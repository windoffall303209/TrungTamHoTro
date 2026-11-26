import { Test, type TestingModule } from "@nestjs/testing";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../../src/app.module.js";
import type { AuthenticatedSession } from "../../src/auth/auth.service.js";
import { PrismaService } from "../../src/database/prisma.service.js";
import { AcademicService } from "../../src/domains/learning/academic/academic.service.js";
import { LearningService } from "../../src/domains/learning/core/learning.service.js";
import { deleteTestAuditLogs } from "../support/audit-maintenance.js";

/** Tạo phiên xác thực đầy đủ vai trò và quyền để chạy ma trận phân quyền liên lớp trên service thật. */
function makeSession(
  id: string,
  roleCode: AuthenticatedSession["roleCode"],
  permissions: AuthenticatedSession["permissions"],
): AuthenticatedSession {
  return {
    sessionId: `sess-${id}`,
    roleCode,
    permissions,
    availableRoles: [{ code: roleCode, name: roleCode }],
    user: { id, username: id, name: id, email: `${id}@example.test`, roleName: roleCode },
  };
}

describe.skipIf(!(process.env.DB_NAME ?? "").endsWith("_test"))("nghiệm thu vào phòng trực tuyến, lịch sử điểm và phân quyền liên lớp (D07)", () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let learning: LearningService;
  let academic: AcademicService;

  const prefix = `d07-${randomUUID().slice(0, 8)}`;
  const ids = {
    instructorA: `${prefix}-inst-a`,
    instructorB: `${prefix}-inst-b`,
    learnerA: `${prefix}-lrn-a`,
    learnerB: `${prefix}-lrn-b`,
    manager: `${prefix}-mgr`,
    classA: `${prefix}-cls-a`,
    classB: `${prefix}-cls-b`,
    sessionOpenA: `${prefix}-ses-open-a`,
    sessionEarlyA: `${prefix}-ses-early-a`,
    sessionLateA: `${prefix}-ses-late-a`,
    sessionCancelledA: `${prefix}-ses-cancel-a`,
    sessionOpenB: `${prefix}-ses-open-b`,
    examA: `${prefix}-exam-a`,
    attemptA: `${prefix}-att-a`,
  };
  let assignmentAId = "";
  let submissionAId = "";
  let regradeId = "";

  // Tạo 2 lớp độc lập A/B với giảng viên và học viên tách biệt để kiểm chứng ma trận RBAC và lịch sử điểm trên DB thật.
  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    prisma = moduleRef.get(PrismaService);
    learning = moduleRef.get(LearningService);
    academic = moduleRef.get(AcademicService);

    const [instRole, lrnRole, mgrRole, sourceClass] = await Promise.all([
      prisma.role.findUniqueOrThrow({ where: { code: "INSTRUCTOR" } }),
      prisma.role.findUniqueOrThrow({ where: { code: "LEARNER" } }),
      prisma.role.findUniqueOrThrow({ where: { code: "CENTER_MANAGER" } }),
      prisma.learningClass.findFirstOrThrow(),
    ]);

    for (const [id, roleId] of [
      [ids.instructorA, instRole.id],
      [ids.instructorB, instRole.id],
      [ids.learnerA, lrnRole.id],
      [ids.learnerB, lrnRole.id],
      [ids.manager, mgrRole.id],
    ] as const) {
      await prisma.user.create({
        data: { id, username: id, displayName: id, email: `${id}@example.test`, status: "ACTIVE", roles: { create: { roleId } } },
      });
    }

    const nowMs = Date.now();
    for (const [classId, code, instId, lrnId] of [
      [ids.classA, `${prefix}-A`, ids.instructorA, ids.learnerA],
      [ids.classB, `${prefix}-B`, ids.instructorB, ids.learnerB],
    ] as const) {
      await prisma.learningClass.create({
        data: {
          id: classId,
          code,
          name: `Lớp ${code}`,
          courseId: sourceClass.courseId,
          courseVersion: sourceClass.courseVersion,
          term: "test",
          capacity: 20,
          status: "ACTIVE",
          startAt: new Date(nowMs - 86_400_000),
          endAt: new Date(nowMs + 30 * 86_400_000),
          instructors: { create: { instructorId: instId, role: "PRIMARY", assignedBy: ids.manager } },
          enrollments: { create: { learnerId: lrnId, status: "ACTIVE" } },
        },
      });
    }

    // Các buổi học phủ cửa sổ tham gia hợp lệ, quá sớm (>15p), quá muộn (>30p sau kết thúc), đã hủy và lớp khác.
    await prisma.liveSession.createMany({
      data: [
        {
          id: ids.sessionOpenA,
          classId: ids.classA,
          hostId: ids.instructorA,
          title: "Buổi đang mở lớp A",
          provider: "GOOGLE_MEET",
          requestedProvider: "GOOGLE_MEET",
          status: "SCHEDULED",
          startsAt: new Date(nowMs + 5 * 60_000),
          endsAt: new Date(nowMs + 65 * 60_000),
          hostUrl: "https://meet.google.com/aaa-bbbb-ccc",
          attendeeUrl: "https://meet.google.com/aaa-bbbb-ccc",
        },
        {
          id: ids.sessionEarlyA,
          classId: ids.classA,
          hostId: ids.instructorA,
          title: "Buổi chưa tới giờ lớp A",
          provider: "GOOGLE_MEET",
          requestedProvider: "GOOGLE_MEET",
          status: "SCHEDULED",
          startsAt: new Date(nowMs + 60 * 60_000),
          endsAt: new Date(nowMs + 120 * 60_000),
          hostUrl: "https://meet.google.com/ddd-eeee-fff",
          attendeeUrl: "https://meet.google.com/ddd-eeee-fff",
        },
        {
          id: ids.sessionLateA,
          classId: ids.classA,
          hostId: ids.instructorA,
          title: "Buổi đã quá giờ lớp A",
          provider: "GOOGLE_MEET",
          requestedProvider: "GOOGLE_MEET",
          status: "SCHEDULED",
          startsAt: new Date(nowMs - 120 * 60_000),
          endsAt: new Date(nowMs - 60 * 60_000),
          hostUrl: "https://meet.google.com/ggg-hhhh-iii",
          attendeeUrl: "https://meet.google.com/ggg-hhhh-iii",
        },
        {
          id: ids.sessionCancelledA,
          classId: ids.classA,
          hostId: ids.instructorA,
          title: "Buổi đã hủy lớp A",
          provider: "GOOGLE_MEET",
          requestedProvider: "GOOGLE_MEET",
          status: "CANCELLED",
          startsAt: new Date(nowMs + 5 * 60_000),
          endsAt: new Date(nowMs + 65 * 60_000),
          hostUrl: "https://meet.google.com/jjj-kkkk-lll",
          attendeeUrl: "https://meet.google.com/jjj-kkkk-lll",
        },
        {
          id: ids.sessionOpenB,
          classId: ids.classB,
          hostId: ids.instructorB,
          title: "Buổi đang mở lớp B",
          provider: "GOOGLE_MEET",
          requestedProvider: "GOOGLE_MEET",
          status: "SCHEDULED",
          startsAt: new Date(nowMs + 5 * 60_000),
          endsAt: new Date(nowMs + 65 * 60_000),
          hostUrl: "https://meet.google.com/mmm-nnnn-ooo",
          attendeeUrl: "https://meet.google.com/mmm-nnnn-ooo",
        },
      ],
    });

    await prisma.exam.create({
      data: {
        id: ids.examA,
        classId: ids.classA,
        title: `Đề kiểm tra lịch sử điểm ${prefix}`,
        totalScore: 10,
        durationMinutes: 30,
        attemptLimit: 1,
        openAt: new Date(nowMs - 3600_000),
        closeAt: new Date(nowMs + 3600_000),
        status: "PUBLISHED",
      },
    });
    await prisma.examAttempt.create({
      data: {
        id: ids.attemptA,
        examId: ids.examA,
        learnerId: ids.learnerA,
        attemptNo: 1,
        status: "SUBMITTED",
        startedAt: new Date(nowMs - 1800_000),
        submittedAt: new Date(nowMs - 600_000),
      },
    });
  });

  // Dọn toàn bộ bản ghi fixture trên PostgreSQL test.
  afterAll(async () => {
    if (prisma) {
      const entityIds = [ids.attemptA, submissionAId, assignmentAId, ids.classA, ids.classB].filter(Boolean);
      for (const entityId of entityIds) {
        await deleteTestAuditLogs(prisma, { entityId });
      }
      if (regradeId) await prisma.regradeRequest.deleteMany({ where: { id: regradeId } });
      await prisma.notification.deleteMany({ where: { recipientId: { in: [ids.learnerA, ids.learnerB, ids.instructorA, ids.instructorB] } } });
      await prisma.examAttempt.deleteMany({ where: { id: ids.attemptA } });
      await prisma.exam.deleteMany({ where: { id: ids.examA } });
      if (assignmentAId) await prisma.assignment.deleteMany({ where: { id: assignmentAId } });
      await prisma.liveSession.deleteMany({ where: { classId: { in: [ids.classA, ids.classB] } } });
      await prisma.learningClass.deleteMany({ where: { id: { in: [ids.classA, ids.classB] } } });
      await prisma.user.deleteMany({ where: { id: { in: [ids.instructorA, ids.instructorB, ids.learnerA, ids.learnerB, ids.manager] } } });
    }
    await moduleRef?.close();
  });

  it("kiểm soát đúng cửa sổ tham gia buổi học và phân quyền liên lớp cho mọi vai trò", async () => {
    // Giảng viên lớp A vào được buổi lớp A, bị chặn ở buổi lớp B.
    const hostJoin = await learning.joinSession(ids.sessionOpenA, ids.instructorA, "INSTRUCTOR");
    expect(hostJoin.attendeeUrl).toBe("https://meet.google.com/aaa-bbbb-ccc");
    await expect(learning.joinSession(ids.sessionOpenB, ids.instructorA, "INSTRUCTOR")).rejects.toMatchObject({ status: 400 });

    // Học viên lớp A vào phòng được bất kể thời điểm khi buổi học còn mở; bị chặn ở buổi đã hủy hoặc lớp B.
    const learnerJoin = await learning.joinSession(ids.sessionOpenA, ids.learnerA, "LEARNER");
    expect(learnerJoin.attendeeUrl).toBe("https://meet.google.com/aaa-bbbb-ccc");
    expect((await learning.joinSession(ids.sessionEarlyA, ids.learnerA, "LEARNER")).attendeeUrl).toBe("https://meet.google.com/ddd-eeee-fff");
    expect((await learning.joinSession(ids.sessionLateA, ids.learnerA, "LEARNER")).attendeeUrl).toBe("https://meet.google.com/ggg-hhhh-iii");
    await expect(learning.joinSession(ids.sessionCancelledA, ids.learnerA, "LEARNER")).rejects.toMatchObject({ status: 400 });
    await expect(learning.joinSession(ids.sessionOpenB, ids.learnerA, "LEARNER")).rejects.toMatchObject({ status: 400 });

    // Quản lý trung tâm và Quản trị hệ thống tham gia giám sát không bị giới hạn giờ; vai trò lạ bị từ chối deny-by-default (403).
    expect((await learning.joinSession(ids.sessionOpenB, ids.manager, "CENTER_MANAGER")).attendeeUrl).toBe("https://meet.google.com/mmm-nnnn-ooo");
    expect((await learning.joinSession(ids.sessionEarlyA, ids.manager, "SYSTEM_ADMIN")).attendeeUrl).toBe("https://meet.google.com/ddd-eeee-fff");
    await expect(learning.joinSession(ids.sessionOpenA, ids.learnerA, "GUEST")).rejects.toMatchObject({ status: 403 });
  });

  it("ghi đầy đủ lịch sử điểm trước/sau cho bài tập, đề thi và phúc khảo đồng thời chặn chấm chéo lớp", async () => {
    const instA = makeSession(ids.instructorA, "INSTRUCTOR", ["exam:manage", "class:view"]);
    const instB = makeSession(ids.instructorB, "INSTRUCTOR", ["exam:manage", "class:view"]);
    const lrnA = makeSession(ids.learnerA, "LEARNER", ["exam:view", "class:view"]);
    const lrnB = makeSession(ids.learnerB, "LEARNER", ["exam:view", "class:view"]);
    const mgr = makeSession(ids.manager, "CENTER_MANAGER", ["class:view", "report:view"]);

    // 1. Bài tập tự luận: tạo -> nộp -> chấm lần đầu (ASSIGNMENT_GRADED) -> sửa điểm (ASSIGNMENT_GRADE_CORRECTED).
    const assignment = await academic.createAssignment(
      ids.classA,
      {
        title: `Tự luận lịch sử điểm ${prefix}`,
        description: "Kiểm thử lịch sử chấm và sửa điểm",
        instructions: "Trình bày ngắn gọn đầy đủ ý.",
        dueAt: new Date(Date.now() + 86_400_000).toISOString(),
        maxScore: 10,
        rubric: [{ title: "Nội dung", description: "Đúng trọng tâm", maxPoints: 10 }],
      },
      instA,
    );
    assignmentAId = assignment.id;
    const criterionId = assignment.rubric[0]!.id;

    await expect(academic.submitAssignment(assignment.id, "Học viên lớp B nộp nhầm lớp A", lrnB)).rejects.toMatchObject({ status: 404 });
    const submitted = await academic.submitAssignment(assignment.id, "Bài làm hợp lệ của học viên lớp A", lrnA);
    submissionAId = submitted.id;

    // Giảng viên lớp B và quản lý không được chấm; quản lý đọc được danh sách bài nộp chỉ đọc.
    await expect(academic.gradeSubmission(submitted.id, [{ criterionId, score: 8 }], "Sai lớp", submitted.revision, undefined, instB)).rejects.toMatchObject({ status: 404 });
    await expect(academic.gradeSubmission(submitted.id, [{ criterionId, score: 8 }], "Quản lý không chấm", submitted.revision, undefined, mgr)).rejects.toMatchObject({ status: 403 });
    expect(await academic.listSubmissions(assignment.id, mgr)).toHaveLength(1);
    await expect(academic.listSubmissions(assignment.id, instB)).rejects.toMatchObject({ status: 404 });

    // Chấm lần đầu ghi audit ASSIGNMENT_GRADED.
    const graded = await academic.gradeSubmission(submitted.id, [{ criterionId, score: 8 }], "Đạt yêu cầu", submitted.revision, undefined, instA);
    expect(graded.score).toBe(8);
    // Sửa điểm sai revision -> 409; đúng revision -> ghi ASSIGNMENT_GRADE_CORRECTED trước/sau.
    await expect(academic.gradeSubmission(submitted.id, [{ criterionId, score: 9.5 }], "Chấm lại", submitted.revision + 1, "Bổ sung ý đúng", instA)).rejects.toMatchObject({ status: 409 });
    const corrected = await academic.gradeSubmission(submitted.id, [{ criterionId, score: 9.5 }], "Cập nhật sau rà soát", submitted.revision, "Cộng thêm điểm phần phân tích", instA);
    expect(corrected.score).toBe(9.5);

    const assignmentAudits = await prisma.auditLog.findMany({
      where: { entityType: "assignment_submission", entityId: submitted.id },
      orderBy: { createdAt: "asc" },
    });
    expect(assignmentAudits.map((row) => row.action)).toEqual(["ASSIGNMENT_GRADED", "ASSIGNMENT_GRADE_CORRECTED"]);
    expect(assignmentAudits[0]?.context).toMatchObject({ previousScore: null, newScore: 8, reason: "Chấm lần đầu" });
    expect(assignmentAudits[1]?.context).toMatchObject({ previousScore: 8, newScore: 9.5, reason: "Cộng thêm điểm phần phân tích" });

    // 2. Đề thi & phúc khảo: chấm lần đầu -> sửa điểm -> phúc khảo chấp thuận ghi đủ trước/sau; giảng viên lớp B bị chặn 404.
    await expect(learning.gradeAttempt(ids.attemptA, 6, "Ngoài lớp", undefined, ids.instructorB)).rejects.toMatchObject({ status: 404 });
    await learning.gradeAttempt(ids.attemptA, 6, "Chấm lần đầu", undefined, ids.instructorA);
    await learning.gradeAttempt(ids.attemptA, 7.5, "Đã rà soát lại", "Bổ sung điểm câu tự luận", ids.instructorA);

    const req = await learning.requestRegrade(ids.attemptA, "Đề nghị xem lại câu 2 bài thi", ids.learnerA);
    regradeId = req.id;
    await expect(learning.claimRegrade(req.id, ids.instructorB)).rejects.toMatchObject({ status: 404 });
    await learning.claimRegrade(req.id, ids.instructorA);
    const resolved = await learning.resolveRegrade(req.id, { decision: "APPROVE", resolution: "Đồng ý cộng thêm 1.5 điểm", score: 9 }, ids.instructorA);
    expect(resolved.status).toBe("RESOLVED");

    const examAudits = await prisma.auditLog.findMany({
      where: { entityType: "exam_attempt", entityId: ids.attemptA },
      orderBy: { createdAt: "asc" },
    });
    expect(examAudits.map((row) => row.action)).toEqual(["EXAM_ATTEMPT_GRADED", "EXAM_GRADE_CORRECTED", "EXAM_GRADE_CORRECTED"]);
    expect(examAudits[0]?.context).toMatchObject({ previousScore: null, score: 6 });
    expect(examAudits[1]?.context).toMatchObject({ previousScore: 6, score: 7.5, reason: "Bổ sung điểm câu tự luận" });
    expect(examAudits[2]?.context).toMatchObject({ previousScore: 7.5, score: 9, reason: "Phúc khảo: Đồng ý cộng thêm 1.5 điểm" });

    // 3. Ma trận phân quyền liên lớp cho sổ điểm và báo cáo tiến độ.
    expect((await academic.gradebook(ids.classA, instA)).rows.map((row) => row.learnerId)).toEqual([ids.learnerA]);
    await expect(academic.gradebook(ids.classB, instA)).rejects.toMatchObject({ status: 404 });
    expect((await academic.gradebook(ids.classA, lrnA)).rows.map((row) => row.learnerId)).toEqual([ids.learnerA]);
    await expect(academic.gradebook(ids.classB, lrnA)).rejects.toMatchObject({ status: 403 });
    expect((await academic.gradebook(ids.classA, mgr)).rows).toHaveLength(1);
    expect((await academic.gradebook(ids.classB, mgr)).rows).toHaveLength(1);

    expect((await learning.getClassProgress(ids.classA, {}, ids.instructorA, "INSTRUCTOR")).classId).toBe(ids.classA);
    await expect(learning.getClassProgress(ids.classB, {}, ids.instructorA, "INSTRUCTOR")).rejects.toMatchObject({ status: 404 });
    await expect(learning.getClassProgress(ids.classA, {}, ids.learnerA, "LEARNER")).rejects.toMatchObject({ status: 403 });
    expect((await learning.getClassProgress(ids.classB, {}, ids.manager, "CENTER_MANAGER")).classId).toBe(ids.classB);
  });
});
