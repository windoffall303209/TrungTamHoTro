import { BadRequestException, Body, Controller, Delete, ForbiddenException, Get, Header, Headers, HttpCode, Optional, Param, Patch, Post, Put, Query, Req, Res, StreamableFile, UploadedFile, UseInterceptors } from "@nestjs/common";
import type { Request, Response } from "express";
import { rethrowWithRangeHeaders, sendRangedStreamableFile } from "../../../infrastructure/http-range-stream.js";
import { ApiTags } from "@nestjs/swagger";
import { parseOptionalQueryInt, parseOptionalQueryString, parsePageQuery, type PaginatedResult } from "../../../common/pagination.js";
import { parseExamPageQuery, type ExamPage } from "../operations/exams/learning-exam-page.js";
import { FileInterceptor } from "@nestjs/platform-express";
import { MaterialUploadInterceptor } from "../../../infrastructure/material-upload.interceptor.js";
import { readFileHead } from "../../../infrastructure/file-streams.js";
import type { AuthenticatedSession } from "../../../auth/auth.service.js";
import { CurrentSession } from "../../../auth/current-session.decorator.js";
import { RequirePermissions } from "../../../auth/require-permissions.decorator.js";
import { fileContentDisposition, normalizeMultipartFileName } from "../../../infrastructure/file-transfer.js";
import { AskExamTutorDto, AskInstructorPreviewTutorDto, ClassFolderDto, CreateExamDto, CreateMaterialDto, CreateQuestionDto, DraftAiExamDto, GenerateAiExamDto, GradeAttemptDto, ImportQuestionsDto, RequestRegradeDto, ResolveRegradeDto, SaveAnswerDto, SubmitAttemptDto, UpdateExamDto, UpdateMaterialDto, UpdateQuestionDto, UploadMaterialDto } from "../core/learning.dto.js";
import type { MaterialAccessAction, MaterialSearchResult, MaterialSummaryBucket, QuestionSummary, UploadedMaterialFile } from "../core/learning.shared.js";
import { ContentMaterialService } from "./content-material.service.js";
import { ExamAssessmentService } from "../exams/exam-assessment.service.js";
import type { AttachmentDocumentPreview } from "../academic/academic.shared.js";
import type { AiGeneratedExamResult, ExamAttempt, ExamAttemptReview, ExamAttemptTutorState, ExamTutorAskResult, ExamTutorTurn, LearnerExamSummary, LearnerResult, LearningExam, LearningMaterial, LearningQuestion, QuestionImportResult, RegradeRequest } from "../core/learning.types.js";
import { AiProviderService, type GeneratedExamDraft, type QuestionScanResult } from "../../system/ai/ai-provider.service.js";
import { AiGenerationRequestService } from "../ai/ai-generation-request.service.js";
import { AiMaterialContextService } from "../ai/ai-material-context.service.js";
import { AiExamTutorService } from "../ai/ai-exam-tutor.service.js";
import { MaterialAiContextDto, MaterialAiQuestionDto, MaterialAiQuestionStatusDto, MaterialAiHistoryQueryDto, MaterialStudyGuideDto, StudyDraftListQueryDto } from "../core/learning.dto.js";
import { EditExamQuestionDto, EditStudyDraftDto, PublishStudyDraftDto, UnpublishStudyDraftDto, SubmitExamDto } from "../core/learning.dto.js";
import { isInlineSafeMime, USER_FILE_CSP } from "../../../infrastructure/file-signature.js";

@ApiTags("Content & Assessment")
@Controller()
/** API học liệu, ngân hàng câu hỏi, AI scan, đề thi và vòng đời lượt làm bài. */
export class ContentController {
  constructor(
    private readonly materials: ContentMaterialService,
    private readonly exams: ExamAssessmentService,
    private readonly aiProviders: AiProviderService,
    private readonly aiRequests: AiGenerationRequestService,
    private readonly materialAi: AiMaterialContextService,
    @Optional() private readonly examTutor?: AiExamTutorService,
  ) {}

  /** Chặn mọi thao tác tạo, sửa, xuất bản và AI trên câu hỏi/đề thi đối với vai trò chỉ xem. */
  private assertInstructorMutation(session: AuthenticatedSession): void {
    if (session.roleCode !== "INSTRUCTOR") throw new ForbiddenException("Chỉ giảng viên được thao tác câu hỏi và đề thi.");
  }

  /** Liệt kê thư mục một cấp của lớp học (bao gồm thư mục rỗng) cho người có quyền xem lớp. */
  @Get("classes/:classId/folders") @RequirePermissions("material:view")
  publicFolders(@Param("classId") id: string, @CurrentSession() session: AuthenticatedSession): Promise<{ materials: string[]; lectures: string[]; assignments: string[] }> {
    return this.materials.classFolders(id, session.user.id, undefined, session.roleCode);
  }

  /** Liệt kê danh sách thư mục một cấp của lớp giảng viên phụ trách, bao gồm thư mục rỗng. */
  @Get("instructor/classes/:classId/folders") @RequirePermissions("material:manage")
  folders(@Param("classId") id: string, @CurrentSession() session: AuthenticatedSession): Promise<{ materials: string[]; lectures: string[]; assignments: string[] }> {
    this.assertInstructorMutation(session);
    return this.materials.classFolders(id, session.user.id, undefined, session.roleCode);
  }

  /** Tạo mới thư mục một cấp trong lớp học được phân công. */
  @Post("instructor/classes/:classId/folders") @RequirePermissions("material:manage")
  createFolder(@Param("classId") id: string, @Body() input: ClassFolderDto, @CurrentSession() session: AuthenticatedSession): Promise<{ materials: string[]; lectures: string[]; assignments: string[] }> {
    this.assertInstructorMutation(session);
    return this.materials.classFolders(id, session.user.id, input, session.roleCode);
  }

  @Get("instructor/materials/:materialId/ai-questions") @RequirePermissions("material:manage")
  @Header("Cache-Control", "no-store")
  /** Liệt kê câu hỏi riêng đã lưu, không sinh câu trả lời hoặc nhận chủ sở hữu do client cung cấp. */
  questionHistory(@Param("materialId") materialId: string, @Query() query: MaterialAiHistoryQueryDto, @CurrentSession() session: AuthenticatedSession): ReturnType<AiMaterialContextService["questionHistory"]> {
    this.assertInstructorMutation(session);
    return this.materialAi.questionHistory(materialId, query.version, session.user.id, session.roleCode, query.cursor);
  }

