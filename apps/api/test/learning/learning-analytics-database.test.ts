import { describe, expect, it, vi, type Mock } from "vitest";
import type { LearningServiceContext } from "../../src/domains/learning/core/learning.context.js";
import { getExamAnalytics } from "../../src/domains/learning/operations/analytics/learning-analytics.js";

// Tạo ngữ cảnh dữ liệu giả để kiểm thử thống kê mà không cần kết nối cơ sở dữ liệu.
function analyticsContext(exams: unknown[]): {
  context: LearningServiceContext;
  findMany: Mock<(query: unknown) => Promise<unknown[]>>;
} {
  const findMany = vi.fn<(query: unknown) => Promise<unknown[]>>().mockResolvedValue(exams);
  const toStringArray = vi.fn((value: unknown) => value as string[]);
  const context = {
    reportingPeriod: () => ({ from: new Date("2020-01-01"), to: new Date("2030-01-01") }),
    database: () => ({ exam: { findMany } }),
    toStringArray,
  } as unknown as LearningServiceContext;
  return { context, findMany };
}

describe("database-backed exam analytics", () => {
  it("keeps the first saved answer per question, sparse responses and output rates", async () => {
    const questions = ["one", "two", "unanswered"].map((id) => ({
      question: { id, difficulty: "EASY", correctAnswers: ["yes"] },
    }));
    const attempts = [
      { score: 5, answers: [
        { questionId: "one", answerData: ["no"] },
        { questionId: "one", answerData: ["yes"] },
        { questionId: "two", answerData: ["yes"] },
      ] },
      { score: 10, answers: [{ questionId: "one", answerData: ["yes"] }] },
    ];
    const exam = {
      id: "exam", classId: "class", title: "Final exam", totalScore: 10,
      closeAt: new Date("2025-01-01"), questions, attempts,
    };
    const { context, findMany } = analyticsContext([exam]);

    const report = await getExamAnalytics(context, { examId: "exam" }, "instructor");
    expect(report.exams).toEqual([{
      examId: "exam", classId: "class", title: "Final exam", sampleSize: 2,
      smallSampleWarning: true, averagePercentage: 75, passRate: 100,
      questionStatsAvailable: true,
      questionStats: [
        { questionId: "one", difficulty: "EASY", responseCount: 2, correctRate: 50 },
        { questionId: "two", difficulty: "EASY", responseCount: 1, correctRate: 100 },
        { questionId: "unanswered", difficulty: "EASY", responseCount: 0, correctRate: 0 },
      ],
    }]);
    expect(findMany).toHaveBeenCalledOnce();
    const query = findMany.mock.calls[0]?.[0] as {
      where: { id: string; class: { instructors: { some: { instructorId: string } } } };
    };
    expect(query.where).toMatchObject({
      id: "exam", class: { instructors: { some: { instructorId: "instructor" } } },
    });

    exam.closeAt = new Date("2100-01-01");
    const open = await getExamAnalytics(context, { examId: "exam" }, "instructor");
    expect(open.exams[0]).toMatchObject({ questionStatsAvailable: false, questionStats: [] });
  });

  it("aggregates many attempts and questions without repeatedly searching each answer list", async () => {
    const questions = Array.from({ length: 48 }, (_, index) => ({
      question: { id: `question-${index}`, difficulty: "MEDIUM", correctAnswers: ["yes"] },
    }));
    const answers = questions.map(({ question }) => ({ questionId: question.id, answerData: ["yes"] }));
    const attempts = Array.from({ length: 800 }, () => ({ score: 10, answers }));
    const { context } = analyticsContext([{
      id: "large", classId: "class", title: "Large exam", totalScore: 10,
      closeAt: new Date("2025-01-01"), questions, attempts,
    }]);

    const report = await getExamAnalytics(context, { examId: "large" });
    expect(report.exams[0]).toMatchObject({ sampleSize: 800, averagePercentage: 100, passRate: 100 });
    expect(report.exams[0]?.questionStats).toHaveLength(48);
    expect(report.exams[0]?.questionStats.every((stat) =>
      stat.responseCount === 800 && stat.correctRate === 100,
    )).toBe(true);
  });
});
