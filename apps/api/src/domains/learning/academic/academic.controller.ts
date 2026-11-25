import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Header,
  Headers,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  StreamableFile,
  UploadedFiles,
  UseInterceptors,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { parseOptionalQueryString, parsePageQuery, type PaginatedResult } from "../../../common/pagination.js";
import { readFileHead } from "../../../infrastructure/file-streams.js";
import { fileContentDisposition, normalizeMultipartFileName } from "../../../infrastructure/file-transfer.js";
import { rethrowWithRangeHeaders, sendRangedStreamableFile } from "../../../infrastructure/http-range-stream.js";
import { SubmissionUploadInterceptor } from "../../../infrastructure/submission-upload.interceptor.js";
import type { AuthenticatedSession } from "../../../auth/auth.service.js";
import { CurrentSession } from "../../../auth/current-session.decorator.js";
import {
  RequireAuthentication,
  RequirePermissions,
} from "../../../auth/require-permissions.decorator.js";
import { AcademicService, type AcademicCalendarEvent, type AssignmentSubmissionView, type AssignmentView, type AttachmentDocumentPreview, type ClassAnnouncementView, type GradebookResponse, type GradingQueueGroup, type UploadedAssignmentFile } from "./academic.service.js";
import {
  AcademicQueryDto,
  CloseAssignmentDto,
  CreateAnnouncementDto,
  AssignmentVisibilityDto,
  WorkVersionDto,
  CreateAssignmentDto,
  ExtendAssignmentDto,
  GradeAssignmentDto,
  GradingAiRequestDto,
  GradingAiStatusQueryDto,
  SubmissionRevisionQueryDto,
  SubmitAssignmentDto,
  UpdateAssignmentDto,
} from "./academic.dto.js";
import { AiGradingAssistService } from "../ai/ai-grading-assist.service.js";
import { USER_FILE_CSP } from "../../../infrastructure/file-signature.js";

@Controller()
/** API học vụ cho bài tập, sổ điểm, lịch và thông báo; phiên hiện tại quyết định phạm vi lớp. */
export class AcademicController {
  constructor(private readonly academic: AcademicService, private readonly gradingAi: AiGradingAssistService) {}

  @Get("academic/assignments")
  @RequireAuthentication()
  /** Liệt kê bài tập trong các lớp người dùng được phép truy cập. */
  assignments(
    @Query() query: AcademicQueryDto,
    @CurrentSession() session: AuthenticatedSession,
  ): Promise<AssignmentView[]> {
    return this.academic.listAssignments(session, query.classId);
  }

  @Get("academic/assignments/page")
  @RequireAuthentication()
  /** Trả danh sách bài tập phân trang từ DB theo lớp, trạng thái và từ khóa. */
  assignmentsPage(
    @Query() raw: Record<string, unknown>,
    @CurrentSession() session: AuthenticatedSession,
  ): Promise<PaginatedResult<AssignmentView>> {
    const { page, pageSize } = parsePageQuery(raw, { pageSize: 10, maxPageSize: 100 });
    const rawStatus = parseOptionalQueryString(raw.status, "status", 64)?.toUpperCase();
    if (rawStatus && !["DRAFT", "PUBLISHED", "CLOSED"].includes(rawStatus)) {
      throw new BadRequestException("Tham số status không hợp lệ.");
    }
    return this.academic.listAssignmentsPage(session, {
      classId: parseOptionalQueryString(raw.classId, "classId", 191),
      status: rawStatus as "DRAFT" | "PUBLISHED" | "CLOSED" | undefined,
      query: parseOptionalQueryString(raw.query, "query", 255),
      page,
      pageSize,
    });
  }

  @Post("instructor/classes/:classId/assignments")
  @RequirePermissions("exam:manage")
  /** Tạo bản nháp bài tập sau khi service kiểm tra quyền giảng dạy lớp. */
  createAssignment(
    @Param("classId") classId: string,
    @Body() input: CreateAssignmentDto,
    @CurrentSession() session: AuthenticatedSession,
  ): Promise<AssignmentView> {
    return this.academic.createAssignment(classId, input, session);
  }

  @Patch("instructor/assignments/:assignmentId")
  @RequirePermissions("exam:manage")
  /** Sửa bài tập nháp với expectedVersion. */
  updateAssignment(
    @Param("assignmentId") assignmentId: string,
    @Body() input: UpdateAssignmentDto,
    @CurrentSession() session: AuthenticatedSession,
  ): Promise<AssignmentView> {
    return this.academic.updateAssignment(assignmentId, input, session);
  }

