import { Test, type TestingModule } from "@nestjs/testing";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../../src/app.module.js";
import { PrismaService } from "../../src/database/prisma.service.js";
import { IdentityService } from "../../src/identity/identity.service.js";
import { deleteTestAuditLogs } from "../support/audit-maintenance.js";

describe.skipIf(!(process.env.DB_NAME ?? "").endsWith("_test"))("bàn giao công việc cho tài khoản đa vai trò (D06)", () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let service: IdentityService;
  let actorId: string;
  const prefix = `d06-h-${randomUUID().slice(0, 8)}`;
  const dualSourceId = `${prefix}-dual-src`;
  const dualRecipientId = `${prefix}-dual-dst`;
  const singleInstructorId = `${prefix}-single-inst`;
  const classId = `${prefix}-cls`;
  const ticketId = `${prefix}-tkt`;

  // Tạo tài khoản nguồn đa vai trò (INSTRUCTOR + CENTER_MANAGER) giữ cả lớp lẫn phiếu hỗ trợ và hai người nhận kiểm chứng.
  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    prisma = moduleRef.get(PrismaService);
    service = moduleRef.get(IdentityService);
    actorId = (await prisma.user.findFirstOrThrow({ where: { roles: { some: { role: { code: "SYSTEM_ADMIN" } } } } })).id;
    const instructorRole = await prisma.role.findUniqueOrThrow({ where: { code: "INSTRUCTOR" } });
    const managerRole = await prisma.role.findUniqueOrThrow({ where: { code: "CENTER_MANAGER" } });

    await prisma.user.create({
      data: {
        id: dualSourceId,
        username: dualSourceId,
        displayName: "Dual Role Source",
        status: "ACTIVE",
        roles: { create: [{ roleId: managerRole.id }, { roleId: instructorRole.id }] },
      },
    });
    await prisma.user.create({
      data: {
        id: dualRecipientId,
        username: dualRecipientId,
        displayName: "Dual Role Recipient",
        status: "ACTIVE",
        // Cố tình tạo CENTER_MANAGER trước để tái hiện lỗi take: 1 bỏ qua vai trò INSTRUCTOR thứ hai.
        roles: { create: [{ roleId: managerRole.id }, { roleId: instructorRole.id }] },
      },
    });
    await prisma.user.create({
      data: {
        id: singleInstructorId,
        username: singleInstructorId,
        displayName: "Single Role Instructor",
        status: "ACTIVE",
        roles: { create: [{ roleId: instructorRole.id }] },
      },
    });

    const sourceClass = await prisma.learningClass.findFirstOrThrow();
    await prisma.learningClass.create({
      data: {
        id: classId,
        code: classId,
        name: "Lớp kiểm thử bàn giao đa vai trò",
        courseId: sourceClass.courseId,
        courseVersion: sourceClass.courseVersion,
        term: "test",
        capacity: 20,
        status: "ACTIVE",
        startAt: new Date("2025-01-01T00:00:00Z"),
        endAt: new Date("2030-01-01T00:00:00Z"),
      },
    });
    await prisma.classInstructor.create({
      data: {
        classId,
        instructorId: dualSourceId,
        role: "PRIMARY",
        assignedBy: actorId,
      },
    });
    await prisma.supportTicket.create({
      data: {
        id: ticketId,
        reporterId: actorId,
        assigneeId: dualSourceId,
        category: "TECHNICAL",
        severity: "P2",
        status: "IN_PROGRESS",
        description: "Nội dung phiếu phục vụ kiểm thử bàn giao đa vai trò D06.",
        dueAt: new Date(Date.now() + 86_400_000),
      },
    });
  });

  // Dọn toàn bộ fixture tài khoản, lớp, phiếu và audit sau kiểm thử.
  afterAll(async () => {
    if (prisma) {
      await deleteTestAuditLogs(prisma, { entityId: dualSourceId });
      await prisma.supportTicket.deleteMany({ where: { id: ticketId } });
      await prisma.learningClass.deleteMany({ where: { id: classId } });
      await prisma.user.deleteMany({ where: { id: { in: [dualSourceId, dualRecipientId, singleInstructorId] } } });
    }
    await moduleRef?.close();
  });

  it("gỡ riêng CENTER_MANAGER nhưng giữ ACTIVE INSTRUCTOR chỉ bàn giao phiếu hỗ trợ, không tước lớp đang dạy", async () => {
    const input = { roleCodes: ["INSTRUCTOR" as const], handoffUserId: dualRecipientId, handoffReason: "Bàn giao quyền quản lý phiếu hỗ trợ" };
    const impact = await service.previewUserChange(dualSourceId, input, "SYSTEM_ADMIN");
    expect(impact.requiresHandoff).toBe(true);
    // Chỉ mất quyền vận hành (CENTER_MANAGER), vẫn còn quyền INSTRUCTOR nên lớp không bị đưa vào diện phải bàn giao.
    expect(impact.classes).toHaveLength(0);
    expect(impact.openWork.supportTickets).toBe(1);

    await service.updateUser(dualSourceId, { ...input, impactToken: impact.token }, actorId, "SYSTEM_ADMIN", ["user:update"]);
    expect(await prisma.classInstructor.count({ where: { classId, instructorId: dualSourceId } })).toBe(1);
    expect((await prisma.supportTicket.findUniqueOrThrow({ where: { id: ticketId } })).assigneeId).toBe(dualRecipientId);
  });

  it("chấp nhận bàn giao cả lớp lẫn phiếu cho người nhận đa vai trò và vẫn từ chối người nhận thiếu miền quyền", async () => {
    // Khôi phục lại nguồn có cả hai vai trò và giữ lại cả lớp lẫn phiếu để kiểm khóa tài khoản đa vai trò.
    const managerRole = await prisma.role.findUniqueOrThrow({ where: { code: "CENTER_MANAGER" } });
    await prisma.userRole.createMany({ data: [{ userId: dualSourceId, roleId: managerRole.id }], skipDuplicates: true });
    await prisma.supportTicket.update({ where: { id: ticketId }, data: { assigneeId: dualSourceId } });

    const lockInput = { status: "LOCKED" as const, handoffUserId: singleInstructorId, handoffReason: "Khóa tài khoản đa vai trò" };
    const impact = await service.previewUserChange(dualSourceId, lockInput, "SYSTEM_ADMIN");
    expect(impact.requiresHandoff).toBe(true);
    expect(impact.classes).toHaveLength(1);
    expect(impact.openWork.supportTickets).toBe(1);

    // Người nhận chỉ có INSTRUCTOR (không có CENTER_MANAGER/SYSTEM_ADMIN) phải bị từ chối khi còn phiếu hỗ trợ.
    await expect(
      service.updateUser(dualSourceId, { ...lockInput, impactToken: impact.token }, actorId, "SYSTEM_ADMIN", ["user:suspend"]),
    ).rejects.toMatchObject({ status: 400 });

    // Người nhận đa vai trò (CENTER_MANAGER + INSTRUCTOR) có đủ cả hai miền quyền nên phải bàn giao thành công.
    const dualLockInput = { status: "LOCKED" as const, handoffUserId: dualRecipientId, handoffReason: "Bàn giao trọn gói đa vai trò" };
    const dualImpact = await service.previewUserChange(dualSourceId, dualLockInput, "SYSTEM_ADMIN");
    await service.updateUser(dualSourceId, { ...dualLockInput, impactToken: dualImpact.token }, actorId, "SYSTEM_ADMIN", ["user:suspend"]);

    expect(await prisma.classInstructor.count({ where: { classId, instructorId: dualSourceId } })).toBe(0);
    expect(await prisma.classInstructor.count({ where: { classId, instructorId: dualRecipientId, role: "PRIMARY" } })).toBe(1);
    expect((await prisma.supportTicket.findUniqueOrThrow({ where: { id: ticketId } })).assigneeId).toBe(dualRecipientId);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: dualSourceId } })).status).toBe("LOCKED");
  });
});
