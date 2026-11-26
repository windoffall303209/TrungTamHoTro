import "reflect-metadata";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { describe, expect, it } from "vitest";
import { SubmitAttemptDto } from "../../src/domains/learning/core/learning.dto.js";
import { LearningService } from "../../src/domains/learning/core/learning.service.js";

describe("Nộp bài kèm toàn bộ đáp án trong một request", () => {
  it("lưu gộp đáp án rồi chấm như khi lưu từng câu", async () => {
    const service = new LearningService();
    const attempt = await service.startAttempt("exam-mid-web", "usr-learner");
    const result = await service.submitAttemptWithAnswers(attempt.id, "usr-learner", [
      { questionId: "q-rest-01", answers: ["PATCH"] },
      { questionId: "q-db-01", answers: ["Đúng"] },
    ]);
    expect(result.status).toMatch(/SUBMITTED|GRADED/);
    expect(result.score).toBe(10);
    expect(result.submissionReceipt).toBeTruthy();

    // Gửi lại cùng đáp án sau khi mất phản hồi trả về nguyên biên nhận cũ thay vì 400 Bài làm đã khóa.
    const retried = await service.submitAttemptWithAnswers(attempt.id, "usr-learner", [
      { questionId: "q-rest-01", answers: ["PATCH"] },
      { questionId: "q-db-01", answers: ["Đúng"] },
    ]);
    expect(retried.submissionReceipt).toBe(result.submissionReceipt);
    expect(retried.score).toBe(10);

    // Gửi đáp án khác sau khi đã chốt vẫn bị từ chối Bài làm đã khóa.
    await expect(
      service.submitAttemptWithAnswers(attempt.id, "usr-learner", [
        { questionId: "q-rest-01", answers: ["GET"] },
        { questionId: "q-db-01", answers: ["Đúng"] },
      ]),
    ).rejects.toThrow("Bài làm đã khóa");
  });

  it("từ chối câu hỏi không thuộc đề và không nộp bài", async () => {
    const service = new LearningService();
    const attempt = await service.startAttempt("exam-mid-web", "usr-learner");
    await expect(service.submitAttemptWithAnswers(attempt.id, "usr-learner", [{ questionId: "q-khong-co", answers: ["x"] }])).rejects.toThrow("không thuộc đề");
  });

  it("DTO chỉ nhận mảng đáp án hợp lệ và cho phép body rỗng như trước", async () => {
    expect(await validate(plainToInstance(SubmitAttemptDto, {}))).toHaveLength(0);
    expect(await validate(plainToInstance(SubmitAttemptDto, { answers: [{ questionId: "q-1", answers: ["A"] }] }))).toHaveLength(0);
    expect(await validate(plainToInstance(SubmitAttemptDto, { answers: [{ questionId: "", answers: "A" }] }))).not.toHaveLength(0);
  });
});
