import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from "@nestjs/common";
import { id, now } from "../learning.shared.js";
import type {
  ClassProgressReport,
  ProgressIntervention,
  RiskThresholds,
} from "../learning.types.js";
import type { LearningServiceContext } from "../learning.context.js";

/** Tổng hợp điểm danh, điểm số, hoàn thành học liệu và sinh phân loại rủi ro từng học viên. */
export async function getClassProgress(
  serviceContext: LearningServiceContext,
  classId: string,
  input: { from?: string; to?: string } & Partial<RiskThresholds>,
): Promise<ClassProgressReport> {
  const { from, to } = serviceContext.reportingPeriod(input.from, input.to);
  const thresholds: RiskThresholds = {
    attendanceBelow: input.attendanceBelow ?? 70,
    scoreBelow: input.scoreBelow ?? 50,
    completionBelow: input.completionBelow ?? 60,
  };
  serviceContext.validateRiskThresholds(thresholds);
  const prisma = serviceContext.database();
  if (prisma) {
    const classItem = await prisma.learningClass.findUnique({
      where: { id: classId },
      include: {
        enrollments: { where: { status: "ACTIVE" } },
        materials: {
          where: { visibility: "PUBLISHED" },
          include: {
            accessLogs: { where: { createdAt: { gte: from, lte: to } } },
          },
        },
        exams: {
          where: { openAt: { lte: to }, closeAt: { gte: from } },
          include: {
            attempts: { where: { submittedAt: { gte: from, lte: to } } },
          },
        },
        assignments: {
          where: {
            status: { in: ["PUBLISHED", "CLOSED"] },
            dueAt: { gte: from, lte: to },
          },
          include: { submissions: { where: { submittedAt: { lte: to } } } },
        },
        sessions: {
          where: {
            startsAt: { gte: from, lte: to },
            status: { in: ["COMPLETED", "LIVE"] },
          },
          include: { attendance: true },
        },
      },
    });
    if (!classItem) throw new NotFoundException("Không tìm thấy lớp học.");
    const interventions = await prisma.progressIntervention.findMany({
      where: { classId },
      orderBy: { createdAt: "desc" },
    });
    const learners = classItem.enrollments.map(({ learnerId }) => {
      const accessedMaterialIds = new Set(
        classItem.materials
          .filter((material) =>
            material.accessLogs.some((log) => log.userId === learnerId),
          )
          .map((material) => material.id),
      );
      const attempts = classItem.exams.flatMap((exam) =>
        exam.attempts
          .filter((attempt) => attempt.learnerId === learnerId)
          .map((attempt) => ({
            ...attempt,
            totalScore: Number(exam.totalScore),
          })),
      );
      const assignmentSubmissions = classItem.assignments.flatMap(
        (assignment) =>
          assignment.submissions
            .filter((submission) => submission.learnerId === learnerId)
            .map((submission) => ({
              ...submission,
              assignmentMaxScore: Number(assignment.maxScore),
            })),
      );
      const completedExamIds = new Set(
        attempts
          .filter((attempt) => attempt.status !== "IN_PROGRESS")
          .map((attempt) => attempt.examId),
      );
      let earned = 0;
      let possible = 0;
      for (const exam of classItem.exams) {
        const learnerAttempts = exam.attempts.filter(
          (attempt) => attempt.learnerId === learnerId,
        );
        const graded = learnerAttempts.filter(
          (attempt) => attempt.status === "GRADED",
        );
        if (graded.length) {
          earned += Math.max(
            ...graded.map((attempt) => Number(attempt.score ?? 0)),
          );
          possible += Number(exam.totalScore);
        } else if (exam.status === "CLOSED" || exam.closeAt <= to)
          possible += Number(exam.totalScore);
      }
      for (const assignment of classItem.assignments) {
        const submission = assignment.submissions.find(
          (candidate) => candidate.learnerId === learnerId,
        );
        if (submission?.status === "GRADED") {
          earned += Number(submission.score ?? 0);
          possible += Number(assignment.maxScore);
        } else if (assignment.status === "CLOSED" || assignment.dueAt <= to)
          possible += Number(assignment.maxScore);
      }
      const attendance = classItem.sessions.flatMap((session) =>
        session.attendance.filter((record) => record.learnerId === learnerId),
      );
      const activityDates = [
        ...classItem.materials.flatMap((material) =>
          material.accessLogs
            .filter((log) => log.userId === learnerId)
            .map((log) => log.createdAt),
        ),
        ...attempts.flatMap((attempt) =>
          attempt.submittedAt ? [attempt.submittedAt] : [],
        ),
        ...assignmentSubmissions.map((submission) => submission.submittedAt),
        ...attendance.flatMap((record) =>
          record.joinedAt ? [record.joinedAt] : [],
        ),
      ];
      const completedAssessments =
        completedExamIds.size +
        new Set(
          assignmentSubmissions.map((submission) => submission.assignmentId),
        ).size;
      const totalAssessments =
        classItem.exams.length + classItem.assignments.length;
      return serviceContext.buildLearnerProgress({
        learnerId,
        materialCompletionRate: serviceContext.percentage(
          accessedMaterialIds.size,
          classItem.materials.length,
        ),
        assessmentCompletionRate: serviceContext.percentage(
          completedAssessments,
          totalAssessments,
        ),
        attendanceRate: serviceContext.percentage(
          attendance.filter(
            (record) => record.status === "PRESENT" || record.status === "LATE",
          ).length,
          classItem.sessions.length,
        ),
        averageScore: possible
          ? Math.round((earned / possible) * 10_000) / 100
          : 0,
        lastActivityAt: serviceContext.latestDate(activityDates),
        thresholds,
        interventions: interventions
          .filter((item) => item.learnerId === learnerId)
          .map((item) => serviceContext.mapProgressIntervention(item)),
      });
    });
    return {
      classId,
      classCode: classItem.code,
      from: from.toISOString(),
      to: to.toISOString(),
      thresholds,
      learners,
      generatedAt: now(),
    };
  }
  const classItem = serviceContext.findClass(classId);
  const materials = serviceContext.materials.filter(
    (material) =>
      material.classId === classId && material.visibility === "PUBLISHED",
  );
  const exams = serviceContext.exams.filter(
    (exam) =>
      exam.classId === classId &&
      new Date(exam.openAt) <= to &&
      new Date(exam.closeAt) >= from,
  );
  const sessions = serviceContext.sessions.filter(
    (session) =>
      session.classId === classId &&
      new Date(session.startsAt) >= from &&
      new Date(session.startsAt) <= to &&
      ["COMPLETED", "LIVE"].includes(session.status),
  );
  const learners = classItem.learnerIds.map((learnerId) => {
    const accessLogs = serviceContext.materialAccessLogs.filter(
      (log) =>
        log.userId === learnerId &&
        materials.some((material) => material.id === log.materialId) &&
        new Date(log.createdAt) >= from &&
        new Date(log.createdAt) <= to,
    );
    const attempts = serviceContext.attempts.filter(
      (attempt) =>
        attempt.learnerId === learnerId &&
        exams.some((exam) => exam.id === attempt.examId) &&
        attempt.submittedAt &&
        new Date(attempt.submittedAt) >= from &&
        new Date(attempt.submittedAt) <= to,
    );
    const attendance = serviceContext.attendance.filter(
      (record) =>
        record.learnerId === learnerId &&
        sessions.some((session) => session.id === record.sessionId),
    );
    const activityDates = [
      ...accessLogs.map((log) => new Date(log.createdAt)),
      ...attempts.flatMap((attempt) =>
        attempt.submittedAt ? [new Date(attempt.submittedAt)] : [],
      ),
      ...attendance.flatMap((record) =>
        record.joinedAt ? [new Date(record.joinedAt)] : [],
      ),
    ];
    return serviceContext.buildLearnerProgress({
      learnerId,
      materialCompletionRate: serviceContext.percentage(
        new Set(accessLogs.map((log) => log.materialId)).size,
        materials.length,
      ),
      assessmentCompletionRate: serviceContext.percentage(
        new Set(attempts.map((attempt) => attempt.examId)).size,
        exams.length,
      ),
      attendanceRate: serviceContext.percentage(
        attendance.filter(
          (record) => record.status === "PRESENT" || record.status === "LATE",
        ).length,
        sessions.length,
      ),
      averageScore: attempts.length
        ? Math.round(
            (attempts.reduce((sum, attempt) => {
              const exam = exams.find(
                (candidate) => candidate.id === attempt.examId,
              );
              return (
                sum +
                (exam ? ((attempt.score ?? 0) / exam.totalScore) * 100 : 0)
              );
            }, 0) /
              attempts.length) *
              100,
          ) / 100
        : 0,
      lastActivityAt: serviceContext.latestDate(activityDates),
      thresholds,
      interventions: serviceContext.progressInterventions
        .filter(
          (item) => item.classId === classId && item.learnerId === learnerId,
        )
        .map((item) => ({ ...item })),
    });
  });
  return {
    classId,
    classCode: classItem.code,
    from: from.toISOString(),
    to: to.toISOString(),
    thresholds,
    learners,
    generatedAt: now(),
  };
}

