import { Body, Controller, Get, Headers, Param, Patch, Post, Query } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { RequirePermissions } from "../auth/require-permissions.decorator.js";
import { CreateExamDto, CreateMaterialDto, CreateQuestionDto, GradeAttemptDto, SaveAnswerDto, UpdateMaterialDto } from "./learning.dto.js";
import { LearningService } from "./learning.service.js";
import type { ExamAttempt, LearningExam, LearningMaterial, LearningQuestion } from "./learning.types.js";

@ApiTags("Content & Assessment")
@Controller()
export class ContentController {
  constructor(private readonly learning: LearningService) {}

  @Get("materials") @RequirePermissions("material:view")
  listMaterials(@Headers("x-role-code") role = "LEARNER", @Query("query") query?: string): LearningMaterial[] { return this.learning.listMaterials(role, query); }

  @Get("learner/materials/search") @RequirePermissions("material:view")
  searchMaterials(@Query("query") query?: string): LearningMaterial[] { return this.learning.listMaterials("LEARNER", query); }

  @Post("instructor/classes/:classId/materials") @RequirePermissions("material:manage")
  createMaterial(@Param("classId") classId: string, @Body() input: CreateMaterialDto): LearningMaterial { return this.learning.createMaterial(classId, input); }

  @Patch("instructor/materials/:materialId") @RequirePermissions("material:manage")
  updateMaterial(@Param("materialId") materialId: string, @Body() input: UpdateMaterialDto): LearningMaterial { return this.learning.updateMaterial(materialId, input); }

  @Patch("manager/materials/:materialId/review") @RequirePermissions("class:manage")
  reviewMaterial(@Param("materialId") materialId: string, @Body() input: UpdateMaterialDto): LearningMaterial { return this.learning.updateMaterial(materialId, input); }

  @Get("instructor/question-bank/questions") @RequirePermissions("question:view")
  listQuestions(@Query("query") query?: string): LearningQuestion[] { return this.learning.listQuestions(query); }

  @Post("instructor/question-bank/questions") @RequirePermissions("question:manage")
  createQuestion(@Body() input: CreateQuestionDto): LearningQuestion { return this.learning.createQuestion(input); }

  @Get("exams") @RequirePermissions("exam:view")
  listExams(@Headers("x-role-code") role = "LEARNER"): LearningExam[] { return this.learning.listExams(role); }

  @Get("learner/classes/:classId/exams") @RequirePermissions("exam:view")
  listLearnerExams(@Param("classId") classId: string): LearningExam[] { return this.learning.listExams("LEARNER").filter((item) => item.classId === classId); }

  @Get("learner/exams/:examId/questions") @RequirePermissions("exam:view")
  getLearnerExamQuestions(@Param("examId") examId: string): LearningQuestion[] { return this.learning.getExamQuestions(examId); }

  @Post("instructor/exams") @RequirePermissions("exam:manage")
  createExam(@Body() input: CreateExamDto): LearningExam { return this.learning.createExam(input); }

  @Post("instructor/exams/:examId/publish") @RequirePermissions("exam:manage")
  publishExam(@Param("examId") examId: string): LearningExam { return this.learning.publishExam(examId); }

  @Post("manager/exams/:examId/approve") @RequirePermissions("class:manage")
  approveExam(@Param("examId") examId: string): LearningExam { return this.learning.publishExam(examId); }

  @Post("learner/exams/:examId/attempts") @RequirePermissions("exam:view")
  startAttempt(@Param("examId") examId: string): ExamAttempt { return this.learning.startAttempt(examId); }

  @Patch("learner/exam-attempts/:attemptId/answers") @RequirePermissions("exam:view")
  saveAnswer(@Param("attemptId") attemptId: string, @Body() input: SaveAnswerDto): ExamAttempt { return this.learning.saveAnswer(attemptId, input.questionId, input.answers); }

  @Post("learner/exam-attempts/:attemptId/submit") @RequirePermissions("exam:view")
  submitAttempt(@Param("attemptId") attemptId: string): ExamAttempt { return this.learning.submitAttempt(attemptId); }

  @Get("learner/attempts/:attemptId/result") @RequirePermissions("exam:view")
  getAttempt(@Param("attemptId") attemptId: string): ExamAttempt { return this.learning.getAttempt(attemptId); }

  @Get("instructor/exam-attempts") @RequirePermissions("exam:manage")
  listAttempts(@Query("examId") examId?: string): ExamAttempt[] { return this.learning.listAttempts(examId); }

  @Patch("instructor/exam-attempts/:attemptId/grade") @RequirePermissions("exam:manage")
  gradeAttempt(@Param("attemptId") attemptId: string, @Body() input: GradeAttemptDto): ExamAttempt { return this.learning.gradeAttempt(attemptId, input.score, input.feedback); }
}