  @Post("instructor/materials/:materialId/ai-context") @RequirePermissions("material:manage")
  /** Chuẩn bị ngữ cảnh có nguồn cho tài liệu giảng viên được phép truy cập. */
  prepareMaterialContext(@Param("materialId") materialId: string, @Body() input: MaterialAiContextDto, @CurrentSession() session: AuthenticatedSession): ReturnType<AiMaterialContextService["prepare"]> { this.assertInstructorMutation(session); return this.materialAi.prepare(materialId, session.user.id, session.roleCode, input.query); }

  @Post("instructor/materials/:materialId/ai-question") @RequirePermissions("material:manage")
  @Header("Cache-Control", "no-store")
  /** Hỏi đáp tài liệu của giảng viên với trích dẫn từ đúng ngữ cảnh server đã đọc. */
  askMaterial(@Param("materialId") materialId: string, @Body() input: MaterialAiQuestionDto, @CurrentSession() session: AuthenticatedSession): ReturnType<AiMaterialContextService["ask"]> { this.assertInstructorMutation(session); return this.materialAi.ask(materialId, session.user.id, session.roleCode, input.question, input.language); }

  @Post("instructor/materials/:materialId/ai-question/status") @RequirePermissions("material:manage")
  @HttpCode(200) @Header("Cache-Control", "no-store")
  /** Tra cứu trạng thái chỉ đọc qua body để nội dung câu hỏi riêng không xuất hiện trong URL. */
  questionStatus(@Param("materialId") materialId: string, @Body() input: MaterialAiQuestionStatusDto, @CurrentSession() session: AuthenticatedSession): ReturnType<AiMaterialContextService["questionStatus"]> { this.assertInstructorMutation(session); return this.materialAi.questionStatus(materialId, session.user.id, session.roleCode, input.question, input.language, input.version); }

  @Post("instructor/materials/:materialId/ai-study-guide") @RequirePermissions("material:manage")
  /** Tạo tóm tắt và thẻ ôn tập có nguồn từ học liệu giảng viên được phép xem. */
  studyMaterial(@Param("materialId") materialId: string, @Body() input: MaterialStudyGuideDto, @CurrentSession() session: AuthenticatedSession): ReturnType<AiMaterialContextService["study"]> { this.assertInstructorMutation(session); return this.materialAi.study(materialId, session.user.id, session.roleCode, input); }

  @Get("instructor/materials/:materialId/ai-study-guides") @RequirePermissions("material:manage")
  /** Liệt kê lịch sử bộ ôn tập riêng của giảng viên, có phân trang. */
  listStudyDrafts(@Param("materialId") materialId: string, @Query() query: StudyDraftListQueryDto, @CurrentSession() session: AuthenticatedSession): ReturnType<AiMaterialContextService["listStudyDrafts"]> { this.assertInstructorMutation(session); return this.materialAi.listStudyDrafts(materialId, session.user.id, session.roleCode, query.cursor); }

  @Get("instructor/materials/:materialId/ai-study-guides/:draftId") @RequirePermissions("material:manage")
  /** Mở lại bộ ôn tập đã lưu sau khi xác nhận quyền đối với phiên bản nguồn. */
  getStudyDraft(@Param("materialId") materialId: string, @Param("draftId") draftId: string, @CurrentSession() session: AuthenticatedSession): ReturnType<AiMaterialContextService["getStudyDraft"]> { this.assertInstructorMutation(session); return this.materialAi.getStudyDraft(materialId, draftId, session.user.id, session.roleCode); }

  /** Chỉnh sửa bản ôn tập riêng, giữ nguồn gốc và phát hiện xung đột chỉnh sửa. */
  @Patch("instructor/materials/:materialId/ai-study-guides/:draftId") @RequirePermissions("material:manage")
  editStudyDraft(@Param("materialId") materialId: string, @Param("draftId") draftId: string, @Body() input: EditStudyDraftDto, @CurrentSession() session: AuthenticatedSession): ReturnType<AiMaterialContextService["editStudyDraft"]> { this.assertInstructorMutation(session); return this.materialAi.editStudyDraft(materialId, draftId, session.user.id, session.roleCode, input); }

  /** Phát hành snapshot đã duyệt, không gọi AI. */
  @Post("instructor/materials/:materialId/ai-study-guides/:draftId/publish") @RequirePermissions("material:manage")
  publishStudyDraft(@Param("materialId") materialId: string, @Param("draftId") draftId: string, @Body() input: PublishStudyDraftDto, @CurrentSession() session: AuthenticatedSession): ReturnType<AiMaterialContextService["publishStudyDraft"]> { this.assertInstructorMutation(session); return this.materialAi.publishStudyDraft(materialId, draftId, session.user.id, session.roleCode, input); }

  /** Thu hồi quyền xem snapshot của học viên mà không xóa bản nháp riêng. */
  @Post("instructor/materials/:materialId/ai-study-guides/:draftId/unpublish") @RequirePermissions("material:manage")
  unpublishStudyDraft(@Param("materialId") materialId: string, @Param("draftId") draftId: string, @Body() input: UnpublishStudyDraftDto, @CurrentSession() session: AuthenticatedSession): ReturnType<AiMaterialContextService["unpublishStudyDraft"]> { this.assertInstructorMutation(session); return this.materialAi.unpublishStudyDraft(materialId, draftId, session.user.id, session.roleCode, input.expectedPublicationRevision); }

  @Get("learner/materials/:materialId/study-guides") @RequirePermissions("material:view")
  /** Danh sách có phân trang, chỉ trả metadata của các bản phát hành có nguồn được phép xem. */
  listPublishedStudyDrafts(@Param("materialId") materialId: string, @Query() query: StudyDraftListQueryDto, @CurrentSession() session: AuthenticatedSession): ReturnType<AiMaterialContextService["listPublishedStudyDrafts"]> { return this.materialAi.listPublishedStudyDrafts(materialId, session.user.id, session.roleCode, query.cursor); }