/** Tạo kế hoạch can thiệp, giao đúng giảng viên của lớp và lưu riêng người tạo. */
export async function createProgressIntervention(
  serviceContext: LearningServiceContext,
  classId: string,
  input: Pick<
    ProgressIntervention,
    "learnerId" | "title" | "notes" | "dueAt"
  > & { assigneeId: string },
  createdById = "usr-manager",
): Promise<ProgressIntervention> {
  const dueAt = new Date(input.dueAt);
  if (Number.isNaN(dueAt.getTime()) || dueAt <= new Date())
    throw new BadRequestException("Hạn hành động hỗ trợ phải ở tương lai.");
  const title = input.title.trim();
  const prisma = serviceContext.database();
  if (prisma) {
    const [classItem, enrollment, assignee] = await Promise.all([
      prisma.learningClass.findUnique({
        where: { id: classId },
        select: { status: true, code: true },
      }),
      prisma.classEnrollment.findFirst({
        where: { classId, learnerId: input.learnerId, status: "ACTIVE" },
      }),
      prisma.classInstructor.findUnique({
        where: {
          classId_instructorId: { classId, instructorId: input.assigneeId },
        },
      }),
    ]);
    if (!classItem) throw new NotFoundException("Không tìm thấy lớp học.");
    if (classItem.status === "CLOSED")
      throw new ConflictException("Lớp đã lưu trữ và chỉ cho phép đọc.");
    if (!enrollment)
      throw new NotFoundException("Học viên không thuộc lớp đang hoạt động.");
    if (!assignee)
      throw new BadRequestException(
        "Người phụ trách phải là giảng viên đang được phân công cho lớp.",
      );
    const row = await prisma.$transaction(async (transaction) => {
      const created = await transaction.progressIntervention.create({
        data: {
          id: id("intervention"),
          classId,
          learnerId: input.learnerId,
          ownerId: input.assigneeId,
          createdById,
          title,
          notes: input.notes?.trim(),
          dueAt,
          handoffHistory: [],
        },
      });
      await transaction.notification.upsert({
        where: {
          dedupKey: `progress-assigned:${created.id}:${input.assigneeId}`,
        },
        update: { readAt: null, createdAt: new Date() },
        create: {
          id: id("notification"),
          recipientId: input.assigneeId,
          type: "PROGRESS_INTERVENTION_ASSIGNED",
          title: `Bạn được giao hỗ trợ một học viên của lớp ${classItem.code}`,
          entityType: "PROGRESS_INTERVENTION",
          entityId: created.id,
          dedupKey: `progress-assigned:${created.id}:${input.assigneeId}`,
        },
      });
      await transaction.auditLog.create({
        data: {
          actorId: createdById,
          action: "PROGRESS_INTERVENTION_CREATED",
          entityType: "progress_intervention",
          entityId: created.id,
          context: {
            classId,
            learnerId: input.learnerId,
            assigneeId: input.assigneeId,
            dueAt: dueAt.toISOString(),
          },
        },
      });
      return created;
    });
    return serviceContext.mapProgressIntervention(row);
  }
  const classItem = serviceContext.findClass(classId);
  if (classItem.status === "CLOSED")
    throw new ConflictException("Lớp đã lưu trữ và chỉ cho phép đọc.");
  if (!classItem.learnerIds.includes(input.learnerId))
    throw new NotFoundException("Học viên không thuộc lớp đang hoạt động.");
  if (!classItem.instructorIds.includes(input.assigneeId))
    throw new BadRequestException(
      "Người phụ trách phải là giảng viên đang được phân công cho lớp.",
    );
  const item: ProgressIntervention = {
    id: id("intervention"),
    classId,
    learnerId: input.learnerId,
    ownerId: input.assigneeId,
    createdById,
    title,
    notes: input.notes?.trim(),
    dueAt: dueAt.toISOString(),
    status: "OPEN",
    history: [],
    createdAt: now(),
  };
  serviceContext.progressInterventions.unshift(item);
  serviceContext.notifications.unshift({
    id: id("notification"),
    recipientId: input.assigneeId,
    type: "PROGRESS_INTERVENTION_ASSIGNED",
    title: `Bạn được giao hỗ trợ một học viên của lớp ${classItem.code}`,
    entityType: "PROGRESS_INTERVENTION",
    entityId: item.id,
    createdAt: now(),
  });
  return { ...item };
}

