import { BadRequestException, Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, StreamableFile, UploadedFile, UseInterceptors } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { FileInterceptor } from "@nestjs/platform-express";
import type { Request } from "express";
import type { AuthenticatedSession } from "../auth/auth.service.js";
import { CurrentSession } from "../auth/current-session.decorator.js";
import { RequirePermissions } from "../auth/require-permissions.decorator.js";
import { fileContentDisposition, normalizeMultipartFileName } from "../infrastructure/file-transfer.js";
import { CreateExamDto, CreateMaterialDto, CreateQuestionDto, GenerateAiExamDto, GradeAttemptDto, ImportQuestionsDto, RequestRegradeDto, ResolveRegradeDto, ReviewExamDto, ReviewMaterialDto, ReviewQuestionDto, SaveAnswerDto, UpdateExamDto, UpdateMaterialDto, UpdateQuestionDto, UploadMaterialDto } from "./learning.dto.js";
import { LearningService, type MaterialAccessAction, type MaterialSearchResult, type UploadedMaterialFile } from "./learning.service.js";
import type { AiGeneratedExamResult, ExamApprovalRecord, ExamAttempt, ExamAttemptReview, FileReviewRecord, GradeHistoryRecord, LearnerExamSummary, LearnerResult, LearningExam, LearningMaterial, LearningQuestion, MaterialVersionSnapshot, QuestionImportResult, RegradeRequest } from "./learning.types.js";
import { AiProviderService, type QuestionScanResult } from "../system/ai-provider.service.js";

@ApiTags("Content & Assessment")
@Controller()
/** API học liệu, ngân hàng câu hỏi, AI scan, đề thi và vòng đời lượt làm bài. */
export class ContentController {
  constructor(private readonly learning: LearningService, private readonly aiProviders: AiProviderService) {}

  @Get("materials") @RequirePermissions("material:view")
  /** Liệt kê học liệu theo vai trò, người dùng và từ khóa. */
  listMaterials(@CurrentSession() session: AuthenticatedSession, @Query("query") query?: string): Promise<LearningMaterial[]> { return this.learning.listMaterials(session.roleCode, query, session.user.id); }

  @Get("learner/materials/search") @RequirePermissions("material:view")
  /** Tìm học liệu học viên được truy cập với bộ lọc và phân trang đã chuẩn hóa trong service. */
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
  /** Tạo metadata học liệu không kèm tệp cho lớp giảng viên. */
  createMaterial(@Param("classId") classId: string, @Body() input: CreateMaterialDto, @CurrentSession() session: AuthenticatedSession): Promise<LearningMaterial> { return this.learning.createMaterial(classId, input, undefined, session.user.id); }

