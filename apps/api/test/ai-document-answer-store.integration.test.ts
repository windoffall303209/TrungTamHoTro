import { Test, type TestingModule } from "@nestjs/testing";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { AppModule } from "../src/app.module.js";
import { PrismaService } from "../src/database/prisma.service.js";
import { AiDocumentAnswerStore } from "../src/learning/ai-document-answer-store.js";

const enabled = (process.env.DB_NAME ?? "").endsWith("_test") && process.env.DATABASE_CONNECT_ON_START === "true";
describe.skipIf(!enabled)("Durable document answers on MySQL", () => {
  const ownerId = `answer-test-${randomUUID()}`;
  const identity = { ownerId, materialId: "fixture-document", version: 1, question: "What is HTTP?", language: "EN" as const };
  const result = { answer: "An application protocol.", insufficientContext: false, citations: [], warning: "Fixture", version: 1 };
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  // Load real database services without calling AI providers.
  beforeAll(async () => { moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile(); prisma = moduleRef.get(PrismaService); });
  // Remove only this run's hashed answer records.
  afterAll(async () => { if (prisma) await prisma.systemSetting.deleteMany({ where: { updatedBy: { in: [ownerId, `${ownerId}-other`] }, key: { startsWith: "ai-doc-answer:" } } }); await moduleRef?.close(); });

  it("allows one concurrent generation and replays after process replacement", async () => {
    const generate = vi.fn(() => Promise.resolve(result));
    const outcomes = await Promise.allSettled(Array.from({ length: 6 }, () => new AiDocumentAnswerStore(prisma).generate(identity, generate)));
    expect(outcomes.some((outcome) => outcome.status === "fulfilled")).toBe(true);
    for (const outcome of outcomes) if (outcome.status === "rejected") expect(outcome.reason).toMatchObject({ status: 409 });
    expect(await new AiDocumentAnswerStore(prisma).generate({ ...identity, question: ` ${identity.question} ` }, generate)).toEqual(result);
    expect(generate).toHaveBeenCalledTimes(1);
    const rows = await prisma.systemSetting.findMany({ where: { updatedBy: ownerId, key: { startsWith: "ai-doc-answer:" } } });
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows)).not.toContain(identity.question);
  });

  it("isolates owners, versions, languages and questions", async () => {
    for (const change of [{ ownerId: `${ownerId}-other` }, { version: 2 }, { language: "VI" as const }, { question: "What is HTTPS?" }]) {
      const next = { ...identity, ...change };
      const generate = vi.fn(() => Promise.resolve({ ...result, version: next.version }));
      await new AiDocumentAnswerStore(prisma).generate(next, generate);
      expect(generate).toHaveBeenCalledTimes(1);
    }
  });

  it("keeps lost responses blocked after restart", async () => {
    const next = { ...identity, question: "Uncertain fixture?" };
    const generate = vi.fn().mockRejectedValue(new Error("response lost"));
    await expect(new AiDocumentAnswerStore(prisma).generate(next, generate)).rejects.toThrow("response lost");
    await expect(new AiDocumentAnswerStore(prisma).generate(next, generate)).rejects.toMatchObject({ status: 409 });
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it("rejects a mismatched source version without caching an answer as ready", async () => {
    const next = { ...identity, question: "Version fixture?" };
    const generate = vi.fn(() => Promise.resolve({ ...result, version: 999 }));
    await expect(new AiDocumentAnswerStore(prisma).generate(next, generate)).rejects.toMatchObject({ status: 409 });
    await expect(new AiDocumentAnswerStore(prisma).generate(next, generate)).rejects.toMatchObject({ status: 409 });
    expect(generate).toHaveBeenCalledTimes(1);
  });
});

it("does not call AI when durable answer storage is unavailable", async () => {
  const generate = vi.fn();
  await expect(new AiDocumentAnswerStore().generate({ ownerId: "owner", materialId: "file", version: 1, question: "Why?", language: "VI" }, generate)).rejects.toMatchObject({ status: 503 });
  expect(generate).not.toHaveBeenCalled();
});
