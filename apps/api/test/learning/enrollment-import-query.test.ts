import { ConflictException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import type { LearningServiceContext } from "../../src/domains/learning/core/learning.context.js";
import { importEnrollments } from "../../src/domains/learning/operations/classes/learning-class-enrollments.js";

/** Tạo biên tra cứu và ghi danh để đo số lần đọc, giữ kết quả từng dòng. */
function fixture(): { context: LearningServiceContext; findMany: ReturnType<typeof vi.fn>; enrollLearner: ReturnType<typeof vi.fn> } {
  const findMany = vi.fn().mockResolvedValue([]);
  const enrollLearner = vi.fn().mockResolvedValue({});
  const context = { database: () => ({ user: { findMany } }), enrollLearner } as unknown as LearningServiceContext;
  return { context, findMany, enrollLearner };
}

describe("batched enrollment identity lookup", () => {
  it("resolves 100 identifiers in one bounded lookup", async () => {
    const { context, findMany, enrollLearner } = fixture();
    const ids = Array.from({ length: 100 }, (_, index) => `learner-${index}`);
    const results = await importEnrollments(context, "class-1", ids, "manager");
    expect(results.every((row) => row.status === "ENROLLED")).toBe(true);
    expect(findMany).toHaveBeenCalledTimes(1);
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: {
      status: { in: ["ACTIVE", "PENDING"] },
      OR: [{ id: { in: ids } }, { email: { in: ids } }],
      roles: { some: { role: { code: "LEARNER" } } },
    } }));
    expect(enrollLearner).toHaveBeenCalledTimes(100);
  });

  it("preserves email normalization, duplicates and per-row enrollment errors", async () => {
    const { context, findMany, enrollLearner } = fixture();
    findMany.mockResolvedValue([{ id: "user-1", email: "a@example.com" }]);
    enrollLearner.mockResolvedValueOnce({}).mockRejectedValueOnce(new ConflictException("Đã ghi danh"));
    const rows = await importEnrollments(context, "class-1", [" A@EXAMPLE.COM ", "a@example.com", "user-1", " "], "manager");
    expect(rows.map((row) => row.status)).toEqual(["ENROLLED", "SKIPPED", "SKIPPED"]);
    expect(rows[0]?.userId).toBe("user-1");
    expect(enrollLearner).toHaveBeenNthCalledWith(1, "class-1", "user-1", "manager");
  });

  it("bounds large imports and isolates lookup failures to their batch", async () => {
    const { context, findMany, enrollLearner } = fixture();
    findMany.mockRejectedValueOnce(new Error("DB unavailable")).mockResolvedValueOnce([]);
    const rows = await importEnrollments(context, "class-1", Array.from({ length: 501 }, (_, i) => `user-${i}`), "manager");
    expect(findMany).toHaveBeenCalledTimes(2);
    expect(rows.filter((row) => row.status === "FAILED")).toHaveLength(500);
    expect(rows[500]?.status).toBe("ENROLLED");
    expect(enrollLearner).toHaveBeenCalledTimes(1);
  });

  it("does not query for empty input", async () => {
    const { context, findMany } = fixture();
    expect(await importEnrollments(context, "class-1", [" "], "manager")).toEqual([]);
    expect(findMany).not.toHaveBeenCalled();
  });
});
