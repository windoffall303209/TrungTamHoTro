import { BadRequestException, Body, Controller, Get, Headers, Param, Patch, Post, Query, StreamableFile, UploadedFile, UseInterceptors } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { FileInterceptor } from "@nestjs/platform-express";
import { RequirePermissions } from "../auth/require-permissions.decorator.js";
import {
  AppealReportDto, AttachRecordingDto, CancelSessionDto, CreateAttendanceAppealDto, CreatePostDto, CreateReportDto, CreateSessionDto, CreateTicketCommentDto, CreateTicketDto,
  CreateProgressInterventionDto, CreateReportExportDto, CreateTopicDto, HideForumPostDto, ModerateTopicDto, ProgressQueryDto, ResolveAttendanceAppealDto, ResolveReportDto, RunOperationalReportDto, SyncAttendanceDto, TransitionSessionDto, UpdateAttendanceDto, UpdatePostDto, UpdateProgressInterventionDto, UpdateSessionDto, UpdateTicketDto,
} from "./learning.dto.js";
import { LearningService } from "./learning.service.js";
import type { ClassProgressReport, ContentReport, ExamAnalytics, ForumPost, ForumTopic, LearningNotification, LiveSession, ModerationContext, OperationalReport, ProgressIntervention, ReportExport, ReportRun, SupportAttachment, SupportTicket, TicketComment } from "./learning.types.js";

@ApiTags("Forum, Live Class & Support")
@Controller()
export class EngagementController {
  constructor(private readonly learning: LearningService) {}

  @Get("forum/topics") @RequirePermissions("forum:view")
  listTopics(@Headers("x-role-code") role = "LEARNER"): Promise<ForumTopic[]> { return this.learning.listTopics(role); }

  @Post("instructor/classes/:classId/forum/topics") @RequirePermissions("forum:moderate")
  createTopic(@Param("classId") classId: string, @Body() input: CreateTopicDto): Promise<ForumTopic> { return this.learning.createTopic(classId, input); }

  @Post("learner/classes/:classId/forum/topics") @RequirePermissions("forum:post")
  createLearnerTopic(@Param("classId") classId: string, @Body() input: CreateTopicDto): Promise<ForumTopic> { return this.learning.createTopic(classId, { ...input, isPinned: false }, "usr-learner"); }

  @Patch("instructor/forum/topics/:topicId") @RequirePermissions("forum:moderate")
  moderateTopic(@Param("topicId") topicId: string, @Body() input: ModerateTopicDto): Promise<ForumTopic> { return this.learning.moderateTopic(topicId, input); }

  @Get("forum/topics/:topicId/posts") @RequirePermissions("forum:view")
  listPosts(@Param("topicId") topicId: string, @Headers("x-role-code") role = "LEARNER"): Promise<ForumPost[]> { return this.learning.listPosts(topicId, role); }

  @Post("learner/forum/topics/:topicId/posts") @RequirePermissions("forum:post")
  createPost(@Param("topicId") topicId: string, @Body() input: CreatePostDto): Promise<ForumPost> {
    return this.learning.createPost(topicId, input.body, "usr-learner", input.parentId, input.attachmentIds, input.mentionedUserIds);
  }

  @Patch("learner/forum/posts/:postId") @RequirePermissions("forum:post")
  updatePost(@Param("postId") postId: string, @Body() input: UpdatePostDto): Promise<ForumPost> { return this.learning.updatePost(postId, input.body); }

  @Post("learner/forum/posts/:postId/delete") @RequirePermissions("forum:post")
  deletePost(@Param("postId") postId: string): Promise<ForumPost> { return this.learning.deletePost(postId); }

  @Post("instructor/forum/posts/:postId/hide") @RequirePermissions("forum:moderate")
  hidePost(@Param("postId") postId: string, @Body() input: HideForumPostDto): Promise<ForumPost> { return this.learning.hidePost(postId, input.reason); }

  @Get("learner/notifications") @RequirePermissions("forum:view")
  listNotifications(): Promise<LearningNotification[]> { return this.learning.listNotifications(); }

