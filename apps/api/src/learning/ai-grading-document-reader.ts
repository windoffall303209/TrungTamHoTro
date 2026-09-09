import { BadRequestException, ConflictException } from "@nestjs/common";
import { createHash } from "node:crypto";
import mammoth from "mammoth";
import { fromBuffer, type Entry, type ZipFile } from "yauzl";
import type { AiProviderService } from "../system/ai-provider.service.js";
import { AiDocumentExtractionStore } from "./ai-document-extraction-store.js";
import { decodeGradingText, isGradingDocument, isGradingDocx, type VerifiedGradingAttachment } from "./ai-grading-source.js";

const DOCX_ENTRY_LIMIT = 8 * 1024 * 1024;
const DOCX_TOTAL_LIMIT = 32 * 1024 * 1024;
const DOCX_ENTRY_COUNT_LIMIT = 2_048;

/** Inspect the ZIP directory without expanding entries so compressed bombs fail before DOCX parsing. */
function validateDocxArchive(buffer: Buffer): Promise<void> {
  return new Promise((resolve, reject) => {
    let archive: ZipFile | undefined;
    let settled = false;
    let entries = 0;
    let total = 0;
    let hasDocument = false;
    const finish = (error?: Error): void => {
      if (settled) return;
      settled = true;
      archive?.close();
      if (error) reject(error); else resolve();
    };
    fromBuffer(buffer, { lazyEntries: true, validateEntrySizes: true, strictFileNames: true }, (openError, opened) => {
      if (openError) { finish(new BadRequestException("Tệp DOCX không hợp lệ hoặc đã bị hỏng.")); return; }
      archive = opened;
      opened.on("error", () => finish(new BadRequestException("Tệp DOCX không hợp lệ hoặc đã bị hỏng.")));
      opened.on("entry", (entry: Entry) => {
        entries += 1;
        total += entry.uncompressedSize;
        if (entry.fileName === "word/document.xml") hasDocument = true;
        if (entries > DOCX_ENTRY_COUNT_LIMIT || entry.uncompressedSize > DOCX_ENTRY_LIMIT || total > DOCX_TOTAL_LIMIT) {
          finish(new BadRequestException("Tệp DOCX có cấu trúc giải nén vượt giới hạn an toàn."));
          return;
        }
        opened.readEntry();
      });
      opened.on("end", () => finish(hasDocument ? undefined : new BadRequestException("Tệp DOCX không có nội dung tài liệu hợp lệ.")));
      opened.readEntry();
    });
  });
}

/** Extract DOCX text locally after bounded archive validation; no model or provider is resolved. */
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

/** Signal that an explicit generation request may create OCR; ordinary status reads must stay provider-free. */
export class GradingExtractionMissingError extends ConflictException {
  constructor() { super("Bài nộp chưa có bản trích xuất đã lưu. Chỉ thao tác tạo gợi ý mới được phép gọi OCR."); }
}

/** Read private, version-bound OCR snapshots; the caller must verify teaching access before and after use. */
export class AiGradingDocumentReader {
  constructor(private readonly store: AiDocumentExtractionStore, private readonly ai: AiProviderService) {}

  /** Parse DOCX locally or reuse persisted OCR; only explicit PDF/image generation contacts a provider. */
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
