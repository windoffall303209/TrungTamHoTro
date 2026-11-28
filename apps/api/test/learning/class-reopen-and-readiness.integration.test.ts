import { Test, type TestingModule } from "@nestjs/testing";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../../src/app.module.js";
import { PrismaService } from "../../src/database/prisma.service.js";
import { LearningService } from "../../src/domains/learning/core/learning.service.js";
import { deleteTestAuditLogs } from "../support/audit-maintenance.js";

describe.skipIf(!(process.env.DB_NAME ?? "").endsWith("_test"))("đóng và mở lại lớp đồng thời (D06)", () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let learning: LearningService;
  let actorId: string;
  const classId = `d06-reopen-${randomUUID()}`;

  // Tạo một lớp đã đóng sẵn để kiểm thử mở lại đồng thời và đối chiếu readiness.
  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    prisma = moduleRef.get(PrismaService);
    learning = moduleRef.get(LearningService);
    const source = await prisma.learningClass.findFirstOrThrow();
    actorId = (await prisma.user.findFirstOrThrow({ where: { roles: { some: { role: { code: "SYSTEM_ADMIN" } } } } })).id;
    await prisma.learningClass.create({
      data: {
        id: classId,
        code: classId,
        name: "Lớp kiểm thử đóng/mở đồng thời",
        courseId: source.courseId,
        courseVersion: source.courseVersion,
        term: "test",
        capacity: 20,
        status: "CLOSED",
        closeReason: "Đã hoàn tất học kỳ",
        archivePolicy: "STANDARD_RETENTION",
        closedAt: new Date(Date.now() - 3600_000),
        archivedAt: new Date(Date.now() - 3600_000),
        startAt: new Date(Date.now() - 172_800_000),
        endAt: new Date(Date.now() - 86_400_000),
      },
    });
  });

  // Dọn sạch lớp, thông báo và audit tạo bởi kiểm thử.
  afterAll(async () => {
    if (prisma) {
      await deleteTestAuditLogs(prisma, { entityId: classId });
      await prisma.outboxDelivery.deleteMany({ where: { aggregateId: classId } });
      await prisma.notification.deleteMany({ where: { entityId: classId } });
      await prisma.learningClass.deleteMany({ where: { id: classId } });
    }
    await moduleRef?.close();
  });

  it("chỉ cho đúng một yêu cầu reopenClass thành công khi gửi đồng thời và chỉ ghi đúng một audit CLASS_REOPEN", async () => {
    const settled = await Promise.allSettled([
      learning.reopenClass(classId, "Mở lại bổ sung điểm lần 1", actorId),
      learning.reopenClass(classId, "Mở lại bổ sung điểm lần 2", actorId),
      learning.reopenClass(classId, "Mở lại bổ sung điểm lần 3", actorId),
      learning.reopenClass(classId, "Mở lại bổ sung điểm lần 4", actorId),
    ]);

    const fulfilled = settled.filter((item) => item.status === "fulfilled");
    const rejected = settled.filter((item): item is PromiseRejectedResult => item.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(3);
    for (const failure of rejected) {
      expect(failure.reason).toMatchObject({ status: 409 });
    }
    expect(await prisma.auditLog.count({ where: { entityId: classId, action: "CLASS_REOPEN" } })).toBe(1);

    // Sau khi mở lại thành ACTIVE, kiểm tra readiness phải cho eligible=true và đóng lại đồng thời chỉ có đúng 1 thành công.
    const readiness = await learning.getClassClosureReadiness(classId);
    expect(readiness.eligible).toBe(true);

    const closeSettled = await Promise.allSettled([
      learning.closeClass(classId, "Đóng lớp hoàn tất lần 1", "STANDARD_RETENTION", actorId),
      learning.closeClass(classId, "Đóng lớp hoàn tất lần 2", "STANDARD_RETENTION", actorId),
    ]);
    expect(closeSettled.filter((item) => item.status === "fulfilled")).toHaveLength(1);
    expect(closeSettled.filter((item) => item.status === "rejected")).toHaveLength(1);
    expect(await prisma.auditLog.count({ where: { entityId: classId, action: "CLASS_CLOSE_ARCHIVE" } })).toBe(1);
  });
});