  @Patch("learner/notifications/:notificationId/read") @RequirePermissions("forum:view")
  markNotificationRead(@Param("notificationId") notificationId: string): Promise<LearningNotification> {
    return this.learning.markNotificationRead(notificationId);
  }

  @Get("notifications")
  listRoleNotifications(@Headers("x-role-code") role = "LEARNER"): Promise<LearningNotification[]> {
    return this.learning.listRoleNotifications(role);
  }

  @Patch("notifications/:notificationId/read")
  markRoleNotificationRead(@Param("notificationId") notificationId: string, @Headers("x-role-code") role = "LEARNER"): Promise<LearningNotification> {
    return this.learning.markRoleNotificationRead(notificationId, role);
  }

  @Post("learner/content-reports") @RequirePermissions("forum:view")
  reportContent(@Body() input: CreateReportDto): Promise<ContentReport> { return this.learning.reportContent({ ...input, reporterId: "usr-learner" }); }

  @Get("learner/content-reports") @RequirePermissions("forum:view")
  listLearnerReports(): Promise<ContentReport[]> { return this.learning.listLearnerReports(); }

  @Get("manager/forum/reports") @RequirePermissions("forum:moderate")
  listReports(): Promise<ContentReport[]> { return this.learning.listReports(); }

  @Get("manager/forum/reports/:reportId/context") @RequirePermissions("forum:moderate")
  getReportContext(@Param("reportId") reportId: string): Promise<ModerationContext> { return this.learning.getReportContext(reportId); }

  @Post("manager/forum/reports/:reportId/claim") @RequirePermissions("forum:moderate")
  claimReport(@Param("reportId") reportId: string): Promise<ContentReport> { return this.learning.claimReport(reportId); }

  @Post("manager/forum/reports/:reportId/resolve") @RequirePermissions("forum:moderate")
  resolveReport(@Param("reportId") reportId: string, @Body() input: ResolveReportDto): Promise<ContentReport> { return this.learning.resolveReport(reportId, input.action, input.resolution); }

  @Post("learner/content-reports/:reportId/appeal") @RequirePermissions("forum:view")
  appealReport(@Param("reportId") reportId: string, @Body() input: AppealReportDto): Promise<ContentReport> { return this.learning.appealReport(reportId, input.reason); }

  @Get("sessions") @RequirePermissions("session:view")
  listSessions(@Headers("x-role-code") role = "LEARNER"): Promise<LiveSession[]> { return this.learning.listSessions(role); }

  @Post("instructor/classes/:classId/sessions") @RequirePermissions("session:manage")
  createSession(@Param("classId") classId: string, @Body() input: CreateSessionDto): Promise<LiveSession> { return this.learning.createSession(classId, input); }

  @Post("manager/classes/:classId/sessions") @RequirePermissions("class:manage")
  createManagerSession(@Param("classId") classId: string, @Body() input: CreateSessionDto): Promise<LiveSession> { return this.learning.createSession(classId, input, "usr-manager"); }

  @Patch("manager/sessions/:sessionId") @RequirePermissions("class:manage")
  updateManagerSession(@Param("sessionId") sessionId: string, @Body() input: UpdateSessionDto): Promise<LiveSession> { return this.learning.updateSession(sessionId, input); }

  @Post("manager/sessions/:sessionId/cancel") @RequirePermissions("class:manage")
  cancelManagerSession(@Param("sessionId") sessionId: string, @Body() input: CancelSessionDto): Promise<LiveSession> { return this.learning.cancelSession(sessionId, input.reason); }

  @Patch("instructor/sessions/:sessionId/status") @RequirePermissions("session:manage")
  transitionSession(@Param("sessionId") sessionId: string, @Body() input: TransitionSessionDto): Promise<LiveSession> { return this.learning.transitionSession(sessionId, input.status); }

  @Post("learner/sessions/:sessionId/join") @RequirePermissions("session:view")
  joinSession(@Param("sessionId") sessionId: string): Promise<object> { return this.learning.joinSession(sessionId); }

