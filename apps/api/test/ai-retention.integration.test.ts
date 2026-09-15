import { Test, type TestingModule } from "@nestjs/testing";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module.js";
import { PrismaService } from "../src/database/prisma.service.js";
import { SystemService } from "../src/system/system.service.js";

const enabled = (process.env.DB_NAME ?? "").endsWith("_test") && process.env.DATABASE_CONNECT_ON_START === "true";
type RetentionInternals = {
  countRetentionRows(prisma: PrismaService, category: string, cutoffAt: Date): Promise<number>;
  executeRetention(prisma: PrismaService, category: string, action: "ARCHIVE" | "DELETE", cutoffAt: Date, jobId: string, assertOwned?: () => Promise<void>): Promise<{ affectedRows: number }>;
};

describe.skipIf(!enabled)("AI results retention on dedicated PostgreSQL", () => {
  const fixture = randomUUID();
  const keyPrefix = `ai-doc:${fixture}`;
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let service: SystemService;

  /** Khởi tạo module thật để kiểm tra JSON state và delete transaction trên PostgreSQL test riêng. */
  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    prisma = moduleRef.get(PrismaService);
    service = moduleRef.get(SystemService);
  });

  /** Chỉ dọn các system setting mang UUID của fixture hiện tại. */
  afterAll(async () => {
    if (prisma) await prisma.systemSetting.deleteMany({ where: { key: { startsWith: keyPrefix } } });
    await moduleRef?.close();
  });

  it("deletes expired READY and legacy OCR caches while preserving unresolved claims", async () => {
    const old = new Date("2000-01-01T00:00:00.000Z");
    const cutoff = new Date("2000-01-02T00:00:00.000Z");
    const keys = {
      ready: `${keyPrefix}:ready`,
      legacy: `${keyPrefix}:legacy`,
      generating: `${keyPrefix}:generating`,
      uncertain: `${keyPrefix}:uncertain`,
    };
    await prisma.systemSetting.createMany({ data: [
      { key: keys.ready, updatedBy: fixture, value: { state: "READY", pages: [{ page: 1, text: "ready" }] }, updatedAt: old },
      { key: keys.legacy, updatedBy: fixture, value: [{ page: 1, text: "legacy" }], updatedAt: old },
      { key: keys.generating, updatedBy: fixture, value: { state: "GENERATING" }, updatedAt: old },
      { key: keys.uncertain, updatedBy: fixture, value: { state: "UNCERTAIN" }, updatedAt: old },
    ] });
    const internals = service as unknown as RetentionInternals;

    await expect(internals.countRetentionRows(prisma, "AI_RESULTS", cutoff)).resolves.toBe(2);
    const result = await internals.executeRetention(prisma, "AI_RESULTS", "DELETE", cutoff, `retention-${fixture}`);

    expect(result.affectedRows).toBe(2);
    expect(await prisma.systemSetting.findMany({ where: { key: { in: Object.values(keys) } }, select: { key: true } })).toEqual(expect.arrayContaining([{ key: keys.generating }, { key: keys.uncertain }]));
    expect(await prisma.systemSetting.count({ where: { key: { in: [keys.ready, keys.legacy] } } })).toBe(0);
  });

  it("giữ bản ghi được sửa sau khi lấy snapshot retention", async () => {
    const key = `${keyPrefix}:concurrent`;
    await prisma.systemSetting.create({ data: { key, updatedBy: fixture, value: { state: "READY" }, updatedAt: new Date("1999-01-01") } });
    const result = await (service as unknown as RetentionInternals).executeRetention(prisma, "AI_RESULTS", "DELETE", new Date("1999-01-02"), fixture, async () => {
      await prisma.systemSetting.update({ where: { key }, data: { value: { state: "GENERATING" } } });
    });
    expect(result.affectedRows).toBe(0);
    expect(await prisma.systemSetting.findUnique({ where: { key } })).not.toBeNull();
  });
});
