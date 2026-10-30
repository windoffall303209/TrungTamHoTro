import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from "@nestjs/common";
import { id } from "../learning.shared.js";
import type { LearningExam, LearningQuestion } from "../learning.types.js";
import type { LearningServiceContext } from "../learning.context.js";

/** Validate lịch/thang điểm/câu hỏi, giữ thứ tự chọn và tạo đề nháp cho lớp phụ trách. */
export async function createExam(
  serviceContext: LearningServiceContext,
  input: Omit<
    LearningExam,
    "id" | "status" | "version" | "questionScores" | "aiContext"
  > & { scoreAllocations?: Array<{ questionId: string; score: number }> },
  actorId = "usr-instructor",
): Promise<LearningExam> {
  if (new Date(input.closeAt) <= new Date(input.openAt))
    throw new BadRequestException("Thời gian đóng đề phải sau thời gian mở.");
  if (!input.questionIds.length)
    throw new BadRequestException("Đề cần ít nhất một câu hỏi.");
  const originalQuestionIds = [...input.questionIds];
  const questionScores = serviceContext.resolveExamScoreAllocations(
    originalQuestionIds,
    input.totalScore,
    input.scoreAllocations,
  );
  const prisma = serviceContext.database();
  if (prisma) {
    return prisma.$transaction(async (transaction) => {
      const classItem = await transaction.learningClass.findFirst({
        where: {
          id: input.classId,
          instructors: { some: { instructorId: actorId } },
        },
      });
      if (!classItem)
        throw new NotFoundException("Không tìm thấy lớp học được phép tạo đề.");
      if (classItem.status === "CLOSED")
        throw new ConflictException("Lớp đã lưu trữ và chỉ cho phép đọc.");
      if (new Set(input.questionIds).size !== input.questionIds.length)
        throw new BadRequestException(
          "Danh sách đề không được chứa câu hỏi trùng.",
        );
      const questionCount = await transaction.question.count({
        where: {
          id: { in: input.questionIds },
          status: "PUBLISHED",
          courseId: classItem.courseId,
        },
      });
      if (questionCount !== input.questionIds.length)
        throw new BadRequestException(
          "Đề chỉ được dùng câu hỏi đã xuất bản thuộc khóa học của lớp.",
        );
      const exam = await transaction.exam.create({
        data: {
          id: id("exam"),
          classId: input.classId,
          title: input.title.trim(),
          durationMinutes: input.durationMinutes,
          totalScore: input.totalScore,
          openAt: new Date(input.openAt),
          closeAt: new Date(input.closeAt),
          attemptLimit: input.attemptLimit,
          shuffleQuestions: input.shuffleQuestions ?? false,
          randomSeed: input.randomSeed?.trim(),
        },
      });
      await transaction.examQuestion.createMany({
        data: originalQuestionIds.map((questionId, position) => ({
          examId: exam.id,
          questionId,
          position: position + 1,
          score: questionScores[questionId]!,
        })),
      });
      return serviceContext.getDatabaseExam(transaction, exam.id);
    });
  }
  const classItem = serviceContext.findClass(input.classId);
  if (!classItem.instructorIds.includes(actorId))
    throw new NotFoundException("Không tìm thấy lớp học được phép tạo đề.");
  if (classItem.status === "CLOSED")
    throw new ConflictException("Lớp đã lưu trữ và chỉ cho phép đọc.");
  if (new Set(input.questionIds).size !== input.questionIds.length)
    throw new BadRequestException(
      "Danh sách đề không được chứa câu hỏi trùng.",
    );
  if (
    input.questionIds.some(
      (questionId) =>
        !serviceContext.questions.some(
          (question) =>
            question.id === questionId &&
            question.status === "PUBLISHED" &&
            question.courseId === classItem.courseId,
        ),
    )
  )
    throw new BadRequestException(
      "Đề chỉ được dùng câu hỏi đã xuất bản thuộc khóa học của lớp.",
    );
  const item: LearningExam = {
    id: id("exam"),
    classId: input.classId,
    title: input.title.trim(),
    questionIds: originalQuestionIds,
    durationMinutes: input.durationMinutes,
    totalScore: input.totalScore,
    openAt: input.openAt,
    closeAt: input.closeAt,
    attemptLimit: input.attemptLimit,
    shuffleQuestions: input.shuffleQuestions,
    randomSeed: input.randomSeed,
    questionScores,
    status: "DRAFT",
    version: 1,
  };
  serviceContext.exams.unshift(item);
  return { ...item, questionIds: [...item.questionIds] };
}

