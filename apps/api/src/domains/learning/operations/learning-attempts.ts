import { BadRequestException, NotFoundException } from "@nestjs/common";
import { id, now } from "../learning.shared.js";
import type { ExamAttempt, LearnerResult } from "../learning.types.js";
import type { LearningServiceContext } from "../learning.context.js";

/** Kiểm tra ghi danh, cửa sổ thi, giới hạn lượt rồi tạo hoặc tiếp tục lượt đang làm. */
export async function startAttempt(
  serviceContext: LearningServiceContext,
  examId: string,
  learnerId = "usr-learner",
): Promise<ExamAttempt> {
  const prisma = serviceContext.database();
  if (prisma) {
    const active = await prisma.examAttempt.findFirst({
      where: { examId, learnerId, status: "IN_PROGRESS" },
      include: { exam: true },
    });
    if (
      active &&
      serviceContext.attemptDeadline(
        active.startedAt,
        active.exam.durationMinutes,
        active.exam.closeAt,
      ) <= new Date()
    )
      await serviceContext.submitAttempt(active.id, learnerId);
    return prisma.$transaction(async (transaction) => {
      const exam = await transaction.exam.findUnique({
        where: { id: examId },
        include: {
          class: {
            include: {
              enrollments: { where: { learnerId, status: "ACTIVE" } },
            },
          },
        },
      });
      if (!exam) throw new NotFoundException("Không tìm thấy đề.");
      if (exam.status !== "PUBLISHED")
        throw new BadRequestException("Đề chưa được phát hành.");
      if (!exam.class.enrollments.length)
        throw new NotFoundException("Học viên không thuộc lớp được giao đề.");
      const timestamp = new Date();
      if (timestamp < exam.openAt || timestamp > exam.closeAt)
        throw new BadRequestException("Đề chưa mở hoặc đã đóng.");
      const attempts = await transaction.examAttempt.findMany({
        where: { examId, learnerId },
        include: { answers: true },
        orderBy: { attemptNo: "asc" },
      });
      const existing = attempts.find((item) => item.status === "IN_PROGRESS");
      if (existing) {
        return serviceContext.mapAttempt(existing);
      }
      if (attempts.length >= exam.attemptLimit)
        throw new BadRequestException("Đã hết số lần làm bài.");
      const created = await transaction.examAttempt.create({
        data: {
          id: id("attempt"),
          examId,
          learnerId,
          attemptNo: attempts.length + 1,
        },
        include: { answers: true },
      });
      return serviceContext.mapAttempt(created);
    });
  }
  const exam = serviceContext.findExam(examId);
  if (exam.status !== "PUBLISHED")
    throw new BadRequestException("Đề chưa được phát hành.");
  const timestamp = new Date();
  if (timestamp < new Date(exam.openAt) || timestamp > new Date(exam.closeAt))
    throw new BadRequestException("Đề chưa mở hoặc đã đóng.");
  const classItem = serviceContext.findClass(exam.classId);
  if (!classItem.learnerIds.includes(learnerId))
    throw new NotFoundException("Học viên không thuộc lớp được giao đề.");
  const attempts = serviceContext.attempts.filter(
    (item) => item.examId === examId && item.learnerId === learnerId,
  );
  const existing = attempts.find((item) => item.status === "IN_PROGRESS");
  if (existing) {
    if (
      serviceContext.attemptDeadline(
        new Date(existing.startedAt),
        exam.durationMinutes,
        new Date(exam.closeAt),
      ) <= timestamp
    )
      await serviceContext.submitAttempt(existing.id, learnerId);
    else return { ...existing, answers: { ...existing.answers } };
  }
  if (attempts.length >= exam.attemptLimit)
    throw new BadRequestException("Đã hết số lần làm bài.");
  const item: ExamAttempt = {
    id: id("attempt"),
    examId,
    learnerId,
    answers: {},
    status: "IN_PROGRESS",
    startedAt: now(),
  };
  serviceContext.attempts.push(item);
  return { ...item, answers: {} };
}

