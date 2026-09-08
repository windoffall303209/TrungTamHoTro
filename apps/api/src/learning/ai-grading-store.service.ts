import { ConflictException, Injectable, Optional } from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import { PrismaService } from "../database/prisma.service.js";
import type { Prisma } from "../generated/prisma/client.js";
import type { GradingSuggestion } from "../system/ai-grading-suggestion.js";
import type { ExamLanguage } from "../system/ai-provider.service.js";
import type { GradingAnswerSource } from "./ai-grading-source.js";

export type GradingIdentity = { ownerId: string; submissionId: string; contextHash: string; language: ExamLanguage };
export type SavedGradingSuggestion = GradingSuggestion & { model: string; submissionRevision: number; assignmentVersion: number; contextHash: string; sources?: GradingAnswerSource[] };
type Stored = GradingIdentity & { id: string; fingerprint: string; state: "GENERATING" | "READY" | "UNCERTAIN"; result: SavedGradingSuggestion | null };

@Injectable()
/** Claim bền vững cho mỗi ngữ cảnh bài nộp; không fallback sang memory khi database bị lỗi. */
export class AiGradingStoreService {
  private readonly memory = new Map<string, Stored>();
  constructor(@Optional() private readonly prisma?: PrismaService) {}

  /** Đọc trạng thái cùng ngữ cảnh/người tạo; không gọi provider. */
  async find(identity: GradingIdentity): Promise<Stored | null> {
    const fingerprint = this.fingerprint(identity);
    const db = this.database();
    const row = db ? await db.aiGradingSuggestion.findUnique({ where: { fingerprint } }) as unknown as Stored | null : this.memory.get(fingerprint) ?? null;
    return structuredClone(row);
  }

  /** Chỉ worker tạo được unique claim mới gọi AI; READY phát lại, UNCERTAIN không tự thử lại. */
  async generate(identity: GradingIdentity, generate: () => Promise<SavedGradingSuggestion>): Promise<SavedGradingSuggestion & { suggestionId: string }> {
    const fingerprint = this.fingerprint(identity);
    const initial: Stored = { ...identity, fingerprint, id: `grading-ai-${randomUUID()}`, state: "GENERATING", result: null };
    const db = this.database();
    let claimed = false;
    if (db) {
      try { await db.aiGradingSuggestion.create({ data: { id: initial.id, fingerprint, ...identity } }); claimed = true; }
      catch (error) { if (!error || typeof error !== "object" || !("code" in error) || error.code !== "P2002") throw error; }
    } else if (!this.memory.has(fingerprint)) { this.memory.set(fingerprint, initial); claimed = true; }
    const row = await this.find(identity);
    if (!row) throw new ConflictException("Không xác nhận được yêu cầu gợi ý chấm AI.");
    if (row.state === "READY" && row.result) return { ...row.result, suggestionId: row.id };
    if (!claimed) throw new ConflictException(row.state === "UNCERTAIN" ? "Lần gợi ý chấm trước chưa rõ kết quả. Hệ thống không tự gọi lại AI để tránh phí trùng." : "Gợi ý chấm đang xử lý hoặc bị gián đoạn. Hãy kiểm tra lại trạng thái.");
    try {
      const result = await generate();
      if (result.contextHash !== identity.contextHash) throw new ConflictException("Ngữ cảnh gợi ý chấm không khớp yêu cầu đã lưu.");
      if (db) {
        const saved = await db.aiGradingSuggestion.updateMany({ where: { id: row.id, state: "GENERATING" }, data: { state: "READY", result: result as unknown as Prisma.InputJsonValue } });
        if (saved.count !== 1) throw new ConflictException("Chưa xác nhận được việc lưu gợi ý chấm AI.");
      } else this.memory.set(fingerprint, { ...row, state: "READY", result: structuredClone(result) });
      return { ...result, suggestionId: row.id };
    } catch (error) {
      if (db) await db.aiGradingSuggestion.updateMany({ where: { id: row.id, state: "GENERATING" }, data: { state: "UNCERTAIN" } });
      else this.memory.set(fingerprint, { ...row, state: "UNCERTAIN" });
      throw error;
    }
  }

  /** Phân biệt người tạo, bài nộp, nội dung nguồn và ngôn ngữ; key không chứa văn bản bài làm. */
  private fingerprint(identity: GradingIdentity): string { return createHash("sha256").update(JSON.stringify([identity.ownerId, identity.submissionId, identity.contextHash, identity.language])).digest("hex"); }
  /** Chỉ dùng memory khi cấu hình ứng dụng tắt database. */
  private database(): PrismaService | undefined { return this.prisma?.isStartupConnectionEnabled() ? this.prisma : undefined; }
}
