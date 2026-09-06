import type { ChatMessage } from "@/lib/learning-types";

/** Chuẩn hóa payload lịch sử và SSE để heartbeat hoặc phiên bản API cũ không làm sập màn hình. */
export function normalizeChatMessage(payload: unknown): ChatMessage | null {
  if (!payload || typeof payload !== "object") return null;
  const candidate = payload as Partial<ChatMessage> & { data?: unknown };
  const nested =
    candidate.data && typeof candidate.data === "object"
      ? (candidate.data as Partial<ChatMessage>)
      : candidate;
  if (
    typeof nested.id !== "string" ||
    typeof nested.conversationId !== "string"
  )
    return null;
  return {
    ...(nested as ChatMessage),
    attachments: Array.isArray(nested.attachments) ? nested.attachments : [],
    mentionedUserIds: Array.isArray(nested.mentionedUserIds)
      ? nested.mentionedUserIds
      : [],
  };
}
