import { BadRequestException, ConflictException } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import { LearningService } from "../src/learning/learning.service.js";

describe("LearningService", () => {
  it("chặn mã khóa học trùng và phát hành khóa học hợp lệ", () => {
    const service = new LearningService();
    expect(() => service.createCourse({ code: "WEB-FULLSTACK", name: "Trùng mã", description: "Mô tả đủ độ dài cho khóa học", outcomes: ["Kết quả"] })).toThrow(ConflictException);
    const created = service.createCourse({ code: "NEW-COURSE", name: "Khóa học mới", description: "Mô tả đủ độ dài cho khóa học", outcomes: ["Hoàn thành mục tiêu"] });
    expect(service.publishCourse(created.id).status).toBe("PUBLISHED");
  });

  it("lưu đáp án, nộp một lần và chấm tự động", () => {
    const service = new LearningService();
    const attempt = service.startAttempt("exam-mid-web");
    service.saveAnswer(attempt.id, "q-rest-01", ["PATCH"]);
    service.saveAnswer(attempt.id, "q-db-01", ["Đúng"]);
    const result = service.submitAttempt(attempt.id);
    expect(result.score).toBe(10);
    expect(() => service.submitAttempt(attempt.id)).toThrow(ConflictException);
  });

  it("chặn lịch buổi học trùng", () => {
    const service = new LearningService();
    expect(() => service.createSession("class-web-01", { title: "Trùng lịch", startsAt: "2026-08-26T02:30:00.000Z", endsAt: "2026-08-26T04:00:00.000Z", provider: "JITSI" })).toThrow(ConflictException);
  });

  it("yêu cầu lý do khi điều chỉnh điểm danh", () => {
    const service = new LearningService();
    expect(() => service.updateAttendance("missing", "usr-learner", "PRESENT", 30, "Có minh chứng")).toThrow();
    expect(BadRequestException).toBeDefined();
  });
});

