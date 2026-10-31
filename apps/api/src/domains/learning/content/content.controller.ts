import { BadRequestException, Body, Controller, Delete, Get, Header, HttpCode, Param, Patch, Post, Put, Query, Req, StreamableFile, UploadedFile, UseInterceptors } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { parseExamPageQuery, type ExamPage } from "../operations/exams/learning-exam-page.js";
import { FileInterceptor } from "@nestjs/platform-express";
import { MaterialUploadInterceptor } from "../../../infrastructure/material-upload.interceptor.js";
import { readFileHead } from "../../../infrastructure/file-streams.js";
import type { Request } from "express";
import type { AuthenticatedSession } from "../../../auth/auth.service.js";
import { CurrentSession } from "../../../auth/current-session.decorator.js";
import { RequirePermissions } from "../../../auth/require-permissions.decorator.js";
import { fileContentDisposition, normalizeMultipartFileName } from "../../../infrastructure/file-transfer.js";
import { CreateExamDto, CreateMaterialDto, CreateQuestionDto, GenerateAiExamDto, GradeAttemptDto, ImportQuestionsDto, RequestRegradeDto, ResolveRegradeDto, ReviewExamDto, ReviewMaterialDto, ReplaceMaterialEditorsDto, ReviewQuestionDto, SaveAnswerDto, UpdateExamDto, UpdateMaterialDto, UpdateQuestionDto, UploadMaterialDto } from "../core/learning.dto.js";
import { LearningService, type MaterialAccessAction, type MaterialSearchResult, type UploadedMaterialFile } from "../core/learning.service.js";
import type { AiGeneratedExamResult, ExamApprovalRecord, ExamAttempt, ExamAttemptReview, FileReviewRecord, GradeHistoryRecord, LearnerExamSummary, LearnerResult, LearningExam, LearningMaterial, LearningQuestion, MaterialVersionSnapshot, QuestionImportResult, RegradeRequest } from "../core/learning.types.js";
import { AiProviderService, type QuestionScanResult } from "../../system/ai/ai-provider.service.js";
import { AiGenerationRequestService } from "../ai/ai-generation-request.service.js";
import { AiMaterialContextService } from "../ai/ai-material-context.service.js";
import { MaterialAiContextDto, MaterialAiQuestionDto, MaterialAiQuestionStatusDto, MaterialAiHistoryQueryDto, MaterialStudyGuideDto, StudyDraftListQueryDto } from "../core/learning.dto.js";
import { EditExamQuestionDto, EditStudyDraftDto, PublishStudyDraftDto, UnpublishStudyDraftDto, SubmitExamDto } from "../core/learning.dto.js";

@ApiTags("Content & Assessment")
@Controller()
/** API học liệu, ngân hàng câu hỏi, AI scan, đề thi và vòng đời lượt làm bài. */
export class ContentController {
  constructor(private readonly learning: LearningService, private readonly aiProviders: AiProviderService, private readonly aiRequests: AiGenerationRequestService, private readonly materialAi: AiMaterialContextService) {}

  @Get("instructor/materials/:materialId/ai-questions") @RequirePermissions("material:manage")
  @Header("Cache-Control", "no-store")
  /** Liệt kê câu hỏi riêng đã lưu, không sinh câu trả lời hoặc nhận chủ sở hữu do client cung cấp. */
  questionHistory(@Param("materialId") materialId: string, @Query() query: MaterialAiHistoryQueryDto, @CurrentSession() session: AuthenticatedSession): ReturnType<AiMaterialContextService["questionHistory"]> {
    return this.materialAi.questionHistory(materialId, query.version, session.user.id, session.roleCode, query.cursor);
  }

  @Post("instructor/materials/:materialId/ai-context") @RequirePermissions("material:manage")
  /** Chuẩn bị ngữ cảnh có nguồn cho tài liệu giảng viên được phép truy cập. */
  prepareMaterialContext(@Param("materialId") materialId: string, @Body() input: MaterialAiContextDto, @CurrentSession() session: AuthenticatedSession): ReturnType<AiMaterialContextService["prepare"]> { return this.materialAi.prepare(materialId, session.user.id, session.roleCode, input.query); }

