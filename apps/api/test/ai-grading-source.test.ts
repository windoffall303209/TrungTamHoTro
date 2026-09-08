import { describe, expect, it } from "vitest";
import { combineGradingSources, decodeGradingText } from "../src/learning/ai-grading-source.js";

describe("complete UTF-8 grading sources", () => {
  it("decodes Vietnamese, emoji, BOM and original whitespace without truncating", () => {
    const text = "Câu trả lời 🌿\r\n\tDẫn chứng.";
    expect(decodeGradingText(Buffer.from(`\uFEFF${text}`))).toBe(text);
    expect(decodeGradingText(Buffer.from("a".repeat(20000)))).toHaveLength(20000);
  });
  it.each([Buffer.alloc(0), Buffer.from(" \t\n"), Buffer.from([0xc3, 0x28]), Buffer.from([0xff, 0xfe, 0x61, 0]), Buffer.from("text\x00"), Buffer.from("text\x1b"), Buffer.from("text\x7f"), Buffer.from("x".repeat(20001)), Buffer.alloc(80001, 97)])("rejects invalid, binary, blank or over-limit input %#", (buffer) => {
    expect(() => decodeGradingText(buffer)).toThrow();
  });
  it("applies the limit to all sources including separators, not to each file independently", () => {
    const source = { attachmentId: "file", name: "answer.txt", checksum: "verified", text: "x".repeat(9999) };
    expect(combineGradingSources([source, source])).toHaveLength(20000);
    expect(() => combineGradingSources([source, { ...source, text: "x".repeat(10000) }])).toThrow("không tự cắt");
    expect(() => combineGradingSources([])).toThrow();
  });
});
