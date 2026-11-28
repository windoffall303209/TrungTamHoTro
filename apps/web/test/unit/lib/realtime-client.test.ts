import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RealtimeClient } from "../../../src/lib/realtime-client";

vi.mock("../../../src/lib/api-client", () => ({ publicApiUrl: (path: string) => path }));

/** Mô phỏng callback socket, kể cả callback đã xếp hàng sau khi đóng. */
class Source {
  onopen?: () => void;
  onmessage?: (event: { data: string }) => void;
  onerror?: () => void;
  close = vi.fn();
  /** Phát envelope như EventSource của trình duyệt. */
  send(value: unknown) { this.onmessage?.({ data: JSON.stringify(value) }); }
}

const scope = { sessionId: "session-a", userId: "user-a", roleCode: "LEARNER" };
/** Tạo payload chat có cursor khớp message để kiểm tra reconnect. */
function message(id: string, key = "conversation-a") {
  return { channel: "chat", key, cursor: id, value: { id, conversationId: key } };
}

describe("RealtimeClient", () => {
  let client: RealtimeClient;
  let sources: Source[];
  let urls: string[];
  beforeEach(() => {
    vi.useFakeTimers();
    sources = [];
    urls = [];
    client = new RealtimeClient((url) => {
      const source = new Source();
      sources.push(source);
      urls.push(url);
      return source as unknown as EventSource;
    });
    client.setSession(scope);
  });
  afterEach(() => { client.setSession(); vi.restoreAllMocks(); vi.useRealTimers(); });

  it("stops reconnect attempts offline, retains cursors online and removes listeners on logout", () => {
    const online = vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
    client.subscribe(scope, { channel: "chat", key: "conversation-a" }, { next: vi.fn() });
    vi.advanceTimersByTime(25);
    sources[0]!.send(message("last-seen"));
    sources[0]!.onerror?.();
    online.mockReturnValue(false);
    window.dispatchEvent(new Event("offline"));
    vi.advanceTimersByTime(60000);
    expect(sources).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
    // Đăng ký thêm khi offline không được tạo timer thử lại.
    client.subscribe(scope, { channel: "notifications" }, { next: vi.fn() });
    expect(vi.getTimerCount()).toBe(0);
    online.mockReturnValue(true);
    window.dispatchEvent(new Event("online"));
    vi.advanceTimersByTime(0);
    expect(sources).toHaveLength(2);
    expect(urls[1]).toContain("last-seen");
    client.setSession();
    window.dispatchEvent(new Event("online"));
    vi.advanceTimersByTime(60000);
    expect(sources).toHaveLength(2);
    expect(sources[1]!.close).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("shares one socket for repeated topics and closes only after the last subscriber", () => {
    const first = vi.fn();
    const second = vi.fn();
    const off = client.subscribe(scope, { channel: "chat", key: "conversation-a" }, { next: first });
    vi.advanceTimersByTime(25);
    const offSecond = client.subscribe(scope, { channel: "chat", key: "conversation-a" }, { next: second });
    vi.advanceTimersByTime(60000);
    expect(sources).toHaveLength(1);
    sources[0]!.send(message("m1"));
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
    off();
    expect(sources[0]!.close).not.toHaveBeenCalled();
    offSecond();
    expect(sources[0]!.close).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("reconnects with independent conversation cursors and rejects stale callbacks and duplicates", () => {
    const next = vi.fn();
    client.subscribe(scope, { channel: "chat", key: "conversation-a" }, { next });
    client.subscribe(scope, { channel: "chat", key: "conversation-b" }, { next });
    vi.advanceTimersByTime(25);
    sources[0]!.send(message("m1"));
    sources[0]!.send(message("m2", "conversation-b"));
    sources[0]!.onerror?.();
    sources[0]!.send(message("stale"));
    vi.advanceTimersByTime(500);
    expect(sources[0]!.close).toHaveBeenCalledOnce();
    const query = new URL(urls[1]!, "http://localhost").searchParams;
    expect(JSON.parse(query.get("conversations")!)).toEqual([
      { id: "conversation-a", cursor: "m1" }, { id: "conversation-b", cursor: "m2" },
    ]);
    sources[1]!.send(message("m1"));
    sources[1]!.send(message("m3"));
    expect(next).toHaveBeenCalledTimes(3);
  });

  it("isolates accounts and clears cursors on session changes", () => {
    const old = vi.fn();
    client.subscribe(scope, { channel: "chat", key: "conversation-a" }, { next: old });
    vi.advanceTimersByTime(25);
    sources[0]!.send(message("private"));
    const other = { ...scope, sessionId: "session-b", userId: "user-b" };
    client.setSession(other);
    const next = vi.fn();
    client.subscribe(other, { channel: "chat", key: "conversation-a" }, { next });
    vi.advanceTimersByTime(25);
    expect(urls[1]!).not.toContain("private");
    sources[0]!.send(message("late"));
    sources[1]!.send(message("new"));
    expect(old).toHaveBeenCalledOnce();
    expect(next).toHaveBeenCalledOnce();
    client.setSession();
    sources[1]!.send(message("logout"));
    expect(next).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("routes notifications and operations and rejects malformed or foreign payloads", () => {
    const notifications = vi.fn();
    const operations = vi.fn();
    client.subscribe(scope, { channel: "notifications" }, { next: notifications });
    client.subscribe(scope, { channel: "operations" }, { next: operations });
    vi.advanceTimersByTime(25);
    expect(new URL(urls[0]!, "http://localhost").searchParams.get("operations")).toBe("true");
    sources[0]!.onmessage?.({ data: "invalid" });
    sources[0]!.send({ channel: "notifications", value: [{ id: "n1", recipientId: "other" }] });
    sources[0]!.send({ channel: "notifications", value: [{ id: "n2", recipientId: scope.userId }] });
    sources[0]!.send({ channel: "operations", value: { revision: 2 } });
    expect(notifications).toHaveBeenCalledOnce();
    expect(operations).toHaveBeenCalledWith({ revision: 2 });
  });

  it("batches topology changes and cancels pending reconnect on cleanup", () => {
    const off = client.subscribe(scope, { channel: "notifications" }, { next: vi.fn() });
    const offChat = client.subscribe(scope, { channel: "chat", key: "conversation-a" }, { next: vi.fn() });
    vi.advanceTimersByTime(25);
    expect(sources).toHaveLength(1);
    sources[0]!.onerror?.();
    offChat();
    off();
    vi.advanceTimersByTime(60000);
    expect(sources).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("routes chat-list invalidation separately from job updates", () => {
    const list = vi.fn();
    const jobs = vi.fn();
    client.subscribe(scope, { channel: "chat-list" }, { next: list });
    client.subscribe(scope, { channel: "operations" }, { next: jobs });
    vi.advanceTimersByTime(25);
    sources[0]!.send({ channel: "chat-list", value: { revision: 1 } });
    expect(list).toHaveBeenCalledWith({ revision: 1 });
    expect(jobs).not.toHaveBeenCalled();
    expect(sources).toHaveLength(1);
  });
});
