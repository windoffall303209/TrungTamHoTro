import { BadRequestException, ConflictException, Injectable, Optional, ServiceUnavailableException } from "@nestjs/common";
import { createHash } from "node:crypto";
import type { AuthenticatedSession } from "../../../auth/auth.service.js";
import { AiProviderService, type ExamLanguage } from "../../system/ai/ai-provider.service.js";
import { AcademicService } from "../academic/academic.service.js";
import { AiGradingStoreService, type SavedGradingSuggestion, type StoredGradingSuggestion } from "./ai-grading-store.service.js";
import { validateGradingInput } from "../../system/ai/ai-grading-suggestion.js";
import { stripInvisibleText } from "../../system/ai/ai-untrusted-content.js";
import { PrismaService } from "../../../database/prisma.service.js";
import { AiDocumentExtractionStore } from "./ai-document-extraction-store.js";
import { AiGradingDocumentReader, GradingExtractionMissingError } from "./ai-grading-document-reader.js";
import {
  combineGradingSources,
  doesSourcesMatchMetadata,
  gradingMetadataFingerprint,
  isGradingDocument,
  isGradingDocx,
  type GradingAiContextMetadata,
  type GradingAnswerSource,
} from "./ai-grading-source.js";

type GradingContextPayload = Awaited<ReturnType<AcademicService["gradingAiContext"]>>;
type InspectResult = { state: "NOT_REQUESTED" | "GENERATING" | "READY" | "UNCERTAIN"; suggestionId?: string; result?: SavedGradingSuggestion | null };

@Injectable()
/** Điều phối gợi ý riêng cho giảng viên; không gọi thao tác lưu điểm hoặc gửi phản hồi. */
export class AiGradingAssistService {
  constructor(private readonly academic: AcademicService, private readonly ai: AiProviderService, @Optional() private readonly store: AiGradingStoreService = new AiGradingStoreService(), @Optional() private readonly prisma?: PrismaService) {}

  /** Xác thực ngôn ngữ AI hợp lệ trước khi đọc metadata, cache hoặc gọi nhà cung cấp. */
  private assertValidLanguage(language: ExamLanguage): void {
    if (!["VI", "EN", "BILINGUAL"].includes(language)) throw new BadRequestException("Ngôn ngữ AI không hợp lệ.");
  }

  /** Tạo bộ đọc tài liệu chấm bài dùng kho trích xuất OCR gắn với Prisma hiện hành. */
  private createDocumentReader(): AiGradingDocumentReader {
    return new AiGradingDocumentReader(new AiDocumentExtractionStore(this.prisma), this.ai);
  }

  /** Tính SHA-256 cố định cho ngữ cảnh chấm bài để giữ tương thích hoàn toàn với bản ghi đã lưu. */
  private hashContext(context: GradingContextPayload): string {
    return createHash("sha256").update(JSON.stringify(context)).digest("hex");
  }

  /** Kiểm tra ngôn ngữ trước OCR có phí; dùng bản lưu chỉ đọc để xem trước và kiểm tra nguồn lần cuối. */
  private context(submissionId: string, revision: number, language: ExamLanguage, session: AuthenticatedSession, generate = false): ReturnType<AcademicService["gradingAiContext"]> {
    this.assertValidLanguage(language);
    const reader = this.createDocumentReader();
    return this.academic.gradingAiContext(submissionId, revision, session, (file) => reader.read(submissionId, session.user.id, file, generate));
  }

  /** Tái xác minh quyền giảng dạy, trạng thái lớp và metadata DB sau khi tra cứu mà không tải lại object storage. */
  private async assertMetadataUnchanged(
    submissionId: string,
    expectedRevision: number,
    session: AuthenticatedSession,
    expectedFingerprint: string,
    conflictMessage: string,
  ): Promise<void> {
    const current = await this.academic.gradingAiMetadata(submissionId, expectedRevision, session, true);
    if (gradingMetadataFingerprint(current) !== expectedFingerprint) throw new ConflictException(conflictMessage);
  }

  /** Tái xác minh metadata DB khớp hoàn toàn ngữ cảnh đã gửi AI sau khi sinh xong, tránh tải tệp lần hai. */
  private async assertContextStillMatchesMetadata(
    submissionId: string,
    expectedRevision: number,
    session: AuthenticatedSession,
    expectedContext: GradingContextPayload,
    conflictMessage: string,
  ): Promise<void> {
    const current = await this.academic.gradingAiMetadata(submissionId, expectedRevision, session, true);
    const sameBase =
      current.submissionId === expectedContext.submissionId &&
      current.submissionRevision === expectedContext.submissionRevision &&
      current.assignmentVersion === expectedContext.assignmentVersion &&
      current.instructions === expectedContext.instructions &&
      JSON.stringify(current.rubric) === JSON.stringify(expectedContext.rubric);
    const sameSources = expectedContext.sources
      ? doesSourcesMatchMetadata(current, expectedContext.sources)
      : current.attachments.length === 0 && current.inlineContent === expectedContext.answer;
    if (!sameBase || !sameSources) throw new ConflictException(conflictMessage);
  }

