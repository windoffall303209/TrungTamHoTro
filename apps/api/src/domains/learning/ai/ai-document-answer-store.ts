import { BadRequestException, ConflictException, ServiceUnavailableException } from "@nestjs/common";
import { createHash } from "node:crypto";
import { z } from "zod";
import type { PrismaService } from "../../../database/prisma.service.js";
import { Prisma } from "../../../generated/prisma/client.js";
import { canReopenAiClaimAfterFailure, createAiClaimLease, currentAiClaimTime, isAiLeaseExpired, type AiClaimLeaseOptions } from "../../system/ai/ai-claim-policy.js";
import type { AiProviderService } from "../../system/ai/ai-provider.service.js";

export type SavedDocumentAnswer = Awaited<ReturnType<AiProviderService["answerDocument"]>> & { warning: string; version: number };
export type DocumentAnswerIdentity = { ownerId: string; materialId: string; version: number; question: string; language: "VI" | "EN" | "BILINGUAL" };
export type DocumentAnswerStatus = { state: "NOT_REQUESTED" | "GENERATING" | "UNCERTAIN" } | { state: "READY"; result: SavedDocumentAnswer };
type HistoryScope = Pick<DocumentAnswerIdentity, "ownerId" | "materialId" | "version">;
type HistoryItem = { id: string; question: string; language: DocumentAnswerIdentity["language"]; state: "RETRY_AUTHORIZED" | "GENERATING" | "READY" | "UNCERTAIN"; createdAt: Date };

type StoredAnswerRow = {
  id: string;
  ownerId: string;
  materialId: string | null;
  sourceVersion: number | null;
  question: string | null;
  language: string | null;
  state: string;
  version: number;
  result: unknown;
  leaseToken: string | null;
  leaseExpiresAt: Date | null;
  createdAt: Date;
};

const ALLOWED_LANGUAGES = ["VI", "EN", "BILINGUAL"] as const;

const sourceSchema = z.object({
  id: z.string().min(1), materialId: z.string().min(1), version: z.number().int().positive(),
  checksum: z.string().min(1), name: z.string().min(1), page: z.number().int().positive(),
  start: z.number().int().nonnegative(), end: z.number().int().nonnegative(), text: z.string().min(1),
}).refine((source) => source.end > source.start);

const answerSchema = z.object({
  answer: z.string().min(1).max(20_000).refine((value) => Boolean(value.trim())),
  insufficientContext: z.boolean(), version: z.number().int().positive(), warning: z.string().min(1),
  model: z.string().min(1).optional(), citations: z.array(sourceSchema).max(8),
}).refine((answer) => answer.insufficientContext ? answer.citations.length === 0 : answer.citations.length > 0);

/** Kiểm tra câu trả lời mới và đã lưu bằng cùng quy tắc, ràng buộc trích dẫn với nguồn và bỏ trường ngoài khai báo. */
function readAnswer(value: unknown, identity: DocumentAnswerIdentity): SavedDocumentAnswer | undefined {
  const parsed = answerSchema.safeParse(value);
  if (!parsed.success || parsed.data.version !== identity.version) return undefined;
  const answer = parsed.data;
  if (answer.citations.some((source) => source.materialId !== identity.materialId || source.version !== identity.version)) return undefined;
  if (new Set(answer.citations.map((source) => source.id)).size !== answer.citations.length) return undefined;
  return answer;
}

/** Chuẩn hóa trạng thái lưu trữ sang tập hợp hợp lệ, coi giá trị lạ là UNCERTAIN. */
function normalizeAnswerState(state: string): HistoryItem["state"] {
  if (state === "RETRY_AUTHORIZED" || state === "GENERATING" || state === "READY") return state;
  return "UNCERTAIN";
}

/** Bộ đệm câu trả lời riêng lưu trong bảng chuyên dụng ai_document_answers; bên gọi kiểm tra quyền nguồn trước và sau mỗi lần dùng. */
export class AiDocumentAnswerStore {
  constructor(
    private readonly prisma?: PrismaService,
    private readonly leaseOptions: AiClaimLeaseOptions = {},
  ) {}

