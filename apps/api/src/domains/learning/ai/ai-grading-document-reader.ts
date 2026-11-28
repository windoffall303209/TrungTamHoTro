import { BadRequestException, ConflictException } from "@nestjs/common";
import { createHash } from "node:crypto";
import mammoth from "mammoth";
import { stripHiddenDocxText } from "../../../infrastructure/docx-hidden-text.js";
import { validateDocxArchive } from "../../../infrastructure/validate-docx-archive.js";
import type { AiProviderService } from "../../system/ai/ai-provider.service.js";
import { AiDocumentExtractionStore } from "./ai-document-extraction-store.js";
import { decodeGradingText, isGradingDocument, isGradingDocx, type VerifiedGradingAttachment } from "./ai-grading-source.js";

/** Trích xuất văn bản DOCX tại chỗ sau khi kiểm tra giới hạn tệp nén; bỏ chữ định dạng ẩn để chỉ thị vô hình không vào prompt AI. */
async function readDocx(buffer: Buffer): Promise<string> {
  await validateDocxArchive(buffer);
  try {
    const result = await mammoth.extractRawText({ buffer: await stripHiddenDocxText(buffer) });
    if (result.messages.some((message) => message.type === "error")) throw new Error("DOCX extraction reported an error");
    return decodeGradingText(Buffer.from(result.value, "utf8"));
  } catch (error) {
    if (error instanceof BadRequestException) throw error;
    throw new BadRequestException("Không đọc được nội dung DOCX. Hãy kiểm tra tệp hoặc chuyển sang PDF.");
  }
}

/** Đánh dấu yêu cầu sinh nội dung được phép tạo OCR; đọc trạng thái thông thường không được gọi nhà cung cấp. */
export class GradingExtractionMissingError extends ConflictException {
  constructor() { super("Bài nộp chưa có bản trích xuất đã lưu. Chỉ thao tác tạo gợi ý mới được phép gọi OCR."); }
}

const MAX_GRADING_DOCUMENT_BYTES = 12 * 1024 * 1024;
const SHA256_CHECKSUM_PATTERN = /^sha256:[0-9a-f]{64}$/;

export type GradingDocumentMetadata = {
  attachmentId: string;
  fileName: string;
  mimeType: string;
  checksum: string;
  sizeBytes: bigint;
  submissionRevision: number;
};

/** Tạo khóa tra cứu bản lưu OCR dùng chung giữa đọc cache chỉ metadata và đọc có tải bytes. */
function buildGradingExtractionKey(
  submissionId: string,
  ownerId: string,
  file: Pick<GradingDocumentMetadata, "attachmentId" | "checksum" | "fileName" | "mimeType" | "submissionRevision">,
): string {
  return `ai-doc:${createHash("sha256").update(JSON.stringify(["grading-v1", ownerId, submissionId, file.submissionRevision, file.attachmentId, file.checksum, file.fileName, file.mimeType])).digest("hex")}`;
}

/** Đọc bản lưu OCR riêng gắn với phiên bản; bên gọi phải kiểm tra quyền giảng dạy trước và sau khi dùng. */
export class AiGradingDocumentReader {
  constructor(private readonly store: AiDocumentExtractionStore, private readonly ai: AiProviderService) {}

  /** Đọc lại văn bản OCR đã lưu bằng metadata DB (không tải object storage); ném lỗi nếu chưa có hoặc đang xử lý. */
  async readCached(submissionId: string, ownerId: string, file: GradingDocumentMetadata): Promise<string> {
    if (
      !submissionId ||
      !ownerId ||
      !file.attachmentId ||
      !Number.isSafeInteger(file.submissionRevision) ||
      file.submissionRevision < 1 ||
      file.sizeBytes <= 0n ||
      file.sizeBytes > BigInt(MAX_GRADING_DOCUMENT_BYTES) ||
      !SHA256_CHECKSUM_PATTERN.test(file.checksum) ||
      !isGradingDocument(file.mimeType, file.fileName) ||
      isGradingDocx(file.mimeType, file.fileName)
    ) {
      throw new BadRequestException("Nguồn trích xuất bài nộp không hợp lệ.");
    }
    const key = buildGradingExtractionKey(submissionId, ownerId, file);
    const status = await this.store.status(key);
    if (status.state === "READY") return decodeGradingText(Buffer.from(status.pages.map((page) => page.text).join("\n\n"), "utf8"));
    if (status.state !== "NOT_REQUESTED") throw new ConflictException("Trích xuất AI đang xử lý hoặc chưa rõ kết quả. Không tự gọi lại; liên hệ quản trị viên đối soát.");
    throw new GradingExtractionMissingError();
  }

  /** Đọc DOCX tại chỗ hoặc dùng lại OCR đã lưu; chỉ yêu cầu sinh rõ ràng cho PDF hoặc ảnh mới gọi nhà cung cấp. */
  async read(submissionId: string, ownerId: string, file: VerifiedGradingAttachment, allowGeneration = false): Promise<string> {
    if (!submissionId || !ownerId || !file.attachmentId || !Number.isSafeInteger(file.submissionRevision) || file.submissionRevision < 1 || !isGradingDocument(file.mimeType, file.fileName)) throw new BadRequestException("Nguồn trích xuất bài nộp không hợp lệ.");
    if (!file.buffer.length || file.buffer.length > MAX_GRADING_DOCUMENT_BYTES || file.checksum !== `sha256:${createHash("sha256").update(file.buffer).digest("hex")}`) throw new BadRequestException("Nguồn trích xuất bài nộp không hợp lệ.");
    if (isGradingDocx(file.mimeType, file.fileName)) return readDocx(file.buffer);
    const key = buildGradingExtractionKey(submissionId, ownerId, file);
    const status = await this.store.status(key);
    if (status.state === "READY") return decodeGradingText(Buffer.from(status.pages.map((page) => page.text).join("\n\n"), "utf8"));
    if (status.state !== "NOT_REQUESTED") throw new ConflictException("Trích xuất AI đang xử lý hoặc chưa rõ kết quả. Không tự gọi lại; liên hệ quản trị viên đối soát.");
    if (!allowGeneration) throw new GradingExtractionMissingError();
    await this.ai.resolveTask("GRADING_ASSIST");
    const selected = await this.ai.resolveTask("DOCUMENT_CONTEXT");
    const result = await this.store.generate(key, ownerId, () => this.ai.extractDocumentPages({ name: file.fileName, mimeType: file.mimeType, buffer: file.buffer }, selected));
    return decodeGradingText(Buffer.from(result.pages.map((page) => page.text).join("\n\n"), "utf8"));
  }
}
