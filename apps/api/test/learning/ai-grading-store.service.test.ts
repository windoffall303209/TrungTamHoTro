import { describe, expect, it, vi } from "vitest";
import { AiGradingStoreService, type SavedGradingSuggestion } from "../../src/domains/learning/ai/ai-grading-store.service.js";
import type { PrismaService } from "../../src/database/prisma.service.js";
import { testGradingStore as testStore } from "./ai-grading-store.fixture.js";

const identity = { ownerId: "teacher", submissionId: "submission", contextHash: "a".repeat(64), language: "VI" as const };
const result: SavedGradingSuggestion = { insufficientEvidence: true, feedback: "Review required", criteria: [], suggestedTotal: null, requiresHumanReview: true, model: "configured", submissionRevision: 1, assignmentVersion: 1, contextHash: identity.contextHash };

describe("AI grading durable claim", () => {
  it.each([undefined, { isStartupConnectionEnabled: (): boolean => false }])("refuses generation and status without durable storage", async (prisma) => {
    const store = new AiGradingStoreService(prisma as PrismaService | undefined);
    const generate = vi.fn();
    await expect(store.generate(identity, generate)).rejects.toMatchObject({ status: 503 });
    await expect(store.find(identity)).rejects.toMatchObject({ status: 503 });
    expect(generate).not.toHaveBeenCalled();
  });
  it("blocks concurrent calls and replays an isolated copy of the saved result", async () => {
    const store = testStore();
    let release!: (value: SavedGradingSuggestion) => void;
    let entered!: () => void;
    const started = new Promise<void>((resolve) => { entered = resolve; });
    const generate = vi.fn(() => { entered(); return new Promise<SavedGradingSuggestion>((resolve) => { release = resolve; }); });
    const first = store.generate(identity, generate);
    await started;
    await expect(store.generate(identity, generate)).rejects.toMatchObject({ status: 409 });
    release(result);
    const saved = await first;
    expect(await store.generate(identity, generate)).toEqual(saved);
    saved.feedback = "Mutated outside store";
    expect((await store.find(identity))?.result?.feedback).toBe(result.feedback);
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it.each([
    { ownerId: "another-teacher" }, { submissionId: "another-submission" },
    { contextHash: "b".repeat(64) }, { language: "EN" as const },
  ])("isolates identity dimension %j", async (changed) => {
    const store = testStore();
    await store.generate(identity, () => Promise.resolve(result));
    const other = { ...identity, ...changed };
    expect(await store.find(other)).toBeNull();
    const saved = await store.generate(other, () => Promise.resolve({ ...result, contextHash: other.contextHash }));
    expect(saved.suggestionId).not.toBe((await store.find(identity))?.id);
  });

  it("never retries an ambiguous provider failure", async () => {
    const store = testStore();
    const generate = vi.fn().mockRejectedValue(new Error("response lost"));
    await expect(store.generate(identity, generate)).rejects.toThrow("response lost");
    expect((await store.find(identity))?.state).toBe("UNCERTAIN");
    await expect(store.generate(identity, generate)).rejects.toMatchObject({ status: 409 });
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it("lets exactly one caller consume an admin-authorized retry", async () => {
    let state = "RETRY_AUTHORIZED";
    let storedResult: SavedGradingSuggestion | null = null;
    const prisma = { isStartupConnectionEnabled: (): boolean => true, aiGradingSuggestion: {
      create: vi.fn().mockRejectedValue({ code: "P2002" }),
      findUnique: vi.fn().mockImplementation(() => Promise.resolve({ ...identity, id: "authorized-id", state, result: storedResult })),
      updateMany: vi.fn().mockImplementation(({ where, data }: { where: { state: string }; data: { state: string; result?: SavedGradingSuggestion | null } }) => {
        if (where.state !== state) return Promise.resolve({ count: 0 });
        state = data.state;
        storedResult = data.result ?? null;
        return Promise.resolve({ count: 1 });
      }),
    } };
    let release!: (value: SavedGradingSuggestion) => void;
    const generate = vi.fn(() => new Promise<SavedGradingSuggestion>((resolve) => { release = resolve; }));
    const store = new AiGradingStoreService(prisma as unknown as PrismaService);

    const first = store.generate(identity, generate);
    await vi.waitFor(() => expect(generate).toHaveBeenCalledOnce());
    await expect(store.generate(identity, generate)).rejects.toMatchObject({ status: 409 });
    release(result);

    await expect(first).resolves.toEqual({ ...result, suggestionId: "authorized-id" });
    expect(generate).toHaveBeenCalledOnce();
    expect(state).toBe("READY");
  });

  it("rejects a mismatched result without making it replayable", async () => {
    const store = testStore();
    await expect(store.generate(identity, () => Promise.resolve({ ...result, contextHash: "wrong" }))).rejects.toMatchObject({ status: 409 });
    expect(await store.find(identity)).toMatchObject({ state: "UNCERTAIN", result: null });
  });

  it("does not fall back to memory when the database claim fails", async () => {
    const prisma = { isStartupConnectionEnabled: (): boolean => true, aiGradingSuggestion: { create: vi.fn().mockRejectedValue(new Error("database offline")) } };
    const generate = vi.fn();
    await expect(new AiGradingStoreService(prisma as unknown as PrismaService).generate(identity, generate)).rejects.toThrow("database offline");
    expect(generate).not.toHaveBeenCalled();
  });

  it("preserves a committed READY result when its write acknowledgement is lost", async () => {
    let state = "GENERATING";
    let storedResult: SavedGradingSuggestion | null = null;
    const prisma = { isStartupConnectionEnabled: (): boolean => true, aiGradingSuggestion: {
      create: vi.fn().mockResolvedValue({}),
      findUnique: vi.fn().mockImplementation(() => Promise.resolve({ ...identity, id: "saved-id", state, result: storedResult })),
      updateMany: vi.fn().mockImplementation(({ where, data }: { where: { state: string }; data: { state: string; result?: SavedGradingSuggestion } }) => {
        if (where.state !== state) return Promise.resolve({ count: 0 });
        state = data.state; storedResult = data.result ?? null;
        return Promise.reject(new Error("acknowledgement lost"));
      }),
    } };
    const generate = vi.fn().mockResolvedValue(result);
    const store = new AiGradingStoreService(prisma as unknown as PrismaService);
    await expect(store.generate(identity, generate)).rejects.toThrow("acknowledgement lost");
    prisma.aiGradingSuggestion.create.mockRejectedValue({ code: "P2002" });
    expect(await store.generate(identity, generate)).toEqual({ ...result, suggestionId: "saved-id" });
    expect(generate).toHaveBeenCalledTimes(1);
  });
});
