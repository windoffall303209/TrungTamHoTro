import { describe, expect, it, vi } from "vitest";
import type { AuthenticatedSession } from "../../src/auth/auth.service.js";
import type { AcademicServiceContext } from "../../src/domains/learning/academic/academic.context.js";
import { gradebook } from "../../src/domains/learning/operations/academic/academic-grading.js";

const now = Date.now();
const past = new Date(now - 86_400_000);

/** Tạo fixture lớp 200 học viên × 20 bài kiểm tra (10 trắc nghiệm + 10 tự luận) để đo kích thước JSON trước/sau. */
function buildLargeClassFixture(learnerCount = 200, examCount = 10, assignmentCount = 10): Record<string, unknown> {
  const enrollments = Array.from({ length: learnerCount }, (_, i) => ({
    learnerId: `lrn-${String(i + 1).padStart(3, "0")}`,
    learner: {
      displayName: `Học viên thứ ${i + 1}`,
      email: `hocvien${i + 1}@wind.edu.vn`,
    },
  }));
  const exams = Array.from({ length: examCount }, (_, e) => ({
    id: `exam-${e + 1}`,
    title: `Bài kiểm tra trắc nghiệm Chương ${e + 1}`,
    totalScore: 10,
    openAt: new Date(now - (examCount - e + 10) * 86_400_000),
    closeAt: past,
    hidden: false,
    status: "CLOSED",
    // ~70% học viên đã nộp, 30% chưa nộp để phản ánh lớp học thực tế.
    attempts: enrollments
      .filter((_, idx) => (idx + e) % 10 < 7)
      .map((entry, idx) => ({
        learnerId: entry.learnerId,
        status: "GRADED",
        score: Number(((idx % 10) + 0.5).toFixed(1)),
      })),
  }));
  const assignments = Array.from({ length: assignmentCount }, (_, a) => ({
    id: `asg-${a + 1}`,
    title: `Bài tập tự luận Chủ đề ${a + 1}`,
    maxScore: 10,
    createdAt: new Date(now - (assignmentCount - a + 5) * 86_400_000),
    dueAt: past,
    hidden: false,
    status: "CLOSED",
    submissions: enrollments
      .filter((_, idx) => (idx + a) % 10 < 6)
      .map((entry, idx) => ({
        learnerId: entry.learnerId,
        status: idx % 9 === 0 ? "SUBMITTED" : "GRADED",
        score: idx % 9 === 0 ? null : Number(((idx % 9) + 1).toFixed(1)),
      })),
  }));
  return { id: "cls-large", enrollments, exams, assignments };
}

describe("C07 Gradebook payload deduplication & DB-scoped filtering", () => {
  it("giảm đáng kể dung lượng JSON sổ điểm trên lớp 200 học viên × 20 bài (không lặp cột và ma trận ô thưa)", async () => {
    const fixture = buildLargeClassFixture(200, 10, 10);
    const findUnique = vi.fn().mockResolvedValue(fixture);
    const ctx = {
      prisma: { learningClass: { findUnique } },
      requireTeachingAccess: vi.fn(),
    } as unknown as AcademicServiceContext;
    const managerSession = {
      roleCode: "CENTER_MANAGER",
      permissions: ["class:view"],
      user: { id: "usr-mgr" },
    } as unknown as AuthenticatedSession;

    const compact = await gradebook(ctx, "cls-large", managerSession);
    expect(compact.assessments).toHaveLength(20);
    expect(compact.rows).toHaveLength(200);
    expect(compact.rows.every((row) => row.assessments === undefined)).toBe(true);

    // So sánh với định dạng cũ (lặp nguyên mảng assessments trên cả 200 dòng và gửi đủ 20 ô kể cả NOT_SUBMITTED + kind/maxScore).
    const legacyRows = compact.rows.map((row) => {
      const byId = new Map((row.cells ?? []).map((cell) => [cell.assessmentId, cell]));
      return {
        ...row,
        assessments: compact.assessments,
        cells: compact.assessments.map((col) => {
          const existing = byId.get(col.id);
          return {
            assessmentId: col.id,
            kind: col.kind,
            score: existing?.status === "GRADED" ? (existing.score ?? 0) : null,
            maxScore: col.maxScore,
            status: existing?.status ?? "NOT_SUBMITTED",
            attemptCount: existing ? (existing.attemptCount ?? 1) : 0,
          };
        }),
      };
    });

    const legacyBytes = Buffer.byteLength(JSON.stringify(legacyRows), "utf8");
    const compactBytes = Buffer.byteLength(JSON.stringify(compact), "utf8");
    const reductionPct = ((legacyBytes - compactBytes) / legacyBytes) * 100;

    // Payload mới phải giảm trên 70% dung lượng JSON so với định dạng cũ lặp cột & ô đầy.
    expect(compactBytes).toBeLessThan(legacyBytes * 0.3);
    expect(reductionPct).toBeGreaterThan(70);

    // Xác minh truy vấn Prisma không kéo `attempts` full row (chỉ select learnerId/status/score).
    const queryArg = findUnique.mock.calls[0]?.[0] as {
      select: {
        exams: { select: { attempts: { select: Record<string, boolean> } } };
      };
    };
    expect(queryArg.select.exams.select.attempts.select).toEqual({
      learnerId: true,
      status: true,
      score: true,
    });
  });

  it("chế độ SELF đẩy điều kiện lọc learnerId xuống truy vấn DB thay vì kéo toàn bộ lớp lên RAM", async () => {
    const findUnique = vi
      .fn()
      .mockResolvedValueOnce({
        allowPeerGradeViewing: false,
        enrollments: [{ learnerId: "lrn-007" }],
      })
      .mockResolvedValueOnce({
        id: "cls-large",
        enrollments: [{ learnerId: "lrn-007", learner: { displayName: "Học viên 7", email: "hv7@wind.edu.vn" } }],
        exams: [],
        assignments: [],
      });
    const ctx = {
      prisma: { learningClass: { findUnique } },
      requireTeachingAccess: vi.fn(),
    } as unknown as AcademicServiceContext;
    const learnerSession = {
      roleCode: "LEARNER",
      permissions: ["class:view"],
      user: { id: "lrn-007" },
    } as unknown as AuthenticatedSession;

    const result = await gradebook(ctx, "cls-large", learnerSession);
    expect(result.rows.map((r) => r.learnerId)).toEqual(["lrn-007"]);
    expect(findUnique).toHaveBeenCalledTimes(2);

    const dataQueryArg = findUnique.mock.calls[1]?.[0] as {
      select: {
        enrollments: { where: Record<string, unknown> };
        exams: { select: { attempts: { where: Record<string, unknown> } } };
        assignments: { select: { submissions: { where: Record<string, unknown> } } };
      };
    };
    expect(dataQueryArg.select.enrollments.where).toEqual({ status: "ACTIVE", learnerId: "lrn-007" });
    expect(dataQueryArg.select.exams.select.attempts.where).toEqual({ learnerId: "lrn-007" });
    expect(dataQueryArg.select.assignments.select.submissions.where).toEqual({ learnerId: "lrn-007" });
  });
});