  /** Đọc một trang lịch sử riêng theo phiên bản nguồn qua chỉ mục trực tiếp; không tải JSON câu trả lời vào danh sách. */
  async list(scope: HistoryScope, cursor?: string): Promise<{ items: HistoryItem[]; nextCursor: string | null }> {
    if (!scope.ownerId || !scope.materialId || !Number.isSafeInteger(scope.version) || scope.version < 1 || (cursor !== undefined && !/^[a-f0-9]{64}$/.test(cursor))) {
      throw new BadRequestException("Mốc phân trang bản nháp không hợp lệ.");
    }
    const db = this.database();
    const baseWhere: Prisma.AiDocumentAnswerWhereInput = {
      ownerId: scope.ownerId,
      materialId: scope.materialId,
      sourceVersion: scope.version,
      question: { not: null },
      language: { in: [...ALLOWED_LANGUAGES] },
    };
    const anchor = cursor
      ? await db.aiDocumentAnswer.findFirst({
          where: { ...baseWhere, id: cursor },
          select: { id: true, createdAt: true },
        })
      : undefined;
    if (cursor && !anchor) throw new BadRequestException("Mốc phân trang bản nháp không hợp lệ.");

    const rows = await db.aiDocumentAnswer.findMany({
      where: {
        ...baseWhere,
        ...(anchor
          ? {
              OR: [
                { createdAt: { lt: anchor.createdAt } },
                { createdAt: anchor.createdAt, id: { lt: anchor.id } },
              ],
            }
          : {}),
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 21,
      select: { id: true, question: true, language: true, state: true, createdAt: true },
    });

    const validated: HistoryItem[] = rows.map((row) => {
      const question = row.question ?? "";
      const language = row.language as DocumentAnswerIdentity["language"];
      if (question.trim().length < 2 || question.length > 2000 || this.fingerprint({ ...scope, question, language }) !== row.id) {
        throw new ConflictException("Không xác nhận được việc lưu câu trả lời AI. Không gửi yêu cầu mới.");
      }
      return {
        id: row.id,
        question,
        language,
        state: normalizeAnswerState(row.state),
        createdAt: row.createdAt,
      };
    });

    const items = validated.slice(0, 20);
    return { items, nextCursor: validated.length > 20 ? items.at(-1)!.id : null };
  }

  /** Đọc đúng bản ghi tác vụ riêng mà không tạo dữ liệu hoặc gọi nhà cung cấp. */
  async status(identity: DocumentAnswerIdentity): Promise<DocumentAnswerStatus> {
    const db = this.database();
    const row = await db.aiDocumentAnswer.findUnique({
      where: { id: this.fingerprint(identity) },
      select: { state: true, result: true, leaseExpiresAt: true },
    });
    if (!row || row.state === "RETRY_AUTHORIZED") return { state: "NOT_REQUESTED" };
    if (row.state === "READY") {
      const result = readAnswer(row.result, identity);
      if (result) return { state: "READY", result };
      return { state: "UNCERTAIN" };
    }
    if (row.state === "GENERATING" && !isAiLeaseExpired(row.leaseExpiresAt, currentAiClaimTime(this.leaseOptions))) {
      return { state: "GENERATING" };
    }
    return { state: "UNCERTAIN" };
  }

  /** Tính khóa băm SHA-256 nhất quán theo chủ sở hữu, nguồn, phiên bản, câu hỏi đã chuẩn hóa và ngôn ngữ. */
  private fingerprint(identity: DocumentAnswerIdentity): string {
    return createHash("sha256")
      .update(JSON.stringify(["v1", identity.ownerId, identity.materialId, identity.version, identity.question.trim(), identity.language]))
      .digest("hex");
  }

  /** Giữ quyền sinh một câu trả lời kèm lease trong bảng ai_document_answers; không tự gọi lại tác vụ mơ hồ. */
  async generate(identity: DocumentAnswerIdentity, generate: () => Promise<SavedDocumentAnswer>): Promise<SavedDocumentAnswer> {
    const db = this.database();
    const id = this.fingerprint(identity);
    const question = identity.question.trim();
    const lease = createAiClaimLease(this.leaseOptions);
    let claimed = false;

    try {
      await db.aiDocumentAnswer.create({
        data: {
          id,
          ownerId: identity.ownerId,
          materialId: identity.materialId,
          sourceVersion: identity.version,
          question,
          language: identity.language,
          state: "GENERATING",
          leaseToken: lease.leaseToken,
          leaseExpiresAt: lease.leaseExpiresAt,
        },
      });
      claimed = true;
    } catch (error) {
      if (!error || typeof error !== "object" || !("code" in error) || error.code !== "P2002") throw error;
    }

    let row = await db.aiDocumentAnswer.findUnique({ where: { id } }) as StoredAnswerRow | null;
    const cached = row?.state === "READY" ? readAnswer(row.result, identity) : undefined;
    if (cached) return cached;

    const now = currentAiClaimTime(this.leaseOptions);
    if (!claimed && row && row.state === "GENERATING" && isAiLeaseExpired(row.leaseExpiresAt, now)) {
      // Hết hạn lease hỏi đáp AI sau crash/restart -> chuyển UNCERTAIN bằng CAS version, không tự gọi lại provider.
      await db.aiDocumentAnswer.updateMany({
        where: { id, version: row.version, state: "GENERATING" },
        data: { state: "UNCERTAIN", leaseToken: null, leaseExpiresAt: null, version: { increment: 1 } },
      });
      throw new ConflictException("Lần hỏi đáp AI trước đã hết thời hạn xử lý và chưa rõ kết quả. Không gửi lại để tránh phí trùng; liên hệ quản trị viên đối soát.");
    }

    if (!claimed && row && row.state === "RETRY_AUTHORIZED" && row.ownerId === identity.ownerId && this.sameRequest(row, identity, question)) {
      const reopened = await db.aiDocumentAnswer.updateMany({
        where: { id, version: row.version, ownerId: identity.ownerId, state: "RETRY_AUTHORIZED" },
        data: {
          state: "GENERATING",
          result: Prisma.JsonNull,
          leaseToken: lease.leaseToken,
          leaseExpiresAt: lease.leaseExpiresAt,
          version: { increment: 1 },
        },
      });
      claimed = reopened.count === 1;
      if (claimed) {
        row = { ...row, state: "GENERATING", result: null, leaseToken: lease.leaseToken, leaseExpiresAt: lease.leaseExpiresAt, version: row.version + 1 };
      }
    }

    if (!claimed || !row || row.state !== "GENERATING") {
      throw new ConflictException("Câu hỏi AI đang xử lý hoặc chưa rõ kết quả. Không gửi lại để tránh phí trùng; liên hệ quản trị viên đối soát.");
    }

    try {
      const generated = await generate();
      if (generated?.version !== identity.version) throw new ConflictException("Phiên bản câu trả lời AI không khớp tài liệu yêu cầu.");
      const result = readAnswer(generated, identity);
      if (!result) throw new ConflictException("Câu trả lời tài liệu không đúng cấu trúc.");
      const saved = await db.aiDocumentAnswer.updateMany({
        where: { id, version: row.version, state: "GENERATING", leaseToken: lease.leaseToken },
        data: {
          state: "READY",
          result: result as unknown as Prisma.InputJsonValue,
          leaseToken: null,
          leaseExpiresAt: null,
          version: { increment: 1 },
        },
      });
      if (saved.count !== 1) throw new ConflictException("Không xác nhận được việc lưu câu trả lời AI. Không gửi yêu cầu mới.");
      return result;
    } catch (error) {
      const nextState = canReopenAiClaimAfterFailure(error) ? "RETRY_AUTHORIZED" : "UNCERTAIN";
      await db.aiDocumentAnswer.updateMany({
        where: { id, version: row.version, state: "GENERATING", leaseToken: lease.leaseToken },
        data: {
          state: nextState,
          result: Prisma.JsonNull,
          leaseToken: null,
          leaseExpiresAt: null,
          version: { increment: 1 },
        },
      });
      throw error;
    }
  }

  /** Xác nhận đầy đủ metadata yêu cầu trùng khớp fingerprint trước khi tiêu thụ quyền retry. */
  private sameRequest(row: StoredAnswerRow, expected: DocumentAnswerIdentity, question: string): boolean {
    return row.materialId === expected.materialId
      && row.sourceVersion === expected.version
      && row.question === question
      && row.language === expected.language;
  }

  /** Từ chối thao tác khi database bền vững không khả dụng. */
  private database(): PrismaService {
    if (!this.prisma?.isStartupConnectionEnabled()) {
      throw new ServiceUnavailableException("Hỏi đáp AI yêu cầu database bền vững để chống gửi trùng.");
    }
    return this.prisma;
  }
}
