import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "../../../../generated/prisma/client.js";
import { copyLearningClass, id, now } from "../../core/learning.shared.js";
import type {
  ClassClosureReadiness,
  LearningClass,
} from "../../core/learning.types.js";
import type { LearningServiceContext } from "../../core/learning.context.js";

/** Kích hoạt lớp khi khóa học đã xuất bản, lịch hợp lệ và có giảng viên chính. */
export async function activateClass(
  serviceContext: LearningServiceContext,
  classId: string,
  actorId: string,
): Promise<LearningClass> {
  const prisma = serviceContext.database();
  if (prisma) {
    const item = await serviceContext.getDatabaseClass(prisma, classId);
    if (item.status === "ACTIVE") return item;
    if (item.status === "CLOSED")
      throw new ConflictException(
        "Lớp đã đóng và không thể kích hoạt trực tiếp.",
      );
    if (!item.instructorIds.length)
      throw new BadRequestException(
        "Cần phân công ít nhất một giảng viên trước khi kích hoạt.",
      );
    if (
      (await prisma.classInstructor.count({
        where: { classId, role: "PRIMARY" },
      })) !== 1
    )
      throw new BadRequestException(
        "Lớp cần đúng một giảng viên chính trước khi kích hoạt.",
      );
    if (new Date(item.endAt) <= new Date(item.startAt))
      throw new BadRequestException("Lịch lớp không hợp lệ.");
    if (item.learnerIds.length > item.capacity)
      throw new BadRequestException("Sĩ số hiện tại vượt quá sức chứa lớp.");
    await prisma.$transaction([
      prisma.learningClass.update({
        where: { id: classId },
        data: { status: "ACTIVE" },
      }),
      prisma.auditLog.create({
        data: {
          actorId,
          action: "CLASS_ACTIVATED",
          entityType: "learning_class",
          entityId: classId,
          context: {
            courseId: item.courseId,
            courseVersion: item.courseVersion,
            instructorCount: item.instructorIds.length,
            learnerCount: item.learnerIds.length,
          },
        },
      }),
    ]);
    return serviceContext.getDatabaseClass(prisma, classId);
  }
  const item = serviceContext.findClass(classId);
  if (item.status === "ACTIVE")
    return copyLearningClass(item);
  if (item.status === "CLOSED")
    throw new ConflictException(
      "Lớp đã đóng và không thể kích hoạt trực tiếp.",
    );
  if (!item.instructorIds.length)
    throw new BadRequestException(
      "Cần phân công ít nhất một giảng viên trước khi kích hoạt.",
    );
  if (
    item.instructorIds.filter(
      (instructorId) =>
        serviceContext.instructorRoles.get(`${classId}:${instructorId}`) ===
        "PRIMARY",
    ).length !== 1
  )
    throw new BadRequestException(
      "Lớp cần đúng một giảng viên chính trước khi kích hoạt.",
    );
  if (new Date(item.endAt) <= new Date(item.startAt))
    throw new BadRequestException("Lịch lớp không hợp lệ.");
  if (item.learnerIds.length > item.capacity)
    throw new BadRequestException("Sĩ số hiện tại vượt quá sức chứa lớp.");
  item.status = "ACTIVE";
  return copyLearningClass(item);
}

/** Đếm các nghiệp vụ còn mở để xác định lớp có thể đóng hay chưa. */
export async function getClassClosureReadiness(
  serviceContext: LearningServiceContext,
  classId: string,
): Promise<ClassClosureReadiness> {
  const prisma = serviceContext.database();
  if (prisma) {
    const current = await prisma.learningClass.findUnique({
      where: { id: classId },
    });
    if (!current) throw new NotFoundException("Không tìm thấy lớp học.");
    const [
      openExams,
      inProgressAttempts,
      pendingGrades,
      openAssignments,
      pendingAssignmentGrades,
      openRegrades,
      activeSessions,
    ] = await prisma.$transaction([
      prisma.exam.count({
        where: {
          classId,
          OR: [
            { status: "PENDING_REVIEW" },
            { status: "PUBLISHED", closeAt: { gt: new Date() } },
          ],
        },
      }),
      prisma.examAttempt.count({
        where: { exam: { classId }, status: "IN_PROGRESS" },
      }),
      prisma.examAttempt.count({
        where: { exam: { classId }, status: "SUBMITTED" },
      }),
      prisma.assignment.count({
        where: { classId, status: "PUBLISHED", dueAt: { gt: new Date() } },
      }),
      prisma.assignmentSubmission.count({
        where: { assignment: { classId }, status: "SUBMITTED" },
      }),
      prisma.regradeRequest.count({
        where: {
          attempt: { exam: { classId } },
          status: { in: ["OPEN", "IN_REVIEW"] },
        },
      }),
      prisma.liveSession.count({
        where: { classId, status: { in: ["SCHEDULED", "LIVE"] } },
      }),
    ]);
    return serviceContext.buildClassClosureReadiness(
      current.status,
      current.endAt,
      {
        openExams,
        inProgressAttempts,
        pendingGrades,
        openAssignments,
        pendingAssignmentGrades,
        openRegrades,
        activeSessions,
      },
    );
  }
  const item = serviceContext.findClass(classId);
  const classExams = serviceContext.exams.filter(
    (exam) => exam.classId === classId,
  );
  const classSessions = serviceContext.sessions.filter(
    (session) => session.classId === classId,
  );
  return serviceContext.buildClassClosureReadiness(
    item.status,
    new Date(item.endAt),
    {
      openExams: classExams.filter(
        (exam) =>
          exam.status === "PENDING_REVIEW" ||
          (exam.status === "PUBLISHED" && new Date(exam.closeAt) > new Date()),
      ).length,
      inProgressAttempts: serviceContext.attempts.filter(
        (attempt) =>
          classExams.some((exam) => exam.id === attempt.examId) &&
          attempt.status === "IN_PROGRESS",
      ).length,
      pendingGrades: serviceContext.attempts.filter(
        (attempt) =>
          classExams.some((exam) => exam.id === attempt.examId) &&
          attempt.status === "SUBMITTED",
      ).length,
      openAssignments: 0,
      pendingAssignmentGrades: 0,
      openRegrades: serviceContext.regradeRequests.filter(
        (request) =>
          classExams.some((exam) =>
            serviceContext.attempts.some(
              (attempt) =>
                attempt.id === request.attemptId && attempt.examId === exam.id,
            ),
          ) && ["OPEN", "IN_REVIEW"].includes(request.status),
      ).length,
      activeSessions: classSessions.filter(
        (session) =>
          session.status === "SCHEDULED" || session.status === "LIVE",
      ).length,
    },
  );
}