  /** Đọc bộ ôn tập công khai theo quyền truy cập lớp của người dùng hiện tại. */
  @Get("learner/materials/:materialId/study-guides/:draftId") @RequirePermissions("material:view")
  getPublishedStudyDraft(@Param("materialId") materialId: string, @Param("draftId") draftId: string, @CurrentSession() session: AuthenticatedSession): ReturnType<AiMaterialContextService["getPublishedStudyDraft"]> { return this.materialAi.getPublishedStudyDraft(materialId, draftId, session.user.id, session.roleCode); }

  @Get("materials") @RequirePermissions("material:view")
  /** Liệt kê học liệu theo vai trò, người dùng và từ khóa. */
  listMaterials(@CurrentSession() session: AuthenticatedSession, @Query("query") query?: string, @Query("page") page?: string): Promise<LearningMaterial[]> { return this.materials.listMaterials(session.roleCode, query, session.user.id, Number(page)); }

  @Get("instructor/material-upload-policy") @RequirePermissions("material:manage")
  @Header("Cache-Control", "no-store")
  /** Trả về chính sách tệp đã áp dụng khi máy chủ nhận học liệu. */
  getMaterialUploadPolicy(): Promise<{ maxFileSizeMb: number; allowedMimeTypes: string[] }> { return this.materials.getMaterialUploadPolicy(); }

