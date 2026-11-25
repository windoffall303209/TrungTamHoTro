import { BadRequestException, Body, Controller, Get, Header, Optional, Param, Patch, Post, Query, Sse, StreamableFile, UploadedFile, UseInterceptors } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { parseOptionalQueryString, parsePageQuery, type PaginatedResult } from "../../../common/pagination.js";
import { FileInterceptor } from "@nestjs/platform-express";
import type { Observable } from "rxjs";
import { DatabaseEventsService, type SnapshotStreamEvent } from "../../../database/database-events.service.js";
import type { AuthenticatedSession } from "../../../auth/auth.service.js";
import { CurrentSession } from "../../../auth/current-session.decorator.js";
import { RequireAuthentication, RequirePermissions } from "../../../auth/require-permissions.decorator.js";
import { fileContentDisposition, normalizeMultipartFileName } from "../../../infrastructure/file-transfer.js";
import { AttachRecordingDto, CancelSessionDto, CompleteRecordingDto, CreatePostDto, CreateSessionDto, CreateTicketCommentDto, CreateTicketDto, CreateProgressInterventionDto, CreateTopicDto, ModerateTopicDto, ProgressQueryDto, TransferProgressInterventionDto, TransitionSessionDto, UpdatePostDto, UpdateProgressInterventionDto, UpdateSessionDto, UpdateTicketDto } from "../core/learning.dto.js";
import { LearningService, type ForumPostPageResult } from "../core/learning.service.js";
import type { ClassProgressReport, ForumPost, ForumTopic, LearningNotification, LiveSession, ProgressIntervention, SupportAttachment, SupportTicket, TicketComment } from "../core/learning.types.js";
import { isInlineSafeMime, USER_FILE_CSP } from "../../../infrastructure/file-signature.js";

@ApiTags("Forum, Live Class & Support")
@Controller()
/** API tương tác học tập: diễn đàn, thông báo, kiểm duyệt, lớp trực tuyến, hỗ trợ và báo cáo. */
export class EngagementController {
  constructor(private readonly learning: LearningService, @Optional() private readonly databaseEvents?: DatabaseEventsService) {}

  @Get("forum/topics") @RequirePermissions("forum:view")
  /** Liệt kê chủ đề diễn đàn trong các lớp phiên hiện tại truy cập được. */
  listTopics(@CurrentSession() session: AuthenticatedSession): Promise<ForumTopic[]> { return this.learning.listTopics(session.roleCode, session.user.id); }

  @Get("forum/topics/page") @RequirePermissions("forum:view")
  /** Trả danh sách chủ đề diễn đàn phân trang từ DB kèm lọc lớp, ghim, bài của tôi và tìm kiếm. */
  listTopicsPage(
    @Query() raw: Record<string, unknown>,
    @CurrentSession() session: AuthenticatedSession,
  ): Promise<PaginatedResult<ForumTopic>> {
    const { page, pageSize } = parsePageQuery(raw, { pageSize: 10, maxPageSize: 100 });
    return this.learning.listTopicsPage(session.roleCode, session.user.id, {
      classId: parseOptionalQueryString(raw.classId, "classId", 191),
      query: parseOptionalQueryString(raw.query, "query", 255),
      pinnedOnly: raw.pinnedOnly === "true",
      mineOnly: raw.mineOnly === "true",
      page,
      pageSize,
    });
  }

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

  @Get("forum/topics/:topicId/posts/page") @RequirePermissions("forum:view")
  /** Phân trang bình luận gốc của chủ đề kèm đầy đủ phản hồi thuộc các gốc đó. */
  listPostsPage(
    @Param("topicId") topicId: string,
    @Query() raw: Record<string, unknown>,
    @CurrentSession() session: AuthenticatedSession,
  ): Promise<ForumPostPageResult> {
    const { page, pageSize } = parsePageQuery(raw, { pageSize: 15, maxPageSize: 100 });
    return this.learning.listPostsPage(topicId, session.roleCode, session.user.id, { page, pageSize });
  }

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

