import { BadRequestException, ConflictException, NotFoundException } from "@nestjs/common";
import type { ConfigService } from "@nestjs/config";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { Environment } from "../src/config/environment.js";
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

  it("chặn lịch buổi học trùng", async () => {
    const service = new LearningService();
    await expect(service.createSession("class-web-01", { title: "Trùng lịch", startsAt: "2026-08-26T02:30:00.000Z", endsAt: "2026-08-26T04:00:00.000Z", provider: "JITSI" })).rejects.toThrow(ConflictException);
  });

  it("chỉ gắn bản ghi sau khi buổi học kết thúc", async () => {
    const service = new LearningService();
    await expect(service.attachRecording("session-web-01", "https://recording.example/video")).rejects.toThrow(BadRequestException);
  });

  it("tổng hợp đúng điểm và điểm danh theo lớp", async () => {
    const service = new LearningService();
    const attempt = await service.startAttempt("exam-mid-web");
    await service.saveAnswer(attempt.id, "q-rest-01", ["PATCH"]);
    await service.submitAttempt(attempt.id);
    await service.updateAttendance("session-web-01", "usr-learner", "PRESENT", 60, "Đối soát nhật ký");
    const report = (await service.getClassReports())[0] as { submittedAttempts: number; averageScore: number; attendanceRate: number };
    expect(report.submittedAttempts).toBe(1);
    expect(report.averageScore).toBe(5);
    expect(report.attendanceRate).toBe(100);
  });

  it("lưu bytes, cấp liên kết có chữ ký và kiểm tra checksum khi tải học liệu", async () => {
    const storageRoot = await mkdtemp(join(tmpdir(), "wind-material-"));
    const config = {
      get: (key: keyof Environment): string | undefined => key === "STORAGE_ROOT"
        ? storageRoot
        : key === "STORAGE_SIGNING_SECRET"
          ? "test-storage-signing-secret-at-least-32-characters"
          : undefined,
    } as unknown as ConfigService<Environment, true>;
    const service = new LearningService(undefined, config);

    try {
      const bytes = Buffer.from("%PDF-1.7\nnoi-dung-kiem-thu");
      const material = await service.createMaterial("class-web-01", {
        name: "kiem-thu.pdf",
        mimeType: "application/pdf",
        sizeBytes: bytes.length,
        folder: "Tuần kiểm thử",
        tags: ["bao-mat"],
      }, { originalName: "kiem-thu.pdf", mimeType: "application/pdf", size: bytes.length, buffer: bytes });
      await service.updateMaterial(material.id, { visibility: "PUBLISHED" });

      const access = await service.createMaterialAccess(material.id, "LEARNER");
      const signedUrl = new URL(access.url, "http://localhost");
      const expires = Number(signedUrl.searchParams.get("expires"));
      const signature = signedUrl.searchParams.get("signature") ?? "";
      const download = await service.readMaterialDownload(material.id, expires, signature, "LEARNER", "DOWNLOAD");

      expect(download.buffer.equals(bytes)).toBe(true);
      expect(download.mimeType).toBe("application/pdf");
      await expect(service.readMaterialDownload(material.id, expires, `${signature}x`, "LEARNER", "DOWNLOAD")).rejects.toThrow(BadRequestException);
      await expect(service.readMaterialDownload(material.id, expires, signature, "LEARNER", "PREVIEW")).rejects.toThrow(BadRequestException);
    } finally {
      await rm(storageRoot, { recursive: true, force: true });
    }
  });

  it("lọc và phân trang học liệu chỉ trong lớp đã ghi danh", async () => {
    const service = new LearningService();
    const firstPage = await service.searchAccessibleMaterials({ query: "pdf", mimeType: "application/pdf", page: 1, pageSize: 1 });
    expect(firstPage.items).toHaveLength(1);
    expect(firstPage.total).toBe(2);
    expect(firstPage.totalPages).toBe(2);

    const outside = await service.searchAccessibleMaterials({ classId: "class-khong-ghi-danh" });
    expect(outside.items).toHaveLength(0);
    expect(outside.total).toBe(0);
  });

  it("chặn học viên mở học liệu của lớp chưa ghi danh", async () => {
    const service = new LearningService();
    const classItem = await service.createClass({
      courseId: "course-web",
      code: "WEB-NO-ENROLLMENT",
      name: "Lớp chưa ghi danh",
      term: "2026-HK2",
      startAt: "2026-09-01T00:00:00.000Z",
      endAt: "2026-12-01T00:00:00.000Z",
      capacity: 20,
    });
    const material = await service.createMaterial(classItem.id, {
      name: "tai-lieu-ngoai-lop.pdf",
      mimeType: "application/pdf",
      sizeBytes: 100,
      folder: "Tuần 1",
      tags: ["ngoai-lop"],
    });
    await service.updateMaterial(material.id, { visibility: "PUBLISHED" });

    await expect(service.createMaterialAccess(material.id, "LEARNER")).rejects.toThrow(NotFoundException);
    await expect(service.createMaterialAccess(material.id, "LEARNER")).rejects.toThrow("Học viên không thuộc lớp");
  });

  it("không lộ câu hỏi trước khi bắt đầu và trả đúng số lượt làm đề", async () => {
    const service = new LearningService();
    const summaries = await service.listLearnerExamSummaries("class-web-01");
    expect(summaries[0]?.questionIds).toEqual([]);
    expect(summaries[0]?.questionCount).toBe(2);
    expect(summaries[0]?.remainingAttempts).toBe(2);
    await expect(service.getExamQuestions("exam-mid-web")).rejects.toThrow("lượt làm bài đang mở");

    await service.startAttempt("exam-mid-web");
    expect(await service.getExamQuestions("exam-mid-web")).toHaveLength(2);
    const active = await service.listLearnerExamSummaries("class-web-01");
    expect(active[0]?.availabilityStatus).toBe("IN_PROGRESS");
  });

  it("không nhận autosave sau khi thời lượng làm bài kết thúc", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-08-25T02:00:00.000Z"));
      const service = new LearningService();
      const attempt = await service.startAttempt("exam-mid-web");
      vi.setSystemTime(new Date("2026-08-25T02:46:00.000Z"));
      await expect(service.saveAnswer(attempt.id, "q-rest-01", ["PATCH"])).rejects.toThrow("hết thời gian");
    } finally {
      vi.useRealTimers();
    }
  });

  it("chỉ công bố kết quả của chính học viên và chặn phúc khảo trùng", async () => {
    const service = new LearningService();
    const attempt = await service.startAttempt("exam-mid-web");
    await service.saveAnswer(attempt.id, "q-rest-01", ["PATCH"]);
    await service.submitAttempt(attempt.id);

    const result = await service.getLearnerResult(attempt.id);
    expect(result.attempt.gradePublishedAt).toBeTruthy();
    expect(result.answerBreakdown).toHaveLength(2);
    expect(result.answerBreakdown[0]?.awardedScore).toBe(5);
    const request = await service.requestRegrade(attempt.id, "Đề nghị kiểm tra lại câu số hai");
    expect(request.status).toBe("OPEN");
    await expect(service.requestRegrade(attempt.id, "Đề nghị kiểm tra lại lần nữa")).rejects.toThrow(ConflictException);
    await expect(service.getLearnerResult("attempt-khong-thuoc-ve-minh")).rejects.toThrow(NotFoundException);
  });

  it("chặn HTML nguy hiểm, từ khóa cấm và spam trên diễn đàn", async () => {
    const service = new LearningService();
    await expect(service.createPost("topic-rest", "<script>alert(1)</script>")).rejects.toThrow(BadRequestException);
    await expect(service.createPost("topic-rest", "Đây là nội dung lừa đảo")).rejects.toThrow(BadRequestException);
    await service.createPost("topic-rest", "Phản hồi hợp lệ số một");
    await service.createPost("topic-rest", "Phản hồi hợp lệ số hai");
    await service.createPost("topic-rest", "Phản hồi hợp lệ số ba");
    await service.createPost("topic-rest", "Phản hồi hợp lệ số bốn");
    await expect(service.createPost("topic-rest", "Phản hồi vượt giới hạn")).rejects.toThrow("vượt giới hạn");
  });

  it("kiểm tra tệp diễn đàn, mention trong lớp và thông báo chống trùng", async () => {
    const service = new LearningService();
    const post = await service.createPost(
      "topic-rest",
      "Mời giảng viên xem giúp tài liệu này",
      "usr-learner",
      undefined,
      ["mat-web-intro"],
      ["usr-instructor", "usr-instructor"],
    );
    expect(post.attachmentIds).toEqual(["mat-web-intro"]);
    expect(post.mentionedUserIds).toEqual(["usr-instructor"]);
    const notifications = await service.listNotifications("usr-instructor");
    expect(notifications).toHaveLength(1);
    expect((await service.markNotificationRead(notifications[0]!.id, "usr-instructor")).readAt).toBeTruthy();
    await expect(service.createPost("topic-rest", "Đính kèm không hợp lệ", "usr-learner", undefined, ["mat-khong-ton-tai"])).rejects.toThrow(BadRequestException);
    await expect(service.createPost("topic-rest", "Nhắc người ngoài lớp", "usr-learner", undefined, [], ["usr-ngoai-lop"])).rejects.toThrow(BadRequestException);
  });

  it("ghi báo cáo diễn đàn theo học viên và chặn báo cáo trùng", async () => {
    const service = new LearningService();
    const report = await service.reportContent({ targetType: "TOPIC", targetId: "topic-rest", reporterId: "usr-learner", reason: "Spam", details: "Chủ đề có nội dung lặp lại" });
    expect(report.status).toBe("OPEN");
    expect(await service.listLearnerReports()).toHaveLength(1);
    await expect(service.reportContent({ targetType: "TOPIC", targetId: "topic-rest", reporterId: "usr-learner", reason: "Spam", details: "Gửi lại báo cáo đang mở" })).rejects.toThrow(ConflictException);
    await expect(service.reportContent({ targetType: "TOPIC", targetId: "topic-khong-ton-tai", reporterId: "usr-learner", reason: "Spam", details: "Không có quyền truy cập" })).rejects.toThrow(NotFoundException);
  });

  it("chỉ cho học viên vào lớp đúng cửa sổ và ghi đủ sự kiện rời phòng", async () => {
    vi.useFakeTimers();
    try {
      const service = new LearningService();
      const learnerSessions = await service.listSessions("LEARNER");
      expect(learnerSessions[0]?.hostUrl).toBe("");
      vi.setSystemTime(new Date("2026-08-26T01:30:00.000Z"));
      await expect(service.joinSession("session-web-01")).rejects.toThrow("sớm tối đa 15 phút");
      vi.setSystemTime(new Date("2026-08-26T01:50:00.000Z"));
      const joined = await service.joinSession("session-web-01");
      expect(joined.attendeeUrl).not.toContain("-host");
      vi.setSystemTime(new Date("2026-08-26T02:10:00.000Z"));
      const attendance = await service.leaveSession("session-web-01");
      expect(attendance.attendedMinutes).toBe(20);
      expect(attendance.leftAt).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it("tính SLA, lưu trao đổi và không đóng ticket thiếu kết quả", async () => {
    const service = new LearningService();
    const ticket = await service.createTicket({ category: "TECHNICAL", severity: "P0", description: "Không thể truy cập lớp học trực tuyến" });
    expect(new Date(ticket.dueAt).getTime() - new Date(ticket.createdAt).getTime()).toBeLessThanOrEqual(4 * 3_600_000 + 1_000);
    await service.addTicketComment(ticket.id, "Em vẫn gặp lỗi khi thử lại", "LEARNER");
    await service.addTicketComment(ticket.id, "Đội hỗ trợ đang kiểm tra nhật ký", "SYSTEM_ADMIN");
    expect(await service.listTicketComments(ticket.id, "LEARNER")).toHaveLength(2);
    expect((await service.listTickets("SYSTEM_ADMIN"))[0]?.status).toBe("IN_PROGRESS");
    await expect(service.updateTicket(ticket.id, { status: "RESOLVED" })).rejects.toThrow(BadRequestException);
  });

  it("cấp bản ghi có chữ ký và quản lý appeal điểm danh", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-08-26T02:00:00.000Z"));
      const service = new LearningService();
      await service.joinSession("session-web-01");
      await service.leaveSession("session-web-01");
      await service.transitionSession("session-web-01", "LIVE");
      await service.transitionSession("session-web-01", "COMPLETED");
      await service.attachRecording("session-web-01", "https://recording.example/session-web-01");
      const summary = await service.getSessionSummary("session-web-01") as { recordingAvailable: boolean; session: { recordingUrl?: string } };
      expect(summary.recordingAvailable).toBe(true);
      expect(summary.session.recordingUrl).toBeUndefined();
      const access = await service.createRecordingAccess("session-web-01");
      const url = new URL(access.url, "http://localhost");
      const expires = Number(url.searchParams.get("expires"));
      const signature = url.searchParams.get("signature") ?? "";
      expect((await service.resolveRecordingAccess("session-web-01", expires, signature)).recordingUrl).toContain("recording.example");
      await expect(service.resolveRecordingAccess("session-web-01", expires, `${signature}x`)).rejects.toThrow(BadRequestException);
      expect((await service.requestAttendanceAppeal("session-web-01", "Thời lượng tham gia chưa được ghi nhận đúng")).status).toBe("OPEN");
      await expect(service.requestAttendanceAppeal("session-web-01", "Đề nghị kiểm tra lại một lần nữa")).rejects.toThrow(ConflictException);
    } finally {
      vi.useRealTimers();
    }
  });
});
