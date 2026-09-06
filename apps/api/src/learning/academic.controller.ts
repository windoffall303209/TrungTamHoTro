import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  StreamableFile,
  UploadedFiles,
  UseInterceptors,
} from "@nestjs/common";
import { FilesInterceptor } from "@nestjs/platform-express";
import type { AuthenticatedSession } from "../auth/auth.service.js";
import { CurrentSession } from "../auth/current-session.decorator.js";
import {
  RequireAuthentication,
  RequirePermissions,
} from "../auth/require-permissions.decorator.js";
import {
  AcademicService,
  type AcademicCalendarEvent,
  type AssignmentChangeView,
  type AssignmentSubmissionView,
  type AssignmentView,
  type ClassAnnouncementView,
  type GradebookRow,
  type GradingQueueGroup,
  type UploadedAssignmentFile,
} from "./academic.service.js";
import {
  AcademicQueryDto,
  CloseAssignmentDto,
  CreateAnnouncementDto,
  CreateAssignmentDto,
  ExtendAssignmentDto,
  GradeAssignmentDto,
  SubmissionRevisionQueryDto,
  SubmitAssignmentDto,
  UpdateAssignmentDto,
} from "./academic.dto.js";

@Controller()
/** API học vụ cho bài tập, sổ điểm, lịch và thông báo; phiên hiện tại quyết định phạm vi lớp. */
export class AcademicController {
  constructor(private readonly academic: AcademicService) {}

  @Get("academic/assignments")
  @RequireAuthentication()
  /** Liệt kê bài tập trong các lớp người dùng được phép truy cập. */
  assignments(
    @Query() query: AcademicQueryDto,
    @CurrentSession() session: AuthenticatedSession,
  ): Promise<AssignmentView[]> {
    return this.academic.listAssignments(session, query.classId);
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

  @Get("instructor/assignments/:assignmentId/history")
  @RequirePermissions("exam:manage")
  /** Đọc lịch sử sửa, gia hạn, công bố và đóng bài tập. */
  assignmentHistory(
    @Param("assignmentId") assignmentId: string,
    @CurrentSession() session: AuthenticatedSession,
  ): Promise<AssignmentChangeView[]> {
    return this.academic.assignmentHistory(assignmentId, session);
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
  @UseInterceptors(
    FilesInterceptor("files", 5, {
      limits: { fileSize: 20 * 1024 * 1024, files: 5 },
    }),
  )
  /** Nộp nội dung và tệp bài tập sau khi chuẩn hóa metadata từ Multer. */
  submitAssignment(
    @Param("assignmentId") assignmentId: string,
    @Body() input: SubmitAssignmentDto,
    @CurrentSession() session: AuthenticatedSession,
    @UploadedFiles()
    files: Array<{
      originalname: string;
      mimetype: string;
      size: number;
      buffer: Buffer;
    }> = [],
  ): Promise<AssignmentSubmissionView> {
    return this.academic.submitAssignment(
      assignmentId,
      input.content,
      session,
      this.uploads(files),
      input.expectedRevision,
    );
  }

  @Post("learner/assignment-submissions/:submissionId/attachments")
  @RequirePermissions("exam:view")
  @UseInterceptors(
    FilesInterceptor("files", 5, {
      limits: { fileSize: 20 * 1024 * 1024, files: 5 },
    }),
  )
  /** Bổ sung tệp vào bài nộp còn thuộc quyền chỉnh sửa của học viên. */
  addAttachments(
    @Param("submissionId") submissionId: string,
    @CurrentSession() session: AuthenticatedSession,
    @UploadedFiles()
    files: Array<{
      originalname: string;
      mimetype: string;
      size: number;
      buffer: Buffer;
    }> = [],
  ): Promise<AssignmentSubmissionView> {
    return this.academic.addSubmissionAttachments(
      submissionId,
      this.uploads(files),
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
  /** Stream tệp bài nộp với disposition xem nội tuyến hoặc tải xuống. */
  async readAttachment(
    @Param("submissionId") submissionId: string,
    @Param("attachmentId") attachmentId: string,
    @Query("action") action: string,
    @CurrentSession() session: AuthenticatedSession,
  ): Promise<StreamableFile> {
    const file = await this.academic.readSubmissionAttachment(
      submissionId,
      attachmentId,
      session,
    );
    const preview =
      action === "preview" &&
      (file.mimeType === "application/pdf" ||
        file.mimeType.startsWith("image/"));
    return new StreamableFile(file.buffer, {
      type: file.mimeType,
      disposition: `${preview ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
      length: file.buffer.length,
    });
  }

  @Get("instructor/assignments/:assignmentId/submissions")
  @RequirePermissions("exam:manage")
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

  @Get("academic/classes/:classId/gradebook")
  @RequirePermissions("report:view")
  /** Tổng hợp điểm thi và bài tập theo từng học viên trong lớp. */
  gradebook(
    @Param("classId") classId: string,
    @CurrentSession() session: AuthenticatedSession,
  ): Promise<GradebookRow[]> {
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

  /** Chuẩn hóa tên multipart và chỉ chuyển các trường service cần xử lý. */
  private uploads(
    files: Array<{
      originalname: string;
      mimetype: string;
      size: number;
      buffer: Buffer;
    }>,
  ): UploadedAssignmentFile[] {
    if (files.some((file) => !file.buffer))
      throw new BadRequestException("Không đọc được dữ liệu tệp tải lên.");
    return files.map((file) => ({
      originalName: file.originalname,
      mimeType: file.mimetype,
      size: file.size,
      buffer: file.buffer,
    }));
  }
}
