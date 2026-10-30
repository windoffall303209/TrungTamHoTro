import { BadRequestException, ConflictException, ServiceUnavailableException } from "@nestjs/common";
import { createHash } from "node:crypto";
import { z } from "zod";
import type { PrismaService } from "../../database/prisma.service.js";
import type { AiProviderService } from "../system/ai-provider.service.js";
import { Prisma } from "../../generated/prisma/client.js";

export type SavedDocumentAnswer = Awaited<ReturnType<AiProviderService["answerDocument"]>> & { warning: string; version: number };
export type DocumentAnswerIdentity = { ownerId: string; materialId: string; version: number; question: string; language: "VI" | "EN" | "BILINGUAL" };
type AnswerRequest = Pick<DocumentAnswerIdentity, "materialId" | "version" | "question" | "language">;
type Claim = { state: "RETRY_AUTHORIZED" | "GENERATING" | "READY" | "UNCERTAIN"; request?: AnswerRequest; result?: SavedDocumentAnswer };
export type DocumentAnswerStatus = { state: "NOT_REQUESTED" | "GENERATING" | "UNCERTAIN" } | { state: "READY"; result: SavedDocumentAnswer };
type HistoryScope = Pick<DocumentAnswerIdentity, "ownerId" | "materialId" | "version">;
type HistoryItem = { id: string; question: string; language: DocumentAnswerIdentity["language"]; state: "RETRY_AUTHORIZED" | "GENERATING" | "READY" | "UNCERTAIN"; createdAt: Date };

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

/** Bộ đệm câu trả lời riêng lưu bền vững; bên gọi kiểm tra quyền nguồn trước và sau mỗi lần sử dụng. */
export class AiDocumentAnswerStore {
  constructor(private readonly prisma?: PrismaService) {}

  /** Đọc một trang lịch sử riêng theo phiên bản nguồn; tác vụ cũ thiếu thông tin yêu cầu vẫn dùng lại được nhưng không liệt kê. */
  async list(scope: HistoryScope, cursor?: string): Promise<{ items: HistoryItem[]; nextCursor: string | null }> {
    if (!scope.ownerId || !scope.materialId || !Number.isSafeInteger(scope.version) || scope.version < 1 || (cursor !== undefined && !/^[a-f0-9]{64}$/.test(cursor))) throw new BadRequestException("Mốc phân trang bản nháp không hợp lệ.");
    const anchor = cursor ? (await this.historyRows(scope, Prisma.sql`AND r."key" = ${`ai-doc-answer:${cursor}`}`, 1))[0] : undefined;
    if (cursor && !anchor) throw new BadRequestException("Mốc phân trang bản nháp không hợp lệ.");
    const position = anchor ? Prisma.sql`AND (r.effective_at < ${anchor.createdAt} OR (r.effective_at = ${anchor.createdAt} AND r."key" < ${`ai-doc-answer:${anchor.id}`}))` : Prisma.empty;
    const rows = await this.historyRows(scope, position, 21);
    const items = rows.slice(0, 20);
    return { items, nextCursor: rows.length > 20 ? items.at(-1)!.id : null };
  }

  /** Áp dụng ràng buộc chủ sở hữu và nguồn trước phân trang; không tải câu trả lời hoặc trích dẫn vào danh sách lịch sử. */
  private async historyRows(scope: HistoryScope, position: Prisma.Sql, limit: number): Promise<HistoryItem[]> {
    if (!this.prisma?.isStartupConnectionEnabled()) throw new ServiceUnavailableException("Hỏi đáp AI yêu cầu database bền vững để chống gửi trùng.");
    const rows = await this.prisma.$queryRaw<HistoryItem[]>(Prisma.sql`
      SELECT SUBSTRING(r."key", 15) AS id,
        r.value->'request'->>'question' AS question,
        r.value->'request'->>'language' AS language,
        CASE WHEN r.value->>'state' IN ('RETRY_AUTHORIZED', 'GENERATING', 'READY')
          THEN r.value->>'state' ELSE 'UNCERTAIN' END AS state,
        r.effective_at AS "createdAt"
      FROM system_settings r
      WHERE r."key" LIKE 'ai-doc-answer:%' AND r.updated_by = ${scope.ownerId}
        AND r.value->'request'->>'materialId' = ${scope.materialId}
        AND CASE WHEN jsonb_typeof(r.value->'request'->'version') = 'number' THEN (r.value->'request'->>'version')::integer END = ${scope.version}
        AND jsonb_typeof(r.value->'request'->'question') = 'string'
        AND r.value->'request'->>'language' IN ('VI', 'EN', 'BILINGUAL')
        ${position}
      ORDER BY r.effective_at DESC, r."key" DESC LIMIT ${limit}
    `);
    for (const row of rows) {
      if (row.question.trim().length < 2 || row.question.length > 2000 || this.key({ ...scope, question: row.question, language: row.language }) !== `ai-doc-answer:${row.id}`) throw new ConflictException("Không xác nhận được việc lưu câu trả lời AI. Không gửi yêu cầu mới.");
    }
    return rows;
  }

