import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { AuthenticatedSession } from "../../../../auth/auth.service.js";
import {
  AssignmentSubmissionView,
  GradebookAssessmentCell,
  GradebookAssessmentColumn,
  GradebookRow,
  GradingQueueGroup,
} from "../../academic/academic.shared.js";
import type { AcademicServiceContext } from "../../academic/academic.context.js";

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
  const rubric = serviceContext.rubric(submission.assignment.rubric, Number(submission.assignment.maxScore));
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
    const updated = await transaction.assignmentSubmission.findUniqueOrThrow({
      where: { id: submissionId },
      include: {
        learner: { select: { displayName: true, email: true } },
        attachments: {
          where: { removedAt: null },
          orderBy: { createdAt: "asc" },
        },
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
        dedupKey: `assignment-grade:${submissionId}:${randomUUID()}`,
      },
    });
    return updated;
  });
  return serviceContext.mapSubmission(row);
}

/** Tổng hợp điểm thi (lấy điểm cao nhất nhiều lượt) và bài tập đã chấm cho từng học viên. */
export async function gradebook(
  serviceContext: AcademicServiceContext,
  classId: string,
  session: AuthenticatedSession,
): Promise<GradebookRow[]> {
  if (session.roleCode === "LEARNER") {
    const access = await serviceContext.prisma.learningClass.findUnique({
      where: { id: classId },
      select: {
        allowPeerGradeViewing: true,
        enrollments: {
          where: { learnerId: session.user.id, status: "ACTIVE" },
          select: { learnerId: true },
        },
      },
    });
    if (!access?.allowPeerGradeViewing || !access.enrollments.length) {
      throw new ForbiddenException("Lớp chưa cho phép học viên xem bảng điểm chung.");
    }
  } else {
    await serviceContext.requireTeachingAccess(classId, session);
  }
  const classItem = await serviceContext.prisma.learningClass.findUnique({
    where: { id: classId },
    include: {
      enrollments: {
        where: { status: "ACTIVE" },
        include: { learner: { select: { displayName: true, email: true } } },
        orderBy: { learner: { displayName: "asc" } },
      },
      exams: {
        where: { hidden: session.roleCode === "LEARNER" ? false : undefined, status: { in: ["PUBLISHED", "CLOSED"] } },
        include: { attempts: { orderBy: { attemptNo: "desc" } } },
      },
      assignments: {
        where: { hidden: session.roleCode === "LEARNER" ? false : undefined, status: { in: ["PUBLISHED", "CLOSED"] } },
        include: { submissions: true },
      },
    },
  });
  if (!classItem) throw new NotFoundException("Không tìm thấy lớp học.");
  const now = new Date();
  const orderedWorks = [
    ...classItem.exams.map((exam) => ({
      id: exam.id,
      kind: "EXAM" as const,
      title: exam.title,
      maxScore: Number(exam.totalScore),
      dueAt: exam.closeAt.toISOString(),
      sortTime: exam.openAt.getTime(),
      exam,
      assignment: null,
    })),
    ...classItem.assignments.map((assignment) => ({
      id: assignment.id,
      kind: "ASSIGNMENT" as const,
      title: assignment.title,
      maxScore: Number(assignment.maxScore),
      dueAt: assignment.dueAt.toISOString(),
      sortTime: assignment.createdAt.getTime(),
      exam: null,
      assignment,
    })),
  ].sort(
    (left, right) =>
      left.sortTime - right.sortTime ||
      left.title.localeCompare(right.title, "vi") ||
      left.id.localeCompare(right.id),
  );
  const assessments: GradebookAssessmentColumn[] = orderedWorks.map((work) => ({
    id: work.id,
    kind: work.kind,
    title: work.title,
    maxScore: work.maxScore,
    dueAt: work.dueAt,
  }));

  return classItem.enrollments.map(({ learnerId, learner }) => {
    let examEarned = 0;
    let examPossible = 0;
    let assignmentEarned = 0;
    let assignmentPossible = 0;
    let awaitingGrade = 0;
    let notSubmitted = 0;
    const cells: GradebookAssessmentCell[] = [];

    for (const work of orderedWorks) {
      if (work.kind === "EXAM" && work.exam) {
        const exam = work.exam;
        const attempts = exam.attempts.filter(
          (attempt) => attempt.learnerId === learnerId,
        );
        const gradedAttempts = attempts.filter(
          (attempt) => attempt.status === "GRADED" && attempt.score !== null,
        );
        const highestAttempt = gradedAttempts.reduce<
          (typeof gradedAttempts)[number] | undefined
        >(
          (best, current) =>
            !best || Number(current.score ?? 0) > Number(best.score ?? 0)
              ? current
              : best,
          undefined,
        );
        if (highestAttempt) {
          const score = Number(highestAttempt.score ?? 0);
          examPossible += Number(exam.totalScore);
          examEarned += score;
          cells.push({
            assessmentId: exam.id,
            kind: "EXAM",
            score,
            maxScore: Number(exam.totalScore),
            status: "GRADED",
            attemptCount: attempts.length,
          });
        } else if (attempts.some((attempt) => attempt.status === "SUBMITTED")) {
          awaitingGrade += 1;
          cells.push({
            assessmentId: exam.id,
            kind: "EXAM",
            score: null,
            maxScore: Number(exam.totalScore),
            status: "AWAITING_GRADE",
            attemptCount: attempts.length,
          });
        } else if (attempts.some((attempt) => attempt.status === "IN_PROGRESS")) {
          awaitingGrade += 1;
          cells.push({
            assessmentId: exam.id,
            kind: "EXAM",
            score: null,
            maxScore: Number(exam.totalScore),
            status: "IN_PROGRESS",
            attemptCount: attempts.length,
          });
        } else {
          if (exam.status === "CLOSED" || exam.closeAt <= now) {
            examPossible += Number(exam.totalScore);
            notSubmitted += 1;
          }
          cells.push({
            assessmentId: exam.id,
            kind: "EXAM",
            score: null,
            maxScore: Number(exam.totalScore),
            status: "NOT_SUBMITTED",
            attemptCount: 0,
          });
        }
      } else if (work.assignment) {
        const assignment = work.assignment;
        const submission = assignment.submissions.find(
          (item) => item.learnerId === learnerId,
        );
        if (submission?.status === "GRADED") {
          const score = Number(submission.score ?? 0);
          assignmentPossible += Number(assignment.maxScore);
          assignmentEarned += score;
          cells.push({
            assessmentId: assignment.id,
            kind: "ASSIGNMENT",
            score,
            maxScore: Number(assignment.maxScore),
            status: "GRADED",
            attemptCount: 1,
          });
        } else if (submission) {
          awaitingGrade += 1;
          cells.push({
            assessmentId: assignment.id,
            kind: "ASSIGNMENT",
            score: null,
            maxScore: Number(assignment.maxScore),
            status: "AWAITING_GRADE",
            attemptCount: 1,
          });
        } else {
          if (assignment.status === "CLOSED" || assignment.dueAt <= now) {
            assignmentPossible += Number(assignment.maxScore);
            notSubmitted += 1;
          }
          cells.push({
            assessmentId: assignment.id,
            kind: "ASSIGNMENT",
            score: null,
            maxScore: Number(assignment.maxScore),
            status: "NOT_SUBMITTED",
            attemptCount: 0,
          });
        }
      }
    }

    const possible = examPossible + assignmentPossible;
    const totalPercent = possible
      ? Math.round(((examEarned + assignmentEarned) / possible) * 10_000) / 100
      : 0;
    return {
      learnerId,
      learnerName: learner.displayName,
      learnerEmail: learner.email,
      examEarned,
      examPossible,
      assignmentEarned,
      assignmentPossible,
      totalPercent,
      averageScore: possible
        ? Math.round(((examEarned + assignmentEarned) / possible) * 1000) / 100
        : null,
      awaitingGrade,
      notSubmitted,
      assessments,
      cells,
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
