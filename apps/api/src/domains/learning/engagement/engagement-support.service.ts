import { Injectable, Optional } from "@nestjs/common";
import type { Readable } from "node:stream";
import type { PaginatedResult } from "../../../common/pagination.js";
import type { ByteRange } from "../../../infrastructure/http-range-stream.js";
import { LearningRuntimeService } from "../core/learning-runtime.service.js";
import type { MaterialDownload, UploadedMaterialFile } from "../core/learning.shared.js";
import type {
  ClassProgressReport,
  ForumPost,
  ForumTopic,
  LearningNotification,
  LiveSession,
  ProgressIntervention,
  RiskThresholds,
  SupportAttachment,
  SupportTicket,
  TicketComment,
} from "../core/learning.types.js";
import * as forum_ops from "../operations/forum/learning-forum.js";
import * as live_sessions_ops from "../operations/live/learning-live-sessions.js";
import * as recordings_ops from "../operations/live/learning-recordings.js";
import * as moderation_ops from "../operations/moderation/learning-moderation.js";
import * as progress_ops from "../operations/progress/learning-progress.js";
import * as support_ops from "../operations/support/learning-support.js";

@Injectable()
/** Service miền tương tác học tập: diễn đàn, thông báo, lớp trực tuyến, bản ghi, phiếu hỗ trợ và tiến độ học viên. */
export class EngagementSupportService {
  private readonly runtime: LearningRuntimeService;

  constructor(@Optional() runtime?: LearningRuntimeService) {
    this.runtime = runtime ?? new LearningRuntimeService();
  }

  /** Liệt kê chủ đề theo lớp truy cập được, ưu tiên chủ đề ghim rồi mới theo cập nhật. */
  async listTopics(role: string, actorId: string): Promise<ForumTopic[]> {
    return await forum_ops.listTopics(this.runtime.context, role, actorId);
  }

  /** Phân trang chủ đề diễn đàn trực tiếp từ DB kèm bộ lọc lớp, ghim, bài của tôi và từ khóa. */
  async listTopicsPage(
    role: string,
    actorId: string,
    filters: forum_ops.ForumTopicPageFilters = {},
  ): Promise<PaginatedResult<ForumTopic>> {
    return await forum_ops.listTopicsPage(this.runtime.context, role, actorId, filters);
  }

  /** Kiểm tra thành viên/chính sách nội dung rồi tạo chủ đề và thông báo thành viên lớp. */
  async createTopic(
    classId: string,
    input: Pick<ForumTopic, "title" | "body" | "tags" | "isPinned">,
    authorId: string,
    authorRole = authorId === "usr-learner" ? "LEARNER" : "INSTRUCTOR",
  ): Promise<ForumTopic> {
    return await forum_ops.createTopic(
      this.runtime.context,
      classId,
      input,
      authorId,
      authorRole,
    );
  }

  /** Ghim hoặc khóa chủ đề và ghi audit người điều phối. */
  async moderateTopic(
    topicId: string,
    input: { isLocked?: boolean; isPinned?: boolean; reason?: string },
    actorId: string,
  ): Promise<ForumTopic> {
    return await forum_ops.moderateTopic(this.runtime.context, topicId, input, actorId);
  }

  /** Kiểm tra quyền lớp rồi trả cây bài viết, ẩn nội dung đã xóa/kiểm duyệt phù hợp. */
  async listPosts(topicId: string, role: string, actorId: string): Promise<ForumPost[]> {
    return await forum_ops.listPosts(this.runtime.context, topicId, role, actorId);
  }

  /** Phân trang bình luận gốc của chủ đề kèm đầy đủ phản hồi thuộc từng gốc đó. */
  async listPostsPage(
    topicId: string,
    role: string,
    actorId: string,
    filters: { page?: number; pageSize?: number } = {},
  ): Promise<forum_ops.ForumPostPageResult> {
    return await forum_ops.listPostsPage(this.runtime.context, topicId, role, actorId, filters);
  }

  /** Validate nội dung, chủ đề chưa khóa, parent/tệp/mention hợp lệ rồi tạo post và thông báo. */
  async createPost(
    topicId: string,
    body: string,
    authorId: string,
    parentId?: string,
    rawAttachmentIds: string[] = [],
    rawMentionedUserIds: string[] = [],
  ): Promise<ForumPost> {
    return await forum_ops.createPost(
      this.runtime.context,
      topicId,
      body,
      authorId,
      parentId,
      rawAttachmentIds,
      rawMentionedUserIds,
    );
  }

