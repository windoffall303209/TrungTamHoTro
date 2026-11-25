import { Test, type TestingModule } from "@nestjs/testing";
import { randomUUID } from "node:crypto";
import { filter, firstValueFrom, timeout, type Subscription } from "rxjs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { AppModule } from "../../src/app.module.js";
import { REQUIRED_PERMISSIONS_KEY } from "../../src/auth/require-permissions.decorator.js";
import { DatabaseEventsService } from "../../src/database/database-events.service.js";
import { PrismaService } from "../../src/database/prisma.service.js";
import { SystemController } from "../../src/domains/system/core/system.controller.js";

describe.skipIf(!(process.env.DB_NAME ?? "").endsWith("_test"))("operational job refresh events", () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let bus: DatabaseEventsService;
  let subscription: Subscription;
  const id = `job-event-${randomUUID()}`;
  const received: Array<{ revision: number }> = [];
  const errors: unknown[] = [];

  // Compile không khởi động worker; fixture job sẽ không chạy backup/restore thật.
  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    prisma = moduleRef.get(PrismaService);
    bus = moduleRef.get(DatabaseEventsService);
    await prisma.operationalJob.create({ data: { id: `${id}-source`, kind: "BACKUP", type: "FULL", status: "COMPLETED", requestedBy: "fixture" } });
    await firstValueFrom(bus.watch().pipe(filter((event) => event.kind === "resync"), timeout(5000)));
    subscription = moduleRef.get(SystemController).watchOperations().subscribe({
      next: (event) => { if ("data" in event) received.push(event.data); }, error: (error: unknown) => errors.push(error),
    });
    await vi.waitFor(() => expect(received).toHaveLength(1));
  });

  // Đóng stream trước khi dọn fixture, không đụng job có sẵn.
  afterAll(async () => {
    subscription?.unsubscribe();
    if (prisma) {
      await prisma.operationalJob.deleteMany({ where: { id } });
      await prisma.operationalJob.deleteMany({ where: { id: `${id}-source` } });
    }
    await moduleRef?.close();
  });

  it("requires system permission and emits no sensitive job data after committed changes", async () => {
    const handler: unknown = Object.getOwnPropertyDescriptor(SystemController.prototype, "watchOperations")?.value;
    if (typeof handler !== "function") throw new Error("Missing operations SSE handler");
    expect(Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, handler)).toEqual(["system:configure"]);
    await expect(prisma.$transaction(async (tx) => {
      await tx.operationalJob.create({ data: { id, kind: "BACKUP", type: "FULL", status: "PENDING", requestedBy: "fixture" } });
      throw new Error("rollback job");
    })).rejects.toThrow("rollback job");
    const barrier = firstValueFrom(bus.watch().pipe(filter((event) => event.kind === "notification" && event.key === id), timeout(5000)));
    await prisma.$executeRaw`SELECT pg_notify('wind_events', ${JSON.stringify({ kind: "notification", key: id })})`;
    await barrier;
    expect(received).toHaveLength(1);
    await prisma.operationalJob.create({ data: { id, kind: "RESTORE", backupId: `${id}-source`, mode: "DRILL", status: "PENDING", requestedBy: "fixture" } });
    await vi.waitFor(() => expect(received).toHaveLength(2));
    await prisma.operationalJob.update({ where: { id }, data: { status: "RUNNING", progress: 50 } });
    await vi.waitFor(() => expect(received).toHaveLength(3));
    await prisma.operationalJob.update({ where: { id }, data: { status: "COMPLETED", progress: 100, completedAt: new Date() } });
    await vi.waitFor(() => expect(received).toHaveLength(4));
    expect(received).toEqual([{ revision: 1 }, { revision: 2 }, { revision: 3 }, { revision: 4 }]);
    expect(errors).toEqual([]);
  });
});
