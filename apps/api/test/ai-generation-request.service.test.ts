import { describe, expect, it, vi } from "vitest";
import { AiGenerationRequestService } from "../src/learning/ai-generation-request.service.js";
import type { PrismaService } from "../src/database/prisma.service.js";
import type { GeneratedExamDraft } from "../src/system/ai-provider.service.js";
import type { AiGeneratedExamResult } from "../src/learning/learning.types.js";

const prepared = { courseId: "course-1", generated: { model: "test" } as GeneratedExamDraft };
const result = { exam: { id: "exam-1" } } as AiGeneratedExamResult;
/** Trả trạng thái chưa có đề để kiểm tra nhánh tạo mới. */
const noResult = (): Promise<undefined> => Promise.resolve(undefined);

/** Mô phỏng unique insert và CAS của storage dùng chung giữa hai API instance. */
function sharedDatabase(): PrismaService {
  const rows = new Map<string, { version: number; value: object }>();
  return {
    isStartupConnectionEnabled: () => true,
    systemSetting: {
      create: ({ data }: { data: { key: string; value: object } }) => { if (rows.has(data.key)) throw Object.assign(new Error("duplicate"), { code: "P2002" }); rows.set(data.key, { version: 1, value: structuredClone(data.value) }); return Promise.resolve(); },
      findUnique: ({ where }: { where: { key: string } }) => Promise.resolve(structuredClone(rows.get(where.key) ?? null)),
      updateMany: ({ where, data }: { where: { key: string; version: number }; data: { value: object } }) => { if (rows.get(where.key)?.version !== where.version) return Promise.resolve({ count: 0 }); rows.set(where.key, { version: where.version + 1, value: structuredClone(data.value) }); return Promise.resolve({ count: 1 }); },
    },
  } as unknown as PrismaService;
}

describe("AI generation idempotency", () => {
  it("allows only one provider call across API instances and replays the completed result", async () => {
    const db = sharedDatabase();
    const first = new AiGenerationRequestService(db);
    const second = new AiGenerationRequestService(db);
    let release!: (value: typeof prepared) => void;
    let started!: () => void;
    const entered = new Promise<void>((resolve) => { started = resolve; });
    const generate = vi.fn(() => { started(); return new Promise<typeof prepared>((resolve) => { release = resolve; }); });
    const save = vi.fn(() => Promise.resolve(result));
    const pending = first.run("id", "owner", { a: 1, b: 2 }, generate, save, noResult);
    await entered;
    await expect(second.run("id", "owner", { b: 2, a: 1 }, generate, save, noResult)).rejects.toMatchObject({ status: 409 });
    release(prepared);
    expect(await pending).toEqual(result);
    expect(await second.run("id", "owner", { a: 1, b: 2 }, generate, save, noResult)).toEqual(result);
    expect(generate).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledTimes(1);
    await expect(second.run("id", "another-owner", { a: 1, b: 2 }, generate, save, noResult)).rejects.toMatchObject({ status: 409 });
    await expect(second.run("id", "owner", { a: 3 }, generate, save, noResult)).rejects.toMatchObject({ status: 409 });
  });

  it("retries database persistence without regenerating questions after process replacement", async () => {
    const db = sharedDatabase();
    const generate = vi.fn(() => Promise.resolve(prepared));
    const save = vi.fn().mockRejectedValueOnce(new Error("database offline")).mockResolvedValueOnce(result);
    await expect(new AiGenerationRequestService(db).run("id", "owner", {}, generate, save, noResult)).rejects.toThrow("offline");
    expect(await new AiGenerationRequestService(db).run("id", "owner", {}, generate, save, noResult)).toEqual(result);
    expect(generate).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledTimes(2);
  });

  it("never automatically repeats an uncertain upstream call", async () => {
    const service = new AiGenerationRequestService();
    const generate = vi.fn().mockRejectedValue(new Error("timeout"));
    await expect(service.run("id", "owner", {}, generate, vi.fn(), noResult)).rejects.toThrow("timeout");
    await expect(service.run("id", "owner", {}, generate, vi.fn(), noResult)).rejects.toThrow("chưa có kết quả xác định");
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it("recovers a committed exam after response failure without generating again", async () => {
    const service = new AiGenerationRequestService();
    const generate = vi.fn(() => Promise.resolve(prepared));
    await expect(service.run("id", "owner", {}, generate, () => Promise.reject(new Error("lost commit response")), noResult)).rejects.toThrow();
    expect(await service.run("id", "owner", {}, generate, vi.fn(), () => Promise.resolve(result))).toEqual(result);
    expect(generate).toHaveBeenCalledTimes(1);
  });
});
