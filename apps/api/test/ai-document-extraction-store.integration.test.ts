import { Test, type TestingModule } from "@nestjs/testing";
import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { AppModule } from "../src/app.module.js";
import { PrismaService } from "../src/database/prisma.service.js";
import { AiDocumentExtractionStore } from "../src/learning/ai-document-extraction-store.js";

const enabled = (process.env.DB_NAME ?? "").endsWith("_test") && process.env.DATABASE_CONNECT_ON_START === "true";
describe.skipIf(!enabled)("Durable extraction on MySQL", () => {
  const ownerId = `extraction-test-${randomUUID()}`;
  const keys = ["race", "uncertain", "legacy"].map((name) => `ai-doc:${createHash("sha256").update(`${ownerId}:${name}`).digest("hex")}`);
  const pages = [{ page: 1, text: "Synthetic OCR result; no real provider invoked." }];
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  // Load the real database service; provider work remains mocked.
  beforeAll(async () => { moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile(); prisma = moduleRef.get(PrismaService); });
  // Delete only this run's exact fixture keys, never production caches.
  afterAll(async () => { if (prisma) await prisma.systemSetting.deleteMany({ where: { updatedBy: ownerId, key: { in: keys } } }); await moduleRef?.close(); });

  it("allows one OCR invocation among six workers and replays after service replacement", async () => {
    expect(await new AiDocumentExtractionStore(prisma).status(keys[0]!)).toEqual({ state: "NOT_REQUESTED" });
    const extract = vi.fn(() => Promise.resolve(pages));
    const outcomes = await Promise.allSettled(Array.from({ length: 6 }, () => new AiDocumentExtractionStore(prisma).generate(keys[0]!, ownerId, extract)));
    expect(outcomes.some((outcome) => outcome.status === "fulfilled")).toBe(true);
    for (const outcome of outcomes) if (outcome.status === "rejected") expect(outcome.reason).toMatchObject({ status: 409 });
    expect(await new AiDocumentExtractionStore(prisma).generate(keys[0]!, ownerId, extract)).toEqual({ pages, cached: true });
    expect(extract).toHaveBeenCalledTimes(1);
    expect(await prisma.systemSetting.count({ where: { key: keys[0] } })).toBe(1);
    const before = await prisma.systemSetting.findUnique({ where: { key: keys[0] } });
    expect(await new AiDocumentExtractionStore(prisma).status(keys[0]!)).toEqual({ state: "READY", pages });
    expect(await prisma.systemSetting.findUnique({ where: { key: keys[0] } })).toEqual(before);
  });

  it("persists uncertain state and refuses to retry after replacement", async () => {
    const extract = vi.fn().mockRejectedValue(new Error("response lost"));
    await expect(new AiDocumentExtractionStore(prisma).generate(keys[1]!, ownerId, extract)).rejects.toThrow("response lost");
    await expect(new AiDocumentExtractionStore(prisma).generate(keys[1]!, ownerId, extract)).rejects.toMatchObject({ status: 409 });
    expect((await prisma.systemSetting.findUnique({ where: { key: keys[1] } }))?.value).toEqual({ state: "UNCERTAIN" });
    expect(extract).toHaveBeenCalledTimes(1);
    expect(await new AiDocumentExtractionStore(prisma).status(keys[1]!)).toEqual({ state: "UNCERTAIN" });
  });

  it("replays pre-claim array caches without modifying the original record", async () => {
    await prisma.systemSetting.create({ data: { key: keys[2]!, updatedBy: ownerId, value: pages } });
    const before = await prisma.systemSetting.findUnique({ where: { key: keys[2] } });
    const extract = vi.fn();
    expect(await new AiDocumentExtractionStore(prisma).status(keys[2]!)).toEqual({ state: "READY", pages });
    expect(await new AiDocumentExtractionStore(prisma).generate(keys[2]!, ownerId, extract)).toEqual({ pages, cached: true });
    expect(await prisma.systemSetting.findUnique({ where: { key: keys[2] } })).toEqual(before);
    expect(extract).not.toHaveBeenCalled();
  });
});
