import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";
import type { ConfigService } from "@nestjs/config";
import { randomUUID } from "node:crypto";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Environment } from "../../src/config/environment.js";
import { LearningService } from "../../src/domains/learning/core/learning.service.js";
import { SystemService } from "../../src/domains/system/core/system.service.js";

describe("LearningService", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-01T00:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("chỉ trả học viên đang ghi danh trong lớp được phân công cho giảng viên", async () => {
    const service = new LearningService();

    expect(
      await service.listInstructorClassLearners(
        "class-web-01",
        "usr-instructor",
      ),
    ).toEqual([
      expect.objectContaining({ id: "usr-learner", roleCode: "LEARNER" }),
    ]);
    await expect(
      service.listInstructorClassLearners("class-web-01", "usr-outside"),
    ).rejects.toThrow(NotFoundException);
  });

  it("phiên bản hóa khóa học mà không làm đổi snapshot của lớp cũ", async () => {
    const service = new LearningService();
    await expect(
      service.createCourse({
        code: "WEB-FULLSTACK",
        name: "Trùng mã",
        description: "Mô tả đủ độ dài cho khóa học",
        outcomes: ["Kết quả"],
      }, "usr-manager"),
    ).rejects.toThrow(ConflictException);
    const created = await service.createCourse({
      code: "NEW-COURSE",
      name: "Khóa học mới",
      description: "Mô tả đủ độ dài cho khóa học",
      outcomes: ["Hoàn thành mục tiêu"],
    }, "usr-manager");
    const publishedV1 = await service.publishCourse(created.id, "usr-manager");
    expect(publishedV1).toMatchObject({ status: "PUBLISHED", version: 1 });
    const classV1 = await service.createClass({
      courseId: created.id,
      code: "NEW-K01",
      name: "Lớp dùng bản một",
      term: "2026-HK1",
      startAt: "2026-09-01T00:00:00.000Z",
      endAt: "2026-12-01T00:00:00.000Z",
      capacity: 20,
    }, "usr-manager");
    expect(classV1.courseVersion).toBe(1);

    expect(
      (
        await service.updateCourse(created.id, {
          name: "Khóa học mới cập nhật",
          description: "Mô tả phiên bản thứ hai đủ độ dài",
          outcomes: ["Mục tiêu phiên bản hai"],
        }, "usr-manager")
      ).status,
    ).toBe("DRAFT");
    expect((await service.publishCourse(created.id, "usr-manager")).version).toBe(2);
    expect(
      (await service.listCourseVersions(created.id)).map(
        (item) => item.version,
      ),
    ).toEqual([2, 1]);
    expect(
      (await service.listClasses("CENTER_MANAGER", "usr-manager")).find(
        (item) => item.id === classV1.id,
      )?.courseVersion,
    ).toBe(1);
    expect(
      (await service.archiveCourse(created.id, "Ngừng tuyển sinh khóa học này", "usr-manager"))
        .status,
    ).toBe("ARCHIVED");
    await expect(
      service.createClass({
        courseId: created.id,
        code: "NEW-K02",
        name: "Không được mở",
        term: "2026-HK2",
        startAt: "2027-01-01T00:00:00.000Z",
        endAt: "2027-03-01T00:00:00.000Z",
        capacity: 20,
      }, "usr-manager"),
    ).rejects.toThrow(BadRequestException);
  });

  it("cấu hình lớp theo học kỳ, múi giờ, sức chứa và điều kiện kích hoạt", async () => {
    const service = new LearningService();
    const first = await service.createClass({
      courseId: "course-web",
      code: "SHARED",
      name: "Lớp học kỳ một",
      term: "2027-HK1",
      startAt: "2027-01-10T00:00:00.000Z",
      endAt: "2027-04-10T00:00:00.000Z",
      capacity: 30,
      timezone: "Asia/Bangkok",
    }, "usr-manager");
    expect(first).toMatchObject({
      courseVersion: 1,
      timezone: "Asia/Bangkok",
      status: "DRAFT",
    });

    const customByGradeAndSubject = await service.createClass({
      code: "CUSTOM-GS-01",
      name: "Lớp Lập trình C++ Đại học",
      term: "2027-HK1",
      grade: "Đại học",
      subject: "Lập trình C++",
      startAt: "2027-01-10T00:00:00.000Z",
      endAt: "2027-04-10T00:00:00.000Z",
      capacity: 35,
    }, "usr-manager");
    expect(customByGradeAndSubject).toMatchObject({
      grade: "Đại học",
      subject: "Lập trình C++",
      courseVersion: 1,
      status: "DRAFT",
    });
    await expect(
      service.createClass({
        code: "MISSING-GS-01",
        name: "Thiếu môn học",
        term: "2027-HK1",
        grade: "10",
        startAt: "2027-01-10T00:00:00.000Z",
        endAt: "2027-04-10T00:00:00.000Z",
        capacity: 30,
      }, "usr-manager"),
    ).rejects.toThrow(BadRequestException);
    await expect(
      service.createClass({
        courseId: "course-web",
        code: "shared",
        name: "Trùng học kỳ",
        term: "2027-HK1",
        startAt: "2027-01-10T00:00:00.000Z",
        endAt: "2027-04-10T00:00:00.000Z",
        capacity: 30,
      }, "usr-manager"),
    ).rejects.toThrow(ConflictException);
    expect(
      (
        await service.createClass({
          courseId: "course-web",
          code: "SHARED",
          name: "Khác học kỳ",
          term: "2027-HK2",
          startAt: "2027-05-10T00:00:00.000Z",
          endAt: "2027-08-10T00:00:00.000Z",
          capacity: 30,
        }, "usr-manager")
      ).term,
    ).toBe("2027-HK2");
    await expect(
      service.createClass({
        courseId: "course-web",
        code: "BAD-TZ",
        name: "Sai múi giờ",
        term: "2027-HK1",
        startAt: "2027-01-10T00:00:00.000Z",
        endAt: "2027-04-10T00:00:00.000Z",
        capacity: 30,
        timezone: "Mars/Olympus",
      }, "usr-manager"),
    ).rejects.toThrow(BadRequestException);
    await expect(service.activateClass(first.id, "usr-manager")).rejects.toThrow(
      BadRequestException,
    );
    await service.assignInstructor(first.id, "usr-instructor", undefined, "usr-manager");
    expect((await service.activateClass(first.id, "usr-manager")).status).toBe("ACTIVE");
    expect((await service.activateClass(first.id, "usr-manager")).status).toBe("ACTIVE");
  });

  it("chỉ chặn phân công giảng viên khi các buổi học thực tế giao nhau", async () => {
    const service = new LearningService();
    const first = await service.createClass({
      courseId: "course-web",
      code: "SCHEDULE-A",
      name: "Lớp có cùng khoảng ngày A",
      term: "2030-HK1",
      startAt: "2030-01-01T00:00:00.000Z",
      endAt: "2030-06-01T00:00:00.000Z",
      capacity: 20,
    }, "usr-manager");
    const second = await service.createClass({
      courseId: "course-web",
      code: "SCHEDULE-B",
      name: "Lớp có cùng khoảng ngày B",
      term: "2030-HK1",
      startAt: "2030-01-01T00:00:00.000Z",
      endAt: "2030-06-01T00:00:00.000Z",
      capacity: 20,
    }, "usr-manager");

    await service.assignInstructor(first.id, "schedule-instructor", "PRIMARY", "usr-manager");
    await expect(
      service.assignInstructor(second.id, "schedule-instructor", "PRIMARY", "usr-manager"),
    ).resolves.toMatchObject({ id: second.id });
  });

  it("không lưu trữ khóa học khi còn lớp đang hoạt động", async () => {
    const service = new LearningService();
    const course = await service.createCourse({
      code: "ACTIVE-COURSE",
      name: "Khóa học đang vận hành",
      description: "Khóa học dùng để kiểm tra ràng buộc lưu trữ.",
      outcomes: ["Hoàn thành nội dung khóa học"],
    }, "usr-manager");
    await service.publishCourse(course.id, "usr-manager");
    const classItem = await service.createClass({
      courseId: course.id,
      code: "ACTIVE-CLASS",
      name: "Lớp đang hoạt động",
      term: "2030-HK1",
      startAt: "2030-01-01T00:00:00.000Z",
      endAt: "2030-06-01T00:00:00.000Z",
      capacity: 20,
    }, "usr-manager");
    await service.assignInstructor(classItem.id, "archive-instructor", "PRIMARY", "usr-manager");
    await service.activateClass(classItem.id, "usr-manager");

    await expect(
      service.archiveCourse(course.id, "Chuyển khóa học sang lưu trữ", "usr-manager"),
    ).rejects.toThrow("còn 1 lớp đang hoạt động");
  });

  it("lưu đáp án, nộp lặp an toàn và chấm tự động", async () => {
    const service = new LearningService();
    const attempt = await service.startAttempt("exam-mid-web", "usr-learner");
    const saved = await service.saveAnswer(attempt.id, "q-rest-01", ["PATCH"], "usr-learner");
    expect(saved.lastSavedAt).toBeTruthy();
    expect(saved.serverTime).toBeTruthy();
    await service.saveAnswer(attempt.id, "q-db-01", ["Đúng"], "usr-learner");
    const result = await service.submitAttempt(attempt.id, "usr-learner");
    expect(result.score).toBe(10);
    expect(result.submissionReceipt).toMatch(/^SUB-[A-F0-9]{20}$/);
    expect((await service.submitAttempt(attempt.id, "usr-learner")).submissionReceipt).toBe(
      result.submissionReceipt,
    );
  });

  it("trả lượt điểm cao nhất như sổ điểm và vẫn cho xem chi tiết lượt thấp hơn", async () => {
    const service = new LearningService();
    const first = await service.startAttempt("exam-mid-web", "usr-learner");
    await service.saveAnswer(first.id, "q-rest-01", ["PATCH"], "usr-learner");
    await service.saveAnswer(first.id, "q-db-01", ["Đúng"], "usr-learner");
    expect((await service.submitAttempt(first.id, "usr-learner")).score).toBe(10);
    const latest = await service.startAttempt("exam-mid-web", "usr-learner");
    expect((await service.listLearnerResults("usr-learner"))[0]?.attempt.id).toBe(first.id);
    await service.submitAttempt(latest.id, "usr-learner");
    const results = await service.listLearnerResults("usr-learner");
    expect(results).toHaveLength(1);
    expect(results[0]?.attempt).toMatchObject({ id: first.id, score: 10 });
    expect((await service.getLearnerResult(latest.id, "usr-learner")).attempt).toMatchObject({ id: latest.id, score: 0 });
  });

  it("tự động nộp lượt làm bài khi bộ đếm phía máy chủ hết giờ", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-08-30T08:00:00.000Z"));
      const service = new LearningService();
      const attempt = await service.startAttempt("exam-mid-web", "usr-learner");
      vi.setSystemTime(new Date("2026-08-30T08:46:00.000Z"));
      expect(await service.reconcileExpiredAttempts()).toBe(1);
      expect((await service.getAttempt(attempt.id)).status).toBe("GRADED");
      expect(await service.reconcileExpiredAttempts()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("cô lập lượt làm bài theo đúng tài khoản học viên", async () => {
    const service = new LearningService();
    await service.enrollLearner("class-web-01", "learner-second", "usr-manager");
    const attempt = await service.startAttempt(
      "exam-mid-web",
      "learner-second",
    );

    await expect(
      service.getExamQuestions("exam-mid-web", "usr-learner"),
    ).rejects.toThrow(NotFoundException);
    await expect(
      service.saveAnswer(attempt.id, "q-rest-01", ["PATCH"], "usr-learner"),
    ).rejects.toThrow(NotFoundException);
    await expect(
      service.submitAttempt(attempt.id, "usr-learner"),
    ).rejects.toThrow(NotFoundException);

    expect(
      await service.getExamQuestions("exam-mid-web", "learner-second"),
    ).toHaveLength(2);
    await service.saveAnswer(
      attempt.id,
      "q-rest-01",
      ["PATCH"],
      "learner-second",
    );
    expect(
      (await service.submitAttempt(attempt.id, "learner-second")).learnerId,
    ).toBe("learner-second");
    expect(await service.listLearnerResults("usr-learner")).toHaveLength(0);
    expect(await service.listLearnerResults("learner-second")).toHaveLength(1);
  });

  it("cô lập chủ đề, phản hồi và báo cáo diễn đàn theo thành viên thật", async () => {
    const service = new LearningService();
    await service.enrollLearner("class-web-01", "learner-forum", "usr-manager");
    const topic = await service.createTopic(
      "class-web-01",
      {
        title: "Chủ đề của học viên thứ hai",
        body: "Trao đổi cách tổ chức API cho bài tập nhóm.",
        tags: ["api"],
        isPinned: false,
      },
      "learner-forum",
      "LEARNER",
    );

    expect(
      (await service.listTopics("LEARNER", "learner-forum")).some(
        (item) => item.id === topic.id,
      ),
    ).toBe(true);
    expect(await service.listTopics("LEARNER", "learner-outside")).toHaveLength(
      0,
    );
    await expect(
      service.listPosts(topic.id, "LEARNER", "learner-outside"),
    ).rejects.toThrow(NotFoundException);

    const post = await service.createPost(
      topic.id,
      "Em bổ sung một phương án triển khai hợp lệ.",
      "learner-forum",
    );
    await expect(
      service.updatePost(post.id, "Sửa bài của tài khoản khác.", "usr-learner"),
    ).rejects.toThrow(NotFoundException);
    await expect(service.deletePost(post.id, "usr-learner")).rejects.toThrow(
      NotFoundException,
    );
    expect(
      (
        await service.updatePost(
          post.id,
          "Em cập nhật phương án triển khai chi tiết hơn.",
          "learner-forum",
        )
      ).authorId,
    ).toBe("learner-forum");
  });

  it("chặn lịch buổi học trùng", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-08-25T00:00:00.000Z"));
      const service = new LearningService();
      await expect(
        service.createSession("class-web-01", {
          title: "Trùng lịch",
          startsAt: "2026-08-26T02:30:00.000Z",
          endsAt: "2026-08-26T04:00:00.000Z",
          provider: "JITSI",
        }, "usr-instructor", "INSTRUCTOR"),
      ).rejects.toThrow(ConflictException);
    } finally {
      vi.useRealTimers();
    }
  });

  it("quản trị vai trò giảng viên, thay thế và lưu lịch sử", async () => {
    const service = new LearningService();
    const classItem = await service.createClass({
      courseId: "course-web",
      code: "TEAM-01",
      name: "Lớp kiểm thử phân công",
      term: "2027",
      startAt: "2027-02-01T00:00:00.000Z",
      endAt: "2027-04-01T00:00:00.000Z",
      capacity: 20,
    }, "usr-manager");
    await service.assignInstructor(classItem.id, "usr-instructor", "PRIMARY", "usr-manager");
    await service.assignInstructor(
      classItem.id,
      "usr-co-instructor",
      "CO_INSTRUCTOR", "usr-manager",
    );
    await expect(
      service.removeInstructor(
        classItem.id,
        "usr-instructor",
        "Điều chuyển công tác", "usr-manager",
      ),
    ).rejects.toThrow(ConflictException);
    await service.transferPrimaryInstructor(
      classItem.id,
      "usr-instructor",
      "usr-co-instructor",
      "Bàn giao cho người thay thế", "usr-manager",
    );
    await service.removeInstructor(
      classItem.id,
      "usr-instructor",
      "Bàn giao cho người thay thế", "usr-manager",
    );
    const roster = await service.getClassRoster(classItem.id);
    expect(roster.instructors).toEqual([
      expect.objectContaining({
        instructorId: "usr-co-instructor",
        role: "PRIMARY",
      }),
    ]);
  });

  it("nhập ghi danh theo dòng, báo kết quả và gỡ học viên", async () => {
    const service = new LearningService();
    const classItem = await service.createClass({
      courseId: "course-web",
      code: "ENROLL-01",
      name: "Lớp kiểm thử ghi danh",
      term: "2027",
      startAt: "2027-05-01T00:00:00.000Z",
      endAt: "2027-06-01T00:00:00.000Z",
      capacity: 2,
    }, "usr-manager");
    const results = await service.importEnrollments(classItem.id, [
      "learner-a",
      "learner-a",
      "learner-b",
      "learner-c",
    ], "usr-manager");
    expect(results.map((item) => item.status)).toEqual([
      "ENROLLED",
      "SKIPPED",
      "ENROLLED",
      "FAILED",
    ]);
    await service.removeEnrollment(
      classItem.id,
      "learner-a",
      "Học viên chuyển sang lớp khác", "usr-manager",
    );
    const roster = await service.getClassRoster(classItem.id);
    expect(roster.enrollments.map((item) => item.learnerId)).toEqual([
      "learner-b",
    ]);
  });

  it("lọc danh sách lớp theo đúng tài khoản học viên và giảng viên", async () => {
    const service = new LearningService();
    const classItem = await service.createClass(
      {
        courseId: "course-web",
        code: "IDENTITY-CLASS",
        name: "Lớp kiểm thử danh tính",
        term: "2027-HK3",
        startAt: "2027-09-01T00:00:00.000Z",
        endAt: "2027-11-01T00:00:00.000Z",
        capacity: 20,
      },
      "manager-real",
    );
    await service.assignInstructor(
      classItem.id,
      "instructor-real",
      "PRIMARY",
      "manager-real",
    );
    await service.enrollLearner(classItem.id, "learner-real", "manager-real");
    // Lớp nháp chưa hiện cho học viên dù đã ghi danh; chỉ khi kích hoạt học viên mới thấy.
    expect((await service.listClasses("LEARNER", "learner-real")).map((item) => item.id)).not.toContain(classItem.id);
    await service.activateClass(classItem.id, "manager-real");
    const learnerView = (await service.listClasses("LEARNER", "learner-real")).find((item) => item.id === classItem.id);
    expect(learnerView?.learnerIds).toEqual(["learner-real"]);
    expect(learnerView?.learnerCount).toBe(1);

    expect(
      (await service.listClasses("INSTRUCTOR", "instructor-real")).map(
        (item) => item.id,
      ),
    ).toContain(classItem.id);
    expect(
      (await service.listClasses("INSTRUCTOR", "instructor-outside")).map(
        (item) => item.id,
      ),
    ).not.toContain(classItem.id);
    expect(
      (await service.listClasses("LEARNER", "learner-real")).map(
        (item) => item.id,
      ),
    ).toContain(classItem.id);
    expect(
      (await service.listClasses("LEARNER", "learner-outside")).map(
        (item) => item.id,
      ),
    ).not.toContain(classItem.id);
    const roster = await service.getClassRoster(classItem.id);
    expect(roster.instructors.map((item) => item.instructorId)).toEqual(["instructor-real"]);
    expect(roster.enrollments.map((item) => item.learnerId)).toEqual(["learner-real"]);
  });

  it("quản lý đổi và hủy lịch có lý do, chặn thao tác quá khứ", async () => {
    const service = new LearningService();
    const classItem = await service.createClass({
      courseId: "course-web",
      code: "LIVE-OPS",
      name: "Lớp kiểm thử lịch",
      term: "2027",
      startAt: "2027-07-01T00:00:00.000Z",
      endAt: "2027-09-01T00:00:00.000Z",
      capacity: 20,
      timezone: "Asia/Bangkok",
    }, "usr-manager");
    await service.assignInstructor(classItem.id, "host-live", "PRIMARY", "usr-manager");
    const created = await service.createSession(
      classItem.id,
      {
        title: "Buổi một",
        startsAt: "2027-07-10T02:00:00.000Z",
        endsAt: "2027-07-10T03:00:00.000Z",
        provider: "GOOGLE_MEET",
      },
      "usr-manager",
      "CENTER_MANAGER",
    );
    expect(created).toMatchObject({
      timezone: "Asia/Bangkok",
      status: "SCHEDULED",
    });
    const updated = await service.updateSession(created.id, {
      title: "Buổi một đổi lịch",
      startsAt: "2027-07-11T02:00:00.000Z",
      endsAt: "2027-07-11T03:00:00.000Z",
      provider: "ZOOM",
      reason: "Điều chỉnh theo lịch giảng viên",
    }, "usr-manager", "CENTER_MANAGER");
    // Zoom chưa có adapter tạo phòng: hệ thống chuyển sang Jitsi thật thay vì sinh URL zoom.us giả.
    expect(updated).toMatchObject({
      provider: "JITSI",
      requestedProvider: "ZOOM",
      fallbackUsed: true,
      changeReason: "Điều chỉnh theo lịch giảng viên",
    });
    expect(updated.attendeeUrl).toMatch(/^https:\/\/meet\.jit\.si\//);
    expect(
      (await service.cancelSession(created.id, "Nghỉ theo lịch của trung tâm", "usr-manager", "CENTER_MANAGER"))
        .status,
    ).toBe("CANCELLED");
    await expect(
      service.createSession(
        classItem.id,
        {
          title: "Quá khứ",
          startsAt: "2020-01-01T00:00:00.000Z",
          endsAt: "2020-01-01T01:00:00.000Z",
          provider: "JITSI",
        },
        "usr-manager",
        "CENTER_MANAGER",
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it("cô lập lớp online theo đúng chủ trì và học viên ghi danh", async () => {
    const service = new LearningService();
    const classItem = await service.createClass(
      {
        courseId: "course-web",
        code: "IDENTITY-LIVE",
        name: "Lớp kiểm thử quyền online",
        term: "2027-HK4",
        startAt: "2027-11-01T00:00:00.000Z",
        endAt: "2028-01-15T00:00:00.000Z",
        capacity: 20,
      },
      "manager-real",
    );
    await service.assignInstructor(
      classItem.id,
      "instructor-real",
      "PRIMARY",
      "manager-real",
    );
    await service.enrollLearner(classItem.id, "learner-real", "manager-real");
    const liveSession = await service.createSession(
      classItem.id,
      {
        title: "Phân quyền lớp online",
        startsAt: "2027-11-10T02:00:00.000Z",
        endsAt: "2027-11-10T03:00:00.000Z",
        provider: "JITSI",
      },
      "instructor-real",
      "INSTRUCTOR",
    );

    expect(liveSession.hostId).toBe("instructor-real");
    expect(
      (await service.listSessions("INSTRUCTOR", "instructor-real")).map(
        (item) => item.id,
      ),
    ).toContain(liveSession.id);
    expect(
      (await service.listSessions("INSTRUCTOR", "instructor-outside")).map(
        (item) => item.id,
      ),
    ).not.toContain(liveSession.id);
    expect(
      (await service.listSessions("LEARNER", "learner-real")).map(
        (item) => item.id,
      ),
    ).toContain(liveSession.id);
    expect(
      (await service.listSessions("LEARNER", "learner-outside")).map(
        (item) => item.id,
      ),
    ).not.toContain(liveSession.id);
    await expect(
      service.transitionSession(liveSession.id, "LIVE", "instructor-outside"),
    ).rejects.toThrow(NotFoundException);
    await expect(
      service.getSessionSummary(liveSession.id, "learner-outside"),
    ).rejects.toThrow(NotFoundException);
  });

  it("chặn đóng lớp thiếu điều kiện, lưu trữ chỉ đọc và mở lại có lý do", async () => {
    const service = new LearningService();
    const blocked = await service.getClassClosureReadiness("class-web-01");
    expect(blocked.eligible).toBe(false);
    expect(blocked.blockers.length).toBeGreaterThan(0);

    const classItem = await service.createClass({
      courseId: "course-web",
      code: "ARCHIVE-01",
      name: "Lớp đủ điều kiện lưu trữ",
      term: "2025",
      startAt: "2025-01-01T00:00:00.000Z",
      endAt: "2025-02-01T00:00:00.000Z",
      capacity: 20,
    }, "usr-manager");
    await service.assignInstructor(classItem.id, "usr-instructor", undefined, "usr-manager");
    await service.activateClass(classItem.id, "usr-manager");
    expect(
      (await service.getClassClosureReadiness(classItem.id)).eligible,
    ).toBe(true);
    const closed = await service.closeClass(
      classItem.id,
      "Đã hoàn tất toàn bộ hoạt động lớp",
      "STANDARD_RETENTION", "usr-manager",
    );
    expect(closed).toMatchObject({
      status: "CLOSED",
      archivePolicy: "STANDARD_RETENTION",
    });
    expect(closed.archivedAt).toBeTruthy();
    await expect(
      service.createMaterial(classItem.id, {
        name: "read-only.pdf",
        mimeType: "application/pdf",
        sizeBytes: 100,
        folder: "Lưu trữ",
        tags: [],
      }, undefined, "usr-instructor", "INSTRUCTOR"),
    ).rejects.toThrow("chỉ cho phép đọc");
    expect(
      (await service.reopenClass(classItem.id, "Mở bổ sung một buổi học", "usr-manager"))
        .status,
    ).toBe("ACTIVE");
  });

  it("cho phép ghi danh sau ngày bắt đầu và đóng lớp trước ngày kết thúc", async () => {
    const service = new LearningService();
    const now = Date.now();
    const classItem = await service.createClass({
      courseId: "course-web",
      code: "FLEXIBLE-DATES-01",
      name: "Lớp không giới hạn ghi danh theo ngày khai giảng",
      term: "2026",
      startAt: new Date(now - 30 * 86_400_000).toISOString(),
      endAt: new Date(now + 30 * 86_400_000).toISOString(),
      capacity: 20,
    }, "usr-manager");
    await service.assignInstructor(classItem.id, "usr-instructor", undefined, "usr-manager");
    await service.activateClass(classItem.id, "usr-manager");

    const enrolled = await service.enrollLearner(classItem.id, "usr-learner", "usr-manager");
    expect(enrolled.learnerIds).toContain("usr-learner");
    expect((await service.getClassClosureReadiness(classItem.id)).eligible).toBe(true);

    const closed = await service.closeClass(
      classItem.id,
      "Đã hoàn tất hoạt động sớm",
      "STANDARD_RETENTION", "usr-manager",
    );
    expect(closed.status).toBe("CLOSED");
  });

  it("chỉ gắn bản ghi sau khi buổi học kết thúc", async () => {
    const service = new LearningService();
    await expect(
      service.attachRecording(
        "session-web-01",
        "https://recording.example/video", "usr-instructor",
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it("giải thích cờ rủi ro và theo dõi hành động hỗ trợ học viên", async () => {
    const service = new LearningService();
    const progress = await service.getClassProgress("class-web-01", {
      from: "2026-01-01T00:00:00.000Z",
      to: "2026-12-31T23:59:59.000Z",
      scoreBelow: 50,
      completionBelow: 60,
    }, "usr-manager", "CENTER_MANAGER");
    expect(progress.thresholds).toEqual({
      scoreBelow: 50,
      completionBelow: 60,
    });
    expect(progress.learners[0]).toMatchObject({
      learnerId: "usr-learner",
      riskLevel: "HIGH",
    });
    expect(progress.learners[0]?.riskReasons).toHaveLength(2);
    await expect(
      service.getClassProgress("class-web-01", { scoreBelow: 0 }, "usr-manager", "CENTER_MANAGER"),
    ).rejects.toThrow(BadRequestException);

    const intervention = await service.createProgressIntervention(
      "class-web-01",
      {
        learnerId: "usr-learner",
        assigneeId: "usr-instructor",
        title: "Hẹn tư vấn học tập",
        notes: "Rà soát tiến độ và lập kế hoạch bù",
        dueAt: "2027-01-10T10:00:00.000Z",
      }, "usr-manager", "CENTER_MANAGER",
    );
    expect(intervention).toMatchObject({
      status: "OPEN",
      ownerId: "usr-instructor",
      createdById: "usr-manager",
      history: [],
    });
    expect(
      (await service.getClassProgress("class-web-01", {}, "usr-manager", "CENTER_MANAGER")).learners[0]
        ?.interventions,
    ).toHaveLength(1);
    await expect(
      service.updateProgressIntervention(
        intervention.id,
        { status: "DONE", outcome: "Đã thống nhất lịch học bù" },
        "other-instructor",
        "INSTRUCTOR",
      ),
    ).rejects.toThrow("người được giao");
    expect(
      (
        await service.updateProgressIntervention(
          intervention.id,
          { status: "IN_PROGRESS" },
          "usr-instructor",
          "INSTRUCTOR",
        )
      ).status,
    ).toBe("IN_PROGRESS");
    expect(
      (
        await service.updateProgressIntervention(
          intervention.id,
          { status: "DONE", outcome: "Đã thống nhất lịch học bù" },
          "usr-instructor",
          "INSTRUCTOR",
        )
      ).status,
    ).toBe("DONE");
    await expect(
      service.updateProgressIntervention(intervention.id, {
        status: "CANCELLED",
        cancellationReason: "Không còn nhu cầu",
      }, "usr-manager", "CENTER_MANAGER"),
    ).rejects.toThrow(ConflictException);
    await expect(
      service.createProgressIntervention("class-web-01", {
        learnerId: "usr-outside",
        assigneeId: "usr-instructor",
        title: "Sai lớp",
        dueAt: "2027-01-10T10:00:00.000Z",
      }, "usr-manager", "CENTER_MANAGER"),
    ).rejects.toThrow(NotFoundException);
  });

  it("bàn giao hành động hỗ trợ cho giảng viên cùng lớp và lưu lịch sử", async () => {
    const service = new LearningService();
    await service.assignInstructor(
      "class-web-01",
      "usr-co-intervention",
      "CO_INSTRUCTOR", "usr-manager",
    );
    const intervention = await service.createProgressIntervention(
      "class-web-01",
      {
        learnerId: "usr-learner",
        assigneeId: "usr-instructor",
        title: "Theo dõi tiến độ",
        dueAt: "2027-02-10T10:00:00.000Z",
      }, "usr-manager", "CENTER_MANAGER",
    );
    await expect(
      service.updateProgressIntervention(
        intervention.id,
        { status: "DONE" },
        "usr-instructor",
        "INSTRUCTOR",
      ),
    ).rejects.toThrow("Kết quả");
    const transferred = await service.transferProgressIntervention(
      intervention.id,
      "usr-co-intervention",
      "Phân công theo chuyên môn",
      "usr-manager", "CENTER_MANAGER",
    );
    expect(transferred).toMatchObject({
      ownerId: "usr-co-intervention",
      status: "OPEN",
    });
    expect(transferred.history).toHaveLength(1);
    expect(
      await service.listMyProgressInterventions("usr-co-intervention"),
    ).toHaveLength(1);
    await expect(
      service.transferProgressIntervention(
        intervention.id,
        "usr-outside",
        "Bàn giao sai người",
        "usr-manager", "CENTER_MANAGER",
      ),
    ).rejects.toThrow("giảng viên");
    await expect(
      service.getClassProgress("class-web-01", {}, "usr-outside", "INSTRUCTOR"),
    ).rejects.toThrow(NotFoundException);
    await expect(
      service.createProgressIntervention(
        "class-web-01",
        {
          learnerId: "usr-learner",
          assigneeId: "usr-instructor",
          title: "Giảng viên không được tự tạo",
          dueAt: "2027-02-10T10:00:00.000Z",
        },
        "usr-instructor",
        "INSTRUCTOR",
      ),
    ).rejects.toThrow(ForbiddenException);
    await expect(
      service.transferProgressIntervention(
        intervention.id,
        "usr-instructor",
        "Không đủ thẩm quyền bàn giao",
        "usr-instructor",
        "INSTRUCTOR",
      ),
    ).rejects.toThrow(ForbiddenException);
  });

  it("lưu bytes, cấp liên kết có chữ ký và kiểm tra checksum khi tải học liệu", async () => {
    const storageRoot = await mkdtemp(join(tmpdir(), "wind-material-"));
    const config = {
      get: (key: keyof Environment): string | undefined =>
        key === "STORAGE_ROOT"
          ? storageRoot
          : key === "STORAGE_SIGNING_SECRET"
            ? "test-storage-signing-secret-at-least-32-characters"
            : undefined,
    } as unknown as ConfigService<Environment, true>;
    const service = new LearningService(undefined, config);

    try {
      const bytes = Buffer.from("%PDF-1.7\nnoi-dung-kiem-thu");
      const material = await service.createMaterial(
        "class-web-01",
        {
          name: "kiem-thu.pdf",
          mimeType: "application/pdf",
          sizeBytes: bytes.length,
          folder: "Tài liệu chung",
          tags: ["bao-mat"],
        },
        {
          originalName: "kiem-thu.pdf",
          mimeType: "application/pdf",
          size: bytes.length,
          buffer: bytes,
        }, "usr-instructor", "INSTRUCTOR",
      );
      expect(material.visibility).toBe("PUBLISHED");

      const access = await service.createMaterialAccess(material.id, "LEARNER", "DOWNLOAD", "usr-learner");
      const signedUrl = new URL(access.url, "http://localhost");
      const expires = Number(signedUrl.searchParams.get("expires"));
      const signature = signedUrl.searchParams.get("signature") ?? "";
      const download = await service.readMaterialDownload(
        material.id,
        expires,
        signature,
        "LEARNER",
        "DOWNLOAD",
        "usr-learner",
      );

      expect(download.buffer.equals(bytes)).toBe(true);
      expect(download.mimeType).toBe("application/pdf");
      await expect(
        service.readMaterialDownload(
          material.id,
          expires,
          `${signature}x`,
          "LEARNER",
          "DOWNLOAD",
          "usr-learner",
        ),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.readMaterialDownload(
          material.id,
          expires,
          signature,
          "LEARNER",
          "PREVIEW",
          "usr-learner",
        ),
      ).rejects.toThrow(BadRequestException);

      const initialFiles = (await readdir(storageRoot, { recursive: true })).filter((filePath) =>
        String(filePath).includes(material.id),
      );
      expect(initialFiles).toHaveLength(1);

      const replacement = Buffer.from("%PDF-1.7\nnoi-dung-phien-ban-moi");
      const versionTwo = await service.replaceMaterialFile(
        material.id,
        { folder: "Tài liệu chung", tags: ["bao-mat", "v2"] },
        {
          originalName: "kiem-thu-v2.pdf",
          mimeType: "application/pdf",
          size: replacement.length,
          buffer: replacement,
        }, "usr-instructor",
      );
      expect(versionTwo).toMatchObject({ version: 2, visibility: "PUBLISHED" });
      const filesAfterReplace = (await readdir(storageRoot, { recursive: true })).filter((filePath) =>
        String(filePath).includes(material.id),
      );
      expect(filesAfterReplace).toHaveLength(1);
      expect(filesAfterReplace).not.toEqual(initialFiles);

      await service.updateMaterial(material.id, { visibility: "HIDDEN" }, "usr-instructor", "INSTRUCTOR");
      await expect(
        service.createMaterialAccess(material.id, "LEARNER", "DOWNLOAD", "usr-learner"),
      ).rejects.toThrow(NotFoundException);
      await service.updateMaterial(material.id, { visibility: "PUBLISHED" }, "usr-instructor", "INSTRUCTOR");
      const currentAccess = await service.createMaterialAccess(
        material.id,
        "LEARNER", "DOWNLOAD", "usr-learner",
      );
      const currentUrl = new URL(currentAccess.url, "http://localhost");
      const currentDownload = await service.readMaterialDownload(
        material.id,
        Number(currentUrl.searchParams.get("expires")),
        currentUrl.searchParams.get("signature") ?? "",
        "LEARNER",
        "DOWNLOAD", "usr-learner",
      );
      expect(currentDownload.buffer.equals(replacement)).toBe(true);
    } finally {
      await rm(storageRoot, { recursive: true, force: true });
    }
  });

  it("tải lên và đọc lại học liệu Word DOCX", async () => {
    const storageRoot = await mkdtemp(join(tmpdir(), "wind-word-material-"));
    const config = {
      get: (key: keyof Environment): string | undefined =>
        key === "STORAGE_ROOT"
          ? storageRoot
          : key === "STORAGE_SIGNING_SECRET"
            ? "test-storage-signing-secret-at-least-32-characters"
            : undefined,
    } as unknown as ConfigService<Environment, true>;
    const service = new LearningService(undefined, config);
    const mimeType =
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    const bytes = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00]);

    try {
      const material = await service.createMaterial(
        "class-web-01",
        {
          name: "Bài giảng đại số.docx",
          mimeType,
          sizeBytes: bytes.length,
          folder: "Tuần 1",
          tags: ["word"],
        },
        {
          originalName: "Bài giảng đại số.docx",
          mimeType,
          size: bytes.length,
          buffer: bytes,
        }, "usr-instructor", "INSTRUCTOR",
      );
      const access = await service.createMaterialAccess(
        material.id,
        "INSTRUCTOR", "DOWNLOAD", "usr-instructor",
      );
      const signedUrl = new URL(access.url, "http://localhost");
      const download = await service.readMaterialDownload(
        material.id,
        Number(signedUrl.searchParams.get("expires")),
        signedUrl.searchParams.get("signature") ?? "",
        "INSTRUCTOR",
        "DOWNLOAD", "usr-instructor",
      );

      expect(material.name).toBe("Bài giảng đại số.docx");
      expect(download.mimeType).toBe(mimeType);
      expect(download.buffer.equals(bytes)).toBe(true);
    } finally {
      await rm(storageRoot, { recursive: true, force: true });
    }
  });

  it("cách ly tệp có chữ ký nguy hiểm và cảnh báo đúng chủ tệp", async () => {
    const storageRoot = await mkdtemp(join(tmpdir(), "wind-quarantine-"));
    const config = {
      get: (key: keyof Environment): string | undefined =>
        key === "STORAGE_ROOT" ? storageRoot : undefined,
    } as unknown as ConfigService<Environment, true>;
    const service = new LearningService(undefined, config);
    try {
      const bytes = Buffer.from(
        "X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*",
      );
      const material = await service.createMaterial(
        "class-web-01",
        {
          name: "anh-bang-chung.png",
          mimeType: "image/png",
          sizeBytes: bytes.length,
          folder: "Tuần 1",
          tags: ["kiem-tra"],
        },
        {
          originalName: "anh-bang-chung.png",
          mimeType: "image/png",
          size: bytes.length,
          buffer: bytes,
        }, "usr-instructor", "INSTRUCTOR",
      );
      expect(material.visibility).toBe("HIDDEN");
      expect(material.quarantineReason).toContain("EICAR");
      await expect(
        service.createMaterialAccess(material.id, "INSTRUCTOR", "DOWNLOAD", "usr-instructor"),
      ).rejects.toThrow("cách ly");
      await expect(
        service.updateMaterial(material.id, { visibility: "DRAFT" }, "usr-instructor", "INSTRUCTOR"),
      ).rejects.toThrow("cách ly");
      expect(
        (await service.listNotifications("usr-instructor")).some(
          (item) => item.type === "MATERIAL_QUARANTINED",
        ),
      ).toBe(true);
    } finally {
      await rm(storageRoot, { recursive: true, force: true });
    }
  });

  it("phát hành mặc định khi tải lên, cho phép ẩn/hiện và chặn quản trị viên xem tệp đã ẩn", async () => {
    const service = new LearningService();
    const bytes = Buffer.from("%PDF-1.7\nnoi-dung-an-hien");
    const material = await service.createMaterial(
      "class-web-01",
      {
        name: "slide-visibility.pdf",
        mimeType: "application/pdf",
        sizeBytes: bytes.length,
        folder: "Tài liệu chung",
        tags: ["visibility"],
      },
      {
        originalName: "slide-visibility.pdf",
        mimeType: "application/pdf",
        size: bytes.length,
        buffer: bytes,
      }, "usr-instructor", "INSTRUCTOR",
    );
    expect(material.visibility).toBe("PUBLISHED");

    const hidden = await service.updateMaterial(material.id, { visibility: "HIDDEN" }, "usr-instructor", "INSTRUCTOR");
    expect(hidden.visibility).toBe("HIDDEN");

    // Học viên không thấy tài liệu đã ẩn trong danh sách và không thể truy cập.
    const learnerSearch = await service.searchAccessibleMaterials({ classId: "class-web-01" }, "usr-learner", "LEARNER");
    expect(learnerSearch.items.some((item) => item.id === material.id)).toBe(false);
    await expect(service.createMaterialAccess(material.id, "LEARNER", "DOWNLOAD", "usr-learner")).rejects.toThrow(NotFoundException);

    // Quản trị viên / Quản lý trung tâm vẫn thấy tài liệu ở trạng thái HIDDEN trong danh sách nhưng không thể xem hoặc tải xuống.
    const managerSearch = await service.searchAccessibleMaterials({ classId: "class-web-01" }, "usr-manager", "CENTER_MANAGER");
    expect(managerSearch.items.find((item) => item.id === material.id)?.visibility).toBe("HIDDEN");
    await expect(service.createMaterialAccess(material.id, "CENTER_MANAGER", "DOWNLOAD", "usr-manager")).rejects.toThrow("đã ẩn");
    await expect(service.createMaterialAccess(material.id, "SYSTEM_ADMIN", "DOWNLOAD", "usr-admin")).rejects.toThrow("đã ẩn");

    // Giảng viên vẫn xem và tải bình thường khi tài liệu đang ẩn.
    const instructorAccess = await service.createMaterialAccess(material.id, "INSTRUCTOR", "DOWNLOAD", "usr-instructor");
    expect(instructorAccess.url).toContain(material.id);

    // Giảng viên bật hiển thị lại thì học viên và quản lý đều truy cập được.
    const republished = await service.updateMaterial(material.id, { visibility: "PUBLISHED" }, "usr-instructor", "INSTRUCTOR");
    expect(republished.visibility).toBe("PUBLISHED");
    await expect(service.createMaterialAccess(material.id, "LEARNER", "DOWNLOAD", "usr-learner")).resolves.toHaveProperty("url");
    await expect(service.createMaterialAccess(material.id, "CENTER_MANAGER", "DOWNLOAD", "usr-manager")).resolves.toHaveProperty("url");
  });

  it("lọc và phân trang học liệu chỉ trong lớp đã ghi danh", async () => {
    const service = new LearningService();
    const firstPage = await service.searchAccessibleMaterials({
      query: "pdf",
      mimeType: "application/pdf",
      page: 1,
      pageSize: 1,
    }, "usr-learner", "LEARNER");
    expect(firstPage.items).toHaveLength(1);
    expect(firstPage.total).toBe(2);
    expect(firstPage.totalPages).toBe(2);

    const outside = await service.searchAccessibleMaterials({
      classId: "class-khong-ghi-danh",
    }, "usr-learner", "LEARNER");
    expect(outside.items).toHaveLength(0);
    expect(outside.total).toBe(0);
  });

  it("giữ nguyên kết quả khi phối hợp bộ lọc học liệu trong bộ nhớ", async () => {
    const service = new LearningService();
    await service.classFolders("class-web-01", "usr-instructor", { kind: "materials", name: "Module Clean Audit" }, "INSTRUCTOR");
    const material = await service.createMaterial("class-web-01", {
      name: "unique-clean-search.pdf",
      mimeType: "application/pdf",
      sizeBytes: 128,
      folder: "Module Clean Audit",
      tags: ["CleanSearchTag"],
    }, undefined, "usr-instructor", "INSTRUCTOR");
    const filters = {
      materialId: material.id,
      classId: material.classId ?? undefined,
      courseId: material.courseId,
      scope: material.scope,
      visibility: material.visibility,
      mimeType: "application/pdf",
      folder: "clean audit",
      tag: "cleansearchtag",
      query: "unique-clean",
      aiOnly: true,
      page: 1,
      pageSize: 1,
    };
    const matching = await service.searchAccessibleMaterials(filters, "usr-instructor", "INSTRUCTOR");
    expect(matching.items.map((item) => item.id)).toEqual([material.id]);
    expect(matching.total).toBe(1);
    expect(matching.totalPages).toBe(1);

    const wrongFolder = await service.searchAccessibleMaterials({ ...filters, folder: "khác" }, "usr-instructor", "INSTRUCTOR");
    expect(wrongFolder.items).toEqual([]);
    const wrongMime = await service.searchAccessibleMaterials({ ...filters, mimeType: "image/png" }, "usr-instructor", "INSTRUCTOR");
    expect(wrongMime.items).toEqual([]);
  });

  it("chuyển học liệu sang lớp khác cập nhật đúng khóa học và chỉ nhận lớp được phân công", async () => {
    const service = new LearningService();
    await service.publishCourse("course-data", "usr-manager");
    const target = await service.createClass({
      courseId: "course-data",
      code: "MOVE-MATERIAL-TARGET",
      name: "Lớp dữ liệu nhận học liệu",
      term: "2027-HK2",
      startAt: "2027-04-01T00:00:00.000Z",
      endAt: "2027-07-01T00:00:00.000Z",
      capacity: 20,
    }, "usr-manager");
    const materialId = "mat-web-intro";
    await expect(
      service.updateMaterial(materialId, { classId: target.id }, "usr-instructor", "INSTRUCTOR"),
    ).rejects.toThrow(NotFoundException);

    await service.assignInstructor(target.id, "usr-instructor", undefined, "usr-manager");
    await expect(service.updateMaterial(materialId, { classId: target.id }, "usr-instructor", "INSTRUCTOR")).rejects.toThrow(BadRequestException);
    const moved = await service.updateMaterial(
      materialId,
      { classId: target.id, folder: "Tài liệu chung" },
      "usr-instructor", "INSTRUCTOR",
    );
    expect(moved).toMatchObject({ classId: target.id, courseId: "course-data", scope: "CLASS", version: 2 });
    const matching = await service.searchAccessibleMaterials(
      { courseId: "course-data", classId: target.id },
      "usr-instructor",
      "INSTRUCTOR",
    );
    expect(matching.items.map((item) => item.id)).toContain(materialId);

    await expect(
      service.updateMaterial(materialId, { classId: null }, "usr-instructor", "INSTRUCTOR"),
    ).rejects.toThrow(BadRequestException);
    await expect(
      service.createMaterial(null, {
        name: "khong-co-lop.pdf",
        mimeType: "application/pdf",
        sizeBytes: 120,
        folder: "Tài liệu chung",
        tags: ["MATERIAL"],
      }, undefined, "usr-instructor", "INSTRUCTOR"),
    ).rejects.toThrow(BadRequestException);

    const archivedTarget = await service.createClass({
      courseId: "course-data",
      code: "MOVE-MATERIAL-ARCHIVED",
      name: "Lớp lưu trữ không nhận học liệu",
      term: "2025-HK1",
      startAt: "2025-01-01T00:00:00.000Z",
      endAt: "2025-02-01T00:00:00.000Z",
      capacity: 20,
    }, "usr-manager");
    await service.assignInstructor(archivedTarget.id, "usr-instructor", undefined, "usr-manager");
    await service.activateClass(archivedTarget.id, "usr-manager");
    await service.closeClass(
      archivedTarget.id,
      "Lớp đã kết thúc và lưu trữ",
      "STANDARD_RETENTION", "usr-manager",
    );
    await expect(
      service.updateMaterial(materialId, { classId: archivedTarget.id }, "usr-instructor", "INSTRUCTOR"),
    ).rejects.toThrow(ConflictException);
  });

  it("cô lập học liệu theo đúng tài khoản giảng viên và học viên", async () => {
    const service = new LearningService();
    const classItem = await service.createClass(
      {
        courseId: "course-web",
        code: "IDENTITY-MATERIAL",
        name: "Lớp kiểm thử quyền học liệu",
        term: "2027-HK3",
        startAt: "2027-09-01T00:00:00.000Z",
        endAt: "2027-11-01T00:00:00.000Z",
        capacity: 20,
      },
      "manager-real",
    );
    await service.assignInstructor(
      classItem.id,
      "instructor-real",
      "PRIMARY",
      "manager-real",
    );
    await service.enrollLearner(classItem.id, "learner-real", "manager-real");
    const material = await service.createMaterial(
      classItem.id,
      {
        name: "identity.pdf",
        mimeType: "application/pdf",
        sizeBytes: 100,
        folder: "Tài liệu chung",
        tags: ["identity"],
      },
      undefined,
      "instructor-real", "INSTRUCTOR",
    );
    await service.updateMaterial(
      material.id,
      { visibility: "PUBLISHED" },
      "instructor-real", "INSTRUCTOR",
    );

    expect(
      (
        await service.listMaterials("INSTRUCTOR", undefined, "instructor-real")
      ).map((item) => item.id),
    ).toContain(material.id);
    expect(
      (
        await service.listMaterials(
          "INSTRUCTOR",
          undefined,
          "instructor-outside",
        )
      ).map((item) => item.id),
    ).not.toContain(material.id);
    expect(
      (
        await service.searchAccessibleMaterials(
          { classId: classItem.id },
          "learner-real", "LEARNER",
        )
      ).items.map((item) => item.id),
    ).toContain(material.id);
    expect(
      (
        await service.searchAccessibleMaterials(
          { classId: classItem.id },
          "learner-outside", "LEARNER",
        )
      ).items,
    ).toHaveLength(0);
    await expect(
      service.createMaterialAccess(material.id, "LEARNER", "DOWNLOAD", "learner-outside"),
    ).rejects.toThrow(NotFoundException);
    await expect(
      service.updateMaterial(
        material.id,
        { folder: "Xâm nhập" },
        "instructor-outside", "INSTRUCTOR",
      ),
    ).rejects.toThrow(NotFoundException);
    await expect(
      service.createMaterial(
        classItem.id,
        {
          name: "outside.pdf",
          mimeType: "application/pdf",
          sizeBytes: 1,
          folder: "",
          tags: [],
        },
        undefined,
        "instructor-outside", "INSTRUCTOR",
      ),
    ).rejects.toThrow(NotFoundException);
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
    }, "usr-manager");
    await service.assignInstructor(classItem.id, "usr-instructor", undefined, "usr-manager");
    const material = await service.createMaterial(classItem.id, {
      name: "tai-lieu-ngoai-lop.pdf",
      mimeType: "application/pdf",
      sizeBytes: 100,
      folder: "Tài liệu chung",
      tags: ["ngoai-lop"],
    }, undefined, "usr-instructor", "INSTRUCTOR");

    await expect(
      service.createMaterialAccess(material.id, "LEARNER", "DOWNLOAD", "usr-learner"),
    ).rejects.toThrow(NotFoundException);
    await expect(
      service.createMaterialAccess(material.id, "LEARNER", "DOWNLOAD", "usr-learner"),
    ).rejects.toThrow("Học viên không thuộc lớp");
  });

  it("không lộ câu hỏi trước khi bắt đầu và trả đúng số lượt làm đề", async () => {
    const service = new LearningService();
    const summaries = await service.listLearnerExamSummaries("class-web-01", "usr-learner");
    expect(summaries[0]?.questionIds).toEqual([]);
    expect(summaries[0]?.questionCount).toBe(2);
    expect(summaries[0]?.remainingAttempts).toBe(2);
    await expect(service.getExamQuestions("exam-mid-web", "usr-learner")).rejects.toThrow(
      "lượt làm bài đang mở",
    );

    await service.startAttempt("exam-mid-web", "usr-learner");
    expect(await service.getExamQuestions("exam-mid-web", "usr-learner")).toHaveLength(2);
    const active = await service.listLearnerExamSummaries("class-web-01", "usr-learner");
    expect(active[0]?.availabilityStatus).toBe("IN_PROGRESS");
  });

  it("retry provider lỗi rồi fallback có dấu vết và link đúng vai trò", async () => {
    const config = {
      get: (key: keyof Environment): string | number | undefined => {
        if (key === "LIVE_PROVIDER_RETRY_LIMIT") return 2;
        if (key === "LIVE_PROVIDER_FALLBACK_ORDER")
          return "ZOOM,JITSI,GOOGLE_MEET";
        if (key === "LIVE_PROVIDER_SIMULATED_FAILURES") return "ZOOM";
        return undefined;
      },
    } as unknown as ConfigService<Environment, true>;
    const service = new LearningService(undefined, config);
    const session = await service.createSession("class-web-01", {
      title: "Buổi học có fallback",
      startsAt: "2026-10-10T02:00:00.000Z",
      endsAt: "2026-10-10T03:00:00.000Z",
      provider: "ZOOM",
    }, "usr-instructor", "INSTRUCTOR");
    expect(session).toMatchObject({
      requestedProvider: "ZOOM",
      provider: "JITSI",
      fallbackUsed: true,
      provisioningAttempts: 1,
    });
    expect(session.attendeeUrl).not.toContain("zoom.us");
    expect(session.hostUrl).not.toBe(session.attendeeUrl);
    expect(session.hostUrl).toContain("role=host");
    expect(session.attendeeUrl).not.toContain("role=host");
  });

  it("tôn trọng provider mặc định đang bật trong cấu hình runtime", async () => {
    const system = new SystemService();
    const service = new LearningService(
      undefined,
      undefined,
      undefined,
      undefined,
      system,
    );
    const session = await service.createSession("class-web-01", {
      title: "Buổi học dùng provider runtime",
      startsAt: "2026-11-10T02:00:00.000Z",
      endsAt: "2026-11-10T03:00:00.000Z",
      provider: "GOOGLE_MEET",
    }, "usr-instructor", "INSTRUCTOR");

    expect(session).toMatchObject({
      requestedProvider: "GOOGLE_MEET",
      provider: "JITSI",
      fallbackUsed: true,
    });
    expect(session.attendeeUrl).toMatch(/^https:\/\/meet\.jit\.si\//);
  });

  it("phiên bản hóa, kiểm tra trùng và xuất bản câu hỏi trước khi đưa vào đề", async () => {
    const service = new LearningService();
    const draft = await service.createQuestion({
      courseId: "course-web",
      type: "SINGLE_CHOICE",
      content: "Giao thức nào mã hóa lưu lượng web?",
      options: ["HTTP", "HTTPS", "FTP"],
      correctAnswers: ["HTTPS"],
      difficulty: 1,
      tags: [" Security ", "web"],
    }, "usr-instructor");
    expect(draft).toMatchObject({
      status: "PUBLISHED",
      version: 1,
      tags: ["security", "web"],
    });
    await expect(
      service.createExam({
        classId: "class-web-01",
        title: "Đề dùng câu nháp",
        questionIds: [draft.id],
        durationMinutes: 15,
        totalScore: 10,
        openAt: "2026-09-01T00:00:00.000Z",
        closeAt: "2026-10-01T00:00:00.000Z",
        attemptLimit: 1,
      }, "usr-instructor"),
    ).resolves.toMatchObject({ status: "PUBLISHED" });
    await expect(
      service.createQuestion({
        courseId: "course-web",
        type: "SINGLE_CHOICE",
        content: "  Giao thức nào mã hóa   lưu lượng WEB? ",
        options: ["HTTP", "HTTPS"],
        correctAnswers: ["HTTPS"],
        difficulty: 1,
        tags: [],
      }, "usr-instructor"),
    ).rejects.toThrow(ConflictException);
    const published = draft;
    const versionTwo = await service.updateQuestion(published.id, {
      ...published,
      content: "Giao thức nào bảo vệ lưu lượng web?",
      difficulty: 2,
    }, "usr-instructor");
    expect(versionTwo).toMatchObject({
      version: 2,
      status: "PUBLISHED",
      supersedesId: published.id,
      familyId: published.familyId,
    });
    expect(
      (
        await service.listQuestions({
          courseId: "course-web",
          status: "PUBLISHED",
        }, { actorId: "usr-manager", actorRole: "CENTER_MANAGER" })
      ).find((item) => item.familyId === published.familyId)?.id,
    ).toBe(versionTwo.id);
    await expect(
      service.updateQuestion(published.id, {
        ...published,
        content: "Không được sửa bản cũ",
      }, "usr-instructor"),
    ).rejects.toThrow(ConflictException);
    expect(
      (await service.listQuestions({ tag: "security", difficulty: 2 }, { actorId: "usr-manager", actorRole: "CENTER_MANAGER" }))[0]?.id,
    ).toBe(versionTwo.id);
    expect(
      (
        await service.listQuestions({
          courseId: "course-web",
          status: "PUBLISHED",
        }, { actorId: "usr-manager", actorRole: "CENTER_MANAGER" })
      ).find((item) => item.familyId === published.familyId)?.id,
    ).toBe(versionTwo.id);
    expect(
      (
        await service.createExam({
          classId: "class-web-01",
          title: "Đề dùng câu đã duyệt",
          questionIds: [versionTwo.id],
          durationMinutes: 15,
          totalScore: 10,
          openAt: "2026-09-01T00:00:00.000Z",
          closeAt: "2026-10-01T00:00:00.000Z",
          attemptLimit: 1,
        }, "usr-instructor")
      ).status,
    ).toBe("PUBLISHED");
  });

  it("bàn giao giảng viên chính nguyên tử và chặn yêu cầu dùng nguồn đã cũ", async () => {
    const service = new LearningService();
    const classItem = await service.createClass({
      courseId: "course-web",
      code: "PRIMARY-HANDOFF",
      name: "Lớp bàn giao giảng viên",
      term: "2027",
      startAt: "2027-01-01T00:00:00.000Z",
      endAt: "2027-06-01T00:00:00.000Z",
      capacity: 20,
    }, "usr-manager");
    await service.assignInstructor(
      classItem.id,
      "instructor-primary",
      "PRIMARY", "usr-manager",
    );
    await service.assignInstructor(
      classItem.id,
      "instructor-next",
      "CO_INSTRUCTOR", "usr-manager",
    );
    await expect(
      service.assignInstructor(classItem.id, "instructor-next", "PRIMARY", "usr-manager"),
    ).rejects.toThrow("luồng bàn giao");
    await service.transferPrimaryInstructor(
      classItem.id,
      "instructor-primary",
      "instructor-next",
      "Bàn giao theo kế hoạch nhân sự", "usr-manager",
    );
    const roster = await service.getClassRoster(classItem.id);
    expect(
      roster.instructors
        .filter((item) => item.role === "PRIMARY")
        .map((item) => item.instructorId),
    ).toEqual(["instructor-next"]);
    await expect(
      service.transferPrimaryInstructor(
        classItem.id,
        "instructor-primary",
        "instructor-third",
        "Yêu cầu cạnh tranh đã cũ", "usr-manager",
      ),
    ).rejects.toThrow("tải lại");
  });

  it.each([["True", "False"], ["Đúng (True)", "Sai (False)"]])("lưu câu đúng sai đa ngôn ngữ %s", async (positive, negative) => {
    const service = new LearningService();
    const question = await service.createQuestion({ courseId: "course-web", type: "TRUE_FALSE", content: "HTTP is an application layer protocol.", options: [positive, negative], correctAnswers: [positive], difficulty: 1, tags: [] }, "usr-instructor");
    expect(question.options).toEqual([positive, negative]);
    expect(question.correctAnswers).toEqual([positive]);
  });

  it("bỏ đọc tài liệu khi chọn web nhưng vẫn kiểm tra quyền lớp học", async () => {
    const service = new LearningService();
    const context = await service.getExamGenerationContext("class-web-01", "usr-instructor", [], true);
    expect(context.sourceFiles).toEqual([]);
    expect(context.courseId).toBe("course-web");
    await expect(service.getExamGenerationContext("class-web-01", "unauthorized-user", [], true)).rejects.toThrow();
  });

  it.each(["same", "answer", "options", "type", "difficulty", "case"])("không tái dùng câu ngân hàng sai ngữ nghĩa: %s", async (variant) => {
    const service = new LearningService();
    const base = { courseId: "course-web", type: "SINGLE_CHOICE" as const, content: "Select the correct HTTP method for this operation.", options: ["GET", "POST"], correctAnswers: ["GET"], difficulty: 1 as const, tags: [] };
    const original = await service.createQuestion(base, "usr-instructor");
    const generated = { ...base, confidence: 1, warnings: [],
      ...(variant === "answer" ? { correctAnswers: ["POST"] } : {}),
      ...(variant === "options" ? { options: ["POST", "GET"] } : {}),
      ...(variant === "type" ? { type: "MULTIPLE_CHOICE" as const, correctAnswers: ["GET", "POST"] } : {}),
      ...(variant === "difficulty" ? { difficulty: 2 as const } : {}),
      ...(variant === "case" ? { content: base.content.toUpperCase() } : {}),
    };
    const exam = await service.createGeneratedExam({ classId: "class-web-01", title: "AI semantic identity", durationMinutes: 30, totalScore: 10, openAt: "2026-09-10T00:00:00Z", closeAt: "2026-10-10T00:00:00Z", attemptLimit: 1 }, [generated], base.courseId, { mode: "WEB_SEARCH", materialIds: [], sources: [] }, randomUUID(), "usr-instructor");
    if (variant === "same") expect(exam.questionIds).toEqual([original.id]);
    else {
      expect(exam.questionIds[0]).not.toBe(original.id);
      const stored = (await service.listQuestions({ courseId: base.courseId, status: "PUBLISHED" }, { actorId: "usr-manager", actorRole: "CENTER_MANAGER" })).find((question) => question.id === exam.questionIds[0]);
      expect(stored).toMatchObject({ type: generated.type, content: generated.content, options: generated.options, correctAnswers: generated.correctAnswers, difficulty: generated.difficulty });
    }
  });

  it("tạo đề AI nháp và gắn nguồn cho câu hỏi sinh tự động", async () => {
    const service = new LearningService();
    const context = await service.getExamGenerationContext("class-web-01", "usr-instructor");
    expect(context).toMatchObject({
      courseId: "course-web",
      courseName: "Phát triển Web Full-stack",
    });
    expect(context.sourceFiles).toHaveLength(0);
    const exam = await service.createGeneratedExam(
      {
        classId: "class-web-01",
        title: "Đề AI về REST",
        durationMinutes: 30,
        totalScore: 10,
        openAt: "2026-09-10T00:00:00.000Z",
        closeAt: "2026-10-10T00:00:00.000Z",
        attemptLimit: 1,
        shuffleQuestions: false,
      },
      [
        {
          type: "SHORT_ANSWER",
          content: "HTTP là chữ viết tắt của cụm từ nào?",
          options: [],
          correctAnswers: ["Hypertext Transfer Protocol"],
          difficulty: 1,
          tags: ["http"],
          confidence: 0.95,
          warnings: [],
        },
      ],
      context.courseId,
      {
        mode: "WEB_SEARCH",
        materialIds: [],
        sources: [
          {
            title: "MDN HTTP",
            url: "https://developer.mozilla.org/docs/Web/HTTP",
          },
        ],
      }, randomUUID(), "usr-instructor",
    );
    expect(exam.status).toBe("PUBLISHED");
    expect(exam.questionIds).toHaveLength(1);
    expect(exam.aiContext).toMatchObject({
      mode: "WEB_SEARCH",
      materialIds: [],
    });
    const generated = (
      await service.listQuestions({ courseId: "course-web", status: "PUBLISHED" }, { actorId: "usr-manager", actorRole: "CENTER_MANAGER" })
    ).find((item) => item.id === exam.questionIds[0]);
    expect(generated?.tags).toEqual(
      expect.arrayContaining(["ai-generated", "nguồn-web"]),
    );
    expect(exam.status).toBe("PUBLISHED");
    const originalId = exam.questionIds[0]!;
    await expect(service.editExamQuestion(exam.id, originalId, { content: "Nội dung hợp lệ", options: [], correctAnswers: ["Đáp án"], expectedVersion: exam.version }, "unauthorized")).rejects.toThrow();
    const edited = await service.editExamQuestion(exam.id, originalId, { content: "HTTP được viết đầy đủ như thế nào?", options: [], correctAnswers: ["Hypertext Transfer Protocol"], expectedVersion: exam.version }, "usr-instructor");
    expect(edited.id).not.toBe(originalId);
    expect(edited.status).toBe("PUBLISHED");
    expect((await service.listQuestions({ courseId: "course-web" }, { actorId: "usr-manager", actorRole: "CENTER_MANAGER" })).find((question) => question.id === originalId)?.content).toBe(generated?.content);
    await expect(service.submitExamForReview(exam.id, "usr-instructor", true, 999)).rejects.toThrow("thay đổi");
    expect((await service.submitExamForReview(exam.id, "usr-instructor", true)).status).toBe(
      "PUBLISHED",
    );
    expect((await service.listQuestions({ courseId: "course-web" }, { actorId: "usr-manager", actorRole: "CENTER_MANAGER" })).find((question) => question.id === edited.id)?.status).toBe("PUBLISHED");
    await expect(service.editExamQuestion(exam.id, edited.id, { content: "Nội dung cập nhật khi công bố", options: [], correctAnswers: ["Đáp án"], expectedVersion: 2 }, "usr-instructor")).resolves.toMatchObject({ content: "Nội dung cập nhật khi công bố" });
  });

  it("phân bổ điểm từng câu chính xác và dùng đúng trọng số khi chấm tự động", async () => {
    const service = new LearningService();
    const exam = await service.createExam({
      classId: "class-web-01",
      title: "Đề có trọng số",
      questionIds: ["q-rest-01", "q-db-01"],
      durationMinutes: 30,
      totalScore: 10,
      openAt: "2026-09-01T00:00:00.000Z",
      closeAt: "2026-10-01T00:00:00.000Z",
      attemptLimit: 1,
      scoreAllocations: [
        { questionId: "q-rest-01", score: 7 },
        { questionId: "q-db-01", score: 3 },
      ],
    }, "usr-instructor");
    expect(exam.questionScores).toEqual({ "q-rest-01": 7, "q-db-01": 3 });
    await service.submitExamForReview(exam.id, "usr-instructor");
    const attempt = await service.startAttempt(exam.id, "usr-learner");
    await service.saveAnswer(attempt.id, "q-rest-01", ["PATCH"], "usr-learner");
    await service.saveAnswer(attempt.id, "q-db-01", ["Sai"], "usr-learner");
    expect((await service.submitAttempt(attempt.id, "usr-learner")).score).toBe(7);
    await expect(
      service.createExam({
        classId: "class-web-01",
        title: "Đề sai tổng điểm",
        questionIds: ["q-rest-01", "q-db-01"],
        durationMinutes: 30,
        totalScore: 10,
        openAt: "2026-09-01T00:00:00.000Z",
        closeAt: "2026-10-01T00:00:00.000Z",
        attemptLimit: 1,
        scoreAllocations: [
          { questionId: "q-rest-01", score: 8 },
          { questionId: "q-db-01", score: 3 },
        ],
      }, "usr-instructor"),
    ).rejects.toThrow("Tổng điểm từng câu");
  });

  it("sửa đề nháp theo version và cho người duyệt xem đề đang chờ", async () => {
    const service = new LearningService();
    const draft = await service.createExam({
      classId: "class-web-01",
      title: "Đề cần chỉnh",
      questionIds: ["q-rest-01"],
      durationMinutes: 20,
      totalScore: 10,
      openAt: "2026-09-10T00:00:00.000Z",
      closeAt: "2026-10-10T00:00:00.000Z",
      attemptLimit: 1,
    }, "usr-instructor");
    const updated = await service.updateExam(draft.id, {
      classId: draft.classId,
      title: "Đề đã chỉnh",
      questionIds: ["q-rest-01", "q-db-01"],
      durationMinutes: 30,
      totalScore: 10,
      openAt: draft.openAt,
      closeAt: draft.closeAt,
      attemptLimit: 2,
      scoreAllocations: [
        { questionId: "q-rest-01", score: 6 },
        { questionId: "q-db-01", score: 4 },
      ],
      expectedVersion: draft.version,
    }, "usr-instructor");
    expect(updated).toMatchObject({
      title: "Đề đã chỉnh",
      version: 2,
      attemptLimit: 2,
      questionScores: { "q-rest-01": 6, "q-db-01": 4 },
    });
    await expect(
      service.updateExam(draft.id, {
        classId: draft.classId,
        title: "Ghi đè cũ",
        questionIds: ["q-rest-01"],
        durationMinutes: 20,
        totalScore: 10,
        openAt: draft.openAt,
        closeAt: draft.closeAt,
        attemptLimit: 1,
        expectedVersion: 1,
      }, "usr-instructor"),
    ).rejects.toThrow("tải lại");
    await service.submitExamForReview(draft.id, "usr-instructor");
    expect(await service.getReviewerExamPreview(draft.id, "usr-manager")).toHaveLength(2);
    await expect(
      service.updateExam(draft.id, {
        classId: draft.classId,
        title: "Đề được cập nhật",
        questionIds: ["q-rest-01"],
        durationMinutes: 20,
        totalScore: 10,
        openAt: draft.openAt,
        closeAt: draft.closeAt,
        attemptLimit: 1,
        expectedVersion: 2,
      }, "usr-instructor"),
    ).resolves.toMatchObject({ title: "Đề được cập nhật", status: "PUBLISHED" });
  });

  it("cho phép cập nhật metadata an toàn khi đề đã có lượt làm bài và khóa thay đổi cấu trúc", async () => {
    const service = new LearningService();
    const exam = await service.createExam({
      classId: "class-web-01",
      title: "Đề đang mở",
      questionIds: ["q-rest-01"],
      durationMinutes: 20,
      totalScore: 10,
      openAt: "2026-08-25T00:00:00.000Z",
      closeAt: "2026-12-10T00:00:00.000Z",
      attemptLimit: 2,
    }, "usr-instructor");
    await service.submitExamForReview(exam.id, "usr-instructor");
    const first = await service.startAttempt(exam.id, "usr-learner");
    await service.submitAttempt(first.id, "usr-learner");
    await service.startAttempt(exam.id, "usr-learner");

    const updated = await service.updateExam(exam.id, {
      classId: exam.classId,
      title: "Đề đã cập nhật hạn nộp",
      questionIds: ["q-rest-01"],
      durationMinutes: 20,
      totalScore: 10,
      scoreAllocations: [{ questionId: "q-rest-01", score: 10 }],
      openAt: exam.openAt,
      closeAt: "2026-12-15T00:00:00.000Z",
      attemptLimit: 3,
      shuffleQuestions: true,
      expectedVersion: exam.version,
    }, "usr-instructor");
    expect(updated).toMatchObject({
      title: "Đề đã cập nhật hạn nộp",
      attemptLimit: 3,
      shuffleQuestions: true,
      version: 2,
    });

    await expect(
      service.updateExam(exam.id, {
        classId: exam.classId,
        title: "Hạ giới hạn",
        questionIds: ["q-rest-01"],
        durationMinutes: 20,
        totalScore: 10,
        scoreAllocations: [{ questionId: "q-rest-01", score: 10 }],
        openAt: exam.openAt,
        closeAt: updated.closeAt,
        attemptLimit: 1,
        expectedVersion: updated.version,
      }, "usr-instructor"),
    ).rejects.toThrow("Số lượt làm bài không được nhỏ hơn");

    await expect(
      service.updateExam(exam.id, {
        classId: exam.classId,
        title: "Đổi cấu trúc",
        questionIds: ["q-rest-01", "q-db-01"],
        durationMinutes: 20,
        totalScore: 10,
        openAt: exam.openAt,
        closeAt: updated.closeAt,
        attemptLimit: 3,
        expectedVersion: updated.version,
      }, "usr-instructor"),
    ).rejects.toThrow("Đề đã có lượt làm bài nên không thể sửa câu hỏi, thời lượng hoặc thang điểm.");
  });

  it("giữ nguyên Markdown và LaTeX khi chuẩn hóa nội dung câu hỏi", async () => {
    const service = new LearningService();
    const question = await service.createQuestion({
      courseId: "course-web",
      type: "SINGLE_CHOICE",
      content: "**Tính giá trị** của $x$:\n\n$$\n2x + 4 = 10\n$$",
      options: ["$x = 2$", "$x = 3$"],
      correctAnswers: ["$x = 3$"],
      difficulty: 1,
      tags: ["toán"],
    }, "usr-instructor");

    expect(question.content).toContain("**Tính giá trị**");
    expect(question.content).toContain("\n\n$$\n2x + 4 = 10\n$$");
    expect(question.options).toEqual(["$x = 2$", "$x = 3$"]);
  });

  it("tải, kế thừa và xóa ảnh câu hỏi theo phiên bản", async () => {
    const service = new LearningService();
    const draft = await service.createQuestion({
      courseId: "course-web",
      type: "TRUE_FALSE",
      content: "Sơ đồ minh họa này có hợp lệ không?",
      options: ["Đúng", "Sai"],
      correctAnswers: ["Đúng"],
      difficulty: 1,
      tags: ["sơ-đồ"],
    }, "usr-instructor");
    const png = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00,
    ]);

    const withImage = await service.uploadQuestionImage(draft.id, {
      originalName: "Sơ đồ hệ thống.png",
      mimeType: "image/png",
      size: png.length,
      buffer: png,
    }, "usr-instructor");
    expect(withImage).toMatchObject({
      imageName: "Sơ đồ hệ thống.png",
      imageMimeType: "image/png",
      imageSizeBytes: png.length,
    });
    expect(
      (
        await service.readQuestionImage(
          withImage.id,
          "INSTRUCTOR",
          "usr-instructor",
        )
      ).buffer,
    ).toEqual(png);

    const next = await service.updateQuestion(withImage.id, {
      ...withImage,
      content: "Sơ đồ minh họa này có còn hợp lệ không?",
    }, "usr-instructor");
    expect(next.imageName).toBe("Sơ đồ hệ thống.png");
    expect(
      (await service.readQuestionImage(next.id, "INSTRUCTOR", "usr-instructor"))
        .buffer,
    ).toEqual(png);
    const removed = await service.removeQuestionImage(next.id, "usr-instructor");
    expect(removed.imageUrl).toBeUndefined();
    await expect(
      service.readQuestionImage(removed.id, "INSTRUCTOR", "usr-instructor"),
    ).rejects.toThrow(NotFoundException);
  });

  it("từ chối ảnh câu hỏi giả mạo định dạng", async () => {
    const service = new LearningService();
    await expect(
      service.uploadQuestionImage("q-rest-01", {
        originalName: "gia-mao.png",
        mimeType: "image/png",
        size: 8,
        buffer: Buffer.from("notimage"),
      }, "usr-instructor"),
    ).rejects.toThrow("không khớp định dạng");
  });

  it("chỉ trả ảnh trong đề khi học viên có lượt làm bài còn hiệu lực", async () => {
    const service = new LearningService();
    const png = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00,
    ]);
    const draft = await service.createQuestion({
      courseId: "course-web",
      type: "TRUE_FALSE",
      content: "Ảnh HTTP minh họa giao thức web.",
      options: ["Đúng", "Sai"],
      correctAnswers: ["Đúng"],
      difficulty: 1,
      tags: ["http-image"],
    }, "usr-instructor");
    const withImage = await service.uploadQuestionImage(draft.id, {
      originalName: "http.png",
      mimeType: "image/png",
      size: png.length,
      buffer: png,
    }, "usr-instructor");
    const exam = await service.createExam({
      classId: "class-web-01",
      title: "Đề ảnh có kiểm soát",
      questionIds: [withImage.id],
      durationMinutes: 30,
      totalScore: 10,
      openAt: "2026-09-01T00:00:00.000Z",
      closeAt: "2026-12-01T00:00:00.000Z",
      attemptLimit: 1,
    }, "usr-instructor");
    await service.submitExamForReview(exam.id, "usr-instructor");

    await expect(
      service.readQuestionImage(withImage.id, "LEARNER", "usr-learner"),
    ).rejects.toThrow(NotFoundException);
    await service.startAttempt(exam.id, "usr-learner");
    expect(
      (await service.readQuestionImage(withImage.id, "LEARNER", "usr-learner"))
        .buffer,
    ).toEqual(png);
  });

  it("tự động phê duyệt câu hỏi theo cấu hình mặc định", async () => {
    const system = new SystemService();
    const service = new LearningService(
      undefined,
      undefined,
      undefined,
      undefined,
      system,
    );
    const draft = await service.createQuestion({
      courseId: "course-web",
      type: "TRUE_FALSE",
      content: "HTTP là một giao thức ở tầng ứng dụng.",
      options: ["Đúng", "Sai"],
      correctAnswers: ["Đúng"],
      difficulty: 1,
      tags: ["http"],
    }, "usr-instructor");
    expect(draft.status).toBe("PUBLISHED");
  });


  it("nhập câu hỏi hàng loạt và trả kết quả riêng cho từng dòng", async () => {
    const service = new LearningService();
    const results = await service.importQuestions([
      {
        courseId: "course-web",
        type: "TRUE_FALSE",
        content: "TLS giúp mã hóa kết nối mạng.",
        options: ["Đúng", "Sai"],
        correctAnswers: ["Đúng"],
        difficulty: 1,
        tags: ["tls"],
      },
      {
        courseId: "course-web",
        type: "SINGLE_CHOICE",
        content: "Câu hỏi thiếu lựa chọn hợp lệ",
        options: ["Một"],
        correctAnswers: ["Một"],
        difficulty: 1,
        tags: [],
      },
    ], "usr-instructor");
    expect(results.map((item) => item.status)).toEqual(["IMPORTED", "FAILED"]);
    expect(results[0]?.questionId).toBeTruthy();
    expect(results[1]?.message).toContain("hai lựa chọn");
  });

  it("công bố đề và gửi thông báo", async () => {
    const system = new SystemService();
    const service = new LearningService(
      undefined,
      undefined,
      undefined,
      undefined,
      system,
    );
    const exam = await service.createExam({
      classId: "class-web-01",
      title: "Đề duyệt tự động",
      questionIds: ["q-rest-01"],
      durationMinutes: 30,
      totalScore: 10,
      openAt: "2026-09-01T00:00:00.000Z",
      closeAt: "2026-12-01T00:00:00.000Z",
      attemptLimit: 1,
    }, "usr-instructor");

    expect((await service.submitExamForReview(exam.id, "usr-instructor")).status).toBe(
      "PUBLISHED",
    );
    expect(
      (await service.listNotifications("usr-instructor")).some((item) =>
        item.type === "EXAM_PUBLISHED",
      ),
    ).toBe(true);
  });

  it("cô lập đề, lượt làm và quyền chấm theo giảng viên được phân công", async () => {
    const service = new LearningService();
    const classItem = await service.createClass(
      {
        courseId: "course-web",
        code: "IDENTITY-EXAM",
        name: "Lớp kiểm thử quyền đề",
        term: "2026-HK3",
        startAt: "2026-08-01T00:00:00.000Z",
        endAt: "2026-12-15T00:00:00.000Z",
        capacity: 20,
      },
      "manager-real",
    );
    await service.assignInstructor(
      classItem.id,
      "instructor-real",
      "PRIMARY",
      "manager-real",
    );
    await service.enrollLearner(classItem.id, "learner-real", "manager-real");
    const examInput = {
      classId: classItem.id,
      title: "Đề kiểm thử phân quyền",
      questionIds: ["q-rest-01"],
      durationMinutes: 30,
      totalScore: 10,
      openAt: "2026-08-01T00:00:00.000Z",
      closeAt: "2026-12-01T00:00:00.000Z",
      attemptLimit: 1,
    };

    await expect(
      service.createExam(examInput, "instructor-outside"),
    ).rejects.toThrow(NotFoundException);
    const exam = await service.createExam(examInput, "instructor-real");
    expect(
      (await service.listExams("INSTRUCTOR", "instructor-real")).map(
        (item) => item.id,
      ),
    ).toContain(exam.id);
    expect(
      (await service.listExams("INSTRUCTOR", "instructor-outside")).map(
        (item) => item.id,
      ),
    ).not.toContain(exam.id);
    await expect(
      service.submitExamForReview(exam.id, "instructor-outside"),
    ).rejects.toThrow(NotFoundException);
    await service.submitExamForReview(exam.id, "instructor-real");
    const attempt = await service.startAttempt(exam.id, "learner-real");
    await service.saveAnswer(
      attempt.id,
      "q-rest-01",
      ["PATCH"],
      "learner-real",
    );
    await service.submitAttempt(attempt.id, "learner-real");

    expect(
      await service.listAttempts(exam.id, "instructor-outside"),
    ).toHaveLength(0);
    expect(
      await service.getAttemptReview(attempt.id, "instructor-real"),
    ).toMatchObject({
      exam: { id: exam.id, title: exam.title },
      learner: { id: "learner-real" },
      questions: [{ questionId: "q-rest-01", submittedAnswers: ["PATCH"] }],
    });
    await expect(
      service.getAttemptReview(attempt.id, "instructor-outside"),
    ).rejects.toThrow(NotFoundException);
    await expect(
      service.gradeAttempt(
        attempt.id,
        9,
        "Chấm bài",
        undefined,
        "instructor-outside",
      ),
    ).rejects.toThrow(NotFoundException);
    expect(
      await service.gradeAttempt(
        attempt.id,
        9,
        "Chấm bài",
        "Điều chỉnh theo đáp án",
        "instructor-real",
      ),
    ).toMatchObject({ status: "GRADED", score: 9 });
  });

  it("giữ thứ tự gốc cho bản xem của giảng viên dù đề bật xáo câu hỏi", async () => {
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
    const firstExam = await service.createExam(examInput, "usr-instructor");
    const secondExam = await service.createExam({
      ...examInput,
      title: "Đề xáo câu hỏi bản sao",
    }, "usr-instructor");
    expect(firstExam.questionIds).toEqual(examInput.questionIds);
    expect(secondExam.questionIds).toEqual(examInput.questionIds);
    expect(firstExam).toMatchObject({
      shuffleQuestions: true,
      randomSeed: "lop-web-dot-1",
    });
    expect(
      (await service.getInstructorExamPreview(firstExam.id, "usr-instructor")).map(
        (question) => question.id,
      ),
    ).toEqual(examInput.questionIds);
    await expect(
      service.getInstructorExamPreview(firstExam.id, "instructor-outside"),
    ).rejects.toThrow(NotFoundException);
  });

  it("trả điểm mới nhất sau khi sửa", async () => {
    const service = new LearningService();

    const attempt = await service.startAttempt("exam-mid-web", "usr-learner");
    await service.saveAnswer(attempt.id, "q-rest-01", ["PATCH"], "usr-learner");
    await service.submitAttempt(attempt.id, "usr-learner");
    await service.gradeAttempt(
      attempt.id,
      8,
      "Điều chỉnh sau phúc khảo",
      undefined,
      "usr-instructor",
    );
    expect((await service.getAttempt(attempt.id)).score).toBe(8);
  });

  it("chấm tự luận lần đầu không đòi lý do dù phần trắc nghiệm đã có điểm", async () => {
    const service = new LearningService();
    const essay = await service.createQuestion({
      courseId: "course-web",
      type: "ESSAY",
      content: "Phân tích ưu điểm của REST trong một hệ thống thực tế.",
      options: [],
      correctAnswers: [],
      difficulty: 2,
      tags: ["essay"],
    }, "usr-instructor");
    const exam = await service.createExam({
      classId: "class-web-01",
      title: "Đề hỗn hợp chấm tay",
      questionIds: ["q-rest-01", essay.id],
      durationMinutes: 30,
      totalScore: 10,
      openAt: "2026-09-01T00:00:00.000Z",
      closeAt: "2026-12-01T00:00:00.000Z",
      attemptLimit: 1,
    }, "usr-instructor");
    await service.submitExamForReview(exam.id, "usr-instructor");
    const attempt = await service.startAttempt(exam.id, "usr-learner");
    await service.saveAnswer(attempt.id, "q-rest-01", ["PATCH"], "usr-learner");
    await service.saveAnswer(attempt.id, essay.id, [
      "REST dễ quan sát, cache và tích hợp.",
    ], "usr-learner");
    const submitted = await service.submitAttempt(attempt.id, "usr-learner");
    expect(submitted).toMatchObject({ status: "SUBMITTED" });
    // Điểm phần trắc nghiệm chưa công bố không được trả cho học viên, nhưng vẫn lưu cho giảng viên chấm tiếp.
    expect(submitted).not.toHaveProperty("score");
    expect((await service.getAttempt(attempt.id)).score).toBe(5);
    expect(
      await service.gradeAttempt(
        attempt.id,
        0,
        "Bài phân tích đúng trọng tâm.",
        undefined,
        "usr-instructor",
        [{ questionId: essay.id, score: 4 }],
      ),
    ).toMatchObject({ status: "GRADED", score: 9 });
    await expect(
      service.gradeAttempt(attempt.id, 8, "Sửa lại điểm", undefined, "usr-instructor"),
    ).resolves.toMatchObject({ status: "GRADED", score: 8 });
  });

  it("không nhận autosave sau khi thời lượng làm bài kết thúc", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-08-25T02:00:00.000Z"));
      const service = new LearningService();
      const attempt = await service.startAttempt("exam-mid-web", "usr-learner");
      vi.setSystemTime(new Date("2026-08-25T02:46:00.000Z"));
      await expect(
        service.saveAnswer(attempt.id, "q-rest-01", ["PATCH"], "usr-learner"),
      ).rejects.toThrow("hết thời gian");
    } finally {
      vi.useRealTimers();
    }
  });

  it("chỉ công bố kết quả của chính học viên và chặn phúc khảo trùng", async () => {
    const service = new LearningService();
    const attempt = await service.startAttempt("exam-mid-web", "usr-learner");
    await service.saveAnswer(attempt.id, "q-rest-01", ["PATCH"], "usr-learner");
    await service.submitAttempt(attempt.id, "usr-learner");

    const result = await service.getLearnerResult(attempt.id, "usr-learner");
    expect(result.attempt.gradePublishedAt).toBeTruthy();
    expect(result.answerBreakdown).toHaveLength(2);
    // Đề còn mở: chỉ có tổng điểm, điểm từng câu bị ẩn tới khi đề đóng để không thành công cụ dò đáp án.
    expect(result.attempt.score).toBe(5);
    expect(result.answerBreakdown[0]).not.toHaveProperty("awardedScore");
    expect(result.breakdownVisibleAt).toBe(result.exam.closeAt);
    const openTime = Date.now();
    vi.setSystemTime(new Date(new Date(result.exam.closeAt).getTime() + 60_000));
    const afterClose = await service.getLearnerResult(attempt.id, "usr-learner");
    expect(afterClose.answerBreakdown[0]?.awardedScore).toBe(5);
    expect(afterClose).not.toHaveProperty("breakdownVisibleAt");
    vi.setSystemTime(new Date(openTime));
    const request = await service.requestRegrade(
      attempt.id,
      "Đề nghị kiểm tra lại câu số hai", "usr-learner",
    );
    expect(request.status).toBe("OPEN");
    await expect(
      service.requestRegrade(attempt.id, "Đề nghị kiểm tra lại lần nữa", "usr-learner"),
    ).rejects.toThrow(ConflictException);
    expect(await service.claimRegrade(request.id, "usr-instructor")).toMatchObject({
      status: "IN_REVIEW",
      assignedToId: "usr-instructor",
    });
    // Người khác không nhả được; chính người nhận nhả về hàng đợi rồi nhận lại để xử lý tiếp.
    await expect(service.releaseRegrade(request.id, "usr-other")).rejects.toThrow(ConflictException);
    expect(await service.releaseRegrade(request.id, "usr-instructor")).toMatchObject({ status: "OPEN" });
    expect(await service.claimRegrade(request.id, "usr-instructor")).toMatchObject({ status: "IN_REVIEW", assignedToId: "usr-instructor" });
    expect(
      await service.resolveRegrade(request.id, {
        decision: "APPROVE",
        resolution: "Chấp nhận một phần đáp án tương đương",
        score: 6,
        feedback: "Đã kiểm tra lại theo đáp án tương đương.",
      }, "usr-instructor"),
    ).toMatchObject({ status: "RESOLVED", resolvedById: "usr-instructor" });
    expect((await service.getLearnerResult(attempt.id, "usr-learner")).attempt.score).toBe(6);
    await expect(
      service.getLearnerResult("attempt-khong-thuoc-ve-minh", "usr-learner"),
    ).rejects.toThrow(NotFoundException);
  });

  it("chặn HTML nguy hiểm và giới hạn tần suất đăng bài trên diễn đàn", async () => {
    const service = new LearningService();
    await expect(
      service.createPost("topic-rest", "<script>alert(1)</script>", "usr-learner"),
    ).rejects.toThrow(BadRequestException);
    await service.createPost("topic-rest", "Phản hồi hợp lệ số một", "usr-learner");
    await service.createPost("topic-rest", "Phản hồi hợp lệ số hai", "usr-learner");
    await service.createPost("topic-rest", "Phản hồi hợp lệ số ba", "usr-learner");
    await service.createPost("topic-rest", "Phản hồi hợp lệ số bốn", "usr-learner");
    await expect(
      service.createPost("topic-rest", "Phản hồi vượt giới hạn", "usr-learner"),
    ).rejects.toThrow("vượt giới hạn");
  });

  it("phân tích bài đã chấm, cảnh báo mẫu nhỏ và giữ kín thống kê câu khi đề còn mở", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-09-10T02:00:00.000Z"));
      const service = new LearningService();
      const first = await service.startAttempt("exam-mid-web", "usr-learner");
      await service.saveAnswer(first.id, "q-rest-01", ["PATCH"], "usr-learner");
      await service.saveAnswer(first.id, "q-db-01", ["Đúng"], "usr-learner");
      await service.submitAttempt(first.id, "usr-learner");
      const second = await service.startAttempt("exam-mid-web", "usr-learner");
      await service.saveAnswer(second.id, "q-rest-01", ["GET"], "usr-learner");
      await service.saveAnswer(second.id, "q-db-01", ["Sai"], "usr-learner");
      await service.submitAttempt(second.id, "usr-learner");
      const openReport = await service.getExamAnalytics({
        classId: "class-web-01",
      }, "usr-instructor");
      expect(openReport.exams[0]).toMatchObject({
        sampleSize: 2,
        smallSampleWarning: true,
        averagePercentage: 50,
        passRate: 50,
        questionStatsAvailable: false,
        questionStats: [],
      });

      vi.setSystemTime(new Date("2027-01-10T02:00:00.000Z"));
      const closedReport = await service.getExamAnalytics({
        examId: "exam-mid-web",
      }, "usr-instructor");
      expect(closedReport.exams[0]?.questionStats).toEqual([
        expect.objectContaining({ responseCount: 2, correctRate: 50 }),
        expect.objectContaining({ responseCount: 2, correctRate: 50 }),
      ]);
      const csv = (
        await service.exportExamAnalytics({ examId: "exam-mid-web" }, "usr-instructor")
      ).toString("utf8");
      expect(csv).toContain("averagePercentage");
      expect(csv).not.toContain("PATCH");
    } finally {
      vi.useRealTimers();
    }
  });

  it("điều phối chủ đề, giới hạn độ sâu và xóa mềm phản hồi", async () => {
    const service = new LearningService();
    const topic = await service.createTopic("class-web-01", {
      title: "Luồng kiểm thử diễn đàn",
      body: "Nội dung thảo luận hợp lệ cho cả lớp.",
      tags: ["testing"],
      isPinned: false,
    }, "usr-instructor");
    expect(
      (await service.listNotifications("usr-learner")).some(
        (item) => item.entityId === topic.id,
      ),
    ).toBe(true);
    const root = await service.createPost(topic.id, "Phản hồi gốc hợp lệ", "usr-learner");
    const child = await service.createPost(
      topic.id,
      "Phản hồi cấp một hợp lệ",
      "usr-learner",
      root.id,
    );
    const grandchild = await service.createPost(
      topic.id,
      "Phản hồi cấp hai hợp lệ",
      "usr-learner",
      child.id,
    );
    await expect(
      service.createPost(
        topic.id,
        "Không được tạo cấp ba",
        "usr-learner",
        grandchild.id,
      ),
    ).rejects.toThrow("tối đa 2 cấp");

    const edited = await service.updatePost(
      root.id,
      "Phản hồi gốc đã chỉnh sửa", "usr-learner",
    );
    expect(edited).toMatchObject({
      editCount: 1,
      body: "Phản hồi gốc đã chỉnh sửa",
    });
    expect((await service.deletePost(root.id, "usr-learner")).deletedAt).toBeTruthy();
    expect((await service.listPosts(topic.id, "LEARNER", "usr-learner"))[0]).toMatchObject({
      body: "[Nội dung đã bị ẩn]",
      status: "HIDDEN",
    });

    expect(
      await service.moderateTopic(topic.id, {
        isLocked: true,
        isPinned: true,
        reason: "Kết thúc phiên thảo luận",
      }, "usr-instructor"),
    ).toMatchObject({ isLocked: true, isPinned: true });
    await expect(
      service.createPost(topic.id, "Không thể đăng khi đã khóa", "usr-learner"),
    ).rejects.toThrow("đã khóa");
    await expect(
      service.updatePost(child.id, "Không thể sửa khi đã khóa", "usr-learner"),
    ).rejects.toThrow("đã khóa");
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
    expect(
      (
        await service.markNotificationRead(
          notifications[0]!.id,
          "usr-instructor",
        )
      ).readAt,
    ).toBeTruthy();
    await expect(
      service.createPost(
        "topic-rest",
        "Đính kèm không hợp lệ",
        "usr-learner",
        undefined,
        ["mat-khong-ton-tai"],
      ),
    ).rejects.toThrow(BadRequestException);
    await expect(
      service.createPost(
        "topic-rest",
        "Nhắc người ngoài lớp",
        "usr-learner",
        undefined,
        [],
        ["usr-ngoai-lop"],
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it("khóa toàn bộ thao tác ghi diễn đàn khi lớp đã lưu trữ", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2024-12-01T00:00:00.000Z"));
      const service = new LearningService();
      const classItem = await service.createClass({
        courseId: "course-web",
        code: "FORUM-CLOSED",
        name: "Lớp diễn đàn lưu trữ",
        term: "2025",
        startAt: "2025-01-01T00:00:00.000Z",
        endAt: "2025-02-01T00:00:00.000Z",
        capacity: 20,
      }, "usr-manager");
      await service.assignInstructor(classItem.id, "usr-instructor", undefined, "usr-manager");
      await service.enrollLearner(classItem.id, "usr-learner", "usr-manager");
      await service.activateClass(classItem.id, "usr-manager");
      const topic = await service.createTopic(classItem.id, {
        title: "Chủ đề trước lưu trữ",
        body: "Nội dung được giữ lại để chỉ đọc.",
        tags: ["archive"],
        isPinned: false,
      }, "usr-instructor");
      const post = await service.createPost(
        topic.id,
        "Phản hồi trước khi lưu trữ.", "usr-learner",
      );
      vi.setSystemTime(new Date("2025-03-01T00:00:00.000Z"));
      await service.closeClass(
        classItem.id,
        "Đã hoàn tất lớp và khóa dữ liệu",
        "STANDARD_RETENTION", "usr-manager",
      );

      await expect(
        service.moderateTopic(topic.id, {
          isPinned: true,
          reason: "Không được thay đổi",
        }, "usr-instructor"),
      ).rejects.toThrow("chỉ cho phép đọc");
      await expect(
        service.updatePost(post.id, "Không được chỉnh sửa sau lưu trữ", "usr-learner"),
      ).rejects.toThrow("chỉ cho phép đọc");
      await expect(service.deletePost(post.id, "usr-learner")).rejects.toThrow(
        "chỉ cho phép đọc",
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("cho phép học viên thuộc lớp vào phòng không phụ thuộc khung giờ và ẩn link host trong danh sách", async () => {
    vi.useFakeTimers();
    try {
      const service = new LearningService();
      const learnerSessions = await service.listSessions("LEARNER", "usr-learner");
      expect(learnerSessions[0]?.hostUrl).toBe("");
      vi.setSystemTime(new Date("2026-08-26T01:30:00.000Z"));
      const earlyJoined = await service.joinSession("session-web-01", "usr-learner", "LEARNER");
      expect(earlyJoined.attendeeUrl).not.toContain("-host");
      vi.setSystemTime(new Date("2026-08-26T01:50:00.000Z"));
      const joined = await service.joinSession("session-web-01", "usr-learner", "LEARNER");
      expect(joined.attendeeUrl).not.toContain("-host");
      vi.setSystemTime(new Date("2026-08-26T02:10:00.000Z"));
    } finally {
      vi.useRealTimers();
    }
  });

  it("tính SLA, lưu trao đổi và không đóng ticket thiếu kết quả", async () => {
    const service = new LearningService();
    const ticket = await service.createTicket({
      category: "TECHNICAL",
      severity: "P0",
      description: "Không thể truy cập lớp học trực tuyến",
    }, "usr-learner");
    expect(
      new Date(ticket.dueAt).getTime() - new Date(ticket.createdAt).getTime(),
    ).toBeLessThanOrEqual(4 * 3_600_000 + 1_000);
    await service.addTicketComment(
      ticket.id,
      "Em vẫn gặp lỗi khi thử lại",
      "LEARNER", "usr-learner",
    );
    await service.addTicketComment(
      ticket.id,
      "Đội hỗ trợ đang kiểm tra nhật ký",
      "SYSTEM_ADMIN", "usr-admin",
    );
    expect(await service.listTicketComments(ticket.id, "LEARNER", "usr-learner")).toHaveLength(
      2,
    );
    expect((await service.listTickets("SYSTEM_ADMIN", "usr-admin"))[0]?.status).toBe(
      "IN_PROGRESS",
    );
    await expect(
      service.updateTicket(ticket.id, { status: "RESOLVED" }, "usr-admin"),
    ).rejects.toThrow(BadRequestException);
  });

  it("từ chối chuyển trạng thái ticket không hợp lệ hoặc thiếu người xử lý", async () => {
    const service = new LearningService();
    const ticket = await service.createTicket({
      category: "TECHNICAL",
      severity: "P2",
      description: "Phiếu kiểm tra quy tắc chuyển trạng thái",
    }, "usr-learner");

    await expect(
      service.updateTicket(ticket.id, { status: "IN_PROGRESS" }, "usr-admin"),
    ).rejects.toThrow(BadRequestException);
    await expect(
      service.updateTicket(ticket.id, {
        status: "RESOLVED",
        assigneeId: "usr-admin",
        resolution: "Đã xử lý yêu cầu.",
      }, "usr-admin"),
    ).rejects.toThrow(ConflictException);
    await service.updateTicket(ticket.id, {
      status: "IN_PROGRESS",
      assigneeId: "usr-admin",
    }, "usr-admin");
    await expect(
      service.updateTicket(ticket.id, { status: "OPEN" }, "usr-admin"),
    ).rejects.toThrow(ConflictException);
  });

  it("chỉ cho người báo hoặc đội quản lý hỗ trợ truy cập ticket", async () => {
    const service = new LearningService();
    const ticket = await service.createTicket(
      {
        category: "ACCOUNT",
        severity: "P1",
        description: "Tài khoản không tải được hồ sơ cá nhân",
      },
      "reporter-one",
    );

    expect(await service.listTickets("LEARNER", "reporter-two")).toHaveLength(
      0,
    );
    expect(
      await service.listTickets("INSTRUCTOR", "reporter-two"),
    ).toHaveLength(0);
    await expect(
      service.listTicketComments(ticket.id, "LEARNER", "reporter-two"),
    ).rejects.toThrow(NotFoundException);
    await expect(
      service.addTicketComment(
        ticket.id,
        "Tôi muốn xem ticket của người khác",
        "INSTRUCTOR",
        "reporter-two",
      ),
    ).rejects.toThrow(NotFoundException);

    expect(
      await service.listTickets("CENTER_MANAGER", "support-manager"),
    ).toHaveLength(1);
    const comment = await service.addTicketComment(
      ticket.id,
      "Đội hỗ trợ đã tiếp nhận yêu cầu",
      "CENTER_MANAGER",
      "support-manager",
    );
    expect(comment.authorId).toBe("support-manager");
    expect(
      (await service.listTickets("LEARNER", "reporter-one"))[0]?.status,
    ).toBe("IN_PROGRESS");
  });

  it("chặn bí mật và lưu bằng chứng hỗ trợ có checksum", async () => {
    const storageRoot = await mkdtemp(join(tmpdir(), "wind-support-"));
    const config = {
      get: (key: keyof Environment): string | undefined =>
        key === "STORAGE_ROOT" ? storageRoot : undefined,
    } as unknown as ConfigService<Environment, true>;
    const service = new LearningService(undefined, config);
    try {
      await expect(
        service.createTicket({
          category: "ACCOUNT",
          severity: "P1",
          description: "Không đăng nhập được, password=MatKhauBiMat123",
        }, "usr-learner"),
      ).rejects.toThrow("dữ liệu nhạy cảm");
      const ticket = await service.createTicket({
        category: "TECHNICAL",
        severity: "P2",
        contextId: "class-web-01",
        description: "Màn hình lớp học hiển thị lỗi khi mở",
      }, "usr-learner");
      const bytes = Buffer.from(
        "Anh chup va mo ta loi khong chua du lieu bi mat",
      );
      const attachment = await service.addSupportAttachment(
        ticket.id,
        {
          originalName: "bang-chung.txt",
          mimeType: "text/plain",
          size: bytes.length,
          buffer: bytes,
        },
        "LEARNER", "usr-learner",
      );
      expect(attachment.checksum).toMatch(/^sha256:/);
      expect(
        (await service.listTickets("LEARNER", "usr-learner"))[0]?.attachments,
      ).toHaveLength(1);
      expect(
        (
          await service.readSupportAttachment(
            ticket.id,
            attachment.id,
            "LEARNER",
            "usr-learner",
          )
        ).buffer.equals(bytes),
      ).toBe(true);
      expect(
        (
          await service.readSupportAttachment(
            ticket.id,
            attachment.id,
            "SYSTEM_ADMIN",
            "usr-admin",
          )
        ).fileName,
      ).toBe("bang-chung.txt");
      await expect(
        service.readSupportAttachment(
          ticket.id,
          attachment.id,
          "LEARNER",
          "usr-khac",
        ),
      ).rejects.toThrow(NotFoundException);
      await expect(
        service.addSupportAttachment(
          ticket.id,
          {
            originalName: "malware.exe",
            mimeType: "application/octet-stream",
            size: 3,
            buffer: Buffer.from("abc"),
          },
          "LEARNER", "usr-learner",
        ),
      ).rejects.toThrow(BadRequestException);
    } finally {
      await rm(storageRoot, { recursive: true, force: true });
    }
  });

  it("cảnh báo P0 ngay và liên kết ticket trùng trong 24 giờ", async () => {
    const service = new LearningService();
    const first = await service.createTicket({
      category: "LIVE_CLASS",
      severity: "P0",
      contextId: "session-web-01",
      description: "Toàn bộ học viên không thể vào phòng học",
    }, "usr-learner");
    const duplicate = await service.createTicket({
      category: "LIVE_CLASS",
      severity: "P0",
      contextId: "session-web-01",
      description: "Sự cố vẫn tiếp tục xảy ra với cả lớp",
    }, "usr-learner");
    expect(duplicate.duplicateOfId).toBe(first.id);
    const alerts = await service.listRoleNotifications("SYSTEM_ADMIN");
    expect(alerts).toHaveLength(2);
    expect(alerts.every((item) => item.type === "SUPPORT_P0")).toBe(true);
  });

  it("trả cùng biên nhận khi tạo lại phiếu bằng cùng khóa idempotency", async () => {
    const service = new LearningService();
    const clientRequestId = "d93086bf-7dcb-4452-b03f-5c3bf13f4c86";
    const input = {
      clientRequestId,
      category: "TECHNICAL",
      severity: "P2" as const,
      description: "Yêu cầu bị timeout sau khi máy chủ đã tạo phiếu",
    };
    const first = await service.createTicket(input, "usr-learner");
    const retry = await service.createTicket(input, "usr-learner");
    expect(retry.id).toBe(first.id);
    expect((await service.listTickets("LEARNER", "usr-learner")).filter((item) => item.clientRequestId === clientRequestId)).toHaveLength(1);
  });

  it("chỉ cho người báo đóng ticket sau khi đã có kết quả xử lý", async () => {
    const service = new LearningService();
    const ticket = await service.createTicket({
      category: "TECHNICAL",
      severity: "P2",
      description: "Không thể mở nội dung bài giảng đã phát hành",
    }, "usr-learner");
    await expect(service.closeTicketByReporter(ticket.id, "usr-learner")).rejects.toThrow(
      ConflictException,
    );
    await service.updateTicket(ticket.id, {
      status: "IN_PROGRESS",
      assigneeId: "usr-admin",
    }, "usr-admin");
    await service.updateTicket(ticket.id, {
      status: "RESOLVED",
      assigneeId: "usr-admin",
      resolution: "Đã cấp lại quyền truy cập học liệu.",
    }, "usr-admin");
    expect(await service.closeTicketByReporter(ticket.id, "usr-learner")).toMatchObject({
      status: "CLOSED",
      resolution: "Đã cấp lại quyền truy cập học liệu.",
    });
    await expect(
      service.closeTicketByReporter(ticket.id, "usr-khac"),
    ).rejects.toThrow(NotFoundException);
  });

  it("cấp bản ghi có chữ ký và quản lý appeal điểm danh", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-08-26T02:00:00.000Z"));
      const service = new LearningService();
      await service.joinSession("session-web-01", "usr-learner", "LEARNER");
      await service.transitionSession("session-web-01", "LIVE", "usr-instructor");
      await service.transitionSession("session-web-01", "COMPLETED", "usr-instructor");
      await service.attachRecording(
        "session-web-01",
        "https://recording.example/session-web-01", "usr-instructor",
      );
      const processing = (await service.getSessionSummary(
        "session-web-01", "usr-learner",
      )) as {
        recordingAvailable: boolean;
        session: { recordingUrl?: string; recordingStatus?: string };
      };
      expect(processing).toMatchObject({
        recordingAvailable: false,
        session: { recordingStatus: "PROCESSING" },
      });
      expect(processing.session.recordingUrl).toBeUndefined();
      await expect(
        service.createRecordingAccess("session-web-01", "usr-learner"),
      ).rejects.toThrow(NotFoundException);

      const ready = await service.completeRecording(
        "session-web-01",
        "READY",
        90, undefined, "usr-instructor",
      );
      expect(ready).toMatchObject({ recordingStatus: "READY" });
      expect(ready.recordingExpiresAt).toBeTruthy();
      const summary = (await service.getSessionSummary("session-web-01", "usr-learner")) as {
        recordingAvailable: boolean;
        session: { recordingStatus?: string };
      };
      expect(summary).toMatchObject({
        recordingAvailable: true,
        session: { recordingStatus: "READY" },
      });
      const access = await service.createRecordingAccess("session-web-01", "usr-learner");
      const url = new URL(access.url, "http://localhost");
      const expires = Number(url.searchParams.get("expires"));
      const signature = url.searchParams.get("signature") ?? "";
      expect(
        (
          await service.resolveRecordingAccess(
            "session-web-01",
            expires,
            signature, "usr-learner",
          )
        ).recordingUrl,
      ).toContain("recording.example");
      await expect(
        service.resolveRecordingAccess(
          "session-web-01",
          expires,
          `${signature}x`, "usr-learner",
        ),
      ).rejects.toThrow(BadRequestException);
    } finally {
      vi.useRealTimers();
    }
  });
});
