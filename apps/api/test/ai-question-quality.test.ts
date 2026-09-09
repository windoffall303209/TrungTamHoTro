import { describe, expect, it } from "vitest";
import { assertAiQuestionQuality } from "../src/system/ai-question-quality.js";
import type { ScannedQuestionDraft } from "../src/system/ai-provider.service.js";

const valid: ScannedQuestionDraft = { type: "SINGLE_CHOICE", content: "Which HTTP method retrieves a resource?", options: ["GET", "POST", "PUT", "DELETE"], correctAnswers: ["GET"], difficulty: 1, tags: [], confidence: 1, warnings: [] };
describe("AI question quality gate", () => {
  it("accepts a valid objective question", () => expect(() => assertAiQuestionQuality([valid])).not.toThrow());
  it.each([
    { correctAnswers: ["PATCH"] },
    { options: ["GET", "GET", "PUT", "DELETE"] },
    { correctAnswers: [] },
    { correctAnswers: ["GET", "POST"] },
    { type: "MULTIPLE_CHOICE" as const },
    { type: "ESSAY" as const },
  ])("rejects invalid answers or type shape %#", (patch) => expect(() => assertAiQuestionQuality([{ ...valid, ...patch }])).toThrow());
  it("detects repeated questions despite whitespace and capitalization", () => expect(() => assertAiQuestionQuality([valid, { ...valid, content: `  ${valid.content.toUpperCase()}  ` }])).toThrow("trùng"));
  it("accepts essay marking guidance without options", () => expect(() => assertAiQuestionQuality([{ ...valid, type: "ESSAY", options: [], correctAnswers: ["Explain the retrieval semantics and give an example."] }])).not.toThrow());
});