/** Tính lại mọi blocker trong chính transaction đóng lớp để loại cửa sổ cạnh tranh với lệnh tạo/nộp. */
export async function databaseClassClosureReadiness(
  serviceContext: LearningServiceContext,
  database: Prisma.TransactionClient,
  classId: string,
): Promise<ClassClosureReadiness> {
  const checkedAt = new Date();
  // Một snapshot SQL cho trạng thái lớp và bảy blocker; tránh tám round-trip trên cùng kết nối.
  const [current] = await database.$queryRaw<Array<{
    status: LearningClass["status"]; endAt: Date;
    openExams: number; inProgressAttempts: number; pendingGrades: number;
    openAssignments: number; pendingAssignmentGrades: number; openRegrades: number; activeSessions: number;
  }>>`
    SELECT c.status, c.end_at AS "endAt",
      (SELECT count(*)::int FROM exams e WHERE e.class_id = c.id
        AND (e.status = 'PENDING_REVIEW' OR (e.status = 'PUBLISHED' AND e.close_at > ${checkedAt}))) AS "openExams",
      (SELECT count(*)::int FROM exam_attempts a JOIN exams e ON e.id = a.exam_id
        WHERE e.class_id = c.id AND a.status = 'IN_PROGRESS') AS "inProgressAttempts",
      (SELECT count(*)::int FROM exam_attempts a JOIN exams e ON e.id = a.exam_id
        WHERE e.class_id = c.id AND a.status = 'SUBMITTED') AS "pendingGrades",
      (SELECT count(*)::int FROM assignments a WHERE a.class_id = c.id
        AND a.status = 'PUBLISHED' AND a.due_at > ${checkedAt}) AS "openAssignments",
      (SELECT count(*)::int FROM assignment_submissions s JOIN assignments a ON a.id = s.assignment_id
        WHERE a.class_id = c.id AND s.status = 'SUBMITTED') AS "pendingAssignmentGrades",
      (SELECT count(*)::int FROM regrade_requests r JOIN exam_attempts a ON a.id = r.attempt_id
        JOIN exams e ON e.id = a.exam_id WHERE e.class_id = c.id AND r.status IN ('OPEN', 'IN_REVIEW')) AS "openRegrades",
      (SELECT count(*)::int FROM live_sessions s WHERE s.class_id = c.id
        AND s.status IN ('SCHEDULED', 'LIVE')) AS "activeSessions"
    FROM learning_classes c WHERE c.id = ${classId}
  `;
  if (!current) throw new NotFoundException("Không tìm thấy lớp học.");
  const { openExams, inProgressAttempts, pendingGrades, openAssignments,
    pendingAssignmentGrades, openRegrades, activeSessions } = current;
  return serviceContext.buildClassClosureReadiness(
    current.status,
    current.endAt,
    {
      openExams,
      inProgressAttempts,
      pendingGrades,
      openAssignments,
      pendingAssignmentGrades,
      openRegrades,
      activeSessions,
    },
  );
}

