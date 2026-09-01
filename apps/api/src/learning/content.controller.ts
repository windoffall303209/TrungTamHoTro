import { BadRequestException, Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, StreamableFile, UploadedFile, UseInterceptors } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { FileInterceptor } from "@nestjs/platform-express";
import type { Request } from "express";
import type { AuthenticatedSession } from "../auth/auth.service.js";
import { CurrentSession } from "../auth/current-session.decorator.js";
import { RequirePermissions } from "../auth/require-permissions.decorator.js";
import { fileContentDisposition, normalizeMultipartFileName } from "../infrastructure/file-transfer.js";
import { CreateExamDto, CreateMaterialDto, CreateQuestionDto, GradeAttemptDto, ImportQuestionsDto, RequestRegradeDto, ReviewExamDto, ReviewMaterialDto, ReviewQuestionDto, SaveAnswerDto, UpdateMaterialDto, UpdateQuestionDto, UploadMaterialDto } from "./learning.dto.js";
import { LearningService, type MaterialAccessAction, type MaterialSearchResult, type UploadedMaterialFile } from "./learning.service.js";
import type { ExamApprovalRecord, ExamAttempt, FileReviewRecord, GradeHistoryRecord, LearnerExamSummary, LearnerResult, LearningExam, LearningMaterial, LearningQuestion, MaterialVersionSnapshot, QuestionImportResult, RegradeRequest } from "./learning.types.js";
import { AiProviderService, type QuestionScanResult } from "../system/ai-provider.service.js";

@ApiTags("Content & Assessment")
@Controller()
export class ContentController {
  constructor(private readonly learning: LearningService, private readonly aiProviders: AiProviderService) {}

  @Get("materials") @RequirePermissions("material:view")
  listMaterials(@CurrentSession() session: AuthenticatedSession, @Query("query") query?: string): Promise<LearningMaterial[]> { return this.learning.listMaterials(session.roleCode, query, session.user.id); }

  @Get("learner/materials/search") @RequirePermissions("material:view")
  searchMaterials(
    @CurrentSession() session: AuthenticatedSession,
    @Query("query") query?: string,
    @Query("classId") classId?: string,
    @Query("folder") folder?: string,
    @Query("mimeType") mimeType?: string,
    @Query("tag") tag?: string,
    @Query("page") rawPage?: string,
    @Query("pageSize") rawPageSize?: string,
  ): Promise<MaterialSearchResult> {
    return this.learning.searchAccessibleMaterials({ query, classId, folder, mimeType, tag, page: Number(rawPage), pageSize: Number(rawPageSize) }, session.user.id);
  }

  @Post("instructor/classes/:classId/materials") @RequirePermissions("material:manage")
  createMaterial(@Param("classId") classId: string, @Body() input: CreateMaterialDto, @CurrentSession() session: AuthenticatedSession): Promise<LearningMaterial> { return this.learning.createMaterial(classId, input, undefined, session.user.id); }

