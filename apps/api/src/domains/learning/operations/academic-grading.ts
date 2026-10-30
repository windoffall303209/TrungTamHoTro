import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { AuthenticatedSession } from "../../../auth/auth.service.js";
import {
  AssignmentSubmissionView,
  GradebookRow,
  GradingQueueGroup,
} from "../academic.shared.js";
import type { AcademicServiceContext } from "../academic.context.js";

/** Kiểm tra điểm từng rubric không vượt trần rồi lưu kết quả và thời điểm chấm. */
export async function gradeSubmission(
  serviceContext: AcademicServiceContext,
  submissionId: string,
  rubricScores: Array<{ criterionId: string; score: number }>,
  feedback: string,
  expectedSubmissionRevision: number,
  correctionReason: string | undefined,
  session: AuthenticatedSession,
): Promise<AssignmentSubmissionView> {
  const submission =
    await serviceContext.prisma.assignmentSubmission.findUnique({
      where: { id: submissionId },
      include: { assignment: true },
    });
  if (!submission) throw new NotFoundException("Không tìm thấy bài nộp.");
  await serviceContext.requireTeachingAccess(
    submission.assignment.classId,
    session,
    true,
  );
  if (submission.revision !== expectedSubmissionRevision)
    throw new ConflictException(
      "Học viên đã nộp phiên bản mới. Hãy tải lại bài trước khi chấm.",
    );
  const correction = submission.status === "GRADED";
  if (correction && !correctionReason?.trim())
    throw new BadRequestException("Sửa điểm đã công bố phải ghi rõ lý do.");
  const rubric = serviceContext.rubric(submission.assignment.rubric);
  if (
    rubricScores.length !== rubric.length ||
    new Set(rubricScores.map((item) => item.criterionId)).size !== rubric.length
  )
    throw new BadRequestException(
      "Điểm rubric phải có đúng một giá trị cho từng tiêu chí.",
    );
  let total = 0;
  for (const criterion of rubric) {
    const score = rubricScores.find(
      (item) => item.criterionId === criterion.id,
    )?.score;
    if (score === undefined || score > criterion.maxPoints)
      throw new BadRequestException(
        `Điểm tiêu chí ${criterion.title} vượt giới hạn.`,
      );
    total += score;
  }
  const row = await serviceContext.prisma.$transaction(async (transaction) => {
    const changed = await transaction.assignmentSubmission.updateMany({
      where: {
        id: submissionId,
        revision: expectedSubmissionRevision,
        updatedAt: submission.updatedAt,
      },
      data: {
        status: "GRADED",
        score: total,
        rubricScores,
        feedback: feedback.trim(),
        gradedBy: session.user.id,
        gradedAt: new Date(),
      },
    });
    if (changed.count !== 1)
      throw new ConflictException(
        "Bài nộp hoặc điểm vừa thay đổi ở nơi khác. Hãy tải lại trước khi lưu.",
      );
    const gradeChangeId = `assignment-grade-${randomUUID()}`;
    await transaction.assignmentGradeChange.create({
      data: {
        id: gradeChangeId,
        submissionId,
        submissionRevision: submission.revision,
        actorId: session.user.id,
        action: correction ? "CORRECTED" : "GRADED",
        previousScore: submission.score,
        nextScore: total,
        previousRubric: submission.rubricScores ?? undefined,
        nextRubric: rubricScores,
        previousFeedback: submission.feedback,
        nextFeedback: feedback.trim(),
        reason: correctionReason?.trim(),
      },
    });
    const updated = await transaction.assignmentSubmission.findUniqueOrThrow({
      where: { id: submissionId },
      include: {
        learner: { select: { displayName: true, email: true } },
        attachments: {
          where: { removedAt: null },
          orderBy: { createdAt: "asc" },
        },
        gradeChanges: { orderBy: { createdAt: "desc" } },
      },
    });
    await transaction.notification.create({
      data: {
        id: `notification-${randomUUID()}`,
        recipientId: submission.learnerId,
        type: correction ? "ASSIGNMENT_GRADE_CORRECTED" : "ASSIGNMENT_GRADED",
        title: correction
          ? `Điểm bài ${submission.assignment.title} đã được cập nhật`
          : `Đã chấm bài: ${submission.assignment.title}`,
        entityType: "ASSIGNMENT",
        entityId: submission.assignmentId,
        dedupKey: `assignment-grade:${gradeChangeId}:${submission.learnerId}`,
      },
    });
    return updated;
  });
  return serviceContext.mapSubmission(row);
}

