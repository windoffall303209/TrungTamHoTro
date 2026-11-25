import { Test, type TestingModule } from "@nestjs/testing";
import { randomUUID } from "node:crypto";
import { filter, firstValueFrom, timeout, type Subscription } from "rxjs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { AppModule } from "../../src/app.module.js";
import { DatabaseEventsService } from "../../src/database/database-events.service.js";
import { PrismaService } from "../../src/database/prisma.service.js";
import { EngagementController } from "../../src/domains/learning/engagement/engagement.controller.js";
import { LearningService } from "../../src/domains/learning/core/learning.service.js";
import type { LearningNotification } from "../../src/domains/learning/core/learning.types.js";
import type { AuthenticatedSession } from "../../src/auth/auth.service.js";

describe.skipIf(!(process.env.DB_NAME ?? "").endsWith("_test"))("notification events after commit", () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let bus: DatabaseEventsService;
  let learning: LearningService;
  const prefix = `ne-${randomUUID()}`;
  const recipients = [`${prefix}-a`, `${prefix}-b`];
  const snapshots: LearningNotification[][][] = [[], []];
  const subscriptions: Subscription[] = [];
  const errors: unknown[] = [];

  // Hai tài khoản fixture có stream riêng để kiểm tra không làm lộ dữ liệu giữa người nhận.
  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    prisma = moduleRef.get(PrismaService);
    bus = moduleRef.get(DatabaseEventsService);
    learning = moduleRef.get(LearningService);
    await prisma.user.createMany({ data: recipients.map((id) => ({ id, username: id, displayName: id })) });
    await firstValueFrom(bus.watch().pipe(filter((event) => event.kind === "resync"), timeout(5000)));
    const controller = new EngagementController(learning, bus);
    for (const [index, id] of recipients.entries()) subscriptions.push(controller.watchRoleNotifications({ user: { id } } as AuthenticatedSession)
      .subscribe({ next: (event) => { if ("data" in event) snapshots[index]!.push(event.data); }, error: (error: unknown) => errors.push(error) }));
    await vi.waitFor(() => expect(snapshots.map((rows) => rows.length)).toEqual([1, 1]));
  });

  // Dừng stream và dọn đúng thông báo/outbox/tài khoản fixture.
  afterAll(async () => {
    subscriptions.forEach((subscription) => subscription.unsubscribe());
    if (prisma) {
      await prisma.outboxDelivery.deleteMany({ where: { recipientId: { in: recipients } } });
      await prisma.notification.deleteMany({ where: { recipientId: { in: recipients } } });
      await prisma.user.deleteMany({ where: { id: { in: recipients } } });
    }
    await moduleRef?.close();
  });

  it("updates only the recipient, read-one/read-all and deletion snapshots", async () => {
    await prisma.notification.createMany({ data: [0, 1, 2].map((i) => ({ id: `${prefix}-${i}`, recipientId: recipients[0]!,
      type: "TEST", title: `Notification ${i}`, entityType: "TEST", entityId: prefix, dedupKey: `${prefix}-${i}` })) });
    await vi.waitFor(() => expect(snapshots[0]!.at(-1)).toHaveLength(3));
    expect(snapshots[1]).toEqual([[]]);
    await learning.markNotificationRead(`${prefix}-0`, recipients[0]!);
    await vi.waitFor(() => expect(snapshots[0]!.at(-1)?.find((row) => row.id === `${prefix}-0`)?.readAt).toBeTruthy());
    await expect(learning.markNotificationRead(`${prefix}-0`, recipients[1]!)).rejects.toMatchObject({ status: 404 });
    await learning.markAllNotificationsRead(recipients[0]!);
    await vi.waitFor(() => expect(snapshots[0]!.at(-1)?.every((row) => Boolean(row.readAt))).toBe(true));
    await prisma.notification.deleteMany({ where: { recipientId: recipients[0] } });
    await vi.waitFor(() => expect(snapshots[0]!.at(-1)).toEqual([]));
    expect(snapshots[1]).toEqual([[]]);
    expect(errors).toEqual([]);
  });

  it("discards rolled-back notifications and reloads snapshots after listener reconnect", async () => {
    await expect(prisma.$transaction(async (tx) => {
      await tx.notification.create({ data: { recipientId: recipients[1]!, type: "TEST", title: "Rollback",
        entityType: "TEST", entityId: prefix, dedupKey: `${prefix}-rollback` } });
      throw new Error("rollback notification");
    })).rejects.toThrow("rollback notification");
    const resync = firstValueFrom(bus.watch().pipe(filter((event) => event.kind === "resync"), timeout(5000)));
    await bus["client"]!.end();
    await prisma.notification.create({ data: { recipientId: recipients[1]!, type: "TEST", title: "During disconnect",
      entityType: "TEST", entityId: prefix, dedupKey: `${prefix}-reconnect` } });
    await resync;
    await vi.waitFor(() => expect(snapshots[1]!.at(-1)?.map((row) => row.title)).toEqual(["During disconnect"]));
    expect(snapshots[0]!.at(-1)).toEqual([]);
    expect(errors).toEqual([]);
  });
});