  /** Đọc đúng bản ghi tác vụ riêng mà không tạo dữ liệu hoặc gọi nhà cung cấp. */
  async status(identity: DocumentAnswerIdentity): Promise<DocumentAnswerStatus> {
    if (!this.prisma?.isStartupConnectionEnabled()) throw new ServiceUnavailableException("Hỏi đáp AI yêu cầu database bền vững để chống gửi trùng.");
    const row = await this.prisma.systemSetting.findUnique({ where: { key: this.key(identity) }, select: { value: true } });
    if (!row) return { state: "NOT_REQUESTED" };
    const claim = row.value as Claim | null;
    if (claim?.state === "RETRY_AUTHORIZED") return { state: "NOT_REQUESTED" };
    const result = claim?.state === "READY" ? readAnswer(claim.result, identity) : undefined;
    if (result) return { state: "READY", result };
    return { state: claim?.state === "GENERATING" ? "GENERATING" : "UNCERTAIN" };
  }

  /** Dùng cùng định danh đã chuẩn hóa cho đọc trạng thái và giữ quyền sinh nội dung. */
  private key(identity: DocumentAnswerIdentity): string {
    return `ai-doc-answer:${createHash("sha256").update(JSON.stringify(["v1", identity.ownerId, identity.materialId, identity.version, identity.question.trim(), identity.language])).digest("hex")}`;
  }

  /** Giữ quyền sinh một câu trả lời theo chủ sở hữu, phiên bản nguồn, câu hỏi và ngôn ngữ; không gọi lại tác vụ chưa rõ kết quả. */
  async generate(identity: DocumentAnswerIdentity, generate: () => Promise<SavedDocumentAnswer>): Promise<SavedDocumentAnswer> {
    if (!this.prisma?.isStartupConnectionEnabled()) throw new ServiceUnavailableException("Hỏi đáp AI yêu cầu database bền vững để chống gửi trùng.");
    const key = this.key(identity);
    // Thông tin lịch sử riêng được lưu cùng tác vụ, không nằm trong khóa hoặc dữ liệu hàng đợi quản trị.
    const request = { materialId: identity.materialId, version: identity.version, question: identity.question.trim(), language: identity.language };
    let claimed = false;
    try {
      await this.prisma.systemSetting.create({ data: { key, updatedBy: identity.ownerId, value: { state: "GENERATING", request } } });
      claimed = true;
    } catch (error) {
      if (!error || typeof error !== "object" || !("code" in error) || error.code !== "P2002") throw error;
    }
    let row = await this.prisma.systemSetting.findUnique({ where: { key } });
    let claim = row?.value as Claim | undefined;
    const cached = claim?.state === "READY" ? readAnswer(claim.result, identity) : undefined;
    if (cached) return cached;
    if (!claimed && row && claim?.state === "RETRY_AUTHORIZED" && row.updatedBy === identity.ownerId && this.sameRequest(claim.request, request)) {
      const reopened = await this.prisma.systemSetting.updateMany({ where: { key, version: row.version, updatedBy: identity.ownerId }, data: { value: { state: "GENERATING", request }, version: { increment: 1 } } });
      claimed = reopened.count === 1;
      if (claimed) {
        row = { ...row, version: row.version + 1, value: { state: "GENERATING", request } };
        claim = row.value as Claim;
      }
    }
    if (!claimed || !row || claim?.state !== "GENERATING") throw new ConflictException("Câu hỏi AI đang xử lý hoặc chưa rõ kết quả. Không gửi lại để tránh phí trùng; liên hệ quản trị viên đối soát.");
    try {
      const generated = await generate();
      if (generated?.version !== identity.version) throw new ConflictException("Phiên bản câu trả lời AI không khớp tài liệu yêu cầu.");
      const result = readAnswer(generated, identity);
      if (!result) throw new ConflictException("Câu trả lời tài liệu không đúng cấu trúc.");
      const saved = await this.prisma.systemSetting.updateMany({ where: { key, version: row.version }, data: { value: { state: "READY", request, result }, version: { increment: 1 } } });
      if (saved.count !== 1) throw new ConflictException("Không xác nhận được việc lưu câu trả lời AI. Không gửi yêu cầu mới.");
      return result;
    } catch (error) {
      await this.prisma.systemSetting.updateMany({ where: { key, version: row.version }, data: { value: { state: "UNCERTAIN", request }, version: { increment: 1 } } });
      throw error;
    }
  }

  /** Xác nhận metadata riêng của claim vẫn đúng toàn bộ fingerprint trước khi tiêu thụ quyền retry. */
  private sameRequest(stored: AnswerRequest | undefined, expected: AnswerRequest): boolean {
    return Boolean(stored
      && stored.materialId === expected.materialId
      && stored.version === expected.version
      && stored.question === expected.question
      && stored.language === expected.language);
  }
}
