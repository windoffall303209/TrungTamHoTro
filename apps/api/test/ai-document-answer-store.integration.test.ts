import { Test, type TestingModule } from "@nestjs/testing";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { AppModule } from "../src/app.module.js";
import { PrismaService } from "../src/database/prisma.service.js";
import { AiDocumentAnswerStore } from "../src/learning/ai-document-answer-store.js";
import { AiGradingOperationsService } from "../src/learning/ai-grading-operations.js";
import type { AuthenticatedSession } from "../src/auth/auth.service.js";

const enabled = (process.env.DB_NAME ?? "").endsWith("_test") && process.env.DATABASE_CONNECT_ON_START === "true";
describe.skipIf(!enabled)("Durable document answers on MySQL", () => {
  const ownerId = `answer-test-${randomUUID()}`;
  const identity = { ownerId, materialId: "fixture-document", version: 1, question: "What is HTTP?", language: "EN" as const };
  const result = { answer: "Insufficient fixture context.", insufficientContext: true, citations: [], warning: "Fixture", version: 1 };
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  // Load real database services without calling AI providers.
  beforeAll(async () => { moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile(); prisma = moduleRef.get(PrismaService); });
  // Remove only this run's hashed answer records.
  afterAll(async () => { if (prisma) await prisma.systemSetting.deleteMany({ where: { updatedBy: { in: [ownerId, `${ownerId}-other`] }, key: { startsWith: "ai-doc-answer:" } } }); await moduleRef?.close(); });

  it("allows one concurrent generation and replays after process replacement", async () => {
    const reader = new AiDocumentAnswerStore(prisma);
    expect(await reader.status(identity)).toEqual({ state: "NOT_REQUESTED" });
    expect(await prisma.systemSetting.count({ where: { updatedBy: ownerId, key: { startsWith: "ai-doc-answer:" } } })).toBe(0);
    const generate = vi.fn(() => Promise.resolve(result));
    const outcomes = await Promise.allSettled(Array.from({ length: 6 }, () => new AiDocumentAnswerStore(prisma).generate(identity, generate)));
    expect(outcomes.some((outcome) => outcome.status === "fulfilled")).toBe(true);
    for (const outcome of outcomes) if (outcome.status === "rejected") expect(outcome.reason).toMatchObject({ status: 409 });
    expect(await new AiDocumentAnswerStore(prisma).generate({ ...identity, question: ` ${identity.question} ` }, generate)).toEqual(result);
    expect(generate).toHaveBeenCalledTimes(1);
    expect(await reader.status(identity)).toEqual({ state: "READY", result });
    expect(await reader.status({ ...identity, ownerId: `${ownerId}-other` })).toEqual({ state: "NOT_REQUESTED" });
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
    expect(await new AiDocumentAnswerStore(prisma).status(next)).toEqual({ state: "UNCERTAIN" });
  });

  it("reads GENERATING while the provider is pending and does not change the claim", async () => {
    const next = { ...identity, question: "Pending question?" };
    let finish!: () => void;
    let started!: () => void;
    const entered = new Promise<void>((resolve) => { started = resolve; });
    const pending = new AiDocumentAnswerStore(prisma).generate(next, () => { started(); return new Promise((resolve) => { finish = (): void => resolve(result); }); });
    await entered;
    try {
      const before = await prisma.systemSetting.findMany({ where: { updatedBy: ownerId }, orderBy: { key: "asc" } });
      expect(await new AiDocumentAnswerStore(prisma).status(next)).toEqual({ state: "GENERATING" });
      expect(await prisma.systemSetting.findMany({ where: { updatedBy: ownerId }, orderBy: { key: "asc" } })).toEqual(before);
    } finally { finish(); await pending; }
  });

  it("rejects a mismatched source version without caching an answer as ready", async () => {
    const next = { ...identity, question: "Version fixture?" };
    const generate = vi.fn(() => Promise.resolve({ ...result, version: 999 }));
    await expect(new AiDocumentAnswerStore(prisma).generate(next, generate)).rejects.toMatchObject({ status: 409 });
    await expect(new AiDocumentAnswerStore(prisma).generate(next, generate)).rejects.toMatchObject({ status: 409 });
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it("lists private answer metadata with stable keysets and no database mutations", async () => {
    const stamp = new Date("2090-01-01T00:00:00Z");
    const ids = ["a", "b", "c"].map((prefix) => `${prefix}${randomUUID()}`);
    const states = ["GENERATING", "UNCERTAIN", "UNKNOWN"];
    for (const [index, id] of ids.entries()) await prisma.systemSetting.create({ data: {
      key: `ai-doc-answer:${id}`, updatedBy: ownerId, effectiveAt: stamp,
      value: { state: states[index], question: "private question sentinel", result: { answer: "private answer sentinel", citations: ["private citation sentinel"] } },
    } });
    const operations = new AiGradingOperationsService(prisma);
    const admin = { roleCode: "SYSTEM_ADMIN", permissions: ["system:configure"] } as AuthenticatedSession;
    const before = await prisma.systemSetting.findMany({ where: { updatedBy: ownerId }, orderBy: { key: "asc" } });
    const page = await operations.listDocumentAnswers({ limit: 2 }, admin);
    expect(page.items.map((item) => item.id)).toEqual([ids[2], ids[1]]);
    expect(page.items.map((item) => item.state)).toEqual(["UNCERTAIN", "UNCERTAIN"]);
    expect(page.nextCursor).toBe(ids[1]);
    expect(Object.keys(page.items[0]!).sort()).toEqual(["createdAt", "id", "ownerId", "state", "updatedAt", "version"]);
    expect(JSON.stringify(page)).not.toContain("sentinel");
    const next = await operations.listDocumentAnswers({ limit: 1, cursor: page.nextCursor! }, admin);
    expect(next.items[0]?.id).toBe(ids[0]);
    const ready = await operations.listDocumentAnswers({ limit: 50, state: "READY" }, admin);
    expect(ready.items.every((item) => item.state === "READY")).toBe(true);
    await expect(operations.listDocumentAnswers({ limit: 2, cursor: "missing-cursor" }, admin)).rejects.toMatchObject({ status: 400 });
    expect(await prisma.systemSetting.findMany({ where: { updatedBy: ownerId }, orderBy: { key: "asc" } })).toEqual(before);
  });
});

it("does not call AI when durable answer storage is unavailable", async () => {
  const generate = vi.fn();
  await expect(new AiDocumentAnswerStore().generate({ ownerId: "owner", materialId: "file", version: 1, question: "Why?", language: "VI" }, generate)).rejects.toMatchObject({ status: 503 });
  expect(generate).not.toHaveBeenCalled();
});
