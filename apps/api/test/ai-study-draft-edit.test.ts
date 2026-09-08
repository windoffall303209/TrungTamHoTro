import { testStudyDraft } from "./ai-study-draft.fixture.js";
import { describe, expect, it, vi } from "vitest";
import { type SavedStudyGuide } from "../src/learning/ai-study-draft.service.js";
import { validateStudyDraftEdit } from "../src/learning/ai-study-draft-edit.js";

const source = { id: "chunk", materialId: "material", version: 1, checksum: "checksum", name: "Lesson", page: 1, start: 0, end: 8, text: "Evidence" };
const original: SavedStudyGuide = { insufficientContext: false, summary: [{ text: "Original", citations: [source] }], flashcards: [{ front: "Question", back: "Answer", citations: [source] }], version: 1, warning: "Check source", coverage: { totalChunks: 1, selectedChunks: 1, selectedPages: [1], partial: false, fromPage: null, toPage: null } };
const input = { expectedRevision: 0, summary: [{ text: " Revised ", citationIds: ["chunk"] }], flashcards: [{ front: "Edited question", back: "Edited answer", citationIds: ["chunk"] }] };
const identity = { ownerId: "teacher", materialId: "material", sourceVersion: 1, options: { cardCount: 1, language: "VI" as const } };

