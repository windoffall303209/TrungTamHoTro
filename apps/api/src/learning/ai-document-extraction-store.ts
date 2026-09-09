import { BadRequestException, ConflictException, ServiceUnavailableException } from "@nestjs/common";
import type { PrismaService } from "../database/prisma.service.js";
import type { DocumentPage } from "../system/ai-document-context.js";

/** Validate fresh and legacy page snapshots without truncating or exposing undeclared fields. */
function readPages(raw: unknown): DocumentPage[] | undefined {
  if (!Array.isArray(raw) || !raw.length || raw.length > 200) return undefined;
  const pages: DocumentPage[] = [];
  let size = 0;
  for (const [index, value] of (raw as unknown[]).entries()) {
    if (!value || typeof value !== "object" || !("page" in value) || !("text" in value)) return undefined;
    if (!value || typeof value !== "object" || value.page !== index + 1 || typeof value.text !== "string") return undefined;
    size += value.text.length;
    if (size > 500_000) return undefined;
    pages.push({ page: index + 1, text: value.text });
  }
  return pages.some((page) => page.text.trim()) ? pages : undefined;
}

/** Share verified source/model extraction across workers; callers enforce source access on both sides. */
export class AiDocumentExtractionStore {
  constructor(private readonly prisma?: PrismaService) {}

  /** Reserve durable OCR work once, replay valid legacy caches, and never retry uncertain work automatically. */
  async generate(key: string, actorId: string, extract: () => Promise<DocumentPage[]>): Promise<{ pages: DocumentPage[]; cached: boolean }> {
    if (!/^ai-doc:[a-f0-9]{64}$/.test(key) || !actorId) throw new BadRequestException("Khóa trích xuất tài liệu AI không hợp lệ.");
    if (!this.prisma?.isStartupConnectionEnabled()) throw new ServiceUnavailableException("Trích xuất AI yêu cầu database bền vững để chống gọi trùng.");
    const db = this.prisma;
    let claimed = false;
    try {
      await db.systemSetting.create({ data: { key, updatedBy: actorId, value: { state: "GENERATING" } } });
      claimed = true;
    } catch (error) {
      if (!error || typeof error !== "object" || !("code" in error) || error.code !== "P2002") throw error;
    }
    const row = await db.systemSetting.findUnique({ where: { key } });
    if (!row) throw new ConflictException("Không xác nhận được khóa trích xuất AI. Không gửi lại yêu cầu.");
    const claim = row.value as { state?: unknown; pages?: unknown } | null;
    const saved = readPages(Array.isArray(row.value) ? row.value : claim?.state === "READY" ? claim.pages : undefined);
    if (saved) return { pages: saved, cached: true };
    if (!claimed) throw new ConflictException("Trích xuất AI đang xử lý hoặc chưa rõ kết quả. Không tự gọi lại; liên hệ quản trị viên đối soát.");
    try {
      const pages = readPages(await extract());
      if (!pages) throw new ServiceUnavailableException("Nội dung trích xuất AI không hợp lệ hoặc chưa đầy đủ. Không tự gọi lại.");
      const updated = await db.systemSetting.updateMany({ where: { key, version: row.version }, data: { value: { state: "READY", pages }, version: { increment: 1 } } });
      if (updated.count !== 1) throw new ConflictException("Không xác nhận được việc lưu trích xuất AI. Không gửi lại yêu cầu.");
      return { pages, cached: false };
    } catch (error) {
      await db.systemSetting.updateMany({ where: { key, version: row.version }, data: { value: { state: "UNCERTAIN" }, version: { increment: 1 } } });
      throw error;
    }
  }
}
