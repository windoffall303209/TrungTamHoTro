import { BadRequestException, Body, Controller, Get, Headers, Param, Patch, Post, Query, Req, StreamableFile, UploadedFile, UseInterceptors } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { FileInterceptor } from "@nestjs/platform-express";
import type { Request } from "express";
import { RequirePermissions } from "../auth/require-permissions.decorator.js";
import { CreateExamDto, CreateMaterialDto, CreateQuestionDto, GradeAttemptDto, SaveAnswerDto, UpdateMaterialDto, UploadMaterialDto } from "./learning.dto.js";
import { LearningService, type MaterialAccessAction, type MaterialSearchResult, type UploadedMaterialFile } from "./learning.service.js";
import type { ExamAttempt, LearningExam, LearningMaterial, LearningQuestion } from "./learning.types.js";

@ApiTags("Content & Assessment")
@Controller()
export class ContentController {
  constructor(private readonly learning: LearningService) {}

  @Get("materials") @RequirePermissions("material:view")
  listMaterials(@Headers("x-role-code") role = "LEARNER", @Query("query") query?: string): Promise<LearningMaterial[]> { return this.learning.listMaterials(role, query); }

  @Get("learner/materials/search") @RequirePermissions("material:view")
  searchMaterials(
    @Query("query") query?: string,
    @Query("classId") classId?: string,
    @Query("folder") folder?: string,
    @Query("mimeType") mimeType?: string,
    @Query("tag") tag?: string,
    @Query("page") rawPage?: string,
    @Query("pageSize") rawPageSize?: string,
  ): Promise<MaterialSearchResult> {
    return this.learning.searchAccessibleMaterials({ query, classId, folder, mimeType, tag, page: Number(rawPage), pageSize: Number(rawPageSize) });
  }

  @Post("instructor/classes/:classId/materials") @RequirePermissions("material:manage")
  createMaterial(@Param("classId") classId: string, @Body() input: CreateMaterialDto): Promise<LearningMaterial> { return this.learning.createMaterial(classId, input); }

