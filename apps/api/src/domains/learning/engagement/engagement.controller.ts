import { BadRequestException, Body, Controller, Get, Param, Patch, Post, Query, StreamableFile, UploadedFile, UseInterceptors } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { FileInterceptor } from "@nestjs/platform-express";
import type { AuthenticatedSession } from "../../../auth/auth.service.js";
import { CurrentSession } from "../../../auth/current-session.decorator.js";
import { RequireAuthentication, RequirePermissions } from "../../../auth/require-permissions.decorator.js";
import { fileContentDisposition, normalizeMultipartFileName } from "../../../infrastructure/file-transfer.js";
import {
  AppealReportDto, AttachRecordingDto, CancelSessionDto, CompleteRecordingDto, CreateAttendanceAppealDto, CreatePostDto, CreateReportDto, CreateSessionDto, CreateTicketCommentDto, CreateTicketDto,
  CreateProgressInterventionDto, CreateReportExportDto, CreateTopicDto, HideForumPostDto, ModerateTopicDto, ProgressQueryDto, ResolveAttendanceAppealDto, ResolveReportDto, RunOperationalReportDto, SyncAttendanceDto, TransferProgressInterventionDto, TransitionSessionDto, UpdateAttendanceDto, UpdatePostDto, UpdateProgressInterventionDto, UpdateSessionDto, UpdateTicketDto,
} from "../core/learning.dto.js";
import { LearningService } from "../core/learning.service.js";
import type { ClassProgressReport, ContentReport, ExamAnalytics, ForumPost, ForumTopic, LearningNotification, LiveSession, ModerationContext, OperationalReport, ProgressIntervention, ReportExport, ReportRun, SupportAttachment, SupportTicket, TicketComment } from "../core/learning.types.js";

@ApiTags("Forum, Live Class & Support")
@Controller()
/** API tương tác học tập: diễn đàn, thông báo, kiểm duyệt, lớp trực tuyến, hỗ trợ và báo cáo. */
export class EngagementController {
  constructor(private readonly learning: LearningService) {}

  @Get("forum/topics") @RequirePermissions("forum:view")
  /** Liệt kê chủ đề diễn đàn trong các lớp phiên hiện tại truy cập được. */
  listTopics(@CurrentSession() session: AuthenticatedSession): Promise<ForumTopic[]> { return this.learning.listTopics(session.roleCode, session.user.id); }

  @Post("instructor/classes/:classId/forum/topics") @RequirePermissions("forum:moderate")
  /** Tạo chủ đề với quyền ghim/khóa dành cho người điều phối. */
  createTopic(@Param("classId") classId: string, @Body() input: CreateTopicDto, @CurrentSession() session: AuthenticatedSession): Promise<ForumTopic> { return this.learning.createTopic(classId, input, session.user.id, session.roleCode); }

  @Post("learner/classes/:classId/forum/topics") @RequirePermissions("forum:post")
  /** Tạo chủ đề học viên và bắt buộc bỏ cờ ghim ở boundary API. */
  createLearnerTopic(@Param("classId") classId: string, @Body() input: CreateTopicDto, @CurrentSession() session: AuthenticatedSession): Promise<ForumTopic> { return this.learning.createTopic(classId, { ...input, isPinned: false }, session.user.id, session.roleCode); }

  @Patch("instructor/forum/topics/:topicId") @RequirePermissions("forum:moderate")
  /** Cập nhật trạng thái ghim/khóa của chủ đề và lưu người điều phối. */
  moderateTopic(@Param("topicId") topicId: string, @Body() input: ModerateTopicDto, @CurrentSession() session: AuthenticatedSession): Promise<ForumTopic> { return this.learning.moderateTopic(topicId, input, session.user.id); }