  /** Thay đổi trạng thái ẩn/hiện bài tập độc lập với hạn nộp và tiến độ nộp bài. */
  @Patch("instructor/assignments/:assignmentId/visibility")
  @RequirePermissions("exam:manage")
  changeVisibility(
    @Param("assignmentId") id: string,
    @Body() input: AssignmentVisibilityDto,
    @CurrentSession() session: AuthenticatedSession,
  ): Promise<{ hidden: boolean; version: number }> {
    return this.academic.changeVisibility(id, input.hidden, input.expectedVersion, session);
  }

  /** Bật/tắt hiển thị đề thi của lớp mà không làm thay đổi trạng thái phát hành. */
  @Patch("instructor/exams/:id/visibility")
  @RequirePermissions("exam:manage")
  examVisibility(
    @Param("id") id: string,
    @Body() input: AssignmentVisibilityDto,
    @CurrentSession() session: AuthenticatedSession,
  ): Promise<{ hidden: boolean; version: number }> {
    return this.academic.changeVisibility(id, input.hidden, input.expectedVersion, session, "EXAM");
  }

  /** Xóa đề thi đã chọn theo đúng phiên bản kỳ vọng của giảng viên. */
  @Delete("instructor/exams/:id") @HttpCode(204) @RequirePermissions("exam:manage")
  deleteExam(@Param("id") id: string, @Body() input: WorkVersionDto, @CurrentSession() session: AuthenticatedSession): Promise<void> {
    return this.academic.deleteClassWork("EXAM", id, input.expectedVersion, session);
  }

  /** Xóa bài tập tự luận đã chọn cùng các bài nộp liên quan. */
  @Delete("instructor/assignments/:id") @HttpCode(204) @RequirePermissions("exam:manage")
  deleteAssignment(@Param("id") id: string, @Body() input: WorkVersionDto, @CurrentSession() session: AuthenticatedSession): Promise<void> {
    return this.academic.deleteClassWork("ASSIGNMENT", id, input.expectedVersion, session);
  }

  @Patch("instructor/assignments/:assignmentId/extend")
  @RequirePermissions("exam:manage")
  /** Gia hạn bài đã công bố và phát thông báo thay đổi. */
  extendAssignment(
    @Param("assignmentId") assignmentId: string,
    @Body() input: ExtendAssignmentDto,
    @CurrentSession() session: AuthenticatedSession,
  ): Promise<AssignmentView> {
    return this.academic.extendAssignment(
      assignmentId,
      input.dueAt,
      input.reason,
      input.expectedVersion,
      session,
    );
  }

  @Post("instructor/assignments/:assignmentId/close")
  @RequirePermissions("exam:manage")
  /** Đóng bài sớm với lý do bắt buộc. */
  closeAssignment(
    @Param("assignmentId") assignmentId: string,
    @Body() input: CloseAssignmentDto,
    @CurrentSession() session: AuthenticatedSession,
  ): Promise<AssignmentView> {
    return this.academic.closeAssignment(
      assignmentId,
      input.reason,
      input.expectedVersion,
      session,
    );
  }

  @Post("instructor/assignments/:assignmentId/publish")
  @RequirePermissions("exam:manage")
  /** Công bố bài tập để học viên có thể xem và nộp bài. */
  publishAssignment(
    @Param("assignmentId") assignmentId: string,
    @CurrentSession() session: AuthenticatedSession,
  ): Promise<AssignmentView> {
    return this.academic.publishAssignment(assignmentId, session);
  }

  @Post("learner/assignments/:assignmentId/submissions")
  @RequirePermissions("exam:view")
  @UseInterceptors(SubmissionUploadInterceptor)
  /** Nộp nội dung và tệp bài tập qua thư mục tạm trên đĩa, chỉ đọc phần đầu để kiểm tra chữ ký tệp. */
  async submitAssignment(
    @Param("assignmentId") assignmentId: string,
    @Body() input: SubmitAssignmentDto,
    @CurrentSession() session: AuthenticatedSession,
    @UploadedFiles()
    files: Array<{
      originalname: string;
      mimetype: string;
      size: number;
      buffer?: Buffer;
      path?: string;
    }> = [],
  ): Promise<AssignmentSubmissionView> {
    return this.academic.submitAssignment(
      assignmentId,
      input.content,
      session,
      await this.uploads(files),
      input.expectedRevision,
      input.keepAttachmentIds,
    );
  }

