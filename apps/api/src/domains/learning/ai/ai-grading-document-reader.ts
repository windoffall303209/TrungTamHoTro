import { BadRequestException, ConflictException } from "@nestjs/common";
import { createHash } from "node:crypto";
import mammoth from "mammoth";
import { validateDocxArchive } from "../../../infrastructure/validate-docx-archive.js";
import type { AiProviderService } from "../../system/ai/ai-provider.service.js";
import { AiDocumentExtractionStore } from "./ai-document-extraction-store.js";
import { decodeGradingText, isGradingDocument, isGradingDocx, type VerifiedGradingAttachment } from "./ai-grading-source.js";

/** Trích xuất văn bản DOCX tại chỗ sau khi kiểm tra giới hạn tệp nén; không chọn mô hình hoặc nhà cung cấp. */
async function readDocx(buffer: Buffer): Promise<string> {
  await validateDocxArchive(buffer);
  try {
    const result = await mammoth.extractRawText({ buffer });
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

/** Đọc bản lưu OCR riêng gắn với phiên bản; bên gọi phải kiểm tra quyền giảng dạy trước và sau khi dùng. */
export class AiGradingDocumentReader {
  constructor(private readonly store: AiDocumentExtractionStore, private readonly ai: AiProviderService) {}

  /** Đọc DOCX tại chỗ hoặc dùng lại OCR đã lưu; chỉ yêu cầu sinh rõ ràng cho PDF hoặc ảnh mới gọi nhà cung cấp. */
  async read(submissionId: string, ownerId: string, file: VerifiedGradingAttachment, allowGeneration = false): Promise<string> {
    if (!submissionId || !ownerId || !file.attachmentId || !Number.isSafeInteger(file.submissionRevision) || file.submissionRevision < 1 || !isGradingDocument(file.mimeType, file.fileName)) throw new BadRequestException("Nguồn trích xuất bài nộp không hợp lệ.");
    if (!file.buffer.length || file.buffer.length > 12 * 1024 * 1024 || file.checksum !== `sha256:${createHash("sha256").update(file.buffer).digest("hex")}`) throw new BadRequestException("Nguồn trích xuất bài nộp không hợp lệ.");
    if (isGradingDocx(file.mimeType, file.fileName)) return readDocx(file.buffer);
    const key = `ai-doc:${createHash("sha256").update(JSON.stringify(["grading-v1", ownerId, submissionId, file.submissionRevision, file.attachmentId, file.checksum, file.fileName, file.mimeType])).digest("hex")}`;
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