/** Liệt kê hành động hỗ trợ đang thuộc trách nhiệm của người dùng hiện tại. */
export async function listMyProgressInterventions(
  serviceContext: LearningServiceContext,
  ownerId: string,
): Promise<ProgressIntervention[]> {
  const prisma = serviceContext.database();
  if (prisma) {
    const rows = await prisma.progressIntervention.findMany({
      where: { ownerId },
      orderBy: [{ status: "asc" }, { dueAt: "asc" }],
    });
    return rows.map((row) => serviceContext.mapProgressIntervention(row));
  }
  return serviceContext.progressInterventions
    .filter((item) => item.ownerId === ownerId)
    .map((item) => structuredClone(item));
}

/** Nhận, hoàn tất hoặc hủy hành động hỗ trợ theo quyền sở hữu và điều kiện kết quả. */
export async function updateProgressIntervention(
  serviceContext: LearningServiceContext,
  interventionId: string,
  input: {
    status: "IN_PROGRESS" | "DONE" | "CANCELLED";
    outcome?: string;
    cancellationReason?: string;
  },
  actorId = "usr-manager",
  actorRole = "CENTER_MANAGER",
): Promise<ProgressIntervention> {
  const outcome = input.outcome?.trim();
  const cancellationReason = input.cancellationReason?.trim();
  if (input.status === "DONE" && (!outcome || outcome.length < 5))
    throw new BadRequestException("Kết quả hỗ trợ cần ít nhất 5 ký tự.");
  if (
    input.status === "CANCELLED" &&
    (!cancellationReason || cancellationReason.length < 5)
  )
    throw new BadRequestException("Lý do hủy cần ít nhất 5 ký tự.");
  const prisma = serviceContext.database();
  if (prisma) {
    const current = await prisma.progressIntervention.findUnique({
      where: { id: interventionId },
    });
    if (!current)
      throw new NotFoundException("Không tìm thấy hành động hỗ trợ.");
    if (!["OPEN", "IN_PROGRESS"].includes(current.status))
      throw new ConflictException("Hành động hỗ trợ đã kết thúc.");
    if (
      current.ownerId !== actorId &&
      !["CENTER_MANAGER", "SYSTEM_ADMIN"].includes(actorRole)
    )
      throw new ConflictException(
        "Chỉ người được giao hoặc quản lý mới được cập nhật hành động này.",
      );
    if (current.status === "IN_PROGRESS" && input.status === "IN_PROGRESS")
      throw new ConflictException("Hành động hỗ trợ đã được nhận xử lý.");
    const terminal = ["DONE", "CANCELLED"].includes(input.status);
    const row = await prisma.$transaction(async (transaction) => {
      const claimed = await transaction.progressIntervention.updateMany({
        where: { id: interventionId, status: current.status },
        data: {
          status: input.status,
          acceptedAt:
            input.status === "IN_PROGRESS" ? new Date() : current.acceptedAt,
          completedAt: terminal ? new Date() : null,
          outcome: input.status === "DONE" ? outcome : null,
          cancellationReason:
            input.status === "CANCELLED" ? cancellationReason : null,
        },
      });
      if (claimed.count !== 1)
        throw new ConflictException(
          "Hành động đã được người khác cập nhật; hãy tải lại.",
        );
      if (terminal) {
        const recipients = new Set([current.createdById, current.ownerId]);
        for (const recipientId of recipients)
          await transaction.notification.upsert({
            where: {
              dedupKey: `progress-${input.status.toLowerCase()}:${interventionId}:${recipientId}`,
            },
            update: { readAt: null, createdAt: new Date() },
            create: {
              id: id("notification"),
              recipientId,
              type: `PROGRESS_INTERVENTION_${input.status}`,
              title:
                input.status === "DONE"
                  ? "Hành động hỗ trợ học viên đã hoàn tất"
                  : "Hành động hỗ trợ học viên đã bị hủy",
              entityType: "PROGRESS_INTERVENTION",
              entityId: interventionId,
              dedupKey: `progress-${input.status.toLowerCase()}:${interventionId}:${recipientId}`,
            },
          });
      }
      await transaction.auditLog.create({
        data: {
          actorId,
          action: `PROGRESS_INTERVENTION_${input.status}`,
          entityType: "progress_intervention",
          entityId: interventionId,
          context: {
            previousStatus: current.status,
            nextStatus: input.status,
            outcome,
            cancellationReason,
          },
        },
      });
      return transaction.progressIntervention.findUniqueOrThrow({
        where: { id: interventionId },
      });
    });
    return serviceContext.mapProgressIntervention(row);
  }
  const item = serviceContext.progressInterventions.find(
    (candidate) => candidate.id === interventionId,
  );
  if (!item) throw new NotFoundException("Không tìm thấy hành động hỗ trợ.");
  if (!["OPEN", "IN_PROGRESS"].includes(item.status))
    throw new ConflictException("Hành động hỗ trợ đã kết thúc.");
  if (
    item.ownerId !== actorId &&
    !["CENTER_MANAGER", "SYSTEM_ADMIN"].includes(actorRole)
  )
    throw new ConflictException(
      "Chỉ người được giao hoặc quản lý mới được cập nhật hành động này.",
    );
  if (item.status === "IN_PROGRESS" && input.status === "IN_PROGRESS")
    throw new ConflictException("Hành động hỗ trợ đã được nhận xử lý.");
  item.status = input.status;
  item.acceptedAt = input.status === "IN_PROGRESS" ? now() : item.acceptedAt;
  item.completedAt = ["DONE", "CANCELLED"].includes(input.status)
    ? now()
    : undefined;
  item.outcome = input.status === "DONE" ? outcome : undefined;
  item.cancellationReason =
    input.status === "CANCELLED" ? cancellationReason : undefined;
  return { ...item };
}

