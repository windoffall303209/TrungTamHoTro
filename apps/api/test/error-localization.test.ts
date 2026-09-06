import { describe, expect, it } from "vitest";
import { localizeErrorMessage, resolveRequestLocale } from "../src/common/error-localization.js";

describe("error localization", () => {
  it("nhận diện ưu tiên tiếng Anh từ Accept-Language", () => {
    expect(resolveRequestLocale("en-US,en;q=0.9,vi;q=0.8")).toBe("en-US");
    expect(resolveRequestLocale("vi-VN,vi;q=0.9")).toBe("vi-VN");
  });

  it("dịch lỗi nghiệp vụ đã kiểm kê và giữ nguyên tiếng Việt", () => {
    const message = "Tài khoản hoặc mật khẩu không chính xác.";
    expect(localizeErrorMessage(message, "en-US")).toMatch(/account|password/i);
    expect(localizeErrorMessage(message, "vi-VN")).toBe(message);
  });

  it("không làm lộ lỗi nội bộ chưa có trong catalog tiếng Anh", () => {
    expect(localizeErrorMessage("Lỗi nội bộ bí mật", "en-US")).toBe("The request could not be completed. Please review the information and try again.");
  });
});
