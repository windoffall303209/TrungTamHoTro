import { describe, expect, it } from "vitest";
import type { AuthenticatedSession } from "../../src/auth/auth.service.js";
import type { AcademicServiceContext } from "../../src/domains/learning/academic/academic.context.js";
import { gradebook } from "../../src/domains/learning/operations/academic/academic-grading.js";
import { buildLearnerProgress } from "../../src/domains/learning/operations/reports/learning-report-rules.js";

const past = new Date(Date.now() - 86_400_000);
const thresholds = { scoreBelow: 50, completionBelow: 60, inactiveDays: 7 };

/** Lớp giả: một đề thang 10 đạt 10, một bài tập thang 100 đạt 50 và một bài tập đang ẩn đã quá hạn chưa nộp. */
function context(): AcademicServiceContext {
  const classItem = {
    id: "class-1",
    enrollments: [{ learnerId: "usr-l1", learner: { displayName: "Học viên", email: null } }],
    exams: [{ id: "exam-1", title: "Đề", totalScore: 10, openAt: past, createdAt: past, closeAt: past, status: "CLOSED", hidden: false, attempts: [{ learnerId: "usr-l1", status: "GRADED", score: 10, attemptNo: 1 }] }],
    assignments: [
      { id: "asg-1", title: "Bài 1", maxScore: 100, createdAt: past, dueAt: past, status: "CLOSED", hidden: false, submissions: [{ learnerId: "usr-l1", status: "GRADED", score: 50 }] },
      { id: "asg-hidden", title: "Bài ẩn", maxScore: 100, createdAt: past, dueAt: past, status: "CLOSED", hidden: true, submissions: [] },
    ],
  };
  return { prisma: { learningClass: { findUnique: (): Promise<object> => Promise.resolve(classItem) } } } as unknown as AcademicServiceContext;
}

describe("Thống nhất công thức điểm", () => {
  it("sổ điểm lấy trung bình phần trăm từng bài và bỏ bài ẩn khỏi trung bình", async () => {
    const session = { roleCode: "CENTER_MANAGER", permissions: ["class:view"], user: { id: "usr-m" } } as unknown as AuthenticatedSession;
    const [row] = await gradebook(context(), "class-1", session);
    // (100% + 50%) / 2 = 75%; công thức cộng thô cũ cho (10 + 50) / 110 ≈ 54,55% và tính bài ẩn quá hạn là 0.
    expect(row!.totalPercent).toBe(75);
    expect(row!.notSubmitted).toBe(0);
    expect(row!.cells).toHaveLength(3);
  });

  it("không gắn nguy cơ khi lớp chưa có bài đánh giá nào", () => {
    const progress = buildLearnerProgress({ learnerId: "usr-l1", materialCompletionRate: 0, assessmentCompletionRate: 0, averageScore: 0, lastActivityAt: undefined, interventions: [], thresholds, scoredItems: 0, totalAssessments: 0 });
    expect(progress.riskLevel).toBe("LOW");
    expect(progress.riskReasons).toEqual([]);
    const atRisk = buildLearnerProgress({ learnerId: "usr-l1", materialCompletionRate: 0, assessmentCompletionRate: 0, averageScore: 0, lastActivityAt: undefined, interventions: [], thresholds, scoredItems: 2, totalAssessments: 2 });
    expect(atRisk.riskLevel).toBe("HIGH");
  });
});
