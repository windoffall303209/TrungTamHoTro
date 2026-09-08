import { testStudyDraft } from "./ai-study-draft.fixture.js";
import { AiStudyDraftService } from "../src/learning/ai-study-draft.service.js";
import type { PrismaService } from "../src/database/prisma.service.js";
import { describe, expect, it, vi } from "vitest";
import { type SavedStudyGuide } from "../src/learning/ai-study-draft.service.js";

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