  /** Đối chiếu một bản ghi READY đã lưu với metadata hiện hành và OCR cache để phát lại mà không cần đọc object storage. */
  private matchesSavedReadyCandidate(
    metadata: GradingAiContextMetadata,
    candidate: StoredGradingSuggestion,
    cachedOcrTexts: Map<string, string>,
    language: ExamLanguage,
  ): boolean {
    if (candidate.state !== "READY" || !candidate.result?.sources) return false;
    if (!doesSourcesMatchMetadata(metadata, candidate.result.sources)) return false;
    for (const source of candidate.result.sources) {
      if (source.attachmentId && cachedOcrTexts.has(source.attachmentId) && source.text !== cachedOcrTexts.get(source.attachmentId)) {
        return false;
      }
    }
    const candidateContext: GradingContextPayload = {
      submissionId: metadata.submissionId,
      submissionRevision: metadata.submissionRevision,
      assignmentVersion: metadata.assignmentVersion,
      instructions: metadata.instructions,
      answer: combineGradingSources(candidate.result.sources),
      rubric: metadata.rubric,
      sources: candidate.result.sources,
    };
    if (this.hashContext(candidateContext) !== candidate.contextHash) return false;
    validateGradingInput({
      instructions: candidateContext.instructions,
      answer: candidateContext.answer,
      rubric: candidateContext.rubric,
      language,
    });
    return true;
  }

  /** Chuẩn hóa kết quả inspect từ bản ghi trạng thái tìm được trong kho gợi ý. */
  private toInspectResult(row: StoredGradingSuggestion | null): InspectResult {
    if (!row || row.state === "RETRY_AUTHORIZED") return { state: "NOT_REQUESTED" };
    return { state: row.state, suggestionId: row.id, result: row.result };
  }

  /** Đọc nguồn có quyền trước khi gọi AI và loại kết quả nếu quyền/bài làm/rubric thay đổi trong lúc chờ. */
  async suggest(submissionId: string, expectedRevision: number, language: ExamLanguage, session: AuthenticatedSession): ReturnType<AiGradingStoreService["generate"]> {
    const context = await this.context(submissionId, expectedRevision, language, session, true);
    const contextHash = this.hashContext(context);
    const input = validateGradingInput({ instructions: context.instructions, answer: context.answer, rubric: context.rubric, language });
    const identity = { ownerId: session.user.id, submissionId, contextHash, language };
    if (!await this.store.find(identity)) await this.ai.resolveTask("GRADING_ASSIST");
    const suggestion = await this.store.generate(identity, async () => {
      const result = await this.ai.suggestGrading(input);
      if (context.sources && result.criteria.some((item) => item.evidence.some((quote) => !context.sources!.some((source) => stripInvisibleText(source.text).includes(quote))))) throw new ServiceUnavailableException("Dẫn chứng AI phải nằm nguyên vẹn trong một nguồn bài làm. Gợi ý chưa được chấp nhận.");
      return { ...result, submissionRevision: context.submissionRevision, assignmentVersion: context.assignmentVersion, contextHash, ...(context.sources ? { sources: context.sources } : {}) };
    });
    await this.assertContextStillMatchesMetadata(
      submissionId,
      expectedRevision,
      session,
      context,
      "Bài làm hoặc rubric đã thay đổi trong lúc AI xử lý. Gợi ý chưa được áp dụng; hãy tải lại bài.",
    );
    return suggestion;
  }

