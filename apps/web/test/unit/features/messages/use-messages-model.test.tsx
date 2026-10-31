import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatConversation, ChatDirectoryEntry, ChatMessage, ChatMessagePage } from "@/lib/learning-types";
import { useMessagesModel } from "../../../../src/features/messages/use-messages-model";

const mocks = vi.hoisted(() => ({ request: vi.fn(), notify: vi.fn() }));

vi.mock("@/lib/api-client", () => ({
  apiRequest: mocks.request,
  downloadApiFile: vi.fn(),
  previewApiFile: vi.fn(),
  publicApiUrl: (path: string) => path,
}));
vi.mock("@/providers/app-provider", () => ({
  useApp: () => ({
    session: { roleCode: "LEARNER", user: { id: "user-1" } },
    notify: mocks.notify,
  }),
}));
vi.mock("@/providers/i18n-provider", () => ({
  useI18n: () => ({ locale: "vi" }),
}));

const conversations = ["a", "b"].map((id) => ({
  id,
  type: "DIRECT",
  title: id,
  members: [],
  unreadCount: 0,
  readOnly: false,
  updatedAt: "2026-10-31T00:00:00Z",
})) satisfies ChatConversation[];

// Trì hoãn yêu cầu để chủ động kiểm tra phản hồi về sai thứ tự.
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((success, failure) => {
    resolve = success;
    reject = failure;
  });
  return { promise, resolve, reject };
}

// Tạo trang tin nhắn hợp lệ cho từng hội thoại trong các tình huống bất đồng bộ.
function messagePage(conversationId: string): ChatMessagePage {
  return {
    items: [{
      id: `message-${conversationId}`,
      conversationId,
      senderId: "user-2",
      senderName: "Người gửi",
      clientMessageId: `client-${conversationId}`,
      content: "Tin nhắn",
      attachments: [],
      mentionedUserIds: [],
      createdAt: "2026-10-31T00:00:00Z",
    }],
  };
}

// Giữ callback EventSource để mô phỏng tin nhắn tới sau khi đổi hội thoại.
class FakeEventSource {
  onmessage: ((event: MessageEvent<string>) => void) | null = null;
  closed = false;

  constructor(readonly url: string) {
    streams.push(this);
  }

  // Đánh dấu subscription đã đóng khi hook dọn dẹp effect.
  close() {
    this.closed = true;
  }

  // Phát sự kiện bằng callback đã đăng ký với ứng dụng.
  emit(data: unknown) {
    this.onmessage?.({ data: JSON.stringify(data) } as MessageEvent<string>);
  }
}

const streams: FakeEventSource[] = [];

