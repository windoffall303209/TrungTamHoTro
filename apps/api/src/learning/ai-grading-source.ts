import { BadRequestException } from "@nestjs/common";

export const GRADING_TEXT_LIMIT = 20_000;
export const GRADING_TEXT_BYTE_LIMIT = 80_000;
export type GradingAnswerSource = { attachmentId: string | null; name: string; checksum: string | null; text: string };
export type VerifiedGradingAttachment = { attachmentId: string; buffer: Buffer; fileName: string; mimeType: string; checksum: string; submissionRevision: number };
export type GradingDocumentReader = (file: VerifiedGradingAttachment) => Promise<string>;
export const GRADING_DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/** Accept only document formats whose MIME and filename extension agree. */
export function isGradingDocument(mimeType: string, name: string): boolean {
  const extensions: Record<string, RegExp> = { "application/pdf": /\.pdf$/i, "image/png": /\.png$/i, "image/jpeg": /\.jpe?g$/i, "image/webp": /\.webp$/i, [GRADING_DOCX_MIME]: /\.docx$/i };
  return Object.hasOwn(extensions, mimeType) && extensions[mimeType]!.test(name);
}

/** Identify DOCX separately because it is parsed locally and must never consume an OCR request. */
export function isGradingDocx(mimeType: string, name: string): boolean {
  return mimeType === GRADING_DOCX_MIME && /\.docx$/i.test(name);
}

/** Giải mã toàn bộ TXT UTF-8, chặn lỗi mã hóa/binary/nguồn rỗng; không cắt ngắn để chấm một phần. */
export function decodeGradingText(buffer: Buffer): string {
  if (!buffer.length || buffer.length > GRADING_TEXT_BYTE_LIMIT) throw new BadRequestException("Tệp TXT cho chấm AI phải có nội dung và không vượt quá 80.000 byte.");
  let text: string;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(buffer); }
  catch { throw new BadRequestException("Tệp TXT cho chấm AI phải được lưu bằng UTF-8 hợp lệ."); }
  // Giữ tab và xuống dòng nhưng không chuyển các control byte của dữ liệu nhị phân vào prompt.
  if ([...text].some((char) => { const code = char.charCodeAt(0); return (code < 32 && ![9, 10, 13].includes(code)) || code === 127; })) throw new BadRequestException("Tệp TXT chứa ký tự điều khiển không được hỗ trợ cho chấm AI.");
  if (!text.trim() || text.length > GRADING_TEXT_LIMIT) throw new BadRequestException("Nội dung cho chấm AI phải có văn bản và không vượt quá 20.000 ký tự; hệ thống không tự cắt nội dung.");
  return text;
}

/** Ghép các nguồn đã xác minh không thêm nội dung giả vào bằng chứng; áp dụng giới hạn toàn bài. */
export function combineGradingSources(sources: GradingAnswerSource[]): string {
  const answer = sources.map((source) => source.text).join("\n\n");
  if (!answer.trim() || answer.length > GRADING_TEXT_LIMIT) throw new BadRequestException("Nội dung cho chấm AI phải có văn bản và không vượt quá 20.000 ký tự; hệ thống không tự cắt nội dung.");
  return answer;
}