  @Post("instructor/classes/:classId/material-uploads") @RequirePermissions("material:manage")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: 500_000_000, files: 1 } }))
  uploadMaterial(
    @Param("classId") classId: string,
    @Body() input: UploadMaterialDto,
    @CurrentSession() session: AuthenticatedSession,
    @UploadedFile() file?: { originalname: string; mimetype: string; size: number; buffer: Buffer },
  ): Promise<LearningMaterial> {
    if (!file) throw new BadRequestException("Cần chọn một tệp học liệu.");
    const originalName = normalizeMultipartFileName(file.originalname);
    const upload: UploadedMaterialFile = { originalName, mimeType: file.mimetype, size: file.size, buffer: file.buffer };
    return this.learning.createMaterial(classId, {
      name: originalName,
      mimeType: file.mimetype,
      sizeBytes: file.size,
      folder: input.folder,
      tags: input.tags.split(",").map((tag) => tag.trim()).filter(Boolean),
    }, upload, session.user.id);
  }

  @Get("materials/:materialId/versions") @RequirePermissions("material:view")
  listMaterialVersions(@Param("materialId") materialId: string, @CurrentSession() session: AuthenticatedSession): Promise<MaterialVersionSnapshot[]> { return this.learning.listMaterialVersions(materialId, session.roleCode, session.user.id); }

  @Get("materials/:materialId/versions/:version/access") @RequirePermissions("material:view")
  getMaterialVersionAccess(@Param("materialId") materialId: string, @Param("version") version: string, @CurrentSession() session: AuthenticatedSession, @Query("action") rawAction = "DOWNLOAD"): Promise<{ url: string; expiresAt: string }> {
    return this.learning.createMaterialVersionAccess(materialId, Number(version), session.roleCode, rawAction === "PREVIEW" ? "PREVIEW" : "DOWNLOAD", session.user.id);
  }

  @Get("materials/:materialId/versions/:version/download") @RequirePermissions("material:view")
  async downloadMaterialVersion(@Param("materialId") materialId: string, @Param("version") version: string, @Query("expires") expires: string, @Query("signature") signature: string, @Query("action") rawAction: string, @CurrentSession() session: AuthenticatedSession): Promise<StreamableFile> {
    const download = await this.learning.readMaterialVersionDownload(materialId, Number(version), Number(expires), signature ?? "", session.roleCode, rawAction === "PREVIEW" ? "PREVIEW" : "DOWNLOAD", session.user.id);
    return new StreamableFile(download.buffer, { type: download.mimeType, disposition: fileContentDisposition(rawAction === "PREVIEW" ? "inline" : "attachment", download.fileName), length: download.buffer.length });
  }

  @Post("instructor/materials/:materialId/versions") @RequirePermissions("material:manage")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: 500_000_000, files: 1 } }))
  uploadMaterialVersion(
    @Param("materialId") materialId: string,
    @Body() input: UploadMaterialDto,
    @CurrentSession() session: AuthenticatedSession,
    @UploadedFile() file?: { originalname: string; mimetype: string; size: number; buffer: Buffer },
  ): Promise<LearningMaterial> {
    if (!file) throw new BadRequestException("Cần chọn tệp cho phiên bản mới.");
    return this.learning.replaceMaterialVersion(materialId, { folder: input.folder, tags: input.tags.split(",").map((tag) => tag.trim()).filter(Boolean) }, { originalName: normalizeMultipartFileName(file.originalname), mimeType: file.mimetype, size: file.size, buffer: file.buffer }, session.user.id);
  }

  @Patch("instructor/materials/:materialId") @RequirePermissions("material:manage")
  updateMaterial(@Param("materialId") materialId: string, @Body() input: UpdateMaterialDto, @CurrentSession() session: AuthenticatedSession): Promise<LearningMaterial> { return this.learning.updateMaterial(materialId, input, session.user.id); }

  @Patch("manager/materials/:materialId/review") @RequirePermissions("class:manage")
  reviewMaterial(@Param("materialId") materialId: string, @Body() input: ReviewMaterialDto, @CurrentSession() session: AuthenticatedSession): Promise<LearningMaterial> { return this.learning.reviewClassMaterial(materialId, input.action, input.reason, session.user.id); }

  @Get("manager/materials/:materialId/reviews") @RequirePermissions("class:manage")
  listMaterialReviews(@Param("materialId") materialId: string): Promise<FileReviewRecord[]> { return this.learning.listMaterialReviews(materialId); }

  @Get("materials/:materialId/access") @RequirePermissions("material:view")
  getMaterialAccess(
    @Param("materialId") materialId: string,
    @CurrentSession() session: AuthenticatedSession,
    @Query("action") rawAction = "DOWNLOAD",
  ): Promise<{ url: string; expiresAt: string }> {
    const action = rawAction === "PREVIEW" ? "PREVIEW" : "DOWNLOAD";
    return this.learning.createMaterialAccess(materialId, session.roleCode, action, session.user.id);
  }

  @Get("materials/:materialId/download") @RequirePermissions("material:view")
  async downloadMaterial(
    @Param("materialId") materialId: string,
    @Query("expires") expires: string,
    @Query("signature") signature: string,
    @Query("action") rawAction: string,
    @CurrentSession() session: AuthenticatedSession,
    @Req() request: Request,
  ): Promise<StreamableFile> {
    const action: MaterialAccessAction = rawAction === "PREVIEW" ? "PREVIEW" : "DOWNLOAD";
    const download = await this.learning.readMaterialDownload(materialId, Number(expires), signature ?? "", session.roleCode, action, {
      ipAddress: request.ip,
      userAgent: request.header("user-agent"),
    }, session.user.id);
    return new StreamableFile(download.buffer, {
      type: download.mimeType,
      disposition: fileContentDisposition(action === "PREVIEW" ? "inline" : "attachment", download.fileName),
      length: download.buffer.length,
    });
  }

  @Get("instructor/question-bank/questions") @RequirePermissions("question:view")
  listQuestions(
    @Query("query") query?: string,
    @Query("courseId") courseId?: string,
    @Query("type") type?: string,
    @Query("difficulty") difficulty?: string,
    @Query("tag") tag?: string,
    @Query("status") status?: string,
  ): Promise<LearningQuestion[]> {
    const normalizedStatus = status?.trim().toUpperCase();
    if (normalizedStatus && normalizedStatus !== "DRAFT" && normalizedStatus !== "PENDING_REVIEW" && normalizedStatus !== "PUBLISHED") {
      throw new BadRequestException("Trạng thái câu hỏi phải là DRAFT, PENDING_REVIEW hoặc PUBLISHED.");
    }
    return this.learning.listQuestions({
      query,
      courseId,
      type,
      difficulty: difficulty ? Number(difficulty) : undefined,
      tag,
      status: normalizedStatus as LearningQuestion["status"] | undefined,
    });
  }

  @Post("instructor/question-bank/questions") @RequirePermissions("question:manage")
  createQuestion(@Body() input: CreateQuestionDto, @CurrentSession() session: AuthenticatedSession): Promise<LearningQuestion> { return this.learning.createQuestion(input, session.user.id); }

  @Patch("instructor/question-bank/questions/:questionId") @RequirePermissions("question:manage")
  updateQuestion(@Param("questionId") questionId: string, @Body() input: UpdateQuestionDto, @CurrentSession() session: AuthenticatedSession): Promise<LearningQuestion> { return this.learning.updateQuestion(questionId, input, session.user.id); }

  @Post("instructor/question-bank/questions/:questionId/image") @RequirePermissions("question:manage")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: 8 * 1024 * 1024, files: 1 } }))
  uploadQuestionImage(
    @Param("questionId") questionId: string,
    @UploadedFile() file?: { originalname: string; mimetype: string; size: number; buffer: Buffer },
  ): Promise<LearningQuestion> {
    if (!file) throw new BadRequestException("Cần chọn một ảnh cho câu hỏi.");
    return this.learning.uploadQuestionImage(questionId, { originalName: normalizeMultipartFileName(file.originalname), mimeType: file.mimetype, size: file.size, buffer: file.buffer });
  }

  @Delete("instructor/question-bank/questions/:questionId/image") @RequirePermissions("question:manage")
  removeQuestionImage(@Param("questionId") questionId: string): Promise<LearningQuestion> { return this.learning.removeQuestionImage(questionId); }

  @Get("question-bank/questions/:questionId/image") @RequirePermissions("exam:view")
  async readQuestionImage(@Param("questionId") questionId: string, @CurrentSession() session: AuthenticatedSession): Promise<StreamableFile> {
    const image = await this.learning.readQuestionImage(questionId, session.roleCode, session.user.id);
    return new StreamableFile(image.buffer, { type: image.mimeType, disposition: fileContentDisposition("inline", image.fileName), length: image.buffer.length });
  }

  @Post("instructor/question-bank/questions/:questionId/publish") @RequirePermissions("question:manage")
  publishQuestion(@Param("questionId") questionId: string, @CurrentSession() session: AuthenticatedSession): Promise<LearningQuestion> { return this.learning.publishQuestion(questionId, session.user.id); }

  @Post("admin/question-bank/questions/:questionId/review") @RequirePermissions("system:configure")
  reviewQuestion(@Param("questionId") questionId: string, @Body() input: ReviewQuestionDto, @CurrentSession() session: AuthenticatedSession): Promise<LearningQuestion> { return this.learning.reviewQuestion(questionId, input.decision, input.reviewNote, session.user.id); }

  @Post("instructor/question-bank/questions/import") @RequirePermissions("question:manage")
  importQuestions(@Body() input: ImportQuestionsDto, @CurrentSession() session: AuthenticatedSession): Promise<QuestionImportResult[]> { return this.learning.importQuestions(input.questions, session.user.id); }

  @Post("instructor/question-bank/scan-image") @RequirePermissions("question:manage")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: 12 * 1024 * 1024, files: 1 } }))
  scanQuestionImage(
    @Body("providerId") providerId: string | undefined,
    @UploadedFile() file?: { originalname: string; mimetype: string; size: number; buffer: Buffer },
  ): Promise<QuestionScanResult> {
    if (!file) throw new BadRequestException("Cần chọn ảnh đề thi để quét.");
    return this.aiProviders.scanImage({ providerId: providerId?.trim() || undefined, fileName: normalizeMultipartFileName(file.originalname), mimeType: file.mimetype, buffer: file.buffer });
  }

  @Get("instructor/question-bank/ai-providers") @RequirePermissions("question:manage")
  async listQuestionScanProviders(): Promise<Awaited<ReturnType<AiProviderService["list"]>>> {
    return (await this.aiProviders.list()).filter((item) => item.enabled && item.hasApiKey);
  }

  @Get("exams") @RequirePermissions("exam:view")
  listExams(@CurrentSession() session: AuthenticatedSession): Promise<LearningExam[]> { return this.learning.listExams(session.roleCode, session.user.id); }

  @Get("learner/classes/:classId/exams") @RequirePermissions("exam:view")
  listLearnerExams(@Param("classId") classId: string, @CurrentSession() session: AuthenticatedSession): Promise<LearnerExamSummary[]> { return this.learning.listLearnerExamSummaries(classId, session.user.id); }

  @Get("learner/exams") @RequirePermissions("exam:view")
  listAllLearnerExams(@CurrentSession() session: AuthenticatedSession): Promise<LearnerExamSummary[]> { return this.learning.listLearnerExamSummaries(undefined, session.user.id); }

  @Get("learner/exams/:examId/questions") @RequirePermissions("exam:view")
  getLearnerExamQuestions(@Param("examId") examId: string, @CurrentSession() session: AuthenticatedSession): Promise<LearningQuestion[]> { return this.learning.getExamQuestions(examId, session.user.id); }

  @Get("instructor/exams/:examId/preview") @RequirePermissions("exam:manage")
  getInstructorExamPreview(@Param("examId") examId: string, @CurrentSession() session: AuthenticatedSession): Promise<LearningQuestion[]> { return this.learning.getInstructorExamPreview(examId, session.user.id); }

  @Post("instructor/exams") @RequirePermissions("exam:manage")
  createExam(@Body() input: CreateExamDto, @CurrentSession() session: AuthenticatedSession): Promise<LearningExam> { return this.learning.createExam(input, session.user.id); }

  @Post("instructor/exams/:examId/publish") @RequirePermissions("exam:manage")
  publishExam(@Param("examId") examId: string, @CurrentSession() session: AuthenticatedSession): Promise<LearningExam> { return this.learning.submitExamForReview(examId, session.user.id); }

  @Post("manager/exams/:examId/approve") @RequirePermissions("class:manage")
  approveExam(@Param("examId") examId: string, @Body() input: ReviewExamDto, @CurrentSession() session: AuthenticatedSession): Promise<LearningExam> { return this.learning.reviewExam(examId, input.decision, input.reviewNote, session.user.id); }

  @Get("manager/exams/:examId/approvals") @RequirePermissions("class:manage")
  listExamApprovals(@Param("examId") examId: string): Promise<ExamApprovalRecord[]> { return this.learning.listExamApprovals(examId); }

  @Post("learner/exams/:examId/attempts") @RequirePermissions("exam:view")
  startAttempt(@Param("examId") examId: string, @CurrentSession() session: AuthenticatedSession): Promise<ExamAttempt> { return this.learning.startAttempt(examId, session.user.id); }

  @Patch("learner/exam-attempts/:attemptId/answers") @RequirePermissions("exam:view")
  saveAnswer(@Param("attemptId") attemptId: string, @Body() input: SaveAnswerDto, @CurrentSession() session: AuthenticatedSession): Promise<ExamAttempt> { return this.learning.saveAnswer(attemptId, input.questionId, input.answers, session.user.id); }

  @Post("learner/exam-attempts/:attemptId/submit") @RequirePermissions("exam:view")
  submitAttempt(@Param("attemptId") attemptId: string, @CurrentSession() session: AuthenticatedSession): Promise<ExamAttempt> { return this.learning.submitAttempt(attemptId, session.user.id); }

  @Get("learner/attempts/:attemptId/result") @RequirePermissions("exam:view")
  getAttempt(@Param("attemptId") attemptId: string, @CurrentSession() session: AuthenticatedSession): Promise<LearnerResult> { return this.learning.getLearnerResult(attemptId, session.user.id); }

  @Get("learner/results") @RequirePermissions("exam:view")
  listLearnerResults(@CurrentSession() session: AuthenticatedSession): Promise<LearnerResult[]> { return this.learning.listLearnerResults(session.user.id); }

  @Post("learner/attempts/:attemptId/regrade-requests") @RequirePermissions("exam:view")
  requestRegrade(@Param("attemptId") attemptId: string, @Body() input: RequestRegradeDto, @CurrentSession() session: AuthenticatedSession): Promise<RegradeRequest> {
    return this.learning.requestRegrade(attemptId, input.reason, session.user.id);
  }

  @Get("instructor/exam-attempts") @RequirePermissions("exam:manage")
  listAttempts(@CurrentSession() session: AuthenticatedSession, @Query("examId") examId?: string): Promise<ExamAttempt[]> { return this.learning.listAttempts(examId, session.user.id); }

  @Patch("instructor/exam-attempts/:attemptId/grade") @RequirePermissions("exam:manage")
  gradeAttempt(@Param("attemptId") attemptId: string, @Body() input: GradeAttemptDto, @CurrentSession() session: AuthenticatedSession): Promise<ExamAttempt> { return this.learning.gradeAttempt(attemptId, input.score, input.feedback, input.correctionReason, session.user.id); }

  @Get("instructor/exam-attempts/:attemptId/grade-history") @RequirePermissions("exam:manage")
  listGradeHistory(@Param("attemptId") attemptId: string, @CurrentSession() session: AuthenticatedSession): Promise<GradeHistoryRecord[]> { return this.learning.listGradeHistory(attemptId, session.user.id); }
}