  @Post("learner/sessions/:sessionId/leave") @RequirePermissions("session:view")
  leaveSession(@Param("sessionId") sessionId: string): Promise<object> { return this.learning.leaveSession(sessionId); }

  @Patch("instructor/sessions/:sessionId/attendance") @RequirePermissions("session:manage")
  updateAttendance(@Param("sessionId") sessionId: string, @Body() input: UpdateAttendanceDto): Promise<object> { return this.learning.updateAttendance(sessionId, input.learnerId, input.status, input.attendedMinutes, input.adjustmentReason); }

  @Get("manager/sessions/:sessionId/attendance") @RequirePermissions("class:manage")
  getAttendanceReview(@Param("sessionId") sessionId: string): Promise<object> { return this.learning.getAttendanceReview(sessionId); }

  @Post("manager/sessions/:sessionId/attendance/sync") @RequirePermissions("class:manage")
  syncAttendance(@Param("sessionId") sessionId: string, @Body() input: SyncAttendanceDto): Promise<object> { return this.learning.syncAttendance(sessionId, input.records); }

  @Post("manager/sessions/:sessionId/attendance/lock") @RequirePermissions("class:manage")
  lockAttendance(@Param("sessionId") sessionId: string): Promise<object> { return this.learning.lockAttendance(sessionId); }

  @Post("manager/attendance-appeals/:appealId/resolve") @RequirePermissions("class:manage")
  resolveAttendanceAppeal(@Param("appealId") appealId: string, @Body() input: ResolveAttendanceAppealDto): Promise<object> {
    return this.learning.resolveAttendanceAppeal(appealId, input.decision, input.resolution, input.status, input.attendedMinutes);
  }

  @Post("instructor/sessions/:sessionId/recordings") @RequirePermissions("session:manage")
  attachRecording(@Param("sessionId") sessionId: string, @Body() input: AttachRecordingDto): Promise<LiveSession> { return this.learning.attachRecording(sessionId, input.recordingUrl); }

  @Get("learner/sessions/:sessionId/summary") @RequirePermissions("session:view")
  getSessionSummary(@Param("sessionId") sessionId: string): Promise<object> { return this.learning.getSessionSummary(sessionId); }

  @Get("learner/sessions/:sessionId/recording-access") @RequirePermissions("session:view")
  createRecordingAccess(@Param("sessionId") sessionId: string): Promise<object> { return this.learning.createRecordingAccess(sessionId); }

  @Get("learner/sessions/:sessionId/recording") @RequirePermissions("session:view")
  resolveRecordingAccess(@Param("sessionId") sessionId: string, @Query("expires") expires: string, @Query("signature") signature: string): Promise<object> {
    return this.learning.resolveRecordingAccess(sessionId, Number(expires), signature ?? "");
  }

  @Post("learner/sessions/:sessionId/attendance-appeals") @RequirePermissions("session:view")
  requestAttendanceAppeal(@Param("sessionId") sessionId: string, @Body() input: CreateAttendanceAppealDto): Promise<object> {
    return this.learning.requestAttendanceAppeal(sessionId, input.reason);
  }

  @Get("support/tickets")
  listTickets(@Headers("x-role-code") role = "LEARNER"): Promise<SupportTicket[]> { return this.learning.listTickets(role); }

  @Post("support/tickets") @RequirePermissions("support:create")
  createTicket(@Body() input: CreateTicketDto): Promise<SupportTicket> { return this.learning.createTicket(input); }

