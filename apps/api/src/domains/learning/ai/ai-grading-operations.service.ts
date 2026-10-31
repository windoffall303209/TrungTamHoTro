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

@Injectable()
/** Chỉ đọc metadata claim bền vững; không trả bài làm, điểm, phản hồi, hash hoặc cấu hình bí mật. */
export class AiGradingOperationsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Chỉ liệt kê thông tin quản lý OCR; READY là trạng thái lưu trữ, không xác nhận độ chính xác văn bản. */
  async listExtractions(
    query: GradingOperationsQueryDto,
    session: AuthenticatedSession,
  ): Promise<{ items: DocumentAnswerOperation[]; nextCursor: string | null }> {
    const limit = this.validateQuery(query, session);
    const anchor = query.cursor
      ? (
          await this.extractionRows(
            Prisma.sql`r."key" = ${`ai-doc:${query.cursor}`}`,
            1,
          )
        )[0]
      : undefined;
    if (query.cursor && !anchor)
      throw new BadRequestException(
        "Mốc phân trang AI không còn tồn tại. Hãy tải lại danh sách.",
      );
    const states = query.state ? [query.state] : ["GENERATING", "UNCERTAIN"];
    const position = anchor
      ? Prisma.sql`AND (r.effective_at < ${anchor.createdAt} OR (r.effective_at = ${anchor.createdAt} AND r."key" < ${`ai-doc:${anchor.id}`}))`
      : Prisma.empty;
    const rows = await this.extractionRows(
      Prisma.sql`claim_state IN (${Prisma.join(states)}) ${position}`,
      limit + 1,
    );
    const items = rows.slice(0, limit);
    return { items, nextCursor: rows.length > limit ? items.at(-1)!.id : null };
  }

  /** Mở lại đúng khóa OCR sau khi admin xác minh provider không nhận yêu cầu; không gọi provider trong bước này. */
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
    const key = `ai-doc:${id}`;
    return this.prisma.$transaction(async (transaction) => {
      const row = await transaction.systemSetting.findUnique({
        where: { key },
      });
      if (!row)
        throw new BadRequestException(
          "Không tìm thấy tác vụ trích xuất tài liệu AI cần đối soát.",
        );
      if (row.version !== input.expectedVersion)
        throw new ConflictException(
          "Tác vụ AI đã thay đổi. Tải lại danh sách trước khi đối soát.",
        );
      const value = this.readSettingClaim(row.value);
      if (value.state !== "GENERATING" && value.state !== "UNCERTAIN")
        throw new ConflictException(
          "Chỉ tác vụ đang xử lý hoặc chưa rõ kết quả mới được mở lại bằng bằng chứng.",
        );
      if (!row.updatedBy)
        throw new ConflictException(
          "Tác vụ OCR không còn chủ sở hữu hợp lệ. Không thể mở lại tự động.",
        );
      if (evidence.checkedAt < row.updatedAt)
        throw new BadRequestException(
          "Bằng chứng phải được kiểm tra sau lần cập nhật gần nhất của tác vụ.",
        );
      const updated = await transaction.systemSetting.updateMany({
        where: { key, version: row.version, updatedBy: row.updatedBy },
        data: {
          value: { state: "RETRY_AUTHORIZED" },
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
            previousState: value.state,
            previousVersion: row.version,
            ...this.evidenceContext(evidence),
          },
        },
      });
      return {
        id,
        ownerId: row.updatedBy,
        state: "RETRY_AUTHORIZED",
        version: row.version + 1,
        createdAt: row.effectiveAt,
        updatedAt: new Date(),
      };
    });
  }

  /** Chỉ lấy thông tin quản lý tác vụ, không tải các trang; bản lưu dạng mảng cũ được xếp vào READY. */
  private extractionRows(
    filter: Prisma.Sql,
    limit: number,
  ): Promise<DocumentAnswerOperation[]> {
    return this.prisma.$queryRaw<DocumentAnswerOperation[]>(Prisma.sql`
      SELECT SUBSTRING(r."key", 8) AS id, r.updated_by AS "ownerId",
        r.claim_state AS state, r.version, r.effective_at AS "createdAt", r.updated_at AS "updatedAt"
      FROM (
        SELECT "key", updated_by, version, effective_at, updated_at,
          CASE WHEN jsonb_typeof(value) = 'array' THEN 'READY'
            WHEN value->>'state' IN ('RETRY_AUTHORIZED', 'GENERATING', 'READY')
            THEN value->>'state' ELSE 'UNCERTAIN' END AS claim_state
        FROM system_settings WHERE "key" LIKE 'ai-doc:%'
      ) r
      WHERE ${filter}
      ORDER BY r.effective_at DESC, r."key" DESC
      LIMIT ${limit}
    `);
  }

  /** Kiểm tra tác vụ trả lời riêng mà không đọc câu hỏi, câu trả lời, trích dẫn hoặc cấu hình nhà cung cấp. */
  async listDocumentAnswers(
    query: GradingOperationsQueryDto,
    session: AuthenticatedSession,
  ): Promise<{ items: DocumentAnswerOperation[]; nextCursor: string | null }> {
    const limit = this.validateQuery(query, session);
    const anchor = query.cursor
      ? (
          await this.documentAnswerRows(
            Prisma.sql`r."key" = ${`ai-doc-answer:${query.cursor}`}`,
            1,
          )
        )[0]
      : undefined;
    if (query.cursor && !anchor)
      throw new BadRequestException(
        "Mốc phân trang AI không còn tồn tại. Hãy tải lại danh sách.",
      );
    const states = query.state ? [query.state] : ["GENERATING", "UNCERTAIN"];
    const position = anchor
      ? Prisma.sql`AND (r.effective_at < ${anchor.createdAt} OR (r.effective_at = ${anchor.createdAt} AND r."key" < ${`ai-doc-answer:${anchor.id}`}))`
      : Prisma.empty;
    const rows = await this.documentAnswerRows(
      Prisma.sql`claim_state IN (${Prisma.join(states)}) ${position}`,
      limit + 1,
    );
    const items = rows.slice(0, limit);
    return { items, nextCursor: rows.length > limit ? items.at(-1)!.id : null };
  }

  /** Chỉ lấy thông tin vận hành bằng SQL; trạng thái lỗi vẫn hiện là chưa xác định và không tự thử lại. */
  private documentAnswerRows(
    filter: Prisma.Sql,
    limit: number,
  ): Promise<DocumentAnswerOperation[]> {
    return this.prisma.$queryRaw<DocumentAnswerOperation[]>(Prisma.sql`
      SELECT SUBSTRING(r."key", 15) AS id, r.updated_by AS "ownerId",
        r.claim_state AS state, r.version, r.effective_at AS "createdAt", r.updated_at AS "updatedAt"
      FROM (
        SELECT "key", updated_by, version, effective_at, updated_at,
          CASE WHEN value->>'state' IN ('RETRY_AUTHORIZED', 'GENERATING', 'READY')
            THEN value->>'state' ELSE 'UNCERTAIN' END AS claim_state
        FROM system_settings WHERE "key" LIKE 'ai-doc-answer:%'
      ) r
      WHERE ${filter}
      ORDER BY r.effective_at DESC, r."key" DESC
      LIMIT ${limit}
    `);
  }

  /** Mở lại đúng claim hỏi đáp đã được ràng buộc với người dùng, tài liệu, phiên bản, câu hỏi và ngôn ngữ. */
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
    const key = `ai-doc-answer:${id}`;
    return this.prisma.$transaction(async (transaction) => {
      const row = await transaction.systemSetting.findUnique({
        where: { key },
      });
      if (!row)
        throw new BadRequestException(
          "Không tìm thấy tác vụ hỏi đáp tài liệu AI cần đối soát.",
        );
      if (row.version !== input.expectedVersion)
        throw new ConflictException(
          "Tác vụ AI đã thay đổi. Tải lại danh sách trước khi đối soát.",
        );
      const value = this.readSettingClaim(row.value);
      const request = value.request;
      if (
        !request ||
        (value.state !== "GENERATING" && value.state !== "UNCERTAIN")
      )
        throw new ConflictException(
          "Chỉ tác vụ đang xử lý hoặc chưa rõ kết quả mới được mở lại bằng bằng chứng.",
        );
      const materialId =
        typeof request.materialId === "string" ? request.materialId : "";
      const version =
        typeof request.version === "number" &&
        Number.isSafeInteger(request.version)
          ? request.version
          : 0;
      const question =
        typeof request.question === "string" ? request.question.trim() : "";
      const language =
        typeof request.language === "string" ? request.language : "";
      const fingerprint = createHash("sha256")
        .update(
          JSON.stringify([
            "v1",
            row.updatedBy,
            materialId,
            version,
            question,
            language,
          ]),
        )
        .digest("hex");
      if (
        !materialId ||
        version < 1 ||
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
      const normalizedRequest = { materialId, version, question, language };
      const updated = await transaction.systemSetting.updateMany({
        where: { key, version: row.version, updatedBy: row.updatedBy },
        data: {
          value: { state: "RETRY_AUTHORIZED", request: normalizedRequest },
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
            previousState: value.state,
            previousVersion: row.version,
            ...this.evidenceContext(evidence),
          },
        },
      });
      return {
        id,
        ownerId: row.updatedBy,
        state: "RETRY_AUTHORIZED",
        version: row.version + 1,
        createdAt: row.effectiveAt,
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
        data: { state: "RETRY_AUTHORIZED", result: Prisma.JsonNull },
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
            evidenceReference: evidence.evidenceReference,
            evidenceNote: evidence.evidenceNote,
            checkedAt: evidence.checkedAt.toISOString(),
            ...(evidence.providerRequestId
              ? { providerRequestId: evidence.providerRequestId }
              : {}),
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
            evidenceReference: evidence.evidenceReference,
            evidenceNote: evidence.evidenceNote,
            checkedAt: evidence.checkedAt.toISOString(),
            ...(evidence.providerRequestId
              ? { providerRequestId: evidence.providerRequestId }
              : {}),
          },
        },
      });
      const { publishedAt: _publishedAt, ...operation } = row;
      void _publishedAt;
      return { ...operation, state: "RETRY_AUTHORIZED", updatedAt: new Date() };
    });
  }

  /** Đọc request gốc hoặc request bị ảnh hưởng bởi liên kết thiếu/hỏng; không đọc nội dung đề. */
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
            Prisma.sql`r."key" = ${`ai-generation:${query.cursor}`}`,
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
    const stateFilter = Prisma.sql`r.value->>'state' IN (${Prisma.join(states)})`;
    const position = anchor
      ? Prisma.sql`AND (r.effective_at < ${anchor.createdAt} OR (r.effective_at = ${anchor.createdAt} AND r."key" < ${`ai-generation:${anchor.id}`}))`
      : Prisma.empty;
    const rows = await this.examRows(
      Prisma.sql`${stateFilter} ${position}`,
      limit + 1,
      scope,
    );
    const items = rows.slice(0, limit);
    return { items, nextCursor: rows.length > limit ? items.at(-1)!.id : null };
  }

  /** Mở lại claim chỉ sau xác nhận có bằng chứng rằng provider chưa xử lý yêu cầu, đồng thời ghi audit nguyên tử. */
  async reconcileExamNotProcessed(
    id: string,
    input: ReconcileExamNotProcessedDto,
    session: AuthenticatedSession,
  ): Promise<ExamOperation> {
    this.validateQuery({ limit: 1 }, session);
    if (!id || id.length > 86 || !/^[A-Za-z0-9._:-]+$/.test(id))
      throw new BadRequestException("Mã tác vụ sinh đề AI không hợp lệ.");
    const evidenceReference = input.evidenceReference.trim();
    const evidenceNote = input.evidenceNote.trim();
    const providerRequestId = input.providerRequestId?.trim() || undefined;
    if (evidenceReference.length < 8 || evidenceNote.length < 20)
      throw new BadRequestException("Bằng chứng đối soát AI chưa đầy đủ.");
    const checkedAt = new Date(input.checkedAt);
    const now = new Date();
    if (
      !Number.isFinite(checkedAt.getTime()) ||
      checkedAt.getTime() > now.getTime() + 5 * 60_000
    )
      throw new BadRequestException(
        "Thời điểm kiểm tra bằng chứng AI không hợp lệ.",
      );
    const key = `ai-generation:${id}`;
    return this.prisma.$transaction(async (transaction) => {
      const row = await transaction.systemSetting.findUnique({
        where: { key },
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
        !row.value ||
        typeof row.value !== "object" ||
        Array.isArray(row.value)
      )
        throw new ConflictException(
          "Dữ liệu khóa sinh đề AI không hợp lệ. Không thể mở lại tự động.",
        );
      const value = row.value as Record<string, unknown>;
      const owner = typeof value.owner === "string" ? value.owner : "";
      const hash = typeof value.hash === "string" ? value.hash : "";
      const state = typeof value.state === "string" ? value.state : "";
      if (
        !owner ||
        !/^[a-f0-9]{64}$/.test(hash) ||
        !["GENERATING", "UNCERTAIN"].includes(state)
      )
        throw new ConflictException(
          "Chỉ tác vụ đang xử lý hoặc chưa rõ kết quả mới được mở lại bằng bằng chứng.",
        );
      if (checkedAt < row.updatedAt)
        throw new BadRequestException(
          "Bằng chứng phải được kiểm tra sau lần cập nhật gần nhất của tác vụ.",
        );
      const bindings = await transaction.$queryRaw<
        Array<{ present: number }>
      >(Prisma.sql`
        SELECT 1 AS present
        FROM system_settings b
        WHERE b."key" LIKE 'ai-generation-content:%'
          AND jsonb_typeof(b.value->'canonicalRequestId') = 'string'
          AND b.value->>'canonicalRequestId' = ${id}
          AND b.value->>'owner' = ${owner}
          AND b.value->>'hash' = ${hash}
        LIMIT 1
      `);
      if (!bindings.length)
        throw new ConflictException(
          "Tác vụ không có liên kết nội dung hợp lệ; chưa thể mở lại để tránh tạo trùng.",
        );
      const updated = await transaction.systemSetting.updateMany({
        where: { key, version: input.expectedVersion },
        data: {
          value: { owner, hash, state: "CLAIMED" },
          version: { increment: 1 },
          updatedBy: session.user.id,
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
            previousState: state,
            previousVersion: row.version,
            evidenceReference,
            evidenceNote,
            checkedAt: checkedAt.toISOString(),
            ...(providerRequestId ? { providerRequestId } : {}),
          },
        },
      });
      return {
        id,
        ownerId: owner,
        state: "CLAIMED",
        version: row.version + 1,
        createdAt: row.effectiveAt,
        updatedAt: now,
      };
    });
  }

  /** Chiếu metadata ngay trong SQL: không tải prepared/result hoặc giá trị cấu hình hệ thống vào API. */
  private examRows(
    filter: Prisma.Sql,
    limit: number,
    scope: (typeof examScopes)[number],
  ): Promise<ExamOperation[]> {
    if (scope === "canonical") return this.canonicalExamRows(filter, limit);
    // Liên kết hỏng có thể ảnh hưởng nhiều mã thử lại; phạm vi này đếm yêu cầu bị ảnh hưởng, không đếm tác vụ duy nhất.
    const brokenTarget = Prisma.sql`AND NOT EXISTS (
      SELECT 1 FROM system_settings target
      WHERE jsonb_typeof(b.value->'canonicalRequestId') = 'string'
        AND CHAR_LENGTH(b.value->>'canonicalRequestId') > 0
        AND target."key" = 'ai-generation:' || (b.value->>'canonicalRequestId')
        AND target.value->>'owner' = b.value->>'owner'
        AND target.value->>'hash' = b.value->>'hash'
        AND target.value->>'state' IN (${Prisma.join(examStates)})
    )`;
    // Bí danh thử lại dùng chung liên kết chủ sở hữu và mã băm; không được báo thành tác vụ mất liên kết.
    const binding = Prisma.sql`EXISTS (
      SELECT 1 FROM system_settings b
      WHERE b."key" LIKE 'ai-generation-content:%'
        AND b.value->>'owner' = r.value->>'owner'
        AND b.value->>'hash' = r.value->>'hash'
        ${scope === "broken" ? brokenTarget : Prisma.empty}
    )`;
    const relationship =
      scope === "unlinked" ? Prisma.sql`NOT ${binding}` : binding;
    return this.prisma.$queryRaw<ExamOperation[]>(Prisma.sql`
      SELECT SUBSTRING(r."key", 15) AS id,
        r.value->>'owner' AS "ownerId",
        r.value->>'state' AS state,
        r.version, r.effective_at AS "createdAt", r.updated_at AS "updatedAt"
      FROM system_settings r
      WHERE r."key" LIKE 'ai-generation:%'
        AND ${relationship}
        AND ${filter}
      ORDER BY r.effective_at DESC, r."key" DESC
      LIMIT ${limit}
    `);
  }

  /** Bắt đầu đối soát từ liên kết chính thức, rồi tra khóa chính một lần cho mỗi tác vụ đích. */
  private canonicalExamRows(
    filter: Prisma.Sql,
    limit: number,
  ): Promise<ExamOperation[]> {
    return this.prisma.$queryRaw<ExamOperation[]>(Prisma.sql`
      SELECT DISTINCT SUBSTRING(r."key", 15) AS id,
        r.value->>'owner' AS "ownerId",
        r.value->>'state' AS state,
        r.version, r.effective_at AS "createdAt", r.updated_at AS "updatedAt"
      FROM system_settings b
      JOIN system_settings r
        ON r."key" = 'ai-generation:' || (b.value->>'canonicalRequestId')
        AND b.value->>'owner' = r.value->>'owner'
        AND b.value->>'hash' = r.value->>'hash'
      WHERE b."key" LIKE 'ai-generation-content:%'
        AND jsonb_typeof(b.value->'canonicalRequestId') = 'string'
        AND CHAR_LENGTH(b.value->>'canonicalRequestId') > 0
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

  /** Đọc phần metadata tối thiểu của claim JSON, không chiếu nội dung kết quả riêng tư. */
  private readSettingClaim(value: Prisma.JsonValue): {
    state: unknown;
    request?: Record<string, unknown>;
  } {
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new ConflictException(
        "Dữ liệu khóa AI không hợp lệ. Không thể mở lại tự động.",
      );
    const claim = value as Record<string, unknown>;
    const request = claim.request;
    return {
      state: claim.state,
      ...(request && typeof request === "object" && !Array.isArray(request)
        ? { request: request as Record<string, unknown> }
        : {}),
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
