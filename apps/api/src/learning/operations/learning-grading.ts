import { BadRequestException, NotFoundException } from "@nestjs/common";
import { id, now } from "../learning.shared.js";
import type {
  ExamAttempt,
  ExamAttemptReview,
  GradeHistoryRecord,
} from "../learning.types.js";
import type { LearningServiceContext } from "../learning.context.js";

/** Trả đầy đủ đề, bài làm và điểm từng câu sau khi xác minh phạm vi giảng viên. */
export async function getAttemptReview(
  serviceContext: LearningServiceContext,
  attemptId: string,
  actorId = "usr-instructor",
): Promise<ExamAttemptReview> {
  const prisma = serviceContext.database();
  if (prisma) {
    const row = await prisma.examAttempt.findFirst({
      where: {
        id: attemptId,
        exam: { class: { instructors: { some: { instructorId: actorId } } } },
      },
      include: {
        learner: { select: { displayName: true, email: true } },
        answers: true,
        exam: {
          include: {
            questions: {
              include: { question: true },
              orderBy: { position: "asc" },
            },
          },
        },
      },
    });
    if (!row)
      throw new NotFoundException("Không tìm thấy bài làm được phép xem.");
    return {
      attempt: serviceContext.mapAttempt(row),
      exam: {
        id: row.exam.id,
        classId: row.exam.classId,
        title: row.exam.title,
        totalScore: Number(row.exam.totalScore),
      },
      learner: {
        id: row.learnerId,
        name: row.learner.displayName,
        email: row.learner.email,
      },
      questions: row.exam.questions.map((examQuestion) => {
        const answer = row.answers.find(
          (item) => item.questionId === examQuestion.questionId,
        );
        const question = serviceContext.mapQuestion(examQuestion.question);
        return {
          questionId: examQuestion.questionId,
          type: question.type,
          content: question.content,
          imageUrl: question.imageUrl,
          submittedAnswers: serviceContext.toStringArray(
            answer?.answerData ?? [],
          ),
          awardedScore: Number(answer?.score ?? 0),
          maxScore: Number(examQuestion.score),
          requiresManualGrade: ["SHORT_ANSWER", "ESSAY"].includes(
            question.type,
          ),
        };
      }),
    };
  }
  const attempt = serviceContext.findAttempt(attemptId);
  const exam = serviceContext.findExam(attempt.examId);
  if (!serviceContext.findClass(exam.classId).instructorIds.includes(actorId))
    throw new NotFoundException("Không tìm thấy bài làm được phép xem.");
  return {
    attempt: { ...attempt, answers: structuredClone(attempt.answers) },
    exam: {
      id: exam.id,
      classId: exam.classId,
      title: exam.title,
      totalScore: exam.totalScore,
    },
    learner: { id: attempt.learnerId },
    questions: exam.questionIds.map((questionId) => {
      const question = serviceContext.questions.find(
        (item) => item.id === questionId,
      )!;
      return {
        questionId,
        type: question.type,
        content: question.content,
        imageUrl: question.imageUrl,
        submittedAnswers: [...(attempt.answers[questionId] ?? [])],
        awardedScore: 0,
        maxScore: serviceContext.examQuestionScore(exam, questionId),
        requiresManualGrade: ["SHORT_ANSWER", "ESSAY"].includes(question.type),
      };
    }),
  };
}