describe("study draft human edits", () => {
  it("paginates published metadata without returning private content or withdrawn guides", async () => {
    const service = testStudyDraft();
    const privateDraft = await service.generate(identity, () => Promise.resolve(original));
    for (let index = 1; index <= 25; index++) {
      const draft = await service.generate({ ...identity, options: { ...identity.options, fromPage: index, toPage: index } }, () => Promise.resolve(original));
      await service.publish(draft.draftId, identity.ownerId, identity.materialId, { expectedRevision: 0, expectedPublicationRevision: 0, confirmReview: true });
    }
    const first = await service.listPublished(identity.materialId);
    const second = await service.listPublished(identity.materialId, first.nextCursor!);
    expect(first.items).toHaveLength(20);
    expect(second.items).toHaveLength(5);
    expect(second.nextCursor).toBeNull();
    expect(new Set([...first.items, ...second.items].map((item) => item.id)).size).toBe(25);
    expect(Object.keys(first.items[0]!).sort()).toEqual(["id", "language", "publicationRevision", "publishedAt", "sourceVersion"]);
    expect(first.items[0]).toMatchObject({ sourceVersion: 1, publicationRevision: 1, language: "VI" });
    expect(first.items[0]?.publishedAt).toBeInstanceOf(Date);
    expect(first.items.some((item) => item.id === privateDraft.draftId)).toBe(false);
    expect((await service.listPublished("other-material")).items).toEqual([]);
    await expect(service.listPublished("other-material", first.nextCursor!)).rejects.toMatchObject({ status: 400 });
    await service.unpublish(first.items[0]!.id, identity.ownerId, identity.materialId, 1);
    expect((await service.listPublished(identity.materialId)).items.some((item) => item.id === first.items[0]!.id)).toBe(false);
    await expect(service.listPublished(identity.materialId, first.items[0]!.id)).rejects.toMatchObject({ status: 400 });
  });
  it("publishes only confirmed snapshots, keeps later edits private and supports revision-checked withdrawal", async () => {
    const service = testStudyDraft();
    const saved = await service.generate(identity, () => Promise.resolve(original));
    const publish = { expectedRevision: 0, expectedPublicationRevision: 0, confirmReview: true };
    await expect(service.getPublished(saved.draftId, "material")).rejects.toMatchObject({ status: 404 });
    await expect(service.publish(saved.draftId, "teacher", "material", { ...publish, confirmReview: false })).rejects.toMatchObject({ status: 400 });
    await expect(service.publish(saved.draftId, "other", "material", publish)).rejects.toMatchObject({ status: 404 });
    await service.publish(saved.draftId, "teacher", "material", publish);
    const publicGuide = await service.getPublished(saved.draftId, "material");
    expect(publicGuide.result).toEqual(original);
    expect(publicGuide).not.toHaveProperty("ownerId");
    expect(publicGuide).not.toHaveProperty("editedResult");
    expect(publicGuide).not.toHaveProperty("fingerprint");
    await service.edit(saved.draftId, "teacher", "material", input);
    expect((await service.getPublished(saved.draftId, "material")).result).toEqual(original);
    await expect(service.publish(saved.draftId, "teacher", "material", { ...publish, expectedPublicationRevision: 1 })).rejects.toMatchObject({ status: 409 });
    await service.publish(saved.draftId, "teacher", "material", { ...publish, expectedRevision: 1, expectedPublicationRevision: 1 });
    expect((await service.getPublished(saved.draftId, "material")).result.summary[0]?.text).toBe("Revised");
    await expect(service.unpublish(saved.draftId, "teacher", "material", 1)).rejects.toMatchObject({ status: 409 });
    await service.unpublish(saved.draftId, "teacher", "material", 2);
    await expect(service.getPublished(saved.draftId, "material")).rejects.toMatchObject({ status: 404 });
    expect((await service.get(saved.draftId, "teacher", "material")).editedResult?.summary[0]?.text).toBe("Revised");
  });
  it("preserves AI output, restores authoritative sources and detects simultaneous saves", async () => {
    const service = testStudyDraft();
    const generate = vi.fn(() => Promise.resolve(original));
    const saved = await service.generate(identity, generate);
    const attempts = await Promise.allSettled([service.edit(saved.draftId, "teacher", "material", input), service.edit(saved.draftId, "teacher", "material", input)]);
    expect(attempts.filter((value) => value.status === "fulfilled")).toHaveLength(1);
    const rejected = attempts.find((value) => value.status === "rejected") as PromiseRejectedResult;
    expect(rejected.reason).toMatchObject({ status: 409 });
    const row = await service.get(saved.draftId, "teacher", "material");
    expect(row.result).toEqual(original);
    expect(row.editedResult?.summary[0]).toEqual({ text: "Revised", citations: [source] });
    expect(row.editRevision).toBe(1);
    expect(await service.generate(identity, generate)).toEqual(saved);
    expect(generate).toHaveBeenCalledTimes(1);
    await expect(service.edit(saved.draftId, "other", "material", input)).rejects.toMatchObject({ status: 404 });
    await expect(service.edit(saved.draftId, "teacher", "other", input)).rejects.toMatchObject({ status: 404 });
    expect((await service.edit(saved.draftId, "teacher", "material", { ...input, expectedRevision: 1 })).editRevision).toBe(2);
  });

  it.each([
    null, {}, { ...input, expectedRevision: -1 }, { ...input, expectedRevision: "0" },
    { ...input, summary: [] }, { ...input, flashcards: [] },
    { ...input, summary: [{ text: " ", citationIds: ["chunk"] }] },
    { ...input, summary: [{ text: "x".repeat(2001), citationIds: ["chunk"] }] },
    { ...input, flashcards: [{ front: "Q", back: "A", citationIds: [] }] },
    { ...input, flashcards: [{ front: "Q", back: "A", citationIds: ["forged"] }] },
    { ...input, flashcards: Array.from({ length: 21 }, (_, i) => ({ front: `Q${i}`, back: "A", citationIds: ["chunk"] })) },
    { ...input, flashcards: [{ front: "Question?", back: "A", citationIds: ["chunk"] }, { front: "QUESTION", back: "B", citationIds: ["chunk"] }] },
    { ...input, result: original },
  ])("rejects malformed, oversized, duplicate or forged edits: %#", (invalid) => {
    expect(() => validateStudyDraftEdit(invalid, original)).toThrow();
  });

  it("rejects editing a no-context result", async () => {
    const service = testStudyDraft();
    const saved = await service.generate(identity, () => Promise.resolve({ ...original, insufficientContext: true, summary: [], flashcards: [] }));
    await expect(service.edit(saved.draftId, "teacher", "material", input)).rejects.toMatchObject({ status: 409 });
  });
});