  @Get("notifications") @RequireAuthentication()
  /** Dùng cùng kho thông báo cho mọi vai trò đã xác thực. */
  listRoleNotifications(@CurrentSession() session: AuthenticatedSession): Promise<LearningNotification[]> {
    return this.learning.listNotifications(session.user.id);
  }

  /** Đồng bộ thay đổi thông báo qua SSE theo đúng tài khoản đăng nhập, kể cả giữa nhiều thiết bị. */
  @Sse("notifications/events") @RequireAuthentication()
  watchRoleNotifications(@CurrentSession() session: AuthenticatedSession): Observable<SnapshotStreamEvent<LearningNotification[]>> {
    if (!this.databaseEvents) throw new Error("Database event listener is unavailable.");
    return this.databaseEvents.watchSnapshot("notification", session.user.id,
      () => this.learning.listNotifications(session.user.id));
  }

  @Patch("notifications/read-all") @RequireAuthentication()
  /** Đánh dấu toàn bộ thông báo của tài khoản là đã đọc trong một request. */
  markAllRoleNotificationsRead(@CurrentSession() session: AuthenticatedSession): Promise<LearningNotification[]> {
    return this.learning.markAllNotificationsRead(session.user.id);
  }

  @Patch("notifications/:notificationId/read") @RequireAuthentication()
  /** Đánh dấu đã đọc ở endpoint dùng chung cho mọi vai trò. */
  markRoleNotificationRead(@Param("notificationId") notificationId: string, @CurrentSession() session: AuthenticatedSession): Promise<LearningNotification> {
    return this.learning.markNotificationRead(notificationId, session.user.id);
  }

  @Get("sessions") @RequirePermissions("session:view")
  /** Liệt kê buổi học trực tuyến theo vai trò và quan hệ lớp. */
  listSessions(@CurrentSession() session: AuthenticatedSession): Promise<LiveSession[]> { return this.learning.listSessions(session.roleCode, session.user.id); }

  @Get("sessions/page") @RequirePermissions("session:view")
  /** Phân trang danh sách buổi học trực tuyến theo lớp, trạng thái và khoảng thời gian. */
  listSessionsPage(
    @Query() raw: Record<string, unknown>,
    @CurrentSession() session: AuthenticatedSession,
  ): Promise<PaginatedResult<LiveSession>> {
    const { page, pageSize } = parsePageQuery(raw, { pageSize: 10, maxPageSize: 100 });
    const rawStatus = parseOptionalQueryString(raw.status, "status", 64)?.toUpperCase();
    if (rawStatus && !["SCHEDULED", "LIVE", "COMPLETED", "CANCELLED"].includes(rawStatus)) {
      throw new BadRequestException("Tham số status không hợp lệ.");
    }
    return this.learning.listSessionsPage(session.roleCode, session.user.id, {
      classId: parseOptionalQueryString(raw.classId, "classId", 191),
      status: rawStatus as LiveSession["status"] | undefined,
      query: parseOptionalQueryString(raw.query, "query", 255),
      from: parseOptionalQueryString(raw.from, "from", 64),
      to: parseOptionalQueryString(raw.to, "to", 64),
      page,
      pageSize,
    });
  }

  @Post("instructor/classes/:classId/sessions") @RequirePermissions("session:manage")
  /** Lên lịch buổi học cho lớp giảng viên phụ trách. */
  createSession(@Param("classId") classId: string, @Body() input: CreateSessionDto, @CurrentSession() session: AuthenticatedSession): Promise<LiveSession> { return this.learning.createSession(classId, input, session.user.id, session.roleCode); }

  @Patch("instructor/sessions/:sessionId") @RequirePermissions("session:manage")
  /** Cập nhật lịch và liên kết phòng họp cho buổi học của lớp giảng viên phụ trách. */
  updateInstructorSession(@Param("sessionId") sessionId: string, @Body() input: UpdateSessionDto, @CurrentSession() session: AuthenticatedSession): Promise<LiveSession> { return this.learning.updateSession(sessionId, input, session.user.id, session.roleCode); }

