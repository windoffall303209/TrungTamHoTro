import { ConflictException, Injectable, Optional, ServiceUnavailableException } from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import { PrismaService } from "../database/prisma.service.js";
import { Prisma } from "../generated/prisma/client.js";
import type { GradingSuggestion } from "../system/ai-grading-suggestion.js";
import type { ExamLanguage } from "../system/ai-provider.service.js";
import type { GradingAnswerSource } from "./ai-grading-source.js";

export type GradingIdentity = { ownerId: string; submissionId: string; contextHash: string; language: ExamLanguage };
export type SavedGradingSuggestion = GradingSuggestion & { model: string; submissionRevision: number; assignmentVersion: number; contextHash: string; sources?: GradingAnswerSource[] };
type Stored = GradingIdentity & { id: string; fingerprint: string; state: "RETRY_AUTHORIZED" | "GENERATING" | "READY" | "UNCERTAIN"; result: SavedGradingSuggestion | null };

@Injectable()
/** Claim bền vững cho mỗi ngữ cảnh bài nộp; không fallback sang memory khi database bị lỗi. */
export class AiGradingStoreService {
  constructor(@Optional() private readonly prisma?: PrismaService) {}

  /** Đọc trạng thái cùng ngữ cảnh/người tạo; không gọi provider. */
  async find(identity: GradingIdentity): Promise<Stored | null> {
    const fingerprint = this.fingerprint(identity);
    const db = this.database();
    const row = await db.aiGradingSuggestion.findUnique({ where: { fingerprint } }) as unknown as Stored | null;
    return structuredClone(row);
  }

  /** Chỉ worker tạo được unique claim mới gọi AI; READY phát lại, UNCERTAIN không tự thử lại. */
  async generate(identity: GradingIdentity, generate: () => Promise<SavedGradingSuggestion>): Promise<SavedGradingSuggestion & { suggestionId: string }> {
    const fingerprint = this.fingerprint(identity);
    const initial: Stored = { ...identity, fingerprint, id: `grading-ai-${randomUUID()}`, state: "GENERATING", result: null };
    const db = this.database();
    let claimed = false;
    try { await db.aiGradingSuggestion.create({ data: { id: initial.id, fingerprint, ...identity } }); claimed = true; }
    catch (error) { if (!error || typeof error !== "object" || !("code" in error) || error.code !== "P2002") throw error; }
    const row = await this.find(identity);
    if (!row) throw new ConflictException("Không xác nhận được yêu cầu gợi ý chấm AI.");
    if (row.state === "READY" && row.result) return { ...row.result, suggestionId: row.id };
    if (!claimed && row.state === "RETRY_AUTHORIZED") {
      const reopened = await db.aiGradingSuggestion.updateMany({ where: { id: row.id, state: "RETRY_AUTHORIZED" }, data: { state: "GENERATING", result: Prisma.JsonNull } });
      claimed = reopened.count === 1;
    }
    if (!claimed) throw new ConflictException(row.state === "UNCERTAIN" ? "Lần gợi ý chấm trước chưa rõ kết quả. Hệ thống không tự gọi lại AI để tránh phí trùng." : "Gợi ý chấm đang xử lý hoặc bị gián đoạn. Hãy kiểm tra lại trạng thái.");
    try {
      const result = await generate();
      if (result.contextHash !== identity.contextHash) throw new ConflictException("Ngữ cảnh gợi ý chấm không khớp yêu cầu đã lưu.");
      const saved = await db.aiGradingSuggestion.updateMany({ where: { id: row.id, state: "GENERATING" }, data: { state: "READY", result: result as unknown as Prisma.InputJsonValue } });
      if (saved.count !== 1) throw new ConflictException("Chưa xác nhận được việc lưu gợi ý chấm AI.");
      return { ...result, suggestionId: row.id };
    } catch (error) {
      await db.aiGradingSuggestion.updateMany({ where: { id: row.id, state: "GENERATING" }, data: { state: "UNCERTAIN" } });
      throw error;
    }
  }

  /** Phân biệt người tạo, bài nộp, nội dung nguồn và ngôn ngữ; key không chứa văn bản bài làm. */
  private fingerprint(identity: GradingIdentity): string { return createHash("sha256").update(JSON.stringify([identity.ownerId, identity.submissionId, identity.contextHash, identity.language])).digest("hex"); }
  /** Fail closed before AI work when durable claims cannot survive process replacement. */
  private database(): PrismaService {
    if (!this.prisma?.isStartupConnectionEnabled()) throw new ServiceUnavailableException("Gợi ý chấm AI yêu cầu database bền vững để chống gửi trùng.");
    return this.prisma;
  }
}
