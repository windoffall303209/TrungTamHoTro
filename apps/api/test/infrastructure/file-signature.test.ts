import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { assertNoActiveContentMimeTypes, assertSafeUpload, isInlineSafeMime, matchesFileSignature } from "../../src/infrastructure/file-signature.js";
import { validateDocxArchive } from "../../src/infrastructure/validate-docx-archive.js";
import { docxFixture } from "../learning/docx.fixture.js";

const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);

/** Tạo DOCX hợp lệ rồi thêm/ghi đè một phần tử để mô phỏng tệp độc hại. */
async function docxWith(path: string, content: string): Promise<Buffer> {
  const zip = await JSZip.loadAsync(await docxFixture());
  zip.file(path, content);
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

describe("Kiểm tra chữ ký tệp người dùng tải lên", () => {
  it("so khớp magic bytes với MIME khai báo", () => {
    expect(matchesFileSignature("image/png", png)).toBe(true);
    expect(matchesFileSignature("image/jpeg", png)).toBe(false);
    expect(matchesFileSignature("application/pdf", Buffer.from("%PDF-1.7"))).toBe(true);
    expect(matchesFileSignature("text/plain", Buffer.from("ghi chú bình thường"))).toBe(true);
    // HTML/SVG ngụy trang text/plain vẫn bị từ chối.
    expect(matchesFileSignature("text/plain", Buffer.from("  <svg onload=alert(1)>"))).toBe(false);
    expect(matchesFileSignature("application/x-custom", Buffer.from("x"))).toBeUndefined();
  });

  it("chặn MIME có thể chạy script và nội dung lệch chữ ký", async () => {
    await expect(assertSafeUpload({ mimeType: "image/svg+xml", buffer: Buffer.from("<svg/>"), originalName: "a.svg" }, { allowUnknownTypes: true })).rejects.toThrow("không khớp");
    await expect(assertSafeUpload({ mimeType: "image/png", buffer: Buffer.from("<html>"), originalName: "a.png" })).rejects.toThrow("không khớp");
    await expect(assertSafeUpload({ mimeType: "application/x-custom", buffer: Buffer.from("x"), originalName: "a.bin" })).rejects.toThrow("không khớp");
    await expect(assertSafeUpload({ mimeType: "application/x-custom", buffer: Buffer.from("x"), originalName: "a.bin" }, { allowUnknownTypes: true })).resolves.toBeUndefined();
    expect(() => assertNoActiveContentMimeTypes(["application/pdf", " TEXT/HTML "])).toThrow("script");
    expect(isInlineSafeMime("image/png")).toBe(true);
    expect(isInlineSafeMime("text/plain")).toBe(false);
  });

  it("chặn DOCX có DTD/thực thể, macro VBA hoặc quan hệ ngoài không phải hyperlink", async () => {
    await expect(validateDocxArchive(await docxFixture())).resolves.toBeUndefined();
    await expect(validateDocxArchive(await docxWith("word/document.xml", '<?xml version="1.0"?><!DOCTYPE x [<!ENTITY a "aaaa">]><w:document/>'))).rejects.toThrow("khai báo XML");
    await expect(validateDocxArchive(await docxWith("word/vbaProject.bin", "macro"))).rejects.toThrow("macro");
    const externalTemplate = '<?xml version="1.0"?><Relationships><Relationship Id="r1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/attachedTemplate" Target="http://evil.example/t.dotm" TargetMode="External"/></Relationships>';
    await expect(validateDocxArchive(await docxWith("word/_rels/settings.xml.rels", externalTemplate))).rejects.toThrow("liên kết ngoài");
    const hyperlink = '<?xml version="1.0"?><Relationships><Relationship Id="r2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://wind.edu.vn" TargetMode="External"/></Relationships>';
    await expect(validateDocxArchive(await docxWith("word/_rels/document.xml.rels", hyperlink))).resolves.toBeUndefined();
    await expect(assertSafeUpload({ mimeType: DOCX, buffer: await docxWith("word/vbaProject.bin", "macro"), originalName: "bai.docx" })).rejects.toThrow("macro");
  });
});
