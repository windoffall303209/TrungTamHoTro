import { submitExamForReview } from "./learning-exam-approval.js";
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from "@nestjs/common";
import { id } from "../../core/learning.shared.js";
import type { LearningExam, LearningQuestion } from "../../core/learning.types.js";
import type { LearningServiceContext } from "../../core/learning.context.js";

/** Kiểm tra trạng thái trước khi sửa đề hoặc một câu trong đề. */
function assertExamEditable(status: LearningExam["status"]): void {
  if (status === "PENDING_REVIEW") throw new ConflictException("Đề đang chờ duyệt nên không thể chỉnh sửa.");
  if (status === "CLOSED") throw new ConflictException("Đề đã đóng nên không thể chỉnh sửa.");
}

/** Validate lịch/thang điểm/câu hỏi, giữ thứ tự chọn và tạo đề nháp cho lớp phụ trách. */
export async function createExam(
  serviceContext: LearningServiceContext,
  input: Omit<
    LearningExam,
    "id" | "status" | "version" | "questionScores" | "aiContext"
  > & { scoreAllocations?: Array<{ questionId: string; score: number }> },
  actorId: string,
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
          aiTutorEnabled: input.aiTutorEnabled ?? false,
          showAnswersAfterSubmit: input.showAnswersAfterSubmit ?? false,
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
      return submitExamForReview(serviceContext, exam.id, actorId, true, undefined, false, transaction);
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
    aiTutorEnabled: input.aiTutorEnabled ?? false,
    showAnswersAfterSubmit: input.showAnswersAfterSubmit ?? false,
    randomSeed: input.randomSeed,
    questionScores,
    status: "DRAFT",
    version: 1,
  };
  serviceContext.exams.unshift(item);
  try {
    return await submitExamForReview(serviceContext, item.id, actorId, true);
  } catch (error) {
    serviceContext.exams.splice(serviceContext.exams.indexOf(item), 1);
    throw error;
  }
}

/** Kiểm tra xem cấu trúc câu hỏi, thời lượng và thang điểm của đề có giữ nguyên hay không. */
function isExamStructureUnchanged(
  currentQuestionIds: string[],
  currentDuration: number,
  currentTotalScore: number,
  currentQuestionScores: Record<string, number>,
  nextQuestionIds: string[],
  nextDuration: number,
  nextTotalScore: number,
  nextQuestionScores: Record<string, number>,
): boolean {
  if (
    currentDuration !== nextDuration ||
    Math.abs(currentTotalScore - nextTotalScore) > 0.001 ||
    currentQuestionIds.length !== nextQuestionIds.length
  ) {
    return false;
  }
  return currentQuestionIds.every(
    (questionId, index) =>
      questionId === nextQuestionIds[index] &&
      Math.abs((currentQuestionScores[questionId] ?? 0) - (nextQuestionScores[questionId] ?? 0)) <= 0.001,
  );
}

