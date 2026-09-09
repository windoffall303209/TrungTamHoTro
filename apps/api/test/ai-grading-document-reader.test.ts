import { createHash } from "node:crypto";
import JSZip from "jszip";
import { describe, expect, it, vi } from "vitest";
import { AiGradingDocumentReader } from "../src/learning/ai-grading-document-reader.js";
import { AiDocumentExtractionStore } from "../src/learning/ai-document-extraction-store.js";
import { GRADING_DOCX_MIME, type VerifiedGradingAttachment } from "../src/learning/ai-grading-source.js";
import type { AiProviderService } from "../src/system/ai-provider.service.js";
import { extractionDatabase } from "./ai-document-extraction.fixture.js";

const buffer = Buffer.from("synthetic PDF bytes");
const file = { attachmentId: "attachment", buffer, fileName: "answer.pdf", mimeType: "application/pdf", checksum: `sha256:${createHash("sha256").update(buffer).digest("hex")}`, submissionRevision: 1 };

/** Build a minimal valid DOCX fixture containing paragraphs and a table in document order. */
async function docxFixture(documentBody = "<w:p><w:r><w:t>Opening paragraph</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>Cell one</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Cell two</w:t></w:r></w:p></w:tc></w:tr></w:tbl>"): Promise<Buffer> {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  zip.file("_rels/.rels", '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  zip.file("word/document.xml", `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${documentBody}<w:sectPr/></w:body></w:document>`);
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

/** Bind a fixture buffer to the same checksum contract used by verified attachment downloads. */
function docxFile(value: Buffer): VerifiedGradingAttachment {
  return { ...file, buffer: value, fileName: "answer.docx", mimeType: GRADING_DOCX_MIME, checksum: `sha256:${createHash("sha256").update(value).digest("hex")}` };
}

/** Use production claim semantics over a database fixture and a non-network provider stub. */
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