  /** Inspect gợi ý dựa trên metadata DB và cache đã lưu; tránh tải object storage và không đọc nguồn hai lần. */
  async inspect(submissionId: string, expectedRevision: number, language: ExamLanguage, session: AuthenticatedSession): Promise<InspectResult> {
    this.assertValidLanguage(language);
    const metadata = await this.academic.gradingAiMetadata(submissionId, expectedRevision, session, true);
    const beforeFingerprint = gradingMetadataFingerprint(metadata);
    const conflictMessage = "Bài làm hoặc rubric đã thay đổi trong lúc đọc gợi ý AI. Hãy tải lại bài.";

    if (!metadata.attachments.length) {
      const inlineContext: GradingContextPayload = {
        submissionId: metadata.submissionId,
        submissionRevision: metadata.submissionRevision,
        assignmentVersion: metadata.assignmentVersion,
        instructions: metadata.instructions,
        answer: metadata.inlineContent,
        rubric: metadata.rubric,
      };
      validateGradingInput({ instructions: inlineContext.instructions, answer: inlineContext.answer, rubric: inlineContext.rubric, language });
      const contextHash = this.hashContext(inlineContext);
      const row = await this.store.find({ ownerId: session.user.id, submissionId, contextHash, language });
      await this.assertMetadataUnchanged(submissionId, expectedRevision, session, beforeFingerprint, conflictMessage);
      return this.toInspectResult(row);
    }

    const reader = this.createDocumentReader();
    const cachedOcrTexts = new Map<string, string>();
    for (const file of metadata.attachments) {
      if (isGradingDocument(file.mimeType, file.originalName) && !isGradingDocx(file.mimeType, file.originalName)) {
        try {
          const extracted = await reader.readCached(submissionId, session.user.id, {
            attachmentId: file.id,
            fileName: file.originalName,
            mimeType: file.mimeType,
            checksum: file.checksum,
            sizeBytes: file.sizeBytes,
            submissionRevision: metadata.submissionRevision,
          });
          cachedOcrTexts.set(file.id, extracted);
        } catch (error) {
          if (error instanceof GradingExtractionMissingError) {
            await this.assertMetadataUnchanged(submissionId, expectedRevision, session, beforeFingerprint, conflictMessage);
            return { state: "NOT_REQUESTED" };
          }
          throw error;
        }
      }
    }

    const candidates = await this.store.listForSubmission(session.user.id, submissionId, language);
    for (const candidate of candidates) {
      if (this.matchesSavedReadyCandidate(metadata, candidate, cachedOcrTexts, language)) {
        await this.assertMetadataUnchanged(submissionId, expectedRevision, session, beforeFingerprint, conflictMessage);
        return this.toInspectResult(candidate);
      }
    }

    const pendingCandidates = candidates.filter((item) => item.state === "GENERATING" || item.state === "UNCERTAIN");
    if (!pendingCandidates.length) {
      await this.assertMetadataUnchanged(submissionId, expectedRevision, session, beforeFingerprint, conflictMessage);
      return { state: "NOT_REQUESTED" };
    }

    // Nếu mọi tệp đính kèm đều là PDF/ảnh đã có bản lưu OCR, tính contextHash trực tiếp từ cache mà không tải tệp.
    const allCachedOcr = metadata.attachments.every((file) => cachedOcrTexts.has(file.id));
    if (allCachedOcr) {
      const sources: GradingAnswerSource[] = metadata.inlineContent.trim()
        ? [{ attachmentId: null, name: "Nội dung bài làm", checksum: null, text: metadata.inlineContent }]
        : [];
      for (const file of metadata.attachments) {
        sources.push({ attachmentId: file.id, name: file.originalName, checksum: file.checksum, text: cachedOcrTexts.get(file.id)! });
      }
      const cachedContext: GradingContextPayload = {
        submissionId: metadata.submissionId,
        submissionRevision: metadata.submissionRevision,
        assignmentVersion: metadata.assignmentVersion,
        instructions: metadata.instructions,
        answer: combineGradingSources(sources),
        rubric: metadata.rubric,
        sources,
      };
      validateGradingInput({ instructions: cachedContext.instructions, answer: cachedContext.answer, rubric: cachedContext.rubric, language });
      const contextHash = this.hashContext(cachedContext);
      const matched = pendingCandidates.find((item) => item.contextHash === contextHash) ?? null;
      await this.assertMetadataUnchanged(submissionId, expectedRevision, session, beforeFingerprint, conflictMessage);
      return this.toInspectResult(matched);
    }

    // Chỉ đọc tệp TXT/DOCX đúng một lần khi thật sự có phiên GENERATING/UNCERTAIN chưa có snapshot sources; hậu kiểm vẫn chỉ đọc metadata DB.
    const context = await this.context(submissionId, expectedRevision, language, session, false);
    validateGradingInput({ instructions: context.instructions, answer: context.answer, rubric: context.rubric, language });
    const contextHash = this.hashContext(context);
    const row = await this.store.find({ ownerId: session.user.id, submissionId, contextHash, language });
    await this.assertMetadataUnchanged(submissionId, expectedRevision, session, beforeFingerprint, conflictMessage);
    return this.toInspectResult(row);
  }
}