/** Tổng hợp điểm thi và bài tập đã chấm thành tỷ lệ chung cho từng học viên. */
export async function gradebook(
  serviceContext: AcademicServiceContext,
  classId: string,
  session: AuthenticatedSession,
): Promise<GradebookRow[]> {
  await serviceContext.requireTeachingAccess(classId, session);
  const classItem = await serviceContext.prisma.learningClass.findUnique({
    where: { id: classId },
    include: {
      enrollments: {
        where: { status: "ACTIVE" },
        include: { learner: { select: { displayName: true, email: true } } },
      },
      exams: {
        where: { status: { in: ["PUBLISHED", "CLOSED"] } },
        include: { attempts: true },
      },
      assignments: {
        where: { status: { in: ["PUBLISHED", "CLOSED"] } },
        include: { submissions: true },
      },
    },
  });
  if (!classItem) throw new NotFoundException("Không tìm thấy lớp học.");
  return classItem.enrollments.map(({ learnerId, learner }) => {
    let examEarned = 0;
    let examPossible = 0;
    let assignmentEarned = 0;
    let assignmentPossible = 0;
    let awaitingGrade = 0;
    let notSubmitted = 0;
    for (const exam of classItem.exams) {
      const attempts = exam.attempts.filter(
        (attempt) => attempt.learnerId === learnerId,
      );
      const graded = attempts.filter((attempt) => attempt.status === "GRADED");
      if (graded.length) {
        examPossible += Number(exam.totalScore);
        examEarned += Math.max(
          ...graded.map((attempt) => Number(attempt.score ?? 0)),
        );
      } else if (
        attempts.some(
          (attempt) =>
            attempt.status === "SUBMITTED" || attempt.status === "IN_PROGRESS",
        )
      )
        awaitingGrade += 1;
      else if (exam.status === "CLOSED" || exam.closeAt <= new Date()) {
        examPossible += Number(exam.totalScore);
        notSubmitted += 1;
      }
    }
    for (const assignment of classItem.assignments) {
      const submission = assignment.submissions.find(
        (item) => item.learnerId === learnerId,
      );
      if (submission?.status === "GRADED") {
        assignmentPossible += Number(assignment.maxScore);
        assignmentEarned += Number(submission.score ?? 0);
      } else if (submission) awaitingGrade += 1;
      else if (
        assignment.status === "CLOSED" ||
        assignment.dueAt <= new Date()
      ) {
        assignmentPossible += Number(assignment.maxScore);
        notSubmitted += 1;
      }
    }
    const possible = examPossible + assignmentPossible;
    return {
      learnerId,
      learnerName: learner.displayName,
      learnerEmail: learner.email,
      examEarned,
      examPossible,
      assignmentEarned,
      assignmentPossible,
      totalPercent: possible
        ? Math.round(((examEarned + assignmentEarned) / possible) * 10_000) /
          100
        : 0,
      awaitingGrade,
      notSubmitted,
    };
  });
}

/** Gom bài tập và bài thi theo lớp → bài → bài nộp cho một hàng đợi chấm duy nhất. */
export async function gradingQueue(
  serviceContext: AcademicServiceContext,
  session: AuthenticatedSession,
  classId?: string,
): Promise<GradingQueueGroup[]> {
  const classIds = await serviceContext.accessibleClassIds(session);
  if (
    session.roleCode !== "INSTRUCTOR" ||
    !session.permissions.includes("exam:manage")
  )
    throw new ForbiddenException("Hàng đợi chấm chỉ dành cho giảng viên.");
  if (classId && !classIds.includes(classId))
    throw new NotFoundException(
      "Không tìm thấy lớp học trong phạm vi giảng dạy.",
    );
  const scopedIds = classId ? [classId] : classIds;
  const [assignments, exams] = await Promise.all([
    serviceContext.prisma.assignment.findMany({
      where: {
        classId: { in: scopedIds },
        status: { in: ["PUBLISHED", "CLOSED"] },
      },
      include: {
        class: { select: { code: true, grade: true, subject: true } },
        submissions: {
          include: {
            learner: { select: { displayName: true, email: true } },
          },
          orderBy: { submittedAt: "asc" },
        },
      },
      orderBy: [{ class: { code: "asc" } }, { dueAt: "asc" }],
    }),
    serviceContext.prisma.exam.findMany({
      where: {
        classId: { in: scopedIds },
        status: { in: ["PUBLISHED", "CLOSED"] },
      },
      include: {
        class: { select: { code: true, grade: true, subject: true } },
        attempts: {
          where: { status: { in: ["SUBMITTED", "GRADED"] } },
          include: {
            learner: { select: { displayName: true, email: true } },
          },
          orderBy: { submittedAt: "asc" },
        },
      },
      orderBy: [{ class: { code: "asc" } }, { closeAt: "asc" }],
    }),
  ]);
  const assignmentGroups: GradingQueueGroup[] = assignments.map(
    (assignment) => ({
      id: assignment.id,
      type: "ASSIGNMENT",
      classId: assignment.classId,
      classCode: assignment.class.code,
      grade: assignment.class.grade,
      subject: assignment.class.subject,
      title: assignment.title,
      maxScore: Number(assignment.maxScore),
      submittedCount: assignment.submissions.length,
      pendingCount: assignment.submissions.filter(
        (item) => item.status === "SUBMITTED",
      ).length,
      items: assignment.submissions.map((item) => ({
        id: item.id,
        learnerId: item.learnerId,
        learnerName: item.learner.displayName,
        learnerEmail: item.learner.email,
        status: item.status,
        submittedAt: item.submittedAt.toISOString(),
        revision: item.revision,
      })),
    }),
  );
  const examGroups: GradingQueueGroup[] = exams.map((exam) => ({
    id: exam.id,
    type: "EXAM",
    classId: exam.classId,
    classCode: exam.class.code,
    grade: exam.class.grade,
    subject: exam.class.subject,
    title: exam.title,
    maxScore: Number(exam.totalScore),
    submittedCount: exam.attempts.length,
    pendingCount: exam.attempts.filter((item) => item.status === "SUBMITTED")
      .length,
    items: exam.attempts.map((item) => ({
      id: item.id,
      learnerId: item.learnerId,
      learnerName: item.learner.displayName,
      learnerEmail: item.learner.email,
      status: item.status as "SUBMITTED" | "GRADED",
      submittedAt: (item.submittedAt ?? item.startedAt).toISOString(),
    })),
  }));
  return [...assignmentGroups, ...examGroups].sort(
    (left, right) =>
      left.classCode.localeCompare(right.classCode, "vi") ||
      right.pendingCount - left.pendingCount ||
      left.title.localeCompare(right.title, "vi"),
  );
}
