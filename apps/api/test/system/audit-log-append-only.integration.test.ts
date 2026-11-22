import { Test, type TestingModule } from "@nestjs/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../../src/app.module.js";
import { PrismaService } from "../../src/database/prisma.service.js";
import { deleteTestAuditLogs } from "../support/audit-maintenance.js";

const enabled = (process.env.DB_NAME ?? "").endsWith("_test");
const suite = describe.skipIf(!enabled);
const suffix = `${process.pid}-${Date.now().toString(36)}`;

suite("audit_logs chỉ cho phép ghi thêm", () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  const userId = `usr-audit-${suffix}`;

  // Dùng PostgreSQL thật vì ràng buộc nằm ở trigger trong database.
  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    prisma = moduleRef.get(PrismaService);
  });

  // Dọn dữ liệu kiểm thử qua đường bảo trì có kiểm soát.
  afterAll(async () => {
    await deleteTestAuditLogs(prisma, { entityId: `audit-${suffix}` });
    await prisma.user.deleteMany({ where: { id: userId } });
    await moduleRef.close();
  });

  it("chặn sửa, xóa và TRUNCATE nhật ký nhưng vẫn cho FK SET NULL khi xóa người dùng", async () => {
    await prisma.user.create({ data: { id: userId, username: `audit-${suffix}`, displayName: "Người kiểm thử audit", status: "ACTIVE" } });
    const log = await prisma.auditLog.create({ data: { actorId: userId, action: "AUDIT_APPEND_ONLY_TEST", entityType: "test", entityId: `audit-${suffix}`, context: { value: 1 } } });

    await expect(prisma.auditLog.update({ where: { id: log.id }, data: { action: "TAMPERED" } })).rejects.toThrow(/chỉ cho phép ghi thêm/);
    await expect(prisma.auditLog.delete({ where: { id: log.id } })).rejects.toThrow(/chỉ cho phép ghi thêm/);
    await expect(prisma.$executeRawUnsafe('TRUNCATE "audit_logs"')).rejects.toThrow(/TRUNCATE/);

    await prisma.user.delete({ where: { id: userId } });
    const kept = await prisma.auditLog.findUniqueOrThrow({ where: { id: log.id } });
    expect(kept).toMatchObject({ actorId: null, action: "AUDIT_APPEND_ONLY_TEST", entityId: `audit-${suffix}` });
  });
});
