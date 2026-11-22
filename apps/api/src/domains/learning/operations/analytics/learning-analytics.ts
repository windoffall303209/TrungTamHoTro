import { NotFoundException } from "@nestjs/common";
import type { Prisma } from "../../../../generated/prisma/client.js";
import { now } from "../../core/learning.shared.js";
import type { ExamAnalytics } from "../../core/learning.types.js";
import type { LearningServiceContext } from "../../core/learning.context.js";

/** Tổng hợp thống kê phần trăm của các bài đã chấm theo quy tắc chung. */
function summarizeGradedPercentages(
  percentages: number[],
): Pick<
  ExamAnalytics["exams"][number],
  "sampleSize" | "smallSampleWarning" | "averagePercentage" | "passRate"
> {
  return {
    sampleSize: percentages.length,
    smallSampleWarning: percentages.length < 5,
    averagePercentage: percentages.length
      ? Math.round(
          (percentages.reduce((sum, value) => sum + value, 0) /
            percentages.length) *
            100,
        ) / 100
      : 0,
    passRate: percentages.length
      ? Math.round(
          (percentages.filter((value) => value >= 50).length /
            percentages.length) *
            10_000,
        ) / 100
      : 0,
  };
}

interface AnalyticsQuestionItem {
  id: string;
  difficulty: number;
  correctAnswers: Prisma.JsonValue;
}

interface AnalyticsAttemptAnswer {
  questionId: string;
  answerData: Prisma.JsonValue;
}

interface AnalyticsAttemptRow {
  id?: string;
  score: unknown;
  answers?: AnalyticsAttemptAnswer[];
}

interface AnalyticsExamRow {
  id: string;
  classId: string;
  title: string;
  totalScore: unknown;
  closeAt: Date;
  questions?: Array<{ question: AnalyticsQuestionItem }>;
  attempts: AnalyticsAttemptRow[];
}

/** Tính thống kê từng câu hỏi sau khi đề đã đóng dựa trên danh sách câu hỏi và bài làm đã nạp. */
function computeExamQuestionStats(
  serviceContext: LearningServiceContext,
  questions: Array<{ question: AnalyticsQuestionItem }>,
  attempts: Array<{ answers: AnalyticsAttemptAnswer[] }>,
): ExamAnalytics["exams"][number]["questionStats"] {
  const answersByAttempt = attempts.map((attempt) => {
    const answers = new Map<string, AnalyticsAttemptAnswer>();
    for (const answer of attempt.answers) {
      // Giữ câu trả lời đầu tiên giống cách tìm bằng Array.find trước đây.
      if (!answers.has(answer.questionId)) answers.set(answer.questionId, answer);
    }
    return answers;
  });
  return questions.map(({ question }) => {
    const answers = answersByAttempt
      .map((attemptAnswers) => attemptAnswers.get(question.id))
      .filter((answer): answer is AnalyticsAttemptAnswer => Boolean(answer));
    const correct = serviceContext
      .toStringArray(question.correctAnswers)
      .sort()
      .join("\u0000");
    const correctCount = answers.filter(
      (answer) =>
        serviceContext
          .toStringArray(answer.answerData)
          .sort()
          .join("\u0000") === correct,
    ).length;
    return {
      questionId: question.id,
      difficulty: question.difficulty,
      responseCount: answers.length,
      correctRate: answers.length
        ? Math.round((correctCount / answers.length) * 10_000) / 100
        : 0,
    };
  });
}

