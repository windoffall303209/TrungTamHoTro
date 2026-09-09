import { BadRequestException, ConflictException } from "@nestjs/common";
import { createHash } from "node:crypto";
import type { AiProviderService } from "../system/ai-provider.service.js";
import { AiDocumentExtractionStore } from "./ai-document-extraction-store.js";
import { decodeGradingText, isGradingDocument, type VerifiedGradingAttachment } from "./ai-grading-source.js";

/** Signal that an explicit generation request may create OCR; ordinary status reads must stay provider-free. */
export class GradingExtractionMissingError extends ConflictException {
  constructor() { super("Bài nộp chưa có bản trích xuất đã lưu. Chỉ thao tác tạo gợi ý mới được phép gọi OCR."); }
}

/** Read private, version-bound OCR snapshots; the caller must verify teaching access before and after use. */
export class AiGradingDocumentReader {
  constructor(private readonly store: AiDocumentExtractionStore, private readonly ai: AiProviderService) {}

  /** Reuse persisted OCR without model configuration; only explicit generation may contact a provider. */
  async read(submissionId: string, ownerId: string, file: VerifiedGradingAttachment, allowGeneration = false): Promise<string> {
    if (!submissionId || !ownerId || !file.attachmentId || !Number.isSafeInteger(file.submissionRevision) || file.submissionRevision < 1 || !isGradingDocument(file.mimeType, file.fileName)) throw new BadRequestException("Nguồn OCR bài nộp không hợp lệ.");
    if (!file.buffer.length || file.buffer.length > 12 * 1024 * 1024 || file.checksum !== `sha256:${createHash("sha256").update(file.buffer).digest("hex")}`) throw new BadRequestException("Nguồn OCR bài nộp không hợp lệ.");
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
