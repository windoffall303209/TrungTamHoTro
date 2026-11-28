import { Test, type TestingModule } from "@nestjs/testing";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../../src/app.module.js";
import { PrismaService } from "../../src/database/prisma.service.js";
import type { EmailDeliveryService } from "../../src/infrastructure/email-delivery.service.js";
import { OutboxDeliveryService } from "../../src/infrastructure/outbox-delivery.service.js";

const enabled = (process.env.DB_NAME ?? "").endsWith("_test");
const suite = describe.skipIf(!enabled);

suite("E05 Outbox batch claim (FOR UPDATE SKIP LOCKED) & bounded concurrency on PostgreSQL", () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  const suffix = randomUUID().slice(0, 8);
  const createdIds: string[] = [];
  let recipientId = "";

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    prisma = moduleRef.get(PrismaService);

    // Tận dụng một tài khoản ACTIVE có email thật trong DB kiểm thử.
    const existing = await prisma.user.findFirst({
      where: { status: "ACTIVE", email: { not: null } },
      select: { id: true },
    });
    if (!existing) throw new Error("Không tìm thấy tài khoản ACTIVE có email trong DB kiểm thử.");
    recipientId = existing.id;
  });

  afterAll(async () => {
    if (prisma && createdIds.length) {
      await prisma.outboxDelivery.deleteMany({ where: { id: { in: createdIds } } });
    }
    if (moduleRef) await moduleRef.close();
  });

  it("4 worker đồng thời claim theo lô SKIP LOCKED không gửi trùng bất kỳ email nào, giữ giới hạn concurrency và dead-letter ca quá hạn", async () => {
    const now = new Date();
    const past = new Date(now.getTime() - 60_000);
    // Đặt availableAt ở mốc quá khứ cố định để ORDER BY available_at ASC luôn ưu tiên 22 bản ghi của ca kiểm thử này trước dữ liệu tồn dư trong DB test.
    const priorityAvailableAt = new Date("2000-01-01T00:00:00.000Z");
    const old24h = new Date(now.getTime() - 24 * 60 * 60_000);

    // 18 bản ghi PENDING hợp lệ + 2 bản ghi PROCESSING quá hạn lease + 1 bản ghi attempts=8 + 1 bản ghi quá 23h idempotency.
    const keyPrefix = `e05-dedup-${suffix}-`;
    const eligibleKeys: string[] = [];
    const rows = [
      ...Array.from({ length: 18 }, (_, idx) => {
        const id = `e05-pending-${suffix}-${idx}`;
        const dedupKey = `${keyPrefix}pending-${idx}`;
        createdIds.push(id);
        eligibleKeys.push(dedupKey);
        return {
          id,
          eventType: "SYSTEM_ALERT_EMAIL",
          aggregateType: "CLASS",
          aggregateId: `cls-${suffix}`,
          payload: { title: `Thông báo E05 #${idx}` },
          recipientId,
          channel: "EMAIL",
          dedupKey,
          status: "PENDING",
          attempts: 0,
          availableAt: priorityAvailableAt,
          createdAt: past,
        };
      }),
      ...Array.from({ length: 2 }, (_, idx) => {
        const id = `e05-stale-${suffix}-${idx}`;
        const dedupKey = `${keyPrefix}stale-${idx}`;
        createdIds.push(id);
        eligibleKeys.push(dedupKey);
        return {
          id,
          eventType: "SYSTEM_ALERT_EMAIL",
          aggregateType: "CLASS",
          aggregateId: `cls-${suffix}`,
          payload: { title: `Thu hồi lease E05 #${idx}` },
          recipientId,
          channel: "EMAIL",
          dedupKey,
          status: "PROCESSING",
          attempts: 1,
          availableAt: priorityAvailableAt,
          createdAt: past,
        };
      }),
      {
        id: `e05-exhausted-${suffix}`,
        eventType: "SYSTEM_ALERT_EMAIL",
        aggregateType: "CLASS",
        aggregateId: `cls-${suffix}`,
        payload: { title: "Đã cạn lượt thử" },
        recipientId,
        channel: "EMAIL",
        dedupKey: `${keyPrefix}exhausted`,
        status: "FAILED",
        attempts: 8,
        availableAt: priorityAvailableAt,
        createdAt: past,
      },
      {
        id: `e05-expired-window-${suffix}`,
        eventType: "SYSTEM_ALERT_EMAIL",
        aggregateType: "CLASS",
        aggregateId: `cls-${suffix}`,
        payload: { title: "Quá cửa sổ idempotency 23 giờ" },
        recipientId,
        channel: "EMAIL",
        dedupKey: `${keyPrefix}expired`,
        status: "FAILED",
        attempts: 1,
        availableAt: priorityAvailableAt,
        createdAt: old24h,
      },
    ];
    createdIds.push(`e05-exhausted-${suffix}`, `e05-expired-window-${suffix}`);
    await prisma.outboxDelivery.createMany({ data: rows });

    const sentKeys: string[] = [];
    let inflight = 0;
    let peakInflight = 0;
    const emailStub = {
      isConfigured: (): boolean => true,
      send: async (input: { idempotencyKey: string }): Promise<{ providerMessageId: string }> => {
        inflight += 1;
        if (inflight > peakInflight) peakInflight = inflight;
        sentKeys.push(input.idempotencyKey);
        // Trễ ngắn để ép 4 worker thực sự cạnh tranh song song trên PostgreSQL SKIP LOCKED.
        await new Promise((resolve) => setTimeout(resolve, 25));
        inflight -= 1;
        return { providerMessageId: `msg-${input.idempotencyKey}` };
      },
    } as unknown as EmailDeliveryService;

    // 4 worker độc lập cùng drain lô 5 bản ghi (= đúng 20 bản ghi hợp lệ) với bounded concurrency = 3 mỗi worker (tổng tối đa <= 12).
    const workers = Array.from({ length: 4 }, () => new OutboxDeliveryService(prisma, emailStub));
    const round1 = await Promise.all(workers.map((worker) => worker.drain(5, 3)));
    const totalDelivered = round1.reduce((sum, r) => sum + r.delivered, 0);
    const testSentKeys = sentKeys.filter((key) => key.startsWith(keyPrefix));

    // Đúng 20 bản ghi hợp lệ của ca kiểm thử được gửi chính xác 1 lần, 0 trùng lặp trên toàn bộ lượt gửi, 2 bản ghi quá hạn vào DEAD_LETTER.
    expect(totalDelivered).toBe(20);
    expect(new Set(sentKeys).size).toBe(sentKeys.length);
    expect(testSentKeys).toHaveLength(20);
    expect(new Set(testSentKeys).size).toBe(20);
    expect([...testSentKeys].sort()).toEqual([...eligibleKeys].sort());
    expect(peakInflight).toBeGreaterThan(1);
    expect(peakInflight).toBeLessThanOrEqual(12);

    const dbStates = await prisma.outboxDelivery.findMany({
      where: { id: { in: createdIds } },
      select: { id: true, status: true, attempts: true },
    });
    const byId = new Map(dbStates.map((r) => [r.id, r]));
    expect(byId.get(`e05-exhausted-${suffix}`)?.status).toBe("DEAD_LETTER");
    expect(byId.get(`e05-expired-window-${suffix}`)?.status).toBe("DEAD_LETTER");
    expect(byId.get(`e05-stale-${suffix}-0`)).toMatchObject({ status: "DELIVERED", attempts: 2 });
    expect(byId.get(`e05-stale-${suffix}-1`)).toMatchObject({ status: "DELIVERED", attempts: 2 });
    for (let idx = 0; idx < 18; idx += 1) {
      expect(byId.get(`e05-pending-${suffix}-${idx}`)).toMatchObject({ status: "DELIVERED", attempts: 1 });
    }
  });
});
