import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  Post,
  Query,
} from "@nestjs/common";
import type { AuthenticatedSession } from "../auth/auth.service.js";
import { CurrentSession } from "../auth/current-session.decorator.js";
import { RequirePermissions } from "../auth/require-permissions.decorator.js";
import {
  ExamOperationsQueryDto,
  GradingOperationsQueryDto,
  ReconcileAiOperationNotProcessedDto,
  ReconcileExamNotProcessedDto,
} from "./ai-grading-operations.dto.js";
import { AiGradingOperationsService } from "./ai-grading-operations.service.js";

@Controller("admin/ai-operations")
/** API đối soát metadata và mở lại claim bằng bằng chứng; không xóa claim hoặc tự gọi provider. */
export class AiGradingOperationsController {
  constructor(private readonly operations: AiGradingOperationsService) {}

  @Get("extractions")
  @RequirePermissions("system:configure")
  @Header("Cache-Control", "no-store")
  /** Cho quản trị viên hệ thống đọc đối soát OCR mà không cung cấp nội dung tài liệu. */
  extractions(
    @Query() query: GradingOperationsQueryDto,
    @CurrentSession() session: AuthenticatedSession,
  ): ReturnType<AiGradingOperationsService["listExtractions"]> {
    return this.operations.listExtractions(query, session);
  }

  @Post("extractions/:id/reconcile-not-processed")
  @RequirePermissions("system:configure")
  @Header("Cache-Control", "no-store")
  /** Cho phép đúng một lượt OCR lại sau khi đã xác minh provider chưa xử lý yêu cầu gốc. */
  reconcileExtractionNotProcessed(
    @Param("id") id: string,
    @Body() input: ReconcileExamNotProcessedDto,
    @CurrentSession() session: AuthenticatedSession,
  ): ReturnType<AiGradingOperationsService["reconcileExtractionNotProcessed"]> {
    return this.operations.reconcileExtractionNotProcessed(id, input, session);
  }

  @Get("document-answers")
  @RequirePermissions("system:configure")
  @Header("Cache-Control", "no-store")
  /** Cho quản trị viên hệ thống đọc thông tin tác vụ trả lời, không chạy lại hoặc đặt lại tác vụ AI. */
  documentAnswers(
    @Query() query: GradingOperationsQueryDto,
    @CurrentSession() session: AuthenticatedSession,
  ): ReturnType<AiGradingOperationsService["listDocumentAnswers"]> {
    return this.operations.listDocumentAnswers(query, session);
  }

  @Post("document-answers/:id/reconcile-not-processed")
  @RequirePermissions("system:configure")
  @Header("Cache-Control", "no-store")
  /** Cho phép đúng một lượt hỏi lại sau khi đã xác minh provider chưa xử lý yêu cầu gốc. */
  reconcileDocumentAnswerNotProcessed(
    @Param("id") id: string,
    @Body() input: ReconcileExamNotProcessedDto,
    @CurrentSession() session: AuthenticatedSession,
  ): ReturnType<
    AiGradingOperationsService["reconcileDocumentAnswerNotProcessed"]
  > {
    return this.operations.reconcileDocumentAnswerNotProcessed(
      id,
      input,
      session,
    );
  }

  @Get("grading")
  @RequirePermissions("system:configure")
  @Header("Cache-Control", "no-store")
  /** Liệt kê mặc định những yêu cầu đang xử lý hoặc chưa rõ kết quả, chỉ cho admin hệ thống. */
  list(
    @Query() query: GradingOperationsQueryDto,
    @CurrentSession() session: AuthenticatedSession,
  ): ReturnType<AiGradingOperationsService["list"]> {
    return this.operations.list(query, session);
  }

  @Post("grading/:id/reconcile-not-processed")
  @RequirePermissions("system:configure")
  @Header("Cache-Control", "no-store")
  /** Ghi bằng chứng rồi cho phép đúng một yêu cầu cùng fingerprint thử lại chấm AI. */
  reconcileGradingNotProcessed(
    @Param("id") id: string,
    @Body() input: ReconcileAiOperationNotProcessedDto,
    @CurrentSession() session: AuthenticatedSession,
  ): ReturnType<AiGradingOperationsService["reconcileGradingNotProcessed"]> {
    return this.operations.reconcileGradingNotProcessed(id, input, session);
  }

  @Get("study")
  @RequirePermissions("system:configure")
  @Header("Cache-Control", "no-store")
  /** Liệt kê trạng thái sinh tóm tắt/flashcard mà không đọc nội dung riêng của người tạo. */
  study(
    @Query() query: GradingOperationsQueryDto,
    @CurrentSession() session: AuthenticatedSession,
  ): ReturnType<AiGradingOperationsService["listStudy"]> {
    return this.operations.listStudy(query, session);
  }

  @Post("study/:id/reconcile-not-processed")
  @RequirePermissions("system:configure")
  @Header("Cache-Control", "no-store")
  /** Cho phép đúng một lượt sinh lại bộ ôn tập chưa phát hành sau khi đối soát. */
  reconcileStudyNotProcessed(
    @Param("id") id: string,
    @Body() input: ReconcileAiOperationNotProcessedDto,
    @CurrentSession() session: AuthenticatedSession,
  ): ReturnType<AiGradingOperationsService["reconcileStudyNotProcessed"]> {
    return this.operations.reconcileStudyNotProcessed(id, input, session);
  }

  @Get("exams")
  @RequirePermissions("system:configure")
  @Header("Cache-Control", "no-store")
  /** Đọc request sinh đề theo phạm vi đối soát, không trả câu hỏi/đáp án và không gọi provider. */
  exams(
    @Query() query: ExamOperationsQueryDto,
    @CurrentSession() session: AuthenticatedSession,
  ): ReturnType<AiGradingOperationsService["listExams"]> {
    return this.operations.listExams(query, session);
  }

  @Post("exams/:id/reconcile-not-processed")
  @RequirePermissions("system:configure")
  @Header("Cache-Control", "no-store")
  /** Ghi nhận bằng chứng provider chưa xử lý rồi mở lại claim; lần gọi AI kế tiếp vẫn do người tạo chủ động thực hiện. */
  reconcileExamNotProcessed(
    @Param("id") id: string,
    @Body() input: ReconcileExamNotProcessedDto,
    @CurrentSession() session: AuthenticatedSession,
  ): ReturnType<AiGradingOperationsService["reconcileExamNotProcessed"]> {
    return this.operations.reconcileExamNotProcessed(id, input, session);
  }
}
