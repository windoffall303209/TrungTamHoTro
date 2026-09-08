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

/** Xác định phím Enter nào gửi tin và giữ Shift+Enter cho thao tác xuống dòng. */
export function shouldSendChatMessage(
  key: string,
  shiftKey: boolean,
  isComposing: boolean,
): boolean {
  return key === "Enter" && !shiftKey && !isComposing;
}

/** Chọn định dạng ghi âm đầu tiên mà trình duyệt hiện tại có thể tạo. */
export function selectChatRecordingMimeType(
  supports: (mimeType: string) => boolean,
): string {
  return (
    [
      "audio/webm;codecs=opus",
      "audio/ogg;codecs=opus",
      "audio/mp4",
    ].find(supports) ?? ""
  );
}

/** Suy ra phần mở rộng an toàn cho tệp ghi âm từ MIME type. */
export function chatRecordingExtension(mimeType: string): string {
  if (mimeType.startsWith("audio/ogg")) return "ogg";
  if (mimeType.startsWith("audio/mp4")) return "m4a";
  return "webm";
}

/** Xác định tin nhắn có bắt đầu một cụm thời gian mới sau 30 phút hoặc sang ngày khác. */
export function shouldStartChatTimeGroup(
  createdAt: string,
  previousCreatedAt?: string,
): boolean {
  if (!previousCreatedAt) return true;
  const current = new Date(createdAt);
  const previous = new Date(previousCreatedAt);
  if (Number.isNaN(current.getTime()) || Number.isNaN(previous.getTime()))
    return true;
  return (
    current.toDateString() !== previous.toDateString() ||
    current.getTime() - previous.getTime() >= 30 * 60 * 1000
  );
}