describe("useMessagesModel asynchronous conversations", () => {
  let oldMessages: ReturnType<typeof deferred<ChatMessagePage>>;
  let pendingSend: ReturnType<typeof deferred<unknown>>;
  const pendingSearches: ReturnType<typeof deferred<ChatMessage[]>>[] = [];

  beforeEach(() => {
    streams.length = 0;
    pendingSearches.length = 0;
    oldMessages = deferred<ChatMessagePage>();
    pendingSend = deferred<unknown>();
    window.localStorage.removeItem("wind-chat-drafts:user-1");
    mocks.notify.mockReset();
    mocks.request.mockReset();
    vi.stubGlobal("EventSource", FakeEventSource);
    mocks.request.mockImplementation((path: string) => {
      if (path === "/chat/conversations") return Promise.resolve(conversations);
      if (path === "/chat/conversations/a/messages?limit=80") return oldMessages.promise;
      if (path === "/chat/conversations/b/messages?limit=80") return Promise.resolve(messagePage("b"));
      if (path === "/chat/conversations/a/messages") return pendingSend.promise;
      if (path.startsWith("/chat/conversations/a/search?")) {
        const pending = deferred<ChatMessage[]>();
        pendingSearches.push(pending);
        return pending.promise;
      }
      if (path.endsWith("/read")) return Promise.resolve({});
      throw new Error(`Unexpected API request: ${path}`);
    });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("giữ bản nháp đang gõ khi trình duyệt chặn ghi localStorage", async () => {
    const { result } = renderHook(() => useMessagesModel());
    await waitFor(() => expect(result.current.selectedId).toBe("a"));
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("Blocked", "SecurityError");
    });

    act(() => result.current.updateDraft("bản nháp trong bộ nhớ"));
    expect(result.current.draft).toBe("bản nháp trong bộ nhớ");
  });

  it("giữ tin nhắn hội thoại mới khi phản hồi hội thoại cũ tới muộn", async () => {
    const { result } = renderHook(() => useMessagesModel());
    await waitFor(() => expect(mocks.request).toHaveBeenCalledWith(
      "/chat/conversations/a/messages?limit=80", expect.anything(),
    ));
    act(() => result.current.setSelectedId("b"));
    await waitFor(() => expect(result.current.messages[0]?.id).toBe("message-b"));

    await act(async () => oldMessages.resolve(messagePage("a")));
    expect(result.current.selectedId).toBe("b");
    expect(result.current.messages[0]?.id).toBe("message-b");
    expect(mocks.request).not.toHaveBeenCalledWith(
      "/chat/conversations/a/read", expect.anything(),
    );
  });

  it("không hiện lỗi từ yêu cầu hội thoại đã rời", async () => {
    const { result } = renderHook(() => useMessagesModel());
    await waitFor(() => expect(mocks.request).toHaveBeenCalledWith(
      "/chat/conversations/a/messages?limit=80", expect.anything(),
    ));
    act(() => result.current.setSelectedId("b"));
    await waitFor(() => expect(result.current.messages[0]?.id).toBe("message-b"));

    await act(async () => oldMessages.reject(new Error("Old conversation failed")));
    expect(mocks.notify).not.toHaveBeenCalled();
  });

  it("xóa kết quả tìm kiếm cũ và bỏ qua phản hồi đến sau khi chuyển hội thoại", async () => {
    const { result } = renderHook(() => useMessagesModel());
    await waitFor(() => expect(result.current.selectedId).toBe("a"));
    act(() => result.current.setMessageQuery("first"));
    act(() => { void result.current.searchConversation({ preventDefault: vi.fn() } as unknown as React.FormEvent); });
    await waitFor(() => expect(pendingSearches).toHaveLength(1));
    await act(async () => pendingSearches[0]!.resolve(messagePage("a").items));
    expect(result.current.searchResults[0]?.id).toBe("message-a");

    act(() => result.current.setMessageQuery("second"));
    act(() => { void result.current.searchConversation({ preventDefault: vi.fn() } as unknown as React.FormEvent); });
    await waitFor(() => expect(pendingSearches).toHaveLength(2));
    act(() => result.current.setSelectedId("b"));
    await waitFor(() => expect(result.current.messages[0]?.id).toBe("message-b"));
    expect(result.current.searchResults).toEqual([]);

    await act(async () => pendingSearches[1]!.resolve(messagePage("a").items));
    expect(result.current.searchResults).toEqual([]);
    expect(mocks.notify).not.toHaveBeenCalled();
  });

  it("không xóa bản nháp và nội dung đang soạn ở hội thoại khác khi gửi tin cũ hoàn tất", async () => {
    const { result } = renderHook(() => useMessagesModel());
    await waitFor(() => expect(result.current.selectedId).toBe("a"));
    act(() => result.current.updateDraft("nội dung A"));
    let submission!: Promise<void>;
    act(() => { submission = result.current.sendMessage(); });
    await waitFor(() => expect(mocks.request).toHaveBeenCalledWith(
      "/chat/conversations/a/messages", expect.objectContaining({ method: "POST" }),
    ));

    act(() => result.current.setSelectedId("b"));
    await waitFor(() => expect(result.current.messages[0]?.id).toBe("message-b"));
    act(() => result.current.updateDraft("nội dung B"));
    act(() => result.current.setReplyTo(messagePage("b").items[0]!));

    await act(async () => {
      pendingSend.resolve({});
      oldMessages.resolve(messagePage("a"));
      await submission;
    });

    expect(result.current.draft).toBe("nội dung B");
    expect(result.current.replyTo?.id).toBe("message-b");
    expect(JSON.parse(window.localStorage.getItem("wind-chat-drafts:user-1")!)).toMatchObject({
      a: "",
      b: "nội dung B",
    });
  });

  it("bỏ qua sự kiện từ subscription đã đóng và thông báo lỗi đánh dấu đã đọc", async () => {
    const { result } = renderHook(() => useMessagesModel());
    await waitFor(() => expect(streams.length).toBe(1));
    const staleStream = streams[0]!;
    act(() => result.current.setSelectedId("b"));
    await waitFor(() => expect(result.current.messages[0]?.id).toBe("message-b"));
    expect(staleStream.closed).toBe(true);

    act(() => staleStream.emit({ id: "stale-event", conversationId: "a" }));
    expect(result.current.messages.map((item) => item.id)).toEqual(["message-b"]);

    const readError = new Error("Không thể ghi trạng thái đã đọc");
    mocks.request.mockImplementation((path: string) => {
      if (path === "/chat/conversations") return Promise.resolve(conversations);
      if (path === "/chat/conversations/b/read") return Promise.reject(readError);
      throw new Error(`Unexpected API request: ${path}`);
    });
    const activeStream = streams.at(-1)!;
    await act(async () => activeStream.emit({ id: "live-event", conversationId: "b" }));
    expect(result.current.messages.map((item) => item.id)).toEqual(["message-b", "live-event"]);
    expect(mocks.notify).toHaveBeenCalledWith(readError.message, "error");
  });

  it("không làm mất tin SSE đến trước phản hồi tải lịch sử", async () => {
    const { result } = renderHook(() => useMessagesModel());
    await waitFor(() => expect(mocks.request).toHaveBeenCalledWith(
      "/chat/conversations/a/messages?limit=80", expect.anything(),
    ));
    const live = { ...messagePage("a").items[0]!, id: "live-a" };
    await act(async () => streams[0]!.emit(live));
    expect(result.current.messages.map((item) => item.id)).toEqual(["live-a"]);

    await act(async () => oldMessages.resolve(messagePage("a")));
    expect(result.current.messages.map((item) => item.id)).toEqual(["message-a", "live-a"]);
  });

  it("giữ nội dung và tin trả lời mới được nhập trong lúc gửi tin", async () => {
    const { result } = renderHook(() => useMessagesModel());
    await waitFor(() => expect(result.current.selectedId).toBe("a"));
    act(() => {
      result.current.updateDraft("nội dung lúc gửi");
      result.current.setReplyTo(messagePage("a").items[0]!);
    });
    let submission!: Promise<void>;
    act(() => { submission = result.current.sendMessage(); });
    await waitFor(() => expect(mocks.request).toHaveBeenCalledWith(
      "/chat/conversations/a/messages", expect.objectContaining({ method: "POST" }),
    ));
    act(() => {
      result.current.updateDraft("bản nháp tiếp theo");
      result.current.setReplyTo({ ...messagePage("a").items[0]!, id: "new-reply" });
    });
    await act(async () => {
      pendingSend.resolve({});
      oldMessages.resolve(messagePage("a"));
      await submission;
    });
    expect(result.current.draft).toBe("bản nháp tiếp theo");
    expect(result.current.replyTo?.id).toBe("new-reply");
    expect(JSON.parse(window.localStorage.getItem("wind-chat-drafts:user-1")!).a).toBe("bản nháp tiếp theo");
  });

  it("không ghi đè kết quả tìm kiếm mới bằng kết quả cùng hội thoại đến muộn", async () => {
    const { result } = renderHook(() => useMessagesModel());
    await waitFor(() => expect(result.current.selectedId).toBe("a"));
    act(() => result.current.setMessageQuery("slow"));
    act(() => { void result.current.searchConversation({ preventDefault: vi.fn() } as unknown as React.FormEvent); });
    await waitFor(() => expect(pendingSearches).toHaveLength(1));
    act(() => result.current.setMessageQuery("fast"));
    act(() => { void result.current.searchConversation({ preventDefault: vi.fn() } as unknown as React.FormEvent); });
    await waitFor(() => expect(pendingSearches).toHaveLength(2));

    await act(async () => pendingSearches[1]!.resolve([{ ...messagePage("a").items[0]!, id: "fast-result" }]));
    await act(async () => pendingSearches[0]!.resolve([{ ...messagePage("a").items[0]!, id: "slow-result" }]));
    expect(result.current.searchResults.map((item) => item.id)).toEqual(["fast-result"]);
  });

  it("không ghi đè danh bạ mới bằng kết quả tìm người dùng đến muộn", async () => {
    const older = deferred<ChatDirectoryEntry[]>();
    const newer = deferred<ChatDirectoryEntry[]>();
    mocks.request.mockImplementation((path: string) => {
      if (path === "/chat/conversations") return Promise.resolve(conversations);
      if (path === "/chat/conversations/a/messages?limit=80") return oldMessages.promise;
      if (path === "/chat/directory?q=older") return older.promise;
      if (path === "/chat/directory?q=newer") return newer.promise;
      if (path.endsWith("/read")) return Promise.resolve({});
      throw new Error(`Unexpected API request: ${path}`);
    });
    const { result } = renderHook(() => useMessagesModel());
    await waitFor(() => expect(result.current.selectedId).toBe("a"));
    act(() => result.current.setQuery("older"));
    act(() => { void result.current.searchDirectory({ preventDefault: vi.fn() } as unknown as React.FormEvent); });
    act(() => result.current.setQuery("newer"));
    act(() => { void result.current.searchDirectory({ preventDefault: vi.fn() } as unknown as React.FormEvent); });

    await act(async () => newer.resolve([{
      id: "newer-user", displayName: "Người mới", roleCode: "LEARNER", sharedClasses: [],
    }]));
    await act(async () => older.resolve([{
      id: "older-user", displayName: "Người cũ", roleCode: "LEARNER", sharedClasses: [],
    }]));
    expect(result.current.directory.map((user) => user.id)).toEqual(["newer-user"]);
  });

  it("giải phóng micro khi quyền ghi âm được cấp sau lúc component đã đóng", async () => {
    const previousMediaDevices = Object.getOwnPropertyDescriptor(navigator, "mediaDevices");
    const microphone = deferred<MediaStream>();
    const stop = vi.fn();
    const stream = { getTracks: () => [{ stop }] } as unknown as MediaStream;
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: vi.fn().mockReturnValue(microphone.promise) },
    });
    vi.stubGlobal("MediaRecorder", class {
      // Tắt chọn MIME để mô phỏng trình ghi âm tối giản.
      static isTypeSupported() { return false; }
      state = "inactive";
      mimeType = "audio/webm";
      // Bật trạng thái ghi âm giả lập.
      start() { this.state = "recording"; }
      // Tắt trạng thái ghi âm giả lập.
      stop() { this.state = "inactive"; }
    });
    try {
      const { result, unmount } = renderHook(() => useMessagesModel());
      await waitFor(() => expect(result.current.selectedId).toBe("a"));
      let request!: Promise<void>;
      act(() => { request = result.current.toggleRecording(); });
      unmount();
      await act(async () => {
        microphone.resolve(stream);
        await request;
      });
      expect(stop).toHaveBeenCalledOnce();
    } finally {
      if (previousMediaDevices)
        Object.defineProperty(navigator, "mediaDevices", previousMediaDevices);
      else Reflect.deleteProperty(navigator, "mediaDevices");
    }
  });

  it("giải phóng micro khi trình ghi âm không khởi tạo được", async () => {
    const previousMediaDevices = Object.getOwnPropertyDescriptor(navigator, "mediaDevices");
    const stop = vi.fn();
    const stream = { getTracks: () => [{ stop }] } as unknown as MediaStream;
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: vi.fn().mockResolvedValue(stream) },
    });
    vi.stubGlobal("MediaRecorder", class {
      // Tắt chọn MIME trước khi mô phỏng lỗi khởi tạo.
      static isTypeSupported() { return false; }
      constructor() { throw new Error("Thiết bị ghi âm lỗi"); }
    });
    try {
      const { result } = renderHook(() => useMessagesModel());
      await waitFor(() => expect(result.current.selectedId).toBe("a"));
      await act(async () => result.current.toggleRecording());
      expect(stop).toHaveBeenCalledOnce();
      expect(result.current.recording).toBe(false);
      expect(mocks.notify).toHaveBeenCalledWith(expect.stringContaining("Không mở được micro"), "error");
    } finally {
      if (previousMediaDevices)
        Object.defineProperty(navigator, "mediaDevices", previousMediaDevices);
      else Reflect.deleteProperty(navigator, "mediaDevices");
    }
  });

  it("chỉ giữ yêu cầu micro mới nhất khi cấp quyền khác thứ tự", async () => {
    const previousMediaDevices = Object.getOwnPropertyDescriptor(navigator, "mediaDevices");
    const first = deferred<MediaStream>();
    const second = deferred<MediaStream>();
    const firstStop = vi.fn();
    const secondStop = vi.fn();
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: vi.fn()
        .mockReturnValueOnce(first.promise)
        .mockReturnValueOnce(second.promise) },
    });
    vi.stubGlobal("MediaRecorder", class {
      // Tắt chọn MIME để mô phỏng hai yêu cầu đồng thời.
      static isTypeSupported() { return false; }
      state = "inactive";
      mimeType = "audio/webm";
      // Bật trạng thái ghi âm khi cấp quyền thành công.
      start() { this.state = "recording"; }
      // Tắt trạng thái ghi âm khi giải phóng micro.
      stop() { this.state = "inactive"; }
    });
    try {
      const { result, unmount } = renderHook(() => useMessagesModel());
      await waitFor(() => expect(result.current.selectedId).toBe("a"));
      let oldRequest!: Promise<void>;
      let newRequest!: Promise<void>;
      act(() => {
        oldRequest = result.current.toggleRecording();
        newRequest = result.current.toggleRecording();
      });
      await act(async () => {
        second.resolve({ getTracks: () => [{ stop: secondStop }] } as unknown as MediaStream);
        await newRequest;
      });
      await act(async () => {
        first.resolve({ getTracks: () => [{ stop: firstStop }] } as unknown as MediaStream);
        await oldRequest;
      });
      expect(firstStop).toHaveBeenCalledOnce();
      expect(secondStop).not.toHaveBeenCalled();
      expect(result.current.recording).toBe(true);
      unmount();
      expect(secondStop).toHaveBeenCalledOnce();
    } finally {
      if (previousMediaDevices)
        Object.defineProperty(navigator, "mediaDevices", previousMediaDevices);
      else Reflect.deleteProperty(navigator, "mediaDevices");
    }
  });

  it("chỉ chấp nhận phản hồi mới nhất khi đồng bộ danh sách hội thoại", async () => {
    const { result } = renderHook(() => useMessagesModel());
    await waitFor(() => expect(streams.length).toBe(1));
    const first = deferred<ChatConversation[]>();
    const second = deferred<ChatConversation[]>();
    let calls = 0;
    mocks.request.mockImplementation((path: string) => {
      if (path === "/chat/conversations") return ++calls === 1 ? first.promise : second.promise;
      if (path.endsWith("/read")) return Promise.resolve({});
      throw new Error(`Unexpected API request: ${path}`);
    });
    const live = messagePage("a").items[0]!;
    await act(async () => {
      streams[0]!.emit({ ...live, id: "first-live" });
      streams[0]!.emit({ ...live, id: "second-live" });
    });
    await act(async () => second.resolve([conversations[1]!, conversations[0]!]));
    await act(async () => first.resolve([conversations[0]!]));
    expect(result.current.conversations.map((item) => item.id)).toEqual(["b", "a"]);
  });
});