  @Get(["learner/materials/summary", "materials/summary"]) @RequirePermissions("material:view")
  /** Tổng hợp nhanh số lượng học liệu theo lớp, thư mục và loại nội dung để hiển thị cây điều hướng. */
  getMaterialSummary(
    @CurrentSession() session: AuthenticatedSession,
    @Query("classId") rawClassId?: string,
  ): Promise<MaterialSummaryBucket[]> {
    const classId = parseOptionalQueryString(rawClassId, "classId", 255);
    return this.materials.getMaterialSummary(session.user.id, session.roleCode, classId);
  }

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
    @Query("folderExact") folderExact?: string,
    @Query("kind") rawKind?: string,
    @Query("mimeType") mimeType?: string,
    @Query("tag") tag?: string,
    @Query("page") rawPage?: string,
    @Query("pageSize") rawPageSize?: string,
  ): Promise<MaterialSearchResult> {
    const normalizedKind = parseOptionalQueryString(rawKind, "kind", 32)?.toLowerCase();
    if (normalizedKind && normalizedKind !== "materials" && normalizedKind !== "lectures") {
      throw new BadRequestException("Tham số kind không hợp lệ.");
    }
    return this.materials.searchAccessibleMaterials(
      {
        query,
        classId,
        courseId,
        scope,
        visibility,
        aiOnly: aiOnly === "true",
        folder,
        folderExact: folderExact === "true",
        kind: normalizedKind as "materials" | "lectures" | undefined,
        mimeType,
        tag,
        page: Number(rawPage),
        pageSize: Number(rawPageSize),
      },
      session.user.id,
      session.roleCode,
    );
  }

  @Post("instructor/classes/:classId/materials") @RequirePermissions("material:manage")
  /** Tạo bài giảng dạng liên kết (không kèm tệp) cho lớp giảng viên; dung lượng do máy chủ tính theo URL. */
  createMaterial(@Param("classId") classId: string, @Body() input: CreateMaterialDto, @CurrentSession() session: AuthenticatedSession): Promise<LearningMaterial> {
    this.assertInstructorMutation(session);
    return this.materials.createMaterial(classId, input, undefined, session.user.id, session.roleCode);
  }

  @Post("instructor/classes/:classId/material-uploads") @RequirePermissions("material:manage")
  @UseInterceptors(MaterialUploadInterceptor)
  /** Chuẩn hóa tên/tags của tệp multipart rồi giao service quét virus và lưu object. */
  async uploadMaterial(
    @Param("classId") classId: string,
    @Body() input: UploadMaterialDto,
    @CurrentSession() session: AuthenticatedSession,
    @UploadedFile() file?: { originalname: string; mimetype: string; size: number; path: string },
  ): Promise<LearningMaterial> {
    this.assertInstructorMutation(session);
    if (!file) throw new BadRequestException("Cần chọn một tệp học liệu.");
    const originalName = normalizeMultipartFileName(file.originalname);
    const upload: UploadedMaterialFile = { originalName, mimeType: file.mimetype, size: file.size, path: file.path, buffer: await readFileHead(file.path) };
    return this.materials.createMaterial(classId, {
      name: originalName,
      mimeType: file.mimetype,
      sizeBytes: file.size,
      folder: input.folder,
      tags: input.tags.split(",").map((tag) => tag.trim()).filter(Boolean),
      scope: input.scope,
      visibility: input.visibility,
    }, upload, session.user.id, session.roleCode);
  }

  @Put("instructor/materials/:materialId/file") @RequirePermissions("material:manage")
  @UseInterceptors(MaterialUploadInterceptor)
  /** Tải tệp mới thay thế trực tiếp cho học liệu hiện tại và xóa ngay tệp cũ. */
  async replaceMaterialFile(
    @Param("materialId") materialId: string,
    @Body() input: UploadMaterialDto,
    @CurrentSession() session: AuthenticatedSession,
    @UploadedFile() file?: { originalname: string; mimetype: string; size: number; path: string },
  ): Promise<LearningMaterial> {
    this.assertInstructorMutation(session);
    if (!file) throw new BadRequestException("Cần chọn tệp thay thế.");
    return this.materials.replaceMaterialFile(materialId, { folder: input.folder, tags: input.tags.split(",").map((tag) => tag.trim()).filter(Boolean) }, { originalName: normalizeMultipartFileName(file.originalname), mimeType: file.mimetype, size: file.size, path: file.path, buffer: await readFileHead(file.path) }, session.user.id);
  }

  @Patch("instructor/materials/:materialId") @RequirePermissions("material:manage")
  /** Cập nhật metadata/khả năng hiển thị của học liệu. */
  updateMaterial(@Param("materialId") materialId: string, @Body() input: UpdateMaterialDto, @CurrentSession() session: AuthenticatedSession): Promise<LearningMaterial> {
    this.assertInstructorMutation(session);
    return this.materials.updateMaterial(materialId, input, session.user.id, session.roleCode);
  }

  @Delete("instructor/materials/:materialId") @RequirePermissions("material:manage") @HttpCode(204)
  /** Xóa hẳn học liệu cùng tệp lưu trữ theo phân công giảng dạy của lớp. */
  deleteMaterial(@Param("materialId") materialId: string, @CurrentSession() session: AuthenticatedSession): Promise<void> {
    this.assertInstructorMutation(session);
    return this.materials.deleteMaterial(materialId, session.user.id, session.roleCode);
  }

  @Get("materials/:materialId/access") @RequirePermissions("material:view")
  /** Phát URL ký ngắn hạn cho phiên bản học liệu hiện tại. */
  getMaterialAccess(
    @Param("materialId") materialId: string,
    @CurrentSession() session: AuthenticatedSession,
    @Query("action") rawAction = "DOWNLOAD",
  ): Promise<{ url: string; expiresAt: string }> {
    const action = rawAction === "PREVIEW" ? "PREVIEW" : "DOWNLOAD";
    return this.materials.createMaterialAccess(materialId, session.roleCode, action, session.user.id);
  }

  @Get("materials/:materialId/download") @RequirePermissions("material:view")
  /** Xác minh quyền/chữ ký rồi stream học liệu hiện tại, hỗ trợ HTTP Range (206/416) và hủy luồng khi ngắt kết nối. */
  @Header("Content-Security-Policy", USER_FILE_CSP)
  async downloadMaterial(
    @Param("materialId") materialId: string,
    @Query("expires") expires: string,
    @Query("signature") signature: string,
    @Query("action") rawAction: string,
    @Headers("range") rangeHeader: string | undefined,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @CurrentSession() session: AuthenticatedSession,
  ): Promise<StreamableFile> {
    const action: MaterialAccessAction = rawAction === "PREVIEW" ? "PREVIEW" : "DOWNLOAD";
    try {
      const download = await this.materials.readMaterialDownloadStream(
        materialId,
        Number(expires),
        signature ?? "",
        session.roleCode,
        action,
        session.user.id,
        rangeHeader,
      );
      return sendRangedStreamableFile(req, res, {
        stream: download.stream,
        totalSize: download.totalSize,
        range: download.range,
        fileName: download.fileName,
        mimeType: download.mimeType,
        disposition: fileContentDisposition(action === "PREVIEW" && isInlineSafeMime(download.mimeType) ? "inline" : "attachment", download.fileName),
      });
    } catch (error) {
      rethrowWithRangeHeaders(res, error);
    }
  }

  @Get("materials/:materialId/preview-content") @RequirePermissions("material:view")
  /** Trích xuất nội dung xem trước an toàn (DOCX/DOC/TXT) cho tệp đề hoặc học liệu. */
  previewMaterialContent(
    @Param("materialId") materialId: string,
    @CurrentSession() session: AuthenticatedSession,
  ): Promise<AttachmentDocumentPreview> {
    return this.materials.readMaterialPreviewContent(materialId, session.roleCode, session.user.id);
  }

  @Get("instructor/question-bank/questions") @RequirePermissions("question:view")
  /** Lọc ngân hàng câu hỏi và kiểm tra trạng thái query trước khi gọi service. */
  listQuestions(
    @CurrentSession() session: AuthenticatedSession,
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
    return this.exams.listQuestions({
      query,
      courseId,
      type,
      difficulty: difficulty ? Number(difficulty) : undefined,
      tag,
      status: normalizedStatus as LearningQuestion["status"] | undefined,
    }, { actorId: session.user.id, actorRole: session.roleCode });
  }

  @Get("instructor/question-bank/questions/summary") @RequirePermissions("question:view")
  /** Trả thống kê nhanh số lượng câu hỏi (tổng, trắc nghiệm, tự luận) theo khóa học trong phạm vi được phân công. */
  getQuestionSummary(@CurrentSession() session: AuthenticatedSession, @Query("courseId") rawCourseId?: string): Promise<QuestionSummary> {
    return this.exams.getQuestionSummary(parseOptionalQueryString(rawCourseId, "courseId", 191), { actorId: session.user.id, actorRole: session.roleCode });
  }

  @Get("instructor/question-bank/questions/page") @RequirePermissions("question:view")
  /** Phân trang ngân hàng câu hỏi trực tiếp từ DB bằng CTE phiên bản mới nhất mỗi family, giới hạn theo phân công. */
  listQuestionsPage(@Query() raw: Record<string, unknown>, @CurrentSession() session: AuthenticatedSession): Promise<PaginatedResult<LearningQuestion>> {
    const { page, pageSize } = parsePageQuery(raw, { pageSize: 10, maxPageSize: 100 });
    const query = parseOptionalQueryString(raw.query, "query", 255);
    const courseId = parseOptionalQueryString(raw.courseId, "courseId", 191);
    const type = parseOptionalQueryString(raw.type, "type", 64);
    const rawTypeGroup = parseOptionalQueryString(raw.typeGroup, "typeGroup", 32)?.toUpperCase();
    if (rawTypeGroup && rawTypeGroup !== "OBJECTIVE" && rawTypeGroup !== "ESSAY") {
      throw new BadRequestException("Tham số typeGroup không hợp lệ.");
    }
    const tag = parseOptionalQueryString(raw.tag, "tag", 191);
    const difficulty = parseOptionalQueryInt(raw.difficulty, "difficulty", 1, 3);
    const normalizedStatus = parseOptionalQueryString(raw.status, "status", 64)?.toUpperCase();
    if (normalizedStatus && normalizedStatus !== "DRAFT" && normalizedStatus !== "PENDING_REVIEW" && normalizedStatus !== "PUBLISHED") {
      throw new BadRequestException("Trạng thái câu hỏi phải là DRAFT, PENDING_REVIEW hoặc PUBLISHED.");
    }
    return this.exams.listQuestionsPage({
      query,
      courseId,
      type,
      typeGroup: rawTypeGroup as "OBJECTIVE" | "ESSAY" | undefined,
      difficulty,
      tag,
      status: normalizedStatus as LearningQuestion["status"] | undefined,
      page,
      pageSize,
    }, { actorId: session.user.id, actorRole: session.roleCode });
  }

  @Post("instructor/question-bank/questions") @RequirePermissions("question:manage")
  /** Tạo câu hỏi nháp hoặc tự duyệt theo cấu hình hệ thống. */
  createQuestion(@Body() input: CreateQuestionDto, @CurrentSession() session: AuthenticatedSession): Promise<LearningQuestion> { this.assertInstructorMutation(session); return this.exams.createQuestion(input, session.user.id); }

  @Patch("instructor/question-bank/questions/:questionId") @RequirePermissions("question:manage")
  /** Cập nhật nội dung/đáp án và kích hoạt lại quy trình duyệt khi cần. */
  updateQuestion(@Param("questionId") questionId: string, @Body() input: UpdateQuestionDto, @CurrentSession() session: AuthenticatedSession): Promise<LearningQuestion> { this.assertInstructorMutation(session); return this.exams.updateQuestion(questionId, input, session.user.id); }

  @Post("instructor/question-bank/questions/:questionId/image") @RequirePermissions("question:manage")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: 8 * 1024 * 1024, files: 1 } }))
  /** Nhận ảnh minh họa câu hỏi, chuẩn hóa tên và để service kiểm tra định dạng thực. */
  uploadQuestionImage(
    @Param("questionId") questionId: string,
    @CurrentSession() session: AuthenticatedSession,
    @UploadedFile() file?: { originalname: string; mimetype: string; size: number; buffer: Buffer },
  ): Promise<LearningQuestion> {
    this.assertInstructorMutation(session);
    if (!file) throw new BadRequestException("Cần chọn một ảnh cho câu hỏi.");
    return this.exams.uploadQuestionImage(questionId, { originalName: normalizeMultipartFileName(file.originalname), mimeType: file.mimetype, size: file.size, buffer: file.buffer }, session.user.id);
  }

  @Delete("instructor/question-bank/questions/:questionId/image") @RequirePermissions("question:manage")
  /** Gỡ ảnh minh họa và dọn object liên quan. */
  removeQuestionImage(@Param("questionId") questionId: string, @CurrentSession() session: AuthenticatedSession): Promise<LearningQuestion> { this.assertInstructorMutation(session); return this.exams.removeQuestionImage(questionId, session.user.id); }

  @Get("question-bank/questions/:questionId/image") @RequirePermissions("exam:view") @Header("Content-Security-Policy", USER_FILE_CSP)
  /** Kiểm tra quyền theo ngữ cảnh đề/câu hỏi rồi stream ảnh nội tuyến. */
  async readQuestionImage(@Param("questionId") questionId: string, @CurrentSession() session: AuthenticatedSession): Promise<StreamableFile> {
    const image = await this.exams.readQuestionImage(questionId, session.roleCode, session.user.id);
    return new StreamableFile(image.buffer, { type: image.mimeType, disposition: fileContentDisposition("inline", image.fileName), length: image.buffer.length });
  }

  @Post("instructor/question-bank/questions/import") @RequirePermissions("question:manage")
  /** Nhập hàng loạt câu hỏi và trả kết quả riêng cho từng mục. */
  importQuestions(@Body() input: ImportQuestionsDto, @CurrentSession() session: AuthenticatedSession): Promise<QuestionImportResult[]> { this.assertInstructorMutation(session); return this.exams.importQuestions(input.questions, session.user.id); }

  @Post("instructor/question-bank/scan-image") @RequirePermissions("question:manage")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: 12 * 1024 * 1024, files: 1 } }))
  /** Gửi ảnh đề sang nhà cung cấp AI đã chọn để trích xuất câu hỏi có cấu trúc. */
  async scanQuestionImage(
    @CurrentSession() session: AuthenticatedSession,
    @UploadedFile() file?: { originalname: string; mimetype: string; size: number; buffer: Buffer },
    @Body("providerId") rawProviderId?: unknown,
  ): Promise<QuestionScanResult> {
    this.assertInstructorMutation(session);
    if (!file) throw new BadRequestException("Cần chọn ảnh đề thi để quét.");
    // Provider giảng viên chọn phải thuộc danh sách đang bật và có khóa; bỏ trống thì dùng phân công SCAN_IMAGE của admin.
    const providerId = typeof rawProviderId === "string" && rawProviderId.trim() ? rawProviderId.trim().slice(0, 191) : undefined;
    if (providerId && !(await this.aiProviders.list()).some((item) => item.id === providerId && item.enabled && item.hasApiKey))
      throw new BadRequestException("Nhà cung cấp AI đã chọn không còn khả dụng.");
    return this.aiProviders.scanImage({ providerId, fileName: normalizeMultipartFileName(file.originalname), mimeType: file.mimetype, buffer: file.buffer });
  }

  @Get("instructor/question-bank/ai-providers") @RequirePermissions("question:manage")
  /** Chỉ trả các AI provider đang bật và đã có khóa; tự động fallback sang provider khả dụng nếu chưa gán tác vụ riêng. */
  async listQuestionScanProviders(@CurrentSession() session: AuthenticatedSession, @Query("task") task?: string): Promise<Awaited<ReturnType<AiProviderService["list"]>>> {
    this.assertInstructorMutation(session);
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
  async listQuestionProviderModels(@Param("providerId") providerId: string, @CurrentSession() session: AuthenticatedSession): ReturnType<AiProviderService["listModels"]> {
    this.assertInstructorMutation(session);
    const configs = Object.values(await this.aiProviders.getTaskConfigs());
    return configs.filter((item) => item.providerId === providerId).map((item) => ({ value: item.model, label: item.model, description: "Do quản trị viên cấu hình." }));
  }

  @Get("exams") @RequirePermissions("exam:view")
  /** Liệt kê đề thi theo vai trò và quan hệ lớp. */
  listExams(@CurrentSession() session: AuthenticatedSession): Promise<LearningExam[]> { return this.exams.listExams(session.roleCode, session.user.id); }

  @Get("exams/page") @RequirePermissions("exam:view")
  /** Trả trang đề có giới hạn, kiểm tra query ở server và phạm vi truy cập trong truy vấn DB. */
  listExamPage(@Query() query: Record<string, unknown>, @CurrentSession() session: AuthenticatedSession): Promise<ExamPage> {
    return this.exams.listExamPage(session.roleCode, session.user.id, parseExamPageQuery(query));
  }

  @Get("learner/classes/:classId/exams") @RequirePermissions("exam:view")
  /** Trả đề thi khả dụng và trạng thái lượt làm của học viên trong một lớp. */
  listLearnerExams(@Param("classId") classId: string, @CurrentSession() session: AuthenticatedSession): Promise<LearnerExamSummary[]> { return this.exams.listLearnerExamSummaries(classId, session.user.id); }

  @Get("learner/exams") @RequirePermissions("exam:view")
  /** Tổng hợp đề thi của học viên trên tất cả lớp đã ghi danh. */
  listAllLearnerExams(@CurrentSession() session: AuthenticatedSession): Promise<LearnerExamSummary[]> { return this.exams.listLearnerExamSummaries(undefined, session.user.id); }

  @Get("learner/exams/:examId/questions") @RequirePermissions("exam:view")
  /** Lấy bộ câu hỏi theo thứ tự của lượt/học viên và không làm lộ đáp án. */
  getLearnerExamQuestions(@Param("examId") examId: string, @CurrentSession() session: AuthenticatedSession): Promise<LearningQuestion[]> { return this.exams.getExamQuestions(examId, session.user.id); }

  @Get("instructor/exams/:examId/preview") @RequirePermissions("exam:manage")
  /** Cho giảng viên phụ trách xem đề theo thứ tự gốc bất kể cấu hình xáo trộn. */
  getInstructorExamPreview(@Param("examId") examId: string, @CurrentSession() session: AuthenticatedSession): Promise<LearningQuestion[]> { this.assertInstructorMutation(session); return this.exams.getInstructorExamPreview(examId, session.user.id); }

  @Get("manager/exams/:examId/preview") @RequirePermissions("class:manage")
  /** Cho quản lý xem nội dung đề đã công bố; mỗi lần xem được ghi audit vì phản hồi chứa đáp án. */
  getReviewerExamPreview(@Param("examId") examId: string, @CurrentSession() session: AuthenticatedSession): Promise<LearningQuestion[]> { return this.exams.getReviewerExamPreview(examId, session.user.id); }

  @Post("instructor/exams") @RequirePermissions("exam:manage")
  /** Tạo đề từ danh sách câu hỏi đã chọn và cấu hình thời gian/lượt làm. */
  createExam(@Body() input: CreateExamDto, @CurrentSession() session: AuthenticatedSession): Promise<LearningExam> { this.assertInstructorMutation(session); return this.exams.createExam(input, session.user.id); }

  @Patch("instructor/exams/:examId") @RequirePermissions("exam:manage")
  /** Chỉnh toàn bộ đề nháp bằng optimistic version để không ghi đè thay đổi đồng thời. */
  updateExam(@Param("examId") examId: string, @Body() input: UpdateExamDto, @CurrentSession() session: AuthenticatedSession): Promise<LearningExam> { this.assertInstructorMutation(session); return this.exams.updateExam(examId, input, session.user.id); }

  @Post("instructor/exams/ai-generate") @RequirePermissions("exam:manage")
  /** Tạo câu hỏi đúng ma trận từ tài liệu môn học hoặc Web Search rồi lưu thành đề nháp. */
  async generateAiExam(@Body() input: GenerateAiExamDto, @CurrentSession() session: AuthenticatedSession): Promise<AiGeneratedExamResult> {
    this.assertInstructorMutation(session);
    const seenTypes = new Set(input.distribution.map((item) => item.type));
    if (seenTypes.size !== input.distribution.length) throw new BadRequestException("Mỗi loại câu hỏi chỉ được xuất hiện một lần trong ma trận.");
    const totalQuestions = input.distribution.reduce((sum, item) => sum + item.count, 0);
    if (totalQuestions < 1 || totalQuestions > 50) throw new BadRequestException("Tổng số câu hỏi AI phải từ 1 đến 50.");
    // Kiểm tra quyền trước khi đọc cache; không đọc file hoặc gọi provider ở bước này.
    await this.exams.getExamGenerationContext(input.classId, session.user.id, [], true);
    const { clientRequestId, providerId: _providerId, model: _model, ...payload } = input;
    void _providerId; void _model;
    return this.aiRequests.run(clientRequestId, session.user.id, payload, async () => {
      const context = await this.exams.getExamGenerationContext(input.classId, session.user.id, input.materialIds, input.contextMode === "WEB_SEARCH");
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
    const exam = await this.exams.createGeneratedExam({
      classId: input.classId,
      title: input.title,
      durationMinutes: input.durationMinutes,
      totalScore: input.totalScore,
      openAt: input.openAt,
      closeAt: input.closeAt,
      attemptLimit: input.attemptLimit,
      shuffleQuestions: input.shuffleQuestions,
      aiTutorEnabled: input.aiTutorEnabled,
      randomSeed: input.randomSeed,
    }, generated.questions, courseId, { ...generated.context, providerId: generated.providerId, provider: generated.provider, model: generated.model, warnings: generated.warnings }, canonicalRequestId, session.user.id);
    const draftWarning = exam.status === "PUBLISHED" ? [] : ["Đề đã được lưu ở dạng nháp vì chưa đủ điều kiện công bố; hãy kiểm tra rồi công bố thủ công."];
    return { exam, generatedQuestionCount: generated.questions.length, providerId: generated.providerId, provider: generated.provider, model: generated.model, context: generated.context, warnings: [...generated.warnings, ...draftWarning] };
    }, async (canonicalRequestId) => {
    const existing = await this.exams.getGeneratedExamByRequest(canonicalRequestId, input.classId, session.user.id);
    if (existing) {
      const context = existing.aiContext ?? { mode: "WEB_SEARCH" as const, materialIds: [], sources: [] };
      return { exam: existing, generatedQuestionCount: existing.questionIds.length, providerId: context.providerId ?? "reused", provider: context.provider ?? "Yêu cầu trước", model: context.model ?? "reused", context: { mode: context.mode, materialIds: context.materialIds, materialNames: [], sources: context.sources }, warnings: [...(context.warnings ?? []), "Đã trả lại đề từ yêu cầu AI hoàn tất trước đó; không tạo bản trùng."] };
    }

      return undefined;
    }, { idempotentSave: true });
  }

  @Post("instructor/exams/ai-draft") @RequirePermissions("exam:manage")
  /** Sinh bản nháp danh sách câu hỏi bằng AI để giảng viên xem, chỉnh sửa nội dung và đáp án trước khi tạo bài tập. */
  async draftAiExam(
    @Body() input: DraftAiExamDto,
    @CurrentSession() session: AuthenticatedSession,
  ): Promise<{
    courseId: string;
    providerId: string;
    provider: string;
    model: string;
    questions: GeneratedExamDraft["questions"];
    context: GeneratedExamDraft["context"];
    warnings: string[];
  }> {
    this.assertInstructorMutation(session);
    const seenTypes = new Set(input.distribution.map((item) => item.type));
    if (seenTypes.size !== input.distribution.length) {
      throw new BadRequestException("Mỗi loại câu hỏi chỉ được xuất hiện một lần trong ma trận.");
    }
    const totalQuestions = input.distribution.reduce((sum, item) => sum + item.count, 0);
    if (totalQuestions < 1 || totalQuestions > 50) {
      throw new BadRequestException("Tổng số câu hỏi AI phải từ 1 đến 50.");
    }
    const context = await this.exams.getExamGenerationContext(
      input.classId,
      session.user.id,
      input.materialIds,
      input.contextMode === "WEB_SEARCH",
    );
    const taskConfigs = await this.aiProviders.getTaskConfigs();
    let aiTask = taskConfigs["GENERATE_EXAM"];
    if (!aiTask) {
      const activeProviders = (await this.aiProviders.list()).filter(
        (item) =>
          item.enabled &&
          item.hasApiKey &&
          (item.provider === "GEMINI" || item.provider === "OPENAI" || item.provider === "CUSTOM"),
      );
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
    return {
      courseId: context.courseId,
      providerId: generated.providerId,
      provider: generated.provider,
      model: generated.model,
      questions: generated.questions,
      context: generated.context,
      warnings: generated.warnings,
    };
  }

  @Patch("instructor/exams/:examId/questions/:questionId") @RequirePermissions("exam:manage")
  /** Sửa bản câu hỏi riêng của đề nháp được phân công. */
  editExamQuestion(@Param("examId") examId: string, @Param("questionId") questionId: string, @Body() input: EditExamQuestionDto, @CurrentSession() session: AuthenticatedSession): Promise<LearningQuestion> { this.assertInstructorMutation(session); return this.exams.editExamQuestion(examId, questionId, input, session.user.id); }

  @Post("instructor/exams/:examId/publish") @RequirePermissions("exam:manage")
  /** Công bố đề sau khi kiểm tra câu hỏi và lịch học. */
  publishExam(@Param("examId") examId: string, @CurrentSession() session: AuthenticatedSession, @Body() input: SubmitExamDto = {}): Promise<LearningExam> { this.assertInstructorMutation(session); return this.exams.submitExamForReview(examId, session.user.id, input.confirmQuestions, input.expectedVersion, input.forcePublish); }

  @Get("instructor/exams/:examId/ai-tutor") @RequirePermissions("exam:manage")
  @Header("Cache-Control", "no-store")
  /** Nạp cấu hình gợi ý mẫu và hạn mức gia sư AI cho chế độ làm thử của giảng viên. */
  getInstructorPreviewTutorState(
    @Param("examId") examId: string,
    @CurrentSession() session: AuthenticatedSession,
  ): Promise<ExamAttemptTutorState> {
    this.assertInstructorMutation(session);
    if (!this.examTutor) throw new BadRequestException("Dịch vụ gia sư AI chưa được khởi tạo.");
    return this.examTutor.getInstructorPreviewTutorState(examId, session.user.id);
  }

  @Post("instructor/exams/:examId/questions/:questionId/ai-tutor") @RequirePermissions("exam:manage")
  @Header("Cache-Control", "no-store")
  /** Trả lời dẫn dắt Socratic theo từng câu hỏi khi giảng viên làm thử đề có bật hỏi đáp AI. */
  askInstructorPreviewQuestionTutor(
    @Param("examId") examId: string,
    @Param("questionId") questionId: string,
    @Body() input: AskInstructorPreviewTutorDto,
    @CurrentSession() session: AuthenticatedSession,
  ): Promise<{ turn: ExamTutorTurn; maxPerQuestion: number; maxPerExam: number }> {
    this.assertInstructorMutation(session);
    if (!this.examTutor) throw new BadRequestException("Dịch vụ gia sư AI chưa được khởi tạo.");
    return this.examTutor.askInstructorPreviewTutor(examId, questionId, session.user.id, input);
  }

  @Post("learner/exams/:examId/attempts") @RequirePermissions("exam:view")
  /** Mở hoặc tiếp tục lượt thi hợp lệ cho học viên. */
  startAttempt(@Param("examId") examId: string, @CurrentSession() session: AuthenticatedSession): Promise<ExamAttempt> { return this.exams.startAttempt(examId, session.user.id); }

  @Patch("learner/exam-attempts/:attemptId/answers") @RequirePermissions("exam:view")
  /** Lưu tạm đáp án khi lượt thi vẫn đang mở và thuộc học viên. */
  saveAnswer(@Param("attemptId") attemptId: string, @Body() input: SaveAnswerDto, @CurrentSession() session: AuthenticatedSession): Promise<ExamAttempt> { return this.exams.saveAnswer(attemptId, input.questionId, input.answers, session.user.id); }

  @Post("learner/exam-attempts/:attemptId/submit") @RequirePermissions("exam:view")
  /** Chốt lượt thi, tự chấm phần hỗ trợ được và chuyển trạng thái phù hợp. */
  submitAttempt(@Param("attemptId") attemptId: string, @Body() input: SubmitAttemptDto, @CurrentSession() session: AuthenticatedSession): Promise<ExamAttempt> { return this.exams.submitAttemptWithAnswers(attemptId, session.user.id, input.answers ?? []); }

  @Get("learner/exam-attempts/:attemptId/ai-tutor") @RequirePermissions("exam:view")
  @Header("Cache-Control", "no-store")
  /** Nạp cấu hình gợi ý mẫu, hạn mức còn lại và lịch sử chat dẫn dắt theo từng câu của lượt làm bài. */
  getAttemptTutorState(@Param("attemptId") attemptId: string, @CurrentSession() session: AuthenticatedSession): Promise<ExamAttemptTutorState> {
    if (!this.examTutor) throw new BadRequestException("Dịch vụ gia sư AI chưa được khởi tạo.");
    return this.examTutor.getAttemptTutorState(attemptId, session.user.id);
  }

  @Post("learner/exam-attempts/:attemptId/questions/:questionId/ai-tutor") @RequirePermissions("exam:view")
  @Header("Cache-Control", "no-store")
  /** Gửi câu hỏi gợi ý mẫu hoặc câu hỏi tự nhập của học viên để nhận hướng dẫn Socratic cho đúng câu đang làm. */
  askAttemptQuestionTutor(
    @Param("attemptId") attemptId: string,
    @Param("questionId") questionId: string,
    @Body() input: AskExamTutorDto,
    @CurrentSession() session: AuthenticatedSession,
  ): Promise<ExamTutorAskResult> {
    if (!this.examTutor) throw new BadRequestException("Dịch vụ gia sư AI chưa được khởi tạo.");
    return this.examTutor.askQuestionTutor(attemptId, questionId, session.user.id, input);
  }

  @Get("learner/attempts/:attemptId/result") @RequirePermissions("exam:view")
  /** Trả kết quả một lượt thi thuộc học viên hiện tại. */
  getAttempt(@Param("attemptId") attemptId: string, @CurrentSession() session: AuthenticatedSession): Promise<LearnerResult> { return this.exams.getLearnerResult(attemptId, session.user.id); }

  @Get("learner/results") @RequirePermissions("exam:view")
  /** Liệt kê toàn bộ kết quả thi của học viên hiện tại. */
  listLearnerResults(@CurrentSession() session: AuthenticatedSession): Promise<LearnerResult[]> { return this.exams.listLearnerResults(session.user.id); }

  @Post("learner/attempts/:attemptId/regrade-requests") @RequirePermissions("exam:view")
  /** Mở yêu cầu phúc khảo cho lượt thi thuộc học viên. */
  requestRegrade(@Param("attemptId") attemptId: string, @Body() input: RequestRegradeDto, @CurrentSession() session: AuthenticatedSession): Promise<RegradeRequest> {
    return this.exams.requestRegrade(attemptId, input.reason, session.user.id);
  }

  @Get("instructor/regrade-requests") @RequirePermissions("exam:manage")
  /** Liệt kê hàng đợi phúc khảo thuộc các lớp giảng viên phụ trách. */
  listRegradeRequests(@CurrentSession() session: AuthenticatedSession, @Query("status") status?: RegradeRequest["status"]): Promise<RegradeRequest[]> {
    this.assertInstructorMutation(session);
    return this.exams.listRegradeRequests(session.user.id, status);
  }

  @Post("instructor/regrade-requests/:requestId/claim") @RequirePermissions("exam:manage")
  /** Nhận xử lý độc quyền một yêu cầu phúc khảo đang mở. */
  claimRegrade(@Param("requestId") requestId: string, @CurrentSession() session: AuthenticatedSession): Promise<RegradeRequest> {
    this.assertInstructorMutation(session);
    return this.exams.claimRegrade(requestId, session.user.id);
  }

  @Post("instructor/regrade-requests/:requestId/release") @RequirePermissions("exam:manage")
  /** Nhả yêu cầu phúc khảo đã nhận nhầm hoặc không thể xử lý tiếp về hàng đợi chung. */
  releaseRegrade(@Param("requestId") requestId: string, @CurrentSession() session: AuthenticatedSession): Promise<RegradeRequest> {
    this.assertInstructorMutation(session);
    return this.exams.releaseRegrade(requestId, session.user.id);
  }

  @Patch("instructor/regrade-requests/:requestId/resolve") @RequirePermissions("exam:manage")
  /** Chấp thuận hoặc từ chối phúc khảo, đồng bộ điểm và lịch sử khi chấp thuận. */
  resolveRegrade(@Param("requestId") requestId: string, @Body() input: ResolveRegradeDto, @CurrentSession() session: AuthenticatedSession): Promise<RegradeRequest> {
    this.assertInstructorMutation(session);
    return this.exams.resolveRegrade(requestId, input, session.user.id);
  }

  @Get("instructor/exam-attempts") @RequirePermissions("exam:manage")
  /** Liệt kê lượt thi trong các lớp giảng viên phụ trách, có thể lọc theo đề. */
  listAttempts(@CurrentSession() session: AuthenticatedSession, @Query("examId") examId?: string): Promise<ExamAttempt[]> {
    this.assertInstructorMutation(session);
    return this.exams.listAttempts(examId, session.user.id);
  }

  @Get("instructor/exam-attempts/:attemptId/review") @RequirePermissions("exam:manage")
  /** Trả đề, đáp án và điểm từng câu để giảng viên chấm trong đúng phạm vi lớp. */
  reviewAttempt(@Param("attemptId") attemptId: string, @CurrentSession() session: AuthenticatedSession): Promise<ExamAttemptReview> {
    this.assertInstructorMutation(session);
    return this.exams.getAttemptReview(attemptId, session.user.id);
  }

  @Patch("instructor/exam-attempts/:attemptId/grade") @RequirePermissions("exam:manage")
  /** Chấm hoặc sửa điểm lượt thi và ghi lý do hiệu chỉnh vào lịch sử. */
  gradeAttempt(@Param("attemptId") attemptId: string, @Body() input: GradeAttemptDto, @CurrentSession() session: AuthenticatedSession): Promise<ExamAttempt> {
    this.assertInstructorMutation(session);
    return this.exams.gradeAttempt(attemptId, input.score, input.feedback, input.correctionReason, session.user.id, input.questionScores);
  }

}