  /** Cho đúng tác giả sửa bài chưa bị xóa/ẩn và chạy lại chính sách nội dung. */
  async updatePost(postId: string, body: string, authorId: string): Promise<ForumPost> {
    return await forum_ops.updatePost(this.runtime.context, postId, body, authorId);
  }

  /** Xóa mềm bài viết của tác giả để giữ tính toàn vẹn chuỗi thảo luận. */
  async deletePost(postId: string, authorId: string): Promise<ForumPost> {
    return await forum_ops.deletePost(this.runtime.context, postId, authorId);
  }

  /** Liệt kê thông báo của đúng người nhận theo thời gian mới nhất. */
  async listNotifications(recipientId: string): Promise<LearningNotification[]> {
    return await moderation_ops.listNotifications(this.runtime.context, recipientId);
  }

  /** Đánh dấu toàn bộ thông báo của người nhận là đã đọc và trả danh sách mới. */
  async markAllNotificationsRead(recipientId: string): Promise<LearningNotification[]> {
    return await moderation_ops.markAllNotificationsRead(this.runtime.context, recipientId);
  }

  /** Đánh dấu đã đọc bằng điều kiện recipientId để ngăn sửa thông báo người khác. */
  async markNotificationRead(
    notificationId: string,
    recipientId: string,
  ): Promise<LearningNotification> {
    return await moderation_ops.markNotificationRead(
      this.runtime.context,
      notificationId,
      recipientId,
    );
  }

  /** Liệt kê buổi trực tuyến theo quan hệ lớp và trạng thái truy cập của vai trò. */
  async listSessions(role: string, actorId: string): Promise<LiveSession[]> {
    return await live_sessions_ops.listSessions(this.runtime.context, role, actorId);
  }

  /** Phân trang buổi học trực tuyến theo lớp, trạng thái và khoảng thời gian trên DB. */
  async listSessionsPage(
    role: string,
    actorId: string,
    filters: live_sessions_ops.LiveSessionPageFilters = {},
  ): Promise<PaginatedResult<LiveSession>> {
    return await live_sessions_ops.listSessionsPage(this.runtime.context, role, actorId, filters);
  }

  /** Validate lịch/quyền lớp, lưu link Google Meet hoặc cấp phòng từ provider có fallback. */
  async createSession(
    classId: string,
    input: Pick<LiveSession, "title" | "startsAt" | "endsAt" | "provider"> & {
      meetingUrl?: string;
    },
    actorId: string,
    actorRole: string,
  ): Promise<LiveSession> {
    return await live_sessions_ops.createSession(
      this.runtime.context,
      classId,
      input,
      actorId,
      actorRole,
    );
  }

  /** Cập nhật lịch và liên kết phòng họp trước khi buổi học diễn ra và lưu lý do audit. */
  async updateSession(
    sessionId: string,
    input: Pick<LiveSession, "title" | "startsAt" | "endsAt" | "provider"> & {
      reason?: string;
      meetingUrl?: string;
    },
    actorId: string,
    actorRole: string,
  ): Promise<LiveSession> {
    return await live_sessions_ops.updateSession(
      this.runtime.context,
      sessionId,
      input,
      actorId,
      actorRole,
    );
  }

  /** Hủy buổi chưa hoàn tất, ghi lý do và gửi thông báo tới lớp. */
  async cancelSession(
    sessionId: string,
    reason: string | undefined,
    actorId: string,
    actorRole: string,
  ): Promise<LiveSession> {
    return await live_sessions_ops.cancelSession(
      this.runtime.context,
      sessionId,
      reason,
      actorId,
      actorRole,
    );
  }

  /** Kiểm soát chuyển trạng thái buổi học và cập nhật mốc vận hành liên quan. */
  async transitionSession(
    sessionId: string,
    status: LiveSession["status"],
    actorId: string,
  ): Promise<LiveSession> {
    return await live_sessions_ops.transitionSession(
      this.runtime.context,
      sessionId,
      status,
      actorId,
    );
  }

  /** Xác minh ghi danh/quyền lớp/cửa sổ tham dự và trả URL phòng họp hợp lệ. */
  async joinSession(
    sessionId: string,
    actorId: string,
    actorRole: string,
  ): Promise<{ attendeeUrl: string; joinedAt: string }> {
    return await live_sessions_ops.joinSession(
      this.runtime.context,
      sessionId,
      actorId,
      actorRole,
    );
  }

