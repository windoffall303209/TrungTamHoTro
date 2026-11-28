import { describe, expect, it, vi } from "vitest";
import type { AuthenticatedSession } from "../../src/auth/auth.service.js";
import type { AcademicServiceContext } from "../../src/domains/learning/academic/academic.context.js";
import { requireTeachingAccess } from "../../src/domains/learning/operations/academic/academic-access.js";

/** Tạo biên database để kiểm tra phạm vi truy vấn và số lượt đọc quyền lớp. */
function fixture(status: string | null = "ACTIVE"): {
  context: AcademicServiceContext;
  session: AuthenticatedSession;
  findFirst: ReturnType<typeof vi.fn>;
  accessibleClassIds: ReturnType<typeof vi.fn>;
} {
  const findFirst = vi.fn().mockResolvedValue(status ? { status } : null);
  const accessibleClassIds = vi.fn();
  const context = { prisma: { learningClass: { findFirst } }, accessibleClassIds } as unknown as AcademicServiceContext;
  const session = { roleCode: "INSTRUCTOR", permissions: ["exam:manage"], user: { id: "teacher-1" } } as AuthenticatedSession;
  return { context, session, findFirst, accessibleClassIds };
}

describe("teaching access point query", () => {
  it("checks assignment and writable status with one scoped read", async () => {
    const { context, session, findFirst, accessibleClassIds } = fixture();
    await requireTeachingAccess(context, "class-1", session, true);
    expect(findFirst).toHaveBeenCalledExactlyOnceWith({
      where: { id: "class-1", instructors: { some: { instructorId: "teacher-1" } } },
      select: { status: true },
    });
    expect(accessibleClassIds).not.toHaveBeenCalled();
  });

  it("rejects missing or unassigned classes without exposing their state", async () => {
    const { context, session } = fixture(null);
    await expect(requireTeachingAccess(context, "other-class", session, true)).rejects.toMatchObject({ status: 404 });
  });

  it("allows closed-class reads but rejects writes", async () => {
    const { context, session } = fixture("CLOSED");
    await expect(requireTeachingAccess(context, "class-1", session)).resolves.toBeUndefined();
    await expect(requireTeachingAccess(context, "class-1", session, true)).rejects.toMatchObject({ status: 409 });
  });

  it("rejects wrong roles and missing permissions before database access", async () => {
    const { context, session, findFirst } = fixture();
    await expect(requireTeachingAccess(context, "class-1", { ...session, roleCode: "LEARNER" })).rejects.toMatchObject({ status: 403 });
    await expect(requireTeachingAccess(context, "class-1", { ...session, permissions: [] })).rejects.toMatchObject({ status: 404 });
    expect(findFirst).not.toHaveBeenCalled();
  });
});
