import { beforeAll, describe, expect, it } from "vitest";
import {
  isEnglishCatalogLoaded,
  isSupportedLocale,
  loadEnglishCatalog,
  resetEnglishCatalogForTests,
  translateText,
  translateTextAsync,
} from "../../../src/i18n/catalog";

describe("i18n catalog lazy loading (C03)", () => {
  it("không nạp từ điển EN khi dùng locale vi-VN và chỉ nạp khi chuyển sang en-US", async () => {
    resetEnglishCatalogForTests();
    expect(isEnglishCatalogLoaded()).toBe(false);
    expect(translateText("Bài tập", "vi-VN")).toBe("Bài tập");
    expect(await translateTextAsync("Bài tập", "vi-VN")).toBe("Bài tập");
    expect(isEnglishCatalogLoaded()).toBe(false);

    expect(await translateTextAsync("  Bài tập  ", "en-US")).toBe("  Assignments  ");
    expect(isEnglishCatalogLoaded()).toBe(true);
    expect(translateText("Bài tập", "en-US")).toBe("Assignments");
  });
});

describe("i18n catalog", () => {
  beforeAll(async () => {
    await loadEnglishCatalog();
  });
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

  it("dịch đầy đủ các nhãn tài khoản, học liệu và điều hướng khảo thí", () => {
    expect(translateText("Tạo đề, giao bài & bảng điểm", "en-US")).toBe("Exams, assignments & gradebook");
    expect(translateText("Tải lên tài liệu / bài giảng", "en-US")).toBe("Upload material / lecture");
    expect(translateText("Sửa đổi lần cuối", "en-US")).toBe("Last modified");
    expect(translateText("Chức năng khảo thí", "en-US")).toBe("Examination functions");
    expect(translateText("Đề thi & Kết quả", "en-US")).toBe("Exams & Results");
    expect(translateText("Cần phân cấp lại", "en-US")).toBe("Needs reclassification");
    expect(translateText("Hiển thị chi tiết học liệu", "en-US")).toBe("Show material details");
    expect(translateText("Tên khối", "en-US")).toBe("Grade level name");
    expect(translateText("Kích thước tệp", "en-US")).toBe("File size");
    expect(translateText("Tùy chọn", "en-US")).toBe("Options");
    expect(translateText("Tên tài khoản đăng nhập", "en-US")).toBe("Username");
    expect(translateText("Tên định danh cố định không thể sửa.", "en-US")).toBe("Fixed identifier cannot be modified.");
    expect(translateText("Ngôn ngữ hiển thị", "en-US")).toBe("Display language");
    expect(translateText("Tham gia hệ thống từ:", "en-US")).toBe("Member since:");
    expect(translateText("Hồ Chí Minh, Bangkok (UTC+7)", "en-US")).toBe("Ho Chi Minh, Bangkok (UTC+7)");
    expect(translateText("Hỗ trợ định dạng PNG, JPEG hoặc WebP; dung lượng tối đa 3 MB.", "en-US")).toBe("Supports PNG, JPEG, or WebP; maximum size 3 MB.");
    expect(translateText("Đã cập nhật thông tin cá nhân thành công.", "en-US")).toBe("Profile updated successfully.");
  });

  it("áp dụng quy tắc số ít, số nhiều, bước tiến trình và thông báo động", () => {
    expect(translateText("1 mục", "en-US")).toBe("1 item");
    expect(translateText("24 mục", "en-US")).toBe("24 items");
    expect(translateText("1 điểm", "en-US")).toBe("1 point");
    expect(translateText("5 điểm", "en-US")).toBe("5 points");
    expect(translateText("1 lớp", "en-US")).toBe("1 class");
    expect(translateText("5 lớp", "en-US")).toBe("5 classes");
    expect(translateText("1 tệp", "en-US")).toBe("1 file");
    expect(translateText("5 tệp", "en-US")).toBe("5 files");
    expect(translateText("1 câu · Tổng 1 điểm", "en-US")).toBe("1 question · Total 1 point");
    expect(translateText("10 câu · Tổng 20 điểm", "en-US")).toBe("10 questions · Total 20 points");
    expect(translateText("Tạo đề thi thủ công (1 câu)", "en-US")).toBe("Create exam manually (1 question)");
    expect(translateText("Tạo đề thi thủ công (12 câu)", "en-US")).toBe("Create exam manually (12 questions)");
    expect(translateText("1 câu tự luận", "en-US")).toBe("1 essay question");
    expect(translateText("2 câu tự luận và 1 tệp đề", "en-US")).toBe("2 essay questions and 1 prompt file");
    expect(translateText("Bước 1/5", "en-US")).toBe("Step 1/5");
    expect(translateText("Thiết bị đăng nhập (2)", "en-US")).toBe("Signed-in devices (2)");
    expect(translateText("Thông báo lớp: Nghỉ lễ", "en-US")).toBe("Class announcement: Nghỉ lễ");
    expect(translateText("Gia hạn bài Midterm đến 20/11", "en-US")).toBe("Extended deadline for Midterm to 20/11");
    expect(translateText("Bài tập mới: Quiz 1", "en-US")).toBe("New assignment: Quiz 1");
    expect(translateText("Đã chấm bài: Essay 1", "en-US")).toBe("Graded assignment: Essay 1");
    expect(translateText("Tin nhắn mới từ Nguyen Van A", "en-US")).toBe("New message from Nguyen Van A");
    expect(translateText("Hoàng Thanh Mai đã nhắc bạn trong tin nhắn", "en-US")).toBe("Hoàng Thanh Mai mentioned you in a message");
  });

  it("loại bỏ các lỗi dịch máy sai ngữ cảnh giáo dục", () => {
    expect(translateText("Chấm", "en-US")).toBe("Grade");
    expect(translateText("Chấm 8.5", "en-US")).toBe("Graded 8.5");
    expect(translateText("câu", "en-US")).toBe("questions");
    expect(translateText("Phiếu", "en-US")).toBe("Ticket");
    expect(translateText("· duyệt bởi Admin", "en-US")).toBe("· reviewed by Admin");
    expect(translateText("Ảnh đại diện của Admin", "en-US")).toBe("Avatar of Admin");
    expect(translateText("Khối 10 · Môn Toán · v2", "en-US")).toBe("Grade 10 · Subject Toán · v2");
    expect(translateText("Phương án A câu 3", "en-US")).toBe("Option A for question 3");
    expect(translateText("Đã chuyển 'Tai lieu.pdf' vào Cần phân cấp lại.", "en-US")).toBe("Moved 'Tai lieu.pdf' to Needs reclassification.");
    expect(translateText("Xác nhận gỡ Nguyen Van A khỏi lớp học.", "en-US")).toBe("Confirm removing Nguyen Van A from the class.");
    const aiErr = translateText("Không thể kết nối OpenAI để tạo đề.", "en-US");
    expect(aiErr.toLowerCase()).toContain("exam");
    expect(aiErr.toLowerCase()).not.toContain("topic");
    const returnedExam = translateText("Đề “Midterm” sẽ quay về bản nháp để giảng viên chỉnh sửa.", "en-US");
    expect(returnedExam).toContain("Exam");
    expect(returnedExam.toLowerCase()).not.toContain("topic");
  });

  it("dịch đầy đủ hướng dẫn nhiều dòng, trạng thái chấm học sinh và thông báo thang điểm tự luận", () => {
    expect(
      translateText(
        "Câu 1: test câu hỏi tiếng anh\n\nNhập nội dung bài làm hoặc tải lên tệp câu trả lời.",
        "en-US",
      ),
    ).toBe("Question 1: test câu hỏi tiếng anh\n\nType your response or upload an answer file.");
    expect(translateText("Bài tập tự luận: test eng", "en-US")).toBe("Essay assignment: test eng");
    expect(translateText("Chọn tệp", "en-US")).toBe("Choose files");
    expect(translateText("Chưa có tệp nào được chọn", "en-US")).toBe("No file chosen");
    expect(translateText("Đã chọn 2 tệp", "en-US")).toBe("2 files selected");
    expect(translateText("1. Nguyễn Văn A — Chờ chấm", "en-US")).toBe("1. Nguyễn Văn A — Pending");
    expect(translateText("2. Trần Thị B — Đã chấm (8.5/10)", "en-US")).toBe(
      "2. Trần Thị B — Graded (8.5/10)",
    );
    expect(translateText("Vui lòng nhập điểm cho Phần tự luận.", "en-US")).toBe(
      "Please enter a score for Essay.",
    );
    expect(translateText("Điểm Phần trắc nghiệm phải nằm trong khoảng từ 0 đến 7.", "en-US")).toBe(
      "Multiple choice score must be between 0 and 7.",
    );
    expect(translateText("Đề bài", "en-US")).toBe("Prompt");
  });
});