  @Post("learner/assignment-submissions/:submissionId/attachments")
  @RequirePermissions("exam:view")
  @UseInterceptors(SubmissionUploadInterceptor)
  /** Bổ sung tệp vào bài nộp qua đĩa tạm (không đệm toàn tệp trong RAM). */
  async addAttachments(
    @Param("submissionId") submissionId: string,
    @CurrentSession() session: AuthenticatedSession,
    @UploadedFiles()
    files: Array<{
      originalname: string;
      mimetype: string;
      size: number;
      buffer?: Buffer;
      path?: string;
    }> = [],
  ): Promise<AssignmentSubmissionView> {
    return this.academic.addSubmissionAttachments(
      submissionId,
      await this.uploads(files),
      session,
    );
  }

  @Delete(
    "learner/assignment-submissions/:submissionId/attachments/:attachmentId",
  )
  @RequirePermissions("exam:view")
  /** Xóa một tệp đính kèm và để service dọn object lưu trữ. */
  removeAttachment(
    @Param("submissionId") submissionId: string,
    @Param("attachmentId") attachmentId: string,
    @Query() query: SubmissionRevisionQueryDto,
    @CurrentSession() session: AuthenticatedSession,
  ): Promise<AssignmentSubmissionView> {
    return this.academic.removeSubmissionAttachment(
      submissionId,
      attachmentId,
      query.expectedRevision,
      session,
    );
  }

  @Get("assignment-submissions/:submissionId/attachments/:attachmentId")
  @RequireAuthentication()
  @Header("Content-Security-Policy", USER_FILE_CSP)
  /** Stream tệp bài nộp có hỗ trợ HTTP Range (206/416) và hủy luồng khi client ngắt kết nối. */
  async readAttachment(
    @Param("submissionId") submissionId: string,
    @Param("attachmentId") attachmentId: string,
    @Query("action") action: string,
    @Headers("range") rangeHeader: string | undefined,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @CurrentSession() session: AuthenticatedSession,
  ): Promise<StreamableFile> {
    try {
      const file = await this.academic.readSubmissionAttachmentStream(
        submissionId,
        attachmentId,
        session,
        rangeHeader,
      );
      const preview =
        action === "preview" &&
        (file.mimeType === "application/pdf" ||
          file.mimeType.startsWith("image/"));
      return sendRangedStreamableFile(req, res, {
        stream: file.stream,
        totalSize: file.totalSize,
        range: file.range,
        fileName: file.fileName,
        mimeType: file.mimeType,
        disposition: fileContentDisposition(preview ? "inline" : "attachment", file.fileName),
      });
    } catch (error) {
      rethrowWithRangeHeaders(res, error);
    }
  }

  @Get("assignment-submissions/:submissionId/attachments/:attachmentId/preview-content")
  @RequireAuthentication()
  /** Trích xuất nội dung xem trước an toàn (HTML/text) cho tệp DOCX/DOC/TXT của bài nộp. */
  previewAttachmentContent(
    @Param("submissionId") submissionId: string,
    @Param("attachmentId") attachmentId: string,
    @CurrentSession() session: AuthenticatedSession,
  ): Promise<AttachmentDocumentPreview> {
    return this.academic.previewSubmissionAttachment(
      submissionId,
      attachmentId,
      session,
    );
  }

  @Get("instructor/assignments/:assignmentId/submissions")
  @RequirePermissions("class:view")
  /** Liệt kê bài nộp cho người có quyền giảng dạy bài tập. */
  submissions(
    @Param("assignmentId") assignmentId: string,
    @CurrentSession() session: AuthenticatedSession,
  ): Promise<AssignmentSubmissionView[]> {
    return this.academic.listSubmissions(assignmentId, session);
  }

  @Patch("instructor/assignment-submissions/:submissionId/grade")
  @RequirePermissions("exam:manage")
  /** Chấm bài theo rubric và lưu phản hồi giảng viên. */
  grade(
    @Param("submissionId") submissionId: string,
    @Body() input: GradeAssignmentDto,
    @CurrentSession() session: AuthenticatedSession,
  ): Promise<AssignmentSubmissionView> {
    return this.academic.gradeSubmission(
      submissionId,
      input.rubricScores,
      input.feedback,
      input.expectedSubmissionRevision,
      input.correctionReason,
      session,
    );
  }