/** Validate đáp án thuộc đề và upsert câu trả lời khi lượt thi còn trong hạn. */
export async function saveAnswer(
  serviceContext: LearningServiceContext,
  attemptId: string,
  questionId: string,
  answers: string[],
  learnerId = "usr-learner",
): Promise<ExamAttempt> {
  const prisma = serviceContext.database();
  if (prisma) {
    return prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`SELECT id FROM exam_attempts WHERE id = ${attemptId} FOR UPDATE`;
      const attempt = await transaction.examAttempt.findFirst({
        where: { id: attemptId, learnerId },
        include: { exam: true },
      });
      if (!attempt) throw new NotFoundException("Không tìm thấy lượt làm bài.");
      if (attempt.status !== "IN_PROGRESS")
        throw new BadRequestException("Bài làm đã khóa.");
      if (
        serviceContext.attemptDeadline(
          attempt.startedAt,
          attempt.exam.durationMinutes,
          attempt.exam.closeAt,
        ) <= new Date()
      )
        throw new BadRequestException("Đã hết thời gian lưu câu trả lời.");
      const examQuestion = await transaction.examQuestion.findUnique({
        where: { examId_questionId: { examId: attempt.examId, questionId } },
        include: { question: true },
      });
      if (!examQuestion)
        throw new BadRequestException("Câu hỏi không thuộc đề.");
      const normalizedAnswers = serviceContext.validateSubmittedAnswers(
        serviceContext.mapQuestion(examQuestion.question),
        answers,
      );
      await transaction.attemptAnswer.upsert({
        where: { attemptId_questionId: { attemptId, questionId } },
        update: { answerData: normalizedAnswers },
        create: { attemptId, questionId, answerData: normalizedAnswers },
      });
      return serviceContext.getDatabaseAttempt(transaction, attemptId);
    });
  }
  const item = serviceContext.attempts.find(
    (attempt) => attempt.id === attemptId && attempt.learnerId === learnerId,
  );
  if (!item) throw new NotFoundException("Không tìm thấy lượt làm bài.");
  if (item.status !== "IN_PROGRESS")
    throw new BadRequestException("Bài làm đã khóa.");
  const exam = serviceContext.findExam(item.examId);
  if (
    serviceContext.attemptDeadline(
      new Date(item.startedAt),
      exam.durationMinutes,
      new Date(exam.closeAt),
    ) <= new Date()
  )
    throw new BadRequestException("Đã hết thời gian lưu câu trả lời.");
  if (!exam.questionIds.includes(questionId))
    throw new BadRequestException("Câu hỏi không thuộc đề.");
  const question = serviceContext.questions.find(
    (candidate) => candidate.id === questionId,
  );
  if (!question) throw new BadRequestException("Câu hỏi không tồn tại.");
  item.answers[questionId] = serviceContext.validateSubmittedAnswers(
    question,
    answers,
  );
  item.lastSavedAt = now();
  return { ...item, answers: { ...item.answers }, serverTime: now() };
}

