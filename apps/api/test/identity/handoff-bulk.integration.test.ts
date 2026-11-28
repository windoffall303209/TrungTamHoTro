import { Test, type TestingModule } from "@nestjs/testing";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../../src/app.module.js";
import { PrismaService } from "../../src/database/prisma.service.js";
import { IdentityService } from "../../src/identity/identity.service.js";
import { deleteTestAuditLogs } from "../support/audit-maintenance.js";

describe.skipIf(!(process.env.DB_NAME ?? "").endsWith("_test"))("bulk identity class handoff", () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let service: IdentityService;
  let actorId: string;
  const prefix = `handoff-${randomUUID()}`;
  const fromId = `${prefix}-from`;
  const toId = `${prefix}-to`;
  const classIds = Array.from({ length: 48 }, (_, i) => `${prefix}-${i}`);
  const oldDate = new Date("2025-01-01T00:00:00Z");

  // Tạo 48 lớp, phủ sáu tổ hợp vai trò nguồn và phân công người nhận có/không tồn tại.
  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    prisma = moduleRef.get(PrismaService);
    service = moduleRef.get(IdentityService);
    actorId = (await prisma.user.findFirstOrThrow({ where: { roles: { some: { role: { code: "SYSTEM_ADMIN" } } } } })).id;
    const role = await prisma.role.findUniqueOrThrow({ where: { code: "INSTRUCTOR" } });
    for (const id of [fromId, toId]) await prisma.user.create({ data: {
      id, username: id, displayName: "Bulk handoff fixture", status: "ACTIVE", roles: { create: { roleId: role.id } },
    } });
    const source = await prisma.learningClass.findFirstOrThrow();
    await prisma.learningClass.createMany({ data: classIds.map((id) => ({ id, code: id, name: "Bulk handoff", courseId: source.courseId,
      courseVersion: source.courseVersion, term: "test", capacity: 10, status: "ACTIVE", startAt: oldDate, endAt: new Date("2030-01-01") })) });
    await prisma.classInstructor.createMany({ data: classIds.map((classId, i) => ({ classId, instructorId: fromId,
      role: i % 6 < 3 ? "PRIMARY" as const : "CO_INSTRUCTOR" as const, assignedBy: actorId, assignedAt: oldDate })) });
    await prisma.classInstructor.createMany({ data: classIds.flatMap((classId, i) => i % 3 === 0 ? [] : [{ classId, instructorId: toId,
      role: i % 3 === 1 ? "CO_INSTRUCTOR" as const : "PRIMARY" as const, assignedBy: fromId, assignedAt: oldDate }]) });
  });

  // Dọn đúng fixture và audit; giữ nguyên tài khoản/lớp seed.
  afterAll(async () => {
    if (prisma) {
      await deleteTestAuditLogs(prisma, { entityId: fromId });
      await prisma.learningClass.deleteMany({ where: { id: { in: classIds } } });
      await prisma.user.deleteMany({ where: { id: { in: [fromId, toId] } } });
    }
    await moduleRef?.close();
  });

  it("rejects stale preview, rolls back failed bulk transfer, then preserves all assignment semantics", async () => {
    const input = { status: "LOCKED" as const, handoffUserId: toId, handoffReason: "Bàn giao toàn bộ lớp" };
    const impact = await service.previewUserChange(fromId, input, "SYSTEM_ADMIN");
    expect(impact.classes).toHaveLength(48);
    await expect(service.updateUser(fromId, { ...input, impactToken: "stale" }, actorId, "SYSTEM_ADMIN", ["user:suspend"])).rejects.toMatchObject({ status: 409 });

    // Mô phỏng phân công nguồn bị xóa sau preview trong cùng transaction; batch phải từ chối và rollback.
    await expect(prisma.$transaction(async (tx) => {
      await tx.classInstructor.delete({ where: { classId_instructorId: { classId: classIds[0]!, instructorId: fromId } } });
      await service["handoffDatabaseWork"](tx, fromId, toId, actorId, impact);
    })).rejects.toMatchObject({ status: 409 });
    expect(await prisma.classInstructor.count({ where: { instructorId: fromId } })).toBe(48);
    expect(await prisma.classInstructor.count({ where: { instructorId: toId } })).toBe(32);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: fromId } })).status).toBe("ACTIVE");

    await service.updateUser(fromId, { ...input, impactToken: impact.token }, actorId, "SYSTEM_ADMIN", ["user:suspend"]);
    expect(await prisma.classInstructor.count({ where: { instructorId: fromId } })).toBe(0);
    const assignments = await prisma.classInstructor.findMany({ where: { instructorId: toId } });
    expect(assignments).toHaveLength(48);
    for (const [i, classId] of classIds.entries()) {
      const row = assignments.find((item) => item.classId === classId)!;
      const preserveExisting = i % 6 >= 3 && i % 3 !== 0;
      expect(row.role).toBe(i % 6 < 3 || i % 3 === 2 ? "PRIMARY" : "CO_INSTRUCTOR");
      expect(row.assignedBy).toBe(preserveExisting ? fromId : actorId);
      if (preserveExisting) expect(row.assignedAt).toEqual(oldDate);
      else expect(row.assignedAt.getTime()).toBeGreaterThan(oldDate.getTime());
    }
    expect((await prisma.user.findUniqueOrThrow({ where: { id: fromId } })).status).toBe("LOCKED");
    expect(await prisma.auditLog.count({ where: { entityId: fromId, action: "USER_UPDATED" } })).toBe(1);
  });
});
