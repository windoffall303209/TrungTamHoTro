import { BadRequestException, ConflictException, ServiceUnavailableException } from "@nestjs/common";
import type { PrismaService } from "../../../database/prisma.service.js";
import { Prisma } from "../../../generated/prisma/client.js";
import { canReopenAiClaimAfterFailure, createAiClaimLease, currentAiClaimTime, isAiLeaseExpired, type AiClaimLeaseOptions } from "../../system/ai/ai-claim-policy.js";
import type { DocumentPage } from "../../system/ai/ai-document-context.js";

export type DocumentExtractionStatus = { state: "NOT_REQUESTED" | "GENERATING" | "UNCERTAIN" } | { state: "READY"; pages: DocumentPage[] };

type StoredExtraction = {
  id: string;
  ownerId: string;
  state: string;
  version: number;
  pages: unknown;
  leaseToken: string | null;
  leaseExpiresAt: Date | null;
};

/** Kiểm tra danh sách trang OCR mà không cắt bớt dữ liệu hoặc lộ trường ngoài khai báo. */
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

/** Diễn giải trạng thái bản ghi OCR trong bảng chuyên dụng; lease GENERATING quá hạn được báo UNCERTAIN. */
function readStatus(row: Pick<StoredExtraction, "state" | "pages" | "leaseExpiresAt">, now: Date): Exclude<DocumentExtractionStatus, { state: "NOT_REQUESTED" }> {
  if (row.state === "READY") {
    const pages = readPages(row.pages);
    if (pages) return { state: "READY", pages };
    return { state: "UNCERTAIN" };
  }
  if (row.state === "GENERATING" && !isAiLeaseExpired(row.leaseExpiresAt, now)) return { state: "GENERATING" };
  return { state: "UNCERTAIN" };
}

/** Chia sẻ kết quả trích xuất đã xác minh trong bảng ai_document_extractions; bên gọi tự kiểm quyền nguồn trước và sau khi dùng. */
export class AiDocumentExtractionStore {
  constructor(
    private readonly prisma?: PrismaService,
    private readonly leaseOptions: AiClaimLeaseOptions = {},
  ) {}

  /** Đọc đúng trạng thái OCR của nguồn và mô hình, không giữ quyền xử lý, sửa dữ liệu hoặc gọi nhà cung cấp. */
  async status(key: string): Promise<DocumentExtractionStatus> {
    const { db, id } = this.database(key);
    const row = await db.aiDocumentExtraction.findUnique({
      where: { id },
      select: { state: true, pages: true, leaseExpiresAt: true },
    });
    if (!row || row.state === "RETRY_AUTHORIZED") return { state: "NOT_REQUESTED" };
    return readStatus(row, currentAiClaimTime(this.leaseOptions));
  }

  /** Xác thực khóa nội bộ dạng ai-doc:<sha256> và kiểm tra kết nối database bền vững. */
  private database(key: string): { db: PrismaService; id: string } {
    if (!/^ai-doc:[a-f0-9]{64}$/.test(key)) throw new BadRequestException("Khóa trích xuất tài liệu AI không hợp lệ.");
    if (!this.prisma?.isStartupConnectionEnabled()) throw new ServiceUnavailableException("Trích xuất AI yêu cầu database bền vững để chống gọi trùng.");
    return { db: this.prisma, id: key.slice(7) };
  }

  /** Giữ quyền OCR bền vững kèm lease trong bảng ai_document_extractions, dùng lại bộ đệm hợp lệ và không tự gọi lại khi mơ hồ. */
  async generate(key: string, actorId: string, extract: () => Promise<DocumentPage[]>): Promise<{ pages: DocumentPage[]; cached: boolean }> {
    if (!actorId) throw new BadRequestException("Khóa trích xuất tài liệu AI không hợp lệ.");
    const { db, id } = this.database(key);
    const lease = createAiClaimLease(this.leaseOptions);
    let claimed = false;
    try {
      await db.aiDocumentExtraction.create({
        data: { id, ownerId: actorId, state: "GENERATING", leaseToken: lease.leaseToken, leaseExpiresAt: lease.leaseExpiresAt },
      });
      claimed = true;
    } catch (error) {
      if (!error || typeof error !== "object" || !("code" in error) || error.code !== "P2002") throw error;
    }

    let row = await db.aiDocumentExtraction.findUnique({ where: { id } }) as StoredExtraction | null;
    if (!row) throw new ConflictException("Không xác nhận được khóa trích xuất AI. Không gửi lại yêu cầu.");

    const now = currentAiClaimTime(this.leaseOptions);
    if (!claimed && row.state === "GENERATING" && isAiLeaseExpired(row.leaseExpiresAt, now)) {
      // Hết hạn lease OCR sau crash/restart -> chuyển UNCERTAIN bằng CAS version, không tự gọi lại provider.
      await db.aiDocumentExtraction.updateMany({
        where: { id, version: row.version, state: "GENERATING" },
        data: { state: "UNCERTAIN", leaseToken: null, leaseExpiresAt: null, version: { increment: 1 } },
      });
      throw new ConflictException("Lần trích xuất AI trước đã hết thời hạn xử lý và chưa rõ kết quả. Không tự gọi lại; liên hệ quản trị viên đối soát.");
    }

    if (!claimed && row.ownerId === actorId && row.state === "RETRY_AUTHORIZED") {
      const reopened = await db.aiDocumentExtraction.updateMany({
        where: { id, version: row.version, ownerId: actorId, state: "RETRY_AUTHORIZED" },
        data: {
          state: "GENERATING",
          pages: Prisma.JsonNull,
          leaseToken: lease.leaseToken,
          leaseExpiresAt: lease.leaseExpiresAt,
          version: { increment: 1 },
        },
      });
      claimed = reopened.count === 1;
      if (claimed) {
        row = { ...row, state: "GENERATING", pages: null, leaseToken: lease.leaseToken, leaseExpiresAt: lease.leaseExpiresAt, version: row.version + 1 };
      }
    }

    const status = readStatus(row, now);
    if (status.state === "READY") return { pages: status.pages, cached: true };
    if (!claimed) throw new ConflictException("Trích xuất AI đang xử lý hoặc chưa rõ kết quả. Không tự gọi lại; liên hệ quản trị viên đối soát.");

    try {
      const pages = readPages(await extract());
      if (!pages) throw new ServiceUnavailableException("Nội dung trích xuất AI không hợp lệ hoặc chưa đầy đủ. Không tự gọi lại.");
      const updated = await db.aiDocumentExtraction.updateMany({
        where: { id, version: row.version, state: "GENERATING", leaseToken: lease.leaseToken },
        data: {
          state: "READY",
          pages: pages as unknown as Prisma.InputJsonValue,
          leaseToken: null,
          leaseExpiresAt: null,
          version: { increment: 1 },
        },
      });
      if (updated.count !== 1) throw new ConflictException("Không xác nhận được việc lưu trích xuất AI. Không gửi lại yêu cầu.");
      return { pages, cached: false };
    } catch (error) {
      const nextState = canReopenAiClaimAfterFailure(error) ? "RETRY_AUTHORIZED" : "UNCERTAIN";
      await db.aiDocumentExtraction.updateMany({
        where: { id, version: row.version, state: "GENERATING", leaseToken: lease.leaseToken },
        data: { state: nextState, pages: Prisma.JsonNull, leaseToken: null, leaseExpiresAt: null, version: { increment: 1 } },
      });
      throw error;
    }
  }
}