/** Phân tích phân bố điểm, tỷ lệ hoàn thành và hiệu suất câu hỏi trong phạm vi giảng viên. */
export async function getExamAnalytics(
  serviceContext: LearningServiceContext,
  input: { classId?: string; examId?: string; from?: string; to?: string },
  actorId: string,
): Promise<ExamAnalytics> {
  const { from, to } = serviceContext.reportingPeriod(input.from, input.to);
  const metricDefinitions = {
    averagePercentage:
      "Trung bình điểm đã chấm chia tổng điểm đề, quy đổi phần trăm.",
    passRate: "Tỷ lệ bài đạt từ 50% tổng điểm trong các bài đã chấm.",
    correctRate:
      "Tỷ lệ lượt trả lời khớp toàn bộ đáp án chuẩn của câu hỏi sau khi đề đóng.",
  };
  const prisma = serviceContext.database();
  if (prisma) {
    const currentTimestamp = new Date();
    const whereClause = {
      id: input.examId || undefined,
      classId: input.classId || undefined,
      openAt: { lte: to },
      closeAt: { gte: from },
      class: { instructors: { some: { instructorId: actorId } } },
    };
    const attemptWhereClause = {
      submittedAt: { gte: from, lte: to },
      status: { in: ["SUBMITTED", "GRADED"] as Array<"SUBMITTED" | "GRADED"> },
    };
    const hasGranularDelegates =
      typeof (prisma as unknown as { examQuestion?: { findMany?: unknown } }).examQuestion?.findMany === "function" &&
      typeof (prisma as unknown as { attemptAnswer?: { findMany?: unknown } }).attemptAnswer?.findMany === "function";

    const rows: AnalyticsExamRow[] = hasGranularDelegates
      ? await prisma.exam.findMany({
          where: whereClause,
          select: {
            id: true,
            classId: true,
            title: true,
            totalScore: true,
            closeAt: true,
            attempts: {
              where: attemptWhereClause,
              select: { id: true, score: true },
            },
          },
          orderBy: { openAt: "desc" },
        })
      : await prisma.exam.findMany({
          where: whereClause,
          include: {
            questions: {
              include: { question: true },
              orderBy: { position: "asc" },
            },
            attempts: {
              where: attemptWhereClause,
              include: { answers: true },
            },
          },
          orderBy: { openAt: "desc" },
        });

    const closedExams = rows.filter((exam) => currentTimestamp > exam.closeAt);
    const questionsByExamId = new Map<string, Array<{ question: AnalyticsQuestionItem }>>();
    const answersByAttemptId = new Map<string, AnalyticsAttemptAnswer[]>();

    if (hasGranularDelegates && closedExams.length > 0) {
      const closedExamIds = closedExams.map((exam) => exam.id);
      const closedAttemptIds = closedExams.flatMap((exam) =>
        exam.attempts.map((attempt) => attempt.id).filter((id): id is string => Boolean(id)),
      );
      const [examQuestions, attemptAnswers] = await Promise.all([
        prisma.examQuestion.findMany({
          where: { examId: { in: closedExamIds } },
          orderBy: { position: "asc" },
          select: {
            examId: true,
            question: { select: { id: true, difficulty: true, correctAnswers: true } },
          },
        }),
        closedAttemptIds.length > 0
          ? prisma.attemptAnswer.findMany({
              where: { attemptId: { in: closedAttemptIds } },
              select: { attemptId: true, questionId: true, answerData: true },
            })
          : Promise.resolve([]),
      ]);
      for (const row of examQuestions) {
        const list = questionsByExamId.get(row.examId);
        if (list) list.push({ question: row.question });
        else questionsByExamId.set(row.examId, [{ question: row.question }]);
      }
      for (const row of attemptAnswers) {
        const list = answersByAttemptId.get(row.attemptId);
        if (list) list.push({ questionId: row.questionId, answerData: row.answerData });
        else answersByAttemptId.set(row.attemptId, [{ questionId: row.questionId, answerData: row.answerData }]);
      }
    }

    return {
      generatedAt: now(),
      filters: input,
      metricDefinitions,
      exams: rows.map((exam) => {
        const graded = exam.attempts.filter(
          (attempt) => attempt.score !== null,
        );
        const percentages = graded.map(
          (attempt) => (Number(attempt.score) / Number(exam.totalScore)) * 100,
        );
        const questionStatsAvailable = currentTimestamp > exam.closeAt;
        const examQuestions = questionStatsAvailable
          ? (hasGranularDelegates ? (questionsByExamId.get(exam.id) ?? []) : (exam.questions ?? []))
          : [];
        const attemptAnswersList = questionStatsAvailable
          ? exam.attempts.map((attempt) => ({
              answers: hasGranularDelegates && attempt.id
                ? (answersByAttemptId.get(attempt.id) ?? [])
                : (attempt.answers ?? []),
            }))
          : [];
        const questionStats = questionStatsAvailable
          ? computeExamQuestionStats(serviceContext, examQuestions, attemptAnswersList)
          : [];
        return {
          examId: exam.id,
          classId: exam.classId,
          title: exam.title,
          ...summarizeGradedPercentages(percentages),
          questionStatsAvailable,
          questionStats,
        };
      }),
    };
  }
  const exams = serviceContext.exams
    .filter(
      (exam) =>
        (!input.examId || exam.id === input.examId) &&
        (!input.classId || exam.classId === input.classId) &&
        serviceContext
          .findClass(exam.classId)
          .instructorIds.includes(actorId) &&
        new Date(exam.openAt) <= to &&
        new Date(exam.closeAt) >= from,
    )
    .map((exam) => {
      const attempts = serviceContext.attempts.filter(
        (attempt) =>
          attempt.examId === exam.id &&
          attempt.submittedAt &&
          new Date(attempt.submittedAt) >= from &&
          new Date(attempt.submittedAt) <= to &&
          ["SUBMITTED", "GRADED"].includes(attempt.status),
      );
      const graded = attempts.filter((attempt) => attempt.score !== undefined);
      const percentages = graded.map(
        (attempt) => ((attempt.score ?? 0) / exam.totalScore) * 100,
      );
      const questionStatsAvailable = new Date() > new Date(exam.closeAt);
      const questionStats = questionStatsAvailable
        ? exam.questionIds.map((questionId) => {
            const question = serviceContext.questions.find(
              (item) => item.id === questionId,
            );
            if (!question)
              throw new NotFoundException("Đề chứa câu hỏi không tồn tại.");
            const answers = attempts
              .map((attempt) => attempt.answers[questionId])
              .filter((answer): answer is string[] => Boolean(answer));
            const correct = [...question.correctAnswers].sort().join("\u0000");
            return {
              questionId,
              difficulty: question.difficulty,
              responseCount: answers.length,
              correctRate: answers.length
                ? Math.round(
                    (answers.filter(
                      (answer) => [...answer].sort().join("\u0000") === correct,
                    ).length /
                      answers.length) *
                      10_000,
                  ) / 100
                : 0,
            };
          })
        : [];
      return {
        examId: exam.id,
        classId: exam.classId,
        title: exam.title,
        ...summarizeGradedPercentages(percentages),
        questionStatsAvailable,
        questionStats,
      };
    });
  return { generatedAt: now(), filters: input, metricDefinitions, exams };
}

/** Chuyển dữ liệu phân tích đề thi sang CSV có BOM để Excel đọc Unicode đúng. */
export async function exportExamAnalytics(
  serviceContext: LearningServiceContext,
  input: { classId?: string; examId?: string; from?: string; to?: string },
  actorId: string,
): Promise<Buffer> {
  const report = await serviceContext.getExamAnalytics(input, actorId);
  /** Bao ô CSV bằng dấu ngoặc kép và thoát dấu ngoặc kép trong nội dung. */
  const escape = (value: string | number | boolean): string =>
    `"${String(value).replaceAll('"', '""')}"`;
  const rows = [
    [
      "examId",
      "classId",
      "title",
      "sampleSize",
      "smallSampleWarning",
      "averagePercentage",
      "passRate",
    ],
    ...report.exams.map((exam) => [
      exam.examId,
      exam.classId,
      exam.title,
      exam.sampleSize,
      exam.smallSampleWarning,
      exam.averagePercentage,
      exam.passRate,
    ]),
  ];
  return Buffer.from(
    `\uFEFF${rows.map((row) => row.map(escape).join(",")).join("\r\n")}`,
    "utf8",
  );
}
