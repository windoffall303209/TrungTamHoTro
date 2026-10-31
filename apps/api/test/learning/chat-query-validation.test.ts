import { describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";
import type { AuthenticatedSession } from "../../src/auth/auth.service.js";
import { PrismaService } from "../../src/database/prisma.service.js";
import { ChatService } from "../../src/domains/learning/chat/chat.service.js";
import type { ChatMessageView } from "../../src/domains/learning/chat/chat.types.js";
import { AntivirusService } from "../../src/infrastructure/antivirus.service.js";
import { ObjectStorageService } from "../../src/infrastructure/object-storage.service.js";

const session = { user: { id: "user-1" } } as AuthenticatedSession;

interface MessageQuery {
  take: number;
  where: {
    createdAt?: { lt: Date };
    OR?: Array<{ createdAt: { lt: Date } } | { createdAt: Date; id: { lt: string } }>;
  };
}

// Tạo service với hội thoại hợp lệ để kiểm tra đầu vào mà không cần kết nối database.
function createService(): { service: ChatService; findMany: Mock<(query: MessageQuery) => Promise<unknown[]>> } {
  const findMany = vi.fn<(query: MessageQuery) => Promise<unknown[]>>().mockResolvedValue([]);
  const prisma = {
    chatConversation: { findUnique: vi.fn().mockResolvedValue({ classId: null }) },
    chatConversationMember: {
      findUnique: vi.fn().mockResolvedValue({ status: "ACTIVE", removedAt: null }),
    },
    chatMessage: { findMany },
  } as unknown as PrismaService;
  return {
    service: new ChatService(prisma, {} as ObjectStorageService, {} as AntivirusService),
    findMany,
  };
}

describe("ChatService query validation", () => {
  it("dùng mốc thời gian của tin cũ nhất trong trang để phân trang không bị trùng", async () => {
    const { service, findMany } = createService();
    const rows = [4, 3, 2, 1].map((day) => ({
      id: `message-${day}`,
      createdAt: new Date(`2026-10-${String(day).padStart(2, "0")}T00:00:00.000Z`),
    }));
    findMany.mockImplementation((query) => Promise.resolve(
      rows
        .filter((row) => !query.where.createdAt?.lt || row.createdAt < query.where.createdAt.lt)
        .slice(0, query.take),
    ));
    vi.spyOn(service as unknown as {
      mapMessageForActor: (row: { id: string; createdAt: Date }) => Promise<ChatMessageView>;
    }, "mapMessageForActor").mockImplementation((row) => Promise.resolve({
      id: row.id,
      createdAt: row.createdAt.toISOString(),
    } as ChatMessageView));

    const first = await service.listMessages("conversation-1", session, undefined, 2);
    expect(first.items.map(({ id }) => id)).toEqual(["message-3", "message-4"]);
    expect(first.nextCursor).toBe("2026-10-03T00:00:00.000Z");
    const second = await service.listMessages("conversation-1", session, first.nextCursor, 2);
    expect(second.items.map(({ id }) => id)).toEqual(["message-1", "message-2"]);
    expect(second.nextCursor).toBeUndefined();
  });

  it("không bỏ sót tin khi nhiều trang chứa tin cùng timestamp", async () => {
    const { service, findMany } = createService();
    const timestamp = new Date("2026-10-03T00:00:00.000Z");
    const rows = ["e", "d", "c", "b", "a"].map((id) => ({
      id: `message-${id}`, createdAt: timestamp,
    }));
    rows.push({ id: "message-old", createdAt: new Date("2026-10-02T00:00:00.000Z") });
    findMany.mockImplementation(({ where, take }) => Promise.resolve(rows.filter((row) => {
      if (where.OR) return where.OR.some((condition) => "id" in condition
        ? row.createdAt.getTime() === condition.createdAt.getTime() && row.id < condition.id.lt
        : row.createdAt < condition.createdAt.lt);
      return !where.createdAt?.lt || row.createdAt < where.createdAt.lt;
    }).slice(0, take)));
    vi.spyOn(service as unknown as {
      mapMessageForActor: (row: { id: string; createdAt: Date }) => Promise<ChatMessageView>;
    }, "mapMessageForActor").mockImplementation((row) => Promise.resolve({
      id: row.id, createdAt: row.createdAt.toISOString(),
    } as ChatMessageView));

    const first = await service.listMessages("conversation-1", session, undefined, 2);
    const second = await service.listMessages("conversation-1", session, first.nextCursor, 2);
    const third = await service.listMessages("conversation-1", session, second.nextCursor, 2);
    expect(first.nextCursor).toBe("2026-10-03T00:00:00.000Z|message-d");
    expect(second.nextCursor).toBe("2026-10-03T00:00:00.000Z|message-b");
    expect(third.nextCursor).toBeUndefined();
    expect([...first.items, ...second.items, ...third.items].map(({ id }) => id)).toEqual([
      "message-d", "message-e", "message-b", "message-c", "message-old", "message-a",
    ]);
    const legacy = await service.listMessages("conversation-1", session, timestamp.toISOString(), 2);
    expect(legacy.items.map(({ id }) => id)).toEqual(["message-old"]);
  });

  it("không vượt thời điểm rời lớp dù cursor chứa ID", async () => {
    const { service, findMany } = createService();
    const cutoff = new Date("2026-10-03T00:00:00.000Z");
    const prisma = (service as unknown as { prisma: {
      chatConversationMember: { findUnique: Mock };
    } }).prisma;
    prisma.chatConversationMember.findUnique.mockResolvedValue({ status: "REMOVED", removedAt: cutoff });
    await service.listMessages("conversation-1", session, `${cutoff.toISOString()}|message-a`, 2);
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { conversationId: "conversation-1", createdAt: { lt: cutoff } },
    }));
  });

  it.each([
    "invalid|message-a", "2026-10-03T00:00:00.000Z|", "2026-10-03T00:00:00.000Z|bad/id",
    "2026-10-03T00:00:00.000Z|message-a|extra", ["2026-10-03", "2026-10-04"],
  ])("từ chối cursor phân trang không hợp lệ: %s", async (before) => {
    const { service, findMany } = createService();
    await expect(service.listMessages("conversation-1", session, before as string, 2))
      .rejects.toMatchObject({ status: 400 });
    expect(findMany).not.toHaveBeenCalled();
  });

  it.each([Number.NaN, Infinity, -Infinity, 1.5])(
    "trả lỗi 400 cho giới hạn số tin nhắn không hợp lệ: %s",
    async (limit) => {
      const { service, findMany } = createService();
      await expect(service.listMessages("conversation-1", session, undefined, limit))
        .rejects.toMatchObject({ status: 400 });
      expect(findMany).not.toHaveBeenCalled();
    },
  );

  it.each([{ input: 0, take: 2 }, { input: 500, take: 101 }, { input: 40, take: 41 }])(
    "giữ nguyên cách giới hạn trang tin hợp lệ $input",
    async ({ input, take }) => {
      const { service, findMany } = createService();
      await expect(service.listMessages("conversation-1", session, undefined, input))
        .resolves.toEqual({ items: [], nextCursor: undefined });
      expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ take }));
    },
  );

  it("từ chối query tìm tin bị thiếu hoặc là mảng thay vì gây lỗi 500", async () => {
    const { service, findMany } = createService();
    for (const invalid of [undefined, ["hello", "world"]]) {
      await expect(service.searchMessages("conversation-1", invalid as unknown as string, session))
        .rejects.toMatchObject({ status: 400 });
    }
    expect(findMany).not.toHaveBeenCalled();
  });

  it("từ chối query danh bạ dạng mảng trước khi thực hiện truy vấn", async () => {
    const { service } = createService();
    await expect(service.directory(session, ["one", "two"] as unknown as string))
      .rejects.toMatchObject({ status: 400 });
  });
});
