import { Controller, Headers, Sse, type INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { Subject, type Observable } from "rxjs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { AuthenticatedSession } from "../../src/auth/auth.service.js";
import { ResponseInterceptor } from "../../src/common/response.interceptor.js";
import { DatabaseEventsService, type DatabaseEvent } from "../../src/database/database-events.service.js";
import type { PrismaService } from "../../src/database/prisma.service.js";
import { ChatService } from "../../src/domains/learning/chat/chat.service.js";
import type { ChatMessageView, ChatStreamEvent } from "../../src/domains/learning/chat/chat.types.js";
import type { AntivirusService } from "../../src/infrastructure/antivirus.service.js";
import type { ObjectStorageService } from "../../src/infrastructure/object-storage.service.js";

let service: ChatService;
const session = { user: { id: "reader" } } as AuthenticatedSession;

@Controller()
class StreamFixtureController {
  /** Dùng transport SSE thật của Nest với stream chat; quyền/DB được kiểm ở integration suite riêng. */
  @Sse("events") events(@Headers("last-event-id") lastId?: string): Observable<ChatStreamEvent> {
    return service.watchMessages("conversation", session, lastId);
  }
}

describe("chat heartbeat HTTP transport", () => {
  let app: INestApplication;
  let url: string;
  const signals = new Subject<DatabaseEvent>();
  const findMany = vi.fn().mockResolvedValue([]);
  const findFirst = vi.fn().mockResolvedValue({ streamSequence: 1n });
  const startCursor = vi.fn().mockResolvedValue([{ sequence: 0n }]);

  // Mở HTTP listener cổng ngẫu nhiên với serializer/interceptor production và DB boundary giả lập.
  beforeAll(async () => {
    const prisma = { chatMessage: { findMany, findFirst }, $queryRaw: startCursor,
      chatConversationMember: { findUnique: vi.fn().mockResolvedValue({ status: "ACTIVE" }) } } as unknown as PrismaService;
    service = new ChatService(prisma, {} as ObjectStorageService, {} as AntivirusService,
      { watch: () => signals.asObservable() } as DatabaseEventsService);
    const message: ChatMessageView = { id: "message-real", conversationId: "conversation", senderId: "sender", senderName: "Sender",
      clientMessageId: "client", content: "Hi", attachments: [], mentionedUserIds: [], createdAt: new Date().toISOString() };
    findMany.mockResolvedValueOnce([{ ...message, streamSequence: 1n }]);
    vi.spyOn(service as unknown as { mapMessageForActor: () => Promise<ChatMessageView> }, "mapMessageForActor").mockResolvedValue(message);
    const moduleRef = await Test.createTestingModule({ controllers: [StreamFixtureController] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalInterceptors(new ResponseInterceptor());
    await app.listen(0, "127.0.0.1");
    url = await app.getUrl();
  });

  // Đóng HTTP server và khôi phục mock để không để lại socket/test state.
  afterAll(async () => { await app?.close(); signals.complete(); vi.restoreAllMocks(); });

  it("sends comment heartbeats without IDs or DB polling and preserves reconnect cursor", async () => {
    const abort = new AbortController();
    const deadline = setTimeout(() => abort.abort(), 12000);
    try {
      const response = await fetch(`${url}/events`, { signal: abort.signal, headers: { Accept: "text/event-stream" } });
      expect(response.headers.get("content-type")).toContain("text/event-stream");
      expect(response.headers.get("x-accel-buffering")).toBe("no");
      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let wire = "";
      while ((wire.match(/: heartbeat/g) ?? []).length < 2 || !wire.includes("id: message-real")) {
        const chunk = await reader.read();
        if (chunk.done) throw new Error("SSE ended before heartbeat/message");
        wire += decoder.decode(chunk.value, { stream: true });
      }
      const frames = wire.replace(/\r/g, "").split("\n\n");
      const heartbeats = frames.filter((frame) => frame.includes(": heartbeat"));
      expect(heartbeats.length).toBeGreaterThanOrEqual(2);
      expect(heartbeats.every((frame) => !frame.includes("id:") && !frame.includes("data:") && !frame.includes("event:"))).toBe(true);
      expect(wire.match(/^id: /gm)).toHaveLength(1);
      expect(findMany).toHaveBeenCalledTimes(1);
      expect(startCursor).toHaveBeenCalledTimes(1);
      abort.abort();
      await reader.cancel().catch(() => undefined);
      await vi.waitFor(() => expect(service["isActivelyViewing"]("conversation", "reader")).toBe(false));
    } finally { clearTimeout(deadline); abort.abort(); }

    const reconnect = new AbortController();
    const reconnectDeadline = setTimeout(() => reconnect.abort(), 5000);
    try {
      const response = await fetch(`${url}/events`, { signal: reconnect.signal,
        headers: { Accept: "text/event-stream", "Last-Event-ID": "message-real" } });
      await response.body!.getReader().read();
      expect(findFirst).toHaveBeenCalledWith({ where: { id: "message-real", conversationId: "conversation" }, select: { streamSequence: true } });
      expect(startCursor).toHaveBeenCalledTimes(1);
      expect(findMany.mock.lastCall?.[0]).toMatchObject({ where: { streamSequence: { gt: 1n } } });
    } finally { clearTimeout(reconnectDeadline); reconnect.abort(); }
  }, 20000);
});
