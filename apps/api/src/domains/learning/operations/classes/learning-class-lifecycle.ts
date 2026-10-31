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
  actorId = "usr-manager",
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
      unlockedAttendanceSessions,
      openAppeals,
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
      prisma.liveSession.count({
        where: { classId, status: "COMPLETED", attendanceLockedAt: null },
      }),
      prisma.attendanceAppeal.count({
        where: {
          session: { classId },
          status: { in: ["OPEN", "IN_REVIEW"] },
        },
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
        unlockedAttendanceSessions,
        openAppeals,
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
      unlockedAttendanceSessions: classSessions.filter(
        (session) =>
          session.status === "COMPLETED" && !session.attendanceLockedAt,
      ).length,
      openAppeals: serviceContext.attendanceAppeals.filter(
        (appeal) =>
          classSessions.some((session) => session.id === appeal.sessionId) &&
          ["OPEN", "IN_REVIEW"].includes(appeal.status),
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
  const current = await database.learningClass.findUnique({
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
    unlockedAttendanceSessions,
    openAppeals,
  ] = await Promise.all([
    database.exam.count({
      where: {
        classId,
        OR: [
          { status: "PENDING_REVIEW" },
          { status: "PUBLISHED", closeAt: { gt: new Date() } },
        ],
      },
    }),
    database.examAttempt.count({
      where: { exam: { classId }, status: "IN_PROGRESS" },
    }),
    database.examAttempt.count({
      where: { exam: { classId }, status: "SUBMITTED" },
    }),
    database.assignment.count({
      where: { classId, status: "PUBLISHED", dueAt: { gt: new Date() } },
    }),
    database.assignmentSubmission.count({
      where: { assignment: { classId }, status: "SUBMITTED" },
    }),
    database.regradeRequest.count({
      where: {
        attempt: { exam: { classId } },
        status: { in: ["OPEN", "IN_REVIEW"] },
      },
    }),
    database.liveSession.count({
      where: { classId, status: { in: ["SCHEDULED", "LIVE"] } },
    }),
    database.liveSession.count({
      where: { classId, status: "COMPLETED", attendanceLockedAt: null },
    }),
    database.attendanceAppeal.count({
      where: { session: { classId }, status: { in: ["OPEN", "IN_REVIEW"] } },
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
      unlockedAttendanceSessions,
      openAppeals,
    },
  );
}

/** Đóng lớp chỉ khi readiness không còn blocker và lưu chính sách lưu trữ. */
export async function closeClass(
  serviceContext: LearningServiceContext,
  classId: string,
  closeReason: string,
  archivePolicy: "STANDARD_RETENTION" | "LONG_TERM_RETENTION",
  actorId = "usr-manager",
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
              unlockedAttendanceSessions: readiness.unlockedAttendanceSessions,
              openAppeals: readiness.openAppeals,
            },
          },
        });
        const recipients = await transaction.classEnrollment.findMany({
          where: { classId, status: "ACTIVE" },
          select: { learnerId: true },
        });
        for (const recipient of recipients)
          await transaction.notification.upsert({
            where: {
              dedupKey: `class-archived:${classId}:${recipient.learnerId}`,
            },
            update: { readAt: null, createdAt: new Date() },
            create: {
              id: id("notification"),
              recipientId: recipient.learnerId,
              type: "CLASS_ARCHIVED",
              title: "Lớp học đã kết thúc và chuyển sang chỉ đọc",
              entityType: "CLASS",
              entityId: classId,
              dedupKey: `class-archived:${classId}:${recipient.learnerId}`,
            },
          });
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
  actorId = "usr-manager",
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
