import { ForbiddenException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import type { AuthenticatedSession } from "../../src/auth/auth.service.js";
import type { AcademicServiceContext } from "../../src/domains/learning/academic/academic.context.js";
import { isAcademicSupervisor } from "../../src/domains/learning/operations/academic/academic-access.js";
import { listSubmissions } from "../../src/domains/learning/operations/academic/academic-submissions.js";

/** Phiên tối thiểu theo vai trò và quyền cho kiểm thử quyền đọc. */
function session(roleCode: string, permissions: string[]): AuthenticatedSession {
  return { roleCode, permissions, user: { id: `usr-${roleCode.toLowerCase()}` } } as unknown as AuthenticatedSession;
}

/** Ngữ cảnh học thuật giả: một bài tập, một bài nộp và kiểm tra phân công giảng viên luôn từ chối. */
function context(): { ctx: AcademicServiceContext; requireTeachingAccess: ReturnType<typeof vi.fn> } {
  const requireTeachingAccess = vi.fn((): Promise<void> => Promise.reject(new ForbiddenException("Chỉ giảng viên")));
  const ctx = {
    prisma: {
      assignment: { findUnique: vi.fn((): Promise<object> => Promise.resolve({ id: "asg-1", classId: "class-1" })) },
      assignmentSubmission: { findMany: vi.fn((): Promise<object[]> => Promise.resolve([{ id: "sub-1" }])) },
    },
    requireTeachingAccess,
    mapSubmission: (row: object): object => row,
  } as unknown as AcademicServiceContext;
  return { ctx, requireTeachingAccess };
}

describe("Cấp quản lý đọc bài nộp ở chế độ chỉ đọc", () => {
  it("quản lý trung tâm xem được danh sách bài nộp mà không cần là giảng viên của lớp", async () => {
    const { ctx, requireTeachingAccess } = context();
    await expect(listSubmissions(ctx, "asg-1", session("CENTER_MANAGER", ["class:view", "report:view"]))).resolves.toHaveLength(1);
    expect(requireTeachingAccess).not.toHaveBeenCalled();
  });

  it("học viên vẫn phải qua kiểm tra giảng dạy và bị từ chối", async () => {
    const { ctx } = context();
    await expect(listSubmissions(ctx, "asg-1", session("LEARNER", ["class:view"]))).rejects.toThrow(ForbiddenException);
  });

  it("chỉ quản lý có quyền class:view mới là cấp giám sát", () => {
    expect(isAcademicSupervisor(session("SYSTEM_ADMIN", ["class:view"]))).toBe(true);
    expect(isAcademicSupervisor(session("CENTER_MANAGER", []))).toBe(false);
    expect(isAcademicSupervisor(session("INSTRUCTOR", ["class:view"]))).toBe(false);
  });
});
