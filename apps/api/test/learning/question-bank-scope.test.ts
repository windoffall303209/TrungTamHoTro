import { BadRequestException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LearningService } from "../../src/domains/learning/core/learning.service.js";

const manager = { actorId: "usr-manager", actorRole: "CENTER_MANAGER" };
const instructor = { actorId: "usr-instructor", actorRole: "INSTRUCTOR" };
const outsider = { actorId: "usr-outsider", actorRole: "INSTRUCTOR" };

describe("Phạm vi ngân hàng câu hỏi và dữ liệu đề trả cho học viên", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-01T00:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("giảng viên chỉ thấy câu hỏi của khóa học được phân công, vai trò khác ngoài quản lý bị từ chối", async () => {
    const service = new LearningService();
    const all = await service.listQuestions({}, manager);
    expect(all.length).toBeGreaterThan(0);
    expect((await service.listQuestions({}, instructor)).map((item) => item.id).sort()).toEqual(all.filter((item) => item.courseId === "course-web").map((item) => item.id).sort());
    expect(await service.listQuestions({}, outsider)).toEqual([]);
    expect((await service.listQuestionsPage({}, outsider)).total).toBe(0);
    expect((await service.getQuestionSummary(undefined, outsider)).total).toBe(0);
    await expect(service.listQuestions({}, { actorId: "usr-learner", actorRole: "LEARNER" })).rejects.toThrow(ForbiddenException);
  });

  it("chặn sửa, đổi ảnh hoặc tạo câu hỏi ngoài phạm vi và không cho chuyển family sang khóa học khác", async () => {
    const service = new LearningService();
    const [question] = await service.listQuestions({}, instructor);
    expect(question).toBeDefined();
    const input = { courseId: question!.courseId, type: question!.type, content: `${question!.content} (bản sửa)`, options: question!.options, correctAnswers: question!.correctAnswers, difficulty: question!.difficulty, tags: question!.tags };

    await expect(service.updateQuestion(question!.id, input, outsider.actorId)).rejects.toThrow(NotFoundException);
    await expect(service.removeQuestionImage(question!.id, outsider.actorId)).rejects.toThrow(NotFoundException);
    await expect(service.createQuestion({ ...input, content: "Câu hỏi của người ngoài lớp" }, outsider.actorId)).rejects.toThrow(NotFoundException);
    await expect(service.updateQuestion(question!.id, { ...input, courseId: "course-other" }, instructor.actorId)).rejects.toThrow(BadRequestException);

    const updated = await service.updateQuestion(question!.id, input, instructor.actorId);
    expect(updated).toMatchObject({ courseId: question!.courseId, version: question!.version + 1 });
  });

  it("không trả danh sách câu, điểm từng câu, seed xáo trộn hay ngữ cảnh AI cho học viên trước khi mở lượt làm", async () => {
    const service = new LearningService();
    const exams = await service.listExams("LEARNER", "usr-learner");
    const summaries = await service.listLearnerExamSummaries(undefined, "usr-learner");
    expect(exams.length).toBeGreaterThan(0);
    for (const exam of [...exams, ...summaries]) {
      expect(exam.questionIds).toEqual([]);
      expect(exam).not.toHaveProperty("questionScores");
      expect(exam).not.toHaveProperty("randomSeed");
      expect(exam).not.toHaveProperty("aiContext");
    }
    // Giảng viên vẫn nhận đủ cấu trúc đề để quản lý.
    expect((await service.listExams("INSTRUCTOR", "usr-instructor")).some((exam) => exam.questionIds.length > 0)).toBe(true);
  });
});