/** Bàn giao hành động đang mở cho giảng viên khác và lưu toàn bộ dấu vết chuyển giao. */
export async function transferProgressIntervention(
  serviceContext: LearningServiceContext,
  interventionId: string,
  assigneeId: string,
  rawReason: string,
  actorId = "usr-manager",
): Promise<ProgressIntervention> {
  const reason = rawReason.trim();
  if (reason.length < 5)
    throw new BadRequestException("Lý do bàn giao cần ít nhất 5 ký tự.");
  const prisma = serviceContext.database();
  if (prisma) {
    const current = await prisma.progressIntervention.findUnique({
      where: { id: interventionId },
    });
    if (!current)
      throw new NotFoundException("Không tìm thấy hành động hỗ trợ.");
    if (!["OPEN", "IN_PROGRESS"].includes(current.status))
      throw new ConflictException(
        "Chỉ có thể bàn giao hành động chưa kết thúc.",
      );
    if (current.ownerId === assigneeId)
      throw new BadRequestException(
        "Người nhận bàn giao phải khác người hiện tại.",
      );
    const assignment = await prisma.classInstructor.findUnique({
      where: {
        classId_instructorId: {
          classId: current.classId,
          instructorId: assigneeId,
        },
      },
    });
    if (!assignment)
      throw new BadRequestException(
        "Người nhận phải là giảng viên đang được phân công cho lớp.",
      );
    const history = serviceContext.progressInterventionHistory(
      current.handoffHistory,
    );
    history.push({
      fromOwnerId: current.ownerId,
      toOwnerId: assigneeId,
      reason,
      actorId,
      createdAt: now(),
    });
    const row = await prisma.$transaction(async (transaction) => {
      const claimed = await transaction.progressIntervention.updateMany({
        where: {
          id: interventionId,
          ownerId: current.ownerId,
          status: current.status,
        },
        data: {
          ownerId: assigneeId,
          status: "OPEN",
          acceptedAt: null,
          handoffHistory: history,
        },
      });
      if (claimed.count !== 1)
        throw new ConflictException(
          "Hành động đã được cập nhật; hãy tải lại trước khi bàn giao.",
        );
      await transaction.notification.upsert({
        where: {
          dedupKey: `progress-transferred:${interventionId}:${assigneeId}:${history.length}`,
        },
        update: { readAt: null, createdAt: new Date() },
        create: {
          id: id("notification"),
          recipientId: assigneeId,
          type: "PROGRESS_INTERVENTION_ASSIGNED",
          title: "Bạn vừa nhận bàn giao một hành động hỗ trợ học viên",
          entityType: "PROGRESS_INTERVENTION",
          entityId: interventionId,
          dedupKey: `progress-transferred:${interventionId}:${assigneeId}:${history.length}`,
        },
      });
      await transaction.auditLog.create({
        data: {
          actorId,
          action: "PROGRESS_INTERVENTION_TRANSFERRED",
          entityType: "progress_intervention",
          entityId: interventionId,
          context: {
            fromOwnerId: current.ownerId,
            toOwnerId: assigneeId,
            reason,
          },
        },
      });
      return transaction.progressIntervention.findUniqueOrThrow({
        where: { id: interventionId },
      });
    });
    return serviceContext.mapProgressIntervention(row);
  }
  const item = serviceContext.progressInterventions.find(
    (candidate) => candidate.id === interventionId,
  );
  if (!item) throw new NotFoundException("Không tìm thấy hành động hỗ trợ.");
  if (!["OPEN", "IN_PROGRESS"].includes(item.status))
    throw new ConflictException("Chỉ có thể bàn giao hành động chưa kết thúc.");
  if (item.ownerId === assigneeId)
    throw new BadRequestException(
      "Người nhận bàn giao phải khác người hiện tại.",
    );
  if (
    !serviceContext.findClass(item.classId).instructorIds.includes(assigneeId)
  )
    throw new BadRequestException(
      "Người nhận phải là giảng viên đang được phân công cho lớp.",
    );
  item.history.push({
    fromOwnerId: item.ownerId,
    toOwnerId: assigneeId,
    reason,
    actorId,
    createdAt: now(),
  });
  item.ownerId = assigneeId;
  item.status = "OPEN";
  item.acceptedAt = undefined;
  return structuredClone(item);
}