  @Post("instructor/materials/:materialId/ai-question") @RequirePermissions("material:manage")
  @Header("Cache-Control", "no-store")
  /** Hỏi đáp tài liệu của giảng viên với trích dẫn từ đúng ngữ cảnh server đã đọc. */
  askMaterial(@Param("materialId") materialId: string, @Body() input: MaterialAiQuestionDto, @CurrentSession() session: AuthenticatedSession): ReturnType<AiMaterialContextService["ask"]> { return this.materialAi.ask(materialId, session.user.id, session.roleCode, input.question, input.language); }

  @Post("instructor/materials/:materialId/ai-question/status") @RequirePermissions("material:manage")
  @HttpCode(200) @Header("Cache-Control", "no-store")
  /** Tra cứu trạng thái chỉ đọc qua body để nội dung câu hỏi riêng không xuất hiện trong URL. */
  questionStatus(@Param("materialId") materialId: string, @Body() input: MaterialAiQuestionStatusDto, @CurrentSession() session: AuthenticatedSession): ReturnType<AiMaterialContextService["questionStatus"]> { return this.materialAi.questionStatus(materialId, session.user.id, session.roleCode, input.question, input.language, input.version); }

  @Post("instructor/materials/:materialId/ai-study-guide") @RequirePermissions("material:manage")
  /** Tạo tóm tắt và thẻ ôn tập có nguồn từ học liệu giảng viên được phép xem. */
  studyMaterial(@Param("materialId") materialId: string, @Body() input: MaterialStudyGuideDto, @CurrentSession() session: AuthenticatedSession): ReturnType<AiMaterialContextService["study"]> { return this.materialAi.study(materialId, session.user.id, session.roleCode, input); }

  @Get("instructor/materials/:materialId/ai-study-guides") @RequirePermissions("material:manage")
  /** Liệt kê lịch sử bộ ôn tập riêng của giảng viên, có phân trang. */
  listStudyDrafts(@Param("materialId") materialId: string, @Query() query: StudyDraftListQueryDto, @CurrentSession() session: AuthenticatedSession): ReturnType<AiMaterialContextService["listStudyDrafts"]> { return this.materialAi.listStudyDrafts(materialId, session.user.id, session.roleCode, query.cursor); }

  @Get("instructor/materials/:materialId/ai-study-guides/:draftId") @RequirePermissions("material:manage")
  /** Mở lại bộ ôn tập đã lưu sau khi xác nhận quyền đối với phiên bản nguồn. */
  getStudyDraft(@Param("materialId") materialId: string, @Param("draftId") draftId: string, @CurrentSession() session: AuthenticatedSession): ReturnType<AiMaterialContextService["getStudyDraft"]> { return this.materialAi.getStudyDraft(materialId, draftId, session.user.id, session.roleCode); }

  /** Chỉnh sửa bản ôn tập riêng, giữ nguồn gốc và phát hiện xung đột chỉnh sửa. */
  @Patch("instructor/materials/:materialId/ai-study-guides/:draftId") @RequirePermissions("material:manage")
  editStudyDraft(@Param("materialId") materialId: string, @Param("draftId") draftId: string, @Body() input: EditStudyDraftDto, @CurrentSession() session: AuthenticatedSession): ReturnType<AiMaterialContextService["editStudyDraft"]> { return this.materialAi.editStudyDraft(materialId, draftId, session.user.id, session.roleCode, input); }

  /** Phát hành snapshot đã duyệt, không gọi AI. */
  @Post("instructor/materials/:materialId/ai-study-guides/:draftId/publish") @RequirePermissions("material:manage")
  publishStudyDraft(@Param("materialId") materialId: string, @Param("draftId") draftId: string, @Body() input: PublishStudyDraftDto, @CurrentSession() session: AuthenticatedSession): ReturnType<AiMaterialContextService["publishStudyDraft"]> { return this.materialAi.publishStudyDraft(materialId, draftId, session.user.id, session.roleCode, input); }

  /** Thu hồi quyền xem snapshot của học viên mà không xóa bản nháp riêng. */
  @Post("instructor/materials/:materialId/ai-study-guides/:draftId/unpublish") @RequirePermissions("material:manage")
  unpublishStudyDraft(@Param("materialId") materialId: string, @Param("draftId") draftId: string, @Body() input: UnpublishStudyDraftDto, @CurrentSession() session: AuthenticatedSession): ReturnType<AiMaterialContextService["unpublishStudyDraft"]> { return this.materialAi.unpublishStudyDraft(materialId, draftId, session.user.id, session.roleCode, input.expectedPublicationRevision); }