/** Đóng lớp chỉ khi readiness không còn blocker và lưu chính sách lưu trữ. */
export async function closeClass(
  serviceContext: LearningServiceContext,
  classId: string,
  closeReason: string,
  archivePolicy: "STANDARD_RETENTION" | "LONG_TERM_RETENTION",
  actorId: string,
): Promise<LearningClass> {
  const reason = closeReason.trim();
  if (reason.length < 5)
    throw new BadRequestException("Lý do đóng lớp cần ít nhất 5 ký tự.");
  const prisma = serviceContext.database();
  if (prisma) {
    await prisma.$transaction(
      async (transaction) => {
        await transaction.$queryRaw`SELECT id FROM learning_classes WHERE id = ${classId} FOR UPDATE`;
        const readiness = await serviceContext.databaseClassClosureReadiness(
          transaction,
          classId,
        );
        if (!readiness.eligible)
          throw new ConflictException(
            `Chưa thể đóng lớp: ${readiness.blockers.join("; ")}.`,
          );
        const updated = await transaction.learningClass.updateMany({
          where: { id: classId, status: "ACTIVE" },
          data: {
            status: "CLOSED",
            closeReason: reason,
            archivePolicy,
            closedAt: new Date(),
            archivedAt: new Date(),
          },
        });
        if (updated.count !== 1)
          throw new ConflictException(
            "Trạng thái lớp đã thay đổi; hãy kiểm tra lại trước khi đóng.",
          );
        await transaction.auditLog.create({
          data: {
            actorId,
            action: "CLASS_CLOSE_ARCHIVE",
            entityType: "learning_class",
            entityId: classId,
            context: {
              closeReason: reason,
              archivePolicy,
              eligible: readiness.eligible,
              blockers: readiness.blockers,
              openExams: readiness.openExams,
              pendingGrades: readiness.pendingGrades,
              activeSessions: readiness.activeSessions,
            },
          },
        });
        // Chọn người nhận và ghi thông báo trong một lệnh; trigger outbox chạy theo cả lô.
        const notificationPrefix = id("notification");
        await transaction.$executeRaw`
          INSERT INTO notifications (id, recipient_id, type, title, entity_type, entity_id, dedup_key, read_at, created_at)
          SELECT ${notificationPrefix} || ':' || learner_id, learner_id, 'CLASS_ARCHIVED',
            'Lớp học đã kết thúc và chuyển sang chỉ đọc', 'CLASS', ${classId},
            'class-archived:' || ${classId} || ':' || learner_id, NULL, CURRENT_TIMESTAMP
          FROM class_enrollments WHERE class_id = ${classId} AND status = 'ACTIVE'
          ON CONFLICT (dedup_key) DO UPDATE SET read_at = NULL, created_at = EXCLUDED.created_at
        `;
      },
      { isolationLevel: "Serializable" },
    );
    return serviceContext.getDatabaseClass(prisma, classId);
  }
  const readiness = await serviceContext.getClassClosureReadiness(classId);
  if (!readiness.eligible)
    throw new ConflictException(
      `Chưa thể đóng lớp: ${readiness.blockers.join("; ")}.`,
    );
  const item = serviceContext.findClass(classId);
  item.status = "CLOSED";
  item.closeReason = reason;
  item.archivePolicy = archivePolicy;
  item.closedAt = now();
  item.archivedAt = item.closedAt;
  for (const learnerId of item.learnerIds)
    serviceContext.notifications.unshift({
      id: id("notification"),
      recipientId: learnerId,
      type: "CLASS_ARCHIVED",
      title: "Lớp học đã kết thúc và chuyển sang chỉ đọc",
      entityType: "CLASS",
      entityId: classId,
      createdAt: now(),
    });
  return copyLearningClass(item);
}

/** Mở lại lớp đã đóng, xóa thông tin đóng và ghi lý do vào audit. */
export async function reopenClass(
  serviceContext: LearningServiceContext,
  classId: string,
  rawReason: string,
  actorId: string,
): Promise<LearningClass> {
  const reason = rawReason.trim();
  if (reason.length < 5)
    throw new BadRequestException("Lý do mở lại lớp cần ít nhất 5 ký tự.");
  const prisma = serviceContext.database();
  if (prisma) {
    await prisma.$transaction(async (transaction) => {
      const current = await transaction.learningClass.findUnique({
        where: { id: classId },
      });
      if (!current) throw new NotFoundException("Không tìm thấy lớp học.");
      if (current.status !== "CLOSED")
        throw new ConflictException("Chỉ lớp đã đóng mới có thể mở lại.");
      await transaction.learningClass.update({
        where: { id: classId },
        data: {
          status: "ACTIVE",
          closeReason: null,
          archivePolicy: null,
          closedAt: null,
          archivedAt: null,
        },
      });
      await transaction.auditLog.create({
        data: {
          actorId,
          action: "CLASS_REOPEN",
          entityType: "learning_class",
          entityId: classId,
          context: {
            reason,
            previousClosedAt: current.closedAt?.toISOString(),
            previousArchivePolicy: current.archivePolicy,
          },
        },
      });
    });
    return serviceContext.getDatabaseClass(prisma, classId);
  }
  const item = serviceContext.findClass(classId);
  if (item.status !== "CLOSED")
    throw new ConflictException("Chỉ lớp đã đóng mới có thể mở lại.");
  item.status = "ACTIVE";
  item.closeReason = undefined;
  item.archivePolicy = undefined;
  item.closedAt = undefined;
  item.archivedAt = undefined;
  return copyLearningClass(item);
}