  @Post("support/tickets/:ticketId/attachments") @RequirePermissions("support:create")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: 10 * 1024 * 1024, files: 1 } }))
  addSupportAttachment(
    @Param("ticketId") ticketId: string,
    @Headers("x-role-code") role = "LEARNER",
    @UploadedFile() file?: { originalname: string; mimetype: string; size: number; buffer: Buffer },
  ): Promise<SupportAttachment> {
    if (!file) throw new BadRequestException("Cần chọn một tệp bằng chứng.");
    return this.learning.addSupportAttachment(ticketId, { originalName: file.originalname, mimeType: file.mimetype, size: file.size, buffer: file.buffer }, role);
  }

  @Patch("admin/support/tickets/:ticketId") @RequirePermissions("support:manage")
  updateTicket(@Param("ticketId") ticketId: string, @Body() input: UpdateTicketDto): Promise<SupportTicket> { return this.learning.updateTicket(ticketId, input); }

  @Get("support/tickets/:ticketId/comments")
  listTicketComments(@Param("ticketId") ticketId: string, @Headers("x-role-code") role = "LEARNER"): Promise<TicketComment[]> {
    return this.learning.listTicketComments(ticketId, role);
  }

  @Post("support/tickets/:ticketId/comments")
  addTicketComment(@Param("ticketId") ticketId: string, @Headers("x-role-code") role = "LEARNER", @Body() input: CreateTicketCommentDto): Promise<TicketComment> {
    return this.learning.addTicketComment(ticketId, input.body, role);
  }

  @Get("reports/operations") @RequirePermissions("report:view")
  getOperationalReport(@Query("from") from?: string, @Query("to") to?: string): Promise<OperationalReport> { return this.learning.getOperationalReport(from, to); }

  @Get("reports/classes") @RequirePermissions("report:view")
  getClassReports(): Promise<object[]> { return this.learning.getClassReports(); }

  @Get("instructor/analytics/exams") @RequirePermissions("report:view")
  getExamAnalytics(@Query("classId") classId?: string, @Query("examId") examId?: string, @Query("from") from?: string, @Query("to") to?: string): Promise<ExamAnalytics> { return this.learning.getExamAnalytics({ classId, examId, from, to }); }

  @Get("instructor/analytics/exams/export") @RequirePermissions("report:view")
  async exportExamAnalytics(@Query("classId") classId?: string, @Query("examId") examId?: string, @Query("from") from?: string, @Query("to") to?: string): Promise<StreamableFile> {
    const buffer = await this.learning.exportExamAnalytics({ classId, examId, from, to });
    return new StreamableFile(buffer, { type: "text/csv; charset=utf-8", disposition: `attachment; filename="exam-analytics-${Date.now()}.csv"`, length: buffer.length });
  }

  @Get("manager/classes/:classId/progress") @RequirePermissions("report:view")
  getClassProgress(@Param("classId") classId: string, @Query() input: ProgressQueryDto): Promise<ClassProgressReport> { return this.learning.getClassProgress(classId, input); }

  @Post("manager/classes/:classId/progress/interventions") @RequirePermissions("report:view")
  createProgressIntervention(@Param("classId") classId: string, @Body() input: CreateProgressInterventionDto): Promise<ProgressIntervention> { return this.learning.createProgressIntervention(classId, input); }

  @Patch("manager/progress/interventions/:interventionId") @RequirePermissions("report:view")
  updateProgressIntervention(@Param("interventionId") interventionId: string, @Body() input: UpdateProgressInterventionDto): Promise<ProgressIntervention> { return this.learning.updateProgressIntervention(interventionId, input.status); }

  @Post("manager/reports/run") @RequirePermissions("report:view")
  runOperationalReport(@Body() input: RunOperationalReportDto): Promise<ReportRun> { return this.learning.runOperationalReport(input.from, input.to); }

  @Get("manager/reports/exports") @RequirePermissions("report:view")
  listReportExports(): Promise<ReportExport[]> { return this.learning.listReportExports(); }

  @Post("manager/reports/exports") @RequirePermissions("report:view")
  createReportExport(@Body() input: CreateReportExportDto): Promise<ReportExport> { return this.learning.createReportExport(input.reportRunId, input.format); }

  @Get("manager/reports/exports/:exportId/download") @RequirePermissions("report:view")
  async downloadReportExport(@Param("exportId") exportId: string): Promise<StreamableFile> {
    const download = await this.learning.downloadReportExport(exportId);
    return new StreamableFile(download.buffer, { type: download.mimeType, disposition: `attachment; filename*=UTF-8''${encodeURIComponent(download.fileName)}`, length: download.buffer.length });
  }
}
