import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { AuthenticatedSession } from "../auth/auth.service.js";
import { PrismaService } from "../database/prisma.service.js";
import type { Prisma } from "../generated/prisma/client.js";
import { AntivirusService } from "../infrastructure/antivirus.service.js";
import { ObjectStorageService } from "../infrastructure/object-storage.service.js";
import type {
  ChatConversationView,
  ChatDirectoryEntry,
  ChatMessagePage,
  ChatMessageView,
} from "./chat.types.js";
import { defer, from, interval, type Observable } from "rxjs";
import { concatMap, finalize, mergeMap } from "rxjs/operators";

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
export interface UploadedChatFile {
  originalName: string;
  mimeType: string;
  size: number;
  buffer: Buffer;
}

@Injectable()
/** Quản lý danh bạ và hội thoại theo quan hệ lớp, không mở rộng phạm vi từ dữ liệu hồ sơ riêng tư. */
export class ChatService {
  private readonly activeViewers = new Map<string, number>();
  constructor(
    private readonly prisma: PrismaService,
    private readonly objectStorage: ObjectStorageService,
    private readonly antivirus: AntivirusService,
  ) {}

  /** Tìm người có thể liên hệ bằng tên không dấu, mã tài khoản hoặc lớp chung. */
  async directory(
    session: AuthenticatedSession,
    query = "",
  ): Promise<ChatDirectoryEntry[]> {
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
        take: 250,
      });
      for (const user of users)
        entries.set(
          user.id,
          entries.get(user.id) ?? {
            id: user.id,
            displayName: user.displayName,
            roleCode: this.primaryRole(
              user.roles.map((item) => item.role.code),
            ),
            sharedClasses: [],
          },
        );
    }
    const normalized = this.searchText(query);
    return [...entries.values()]
      .filter(
        (entry) =>
          !normalized ||
          this.searchText(
            `${entry.displayName} ${entry.id} ${entry.sharedClasses.map((item) => `${item.code} ${item.name}`).join(" ")}`,
          ).includes(normalized),
      )
      .sort((left, right) =>
        left.displayName.localeCompare(right.displayName, "vi"),
      )
      .slice(0, 50);
  }

  /** Mở đúng một hội thoại riêng cho một cặp người dùng, chống tạo trùng bằng directKey. */
  async openDirect(
    session: AuthenticatedSession,
    targetUserId: string,
  ): Promise<ChatConversationView> {
    if (targetUserId === session.user.id)
      throw new BadRequestException(
        "Không thể tự mở hội thoại với chính mình.",
      );
    if (await this.isBlockedPair(session.user.id, targetUserId))
      throw new ConflictException(
        "Không thể mở hội thoại vì một trong hai tài khoản đã chặn liên hệ riêng.",
      );
    const allowed = await this.directory(session);
    if (!allowed.some((entry) => entry.id === targetUserId))
      throw new NotFoundException(
        "Không tìm thấy người dùng trong phạm vi có thể liên hệ.",
      );
    const directKey = [session.user.id, targetUserId].sort().join(":");
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

  /** Mở hội thoại lớp và đồng bộ thành viên theo ghi danh/phân công hiện tại. */
  async openClass(
    session: AuthenticatedSession,
    classId: string,
  ): Promise<ChatConversationView> {
    if (!(await this.canJoinClassConversation(classId, session.user.id)))
      throw new NotFoundException("Không tìm thấy lớp được phép trò chuyện.");
    const conversation = await this.prisma.chatConversation.upsert({
      where: { classId },
      update: {},
      create: {
        id: `conversation-${randomUUID()}`,
        type: "CLASS",
        classId,
        createdById: session.user.id,
      },
    });
    await this.syncClassMembers(conversation.id, classId);
    return this.mapConversation(
      await this.loadConversation(this.prisma, conversation.id),
      session.user.id,
    );
  }

  /** Liệt kê hội thoại của thành viên, tính chưa đọc trên server và giữ lớp đóng ở chế độ đọc. */
  async listConversations(
    session: AuthenticatedSession,
  ): Promise<ChatConversationView[]> {
    const classMemberships = await this.prisma.chatConversationMember.findMany({
      where: { userId: session.user.id, conversation: { type: "CLASS" } },
      select: {
        conversationId: true,
        conversation: { select: { classId: true } },
      },
    });
    for (const membership of classMemberships)
      if (membership.conversation.classId)
        await this.syncClassMembers(
          membership.conversationId,
          membership.conversation.classId,
        );
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
    return Promise.all(
      rows.map(async (row) =>
        this.mapConversation(
          row,
          session.user.id,
          await this.unreadCount(row.id, session.user.id),
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
    const membership = await this.resolveMembership(
      conversationId,
      session.user.id,
    );
    const take = Math.min(Math.max(limit, 1), 100);
    const beforeDate = before ? new Date(before) : undefined;
    if (beforeDate && Number.isNaN(beforeDate.getTime()))
      throw new BadRequestException("Cursor tin nhắn không hợp lệ.");
    const upperBound =
      membership.status === "REMOVED" &&
      membership.removedAt &&
      (!beforeDate || membership.removedAt < beforeDate)
        ? membership.removedAt
        : beforeDate;
    const rows = await this.prisma.chatMessage.findMany({
      where: {
        conversationId,
        createdAt: upperBound ? { lt: upperBound } : undefined,
      },
      orderBy: { createdAt: "desc" },
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
    return {
      items: await Promise.all(
        page
          .reverse()
          .map((row) => this.mapMessageForActor(row, session.user.id)),
      ),
      nextCursor: hasNext
        ? page[page.length - 1]?.createdAt.toISOString()
        : undefined,
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
    if (membership.conversation.type === "DIRECT") {
      const other = await this.prisma.chatConversationMember.findFirst({
        where: { conversationId, userId: { not: session.user.id } },
        select: { userId: true },
      });
      if (other && (await this.isBlockedPair(session.user.id, other.userId)))
        throw new ConflictException(
          "Không thể gửi tin vì một trong hai tài khoản đã chặn liên hệ riêng.",
        );
    }
    this.validateFiles(files);
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
      for (const member of activeMembers)
        if (
          !(await this.canAccessContext(
            input.contextType,
            input.contextId,
            member.userId,
          ))
        )
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
              originalName: file.originalName,
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
  ): Observable<{ data: ChatMessageView }> {
    const viewerKey = `${conversationId}:${session.user.id}`;
    let cursor = new Date();
    const seen = new Set<string>();
    return defer(async () => {
      await this.resolveMembership(conversationId, session.user.id);
      this.activeViewers.set(viewerKey, Date.now());
      return true;
    }).pipe(
      mergeMap(() => interval(2_000)),
      concatMap(() =>
        from(this.pollMessages(conversationId, session.user.id, cursor, seen)),
      ),
      mergeMap((messages) => {
        this.activeViewers.set(viewerKey, Date.now());
        if (messages.length)
          cursor = new Date(messages[messages.length - 1]!.createdAt);
        return from(messages.map((message) => ({ data: message })));
      }),
      finalize(() => this.activeViewers.delete(viewerKey)),
    );
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
    const query = rawQuery.trim();
    if (query.length < 2)
      throw new BadRequestException("Từ khóa tìm tin cần ít nhất 2 ký tự.");
    const rows = await this.prisma.chatMessage.findMany({
      where: {
        conversationId,
        content: { contains: query },
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
    return Promise.all(
      rows.map((row) => this.mapMessageForActor(row, session.user.id)),
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

  /** Ghi nhận báo cáo tin nhắn một lần cho mỗi người và lưu audit để kiểm duyệt. */
  async reportMessage(
    messageId: string,
    rawReason: string,
    session: AuthenticatedSession,
  ): Promise<{ id: string; status: string }> {
    const message = await this.prisma.chatMessage.findUnique({
      where: { id: messageId },
    });
    if (!message) throw new NotFoundException("Không tìm thấy tin nhắn.");
    const membership = await this.resolveMembership(
      message.conversationId,
      session.user.id,
    );
    if (membership.removedAt && message.createdAt > membership.removedAt)
      throw new NotFoundException(
        "Không tìm thấy tin nhắn trong phạm vi truy cập.",
      );
    if (message.senderId === session.user.id)
      throw new BadRequestException(
        "Không thể báo cáo tin nhắn của chính mình.",
      );
    const reason = rawReason.trim();
    const row = await this.prisma.chatMessageReport.upsert({
      where: {
        messageId_reporterId: { messageId, reporterId: session.user.id },
      },
      update: { reason, status: "OPEN" },
      create: {
        id: `chat-report-${randomUUID()}`,
        messageId,
        reporterId: session.user.id,
        reason,
      },
    });
    await this.prisma.auditLog.create({
      data: {
        actorId: session.user.id,
        action: "CHAT_MESSAGE_REPORTED",
        entityType: "CHAT_MESSAGE",
        entityId: messageId,
        context: { reportId: row.id },
      },
    });
    return { id: row.id, status: row.status };
  }

  /** Chặn liên hệ riêng với một người dùng nhưng không thay đổi quyền xem nhóm lớp. */
  async blockUser(
    userId: string,
    rawReason: string | undefined,
    session: AuthenticatedSession,
  ): Promise<{ blockedUserId: string }> {
    if (userId === session.user.id)
      throw new BadRequestException("Không thể tự chặn chính mình.");
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true },
    });
    if (!user) throw new NotFoundException("Không tìm thấy người dùng.");
    await this.prisma.userBlock.upsert({
      where: {
        blockerId_blockedId: { blockerId: session.user.id, blockedId: userId },
      },
      update: { reason: rawReason?.trim() },
      create: {
        blockerId: session.user.id,
        blockedId: userId,
        reason: rawReason?.trim(),
      },
    });
    return { blockedUserId: userId };
  }

  /** Bỏ chặn liên hệ riêng do chính người dùng đã tạo. */
  async unblockUser(
    userId: string,
    session: AuthenticatedSession,
  ): Promise<{ unblockedUserId: string }> {
    await this.prisma.userBlock.deleteMany({
      where: { blockerId: session.user.id, blockedId: userId },
    });
    return { unblockedUserId: userId };
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

  /** Nạp lớp chung kèm hồ sơ công khai tối thiểu dùng cho danh bạ. */
  private accessibleDirectoryClasses(
    session: AuthenticatedSession,
  ): Promise<DirectoryClassRow[]> {
    return this.prisma.learningClass.findMany({
      where:
        session.roleCode === "CENTER_MANAGER" ||
        session.roleCode === "SYSTEM_ADMIN"
          ? undefined
          : {
              OR: [
                { instructors: { some: { instructorId: session.user.id } } },
                {
                  enrollments: {
                    some: { learnerId: session.user.id, status: "ACTIVE" },
                  },
                },
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
      take: 100,
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

  /** Đồng bộ membership nhóm lớp; người rời giữ lịch sử nhưng không nhận/gửi tin mới. */
  private async syncClassMembers(
    conversationId: string,
    classId: string,
  ): Promise<void> {
    const classItem = await this.prisma.learningClass.findUnique({
      where: { id: classId },
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
    if (!classItem) return;
    const members = [
      ...classItem.instructors.map((item) => item.instructor),
      ...classItem.enrollments.map((item) => item.learner),
    ];
    const activeIds = [...new Set(members.map((user) => user.id))];
    await this.prisma.$transaction(async (transaction) => {
      await transaction.chatConversationMember.updateMany({
        where: {
          conversationId,
          status: "ACTIVE",
          userId: { notIn: activeIds },
        },
        data: { status: "REMOVED", removedAt: new Date() },
      });
      for (const user of members)
        await transaction.chatConversationMember.upsert({
          where: { conversationId_userId: { conversationId, userId: user.id } },
          update: {
            status: "ACTIVE",
            removedAt: null,
            roleSnapshot: this.primaryRole(
              user.roles.map((item) => item.role.code),
            ),
          },
          create: {
            conversationId,
            userId: user.id,
            roleSnapshot: this.primaryRole(
              user.roles.map((item) => item.role.code),
            ),
          },
        });
    });
  }

  /** Nạp membership cùng trạng thái lớp và đồng bộ trước khi cấp quyền. */
  private async resolveMembership(
    conversationId: string,
    userId: string,
  ): Promise<ConversationMembershipRow> {
    const conversation = await this.prisma.chatConversation.findUnique({
      where: { id: conversationId },
      select: { classId: true },
    });
    if (!conversation) throw new NotFoundException("Không tìm thấy hội thoại.");
    if (conversation.classId)
      await this.syncClassMembers(conversationId, conversation.classId);
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

  /** Đếm tin mới hơn mốc đã đọc, không tính tin do chính người dùng gửi. */
  private async unreadCount(
    conversationId: string,
    userId: string,
  ): Promise<number> {
    const member = await this.prisma.chatConversationMember.findUnique({
      where: { conversationId_userId: { conversationId, userId } },
    });
    if (!member) return 0;
    return this.prisma.chatMessage.count({
      where: {
        conversationId,
        senderId: { not: userId },
        createdAt: {
          gt: member.lastReadAt ?? member.joinedAt,
          ...(member.removedAt ? { lte: member.removedAt } : {}),
        },
      },
    });
  }

  /** Đọc các tin phát sinh sau cursor, loại trùng ở ranh giới timestamp và giữ quyền lịch sử. */
  private async pollMessages(
    conversationId: string,
    actorId: string,
    cursor: Date,
    seen: Set<string>,
  ): Promise<ChatMessageView[]> {
    const membership = await this.resolveMembership(conversationId, actorId);
    const rows = await this.prisma.chatMessage.findMany({
      where: {
        conversationId,
        createdAt: {
          gte: cursor,
          ...(membership.removedAt ? { lte: membership.removedAt } : {}),
        },
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: 100,
      include: {
        sender: true,
        replyTo: { include: { sender: true } },
        attachments: true,
        mentions: true,
      },
    });
    const fresh = rows.filter((row) => !seen.has(row.id));
    for (const row of fresh) seen.add(row.id);
    if (seen.size > 500) {
      const keep = new Set(fresh.map((row) => row.id));
      seen.clear();
      for (const id of keep) seen.add(id);
    }
    return Promise.all(
      fresh.map((row) => this.mapMessageForActor(row, actorId)),
    );
  }

  /** Xác định người nhận còn giữ luồng SSE sống trong khoảng heartbeat an toàn. */
  private isActivelyViewing(conversationId: string, userId: string): boolean {
    const lastSeen = this.activeViewers.get(`${conversationId}:${userId}`);
    return Boolean(lastSeen && Date.now() - lastSeen < 10_000);
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

  /** Ánh xạ tin nhắn và chỉ trả thẻ ngữ cảnh khi người đọc còn quyền đối tượng. */
  private async mapMessageForActor(
    row: MessageRow,
    actorId: string,
  ): Promise<ChatMessageView> {
    const context =
      row.contextType &&
      row.contextId &&
      (await this.canAccessContext(
        row.contextType as "ASSIGNMENT" | "EXAM" | "MATERIAL",
        row.contextId,
        actorId,
      ))
        ? await this.contextCard(
            row.contextType as "ASSIGNMENT" | "EXAM" | "MATERIAL",
            row.contextId,
          )
        : undefined;
    return {
      id: row.id,
      conversationId: row.conversationId,
      senderId: row.senderId,
      senderName: row.sender.displayName,
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
        originalName: item.originalName,
        mimeType: item.mimeType,
        sizeBytes: Number(item.sizeBytes),
        canPreview:
          item.mimeType === "application/pdf" ||
          item.mimeType.startsWith("image/"),
      })),
      mentionedUserIds: row.mentions.map((item) => item.mentionedUserId),
      context,
      createdAt: row.createdAt.toISOString(),
    };
  }

  /** Kiểm tra một cặp bị chặn theo bất kỳ chiều nào. */
  private async isBlockedPair(
    leftUserId: string,
    rightUserId: string,
  ): Promise<boolean> {
    return Boolean(
      await this.prisma.userBlock.findFirst({
        where: {
          OR: [
            { blockerId: leftUserId, blockedId: rightUserId },
            { blockerId: rightUserId, blockedId: leftUserId },
          ],
        },
        select: { blockerId: true },
      }),
    );
  }

  /** Kiểm tra quyền hiện tại của người dùng đối với đối tượng gắn trong thẻ chat. */
  private async canAccessContext(
    type: "ASSIGNMENT" | "EXAM" | "MATERIAL",
    contextId: string,
    userId: string,
  ): Promise<boolean> {
    const classId =
      type === "ASSIGNMENT"
        ? (
            await this.prisma.assignment.findUnique({
              where: { id: contextId },
              select: { classId: true },
            })
          )?.classId
        : type === "EXAM"
          ? (
              await this.prisma.exam.findUnique({
                where: { id: contextId },
                select: { classId: true },
              })
            )?.classId
          : (
              await this.prisma.material.findUnique({
                where: { id: contextId },
                select: { classId: true },
              })
            )?.classId;
    if (!classId) return false;
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { roles: { select: { role: { select: { code: true } } } } },
    });
    if (
      user?.roles.some((item) =>
        ["SYSTEM_ADMIN", "CENTER_MANAGER"].includes(item.role.code),
      )
    )
      return true;
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

  /** Tạo nhãn và đường dẫn sâu cho thẻ ngữ cảnh đã được cấp quyền. */
  private async contextCard(
    type: "ASSIGNMENT" | "EXAM" | "MATERIAL",
    contextId: string,
  ): Promise<ChatMessageView["context"]> {
    if (type === "ASSIGNMENT") {
      const row = await this.prisma.assignment.findUnique({
        where: { id: contextId },
        select: { title: true, classId: true },
      });
      return row
        ? {
            type,
            id: contextId,
            title: row.title,
            href: `/academic?classId=${encodeURIComponent(row.classId)}&assignmentId=${encodeURIComponent(contextId)}`,
          }
        : undefined;
    }
    if (type === "EXAM") {
      const row = await this.prisma.exam.findUnique({
        where: { id: contextId },
        select: { title: true, classId: true },
      });
      return row
        ? {
            type,
            id: contextId,
            title: row.title,
            href: `/exams?classId=${encodeURIComponent(row.classId)}&examId=${encodeURIComponent(contextId)}`,
          }
        : undefined;
    }
    const row = await this.prisma.material.findUnique({
      where: { id: contextId },
      select: {
        name: true,
        classId: true,
        visibility: true,
        quarantinedAt: true,
      },
    });
    return row && row.visibility === "PUBLISHED" && !row.quarantinedAt
      ? {
          type,
          id: contextId,
          title: row.name,
          href: `/materials?classId=${encodeURIComponent(row.classId)}&materialId=${encodeURIComponent(contextId)}`,
        }
      : undefined;
  }

  /** Giới hạn và xác thực định dạng tệp trước khi quét virus/lưu storage. */
  private validateFiles(files: UploadedChatFile[]): void {
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
