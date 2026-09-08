import { ConflictException, Injectable } from "@nestjs/common";
import { createHash } from "node:crypto";
import type { AuthenticatedSession } from "../auth/auth.service.js";
import { AiProviderService, type ExamLanguage } from "../system/ai-provider.service.js";
import { AcademicService } from "./academic.service.js";

@Injectable()
/** Điều phối gợi ý riêng cho giảng viên; không gọi thao tác lưu điểm hoặc gửi phản hồi. */
export class AiGradingAssistService {
  constructor(private readonly academic: AcademicService, private readonly ai: AiProviderService) {}

  /** Đọc nguồn có quyền trước khi gọi AI và loại kết quả nếu quyền/bài làm/rubric thay đổi trong lúc chờ. */
  async suggest(submissionId: string, expectedRevision: number, language: ExamLanguage, session: AuthenticatedSession): Promise<Awaited<ReturnType<AiProviderService["suggestGrading"]>> & { submissionRevision: number; assignmentVersion: number; contextHash: string }> {
    const context = await this.academic.gradingAiContext(submissionId, expectedRevision, session);
    const contextHash = createHash("sha256").update(JSON.stringify(context)).digest("hex");
    const suggestion = await this.ai.suggestGrading({ instructions: context.instructions, answer: context.answer, rubric: context.rubric, language });
    const current = await this.academic.gradingAiContext(submissionId, expectedRevision, session);
    if (createHash("sha256").update(JSON.stringify(current)).digest("hex") !== contextHash) throw new ConflictException("Bài làm hoặc rubric đã thay đổi trong lúc AI xử lý. Gợi ý chưa được áp dụng; hãy tải lại bài.");
    return { ...suggestion, submissionRevision: context.submissionRevision, assignmentVersion: context.assignmentVersion, contextHash };
  }
}
