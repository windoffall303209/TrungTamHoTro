import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  Optional,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { Readable } from "node:stream";
import type { AuthenticatedSession } from "../../../auth/auth.service.js";
import type { ByteRange } from "../../../infrastructure/http-range-stream.js";
import { openVerifiedObjectStream } from "../../../infrastructure/verified-download.js";
import { PrismaService } from "../../../database/prisma.service.js";
import { Prisma } from "../../../generated/prisma/client.js";
import { AntivirusService } from "../../../infrastructure/antivirus.service.js";
import { ObjectStorageService } from "../../../infrastructure/object-storage.service.js";
import type {
  ChatConversationView,
  ChatDirectoryEntry,
  ChatMessagePage,
  ChatMessageView,
  ChatStreamEvent,
} from "./chat.types.js";
import { Observable } from "rxjs";
import { DatabaseEventsService } from "../../../database/database-events.service.js";
import { assertSafeUpload } from "../../../infrastructure/file-signature.js";
import { normalizeMultipartFileName } from "../../../infrastructure/file-transfer.js";

type ConversationRow = Prisma.ChatConversationGetPayload<{
  include: {
    class: true;
    members: { include: { user: true } };
    messages: {
      include: {
        sender: true;
        replyTo: { include: { sender: true } };
        attachments: true;
        mentions: true;
      };
    };
  };
}>;
type MessageRow = Prisma.ChatMessageGetPayload<{
  include: {
    sender: true;
    replyTo: { include: { sender: true } };
    attachments: true;
    mentions: true;
  };
}>;
type DirectoryClassRow = Prisma.LearningClassGetPayload<{
  include: {
    instructors: {
      include: {
        instructor: { include: { roles: { include: { role: true } } } };
      };
    };
    enrollments: {
      include: { learner: { include: { roles: { include: { role: true } } } } };
    };
  };
}>;
type ConversationMembershipRow = Prisma.ChatConversationMemberGetPayload<{
  include: { conversation: { include: { class: true } } };
}>;
type ChatStreamCursor = { sequence: bigint };

interface SqlChatAttachmentJson {
  id: string;
  originalName: string;
  mimeType: string;
  sizeBytes: string | number;
}

interface SqlChatMessageJson {
  id: string;
  conversationId: string;
  senderId: string;
  senderName: string;
  senderAvatarObjectKey: string | null;
  senderAvatarUpdatedAt: string | Date | null;
  clientMessageId: string;
  content: string;
  contextType: string | null;
  contextId: string | null;
  createdAt: string | Date;
  replyTo: { id: string; senderName: string; content: string } | null;
  attachments: SqlChatAttachmentJson[];
  mentionedUserIds: string[];
}

interface SqlChatMemberJson {
  userId: string;
  displayName: string;
  avatarObjectKey: string | null;
  avatarUpdatedAt: string | Date | null;
  roleCode: string;
  status: "ACTIVE" | "REMOVED";
}

interface SqlConversationSummaryRow {
  id: string;
  type: "DIRECT" | "CLASS";
  classId: string | null;
  updatedAt: Date | string;
  className: string | null;
  classStatus: string | null;
  actorStatus: "ACTIVE" | "REMOVED";
  actorMutedUntil: Date | string | null;
  unreadCount: number;
  membersJson: SqlChatMemberJson[] | string | null;
  lastMessageJson: SqlChatMessageJson | string | null;
}

interface SqlMessageListRow {
  id: string;
  conversationId: string;
  senderId: string;
  senderName: string;
  senderAvatarObjectKey: string | null;
  senderAvatarUpdatedAt: Date | null;
  clientMessageId: string;
  content: string;
  contextType: string | null;
  contextId: string | null;
  createdAt: Date;
  replyToId: string | null;
  replyToSenderName: string | null;
  replyToContent: string | null;
  attachmentsJson: SqlChatAttachmentJson[] | string | null;
  mentionsJson: string[] | string | null;
}

interface SqlDirectTargetEligibilityRow {
  targetId: string;
  targetRoles: string[] | null;
  actorRoles: string[] | null;
  allowed: boolean;
}

/** Chuyển giá trị JSON hoặc chuỗi JSON từ PostgreSQL về đúng kiểu đối tượng đã khai báo. */
function parseJsonField<T>(raw: T | string | null | undefined, fallback: T): T {
  if (raw === null || raw === undefined) return fallback;
  if (typeof raw === "string") return JSON.parse(raw) as T;
  return raw;
}

/** Chuẩn hóa giá trị thời gian trả về từ driver PostgreSQL sang đối tượng Date hợp lệ. */
function toDateValue(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  return value instanceof Date ? value : new Date(value);
}

/** Tạo khóa chuẩn hóa duy nhất cho mỗi cặp (contextType, contextId) khi gom lô kiểm quyền thẻ ngữ cảnh. */
function contextCacheKey(type: "ASSIGNMENT" | "EXAM" | "MATERIAL", contextId: string): string {
  return `${type}:${contextId}`;
}

export interface UploadedChatFile {
  originalName: string;
  mimeType: string;
  size: number;
  buffer: Buffer;
}

@Injectable()
/** Quản lý danh bạ và hội thoại theo quan hệ lớp, không mở rộng phạm vi từ dữ liệu hồ sơ riêng tư. */
export class ChatService {
  private readonly activeViewers = new Map<string, Map<symbol, number>>();
  constructor(
    private readonly prisma: PrismaService,
    private readonly objectStorage: ObjectStorageService,
    private readonly antivirus: AntivirusService,
    @Optional() private readonly databaseEvents?: DatabaseEventsService,
  ) {}

  /** Tìm người có thể liên hệ bằng tên không dấu, mã tài khoản hoặc lớp chung. */
  async directory(
    session: AuthenticatedSession,
    query = "",
    limit = 500,
  ): Promise<ChatDirectoryEntry[]> {
    if (typeof query !== "string")
      throw new BadRequestException("Từ khóa tìm liên hệ không hợp lệ.");
    const classes = await this.accessibleDirectoryClasses(session);
    const entries = new Map<string, ChatDirectoryEntry>();
    for (const classItem of classes) {
      const sharedClass = {
        id: classItem.id,
        code: classItem.code,
        name: classItem.name,
      };
      for (const member of [
        ...classItem.instructors.map((item) => item.instructor),
        ...classItem.enrollments.map((item) => item.learner),
      ]) {
        if (member.id === session.user.id || member.status !== "ACTIVE")
          continue;
        const roleCode = this.primaryRole(
          member.roles.map((item) => item.role.code),
        );
        if (
          session.roleCode === "LEARNER" &&
          !["LEARNER", "INSTRUCTOR"].includes(roleCode)
        )
          continue;
        const current = entries.get(member.id) ?? {
          id: member.id,
          displayName: member.displayName,
          avatarUrl: this.avatarUrl(member),
          roleCode,
          sharedClasses: [],
        };
        if (!current.sharedClasses.some((item) => item.id === classItem.id))
          current.sharedClasses.push(sharedClass);
        entries.set(member.id, current);
      }
    }
    if (
      session.roleCode === "CENTER_MANAGER" ||
      session.roleCode === "SYSTEM_ADMIN"
    ) {
      const users = await this.prisma.user.findMany({
        where: { status: "ACTIVE", id: { not: session.user.id } },
        include: { roles: { include: { role: true } } },
      });
      for (const user of users)
        entries.set(
          user.id,
          entries.get(user.id) ?? {
            id: user.id,
            displayName: user.displayName,
            avatarUrl: this.avatarUrl(user),
            roleCode: this.primaryRole(
              user.roles.map((item) => item.role.code),
            ),
            sharedClasses: [],
          },
        );
    }
    // Quản trị viên và quản lý luôn xuất hiện trong danh bạ của giảng viên/học viên.
    if (session.roleCode === "LEARNER" || session.roleCode === "INSTRUCTOR") {
      const staff = await this.prisma.user.findMany({
        where: {
          status: "ACTIVE",
          id: { not: session.user.id },
          roles: { some: { role: { code: { in: ["SYSTEM_ADMIN", "CENTER_MANAGER"] } } } },
        },
        include: { roles: { include: { role: true } } },
      });
      for (const user of staff) {
        if (!entries.has(user.id))
          entries.set(user.id, {
            id: user.id,
            displayName: user.displayName,
            avatarUrl: this.avatarUrl(user),
            roleCode: this.primaryRole(user.roles.map((item) => item.role.code)),
            sharedClasses: [],
          });
      }
    }
    const previousDirects = await this.prisma.chatConversation.findMany({
      where: {
        type: "DIRECT",
        members: { some: { userId: session.user.id, status: "ACTIVE" } },
        messages: { some: {} },
      },
      orderBy: { updatedAt: "desc" },
      select: {
        updatedAt: true,
        members: {
          where: { userId: { not: session.user.id }, user: { status: "ACTIVE" } },
          select: { user: { include: { roles: { include: { role: true } } } } },
        },
      },
    });
    const recentRank = new Map<string, number>();
    for (const conversation of previousDirects) {
      for (const { user } of conversation.members) {
        if (!recentRank.has(user.id)) recentRank.set(user.id, recentRank.size);
        if (!entries.has(user.id))
          entries.set(user.id, {
            id: user.id,
            displayName: user.displayName,
            avatarUrl: this.avatarUrl(user),
            roleCode: this.primaryRole(user.roles.map((item) => item.role.code)),
            sharedClasses: [],
          });
      }
    }
    const roleRank: Record<ChatDirectoryEntry["roleCode"], number> = {
      SYSTEM_ADMIN: 0,
      CENTER_MANAGER: 1,
      INSTRUCTOR: 2,
      LEARNER: 3,
    };
    const normalized = this.searchText(query);
    return [...entries.values()]
      .filter(
        (entry) =>
          !normalized ||
          this.searchText(
            `${entry.displayName} ${entry.id} ${entry.sharedClasses.map((item) => `${item.code} ${item.name}`).join(" ")}`,
          ).includes(normalized),
      )
      .sort((left, right) => {
        const leftRecent = recentRank.get(left.id);
        const rightRecent = recentRank.get(right.id);
        if (leftRecent !== undefined || rightRecent !== undefined)
          return (leftRecent ?? Number.MAX_SAFE_INTEGER) - (rightRecent ?? Number.MAX_SAFE_INTEGER);
        return roleRank[left.roleCode] - roleRank[right.roleCode] ||
          left.displayName.localeCompare(right.displayName, "vi");
      })
      .slice(0, limit);
  }

