import { describe, expect, it } from "vitest";
import { normalizeChatMessage } from "./chat-message";

describe("normalizeChatMessage", () => {
  it("bổ sung các mảng còn thiếu trong payload SSE", () => {
    const message = normalizeChatMessage({
      id: "message-1",
      conversationId: "conversation-1",
      senderId: "user-1",
      senderName: "Người gửi",
      clientMessageId: "client-1",
      content: "Xin chào",
      createdAt: "2026-09-06T00:00:00.000Z",
    });

    expect(message?.attachments).toEqual([]);
    expect(message?.mentionedUserIds).toEqual([]);
  });

  it("đọc payload data lồng và bỏ heartbeat không phải tin nhắn", () => {
    expect(
      normalizeChatMessage({
        data: { id: "message-2", conversationId: "conversation-1" },
      }),
    ).toMatchObject({ id: "message-2", attachments: [] });
    expect(normalizeChatMessage({ type: "heartbeat" })).toBeNull();
  });
});
