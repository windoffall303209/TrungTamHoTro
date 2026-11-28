import { BadRequestException, NotFoundException } from "@nestjs/common";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LearningService } from "../../src/domains/learning/core/learning.service.js";

describe("Toàn vẹn lượt làm bài: hậu kiểm ghi danh, biên nhận HMAC và kiểm tra điểm", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-01T00:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("chặn lưu và nộp bài sau khi học viên bị rút khỏi lớp, nhưng tiến trình hệ thống vẫn chốt được lượt", async () => {
    const service = new LearningService();
    await service.enrollLearner("class-web-01", "learner-suspended", "usr-manager");
    const attempt = await service.startAttempt("exam-mid-web", "learner-suspended");
    await service.saveAnswer(attempt.id, "q-rest-01", ["PATCH"], "learner-suspended");
    await service.removeEnrollment("class-web-01", "learner-suspended", "Đình chỉ học tập theo quyết định", "usr-manager");

    await expect(service.saveAnswer(attempt.id, "q-db-01", ["A"], "learner-suspended")).rejects.toThrow(NotFoundException);
    await expect(service.submitAttempt(attempt.id, "learner-suspended")).rejects.toThrow(NotFoundException);
    expect((await service.submitAttempt(attempt.id, "learner-suspended", "SYSTEM")).status).not.toBe("IN_PROGRESS");
  });

  it("phát biên nhận HMAC không tự tính lại được từ các trường công khai và ổn định khi đọc lại", async () => {
    const service = new LearningService();
    const attempt = await service.startAttempt("exam-mid-web", "usr-learner");
    const submitted = await service.submitAttempt(attempt.id, "usr-learner");
    expect(submitted.submissionReceipt).toMatch(/^SUB-[A-F0-9]{20}$/);
    expect((await service.submitAttempt(attempt.id, "usr-learner")).submissionReceipt).toBe(submitted.submissionReceipt);
    // Một service khác (khóa bí mật khác) không thể sinh cùng biên nhận cho cùng dữ liệu.
    const other = new LearningService();
    const otherAttempt = await other.startAttempt("exam-mid-web", "usr-learner");
    const otherSubmitted = await other.submitAttempt(otherAttempt.id, "usr-learner");
    expect(otherSubmitted.submissionReceipt).not.toBe(submitted.submissionReceipt);
  });

  it("từ chối điểm âm, không hữu hạn và chấm lượt đang làm dở", async () => {
    const service = new LearningService();
    const attempt = await service.startAttempt("exam-mid-web", "usr-learner");
    await expect(service.gradeAttempt(attempt.id, 5, "Chấm khi chưa nộp", undefined, "usr-instructor")).rejects.toThrow("Chỉ chấm được lượt làm bài đã nộp.");
    await service.submitAttempt(attempt.id, "usr-learner");
    await expect(service.gradeAttempt(attempt.id, -1, "Điểm âm", "Thử điểm âm", "usr-instructor")).rejects.toThrow(BadRequestException);
    await expect(service.gradeAttempt(attempt.id, Number.NaN, "Điểm lỗi", "Thử điểm NaN", "usr-instructor")).rejects.toThrow(BadRequestException);
    await expect(service.gradeAttempt(attempt.id, 0, "Điểm câu âm", "Thử điểm câu âm", "usr-instructor", [{ questionId: "q-rest-01", score: -2 }])).rejects.toThrow(BadRequestException);
  });
});