/** Ghi điểm thủ công/hiệu chỉnh, bắt buộc lý do khi đổi điểm và lưu grade history. */
export async function gradeAttempt(
  serviceContext: LearningServiceContext,
  attemptId: string,
  score: number,
  feedback: string,
  correctionReason?: string,
  graderId = "usr-instructor",
  questionScores?: Array<{ questionId: string; score: number }>,
): Promise<ExamAttempt> {
  const prisma = serviceContext.database();
  if (prisma) {
    const attempt = await prisma.examAttempt.findFirst({
      where: {
        id: attemptId,
        exam: {
          class: { instructors: { some: { instructorId: graderId } } },
        },
      },
      include: {
        answers: true,
        exam: { include: { questions: { include: { question: true } } } },
      },
    });
    if (!attempt)
      throw new NotFoundException(
        "Không tìm thấy lượt làm bài được phép chấm.",
      );
    let nextScore = score;
    if (questionScores) {
      const manualQuestions = attempt.exam.questions.filter((item) =>
        ["SHORT_ANSWER", "ESSAY"].includes(item.question.type),
      );
      if (
        questionScores.length !== manualQuestions.length ||
        new Set(questionScores.map((item) => item.questionId)).size !==
          manualQuestions.length
      )
        throw new BadRequestException(
          "Cần nhập đúng một điểm cho từng câu tự luận hoặc trả lời ngắn.",
        );
      for (const item of questionScores) {
        const question = manualQuestions.find(
          (candidate) => candidate.questionId === item.questionId,
        );
        if (!question || item.score > Number(question.score))
          throw new BadRequestException(
            "Điểm từng câu phải nằm trong thang điểm của câu hỏi.",
          );
      }
      const objectiveQuestionIds = new Set(
        attempt.exam.questions
          .filter(
            (item) => !["SHORT_ANSWER", "ESSAY"].includes(item.question.type),
          )
          .map((item) => item.questionId),
      );
      const objectiveScore = attempt.answers
        .filter((item) => objectiveQuestionIds.has(item.questionId))
        .reduce((total, item) => total + Number(item.score ?? 0), 0);
      nextScore =
        objectiveScore +
        questionScores.reduce((total, item) => total + item.score, 0);
    }
    if (nextScore > Number(attempt.exam.totalScore))
      throw new BadRequestException("Điểm không được vượt tổng điểm của đề.");
    const isFirstPublishedGrade =
      attempt.status === "SUBMITTED" && attempt.gradePublishedAt === null;
    const reason = isFirstPublishedGrade
      ? "Chấm lần đầu"
      : correctionReason?.trim();
    if (!isFirstPublishedGrade && (!reason || reason.length < 5))
      throw new BadRequestException("Sửa điểm cần lý do ít nhất 5 ký tự.");
    return prisma.$transaction(async (transaction) => {
      if (questionScores)
        await Promise.all(
          questionScores.map((item) =>
            transaction.attemptAnswer.upsert({
              where: {
                attemptId_questionId: {
                  attemptId,
                  questionId: item.questionId,
                },
              },
              update: { score: item.score },
              create: {
                attemptId,
                questionId: item.questionId,
                answerData: [],
                score: item.score,
              },
            }),
          ),
        );
      await transaction.gradeHistory.create({
        data: {
          id: id("grade-history"),
          attemptId,
          graderId,
          previousScore: attempt.score,
          nextScore,
          reason: reason!,
        },
      });
      return serviceContext.mapAttempt(
        await transaction.examAttempt.update({
          where: { id: attemptId },
          data: {
            score: nextScore,
            feedback: feedback.trim(),
            status: "GRADED",
            gradePublishedAt: new Date(),
          },
          include: { answers: true },
        }),
      );
    });
  }
  const item = serviceContext.findAttempt(attemptId);
  const exam = serviceContext.findExam(item.examId);
  if (!serviceContext.findClass(exam.classId).instructorIds.includes(graderId))
    throw new NotFoundException("Không tìm thấy lượt làm bài được phép chấm.");
  if (questionScores) {
    const manualQuestions = exam.questionIds
      .map(
        (questionId) =>
          serviceContext.questions.find(
            (question) => question.id === questionId,
          )!,
      )
      .filter((question) => ["SHORT_ANSWER", "ESSAY"].includes(question.type));
    if (
      questionScores.length !== manualQuestions.length ||
      new Set(questionScores.map((entry) => entry.questionId)).size !==
        manualQuestions.length
    )
      throw new BadRequestException(
        "Cần nhập đúng một điểm cho từng câu tự luận hoặc trả lời ngắn.",
      );
    for (const entry of questionScores)
      if (
        !manualQuestions.some((question) => question.id === entry.questionId) ||
        entry.score > serviceContext.examQuestionScore(exam, entry.questionId)
      )
        throw new BadRequestException(
          "Điểm từng câu phải nằm trong thang điểm của câu hỏi.",
        );
    const objectiveScore = exam.questionIds
      .filter(
        (questionId) =>
          !manualQuestions.some((question) => question.id === questionId) &&
          serviceContext.isMemoryAnswerCorrect(
            questionId,
            item.answers[questionId] ?? [],
          ),
      )
      .reduce(
        (total, questionId) =>
          total + serviceContext.examQuestionScore(exam, questionId),
        0,
      );
    score =
      objectiveScore +
      questionScores.reduce((total, entry) => total + entry.score, 0);
  }
  if (score > exam.totalScore)
    throw new BadRequestException("Điểm không được vượt tổng điểm của đề.");
  const isFirstPublishedGrade =
    item.status === "SUBMITTED" && !item.gradePublishedAt;
  const reason = isFirstPublishedGrade
    ? "Chấm lần đầu"
    : correctionReason?.trim();
  if (!isFirstPublishedGrade && (!reason || reason.length < 5))
    throw new BadRequestException("Sửa điểm cần lý do ít nhất 5 ký tự.");
  serviceContext.gradeHistory.unshift({
    id: id("grade-history"),
    attemptId,
    graderId,
    previousScore: item.score,
    nextScore: score,
    reason: reason!,
    createdAt: now(),
  });
  item.score = score;
  item.feedback = feedback.trim();
  item.status = "GRADED";
  item.gradePublishedAt = now();
  return { ...item, answers: { ...item.answers } };
}

/** Kiểm tra phạm vi giảng dạy rồi trả lịch sử các lần thay đổi điểm. */
export async function listGradeHistory(
  serviceContext: LearningServiceContext,
  attemptId: string,
  actorId = "usr-instructor",
): Promise<GradeHistoryRecord[]> {
  const prisma = serviceContext.database();
  if (prisma) {
    const allowed = await prisma.examAttempt.findFirst({
      where: {
        id: attemptId,
        exam: { class: { instructors: { some: { instructorId: actorId } } } },
      },
      select: { id: true },
    });
    if (!allowed)
      throw new NotFoundException("Không tìm thấy lịch sử chấm được phép xem.");
    const rows = await prisma.gradeHistory.findMany({
      where: { attemptId },
      orderBy: { createdAt: "desc" },
    });
    return rows.map((row) => ({
      id: row.id,
      attemptId: row.attemptId,
      graderId: row.graderId,
      previousScore:
        row.previousScore === null ? undefined : Number(row.previousScore),
      nextScore: Number(row.nextScore),
      reason: row.reason,
      createdAt: row.createdAt.toISOString(),
    }));
  }
  const attempt = serviceContext.findAttempt(attemptId);
  if (
    !serviceContext
      .findClass(serviceContext.findExam(attempt.examId).classId)
      .instructorIds.includes(actorId)
  )
    throw new NotFoundException("Không tìm thấy lịch sử chấm được phép xem.");
  return serviceContext.gradeHistory
    .filter((item) => item.attemptId === attemptId)
    .map((item) => ({ ...item }));
}
