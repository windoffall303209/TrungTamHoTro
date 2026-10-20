import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from "@nestjs/common";
import { id, now } from "../learning.shared.js";
import type { ExamApprovalRecord, LearningExam } from "../learning.types.js";
import type { LearningServiceContext } from "../learning.context.js";
import { examQuestionIssues } from "./learning-question-rules.js";

/** Chặn gửi duyệt khi còn câu sai cấu trúc hoặc trùng nội dung, nêu rõ số câu. */
function assertExamQuestionsReady(
  questions: Parameters<typeof examQuestionIssues>[0],
): void {
  const issues = examQuestionIssues(questions);
  const index = issues.findIndex((items) => items.length > 0);
  if (index >= 0)
    throw new BadRequestException(
      `Câu ${index + 1}: ${issues[index]![0]} Hãy sửa trước khi gửi duyệt.`,
    );
}

/** Kiểm tra đề hoàn chỉnh rồi tự công bố hoặc đưa vào hàng đợi duyệt theo cấu hình. */
export async function submitExamForReview(
  serviceContext: LearningServiceContext,
  examId: string,
  actorId = "usr-instructor",
  confirmQuestions = false,
  expectedVersion?: number,
): Promise<LearningExam> {
  const approvalMode = await serviceContext.getExamApprovalMode();
  const nextStatus: LearningExam["status"] =
    approvalMode === "AUTO" ? "PUBLISHED" : "PENDING_REVIEW";
  const prisma = serviceContext.database();
  if (prisma) {
    const assignment = await prisma.exam.findFirst({
      where: {
        id: examId,
        class: { instructors: { some: { instructorId: actorId } } },
      },
      include: { class: { include: { instructors: true } } },
    });
    if (!assignment)
      throw new NotFoundException("Không tìm thấy đề được phép gửi duyệt.");
    const exam = await serviceContext.getDatabaseExam(prisma, examId);
    if (!exam.questionIds.length)
      throw new BadRequestException("Đề cần ít nhất một câu hỏi.");
    const publishedQuestionCount = await prisma.examQuestion.count({
      where: { examId, question: { status: "PUBLISHED" } },
    });
    if (!confirmQuestions && publishedQuestionCount !== exam.questionIds.length)
      throw new ConflictException(
        "Mọi câu hỏi trong đề phải được phê duyệt trước khi gửi duyệt đề.",
      );
    if (exam.status !== "DRAFT")
      throw new ConflictException("Chỉ đề nháp mới được gửi duyệt.");
    assertExamQuestionsReady(
      (
        await prisma.examQuestion.findMany({
          where: { examId },
          orderBy: { position: "asc" },
          include: { question: true },
        })
      ).map(({ question }) => serviceContext.mapQuestion(question)),
    );
    if (assignment.class.status === "CLOSED")
      throw new ConflictException("Lớp đã lưu trữ và chỉ cho phép đọc.");
    if (
      assignment.closeAt <= new Date() ||
      assignment.openAt < assignment.class.startAt ||
      assignment.closeAt > assignment.class.endAt
    )
      throw new ConflictException(
        "Lịch đề không còn hợp lệ trong thời gian của lớp.",
      );
    return prisma.$transaction(async (transaction) => {
      const changed = await transaction.exam.updateMany({
        where: {
          id: examId,
          status: "DRAFT",
          version: expectedVersion ?? exam.version,
        },
        data: { status: nextStatus },
      });
      if (changed.count !== 1)
        throw new ConflictException(
          "Đề đã thay đổi. Hãy tải lại trước khi xác nhận.",
        );
      if (confirmQuestions) {
        const linked = await transaction.examQuestion.findMany({
          where: { examId },
          include: { question: true },
        });
        for (const { question } of linked) {
          serviceContext.validateQuestionInput(
            serviceContext.mapQuestion(question),
          );
          if (question.status !== "PUBLISHED") {
            if (question.authorId !== actorId)
              throw new ConflictException(
                "Không thể xác nhận câu chưa duyệt của người khác. Hãy sửa thành bản riêng trong đề.",
              );
            await transaction.question.update({
              where: { id: question.id },
              data: { status: "PUBLISHED" },
            });
            await transaction.auditLog.create({
              data: {
                actorId,
                action: "QUESTION_CONFIRMED_WITH_EXAM",
                entityType: "question",
                entityId: question.id,
                context: { examId, version: question.version },
              },
            });
          }
        }
      }
      if (approvalMode === "AUTO") {
        await transaction.auditLog.create({
          data: {
            actorId,
            action: "EXAM_AUTO_APPROVED",
            entityType: "exam",
            entityId: examId,
            context: { version: exam.version, approvalMode },
          },
        });
        for (const { instructorId } of assignment.class.instructors)
          await transaction.notification.create({
            data: {
              id: id("notification"),
              recipientId: instructorId,
              type: "EXAM_REVIEWED",
              title: `Đề ${assignment.title} đã được tự động phê duyệt`,
              entityType: "EXAM",
              entityId: examId,
              dedupKey: `exam-auto-approval:${examId}:${exam.version}:${instructorId}`,
            },
          });
      }
      return serviceContext.getDatabaseExam(transaction, examId);
    });
  }
  const item = serviceContext.findExam(examId);
  if (!serviceContext.findClass(item.classId).instructorIds.includes(actorId))
    throw new NotFoundException("Không tìm thấy đề được phép gửi duyệt.");
  if (!item.questionIds.length)
    throw new BadRequestException("Đề cần ít nhất một câu hỏi.");
  if (
    !confirmQuestions &&
    item.questionIds.some(
      (questionId) =>
        serviceContext.questions.find((question) => question.id === questionId)
          ?.status !== "PUBLISHED",
    )
  )
    throw new ConflictException(
      "Mọi câu hỏi trong đề phải được phê duyệt trước khi gửi duyệt đề.",
    );
  if (item.status !== "DRAFT")
    throw new ConflictException("Chỉ đề nháp mới được gửi duyệt.");
  assertExamQuestionsReady(
    item.questionIds.flatMap((questionId) =>
      serviceContext.questions.filter((question) => question.id === questionId),
    ),
  );
  const classWindow = serviceContext.findClass(item.classId);
  if (classWindow.status === "CLOSED")
    throw new ConflictException("Lớp đã lưu trữ và chỉ cho phép đọc.");
  if (
    new Date(item.closeAt) <= new Date() ||
    new Date(item.openAt) < new Date(classWindow.startAt) ||
    new Date(item.closeAt) > new Date(classWindow.endAt)
  )
    throw new ConflictException(
      "Lịch đề không còn hợp lệ trong thời gian của lớp.",
    );
  if (expectedVersion !== undefined && item.version !== expectedVersion)
    throw new ConflictException("Đề đã thay đổi. Hãy tải lại.");
  if (confirmQuestions) {
    const linked = item.questionIds.map((questionId) =>
      serviceContext.questions.find((question) => question.id === questionId),
    );
    for (const question of linked) {
      if (!question) throw new NotFoundException("Không tìm thấy câu hỏi.");
      serviceContext.validateQuestionInput(question);
    }
    for (const question of linked) question!.status = "PUBLISHED";
  }
  item.status = nextStatus;
  if (approvalMode === "AUTO")
    for (const recipientId of serviceContext.findClass(item.classId)
      .instructorIds)
      serviceContext.notifications.unshift({
        id: id("notification"),
        recipientId,
        type: "EXAM_REVIEWED",
        title: `Đề ${item.title} đã được tự động phê duyệt`,
        entityType: "EXAM",
        entityId: examId,
        createdAt: now(),
      });
  return { ...item, questionIds: [...item.questionIds] };
}

