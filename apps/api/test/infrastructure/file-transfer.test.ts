import { describe, expect, it } from "vitest";
import { DEFAULT_MATERIAL_MIME_TYPES, fileContentDisposition, normalizeMultipartFileName } from "../../src/infrastructure/file-transfer.js";

describe("file transfer", () => {
  it("khôi phục đúng tên tệp tiếng Việt bị multipart giải mã theo latin1", () => {
    const mojibake = Buffer.from("Tài liệu đại số.pdf", "utf8").toString("latin1");
    expect(normalizeMultipartFileName(mojibake)).toBe("Tài liệu đại số.pdf");
    expect(normalizeMultipartFileName("Bài giảng xác suất.docx")).toBe("Bài giảng xác suất.docx");
  });

  it("tạo Content-Disposition tương thích và giữ tên UTF-8", () => {
    const disposition = fileContentDisposition("attachment", "Bài giảng xác suất.pdf");
    expect(disposition).toContain('filename="Bai giang xac suat.pdf"');
    expect(disposition).toContain("filename*=UTF-8''B%C3%A0i%20gi%E1%BA%A3ng%20x%C3%A1c%20su%E1%BA%A5t.pdf");
  });

  it("bật sẵn cả DOC và DOCX trong chính sách học liệu", () => {
    expect(DEFAULT_MATERIAL_MIME_TYPES).toContain("application/msword");
    expect(DEFAULT_MATERIAL_MIME_TYPES).toContain("application/vnd.openxmlformats-officedocument.wordprocessingml.document");
  });
});
