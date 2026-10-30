import { describe, expect, it } from "vitest";
import { chunkDocument, resolveContextCitations, retrieveDocumentContext } from "../src/domains/system/ai-document-context.js";

const source = { materialId: "material-1", version: 1, checksum: "hash-of-file", name: "Bài học" };
describe("document context primitives", () => {
  it("preserves source identity, page and normalized offsets", () => {
    const text = "Giao thức HTTP.\n".repeat(40);
    const chunks = chunkDocument(source, [{ page: 2, text }], 100, 20);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.page).toBe(2);
      expect(chunk.text).toBe(text.slice(chunk.start, chunk.end));
      expect(chunk.text.length).toBeLessThanOrEqual(100);
    }
    expect(chunks.at(-1)?.end).toBe(text.length);
    expect(chunkDocument(source, [{ page: 2, text }], 100, 20)).toEqual(chunks);
    expect(chunkDocument({ ...source, version: 2 }, [{ page: 2, text }], 100, 20)[0]?.id).not.toBe(chunks[0]?.id);
  });
  it("rejects invalid ranges and duplicate page numbers", () => {
    expect(() => chunkDocument(source, [], 100, 100)).toThrow();
    expect(() => chunkDocument(source, [{ page: 1, text: "a" }, { page: 1, text: "b" }])).toThrow();
    expect(chunkDocument(source, [{ page: 1, text: "   " }])).toEqual([]);
  });
  it("retrieves Vietnamese without accents only from supplied sources within limits", () => {
    const chunks = chunkDocument(source, [{ page: 1, text: "Cơ sở dữ liệu quan hệ." }, { page: 2, text: "Giao thức truyền thông HTTP." }]);
    expect(retrieveDocumentContext("co so du lieu", chunks).map((chunk) => chunk.page)).toEqual([1]);
    expect(retrieveDocumentContext("HTTP", chunks.slice(0, 1))).toEqual([]);
    expect(retrieveDocumentContext("HTTP", chunks, 5)).toEqual([]);
    expect(retrieveDocumentContext("", chunks)).toEqual([]);
  });
  it("rejects invented and stale citations", () => {
    const chunks = chunkDocument(source, [{ page: 1, text: "Nội dung tài liệu." }]);
    expect(resolveContextCitations([chunks[0]!.id, chunks[0]!.id], chunks)).toEqual(chunks);
    expect(() => resolveContextCitations(["fabricated-id"], chunks)).toThrow();
    const newer = chunkDocument({ ...source, version: 2 }, [{ page: 1, text: "Nội dung tài liệu." }]);
    expect(() => resolveContextCitations([chunks[0]!.id], newer)).toThrow();
  });
});