  @Get("forum/topics/:topicId/posts") @RequirePermissions("forum:view")
  /** Liệt kê bài viết trong chủ đề sau khi kiểm tra quyền lớp. */
  listPosts(@Param("topicId") topicId: string, @CurrentSession() session: AuthenticatedSession): Promise<ForumPost[]> { return this.learning.listPosts(topicId, session.roleCode, session.user.id); }

  @Post("learner/forum/topics/:topicId/posts") @RequirePermissions("forum:post")
  /** Tạo bài viết/trả lời và chuyển danh sách tệp, người được nhắc tới cho service. */
  createPost(@Param("topicId") topicId: string, @Body() input: CreatePostDto, @CurrentSession() session: AuthenticatedSession): Promise<ForumPost> {
    return this.learning.createPost(topicId, input.body, session.user.id, input.parentId, input.attachmentIds, input.mentionedUserIds);
  }

  @Patch("learner/forum/posts/:postId") @RequirePermissions("forum:post")
  /** Sửa nội dung bài viết thuộc người dùng. */
  updatePost(@Param("postId") postId: string, @Body() input: UpdatePostDto, @CurrentSession() session: AuthenticatedSession): Promise<ForumPost> { return this.learning.updatePost(postId, input.body, session.user.id); }

  @Post("learner/forum/posts/:postId/delete") @RequirePermissions("forum:post")
  /** Xóa mềm bài viết do chính tác giả yêu cầu. */
  deletePost(@Param("postId") postId: string, @CurrentSession() session: AuthenticatedSession): Promise<ForumPost> { return this.learning.deletePost(postId, session.user.id); }

  @Post("instructor/forum/posts/:postId/hide") @RequirePermissions("forum:moderate")
  /** Ẩn bài vi phạm và ghi lý do cùng người kiểm duyệt. */
  hidePost(@Param("postId") postId: string, @Body() input: HideForumPostDto, @CurrentSession() session: AuthenticatedSession): Promise<ForumPost> { return this.learning.hidePost(postId, input.reason, session.user.id); }

  @Get("learner/notifications") @RequirePermissions("forum:view")
  /** Liệt kê thông báo của học viên hiện tại. */
  listNotifications(@CurrentSession() session: AuthenticatedSession): Promise<LearningNotification[]> { return this.learning.listNotifications(session.user.id); }

  @Patch("learner/notifications/:notificationId/read") @RequirePermissions("forum:view")
  /** Đánh dấu thông báo thuộc người dùng là đã đọc. */
  markNotificationRead(@Param("notificationId") notificationId: string, @CurrentSession() session: AuthenticatedSession): Promise<LearningNotification> {
    return this.learning.markNotificationRead(notificationId, session.user.id);
  }

  @Get("notifications") @RequireAuthentication()
  /** Dùng cùng kho thông báo cho mọi vai trò đã xác thực. */
  listRoleNotifications(@CurrentSession() session: AuthenticatedSession): Promise<LearningNotification[]> {
    return this.learning.listNotifications(session.user.id);
  }

  @Patch("notifications/:notificationId/read") @RequireAuthentication()
  /** Đánh dấu đã đọc ở endpoint dùng chung cho mọi vai trò. */
  markRoleNotificationRead(@Param("notificationId") notificationId: string, @CurrentSession() session: AuthenticatedSession): Promise<LearningNotification> {
    return this.learning.markNotificationRead(notificationId, session.user.id);
  }

  @Post("learner/content-reports") @RequirePermissions("forum:view")
  /** Tạo báo cáo nội dung và gắn reporterId từ phiên thay vì tin dữ liệu client. */
  reportContent(@Body() input: CreateReportDto, @CurrentSession() session: AuthenticatedSession): Promise<ContentReport> { return this.learning.reportContent({ ...input, reporterId: session.user.id }); }

  @Get("learner/content-reports") @RequirePermissions("forum:view")
  /** Liệt kê báo cáo do chính học viên gửi. */
  listLearnerReports(@CurrentSession() session: AuthenticatedSession): Promise<ContentReport[]> { return this.learning.listLearnerReports(session.user.id); }

