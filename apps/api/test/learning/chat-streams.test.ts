import { afterEach, describe, expect, it, vi } from "vitest";
import { Subject } from "rxjs";
import { DatabaseEventsService, type DatabaseEvent } from "../../src/database/database-events.service.js";
import type { AuthenticatedSession } from "../../src/auth/auth.service.js";
import { PrismaService } from "../../src/database/prisma.service.js";
import { ChatService } from "../../src/domains/learning/chat/chat.service.js";
import type { ChatMessageView } from "../../src/domains/learning/chat/chat.types.js";
import { AntivirusService } from "../../src/infrastructure/antivirus.service.js";
import { ObjectStorageService } from "../../src/infrastructure/object-storage.service.js";

const session = {
  user: { id: "viewer-1" },
} as AuthenticatedSession;

// Khởi tạo service với dữ liệu hội thoại hợp lệ mà không cần cơ sở dữ liệu thật.
function createService(chatMessage: Record<string, unknown> = {}, events = new Subject<DatabaseEvent>()): ChatService {
  const prisma = {
    $queryRaw: vi.fn().mockResolvedValue([{ sequence: 0n }]),
    chatMessage,
    chatConversation: {
      findUnique: vi.fn().mockResolvedValue({ classId: null }),
    },
    chatConversationMember: {
      findUnique: vi.fn().mockResolvedValue({ status: "ACTIVE" }),
    },
  } as unknown as PrismaService;
  return new ChatService(
    prisma,
    {} as ObjectStorageService,
    {} as AntivirusService,
    { watch: () => events.asObservable() } as DatabaseEventsService,
  );
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("ChatService SSE subscriptions", () => {
  it("không poll khi idle, chỉ đọc đúng hội thoại và gộp burst tín hiệu", async () => {
    vi.useFakeTimers();
    const events = new Subject<DatabaseEvent>();
    const findMany = vi.fn().mockResolvedValue([]);
    const service = createService({ findMany }, events);
    const subscription = service.watchMessages("conversation-1", session).subscribe();
    try {
      await vi.advanceTimersByTimeAsync(60000);
      expect(findMany).toHaveBeenCalledTimes(1);
      expect(service["isActivelyViewing"]("conversation-1", "viewer-1")).toBe(true);
      events.next({ kind: "chat", key: "other-conversation" });
      await vi.advanceTimersByTimeAsync(1);
      expect(findMany).toHaveBeenCalledTimes(1);
      for (let i = 0; i < 100; i++) events.next({ kind: "chat", key: "conversation-1" });
      await vi.advanceTimersByTimeAsync(1);
      expect(findMany).toHaveBeenCalledTimes(3);
      events.next({ kind: "resync" });
      await vi.advanceTimersByTimeAsync(1);
      expect(findMany).toHaveBeenCalledTimes(4);
      subscription.unsubscribe();
      events.next({ kind: "chat", key: "conversation-1" });
      await vi.advanceTimersByTimeAsync(60000);
      expect(findMany).toHaveBeenCalledTimes(4);
      expect(service["isActivelyViewing"]("conversation-1", "viewer-1")).toBe(false);
    } finally { subscription.unsubscribe(); }
  });

  it("không bỏ sót hoặc phát trùng khi hơn 100 tin có cùng timestamp", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-31T09:00:00.000Z"));
    const createdAt = new Date("2026-10-31T09:00:01.000Z");
    const rows = Array.from({ length: 151 }, (_, index) => ({
      id: `message-${String(index + 1).padStart(3, "0")}`,
      streamSequence: BigInt(index + 1),
      createdAt,
    }));
    const findMany = vi.fn((query: {
      where: { streamSequence: { gt: bigint } };
      take: number;
    }) => {
      return Promise.resolve(rows.filter((row) => row.streamSequence > query.where.streamSequence.gt).slice(0, query.take));
    });
    const service = createService({ findMany });
    vi.spyOn(service as unknown as {
      mapMessageForActor: (row: { id: string; createdAt: Date }) => Promise<ChatMessageView>;
    }, "mapMessageForActor").mockImplementation((row) => Promise.resolve({
      id: row.id,
      createdAt: row.createdAt.toISOString(),
    } as ChatMessageView));

    const received: string[] = [];
    const subscription = service.watchMessages("conversation-burst", session)
      .subscribe((event) => { if ("data" in event) received.push(event.data.id); });
    try {
      await vi.advanceTimersByTimeAsync(6_000);
      expect(received).toHaveLength(151);
      expect(new Set(received).size).toBe(151);
      expect(findMany).toHaveBeenCalledTimes(2);
    } finally {
      subscription.unsubscribe();
    }
  });

  it("tiếp tục từ ID sự kiện cuối khi kết nối SSE bị ngắt", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-31T09:00:10.000Z"));
    const firstTime = new Date("2026-10-31T09:00:01.000Z");
    const secondTime = new Date("2026-10-31T09:00:04.000Z");
    const findFirst = vi.fn().mockResolvedValue({ streamSequence: 1n });
    const findMany = vi.fn((query: {
      where: { streamSequence: { gt: bigint } };
    }) => {
      return Promise.resolve([
        { id: "message-1", createdAt: firstTime, streamSequence: 1n },
        { id: "message-2", createdAt: secondTime, streamSequence: 2n },
      ].filter((row) => row.streamSequence > query.where.streamSequence.gt));
    });
    const service = createService({ findFirst, findMany });
    vi.spyOn(service as unknown as {
      mapMessageForActor: (row: { id: string; createdAt: Date }) => Promise<ChatMessageView>;
    }, "mapMessageForActor").mockImplementation((row) => Promise.resolve({
      id: row.id, createdAt: row.createdAt.toISOString(),
    } as ChatMessageView));

    const received: Array<{ id: string; data: ChatMessageView }> = [];
    const subscription = service.watchMessages("conversation-1", session, "message-1")
      .subscribe((event) => { if ("data" in event) received.push(event); });
    try {
      await vi.advanceTimersByTimeAsync(2_000);
      expect(received.map((event) => event.id)).toEqual(["message-2"]);
      expect(received[0]?.id).toBe(received[0]?.data.id);
      expect(findFirst).toHaveBeenCalledWith({
        where: { id: "message-1", conversationId: "conversation-1" },
        select: { streamSequence: true },
      });
    } finally {
      subscription.unsubscribe();
    }
  });

  it("giữ trạng thái đang xem đến khi tất cả kết nối cùng người dùng đóng", async () => {
    vi.useFakeTimers();
    const service = createService();
    const message: ChatMessageView & { streamSequence: bigint } = {
      id: "message-1",
      streamSequence: 1n,
      conversationId: "conversation-1", senderId: "sender", senderName: "Sender",
      clientMessageId: "client-1", content: "Hello", attachments: [], mentionedUserIds: [],
      createdAt: "2026-10-31T09:00:00.000Z",
    };
    const poll = vi.spyOn(service as unknown as {
      pollMessages: (...args: unknown[]) => Promise<ChatMessageView[]>;
    }, "pollMessages").mockResolvedValue([message]);

    const eventsFirst: string[] = [];
    const eventsSecond: string[] = [];
    const stream = service.watchMessages("conversation-1", session);
    const first = stream.subscribe((event) => { if ("data" in event) eventsFirst.push(event.data.id); });
    let second: ReturnType<typeof stream.subscribe> | undefined;
    try {
      await vi.advanceTimersByTimeAsync(2_000);
      second = stream.subscribe((event) => { if ("data" in event) eventsSecond.push(event.data.id); });
      await vi.advanceTimersByTimeAsync(2_000);

      expect(eventsFirst).toEqual(["message-1"]);
      expect(eventsSecond).toEqual(["message-1"]);
      expect(poll.mock.calls).toHaveLength(2);
      expect(poll.mock.calls[0]?.[2]).not.toBe(poll.mock.calls[1]?.[2]);

      first.unsubscribe();
      expect(service["isActivelyViewing"]("conversation-1", "viewer-1")).toBe(true);
      second.unsubscribe();
      expect(service["isActivelyViewing"]("conversation-1", "viewer-1")).toBe(false);
    } finally {
      first.unsubscribe();
      second?.unsubscribe();
    }
  });

  it("không để lại trạng thái đang xem khi đóng kết nối trước lúc xác thực hoàn tất", async () => {
    const service = createService();
    let finishMembership!: (value: unknown) => void;
    const pendingMembership = new Promise<unknown>((resolve) => {
      finishMembership = resolve;
    });
    vi.spyOn(service as unknown as {
      resolveMembership: (...args: string[]) => Promise<unknown>;
    }, "resolveMembership").mockReturnValue(pendingMembership);

    const subscription = service.watchMessages("conversation-2", session).subscribe();
    subscription.unsubscribe();
    finishMembership({ status: "ACTIVE" });
    await pendingMembership;
    await Promise.resolve();

    expect(service["isActivelyViewing"]("conversation-2", "viewer-1")).toBe(false);
  });
});

describe("ChatService membership projection reads", () => {
  it("đọc đúng một membership, không đọc lại lớp hoặc mở transaction ghi", async () => {
    const findUnique = vi.fn().mockResolvedValue({ status: "REMOVED", removedAt: new Date() });
    const transaction = vi.fn();
    const classRead = vi.fn();
    const prisma = {
      chatConversationMember: { findUnique },
      learningClass: { findUnique: classRead },
      $transaction: transaction,
    } as unknown as PrismaService;
    const service = new ChatService(prisma, {} as ObjectStorageService, {} as AntivirusService);
    expect(await service["resolveMembership"]("conversation-1", "user-1")).toMatchObject({ status: "REMOVED" });
    expect(findUnique).toHaveBeenCalledTimes(1);
    expect(classRead).not.toHaveBeenCalled();
    expect(transaction).not.toHaveBeenCalled();
    findUnique.mockResolvedValueOnce(null);
    await expect(service["resolveMembership"]("missing", "user-1")).rejects.toMatchObject({ status: 404 });
  });
});
