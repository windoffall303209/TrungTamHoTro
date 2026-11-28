import { Test, type TestingModule } from "@nestjs/testing";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../../src/app.module.js";
import { PrismaService } from "../../src/database/prisma.service.js";
import { LearningService } from "../../src/domains/learning/core/learning.service.js";
import { deleteTestAuditLogs } from "../support/audit-maintenance.js";

describe.skipIf(!(process.env.DB_NAME ?? "").endsWith("_test"))("class closure bulk notifications", () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let learning: LearningService;
  let actorId: string;
  let learners: string[];
  const classId = `close-${randomUUID()}`;
  const existingId = `${classId}-notification`;

  // Tạo lớp đã hết hạn với 20 người còn ghi danh và một người đã hủy.
  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    prisma = moduleRef.get(PrismaService);
    learning = moduleRef.get(LearningService);
    const source = await prisma.learningClass.findFirstOrThrow();
    actorId = (await prisma.user.findFirstOrThrow({ where: { roles: { some: { role: { code: "SYSTEM_ADMIN" } } } } })).id;
    learners = (await prisma.user.findMany({ where: { roles: { some: { role: { code: "LEARNER" } } } }, take: 21, orderBy: { id: "asc" } })).map((row) => row.id);
    expect(learners).toHaveLength(21);
    await prisma.learningClass.create({ data: { id: classId, courseId: source.courseId, courseVersion: source.courseVersion,
      code: classId, name: "Bulk closure test", term: "test", capacity: 30, status: "ACTIVE",
      startAt: new Date(Date.now() - 172_800_000), endAt: new Date(Date.now() - 86_400_000),
      enrollments: { create: learners.map((learnerId, i) => ({ learnerId, status: i === 20 ? "CANCELLED" as const : "ACTIVE" as const })) } } });
    await prisma.notification.create({ data: { id: existingId, recipientId: learners[0]!, type: "CLASS_ARCHIVED", title: "Thông báo cũ",
      entityType: "CLASS", entityId: classId, dedupKey: `class-archived:${classId}:${learners[0]!}`,
      readAt: new Date(), createdAt: new Date(Date.now() - 86_400_000) } });
  });

  // Dọn đúng lớp và thông báo do test tạo, giữ nguyên dữ liệu seed.
  afterAll(async () => {
    if (prisma) {
      await deleteTestAuditLogs(prisma, { entityId: classId });
      await prisma.outboxDelivery.deleteMany({ where: { aggregateId: classId } });
      await prisma.notification.deleteMany({ where: { entityId: classId } });
      await prisma.learningClass.deleteMany({ where: { id: classId } });
    }
    await moduleRef?.close();
  });

  it("notifies only active learners and preserves dedup conflict semantics", async () => {
    await learning.closeClass(classId, "Đã hoàn tất chương trình", "STANDARD_RETENTION", actorId);
    const rows = await prisma.notification.findMany({ where: { entityId: classId } });
    expect(rows).toHaveLength(20);
    expect(rows.every((row) => row.readAt === null)).toBe(true);
    expect(rows.some((row) => row.recipientId === learners[20])).toBe(false);
    expect(rows.find((row) => row.id === existingId)?.title).toBe("Thông báo cũ");
    expect((await prisma.learningClass.findUniqueOrThrow({ where: { id: classId } })).status).toBe("CLOSED");
    expect(await prisma.auditLog.count({ where: { entityId: classId, action: "CLASS_CLOSE_ARCHIVE" } })).toBe(1);
    await expect(learning.closeClass(classId, "Thử đóng thêm lần nữa", "STANDARD_RETENTION", actorId)).rejects.toMatchObject({ status: 409 });
    expect(await prisma.notification.count({ where: { entityId: classId } })).toBe(20);
  });
});
