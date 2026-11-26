import { BadRequestException, Controller, ForbiddenException, Query, Sse } from "@nestjs/common";
import { catchError, filter, interval, map, merge, of, type Observable } from "rxjs";
import type { AuthenticatedSession } from "../../../auth/auth.service.js";
import { CurrentSession } from "../../../auth/current-session.decorator.js";
import { RequireAuthentication } from "../../../auth/require-permissions.decorator.js";
import { DatabaseEventsService } from "../../../database/database-events.service.js";
import { ChatService } from "../chat/chat.service.js";
import type { ChatMessageView } from "../chat/chat.types.js";
import { EngagementSupportService } from "./engagement-support.service.js";
import type { LearningNotification } from "../core/learning.types.js";

export interface RealtimeConversation { id: string; cursor?: string }
export type RealtimePayload =
  | { channel: "chat"; key: string; cursor: string; value: ChatMessageView }
  | { channel: "notifications"; value: LearningNotification[] }
  | { channel: "operations"; value: { revision: number } }
  | { channel: "chat-list"; value: { revision: number } }
  | { channel: "error"; key: string };
export type RealtimeFrame = { data: RealtimePayload } | { comment: string };

/** Giới hạn số kênh và cursor trước khi tạo subscription/query; không nhận phạm vi người dùng từ client. */
export function parseRealtimeConversations(raw?: string): RealtimeConversation[] {
  if (raw === undefined) return [];
  if (typeof raw !== "string" || raw.length > 8192) throw new BadRequestException("Danh sách hội thoại không hợp lệ.");
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { throw new BadRequestException("Danh sách hội thoại không hợp lệ."); }
  if (!Array.isArray(parsed) || parsed.length > 16) throw new BadRequestException("Tối đa 16 hội thoại realtime mỗi tab.");
  const result: RealtimeConversation[] = [];
  const ids = new Set<string>();
  for (const item of parsed as unknown[]) {
    if (!item || typeof item !== "object") throw new BadRequestException("Hội thoại không hợp lệ.");
    const value = item as Record<string, unknown>;
    if (typeof value.id !== "string" || !/^[A-Za-z0-9_-]{1,191}$/.test(value.id) ||
      (value.cursor !== undefined && (typeof value.cursor !== "string" || !/^[A-Za-z0-9_-]{1,191}$/.test(value.cursor))) ||
      Object.keys(value).some((key) => key !== "id" && key !== "cursor") || ids.has(value.id))
      throw new BadRequestException("Hội thoại hoặc cursor không hợp lệ.");
    ids.add(value.id);
    result.push({ id: value.id, ...(typeof value.cursor === "string" ? { cursor: value.cursor } : {}) });
  }
  return result;
}

@Controller("realtime")
/** Ghép các kênh đã xác thực thành một HTTP SSE; không chia sẻ payload giữa các phiên. */
export class RealtimeController {
  /** Dùng lại kiểm quyền, cursor và snapshot của từng domain. */
  constructor(private readonly chat: ChatService, private readonly learning: EngagementSupportService,
    private readonly events: DatabaseEventsService) {}

  /** Cursor nằm trong từng subscription chat; client reconnect phải gửi lại toàn bộ cursor riêng, không dùng ID SSE toàn cục. */
  @Sse("events") @RequireAuthentication()
  watch(@CurrentSession() session: AuthenticatedSession, @Query("conversations") raw?: string,
    @Query("operations") operations?: string): Observable<RealtimeFrame> {
    const conversations = parseRealtimeConversations(raw);
    if (operations !== undefined && operations !== "true" && operations !== "false")
      throw new BadRequestException("Tham số operations không hợp lệ.");
    if (operations === "true" && !session.permissions.includes("system:configure")) throw new ForbiddenException();
    let listRevision = 0;
    const sources: Array<Observable<RealtimeFrame>> = [
      this.events.watchSnapshot("chat-list", session.user.id, () => Promise.resolve({ revision: ++listRevision })).pipe(
        filter((event) => "data" in event),
        map((event): RealtimeFrame => ({ data: { channel: "chat-list", value: event.data } })),
        catchError(() => of<RealtimeFrame>({ data: { channel: "error", key: "chat-list" } })),
      ),
      this.events.watchSnapshot("notification", session.user.id, () => this.learning.listNotifications(session.user.id)).pipe(
        filter((event) => "data" in event),
        map((event): RealtimeFrame => ({ data: { channel: "notifications", value: event.data } })),
        catchError(() => of<RealtimeFrame>({ data: { channel: "error", key: "notifications" } })),
      ),
      interval(5000).pipe(map((): RealtimeFrame => ({ comment: "heartbeat" }))),
    ];
    for (const conversation of conversations) sources.push(this.chat.watchMessages(conversation.id, session, conversation.cursor).pipe(
      filter((event) => "data" in event),
      map((event): RealtimeFrame => ({ data: { channel: "chat", key: conversation.id, cursor: event.id, value: event.data } })),
      catchError(() => of<RealtimeFrame>({ data: { channel: "error", key: conversation.id } })),
    ));
    if (operations === "true") {
      let revision = 0;
      sources.push(this.events.watchSnapshot("job", "operations", () => Promise.resolve({ revision: ++revision })).pipe(
        filter((event) => "data" in event),
        map((event): RealtimeFrame => ({ data: { channel: "operations", value: event.data } })),
        catchError(() => of<RealtimeFrame>({ data: { channel: "error", key: "operations" } })),
      ));
    }
    return merge(...sources);
  }
}
