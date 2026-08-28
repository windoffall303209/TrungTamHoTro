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
    const saved = await service.saveAnswer(attempt.id, "q-rest-01", ["PATCH"]);
    expect(saved.lastSavedAt).toBeTruthy();
    expect(saved.serverTime).toBeTruthy();
    await service.saveAnswer(attempt.id, "q-db-01", ["Đúng"]);
    const result = await service.submitAttempt(attempt.id);
    expect(result.score).toBe(10);
    expect(result.submissionReceipt).toMatch(/^SUB-[A-F0-9]{16}$/);
    await expect(service.submitAttempt(attempt.id)).rejects.toThrow(ConflictException);
  });

  it("cô lập lượt làm bài theo đúng tài khoản học viên", async () => {
    const service = new LearningService();
    await service.enrollLearner("class-web-01", "learner-second");
    const attempt = await service.startAttempt("exam-mid-web", "learner-second");

    await expect(service.getExamQuestions("exam-mid-web", "usr-learner")).rejects.toThrow(NotFoundException);
    await expect(service.saveAnswer(attempt.id, "q-rest-01", ["PATCH"], "usr-learner")).rejects.toThrow(NotFoundException);
    await expect(service.submitAttempt(attempt.id, "usr-learner")).rejects.toThrow(NotFoundException);

    expect(await service.getExamQuestions("exam-mid-web", "learner-second")).toHaveLength(2);
    await service.saveAnswer(attempt.id, "q-rest-01", ["PATCH"], "learner-second");
    expect((await service.submitAttempt(attempt.id, "learner-second")).learnerId).toBe("learner-second");
    expect(await service.listLearnerResults("usr-learner")).toHaveLength(0);
    expect(await service.listLearnerResults("learner-second")).toHaveLength(1);
  });

  it("cô lập chủ đề, phản hồi và báo cáo diễn đàn theo thành viên thật", async () => {
    const service = new LearningService();
    await service.enrollLearner("class-web-01", "learner-forum");
    const topic = await service.createTopic("class-web-01", {
      title: "Chủ đề của học viên thứ hai",
      body: "Trao đổi cách tổ chức API cho bài tập nhóm.",
      tags: ["api"],
      isPinned: false,
    }, "learner-forum", "LEARNER");

    expect((await service.listTopics("LEARNER", "learner-forum")).some((item) => item.id === topic.id)).toBe(true);
    expect(await service.listTopics("LEARNER", "learner-outside")).toHaveLength(0);
    await expect(service.listPosts(topic.id, "LEARNER", "learner-outside")).rejects.toThrow(NotFoundException);

    const post = await service.createPost(topic.id, "Em bổ sung một phương án triển khai hợp lệ.", "learner-forum");
    await expect(service.updatePost(post.id, "Sửa bài của tài khoản khác.", "usr-learner")).rejects.toThrow(NotFoundException);
    await expect(service.deletePost(post.id, "usr-learner")).rejects.toThrow(NotFoundException);
    expect((await service.updatePost(post.id, "Em cập nhật phương án triển khai chi tiết hơn.", "learner-forum")).authorId).toBe("learner-forum");

    const report = await service.reportContent({ targetType: "TOPIC", targetId: topic.id, reporterId: "learner-forum", reason: "OTHER", details: "Nội dung cần được quản lý xem lại." });
    expect((await service.listLearnerReports("learner-forum"))[0]?.id).toBe(report.id);
    expect(await service.listLearnerReports("usr-learner")).toHaveLength(0);
  });

  it("chặn lịch buổi học trùng", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-08-25T00:00:00.000Z"));
      const service = new LearningService();
      await expect(service.createSession("class-web-01", { title: "Trùng lịch", startsAt: "2026-08-26T02:30:00.000Z", endsAt: "2026-08-26T04:00:00.000Z", provider: "JITSI" })).rejects.toThrow(ConflictException);
    } finally {
      vi.useRealTimers();
    }
  });

  it("quản trị vai trò giảng viên, thay thế và lưu lịch sử", async () => {
    const service = new LearningService();
    const classItem = await service.createClass({ courseId: "course-web", code: "TEAM-01", name: "Lớp kiểm thử phân công", term: "2027", startAt: "2027-02-01T00:00:00.000Z", endAt: "2027-04-01T00:00:00.000Z", capacity: 20 });
    await service.assignInstructor(classItem.id, "usr-instructor", "PRIMARY");
    await service.assignInstructor(classItem.id, "usr-co-instructor", "CO_INSTRUCTOR");
    await expect(service.removeInstructor(classItem.id, "usr-instructor", "Điều chuyển công tác")).rejects.toThrow(ConflictException);
    await service.assignInstructor(classItem.id, "usr-co-instructor", "PRIMARY");
    await service.removeInstructor(classItem.id, "usr-instructor", "Bàn giao cho người thay thế");
    const roster = await service.getClassRoster(classItem.id);
    expect(roster.instructors).toEqual([expect.objectContaining({ instructorId: "usr-co-instructor", role: "PRIMARY" })]);
    expect(roster.history.some((item) => item.action === "REMOVED" && item.reason)).toBe(true);
  });

  it("nhập ghi danh theo dòng, báo kết quả và gỡ nhưng giữ lịch sử", async () => {
    const service = new LearningService();
    const classItem = await service.createClass({ courseId: "course-web", code: "ENROLL-01", name: "Lớp kiểm thử ghi danh", term: "2027", startAt: "2027-05-01T00:00:00.000Z", endAt: "2027-06-01T00:00:00.000Z", capacity: 2 });
    const results = await service.importEnrollments(classItem.id, ["learner-a", "learner-a", "learner-b", "learner-c"]);
    expect(results.map((item) => item.status)).toEqual(["ENROLLED", "SKIPPED", "ENROLLED", "FAILED"]);
    await service.removeEnrollment(classItem.id, "learner-a", "Học viên chuyển sang lớp khác");
    const roster = await service.getClassRoster(classItem.id);
    expect(roster.enrollments.map((item) => item.learnerId)).toEqual(["learner-b"]);
    expect(roster.history.some((item) => item.memberId === "learner-a" && item.action === "REMOVED")).toBe(true);
  });

  it("lọc danh sách lớp theo đúng tài khoản học viên và giảng viên", async () => {
    const service = new LearningService();
    const classItem = await service.createClass({ courseId: "course-web", code: "IDENTITY-CLASS", name: "Lớp kiểm thử danh tính", term: "2027-HK3", startAt: "2027-09-01T00:00:00.000Z", endAt: "2027-11-01T00:00:00.000Z", capacity: 20 }, "manager-real");
    await service.assignInstructor(classItem.id, "instructor-real", "PRIMARY", "manager-real");
    await service.enrollLearner(classItem.id, "learner-real", "manager-real");

    expect((await service.listClasses("INSTRUCTOR", "instructor-real")).map((item) => item.id)).toContain(classItem.id);
    expect((await service.listClasses("INSTRUCTOR", "instructor-outside")).map((item) => item.id)).not.toContain(classItem.id);
    expect((await service.listClasses("LEARNER", "learner-real")).map((item) => item.id)).toContain(classItem.id);
    expect((await service.listClasses("LEARNER", "learner-outside")).map((item) => item.id)).not.toContain(classItem.id);
    expect((await service.getClassRoster(classItem.id)).history.every((item) => item.actorId === "manager-real")).toBe(true);
  });

  it("quản lý đổi và hủy lịch có lý do, chặn thao tác quá khứ", async () => {
    const service = new LearningService();
    const classItem = await service.createClass({ courseId: "course-web", code: "LIVE-OPS", name: "Lớp kiểm thử lịch", term: "2027", startAt: "2027-07-01T00:00:00.000Z", endAt: "2027-09-01T00:00:00.000Z", capacity: 20, timezone: "Asia/Bangkok" });
    await service.assignInstructor(classItem.id, "host-live", "PRIMARY");
    const created = await service.createSession(classItem.id, { title: "Buổi một", startsAt: "2027-07-10T02:00:00.000Z", endsAt: "2027-07-10T03:00:00.000Z", provider: "GOOGLE_MEET" }, "usr-manager", "CENTER_MANAGER");
    expect(created).toMatchObject({ timezone: "Asia/Bangkok", status: "SCHEDULED" });
    const updated = await service.updateSession(created.id, { title: "Buổi một đổi lịch", startsAt: "2027-07-11T02:00:00.000Z", endsAt: "2027-07-11T03:00:00.000Z", provider: "ZOOM", reason: "Điều chỉnh theo lịch giảng viên" });
    expect(updated).toMatchObject({ provider: "ZOOM", changeReason: "Điều chỉnh theo lịch giảng viên" });
    expect((await service.cancelSession(created.id, "Nghỉ theo lịch của trung tâm")).status).toBe("CANCELLED");
    await expect(service.createSession(classItem.id, { title: "Quá khứ", startsAt: "2020-01-01T00:00:00.000Z", endsAt: "2020-01-01T01:00:00.000Z", provider: "JITSI" }, "usr-manager", "CENTER_MANAGER")).rejects.toThrow(BadRequestException);
  });

  it("cô lập lớp online theo đúng chủ trì và học viên ghi danh", async () => {
    const service = new LearningService();
    const classItem = await service.createClass({ courseId: "course-web", code: "IDENTITY-LIVE", name: "Lớp kiểm thử quyền online", term: "2027-HK4", startAt: "2027-11-01T00:00:00.000Z", endAt: "2028-01-15T00:00:00.000Z", capacity: 20 }, "manager-real");
    await service.assignInstructor(classItem.id, "instructor-real", "PRIMARY", "manager-real");
    await service.enrollLearner(classItem.id, "learner-real", "manager-real");
    const liveSession = await service.createSession(classItem.id, { title: "Phân quyền lớp online", startsAt: "2027-11-10T02:00:00.000Z", endsAt: "2027-11-10T03:00:00.000Z", provider: "JITSI" }, "instructor-real", "INSTRUCTOR");

    expect(liveSession.hostId).toBe("instructor-real");
    expect((await service.listSessions("INSTRUCTOR", "instructor-real")).map((item) => item.id)).toContain(liveSession.id);
    expect((await service.listSessions("INSTRUCTOR", "instructor-outside")).map((item) => item.id)).not.toContain(liveSession.id);
    expect((await service.listSessions("LEARNER", "learner-real")).map((item) => item.id)).toContain(liveSession.id);
    expect((await service.listSessions("LEARNER", "learner-outside")).map((item) => item.id)).not.toContain(liveSession.id);
    await expect(service.transitionSession(liveSession.id, "LIVE", "instructor-outside")).rejects.toThrow(NotFoundException);
    await expect(service.getSessionSummary(liveSession.id, "learner-outside")).rejects.toThrow(NotFoundException);
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
      const run = await service.runOperationalReport("2026-01-01T00:00:00.000Z", "2026-12-31T23:59:59.000Z", "manager-real");
      expect(run.result.definitionVersion).toBe("1.0.0");
      expect(run.result.metricDefinitions.classes).toContain("kỳ báo cáo");
      const created = await service.createReportExport(run.id, "CSV", "manager-real");
      expect(created).toMatchObject({ status: "COMPLETED", format: "CSV" });
      expect(await service.listReportExports("manager-real")).toHaveLength(1);
      expect(await service.listReportExports("manager-outside")).toHaveLength(0);
      const download = await service.downloadReportExport(created.id, "manager-real");
      expect(download.fileName).toMatch(/bao-cao-van-hanh.*\.csv$/);
      expect(download.buffer.toString("utf8")).toContain("Phiên bản định nghĩa");
      await expect(service.downloadReportExport(created.id, "manager-outside")).rejects.toThrow(NotFoundException);
      await expect(service.runOperationalReport("2026-12-31T00:00:00.000Z", "2026-01-01T00:00:00.000Z")).rejects.toThrow(BadRequestException);
      await expect(service.createReportExport("run-khong-ton-tai", "CSV", "manager-real")).rejects.toThrow(NotFoundException);
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

      const replacement = Buffer.from("%PDF-1.7\nnoi-dung-phien-ban-moi");
      const versionThree = await service.replaceMaterialVersion(material.id, { folder: "Tuần kiểm thử", tags: ["bao-mat", "v3"] }, { originalName: "kiem-thu-v3.pdf", mimeType: "application/pdf", size: replacement.length, buffer: replacement });
      expect(versionThree).toMatchObject({ version: 3, visibility: "DRAFT" });
      expect((await service.listMaterialVersions(material.id, "INSTRUCTOR")).map((item) => item.version)).toEqual([3, 2, 1]);
      expect((await service.listMaterialVersions(material.id, "LEARNER")).map((item) => item.version)).toEqual([2]);

      const oldAccess = await service.createMaterialVersionAccess(material.id, 2, "LEARNER");
      const oldUrl = new URL(oldAccess.url, "http://localhost");
      const oldDownload = await service.readMaterialVersionDownload(material.id, 2, Number(oldUrl.searchParams.get("expires")), oldUrl.searchParams.get("signature") ?? "", "LEARNER");
      expect(oldDownload.buffer.equals(bytes)).toBe(true);
      await service.updateMaterial(material.id, { visibility: "PUBLISHED" });
      const currentAccess = await service.createMaterialAccess(material.id, "LEARNER");
      const currentUrl = new URL(currentAccess.url, "http://localhost");
      const currentDownload = await service.readMaterialDownload(material.id, Number(currentUrl.searchParams.get("expires")), currentUrl.searchParams.get("signature") ?? "", "LEARNER");
      expect(currentDownload.buffer.equals(replacement)).toBe(true);
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

  it("cô lập học liệu theo đúng tài khoản giảng viên và học viên", async () => {
    const service = new LearningService();
    const classItem = await service.createClass({
      courseId: "course-web",
      code: "IDENTITY-MATERIAL",
      name: "Lớp kiểm thử quyền học liệu",
      term: "2027-HK3",
      startAt: "2027-09-01T00:00:00.000Z",
      endAt: "2027-11-01T00:00:00.000Z",
      capacity: 20,
    }, "manager-real");
    await service.assignInstructor(classItem.id, "instructor-real", "PRIMARY", "manager-real");
    await service.enrollLearner(classItem.id, "learner-real", "manager-real");
    const material = await service.createMaterial(classItem.id, {
      name: "identity.pdf",
      mimeType: "application/pdf",
      sizeBytes: 100,
      folder: "Phân quyền",
      tags: ["identity"],
    }, undefined, "instructor-real");
    await service.updateMaterial(material.id, { visibility: "PUBLISHED" }, "instructor-real");

    expect((await service.listMaterials("INSTRUCTOR", undefined, "instructor-real")).map((item) => item.id)).toContain(material.id);
    expect((await service.listMaterials("INSTRUCTOR", undefined, "instructor-outside")).map((item) => item.id)).not.toContain(material.id);
    expect((await service.searchAccessibleMaterials({ classId: classItem.id }, "learner-real")).items.map((item) => item.id)).toContain(material.id);
    expect((await service.searchAccessibleMaterials({ classId: classItem.id }, "learner-outside")).items).toHaveLength(0);
    await expect(service.listMaterialVersions(material.id, "LEARNER", "learner-outside")).rejects.toThrow(NotFoundException);
    await expect(service.updateMaterial(material.id, { folder: "Xâm nhập" }, "instructor-outside")).rejects.toThrow(NotFoundException);
    await expect(service.createMaterial(classItem.id, { name: "outside.pdf", mimeType: "application/pdf", sizeBytes: 1, folder: "", tags: [] }, undefined, "instructor-outside")).rejects.toThrow(NotFoundException);
  });

  it("chặn học viên mở học liệu của lớp chưa ghi danh", async () => {
    const service = new LearningService();
    const classItem = await service.createClass({
      courseId: "course-web",
      code: "WEB-NO-ENROLLMENT",
      name: "Lớp chưa ghi danh",
      term: "2027-HK2",
      startAt: "2027-09-01T00:00:00.000Z",
      endAt: "2027-12-01T00:00:00.000Z",
      capacity: 20,
    });
    await service.assignInstructor(classItem.id, "usr-instructor");
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

  it("retry provider lỗi rồi fallback có dấu vết và link đúng vai trò", async () => {
    const config = { get: (key: keyof Environment): string | number | undefined => {
      if (key === "LIVE_PROVIDER_RETRY_LIMIT") return 2;
      if (key === "LIVE_PROVIDER_FALLBACK_ORDER") return "ZOOM,JITSI,GOOGLE_MEET";
      if (key === "LIVE_PROVIDER_SIMULATED_FAILURES") return "ZOOM";
      return undefined;
    } } as unknown as ConfigService<Environment, true>;
    const service = new LearningService(undefined, config);
    const session = await service.createSession("class-web-01", { title: "Buổi học có fallback", startsAt: "2027-10-10T02:00:00.000Z", endsAt: "2027-10-10T03:00:00.000Z", provider: "ZOOM" });
    expect(session).toMatchObject({ requestedProvider: "ZOOM", provider: "JITSI", fallbackUsed: true, provisioningAttempts: 3 });
    expect(session.hostUrl).not.toBe(session.attendeeUrl);
    expect(session.hostUrl).toContain("role=host");
    expect(session.attendeeUrl).not.toContain("role=host");
  });

  it("phiên bản hóa, kiểm tra trùng và xuất bản câu hỏi trước khi đưa vào đề", async () => {
    const service = new LearningService();
    const draft = await service.createQuestion({ courseId: "course-web", type: "SINGLE_CHOICE", content: "Giao thức nào mã hóa lưu lượng web?", options: ["HTTP", "HTTPS", "FTP"], correctAnswers: ["HTTPS"], difficulty: 1, tags: [" Security ", "web"] });
    expect(draft).toMatchObject({ status: "DRAFT", version: 1, tags: ["security", "web"] });
    await expect(service.createExam({ classId: "class-web-01", title: "Đề dùng câu nháp", questionIds: [draft.id], durationMinutes: 15, totalScore: 10, openAt: "2026-09-01T00:00:00.000Z", closeAt: "2026-10-01T00:00:00.000Z", attemptLimit: 1 })).rejects.toThrow("đã xuất bản");
    await expect(service.createQuestion({ courseId: "course-web", type: "SINGLE_CHOICE", content: "  Giao thức nào mã hóa   lưu lượng WEB? ", options: ["HTTP", "HTTPS"], correctAnswers: ["HTTPS"], difficulty: 1, tags: [] })).rejects.toThrow(ConflictException);
    const published = await service.publishQuestion(draft.id);
    const versionTwo = await service.updateQuestion(published.id, { ...published, content: "Giao thức nào bảo vệ lưu lượng web?", difficulty: 2 });
    expect(versionTwo).toMatchObject({ version: 2, status: "DRAFT", supersedesId: published.id, familyId: published.familyId });
    await expect(service.updateQuestion(published.id, { ...published, content: "Không được sửa bản cũ" })).rejects.toThrow(ConflictException);
    expect((await service.listQuestions({ tag: "security", difficulty: 2 }))[0]?.id).toBe(versionTwo.id);
    await service.publishQuestion(versionTwo.id);
    expect((await service.createExam({ classId: "class-web-01", title: "Đề dùng câu đã duyệt", questionIds: [versionTwo.id], durationMinutes: 15, totalScore: 10, openAt: "2026-09-01T00:00:00.000Z", closeAt: "2026-10-01T00:00:00.000Z", attemptLimit: 1 })).status).toBe("DRAFT");
  });

  it("nhập câu hỏi hàng loạt và trả kết quả riêng cho từng dòng", async () => {
    const service = new LearningService();
    const results = await service.importQuestions([
      { courseId: "course-web", type: "TRUE_FALSE", content: "TLS giúp mã hóa kết nối mạng.", options: ["Đúng", "Sai"], correctAnswers: ["Đúng"], difficulty: 1, tags: ["tls"] },
      { courseId: "course-web", type: "SINGLE_CHOICE", content: "Câu hỏi thiếu lựa chọn hợp lệ", options: ["Một"], correctAnswers: ["Một"], difficulty: 1, tags: [] },
    ]);
    expect(results.map((item) => item.status)).toEqual(["IMPORTED", "FAILED"]);
    expect(results[0]?.questionId).toBeTruthy();
    expect(results[1]?.message).toContain("hai lựa chọn");
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

  it("cô lập đề, lượt làm và quyền chấm theo giảng viên được phân công", async () => {
    const service = new LearningService();
    const classItem = await service.createClass({ courseId: "course-web", code: "IDENTITY-EXAM", name: "Lớp kiểm thử quyền đề", term: "2026-HK3", startAt: "2026-08-01T00:00:00.000Z", endAt: "2026-12-15T00:00:00.000Z", capacity: 20 }, "manager-real");
    await service.assignInstructor(classItem.id, "instructor-real", "PRIMARY", "manager-real");
    await service.enrollLearner(classItem.id, "learner-real", "manager-real");
    const examInput = { classId: classItem.id, title: "Đề kiểm thử phân quyền", questionIds: ["q-rest-01"], durationMinutes: 30, totalScore: 10, openAt: "2026-08-01T00:00:00.000Z", closeAt: "2026-12-01T00:00:00.000Z", attemptLimit: 1 };

    await expect(service.createExam(examInput, "instructor-outside")).rejects.toThrow(NotFoundException);
    const exam = await service.createExam(examInput, "instructor-real");
    expect((await service.listExams("INSTRUCTOR", "instructor-real")).map((item) => item.id)).toContain(exam.id);
    expect((await service.listExams("INSTRUCTOR", "instructor-outside")).map((item) => item.id)).not.toContain(exam.id);
    await expect(service.submitExamForReview(exam.id, "instructor-outside")).rejects.toThrow(NotFoundException);
    await service.submitExamForReview(exam.id, "instructor-real");
    await service.reviewExam(exam.id, "APPROVE", undefined, "manager-real");
    const attempt = await service.startAttempt(exam.id, "learner-real");
    await service.saveAnswer(attempt.id, "q-rest-01", ["PATCH"], "learner-real");
    await service.submitAttempt(attempt.id, "learner-real");

    expect(await service.listAttempts(exam.id, "instructor-outside")).toHaveLength(0);
    await expect(service.gradeAttempt(attempt.id, 9, "Chấm bài", undefined, "instructor-outside")).rejects.toThrow(NotFoundException);
    expect(await service.gradeAttempt(attempt.id, 9, "Chấm bài", "Điều chỉnh theo đáp án", "instructor-real")).toMatchObject({ status: "GRADED", score: 9 });
    await expect(service.listGradeHistory(attempt.id, "instructor-outside")).rejects.toThrow(NotFoundException);
  });

  it("xáo câu hỏi tái lập theo seed và lưu lịch sử mỗi lần sửa điểm", async () => {
    const service = new LearningService();
    const examInput = {
      classId: "class-web-01",
      title: "Đề xáo câu hỏi",
      questionIds: ["q-rest-01", "q-db-01"],
      durationMinutes: 30,
      totalScore: 10,
      openAt: "2026-09-01T00:00:00.000Z",
      closeAt: "2026-12-01T00:00:00.000Z",
      attemptLimit: 1,
      shuffleQuestions: true,
      randomSeed: "lop-web-dot-1",
    };
    const firstExam = await service.createExam(examInput);
    const secondExam = await service.createExam({ ...examInput, title: "Đề xáo câu hỏi bản sao" });
    expect(firstExam.questionIds).toEqual(secondExam.questionIds);
    expect(firstExam).toMatchObject({ shuffleQuestions: true, randomSeed: "lop-web-dot-1" });

    const attempt = await service.startAttempt("exam-mid-web");
    await service.saveAnswer(attempt.id, "q-rest-01", ["PATCH"]);
    await service.submitAttempt(attempt.id);
    await expect(service.gradeAttempt(attempt.id, 8, "Điều chỉnh sau phúc khảo")).rejects.toThrow("lý do");
    await service.gradeAttempt(attempt.id, 8, "Điều chỉnh sau phúc khảo", "Chấp nhận đáp án tương đương");

    expect(await service.listGradeHistory(attempt.id)).toEqual([
      expect.objectContaining({ previousScore: 5, nextScore: 8, reason: "Chấp nhận đáp án tương đương" }),
    ]);
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

  it("phân tích bài đã chấm, cảnh báo mẫu nhỏ và giữ kín thống kê câu khi đề còn mở", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-09-10T02:00:00.000Z"));
      const service = new LearningService();
      const first = await service.startAttempt("exam-mid-web");
      await service.saveAnswer(first.id, "q-rest-01", ["PATCH"]); await service.saveAnswer(first.id, "q-db-01", ["Đúng"]); await service.submitAttempt(first.id);
      const second = await service.startAttempt("exam-mid-web");
      await service.saveAnswer(second.id, "q-rest-01", ["GET"]); await service.saveAnswer(second.id, "q-db-01", ["Sai"]); await service.submitAttempt(second.id);
      const openReport = await service.getExamAnalytics({ classId: "class-web-01" });
      expect(openReport.exams[0]).toMatchObject({ sampleSize: 2, smallSampleWarning: true, averagePercentage: 50, passRate: 50, questionStatsAvailable: false, questionStats: [] });

      vi.setSystemTime(new Date("2027-01-10T02:00:00.000Z"));
      const closedReport = await service.getExamAnalytics({ examId: "exam-mid-web" });
      expect(closedReport.exams[0]?.questionStats).toEqual([expect.objectContaining({ responseCount: 2, correctRate: 50 }), expect.objectContaining({ responseCount: 2, correctRate: 50 })]);
      const csv = (await service.exportExamAnalytics({ examId: "exam-mid-web" })).toString("utf8");
      expect(csv).toContain("averagePercentage");
      expect(csv).not.toContain("PATCH");
    } finally { vi.useRealTimers(); }
  });

  it("điều phối chủ đề, giới hạn độ sâu và xóa mềm phản hồi", async () => {
    const service = new LearningService();
    const topic = await service.createTopic("class-web-01", { title: "Luồng kiểm thử diễn đàn", body: "Nội dung thảo luận hợp lệ cho cả lớp.", tags: ["testing"], isPinned: false });
    expect((await service.listNotifications("usr-learner")).some((item) => item.entityId === topic.id)).toBe(true);
    const root = await service.createPost(topic.id, "Phản hồi gốc hợp lệ");
    const child = await service.createPost(topic.id, "Phản hồi cấp một hợp lệ", "usr-learner", root.id);
    const grandchild = await service.createPost(topic.id, "Phản hồi cấp hai hợp lệ", "usr-learner", child.id);
    await expect(service.createPost(topic.id, "Không được tạo cấp ba", "usr-learner", grandchild.id)).rejects.toThrow("tối đa 2 cấp");

    const edited = await service.updatePost(root.id, "Phản hồi gốc đã chỉnh sửa");
    expect(edited).toMatchObject({ editCount: 1, body: "Phản hồi gốc đã chỉnh sửa" });
    expect((await service.deletePost(root.id)).deletedAt).toBeTruthy();
    expect((await service.listPosts(topic.id))[0]).toMatchObject({ body: "[Nội dung đã bị ẩn]", status: "HIDDEN" });

    expect((await service.moderateTopic(topic.id, { isLocked: true, isPinned: true, reason: "Kết thúc phiên thảo luận" }))).toMatchObject({ isLocked: true, isPinned: true });
    await expect(service.createPost(topic.id, "Không thể đăng khi đã khóa")).rejects.toThrow("đã khóa");
    await expect(service.updatePost(child.id, "Không thể sửa khi đã khóa")).rejects.toThrow("đã khóa");
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

  it("chỉ cho người báo hoặc đội quản lý hỗ trợ truy cập ticket", async () => {
    const service = new LearningService();
    const ticket = await service.createTicket(
      { category: "ACCOUNT", severity: "P1", description: "Tài khoản không tải được hồ sơ cá nhân" },
      "reporter-one",
    );

    expect(await service.listTickets("LEARNER", "reporter-two")).toHaveLength(0);
    expect(await service.listTickets("INSTRUCTOR", "reporter-two")).toHaveLength(0);
    await expect(service.listTicketComments(ticket.id, "LEARNER", "reporter-two")).rejects.toThrow(NotFoundException);
    await expect(service.addTicketComment(ticket.id, "Tôi muốn xem ticket của người khác", "INSTRUCTOR", "reporter-two")).rejects.toThrow(NotFoundException);

    expect(await service.listTickets("CENTER_MANAGER", "support-manager")).toHaveLength(1);
    const comment = await service.addTicketComment(ticket.id, "Đội hỗ trợ đã tiếp nhận yêu cầu", "CENTER_MANAGER", "support-manager");
    expect(comment.authorId).toBe("support-manager");
    expect((await service.listTickets("LEARNER", "reporter-one"))[0]?.status).toBe("IN_PROGRESS");
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

  it("chỉ cho người báo đóng ticket sau khi đã có kết quả xử lý", async () => {
    const service = new LearningService();
    const ticket = await service.createTicket({ category: "TECHNICAL", severity: "P2", description: "Không thể mở nội dung bài giảng đã phát hành" });
    await expect(service.closeTicketByReporter(ticket.id)).rejects.toThrow(ConflictException);
    await service.updateTicket(ticket.id, { status: "RESOLVED", assigneeId: "usr-admin", resolution: "Đã cấp lại quyền truy cập học liệu." });
    expect(await service.closeTicketByReporter(ticket.id)).toMatchObject({ status: "CLOSED", resolution: "Đã cấp lại quyền truy cập học liệu." });
    await expect(service.closeTicketByReporter(ticket.id, "usr-khac")).rejects.toThrow(NotFoundException);
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
      const processing = await service.getSessionSummary("session-web-01") as { recordingAvailable: boolean; session: { recordingUrl?: string; recordingStatus?: string } };
      expect(processing).toMatchObject({ recordingAvailable: false, session: { recordingStatus: "PROCESSING" } });
      expect(processing.session.recordingUrl).toBeUndefined();
      await expect(service.createRecordingAccess("session-web-01")).rejects.toThrow(NotFoundException);

      const ready = await service.completeRecording("session-web-01", "READY", 90);
      expect(ready).toMatchObject({ recordingStatus: "READY" });
      expect(ready.recordingExpiresAt).toBeTruthy();
      const summary = await service.getSessionSummary("session-web-01") as { recordingAvailable: boolean; session: { recordingStatus?: string } };
      expect(summary).toMatchObject({ recordingAvailable: true, session: { recordingStatus: "READY" } });
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
