import { BadRequestException, ConflictException } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import { LearningService } from "../src/learning/learning.service.js";

describe("LearningService", () => {
  it("chặn mã khóa học trùng và phát hành khóa học hợp lệ", async () => {
    const service = new LearningService();
    await expect(service.createCourse({ code: "WEB-FULLSTACK", name: "Trùng mã", description: "Mô tả đủ độ dài cho khóa học", outcomes: ["Kết quả"] })).rejects.toThrow(ConflictException);
    const created = await service.createCourse({ code: "NEW-COURSE", name: "Khóa học mới", description: "Mô tả đủ độ dài cho khóa học", outcomes: ["Hoàn thành mục tiêu"] });
    expect((await service.publishCourse(created.id)).status).toBe("PUBLISHED");
  });

  it("lưu đáp án, nộp một lần và chấm tự động", async () => {
    const service = new LearningService();
    const attempt = await service.startAttempt("exam-mid-web");
    await service.saveAnswer(attempt.id, "q-rest-01", ["PATCH"]);
    await service.saveAnswer(attempt.id, "q-db-01", ["Đúng"]);
    const result = await service.submitAttempt(attempt.id);
    expect(result.score).toBe(10);
    await expect(service.submitAttempt(attempt.id)).rejects.toThrow(ConflictException);
  });

  it("chặn lịch buổi học trùng", () => {
    const service = new LearningService();
    expect(() => service.createSession("class-web-01", { title: "Trùng lịch", startsAt: "2026-08-26T02:30:00.000Z", endsAt: "2026-08-26T04:00:00.000Z", provider: "JITSI" })).toThrow(ConflictException);
  });

  it("chỉ gắn bản ghi sau khi buổi học kết thúc", () => {
    const service = new LearningService();
    expect(() => service.attachRecording("session-web-01", "https://recording.example/video")).toThrow(BadRequestException);
  });

  it("tổng hợp đúng điểm và điểm danh theo lớp", async () => {
    const service = new LearningService();
    const attempt = await service.startAttempt("exam-mid-web");
    await service.saveAnswer(attempt.id, "q-rest-01", ["PATCH"]);
    await service.submitAttempt(attempt.id);
    service.updateAttendance("session-web-01", "usr-learner", "PRESENT", 60, "Đối soát nhật ký");
    const report = service.getClassReports()[0] as { submittedAttempts: number; averageScore: number; attendanceRate: number };
    expect(report.submittedAttempts).toBe(1);
    expect(report.averageScore).toBe(5);
    expect(report.attendanceRate).toBe(100);
  });
});