  /** Gắn nguồn bản ghi cho buổi đã hoàn tất và chuyển sang trạng thái xử lý. */
  async attachRecording(
    sessionId: string,
    recordingUrl: string,
    actorId: string,
  ): Promise<LiveSession> {
    return await recordings_ops.attachRecording(
      this.runtime.context,
      sessionId,
      recordingUrl,
      actorId,
    );
  }

  /** Chốt xử lý bản ghi, tính ngày hết hạn hoặc lưu lỗi và thông báo học viên khi sẵn sàng. */
  async completeRecording(
    sessionId: string,
    status: "READY" | "FAILED",
    retentionDays = 90,
    errorMessage: string | undefined,
    actorId: string,
  ): Promise<LiveSession> {
    return await recordings_ops.completeRecording(
      this.runtime.context,
      sessionId,
      status,
      retentionDays,
      errorMessage,
      actorId,
    );
  }

  /** Trả tóm tắt buổi học và khả năng xem bản ghi của học viên. */
  async getSessionSummary(sessionId: string, learnerId: string): Promise<object> {
    return await recordings_ops.getSessionSummary(this.runtime.context, sessionId, learnerId);
  }

  /** Phát URL nội bộ ký theo session, learner và hạn để bảo vệ bản ghi. */
  async createRecordingAccess(
    sessionId: string,
    learnerId: string,
  ): Promise<{ url: string; expiresAt: string }> {
    return await recordings_ops.createRecordingAccess(this.runtime.context, sessionId, learnerId);
  }

  /** Xác minh chữ ký/hạn/quyền học viên rồi mới trả URL provider thực. */
  async resolveRecordingAccess(
    sessionId: string,
    expires: number,
    signature: string,
    learnerId: string,
  ): Promise<{ recordingUrl: string }> {
    return await recordings_ops.resolveRecordingAccess(
      this.runtime.context,
      sessionId,
      expires,
      signature,
      learnerId,
    );
  }

  /** Liệt kê tất cả phiếu cho nhân sự hỗ trợ hoặc chỉ phiếu của người gửi. */
  async listTickets(role: string, actorId: string): Promise<SupportTicket[]> {
    return await support_ops.listTickets(this.runtime.context, role, actorId);
  }

  /** Phân trang danh sách phiếu hỗ trợ theo vai trò, trạng thái và từ khóa. */
  async listTicketsPage(
    role: string,
    actorId: string,
    filters: support_ops.SupportTicketPageFilters = {},
  ): Promise<PaginatedResult<SupportTicket>> {
    return await support_ops.listTicketsPage(this.runtime.context, role, actorId, filters);
  }

  /** Validate nội dung, chống phiếu trùng đang mở và tạo SLA theo mức độ nghiêm trọng. */
  async createTicket(
    input: Pick<SupportTicket, "category" | "severity" | "description" | "contextId"> & {
      clientRequestId?: string;
    },
    reporterId: string,
  ): Promise<SupportTicket> {
    return await support_ops.createTicket(this.runtime.context, input, reporterId);
  }

  /** Adapter tương thích cũ ánh xạ vai trò demo sang userId để đọc thông báo. */
  listRoleNotifications(role: string): Promise<LearningNotification[]> {
    return support_ops.listRoleNotifications(this.runtime.context, role);
  }

  /** Adapter tương thích cũ đánh dấu thông báo theo userId mặc định của vai trò. */
  markRoleNotificationRead(
    notificationId: string,
    role: string,
  ): Promise<LearningNotification> {
    return support_ops.markRoleNotificationRead(this.runtime.context, notificationId, role);
  }

  /** Kiểm tra quyền phiếu, magic bytes/virus rồi lưu tệp bằng chứng và metadata. */
  async addSupportAttachment(
    ticketId: string,
    upload: UploadedMaterialFile,
    role: string,
    uploaderId: string,
  ): Promise<SupportAttachment> {
    return await support_ops.addSupportAttachment(
      this.runtime.context,
      ticketId,
      upload,
      role,
      uploaderId,
    );
  }

  /** Trả bytes bằng chứng cho đúng người gửi hoặc vai trò quản lý hỗ trợ. */
  async readSupportAttachment(
    ticketId: string,
    attachmentId: string,
    role: string,
    actorId: string,
  ): Promise<MaterialDownload> {
    return await support_ops.readSupportAttachment(
      this.runtime.context,
      ticketId,
      attachmentId,
      role,
      actorId,
    );
  }