/** Thay nội dung đề DRAFT nguyên tử, tăng version và từ chối bản chỉnh sửa đã cũ. */
export async function updateExam(
  serviceContext: LearningServiceContext,
  examId: string,
  input: Omit<
    LearningExam,
    "id" | "status" | "version" | "questionScores" | "aiContext"
  > & {
    scoreAllocations?: Array<{ questionId: string; score: number }>;
    expectedVersion: number;
  },
  actorId = "usr-instructor",
): Promise<LearningExam> {
  if (new Date(input.closeAt) <= new Date(input.openAt))
    throw new BadRequestException("Thời gian đóng đề phải sau thời gian mở.");
  if (
    !input.questionIds.length ||
    new Set(input.questionIds).size !== input.questionIds.length
  )
    throw new BadRequestException("Đề cần câu hỏi hợp lệ và không được trùng.");
  const questionScores = serviceContext.resolveExamScoreAllocations(
    input.questionIds,
    input.totalScore,
    input.scoreAllocations,
  );
  const prisma = serviceContext.database();
  if (prisma) {
    return prisma.$transaction(async (transaction) => {
      const current = await transaction.exam.findFirst({
        where: {
          id: examId,
          class: { instructors: { some: { instructorId: actorId } } },
        },
        include: { class: true },
      });
      if (!current)
        throw new NotFoundException("Không tìm thấy đề được phép chỉnh sửa.");
      if (current.class.status === "CLOSED")
        throw new ConflictException("Lớp đã lưu trữ và chỉ cho phép đọc.");
      if (current.status !== "DRAFT")
        throw new ConflictException("Chỉ đề nháp mới được chỉnh sửa.");
      if (current.version !== input.expectedVersion)
        throw new ConflictException(
          "Đề đã được cập nhật ở nơi khác; hãy tải lại trước khi sửa.",
        );
      const questionCount = await transaction.question.count({
        where: {
          id: { in: input.questionIds },
          status: "PUBLISHED",
          courseId: current.class.courseId,
        },
      });
      if (questionCount !== input.questionIds.length)
        throw new BadRequestException(
          "Đề chỉ được dùng câu hỏi đã xuất bản thuộc khóa học của lớp.",
        );
      const claimed = await transaction.exam.updateMany({
        where: {
          id: examId,
          status: "DRAFT",
          version: input.expectedVersion,
        },
        data: {
          title: input.title.trim(),
          durationMinutes: input.durationMinutes,
          totalScore: input.totalScore,
          openAt: new Date(input.openAt),
          closeAt: new Date(input.closeAt),
          attemptLimit: input.attemptLimit,
          shuffleQuestions: input.shuffleQuestions ?? false,
          randomSeed: input.randomSeed?.trim(),
          version: { increment: 1 },
        },
      });
      if (claimed.count !== 1)
        throw new ConflictException(
          "Đề đã thay đổi; hãy tải lại trước khi sửa.",
        );
      await transaction.examQuestion.deleteMany({ where: { examId } });
      await transaction.examQuestion.createMany({
        data: input.questionIds.map((questionId, position) => ({
          examId,
          questionId,
          position: position + 1,
          score: questionScores[questionId]!,
        })),
      });
      await transaction.auditLog.create({
        data: {
          actorId,
          action: "EXAM_DRAFT_UPDATED",
          entityType: "exam",
          entityId: examId,
          context: {
            previousVersion: input.expectedVersion,
            nextVersion: input.expectedVersion + 1,
            questionIds: input.questionIds,
            questionScores,
          },
        },
      });
      return serviceContext.getDatabaseExam(transaction, examId);
    });
  }
  const current = serviceContext.findExam(examId);
  const classItem = serviceContext.findClass(current.classId);
  if (!classItem.instructorIds.includes(actorId))
    throw new NotFoundException("Không tìm thấy đề được phép chỉnh sửa.");
  if (classItem.status === "CLOSED")
    throw new ConflictException("Lớp đã lưu trữ và chỉ cho phép đọc.");
  if (current.status !== "DRAFT")
    throw new ConflictException("Chỉ đề nháp mới được chỉnh sửa.");
  if (current.version !== input.expectedVersion)
    throw new ConflictException(
      "Đề đã được cập nhật ở nơi khác; hãy tải lại trước khi sửa.",
    );
  if (
    input.questionIds.some(
      (questionId) =>
        !serviceContext.questions.some(
          (question) =>
            question.id === questionId &&
            question.status === "PUBLISHED" &&
            question.courseId === classItem.courseId,
        ),
    )
  )
    throw new BadRequestException(
      "Đề chỉ được dùng câu hỏi đã xuất bản thuộc khóa học của lớp.",
    );
  Object.assign(current, {
    title: input.title.trim(),
    questionIds: [...input.questionIds],
    durationMinutes: input.durationMinutes,
    totalScore: input.totalScore,
    openAt: input.openAt,
    closeAt: input.closeAt,
    attemptLimit: input.attemptLimit,
    shuffleQuestions: input.shuffleQuestions,
    randomSeed: input.randomSeed,
    questionScores,
    version: current.version + 1,
  });
  return {
    ...current,
    questionIds: [...current.questionIds],
    questionScores: { ...current.questionScores },
  };
}

