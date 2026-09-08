import { ConflictException, ServiceUnavailableException } from "@nestjs/common";
import { createHash } from "node:crypto";
import { z } from "zod";
import type { PrismaService } from "../database/prisma.service.js";
import type { AiProviderService } from "../system/ai-provider.service.js";

export type SavedDocumentAnswer = Awaited<ReturnType<AiProviderService["answerDocument"]>> & { warning: string; version: number };
export type DocumentAnswerIdentity = { ownerId: string; materialId: string; version: number; question: string; language: "VI" | "EN" | "BILINGUAL" };
type Claim = { state: "GENERATING" | "READY" | "UNCERTAIN"; result?: SavedDocumentAnswer };
export type DocumentAnswerStatus = { state: "NOT_REQUESTED" | "GENERATING" | "UNCERTAIN" } | { state: "READY"; result: SavedDocumentAnswer };

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

/** Validate stored and fresh answers identically, bind citations to the source, and strip undeclared fields. */
function readAnswer(value: unknown, identity: DocumentAnswerIdentity): SavedDocumentAnswer | undefined {
  const parsed = answerSchema.safeParse(value);
  if (!parsed.success || parsed.data.version !== identity.version) return undefined;
  const answer = parsed.data;
  if (answer.citations.some((source) => source.materialId !== identity.materialId || source.version !== identity.version)) return undefined;
  if (new Set(answer.citations.map((source) => source.id)).size !== answer.citations.length) return undefined;
  return answer;
}

/** Durable private answer cache; the caller must check source permissions before and after every use. */
export class AiDocumentAnswerStore {
  constructor(private readonly prisma?: PrismaService) {}

  /** Read the exact private claim without creating records or invoking a provider. */
  async status(identity: DocumentAnswerIdentity): Promise<DocumentAnswerStatus> {
    if (!this.prisma?.isStartupConnectionEnabled()) throw new ServiceUnavailableException("Hỏi đáp AI yêu cầu database bền vững để chống gửi trùng.");
    const row = await this.prisma.systemSetting.findUnique({ where: { key: this.key(identity) }, select: { value: true } });
    if (!row) return { state: "NOT_REQUESTED" };
    const claim = row.value as Claim | null;
    const result = claim?.state === "READY" ? readAnswer(claim.result, identity) : undefined;
    if (result) return { state: "READY", result };
    return { state: claim?.state === "GENERATING" ? "GENERATING" : "UNCERTAIN" };
  }

  /** Use the same normalized identity for status reads and generation claims. */
  private key(identity: DocumentAnswerIdentity): string {
    return `ai-doc-answer:${createHash("sha256").update(JSON.stringify(["v1", identity.ownerId, identity.materialId, identity.version, identity.question.trim(), identity.language])).digest("hex")}`;
  }

  /** Claim one answer per owner/source version/question/language and never repeat uncertain provider work. */
  async generate(identity: DocumentAnswerIdentity, generate: () => Promise<SavedDocumentAnswer>): Promise<SavedDocumentAnswer> {
    if (!this.prisma?.isStartupConnectionEnabled()) throw new ServiceUnavailableException("Hỏi đáp AI yêu cầu database bền vững để chống gửi trùng.");
    const key = this.key(identity);
    let claimed = false;
    try {
      await this.prisma.systemSetting.create({ data: { key, updatedBy: identity.ownerId, value: { state: "GENERATING" } } });
      claimed = true;
    } catch (error) {
      if (!error || typeof error !== "object" || !("code" in error) || error.code !== "P2002") throw error;
    }
    const row = await this.prisma.systemSetting.findUnique({ where: { key } });
    const claim = row?.value as Claim | undefined;
    const cached = claim?.state === "READY" ? readAnswer(claim.result, identity) : undefined;
    if (cached) return cached;
    if (!claimed || !row || claim?.state !== "GENERATING") throw new ConflictException("Câu hỏi AI đang xử lý hoặc chưa rõ kết quả. Không gửi lại để tránh phí trùng; liên hệ quản trị viên đối soát.");
    try {
      const generated = await generate();
      if (generated?.version !== identity.version) throw new ConflictException("Phiên bản câu trả lời AI không khớp tài liệu yêu cầu.");
      const result = readAnswer(generated, identity);
      if (!result) throw new ConflictException("Câu trả lời tài liệu không đúng cấu trúc.");
      const saved = await this.prisma.systemSetting.updateMany({ where: { key, version: row.version }, data: { value: { state: "READY", result }, version: { increment: 1 } } });
      if (saved.count !== 1) throw new ConflictException("Không xác nhận được việc lưu câu trả lời AI. Không gửi yêu cầu mới.");
      return result;
    } catch (error) {
      await this.prisma.systemSetting.updateMany({ where: { key, version: row.version }, data: { value: { state: "UNCERTAIN" }, version: { increment: 1 } } });
      throw error;
    }
  }
}
