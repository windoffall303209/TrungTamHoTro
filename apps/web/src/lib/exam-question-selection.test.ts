import { describe, expect, it } from "vitest";
import { eligibleExamQuestions } from "@/lib/exam-question-selection";
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
