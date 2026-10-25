import { describe, expect, it } from "vitest";
import { isSupportedLocale, translateText } from "./catalog";

describe("i18n catalog", () => {
  it.each([
    ["Gợi ý chấm AI sai cấu trúc. Không có điểm nào được áp dụng.", "The AI grading suggestion has an invalid structure. No scores have been applied."],
    ["Không xác nhận được trạng thái lưu kết quả AI. Không tạo yêu cầu mới; hãy thử lấy lại kết quả.", "The AI result's storage status could not be confirmed. Do not create a new request; try retrieving the result again."],
    ["Lần gọi AI trước chưa có kết quả xác định. Hệ thống không tự gọi lại để tránh tính phí trùng. Liên hệ quản trị viên kiểm tra mã yêu cầu.", "The previous AI call has an uncertain outcome. The system will not automatically call AI again to avoid duplicate charges. Contact an administrator to check the request ID."],
    ["Tài liệu đã chọn vượt giới hạn 6 tệp hoặc tổng 24 MB. Hãy giảm số tệp.", "The selected documents exceed the limit of 6 files or 24 MB in total. Select fewer files."],
  ])("preserves AI recovery guidance and limits in both languages: %s", (vietnamese, english) => {
    expect(translateText(vietnamese, "en-US")).toBe(english);
    expect(translateText(vietnamese, "vi-VN")).toBe(vietnamese);
  });

  it("dịch thuật ngữ học vụ cốt lõi và giữ khoảng trắng", () => {
    expect(translateText("  Bài tập  ", "en-US")).toBe("  Assignments  ");
    expect(translateText("Lớp", "en-US")).toBe("Class");
    expect(translateText("Bài tập", "vi-VN")).toBe("Bài tập");
  });

  it("dịch chuỗi số lượng động với số ít và số nhiều", () => {
    expect(translateText("1 câu hỏi", "en-US")).toBe("1 question");
    expect(translateText("4 câu hỏi", "en-US")).toBe("4 questions");
    expect(translateText("1 phân hệ khả dụng", "en-US")).toBe("1 module available");
    expect(translateText("6 phân hệ khả dụng", "en-US")).toBe("6 modules available");
  });

  it("dịch chính xác nhóm chuyên mục điều hướng và trang tổng quan", () => {
    expect(translateText("Học tập & Giảng dạy", "en-US")).toBe("Teaching & Learning");
    expect(translateText("Khảo thí & Học liệu", "en-US")).toBe("Exams & Materials");
    expect(translateText("Cộng đồng & Hỗ trợ", "en-US")).toBe("Community & Support");
    expect(translateText("Quản trị & Vận hành", "en-US")).toBe("Admin & Operations");

    expect(translateText("Xin chào, Hoàng Thanh Mai 👋", "en-US")).toBe("Welcome, Hoàng Thanh Mai 👋");
    expect(translateText("Làm mới số liệu", "en-US")).toBe("Refresh metrics");
    expect(translateText("Chỉ số hoạt động trọng tâm", "en-US")).toBe("Key operational metrics");
    expect(translateText("Phân hệ chức năng", "en-US")).toBe("Functional modules");
    expect(translateText("Khóa học & Lớp", "en-US")).toBe("Courses & Classes");
    expect(translateText("Đề thi & Khảo thí", "en-US")).toBe("Exams & Assessments");
    expect(translateText("Kho Học liệu Số", "en-US")).toBe("Digital Learning Materials");
  });

  it("chỉ chấp nhận hai locale đã triển khai", () => {
    expect(isSupportedLocale("vi-VN")).toBe(true);
    expect(isSupportedLocale("en-US")).toBe(true);
    expect(isSupportedLocale("fr-FR")).toBe(false);
  });
});