  @Get("learner/materials/:materialId/study-guides") @RequirePermissions("material:view")
  /** Danh sách có phân trang, chỉ trả metadata của các bản phát hành có nguồn được phép xem. */
  listPublishedStudyDrafts(@Param("materialId") materialId: string, @Query() query: StudyDraftListQueryDto, @CurrentSession() session: AuthenticatedSession): ReturnType<AiMaterialContextService["listPublishedStudyDrafts"]> { return this.materialAi.listPublishedStudyDrafts(materialId, session.user.id, session.roleCode, query.cursor); }

  /** Đọc bộ ôn tập công khai theo quyền truy cập lớp của người dùng hiện tại. */
  @Get("learner/materials/:materialId/study-guides/:draftId") @RequirePermissions("material:view")
  getPublishedStudyDraft(@Param("materialId") materialId: string, @Param("draftId") draftId: string, @CurrentSession() session: AuthenticatedSession): ReturnType<AiMaterialContextService["getPublishedStudyDraft"]> { return this.materialAi.getPublishedStudyDraft(materialId, draftId, session.user.id, session.roleCode); }

  @Get("materials") @RequirePermissions("material:view")
  /** Liệt kê học liệu theo vai trò, người dùng và từ khóa. */
  listMaterials(@CurrentSession() session: AuthenticatedSession, @Query("query") query?: string, @Query("page") page?: string): Promise<LearningMaterial[]> { return this.learning.listMaterials(session.roleCode, query, session.user.id, Number(page)); }

  @Get(["learner/materials/search", "materials/search"]) @RequirePermissions("material:view")
  /** Tìm học liệu học viên được truy cập với bộ lọc và phân trang đã chuẩn hóa trong service. */
  searchMaterials(
    @CurrentSession() session: AuthenticatedSession,
    @Query("query") query?: string,
    @Query("classId") classId?: string,
    @Query("courseId") courseId?: string,
    @Query("scope") scope?: string,
    @Query("visibility") visibility?: string,
    @Query("aiOnly") aiOnly?: string,
    @Query("folder") folder?: string,
    @Query("mimeType") mimeType?: string,
    @Query("tag") tag?: string,
    @Query("page") rawPage?: string,
    @Query("pageSize") rawPageSize?: string,
  ): Promise<MaterialSearchResult> {
    return this.learning.searchAccessibleMaterials({ query, classId, courseId, scope, visibility, aiOnly: aiOnly === "true", folder, mimeType, tag, page: Number(rawPage), pageSize: Number(rawPageSize) }, session.user.id, session.roleCode);
  }

  @Post("instructor/classes/:classId/materials") @RequirePermissions("material:manage")
  /** Tạo metadata học liệu không kèm tệp cho lớp giảng viên. */
  createMaterial(@Param("classId") classId: string, @Body() input: CreateMaterialDto, @CurrentSession() session: AuthenticatedSession): Promise<LearningMaterial> { return this.learning.createMaterial(classId, input, undefined, session.user.id); }

  @Post("instructor/materials") @RequirePermissions("material:manage")
  /** Tạo metadata học liệu không kèm tệp cho kho dùng chung hoặc chưa phân loại. */
  createDirectMaterial(@Body() input: CreateMaterialDto, @CurrentSession() session: AuthenticatedSession): Promise<LearningMaterial> { return this.learning.createMaterial(null, input, undefined, session.user.id); }

