import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  Headers,
  Param,
  Patch,
  Post,
  Query,
  Sse,
  StreamableFile,
  UploadedFiles,
  UseInterceptors,
} from "@nestjs/common";
import { FilesInterceptor } from "@nestjs/platform-express";
import { ApiTags } from "@nestjs/swagger";
import type { AuthenticatedSession } from "../../../auth/auth.service.js";
import { CurrentSession } from "../../../auth/current-session.decorator.js";
import { RequireAuthentication } from "../../../auth/require-permissions.decorator.js";
import { MuteConversationDto, OpenClassConversationDto, OpenDirectConversationDto, SendChatMessageDto } from "./chat.dto.js";
import { ChatService } from "./chat.service.js";
import type {
  ChatConversationView,
  ChatDirectoryEntry,
  ChatMessagePage,
  ChatMessageView,
  ChatStreamEvent,
} from "./chat.types.js";
import type { Observable } from "rxjs";
import { isInlineSafeMime, USER_FILE_CSP } from "../../../infrastructure/file-signature.js";
import { fileContentDisposition, normalizeMultipartFileName } from "../../../infrastructure/file-transfer.js";

@ApiTags("Chat")
@Controller("chat")
@RequireAuthentication()
/** API danh bạ, hội thoại riêng/lớp và trạng thái đã đọc. */
export class ChatController {
  constructor(private readonly chat: ChatService) {}

  /** Tìm người dùng trong phạm vi quan hệ lớp hiện tại. */
  @Get("directory") directory(
    @CurrentSession() session: AuthenticatedSession,
    @Query("q") query = "",
  ): Promise<ChatDirectoryEntry[]> {
    return this.chat.directory(session, query);
  }

  /** Liệt kê hội thoại của tài khoản hiện tại. */
  @Get("conversations") listConversations(
    @CurrentSession() session: AuthenticatedSession,
  ): Promise<ChatConversationView[]> {
    return this.chat.listConversations(session);
  }

  /** Mở hội thoại riêng idempotent với một liên hệ hợp lệ. */
  @Post("conversations/direct") openDirect(
    @Body() input: OpenDirectConversationDto,
    @CurrentSession() session: AuthenticatedSession,
  ): Promise<ChatConversationView> {
    return this.chat.openDirect(session, input.userId);
  }

  /** Mở hoặc tham gia hội thoại lớp theo membership thực tế. */
  @Post("conversations/class") openClass(
    @Body() input: OpenClassConversationDto,
    @CurrentSession() session: AuthenticatedSession,
  ): Promise<ChatConversationView> {
    return this.chat.openClass(session, input.classId);
  }

  /** Đọc một trang lịch sử tin nhắn. */
  @Get("conversations/:conversationId/messages") listMessages(
    @Param("conversationId") conversationId: string,
    @CurrentSession() session: AuthenticatedSession,
    @Query("before") before?: string,
    @Query("limit") limit?: string,
  ): Promise<ChatMessagePage> {
    return this.chat.listMessages(
      conversationId,
      session,
      before,
      limit ? Number(limit) : 40,
    );
  }

  /** Giữ kết nối SSE để nhận tin mới và đồng bộ nhiều thiết bị không cần polling trang. */
  @Sse("conversations/:conversationId/events")
  events(
    @Param("conversationId") conversationId: string,
    @CurrentSession() session: AuthenticatedSession,
    @Headers("last-event-id") lastEventId?: string,
  ): Observable<ChatStreamEvent> {
    return this.chat.watchMessages(conversationId, session, lastEventId);
  }

  /** Tìm nội dung trong một hội thoại thuộc phạm vi truy cập. */
  @Get("conversations/:conversationId/search") searchMessages(
    @Param("conversationId") conversationId: string,
    @Query("q") query: string,
    @CurrentSession() session: AuthenticatedSession,
  ): Promise<ChatMessageView[]> {
    return this.chat.searchMessages(conversationId, query, session);
  }

  /** Gửi văn bản hoặc trả lời một tin nhắn với khóa idempotency từ client. */
  @Post("conversations/:conversationId/messages")
  @UseInterceptors(
    FilesInterceptor("files", 5, {
      limits: { files: 5, fileSize: 10 * 1024 * 1024 },
    }),
  )
  sendMessage(
    @Param("conversationId") conversationId: string,
    @Body() input: SendChatMessageDto,
    @UploadedFiles()
    files: Array<{
      originalname: string;
      mimetype: string;
      size: number;
      buffer: Buffer;
    }> = [],
    @CurrentSession() session: AuthenticatedSession,
  ): Promise<ChatMessageView> {
    if (files.some((file) => !file.buffer))
      throw new BadRequestException("Không đọc được dữ liệu tệp chat.");
    return this.chat.sendMessage(
      conversationId,
      input,
      files.map((file) => ({
        originalName: normalizeMultipartFileName(file.originalname),
        mimeType: file.mimetype,
        size: file.size,
        buffer: file.buffer,
      })),
      session,
    );
  }

  /** Đồng bộ mốc đã đọc cho hội thoại. */
  @Patch("conversations/:conversationId/read") markRead(
    @Param("conversationId") conversationId: string,
    @CurrentSession() session: AuthenticatedSession,
  ): Promise<{ readAt: string }> {
    return this.chat.markRead(conversationId, session);
  }

  /** Tắt hoặc bật lại thông báo riêng cho hội thoại hiện tại. */
  @Patch("conversations/:conversationId/mute") mute(
    @Param("conversationId") conversationId: string,
    @Body() input: MuteConversationDto,
    @CurrentSession() session: AuthenticatedSession,
  ): Promise<{ mutedUntil?: string }> {
    return this.chat.muteConversation(
      conversationId,
      input.mutedUntil,
      session,
    );
  }

  /** Mở hoặc tải một tệp chat sau khi kiểm tra membership và thời điểm rời nhóm. */
  @Get("messages/:messageId/attachments/:attachmentId") @Header("Content-Security-Policy", USER_FILE_CSP) async attachment(
    @Param("messageId") messageId: string,
    @Param("attachmentId") attachmentId: string,
    @Query("action") action: string,
    @CurrentSession() session: AuthenticatedSession,
  ): Promise<StreamableFile> {
    const file = await this.chat.readAttachment(
      messageId,
      attachmentId,
      session,
    );
    const inline = action === "preview" && isInlineSafeMime(file.mimeType);
    return new StreamableFile(file.buffer, {
      type: file.mimeType,
      disposition: fileContentDisposition(inline ? "inline" : "attachment", file.fileName),
      length: file.buffer.length,
    });
  }
}
