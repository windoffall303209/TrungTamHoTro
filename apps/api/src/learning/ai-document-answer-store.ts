import { ConflictException, ServiceUnavailableException } from "@nestjs/common";
import { createHash } from "node:crypto";
import type { PrismaService } from "../database/prisma.service.js";
import type { AiProviderService } from "../system/ai-provider.service.js";

export type SavedDocumentAnswer = Awaited<ReturnType<AiProviderService["answerDocument"]>> & { warning: string; version: number };
export type DocumentAnswerIdentity = { ownerId: string; materialId: string; version: number; question: string; language: "VI" | "EN" | "BILINGUAL" };
type Claim = { state: "GENERATING" | "READY" | "UNCERTAIN"; result?: SavedDocumentAnswer };
export type DocumentAnswerStatus = { state: "NOT_REQUESTED" | "GENERATING" | "UNCERTAIN" } | { state: "READY"; result: SavedDocumentAnswer };

/** Durable private answer cache; the caller must check source permissions before and after every use. */
export class AiDocumentAnswerStore {
  constructor(private readonly prisma?: PrismaService) {}

  /** Read the exact private claim without creating records or invoking a provider. */
  async status(identity: DocumentAnswerIdentity): Promise<DocumentAnswerStatus> {
    if (!this.prisma?.isStartupConnectionEnabled()) throw new ServiceUnavailableException("Hỏi đáp AI yêu cầu database bền vững để chống gửi trùng.");
    const row = await this.prisma.systemSetting.findUnique({ where: { key: this.key(identity) }, select: { value: true } });
    if (!row) return { state: "NOT_REQUESTED" };
    const claim = row.value as Claim | null;
    if (claim?.state === "READY" && claim.result?.version === identity.version) return { state: "READY", result: claim.result };
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
    if (claim?.state === "READY" && claim.result?.version === identity.version) return claim.result;
    if (!claimed || !row || claim?.state !== "GENERATING") throw new ConflictException("Câu hỏi AI đang xử lý hoặc chưa rõ kết quả. Không gửi lại để tránh phí trùng; liên hệ quản trị viên đối soát.");
    try {
      const result = await generate();
      if (result.version !== identity.version) throw new ConflictException("Phiên bản câu trả lời AI không khớp tài liệu yêu cầu.");
      const saved = await this.prisma.systemSetting.updateMany({ where: { key, version: row.version }, data: { value: { state: "READY", result }, version: { increment: 1 } } });
      if (saved.count !== 1) throw new ConflictException("Không xác nhận được việc lưu câu trả lời AI. Không gửi yêu cầu mới.");
      return result;
    } catch (error) {
      await this.prisma.systemSetting.updateMany({ where: { key, version: row.version }, data: { value: { state: "UNCERTAIN" }, version: { increment: 1 } } });
      throw error;
    }
  }
}