/** Thay nội dung đề chưa đóng nguyên tử, tăng version và khóa cấu trúc đề đã có lượt làm. */
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
  actorId: string,
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
        include: {
          class: true,
          questions: { orderBy: { position: "asc" } },
        },
      });
      if (!current)
        throw new NotFoundException("Không tìm thấy đề được phép chỉnh sửa.");
      if (current.class.status === "CLOSED")
        throw new ConflictException("Lớp đã lưu trữ và chỉ cho phép đọc.");
      assertExamEditable(current.status);
      const attemptStats = await transaction.examAttempt.aggregate({
        where: { examId },
        _count: { _all: true },
        _max: { attemptNo: true },
      });
      const hasAttempts = attemptStats._count._all > 0;
      const currentQuestionIds = current.questions.map((row) => row.questionId);
      const currentQuestionScores = Object.fromEntries(
        current.questions.map((row) => [row.questionId, Number(row.score)]),
      );
      const structureUnchanged = isExamStructureUnchanged(
        currentQuestionIds,
        current.durationMinutes,
        Number(current.totalScore),
        currentQuestionScores,
        input.questionIds,
        input.durationMinutes,
        input.totalScore,
        questionScores,
      );
      if (hasAttempts && !structureUnchanged)
        throw new ConflictException("Đề đã có lượt làm bài nên không thể sửa câu hỏi, thời lượng hoặc thang điểm.");
      if (hasAttempts && input.attemptLimit < (attemptStats._max.attemptNo ?? 1))
        throw new BadRequestException("Số lượt làm bài không được nhỏ hơn số lượt học viên đã thực hiện.");
      if (current.version !== input.expectedVersion)
        throw new ConflictException(
          "Đề đã được cập nhật ở nơi khác; hãy tải lại trước khi sửa.",
        );
      if (!hasAttempts) {
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
      }
      const claimed = await transaction.exam.updateMany({
        where: {
          id: examId,
          status: { in: ["DRAFT", "PUBLISHED"] },
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
          aiTutorEnabled: input.aiTutorEnabled ?? false,
          showAnswersAfterSubmit: input.showAnswersAfterSubmit ?? false,
          randomSeed: input.randomSeed?.trim(),
          version: { increment: 1 },
        },
      });
      if (claimed.count !== 1)
        throw new ConflictException(
          "Đề đã thay đổi; hãy tải lại trước khi sửa.",
        );
      if (!hasAttempts) {
        await transaction.examQuestion.deleteMany({ where: { examId } });
        await transaction.examQuestion.createMany({
          data: input.questionIds.map((questionId, position) => ({
            examId,
            questionId,
            position: position + 1,
            score: questionScores[questionId]!,
          })),
        });
      }
      await transaction.auditLog.create({
        data: {
          actorId,
          action: "EXAM_UPDATED",
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
  assertExamEditable(current.status);
  const existingAttempts = serviceContext.attempts.filter((attempt) => attempt.examId === examId);
  const hasAttempts = existingAttempts.length > 0;
  const currentQuestionScores = current.questionScores ?? serviceContext.resolveExamScoreAllocations(current.questionIds, current.totalScore);
  const structureUnchanged = isExamStructureUnchanged(
    current.questionIds,
    current.durationMinutes,
    current.totalScore,
    currentQuestionScores,
    input.questionIds,
    input.durationMinutes,
    input.totalScore,
    questionScores,
  );
  if (hasAttempts && !structureUnchanged)
    throw new ConflictException("Đề đã có lượt làm bài nên không thể sửa câu hỏi, thời lượng hoặc thang điểm.");
  const attemptsByLearner = new Map<string, number>();
  for (const attempt of existingAttempts) {
    attemptsByLearner.set(attempt.learnerId, (attemptsByLearner.get(attempt.learnerId) ?? 0) + 1);
  }
  const maxAttemptNo = Math.max(1, ...attemptsByLearner.values());
  if (hasAttempts && input.attemptLimit < maxAttemptNo)
    throw new BadRequestException("Số lượt làm bài không được nhỏ hơn số lượt học viên đã thực hiện.");
  if (current.version !== input.expectedVersion)
    throw new ConflictException(
      "Đề đã được cập nhật ở nơi khác; hãy tải lại trước khi sửa.",
    );
  if (
    !hasAttempts &&
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
    questionIds: hasAttempts ? current.questionIds : [...input.questionIds],
    durationMinutes: input.durationMinutes,
    totalScore: input.totalScore,
    openAt: input.openAt,
    closeAt: input.closeAt,
    attemptLimit: input.attemptLimit,
    shuffleQuestions: input.shuffleQuestions,
    aiTutorEnabled: input.aiTutorEnabled ?? false,
    showAnswersAfterSubmit: input.showAnswersAfterSubmit ?? false,
    randomSeed: input.randomSeed,
    questionScores: hasAttempts ? current.questionScores : questionScores,
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
      assertExamEditable(exam.status);
      if (exam.class.status === "CLOSED")
        throw new ConflictException(
          "Chỉ sửa câu hỏi trong đề chưa đóng của lớp đang hoạt động.",
        );
      if (await tx.examAttempt.count({ where: { examId } }))
        throw new ConflictException("Đề đã có lượt làm bài nên không thể sửa câu hỏi.");
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
        where: { id: examId, status: { in: ["DRAFT", "PUBLISHED"] }, version: input.expectedVersion },
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
          status: exam.status === "PUBLISHED" ? "PUBLISHED" : "DRAFT",
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
  assertExamEditable(exam.status);
  if (
    classItem.status === "CLOSED" ||
    exam.version !== input.expectedVersion
  )
    throw new ConflictException(
      "Đề đã đóng, đã có lượt làm bài hoặc đã thay đổi. Hãy tải lại.",
    );
  if (serviceContext.attempts.some((attempt) => attempt.examId === examId))
    throw new ConflictException("Đề đã có lượt làm bài nên không thể sửa câu hỏi.");
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
    status: exam.status === "PUBLISHED" ? "PUBLISHED" : "DRAFT",
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
