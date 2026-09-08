import { describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
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
  it("never reclaims legacy GENERATING records when upgrading the service", async () => {
    const db = sharedDatabase();
    await db.systemSetting.create({ data: { key: "ai-generation:legacy", updatedBy: "owner", value: { owner: "owner", hash: createHash("sha256").update("{}").digest("hex"), state: "GENERATING" } } });
    const generate = vi.fn();
    await expect(new AiGenerationRequestService(db).run("legacy", "owner", {}, generate, vi.fn(), noResult)).rejects.toMatchObject({ status: 409 });
    expect(generate).not.toHaveBeenCalled();
  });

  it("fails closed when durable claiming is unavailable", async () => {
    const db = sharedDatabase();
    vi.spyOn(db.systemSetting, "create").mockRejectedValueOnce(new Error("database offline"));
    const generate = vi.fn();
    await expect(new AiGenerationRequestService(db).run("id", "owner", {}, generate, vi.fn(), noResult)).rejects.toThrow("database offline");
    expect(generate).not.toHaveBeenCalled();
  });

  it("resumes a pre-provider lookup failure after restart without stranding the claim", async () => {
    const db = sharedDatabase();
    const generate = vi.fn(() => Promise.resolve(prepared));
    const save = vi.fn(() => Promise.resolve(result));
    const recover = vi.fn().mockRejectedValueOnce(new Error("lookup offline")).mockResolvedValue(undefined);
    await expect(new AiGenerationRequestService(db).run("original", "owner", {}, generate, save, recover)).rejects.toThrow("lookup offline");
    expect(generate).not.toHaveBeenCalled();
    expect(await new AiGenerationRequestService(db).run("retry", "owner", {}, generate, save, recover)).toEqual(result);
    expect(generate).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledExactlyOnceWith(prepared, "original");
  });

  it("lets only one worker resume the same pre-provider claim", async () => {
    const db = sharedDatabase();
    const generate = vi.fn(() => Promise.resolve(prepared));
    const save = vi.fn(() => Promise.resolve(result));
    await expect(new AiGenerationRequestService(db).run("original", "owner", {}, generate, save, () => Promise.reject(new Error("lookup offline")))).rejects.toThrow();
    const outcomes = await Promise.allSettled(Array.from({ length: 8 }, (_, index) =>
      new AiGenerationRequestService(db).run(`resume-${index}`, "owner", {}, generate, save, noResult),
    ));
    expect(outcomes.some((outcome) => outcome.status === "fulfilled")).toBe(true);
    for (const outcome of outcomes) {
      if (outcome.status === "rejected") expect(outcome.reason).toMatchObject({ status: 409 });
      else expect(outcome.value).toEqual(result);
    }
    expect(generate).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledExactlyOnceWith(prepared, "original");
  });

  it("coalesces different request IDs across workers and uses the original ID for persistence", async () => {
    const db = sharedDatabase();
    const first = new AiGenerationRequestService(db);
    const second = new AiGenerationRequestService(db);
    let release!: (value: typeof prepared) => void;
    let started!: () => void;
    const entered = new Promise<void>((resolve) => { started = resolve; });
    const generate = vi.fn(() => { started(); return new Promise<typeof prepared>((resolve) => { release = resolve; }); });
    const save = vi.fn(() => Promise.resolve(result));
    const pending = first.run("original", "owner", { a: 1, b: 2 }, generate, save, noResult);
    await entered;
    await expect(second.run("other-device", "owner", { b: 2, a: 1 }, generate, save, noResult)).rejects.toMatchObject({ status: 409 });
    release(prepared);
    await pending;
    expect(await second.run("third-id", "owner", { a: 1, b: 2 }, generate, save, noResult)).toEqual(result);
    expect(generate).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledExactlyOnceWith(prepared, "original");
    await expect(second.run("other-device", "owner", { a: 99 }, generate, save, noResult)).rejects.toMatchObject({ status: 409 });
  });

  it("does not bypass an uncertain provider outcome with a new request ID", async () => {
    const db = sharedDatabase();
    const generate = vi.fn().mockRejectedValue(new Error("timeout"));
    await expect(new AiGenerationRequestService(db).run("first", "owner", {}, generate, vi.fn(), noResult)).rejects.toThrow("timeout");
    await expect(new AiGenerationRequestService(db).run("new-id", "owner", {}, generate, vi.fn(), noResult)).rejects.toThrow("chưa có kết quả xác định");
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it("retries a cached draft and recovers commits by the original request ID", async () => {
    const db = sharedDatabase();
    const generate = vi.fn(() => Promise.resolve(prepared));
    const save = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(result);
    await expect(new AiGenerationRequestService(db).run("original", "owner", {}, generate, save, noResult)).rejects.toThrow("offline");
    const recover = vi.fn(noResult);
    expect(await new AiGenerationRequestService(db).run("retry", "owner", {}, generate, save, recover)).toEqual(result);
    expect(recover).toHaveBeenCalledWith("original");
    expect(save).toHaveBeenLastCalledWith(prepared, "original");
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it("isolates users and allows genuinely different content", async () => {
    const db = sharedDatabase();
    const generate = vi.fn(() => Promise.resolve(prepared));
    const save = vi.fn(() => Promise.resolve(result));
    for (const [id, owner, payload] of [["1", "one", { a: 1 }], ["2", "two", { a: 1 }], ["3", "one", { a: 2 }]] as const) {
      await new AiGenerationRequestService(db).run(id, owner, payload, generate, save, noResult);
    }
    expect(generate).toHaveBeenCalledTimes(3);
  });

  it("claims a single content binding when different IDs arrive simultaneously", async () => {
    const db = sharedDatabase();
    const generate = vi.fn(() => Promise.resolve(prepared));
    const save = vi.fn(() => Promise.resolve(result));
    const outcomes = await Promise.allSettled(Array.from({ length: 12 }, (_, index) =>
      new AiGenerationRequestService(db).run(`parallel-${index}`, "owner", { topic: "same" }, generate, save, noResult),
    ));
    expect(outcomes.some((outcome) => outcome.status === "fulfilled")).toBe(true);
    for (const outcome of outcomes) {
      if (outcome.status === "fulfilled") expect(outcome.value).toEqual(result);
      else expect(outcome.reason).toMatchObject({ status: 409 });
    }
    expect(generate).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("recovers a committed exam through a new ID after the save response was lost", async () => {
    const db = sharedDatabase();
    const generate = vi.fn(() => Promise.resolve(prepared));
    await expect(new AiGenerationRequestService(db).run("original", "owner", {}, generate, () => Promise.reject(new Error("response lost")), noResult)).rejects.toThrow("response lost");
    const recover = vi.fn((requestId: string) => Promise.resolve(requestId === "original" ? result : undefined));
    const save = vi.fn();
    expect(await new AiGenerationRequestService(db).run("retry-new-id", "owner", {}, generate, save, recover)).toEqual(result);
    expect(save).not.toHaveBeenCalled();
    expect(generate).toHaveBeenCalledTimes(1);
    expect(recover).toHaveBeenCalledExactlyOnceWith("original");
  });

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