  /** Mở đúng một hội thoại riêng cho một cặp người dùng, kiểm quyền trực tiếp theo targetUserId thay vì tải cả danh bạ. */
  async openDirect(
    session: AuthenticatedSession,
    targetUserId: string,
  ): Promise<ChatConversationView> {
    if (targetUserId === session.user.id)
      throw new BadRequestException(
        "Không thể tự mở hội thoại với chính mình.",
      );
    const directKey = [session.user.id, targetUserId].sort().join(":");
    if (typeof this.prisma.$queryRaw === "function") {
      const eligibility = await this.checkDirectTargetEligibility(session, targetUserId);
      if (!eligibility)
        throw new NotFoundException(
          "Không tìm thấy người dùng trong phạm vi có thể liên hệ.",
        );
      // Fast-path: hội thoại riêng đã tồn tại và cả hai thành viên đều ACTIVE với đúng roleSnapshot -> bỏ qua transaction ghi.
      const existingView = await this.loadSingleConversationSql(
        { kind: "directKey", value: directKey },
        session.user.id,
      );
      if (existingView) {
        const actorMember = existingView.members.find((m) => m.userId === session.user.id);
        const targetMember = existingView.members.find((m) => m.userId === targetUserId);
        if (
          actorMember?.status === "ACTIVE" &&
          actorMember.roleCode === eligibility.actorRole &&
          targetMember?.status === "ACTIVE" &&
          targetMember.roleCode === eligibility.targetRole
        ) {
          return existingView;
        }
      }
      const newConversationId = `conversation-${randomUUID()}`;
      // Truyền thời điểm UTC từ JS Date để khớp kiểu timestamp without time zone của Prisma, tránh lệch múi giờ phiên PG.
      const createdAt = new Date();
      await this.prisma.$executeRaw`
        WITH upserted AS (
          INSERT INTO chat_conversations (id, type, direct_key, created_by_id, created_at, updated_at)
          VALUES (${newConversationId}, 'DIRECT'::"ChatConversationType", ${directKey}, ${session.user.id}, ${createdAt}, ${createdAt})
          ON CONFLICT (direct_key) DO UPDATE SET direct_key = EXCLUDED.direct_key
          RETURNING id
        )
        INSERT INTO chat_conversation_members (conversation_id, user_id, role_snapshot, status, joined_at)
        SELECT upserted.id, member_rows.user_id, member_rows.role_snapshot, 'ACTIVE'::"ChatMemberStatus", ${createdAt}
        FROM upserted
        CROSS JOIN (
          VALUES
            (${session.user.id}::text, ${eligibility.actorRole}::text),
            (${targetUserId}::text, ${eligibility.targetRole}::text)
        ) AS member_rows(user_id, role_snapshot)
        ON CONFLICT (conversation_id, user_id) DO UPDATE
          SET status = 'ACTIVE'::"ChatMemberStatus",
              removed_at = NULL,
              role_snapshot = EXCLUDED.role_snapshot
      `;
      const createdView = await this.loadSingleConversationSql(
        { kind: "directKey", value: directKey },
        session.user.id,
      );
      if (createdView) return createdView;
    }
    const allowed = await this.directory(session, "", Number.MAX_SAFE_INTEGER);
    if (!allowed.some((entry) => entry.id === targetUserId))
      throw new NotFoundException(
        "Không tìm thấy người dùng trong phạm vi có thể liên hệ.",
      );
    const row = await this.prisma.$transaction(async (transaction) => {
      const conversation = await transaction.chatConversation.upsert({
        where: { directKey },
        update: {},
        create: {
          id: `conversation-${randomUUID()}`,
          type: "DIRECT",
          directKey,
          createdById: session.user.id,
        },
      });
      const roles = await transaction.user.findMany({
        where: { id: { in: [session.user.id, targetUserId] } },
        include: { roles: { include: { role: true } } },
      });
      for (const user of roles)
        await transaction.chatConversationMember.upsert({
          where: {
            conversationId_userId: {
              conversationId: conversation.id,
              userId: user.id,
            },
          },
          update: {
            status: "ACTIVE",
            removedAt: null,
            roleSnapshot: this.primaryRole(
              user.roles.map((item) => item.role.code),
            ),
          },
          create: {
            conversationId: conversation.id,
            userId: user.id,
            roleSnapshot: this.primaryRole(
              user.roles.map((item) => item.role.code),
            ),
          },
        });
      return this.loadConversation(transaction, conversation.id);
    });
    return this.mapConversation(row, session.user.id);
  }

  /** Mở hội thoại lớp; ưu tiên đọc nhanh khi hội thoại đã tồn tại và chỉ khởi tạo (kèm trigger membership) lần đầu. */
  async openClass(
    session: AuthenticatedSession,
    classId: string,
  ): Promise<ChatConversationView> {
    if (!(await this.canJoinClassConversation(classId, session.user.id)))
      throw new NotFoundException("Không tìm thấy lớp được phép trò chuyện.");
    if (typeof this.prisma.$queryRaw === "function") {
      // Fast-path: bỏ qua BEGIN/upsert/COMMIT khi hội thoại lớp đã được tạo từ trước.
      const existing = await this.loadSingleConversationSql(
        { kind: "classId", value: classId },
        session.user.id,
      );
      if (existing) return existing;
      await this.prisma.chatConversation
        .create({
          data: {
            id: `conversation-${randomUUID()}`,
            type: "CLASS",
            classId,
            createdById: session.user.id,
          },
          select: { id: true },
        })
        .catch((error: unknown) => {
          // Hai phiên có thể cùng tạo hội thoại đầu tiên của lớp trước khi thấy bản ghi của nhau.
          if (
            !(error instanceof Prisma.PrismaClientKnownRequestError) ||
            error.code !== "P2002"
          ) {
            throw error;
          }
        });
      const created = await this.loadSingleConversationSql(
        { kind: "classId", value: classId },
        session.user.id,
      );
      if (created) return created;
    }
    const conversation = await this.prisma.chatConversation.upsert({
      where: { classId },
      update: {},
      select: { id: true },
      create: {
        id: `conversation-${randomUUID()}`,
        type: "CLASS",
        classId,
        createdById: session.user.id,
      },
    }).catch(async (error: unknown) => {
      // Hai phiên có thể cùng tạo hội thoại đầu tiên của lớp trước khi thấy bản ghi của nhau.
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") throw error;
      const existing = await this.prisma.chatConversation.findUnique({ where: { classId }, select: { id: true } });
      if (!existing) throw error;
      return existing;
    });
    return this.mapConversation(
      await this.loadConversation(this.prisma, conversation.id),
      session.user.id,
    );
  }

  /** Liệt kê hội thoại của thành viên, tính chưa đọc và tin mới nhất trong 1 truy vấn SQL (giữ fallback cho unit test mock). */
  async listConversations(
    session: AuthenticatedSession,
  ): Promise<ChatConversationView[]> {
    if (typeof this.prisma.$queryRaw === "function") {
      const rows = await this.loadConversationSummariesSql(session.user.id);
      return this.mapSqlConversationSummaries(rows, session.user.id);
    }
    const rows = await this.prisma.chatConversation.findMany({
      where: { members: { some: { userId: session.user.id } } },
      include: {
        class: true,
        members: { include: { user: true } },
        messages: {
          orderBy: { createdAt: "desc" },
          take: 1,
          include: {
            sender: true,
            replyTo: { include: { sender: true } },
            attachments: true,
            mentions: true,
          },
        },
      },
      orderBy: { updatedAt: "desc" },
    });
    const unreadFilters = rows.flatMap((row) => {
      const member = row.members.find((item) => item.userId === session.user.id);
      if (!member) return [];
      return [{
        conversationId: row.id,
        createdAt: {
          gt: member.lastReadAt ?? member.joinedAt,
          ...(member.removedAt ? { lte: member.removedAt } : {}),
        },
      }];
    });
    const unreadGroups = unreadFilters.length
      ? await this.prisma.chatMessage.groupBy({
          by: ["conversationId"],
          where: { senderId: { not: session.user.id }, OR: unreadFilters },
          _count: { _all: true },
        })
      : [];
    const unreadByConversation = new Map(
      unreadGroups.map((group) => [group.conversationId, group._count._all]),
    );
    return Promise.all(
      rows.map((row) =>
        this.mapConversation(
          row,
          session.user.id,
          unreadByConversation.get(row.id) ?? 0,
        ),
      ),
    );
  }

