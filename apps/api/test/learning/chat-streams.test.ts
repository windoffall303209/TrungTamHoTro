import { afterEach, describe, expect, it, vi } from "vitest";
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
function createService(chatMessage: Record<string, unknown> = {}): ChatService {
  const prisma = {
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
  );
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("ChatService SSE subscriptions", () => {
  it("không bỏ sót hoặc phát trùng khi hơn 100 tin có cùng timestamp", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-31T09:00:00.000Z"));
    const createdAt = new Date("2026-10-31T09:00:01.000Z");
    const rows = Array.from({ length: 151 }, (_, index) => ({
      id: `message-${String(index + 1).padStart(3, "0")}`,
      createdAt,
    }));
    const findMany = vi.fn((query: {
      where: { OR?: Array<{ id?: { gt: string } }> };
      take: number;
    }) => {
      const afterId = query.where.OR?.find((condition) => condition.id)?.id?.gt;
      return Promise.resolve(rows.filter((row) => !afterId || row.id > afterId).slice(0, query.take));
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
      .subscribe(({ data }) => received.push(data.id));
    try {
      await vi.advanceTimersByTimeAsync(6_000);
      expect(received).toHaveLength(151);
      expect(new Set(received).size).toBe(151);
      expect(findMany).toHaveBeenCalledTimes(3);
    } finally {
      subscription.unsubscribe();
    }
  });

  it("giữ trạng thái đang xem đến khi tất cả kết nối cùng người dùng đóng", async () => {
    vi.useFakeTimers();
    const service = createService();
    const message = {
      id: "message-1",
      createdAt: "2026-10-31T09:00:00.000Z",
    } as ChatMessageView;
    const poll = vi.spyOn(service as unknown as {
      pollMessages: (...args: unknown[]) => Promise<ChatMessageView[]>;
    }, "pollMessages").mockResolvedValue([message]);

    const eventsFirst: string[] = [];
    const eventsSecond: string[] = [];
    const stream = service.watchMessages("conversation-1", session);
    const first = stream.subscribe(({ data }) => eventsFirst.push(data.id));
    let second: ReturnType<typeof stream.subscribe> | undefined;
    try {
      await vi.advanceTimersByTimeAsync(2_000);
      second = stream.subscribe(({ data }) => eventsSecond.push(data.id));
      await vi.advanceTimersByTimeAsync(2_000);

      expect(eventsFirst).toEqual(["message-1", "message-1"]);
      expect(eventsSecond).toEqual(["message-1"]);
      expect(poll.mock.calls).toHaveLength(3);
      expect(poll.mock.calls[0]?.[2]).not.toBe(poll.mock.calls[2]?.[2]);

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

describe("ChatService class membership synchronization", () => {
  it("không mở transaction ghi khi toàn bộ thành viên đã đồng bộ", async () => {
    const transaction = vi.fn();
    const prisma = {
      learningClass: {
        findUnique: vi.fn().mockResolvedValue({
          instructors: [{ instructor: { id: "teacher-1", roles: [{ role: { code: "INSTRUCTOR" } }] } }],
          enrollments: [],
        }),
      },
      chatConversationMember: {
        findMany: vi.fn().mockResolvedValue([{
          userId: "teacher-1", status: "ACTIVE", removedAt: null, roleSnapshot: "INSTRUCTOR",
        }]),
      },
      $transaction: transaction,
    } as unknown as PrismaService;
    const service = new ChatService(prisma, {} as ObjectStorageService, {} as AntivirusService);

    await service["syncClassMembers"]("conversation-1", "class-1");

    expect(transaction).not.toHaveBeenCalled();
  });

  it("chỉ cập nhật thành viên có thay đổi vai trò, trạng thái hoặc mới tham gia", async () => {
    const updateMany = vi.fn<(query: {
      where: { conversationId: string; status: string; userId: { notIn: string[] } };
    }) => Promise<{ count: number }>>().mockResolvedValue({ count: 1 });
    const upsert = vi.fn<(query: {
      where: { conversationId_userId: { userId: string } };
    }) => Promise<object>>().mockResolvedValue({});
    const transaction = vi.fn(async (callback: (client: unknown) => Promise<void>) => callback({
      chatConversationMember: { updateMany, upsert },
    }));
    const prisma = {
      learningClass: {
        findUnique: vi.fn().mockResolvedValue({
          instructors: [
            { instructor: { id: "teacher-1", roles: [{ role: { code: "INSTRUCTOR" } }] } },
            { instructor: { id: "teacher-2", roles: [{ role: { code: "INSTRUCTOR" } }] } },
          ],
          enrollments: [{ learner: { id: "learner-new", roles: [{ role: { code: "LEARNER" } }] } }],
        }),
      },
      chatConversationMember: {
        findMany: vi.fn().mockResolvedValue([
          { userId: "teacher-1", status: "ACTIVE", removedAt: null, roleSnapshot: "INSTRUCTOR" },
          { userId: "teacher-2", status: "REMOVED", removedAt: new Date(), roleSnapshot: "INSTRUCTOR" },
          { userId: "learner-left", status: "ACTIVE", removedAt: null, roleSnapshot: "LEARNER" },
        ]),
      },
      $transaction: transaction,
    } as unknown as PrismaService;
    const service = new ChatService(prisma, {} as ObjectStorageService, {} as AntivirusService);

    await service["syncClassMembers"]("conversation-1", "class-1");

    expect(transaction).toHaveBeenCalledOnce();
    expect(updateMany.mock.calls[0]?.[0]).toMatchObject({
      where: { conversationId: "conversation-1", status: "ACTIVE" },
    });
    expect(upsert).toHaveBeenCalledTimes(2);
    expect(upsert.mock.calls.map(([options]) => options.where.conversationId_userId.userId))
      .toEqual(["teacher-2", "learner-new"]);
  });
});