  @Get("manager/forum/reports") @RequirePermissions("forum:moderate")
  /** Liệt kê hàng đợi báo cáo cho người kiểm duyệt. */
  listReports(): Promise<ContentReport[]> { return this.learning.listReports(); }

  @Get("manager/forum/reports/:reportId/context") @RequirePermissions("forum:moderate")
  /** Tải nội dung và ngữ cảnh liên quan để người quản lý ra quyết định. */
  getReportContext(@Param("reportId") reportId: string): Promise<ModerationContext> { return this.learning.getReportContext(reportId); }

  @Post("manager/forum/reports/:reportId/claim") @RequirePermissions("forum:moderate")
  /** Nhận xử lý một báo cáo để tránh nhiều người xử lý đồng thời. */
  claimReport(@Param("reportId") reportId: string, @CurrentSession() session: AuthenticatedSession): Promise<ContentReport> { return this.learning.claimReport(reportId, session.user.id, session.roleCode); }

  @Post("manager/forum/reports/:reportId/resolve") @RequirePermissions("forum:moderate")
  /** Chốt hành động kiểm duyệt và nội dung giải quyết báo cáo. */
  resolveReport(@Param("reportId") reportId: string, @Body() input: ResolveReportDto, @CurrentSession() session: AuthenticatedSession): Promise<ContentReport> { return this.learning.resolveReport(reportId, input.action, input.resolution, session.user.id, session.roleCode); }

  @Post("learner/content-reports/:reportId/appeal") @RequirePermissions("forum:view")
  /** Gửi khiếu nại đối với kết quả báo cáo thuộc người dùng. */
  appealReport(@Param("reportId") reportId: string, @Body() input: AppealReportDto, @CurrentSession() session: AuthenticatedSession): Promise<ContentReport> { return this.learning.appealReport(reportId, input.reason, session.user.id); }

  @Get("sessions") @RequirePermissions("session:view")
  /** Liệt kê buổi học trực tuyến theo vai trò và quan hệ lớp. */
  listSessions(@CurrentSession() session: AuthenticatedSession): Promise<LiveSession[]> { return this.learning.listSessions(session.roleCode, session.user.id); }

  @Post("instructor/classes/:classId/sessions") @RequirePermissions("session:manage")
  /** Lên lịch buổi học cho lớp giảng viên phụ trách. */
  createSession(@Param("classId") classId: string, @Body() input: CreateSessionDto, @CurrentSession() session: AuthenticatedSession): Promise<LiveSession> { return this.learning.createSession(classId, input, session.user.id, session.roleCode); }

  @Post("manager/classes/:classId/sessions") @RequirePermissions("class:manage")
  /** Lên lịch buổi học từ khu vực quản lý trung tâm. */
  createManagerSession(@Param("classId") classId: string, @Body() input: CreateSessionDto, @CurrentSession() session: AuthenticatedSession): Promise<LiveSession> { return this.learning.createSession(classId, input, session.user.id, session.roleCode); }

  @Patch("manager/sessions/:sessionId") @RequirePermissions("class:manage")
  /** Cập nhật lịch/phòng họp của buổi học từ khu vực quản lý. */
  updateManagerSession(@Param("sessionId") sessionId: string, @Body() input: UpdateSessionDto, @CurrentSession() session: AuthenticatedSession): Promise<LiveSession> { return this.learning.updateSession(sessionId, input, session.user.id); }

  @Post("manager/sessions/:sessionId/cancel") @RequirePermissions("class:manage")
  /** Hủy buổi học với lý do được lưu cho vận hành/audit. */
  cancelManagerSession(@Param("sessionId") sessionId: string, @Body() input: CancelSessionDto, @CurrentSession() session: AuthenticatedSession): Promise<LiveSession> { return this.learning.cancelSession(sessionId, input.reason, session.user.id); }

