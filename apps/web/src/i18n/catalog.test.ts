import { describe, expect, it } from "vitest";
import { isSupportedLocale, translateText } from "./catalog";

describe("i18n catalog", () => {
  it("dịch thuật ngữ học vụ cốt lõi và giữ khoảng trắng", () => {
    expect(translateText("  Bài tập  ", "en-US")).toBe("  Assignments  ");
    expect(translateText("Lớp", "en-US")).toBe("Class");
    expect(translateText("Bài tập", "vi-VN")).toBe("Bài tập");
  });

  it("dịch chuỗi số lượng động với số ít và số nhiều", () => {
    expect(translateText("1 câu hỏi", "en-US")).toBe("1 question");
    expect(translateText("4 câu hỏi", "en-US")).toBe("4 questions");
  });

  it("chỉ chấp nhận hai locale đã triển khai", () => {
    expect(isSupportedLocale("vi-VN")).toBe(true);
    expect(isSupportedLocale("en-US")).toBe(true);
    expect(isSupportedLocale("fr-FR")).toBe(false);
  });
});
