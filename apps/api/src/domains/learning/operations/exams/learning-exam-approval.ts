import type { Prisma } from "../../../../generated/prisma/client.js";
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from "@nestjs/common";
import { id, now } from "../../core/learning.shared.js";
import type { LearningExam } from "../../core/learning.types.js";
import type { LearningServiceContext } from "../../core/learning.context.js";
import { examQuestionIssues } from "../questions/learning-question-rules.js";

const publishedTitle = "Đề thi đã được công bố.";

/** Chặn công bố khi còn câu sai cấu trúc hoặc trùng nội dung, nêu rõ số câu. */
function assertExamQuestionsReady(
  questions: Parameters<typeof examQuestionIssues>[0],
): void {
  const issues = examQuestionIssues(questions);
  const index = issues.findIndex((items) => items.length > 0);
  if (index >= 0)
    throw new BadRequestException(
      `Câu ${index + 1}: ${issues[index]![0]} Hãy sửa trước khi công bố.`,
    );
}

/** Kiểm tra nội dung và lịch lớp trước khi công bố đề. */
export async function submitExamForReview(
  serviceContext: LearningServiceContext,
  examId: string,
  actorId = "usr-instructor",
  confirmQuestions = false,
  expectedVersion?: number,
  forcePublish = false,
  creationTransaction?: Prisma.TransactionClient,
): Promise<LearningExam> {
  const nextStatus = "PUBLISHED";
  const database = serviceContext.database();
  const prisma = creationTransaction ?? database;
  if (prisma) {
    const assignment = await prisma.exam.findFirst({
      where: {
        id: examId,
        class: { instructors: { some: { instructorId: actorId } } },
      },
      include: { class: { include: { instructors: true } } },
    });
    if (!assignment)
      throw new NotFoundException("Không tìm thấy đề được phép công bố.");
    const exam = await serviceContext.getDatabaseExam(prisma, examId);
    if (!exam.questionIds.length)
      throw new BadRequestException("Đề cần ít nhất một câu hỏi.");
    if (expectedVersion !== undefined && exam.version !== expectedVersion) throw new ConflictException("Đề đã thay đổi. Hãy tải lại.");
    if (exam.status === "PUBLISHED") return exam;
    if (exam.status !== "DRAFT")
      throw new ConflictException("Chỉ đề nháp mới được công bố.");
    const linkedQuestions = await prisma.examQuestion.findMany({
      where: { examId }, orderBy: { position: "asc" }, include: { question: true },
    });
    if (!confirmQuestions && !forcePublish && linkedQuestions.some(({ question }) => question.status !== "PUBLISHED"))
      throw new ConflictException("Mọi câu hỏi trong đề phải được phê duyệt hoặc xác nhận khi công bố đề.");
    assertExamQuestionsReady(linkedQuestions.map(({ question }) => serviceContext.mapQuestion(question)));
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
    // Công bố đề thi cùng câu hỏi liên kết ngay trong transaction tạo đề nếu có.
    const publish = async (
      transaction: Prisma.TransactionClient,
    ): Promise<LearningExam> => {
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
      const linked = await transaction.examQuestion.findMany({
        where: { examId },
        include: { question: true },
      });
      for (const { question } of linked) {
        serviceContext.validateQuestionInput(
          serviceContext.mapQuestion(question),
        );
        if (question.status !== "PUBLISHED") {
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
      await transaction.auditLog.create({ data: {
        actorId, action: "EXAM_PUBLISHED", entityType: "exam", entityId: examId,
        context: { version: exam.version },
      } });
      await transaction.notification.createMany({
        data: assignment.class.instructors.map(({ instructorId }) => ({
          id: id("notification"), recipientId: instructorId, type: "EXAM_PUBLISHED",
          title: publishedTitle, entityType: "EXAM", entityId: examId,
          dedupKey: ["exam-auto-approval", examId, exam.version, instructorId].join(":"),
        })),
      });
      return serviceContext.getDatabaseExam(transaction, examId);
    };
    return creationTransaction ? publish(creationTransaction) : database!.$transaction(publish);
  }
  const item = serviceContext.findExam(examId);


  if (!serviceContext.findClass(item.classId).instructorIds.includes(actorId))
    throw new NotFoundException("Không tìm thấy đề được phép công bố.");
  if (!item.questionIds.length)
    throw new BadRequestException("Đề cần ít nhất một câu hỏi.");
  if (expectedVersion !== undefined && item.version !== expectedVersion) throw new ConflictException("Đề đã thay đổi. Hãy tải lại.");
    if (item.status === "PUBLISHED") return { ...item, questionIds: [...item.questionIds] };
  if (item.status !== "DRAFT")
    throw new ConflictException("Chỉ đề nháp mới được công bố.");
  if (!confirmQuestions && !forcePublish && item.questionIds.some((id) => serviceContext.questions.find((q) => q.id === id)?.status !== "PUBLISHED"))
    throw new ConflictException("Mọi câu hỏi trong đề phải được phê duyệt hoặc xác nhận khi công bố đề.");
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
  const linked = item.questionIds.map((questionId) =>
    serviceContext.questions.find((question) => question.id === questionId),
  );
  for (const question of linked) {
    if (!question) throw new NotFoundException("Không tìm thấy câu hỏi.");
    serviceContext.validateQuestionInput(question);
  }
  for (const question of linked) question!.status = "PUBLISHED";
  item.status = nextStatus;
  for (const recipientId of classWindow.instructorIds) serviceContext.notifications.unshift({
    id: id("notification"), recipientId, type: "EXAM_PUBLISHED",
    title: publishedTitle, entityType: "EXAM", entityId: examId, createdAt: now(),
  });
  return { ...item, questionIds: [...item.questionIds] };
}
