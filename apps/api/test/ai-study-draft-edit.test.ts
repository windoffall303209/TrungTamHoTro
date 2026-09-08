import { describe, expect, it, vi } from "vitest";
import { AiStudyDraftService, type SavedStudyGuide } from "../src/learning/ai-study-draft.service.js";
import { validateStudyDraftEdit } from "../src/learning/ai-study-draft-edit.js";

const source = { id: "chunk", materialId: "material", version: 1, checksum: "checksum", name: "Lesson", page: 1, start: 0, end: 8, text: "Evidence" };
const original: SavedStudyGuide = { insufficientContext: false, summary: [{ text: "Original", citations: [source] }], flashcards: [{ front: "Question", back: "Answer", citations: [source] }], version: 1, warning: "Check source", coverage: { totalChunks: 1, selectedChunks: 1, selectedPages: [1], partial: false, fromPage: null, toPage: null } };
const input = { expectedRevision: 0, summary: [{ text: " Revised ", citationIds: ["chunk"] }], flashcards: [{ front: "Edited question", back: "Edited answer", citationIds: ["chunk"] }] };
const identity = { ownerId: "teacher", materialId: "material", sourceVersion: 1, options: { cardCount: 1, language: "VI" as const } };

describe("study draft human edits", () => {
  it("preserves AI output, restores authoritative sources and detects simultaneous saves", async () => {
    const service = new AiStudyDraftService();
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
    const service = new AiStudyDraftService();
    const saved = await service.generate(identity, () => Promise.resolve({ ...original, insufficientContext: true, summary: [], flashcards: [] }));
    await expect(service.edit(saved.draftId, "teacher", "material", input)).rejects.toMatchObject({ status: 409 });
  });
});