  @Post("instructor/classes/:classId/material-uploads") @RequirePermissions("material:manage")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: 500_000_000, files: 1 } }))
  uploadMaterial(
    @Param("classId") classId: string,
    @Body() input: UploadMaterialDto,
    @UploadedFile() file?: { originalname: string; mimetype: string; size: number; buffer: Buffer },
  ): Promise<LearningMaterial> {
    if (!file) throw new BadRequestException("Cần chọn một tệp học liệu.");
    const upload: UploadedMaterialFile = { originalName: file.originalname, mimeType: file.mimetype, size: file.size, buffer: file.buffer };
    return this.learning.createMaterial(classId, {
      name: file.originalname,
      mimeType: file.mimetype,
      sizeBytes: file.size,
      folder: input.folder,
      tags: input.tags.split(",").map((tag) => tag.trim()).filter(Boolean),
    }, upload);
  }

  @Patch("instructor/materials/:materialId") @RequirePermissions("material:manage")
  updateMaterial(@Param("materialId") materialId: string, @Body() input: UpdateMaterialDto): Promise<LearningMaterial> { return this.learning.updateMaterial(materialId, input); }

  @Patch("manager/materials/:materialId/review") @RequirePermissions("class:manage")
  reviewMaterial(@Param("materialId") materialId: string, @Body() input: UpdateMaterialDto): Promise<LearningMaterial> { return this.learning.updateMaterial(materialId, input); }

  @Get("materials/:materialId/access") @RequirePermissions("material:view")
  getMaterialAccess(
    @Param("materialId") materialId: string,
    @Headers("x-role-code") role = "LEARNER",
    @Query("action") rawAction = "DOWNLOAD",
  ): Promise<{ url: string; expiresAt: string }> {
    const action = rawAction === "PREVIEW" ? "PREVIEW" : "DOWNLOAD";
    return this.learning.createMaterialAccess(materialId, role, action);
  }

  @Get("materials/:materialId/download") @RequirePermissions("material:view")
  async downloadMaterial(
    @Param("materialId") materialId: string,
    @Query("expires") expires: string,
    @Query("signature") signature: string,
    @Query("action") rawAction: string,
    @Headers("x-role-code") role = "LEARNER",
    @Req() request: Request,
  ): Promise<StreamableFile> {
    const action: MaterialAccessAction = rawAction === "PREVIEW" ? "PREVIEW" : "DOWNLOAD";
    const download = await this.learning.readMaterialDownload(materialId, Number(expires), signature ?? "", role, action, {
      ipAddress: request.ip,
      userAgent: request.header("user-agent"),
    });
    return new StreamableFile(download.buffer, {
      type: download.mimeType,
      disposition: `${action === "PREVIEW" ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(download.fileName)}`,
      length: download.buffer.length,
    });
  }

  @Get("instructor/question-bank/questions") @RequirePermissions("question:view")
  listQuestions(@Query("query") query?: string): Promise<LearningQuestion[]> { return this.learning.listQuestions(query); }

  @Post("instructor/question-bank/questions") @RequirePermissions("question:manage")
  createQuestion(@Body() input: CreateQuestionDto): Promise<LearningQuestion> { return this.learning.createQuestion(input); }

  @Get("exams") @RequirePermissions("exam:view")
  listExams(@Headers("x-role-code") role = "LEARNER"): Promise<LearningExam[]> { return this.learning.listExams(role); }

  @Get("learner/classes/:classId/exams") @RequirePermissions("exam:view")
  async listLearnerExams(@Param("classId") classId: string): Promise<LearningExam[]> { return (await this.learning.listExams("LEARNER")).filter((item) => item.classId === classId); }

  @Get("learner/exams/:examId/questions") @RequirePermissions("exam:view")
  getLearnerExamQuestions(@Param("examId") examId: string): Promise<LearningQuestion[]> { return this.learning.getExamQuestions(examId); }

  @Post("instructor/exams") @RequirePermissions("exam:manage")
  createExam(@Body() input: CreateExamDto): Promise<LearningExam> { return this.learning.createExam(input); }

  @Post("instructor/exams/:examId/publish") @RequirePermissions("exam:manage")
  publishExam(@Param("examId") examId: string): Promise<LearningExam> { return this.learning.publishExam(examId); }

  @Post("manager/exams/:examId/approve") @RequirePermissions("class:manage")
  approveExam(@Param("examId") examId: string): Promise<LearningExam> { return this.learning.publishExam(examId); }

  @Post("learner/exams/:examId/attempts") @RequirePermissions("exam:view")
  startAttempt(@Param("examId") examId: string): Promise<ExamAttempt> { return this.learning.startAttempt(examId); }

  @Patch("learner/exam-attempts/:attemptId/answers") @RequirePermissions("exam:view")
  saveAnswer(@Param("attemptId") attemptId: string, @Body() input: SaveAnswerDto): Promise<ExamAttempt> { return this.learning.saveAnswer(attemptId, input.questionId, input.answers); }

  @Post("learner/exam-attempts/:attemptId/submit") @RequirePermissions("exam:view")
  submitAttempt(@Param("attemptId") attemptId: string): Promise<ExamAttempt> { return this.learning.submitAttempt(attemptId); }

  @Get("learner/attempts/:attemptId/result") @RequirePermissions("exam:view")
  getAttempt(@Param("attemptId") attemptId: string): Promise<ExamAttempt> { return this.learning.getAttempt(attemptId); }

  @Get("instructor/exam-attempts") @RequirePermissions("exam:manage")
  listAttempts(@Query("examId") examId?: string): Promise<ExamAttempt[]> { return this.learning.listAttempts(examId); }

  @Patch("instructor/exam-attempts/:attemptId/grade") @RequirePermissions("exam:manage")
  gradeAttempt(@Param("attemptId") attemptId: string, @Body() input: GradeAttemptDto): Promise<ExamAttempt> { return this.learning.gradeAttempt(attemptId, input.score, input.feedback); }
}
