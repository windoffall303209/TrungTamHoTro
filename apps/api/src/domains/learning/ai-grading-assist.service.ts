import { BadRequestException, ConflictException, Injectable, Optional, ServiceUnavailableException } from "@nestjs/common";
import { createHash } from "node:crypto";
import type { AuthenticatedSession } from "../../auth/auth.service.js";
import { AiProviderService, type ExamLanguage } from "../system/ai-provider.service.js";
import { AcademicService } from "./academic.service.js";
import { AiGradingStoreService, type SavedGradingSuggestion } from "./ai-grading-store.service.js";
import { validateGradingInput } from "../system/ai-grading-suggestion.js";
import { PrismaService } from "../../database/prisma.service.js";
import { AiDocumentExtractionStore } from "./ai-document-extraction-store.js";
import { AiGradingDocumentReader, GradingExtractionMissingError } from "./ai-grading-document-reader.js";

@Injectable()
/** Điều phối gợi ý riêng cho giảng viên; không gọi thao tác lưu điểm hoặc gửi phản hồi. */
export class AiGradingAssistService {
  constructor(private readonly academic: AcademicService, private readonly ai: AiProviderService, @Optional() private readonly store: AiGradingStoreService = new AiGradingStoreService(), @Optional() private readonly prisma?: PrismaService) {}

  /** Kiểm tra ngôn ngữ trước OCR có phí; dùng bản lưu chỉ đọc để xem trước và kiểm tra nguồn lần cuối. */
  private context(submissionId: string, revision: number, language: ExamLanguage, session: AuthenticatedSession, generate = false): ReturnType<AcademicService["gradingAiContext"]> {
    if (!["VI", "EN", "BILINGUAL"].includes(language)) throw new BadRequestException("Ngôn ngữ AI không hợp lệ.");
    const reader = new AiGradingDocumentReader(new AiDocumentExtractionStore(this.prisma), this.ai);
    return this.academic.gradingAiContext(submissionId, revision, session, (file) => reader.read(submissionId, session.user.id, file, generate));
  }

  /** Đọc nguồn có quyền trước khi gọi AI và loại kết quả nếu quyền/bài làm/rubric thay đổi trong lúc chờ. */
  async suggest(submissionId: string, expectedRevision: number, language: ExamLanguage, session: AuthenticatedSession): ReturnType<AiGradingStoreService["generate"]> {
    const context = await this.context(submissionId, expectedRevision, language, session, true);
    const contextHash = createHash("sha256").update(JSON.stringify(context)).digest("hex");
    const input = validateGradingInput({ instructions: context.instructions, answer: context.answer, rubric: context.rubric, language });
    const identity = { ownerId: session.user.id, submissionId, contextHash, language };
    if (!await this.store.find(identity)) await this.ai.resolveTask("GRADING_ASSIST");
    const suggestion = await this.store.generate(identity, async () => {
      const result = await this.ai.suggestGrading(input);
      if (context.sources && result.criteria.some((item) => item.evidence.some((quote) => !context.sources!.some((source) => source.text.includes(quote))))) throw new ServiceUnavailableException("Dẫn chứng AI phải nằm nguyên vẹn trong một nguồn bài làm. Gợi ý chưa được chấp nhận.");
      return { ...result, submissionRevision: context.submissionRevision, assignmentVersion: context.assignmentVersion, contextHash, ...(context.sources ? { sources: context.sources } : {}) };
    });
    const current = await this.context(submissionId, expectedRevision, language, session);
    if (createHash("sha256").update(JSON.stringify(current)).digest("hex") !== contextHash) throw new ConflictException("Bài làm hoặc rubric đã thay đổi trong lúc AI xử lý. Gợi ý chưa được áp dụng; hãy tải lại bài.");
    return suggestion;
  }

  /** Kiểm tra lại quyền và nguồn sau khi đọc trạng thái; không cần model đang hoạt động. */
  async inspect(submissionId: string, expectedRevision: number, language: ExamLanguage, session: AuthenticatedSession): Promise<{ state: "NOT_REQUESTED" | "GENERATING" | "READY" | "UNCERTAIN"; suggestionId?: string; result?: SavedGradingSuggestion | null }> {
    let context: Awaited<ReturnType<AcademicService["gradingAiContext"]>>;
    try { context = await this.context(submissionId, expectedRevision, language, session); }
    catch (error) { if (error instanceof GradingExtractionMissingError) return { state: "NOT_REQUESTED" }; throw error; }
    validateGradingInput({ instructions: context.instructions, answer: context.answer, rubric: context.rubric, language });
    const contextHash = createHash("sha256").update(JSON.stringify(context)).digest("hex");
    const row = await this.store.find({ ownerId: session.user.id, submissionId, contextHash, language });
    const current = await this.context(submissionId, expectedRevision, language, session);
    if (createHash("sha256").update(JSON.stringify(current)).digest("hex") !== contextHash) throw new ConflictException("Bài làm hoặc rubric đã thay đổi trong lúc đọc gợi ý AI. Hãy tải lại bài.");
    if (row?.state === "RETRY_AUTHORIZED") return { state: "NOT_REQUESTED" };
    return row ? { state: row.state, suggestionId: row.id, result: row.result } : { state: "NOT_REQUESTED" };
  }
}
