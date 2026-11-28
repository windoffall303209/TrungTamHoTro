import { BadRequestException } from "@nestjs/common";
import { z } from "zod";
import type { SavedStudyGuide } from "./ai-study-draft.service.js";

const citations = z.array(z.string().trim().min(1).max(128)).min(1).max(8);
const schema = z.object({
  expectedRevision: z.number().int().min(0).max(2147483646),
  summary: z.array(z.object({ text: z.string().trim().min(1).max(2000), citationIds: citations }).strict()).min(1).max(8),
  flashcards: z.array(z.object({ front: z.string().trim().min(1).max(1000), back: z.string().trim().min(1).max(3000), citationIds: citations }).strict()).min(1).max(20),
}).strict();

/** Chuẩn hóa nội dung người duyệt, chỉ gắn nguồn đã lưu từ kết quả AI gốc. */
export function validateStudyDraftEdit(input: unknown, original: SavedStudyGuide): { expectedRevision: number; result: SavedStudyGuide } {
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw new BadRequestException({ message: "Nội dung sửa bộ ôn tập không hợp lệ.", fields: parsed.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })) });
  const edit = parsed.data;
  const sources = new Map([...original.summary, ...original.flashcards].flatMap((item) => item.citations).map((source) => [source.id, source]));
  /** Khôi phục metadata nguồn từ server, không chấp nhận trích dẫn hoặc đường dẫn do client tự tạo. */
  const resolve = (ids: string[]): SavedStudyGuide["summary"][number]["citations"] => [...new Set(ids)].map((id) => {
    const source = sources.get(id);
    if (!source) throw new BadRequestException("Nguồn trích dẫn không thuộc bản ôn tập gốc.");
    return source;
  });
  const fronts = edit.flashcards.map((card) => card.front.normalize("NFKC").toLocaleLowerCase().replace(/[\p{P}\p{Z}\s]+/gu, " ").trim());
  if (new Set(fronts).size !== fronts.length) throw new BadRequestException("Các câu hỏi trong bộ ôn tập không được trùng nhau.");
  return { expectedRevision: edit.expectedRevision, result: { ...original, insufficientContext: false, summary: edit.summary.map((item) => ({ text: item.text, citations: resolve(item.citationIds) })), flashcards: edit.flashcards.map((item) => ({ front: item.front, back: item.back, citations: resolve(item.citationIds) })) } };
}
