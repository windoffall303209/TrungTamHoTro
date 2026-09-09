import { createHash } from "node:crypto";

export type DocumentPage = { page: number; text: string };
export type DocumentIdentity = { materialId: string; version: number; checksum: string; name: string };
export type ContextChunk = DocumentIdentity & { id: string; page: number; start: number; end: number; text: string };

/** Chuẩn hóa từ khóa để truy xuất tiếng Việt có hoặc không dấu. */
function tokens(text: string): Set<string> {
  return new Set(text.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/đ/g, "d").match(/[\p{L}\p{N}]{2,}/gu) ?? []);
}

/** Chia nội dung đã trích xuất thành đoạn có trang, offset và định danh theo phiên bản nguồn. */
export function chunkDocument(identity: DocumentIdentity, pages: DocumentPage[], maxCharacters = 1600, overlap = 160): ContextChunk[] {
  if (!identity.materialId || !identity.checksum || !Number.isInteger(identity.version) || identity.version < 1) throw new Error("Invalid document identity");
  if (!Number.isInteger(maxCharacters) || maxCharacters < 100 || !Number.isInteger(overlap) || overlap < 0 || overlap >= maxCharacters) throw new Error("Invalid chunk limits");
  const chunks: ContextChunk[] = [];
  const seenPages = new Set<number>();
  for (const page of pages) {
    if (!Number.isInteger(page.page) || page.page < 1 || seenPages.has(page.page)) throw new Error("Invalid or duplicate page number");
    seenPages.add(page.page);
    const text = page.text.replace(/\r\n?/g, "\n").replaceAll(String.fromCharCode(0), "");
    for (let start = 0; start < text.length;) {
      let end = Math.min(text.length, start + maxCharacters);
      // Không cắt đôi ký tự ngoài BMP như emoji trong tài liệu.
      if (end < text.length && /[\uD800-\uDBFF]/.test(text[end - 1]!)) end -= 1;
      const excerpt = text.slice(start, end);
      if (excerpt.trim()) {
        const id = createHash("sha256").update(JSON.stringify([identity.materialId, identity.version, identity.checksum, page.page, start, end])).digest("hex");
        chunks.push({ ...identity, id, page: page.page, start, end, text: excerpt });
      }
      if (end === text.length) break;
      start = end - overlap;
      if (/[\uDC00-\uDFFF]/.test(text[start]!)) start += 1;
    }
  }
  return chunks;
}

/** Xếp hạng từ khóa trên đúng tập đoạn đã được caller kiểm tra quyền; không có fallback sang nguồn khác. */
export function retrieveDocumentContext(query: string, authorizedChunks: ContextChunk[], maxCharacters = 12000, maxChunks = 8): ContextChunk[] {
  if (!Number.isInteger(maxCharacters) || maxCharacters < 1 || !Number.isInteger(maxChunks) || maxChunks < 1) throw new Error("Invalid context limits");
  const terms = tokens(query);
  if (!terms.size) return [];
  const ranked = authorizedChunks.map((chunk) => {
    const words = tokens(chunk.text);
    let score = 0;
    for (const term of terms) if (words.has(term)) score += 1;
    return { chunk, score };
  }).filter((item) => item.score > 0).sort((a, b) => b.score - a.score || a.chunk.id.localeCompare(b.chunk.id));
  const selected: ContextChunk[] = [];
  const seen = new Set<string>();
  let used = 0;
  for (const { chunk } of ranked) {
    if (selected.length >= maxChunks) break;
    if (seen.has(chunk.id) || used + chunk.text.length > maxCharacters) continue;
    selected.push(chunk); seen.add(chunk.id); used += chunk.text.length;
  }
  return selected;
}

/** Chỉ nhận trích dẫn tới đoạn đã thực sự cung cấp cho AI, không chấp nhận id do model tự tạo. */
export function resolveContextCitations(ids: string[], suppliedChunks: ContextChunk[]): ContextChunk[] {
  const unique = [...new Set(ids)];
  const lookup = new Map(suppliedChunks.map((chunk) => [chunk.id, chunk]));
  return unique.map((id) => {
    const chunk = lookup.get(id);
    if (!chunk) throw new Error("AI cited a source outside the supplied context");
    return chunk;
  });
}
