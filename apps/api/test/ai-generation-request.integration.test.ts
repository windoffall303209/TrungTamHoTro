import { Test, type TestingModule } from "@nestjs/testing";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { AppModule } from "../src/app.module.js";
import { PrismaService } from "../src/database/prisma.service.js";
import { AiGenerationRequestService } from "../src/learning/ai-generation-request.service.js";
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
});
