import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";
import { Test, type TestingModule } from "@nestjs/testing";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../../src/app.module.js";
import type { AuthenticatedSession } from "../../src/auth/auth.service.js";
import { PrismaService } from "../../src/database/prisma.service.js";
import { AcademicService } from "../../src/domains/learning/academic/academic.service.js";
import { ClassFeedService } from "../../src/domains/learning/class-feed/class-feed.service.js";
import { CourseClassService } from "../../src/domains/learning/courses/course-class.service.js";
import { ObjectStorageService } from "../../src/infrastructure/object-storage.service.js";

const VALID_PNG_BYTES = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53,
  0xde, 0x00, 0x00, 0x00, 0x0c, 0x49, 0x44, 0x41,
  0x54, 0x08, 0xd7, 0x63, 0xf8, 0xcf, 0xc0, 0x00,
  0x00, 0x03, 0x01, 0x01, 0x00, 0x18, 0xdd, 0x8d,
  0xb0, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e,
  0x44, 0xae, 0x42, 0x60, 0x82,
]);

describe("Cài đặt lớp học cho giảng viên, quyền đăng bảng tin, avatar lớp và mã thao tác bảng điểm", () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let courseClass: CourseClassService;
  let academic: AcademicService;
  let feed: ClassFeedService;
  let storage: ObjectStorageService;

  const prefix = `cls-set-${randomUUID().slice(0, 8)}`;
  const classId = `${prefix}-class`;
  const closedClassId = `${prefix}-closed`;
  const learnerId = `${prefix}-learner`;
  const outsideInstructorId = `${prefix}-inst-out`;
  const instructorId = "usr-instructor";
  const assignmentId = `${prefix}-asg`;
  const submissionId = `${prefix}-sub`;
  const examId = `${prefix}-exam`;
  const attemptId = `${prefix}-att`;

  let sessionInstructor: AuthenticatedSession;
  let sessionOutsideInstructor: AuthenticatedSession;
  let sessionLearner: AuthenticatedSession;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    prisma = moduleRef.get(PrismaService);
    courseClass = moduleRef.get(CourseClassService);
    academic = moduleRef.get(AcademicService);
    feed = moduleRef.get(ClassFeedService);
    storage = moduleRef.get(ObjectStorageService);

    const sourceClass = await prisma.learningClass.findFirstOrThrow();
    const learnerRole = await prisma.role.findUniqueOrThrow({ where: { code: "LEARNER" } });
    const instructorRole = await prisma.role.findUniqueOrThrow({ where: { code: "INSTRUCTOR" } });

    await prisma.user.createMany({
      data: [
        { id: learnerId, username: learnerId, email: `${learnerId}@test.local`, emailVerifiedAt: new Date(), displayName: "Học viên Cài đặt", status: "ACTIVE" },
        { id: outsideInstructorId, username: outsideInstructorId, email: `${outsideInstructorId}@test.local`, emailVerifiedAt: new Date(), displayName: "GV Ngoài lớp", status: "ACTIVE" },
      ],
    });
    await prisma.userRole.createMany({
      data: [
        { userId: learnerId, roleId: learnerRole.id },
        { userId: outsideInstructorId, roleId: instructorRole.id },
      ],
    });

    await prisma.learningClass.create({
      data: {
        id: classId,
        code: classId,
        name: `Lớp Cài đặt ${prefix}`,
        term: "test",
        capacity: 40,
        status: "ACTIVE",
        allowPeerGradeViewing: false,
        allowLearnerFeedPosting: true,
        courseId: sourceClass.courseId,
        courseVersion: sourceClass.courseVersion,
        startAt: new Date(Date.now() - 86_400_000),
        endAt: new Date(Date.now() + 86_400_000 * 30),
        instructors: { create: { instructorId, role: "PRIMARY", assignedBy: instructorId } },
        enrollments: { create: [{ learnerId, status: "ACTIVE", source: "TEST" }] },
      },
    });
    await prisma.learningClass.create({
      data: {
        id: closedClassId,
        code: closedClassId,
        name: `Lớp đóng ${prefix}`,
        term: "test",
        capacity: 40,
        status: "CLOSED",
        courseId: sourceClass.courseId,
        courseVersion: sourceClass.courseVersion,
        startAt: new Date(Date.now() - 86_400_000 * 10),
        endAt: new Date(Date.now() - 86_400_000),
        instructors: { create: { instructorId, role: "PRIMARY", assignedBy: instructorId } },
      },
    });

    await prisma.assignment.create({
      data: {
        id: assignmentId,
        classId,
        createdById: instructorId,
        title: "Bài tự luận chờ chấm",
        description: "Mô tả bài tự luận kiểm thử bảng điểm",
        instructions: "Trình bày ngắn gọn câu trả lời",
        dueAt: new Date(Date.now() + 86_400_000),
        maxScore: 10,
        rubric: [{ id: "r-1", title: "Nội dung", description: "Đúng ý", maxPoints: 10 }],
        status: "PUBLISHED",
      },
    });
    await prisma.assignmentSubmission.create({
      data: {
        id: submissionId,
        assignmentId,
        learnerId,
        content: "Bài làm chờ chấm của học viên",
        status: "SUBMITTED",
      },
    });
    await prisma.exam.create({
      data: {
        id: examId,
        classId,
        title: "Bài trắc nghiệm đã có điểm",
        durationMinutes: 15,
        attemptLimit: 1,
        openAt: new Date(Date.now() - 3_600_000),
        closeAt: new Date(Date.now() + 86_400_000),
        totalScore: 10,
        status: "PUBLISHED",
      },
    });
    await prisma.examAttempt.create({
      data: {
        id: attemptId,
        examId,
        learnerId,
        attemptNo: 1,
        status: "GRADED",
        score: 9.5,
        submittedAt: new Date(),
        gradePublishedAt: new Date(),
      },
    });

    sessionInstructor = {
      sessionId: `${prefix}-s-inst`,
      roleCode: "INSTRUCTOR",
      availableRoles: [{ code: "INSTRUCTOR", name: "Giảng viên" }],
      permissions: ["class:view", "exam:manage"],
      user: { id: instructorId, username: "instructor", name: "Giảng viên", email: "instructor@test.local", roleName: "Giảng viên", locale: "vi-VN", avatarUrl: null },
    };
    sessionOutsideInstructor = {
      sessionId: `${prefix}-s-out`,
      roleCode: "INSTRUCTOR",
      availableRoles: [{ code: "INSTRUCTOR", name: "Giảng viên" }],
      permissions: ["class:view", "exam:manage"],
      user: { id: outsideInstructorId, username: outsideInstructorId, name: "GV Ngoài lớp", email: `${outsideInstructorId}@test.local`, roleName: "Giảng viên", locale: "vi-VN", avatarUrl: null },
    };
    sessionLearner = {
      sessionId: `${prefix}-s-learner`,
      roleCode: "LEARNER",
      availableRoles: [{ code: "LEARNER", name: "Học viên" }],
      permissions: ["class:view"],
      user: { id: learnerId, username: learnerId, name: "Học viên Cài đặt", email: `${learnerId}@test.local`, roleName: "Học viên", locale: "vi-VN", avatarUrl: null },
    };
  });

  afterAll(async () => {
    const cls = await prisma.learningClass.findUnique({ where: { id: classId }, select: { avatarObjectKey: true } });
    if (cls?.avatarObjectKey) await storage.remove(cls.avatarObjectKey).catch(() => undefined);
    await prisma.notification.deleteMany({
      where: { recipientId: { in: [learnerId, instructorId] }, entityType: "CLASS_FEED_POST" },
    });
    await prisma.learningClass.deleteMany({ where: { id: { in: [classId, closedClassId] } } });
    await prisma.user.deleteMany({ where: { id: { in: [learnerId, outsideInstructorId] } } });
    await moduleRef.close();
  });

  it("giảng viên tùy chỉnh toàn bộ cài đặt lớp, chặn học viên đăng bài khi tắt và khóa người không được phân công", async () => {
    await expect(
      courseClass.updateClassSettings(classId, { allowPeerGradeViewing: true }, sessionLearner),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      courseClass.updateClassSettings(classId, { allowPeerGradeViewing: true }, sessionOutsideInstructor),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      courseClass.updateClassSettings(closedClassId, { allowPeerGradeViewing: true }, sessionInstructor),
    ).rejects.toBeInstanceOf(ConflictException);

    // Giảng viên phụ trách bật xem bảng điểm và tắt quyền học viên đăng bài
    const updated = await courseClass.updateClassSettings(
      classId,
      {
        name: `Lớp Đã Cập Nhật ${prefix}`,
        capacity: 60,
        allowPeerGradeViewing: true,
        allowLearnerFeedPosting: false,
        allowLateEnrollment: true,
      },
      sessionInstructor,
    );
    expect(updated.name).toBe(`Lớp Đã Cập Nhật ${prefix}`);
    expect(updated.capacity).toBe(60);
    expect(updated.allowPeerGradeViewing).toBe(true);
    expect(updated.allowLearnerFeedPosting).toBe(false);
    expect(updated.allowLateEnrollment).toBe(true);

    // Khi tắt allowLearnerFeedPosting: học viên bị chặn 403 khi tạo bài mới, giảng viên vẫn đăng được
    await expect(
      feed.createPost(classId, "Học viên thử đăng khi bị tắt", [], sessionLearner),
    ).rejects.toBeInstanceOf(ForbiddenException);
    const teacherPost = await feed.createPost(classId, "Giảng viên đăng bình thường", [], sessionInstructor);
    expect(teacherPost.content).toBe("Giảng viên đăng bình thường");
    // Học viên vẫn bình luận được trên bài của giảng viên
    const comment = await feed.createComment(classId, teacherPost.id, { content: "Em đã đọc ạ" }, sessionLearner);
    expect(comment.content).toBe("Em đã đọc ạ");

    // Bật lại allowLearnerFeedPosting: học viên đăng bài thành công
    await courseClass.updateClassSettings(classId, { allowLearnerFeedPosting: true }, sessionInstructor);
    const learnerPost = await feed.createPost(classId, "Học viên đăng bài sau khi mở lại", [], sessionLearner);
    expect(learnerPost.authorId).toBe(learnerId);
  });

  it("hỗ trợ tải/xem/xóa avatar lớp cho giảng viên phụ trách và trả submissionId/attemptId chỉ cho giảng viên trên bảng điểm", async () => {
    // Chặn ảnh giả mạo chữ ký
    await expect(
      courseClass.updateClassAvatar(
        classId,
        { mimeType: "image/png", size: 24, buffer: Buffer.from("<html>alert(1)</html>") },
        sessionInstructor,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    // Tải ảnh PNG hợp lệ → sinh avatarUrl, đọc lại đúng MIME & bytes, rồi gỡ về icon mặc định
    const withAvatar = await courseClass.updateClassAvatar(
      classId,
      { mimeType: "image/png", size: VALID_PNG_BYTES.length, buffer: VALID_PNG_BYTES },
      sessionInstructor,
    );
    expect(withAvatar.avatarUrl).toMatch(new RegExp(`^/classes/${classId}/avatar\\?v=\\d+$`));

    const storedAvatar = await courseClass.readClassAvatar(classId);
    expect(storedAvatar.mimeType).toBe("image/png");
    expect(storedAvatar.buffer.length).toBeGreaterThan(0);

    const withoutAvatar = await courseClass.removeClassAvatar(classId, sessionInstructor);
    expect(withoutAvatar.avatarUrl).toBeNull();
    await expect(courseClass.readClassAvatar(classId)).rejects.toBeInstanceOf(NotFoundException);

    // Bảng điểm giảng viên có submissionId & attemptId để mở chấm/xem chi tiết; học viên KHÔNG nhận các mã thao tác này
    const teacherGradebook = await academic.gradebook(classId, sessionInstructor);
    const teacherRow = teacherGradebook.rows.find((row) => row.learnerId === learnerId);
    const teacherAsgCell = teacherRow?.cells?.find((cell) => cell.assessmentId === assignmentId);
    const teacherExamCell = teacherRow?.cells?.find((cell) => cell.assessmentId === examId);
    expect(teacherAsgCell).toMatchObject({ status: "AWAITING_GRADE", submissionId });
    expect(teacherExamCell).toMatchObject({ status: "GRADED", score: 9.5, attemptId });

    const learnerGradebook = await academic.gradebook(classId, sessionLearner);
    const learnerRow = learnerGradebook.rows.find((row) => row.learnerId === learnerId);
    const learnerAsgCell = learnerRow?.cells?.find((cell) => cell.assessmentId === assignmentId);
    const learnerExamCell = learnerRow?.cells?.find((cell) => cell.assessmentId === examId);
    expect(learnerAsgCell?.submissionId).toBeUndefined();
    expect(learnerExamCell?.attemptId).toBeUndefined();
  });
});
