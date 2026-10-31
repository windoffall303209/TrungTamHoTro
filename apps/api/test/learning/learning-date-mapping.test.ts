import { describe, expect, it } from "vitest";
import type { LearningServiceContext } from "../../src/domains/learning/core/learning.context.js";
import type { AttemptWithAnswers } from "../../src/domains/learning/core/learning.shared.js";
import { latestDate } from "../../src/domains/learning/operations/reports/learning-report-rules.js";
import { mapAttempt } from "../../src/domains/learning/operations/mapping/learning-result-mapping.js";

describe("learning date mapping", () => {
  it("finds the latest date in a large list without exceeding argument limits", () => {
    const older = new Date("2025-01-01T00:00:00.000Z");
    const newer = new Date("2026-10-31T00:00:00.000Z");
    const values = Array<Date>(150_000).fill(older);
    values[50_000] = newer;

    expect(latestDate(values)).toBe(newer.toISOString());
    expect(latestDate([])).toBeUndefined();
    expect(() => latestDate([older, new Date(Number.NaN)])).toThrow(
      RangeError,
    );
  });

  it("maps large answer sets with their latest save time and the same answer contract", () => {
    const older = new Date("2026-01-01T00:00:00.000Z");
    const newer = new Date("2026-10-31T00:00:00.000Z");
    const answer = {
      questionId: "question-one",
      answerData: ["selected"],
      updatedAt: older,
    };
    const answers = Array<typeof answer>(150_000).fill(answer);
    answers[25_000] = { ...answer, updatedAt: newer };
    const attempt = {
      id: "attempt-one",
      examId: "exam-one",
      learnerId: "learner-one",
      answers,
      status: "IN_PROGRESS",
      startedAt: older,
      submittedAt: null,
      score: null,
      feedback: null,
      gradePublishedAt: null,
    } as unknown as AttemptWithAnswers;
    const context = {
      toStringArray: (data: unknown) => data as string[],
      submissionReceipt: () => "receipt",
    } as unknown as LearningServiceContext;

    const result = mapAttempt(context, attempt);
    expect(result.lastSavedAt).toBe(newer.toISOString());
    expect(result.answers).toEqual({ "question-one": ["selected"] });
    expect(result.score).toBeUndefined();
    expect(result.submissionReceipt).toBeUndefined();

    const emptyResult = mapAttempt(context, { ...attempt, answers: [] });
    expect(emptyResult.lastSavedAt).toBeUndefined();
    expect(emptyResult.answers).toEqual({});

    const invalidAttempt = {
      ...attempt,
      answers: [{ ...answer, updatedAt: new Date(Number.NaN) }],
    } as unknown as AttemptWithAnswers;
    expect(() => mapAttempt(context, invalidAttempt)).toThrow(RangeError);
  });
});