  @Patch("instructor/sessions/:sessionId/status") @RequirePermissions("session:manage")
  /** Chuyển trạng thái buổi học theo vòng đời LIVE/COMPLETED/CANCELLED. */
  transitionSession(@Param("sessionId") sessionId: string, @Body() input: TransitionSessionDto, @CurrentSession() session: AuthenticatedSession): Promise<LiveSession> { return this.learning.transitionSession(sessionId, input.status, session.user.id); }

  @Post("learner/sessions/:sessionId/join") @RequirePermissions("session:view")
  /** Ghi nhận học viên vào phòng và bắt đầu dữ liệu điểm danh. */
  joinSession(@Param("sessionId") sessionId: string, @CurrentSession() session: AuthenticatedSession): Promise<object> { return this.learning.joinSession(sessionId, session.user.id); }

  @Post("learner/sessions/:sessionId/leave") @RequirePermissions("session:view")
  /** Ghi nhận thời điểm rời phòng và cập nhật thời lượng tham dự. */
  leaveSession(@Param("sessionId") sessionId: string, @CurrentSession() session: AuthenticatedSession): Promise<object> { return this.learning.leaveSession(sessionId, session.user.id); }

  @Patch("instructor/sessions/:sessionId/attendance") @RequirePermissions("session:manage")
  /** Điều chỉnh điểm danh thủ công cùng lý do và actor. */
  updateAttendance(@Param("sessionId") sessionId: string, @Body() input: UpdateAttendanceDto, @CurrentSession() session: AuthenticatedSession): Promise<object> { return this.learning.updateAttendance(sessionId, input.learnerId, input.status, input.attendedMinutes, input.adjustmentReason, session.user.id); }

  @Get("manager/sessions/:sessionId/attendance") @RequirePermissions("class:manage")
  /** Trả dữ liệu điểm danh, đối soát và khiếu nại của một buổi học. */
  getAttendanceReview(@Param("sessionId") sessionId: string): Promise<object> { return this.learning.getAttendanceReview(sessionId); }

  @Post("manager/sessions/:sessionId/attendance/sync") @RequirePermissions("class:manage")
  /** Đồng bộ bản ghi tham dự từ nhà cung cấp phòng học vào dữ liệu nội bộ. */
  syncAttendance(@Param("sessionId") sessionId: string, @Body() input: SyncAttendanceDto, @CurrentSession() session: AuthenticatedSession): Promise<object> { return this.learning.syncAttendance(sessionId, input.records, session.user.id); }

  @Post("manager/sessions/:sessionId/attendance/lock") @RequirePermissions("class:manage")
  /** Khóa bảng điểm danh để ngăn đồng bộ/chỉnh sửa ngoài quy trình khiếu nại. */
  lockAttendance(@Param("sessionId") sessionId: string, @CurrentSession() session: AuthenticatedSession): Promise<object> { return this.learning.lockAttendance(sessionId, session.user.id); }

  @Post("manager/attendance-appeals/:appealId/resolve") @RequirePermissions("class:manage")
  /** Chấp nhận/từ chối khiếu nại và có thể hiệu chỉnh trạng thái, thời lượng điểm danh. */
  resolveAttendanceAppeal(@Param("appealId") appealId: string, @Body() input: ResolveAttendanceAppealDto, @CurrentSession() session: AuthenticatedSession): Promise<object> {
    return this.learning.resolveAttendanceAppeal(appealId, input.decision, input.resolution, input.status, input.attendedMinutes, session.user.id);
  }

  @Post("instructor/sessions/:sessionId/recordings") @RequirePermissions("session:manage")
  /** Gắn URL bản ghi vào buổi học và bắt đầu trạng thái xử lý. */
  attachRecording(@Param("sessionId") sessionId: string, @Body() input: AttachRecordingDto, @CurrentSession() session: AuthenticatedSession): Promise<LiveSession> { return this.learning.attachRecording(sessionId, input.recordingUrl, session.user.id); }

