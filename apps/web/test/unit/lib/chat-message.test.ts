import { describe, expect, it } from "vitest";
import {
  chatRecordingExtension,
  normalizeChatMessage,
  selectChatRecordingMimeType,
  shouldSendChatMessage,
  shouldStartChatTimeGroup,
} from "../../../src/lib/chat-message";

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

describe("shouldSendChatMessage", () => {
  it("gửi bằng Enter nhưng giữ Shift+Enter để xuống dòng", () => {
    expect(shouldSendChatMessage("Enter", false, false)).toBe(true);
    expect(shouldSendChatMessage("Enter", true, false)).toBe(false);
  });

  it("không gửi khi bộ gõ đang ghép ký tự hoặc khi nhấn phím khác", () => {
    expect(shouldSendChatMessage("Enter", false, true)).toBe(false);
    expect(shouldSendChatMessage("Tab", false, false)).toBe(false);
  });
});

describe("chat recording format", () => {
  it("ưu tiên Opus WebM và dùng đúng phần mở rộng", () => {
    expect(selectChatRecordingMimeType((type) => type.includes("webm"))).toBe(
      "audio/webm;codecs=opus",
    );
    expect(chatRecordingExtension("audio/webm;codecs=opus")).toBe("webm");
  });

  it("hỗ trợ Ogg, MP4 và trình duyệt không công bố định dạng", () => {
    expect(selectChatRecordingMimeType((type) => type === "audio/mp4")).toBe(
      "audio/mp4",
    );
    expect(selectChatRecordingMimeType(() => false)).toBe("");
    expect(chatRecordingExtension("audio/ogg;codecs=opus")).toBe("ogg");
    expect(chatRecordingExtension("audio/mp4")).toBe("m4a");
  });
});

describe("shouldStartChatTimeGroup", () => {
  it("mở cụm đầu tiên và giữ các tin cách nhau dưới 30 phút", () => {
    expect(shouldStartChatTimeGroup("2026-09-06T10:00:00.000Z")).toBe(true);
    expect(
      shouldStartChatTimeGroup(
        "2026-09-06T10:29:59.999Z",
        "2026-09-06T10:00:00.000Z",
      ),
    ).toBe(false);
  });

  it("mở cụm mới đúng ngưỡng 30 phút và khi thời gian không hợp lệ", () => {
    expect(
      shouldStartChatTimeGroup(
        "2026-09-06T10:30:00.000Z",
        "2026-09-06T10:00:00.000Z",
      ),
    ).toBe(true);
    expect(shouldStartChatTimeGroup("không-hợp-lệ", "cũng-không")).toBe(true);
  });
});
