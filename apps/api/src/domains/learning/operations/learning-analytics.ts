import { NotFoundException } from "@nestjs/common";
import { now } from "../learning.shared.js";
import type { ExamAnalytics } from "../learning.types.js";
import type { LearningServiceContext } from "../learning.context.js";

/** Phân tích phân bố điểm, tỷ lệ hoàn thành và hiệu suất câu hỏi trong phạm vi giảng viên. */
export async function getExamAnalytics(
  serviceContext: LearningServiceContext,
  input: { classId?: string; examId?: string; from?: string; to?: string },
  actorId = "usr-instructor",
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
    const rows = await prisma.exam.findMany({
      where: {
        id: input.examId || undefined,
        classId: input.classId || undefined,
        openAt: { lte: to },
        closeAt: { gte: from },
        class: { instructors: { some: { instructorId: actorId } } },
      },
      include: {
        questions: {
          include: { question: true },
          orderBy: { position: "asc" },
        },
        attempts: {
          where: {
            submittedAt: { gte: from, lte: to },
            status: { in: ["SUBMITTED", "GRADED"] },
          },
          include: { answers: true },
        },
      },
      orderBy: { openAt: "desc" },
    });
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
        const questionStatsAvailable = new Date() > exam.closeAt;
        const questionStats = questionStatsAvailable
          ? exam.questions.map(({ question }) => {
              const answers = exam.attempts
                .map((attempt) =>
                  attempt.answers.find(
                    (answer) => answer.questionId === question.id,
                  ),
                )
                .filter((answer) => Boolean(answer));
              const correct = serviceContext
                .toStringArray(question.correctAnswers)
                .sort()
                .join("\u0000");
              const correctCount = answers.filter(
                (answer) =>
                  serviceContext
                    .toStringArray(answer!.answerData)
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
            })
          : [];
        return {
          examId: exam.id,
          classId: exam.classId,
          title: exam.title,
          sampleSize: graded.length,
          smallSampleWarning: graded.length < 5,
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
        sampleSize: graded.length,
        smallSampleWarning: graded.length < 5,
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
  actorId = "usr-instructor",
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
