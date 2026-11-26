import type { ConfigService } from "@nestjs/config";
import { Subject } from "rxjs";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Environment } from "../../src/config/environment.js";
import type { AuthenticatedSession } from "../../src/auth/auth.service.js";
import { DatabaseEventsService, type DatabaseEvent } from "../../src/database/database-events.service.js";
import type { ChatService } from "../../src/domains/learning/chat/chat.service.js";
import type { ChatMessageView, ChatStreamEvent } from "../../src/domains/learning/chat/chat.types.js";
import type { EngagementSupportService } from "../../src/domains/learning/engagement/engagement-support.service.js";
import { RealtimeController, parseRealtimeConversations, type RealtimeFrame } from "../../src/domains/learning/engagement/realtime.controller.js";

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe("realtime multiplex", () => {
  it.each(["invalid", "{}", "[null]", '[{"id":""}]', '[{"id":"a","cursor":3}]',
    '[{"id":"a","userId":"other"}]', '[{"id":"a"},{"id":"a"}]', JSON.stringify(Array.from({ length: 17 }, (_, i) => ({ id: String(i) }))), "x".repeat(8193)])("rejects malformed or oversized subscriptions %s", (raw) => {
    expect(() => parseRealtimeConversations(raw)).toThrow();
  });

  it("accepts bounded subscriptions and does not trust a client recipient", () => {
    expect(parseRealtimeConversations()).toEqual([]);
    expect(parseRealtimeConversations('[{"id":"c1","cursor":"m1"}]')).toEqual([{ id: "c1", cursor: "m1" }]);
    expect(parseRealtimeConversations(JSON.stringify(Array.from({ length: 16 }, (_, i) => ({ id: String(i) }))))).toHaveLength(16);
  });

  it("requires system permission before adding the operations channel", () => {
    const controller = new RealtimeController({} as ChatService, {} as EngagementSupportService, {} as DatabaseEventsService);
    const session = { user: { id: "user" }, permissions: [] } as unknown as AuthenticatedSession;
    expect(() => controller.watch(session, "[]", "true")).toThrow(expect.objectContaining({ status: 403 }));
    expect(() => controller.watch(session, "[]", "bad")).toThrow(expect.objectContaining({ status: 400 }));
  });

  it("keeps cursors per conversation, isolates channel errors and disposes every subscription", async () => {
    vi.useFakeTimers();
    const signals = new Subject<DatabaseEvent>();
    const bus = new DatabaseEventsService({} as ConfigService<Environment, true>);
    vi.spyOn(bus, "watch").mockReturnValue(signals.asObservable());
    const first = new Subject<ChatStreamEvent>();
    const second = new Subject<ChatStreamEvent>();
    const watchMessages = vi.fn((id: string) => id === "c1" ? first : second);
    const listNotifications = vi.fn().mockResolvedValue([]);
    const controller = new RealtimeController({ watchMessages } as unknown as ChatService, { listNotifications } as unknown as EngagementSupportService, bus);
    const session = { user: { id: "user" }, permissions: ["system:configure"] } as AuthenticatedSession;
    const frames: RealtimeFrame[] = [];
    const subscription = controller.watch(session, '[{"id":"c1","cursor":"m1"},{"id":"c2","cursor":"m2"}]', "true")
      .subscribe((frame) => frames.push(frame));
    try {
      await vi.advanceTimersByTimeAsync(0);
      expect(listNotifications).toHaveBeenCalledExactlyOnceWith("user");
      expect(frames).toContainEqual({ data: { channel: "chat-list", value: { revision: 1 } } });
      signals.next({ kind: "chat-list", key: "other-user" });
      await vi.advanceTimersByTimeAsync(0);
      expect(frames.filter((frame) => "data" in frame && frame.data.channel === "chat-list")).toHaveLength(1);
      signals.next({ kind: "chat-list", key: "user" });
      await vi.advanceTimersByTimeAsync(0);
      expect(frames).toContainEqual({ data: { channel: "chat-list", value: { revision: 2 } } });
      expect(watchMessages).toHaveBeenCalledWith("c1", session, "m1");
      expect(watchMessages).toHaveBeenCalledWith("c2", session, "m2");
      first.next({ id: "next1", data: { id: "next1" } as ChatMessageView });
      second.error(new Error("private database detail"));
      first.next({ id: "next2", data: { id: "next2" } as ChatMessageView });
      first.next({ comment: "local heartbeat" });
      await vi.advanceTimersByTimeAsync(5000);
      expect(frames).toContainEqual({ data: { channel: "chat", key: "c1", cursor: "next2", value: { id: "next2" } } });
      expect(frames).toContainEqual({ data: { channel: "error", key: "c2" } });
      expect(JSON.stringify(frames)).not.toContain("private database detail");
      expect(frames.filter((frame) => "comment" in frame)).toEqual([{ comment: "heartbeat" }]);
      expect(listNotifications).toHaveBeenCalledTimes(1);
    } finally { subscription.unsubscribe(); }
    expect(first.observed).toBe(false);
    expect(signals.observed).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });
});