  @Post("instructor/sessions/:sessionId/cancel") @RequirePermissions("session:manage")
  /** Hủy buổi học chưa diễn ra của lớp giảng viên phụ trách. */
  cancelInstructorSession(@Param("sessionId") sessionId: string, @Body() input: CancelSessionDto, @CurrentSession() session: AuthenticatedSession): Promise<LiveSession> { return this.learning.cancelSession(sessionId, input.reason, session.user.id, session.roleCode); }

  @Post("manager/classes/:classId/sessions") @RequirePermissions("class:manage")
  /** Lên lịch buổi học từ khu vực quản lý trung tâm. */
  createManagerSession(@Param("classId") classId: string, @Body() input: CreateSessionDto, @CurrentSession() session: AuthenticatedSession): Promise<LiveSession> { return this.learning.createSession(classId, input, session.user.id, session.roleCode); }

  @Patch("manager/sessions/:sessionId") @RequirePermissions("class:manage")
  /** Cập nhật lịch/phòng họp của buổi học từ khu vực quản lý. */
  updateManagerSession(@Param("sessionId") sessionId: string, @Body() input: UpdateSessionDto, @CurrentSession() session: AuthenticatedSession): Promise<LiveSession> { return this.learning.updateSession(sessionId, input, session.user.id, session.roleCode); }

  @Post("manager/sessions/:sessionId/cancel") @RequirePermissions("class:manage")
  /** Hủy buổi học với lý do được lưu cho vận hành/audit. */
  cancelManagerSession(@Param("sessionId") sessionId: string, @Body() input: CancelSessionDto, @CurrentSession() session: AuthenticatedSession): Promise<LiveSession> { return this.learning.cancelSession(sessionId, input.reason, session.user.id, session.roleCode); }

  @Patch("instructor/sessions/:sessionId/status") @RequirePermissions("session:manage")
  /** Chuyển trạng thái buổi học theo vòng đời LIVE/COMPLETED/CANCELLED. */
  transitionSession(@Param("sessionId") sessionId: string, @Body() input: TransitionSessionDto, @CurrentSession() session: AuthenticatedSession): Promise<LiveSession> { return this.learning.transitionSession(sessionId, input.status, session.user.id); }

  @Post("sessions/:sessionId/join") @RequirePermissions("session:view")
  /** Xác minh quyền tham dự theo vai trò (giảng viên, quản lý, học viên) và trả URL phòng họp. */
  joinRoleSession(@Param("sessionId") sessionId: string, @CurrentSession() session: AuthenticatedSession): Promise<object> { return this.learning.joinSession(sessionId, session.user.id, session.roleCode); }

  @Post("learner/sessions/:sessionId/join") @RequirePermissions("session:view")
  /** Ghi nhận học viên vào phòng và bắt đầu dữ liệu điểm danh. */
  joinSession(@Param("sessionId") sessionId: string, @CurrentSession() session: AuthenticatedSession): Promise<object> { return this.learning.joinSession(sessionId, session.user.id, session.roleCode); }

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
  @Header("Cache-Control", "no-store")
  @Header("Referrer-Policy", "no-referrer")
  /** Xác minh chữ ký/hạn của liên kết trước khi trả URL bản ghi thực; không cho cache hay rò qua Referer. */
  resolveRecordingAccess(@Param("sessionId") sessionId: string, @Query("expires") expires: string, @Query("signature") signature: string, @CurrentSession() session: AuthenticatedSession): Promise<object> {
    return this.learning.resolveRecordingAccess(sessionId, Number(expires), signature ?? "", session.user.id);
  }

  @Get("support/tickets") @RequireAuthentication()
  /** Liệt kê phiếu hỗ trợ theo vai trò: người gửi xem của mình, quản trị xem hàng đợi. */
  listTickets(@CurrentSession() session: AuthenticatedSession): Promise<SupportTicket[]> { return this.learning.listTickets(session.roleCode, session.user.id); }