/** Chốt lượt thi nguyên tử, tự chấm câu khách quan và phát receipt chống nhầm lẫn. */
export async function submitAttempt(
  serviceContext: LearningServiceContext,
  attemptId: string,
  learnerId = "usr-learner",
): Promise<ExamAttempt> {
  const prisma = serviceContext.database();
  if (prisma) {
    return prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`SELECT id FROM exam_attempts WHERE id = ${attemptId} FOR UPDATE`;
      const attempt = await transaction.examAttempt.findFirst({
        where: { id: attemptId, learnerId },
        include: {
          answers: true,
          exam: { include: { questions: { include: { question: true } } } },
        },
      });
      if (!attempt) throw new NotFoundException("Không tìm thấy lượt làm bài.");
      if (attempt.status !== "IN_PROGRESS")
        return serviceContext.mapAttempt(attempt);
      const submittedAt = new Date();
      const claimed = await transaction.examAttempt.updateMany({
        where: { id: attemptId, learnerId, status: "IN_PROGRESS" },
        data: { status: "SUBMITTED", submittedAt },
      });
      if (!claimed.count)
        return serviceContext.getDatabaseAttempt(transaction, attemptId);
      let score = 0;
      let requiresManualGrade = false;
      for (const examQuestion of attempt.exam.questions) {
        const requiresManualAnswer = ["SHORT_ANSWER", "ESSAY"].includes(
          examQuestion.question.type,
        );
        if (requiresManualAnswer) {
          requiresManualGrade = true;
          continue;
        }
        const answer = attempt.answers.find(
          (item) => item.questionId === examQuestion.questionId,
        );
        const submitted = serviceContext.toStringArray(
          answer?.answerData ?? [],
        );
        const isCorrect = serviceContext.isQuestionAnswerCorrect(
          serviceContext.mapQuestion(examQuestion.question),
          submitted,
        );
        const awarded = isCorrect ? Number(examQuestion.score) : 0;
        score += awarded;
        if (answer)
          await transaction.attemptAnswer.update({
            where: {
              attemptId_questionId: {
                attemptId,
                questionId: examQuestion.questionId,
              },
            },
            data: { score: awarded },
          });
      }
      const updated = await transaction.examAttempt.update({
        where: { id: attemptId },
        data: {
          score,
          submittedAt,
          status: requiresManualGrade ? "SUBMITTED" : "GRADED",
          gradePublishedAt: requiresManualGrade ? null : submittedAt,
          feedback: requiresManualGrade
            ? "Bài đang chờ giảng viên chấm câu tự luận hoặc câu trả lời ngắn."
            : "Bài đã được chấm tự động. Giảng viên có thể bổ sung nhận xét.",
        },
        include: { answers: true },
      });
      return serviceContext.mapAttempt(updated);
    });
  }
  const item = serviceContext.attempts.find(
    (attempt) => attempt.id === attemptId && attempt.learnerId === learnerId,
  );
  if (!item) throw new NotFoundException("Không tìm thấy lượt làm bài.");
  if (item.status !== "IN_PROGRESS")
    return { ...item, answers: { ...item.answers } };
  const exam = serviceContext.findExam(item.examId);
  let objectiveScore = 0;
  let requiresManualGrade = false;
  exam.questionIds.forEach((questionId) => {
    const question = serviceContext.questions.find(
      (candidate) => candidate.id === questionId,
    );
    if (!question) return;
    if (["SHORT_ANSWER", "ESSAY"].includes(question.type)) {
      requiresManualGrade = true;
      return;
    }
    if (
      serviceContext.isQuestionAnswerCorrect(
        question,
        item.answers[questionId] ?? [],
      )
    )
      objectiveScore += serviceContext.examQuestionScore(exam, questionId);
  });
  item.score = Math.round(objectiveScore * 100) / 100;
  item.status = requiresManualGrade ? "SUBMITTED" : "GRADED";
  item.submittedAt = now();
  item.submissionReceipt = serviceContext.submissionReceipt(
    item.id,
    item.submittedAt,
  );
  item.gradePublishedAt = requiresManualGrade ? undefined : now();
  item.feedback = requiresManualGrade
    ? "Bài đang chờ giảng viên chấm câu tự luận hoặc câu trả lời ngắn."
    : "Bài đã được chấm tự động. Giảng viên có thể bổ sung nhận xét.";
  return { ...item, answers: { ...item.answers } };
}

/** Tìm lượt IN_PROGRESS quá hạn theo lô và nộp tự động bằng cùng logic submit. */
export async function reconcileExpiredAttempts(
  serviceContext: LearningServiceContext,
  limit = 100,
): Promise<number> {
  const boundedLimit = Math.max(1, Math.min(limit, 500));
  const prisma = serviceContext.database();
  if (prisma) {
    const candidates = await prisma.examAttempt.findMany({
      where: { status: "IN_PROGRESS" },
      include: { exam: true },
      orderBy: { startedAt: "asc" },
      take: 500,
    });
    const timestamp = new Date();
    const expired = candidates
      .filter(
        (attempt) =>
          serviceContext.attemptDeadline(
            attempt.startedAt,
            attempt.exam.durationMinutes,
            attempt.exam.closeAt,
          ) <= timestamp,
      )
      .slice(0, boundedLimit);
    const results = await Promise.allSettled(
      expired.map((attempt) =>
        serviceContext.submitAttempt(attempt.id, attempt.learnerId),
      ),
    );
    return results.filter((result) => result.status === "fulfilled").length;
  }
  const timestamp = new Date();
  const expired = serviceContext.attempts
    .filter((attempt) => {
      const exam = serviceContext.findExam(attempt.examId);
      return (
        attempt.status === "IN_PROGRESS" &&
        serviceContext.attemptDeadline(
          new Date(attempt.startedAt),
          exam.durationMinutes,
          new Date(exam.closeAt),
        ) <= timestamp
      );
    })
    .slice(0, boundedLimit);
  for (const attempt of expired)
    await serviceContext.submitAttempt(attempt.id, attempt.learnerId);
  return expired.length;
}

