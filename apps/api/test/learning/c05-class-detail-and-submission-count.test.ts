import { describe, expect, it, vi } from "vitest";
import { NotFoundException } from "@nestjs/common";
import type { AuthenticatedSession } from "../../src/auth/auth.service.js";
import type { AcademicServiceContext } from "../../src/domains/learning/academic/academic.context.js";
import { mapAssignment } from "../../src/domains/learning/operations/academic/academic-mapping.js";
import { listAssignments } from "../../src/domains/learning/operations/academic/academic-assignments.js";
import { getClassById } from "../../src/domains/learning/operations/classes/learning-classes.js";
import type { LearningServiceContext } from "../../src/domains/learning/core/learning.context.js";
import type { LearningClass } from "../../src/domains/learning/core/learning.types.js";

/** Tạo phiên kiểm thử gọn theo vai trò và mã người dùng. */
function makeSession(roleCode: AuthenticatedSession["roleCode"], userId: string): AuthenticatedSession {
  return {
    sessionId: "sess-c05",
    roleCode,
    permissions: ["class:view"],
    availableRoles: [{ code: roleCode, name: roleCode }],
    user: {
      id: userId,
      username: userId,
      name: userId,
      email: `${userId}@test.local`,
      roleName: roleCode,
    },
  };
}

describe("C05 single-class endpoint RBAC and assignment submissionCount", () => {
  const sampleClasses: LearningClass[] = [
    {
      id: "cls-active",
      courseId: "course-1",
      courseVersion: 1,
      code: "CLS-A",
      name: "Lớp A",
      term: "HK1",
      startAt: "2026-01-01T00:00:00.000Z",
      endAt: "2026-12-31T00:00:00.000Z",
      capacity: 30,
      timezone: "Asia/Bangkok",
      allowPeerGradeViewing: false,
      status: "ACTIVE",
      instructorIds: ["inst-1"],
      learnerIds: ["lrn-1", "lrn-2"],
    },
    {
      id: "cls-draft",
      courseId: "course-1",
      courseVersion: 1,
      code: "CLS-D",
      name: "Lớp Nháp",
      term: "HK1",
      startAt: "2026-01-01T00:00:00.000Z",
      endAt: "2026-12-31T00:00:00.000Z",
      capacity: 30,
      timezone: "Asia/Bangkok",
      allowPeerGradeViewing: false,
      status: "DRAFT",
      instructorIds: ["inst-1"],
      learnerIds: ["lrn-1"],
    },
  ];

  const learningCtx = {
    database: () => null,
    classes: sampleClasses,
  } as unknown as LearningServiceContext;

  it("getClassById lọc đúng phạm vi vai trò, ẩn learnerIds của bạn cùng lớp cho học viên và chặn lớp DRAFT", async () => {
    const forManager = await getClassById(learningCtx, "cls-active", "CENTER_MANAGER", "mgr-1");
    expect(forManager.id).toBe("cls-active");
    expect(forManager.learnerIds).toEqual(["lrn-1", "lrn-2"]);

    const forAssignedInstructor = await getClassById(learningCtx, "cls-active", "INSTRUCTOR", "inst-1");
    expect(forAssignedInstructor.id).toBe("cls-active");

    await expect(getClassById(learningCtx, "cls-active", "INSTRUCTOR", "inst-other")).rejects.toThrow(NotFoundException);

    const forLearner = await getClassById(learningCtx, "cls-active", "LEARNER", "lrn-1");
    expect(forLearner.learnerIds).toEqual(["lrn-1"]);
    expect(forLearner.learnerCount).toBe(2);

    await expect(getClassById(learningCtx, "cls-active", "LEARNER", "lrn-outsider")).rejects.toThrow(NotFoundException);
    await expect(getClassById(learningCtx, "cls-draft", "LEARNER", "lrn-1")).rejects.toThrow(NotFoundException);
  });

  it("listAssignments trả submissionCount cho giảng viên từ _count trong cùng truy vấn và ẩn khỏi học viên", async () => {
    const findMany = vi.fn().mockResolvedValue([
      {
        id: "asg-1",
        classId: "cls-active",
        class: { code: "CLS-A" },
        title: "Bài tập 1",
        description: "Mô tả",
        instructions: "Hướng dẫn",
        dueAt: new Date("2026-12-20T10:00:00.000Z"),
        maxScore: 10,
        rubric: [],
        status: "PUBLISHED",
        hidden: false,
        version: 1,
        closedAt: null,
        closeReason: null,
        createdById: "inst-1",
        createdAt: new Date("2026-11-01T00:00:00.000Z"),
        sourceMaterial: null,
        submissions: [],
        _count: { submissions: 12 },
      },
    ]);

    const academicCtx = {
      accessibleClassIds: vi.fn().mockResolvedValue(["cls-active"]),
      prisma: { assignment: { findMany } },
      rubric: () => [],
      mapSubmission: vi.fn(),
      mapAssignment: (row: Parameters<typeof mapAssignment>[1], sub?: Parameters<typeof mapAssignment>[2]) =>
        mapAssignment(academicCtx, row, sub),
    } as unknown as AcademicServiceContext;

    const instructorRows = await listAssignments(academicCtx, makeSession("INSTRUCTOR", "inst-1"), "cls-active");
    expect(instructorRows[0]?.submissionCount).toBe(12);
    const lastFindManyArg = findMany.mock.calls.at(-1)?.[0] as { include?: { _count?: { select?: { submissions?: boolean } } } } | undefined;
    expect(lastFindManyArg?.include?._count?.select?.submissions).toBe(true);

    const learnerRows = await listAssignments(academicCtx, makeSession("LEARNER", "lrn-1"), "cls-active");
    expect(learnerRows[0]?.submissionCount).toBeUndefined();
  });
});