  @Get("support/tickets/page") @RequireAuthentication()
  /** Phân trang phiếu hỗ trợ theo vai trò, trạng thái và từ khóa từ DB. */
  listTicketsPage(
    @Query() raw: Record<string, unknown>,
    @CurrentSession() session: AuthenticatedSession,
  ): Promise<PaginatedResult<SupportTicket>> {
    const { page, pageSize } = parsePageQuery(raw, { pageSize: 10, maxPageSize: 100 });
    const rawStatus = parseOptionalQueryString(raw.status, "status", 64)?.toUpperCase();
    if (rawStatus && !["OPEN", "IN_PROGRESS", "RESOLVED", "CLOSED"].includes(rawStatus)) {
      throw new BadRequestException("Tham số status không hợp lệ.");
    }
    return this.learning.listTicketsPage(session.roleCode, session.user.id, {
      status: rawStatus as SupportTicket["status"] | undefined,
      category: parseOptionalQueryString(raw.category, "category", 100),
      query: parseOptionalQueryString(raw.query, "query", 255),
      page,
      pageSize,
    });
  }

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

  @Get("support/tickets/:ticketId/attachments/:attachmentId") @RequireAuthentication() @Header("Content-Security-Policy", USER_FILE_CSP)
  /** Đọc bằng chứng sau khi service kiểm tra người gửi hoặc quyền quản lý hỗ trợ. */
  async readSupportAttachment(@Param("ticketId") ticketId: string, @Param("attachmentId") attachmentId: string, @CurrentSession() session: AuthenticatedSession): Promise<StreamableFile> {
    const file = await this.learning.readSupportAttachment(ticketId, attachmentId, session.roleCode, session.user.id);
    return new StreamableFile(file.buffer, { type: file.mimeType, disposition: fileContentDisposition(isInlineSafeMime(file.mimeType) ? "inline" : "attachment", normalizeMultipartFileName(file.fileName)), length: file.buffer.length });
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

  @Get("manager/classes/:classId/progress") @RequirePermissions("report:view")
  /** Tính tiến độ lớp và phân nhóm rủi ro theo các ngưỡng query, ràng buộc lớp phụ trách nếu là giảng viên. */
  getClassProgress(@Param("classId") classId: string, @Query() input: ProgressQueryDto, @CurrentSession() session: AuthenticatedSession): Promise<ClassProgressReport> { return this.learning.getClassProgress(classId, input, session.user.id, session.roleCode); }

  @Post("manager/classes/:classId/progress/interventions") @RequirePermissions("report:view")
  /** Tạo biện pháp hỗ trợ cho học viên được phát hiện cần can thiệp. */
  createProgressIntervention(@Param("classId") classId: string, @Body() input: CreateProgressInterventionDto, @CurrentSession() session: AuthenticatedSession): Promise<ProgressIntervention> { return this.learning.createProgressIntervention(classId, input, session.user.id, session.roleCode); }

  @Get("progress/interventions/mine") @RequirePermissions("report:view")
  /** Liệt kê các hành động hỗ trợ mà người dùng hiện tại đang chịu trách nhiệm. */
  listMyProgressInterventions(@CurrentSession() session: AuthenticatedSession): Promise<ProgressIntervention[]> { return this.learning.listMyProgressInterventions(session.user.id); }

  @Patch("manager/progress/interventions/:interventionId") @RequirePermissions("report:view")
  /** Chuyển trạng thái biện pháp can thiệp và ghi người cập nhật. */
  updateProgressIntervention(@Param("interventionId") interventionId: string, @Body() input: UpdateProgressInterventionDto, @CurrentSession() session: AuthenticatedSession): Promise<ProgressIntervention> { return this.learning.updateProgressIntervention(interventionId, input, session.user.id, session.roleCode); }

  @Patch("manager/progress/interventions/:interventionId/transfer") @RequirePermissions("report:view")
  /** Bàn giao hành động hỗ trợ đang mở cho giảng viên khác trong cùng lớp. */
  transferProgressIntervention(@Param("interventionId") interventionId: string, @Body() input: TransferProgressInterventionDto, @CurrentSession() session: AuthenticatedSession): Promise<ProgressIntervention> { return this.learning.transferProgressIntervention(interventionId, input.assigneeId, input.reason, session.user.id, session.roleCode); }
}
