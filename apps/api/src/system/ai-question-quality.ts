import { ServiceUnavailableException } from "@nestjs/common";
import type { ScannedQuestionDraft } from "./ai-provider.service.js";

/** Chặn bộ câu AI không chấm được; không coi confidence do model tự khai là chứng cứ đúng. */
export function assertAiQuestionQuality(questions: ScannedQuestionDraft[]): void {
  const seen = new Set<string>();
  for (const [index, question] of questions.entries()) {
    const fail = (reason: string): never => { throw new ServiceUnavailableException(`Câu AI ${index + 1}: ${reason}. Kết quả chưa được lưu thành đề.`); };
    const normalized = question.content.normalize("NFKC").replace(/\s+/g, " ").trim().toLocaleLowerCase("vi-VN");
    if (normalized.length < 5) fail("nội dung quá ngắn");
    if (seen.has(normalized)) fail("trùng nội dung câu trước");
    seen.add(normalized);
    const options = question.options.map((item) => item.trim());
    const answers = question.correctAnswers.map((item) => item.trim());
    if (!answers.length || answers.some((item) => !item)) fail("thiếu đáp án hoặc ý chấm tham khảo");
    if (new Set(answers).size !== answers.length) fail("đáp án bị lặp");
    if (["SINGLE_CHOICE", "MULTIPLE_CHOICE", "TRUE_FALSE"].includes(question.type)) {
      if (options.some((item) => !item) || new Set(options).size !== options.length) fail("lựa chọn rỗng hoặc trùng nhau");
      if (answers.some((answer) => !options.includes(answer))) fail("đáp án không khớp lựa chọn");
      if (question.type === "SINGLE_CHOICE" && (options.length !== 4 || answers.length !== 1)) fail("câu một đáp án cần 4 lựa chọn và 1 đáp án đúng");
      if (question.type === "MULTIPLE_CHOICE" && (options.length < 4 || options.length > 6 || answers.length < 2)) fail("câu nhiều đáp án cần 4–6 lựa chọn và ít nhất 2 đáp án đúng");
      if (question.type === "TRUE_FALSE" && (options.length !== 2 || answers.length !== 1)) fail("câu đúng sai cần 2 lựa chọn và 1 đáp án đúng");
    } else if (options.length) fail("câu tự luận hoặc trả lời ngắn không được có lựa chọn");
  }
}
