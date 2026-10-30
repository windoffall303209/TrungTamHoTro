import { describe, expect, it } from "vitest";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { chunkDocument } from "../src/domains/system/ai-document-context.js";
import { parseStudyGuide, selectStudyContext, validateStudyGuideOptions } from "../src/domains/system/ai-study-guide.js";
import { MaterialStudyGuideDto } from "../src/domains/learning/learning.dto.js";

const chunks = chunkDocument({ materialId: "material", version: 2, checksum: "verified", name: "notes.pdf" }, Array.from({ length: 20 }, (_, index) => ({ page: index + 1, text: `Page ${index + 1}: ${"Learning material ".repeat(80)}` })));
const options = { cardCount: 2, language: "VI" as const };
const draft = { insufficientContext: false, summary: [{ text: "Summary", citationIds: [chunks[0]!.id] }], flashcards: [{ front: "What is A?", back: "A", citationIds: [chunks[0]!.id] }, { front: "What is B?", back: "B", citationIds: [chunks[1]!.id] }] };

describe("grounded study guide", () => {
  it("samples across the document under the budget and reports partial coverage", () => {
    const result = selectStudyContext(chunks, options);
    expect(result.coverage.partial).toBe(true);
    expect(result.coverage.totalChunks).toBe(chunks.length);
    expect(result.chunks.length).toBeLessThanOrEqual(8);
    expect(result.chunks.reduce((size, chunk) => size + chunk.text.length, 0)).toBeLessThanOrEqual(12000);
    expect(result.chunks[0]?.page).toBe(1);
    expect(result.chunks.at(-1)?.page).toBe(20);
  });

  it("supports a fully covered page range without including other pages", () => {
    const result = selectStudyContext(chunks, { ...options, fromPage: 3, toPage: 4 });
    expect(result.coverage).toMatchObject({ partial: false, selectedPages: [3, 4], fromPage: 3, toPage: 4 });
    expect(result.chunks.every((chunk) => chunk.page >= 3 && chunk.page <= 4)).toBe(true);
    expect(selectStudyContext([], options).coverage).toMatchObject({ totalChunks: 0, selectedChunks: 0, partial: false });
  });

  it.each([{ cardCount: 0 }, { cardCount: 21 }, { cardCount: 1.5 }, { fromPage: 1 }, { toPage: 3 }, { fromPage: 4, toPage: 3 }, { fromPage: 0, toPage: 3 }, { fromPage: 1, toPage: 201 }])("rejects invalid options %j", (invalid) => {
    expect(() => validateStudyGuideOptions({ ...options, ...invalid })).toThrow();
  });

  it("rejects a range beyond the extracted source", () => {
    expect(() => selectStudyContext(chunks, { ...options, fromPage: 18, toPage: 25 })).toThrow("vượt quá");
  });

  it("binds every summary item and flashcard to the supplied versioned sources", () => {
    const result = parseStudyGuide(draft, chunks.slice(0, 2), 2);
    expect(result.summary[0]?.citations).toEqual([chunks[0]]);
    expect(result.flashcards[1]?.citations).toEqual([chunks[1]]);
  });

  it("rejects missing, forged, malformed, duplicated, and wrong-count results", () => {
    const badValues = [null, {}, { ...draft, summary: [] }, { ...draft, flashcards: [draft.flashcards[0]] }, { ...draft, flashcards: [draft.flashcards[0], { ...draft.flashcards[1], front: " WHAT IS A! " }] }, { ...draft, summary: [{ text: "Unsupported", citationIds: [] }] }, { ...draft, summary: [{ text: "Unsupported", citationIds: ["outside-source"] }] }, { ...draft, flashcards: [{ ...draft.flashcards[0], back: " " }, draft.flashcards[1]] }];
    for (const value of badValues) expect(() => parseStudyGuide(value, chunks, 2)).toThrow();
  });

  it("never exposes speculative items when the model flags insufficient evidence", () => {
    expect(parseStudyGuide({ ...draft, insufficientContext: true }, chunks, 2)).toEqual({ insufficientContext: true, summary: [], flashcards: [] });
  });

  it("validates HTTP types and bounds, applies defaults, and rejects explicit nulls", async () => {
    const defaults = plainToInstance(MaterialStudyGuideDto, {});
    expect(await validate(defaults)).toHaveLength(0);
    expect(defaults).toMatchObject({ cardCount: 5, language: "VI" });
    for (const input of [{ cardCount: "5" }, { cardCount: null }, { language: "FR" }, { language: null }, { cardCount: 21 }, { fromPage: 1.5 }, { toPage: 201 }]) expect((await validate(plainToInstance(MaterialStudyGuideDto, input))).length).toBeGreaterThan(0);
  });
});
