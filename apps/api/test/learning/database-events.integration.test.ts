import { Test, type TestingModule } from "@nestjs/testing";
import { ConfigService } from "@nestjs/config";
import { Client } from "pg";
import { firstValueFrom, filter, timeout, type Subscription } from "rxjs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { AppModule } from "../../src/app.module.js";
import { DatabaseEventsService, type DatabaseEvent } from "../../src/database/database-events.service.js";
import { PrismaService } from "../../src/database/prisma.service.js";
import { buildDatabaseUrl } from "../../src/config/database-connection.js";
import type { Environment } from "../../src/config/environment.js";

describe.skipIf(!(process.env.DB_NAME ?? "").endsWith("_test"))("database event listener", () => {
  let moduleRef: TestingModule;
  let first: DatabaseEventsService;
  let second: DatabaseEventsService;
  let prisma: PrismaService;
  let publisher: Client;
  const received: DatabaseEvent[] = [];
  let subscription: Subscription;
  const key = `event-${randomUUID()}`;

  // Khởi tạo hai listener độc lập để mô phỏng hai API process trên cùng DB test.
  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    const config = moduleRef.get<ConfigService<Environment, true>>(ConfigService);
    first = moduleRef.get(DatabaseEventsService);
    second = new DatabaseEventsService(config);
    prisma = moduleRef.get(PrismaService);
    publisher = new Client({ connectionString: buildDatabaseUrl({
      DB_HOST: config.get("DB_HOST", { infer: true }), DB_PORT: config.get("DB_PORT", { infer: true }),
      DB_USER: config.get("DB_USER", { infer: true }), DB_PASSWORD: config.get("DB_PASSWORD", { infer: true }),
      DB_NAME: config.get("DB_NAME", { infer: true }),
    }) });
    await publisher.connect();
    await Promise.all([waitFor(first, "resync"), waitFor(second, "resync")]);
    subscription = first.watch().subscribe((event) => received.push(event));
  });

  // Đóng publisher/listeners và không để retry timer hoặc socket sống sau test.
  afterAll(async () => {
    subscription?.unsubscribe();
    await publisher?.end();
    await second?.onApplicationShutdown();
    await moduleRef?.close();
  });

  // Chờ đúng tín hiệu với deadline để test lỗi rõ ràng thay vì treo.
  function waitFor(bus: DatabaseEventsService, kind: DatabaseEvent["kind"], expectedKey?: string): Promise<DatabaseEvent> {
    return firstValueFrom(bus.watch().pipe(filter((event) => event.kind === kind &&
      (expectedKey === undefined || ("key" in event && event.key === expectedKey))), timeout(5000)));
  }

  it("delivers after commit to both instances and discards rolled-back notifications", async () => {
    await publisher.query("BEGIN");
    await publisher.query("SELECT pg_notify('wind_events',$1)", [JSON.stringify({ kind: "chat", key })]);
    const barrier = waitFor(first, "job", `${key}-barrier`);
    await prisma.$executeRaw`SELECT pg_notify('wind_events', ${JSON.stringify({ kind: "job", key: `${key}-barrier` })})`;
    await barrier;
    expect(received.some((event) => "key" in event && event.key === key)).toBe(false);
    const deliveries = Promise.all([waitFor(first, "chat", key), waitFor(second, "chat", key)]);
    await publisher.query("COMMIT");
    expect(await deliveries).toHaveLength(2);
    await publisher.query("BEGIN");
    await publisher.query("SELECT pg_notify('wind_events',$1)", [JSON.stringify({ kind: "chat", key: `${key}-rollback` })]);
    await publisher.query("ROLLBACK");
    const afterRollback = waitFor(first, "job", `${key}-after`);
    await publisher.query("SELECT pg_notify('wind_events',$1)", [JSON.stringify({ kind: "job", key: `${key}-after` })]);
    await afterRollback;
    expect(received.some((event) => "key" in event && event.key === `${key}-rollback`)).toBe(false);
  });

  it("ignores malformed signals and reconnects with resync after socket loss", async () => {
    const count = received.length;
    for (const payload of ["invalid json", '{"kind":"resync"}', '{"kind":"chat","key":12}']) {
      await publisher.query("SELECT pg_notify('wind_events',$1)", [payload]);
    }
    const barrier = waitFor(first, "job", `${key}-valid`);
    await publisher.query("SELECT pg_notify('wind_events',$1)", [JSON.stringify({ kind: "job", key: `${key}-valid` })]);
    await barrier;
    expect(received.length).toBe(count + 1);
    const resync = waitFor(first, "resync");
    await first["client"]!.end();
    await resync;
    const next = waitFor(first, "chat", `${key}-reconnected`);
    await publisher.query("SELECT pg_notify('wind_events',$1)", [JSON.stringify({ kind: "chat", key: `${key}-reconnected` })]);
    await next;
  });
});