/** Sửa câu trong đề nháp bằng bản sao riêng; giữ nguyên các đề đang dùng câu gốc. */
export async function editExamQuestion(
  serviceContext: LearningServiceContext,
  examId: string,
  questionId: string,
  input: {
    content: string;
    options: string[];
    correctAnswers: string[];
    expectedVersion: number;
  },
  actorId: string,
): Promise<LearningQuestion> {
  const prisma = serviceContext.database();
  if (prisma)
    return prisma.$transaction(async (tx) => {
      const exam = await tx.exam.findFirst({
        where: {
          id: examId,
          class: { instructors: { some: { instructorId: actorId } } },
        },
        include: { class: true, questions: { include: { question: true } } },
      });
      if (!exam)
        throw new NotFoundException("Không tìm thấy đề được phép sửa.");
      if (exam.status !== "DRAFT" || exam.class.status === "CLOSED")
        throw new ConflictException(
          "Chỉ sửa câu hỏi trong đề nháp của lớp đang hoạt động.",
        );
      const link = exam.questions.find(
        (item) => item.questionId === questionId,
      );
      if (!link)
        throw new NotFoundException("Câu hỏi không còn thuộc đề. Hãy tải lại.");
      if (exam.version !== input.expectedVersion)
        throw new ConflictException(
          "Đề đã thay đổi. Hãy tải lại trước khi sửa.",
        );
      const normalized = serviceContext.validateQuestionInput({
        ...serviceContext.mapQuestion(link.question),
        content: input.content,
        options: input.options,
        correctAnswers: input.correctAnswers,
      });
      const changed = await tx.exam.updateMany({
        where: { id: examId, status: "DRAFT", version: input.expectedVersion },
        data: { version: { increment: 1 } },
      });
      if (changed.count !== 1)
        throw new ConflictException("Đề đã thay đổi. Hãy tải lại.");
      const questionIdNew = id("question");
      const question = await tx.question.create({
        data: {
          id: questionIdNew,
          familyId: questionIdNew,
          courseId: link.question.courseId,
          authorId: actorId,
          type: normalized.type,
          content: normalized.content,
          contentHash: serviceContext.questionContentHash(normalized.content),
          options: normalized.options,
          correctAnswers: normalized.correctAnswers,
          difficulty: normalized.difficulty,
          tags: normalized.tags,
          status: "DRAFT",
          version: 1,
          imageObjectKey: link.question.imageObjectKey,
          imageName: link.question.imageName,
          imageMimeType: link.question.imageMimeType,
          imageSizeBytes: link.question.imageSizeBytes,
          imageChecksum: link.question.imageChecksum,
        },
      });
      await tx.examQuestion.update({
        where: { examId_questionId: { examId, questionId } },
        data: { questionId: question.id },
      });
      await tx.auditLog.create({
        data: {
          actorId,
          action: "EXAM_QUESTION_EDITED",
          entityType: "exam",
          entityId: examId,
          context: { oldQuestionId: questionId, questionId: question.id },
        },
      });
      return serviceContext.mapQuestion(question);
    });
  const exam = serviceContext.findExam(examId);
  const classItem = serviceContext.findClass(exam.classId);
  if (!classItem.instructorIds.includes(actorId))
    throw new NotFoundException("Không tìm thấy đề được phép sửa.");
  if (
    exam.status !== "DRAFT" ||
    classItem.status === "CLOSED" ||
    exam.version !== input.expectedVersion
  )
    throw new ConflictException(
      "Đề không còn được sửa hoặc đã thay đổi. Hãy tải lại.",
    );
  const original = serviceContext.questions.find(
    (item) => item.id === questionId && exam.questionIds.includes(questionId),
  );
  if (!original) throw new NotFoundException("Câu hỏi không còn thuộc đề.");
  const normalized = serviceContext.validateQuestionInput({
    ...original,
    content: input.content,
    options: input.options,
    correctAnswers: input.correctAnswers,
  });
  const nextId = id("question");
  const next: LearningQuestion = {
    ...original,
    ...normalized,
    id: nextId,
    familyId: nextId,
    status: "DRAFT",
    version: 1,
  };
  serviceContext.questions.push(next);
  exam.questionIds = exam.questionIds.map((value) =>
    value === questionId ? next.id : value,
  );
  if (exam.questionScores) {
    exam.questionScores[next.id] = exam.questionScores[questionId]!;
    delete exam.questionScores[questionId];
  }
  exam.version += 1;
  return serviceContext.cloneQuestion(next);
}
