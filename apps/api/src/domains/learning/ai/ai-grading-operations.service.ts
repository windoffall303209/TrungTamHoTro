import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  ServiceUnavailableException,
} from "@nestjs/common";
import { createHash } from "node:crypto";
import type { AuthenticatedSession } from "../../../auth/auth.service.js";
import { PrismaService } from "../../../database/prisma.service.js";
import { Prisma } from "../../../generated/prisma/client.js";
import {
  ExamOperationsQueryDto,
  GradingOperationsQueryDto,
  ReconcileAiOperationNotProcessedDto,
  ReconcileExamNotProcessedDto,
  examScopes,
  examStates,
} from "./ai-grading-operations.dto.js";

const metadata = {
  id: true,
  ownerId: true,
  submissionId: true,
  language: true,
  state: true,
  createdAt: true,
  updatedAt: true,
} as const;

const operationRowSelect = {
  id: true,
  ownerId: true,
  state: true,
  version: true,
  createdAt: true,
  updatedAt: true,
} as const;

type GradingOperation = {
  id: string;
  ownerId: string;
  submissionId: string;
  language: string;
  state: "RETRY_AUTHORIZED" | "GENERATING" | "READY" | "UNCERTAIN";
  createdAt: Date;
  updatedAt: Date;
};

type StudyOperation = {
  id: string;
  ownerId: string;
  materialId: string;
  sourceVersion: number;
  state: "RETRY_AUTHORIZED" | "GENERATING" | "READY" | "UNCERTAIN";
  createdAt: Date;
  updatedAt: Date;
};

type ExamOperation = {
  id: string;
  ownerId: string;
  state: (typeof examStates)[number];
  version: number;
  createdAt: Date;
  updatedAt: Date;
};

type DocumentAnswerOperation = Omit<ExamOperation, "state"> & {
  state: "RETRY_AUTHORIZED" | "GENERATING" | "READY" | "UNCERTAIN";
};

/** Chuẩn hóa trạng thái tác vụ đọc từ bảng chuyên dụng về tập trạng thái hiển thị hợp lệ. */
function normalizeOperationState(state: string): DocumentAnswerOperation["state"] {
  if (state === "RETRY_AUTHORIZED" || state === "GENERATING" || state === "READY") return state;
  return "UNCERTAIN";
}

