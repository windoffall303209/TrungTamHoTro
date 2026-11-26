import { Controller, Sse, type INestApplication } from "@nestjs/common";
import type { ConfigService } from "@nestjs/config";
import { Test } from "@nestjs/testing";
import { Subject, type Observable } from "rxjs";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import type { Environment } from "../../src/config/environment.js";
import type { AuthenticatedSession } from "../../src/auth/auth.service.js";
import { ResponseInterceptor } from "../../src/common/response.interceptor.js";
import { DatabaseEventsService, type DatabaseEvent } from "../../src/database/database-events.service.js";
import type { ChatService } from "../../src/domains/learning/chat/chat.service.js";
import type { ChatStreamEvent } from "../../src/domains/learning/chat/chat.types.js";
import type { EngagementSupportService } from "../../src/domains/learning/engagement/engagement-support.service.js";
import { RealtimeController, type RealtimeFrame } from "../../src/domains/learning/engagement/realtime.controller.js";

let controller: RealtimeController;
@Controller()
class HttpFixture {
  /** Dùng controller multiplex thật; phiên fixture thay auth, không kiểm quyền HTTP trong test transport này. */
  @Sse("events") events(): Observable<RealtimeFrame> {
    return controller.watch({ user: { id: "reader" }, permissions: ["system:configure"] } as AuthenticatedSession,
      '[{"id":"one","cursor":"previous-one"},{"id":"two","cursor":"previous-two"}]', "true");
  }
}

let app: INestApplication;
const signals = new Subject<DatabaseEvent>();
const one = new Subject<ChatStreamEvent>();
const two = new Subject<ChatStreamEvent>();
const notifications = vi.fn().mockResolvedValue([]);
const watchMessages = vi.fn((id: string) => id === "one" ? one : two);

// Khởi chạy HTTP thật trên cổng ngẫu nhiên; bus input và dữ liệu được điều khiển để kiểm transport.
beforeAll(async () => {
  const bus = new DatabaseEventsService({} as ConfigService<Environment, true>);
  vi.spyOn(bus, "watch").mockReturnValue(signals.asObservable());
  controller = new RealtimeController({ watchMessages } as unknown as ChatService,
    { listNotifications: notifications } as unknown as EngagementSupportService, bus);
  const module = await Test.createTestingModule({ controllers: [HttpFixture] }).compile();
  app = module.createNestApplication();
  app.useGlobalInterceptors(new ResponseInterceptor());
  await app.listen(0, "127.0.0.1");
});

// Đóng listener và khôi phục spy sau khi kiểm transport.
afterAll(async () => { await app?.close(); vi.restoreAllMocks(); });

it("carries multiple channels on one HTTP response and tears them all down on disconnect", async () => {
  const abort = new AbortController();
  const deadline = setTimeout(() => abort.abort(), 12000);
  try {
    const response = await fetch(`${await app.getUrl()}/events`, { signal: abort.signal });
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(watchMessages).toHaveBeenCalledWith("one", expect.any(Object), "previous-one");
    expect(watchMessages).toHaveBeenCalledWith("two", expect.any(Object), "previous-two");
    // Lỗi một hội thoại vẫn giữ notification, list, operations và hội thoại còn lại.
    two.error(new Error("private detail"));
    signals.next({ kind: "chat-list", key: "reader" });
    signals.next({ kind: "job", key: "operations" });
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let wire = "";
    while (!wire.includes(": heartbeat")) {
      const chunk = await reader.read();
      if (chunk.done) throw new Error("Premature stream end");
      wire += decoder.decode(chunk.value, { stream: true });
    }
    const frames = wire.replace(/\r/g, "").split("\n\n");
    const data = frames.flatMap((frame) => frame.split("\n").filter((line) => line.startsWith("data: ")).map((line) => JSON.parse(line.slice(6)) as { channel: string; key?: string }));
    expect(data.map((item) => item.channel)).toEqual(expect.arrayContaining(["notifications", "chat-list", "operations", "error"]));
    expect(data).toContainEqual({ channel: "error", key: "two" });
    expect(wire).not.toContain("private detail");
    expect(notifications).toHaveBeenCalledTimes(1);
    expect(frames.filter((frame) => frame.includes(": heartbeat")).every((frame) => !frame.includes("data:") && !frame.includes("id:"))).toBe(true);
    abort.abort();
    await reader.cancel().catch(() => undefined);
    await vi.waitFor(() => { expect(one.observed).toBe(false); expect(signals.observed).toBe(false); });
  } finally { clearTimeout(deadline); abort.abort(); }
}, 15000);
