import { BadRequestException, ConflictException, Injectable, NotFoundException, Optional } from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import { PrismaService } from "../database/prisma.service.js";
import type { Prisma } from "../generated/prisma/client.js";
import type { StudyContext, StudyGuide, StudyGuideOptions } from "../system/ai-study-guide.js";

export type SavedStudyGuide = StudyGuide & { model?: string; coverage: StudyContext["coverage"]; version: number; warning: string };
type DraftIdentity = { ownerId: string; materialId: string; sourceVersion: number; options: StudyGuideOptions };
export type StudyDraftSummary = DraftIdentity & { id: string; state: "GENERATING" | "READY" | "UNCERTAIN"; createdAt: Date; updatedAt: Date };
type Draft = StudyDraftSummary & { fingerprint: string; result: SavedStudyGuide | null };

@Injectable()
/** Lưu bản nháp riêng, claim theo nội dung trong database trước khi gọi provider. */
export class AiStudyDraftService {
  private readonly memory = new Map<string, Draft>();
  constructor(@Optional() private readonly prisma?: PrismaService) {}

  /** Trả lại kết quả đã lưu hoặc claim một lần tạo; trạng thái mơ hồ không tự gọi lại AI. */
  async generate(identity: DraftIdentity, generate: () => Promise<SavedStudyGuide>): Promise<SavedStudyGuide & { draftId: string }> {
    const fingerprint = createHash("sha256").update(JSON.stringify([identity.ownerId, identity.materialId, identity.sourceVersion, identity.options.cardCount, identity.options.language, identity.options.fromPage ?? null, identity.options.toPage ?? null])).digest("hex");
    const now = new Date();
    const initial: Draft = { ...identity, id: `study-${randomUUID()}`, fingerprint, state: "GENERATING", result: null, createdAt: now, updatedAt: now };
    const db = this.database();
    let claimed = false;
    if (db) {
      try {
        await db.aiStudyDraft.create({ data: { id: initial.id, fingerprint, ownerId: identity.ownerId, materialId: identity.materialId, sourceVersion: identity.sourceVersion, options: identity.options as unknown as Prisma.InputJsonValue } });
        claimed = true;
      } catch (error) { if (!error || typeof error !== "object" || !("code" in error) || error.code !== "P2002") throw error; }
    } else if (!this.memory.has(fingerprint)) { this.memory.set(fingerprint, structuredClone(initial)); claimed = true; }
    const row = db ? await db.aiStudyDraft.findUnique({ where: { fingerprint } }) as unknown as Draft | null : structuredClone(this.memory.get(fingerprint));
    if (!row || row.ownerId !== identity.ownerId || row.materialId !== identity.materialId || row.sourceVersion !== identity.sourceVersion) throw new ConflictException("Không xác nhận được bản nháp ôn tập. Hãy thử lại cùng yêu cầu.");
    if (row.state === "READY" && row.result) return { ...row.result, draftId: row.id };
    if (!claimed) throw new ConflictException(row.state === "UNCERTAIN" ? "Lần tạo bộ ôn tập trước chưa rõ kết quả. Hệ thống không tự gọi lại AI để tránh phí trùng." : "Bộ ôn tập đang xử lý hoặc bị gián đoạn. Hãy mở lịch sử bản nháp để kiểm tra, không tạo yêu cầu mới.");
    try {
      const result = await generate();
      if (result.version !== identity.sourceVersion) throw new ConflictException("Phiên bản nguồn của bộ ôn tập không khớp bản nháp. Kết quả chưa được lưu.");
      if (db) {
        const saved = await db.aiStudyDraft.updateMany({ where: { id: row.id, state: "GENERATING" }, data: { state: "READY", result: result as unknown as Prisma.InputJsonValue } });
        if (saved.count !== 1) throw new ConflictException("Không xác nhận được việc lưu bộ ôn tập. Hãy kiểm tra lịch sử bản nháp.");
      } else this.memory.set(fingerprint, { ...row, state: "READY", result: structuredClone(result), updatedAt: new Date() });
      return { ...result, draftId: row.id };
    } catch (error) {
      if (db) await db.aiStudyDraft.updateMany({ where: { id: row.id, state: "GENERATING" }, data: { state: "UNCERTAIN" } });
      else this.memory.set(fingerprint, { ...row, state: "UNCERTAIN", updatedAt: new Date() });
      throw error;
    }
  }

  /** Tìm bản nháp theo cả người tạo và tài liệu, không cho phép dò ID của người khác. */
  async get(id: string, ownerId: string, materialId: string): Promise<Draft> {
    const db = this.database();
    const row = db ? await db.aiStudyDraft.findFirst({ where: { id, ownerId, materialId } }) as unknown as Draft | null : structuredClone([...this.memory.values()].find((item) => item.id === id && item.ownerId === ownerId && item.materialId === materialId));
    if (!row) throw new NotFoundException("Không tìm thấy bản nháp ôn tập được phép xem.");
    return row;
  }

  /** Phân trang lịch sử chỉ với metadata; không tải nội dung nguồn của mọi bản nháp vào danh sách. */
  async list(ownerId: string, materialId: string, cursor?: string): Promise<{ items: StudyDraftSummary[]; nextCursor: string | null }> {
    const boundary = cursor ? await this.get(cursor, ownerId, materialId).catch((error: unknown) => {
      if (error instanceof NotFoundException) throw new BadRequestException("Mốc phân trang bản nháp không hợp lệ.");
      throw error;
    }) : undefined;
    const db = this.database();
    const rows = db ? await db.aiStudyDraft.findMany({ where: { ownerId, materialId, ...(boundary ? { OR: [{ createdAt: { lt: boundary.createdAt } }, { createdAt: boundary.createdAt, id: { lt: boundary.id } }] } : {}) }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 21, select: { id: true, ownerId: true, materialId: true, sourceVersion: true, options: true, state: true, createdAt: true, updatedAt: true } }) as unknown as StudyDraftSummary[] : [...this.memory.values()].filter((row) => row.ownerId === ownerId && row.materialId === materialId && (!boundary || row.createdAt < boundary.createdAt || (row.createdAt.getTime() === boundary.createdAt.getTime() && row.id < boundary.id))).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0)).slice(0, 21);
    const items = rows.slice(0, 20).map((row) => ({ id: row.id, ownerId: row.ownerId, materialId: row.materialId, sourceVersion: row.sourceVersion, options: row.options, state: row.state, createdAt: row.createdAt, updatedAt: row.updatedAt }));
    return structuredClone({ items, nextCursor: rows.length > 20 ? items.at(-1)!.id : null });
  }

  /** Dùng memory chỉ khi chế độ database của ứng dụng đã tắt, không fallback khi database lỗi. */
  private database(): PrismaService | undefined { return this.prisma?.isStartupConnectionEnabled() ? this.prisma : undefined; }
}
