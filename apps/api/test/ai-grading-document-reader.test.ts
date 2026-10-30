import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { AiGradingDocumentReader } from "../src/domains/learning/ai-grading-document-reader.js";
import { AiDocumentExtractionStore } from "../src/domains/learning/ai-document-extraction-store.js";
import { GRADING_DOCX_MIME, type VerifiedGradingAttachment } from "../src/domains/learning/ai-grading-source.js";
import type { AiProviderService } from "../src/domains/system/ai-provider.service.js";
import { extractionDatabase } from "./ai-document-extraction.fixture.js";
import { docxFixture } from "./docx.fixture.js";

const buffer = Buffer.from("synthetic PDF bytes");
const file = { attachmentId: "attachment", buffer, fileName: "answer.pdf", mimeType: "application/pdf", checksum: `sha256:${createHash("sha256").update(buffer).digest("hex")}`, submissionRevision: 1 };

/** Gắn buffer kiểm thử với cùng hợp đồng mã kiểm tra của luồng tải tệp đã xác minh. */
function docxFile(value: Buffer): VerifiedGradingAttachment {
  return { ...file, buffer: value, fileName: "answer.docx", mimeType: GRADING_DOCX_MIME, checksum: `sha256:${createHash("sha256").update(value).digest("hex")}` };
}

/** Dùng quy tắc giữ quyền xử lý thật với cơ sở dữ liệu mô phỏng và nhà cung cấp không gọi mạng. */
function fixture(): ReturnType<typeof extractionDatabase> & { reader: AiGradingDocumentReader; ai: { resolveTask: ReturnType<typeof vi.fn>; extractDocumentPages: ReturnType<typeof vi.fn> } } {
  const database = extractionDatabase();
  const ai = { resolveTask: vi.fn().mockResolvedValue({ providerId: "configured", model: "admin-model" }), extractDocumentPages: vi.fn().mockResolvedValue([{ page: 1, text: "First page" }, { page: 2, text: "Second page" }]) };
  const reader = new AiGradingDocumentReader(new AiDocumentExtractionStore(database.prisma), ai as unknown as AiProviderService);
  return { ...database, ai, reader };
}

describe("private grading OCR reader", () => {
  it("does not call OCR or reserve work on an uncached read", async () => {
    const { reader, ai, rows } = fixture();
    await expect(reader.read("submission", "teacher", file)).rejects.toMatchObject({ status: 409 });
    expect(ai.resolveTask).not.toHaveBeenCalled();
    expect(ai.extractDocumentPages).not.toHaveBeenCalled();
    expect(rows.size).toBe(0);
  });
  it("reads DOCX paragraphs and tables locally without resolving or claiming a provider", async () => {
    const { reader, ai, rows } = fixture();
    const value = await reader.read("submission", "teacher", docxFile(await docxFixture()));
    expect(value).toMatch(/Opening paragraph[\s\S]*Cell one[\s\S]*Cell two/);
    expect(ai.resolveTask).not.toHaveBeenCalled();
    expect(ai.extractDocumentPages).not.toHaveBeenCalled();
    expect(rows.size).toBe(0);
  });
  it("rejects corrupt and expansion-heavy DOCX archives before parsing", async () => {
    const { reader, ai } = fixture();
    const corrupt = Buffer.from("not a docx archive");
    await expect(reader.read("submission", "teacher", docxFile(corrupt))).rejects.toMatchObject({ status: 400 });
    const large = await docxFixture(`<w:p><w:r><w:t>${"x".repeat(8 * 1024 * 1024 + 1)}</w:t></w:r></w:p>`);
    await expect(reader.read("submission", "teacher", docxFile(large))).rejects.toThrow("giải nén vượt giới hạn an toàn");
    expect(ai.resolveTask).not.toHaveBeenCalled();
    expect(ai.extractDocumentPages).not.toHaveBeenCalled();
  });
  it("replays full page text without active providers", async () => {
    const { reader, ai } = fixture();
    expect(await reader.read("submission", "teacher", file, true)).toBe("First page\n\nSecond page");
    ai.resolveTask.mockRejectedValue(new Error("disabled"));
    expect(await reader.read("submission", "teacher", file)).toBe("First page\n\nSecond page");
    expect(ai.resolveTask).toHaveBeenCalledTimes(2);
    expect(ai.extractDocumentPages).toHaveBeenCalledTimes(1);
  });
  it.each(["owner", "submission", "revision", "attachment", "name"])("does not share cache across %s changes", async (change) => {
    const { reader, ai } = fixture();
    await reader.read("submission", "teacher", file, true);
    await expect(reader.read(change === "submission" ? "other" : "submission", change === "owner" ? "other" : "teacher", { ...file, ...(change === "revision" ? { submissionRevision: 2 } : {}), ...(change === "attachment" ? { attachmentId: "other" } : {}), ...(change === "name" ? { fileName: "renamed.pdf" } : {}) })).rejects.toMatchObject({ status: 409 });
    expect(ai.extractDocumentPages).toHaveBeenCalledTimes(1);
  });
  it("rejects tampered bytes before reading or generating", async () => {
    const { reader, systemSetting, ai } = fixture();
    await expect(reader.read("submission", "teacher", { ...file, buffer: Buffer.from("tampered") }, true)).rejects.toMatchObject({ status: 400 });
    expect(systemSetting.findUnique).not.toHaveBeenCalled();
    expect(ai.resolveTask).not.toHaveBeenCalled();
  });
  it("keeps ambiguous OCR locked and does not retry", async () => {
    const { reader, ai } = fixture();
    ai.extractDocumentPages.mockRejectedValue(new Error("lost response"));
    await expect(reader.read("submission", "teacher", file, true)).rejects.toThrow("lost response");
    await expect(reader.read("submission", "teacher", file, true)).rejects.toMatchObject({ status: 409 });
    expect(ai.extractDocumentPages).toHaveBeenCalledTimes(1);
  });
  it("does not reserve OCR when grading model configuration is missing", async () => {
    const { reader, ai, rows } = fixture();
    ai.resolveTask.mockRejectedValueOnce(new Error("missing grading model"));
    await expect(reader.read("submission", "teacher", file, true)).rejects.toThrow("missing grading model");
    expect(rows.size).toBe(0);
    expect(ai.extractDocumentPages).not.toHaveBeenCalled();
  });
  it("does not truncate or regenerate a saved extraction exceeding grading limits", async () => {
    const { reader, ai } = fixture();
    ai.extractDocumentPages.mockResolvedValue([{ page: 1, text: "x".repeat(20_001) }]);
    await expect(reader.read("submission", "teacher", file, true)).rejects.toMatchObject({ status: 400 });
    await expect(reader.read("submission", "teacher", file)).rejects.toMatchObject({ status: 400 });
    expect(ai.extractDocumentPages).toHaveBeenCalledTimes(1);
  });
});