/** Chốt duyệt/từ chối đề, lưu approval record và thông báo cho người tạo. */
export async function reviewExam(
  serviceContext: LearningServiceContext,
  examId: string,
  decision: ExamApprovalRecord["decision"],
  rawNote?: string,
  reviewerId = "usr-manager",
): Promise<LearningExam> {
  const reviewNote = rawNote?.trim();
  if (decision === "RETURN" && (!reviewNote || reviewNote.length < 5))
    throw new BadRequestException("Cần lý do ít nhất 5 ký tự khi trả lại đề.");
  const nextStatus: LearningExam["status"] =
    decision === "APPROVE" ? "PUBLISHED" : "DRAFT";
  const prisma = serviceContext.database();
  if (prisma) {
    return prisma.$transaction(async (transaction) => {
      const current = await transaction.exam.findUnique({
        where: { id: examId },
        include: { class: { include: { instructors: true } } },
      });
      if (!current) throw new NotFoundException("Không tìm thấy đề.");
      if (current.status !== "PENDING_REVIEW")
        throw new ConflictException("Đề không ở trạng thái chờ phê duyệt.");
      if (current.class.status === "CLOSED")
        throw new ConflictException("Lớp đã lưu trữ và chỉ cho phép đọc.");
      if (
        decision === "APPROVE" &&
        (current.closeAt <= new Date() ||
          current.openAt < current.class.startAt ||
          current.closeAt > current.class.endAt)
      )
        throw new ConflictException(
          "Lịch đề không còn hợp lệ trong thời gian của lớp.",
        );
      const approvalId = id("exam-approval");
      await transaction.examApproval.create({
        data: {
          id: approvalId,
          examId,
          reviewerId,
          examVersion: current.version,
          decision,
          reviewNote,
        },
      });
      await transaction.auditLog.create({
        data: {
          actorId: reviewerId,
          action: `EXAM_${decision}`,
          entityType: "exam",
          entityId: examId,
          context: {
            version: current.version,
            reviewNote: reviewNote ?? "Đạt yêu cầu",
          },
        },
      });
      for (const { instructorId } of current.class.instructors)
        await transaction.notification.create({
          data: {
            id: id("notification"),
            recipientId: instructorId,
            type: "EXAM_REVIEWED",
            title: `Đề ${current.title}: ${decision}`,
            entityType: "EXAM",
            entityId: examId,
            dedupKey: `exam-review:${approvalId}:${instructorId}`,
          },
        });
      await transaction.exam.update({
        where: { id: examId },
        data: { status: nextStatus },
      });
      return serviceContext.getDatabaseExam(transaction, examId);
    });
  }
  const item = serviceContext.findExam(examId);
  if (item.status !== "PENDING_REVIEW")
    throw new ConflictException("Đề không ở trạng thái chờ phê duyệt.");
  const classWindow = serviceContext.findClass(item.classId);
  if (classWindow.status === "CLOSED")
    throw new ConflictException("Lớp đã lưu trữ và chỉ cho phép đọc.");
  if (
    decision === "APPROVE" &&
    (new Date(item.closeAt) <= new Date() ||
      new Date(item.openAt) < new Date(classWindow.startAt) ||
      new Date(item.closeAt) > new Date(classWindow.endAt))
  )
    throw new ConflictException(
      "Lịch đề không còn hợp lệ trong thời gian của lớp.",
    );
  const approval: ExamApprovalRecord = {
    id: id("exam-approval"),
    examId,
    reviewerId,
    examVersion: item.version,
    decision,
    reviewNote,
    createdAt: now(),
  };
  serviceContext.examApprovals.unshift(approval);
  item.status = nextStatus;
  for (const recipientId of serviceContext.findClass(item.classId)
    .instructorIds)
    serviceContext.notifications.unshift({
      id: id("notification"),
      recipientId,
      type: "EXAM_REVIEWED",
      title: `Đề ${item.title}: ${decision}`,
      entityType: "EXAM",
      entityId: examId,
      createdAt: now(),
    });
  return { ...item, questionIds: [...item.questionIds] };
}

/** Liệt kê lịch sử phê duyệt của một đề thi. */
export async function listExamApprovals(
  serviceContext: LearningServiceContext,
  examId: string,
): Promise<ExamApprovalRecord[]> {
  const prisma = serviceContext.database();
  if (prisma) {
    const rows = await prisma.examApproval.findMany({
      where: { examId },
      orderBy: { createdAt: "desc" },
    });
    return rows.map((row) => ({
      id: row.id,
      examId: row.examId,
      reviewerId: row.reviewerId,
      examVersion: row.examVersion,
      decision: row.decision === "APPROVE" ? "APPROVE" : "RETURN",
      reviewNote: row.reviewNote ?? undefined,
      createdAt: row.createdAt.toISOString(),
    }));
  }
  return serviceContext.examApprovals
    .filter((item) => item.examId === examId)
    .map((item) => ({ ...item }));
}