@Injectable()
/** Chỉ đọc metadata claim bền vững trên các bảng AI chuyên dụng; không trả bài làm, điểm, phản hồi hoặc bí mật. */
export class AiGradingOperationsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Chỉ liệt kê thông tin quản lý OCR từ bảng ai_document_extractions; không tải nội dung trang. */
  async listExtractions(
    query: GradingOperationsQueryDto,
    session: AuthenticatedSession,
  ): Promise<{ items: DocumentAnswerOperation[]; nextCursor: string | null }> {
    const limit = this.validateQuery(query, session);
    const anchor = query.cursor
      ? await this.prisma.aiDocumentExtraction.findUnique({
          where: { id: query.cursor },
          select: { id: true, createdAt: true },
        })
      : null;
    if (query.cursor && !anchor)
      throw new BadRequestException(
        "Mốc phân trang AI không còn tồn tại. Hãy tải lại danh sách.",
      );
    const states = query.state ? [query.state] : ["GENERATING", "UNCERTAIN"];
    const rows = await this.prisma.aiDocumentExtraction.findMany({
      where: {
        state: { in: states },
        ...(anchor
          ? {
              OR: [
                { createdAt: { lt: anchor.createdAt } },
                { createdAt: anchor.createdAt, id: { lt: anchor.id } },
              ],
            }
          : {}),
      },
      select: operationRowSelect,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1,
    });
    const items = rows.slice(0, limit).map((row) => ({
      ...row,
      state: normalizeOperationState(row.state),
    }));
    return { items, nextCursor: rows.length > limit ? items.at(-1)!.id : null };
  }

  /** Mở lại đúng khóa OCR trong ai_document_extractions sau khi admin xác minh provider chưa xử lý. */
  async reconcileExtractionNotProcessed(
    id: string,
    input: ReconcileExamNotProcessedDto,
    session: AuthenticatedSession,
  ): Promise<DocumentAnswerOperation> {
    this.validateQuery({ limit: 1 }, session);
    if (!/^[a-f0-9]{64}$/.test(id))
      throw new BadRequestException(
        "Mã tác vụ trích xuất tài liệu AI không hợp lệ.",
      );
    const evidence = this.validateSettingRecoveryEvidence(input);
    return this.prisma.$transaction(async (transaction) => {
      const row = await transaction.aiDocumentExtraction.findUnique({
        where: { id },
        select: operationRowSelect,
      });
      if (!row)
        throw new BadRequestException(
          "Không tìm thấy tác vụ trích xuất tài liệu AI cần đối soát.",
        );
      if (row.version !== input.expectedVersion)
        throw new ConflictException(
          "Tác vụ AI đã thay đổi. Tải lại danh sách trước khi đối soát.",
        );
      if (row.state !== "GENERATING" && row.state !== "UNCERTAIN")
        throw new ConflictException(
          "Chỉ tác vụ đang xử lý hoặc chưa rõ kết quả mới được mở lại bằng bằng chứng.",
        );
      if (!row.ownerId)
        throw new ConflictException(
          "Tác vụ OCR không còn chủ sở hữu hợp lệ. Không thể mở lại tự động.",
        );
      if (evidence.checkedAt < row.updatedAt)
        throw new BadRequestException(
          "Bằng chứng phải được kiểm tra sau lần cập nhật gần nhất của tác vụ.",
        );
      const updated = await transaction.aiDocumentExtraction.updateMany({
        where: { id, version: row.version, ownerId: row.ownerId, state: row.state },
        data: {
          state: "RETRY_AUTHORIZED",
          pages: Prisma.JsonNull,
          leaseToken: null,
          leaseExpiresAt: null,
          version: { increment: 1 },
        },
      });
      if (updated.count !== 1)
        throw new ConflictException(
          "Tác vụ AI đã thay đổi. Tải lại danh sách trước khi đối soát.",
        );
      await transaction.auditLog.create({
        data: {
          actorId: session.user.id,
          action: "AI_DOCUMENT_EXTRACTION_RETRY_AUTHORIZED",
          entityType: "ai_document_extraction",
          entityId: id,
          context: {
            previousState: row.state,
            previousVersion: row.version,
            ...this.evidenceContext(evidence),
          },
        },
      });
      return {
        id,
        ownerId: row.ownerId,
        state: "RETRY_AUTHORIZED",
        version: row.version + 1,
        createdAt: row.createdAt,
        updatedAt: new Date(),
      };
    });
  }

  /** Kiểm tra tác vụ trả lời riêng từ bảng ai_document_answers mà không đọc câu hỏi, câu trả lời hay trích dẫn. */
  async listDocumentAnswers(
    query: GradingOperationsQueryDto,
    session: AuthenticatedSession,
  ): Promise<{ items: DocumentAnswerOperation[]; nextCursor: string | null }> {
    const limit = this.validateQuery(query, session);
    const anchor = query.cursor
      ? await this.prisma.aiDocumentAnswer.findUnique({
          where: { id: query.cursor },
          select: { id: true, createdAt: true },
        })
      : null;
    if (query.cursor && !anchor)
      throw new BadRequestException(
        "Mốc phân trang AI không còn tồn tại. Hãy tải lại danh sách.",
      );
    const states = query.state ? [query.state] : ["GENERATING", "UNCERTAIN"];
    const rows = await this.prisma.aiDocumentAnswer.findMany({
      where: {
        state: { in: states },
        ...(anchor
          ? {
              OR: [
                { createdAt: { lt: anchor.createdAt } },
                { createdAt: anchor.createdAt, id: { lt: anchor.id } },
              ],
            }
          : {}),
      },
      select: operationRowSelect,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1,
    });
    const items = rows.slice(0, limit).map((row) => ({
      ...row,
      state: normalizeOperationState(row.state),
    }));
    return { items, nextCursor: rows.length > limit ? items.at(-1)!.id : null };
  }

  /** Mở lại đúng claim hỏi đáp trong ai_document_answers sau khi đối chiếu toàn bộ fingerprint yêu cầu. */
  async reconcileDocumentAnswerNotProcessed(
    id: string,
    input: ReconcileExamNotProcessedDto,
    session: AuthenticatedSession,
  ): Promise<DocumentAnswerOperation> {
    this.validateQuery({ limit: 1 }, session);
    if (!/^[a-f0-9]{64}$/.test(id))
      throw new BadRequestException(
        "Mã tác vụ hỏi đáp tài liệu AI không hợp lệ.",
      );
    const evidence = this.validateSettingRecoveryEvidence(input);
    return this.prisma.$transaction(async (transaction) => {
      const row = await transaction.aiDocumentAnswer.findUnique({
        where: { id },
        select: {
          ...operationRowSelect,
          materialId: true,
          sourceVersion: true,
          question: true,
          language: true,
        },
      });
      if (!row)
        throw new BadRequestException(
          "Không tìm thấy tác vụ hỏi đáp tài liệu AI cần đối soát.",
        );
      if (row.version !== input.expectedVersion)
        throw new ConflictException(
          "Tác vụ AI đã thay đổi. Tải lại danh sách trước khi đối soát.",
        );
      if (row.state !== "GENERATING" && row.state !== "UNCERTAIN")
        throw new ConflictException(
          "Chỉ tác vụ đang xử lý hoặc chưa rõ kết quả mới được mở lại bằng bằng chứng.",
        );
      const materialId = typeof row.materialId === "string" ? row.materialId : "";
      const sourceVersion =
        typeof row.sourceVersion === "number" && Number.isSafeInteger(row.sourceVersion)
          ? row.sourceVersion
          : 0;
      const question = typeof row.question === "string" ? row.question.trim() : "";
      const language = typeof row.language === "string" ? row.language : "";
      const fingerprint = createHash("sha256")
        .update(
          JSON.stringify([
            "v1",
            row.ownerId,
            materialId,
            sourceVersion,
            question,
            language,
          ]),
        )
        .digest("hex");
      if (
        !materialId ||
        sourceVersion < 1 ||
        question.length < 2 ||
        question.length > 2_000 ||
        !["VI", "EN", "BILINGUAL"].includes(language) ||
        fingerprint !== id
      )
        throw new ConflictException(
          "Dữ liệu ràng buộc hỏi đáp AI không hợp lệ. Không thể mở lại tự động.",
        );
      if (evidence.checkedAt < row.updatedAt)
        throw new BadRequestException(
          "Bằng chứng phải được kiểm tra sau lần cập nhật gần nhất của tác vụ.",
        );
      const updated = await transaction.aiDocumentAnswer.updateMany({
        where: { id, version: row.version, ownerId: row.ownerId, state: row.state },
        data: {
          state: "RETRY_AUTHORIZED",
          result: Prisma.JsonNull,
          leaseToken: null,
          leaseExpiresAt: null,
          version: { increment: 1 },
        },
      });
      if (updated.count !== 1)
        throw new ConflictException(
          "Tác vụ AI đã thay đổi. Tải lại danh sách trước khi đối soát.",
        );
      await transaction.auditLog.create({
        data: {
          actorId: session.user.id,
          action: "AI_DOCUMENT_ANSWER_RETRY_AUTHORIZED",
          entityType: "ai_document_answer",
          entityId: id,
          context: {
            previousState: row.state,
            previousVersion: row.version,
            ...this.evidenceContext(evidence),
          },
        },
      });
      return {
        id,
        ownerId: row.ownerId,
        state: "RETRY_AUTHORIZED",
        version: row.version + 1,
        createdAt: row.createdAt,
        updatedAt: new Date(),
      };
    });
  }

  /** Phân trang keyset theo thời điểm tạo và ID; admin xem trạng thái mà không tác động lần gọi AI. */
  async list(
    query: GradingOperationsQueryDto,
    session: AuthenticatedSession,
  ): Promise<{ items: GradingOperation[]; nextCursor: string | null }> {
    const limit = this.validateQuery(query, session);
    const anchor = query.cursor
      ? await this.prisma.aiGradingSuggestion.findUnique({
          where: { id: query.cursor },
          select: { id: true, createdAt: true },
        })
      : null;
    if (query.cursor && !anchor)
      throw new BadRequestException(
        "Mốc phân trang AI không còn tồn tại. Hãy tải lại danh sách.",
      );
    const rows = await this.prisma.aiGradingSuggestion.findMany({
      where: {
        state: query.state ?? { in: ["GENERATING", "UNCERTAIN"] },
        ...(anchor
          ? {
              OR: [
                { createdAt: { lt: anchor.createdAt } },
                { createdAt: anchor.createdAt, id: { lt: anchor.id } },
              ],
            }
          : {}),
      },
      select: metadata,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1,
    });
    const items = rows.slice(0, limit);
    return { items, nextCursor: rows.length > limit ? items.at(-1)!.id : null };
  }

  /** Mở lại đúng một claim chấm AI bằng CAS updatedAt sau khi admin xác nhận provider chưa xử lý. */
  async reconcileGradingNotProcessed(
    id: string,
    input: ReconcileAiOperationNotProcessedDto,
    session: AuthenticatedSession,
  ): Promise<GradingOperation> {
    this.validateQuery({ limit: 1 }, session);
    if (!id || id.length > 191 || !/^[A-Za-z0-9._:-]+$/.test(id))
      throw new BadRequestException("Mã tác vụ chấm AI không hợp lệ.");
    const evidence = this.validateTableRecoveryEvidence(input);
    return this.prisma.$transaction(async (transaction) => {
      const row = await transaction.aiGradingSuggestion.findUnique({
        where: { id },
        select: metadata,
      });
      if (!row)
        throw new BadRequestException(
          "Không tìm thấy tác vụ chấm AI cần đối soát.",
        );
      if (row.updatedAt.getTime() !== evidence.expectedUpdatedAt.getTime())
        throw new ConflictException(
          "Tác vụ AI đã thay đổi. Tải lại danh sách trước khi đối soát.",
        );
      if (row.state !== "GENERATING" && row.state !== "UNCERTAIN")
        throw new ConflictException(
          "Chỉ tác vụ đang xử lý hoặc chưa rõ kết quả mới được mở lại bằng bằng chứng.",
        );
      if (evidence.checkedAt < row.updatedAt)
        throw new BadRequestException(
          "Bằng chứng phải được kiểm tra sau lần cập nhật gần nhất của tác vụ.",
        );
      const updated = await transaction.aiGradingSuggestion.updateMany({
        where: { id, state: row.state, updatedAt: row.updatedAt },
        data: { state: "RETRY_AUTHORIZED", leaseToken: null, leaseExpiresAt: null, result: Prisma.JsonNull },
      });
      if (updated.count !== 1)
        throw new ConflictException(
          "Tác vụ AI đã thay đổi. Tải lại danh sách trước khi đối soát.",
        );
      await transaction.auditLog.create({
        data: {
          actorId: session.user.id,
          action: "AI_GRADING_RETRY_AUTHORIZED",
          entityType: "ai_grading_suggestion",
          entityId: id,
          context: {
            previousState: row.state,
            previousUpdatedAt: row.updatedAt.toISOString(),
            ...this.evidenceContext(evidence),
          },
        },
      });
      return { ...row, state: "RETRY_AUTHORIZED", updatedAt: new Date() };
    });
  }

  /** Đọc metadata bộ ôn tập, tuyệt đối không select options/result hoặc nội dung đã sửa/phát hành. */
  async listStudy(
    query: GradingOperationsQueryDto,
    session: AuthenticatedSession,
  ): Promise<{ items: StudyOperation[]; nextCursor: string | null }> {
    const limit = this.validateQuery(query, session);
    const anchor = query.cursor
      ? await this.prisma.aiStudyDraft.findUnique({
          where: { id: query.cursor },
          select: { id: true, createdAt: true },
        })
      : null;
    if (query.cursor && !anchor)
      throw new BadRequestException(
        "Mốc phân trang AI không còn tồn tại. Hãy tải lại danh sách.",
      );
    const rows = await this.prisma.aiStudyDraft.findMany({
      where: {
        state: query.state ?? { in: ["GENERATING", "UNCERTAIN"] },
        ...(anchor
          ? {
              OR: [
                { createdAt: { lt: anchor.createdAt } },
                { createdAt: anchor.createdAt, id: { lt: anchor.id } },
              ],
            }
          : {}),
      },
      select: {
        id: true,
        ownerId: true,
        materialId: true,
        sourceVersion: true,
        state: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1,
    });
    const items = rows.slice(0, limit);
    return { items, nextCursor: rows.length > limit ? items.at(-1)!.id : null };
  }

  /** Mở lại bản nháp ôn tập chưa phát hành sau đối soát provider; snapshot đã phát hành không bao giờ bị tác động. */
  async reconcileStudyNotProcessed(
    id: string,
    input: ReconcileAiOperationNotProcessedDto,
    session: AuthenticatedSession,
  ): Promise<StudyOperation> {
    this.validateQuery({ limit: 1 }, session);
    if (!id || id.length > 191 || !/^[A-Za-z0-9._:-]+$/.test(id))
      throw new BadRequestException("Mã tác vụ bộ ôn tập AI không hợp lệ.");
    const evidence = this.validateTableRecoveryEvidence(input);
    return this.prisma.$transaction(async (transaction) => {
      const row = await transaction.aiStudyDraft.findUnique({
        where: { id },
        select: {
          id: true,
          ownerId: true,
          materialId: true,
          sourceVersion: true,
          state: true,
          publishedAt: true,
          createdAt: true,
          updatedAt: true,
        },
      });
      if (!row)
        throw new BadRequestException(
          "Không tìm thấy tác vụ bộ ôn tập AI cần đối soát.",
        );
      if (row.updatedAt.getTime() !== evidence.expectedUpdatedAt.getTime())
        throw new ConflictException(
          "Tác vụ AI đã thay đổi. Tải lại danh sách trước khi đối soát.",
        );
      if (row.state !== "GENERATING" && row.state !== "UNCERTAIN")
        throw new ConflictException(
          "Chỉ tác vụ đang xử lý hoặc chưa rõ kết quả mới được mở lại bằng bằng chứng.",
        );
      if (row.publishedAt)
        throw new ConflictException(
          "Bộ ôn tập đã phát hành không được mở lại tác vụ sinh AI.",
        );
      if (evidence.checkedAt < row.updatedAt)
        throw new BadRequestException(
          "Bằng chứng phải được kiểm tra sau lần cập nhật gần nhất của tác vụ.",
        );
      const updated = await transaction.aiStudyDraft.updateMany({
        where: {
          id,
          state: row.state,
          updatedAt: row.updatedAt,
          publishedAt: null,
        },
        data: {
          state: "RETRY_AUTHORIZED",
          leaseToken: null,
          leaseExpiresAt: null,
          result: Prisma.JsonNull,
          editedResult: Prisma.JsonNull,
        },
      });
      if (updated.count !== 1)
        throw new ConflictException(
          "Tác vụ AI đã thay đổi. Tải lại danh sách trước khi đối soát.",
        );
      await transaction.auditLog.create({
        data: {
          actorId: session.user.id,
          action: "AI_STUDY_RETRY_AUTHORIZED",
          entityType: "ai_study_draft",
          entityId: id,
          context: {
            previousState: row.state,
            previousUpdatedAt: row.updatedAt.toISOString(),
            ...this.evidenceContext(evidence),
          },
        },
      });
      const { publishedAt: _publishedAt, ...operation } = row;
      void _publishedAt;
      return { ...operation, state: "RETRY_AUTHORIZED", updatedAt: new Date() };
    });
  }

  /** Đọc request sinh đề gốc hoặc request mất/hỏng liên kết từ hai bảng chuyên dụng, không tải nội dung đề. */
  async listExams(
    query: ExamOperationsQueryDto,
    session: AuthenticatedSession,
  ): Promise<{ items: ExamOperation[]; nextCursor: string | null }> {
    const limit = this.validateQuery({ ...query, state: undefined }, session);
    if (query.state !== undefined && !examStates.includes(query.state))
      throw new BadRequestException("Bộ lọc đối soát AI không hợp lệ.");
    if (query.scope !== undefined && !examScopes.includes(query.scope))
      throw new BadRequestException("Bộ lọc đối soát AI không hợp lệ.");
    const scope = query.scope ?? "canonical";
    const anchor = query.cursor
      ? (
          await this.examRows(
            Prisma.sql`r.id = ${query.cursor}`,
            1,
            scope,
          )
        )[0]
      : undefined;
    if (query.cursor && !anchor)
      throw new BadRequestException(
        "Mốc phân trang AI không còn tồn tại. Hãy tải lại danh sách.",
      );
    const states = query.state
      ? [query.state]
      : examStates.filter((state) => state !== "COMPLETED");
    const stateFilter = Prisma.sql`r.state IN (${Prisma.join(states)})`;
    const position = anchor
      ? Prisma.sql`AND (r.created_at < ${anchor.createdAt} OR (r.created_at = ${anchor.createdAt} AND r.id < ${anchor.id}))`
      : Prisma.empty;
    const rows = await this.examRows(
      Prisma.sql`${stateFilter} ${position}`,
      limit + 1,
      scope,
    );
    const items = rows.slice(0, limit);
    return { items, nextCursor: rows.length > limit ? items.at(-1)!.id : null };
  }

  /** Mở lại claim sinh đề trong ai_generation_requests sau khi xác minh liên kết canonical và ghi audit nguyên tử. */
  async reconcileExamNotProcessed(
    id: string,
    input: ReconcileExamNotProcessedDto,
    session: AuthenticatedSession,
  ): Promise<ExamOperation> {
    this.validateQuery({ limit: 1 }, session);
    if (!id || id.length > 86 || !/^[A-Za-z0-9._:-]+$/.test(id))
      throw new BadRequestException("Mã tác vụ sinh đề AI không hợp lệ.");
    const evidence = this.validateSettingRecoveryEvidence(input);
    const now = new Date();
    return this.prisma.$transaction(async (transaction) => {
      const row = await transaction.aiGenerationRequest.findUnique({
        where: { id },
        select: {
          id: true,
          ownerId: true,
          payloadHash: true,
          state: true,
          version: true,
          createdAt: true,
          updatedAt: true,
        },
      });
      if (!row)
        throw new BadRequestException(
          "Không tìm thấy tác vụ sinh đề AI cần đối soát.",
        );
      if (row.version !== input.expectedVersion)
        throw new ConflictException(
          "Tác vụ AI đã thay đổi. Tải lại danh sách trước khi đối soát.",
        );
      if (
        !row.ownerId ||
        !/^[a-f0-9]{64}$/.test(row.payloadHash) ||
        !["GENERATING", "UNCERTAIN"].includes(row.state)
      )
        throw new ConflictException(
          "Chỉ tác vụ đang xử lý hoặc chưa rõ kết quả mới được mở lại bằng bằng chứng.",
        );
      if (evidence.checkedAt < row.updatedAt)
        throw new BadRequestException(
          "Bằng chứng phải được kiểm tra sau lần cập nhật gần nhất của tác vụ.",
        );
      const binding = await transaction.aiGenerationBinding.findFirst({
        where: {
          canonicalRequestId: id,
          ownerId: row.ownerId,
          payloadHash: row.payloadHash,
          malformed: false,
        },
        select: { fingerprint: true },
      });
      if (!binding)
        throw new ConflictException(
          "Tác vụ không có liên kết nội dung hợp lệ; chưa thể mở lại để tránh tạo trùng.",
        );
      const updated = await transaction.aiGenerationRequest.updateMany({
        where: { id, version: input.expectedVersion, state: row.state },
        data: {
          state: "CLAIMED",
          prepared: Prisma.JsonNull,
          result: Prisma.JsonNull,
          leaseToken: null,
          leaseExpiresAt: null,
          version: { increment: 1 },
        },
      });
      if (updated.count !== 1)
        throw new ConflictException(
          "Tác vụ AI đã thay đổi. Tải lại danh sách trước khi đối soát.",
        );
      await transaction.auditLog.create({
        data: {
          actorId: session.user.id,
          action: "AI_EXAM_RETRY_AUTHORIZED",
          entityType: "ai_generation_request",
          entityId: id,
          context: {
            previousState: row.state,
            previousVersion: row.version,
            ...this.evidenceContext(evidence),
          },
        },
      });
      return {
        id,
        ownerId: row.ownerId,
        state: "CLAIMED",
        version: row.version + 1,
        createdAt: row.createdAt,
        updatedAt: now,
      };
    });
  }

  /** Chiếu metadata trực tiếp từ hai bảng ai_generation_requests và ai_generation_bindings mà không tải JSONB đề thi. */
  private examRows(
    filter: Prisma.Sql,
    limit: number,
    scope: (typeof examScopes)[number],
  ): Promise<ExamOperation[]> {
    if (scope === "canonical") return this.canonicalExamRows(filter, limit);
    const brokenTarget = Prisma.sql`AND (
      b.malformed = TRUE
      OR b.canonical_request_id IS NULL
      OR CHAR_LENGTH(b.canonical_request_id) = 0
      OR NOT EXISTS (
        SELECT 1 FROM ai_generation_requests target
        WHERE target.id = b.canonical_request_id
          AND target.owner_id = b.owner_id
          AND target.payload_hash = b.payload_hash
          AND target.state IN (${Prisma.join(examStates)})
      )
    )`;
    const binding = Prisma.sql`EXISTS (
      SELECT 1 FROM ai_generation_bindings b
      WHERE b.owner_id = r.owner_id
        AND b.payload_hash = r.payload_hash
        ${scope === "broken" ? brokenTarget : Prisma.empty}
    )`;
    const relationship =
      scope === "unlinked" ? Prisma.sql`NOT ${binding}` : binding;
    return this.prisma.$queryRaw<ExamOperation[]>(Prisma.sql`
      SELECT r.id,
        r.owner_id AS "ownerId",
        r.state,
        r.version, r.created_at AS "createdAt", r.updated_at AS "updatedAt"
      FROM ai_generation_requests r
      WHERE ${relationship}
        AND ${filter}
      ORDER BY r.created_at DESC, r.id DESC
      LIMIT ${limit}
    `);
  }

  /** Bắt đầu đối soát từ bảng liên kết ai_generation_bindings rồi nối trực tiếp khóa chính ai_generation_requests. */
  private canonicalExamRows(
    filter: Prisma.Sql,
    limit: number,
  ): Promise<ExamOperation[]> {
    return this.prisma.$queryRaw<ExamOperation[]>(Prisma.sql`
      SELECT DISTINCT r.id,
        r.owner_id AS "ownerId",
        r.state,
        r.version, r.created_at AS "createdAt", r.updated_at AS "updatedAt"
      FROM ai_generation_bindings b
      JOIN ai_generation_requests r
        ON r.id = b.canonical_request_id
        AND b.owner_id = r.owner_id
        AND b.payload_hash = r.payload_hash
      WHERE b.malformed = FALSE
        AND b.canonical_request_id IS NOT NULL
        AND CHAR_LENGTH(b.canonical_request_id) > 0
        AND ${filter}
      ORDER BY "createdAt" DESC, id DESC
      LIMIT ${limit}
    `);
  }

  /** Dùng chung quyền và quy tắc đầu vào cho mọi hàng đợi trước khi truy cập database. */
  private validateQuery(
    query: GradingOperationsQueryDto,
    session: AuthenticatedSession,
  ): number {
    if (
      session.roleCode !== "SYSTEM_ADMIN" ||
      !session.permissions.includes("system:configure")
    )
      throw new ForbiddenException(
        "Chỉ quản trị viên hệ thống được đối soát tác vụ AI.",
      );
    if (!this.prisma.isStartupConnectionEnabled())
      throw new ServiceUnavailableException(
        "Đối soát tác vụ AI yêu cầu database bền vững.",
      );
    const limit = query.limit ?? 20;
    if (
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 50 ||
      (query.state !== undefined &&
        !["RETRY_AUTHORIZED", "GENERATING", "READY", "UNCERTAIN"].includes(
          query.state,
        )) ||
      (query.cursor !== undefined &&
        (typeof query.cursor !== "string" ||
          !query.cursor.length ||
          query.cursor.length > 191))
    )
      throw new BadRequestException("Bộ lọc đối soát AI không hợp lệ.");
    return limit;
  }

  /** Kiểm tra bằng chứng và hai mốc thời gian dùng chung cho claim nằm trong bảng AI. */
  private validateTableRecoveryEvidence(
    input: ReconcileAiOperationNotProcessedDto,
  ): {
    expectedUpdatedAt: Date;
    checkedAt: Date;
    evidenceReference: string;
    evidenceNote: string;
    providerRequestId?: string;
  } {
    const evidenceReference = input.evidenceReference.trim();
    const evidenceNote = input.evidenceNote.trim();
    const providerRequestId = input.providerRequestId?.trim() || undefined;
    if (evidenceReference.length < 8 || evidenceNote.length < 20)
      throw new BadRequestException("Bằng chứng đối soát AI chưa đầy đủ.");
    const expectedUpdatedAt = new Date(input.expectedUpdatedAt);
    const checkedAt = new Date(input.checkedAt);
    if (
      !Number.isFinite(expectedUpdatedAt.getTime()) ||
      !Number.isFinite(checkedAt.getTime()) ||
      checkedAt.getTime() > Date.now() + 5 * 60_000
    )
      throw new BadRequestException(
        "Thời điểm kiểm tra bằng chứng AI không hợp lệ.",
      );
    return {
      expectedUpdatedAt,
      checkedAt,
      evidenceReference,
      evidenceNote,
      ...(providerRequestId ? { providerRequestId } : {}),
    };
  }

  /** Kiểm tra bằng chứng cho claim dùng version làm khóa CAS. */
  private validateSettingRecoveryEvidence(
    input: ReconcileExamNotProcessedDto,
  ): {
    checkedAt: Date;
    evidenceReference: string;
    evidenceNote: string;
    providerRequestId?: string;
  } {
    const evidenceReference = input.evidenceReference.trim();
    const evidenceNote = input.evidenceNote.trim();
    const providerRequestId = input.providerRequestId?.trim() || undefined;
    const checkedAt = new Date(input.checkedAt);
    if (evidenceReference.length < 8 || evidenceNote.length < 20)
      throw new BadRequestException("Bằng chứng đối soát AI chưa đầy đủ.");
    if (
      !Number.isFinite(checkedAt.getTime()) ||
      checkedAt.getTime() > Date.now() + 5 * 60_000
    )
      throw new BadRequestException(
        "Thời điểm kiểm tra bằng chứng AI không hợp lệ.",
      );
    return {
      checkedAt,
      evidenceReference,
      evidenceNote,
      ...(providerRequestId ? { providerRequestId } : {}),
    };
  }

  /** Chuyển toàn bộ lease GENERATING đã hết hạn trên 5 bảng AI chuyên dụng sang UNCERTAIN; không tự gọi lại AI. */
  async expireStaleGeneratingLeases(now = new Date()): Promise<{
    grading: number;
    study: number;
    extraction: number;
    documentAnswer: number;
    exam: number;
  }> {
    if (!this.prisma.isStartupConnectionEnabled()) {
      throw new ServiceUnavailableException(
        "Cần cơ sở dữ liệu bền vững để thu hồi lease tác vụ AI đã hết hạn.",
      );
    }
    const [grading, study, extraction, documentAnswer, exam] = await Promise.all([
      this.prisma.aiGradingSuggestion.updateMany({
        where: { state: "GENERATING", leaseExpiresAt: { lte: now } },
        data: { state: "UNCERTAIN", leaseToken: null, leaseExpiresAt: null },
      }),
      this.prisma.aiStudyDraft.updateMany({
        where: { state: "GENERATING", leaseExpiresAt: { lte: now } },
        data: { state: "UNCERTAIN", leaseToken: null, leaseExpiresAt: null },
      }),
      this.prisma.aiDocumentExtraction.updateMany({
        where: { state: "GENERATING", leaseExpiresAt: { lte: now } },
        data: { state: "UNCERTAIN", leaseToken: null, leaseExpiresAt: null, version: { increment: 1 } },
      }),
      this.prisma.aiDocumentAnswer.updateMany({
        where: { state: "GENERATING", leaseExpiresAt: { lte: now } },
        data: { state: "UNCERTAIN", leaseToken: null, leaseExpiresAt: null, version: { increment: 1 } },
      }),
      this.prisma.aiGenerationRequest.updateMany({
        where: { state: "GENERATING", leaseExpiresAt: { lte: now } },
        data: { state: "UNCERTAIN", leaseToken: null, leaseExpiresAt: null, version: { increment: 1 } },
      }),
    ]);

    return {
      grading: grading.count,
      study: study.count,
      extraction: extraction.count,
      documentAnswer: documentAnswer.count,
      exam: exam.count,
    };
  }

  /** Chuẩn hóa metadata bằng chứng trước khi ghi audit. */
  private evidenceContext(evidence: {
    checkedAt: Date;
    evidenceReference: string;
    evidenceNote: string;
    providerRequestId?: string;
  }): Record<string, string> {
    return {
      evidenceReference: evidence.evidenceReference,
      evidenceNote: evidence.evidenceNote,
      checkedAt: evidence.checkedAt.toISOString(),
      ...(evidence.providerRequestId
        ? { providerRequestId: evidence.providerRequestId }
        : {}),
    };
  }
}