  @Post("instructor/classes/:classId/material-uploads") @RequirePermissions("material:manage")
  @UseInterceptors(MaterialUploadInterceptor)
  /** Chuẩn hóa tên/tags của tệp multipart rồi giao service quét virus và lưu object. */
  async uploadMaterial(
    @Param("classId") classId: string,
    @Body() input: UploadMaterialDto,
    @CurrentSession() session: AuthenticatedSession,
    @UploadedFile() file?: { originalname: string; mimetype: string; size: number; path: string },
  ): Promise<LearningMaterial> {
    if (!file) throw new BadRequestException("Cần chọn một tệp học liệu.");
    const originalName = normalizeMultipartFileName(file.originalname);
    const upload: UploadedMaterialFile = { originalName, mimeType: file.mimetype, size: file.size, path: file.path, buffer: await readFileHead(file.path) };
    return this.learning.createMaterial(classId, {
      name: originalName,
      mimeType: file.mimetype,
      sizeBytes: file.size,
      folder: input.folder,
      tags: input.tags.split(",").map((tag) => tag.trim()).filter(Boolean),
      scope: input.scope,
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
    const download = await this.learning.readMaterialVersionDownloadStream(materialId, Number(version), Number(expires), signature ?? "", session.roleCode, rawAction === "PREVIEW" ? "PREVIEW" : "DOWNLOAD", session.user.id);
    return new StreamableFile(download.stream, { type: download.mimeType, disposition: fileContentDisposition(rawAction === "PREVIEW" ? "inline" : "attachment", download.fileName), length: download.size });
  }

  @Post("instructor/materials/:materialId/versions") @RequirePermissions("material:manage")
  @UseInterceptors(MaterialUploadInterceptor)
  /** Tải tệp thay thế để tạo phiên bản học liệu mới, không ghi đè lịch sử cũ. */
  async uploadMaterialVersion(
    @Param("materialId") materialId: string,
    @Body() input: UploadMaterialDto,
    @CurrentSession() session: AuthenticatedSession,
    @UploadedFile() file?: { originalname: string; mimetype: string; size: number; path: string },
  ): Promise<LearningMaterial> {
    if (!file) throw new BadRequestException("Cần chọn tệp cho phiên bản mới.");
    return this.learning.replaceMaterialVersion(materialId, { folder: input.folder, tags: input.tags.split(",").map((tag) => tag.trim()).filter(Boolean) }, { originalName: normalizeMultipartFileName(file.originalname), mimeType: file.mimetype, size: file.size, path: file.path, buffer: await readFileHead(file.path) }, session.user.id);
  }

  @Post("instructor/courses/:courseId/material-uploads") @RequirePermissions("material:manage")
  @UseInterceptors(MaterialUploadInterceptor)
  /** Tải học liệu dùng chung theo môn; giảng viên không cần dạy lớp nào của môn đó. */
  async uploadCourseMaterial(
    @Param("courseId") courseId: string,
    @Body() input: UploadMaterialDto,
    @CurrentSession() session: AuthenticatedSession,
    @UploadedFile() file?: { originalname: string; mimetype: string; size: number; path: string },
  ): Promise<LearningMaterial> {
    if (!file) throw new BadRequestException("Cần chọn một tệp học liệu.");
    const originalName = normalizeMultipartFileName(file.originalname);
    const upload: UploadedMaterialFile = { originalName, mimeType: file.mimetype, size: file.size, path: file.path, buffer: await readFileHead(file.path) };
    return this.learning.createMaterial(null, {
      name: originalName,
      mimeType: file.mimetype,
      sizeBytes: file.size,
      folder: input.folder,
      tags: input.tags.split(",").map((tag) => tag.trim()).filter(Boolean),
      courseId,
    }, upload, session.user.id);
  }

  @Get("instructor/materials/:materialId/editors") @RequirePermissions("material:manage")
  /** Xem các giảng viên được người tải lên cấp quyền sửa học liệu. */
  listMaterialEditors(@Param("materialId") materialId: string, @CurrentSession() session: AuthenticatedSession): ReturnType<LearningService["listMaterialEditors"]> { return this.learning.listMaterialEditors(materialId, session.user.id); }

  @Put("instructor/materials/:materialId/editors") @RequirePermissions("material:manage")
  /** Người tải lên cấp hoặc thu hồi quyền sửa học liệu cho giảng viên khác. */
  replaceMaterialEditors(@Param("materialId") materialId: string, @Body() input: ReplaceMaterialEditorsDto, @CurrentSession() session: AuthenticatedSession): ReturnType<LearningService["replaceMaterialEditors"]> { return this.learning.replaceMaterialEditors(materialId, input.userIds, session.user.id); }

  @Get("instructor/material-editor-candidates") @RequirePermissions("material:manage")
  /** Giảng viên đang hoạt động có thể được cấp quyền sửa học liệu. */
  listMaterialEditorCandidates(@CurrentSession() session: AuthenticatedSession): ReturnType<LearningService["listMaterialEditorCandidates"]> { return this.learning.listMaterialEditorCandidates(session.user.id); }

  @Patch("instructor/materials/:materialId") @RequirePermissions("material:manage")
  /** Cập nhật metadata/khả năng hiển thị của học liệu. */
  updateMaterial(@Param("materialId") materialId: string, @Body() input: UpdateMaterialDto, @CurrentSession() session: AuthenticatedSession): Promise<LearningMaterial> { return this.learning.updateMaterial(materialId, input, session.user.id); }

  @Delete("instructor/materials/:materialId") @RequirePermissions("material:manage") @HttpCode(204)
  /** Người tải lên xóa hẳn học liệu cùng mọi phiên bản và tệp. */
  deleteMaterial(@Param("materialId") materialId: string, @CurrentSession() session: AuthenticatedSession): Promise<void> { return this.learning.deleteMaterial(materialId, session.user.id); }

  @Get("instructor/materials/:materialId/reviews") @RequirePermissions("material:manage")
  /** Người tải lên và người được cấp quyền sửa xem quyết định kiểm duyệt kèm lý do. */
  listOwnMaterialReviews(@Param("materialId") materialId: string, @CurrentSession() session: AuthenticatedSession): Promise<FileReviewRecord[]> { return this.learning.listMaterialReviews(materialId, session.user.id); }

  @Patch("instructor/materials/:materialId/review") @RequirePermissions("material:manage")
  /** Giảng viên tự kiểm duyệt, công bố hoặc thu hồi học liệu của mình. */
  reviewOwnMaterial(@Param("materialId") materialId: string, @Body() input: ReviewMaterialDto, @CurrentSession() session: AuthenticatedSession): Promise<LearningMaterial> { return this.learning.reviewClassMaterial(materialId, input.action, input.reason, session.user.id); }

  @Patch("manager/materials/:materialId/review") @RequirePermissions("class:manage", "material:manage")
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
    const download = await this.learning.readMaterialDownloadStream(materialId, Number(expires), signature ?? "", session.roleCode, action, {
      ipAddress: request.ip,
      userAgent: request.header("user-agent"),
    }, session.user.id);
    return new StreamableFile(download.stream, {
      type: download.mimeType,
      disposition: fileContentDisposition(action === "PREVIEW" ? "inline" : "attachment", download.fileName),
      length: download.size,
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
  async scanQuestionImage(
    @UploadedFile() file?: { originalname: string; mimetype: string; size: number; buffer: Buffer },
  ): Promise<QuestionScanResult> {
    if (!file) throw new BadRequestException("Cần chọn ảnh đề thi để quét.");
    const config = await this.aiProviders.resolveTask("SCAN_IMAGE");
    return this.aiProviders.scanImage({ ...config, fileName: normalizeMultipartFileName(file.originalname), mimeType: file.mimetype, buffer: file.buffer });
  }

  @Get("instructor/question-bank/ai-providers") @RequirePermissions("question:manage")
  /** Chỉ trả các AI provider đang bật và đã có khóa; tự động fallback sang provider khả dụng nếu chưa gán tác vụ riêng. */
  async listQuestionScanProviders(@Query("task") task?: string): Promise<Awaited<ReturnType<AiProviderService["list"]>>> {
    const allProviders = (await this.aiProviders.list()).filter((item) => item.enabled && item.hasApiKey);
    const config = (await this.aiProviders.getTaskConfigs())[task === "GENERATE_EXAM" ? "GENERATE_EXAM" : "SCAN_IMAGE"];
    if (config) {
      const matched = allProviders.filter((item) => item.id === config.providerId).map((item) => ({ ...item, model: config.model }));
      if (matched.length) return matched;
    }
    const defaultProvider = allProviders.find((item) => item.isDefault) ?? allProviders[0];
    return defaultProvider ? [defaultProvider] : allProviders;
  }

  @Get("instructor/question-bank/ai-providers/:providerId/models") @RequirePermissions("question:manage")
  /** Trả danh sách model thuộc provider để giảng viên chọn riêng cho lần tạo hoặc quét hiện tại. */
  async listQuestionProviderModels(@Param("providerId") providerId: string): ReturnType<AiProviderService["listModels"]> {
    const configs = Object.values(await this.aiProviders.getTaskConfigs());
    return configs.filter((item) => item.providerId === providerId).map((item) => ({ value: item.model, label: item.model, description: "Do quản trị viên cấu hình." }));
  }

  @Get("exams") @RequirePermissions("exam:view")
  /** Liệt kê đề thi theo vai trò và quan hệ lớp. */
  listExams(@CurrentSession() session: AuthenticatedSession): Promise<LearningExam[]> { return this.learning.listExams(session.roleCode, session.user.id); }

  @Get("exams/page") @RequirePermissions("exam:view")
  /** Trả trang đề có giới hạn, kiểm tra query ở server và phạm vi truy cập trong truy vấn DB. */
  listExamPage(@Query() query: Record<string, unknown>, @CurrentSession() session: AuthenticatedSession): Promise<ExamPage> {
    return this.learning.listExamPage(session.roleCode, session.user.id, parseExamPageQuery(query));
  }

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
    // Kiểm tra quyền trước khi đọc cache; không đọc file hoặc gọi provider ở bước này.
    await this.learning.getExamGenerationContext(input.classId, session.user.id, [], true);
    const { clientRequestId, providerId: _providerId, model: _model, ...payload } = input;
    void _providerId; void _model;
    return this.aiRequests.run(clientRequestId, session.user.id, payload, async () => {
      const context = await this.learning.getExamGenerationContext(input.classId, session.user.id, input.materialIds, input.contextMode === "WEB_SEARCH");
      const taskConfigs = await this.aiProviders.getTaskConfigs();
      let aiTask = taskConfigs["GENERATE_EXAM"];
      if (!aiTask) {
        const activeProviders = (await this.aiProviders.list()).filter((item) => item.enabled && item.hasApiKey && (item.provider === "GEMINI" || item.provider === "OPENAI" || item.provider === "CUSTOM"));
        const fallback = activeProviders.find((item) => item.isDefault) ?? activeProviders[0];
        if (fallback) aiTask = { providerId: fallback.id, model: fallback.model };
        else aiTask = await this.aiProviders.resolveTask("GENERATE_EXAM");
      }
    const generated = await this.aiProviders.generateExamDraft({
      ...aiTask,
      courseName: context.courseName,
      courseDescription: context.courseDescription,
      focus: input.focus.trim(),
      difficulty: input.difficulty,
      language: input.language,
      distribution: input.distribution,
      contextMode: input.contextMode,
      sourceFiles: context.sourceFiles,
    });

      return { courseId: context.courseId, generated };
    }, async ({ courseId, generated }, canonicalRequestId) => {
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
    }, generated.questions, courseId, { ...generated.context, providerId: generated.providerId, provider: generated.provider, model: generated.model, warnings: generated.warnings }, canonicalRequestId, session.user.id);
    return { exam, generatedQuestionCount: generated.questions.length, providerId: generated.providerId, provider: generated.provider, model: generated.model, context: generated.context, warnings: generated.warnings };
    }, async (canonicalRequestId) => {
    const existing = await this.learning.getGeneratedExamByRequest(canonicalRequestId, input.classId, session.user.id);
    if (existing) {
      const context = existing.aiContext ?? { mode: "WEB_SEARCH" as const, materialIds: [], sources: [] };
      return { exam: existing, generatedQuestionCount: existing.questionIds.length, providerId: context.providerId ?? "reused", provider: context.provider ?? "Yêu cầu trước", model: context.model ?? "reused", context: { mode: context.mode, materialIds: context.materialIds, materialNames: [], sources: context.sources }, warnings: [...(context.warnings ?? []), "Đã trả lại đề từ yêu cầu AI hoàn tất trước đó; không tạo bản trùng."] };
    }

      return undefined;
    }, { idempotentSave: true });
  }

  @Patch("instructor/exams/:examId/questions/:questionId") @RequirePermissions("exam:manage")
  /** Sửa bản câu hỏi riêng của đề nháp được phân công. */
  editExamQuestion(@Param("examId") examId: string, @Param("questionId") questionId: string, @Body() input: EditExamQuestionDto, @CurrentSession() session: AuthenticatedSession): Promise<LearningQuestion> { return this.learning.editExamQuestion(examId, questionId, input, session.user.id); }

  @Post("instructor/exams/:examId/publish") @RequirePermissions("exam:manage")
  /** Gửi đề duyệt hoặc tự động công bố theo chính sách hệ thống. */
  publishExam(@Param("examId") examId: string, @CurrentSession() session: AuthenticatedSession, @Body() input: SubmitExamDto = {}): Promise<LearningExam> { return this.learning.submitExamForReview(examId, session.user.id, input.confirmQuestions, input.expectedVersion); }

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
