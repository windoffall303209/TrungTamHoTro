import { BadRequestException, ServiceUnavailableException } from "@nestjs/common";
import { z } from "zod";
import { resolveContextCitations, type ContextChunk } from "./ai-document-context.js";

export type StudyGuideOptions = { cardCount: number; language: "VI" | "EN" | "BILINGUAL"; fromPage?: number; toPage?: number };
export type StudyGuide = {
  insufficientContext: boolean;
  summary: Array<{ text: string; citations: ContextChunk[] }>;
  flashcards: Array<{ front: string; back: string; citations: ContextChunk[] }>;
};
export type StudyContext = { chunks: ContextChunk[]; coverage: { totalChunks: number; selectedChunks: number; selectedPages: number[]; partial: boolean; fromPage: number | null; toPage: number | null } };
const citationIds = z.array(z.string().min(1).max(128)).min(1).max(8);
const studySchema = z.object({
  insufficientContext: z.boolean(),
  summary: z.array(z.object({ text: z.string().trim().min(1).max(2000), citationIds })).max(8),
  flashcards: z.array(z.object({ front: z.string().trim().min(1).max(1000), back: z.string().trim().min(1).max(3000), citationIds })).max(20),
});

/** Áp dụng cùng giới hạn cho HTTP và caller nội bộ trước khi đọc tài liệu hoặc gọi AI. */
export function validateStudyGuideOptions(options: StudyGuideOptions): void {
  if (!options || !Number.isInteger(options.cardCount) || options.cardCount < 1 || options.cardCount > 20) throw new BadRequestException("Số thẻ ôn tập phải từ 1 đến 20.");
  if (!["VI", "EN", "BILINGUAL"].includes(options.language)) throw new BadRequestException("Ngôn ngữ AI không hợp lệ.");
  if ((options.fromPage === undefined) !== (options.toPage === undefined)) throw new BadRequestException("Cần chọn cả trang bắt đầu và trang kết thúc.");
  if (options.fromPage !== undefined && options.toPage !== undefined && (!Number.isInteger(options.fromPage) || !Number.isInteger(options.toPage) || options.fromPage < 1 || options.toPage > 200 || options.fromPage > options.toPage)) throw new BadRequestException("Khoảng trang phải từ 1 đến 200 và trang kết thúc không trước trang bắt đầu.");
}

/** Chọn đoạn trải đều trong phạm vi đã chọn; luôn trả độ bao phủ thay vì ngầm cắt phần cuối. */
export function selectStudyContext(chunks: ContextChunk[], options: StudyGuideOptions): StudyContext {
  validateStudyGuideOptions(options);
  const unique = new Map<string, ContextChunk>();
  let maximumPage = 0;
  for (const chunk of chunks) {
    maximumPage = Math.max(maximumPage, chunk.page);
    if (options.fromPage === undefined || (chunk.page >= options.fromPage && chunk.page <= options.toPage!)) unique.set(chunk.id, chunk);
  }
  const scoped = [...unique.values()].sort((a, b) => a.page - b.page || a.start - b.start);
  if (options.toPage !== undefined && options.toPage > maximumPage) throw new BadRequestException("Khoảng trang vượt quá nội dung tài liệu đã trích xuất.");
  let largest = 1;
  for (const chunk of scoped) largest = Math.max(largest, chunk.text.length);
  const count = Math.min(8, scoped.length, Math.floor(12000 / largest));
  const selected = Array.from({ length: count }, (_, index) => scoped[count === 1 ? 0 : Math.round(index * (scoped.length - 1) / (count - 1))]!);
  return { chunks: selected, coverage: { totalChunks: scoped.length, selectedChunks: selected.length, selectedPages: [...new Set(selected.map((chunk) => chunk.page))], partial: selected.length < scoped.length, fromPage: options.fromPage ?? null, toPage: options.toPage ?? null } };
}

/** Từ chối mục thiếu nguồn, nguồn giả, số thẻ sai và câu hỏi lặp trước khi trả bộ ôn tập. */
export function parseStudyGuide(raw: unknown, chunks: ContextChunk[], cardCount: number): StudyGuide {
  const parsed = studySchema.safeParse(raw);
  if (!parsed.success) throw new ServiceUnavailableException("Bộ ôn tập AI không đúng cấu trúc. Kết quả chưa được chấp nhận.");
  const data = parsed.data;
  if (data.insufficientContext) return { insufficientContext: true, summary: [], flashcards: [] };
  if (!data.summary.length || data.flashcards.length !== cardCount) throw new ServiceUnavailableException("AI chưa cung cấp đủ tóm tắt và số thẻ ôn tập yêu cầu.");
  const fronts = data.flashcards.map((card) => card.front.normalize("NFKC").toLocaleLowerCase("vi-VN").replace(/[\p{P}\p{Z}\s]+/gu, " ").trim());
  if (new Set(fronts).size !== fronts.length) throw new ServiceUnavailableException("AI tạo thẻ ôn tập trùng nhau. Kết quả chưa được chấp nhận.");
  try {
    return { insufficientContext: false, summary: data.summary.map((item) => ({ text: item.text, citations: resolveContextCitations(item.citationIds, chunks) })), flashcards: data.flashcards.map((card) => ({ front: card.front, back: card.back, citations: resolveContextCitations(card.citationIds, chunks) })) };
  } catch { throw new ServiceUnavailableException("Bộ ôn tập trích dẫn ngoài ngữ cảnh được phép. Kết quả chưa được chấp nhận."); }
}
