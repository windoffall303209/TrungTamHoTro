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
  GradebookResponse,
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
    // Ghi đầy đủ dấu vết chấm lần đầu và sửa điểm đã công bố (điểm trước/sau, người chấm và lý do).
    await transaction.auditLog.create({
      data: {
        actorId: session.user.id,
        action: correction ? "ASSIGNMENT_GRADE_CORRECTED" : "ASSIGNMENT_GRADED",
        entityType: "assignment_submission",
        entityId: submissionId,
        context: {
          assignmentId: submission.assignmentId,
          learnerId: submission.learnerId,
          previousScore: submission.score === null ? null : Number(submission.score),
          newScore: total,
          reason: correction ? correctionReason!.trim() : "Chấm lần đầu",
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

/** Tổng hợp điểm thi (lấy điểm cao nhất nhiều lượt) và bài tập đã chấm theo payload gọn không lặp cột đề. */
export async function gradebook(
  serviceContext: AcademicServiceContext,
  classId: string,
  session: AuthenticatedSession,
): Promise<GradebookResponse> {
  // Học viên luôn xem được dòng điểm của chính mình; khi lớp bật xem chung chỉ thấy điểm ẩn danh của bạn cùng lớp.
  let learnerScope: "ALL" | "SELF" | "PEERS_ANONYMOUS" = "ALL";
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
    if (!access?.enrollments.length) {
      throw new ForbiddenException("Học viên không thuộc lớp này.");
    }
    learnerScope = access.allowPeerGradeViewing ? "PEERS_ANONYMOUS" : "SELF";
  } else if (session.roleCode !== "CENTER_MANAGER" && session.roleCode !== "SYSTEM_ADMIN") {
    // Cấp quản lý được đọc sổ điểm mọi lớp; giảng viên chỉ đọc lớp được phân công.
    await serviceContext.requireTeachingAccess(classId, session);
  }
  const selfLearnerFilter = learnerScope === "SELF" ? { learnerId: session.user.id } : {};
  const classItem = await serviceContext.prisma.learningClass.findUnique({
    where: { id: classId },
    select: {
      id: true,
      enrollments: {
        where: { status: "ACTIVE", ...selfLearnerFilter },
        select: {
          learnerId: true,
          learner: { select: { displayName: true, email: true } },
        },
        orderBy: { learner: { displayName: "asc" } },
      },
      exams: {
        where: { hidden: session.roleCode === "LEARNER" ? false : undefined, status: { in: ["PUBLISHED", "CLOSED"] } },
        select: {
          id: true,
          title: true,
          totalScore: true,
          openAt: true,
          closeAt: true,
          hidden: true,
          status: true,
          // Chỉ chọn trạng thái và điểm, không kéo JSON câu trả lời chi tiết lên RAM.
          attempts: {
            where: selfLearnerFilter,
            select: { learnerId: true, status: true, score: true },
          },
        },
      },
      assignments: {
        where: { hidden: session.roleCode === "LEARNER" ? false : undefined, status: { in: ["PUBLISHED", "CLOSED"] } },
        select: {
          id: true,
          title: true,
          maxScore: true,
          dueAt: true,
          createdAt: true,
          hidden: true,
          status: true,
          // Sổ điểm chỉ cần trạng thái và điểm; không kéo nội dung bài luận/nhận xét (tới 20 KB mỗi bài) của cả lớp lên RAM.
          submissions: {
            where: selfLearnerFilter,
            select: { learnerId: true, status: true, score: true },
          },
        },
      },
    },
  });
  if (!classItem) throw new NotFoundException("Không tìm thấy lớp học.");
  const now = new Date();
  const orderedWorks = [
    ...classItem.exams.map((exam) => {
      const attemptsByLearner = new Map<
        string,
        Array<{ learnerId: string; status: string; score: unknown }>
      >();
      for (const attempt of exam.attempts) {
        const list = attemptsByLearner.get(attempt.learnerId);
        if (list) list.push(attempt);
        else attemptsByLearner.set(attempt.learnerId, [attempt]);
      }
      return {
        id: exam.id,
        kind: "EXAM" as const,
        title: exam.title,
        maxScore: Number(exam.totalScore),
        dueAt: exam.closeAt.toISOString(),
        sortTime: exam.openAt.getTime(),
        exam,
        attemptsByLearner,
        assignment: null,
        submissionsByLearner: null,
      };
    }),
    ...classItem.assignments.map((assignment) => {
      const submissionsByLearner = new Map<
        string,
        { learnerId: string; status: string; score: unknown }
      >();
      for (const submission of assignment.submissions) {
        submissionsByLearner.set(submission.learnerId, submission);
      }
      return {
        id: assignment.id,
        kind: "ASSIGNMENT" as const,
        title: assignment.title,
        maxScore: Number(assignment.maxScore),
        dueAt: assignment.dueAt.toISOString(),
        sortTime: assignment.createdAt.getTime(),
        exam: null,
        attemptsByLearner: null,
        assignment,
        submissionsByLearner,
      };
    }),
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

  const rows: GradebookRow[] = classItem.enrollments.map(({ learnerId, learner }) => {
    let examEarned = 0;
    let examPossible = 0;
    let assignmentEarned = 0;
    let assignmentPossible = 0;
    let awaitingGrade = 0;
    let notSubmitted = 0;
    // Trung bình theo phần trăm từng bài (mỗi bài cùng trọng số) thay vì cộng thô điểm tuyệt đối khiến bài thang 100
    // nặng gấp 10 lần đề thang 10; bài đang ẩn hiển thị trong ô nhưng không tính vào trung bình ở mọi góc nhìn.
    let percentSum = 0;
    let scoredItems = 0;
    // Ma trận thưa: chỉ gửi các ô có hoạt động (GRADED / AWAITING_GRADE / IN_PROGRESS), ô khuyết mặc định là chưa nộp.
    const cells: GradebookAssessmentCell[] = [];

    for (const work of orderedWorks) {
      if (work.kind === "EXAM" && work.exam && work.attemptsByLearner) {
        const exam = work.exam;
        const counts = !exam.hidden;
        const attempts = work.attemptsByLearner.get(learnerId) ?? [];
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
          if (counts) {
            examPossible += Number(exam.totalScore);
            examEarned += score;
            percentSum += Number(exam.totalScore) > 0 ? score / Number(exam.totalScore) : 0;
            scoredItems += 1;
          }
          cells.push({
            assessmentId: exam.id,
            score,
            status: "GRADED",
            ...(attempts.length > 1 ? { attemptCount: attempts.length } : {}),
          });
        } else if (attempts.some((attempt) => attempt.status === "SUBMITTED")) {
          awaitingGrade += 1;
          cells.push({
            assessmentId: exam.id,
            status: "AWAITING_GRADE",
            ...(attempts.length > 1 ? { attemptCount: attempts.length } : {}),
          });
        } else if (attempts.some((attempt) => attempt.status === "IN_PROGRESS")) {
          awaitingGrade += 1;
          cells.push({
            assessmentId: exam.id,
            status: "IN_PROGRESS",
            ...(attempts.length > 1 ? { attemptCount: attempts.length } : {}),
          });
        } else if (counts && (exam.status === "CLOSED" || exam.closeAt <= now)) {
          examPossible += Number(exam.totalScore);
          notSubmitted += 1;
          scoredItems += 1;
        }
      } else if (work.assignment && work.submissionsByLearner) {
        const assignment = work.assignment;
        const counts = !assignment.hidden;
        const submission = work.submissionsByLearner.get(learnerId);
        if (submission?.status === "GRADED") {
          const score = Number(submission.score ?? 0);
          if (counts) {
            assignmentPossible += Number(assignment.maxScore);
            assignmentEarned += score;
            percentSum += Number(assignment.maxScore) > 0 ? score / Number(assignment.maxScore) : 0;
            scoredItems += 1;
          }
          cells.push({
            assessmentId: assignment.id,
            score,
            status: "GRADED",
          });
        } else if (submission) {
          awaitingGrade += 1;
          cells.push({
            assessmentId: assignment.id,
            status: "AWAITING_GRADE",
          });
        } else if (counts && (assignment.status === "CLOSED" || assignment.dueAt <= now)) {
          assignmentPossible += Number(assignment.maxScore);
          notSubmitted += 1;
          scoredItems += 1;
        }
      }
    }

    const totalPercent = scoredItems ? Math.round((percentSum / scoredItems) * 10_000) / 100 : 0;
    return {
      learnerId,
      learnerName: learner.displayName,
      learnerEmail: learner.email,
      examEarned,
      examPossible,
      assignmentEarned,
      assignmentPossible,
      totalPercent,
      averageScore: scoredItems ? Math.round((percentSum / scoredItems) * 1000) / 100 : null,
      awaitingGrade,
      notSubmitted,
      cells,
    };
  });
  if (learnerScope === "SELF") {
    return { assessments, rows: rows.filter((row) => row.learnerId === session.user.id) };
  }
  if (learnerScope === "PEERS_ANONYMOUS") {
    return { assessments, rows: anonymizePeerRows(rows, session.user.id) };
  }
  return { assessments, rows };
}

/**
 * Bảng điểm chung cho học viên: giữ nguyên dòng của chính học viên, các dòng khác bỏ email/learnerId/họ tên và
 * trạng thái chi tiết (đang làm, chờ chấm, số lượt), chỉ còn điểm đã chấm và xếp theo điểm để không suy ra danh tính.
 */
function anonymizePeerRows(rows: GradebookRow[], selfId: string): GradebookRow[] {
  const self = rows.filter((row) => row.learnerId === selfId);
  const peers = rows
    .filter((row) => row.learnerId !== selfId)
    .sort((left, right) => right.totalPercent - left.totalPercent)
    .map((row, index) => ({
      ...row,
      learnerId: `peer-${index + 1}`,
      learnerName: "Học viên ẩn danh",
      learnerEmail: null,
      awaitingGrade: 0,
      notSubmitted: 0,
      cells: row.cells
        ?.filter((cell) => cell.status === "GRADED" && typeof cell.score === "number")
        .map((cell) => ({
          assessmentId: cell.assessmentId,
          score: cell.score,
          status: "GRADED" as const,
        })),
    }));
  return [...self, ...peers];
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
        // Hàng đợi chấm chỉ hiển thị metadata bài nộp, không cần nội dung/feedback.
        submissions: {
          select: {
            id: true,
            learnerId: true,
            status: true,
            submittedAt: true,
            revision: true,
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
