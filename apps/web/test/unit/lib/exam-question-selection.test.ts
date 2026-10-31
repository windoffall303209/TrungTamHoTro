import { describe, expect, it } from "vitest";
import { eligibleExamQuestions, isExamQuestionPreviewCurrent, toggleVisibleExamQuestions } from "@/lib/exam-question-selection";
import type { LearningClass, Question } from "@/lib/learning-types";

const classes = [
  { id: "class-web", courseId: "course-web" },
  { id: "class-english", courseId: "course-english" },
] as LearningClass[];

const questions = [
  { id: "published-web", courseId: "course-web", status: "PUBLISHED" },
  { id: "draft-web", courseId: "course-web", status: "DRAFT" },
  { id: "published-english", courseId: "course-english", status: "PUBLISHED" },
] as Question[];

describe("eligibleExamQuestions", () => {
  it("chỉ giữ câu đã xuất bản thuộc khóa học của lớp", () => {
    expect(eligibleExamQuestions(questions, classes, "class-web").map((item) => item.id)).toEqual([
      "published-web",
    ]);
  });

  it("không đưa ra lựa chọn khi chưa chọn hoặc không tìm thấy lớp", () => {
    expect(eligibleExamQuestions(questions, classes, "")).toEqual([]);
    expect(eligibleExamQuestions(questions, classes, "unknown")).toEqual([]);
  });
});

describe("toggleVisibleExamQuestions", () => {
  it("chọn phần đang lọc mà vẫn giữ câu đã chọn ở bộ lọc khác", () => {
    expect(toggleVisibleExamQuestions(["essay-1"], ["choice-1", "choice-2"])).toEqual([
      "essay-1", "choice-1", "choice-2",
    ]);
  });

  it("bỏ chọn đúng phần đang lọc khi đã chọn toàn bộ phần đó", () => {
    expect(toggleVisibleExamQuestions(["essay-1", "choice-1", "choice-2"], ["choice-1", "choice-2"])).toEqual(["essay-1"]);
  });

  it("không thay đổi lựa chọn khi bộ lọc trống và không tạo ID trùng", () => {
    expect(toggleVisibleExamQuestions(["essay-1"], [])).toEqual(["essay-1"]);
    expect(toggleVisibleExamQuestions(["essay-1", "choice-1"], ["choice-1", "choice-2"])).toEqual([
      "essay-1", "choice-1", "choice-2",
    ]);
  });
});

describe("isExamQuestionPreviewCurrent", () => {
  const original = {
    id: "question-1", status: "PUBLISHED", content: "Nội dung", type: "Trắc nghiệm", difficulty: "Cơ bản",
    options: ["Phương án A", "Phương án B"], correctAnswers: [0], solution: "Giải thích A",
  };

  it("chấp nhận bản xem trước khi ngân hàng tải lại cùng nội dung", () => {
    expect(isExamQuestionPreviewCurrent([original], [{ ...original }])).toBe(true);
  });

  it("từ chối khi câu hỏi bị gỡ xuất bản, xóa hoặc sửa nội dung", () => {
    expect(isExamQuestionPreviewCurrent([original], [])).toBe(false);
    expect(isExamQuestionPreviewCurrent([original], [{ ...original, status: "DRAFT" }])).toBe(false);
    expect(isExamQuestionPreviewCurrent([original], [{ ...original, content: "Đã chỉnh sửa" }])).toBe(false);
    expect(isExamQuestionPreviewCurrent([original], [{ ...original, difficulty: "Vận dụng" }])).toBe(false);
  });

  it("từ chối khi phương án, đáp án hoặc lời giải đã thay đổi", () => {
    expect(isExamQuestionPreviewCurrent([original], [{ ...original, options: ["Phương án A", "Phương án C"] }])).toBe(false);
    expect(isExamQuestionPreviewCurrent([original], [{ ...original, correctAnswers: [1] }])).toBe(false);
    expect(isExamQuestionPreviewCurrent([original], [{ ...original, solution: "Giải thích mới" }])).toBe(false);
  });

  it("không xác nhận một bản xem trước trống", () => {
    expect(isExamQuestionPreviewCurrent([], [original])).toBe(false);
  });
});
