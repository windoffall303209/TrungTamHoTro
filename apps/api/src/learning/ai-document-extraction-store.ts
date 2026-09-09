import { BadRequestException, ConflictException, ServiceUnavailableException } from "@nestjs/common";
import type { PrismaService } from "../database/prisma.service.js";
import type { DocumentPage } from "../system/ai-document-context.js";

export type DocumentExtractionStatus = { state: "NOT_REQUESTED" | "GENERATING" | "UNCERTAIN" } | { state: "READY"; pages: DocumentPage[] };

/** Validate fresh and legacy page snapshots without truncating or exposing undeclared fields. */
function readPages(raw: unknown): DocumentPage[] | undefined {
  if (!Array.isArray(raw) || !raw.length || raw.length > 200) return undefined;
  const pages: DocumentPage[] = [];
  let size = 0;
  for (const [index, value] of (raw as unknown[]).entries()) {
    if (!value || typeof value !== "object" || !("page" in value) || !("text" in value)) return undefined;
    if (value.page !== index + 1 || typeof value.text !== "string") return undefined;
    size += value.text.length;
    if (size > 500_000) return undefined;
    pages.push({ page: index + 1, text: value.text });
  }
  return pages.some((page) => page.text.trim()) ? pages : undefined;
}

/** Interpret both legacy arrays and durable claims without trusting the persisted READY label alone. */
function readStatus(value: unknown): Exclude<DocumentExtractionStatus, { state: "NOT_REQUESTED" }> {
  const claim = value as { state?: unknown; pages?: unknown } | null;
  const pages = readPages(Array.isArray(value) ? value : claim?.state === "READY" ? claim.pages : undefined);
  if (pages) return { state: "READY", pages };
  return { state: claim?.state === "GENERATING" ? "GENERATING" : "UNCERTAIN" };
}

/** Detect the explicit one-shot retry entitlement without treating malformed values as retryable. */
function isRetryAuthorized(value: unknown): boolean {
  return Boolean(value && typeof value === "object" && !Array.isArray(value) && "state" in value && value.state === "RETRY_AUTHORIZED");
}

/** Share verified source/model extraction across workers; callers enforce source access on both sides. */
export class AiDocumentExtractionStore {
  constructor(private readonly prisma?: PrismaService) {}

  /** Inspect exact source/model OCR state without reserving work, mutating records, or invoking providers. */
  async status(key: string): Promise<DocumentExtractionStatus> {
    const db = this.database(key);
    const row = await db.systemSetting.findUnique({ where: { key }, select: { value: true } });
    if (row && isRetryAuthorized(row.value)) return { state: "NOT_REQUESTED" };
    return row ? readStatus(row.value) : { state: "NOT_REQUESTED" };
  }

  /** Validate the internal key and require durable storage for both reads and generation. */
  private database(key: string): PrismaService {
    if (!/^ai-doc:[a-f0-9]{64}$/.test(key)) throw new BadRequestException("Khóa trích xuất tài liệu AI không hợp lệ.");
    if (!this.prisma?.isStartupConnectionEnabled()) throw new ServiceUnavailableException("Trích xuất AI yêu cầu database bền vững để chống gọi trùng.");
    return this.prisma;
  }

  /** Reserve durable OCR work once, replay valid legacy caches, and never retry uncertain work automatically. */
  async generate(key: string, actorId: string, extract: () => Promise<DocumentPage[]>): Promise<{ pages: DocumentPage[]; cached: boolean }> {
    if (!actorId) throw new BadRequestException("Khóa trích xuất tài liệu AI không hợp lệ.");
    const db = this.database(key);
    let claimed = false;
    try {
      await db.systemSetting.create({ data: { key, updatedBy: actorId, value: { state: "GENERATING" } } });
      claimed = true;
    } catch (error) {
      if (!error || typeof error !== "object" || !("code" in error) || error.code !== "P2002") throw error;
    }
    let row = await db.systemSetting.findUnique({ where: { key } });
    if (!row) throw new ConflictException("Không xác nhận được khóa trích xuất AI. Không gửi lại yêu cầu.");
    if (!claimed && row.updatedBy === actorId && isRetryAuthorized(row.value)) {
      const reopened = await db.systemSetting.updateMany({ where: { key, version: row.version, updatedBy: actorId }, data: { value: { state: "GENERATING" }, version: { increment: 1 } } });
      claimed = reopened.count === 1;
      if (claimed) row = { ...row, version: row.version + 1, value: { state: "GENERATING" } };
    }
    const status = readStatus(row.value);
    if (status.state === "READY") return { pages: status.pages, cached: true };
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
