import { describe, expect, it } from "vitest";
import { localizeErrorMessage, resolveRequestLocale } from "../../src/common/error-localization.js";

describe("error localization", () => {
  it("keeps actionable English messages for rejected submission sources", () => {
    expect(localizeErrorMessage("Tệp bài nộp không khớp bản đã lưu. Không thể sử dụng nội dung; hãy liên hệ quản trị viên.", "en-US")).toContain("contact an administrator");
    expect(localizeErrorMessage("Bài nộp hoặc tệp đã thay đổi trong lúc tải. Hãy mở lại bài nộp.", "en-US")).toContain("Reopen the submission");
  });
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

  it("dịch các thông báo validation DTO đơn lẻ và dạng ghép nhiều trường", () => {
    expect(localizeErrorMessage("Email không được vượt quá 191 ký tự.", "en-US")).toBe("Email must not exceed 191 characters.");
    expect(localizeErrorMessage("Họ tên phải có từ 2 đến 150 ký tự.; Email không đúng định dạng.", "en-US")).toBe(
      "Full name must be between 2 and 150 characters.; Invalid email address.",
    );
    expect(localizeErrorMessage("Email không đúng định dạng.; Lỗi nội bộ bí mật", "en-US")).toBe(
      "The request could not be completed. Please review the information and try again.",
    );
  });

  it("dịch các thông báo lỗi API có tham số động mà vẫn bảo vệ lỗi lạ", () => {
    expect(localizeErrorMessage("Vai trò STUDENT không có quyền: exam.publish", "en-US")).toBe(
      "Role STUDENT lacks required permission: exam.publish",
    );
    expect(localizeErrorMessage("Tham số limit không hợp lệ.", "en-US")).toBe("Invalid parameter: limit.");
    expect(localizeErrorMessage("Ảnh câu hỏi không an toàn: EICAR", "en-US")).toBe(
      "Question image failed security scan: EICAR",
    );
    expect(localizeErrorMessage("Không thể kết nối Gemini để tạo đề.", "en-US")).toBe(
      "Unable to connect to Gemini while generating the exam.",
    );
    expect(localizeErrorMessage("Provider từ chối dữ liệu khi hỏi đáp tài liệu (400). Kiểm tra model và định dạng request.", "en-US")).toBe(
      "Provider rejected the payload while running document Q&A (400). Check the model and request format.",
    );
    expect(localizeErrorMessage("Resend từ chối yêu cầu gửi email (validation_error).", "en-US")).toBe(
      "Resend rejected the email request (validation_error).",
    );
    expect(localizeErrorMessage("Cloudinary trả về lỗi tải tệp (502).", "en-US")).toBe(
      "Cloudinary returned a file upload error (502).",
    );
  });
});