  @Patch("instructor/sessions/:sessionId/recordings/status") @RequirePermissions("session:manage")
  /** Hoàn tất hoặc đánh dấu lỗi xử lý bản ghi cùng chính sách lưu giữ. */
  completeRecording(@Param("sessionId") sessionId: string, @Body() input: CompleteRecordingDto, @CurrentSession() session: AuthenticatedSession): Promise<LiveSession> {
    return this.learning.completeRecording(sessionId, input.status, input.retentionDays, input.errorMessage, session.user.id);
  }

  @Get("learner/sessions/:sessionId/summary") @RequirePermissions("session:view")
  /** Trả tóm tắt buổi học và điểm danh của học viên. */
  getSessionSummary(@Param("sessionId") sessionId: string, @CurrentSession() session: AuthenticatedSession): Promise<object> { return this.learning.getSessionSummary(sessionId, session.user.id); }

  @Get("learner/sessions/:sessionId/recording-access") @RequirePermissions("session:view")
  /** Phát liên kết bản ghi có chữ ký và thời hạn ngắn. */
  createRecordingAccess(@Param("sessionId") sessionId: string, @CurrentSession() session: AuthenticatedSession): Promise<object> { return this.learning.createRecordingAccess(sessionId, session.user.id); }

  @Get("learner/sessions/:sessionId/recording") @RequirePermissions("session:view")
  /** Xác minh chữ ký/hạn của liên kết trước khi trả URL bản ghi thực. */
  resolveRecordingAccess(@Param("sessionId") sessionId: string, @Query("expires") expires: string, @Query("signature") signature: string, @CurrentSession() session: AuthenticatedSession): Promise<object> {
    return this.learning.resolveRecordingAccess(sessionId, Number(expires), signature ?? "", session.user.id);
  }

  @Post("learner/sessions/:sessionId/attendance-appeals") @RequirePermissions("session:view")
  /** Mở khiếu nại điểm danh cho chính học viên trong buổi học. */
  requestAttendanceAppeal(@Param("sessionId") sessionId: string, @Body() input: CreateAttendanceAppealDto, @CurrentSession() session: AuthenticatedSession): Promise<object> {
    return this.learning.requestAttendanceAppeal(sessionId, input.reason, session.user.id);
  }

  @Get("support/tickets") @RequireAuthentication()
  /** Liệt kê phiếu hỗ trợ theo vai trò: người gửi xem của mình, quản trị xem hàng đợi. */
  listTickets(@CurrentSession() session: AuthenticatedSession): Promise<SupportTicket[]> { return this.learning.listTickets(session.roleCode, session.user.id); }

  @Post("support/tickets") @RequirePermissions("support:create")
  /** Tạo phiếu hỗ trợ mới gắn với người dùng hiện tại. */
  createTicket(@Body() input: CreateTicketDto, @CurrentSession() session: AuthenticatedSession): Promise<SupportTicket> { return this.learning.createTicket(input, session.user.id); }