/** Đọc một lượt thi và ánh xạ đáp án từ Prisma hoặc kho nhớ. */
export async function getAttempt(
  serviceContext: LearningServiceContext,
  attemptId: string,
): Promise<ExamAttempt> {
  const prisma = serviceContext.database();
  if (prisma) return serviceContext.getDatabaseAttempt(prisma, attemptId);
  const item = serviceContext.findAttempt(attemptId);
  return { ...item, answers: { ...item.answers } };
}

/** Liệt kê kết quả đã nộp/chấm của học viên cùng trạng thái phúc khảo. */
export async function listLearnerResults(
  serviceContext: LearningServiceContext,
  learnerId = "usr-learner",
): Promise<LearnerResult[]> {
  const prisma = serviceContext.database();
  if (prisma) {
    const rows = await prisma.examAttempt.findMany({
      where: { learnerId, status: "GRADED", gradePublishedAt: { not: null } },
      include: {
        answers: true,
        exam: {
          include: {
            questions: {
              include: { question: true },
              orderBy: { position: "asc" },
            },
          },
        },
        regradeRequests: {
          where: { learnerId },
          orderBy: { createdAt: "desc" },
          take: 1,
        },
      },
      orderBy: { gradePublishedAt: "desc" },
    });
    return rows.map((row) => ({
      attempt: serviceContext.mapAttempt(row),
      exam: {
        id: row.exam.id,
        title: row.exam.title,
        totalScore: Number(row.exam.totalScore),
        closeAt: row.exam.closeAt.toISOString(),
      },
      answerBreakdown: row.exam.questions.map((examQuestion) => {
        const answer = row.answers.find(
          (item) => item.questionId === examQuestion.questionId,
        );
        return {
          questionId: examQuestion.questionId,
          content: examQuestion.question.content,
          submittedAnswers: serviceContext.toStringArray(
            answer?.answerData ?? [],
          ),
          awardedScore: Number(answer?.score ?? 0),
          maxScore: Number(examQuestion.score),
        };
      }),
      regradeRequest: row.regradeRequests[0]
        ? serviceContext.mapRegradeRequest(row.regradeRequests[0])
        : undefined,
    }));
  }
  return serviceContext.attempts
    .filter(
      (attempt) =>
        attempt.learnerId === learnerId &&
        attempt.status === "GRADED" &&
        attempt.gradePublishedAt,
    )
    .sort((left, right) =>
      (right.gradePublishedAt ?? "").localeCompare(left.gradePublishedAt ?? ""),
    )
    .map((attempt) => {
      const exam = serviceContext.findExam(attempt.examId);
      return {
        attempt: { ...attempt, answers: structuredClone(attempt.answers) },
        exam: {
          id: exam.id,
          title: exam.title,
          totalScore: exam.totalScore,
          closeAt: exam.closeAt,
        },
        answerBreakdown: exam.questionIds.map((questionId) => ({
          questionId,
          content:
            serviceContext.questions.find(
              (question) => question.id === questionId,
            )?.content ?? "Câu hỏi không còn tồn tại",
          submittedAnswers: [...(attempt.answers[questionId] ?? [])],
          awardedScore: serviceContext.isMemoryAnswerCorrect(
            questionId,
            attempt.answers[questionId] ?? [],
          )
            ? serviceContext.examQuestionScore(exam, questionId)
            : 0,
          maxScore: serviceContext.examQuestionScore(exam, questionId),
        })),
        regradeRequest: serviceContext.regradeRequests.find(
          (request) =>
            request.attemptId === attempt.id && request.learnerId === learnerId,
        ),
      };
    });
}

/** Trả đúng kết quả thuộc học viên, từ chối truy cập chéo lượt thi. */
export async function getLearnerResult(
  serviceContext: LearningServiceContext,
  attemptId: string,
  learnerId = "usr-learner",
): Promise<LearnerResult> {
  const result = (await serviceContext.listLearnerResults(learnerId)).find(
    (item) => item.attempt.id === attemptId,
  );
  if (!result)
    throw new NotFoundException(
      "Kết quả chưa được công bố hoặc không thuộc học viên hiện tại.",
    );
  return result;
}
