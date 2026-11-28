import { describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { AiGenerationRequestService } from "../../src/domains/learning/ai/ai-generation-request.service.js";
import type { PrismaService } from "../../src/database/prisma.service.js";
import type { GeneratedExamDraft } from "../../src/domains/system/ai/ai-provider.service.js";
import type { AiGeneratedExamResult } from "../../src/domains/learning/core/learning.types.js";

const prepared = { courseId: "course-1", generated: { model: "test" } as GeneratedExamDraft };
const result = { exam: { id: "exam-1" } } as AiGeneratedExamResult;
/** Trả trạng thái chưa có đề để kiểm tra nhánh tạo mới. */
const noResult = (): Promise<undefined> => Promise.resolve(undefined);

interface MockRequestRow {
  id: string;
  ownerId: string;
  payloadHash: string;
  state: string;
  version: number;
  prepared: unknown;
  result: unknown;
  leaseToken: string | null;
  leaseExpiresAt: Date | null;
}

interface MockBindingRow {
  fingerprint: string;
  ownerId: string;
  payloadHash: string;
  canonicalRequestId: string | null;
  malformed: boolean;
}

/** Mô phỏng unique insert và CAS của hai bảng ai_generation_requests và ai_generation_bindings giữa hai API instance. */
function sharedDatabase(): PrismaService {
  const requests = new Map<string, MockRequestRow>();
  const bindings = new Map<string, MockBindingRow>();
  return {
    isStartupConnectionEnabled: () => true,
    aiGenerationRequest: {
      create: ({ data }: { data: Partial<MockRequestRow> & { id: string; ownerId: string; payloadHash: string } }) => {
        if (requests.has(data.id)) throw Object.assign(new Error("duplicate"), { code: "P2002" });
        requests.set(data.id, {
          id: data.id,
          ownerId: data.ownerId,
          payloadHash: data.payloadHash,
          state: data.state ?? "CLAIMED",
          version: 1,
          prepared: data.prepared ?? null,
          result: data.result ?? null,
          leaseToken: data.leaseToken ?? null,
          leaseExpiresAt: data.leaseExpiresAt ?? null,
        });
        return Promise.resolve({});
      },
      findUnique: ({ where }: { where: { id: string } }) => Promise.resolve(structuredClone(requests.get(where.id) ?? null)),
      updateMany: ({ where, data }: { where: { id: string; version: number }; data: Record<string, unknown> }) => {
        const current = requests.get(where.id);
        if (!current || current.version !== where.version) return Promise.resolve({ count: 0 });
        requests.set(where.id, {
          ...current,
          state: typeof data.state === "string" ? data.state : current.state,
          prepared: "prepared" in data ? (typeof data.prepared === "symbol" ? null : structuredClone(data.prepared)) : current.prepared,
          result: "result" in data ? (typeof data.result === "symbol" ? null : structuredClone(data.result)) : current.result,
          leaseToken: "leaseToken" in data ? (data.leaseToken as string | null) : current.leaseToken,
          leaseExpiresAt: "leaseExpiresAt" in data ? (data.leaseExpiresAt as Date | null) : current.leaseExpiresAt,
          version: current.version + 1,
        });
        return Promise.resolve({ count: 1 });
      },
    },
    aiGenerationBinding: {
      create: ({ data }: { data: Partial<MockBindingRow> & { fingerprint: string; ownerId: string; payloadHash: string } }) => {
        if (bindings.has(data.fingerprint)) throw Object.assign(new Error("duplicate"), { code: "P2002" });
        bindings.set(data.fingerprint, {
          fingerprint: data.fingerprint,
          ownerId: data.ownerId,
          payloadHash: data.payloadHash,
          canonicalRequestId: data.canonicalRequestId ?? null,
          malformed: data.malformed ?? false,
        });
        return Promise.resolve({});
      },
      findUnique: ({ where }: { where: { fingerprint: string } }) => Promise.resolve(structuredClone(bindings.get(where.fingerprint) ?? null)),
    },
  } as unknown as PrismaService;
}

describe("AI generation idempotency", () => {
  it("resumes SAVING only for an explicitly idempotent persistence callback without regenerating", async () => {
    const db = sharedDatabase();
    const generate = vi.fn(() => Promise.resolve(prepared));
    await expect(new AiGenerationRequestService(db).run("saving", "owner", {}, generate, () => Promise.reject(new Error("interrupted save")), noResult)).rejects.toThrow("interrupted save");
    const row = await db.aiGenerationRequest.findUnique({ where: { id: "saving" } });
    await db.aiGenerationRequest.updateMany({ where: { id: "saving", version: row!.version }, data: { state: "SAVING", version: { increment: 1 } } });
    const save = vi.fn(() => Promise.resolve(result));
    await expect(new AiGenerationRequestService(db).run("retry", "owner", {}, generate, save, noResult)).rejects.toMatchObject({ status: 409 });
    expect(save).not.toHaveBeenCalled();
    expect(await new AiGenerationRequestService(db).run("retry", "owner", {}, generate, save, noResult, { idempotentSave: true })).toEqual(result);
    expect(save).toHaveBeenCalledExactlyOnceWith(prepared, "saving");
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it.each([
    { ownerId: "" },
    { payloadHash: "bad" },
    { state: "UNKNOWN" },
    { state: "READY", prepared: null },
    { state: "SAVING", prepared: {} },
    { state: "COMPLETED", result: null },
    { version: 0 },
  ])("rejects damaged persisted request claims before any external callback: %j", async (damage) => {
    const db = sharedDatabase();
    const base = {
      id: "id",
      ownerId: "owner",
      payloadHash: createHash("sha256").update("{}").digest("hex"),
      state: "CLAIMED",
      version: 1,
      prepared: null,
      result: null,
      leaseToken: null,
      leaseExpiresAt: null,
    };
    vi.spyOn(db.aiGenerationRequest, "findUnique").mockResolvedValue({ ...base, ...damage } as never);
    const generate = vi.fn();
    const save = vi.fn();
    const recover = vi.fn();
    await expect(new AiGenerationRequestService(db).run("id", "owner", {}, generate, save, recover)).rejects.toMatchObject({ status: 409 });
    expect(generate).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
    expect(recover).not.toHaveBeenCalled();
  });

  it.each([
    { malformed: true },
    { canonicalRequestId: null },
    { canonicalRequestId: " " },
    { canonicalRequestId: "a".repeat(178) },
  ])("rejects damaged persisted bindings before any external callback: %j", async (damage) => {
    const db = sharedDatabase();
    const base = {
      fingerprint: "fp",
      ownerId: "owner",
      payloadHash: createHash("sha256").update("{}").digest("hex"),
      canonicalRequestId: "id",
      malformed: false,
    };
    vi.spyOn(db.aiGenerationBinding, "findUnique").mockResolvedValue({ ...base, ...damage } as never);
    const generate = vi.fn();
    const save = vi.fn();
    const recover = vi.fn();
    await expect(new AiGenerationRequestService(db).run("id", "owner", {}, generate, save, recover)).rejects.toMatchObject({ status: 409 });
    expect(generate).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
    expect(recover).not.toHaveBeenCalled();
  });

  it.each(["disabled", "missing"])("refuses %s storage before provider, recovery or save", async (mode) => {
    const db = sharedDatabase();
    vi.spyOn(db, "isStartupConnectionEnabled").mockReturnValue(false);
    const create = vi.spyOn(db.aiGenerationRequest, "create");
    const generate = vi.fn();
    const save = vi.fn();
    const recover = vi.fn();
    const storage = mode === "missing" ? undefined as unknown as PrismaService : db;
    for (let index = 0; index < 2; index++) {
      await expect(new AiGenerationRequestService(storage).run(`id-${index}`, "owner", {}, generate, save, recover)).rejects.toMatchObject({ status: 503 });
    }
    expect(create).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
    expect(recover).not.toHaveBeenCalled();
  });

  it("never reclaims legacy GENERATING records without leaseExpiresAt when upgrading the service", async () => {
    const db = sharedDatabase();
    await db.aiGenerationRequest.create({
      data: { id: "legacy", ownerId: "owner", payloadHash: createHash("sha256").update("{}").digest("hex"), state: "GENERATING" },
    });
    const generate = vi.fn();
    await expect(new AiGenerationRequestService(db).run("legacy", "owner", {}, generate, vi.fn(), noResult)).rejects.toMatchObject({ status: 409 });
    expect(generate).not.toHaveBeenCalled();
  });

  it("fails closed when durable claiming is unavailable", async () => {
    const db = sharedDatabase();
    vi.spyOn(db.aiGenerationRequest, "create").mockRejectedValueOnce(new Error("database offline"));
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
    const service = new AiGenerationRequestService(sharedDatabase());
    const generate = vi.fn().mockRejectedValue(new Error("timeout"));
    await expect(service.run("id", "owner", {}, generate, vi.fn(), noResult)).rejects.toThrow("timeout");
    await expect(service.run("id", "owner", {}, generate, vi.fn(), noResult)).rejects.toThrow("chưa có kết quả xác định");
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it("recovers a committed exam after response failure without generating again", async () => {
    const service = new AiGenerationRequestService(sharedDatabase());
    const generate = vi.fn(() => Promise.resolve(prepared));
    await expect(service.run("id", "owner", {}, generate, () => Promise.reject(new Error("lost commit response")), noResult)).rejects.toThrow();
    expect(await service.run("id", "owner", {}, generate, vi.fn(), () => Promise.resolve(result))).toEqual(result);
    expect(generate).toHaveBeenCalledTimes(1);
  });
});