  /** Mở luồng tải bằng chứng hỗ trợ có hỗ trợ HTTP Range và kiểm chứng checksum. */
  async readSupportAttachmentStream(
    ticketId: string,
    attachmentId: string,
    role: string,
    actorId: string,
    rangeHeader?: string,
  ): Promise<{
    stream: Readable;
    totalSize: number;
    range?: ByteRange;
    fileName: string;
    mimeType: string;
  }> {
    return await support_ops.readSupportAttachmentStream(
      this.runtime.context,
      ticketId,
      attachmentId,
      role,
      actorId,
      rangeHeader,
    );
  }

  /** Cập nhật người phụ trách/trạng thái/kết quả và ghi audit chuyển trạng thái. */
  async updateTicket(
    ticketId: string,
    input: Partial<Pick<SupportTicket, "status" | "assigneeId" | "resolution">> & {
      expectedUpdatedAt?: string;
    },
    actorId: string,
  ): Promise<SupportTicket> {
    return await support_ops.updateTicket(this.runtime.context, ticketId, input, actorId);
  }

  /** Cho đúng người gửi đóng phiếu chưa hoàn tất và ghi mốc đóng. */
  async closeTicketByReporter(ticketId: string, reporterId: string): Promise<SupportTicket> {
    return await support_ops.closeTicketByReporter(this.runtime.context, ticketId, reporterId);
  }

  /** Kiểm tra người gửi hoặc quyền hỗ trợ trước khi trả trao đổi của phiếu. */
  async listTicketComments(
    ticketId: string,
    role: string,
    actorId: string,
  ): Promise<TicketComment[]> {
    return await support_ops.listTicketComments(this.runtime.context, ticketId, role, actorId);
  }

  /** Thêm trao đổi hợp lệ vào phiếu truy cập được và cập nhật thời gian hoạt động. */
  async addTicketComment(
    ticketId: string,
    body: string,
    role: string,
    authorId: string,
  ): Promise<TicketComment> {
    return await support_ops.addTicketComment(
      this.runtime.context,
      ticketId,
      body,
      role,
      authorId,
    );
  }

  /** Tổng hợp điểm số, hoàn thành học liệu và sinh phân loại rủi ro từng học viên. */
  async getClassProgress(
    classId: string,
    input: { from?: string; to?: string } & Partial<RiskThresholds>,
    actorId: string,
    actorRole: string,
  ): Promise<ClassProgressReport> {
    return await progress_ops.getClassProgress(
      this.runtime.context,
      classId,
      input,
      actorId,
      actorRole,
    );
  }

  /** Tạo kế hoạch can thiệp, giao đúng giảng viên của lớp và lưu riêng người tạo. */
  async createProgressIntervention(
    classId: string,
    input: Pick<ProgressIntervention, "learnerId" | "title" | "notes" | "dueAt"> & {
      assigneeId: string;
    },
    createdById: string,
    actorRole: string,
  ): Promise<ProgressIntervention> {
    return await progress_ops.createProgressIntervention(
      this.runtime.context,
      classId,
      input,
      createdById,
      actorRole,
    );
  }

  /** Liệt kê hành động hỗ trợ đang thuộc trách nhiệm của người dùng hiện tại. */
  async listMyProgressInterventions(ownerId: string): Promise<ProgressIntervention[]> {
    return await progress_ops.listMyProgressInterventions(this.runtime.context, ownerId);
  }

  /** Nhận, hoàn tất hoặc hủy hành động hỗ trợ theo quyền sở hữu và điều kiện kết quả. */
  async updateProgressIntervention(
    interventionId: string,
    input: {
      status: "IN_PROGRESS" | "DONE" | "CANCELLED";
      outcome?: string;
      cancellationReason?: string;
    },
    actorId: string,
    actorRole: string,
  ): Promise<ProgressIntervention> {
    return await progress_ops.updateProgressIntervention(
      this.runtime.context,
      interventionId,
      input,
      actorId,
      actorRole,
    );
  }

  /** Bàn giao hành động đang mở cho giảng viên khác và lưu toàn bộ dấu vết chuyển giao. */
  async transferProgressIntervention(
    interventionId: string,
    assigneeId: string,
    rawReason: string | undefined,
    actorId: string,
    actorRole: string,
  ): Promise<ProgressIntervention> {
    return await progress_ops.transferProgressIntervention(
      this.runtime.context,
      interventionId,
      assigneeId,
      rawReason,
      actorId,
      actorRole,
    );
  }
}
