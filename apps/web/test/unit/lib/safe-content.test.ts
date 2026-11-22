import { describe, expect, it } from "vitest";
import { detachOpener, isSafePreviewImage, safeExternalUrl, safeInternalPath, safePreviewBlob, sanitizePreviewHtml } from "@/lib/safe-content";

describe("Lớp phòng thủ nội dung người dùng phía client", () => {
  it("lọc HTML xem trước theo danh sách cho phép", () => {
    const html = sanitizePreviewHtml('<p onclick="x()">Xin chào<script>alert(1)</script></p><img src="javascript:alert(1)" onerror="alert(2)"><a href="javascript:alert(3)">x</a><a href="https://wind.edu.vn">ok</a><svg><script>alert(4)</script></svg><table><tr><td colspan="2">ô</td></tr></table>');
    expect(html).not.toMatch(/script|onclick|onerror|javascript:|<svg/i);
    expect(html).toContain("<p>Xin chào</p>");
    expect(html).toContain('href="https://wind.edu.vn"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain('colspan="2"');
  });

  it("chỉ nhận URL ngoài https và đường dẫn nội bộ hợp lệ", () => {
    expect(safeExternalUrl("https://meet.google.com/abc-defg-hij")).toBe("https://meet.google.com/abc-defg-hij");
    expect(safeExternalUrl("javascript:alert(1)")).toBeUndefined();
    expect(safeExternalUrl("data:text/html,<script>")).toBeUndefined();
    expect(safeExternalUrl("http://evil.example")).toBeUndefined();
    expect(safeInternalPath("/exams?examId=1")).toBe("/exams?examId=1");
    expect(safeInternalPath("//evil.example")).toBeUndefined();
    expect(safeInternalPath(`/${"\\"}evil.example`)).toBeUndefined();
    expect(safeInternalPath("https://evil.example")).toBeUndefined();
  });

  it("ép kiểu blob không an toàn thành octet-stream và loại SVG khỏi ảnh xem trước", () => {
    expect(safePreviewBlob(new Blob(["<svg/>"], { type: "image/svg+xml" })).type).toBe("application/octet-stream");
    expect(safePreviewBlob(new Blob(["<html>"], { type: "text/html" })).type).toBe("application/octet-stream");
    expect(safePreviewBlob(new Blob(["%PDF"], { type: "application/pdf" })).type).toBe("application/pdf");
    expect(isSafePreviewImage("image/png")).toBe(true);
    expect(isSafePreviewImage("image/svg+xml")).toBe(false);
    const child = { opener: {} } as unknown as Window;
    expect(detachOpener(child)?.opener).toBeNull();
  });
});
