import { describe, expect, it } from "vitest";
import { parseGradingSuggestion, validateGradingInput } from "../src/system/ai-grading-suggestion.js";

const input = { instructions: "Explain the water cycle.", answer: "Water evaporates. Water condenses.", language: "EN" as const, rubric: [{ id: "accuracy", title: "Accuracy", description: "Explain evaporation correctly.", maxPoints: 3.5 }, { id: "clarity", title: "Clarity", description: "Use clear language.", maxPoints: 1.5 }] };
const output = { insufficientEvidence: false, feedback: "Add precipitation.", criteria: [{ criterionId: "clarity", suggestedPoints: 1.25, reasoning: "Clear sentences.", evidence: ["Water condenses."] }, { criterionId: "accuracy", suggestedPoints: 2.5, reasoning: "Evaporation mentioned.", evidence: ["Water evaporates."] }] };

describe("AI grading suggestion contract", () => {
  it("normalizes input, restores rubric order and calculates totals independently", () => {
    expect(validateGradingInput({ ...input, answer: ` ${input.answer} ` }).answer).toBe(input.answer);
    const suggestion = parseGradingSuggestion(output, input);
    expect(suggestion.suggestedTotal).toBe(3.75);
    expect(suggestion.requiresHumanReview).toBe(true);
    expect(suggestion.criteria.map((criterion) => criterion.criterionId)).toEqual(["accuracy", "clarity"]);
  });
  it("returns no scores when evidence is insufficient", () => {
    expect(parseGradingSuggestion({ ...output, insufficientEvidence: true }, input)).toMatchObject({ criteria: [], suggestedTotal: null, requiresHumanReview: true });
  });
  it.each([
    null, {}, { ...input, answer: " " }, { ...input, answer: "x".repeat(20001) },
    { ...input, rubric: [] }, { ...input, rubric: [input.rubric[0], input.rubric[0]] },
    { ...input, language: "XX" }, { ...input, rubric: [{ ...input.rubric[0], maxPoints: 1.123 }] },
    { ...input, rubric: input.rubric.map((criterion) => ({ ...criterion, maxPoints: 600 })) },
  ])("rejects invalid input before provider use: %#", (value) => { expect(() => validateGradingInput(value)).toThrow(); });
  it.each([
    {}, { ...output, suggestedTotal: 99 }, { ...output, criteria: [] },
    { ...output, criteria: [output.criteria[0], output.criteria[0]] },
    { ...output, criteria: [{ ...output.criteria[0], criterionId: "forged" }, output.criteria[1]] },
    { ...output, criteria: [{ ...output.criteria[0], suggestedPoints: 2 }, output.criteria[1]] },
    { ...output, criteria: [{ ...output.criteria[0], suggestedPoints: -1 }, output.criteria[1]] },
    { ...output, criteria: [{ ...output.criteria[0], evidence: ["invented answer"] }, output.criteria[1]] },
    { ...output, criteria: [{ ...output.criteria[0], evidence: [] }, output.criteria[1]] },
    { ...output, criteria: [{ ...output.criteria[0], suggestedPoints: 1.111 }, output.criteria[1]] },
  ])("rejects forged evidence and invalid grades: %#", (value) => { expect(() => parseGradingSuggestion(value, input)).toThrow(); });
});
