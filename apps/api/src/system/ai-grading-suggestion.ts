import { BadRequestException, ServiceUnavailableException } from "@nestjs/common";
import { z } from "zod";

const points = z.number().min(0).max(1000).refine((value) => Math.abs(value * 100 - Math.round(value * 100)) < 1e-7);
const inputSchema = z.object({
  instructions: z.string().trim().min(5).max(16000),
  answer: z.string().trim().min(1).max(20000),
  language: z.enum(["VI", "EN", "BILINGUAL"]),
  rubric: z.array(z.object({ id: z.string().min(1).max(191), title: z.string().trim().min(2).max(120), description: z.string().trim().min(2).max(500), maxPoints: points.refine((value) => value >= 0.25) }).strict()).min(1).max(20),
}).strict();
const outputSchema = z.object({
  insufficientEvidence: z.boolean(),
  feedback: z.string().trim().min(1).max(5000),
  criteria: z.array(z.object({ criterionId: z.string().min(1).max(191), suggestedPoints: points, reasoning: z.string().trim().min(1).max(2000), evidence: z.array(z.string().min(1).max(2000)).min(1).max(5) }).strict()).max(20),
}).strict();
export type GradingSuggestionInput = z.infer<typeof inputSchema>;
export type GradingSuggestion = z.infer<typeof outputSchema> & { suggestedTotal: number | null; requiresHumanReview: true };

/** Validate assignment rules before chargeable extraction, using the same schema as final grading input. */
export function validateGradingDefinition(raw: unknown): Pick<GradingSuggestionInput, "instructions" | "rubric"> {
  const parsed = inputSchema.pick({ instructions: true, rubric: true }).safeParse(raw);
  if (!parsed.success) throw new BadRequestException("Bài làm hoặc rubric cho gợi ý chấm AI không hợp lệ.");
  const input = parsed.data;
  if (new Set(input.rubric.map((criterion) => criterion.id)).size !== input.rubric.length || input.rubric.reduce((sum, criterion) => sum + Math.round(criterion.maxPoints * 100), 0) > 100000) throw new BadRequestException("Rubric phải có mã tiêu chí duy nhất và tổng điểm không vượt 1.000.");
  return input;
}

/** Xác thực rubric và bài làm trước khi gọi provider; không tự cắt mất nội dung để chấm. */
export function validateGradingInput(raw: unknown): GradingSuggestionInput {
  const parsed = inputSchema.safeParse(raw);
  if (!parsed.success) throw new BadRequestException("Bài làm hoặc rubric cho gợi ý chấm AI không hợp lệ.");
  const input = parsed.data;
  validateGradingDefinition({ instructions: input.instructions, rubric: input.rubric });
  return input;
}

/** Chặn điểm vượt rubric và dẫn chứng không tồn tại; tổng điểm do server tính, luôn yêu cầu người duyệt. */
export function parseGradingSuggestion(raw: unknown, input: GradingSuggestionInput): GradingSuggestion {
  const parsed = outputSchema.safeParse(raw);
  if (!parsed.success) throw new ServiceUnavailableException("Gợi ý chấm AI sai cấu trúc. Không có điểm nào được áp dụng.");
  const output = parsed.data;
  if (output.insufficientEvidence) return { insufficientEvidence: true, feedback: output.feedback, criteria: [], suggestedTotal: null, requiresHumanReview: true };
  const criteria = new Map(input.rubric.map((criterion) => [criterion.id, criterion]));
  if (output.criteria.length !== criteria.size || new Set(output.criteria.map((criterion) => criterion.criterionId)).size !== criteria.size) throw new ServiceUnavailableException("Gợi ý chấm AI thiếu hoặc trùng tiêu chí rubric.");
  for (const item of output.criteria) {
    const criterion = criteria.get(item.criterionId);
    if (!criterion || item.suggestedPoints > criterion.maxPoints) throw new ServiceUnavailableException("Điểm AI đề xuất nằm ngoài rubric được phép.");
    if (item.evidence.some((quote) => !quote.trim() || !input.answer.includes(quote))) throw new ServiceUnavailableException("Dẫn chứng AI không có trong bài làm. Gợi ý chưa được chấp nhận.");
  }
  return { ...output, criteria: input.rubric.map((criterion) => output.criteria.find((item) => item.criterionId === criterion.id)!), suggestedTotal: output.criteria.reduce((sum, criterion) => sum + Math.round(criterion.suggestedPoints * 100), 0) / 100, requiresHumanReview: true };
}
