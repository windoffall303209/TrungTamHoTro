import { describe, expect, it } from "vitest";
import { ContentMaterialService } from "../../src/domains/learning/content/content-material.service.js";
import { createLearningTestRuntime } from "../../src/domains/learning/core/learning-runtime.service.js";
import { ExamAssessmentService } from "../../src/domains/learning/exams/exam-assessment.service.js";

describe("F02b ContentMaterialService & ExamAssessmentService slices", () => {
  it("ContentMaterialService quản lý thư mục, chính sách tải lên và tìm kiếm học liệu độc lập", async () => {
    const runtime = createLearningTestRuntime();
    const materials = new ContentMaterialService(runtime);

    const policy = await materials.getMaterialUploadPolicy();
    expect(policy.maxFileSizeMb).toBe(50);
    expect(policy.allowedMimeTypes.length).toBeGreaterThan(0);

    const folders = await materials.classFolders(
      "class-web-01",
      "usr-instructor",
      { kind: "materials", name: "Tuần 9" },
      "INSTRUCTOR",
    );
    expect(folders.materials).toContain("Tuần 9");

    const found = await materials.searchAccessibleMaterials(
      { classId: "class-web-01", query: "REST" },
      "usr-learner",
      "LEARNER",
    );
    expect(found.items.some((item) => item.name.includes("REST"))).toBe(true);
  });

  it("ExamAssessmentService thực hiện trọn vòng đời câu hỏi → lượt thi → tự chấm → biên nhận độc lập", async () => {
    const runtime = createLearningTestRuntime();
    const exams = new ExamAssessmentService(runtime);

    const createdQuestion = await exams.createQuestion(
      {
        courseId: "course-web",
        type: "SINGLE_CHOICE",
        content: "Mã trạng thái HTTP 206 biểu thị điều gì?",
        options: ["Partial Content", "No Content", "Not Modified", "Accepted"],
        correctAnswers: ["Partial Content"],
        difficulty: 1,
        tags: ["http"],
      },
      "usr-instructor",
    );
    expect(createdQuestion.version).toBe(1);

    const attempt = await exams.startAttempt("exam-mid-web", "usr-learner");
    expect(attempt.status).toBe("IN_PROGRESS");

    const submitted = await exams.submitAttemptWithAnswers(attempt.id, "usr-learner", [
      { questionId: "q-rest-01", answers: ["PATCH"] },
      { questionId: "q-db-01", answers: ["Đúng"] },
    ]);
    expect(submitted.status).toBe("GRADED");
    expect(submitted.score).toBe(10);
    expect(submitted.submissionReceipt).toBeTruthy();

    const results = await exams.listLearnerResults("usr-learner");
    expect(results.some((r) => r.attempt.id === submitted.id)).toBe(true);
  });
});