  @Post("support/tickets/:ticketId/attachments") @RequirePermissions("support:create")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: 10 * 1024 * 1024, files: 1 } }))
  /** Nhận một tệp bằng chứng và để service kiểm tra quyền, định dạng, virus và lưu trữ. */
  addSupportAttachment(
    @Param("ticketId") ticketId: string,
    @CurrentSession() session: AuthenticatedSession,
    @UploadedFile() file?: { originalname: string; mimetype: string; size: number; buffer: Buffer },
  ): Promise<SupportAttachment> {
    if (!file) throw new BadRequestException("Cần chọn một tệp bằng chứng.");
    return this.learning.addSupportAttachment(ticketId, { originalName: file.originalname, mimeType: file.mimetype, size: file.size, buffer: file.buffer }, session.roleCode, session.user.id);
  }

  @Get("support/tickets/:ticketId/attachments/:attachmentId") @RequireAuthentication()
  /** Đọc bằng chứng sau khi service kiểm tra người gửi hoặc quyền quản lý hỗ trợ. */
  async readSupportAttachment(@Param("ticketId") ticketId: string, @Param("attachmentId") attachmentId: string, @CurrentSession() session: AuthenticatedSession): Promise<StreamableFile> {
    const file = await this.learning.readSupportAttachment(ticketId, attachmentId, session.roleCode, session.user.id);
    return new StreamableFile(file.buffer, { type: file.mimeType, disposition: fileContentDisposition("inline", normalizeMultipartFileName(file.fileName)), length: file.buffer.length });
  }

  @Patch("admin/support/tickets/:ticketId") @RequirePermissions("support:manage")
  /** Cập nhật trạng thái, mức ưu tiên hoặc người phụ trách phiếu. */
  updateTicket(@Param("ticketId") ticketId: string, @Body() input: UpdateTicketDto, @CurrentSession() session: AuthenticatedSession): Promise<SupportTicket> { return this.learning.updateTicket(ticketId, input, session.user.id); }

  @Post("support/tickets/:ticketId/close") @RequirePermissions("support:create")
  /** Cho người gửi đóng phiếu của chính mình. */
  closeTicket(@Param("ticketId") ticketId: string, @CurrentSession() session: AuthenticatedSession): Promise<SupportTicket> { return this.learning.closeTicketByReporter(ticketId, session.user.id); }

  @Get("support/tickets/:ticketId/comments") @RequireAuthentication()
  /** Liệt kê trao đổi sau khi service kiểm tra người gửi hoặc nhân sự hỗ trợ. */
  listTicketComments(@Param("ticketId") ticketId: string, @CurrentSession() session: AuthenticatedSession): Promise<TicketComment[]> {
    return this.learning.listTicketComments(ticketId, session.roleCode, session.user.id);
  }

  @Post("support/tickets/:ticketId/comments") @RequireAuthentication()
  /** Thêm phản hồi vào phiếu và ghi tác giả từ phiên. */
  addTicketComment(@Param("ticketId") ticketId: string, @Body() input: CreateTicketCommentDto, @CurrentSession() session: AuthenticatedSession): Promise<TicketComment> {
    return this.learning.addTicketComment(ticketId, input.body, session.roleCode, session.user.id);
  }

  @Get("reports/operations") @RequirePermissions("report:view")
  /** Tổng hợp chỉ số vận hành trong khoảng thời gian tùy chọn. */
  getOperationalReport(@Query("from") from?: string, @Query("to") to?: string): Promise<OperationalReport> { return this.learning.getOperationalReport(from, to); }

  @Get("reports/classes") @RequirePermissions("report:view")
  /** Trả báo cáo tóm tắt theo từng lớp. */
  getClassReports(): Promise<object[]> { return this.learning.getClassReports(); }

  @Get("instructor/analytics/exams") @RequirePermissions("report:view")
  /** Tính phân tích đề/lượt thi trong phạm vi lớp giảng viên phụ trách. */
  getExamAnalytics(@CurrentSession() session: AuthenticatedSession, @Query("classId") classId?: string, @Query("examId") examId?: string, @Query("from") from?: string, @Query("to") to?: string): Promise<ExamAnalytics> { return this.learning.getExamAnalytics({ classId, examId, from, to }, session.user.id); }

  @Get("instructor/analytics/exams/export") @RequirePermissions("report:view")
  /** Xuất cùng dữ liệu phân tích đề thi thành CSV UTF-8 tải xuống. */
  async exportExamAnalytics(@CurrentSession() session: AuthenticatedSession, @Query("classId") classId?: string, @Query("examId") examId?: string, @Query("from") from?: string, @Query("to") to?: string): Promise<StreamableFile> {
    const buffer = await this.learning.exportExamAnalytics({ classId, examId, from, to }, session.user.id);
    return new StreamableFile(buffer, { type: "text/csv; charset=utf-8", disposition: `attachment; filename="exam-analytics-${Date.now()}.csv"`, length: buffer.length });
  }

  @Get("manager/classes/:classId/progress") @RequirePermissions("report:view")
  /** Tính tiến độ lớp và phân nhóm rủi ro theo các ngưỡng query. */
  getClassProgress(@Param("classId") classId: string, @Query() input: ProgressQueryDto): Promise<ClassProgressReport> { return this.learning.getClassProgress(classId, input); }

  @Post("manager/classes/:classId/progress/interventions") @RequirePermissions("report:view")
  /** Tạo biện pháp hỗ trợ cho học viên được phát hiện cần can thiệp. */
  createProgressIntervention(@Param("classId") classId: string, @Body() input: CreateProgressInterventionDto, @CurrentSession() session: AuthenticatedSession): Promise<ProgressIntervention> { return this.learning.createProgressIntervention(classId, input, session.user.id); }

  @Get("progress/interventions/mine") @RequirePermissions("report:view")
  /** Liệt kê các hành động hỗ trợ mà người dùng hiện tại đang chịu trách nhiệm. */
  listMyProgressInterventions(@CurrentSession() session: AuthenticatedSession): Promise<ProgressIntervention[]> { return this.learning.listMyProgressInterventions(session.user.id); }

  @Patch("manager/progress/interventions/:interventionId") @RequirePermissions("report:view")
  /** Chuyển trạng thái biện pháp can thiệp và ghi người cập nhật. */
  updateProgressIntervention(@Param("interventionId") interventionId: string, @Body() input: UpdateProgressInterventionDto, @CurrentSession() session: AuthenticatedSession): Promise<ProgressIntervention> { return this.learning.updateProgressIntervention(interventionId, input, session.user.id, session.roleCode); }

  @Patch("manager/progress/interventions/:interventionId/transfer") @RequirePermissions("report:view")
  /** Bàn giao hành động hỗ trợ đang mở cho giảng viên khác trong cùng lớp. */
  transferProgressIntervention(@Param("interventionId") interventionId: string, @Body() input: TransferProgressInterventionDto, @CurrentSession() session: AuthenticatedSession): Promise<ProgressIntervention> { return this.learning.transferProgressIntervention(interventionId, input.assigneeId, input.reason, session.user.id); }

  @Post("manager/reports/run") @RequirePermissions("report:view")
  /** Chụp một lần chạy báo cáo vận hành để làm nguồn cho các bản xuất. */
  runOperationalReport(@Body() input: RunOperationalReportDto, @CurrentSession() session: AuthenticatedSession): Promise<ReportRun> { return this.learning.runOperationalReport(input.from, input.to, session.user.id); }

  @Get("manager/reports/exports") @RequirePermissions("report:view")
  /** Liệt kê các bản xuất báo cáo người dùng được phép tải. */
  listReportExports(@CurrentSession() session: AuthenticatedSession): Promise<ReportExport[]> { return this.learning.listReportExports(session.user.id); }

  @Post("manager/reports/exports") @RequirePermissions("report:view")
  /** Tạo tệp xuất từ snapshot báo cáo đã chạy ở định dạng yêu cầu. */
  createReportExport(@Body() input: CreateReportExportDto, @CurrentSession() session: AuthenticatedSession): Promise<ReportExport> { return this.learning.createReportExport(input.reportRunId, input.format, session.user.id); }

  @Get("manager/reports/exports/:exportId/download") @RequirePermissions("report:view")
  /** Tải bản xuất sau khi kiểm tra quyền và giữ tên tệp Unicode qua filename*. */
  async downloadReportExport(@Param("exportId") exportId: string, @CurrentSession() session: AuthenticatedSession): Promise<StreamableFile> {
    const download = await this.learning.downloadReportExport(exportId, session.user.id);
    return new StreamableFile(download.buffer, { type: download.mimeType, disposition: `attachment; filename*=UTF-8''${encodeURIComponent(download.fileName)}`, length: download.buffer.length });
  }
}
