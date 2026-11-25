import { Test, type TestingModule } from "@nestjs/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../../src/app.module.js";
import { PrismaService } from "../../src/database/prisma.service.js";
import { LearningService } from "../../src/domains/learning/core/learning.service.js";

describe.skipIf(!(process.env.DB_NAME ?? "").endsWith("_test"))("class readiness consolidated query", () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let learning: LearningService;

  // Dùng DB test thật để đối chiếu SQL tổng hợp với các bộ lọc Prisma trước tối ưu.
  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    prisma = moduleRef.get(PrismaService);
    learning = moduleRef.get(LearningService);
  });

  // Đóng kết nối; bộ test chỉ đọc dữ liệu seed.
  afterAll(async () => { await moduleRef?.close(); });

  it("matches every previous blocker count for seeded classes", async () => {
    const classes = await prisma.learningClass.findMany({ take: 20, orderBy: { id: "asc" } });
    expect(classes.length).toBeGreaterThan(0);
    for (const item of classes) {
      const classId = item.id;
      const checkedAt = new Date();
      const expected = {
        openExams: await prisma.exam.count({ where: { classId, OR: [{ status: "PENDING_REVIEW" }, { status: "PUBLISHED", closeAt: { gt: checkedAt } }] } }),
        inProgressAttempts: await prisma.examAttempt.count({ where: { exam: { classId }, status: "IN_PROGRESS" } }),
        pendingGrades: await prisma.examAttempt.count({ where: { exam: { classId }, status: "SUBMITTED" } }),
        openAssignments: await prisma.assignment.count({ where: { classId, status: "PUBLISHED", dueAt: { gt: checkedAt } } }),
        pendingAssignmentGrades: await prisma.assignmentSubmission.count({ where: { assignment: { classId }, status: "SUBMITTED" } }),
        openRegrades: await prisma.regradeRequest.count({ where: { attempt: { exam: { classId } }, status: { in: ["OPEN", "IN_REVIEW"] } } }),
        activeSessions: await prisma.liveSession.count({ where: { classId, status: { in: ["SCHEDULED", "LIVE"] } } }),
      };
      expect(await learning.getClassClosureReadiness(classId)).toMatchObject(expected);
    }
  });

  it("keeps missing class errors", async () => {
    await expect(learning.getClassClosureReadiness("__missing_readiness_class__")).rejects.toMatchObject({ status: 404 });
  });
});
