import { Test, type TestingModule } from "@nestjs/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../../src/app.module.js";
import { PrismaService } from "../../src/database/prisma.service.js";

const enabled = (process.env.DB_NAME ?? "").endsWith("_test");
const suite = describe.skipIf(!enabled);
const suffix = `${process.pid}-${Date.now().toString(36)}`;

suite("Trigger outbox theo câu lệnh", () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  const noEmailUser = `usr-outbox-noemail-${suffix}`;
  const staffUser = `usr-outbox-staff-${suffix}`;
  const notificationIds = [`notif-outbox-a-${suffix}`, `notif-outbox-b-${suffix}`, `notif-outbox-c-${suffix}`];

  // Dùng PostgreSQL thật vì logic nằm ở trigger trong database.
  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    prisma = moduleRef.get(PrismaService);
    await prisma.user.createMany({ data: [
      { id: noEmailUser, username: `outbox-noemail-${suffix}`, displayName: "Chưa có email", status: "ACTIVE" },
      { id: staffUser, username: `outbox-staff-${suffix}`, email: `outbox-${suffix}@wind.test`, displayName: "Nhân sự có email", status: "ACTIVE" },
    ] });
  });

  // Dọn thông báo, delivery và tài khoản kiểm thử.
  afterAll(async () => {
    await prisma.outboxDelivery.deleteMany({ where: { id: { in: notificationIds.map((id) => `delivery:email:${id}`) } } });
    await prisma.notification.deleteMany({ where: { id: { in: notificationIds } } });
    await prisma.user.deleteMany({ where: { id: { in: [noEmailUser, staffUser] } } });
    await moduleRef.close();
  });

  it("một lệnh INSERT nhiều thông báo chỉ tạo delivery cho người nhận có email", async () => {
    await prisma.notification.createMany({ data: [
      { id: notificationIds[0]!, recipientId: noEmailUser, type: "TEST_OUTBOX", title: "Không email", entityType: "SYSTEM", entityId: suffix, dedupKey: notificationIds[0]! },
      { id: notificationIds[1]!, recipientId: staffUser, type: "TEST_OUTBOX", title: "Có email 1", entityType: "SYSTEM", entityId: suffix, dedupKey: notificationIds[1]! },
      { id: notificationIds[2]!, recipientId: staffUser, type: "TEST_OUTBOX", title: "Có email 2", entityType: "SYSTEM", entityId: suffix, dedupKey: notificationIds[2]! },
    ] });
    const deliveries = await prisma.outboxDelivery.findMany({ where: { id: { in: notificationIds.map((id) => `delivery:email:${id}`) } }, orderBy: { id: "asc" } });
    expect(deliveries.map((item) => item.recipientId)).toEqual([staffUser, staffUser]);
    expect(deliveries.every((item) => item.status === "PENDING" && item.channel === "EMAIL")).toBe(true);
  });
});
