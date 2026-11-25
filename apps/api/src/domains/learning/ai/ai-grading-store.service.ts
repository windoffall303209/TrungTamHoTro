import { ConflictException, Inject, Injectable, Optional, ServiceUnavailableException } from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import { PrismaService } from "../../../database/prisma.service.js";
import { Prisma } from "../../../generated/prisma/client.js";
import { AI_CLAIM_LEASE_OPTIONS, canReopenAiClaimAfterFailure, createAiClaimLease, currentAiClaimTime, isAiLeaseExpired, type AiClaimLeaseOptions } from "../../system/ai/ai-claim-policy.js";
import type { GradingSuggestion } from "../../system/ai/ai-grading-suggestion.js";
import type { ExamLanguage } from "../../system/ai/ai-provider.service.js";
import type { GradingAnswerSource } from "./ai-grading-source.js";

export type GradingIdentity = { ownerId: string; submissionId: string; contextHash: string; language: ExamLanguage };
export type SavedGradingSuggestion = GradingSuggestion & { model: string; submissionRevision: number; assignmentVersion: number; contextHash: string; sources?: GradingAnswerSource[] };
type Stored = GradingIdentity & { id: string; fingerprint: string; state: "RETRY_AUTHORIZED" | "GENERATING" | "READY" | "UNCERTAIN"; leaseToken?: string | null; leaseExpiresAt?: Date | null; result: SavedGradingSuggestion | null };

@Injectable()
/** Claim bền vững kèm lease cho mỗi ngữ cảnh bài nộp; không fallback sang memory khi database bị lỗi. */
export class AiGradingStoreService {
  constructor(
    @Optional() private readonly prisma?: PrismaService,
    @Optional() @Inject(AI_CLAIM_LEASE_OPTIONS) private readonly leaseOptions: AiClaimLeaseOptions = {},
  ) {}

  /** Đọc trạng thái cùng ngữ cảnh/người tạo; không gọi provider. */
  async find(identity: GradingIdentity): Promise<Stored | null> {
    const fingerprint = this.fingerprint(identity);
    const db = this.database();
    const row = await db.aiGradingSuggestion.findUnique({ where: { fingerprint } }) as unknown as Stored | null;
    return structuredClone(row);
  }

  /** Chỉ worker giữ được lease mới gọi AI; READY phát lại, hết hạn lease hoặc lỗi mơ hồ chuyển UNCERTAIN. */
  async generate(identity: GradingIdentity, generate: () => Promise<SavedGradingSuggestion>): Promise<SavedGradingSuggestion & { suggestionId: string }> {
    const fingerprint = this.fingerprint(identity);
    const lease = createAiClaimLease(this.leaseOptions);
    const initial: Stored = { ...identity, fingerprint, id: `grading-ai-${randomUUID()}`, state: "GENERATING", leaseToken: lease.leaseToken, leaseExpiresAt: lease.leaseExpiresAt, result: null };
    const db = this.database();
    let claimed = false;
    try {
      await db.aiGradingSuggestion.create({
        data: { id: initial.id, fingerprint, ...identity, leaseToken: lease.leaseToken, leaseExpiresAt: lease.leaseExpiresAt },
      });
      claimed = true;
    } catch (error) { if (!error || typeof error !== "object" || !("code" in error) || error.code !== "P2002") throw error; }
    const row = await this.find(identity);
    if (!row) throw new ConflictException("Không xác nhận được yêu cầu gợi ý chấm AI.");
    if (row.state === "READY" && row.result) return { ...row.result, suggestionId: row.id };
    if (!claimed && row.state === "GENERATING") {
      const now = currentAiClaimTime(this.leaseOptions);
      if (isAiLeaseExpired(row.leaseExpiresAt, now)) {
        // Lease đã hết hạn sau crash/restart -> chuyển UNCERTAIN chờ đối soát, không tự gọi lại provider.
        await db.aiGradingSuggestion.updateMany({
          where: { id: row.id, state: "GENERATING", leaseToken: row.leaseToken ?? null, leaseExpiresAt: { lte: now } },
          data: { state: "UNCERTAIN", leaseToken: null, leaseExpiresAt: null },
        });
        throw new ConflictException("Lần gợi ý chấm trước đã hết thời hạn xử lý và chưa rõ kết quả. Hệ thống không tự gọi lại AI để tránh phí trùng.");
      }
    }
    if (!claimed && row.state === "RETRY_AUTHORIZED") {
      const reopened = await db.aiGradingSuggestion.updateMany({
        where: { id: row.id, state: "RETRY_AUTHORIZED" },
        data: { state: "GENERATING", leaseToken: lease.leaseToken, leaseExpiresAt: lease.leaseExpiresAt, result: Prisma.JsonNull },
      });
      claimed = reopened.count === 1;
    }
    if (!claimed) throw new ConflictException(row.state === "UNCERTAIN" ? "Lần gợi ý chấm trước chưa rõ kết quả. Hệ thống không tự gọi lại AI để tránh phí trùng." : "Gợi ý chấm đang xử lý hoặc bị gián đoạn. Hãy kiểm tra lại trạng thái.");
    try {
      const result = await generate();
      if (result.contextHash !== identity.contextHash) throw new ConflictException("Ngữ cảnh gợi ý chấm không khớp yêu cầu đã lưu.");
      const saved = await db.aiGradingSuggestion.updateMany({
        where: { id: row.id, state: "GENERATING", leaseToken: lease.leaseToken },
        data: { state: "READY", leaseToken: null, leaseExpiresAt: null, result: result as unknown as Prisma.InputJsonValue },
      });
      if (saved.count !== 1) throw new ConflictException("Chưa xác nhận được việc lưu gợi ý chấm AI.");
      return { ...result, suggestionId: row.id };
    } catch (error) {
      // Chỉ cho phép mở lại RETRY_AUTHORIZED khi lỗi chắc chắn chưa phát sinh phí từ provider.
      const nextState = canReopenAiClaimAfterFailure(error) ? "RETRY_AUTHORIZED" : "UNCERTAIN";
      await db.aiGradingSuggestion.updateMany({
        where: { id: row.id, state: "GENERATING", leaseToken: lease.leaseToken },
        data: { state: nextState, leaseToken: null, leaseExpiresAt: null },
      });
      throw error;
    }
  }

  /** Phân biệt người tạo, bài nộp, nội dung nguồn và ngôn ngữ; key không chứa văn bản bài làm. */
  private fingerprint(identity: GradingIdentity): string { return createHash("sha256").update(JSON.stringify([identity.ownerId, identity.submissionId, identity.contextHash, identity.language])).digest("hex"); }
  /** Từ chối gọi AI khi bản ghi giữ quyền xử lý không thể tồn tại sau khi tiến trình bị thay thế. */
  private database(): PrismaService {
    if (!this.prisma?.isStartupConnectionEnabled()) throw new ServiceUnavailableException("Gợi ý chấm AI yêu cầu database bền vững để chống gửi trùng.");
    return this.prisma;
  }
}