  @Post("instructor/assignment-submissions/:submissionId/ai-suggestion")
  @Header("Cache-Control", "no-store")
  @RequirePermissions("exam:manage")
  /** Sinh hoặc phát lại gợi ý riêng; service xác thực giảng viên/lớp và không tự lưu điểm. */
  suggestGrading(
    @Param("submissionId") submissionId: string,
    @Body() input: GradingAiRequestDto,
    @CurrentSession() session: AuthenticatedSession,
  ): ReturnType<AiGradingAssistService["suggest"]> {
    return this.gradingAi.suggest(submissionId, input.expectedSubmissionRevision, input.language, session);
  }

  @Get("instructor/assignment-submissions/:submissionId/ai-suggestion")
  @Header("Cache-Control", "no-store")
  @RequirePermissions("exam:manage")
  /** Đọc trạng thái/kết quả đã lưu có kiểm tra quyền, tuyệt đối không gọi AI từ GET. */
  gradingSuggestionStatus(
    @Param("submissionId") submissionId: string,
    @Query() query: GradingAiStatusQueryDto,
    @CurrentSession() session: AuthenticatedSession,
  ): ReturnType<AiGradingAssistService["inspect"]> {
    return this.gradingAi.inspect(submissionId, query.expectedSubmissionRevision, query.language, session);
  }

  @Get("academic/classes/:classId/gradebook")
  @RequirePermissions("class:view")
  /** Tổng hợp điểm thi và bài tập theo từng học viên trong lớp. */
  gradebook(
    @Param("classId") classId: string,
    @CurrentSession() session: AuthenticatedSession,
  ): Promise<GradebookResponse> {
    return this.academic.gradebook(classId, session);
  }

  @Get("instructor/grading-queue")
  @RequirePermissions("exam:manage")
  /** Gom bài tập và bài thi theo lớp cho một điểm vào chấm duy nhất. */
  gradingQueue(
    @Query() query: AcademicQueryDto,
    @CurrentSession() session: AuthenticatedSession,
  ): Promise<GradingQueueGroup[]> {
    return this.academic.gradingQueue(session, query.classId);
  }

  @Get("academic/calendar")
  @RequireAuthentication()
  /** Hợp nhất các mốc học vụ trong phạm vi lớp truy cập được. */
  calendar(
    @Query() query: AcademicQueryDto,
    @CurrentSession() session: AuthenticatedSession,
  ): Promise<AcademicCalendarEvent[]> {
    return this.academic.calendar(session, query.classId);
  }

  @Get("academic/announcements")
  @RequireAuthentication()
  /** Liệt kê thông báo theo lớp mà phiên hiện tại được xem. */
  announcements(
    @Query() query: AcademicQueryDto,
    @CurrentSession() session: AuthenticatedSession,
  ): Promise<ClassAnnouncementView[]> {
    return this.academic.listAnnouncements(session, query.classId);
  }

  @Post("academic/classes/:classId/announcements")
  @RequireAuthentication()
  /** Đăng thông báo lớp và ghi nhận tác giả từ phiên đăng nhập. */
  createAnnouncement(
    @Param("classId") classId: string,
    @Body() input: CreateAnnouncementDto,
    @CurrentSession() session: AuthenticatedSession,
  ): Promise<ClassAnnouncementView> {
    return this.academic.createAnnouncement(
      classId,
      input.title,
      input.body,
      session,
    );
  }

  /** Chuẩn hóa tên multipart và chỉ nạp 8 KB đầu khi tệp đã ghi ra đĩa tạm, tránh đệm toàn tệp vào RAM. */
  private async uploads(
    files: Array<{
      originalname: string;
      mimetype: string;
      size: number;
      buffer?: Buffer;
      path?: string;
    }>,
  ): Promise<UploadedAssignmentFile[]> {
    const normalized: UploadedAssignmentFile[] = [];
    for (const file of files) {
      if (file.path) {
        normalized.push({
          originalName: normalizeMultipartFileName(file.originalname),
          mimeType: file.mimetype,
          size: file.size,
          path: file.path,
          buffer: await readFileHead(file.path),
        });
      } else if (file.buffer) {
        normalized.push({
          originalName: normalizeMultipartFileName(file.originalname),
          mimeType: file.mimetype,
          size: file.size,
          buffer: file.buffer,
        });
      } else {
        throw new BadRequestException("Không đọc được dữ liệu tệp tải lên.");
      }
    }
    return normalized;
  }
}
