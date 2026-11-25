import { describe, expect, it } from "vitest";
import { apiFileName } from "@/lib/api-client";
import {
  localDateTimeToIso,
  normalizeDisplayFileName,
  parseLocalDateTimeInput,
  toLocalDateTimeInput,
} from "@/lib/date-time";

describe("datetime-local UTC+7 roundtrip và tên tệp Unicode NFC (D05)", () => {
  it("chuyển đổi qua lại ISO <-> datetime-local không lệch giờ theo múi giờ cục bộ (kể cả mốc 00:15 và 23:45)", () => {
    const samples = [
      new Date(2026, 10, 25, 0, 15, 0, 0),
      new Date(2026, 10, 25, 7, 0, 0, 0),
      new Date(2026, 10, 25, 19, 30, 0, 0),
      new Date(2026, 10, 25, 23, 59, 0, 0),
      new Date(2026, 0, 1, 0, 0, 0, 0),
    ];

    for (const sample of samples) {
      const iso = sample.toISOString();
      const inputValue = toLocalDateTimeInput(iso);
      const expectedLocal = `${sample.getFullYear()}-${String(sample.getMonth() + 1).padStart(2, "0")}-${String(sample.getDate()).padStart(2, "0")}T${String(sample.getHours()).padStart(2, "0")}:${String(sample.getMinutes()).padStart(2, "0")}`;
      expect(inputValue).toBe(expectedLocal);
      expect(localDateTimeToIso(inputValue)).toBe(iso);
    }
  });

  it("chứng minh không còn lỗi cắt lát UTC khi múi giờ khác UTC (ví dụ UTC+7)", () => {
    // 2026-11-25T16:30:00.000Z tương ứng 23:30 ngày 25/11 ở UTC+7; toLocalDateTimeInput phải trả đúng giờ cục bộ rồi quay lại đúng mốc UTC gốc.
    const originalIso = "2026-11-25T16:30:00.000Z";
    const localValue = toLocalDateTimeInput(originalIso);
    const roundtrippedIso = localDateTimeToIso(localValue);
    expect(roundtrippedIso).toBe(originalIso);
  });

  it("từ chối chuỗi datetime-local rỗng hoặc ngày tràn lịch như 30/02", () => {
    expect(toLocalDateTimeInput("not-a-date")).toBe("");
    expect(parseLocalDateTimeInput("")).toBeNull();
    expect(parseLocalDateTimeInput("2026-02-30T10:00")).toBeNull();
    expect(() => localDateTimeToIso("2026-02-30T10:00")).toThrow("Thời gian nhập vào không hợp lệ.");
  });

  it("giải mã Content-Disposition filename* tiếng Việt và chuẩn hóa NFD về NFC nhất quán", () => {
    const nfc = "Bài tập Toán 11 (đề 1)!.pdf";
    const nfd = nfc.normalize("NFD");
    expect(nfd).not.toBe(nfc);
    expect(normalizeDisplayFileName(nfd)).toBe(nfc);

    const encodedNfd = encodeURIComponent(nfd);
    const header = `attachment; filename="Bai tap Toan 11.pdf"; filename*=UTF-8''${encodedNfd}`;
    expect(apiFileName(header)).toBe(nfc);
    expect(apiFileName(`attachment; filename="${nfd}"`)).toBe(nfc);
  });
});