  @Post("instructor/classes/:classId/material-uploads") @RequirePermissions("material:manage")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: 500_000_000, files: 1 } }))
  /** Chuẩn hóa tên/tags của tệp multipart rồi giao service quét virus và lưu object. */
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
  /** Liệt kê lịch sử phiên bản học liệu sau khi kiểm tra quyền xem. */
  listMaterialVersions(@Param("materialId") materialId: string, @CurrentSession() session: AuthenticatedSession): Promise<MaterialVersionSnapshot[]> { return this.learning.listMaterialVersions(materialId, session.roleCode, session.user.id); }

  @Get("materials/:materialId/versions/:version/access") @RequirePermissions("material:view")
  /** Phát URL ký ngắn hạn để xem hoặc tải một phiên bản cũ. */
  getMaterialVersionAccess(@Param("materialId") materialId: string, @Param("version") version: string, @CurrentSession() session: AuthenticatedSession, @Query("action") rawAction = "DOWNLOAD"): Promise<{ url: string; expiresAt: string }> {
    return this.learning.createMaterialVersionAccess(materialId, Number(version), session.roleCode, rawAction === "PREVIEW" ? "PREVIEW" : "DOWNLOAD", session.user.id);
  }

  @Get("materials/:materialId/versions/:version/download") @RequirePermissions("material:view")
  /** Xác minh chữ ký truy cập phiên bản rồi stream tệp với Content-Disposition phù hợp. */
  async downloadMaterialVersion(@Param("materialId") materialId: string, @Param("version") version: string, @Query("expires") expires: string, @Query("signature") signature: string, @Query("action") rawAction: string, @CurrentSession() session: AuthenticatedSession): Promise<StreamableFile> {
    const download = await this.learning.readMaterialVersionDownload(materialId, Number(version), Number(expires), signature ?? "", session.roleCode, rawAction === "PREVIEW" ? "PREVIEW" : "DOWNLOAD", session.user.id);
    return new StreamableFile(download.buffer, { type: download.mimeType, disposition: fileContentDisposition(rawAction === "PREVIEW" ? "inline" : "attachment", download.fileName), length: download.buffer.length });
  }

  @Post("instructor/materials/:materialId/versions") @RequirePermissions("material:manage")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: 500_000_000, files: 1 } }))
  /** Tải tệp thay thế để tạo phiên bản học liệu mới, không ghi đè lịch sử cũ. */
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
  /** Cập nhật metadata/khả năng hiển thị của học liệu. */
  updateMaterial(@Param("materialId") materialId: string, @Body() input: UpdateMaterialDto, @CurrentSession() session: AuthenticatedSession): Promise<LearningMaterial> { return this.learning.updateMaterial(materialId, input, session.user.id); }

  @Patch("manager/materials/:materialId/review") @RequirePermissions("class:manage")
  /** Quản lý duyệt, ẩn hoặc cách ly học liệu và lưu lý do. */
  reviewMaterial(@Param("materialId") materialId: string, @Body() input: ReviewMaterialDto, @CurrentSession() session: AuthenticatedSession): Promise<LearningMaterial> { return this.learning.reviewClassMaterial(materialId, input.action, input.reason, session.user.id); }

  @Get("manager/materials/:materialId/reviews") @RequirePermissions("class:manage")
  /** Trả lịch sử các quyết định kiểm duyệt tệp học liệu. */
  listMaterialReviews(@Param("materialId") materialId: string): Promise<FileReviewRecord[]> { return this.learning.listMaterialReviews(materialId); }

  @Get("materials/:materialId/access") @RequirePermissions("material:view")
  /** Phát URL ký ngắn hạn cho phiên bản học liệu hiện tại. */
  getMaterialAccess(
    @Param("materialId") materialId: string,
    @CurrentSession() session: AuthenticatedSession,
    @Query("action") rawAction = "DOWNLOAD",
  ): Promise<{ url: string; expiresAt: string }> {
    const action = rawAction === "PREVIEW" ? "PREVIEW" : "DOWNLOAD";
    return this.learning.createMaterialAccess(materialId, session.roleCode, action, session.user.id);
  }

  @Get("materials/:materialId/download") @RequirePermissions("material:view")
  /** Xác minh quyền/chữ ký, ghi dấu vết truy cập rồi stream học liệu hiện tại. */
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
  /** Lọc ngân hàng câu hỏi và kiểm tra trạng thái query trước khi gọi service. */
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
  /** Tạo câu hỏi nháp hoặc tự duyệt theo cấu hình hệ thống. */
  createQuestion(@Body() input: CreateQuestionDto, @CurrentSession() session: AuthenticatedSession): Promise<LearningQuestion> { return this.learning.createQuestion(input, session.user.id); }

  @Patch("instructor/question-bank/questions/:questionId") @RequirePermissions("question:manage")
  /** Cập nhật nội dung/đáp án và kích hoạt lại quy trình duyệt khi cần. */
  updateQuestion(@Param("questionId") questionId: string, @Body() input: UpdateQuestionDto, @CurrentSession() session: AuthenticatedSession): Promise<LearningQuestion> { return this.learning.updateQuestion(questionId, input, session.user.id); }

  @Post("instructor/question-bank/questions/:questionId/image") @RequirePermissions("question:manage")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: 8 * 1024 * 1024, files: 1 } }))
  /** Nhận ảnh minh họa câu hỏi, chuẩn hóa tên và để service kiểm tra định dạng thực. */
  uploadQuestionImage(
    @Param("questionId") questionId: string,
    @UploadedFile() file?: { originalname: string; mimetype: string; size: number; buffer: Buffer },
  ): Promise<LearningQuestion> {
    if (!file) throw new BadRequestException("Cần chọn một ảnh cho câu hỏi.");
    return this.learning.uploadQuestionImage(questionId, { originalName: normalizeMultipartFileName(file.originalname), mimeType: file.mimetype, size: file.size, buffer: file.buffer });
  }

  @Delete("instructor/question-bank/questions/:questionId/image") @RequirePermissions("question:manage")
  /** Gỡ ảnh minh họa và dọn object liên quan. */
  removeQuestionImage(@Param("questionId") questionId: string): Promise<LearningQuestion> { return this.learning.removeQuestionImage(questionId); }

  @Get("question-bank/questions/:questionId/image") @RequirePermissions("exam:view")
  /** Kiểm tra quyền theo ngữ cảnh đề/câu hỏi rồi stream ảnh nội tuyến. */
  async readQuestionImage(@Param("questionId") questionId: string, @CurrentSession() session: AuthenticatedSession): Promise<StreamableFile> {
    const image = await this.learning.readQuestionImage(questionId, session.roleCode, session.user.id);
    return new StreamableFile(image.buffer, { type: image.mimeType, disposition: fileContentDisposition("inline", image.fileName), length: image.buffer.length });
  }

  @Post("instructor/question-bank/questions/:questionId/publish") @RequirePermissions("question:manage")
  /** Gửi câu hỏi vào quy trình duyệt hoặc xuất bản ngay theo cấu hình. */
  publishQuestion(@Param("questionId") questionId: string, @CurrentSession() session: AuthenticatedSession): Promise<LearningQuestion> { return this.learning.publishQuestion(questionId, session.user.id); }

  @Post("admin/question-bank/questions/:questionId/review") @RequirePermissions("system:configure")
  /** Cho quản trị duyệt hoặc từ chối câu hỏi khi chế độ duyệt tay được bật. */
  reviewQuestion(@Param("questionId") questionId: string, @Body() input: ReviewQuestionDto, @CurrentSession() session: AuthenticatedSession): Promise<LearningQuestion> { return this.learning.reviewQuestion(questionId, input.decision, input.reviewNote, session.user.id); }

  @Post("instructor/question-bank/questions/import") @RequirePermissions("question:manage")
  /** Nhập hàng loạt câu hỏi và trả kết quả riêng cho từng mục. */
  importQuestions(@Body() input: ImportQuestionsDto, @CurrentSession() session: AuthenticatedSession): Promise<QuestionImportResult[]> { return this.learning.importQuestions(input.questions, session.user.id); }

  @Post("instructor/question-bank/scan-image") @RequirePermissions("question:manage")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: 12 * 1024 * 1024, files: 1 } }))
  /** Gửi ảnh đề sang nhà cung cấp AI đã chọn để trích xuất câu hỏi có cấu trúc. */
  scanQuestionImage(
    @Body("providerId") providerId: string | undefined,
    @UploadedFile() file?: { originalname: string; mimetype: string; size: number; buffer: Buffer },
  ): Promise<QuestionScanResult> {
    if (!file) throw new BadRequestException("Cần chọn ảnh đề thi để quét.");
    return this.aiProviders.scanImage({ providerId: providerId?.trim() || undefined, fileName: normalizeMultipartFileName(file.originalname), mimeType: file.mimetype, buffer: file.buffer });
  }

  @Get("instructor/question-bank/ai-providers") @RequirePermissions("question:manage")
  /** Chỉ trả các AI provider đang bật và đã có khóa để giao diện lựa chọn. */
  async listQuestionScanProviders(): Promise<Awaited<ReturnType<AiProviderService["list"]>>> {
    return (await this.aiProviders.list()).filter((item) => item.enabled && item.hasApiKey);
  }

  @Get("exams") @RequirePermissions("exam:view")
  /** Liệt kê đề thi theo vai trò và quan hệ lớp. */
  listExams(@CurrentSession() session: AuthenticatedSession): Promise<LearningExam[]> { return this.learning.listExams(session.roleCode, session.user.id); }

  @Get("learner/classes/:classId/exams") @RequirePermissions("exam:view")
  /** Trả đề thi khả dụng và trạng thái lượt làm của học viên trong một lớp. */
  listLearnerExams(@Param("classId") classId: string, @CurrentSession() session: AuthenticatedSession): Promise<LearnerExamSummary[]> { return this.learning.listLearnerExamSummaries(classId, session.user.id); }

  @Get("learner/exams") @RequirePermissions("exam:view")
  /** Tổng hợp đề thi của học viên trên tất cả lớp đã ghi danh. */
  listAllLearnerExams(@CurrentSession() session: AuthenticatedSession): Promise<LearnerExamSummary[]> { return this.learning.listLearnerExamSummaries(undefined, session.user.id); }

  @Get("learner/exams/:examId/questions") @RequirePermissions("exam:view")
  /** Lấy bộ câu hỏi theo thứ tự của lượt/học viên và không làm lộ đáp án. */
  getLearnerExamQuestions(@Param("examId") examId: string, @CurrentSession() session: AuthenticatedSession): Promise<LearningQuestion[]> { return this.learning.getExamQuestions(examId, session.user.id); }

  @Get("instructor/exams/:examId/preview") @RequirePermissions("exam:manage")
  /** Cho giảng viên phụ trách xem đề theo thứ tự gốc bất kể cấu hình xáo trộn. */
  getInstructorExamPreview(@Param("examId") examId: string, @CurrentSession() session: AuthenticatedSession): Promise<LearningQuestion[]> { return this.learning.getInstructorExamPreview(examId, session.user.id); }

  @Get("manager/exams/:examId/preview") @RequirePermissions("class:manage")
  /** Cho người duyệt xem nội dung đề đang chờ phê duyệt mà không cần được phân công lớp. */
  getReviewerExamPreview(@Param("examId") examId: string): Promise<LearningQuestion[]> { return this.learning.getReviewerExamPreview(examId); }

  @Post("instructor/exams") @RequirePermissions("exam:manage")
  /** Tạo đề từ danh sách câu hỏi đã chọn và cấu hình thời gian/lượt làm. */
  createExam(@Body() input: CreateExamDto, @CurrentSession() session: AuthenticatedSession): Promise<LearningExam> { return this.learning.createExam(input, session.user.id); }

  @Patch("instructor/exams/:examId") @RequirePermissions("exam:manage")
  /** Chỉnh toàn bộ đề nháp bằng optimistic version để không ghi đè thay đổi đồng thời. */
  updateExam(@Param("examId") examId: string, @Body() input: UpdateExamDto, @CurrentSession() session: AuthenticatedSession): Promise<LearningExam> { return this.learning.updateExam(examId, input, session.user.id); }

  @Post("instructor/exams/ai-generate") @RequirePermissions("exam:manage")
  /** Tạo câu hỏi đúng ma trận từ tài liệu môn học hoặc Web Search rồi lưu thành đề nháp. */
  async generateAiExam(@Body() input: GenerateAiExamDto, @CurrentSession() session: AuthenticatedSession): Promise<AiGeneratedExamResult> {
    const seenTypes = new Set(input.distribution.map((item) => item.type));
    if (seenTypes.size !== input.distribution.length) throw new BadRequestException("Mỗi loại câu hỏi chỉ được xuất hiện một lần trong ma trận.");
    const totalQuestions = input.distribution.reduce((sum, item) => sum + item.count, 0);
    if (totalQuestions < 1 || totalQuestions > 50) throw new BadRequestException("Tổng số câu hỏi AI phải từ 1 đến 50.");
    const existing = await this.learning.getGeneratedExamByRequest(input.clientRequestId, input.classId, session.user.id);
    if (existing) {
      const context = existing.aiContext ?? { mode: "WEB_SEARCH" as const, materialIds: [], sources: [] };
      return { exam: existing, generatedQuestionCount: existing.questionIds.length, providerId: context.providerId ?? "reused", provider: context.provider ?? "Yêu cầu trước", model: context.model ?? "reused", context: { mode: context.mode, materialIds: context.materialIds, materialNames: [], sources: context.sources }, warnings: [...(context.warnings ?? []), "Đã trả lại đề từ yêu cầu AI hoàn tất trước đó; không tạo bản trùng."] };
    }
    const context = await this.learning.getExamGenerationContext(input.classId, session.user.id, input.materialIds);
    const generated = await this.aiProviders.generateExamDraft({
      providerId: input.providerId,
      courseName: context.courseName,
      courseDescription: context.courseDescription,
      focus: input.focus.trim(),
      difficulty: input.difficulty,
      distribution: input.distribution,
      contextMode: input.contextMode,
      sourceFiles: context.sourceFiles,
    });
    const exam = await this.learning.createGeneratedExam({
      classId: input.classId,
      title: input.title,
      durationMinutes: input.durationMinutes,
      totalScore: input.totalScore,
      openAt: input.openAt,
      closeAt: input.closeAt,
      attemptLimit: input.attemptLimit,
      shuffleQuestions: input.shuffleQuestions,
      randomSeed: input.randomSeed,
    }, generated.questions, context.courseId, { ...generated.context, providerId: generated.providerId, provider: generated.provider, model: generated.model, warnings: generated.warnings }, input.clientRequestId, session.user.id);
    return { exam, generatedQuestionCount: generated.questions.length, providerId: generated.providerId, provider: generated.provider, model: generated.model, context: generated.context, warnings: generated.warnings };
  }

  @Post("instructor/exams/:examId/publish") @RequirePermissions("exam:manage")
  /** Gửi đề duyệt hoặc tự động công bố theo chính sách hệ thống. */
  publishExam(@Param("examId") examId: string, @CurrentSession() session: AuthenticatedSession): Promise<LearningExam> { return this.learning.submitExamForReview(examId, session.user.id); }

  @Post("manager/exams/:examId/approve") @RequirePermissions("class:manage")
  /** Duyệt hoặc từ chối đề khi hệ thống đang dùng chế độ duyệt tay. */
  approveExam(@Param("examId") examId: string, @Body() input: ReviewExamDto, @CurrentSession() session: AuthenticatedSession): Promise<LearningExam> { return this.learning.reviewExam(examId, input.decision, input.reviewNote, session.user.id); }

  @Get("manager/exams/:examId/approvals") @RequirePermissions("class:manage")
  /** Trả lịch sử quyết định phê duyệt đề thi. */
  listExamApprovals(@Param("examId") examId: string): Promise<ExamApprovalRecord[]> { return this.learning.listExamApprovals(examId); }

  @Post("learner/exams/:examId/attempts") @RequirePermissions("exam:view")
  /** Mở hoặc tiếp tục lượt thi hợp lệ cho học viên. */
  startAttempt(@Param("examId") examId: string, @CurrentSession() session: AuthenticatedSession): Promise<ExamAttempt> { return this.learning.startAttempt(examId, session.user.id); }

  @Patch("learner/exam-attempts/:attemptId/answers") @RequirePermissions("exam:view")
  /** Lưu tạm đáp án khi lượt thi vẫn đang mở và thuộc học viên. */
  saveAnswer(@Param("attemptId") attemptId: string, @Body() input: SaveAnswerDto, @CurrentSession() session: AuthenticatedSession): Promise<ExamAttempt> { return this.learning.saveAnswer(attemptId, input.questionId, input.answers, session.user.id); }

  @Post("learner/exam-attempts/:attemptId/submit") @RequirePermissions("exam:view")
  /** Chốt lượt thi, tự chấm phần hỗ trợ được và chuyển trạng thái phù hợp. */
  submitAttempt(@Param("attemptId") attemptId: string, @CurrentSession() session: AuthenticatedSession): Promise<ExamAttempt> { return this.learning.submitAttempt(attemptId, session.user.id); }

  @Get("learner/attempts/:attemptId/result") @RequirePermissions("exam:view")
  /** Trả kết quả một lượt thi thuộc học viên hiện tại. */
  getAttempt(@Param("attemptId") attemptId: string, @CurrentSession() session: AuthenticatedSession): Promise<LearnerResult> { return this.learning.getLearnerResult(attemptId, session.user.id); }

  @Get("learner/results") @RequirePermissions("exam:view")
  /** Liệt kê toàn bộ kết quả thi của học viên hiện tại. */
  listLearnerResults(@CurrentSession() session: AuthenticatedSession): Promise<LearnerResult[]> { return this.learning.listLearnerResults(session.user.id); }

  @Post("learner/attempts/:attemptId/regrade-requests") @RequirePermissions("exam:view")
  /** Mở yêu cầu phúc khảo cho lượt thi thuộc học viên. */
  requestRegrade(@Param("attemptId") attemptId: string, @Body() input: RequestRegradeDto, @CurrentSession() session: AuthenticatedSession): Promise<RegradeRequest> {
    return this.learning.requestRegrade(attemptId, input.reason, session.user.id);
  }

  @Get("instructor/regrade-requests") @RequirePermissions("exam:manage")
  /** Liệt kê hàng đợi phúc khảo thuộc các lớp giảng viên phụ trách. */
  listRegradeRequests(@CurrentSession() session: AuthenticatedSession, @Query("status") status?: RegradeRequest["status"]): Promise<RegradeRequest[]> {
    return this.learning.listRegradeRequests(session.user.id, status);
  }

  @Post("instructor/regrade-requests/:requestId/claim") @RequirePermissions("exam:manage")
  /** Nhận xử lý độc quyền một yêu cầu phúc khảo đang mở. */
  claimRegrade(@Param("requestId") requestId: string, @CurrentSession() session: AuthenticatedSession): Promise<RegradeRequest> {
    return this.learning.claimRegrade(requestId, session.user.id);
  }

  @Patch("instructor/regrade-requests/:requestId/resolve") @RequirePermissions("exam:manage")
  /** Chấp thuận hoặc từ chối phúc khảo, đồng bộ điểm và lịch sử khi chấp thuận. */
  resolveRegrade(@Param("requestId") requestId: string, @Body() input: ResolveRegradeDto, @CurrentSession() session: AuthenticatedSession): Promise<RegradeRequest> {
    return this.learning.resolveRegrade(requestId, input, session.user.id);
  }

  @Get("instructor/exam-attempts") @RequirePermissions("exam:manage")
  /** Liệt kê lượt thi trong các lớp giảng viên phụ trách, có thể lọc theo đề. */
  listAttempts(@CurrentSession() session: AuthenticatedSession, @Query("examId") examId?: string): Promise<ExamAttempt[]> { return this.learning.listAttempts(examId, session.user.id); }

  @Get("instructor/exam-attempts/:attemptId/review") @RequirePermissions("exam:manage")
  /** Trả đề, đáp án và điểm từng câu để giảng viên chấm trong đúng phạm vi lớp. */
  reviewAttempt(@Param("attemptId") attemptId: string, @CurrentSession() session: AuthenticatedSession): Promise<ExamAttemptReview> { return this.learning.getAttemptReview(attemptId, session.user.id); }

  @Patch("instructor/exam-attempts/:attemptId/grade") @RequirePermissions("exam:manage")
  /** Chấm hoặc sửa điểm lượt thi và ghi lý do hiệu chỉnh vào lịch sử. */
  gradeAttempt(@Param("attemptId") attemptId: string, @Body() input: GradeAttemptDto, @CurrentSession() session: AuthenticatedSession): Promise<ExamAttempt> { return this.learning.gradeAttempt(attemptId, input.score, input.feedback, input.correctionReason, session.user.id, input.questionScores); }

  @Get("instructor/exam-attempts/:attemptId/grade-history") @RequirePermissions("exam:manage")
  /** Trả lịch sử các lần chấm/sửa điểm sau khi kiểm tra quyền giảng viên. */
  listGradeHistory(@Param("attemptId") attemptId: string, @CurrentSession() session: AuthenticatedSession): Promise<GradeHistoryRecord[]> { return this.learning.listGradeHistory(attemptId, session.user.id); }
}