  /** Đọc lịch sử theo cursor; thành viên đã rời chỉ thấy tin được gửi trước thời điểm rời. */
  async listMessages(
    conversationId: string,
    session: AuthenticatedSession,
    before?: string,
    limit = 40,
  ): Promise<ChatMessagePage> {
    if (!Number.isFinite(limit) || !Number.isInteger(limit))
      throw new BadRequestException("Giới hạn số tin nhắn không hợp lệ.");
    const take = Math.min(Math.max(limit, 1), 100);
    if (before !== undefined && typeof before !== "string")
      throw new BadRequestException("Cursor tin nhắn không hợp lệ.");
    const separator = before?.indexOf("|") ?? -1;
    const beforeId = separator >= 0 ? before?.slice(separator + 1) : undefined;
    if (beforeId !== undefined && !/^[A-Za-z0-9_-]{1,128}$/.test(beforeId))
      throw new BadRequestException("Cursor tin nhắn không hợp lệ.");
    const beforeDate = before ? new Date(separator >= 0 ? before.slice(0, separator) : before) : undefined;
    if (beforeDate && Number.isNaN(beforeDate.getTime()))
      throw new BadRequestException("Cursor tin nhắn không hợp lệ.");
    const membership = await this.resolveMembershipLite(
      conversationId,
      session.user.id,
    );
    const upperBound =
      membership.status === "REMOVED" &&
      membership.removedAt &&
      (!beforeDate || membership.removedAt < beforeDate)
        ? membership.removedAt
        : beforeDate;
    // Cursor có ID chỉ được dùng khi mốc rời nhóm không chặn các tin cùng thời điểm.
    const useIdCursor = Boolean(
      beforeId !== undefined &&
      beforeDate &&
      (membership.status !== "REMOVED" || !membership.removedAt || beforeDate < membership.removedAt),
    );
    if (typeof this.prisma.$queryRaw === "function") {
      const rows = await this.loadMessagePageSql(
        conversationId,
        take + 1,
        useIdCursor ? { kind: "idCursor", beforeDate: beforeDate!, beforeId: beforeId! } : { kind: "upperBound", upperBound },
      );
      const hasNext = rows.length > take;
      const page = rows.slice(0, take);
      const last = page.at(-1);
      const nextRow = hasNext ? rows[take] : undefined;
      const nextCursor = nextRow && last
        ? `${last.createdAt.toISOString()}${nextRow.createdAt.getTime() === last.createdAt.getTime() ? `|${last.id}` : ""}`
        : undefined;
      const ordered = page.reverse();
      const contextMap = await this.resolveContextCardsForActor(
        session.user.id,
        ordered.map((row) => ({ contextType: row.contextType, contextId: row.contextId })),
      );
      return {
        items: ordered.map((row) => this.mapSqlMessageRow(row, contextMap)),
        nextCursor,
      };
    }
    const rows = await this.prisma.chatMessage.findMany({
      where: {
        conversationId,
        ...(useIdCursor
          ? { OR: [{ createdAt: { lt: beforeDate } }, { createdAt: beforeDate, id: { lt: beforeId } }] }
          : { createdAt: upperBound ? { lt: upperBound } : undefined }),
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: take + 1,
      include: {
        sender: true,
        replyTo: { include: { sender: true } },
        attachments: true,
        mentions: true,
      },
    });
    const hasNext = rows.length > take;
    const page = rows.slice(0, take);
    const last = page.at(-1);
    const nextRow = hasNext ? rows[take] : undefined;
    // Chỉ thêm ID khi trang kế tiếp có tin trùng timestamp; cursor ISO cũ vẫn hợp lệ.
    const nextCursor = nextRow && last
      ? `${last.createdAt.toISOString()}${nextRow.createdAt.getTime() === last.createdAt.getTime() ? `|${last.id}` : ""}`
      : undefined;
    const ordered = page.reverse();
    const contextMap = await this.resolveContextCardsForActor(
      session.user.id,
      ordered.map((row) => ({ contextType: row.contextType, contextId: row.contextId })),
    );
    return {
      items: await Promise.all(
        ordered.map((row) => this.mapMessageForActor(row, session.user.id, contextMap)),
      ),
      nextCursor,
    };
  }

  /** Gửi tin/tệp idempotent, kiểm tra reply, mention, context và dọn object nếu transaction thất bại. */
  async sendMessage(
    conversationId: string,
    input: {
      clientMessageId: string;
      content?: string;
      replyToId?: string;
      mentionedUserIds?: string[];
      contextType?: "ASSIGNMENT" | "EXAM" | "MATERIAL";
      contextId?: string;
    },
    filesOrSession: UploadedChatFile[] | AuthenticatedSession,
    maybeSession?: AuthenticatedSession,
  ): Promise<ChatMessageView> {
    const files = Array.isArray(filesOrSession) ? filesOrSession : [];
    const session = Array.isArray(filesOrSession)
      ? maybeSession
      : filesOrSession;
    if (!session)
      throw new BadRequestException("Phiên gửi tin nhắn không hợp lệ.");
    const membership = await this.resolveMembership(
      conversationId,
      session.user.id,
    );
    if (membership.status !== "ACTIVE")
      throw new ConflictException(
        "Bạn đã rời hội thoại và chỉ còn quyền đọc lịch sử.",
      );
    if (membership.conversation.class?.status === "CLOSED")
      throw new ConflictException(
        "Lớp đã đóng; hội thoại lớp chỉ cho phép đọc.",
      );
    await this.validateFiles(files);
    const content = input.content?.trim() ?? "";
    if (!content && !files.length)
      throw new BadRequestException(
        "Cần nhập nội dung hoặc đính kèm ít nhất một tệp.",
      );
    if (Boolean(input.contextType) !== Boolean(input.contextId))
      throw new BadRequestException(
        "Thẻ ngữ cảnh phải có đủ loại và mã đối tượng.",
      );
    if (
      input.replyToId &&
      !(await this.prisma.chatMessage.findFirst({
        where: { id: input.replyToId, conversationId },
      }))
    )
      throw new BadRequestException(
        "Tin nhắn được trả lời không thuộc hội thoại này.",
      );
    const existing = await this.prisma.chatMessage.findUnique({
      where: {
        senderId_clientMessageId: {
          senderId: session.user.id,
          clientMessageId: input.clientMessageId,
        },
      },
      include: {
        sender: true,
        replyTo: { include: { sender: true } },
        attachments: true,
        mentions: true,
      },
    });
    if (existing) {
      if (existing.conversationId !== conversationId)
        throw new ConflictException(
          "Mã gửi lại đã được dùng cho hội thoại khác.",
        );
      return this.mapMessageForActor(existing, session.user.id);
    }
    const activeMembers = await this.prisma.chatConversationMember.findMany({
      where: { conversationId, status: "ACTIVE" },
      select: { userId: true, mutedUntil: true },
    });
    const activeIds = new Set(activeMembers.map((item) => item.userId));
    const mentionedUserIds = [...new Set(input.mentionedUserIds ?? [])];
    if (mentionedUserIds.some((userId) => !activeIds.has(userId)))
      throw new BadRequestException(
        "Chỉ được nhắc thành viên đang có trong hội thoại.",
      );
    if (input.contextType && input.contextId) {
      const everyoneAllowed = await this.canAllUsersAccessContext(
        input.contextType,
        input.contextId,
        activeMembers.map((member) => member.userId),
      );
      if (!everyoneAllowed)
        throw new BadRequestException(
          "Một hoặc nhiều người nhận không còn quyền xem đối tượng được đính kèm.",
        );
    }
    const stored: Array<
      UploadedChatFile & { objectKey: string; checksum: string }
    > = [];
    try {
      for (const file of files) {
        const scan = await this.antivirus.scan(file.buffer);
        if (!scan.clean)
          throw new BadRequestException(
            `Tệp ${file.originalName} không an toàn và đã bị từ chối.`,
          );
        stored.push({
          ...file,
          ...(await this.objectStorage.put(
            `chat/${conversationId}/${session.user.id}/${randomUUID()}`,
            file.buffer,
          )),
        });
      }
      const row = await this.prisma.$transaction(async (transaction) => {
        const message = await transaction.chatMessage.create({
          data: {
            id: `message-${randomUUID()}`,
            conversationId,
            senderId: session.user.id,
            clientMessageId: input.clientMessageId,
            content,
            replyToId: input.replyToId,
            contextType: input.contextType,
            contextId: input.contextId,
          },
        });
        if (stored.length)
          await transaction.chatMessageAttachment.createMany({
            data: stored.map((file) => ({
              id: `chat-file-${randomUUID()}`,
              messageId: message.id,
              objectKey: file.objectKey,
              originalName: normalizeMultipartFileName(file.originalName),
              mimeType: file.mimeType,
              sizeBytes: file.size,
              checksum: file.checksum,
            })),
          });
        if (mentionedUserIds.length)
          await transaction.chatMessageMention.createMany({
            data: mentionedUserIds.map((mentionedUserId) => ({
              messageId: message.id,
              mentionedUserId,
            })),
          });
        const recipients = activeMembers.filter(
          (item) =>
            item.userId !== session.user.id &&
            (!item.mutedUntil || item.mutedUntil <= new Date()) &&
            !this.isActivelyViewing(conversationId, item.userId),
        );
        if (recipients.length)
          await transaction.notification.createMany({
            data: recipients.map(({ userId }) => ({
              id: `notification-${randomUUID()}`,
              recipientId: userId,
              type: mentionedUserIds.includes(userId)
                ? "CHAT_MENTION"
                : "CHAT_MESSAGE",
              title: mentionedUserIds.includes(userId)
                ? `${session.user.name} đã nhắc bạn trong tin nhắn`
                : `Tin nhắn mới từ ${session.user.name}`,
              entityType: "CHAT_CONVERSATION",
              entityId: conversationId,
              dedupKey: `chat-message:${message.id}:${userId}`,
            })),
          });
        await transaction.chatConversation.update({
          where: { id: conversationId },
          data: { updatedAt: new Date() },
        });
        return transaction.chatMessage.findUniqueOrThrow({
          where: { id: message.id },
          include: {
            sender: true,
            replyTo: { include: { sender: true } },
            attachments: true,
            mentions: true,
          },
        });
      });
      return this.mapMessageForActor(row, session.user.id);
    } catch (error) {
      await Promise.allSettled(
        stored.map((file) => this.objectStorage.remove(file.objectKey)),
      );
      throw error;
    }
  }

  /** Đánh dấu đã đọc đến thời điểm hiện tại để đồng bộ bộ đếm giữa các thiết bị. */
  async markRead(
    conversationId: string,
    session: AuthenticatedSession,
  ): Promise<{ readAt: string }> {
    await this.resolveMembership(conversationId, session.user.id);
    const readAt = new Date();
    await this.prisma.chatConversationMember.update({
      where: {
        conversationId_userId: { conversationId, userId: session.user.id },
      },
      data: { lastReadAt: readAt },
    });
    return { readAt: readAt.toISOString() };
  }

  /** Phát tin mới qua SSE, đồng thời ghi nhận người đang xem để tránh notification dư thừa. */
  watchMessages(
    conversationId: string,
    session: AuthenticatedSession,
    lastEventId?: string,
  ): Observable<ChatStreamEvent> {
    return new Observable((subscriber) => {
      if (!this.databaseEvents) {
        subscriber.error(new Error("Database event listener is unavailable."));
        return;
      }
      const viewerKey = `${conversationId}:${session.user.id}`;
      const viewerId = Symbol();
      let closed = false;
      let initialized = false;
      let running = false;
      let pending = true;
      let cursor: ChatStreamCursor = { sequence: 0n };

      // Comment SSE giữ kết nối mạng, không thay Last-Event-ID và không truy vấn database.
      const refreshViewer = (): void => {
        if (closed || !initialized) return;
        const viewers = this.activeViewers.get(viewerKey) ?? new Map<symbol, number>();
        viewers.set(viewerId, Date.now());
        this.activeViewers.set(viewerKey, viewers);
        subscriber.next({ comment: "heartbeat" });
      };

      // Gộp tín hiệu khi đang đọc và drain hết trang, không xếp hàng một query cho mỗi notification.
      const drain = async (): Promise<void> => {
        if (closed || !initialized || running) return;
        running = true;
        try {
          while (pending && !closed) {
            pending = false;
            let more = true;
            while (more && !closed) {
              const messages = await this.pollMessages(conversationId, session.user.id, cursor);
              if (closed) return;
              for (const message of messages) {
                const { streamSequence, ...data } = message;
                cursor = { sequence: streamSequence };
                subscriber.next({ data, id: message.id });
                if (closed) return;
              }
              more = messages.length === 100;
            }
          }
        } catch (error) {
          if (!closed) subscriber.error(error);
        } finally {
          running = false;
        }
      };

      // Đăng ký trước catch-up; resync sau LISTEN/reconnect đóng khoảng trống lúc listener chưa sẵn sàng.
      const signals = this.databaseEvents.watch().subscribe({
        next: (event) => {
          if (event.kind === "resync" || (event.kind === "chat" && event.key === conversationId)) {
            pending = true;
            void drain();
          }
        },
        error: (error: unknown) => subscriber.error(error),
        complete: () => subscriber.complete(),
      });
      const heartbeat = setInterval(refreshViewer, 5000);
      // Xác thực và khôi phục cursor trước lần đọc bù đầu tiên.
      void (async (): Promise<void> => {
        try {
          await this.resolveMembership(conversationId, session.user.id);
          if (closed) return;
          let resumed = false;
          if (lastEventId && lastEventId.length <= 191) {
            const resumedMessage = await this.prisma.chatMessage.findFirst({
              where: { id: lastEventId, conversationId },
              select: { streamSequence: true },
            });
            if (resumedMessage) {
              cursor = { sequence: resumedMessage.streamSequence };
              resumed = true;
            }
          }
          if (!resumed && !closed) {
            // Một snapshot SQL: không bỏ qua tin vừa commit giữa đọc cửa sổ gần đây và watermark.
            const [start] = await this.prisma.$queryRaw<Array<{ sequence: bigint }>>`
              SELECT COALESCE(
                (SELECT MIN(stream_sequence)-1 FROM chat_messages
                 WHERE conversation_id=${conversationId} AND created_at >= ${new Date(Date.now() - 10000)}),
                (SELECT message_sequence FROM chat_conversations WHERE id=${conversationId}), 0)::bigint AS sequence`;
            cursor = { sequence: start?.sequence ?? 0n };
          }
          if (closed) return;
          initialized = true;
          refreshViewer();
          await drain();
        } catch (error) {
          if (!closed) subscriber.error(error);
        }
      })();
      return () => {
        closed = true;
        signals.unsubscribe();
        clearInterval(heartbeat);
        const viewers = this.activeViewers.get(viewerKey);
        viewers?.delete(viewerId);
        if (viewers?.size === 0) this.activeViewers.delete(viewerKey);
      };
    });
  }

  /** Tìm tối đa 100 tin trong phạm vi lịch sử người dùng còn được phép đọc. */
  async searchMessages(
    conversationId: string,
    rawQuery: string,
    session: AuthenticatedSession,
  ): Promise<ChatMessageView[]> {
    const membership = await this.resolveMembership(
      conversationId,
      session.user.id,
    );
    if (typeof rawQuery !== "string")
      throw new BadRequestException("Từ khóa tìm tin cần ít nhất 2 ký tự.");
    const query = rawQuery.trim();
    if (query.length < 2)
      throw new BadRequestException("Từ khóa tìm tin cần ít nhất 2 ký tự.");
    const rows = await this.prisma.chatMessage.findMany({
      where: {
        conversationId,
        content: { contains: query, mode: "insensitive" },
        ...(membership.removedAt
          ? { createdAt: { lte: membership.removedAt } }
          : {}),
      },
      orderBy: { createdAt: "desc" },
      take: 100,
      include: {
        sender: true,
        replyTo: { include: { sender: true } },
        attachments: true,
        mentions: true,
      },
    });
    const contextMap = await this.resolveContextCardsForActor(
      session.user.id,
      rows.map((row) => ({ contextType: row.contextType, contextId: row.contextId })),
    );
    return Promise.all(
      rows.map((row) => this.mapMessageForActor(row, session.user.id, contextMap)),
    );
  }

  /** Ghi thời hạn tắt thông báo của riêng thành viên hoặc xóa thời hạn để bật lại. */
  async muteConversation(
    conversationId: string,
    mutedUntilInput: string | undefined,
    session: AuthenticatedSession,
  ): Promise<{ mutedUntil?: string }> {
    await this.resolveMembership(conversationId, session.user.id);
    const mutedUntil = mutedUntilInput ? new Date(mutedUntilInput) : null;
    if (
      mutedUntil &&
      (Number.isNaN(mutedUntil.getTime()) || mutedUntil <= new Date())
    )
      throw new BadRequestException("Thời hạn tắt thông báo phải ở tương lai.");
    await this.prisma.chatConversationMember.update({
      where: {
        conversationId_userId: { conversationId, userId: session.user.id },
      },
      data: { mutedUntil },
    });
    return { mutedUntil: mutedUntil?.toISOString() };
  }

  /** Đọc tệp chat sau khi đối chiếu membership, thời điểm rời nhóm và metadata tin. */
  async readAttachment(
    messageId: string,
    attachmentId: string,
    session: AuthenticatedSession,
  ): Promise<{ buffer: Buffer; fileName: string; mimeType: string }> {
    const attachment = await this.prisma.chatMessageAttachment.findFirst({
      where: { id: attachmentId, messageId },
      include: { message: true },
    });
    if (!attachment) throw new NotFoundException("Không tìm thấy tệp chat.");
    const membership = await this.resolveMembership(
      attachment.message.conversationId,
      session.user.id,
    );
    if (
      membership.removedAt &&
      attachment.message.createdAt > membership.removedAt
    )
      throw new NotFoundException(
        "Không tìm thấy tệp chat trong phạm vi truy cập.",
      );
    return {
      buffer: await this.objectStorage.get(attachment.objectKey),
      fileName: attachment.originalName,
      mimeType: attachment.mimeType,
    };
  }

  /** Mở luồng tải tệp chat có hỗ trợ HTTP Range sau khi đối chiếu membership và thời điểm rời nhóm. */
  async readAttachmentStream(
    messageId: string,
    attachmentId: string,
    session: AuthenticatedSession,
    rangeHeader?: string,
  ): Promise<{
    stream: Readable;
    totalSize: number;
    range?: ByteRange;
    fileName: string;
    mimeType: string;
  }> {
    const attachment = await this.prisma.chatMessageAttachment.findFirst({
      where: { id: attachmentId, messageId },
      include: { message: true },
    });
    if (!attachment) throw new NotFoundException("Không tìm thấy tệp chat.");
    const membership = await this.resolveMembership(
      attachment.message.conversationId,
      session.user.id,
    );
    if (
      membership.removedAt &&
      attachment.message.createdAt > membership.removedAt
    )
      throw new NotFoundException(
        "Không tìm thấy tệp chat trong phạm vi truy cập.",
      );
    const opened = await openVerifiedObjectStream({
      objectStorage: this.objectStorage,
      objectKey: attachment.objectKey,
      expectedSize: Number(attachment.sizeBytes),
      rangeHeader,
    });
    return {
      ...opened,
      fileName: attachment.originalName,
      mimeType: attachment.mimeType,
    };
  }

  /** Nạp lớp chung kèm hồ sơ công khai tối thiểu dùng cho danh bạ. */
  private accessibleDirectoryClasses(
    session: AuthenticatedSession,
  ): Promise<DirectoryClassRow[]> {
    // Quản trị và quản lý đã có danh sách tài khoản toàn hệ thống, không cần nạp toàn bộ lớp.
    if (session.roleCode === "CENTER_MANAGER" || session.roleCode === "SYSTEM_ADMIN") return Promise.resolve([]);
    return this.prisma.learningClass.findMany({
      where: {
        OR: [
          { instructors: { some: { instructorId: session.user.id } } },
          { enrollments: { some: { learnerId: session.user.id, status: "ACTIVE" } } },
        ],
      },
      include: {
        instructors: {
          include: {
            instructor: { include: { roles: { include: { role: true } } } },
          },
        },
        enrollments: {
          where: { status: "ACTIVE" },
          include: {
            learner: { include: { roles: { include: { role: true } } } },
          },
        },
      },
    });
  }

  /** Kiểm tra user đang là giảng viên hoặc học viên hoạt động của lớp. */
  private async canJoinClassConversation(
    classId: string,
    userId: string,
  ): Promise<boolean> {
    return Boolean(
      await this.prisma.learningClass.findFirst({
        where: {
          id: classId,
          OR: [
            { instructors: { some: { instructorId: userId } } },
            { enrollments: { some: { learnerId: userId, status: "ACTIVE" } } },
          ],
        },
        select: { id: true },
      }),
    );
  }

  /** Đọc trạng thái thành viên tối gọn (không join class/conversation) cho các đường đọc chỉ cần status và removedAt. */
  private async resolveMembershipLite(
    conversationId: string,
    userId: string,
  ): Promise<{ status: "ACTIVE" | "REMOVED"; removedAt: Date | null }> {
    const membership = await this.prisma.chatConversationMember.findUnique({
      where: { conversationId_userId: { conversationId, userId } },
      select: { status: true, removedAt: true },
    });
    if (!membership)
      throw new NotFoundException(
        "Không tìm thấy hội thoại trong phạm vi truy cập.",
      );
    return membership;
  }

  /** Kiểm tra quyền mở hội thoại riêng trực tiếp theo targetUserId bằng đúng 1 câu SQL thay vì nạp cả danh bạ. */
  private async checkDirectTargetEligibility(
    session: AuthenticatedSession,
    targetUserId: string,
  ): Promise<{
    actorRole: ChatDirectoryEntry["roleCode"];
    targetRole: ChatDirectoryEntry["roleCode"];
  } | null> {
    const isStaffActor =
      session.roleCode === "CENTER_MANAGER" || session.roleCode === "SYSTEM_ADMIN";
    const rows = await this.prisma.$queryRaw<SqlDirectTargetEligibilityRow[]>`
      SELECT
        target.id AS "targetId",
        COALESCE(
          (
            SELECT array_agg(r.code)
            FROM user_roles ur
            JOIN roles r ON r.id = ur.role_id
            WHERE ur.user_id = target.id
          ),
          ARRAY[]::text[]
        ) AS "targetRoles",
        COALESCE(
          (
            SELECT array_agg(r.code)
            FROM user_roles ur
            JOIN roles r ON r.id = ur.role_id
            WHERE ur.user_id = ${session.user.id}
          ),
          ARRAY[]::text[]
        ) AS "actorRoles",
        (
          ${isStaffActor}
          OR EXISTS (
            SELECT 1
            FROM user_roles ur
            JOIN roles r ON r.id = ur.role_id
            WHERE ur.user_id = target.id
              AND r.code IN ('SYSTEM_ADMIN', 'CENTER_MANAGER')
          )
          OR EXISTS (
            SELECT 1
            FROM chat_conversations c
            JOIN chat_conversation_members m1
              ON m1.conversation_id = c.id
             AND m1.user_id = ${session.user.id}
             AND m1.status = 'ACTIVE'::"ChatMemberStatus"
            JOIN chat_conversation_members m2
              ON m2.conversation_id = c.id
             AND m2.user_id = target.id
            WHERE c.type = 'DIRECT'::"ChatConversationType"
              AND EXISTS (SELECT 1 FROM chat_messages msg WHERE msg.conversation_id = c.id)
          )
          OR EXISTS (
            SELECT 1
            FROM learning_classes lc
            WHERE (
              EXISTS (SELECT 1 FROM class_instructors ci WHERE ci.class_id = lc.id AND ci.instructor_id = ${session.user.id})
              OR EXISTS (SELECT 1 FROM class_enrollments ce WHERE ce.class_id = lc.id AND ce.learner_id = ${session.user.id} AND ce.status = 'ACTIVE'::"EnrollmentStatus")
            )
            AND (
              EXISTS (SELECT 1 FROM class_instructors ci WHERE ci.class_id = lc.id AND ci.instructor_id = target.id)
              OR EXISTS (SELECT 1 FROM class_enrollments ce WHERE ce.class_id = lc.id AND ce.learner_id = target.id AND ce.status = 'ACTIVE'::"EnrollmentStatus")
            )
          )
        ) AS "allowed"
      FROM users target
      WHERE target.id = ${targetUserId}
        AND target.status = 'ACTIVE'::"UserStatus"
      LIMIT 1
    `;
    const row = rows[0];
    if (!row || !row.allowed) return null;
    const targetRole = this.primaryRole(row.targetRoles ?? []);
    const actorRole = this.primaryRole(row.actorRoles ?? []);
    return { actorRole, targetRole };
  }

  /** Tải toàn bộ danh sách hội thoại của actor kèm thành viên, tin cuối và số tin chưa đọc trong 1 truy vấn SQL. */
  private loadConversationSummariesSql(actorId: string): Promise<SqlConversationSummaryRow[]> {
    return this.prisma.$queryRaw<SqlConversationSummaryRow[]>`
      SELECT
        c.id,
        c.type::text AS "type",
        c.class_id AS "classId",
        c.updated_at AS "updatedAt",
        lc.name AS "className",
        lc.status::text AS "classStatus",
        me.status::text AS "actorStatus",
        me.muted_until AS "actorMutedUntil",
        (
          SELECT count(*)::int
          FROM chat_messages um
          WHERE um.conversation_id = c.id
            AND um.sender_id <> ${actorId}
            AND um.created_at > COALESCE(me.last_read_at, me.joined_at)
            AND (me.removed_at IS NULL OR um.created_at <= me.removed_at)
        ) AS "unreadCount",
        COALESCE((
          SELECT json_agg(
            json_build_object(
              'userId', cm.user_id,
              'displayName', u.display_name,
              'avatarObjectKey', u.avatar_object_key,
              'avatarUpdatedAt', u.avatar_updated_at,
              'roleCode', cm.role_snapshot,
              'status', cm.status::text
            )
          )
          FROM chat_conversation_members cm
          JOIN users u ON u.id = cm.user_id
          WHERE cm.conversation_id = c.id
        ), '[]'::json) AS "membersJson",
        (
          SELECT json_build_object(
            'id', lm.id,
            'conversationId', lm.conversation_id,
            'senderId', lm.sender_id,
            'senderName', su.display_name,
            'senderAvatarObjectKey', su.avatar_object_key,
            'senderAvatarUpdatedAt', su.avatar_updated_at,
            'clientMessageId', lm.client_message_id,
            'content', lm.content,
            'contextType', lm.context_type,
            'contextId', lm.context_id,
            'createdAt', lm.created_at,
            'replyTo', CASE WHEN rm.id IS NOT NULL THEN json_build_object(
              'id', rm.id,
              'senderName', rsu.display_name,
              'content', left(rm.content, 160)
            ) ELSE NULL END,
            'attachments', COALESCE((
              SELECT json_agg(
                json_build_object(
                  'id', att.id,
                  'originalName', att.original_name,
                  'mimeType', att.mime_type,
                  'sizeBytes', att.size_bytes::text
                )
                ORDER BY att.created_at ASC
              )
              FROM chat_message_attachments att
              WHERE att.message_id = lm.id
            ), '[]'::json),
            'mentionedUserIds', COALESCE((
              SELECT json_agg(mn.mentioned_user_id)
              FROM chat_message_mentions mn
              WHERE mn.message_id = lm.id
            ), '[]'::json)
          )
          FROM chat_messages lm
          JOIN users su ON su.id = lm.sender_id
          LEFT JOIN chat_messages rm ON rm.id = lm.reply_to_id
          LEFT JOIN users rsu ON rsu.id = rm.sender_id
          WHERE lm.conversation_id = c.id
          ORDER BY lm.created_at DESC
          LIMIT 1
        ) AS "lastMessageJson"
      FROM chat_conversation_members me
      JOIN chat_conversations c ON c.id = me.conversation_id
      LEFT JOIN learning_classes lc ON lc.id = c.class_id
      WHERE me.user_id = ${actorId}
      ORDER BY c.updated_at DESC
    `;
  }

  /** Tải đúng một hội thoại theo directKey hoặc classId trong 1 truy vấn SQL cho đường mở hội thoại nhanh. */
  private async loadSingleConversationSql(
    lookup: { kind: "directKey" | "classId"; value: string },
    actorId: string,
  ): Promise<ChatConversationView | null> {
    const rows =
      lookup.kind === "directKey"
        ? await this.prisma.$queryRaw<SqlConversationSummaryRow[]>`
            SELECT
              c.id,
              c.type::text AS "type",
              c.class_id AS "classId",
              c.updated_at AS "updatedAt",
              lc.name AS "className",
              lc.status::text AS "classStatus",
              COALESCE(me.status::text, 'ACTIVE') AS "actorStatus",
              me.muted_until AS "actorMutedUntil",
              0::int AS "unreadCount",
              COALESCE((
                SELECT json_agg(
                  json_build_object(
                    'userId', cm.user_id,
                    'displayName', u.display_name,
                    'avatarObjectKey', u.avatar_object_key,
                    'avatarUpdatedAt', u.avatar_updated_at,
                    'roleCode', cm.role_snapshot,
                    'status', cm.status::text
                  )
                )
                FROM chat_conversation_members cm
                JOIN users u ON u.id = cm.user_id
                WHERE cm.conversation_id = c.id
              ), '[]'::json) AS "membersJson",
              (
                SELECT json_build_object(
                  'id', lm.id,
                  'conversationId', lm.conversation_id,
                  'senderId', lm.sender_id,
                  'senderName', su.display_name,
                  'senderAvatarObjectKey', su.avatar_object_key,
                  'senderAvatarUpdatedAt', su.avatar_updated_at,
                  'clientMessageId', lm.client_message_id,
                  'content', lm.content,
                  'contextType', lm.context_type,
                  'contextId', lm.context_id,
                  'createdAt', lm.created_at,
                  'replyTo', CASE WHEN rm.id IS NOT NULL THEN json_build_object(
                    'id', rm.id,
                    'senderName', rsu.display_name,
                    'content', left(rm.content, 160)
                  ) ELSE NULL END,
                  'attachments', COALESCE((
                    SELECT json_agg(
                      json_build_object(
                        'id', att.id,
                        'originalName', att.original_name,
                        'mimeType', att.mime_type,
                        'sizeBytes', att.size_bytes::text
                      )
                      ORDER BY att.created_at ASC
                    )
                    FROM chat_message_attachments att
                    WHERE att.message_id = lm.id
                  ), '[]'::json),
                  'mentionedUserIds', COALESCE((
                    SELECT json_agg(mn.mentioned_user_id)
                    FROM chat_message_mentions mn
                    WHERE mn.message_id = lm.id
                  ), '[]'::json)
                )
                FROM chat_messages lm
                JOIN users su ON su.id = lm.sender_id
                LEFT JOIN chat_messages rm ON rm.id = lm.reply_to_id
                LEFT JOIN users rsu ON rsu.id = rm.sender_id
                WHERE lm.conversation_id = c.id
                ORDER BY lm.created_at DESC
                LIMIT 1
              ) AS "lastMessageJson"
            FROM chat_conversations c
            LEFT JOIN learning_classes lc ON lc.id = c.class_id
            LEFT JOIN chat_conversation_members me
              ON me.conversation_id = c.id AND me.user_id = ${actorId}
            WHERE c.direct_key = ${lookup.value}
            LIMIT 1
          `
        : await this.prisma.$queryRaw<SqlConversationSummaryRow[]>`
            SELECT
              c.id,
              c.type::text AS "type",
              c.class_id AS "classId",
              c.updated_at AS "updatedAt",
              lc.name AS "className",
              lc.status::text AS "classStatus",
              COALESCE(me.status::text, 'ACTIVE') AS "actorStatus",
              me.muted_until AS "actorMutedUntil",
              0::int AS "unreadCount",
              COALESCE((
                SELECT json_agg(
                  json_build_object(
                    'userId', cm.user_id,
                    'displayName', u.display_name,
                    'avatarObjectKey', u.avatar_object_key,
                    'avatarUpdatedAt', u.avatar_updated_at,
                    'roleCode', cm.role_snapshot,
                    'status', cm.status::text
                  )
                )
                FROM chat_conversation_members cm
                JOIN users u ON u.id = cm.user_id
                WHERE cm.conversation_id = c.id
              ), '[]'::json) AS "membersJson",
              (
                SELECT json_build_object(
                  'id', lm.id,
                  'conversationId', lm.conversation_id,
                  'senderId', lm.sender_id,
                  'senderName', su.display_name,
                  'senderAvatarObjectKey', su.avatar_object_key,
                  'senderAvatarUpdatedAt', su.avatar_updated_at,
                  'clientMessageId', lm.client_message_id,
                  'content', lm.content,
                  'contextType', lm.context_type,
                  'contextId', lm.context_id,
                  'createdAt', lm.created_at,
                  'replyTo', CASE WHEN rm.id IS NOT NULL THEN json_build_object(
                    'id', rm.id,
                    'senderName', rsu.display_name,
                    'content', left(rm.content, 160)
                  ) ELSE NULL END,
                  'attachments', COALESCE((
                    SELECT json_agg(
                      json_build_object(
                        'id', att.id,
                        'originalName', att.original_name,
                        'mimeType', att.mime_type,
                        'sizeBytes', att.size_bytes::text
                      )
                      ORDER BY att.created_at ASC
                    )
                    FROM chat_message_attachments att
                    WHERE att.message_id = lm.id
                  ), '[]'::json),
                  'mentionedUserIds', COALESCE((
                    SELECT json_agg(mn.mentioned_user_id)
                    FROM chat_message_mentions mn
                    WHERE mn.message_id = lm.id
                  ), '[]'::json)
                )
                FROM chat_messages lm
                JOIN users su ON su.id = lm.sender_id
                LEFT JOIN chat_messages rm ON rm.id = lm.reply_to_id
                LEFT JOIN users rsu ON rsu.id = rm.sender_id
                WHERE lm.conversation_id = c.id
                ORDER BY lm.created_at DESC
                LIMIT 1
              ) AS "lastMessageJson"
            FROM chat_conversations c
            LEFT JOIN learning_classes lc ON lc.id = c.class_id
            LEFT JOIN chat_conversation_members me
              ON me.conversation_id = c.id AND me.user_id = ${actorId}
            WHERE c.class_id = ${lookup.value}
            LIMIT 1
          `;
    if (!rows.length) return null;
    const mapped = await this.mapSqlConversationSummaries(rows, actorId);
    return mapped[0] ?? null;
  }

  /** Ánh xạ kết quả truy vấn tổng hợp hội thoại SQL sang hợp đồng ChatConversationView kèm gom lô thẻ ngữ cảnh. */
  private async mapSqlConversationSummaries(
    rows: SqlConversationSummaryRow[],
    actorId: string,
  ): Promise<ChatConversationView[]> {
    const lastMessages = rows.map((row) =>
      parseJsonField<SqlChatMessageJson | null>(row.lastMessageJson, null),
    );
    const contextMap = await this.resolveContextCardsForActor(
      actorId,
      lastMessages.map((msg) => ({
        contextType: msg?.contextType ?? null,
        contextId: msg?.contextId ?? null,
      })),
    );
    return rows.map((row, idx) => {
      const membersRaw = parseJsonField<SqlChatMemberJson[]>(row.membersJson, []);
      const members = membersRaw.map((member) => ({
        userId: member.userId,
        displayName: member.displayName,
        avatarUrl: this.avatarUrl({
          id: member.userId,
          avatarObjectKey: member.avatarObjectKey,
          avatarUpdatedAt: toDateValue(member.avatarUpdatedAt),
        }),
        roleCode: member.roleCode,
        status: member.status,
      }));
      const other = members.find((member) => member.userId !== actorId);
      const lastMsg = lastMessages[idx];
      const mutedUntil = toDateValue(row.actorMutedUntil);
      const updatedAt = toDateValue(row.updatedAt) ?? new Date();
      return {
        id: row.id,
        type: row.type,
        classId: row.classId ?? undefined,
        title:
          row.type === "CLASS"
            ? (row.className ?? "Hội thoại lớp")
            : (other?.displayName ?? "Hội thoại"),
        members,
        lastMessage: lastMsg ? this.mapSqlMessageJson(lastMsg, contextMap) : undefined,
        unreadCount: Number(row.unreadCount ?? 0),
        readOnly: row.actorStatus === "REMOVED" || row.classStatus === "CLOSED",
        mutedUntil: mutedUntil?.toISOString(),
        updatedAt: updatedAt.toISOString(),
      };
    });
  }

  /** Đọc một trang tin nhắn kèm người gửi, tin trả lời, tệp đính kèm và lượt nhắc trong đúng 1 truy vấn SQL. */
  private loadMessagePageSql(
    conversationId: string,
    limit: number,
    cursor:
      | { kind: "idCursor"; beforeDate: Date; beforeId: string }
      | { kind: "upperBound"; upperBound?: Date },
  ): Promise<SqlMessageListRow[]> {
    if (cursor.kind === "idCursor") {
      return this.prisma.$queryRaw<SqlMessageListRow[]>`
        SELECT
          m.id,
          m.conversation_id AS "conversationId",
          m.sender_id AS "senderId",
          su.display_name AS "senderName",
          su.avatar_object_key AS "senderAvatarObjectKey",
          su.avatar_updated_at AS "senderAvatarUpdatedAt",
          m.client_message_id AS "clientMessageId",
          m.content,
          m.context_type AS "contextType",
          m.context_id AS "contextId",
          m.created_at AS "createdAt",
          rm.id AS "replyToId",
          rsu.display_name AS "replyToSenderName",
          left(rm.content, 160) AS "replyToContent",
          COALESCE((
            SELECT json_agg(
              json_build_object(
                'id', att.id,
                'originalName', att.original_name,
                'mimeType', att.mime_type,
                'sizeBytes', att.size_bytes::text
              )
              ORDER BY att.created_at ASC
            )
            FROM chat_message_attachments att
            WHERE att.message_id = m.id
          ), '[]'::json) AS "attachmentsJson",
          COALESCE((
            SELECT json_agg(mn.mentioned_user_id)
            FROM chat_message_mentions mn
            WHERE mn.message_id = m.id
          ), '[]'::json) AS "mentionsJson"
        FROM chat_messages m
        JOIN users su ON su.id = m.sender_id
        LEFT JOIN chat_messages rm ON rm.id = m.reply_to_id
        LEFT JOIN users rsu ON rsu.id = rm.sender_id
        WHERE m.conversation_id = ${conversationId}
          AND (
            m.created_at < ${cursor.beforeDate}
            OR (m.created_at = ${cursor.beforeDate} AND m.id < ${cursor.beforeId})
          )
        ORDER BY m.created_at DESC, m.id DESC
        LIMIT ${limit}
      `;
    }
    if (cursor.upperBound) {
      return this.prisma.$queryRaw<SqlMessageListRow[]>`
        SELECT
          m.id,
          m.conversation_id AS "conversationId",
          m.sender_id AS "senderId",
          su.display_name AS "senderName",
          su.avatar_object_key AS "senderAvatarObjectKey",
          su.avatar_updated_at AS "senderAvatarUpdatedAt",
          m.client_message_id AS "clientMessageId",
          m.content,
          m.context_type AS "contextType",
          m.context_id AS "contextId",
          m.created_at AS "createdAt",
          rm.id AS "replyToId",
          rsu.display_name AS "replyToSenderName",
          left(rm.content, 160) AS "replyToContent",
          COALESCE((
            SELECT json_agg(
              json_build_object(
                'id', att.id,
                'originalName', att.original_name,
                'mimeType', att.mime_type,
                'sizeBytes', att.size_bytes::text
              )
              ORDER BY att.created_at ASC
            )
            FROM chat_message_attachments att
            WHERE att.message_id = m.id
          ), '[]'::json) AS "attachmentsJson",
          COALESCE((
            SELECT json_agg(mn.mentioned_user_id)
            FROM chat_message_mentions mn
            WHERE mn.message_id = m.id
          ), '[]'::json) AS "mentionsJson"
        FROM chat_messages m
        JOIN users su ON su.id = m.sender_id
        LEFT JOIN chat_messages rm ON rm.id = m.reply_to_id
        LEFT JOIN users rsu ON rsu.id = rm.sender_id
        WHERE m.conversation_id = ${conversationId}
          AND m.created_at < ${cursor.upperBound}
        ORDER BY m.created_at DESC, m.id DESC
        LIMIT ${limit}
      `;
    }
    return this.prisma.$queryRaw<SqlMessageListRow[]>`
      SELECT
        m.id,
        m.conversation_id AS "conversationId",
        m.sender_id AS "senderId",
        su.display_name AS "senderName",
        su.avatar_object_key AS "senderAvatarObjectKey",
        su.avatar_updated_at AS "senderAvatarUpdatedAt",
        m.client_message_id AS "clientMessageId",
        m.content,
        m.context_type AS "contextType",
        m.context_id AS "contextId",
        m.created_at AS "createdAt",
        rm.id AS "replyToId",
        rsu.display_name AS "replyToSenderName",
        left(rm.content, 160) AS "replyToContent",
        COALESCE((
          SELECT json_agg(
            json_build_object(
              'id', att.id,
              'originalName', att.original_name,
              'mimeType', att.mime_type,
              'sizeBytes', att.size_bytes::text
            )
            ORDER BY att.created_at ASC
          )
          FROM chat_message_attachments att
          WHERE att.message_id = m.id
        ), '[]'::json) AS "attachmentsJson",
        COALESCE((
          SELECT json_agg(mn.mentioned_user_id)
          FROM chat_message_mentions mn
          WHERE mn.message_id = m.id
        ), '[]'::json) AS "mentionsJson"
      FROM chat_messages m
      JOIN users su ON su.id = m.sender_id
      LEFT JOIN chat_messages rm ON rm.id = m.reply_to_id
      LEFT JOIN users rsu ON rsu.id = rm.sender_id
      WHERE m.conversation_id = ${conversationId}
      ORDER BY m.created_at DESC, m.id DESC
      LIMIT ${limit}
    `;
  }

  /** Ánh xạ dòng tin nhắn SQL sang ChatMessageView bằng bảng thẻ ngữ cảnh đã gom lô sẵn. */
  private mapSqlMessageRow(
    row: SqlMessageListRow,
    contextMap: Map<string, ChatMessageView["context"]>,
  ): ChatMessageView {
    const attachments = parseJsonField<SqlChatAttachmentJson[]>(row.attachmentsJson, []);
    const mentionedUserIds = parseJsonField<string[]>(row.mentionsJson, []);
    const createdAt = toDateValue(row.createdAt) ?? new Date();
    const context =
      row.contextType && row.contextId
        ? contextMap.get(
            contextCacheKey(
              row.contextType as "ASSIGNMENT" | "EXAM" | "MATERIAL",
              row.contextId,
            ),
          )
        : undefined;
    return {
      id: row.id,
      conversationId: row.conversationId,
      senderId: row.senderId,
      senderName: row.senderName,
      senderAvatarUrl: this.avatarUrl({
        id: row.senderId,
        avatarObjectKey: row.senderAvatarObjectKey,
        avatarUpdatedAt: toDateValue(row.senderAvatarUpdatedAt),
      }),
      clientMessageId: row.clientMessageId,
      content: row.content,
      replyTo: row.replyToId
        ? {
            id: row.replyToId,
            senderName: row.replyToSenderName ?? "",
            content: row.replyToContent ?? "",
          }
        : undefined,
      attachments: attachments.map((item) => ({
        id: item.id,
        originalName: normalizeMultipartFileName(item.originalName),
        mimeType: item.mimeType,
        sizeBytes: Number(item.sizeBytes),
        canPreview:
          item.mimeType === "application/pdf" ||
          item.mimeType.startsWith("image/") ||
          item.mimeType.startsWith("audio/"),
      })),
      mentionedUserIds,
      context,
      createdAt: createdAt.toISOString(),
    };
  }

  /** Ánh xạ đối tượng JSON lastMessage từ SQL tổng hợp sang ChatMessageView. */
  private mapSqlMessageJson(
    raw: SqlChatMessageJson,
    contextMap: Map<string, ChatMessageView["context"]>,
  ): ChatMessageView {
    const createdAt = toDateValue(raw.createdAt) ?? new Date();
    const context =
      raw.contextType && raw.contextId
        ? contextMap.get(
            contextCacheKey(
              raw.contextType as "ASSIGNMENT" | "EXAM" | "MATERIAL",
              raw.contextId,
            ),
          )
        : undefined;
    return {
      id: raw.id,
      conversationId: raw.conversationId,
      senderId: raw.senderId,
      senderName: raw.senderName,
      senderAvatarUrl: this.avatarUrl({
        id: raw.senderId,
        avatarObjectKey: raw.senderAvatarObjectKey,
        avatarUpdatedAt: toDateValue(raw.senderAvatarUpdatedAt),
      }),
      clientMessageId: raw.clientMessageId,
      content: raw.content,
      replyTo: raw.replyTo ?? undefined,
      attachments: (raw.attachments ?? []).map((item) => ({
        id: item.id,
        originalName: normalizeMultipartFileName(item.originalName),
        mimeType: item.mimeType,
        sizeBytes: Number(item.sizeBytes),
        canPreview:
          item.mimeType === "application/pdf" ||
          item.mimeType.startsWith("image/") ||
          item.mimeType.startsWith("audio/"),
      })),
      mentionedUserIds: raw.mentionedUserIds ?? [],
      context,
      createdAt: createdAt.toISOString(),
    };
  }

  /** Đọc projection membership được cập nhật cùng transaction ghi danh/phân công. */
  private async resolveMembership(
    conversationId: string,
    userId: string,
  ): Promise<ConversationMembershipRow> {
    const membership = await this.prisma.chatConversationMember.findUnique({
      where: { conversationId_userId: { conversationId, userId } },
      include: { conversation: { include: { class: true } } },
    });
    if (!membership)
      throw new NotFoundException(
        "Không tìm thấy hội thoại trong phạm vi truy cập.",
      );
    return membership;
  }

  /** Nạp đầy đủ dữ liệu cần ánh xạ một hội thoại. */
  private loadConversation(
    database: PrismaService | Prisma.TransactionClient,
    conversationId: string,
  ): Promise<ConversationRow> {
    return database.chatConversation.findUniqueOrThrow({
      where: { id: conversationId },
      include: {
        class: true,
        members: { include: { user: true } },
        messages: {
          orderBy: { createdAt: "desc" },
          take: 1,
          include: {
            sender: true,
            replyTo: { include: { sender: true } },
            attachments: true,
            mentions: true,
          },
        },
      },
    });
  }

  /** Đọc theo sequence được tuần tự hóa tới commit, không phụ thuộc timestamp hoặc thứ tự ID. */
  private async pollMessages(
    conversationId: string,
    actorId: string,
    cursor: ChatStreamCursor,
  ): Promise<Array<ChatMessageView & { streamSequence: bigint }>> {
    // Projection cập nhật cùng ghi danh/phân công, không chờ TTL đồng bộ.
    const membership = await this.resolveMembership(conversationId, actorId);
    if (membership.status !== "ACTIVE") return [];
    const rows = await this.prisma.chatMessage.findMany({
      where: {
        conversationId,
        streamSequence: { gt: cursor.sequence },
        conversation: { members: { some: { userId: actorId, status: "ACTIVE" } } },
      },
      orderBy: { streamSequence: "asc" },
      take: 100,
      include: {
        sender: true,
        replyTo: { include: { sender: true } },
        attachments: true,
        mentions: true,
      },
    });
    const contextMap = await this.resolveContextCardsForActor(
      actorId,
      rows.map((row) => ({ contextType: row.contextType, contextId: row.contextId })),
    );
    return Promise.all(
      rows.map(async (row) => ({
        ...(await this.mapMessageForActor(row, actorId, contextMap)),
        streamSequence: row.streamSequence,
      })),
    );
  }

  /** Xác định người nhận còn giữ luồng SSE sống trong khoảng heartbeat an toàn. */
  private isActivelyViewing(conversationId: string, userId: string): boolean {
    const viewers = this.activeViewers.get(`${conversationId}:${userId}`);
    return [...(viewers?.values() ?? [])].some(
      (lastSeen) => Date.now() - lastSeen < 10_000,
    );
  }

  /** Ánh xạ hội thoại sang hợp đồng UI và không lộ trường nội bộ. */
  private async mapConversation(
    row: ConversationRow,
    actorId: string,
    unreadCount = 0,
  ): Promise<ChatConversationView> {
    const actor = row.members.find((member) => member.userId === actorId);
    const other = row.members.find((member) => member.userId !== actorId);
    return {
      id: row.id,
      type: row.type,
      classId: row.classId ?? undefined,
      title:
        row.type === "CLASS"
          ? (row.class?.name ?? "Hội thoại lớp")
          : (other?.user.displayName ?? "Hội thoại"),
      members: row.members.map((member) => ({
        userId: member.userId,
        displayName: member.user.displayName,
        avatarUrl: this.avatarUrl(member.user),
        roleCode: member.roleSnapshot,
        status: member.status,
      })),
      lastMessage: row.messages[0]
        ? await this.mapMessageForActor(row.messages[0], actorId)
        : undefined,
      unreadCount,
      readOnly: actor?.status === "REMOVED" || row.class?.status === "CLOSED",
      mutedUntil: actor?.mutedUntil?.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  /** Ánh xạ tin nhắn đơn lẻ và tái sử dụng bảng thẻ ngữ cảnh đã gom lô nếu caller truyền sẵn. */
  private async mapMessageForActor(
    row: MessageRow,
    actorId: string,
    preloadedContextMap?: Map<string, ChatMessageView["context"]>,
  ): Promise<ChatMessageView> {
    const contextMap =
      preloadedContextMap ??
      (await this.resolveContextCardsForActor(actorId, [
        { contextType: row.contextType, contextId: row.contextId },
      ]));
    return this.mapMessageWithContext(row, contextMap);
  }

  /** Ánh xạ tin nhắn Prisma sang ChatMessageView từ bảng thẻ ngữ cảnh đã giải quyết sẵn theo lô. */
  private mapMessageWithContext(
    row: MessageRow,
    contextMap: Map<string, ChatMessageView["context"]>,
  ): ChatMessageView {
    const context =
      row.contextType && row.contextId
        ? contextMap.get(
            contextCacheKey(
              row.contextType as "ASSIGNMENT" | "EXAM" | "MATERIAL",
              row.contextId,
            ),
          )
        : undefined;
    return {
      id: row.id,
      conversationId: row.conversationId,
      senderId: row.senderId,
      senderName: row.sender.displayName,
      senderAvatarUrl: this.avatarUrl(row.sender),
      clientMessageId: row.clientMessageId,
      content: row.content,
      replyTo: row.replyTo
        ? {
            id: row.replyTo.id,
            senderName: row.replyTo.sender.displayName,
            content: row.replyTo.content.slice(0, 160),
          }
        : undefined,
      attachments: row.attachments.map((item) => ({
        id: item.id,
        originalName: normalizeMultipartFileName(item.originalName),
        mimeType: item.mimeType,
        sizeBytes: Number(item.sizeBytes),
        canPreview:
          item.mimeType === "application/pdf" ||
          item.mimeType.startsWith("image/") ||
          item.mimeType.startsWith("audio/"),
      })),
      mentionedUserIds: row.mentions.map((item) => item.mentionedUserId),
      context,
      createdAt: row.createdAt.toISOString(),
    };
  }

  /** Kiểm tra quyền xem một đối tượng đính kèm cho toàn bộ thành viên đang hoạt động theo lô, loại bỏ N+1 theo sĩ số lớp. */
  private async canAllUsersAccessContext(
    type: "ASSIGNMENT" | "EXAM" | "MATERIAL",
    contextId: string,
    userIds: string[],
  ): Promise<boolean> {
    const uniqueUserIds = [...new Set(userIds)];
    if (!uniqueUserIds.length) return true;
    const resource =
      type === "ASSIGNMENT"
        ? await this.prisma.assignment.findUnique({
            where: { id: contextId },
            select: { classId: true, hidden: true },
          })
        : type === "MATERIAL"
          ? await this.prisma.material.findUnique({
              where: { id: contextId },
              select: { classId: true, visibility: true },
            })
          : await this.prisma.exam.findUnique({
              where: { id: contextId },
              select: { classId: true, hidden: true },
            });
    const classId = resource?.classId;
    if (!classId) return false;
    const hidden = Boolean(
      ("hidden" in resource && resource.hidden) ||
      ("visibility" in resource && resource.visibility !== "PUBLISHED"),
    );
    const [staffUsers, instructors, enrollments] = await Promise.all([
      this.prisma.user.findMany({
        where: {
          id: { in: uniqueUserIds },
          roles: { some: { role: { code: { in: ["SYSTEM_ADMIN", "CENTER_MANAGER"] } } } },
        },
        select: { id: true },
      }),
      this.prisma.classInstructor.findMany({
        where: { classId, instructorId: { in: uniqueUserIds } },
        select: { instructorId: true },
      }),
      hidden
        ? Promise.resolve([])
        : this.prisma.classEnrollment.findMany({
            where: { classId, learnerId: { in: uniqueUserIds }, status: "ACTIVE" },
            select: { learnerId: true },
          }),
    ]);
    const allowedIds = new Set<string>([
      ...staffUsers.map((item) => item.id),
      ...instructors.map((item) => item.instructorId),
      ...enrollments.map((item) => item.learnerId),
    ]);
    return uniqueUserIds.every((uid) => allowedIds.has(uid));
  }

  /** Gom lô đọc và kiểm quyền mọi thẻ ngữ cảnh xuất hiện trong trang tin nhắn để loại bỏ hoàn toàn N+1 và truy vấn lặp. */
  private async resolveContextCardsForActor(
    actorId: string,
    refs: Array<{ contextType: string | null; contextId: string | null }>,
  ): Promise<Map<string, ChatMessageView["context"]>> {
    const result = new Map<string, ChatMessageView["context"]>();
    const assignmentIds = new Set<string>();
    const examIds = new Set<string>();
    const materialIds = new Set<string>();
    for (const ref of refs) {
      if (!ref.contextType || !ref.contextId) continue;
      if (ref.contextType === "ASSIGNMENT") assignmentIds.add(ref.contextId);
      else if (ref.contextType === "EXAM") examIds.add(ref.contextId);
      else if (ref.contextType === "MATERIAL") materialIds.add(ref.contextId);
    }
    if (!assignmentIds.size && !examIds.size && !materialIds.size) return result;

    const [assignments, exams, materials, actorStaff] = await Promise.all([
      assignmentIds.size
        ? this.prisma.assignment.findMany({
            where: { id: { in: [...assignmentIds] } },
            select: { id: true, title: true, classId: true, hidden: true },
          })
        : Promise.resolve([]),
      examIds.size
        ? this.prisma.exam.findMany({
            where: { id: { in: [...examIds] } },
            select: { id: true, title: true, classId: true, hidden: true },
          })
        : Promise.resolve([]),
      materialIds.size
        ? this.prisma.material.findMany({
            where: { id: { in: [...materialIds] } },
            select: {
              id: true,
              name: true,
              classId: true,
              visibility: true,
              quarantinedAt: true,
            },
          })
        : Promise.resolve([]),
      this.prisma.user.findFirst({
        where: {
          id: actorId,
          roles: { some: { role: { code: { in: ["SYSTEM_ADMIN", "CENTER_MANAGER"] } } } },
        },
        select: { id: true },
      }),
    ]);

    const isStaff = Boolean(actorStaff);
    const referencedClassIds = new Set<string>();
    for (const item of assignments) if (item.classId) referencedClassIds.add(item.classId);
    for (const item of exams) if (item.classId) referencedClassIds.add(item.classId);
    for (const item of materials) if (item.classId) referencedClassIds.add(item.classId);

    const instructorClasses = new Set<string>();
    const learnerClasses = new Set<string>();
    if (!isStaff && referencedClassIds.size) {
      const classIdList = [...referencedClassIds];
      const [instructed, enrolled] = await Promise.all([
        this.prisma.classInstructor.findMany({
          where: { classId: { in: classIdList }, instructorId: actorId },
          select: { classId: true },
        }),
        this.prisma.classEnrollment.findMany({
          where: { classId: { in: classIdList }, learnerId: actorId, status: "ACTIVE" },
          select: { classId: true },
        }),
      ]);
      for (const row of instructed) instructorClasses.add(row.classId);
      for (const row of enrolled) learnerClasses.add(row.classId);
    }

    /** Kiểm tra người đọc hiện tại có quyền xem đối tượng thuộc một lớp và trạng thái ẩn/hiện hay không. */
    const canViewClassResource = (classId: string | null, hidden: boolean): boolean => {
      if (!classId) return false;
      if (isStaff || instructorClasses.has(classId)) return true;
      return !hidden && learnerClasses.has(classId);
    };

    for (const item of assignments) {
      if (!canViewClassResource(item.classId, item.hidden)) continue;
      result.set(contextCacheKey("ASSIGNMENT", item.id), {
        type: "ASSIGNMENT",
        id: item.id,
        title: item.title,
        href: `/academic?classId=${encodeURIComponent(item.classId)}&assignmentId=${encodeURIComponent(item.id)}`,
      });
    }
    for (const item of exams) {
      if (!canViewClassResource(item.classId, item.hidden)) continue;
      result.set(contextCacheKey("EXAM", item.id), {
        type: "EXAM",
        id: item.id,
        title: item.title,
        href: `/exams?classId=${encodeURIComponent(item.classId)}&examId=${encodeURIComponent(item.id)}`,
      });
    }
    for (const item of materials) {
      const hidden = item.visibility !== "PUBLISHED";
      if (!canViewClassResource(item.classId, hidden)) continue;
      if (item.visibility !== "PUBLISHED" || item.quarantinedAt) continue;
      result.set(contextCacheKey("MATERIAL", item.id), {
        type: "MATERIAL",
        id: item.id,
        title: item.name,
        href: item.classId
          ? `/materials?classId=${encodeURIComponent(item.classId)}&materialId=${encodeURIComponent(item.id)}`
          : `/materials?materialId=${encodeURIComponent(item.id)}`,
      });
    }
    return result;
  }

  /** Giới hạn và xác thực định dạng tệp (MIME + magic bytes + cấu trúc DOCX) trước khi quét virus/lưu storage. */
  private async validateFiles(files: UploadedChatFile[]): Promise<void> {
    if (files.length > 5)
      throw new BadRequestException("Mỗi tin nhắn được đính kèm tối đa 5 tệp.");
    const allowed = new Set([
      "image/jpeg",
      "image/png",
      "image/webp",
      "application/pdf",
      "text/plain",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ]);
    for (const file of files) {
      if (!file.originalName.trim() || file.originalName.length > 255)
        throw new BadRequestException("Tên tệp chat không hợp lệ.");
      if (
        file.size <= 0 ||
        file.size > 10 * 1024 * 1024 ||
        file.buffer.length !== file.size
      )
        throw new BadRequestException(
          `Tệp ${file.originalName} phải có dung lượng từ 1 byte đến 10 MB.`,
        );
      if (!allowed.has(file.mimeType))
        throw new BadRequestException(
          `Định dạng tệp ${file.originalName} không được hỗ trợ trong chat.`,
        );
      // Không tin MIME client khai báo: nội dung phải khớp chữ ký định dạng.
      await assertSafeUpload(file);
    }
  }

  /** Chọn vai trò đại diện ổn định cho nhãn danh bạ. */
  private primaryRole(roles: string[]): ChatDirectoryEntry["roleCode"] {
    for (const role of [
      "SYSTEM_ADMIN",
      "CENTER_MANAGER",
      "INSTRUCTOR",
      "LEARNER",
    ] as const)
      if (roles.includes(role)) return role;
    return "LEARNER";
  }

  /** Tạo đường dẫn avatar công khai, thay đổi khi người dùng cập nhật ảnh. */
  private avatarUrl(user: { id: string; avatarObjectKey: string | null; avatarUpdatedAt: Date | null }): string | undefined {
    return user.avatarObjectKey
      ? `/account/users/${encodeURIComponent(user.id)}/avatar?v=${user.avatarUpdatedAt?.getTime() ?? 0}`
      : undefined;
  }

  /** Chuẩn hóa chuỗi tìm kiếm để tên có dấu và không dấu cho cùng kết quả. */
  private searchText(value: string): string {
    return value
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/đ/g, "d")
      .replace(/Đ/g, "D")
      .trim()
      .toLowerCase();
  }
}
