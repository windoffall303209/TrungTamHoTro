import { testStudyDraft } from "./ai-study-draft.fixture.js";
import { AiStudyDraftService } from "../src/domains/learning/ai-study-draft.service.js";
import type { PrismaService } from "../src/database/prisma.service.js";
import { describe, expect, it, vi } from "vitest";
import { type SavedStudyGuide } from "../src/domains/learning/ai-study-draft.service.js";

const identity = { ownerId: "teacher", materialId: "material", sourceVersion: 1, options: { cardCount: 1, language: "VI" as const } };
const result: SavedStudyGuide = { insufficientContext: true, summary: [], flashcards: [], version: 1, warning: "Review source", coverage: { totalChunks: 1, selectedChunks: 1, selectedPages: [1], partial: false, fromPage: null, toPage: null } };

describe("private study drafts", () => {
  it.each([undefined, { isStartupConnectionEnabled: (): boolean => false }])("requires durable storage for generation, reads, edits and publication", async (prisma) => {
    const service = new AiStudyDraftService(prisma as PrismaService | undefined);
    const generate = vi.fn();
    const operations = [
      service.generate(identity, generate), service.get("draft", "teacher", "material"), service.list("teacher", "material"),
      service.edit("draft", "teacher", "material", {}), service.publish("draft", "teacher", "material", { expectedRevision: 0, expectedPublicationRevision: 0, confirmReview: true }),
      service.unpublish("draft", "teacher", "material", 0), service.getPublished("draft", "material"), service.listPublished("material"),
    ];
    await Promise.all(operations.map((operation) => expect(operation).rejects.toMatchObject({ status: 503 })));
    expect(generate).not.toHaveBeenCalled();
  });

  it("does not call AI or fall back when a durable claim write fails", async () => {
    const prisma = { isStartupConnectionEnabled: (): boolean => true, aiStudyDraft: { create: vi.fn().mockRejectedValue(new Error("database offline")) } };
    const generate = vi.fn();
    await expect(new AiStudyDraftService(prisma as unknown as PrismaService).generate(identity, generate)).rejects.toThrow("database offline");
    expect(generate).not.toHaveBeenCalled();
  });
  it("does not save a guide against a different source version", async () => {
    const service = testStudyDraft();
    await expect(service.generate(identity, () => Promise.resolve({ ...result, version: 2 }))).rejects.toMatchObject({ status: 409 });
    expect((await service.list(identity.ownerId, identity.materialId)).items[0]?.state).toBe("UNCERTAIN");
  });
  it("replays completed drafts without calling AI and isolates owners", async () => {
    const service = testStudyDraft();
    const generate = vi.fn(() => Promise.resolve(result));
    const first = await service.generate(identity, generate);
    expect(await service.generate(identity, generate)).toEqual(first);
    expect(generate).toHaveBeenCalledTimes(1);
    expect((await service.get(first.draftId, identity.ownerId, identity.materialId)).result).toEqual(result);
    await expect(service.get(first.draftId, "other", identity.materialId)).rejects.toMatchObject({ status: 404 });
    await expect(service.get(first.draftId, identity.ownerId, "other-material")).rejects.toMatchObject({ status: 404 });
    expect((await service.list("other", identity.materialId)).items).toEqual([]);
  });

  it("does not repeat an uncertain provider call", async () => {
    const service = testStudyDraft();
    const generate = vi.fn().mockRejectedValue(new Error("provider timeout"));
    await expect(service.generate(identity, generate)).rejects.toThrow("provider timeout");
    await expect(service.generate(identity, generate)).rejects.toMatchObject({ status: 409 });
    expect(generate).toHaveBeenCalledTimes(1);
    expect((await service.list(identity.ownerId, identity.materialId)).items[0]?.state).toBe("UNCERTAIN");
  });

  it("allows one caller to consume an authorized retry without creating a second draft", async () => {
    let state = "RETRY_AUTHORIZED";
    let storedResult: SavedStudyGuide | null = null;
    const row = { ...identity, id: "study-authorized", fingerprint: "f".repeat(64), state, result: storedResult, editedResult: null, publishedResult: null, publishedAt: null, publicationRevision: 0, publishedEditRevision: null, editRevision: 0 };
    const prisma = { isStartupConnectionEnabled: (): boolean => true, aiStudyDraft: {
      create: vi.fn().mockRejectedValue({ code: "P2002" }),
      findUnique: vi.fn().mockImplementation(() => Promise.resolve({ ...row, state, result: storedResult })),
      updateMany: vi.fn().mockImplementation(({ where, data }: { where: { state: string }; data: { state: string; result?: SavedStudyGuide | null } }) => {
        if (where.state !== state) return Promise.resolve({ count: 0 });
        state = data.state;
        storedResult = data.result ?? null;
        return Promise.resolve({ count: 1 });
      }),
    } };
    let release!: (value: SavedStudyGuide) => void;
    const generate = vi.fn(() => new Promise<SavedStudyGuide>((resolve) => { release = resolve; }));
    const service = new AiStudyDraftService(prisma as unknown as PrismaService);

    const first = service.generate(identity, generate);
    await vi.waitFor(() => expect(generate).toHaveBeenCalledOnce());
    await expect(service.generate(identity, generate)).rejects.toMatchObject({ status: 409 });
    release(result);

    await expect(first).resolves.toEqual({ ...result, draftId: row.id });
    expect(generate).toHaveBeenCalledOnce();
    expect(state).toBe("READY");
  });

  it("paginates without exposing generated source text or skipping tied timestamps", async () => {
    const service = testStudyDraft();
    for (let page = 1; page <= 25; page++) await service.generate({ ...identity, options: { ...identity.options, fromPage: page, toPage: page } }, () => Promise.resolve(result));
    const first = await service.list(identity.ownerId, identity.materialId);
    expect(first.items).toHaveLength(20);
    expect(first.nextCursor).toBeTruthy();
    const second = await service.list(identity.ownerId, identity.materialId, first.nextCursor!);
    expect(second.items).toHaveLength(5);
    expect(second.nextCursor).toBeNull();
    expect(new Set([...first.items, ...second.items].map((item) => item.id)).size).toBe(25);
    expect(first.items[0]).not.toHaveProperty("result");
    expect(first.items[0]).not.toHaveProperty("fingerprint");
    await expect(service.list(identity.ownerId, "different", first.nextCursor!)).rejects.toMatchObject({ status: 400 });
  });
});
