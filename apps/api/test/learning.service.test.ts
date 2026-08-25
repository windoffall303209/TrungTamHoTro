import { BadRequestException, ConflictException, NotFoundException } from "@nestjs/common";
import type { ConfigService } from "@nestjs/config";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { Environment } from "../src/config/environment.js";
import { LearningService } from "../src/learning/learning.service.js";

describe("LearningService", () => {
  it("phiên bản hóa khóa học mà không làm đổi snapshot của lớp cũ", async () => {
    const service = new LearningService();
    await expect(service.createCourse({ code: "WEB-FULLSTACK", name: "Trùng mã", description: "Mô tả đủ độ dài cho khóa học", outcomes: ["Kết quả"] })).rejects.toThrow(ConflictException);
    const created = await service.createCourse({ code: "NEW-COURSE", name: "Khóa học mới", description: "Mô tả đủ độ dài cho khóa học", outcomes: ["Hoàn thành mục tiêu"] });
    const publishedV1 = await service.publishCourse(created.id);
    expect(publishedV1).toMatchObject({ status: "PUBLISHED", version: 1 });
    const classV1 = await service.createClass({ courseId: created.id, code: "NEW-K01", name: "Lớp dùng bản một", term: "2026-HK1", startAt: "2026-09-01T00:00:00.000Z", endAt: "2026-12-01T00:00:00.000Z", capacity: 20 });
    expect(classV1.courseVersion).toBe(1);

    expect((await service.updateCourse(created.id, { name: "Khóa học mới cập nhật", description: "Mô tả phiên bản thứ hai đủ độ dài", outcomes: ["Mục tiêu phiên bản hai"] })).status).toBe("DRAFT");
    expect((await service.publishCourse(created.id)).version).toBe(2);
    expect((await service.listCourseVersions(created.id)).map((item) => item.version)).toEqual([2, 1]);
    expect((await service.listClasses("CENTER_MANAGER")).find((item) => item.id === classV1.id)?.courseVersion).toBe(1);
    expect((await service.archiveCourse(created.id, "Ngừng tuyển sinh khóa học này")).status).toBe("ARCHIVED");
    await expect(service.createClass({ courseId: created.id, code: "NEW-K02", name: "Không được mở", term: "2026-HK2", startAt: "2027-01-01T00:00:00.000Z", endAt: "2027-03-01T00:00:00.000Z", capacity: 20 })).rejects.toThrow(BadRequestException);
  });

  it("cấu hình lớp theo học kỳ, múi giờ, sức chứa và điều kiện kích hoạt", async () => {
    const service = new LearningService();
    const first = await service.createClass({ courseId: "course-web", code: "SHARED", name: "Lớp học kỳ một", term: "2027-HK1", startAt: "2027-01-10T00:00:00.000Z", endAt: "2027-04-10T00:00:00.000Z", capacity: 30, timezone: "Asia/Bangkok", allowLateEnrollment: true });
    expect(first).toMatchObject({ courseVersion: 1, timezone: "Asia/Bangkok", allowLateEnrollment: true, status: "DRAFT" });
    await expect(service.createClass({ courseId: "course-web", code: "shared", name: "Trùng học kỳ", term: "2027-HK1", startAt: "2027-01-10T00:00:00.000Z", endAt: "2027-04-10T00:00:00.000Z", capacity: 30 })).rejects.toThrow(ConflictException);
    expect((await service.createClass({ courseId: "course-web", code: "SHARED", name: "Khác học kỳ", term: "2027-HK2", startAt: "2027-05-10T00:00:00.000Z", endAt: "2027-08-10T00:00:00.000Z", capacity: 30 })).term).toBe("2027-HK2");
    await expect(service.createClass({ courseId: "course-web", code: "BAD-TZ", name: "Sai múi giờ", term: "2027-HK1", startAt: "2027-01-10T00:00:00.000Z", endAt: "2027-04-10T00:00:00.000Z", capacity: 30, timezone: "Mars/Olympus" })).rejects.toThrow(BadRequestException);
    await expect(service.activateClass(first.id)).rejects.toThrow(BadRequestException);
    await service.assignInstructor(first.id, "usr-instructor");
    expect((await service.activateClass(first.id)).status).toBe("ACTIVE");
    expect((await service.activateClass(first.id)).status).toBe("ACTIVE");
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

  it("chặn đóng lớp thiếu điều kiện, lưu trữ chỉ đọc và mở lại có lý do", async () => {
    const service = new LearningService();
    const blocked = await service.getClassClosureReadiness("class-web-01");
    expect(blocked.eligible).toBe(false);
    expect(blocked.blockers.length).toBeGreaterThan(0);

    const classItem = await service.createClass({ courseId: "course-web", code: "ARCHIVE-01", name: "Lớp đủ điều kiện lưu trữ", term: "2025", startAt: "2025-01-01T00:00:00.000Z", endAt: "2025-02-01T00:00:00.000Z", capacity: 20 });
    await service.assignInstructor(classItem.id, "usr-instructor");
    await service.activateClass(classItem.id);
    expect((await service.getClassClosureReadiness(classItem.id)).eligible).toBe(true);
    const closed = await service.closeClass(classItem.id, "Đã hoàn tất toàn bộ hoạt động lớp", "STANDARD_RETENTION");
    expect(closed).toMatchObject({ status: "CLOSED", archivePolicy: "STANDARD_RETENTION" });
    expect(closed.archivedAt).toBeTruthy();
    await expect(service.createMaterial(classItem.id, { name: "read-only.pdf", mimeType: "application/pdf", sizeBytes: 100, folder: "Lưu trữ", tags: [] })).rejects.toThrow("chỉ cho phép đọc");
    expect((await service.reopenClass(classItem.id, "Mở bổ sung một buổi học")).status).toBe("ACTIVE");
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
    await service.transitionSession("session-web-01", "LIVE");
    await service.transitionSession("session-web-01", "COMPLETED");
    await service.updateAttendance("session-web-01", "usr-learner", "PRESENT", 60, "Đối soát nhật ký");
    const report = (await service.getClassReports())[0] as { submittedAttempts: number; averageScore: number; attendanceRate: number };
    expect(report.submittedAttempts).toBe(1);
    expect(report.averageScore).toBe(5);
    expect(report.attendanceRate).toBe(100);
  });

  it("giải thích cờ rủi ro và theo dõi hành động hỗ trợ học viên", async () => {
    const service = new LearningService();
    const progress = await service.getClassProgress("class-web-01", { from: "2026-01-01T00:00:00.000Z", to: "2026-12-31T23:59:59.000Z", attendanceBelow: 70, scoreBelow: 50, completionBelow: 60 });
    expect(progress.thresholds).toEqual({ attendanceBelow: 70, scoreBelow: 50, completionBelow: 60 });
    expect(progress.learners[0]).toMatchObject({ learnerId: "usr-learner", riskLevel: "HIGH" });
    expect(progress.learners[0]?.riskReasons).toHaveLength(3);
    await expect(service.getClassProgress("class-web-01", { attendanceBelow: 0 })).rejects.toThrow(BadRequestException);

    const intervention = await service.createProgressIntervention("class-web-01", { learnerId: "usr-learner", title: "Hẹn tư vấn học tập", notes: "Rà soát tiến độ và lập kế hoạch bù", dueAt: "2027-01-10T10:00:00.000Z" });
    expect(intervention.status).toBe("OPEN");
    expect((await service.getClassProgress("class-web-01", {})).learners[0]?.interventions).toHaveLength(1);
    expect((await service.updateProgressIntervention(intervention.id, "DONE")).status).toBe("DONE");
    await expect(service.updateProgressIntervention(intervention.id, "CANCELLED")).rejects.toThrow(ConflictException);
    await expect(service.createProgressIntervention("class-web-01", { learnerId: "usr-outside", title: "Sai lớp", dueAt: "2027-01-10T10:00:00.000Z" })).rejects.toThrow(NotFoundException);
  });

  it("lưu lần chạy, tạo lịch sử export CSV và kiểm soát hạn tải", async () => {
    const storageRoot = await mkdtemp(join(tmpdir(), "wind-report-"));
    try {
      const config = { get: (key: keyof Environment): string | undefined => key === "STORAGE_ROOT" ? storageRoot : undefined } as unknown as ConfigService<Environment, true>;
      const service = new LearningService(undefined, config);
      const run = await service.runOperationalReport("2026-01-01T00:00:00.000Z", "2026-12-31T23:59:59.000Z");
      expect(run.result.definitionVersion).toBe("1.0.0");
      expect(run.result.metricDefinitions.classes).toContain("kỳ báo cáo");
      const created = await service.createReportExport(run.id, "CSV");
      expect(created).toMatchObject({ status: "COMPLETED", format: "CSV" });
      expect(await service.listReportExports()).toHaveLength(1);
      const download = await service.downloadReportExport(created.id);
      expect(download.fileName).toMatch(/bao-cao-van-hanh.*\.csv$/);
      expect(download.buffer.toString("utf8")).toContain("Phiên bản định nghĩa");
      await expect(service.runOperationalReport("2026-12-31T00:00:00.000Z", "2026-01-01T00:00:00.000Z")).rejects.toThrow(BadRequestException);
      await expect(service.createReportExport("run-khong-ton-tai", "CSV")).rejects.toThrow(NotFoundException);
    } finally {
      await rm(storageRoot, { recursive: true, force: true });
    }
  });

  it("đồng bộ, đối chiếu, xử lý điều chỉnh và khóa kỳ điểm danh", async () => {
    const service = new LearningService();
    await service.transitionSession("session-web-01", "LIVE");
    await service.transitionSession("session-web-01", "COMPLETED");
    await expect(service.syncAttendance("session-web-01", [
      { providerParticipantId: "provider-01", learnerId: "usr-learner", joinedAt: "2026-08-26T02:12:00.000Z", leftAt: "2026-08-26T03:20:00.000Z" },
      { providerParticipantId: "provider-01", learnerId: "usr-outsider", joinedAt: "2026-08-26T02:10:00.000Z", leftAt: "2026-08-26T03:00:00.000Z" },
    ])).rejects.toThrow("Trùng mã người tham dự");

    const synced = await service.syncAttendance("session-web-01", [
      { providerParticipantId: "provider-01", learnerId: "usr-learner", joinedAt: "2026-08-26T02:12:00.000Z", leftAt: "2026-08-26T03:20:00.000Z" },
      { providerParticipantId: "provider-outside", learnerId: "usr-outsider", joinedAt: "2026-08-26T02:10:00.000Z", leftAt: "2026-08-26T03:00:00.000Z" },
    ]);
    expect(synced.skippedLearnerIds).toEqual(["usr-outsider"]);
    expect(synced.review.records).toMatchObject([{ learnerId: "usr-learner", status: "LATE", attendedMinutes: 68, providerParticipantId: "provider-01" }]);

    const appeal = await service.requestAttendanceAppeal("session-web-01", "Hệ thống ghi thiếu thời gian em tham dự");
    const resolved = await service.resolveAttendanceAppeal(appeal.id, "APPROVE", "Đã đối chiếu bản ghi nhà cung cấp", "PRESENT", 80);
    expect(resolved.status).toBe("RESOLVED");
    expect((await service.getAttendanceReview("session-web-01")).records[0]).toMatchObject({ status: "PRESENT", attendedMinutes: 80 });
    expect((await service.lockAttendance("session-web-01")).attendanceLockedAt).toBeTruthy();
    await expect(service.updateAttendance("session-web-01", "usr-learner", "ABSENT", 0, "Sửa sau khóa")).rejects.toThrow("đã khóa");
    await expect(service.syncAttendance("session-web-01", [
      { providerParticipantId: "provider-02", learnerId: "usr-learner", joinedAt: "2026-08-26T02:00:00.000Z", leftAt: "2026-08-26T03:00:00.000Z" },
    ])).rejects.toThrow("đã khóa");
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

  it("cách ly tệp có chữ ký nguy hiểm và cảnh báo đúng chủ tệp", async () => {
    const storageRoot = await mkdtemp(join(tmpdir(), "wind-quarantine-"));
    const config = { get: (key: keyof Environment): string | undefined => key === "STORAGE_ROOT" ? storageRoot : undefined } as unknown as ConfigService<Environment, true>;
    const service = new LearningService(undefined, config);
    try {
      const bytes = Buffer.from("X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*");
      const material = await service.createMaterial("class-web-01", { name: "anh-bang-chung.png", mimeType: "image/png", sizeBytes: bytes.length, folder: "Tuần 1", tags: ["kiem-tra"] }, { originalName: "anh-bang-chung.png", mimeType: "image/png", size: bytes.length, buffer: bytes });
      expect(material.visibility).toBe("HIDDEN");
      expect(material.quarantineReason).toContain("EICAR");
      await expect(service.createMaterialAccess(material.id, "INSTRUCTOR")).rejects.toThrow("cách ly");
      await expect(service.updateMaterial(material.id, { visibility: "PUBLISHED" })).rejects.toThrow("cách ly");
      expect((await service.listNotifications("usr-instructor")).some((item) => item.type === "MATERIAL_QUARANTINED")).toBe(true);
    } finally {
      await rm(storageRoot, { recursive: true, force: true });
    }
  });

  it("lưu lịch sử kiểm duyệt học liệu, bắt buộc lý do và thông báo người đăng", async () => {
    const service = new LearningService();
    const material = await service.createMaterial("class-web-01", { name: "slide-review.pdf", mimeType: "application/pdf", sizeBytes: 2048, folder: "Tuần 3", tags: ["review"] });
    await expect(service.reviewClassMaterial(material.id, "HIDE", "")).rejects.toThrow("lý do");
    expect((await service.reviewClassMaterial(material.id, "APPROVE")).visibility).toBe("PUBLISHED");
    expect((await service.reviewClassMaterial(material.id, "REQUEST_CHANGES", "Cần bổ sung nguồn trích dẫn")).visibility).toBe("DRAFT");
    const reviews = await service.listMaterialReviews(material.id);
    expect(reviews.map((item) => item.action)).toEqual(["REQUEST_CHANGES", "APPROVE"]);
    expect((await service.listNotifications("usr-instructor")).filter((item) => item.type === "MATERIAL_REVIEWED")).toHaveLength(2);
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

  it("tách gửi duyệt và phê duyệt đề theo phiên bản có lịch sử", async () => {
    const service = new LearningService();
    const exam = await service.createExam({ classId: "class-web-01", title: "Đề cần phê duyệt", questionIds: ["q-rest-01"], durationMinutes: 30, totalScore: 10, openAt: "2026-09-01T00:00:00.000Z", closeAt: "2026-12-01T00:00:00.000Z", attemptLimit: 1 });
    expect((await service.submitExamForReview(exam.id)).status).toBe("PENDING_REVIEW");
    await expect(service.reviewExam(exam.id, "RETURN", "")).rejects.toThrow("lý do");
    expect((await service.reviewExam(exam.id, "RETURN", "Cần cân đối lại độ khó")).status).toBe("DRAFT");
    await service.submitExamForReview(exam.id);
    expect((await service.reviewExam(exam.id, "APPROVE")).status).toBe("PUBLISHED");
    const history = await service.listExamApprovals(exam.id);
    expect(history.map((item) => item.decision)).toEqual(["APPROVE", "RETURN"]);
    expect(history.every((item) => item.examVersion === exam.version)).toBe(true);
    expect((await service.listNotifications("usr-instructor")).filter((item) => item.type === "EXAM_REVIEWED")).toHaveLength(2);
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

  it("điều phối báo cáo diễn đàn đủ ngữ cảnh, audit hành động và kháng nghị", async () => {
    const service = new LearningService();
    const report = await service.reportContent({ targetType: "TOPIC", targetId: "topic-rest", reporterId: "usr-learner", reason: "Spam", details: "Chủ đề có nội dung lặp lại" });
    expect(report.status).toBe("OPEN");
    expect(await service.listLearnerReports()).toHaveLength(1);
    await expect(service.reportContent({ targetType: "TOPIC", targetId: "topic-rest", reporterId: "usr-learner", reason: "Spam", details: "Gửi lại báo cáo đang mở" })).rejects.toThrow(ConflictException);
    await expect(service.reportContent({ targetType: "TOPIC", targetId: "topic-khong-ton-tai", reporterId: "usr-learner", reason: "Spam", details: "Không có quyền truy cập" })).rejects.toThrow(NotFoundException);

    const context = await service.getReportContext(report.id);
    expect(context.topicTitle).toContain("REST");
    expect(context.targetBody).toContain("Chia sẻ");
    expect(context.surroundingPosts).toHaveLength(1);

    const claimed = await service.claimReport(report.id);
    expect(claimed.status).toBe("IN_REVIEW");
    expect(claimed.assignedToId).toBe("usr-manager");
    expect(claimed.actions.map((item) => item.action)).toEqual(["CLAIM"]);

    const resolved = await service.resolveReport(report.id, "HIDE_CONTENT", "Nội dung vi phạm quy định chống spam.");
    expect(resolved.status).toBe("RESOLVED");
    expect(resolved.resolvedAt).toBeTruthy();
    expect(resolved.actions.map((item) => item.action)).toEqual(["CLAIM", "HIDE_CONTENT"]);
    expect(await service.listTopics("LEARNER")).toHaveLength(0);
    expect((await service.listNotifications("usr-learner"))[0]?.entityId).toBe(report.id);

    const appealed = await service.appealReport(report.id, "Em đề nghị xem lại vì nội dung có ngữ cảnh học tập.");
    expect(appealed.status).toBe("IN_REVIEW");
    expect(appealed.appealReason).toContain("xem lại");
    await expect(service.appealReport(report.id, "Em muốn gửi kháng nghị lần thứ hai.")).rejects.toThrow(ConflictException);
    const rejected = await service.resolveReport(report.id, "KEEP_CONTENT", "Giữ nguyên quyết định sau khi xem lại ngữ cảnh.");
    expect(rejected.status).toBe("REJECTED");
    expect(await service.listTopics("LEARNER")).toHaveLength(1);
    await expect(service.resolveReport(report.id, "HIDE_CONTENT", "Xử lý lại lần nữa.")).rejects.toThrow(ConflictException);
  });

  it("chuyển cấp báo cáo nghiêm trọng mà không tự động ẩn nội dung", async () => {
    const service = new LearningService();
    const report = await service.reportContent({ targetType: "POST", targetId: "post-rest-01", reporterId: "usr-learner", reason: "Quấy rối", details: "Cần quản trị hệ thống rà soát thêm" });
    const escalated = await service.resolveReport(report.id, "ESCALATE_ADMIN", "Có dấu hiệu vi phạm nghiêm trọng cần quản trị xử lý.");
    expect(escalated.status).toBe("ESCALATED");
    expect(escalated.escalationLevel).toBe(1);
    expect((await service.listPosts("topic-rest", "LEARNER"))[0]?.status).toBe("VISIBLE");
    expect((await service.listNotifications("usr-admin"))[0]?.entityId).toBe(report.id);
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

  it("chặn bí mật và lưu bằng chứng hỗ trợ có checksum", async () => {
    const storageRoot = await mkdtemp(join(tmpdir(), "wind-support-"));
    const config = { get: (key: keyof Environment): string | undefined => key === "STORAGE_ROOT" ? storageRoot : undefined } as unknown as ConfigService<Environment, true>;
    const service = new LearningService(undefined, config);
    try {
      await expect(service.createTicket({ category: "ACCOUNT", severity: "P1", description: "Không đăng nhập được, password=MatKhauBiMat123" })).rejects.toThrow("dữ liệu nhạy cảm");
      const ticket = await service.createTicket({ category: "TECHNICAL", severity: "P2", contextId: "class-web-01", description: "Màn hình lớp học hiển thị lỗi khi mở" });
      const bytes = Buffer.from("Anh chup va mo ta loi khong chua du lieu bi mat");
      const attachment = await service.addSupportAttachment(ticket.id, { originalName: "bang-chung.txt", mimeType: "text/plain", size: bytes.length, buffer: bytes }, "LEARNER");
      expect(attachment.checksum).toMatch(/^sha256:/);
      expect((await service.listTickets("LEARNER"))[0]?.attachments).toHaveLength(1);
      await expect(service.addSupportAttachment(ticket.id, { originalName: "malware.exe", mimeType: "application/octet-stream", size: 3, buffer: Buffer.from("abc") }, "LEARNER")).rejects.toThrow(BadRequestException);
    } finally {
      await rm(storageRoot, { recursive: true, force: true });
    }
  });

  it("cảnh báo P0 ngay và liên kết ticket trùng trong 24 giờ", async () => {
    const service = new LearningService();
    const first = await service.createTicket({ category: "LIVE_CLASS", severity: "P0", contextId: "session-web-01", description: "Toàn bộ học viên không thể vào phòng học" });
    const duplicate = await service.createTicket({ category: "LIVE_CLASS", severity: "P0", contextId: "session-web-01", description: "Sự cố vẫn tiếp tục xảy ra với cả lớp" });
    expect(duplicate.duplicateOfId).toBe(first.id);
    const alerts = await service.listRoleNotifications("SYSTEM_ADMIN");
    expect(alerts).toHaveLength(2);
    expect(alerts.every((item) => item.type === "SUPPORT_P0")).toBe(true);
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
