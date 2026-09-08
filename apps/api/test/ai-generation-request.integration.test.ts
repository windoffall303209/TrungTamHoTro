import { Test, type TestingModule } from "@nestjs/testing";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { AppModule } from "../src/app.module.js";
import { PrismaService } from "../src/database/prisma.service.js";
import { AiGenerationRequestService } from "../src/learning/ai-generation-request.service.js";
import { AiGradingOperationsService } from "../src/learning/ai-grading-operations.js";
import type { AuthenticatedSession } from "../src/auth/auth.service.js";
import type { GeneratedExamDraft } from "../src/system/ai-provider.service.js";
import type { AiGeneratedExamResult } from "../src/learning/learning.types.js";

const enabled = (process.env.DB_NAME ?? "").endsWith("_test") && process.env.DATABASE_CONNECT_ON_START === "true";
const prepared = { courseId: "fixture-course", generated: { model: "mock" } as GeneratedExamDraft };
const result = { exam: { id: "fixture-exam" } } as AiGeneratedExamResult;
// Mô phỏng chưa có đề đã lưu; không gọi AI hoặc tạo đề thật.
const noResult = (): Promise<undefined> => Promise.resolve(undefined);

describe.skipIf(!enabled)("Exam generation claims on dedicated MySQL test database", () => {
  const owner = `ai-dedupe-test-${randomUUID()}`;
  let moduleRef: TestingModule;
  let prisma: PrismaService;

  // Dùng database test có sẵn, không reset hoặc thay đổi cấu hình provider.
  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    prisma = moduleRef.get(PrismaService);
  });

  // Chỉ dọn các claim do định danh fixture độc lập của lượt test này tạo.
  afterAll(async () => {
    if (prisma) await prisma.systemSetting.deleteMany({ where: { updatedBy: owner, key: { startsWith: "ai-generation" } } });
    if (moduleRef) await moduleRef.close();
  });

  it("resumes before-provider failures across eight workers and replays after restart", async () => {
    const original = randomUUID();
    const payload = { topic: "concurrent resume" };
    const generate = vi.fn(() => Promise.resolve(prepared));
    const save = vi.fn(() => Promise.resolve(result));
    await expect(new AiGenerationRequestService(prisma).run(original, owner, payload, generate, save, () => Promise.reject(new Error("lookup offline")))).rejects.toThrow("lookup offline");
    expect(generate).not.toHaveBeenCalled();
    const outcomes = await Promise.allSettled(Array.from({ length: 8 }, () =>
      new AiGenerationRequestService(prisma).run(randomUUID(), owner, payload, generate, save, noResult),
    ));
    expect(outcomes.some((outcome) => outcome.status === "fulfilled")).toBe(true);
    for (const outcome of outcomes) {
      if (outcome.status === "rejected") expect(outcome.reason).toMatchObject({ status: 409 });
      else expect(outcome.value).toEqual(result);
    }
    expect(await new AiGenerationRequestService(prisma).run(randomUUID(), owner, payload, generate, save, noResult)).toEqual(result);
    expect(generate).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledExactlyOnceWith(prepared, original);
    const stored = await prisma.systemSetting.findUniqueOrThrow({ where: { key: `ai-generation:${original}` } });
    expect(stored.value).toMatchObject({ state: "COMPLETED", result });
  });

  it("keeps uncertain outcomes blocked even with new request IDs after restart", async () => {
    const payload = { topic: "uncertain call" };
    const generate = vi.fn().mockRejectedValue(new Error("provider response lost"));
    const save = vi.fn();
    await expect(new AiGenerationRequestService(prisma).run(randomUUID(), owner, payload, generate, save, noResult)).rejects.toThrow("provider response lost");
    await expect(new AiGenerationRequestService(prisma).run(randomUUID(), owner, payload, generate, save, noResult)).rejects.toMatchObject({ status: 409 });
    expect(generate).toHaveBeenCalledTimes(1);
    expect(save).not.toHaveBeenCalled();
  });

  it("lists canonical operations only and projects metadata instead of private JSON", async () => {
    const prefix = randomUUID();
    const ids = [`${prefix}-a`, `${prefix}-b`];
    const generate = vi.fn().mockRejectedValue(new Error("uncertain"));
    for (const id of ids) {
      await expect(new AiGenerationRequestService(prisma).run(id, owner, { topic: id }, generate, vi.fn(), noResult)).rejects.toThrow("uncertain");
      await expect(new AiGenerationRequestService(prisma).run(`${id}-alias`, owner, { topic: id }, generate, vi.fn(), noResult)).rejects.toMatchObject({ status: 409 });
    }
    await prisma.systemSetting.updateMany({ where: { updatedBy: owner, key: { in: ids.map((id) => `ai-generation:${id}`) } }, data: { effectiveAt: new Date("2099-09-08T00:00:00Z") } });
    const operations = new AiGradingOperationsService(prisma);
    const session = { roleCode: "SYSTEM_ADMIN", permissions: ["system:configure"], user: { id: owner } } as AuthenticatedSession;
    const first = await operations.listExams({ limit: 1, state: "UNCERTAIN" }, session);
    expect(first.items.map((item) => item.id)).toEqual([ids[1]]);
    expect(Object.keys(first.items[0]!).sort()).toEqual(["id", "ownerId", "state", "version", "createdAt", "updatedAt"].sort());
    const key = `ai-generation:${ids[1]!}`;
    const stored = await prisma.systemSetting.findUniqueOrThrow({ where: { key } });
    await prisma.systemSetting.update({ where: { key }, data: { value: { ...(stored.value as object), state: "COMPLETED", result: { secret: "private exam answer" } } } });
    const second = await operations.listExams({ limit: 1, state: "UNCERTAIN", cursor: first.nextCursor! }, session);
    expect(second.items.map((item) => item.id)).toEqual([ids[0]]);
    const complete = await operations.listExams({ limit: 1, state: "COMPLETED" }, session);
    expect(complete.items.map((item) => item.id)).toEqual([ids[1]]);
    expect(JSON.stringify(complete)).not.toContain("private exam answer");
    await expect(operations.listExams({ limit: 1, cursor: `${ids[0]!}-alias` }, session)).rejects.toMatchObject({ status: 400 });
    await expect(operations.listExams({ limit: 1, cursor: "' OR 1=1 --" }, session)).rejects.toMatchObject({ status: 400 });
    expect(generate).toHaveBeenCalledTimes(2);
  });
});
