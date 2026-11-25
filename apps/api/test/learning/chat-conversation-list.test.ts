import { describe, expect, it, vi } from "vitest";
import type { AuthenticatedSession } from "../../src/auth/auth.service.js";
import { PrismaService } from "../../src/database/prisma.service.js";
import { ChatService } from "../../src/domains/learning/chat/chat.service.js";
import type { ChatConversationView } from "../../src/domains/learning/chat/chat.types.js";
import { AntivirusService } from "../../src/infrastructure/antivirus.service.js";
import { ObjectStorageService } from "../../src/infrastructure/object-storage.service.js";

const actorId = "user-1";
const session = { user: { id: actorId } } as AuthenticatedSession;

describe("ChatService listConversations", () => {
  it("liệt kê trực tiếp mà không quét hoặc ghi lại membership lớp", async () => {
    const membershipRead = vi.fn();
    const write = vi.fn();
    const prisma = {
      chatConversationMember: { findMany: membershipRead },
      chatConversation: { findMany: vi.fn().mockResolvedValue([]) },
      $transaction: write,
    } as unknown as PrismaService;
    const service = new ChatService(prisma, {} as ObjectStorageService, {} as AntivirusService);
    await expect(service.listConversations(session)).resolves.toEqual([]);
    expect(membershipRead).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
  });

  it("đếm tin chưa đọc theo từng hội thoại bằng một truy vấn, giữ mốc đã đọc và thời điểm rời", async () => {
    const rows = [
      {
        id: "conversation-a",
        members: [{
          userId: actorId,
          joinedAt: new Date("2026-10-01T00:00:00.000Z"),
          lastReadAt: new Date("2026-10-08T00:00:00.000Z"),
          removedAt: null,
        }],
      },
      {
        id: "conversation-b",
        members: [{
          userId: actorId,
          joinedAt: new Date("2026-10-02T00:00:00.000Z"),
          lastReadAt: null,
          removedAt: new Date("2026-10-12T00:00:00.000Z"),
        }],
      },
    ];
    const groupBy = vi.fn().mockResolvedValue([
      { conversationId: "conversation-a", _count: { _all: 3 } },
    ]);
    const count = vi.fn().mockResolvedValue(0);
    const findUnique = vi.fn().mockResolvedValue(rows[0]!.members[0]);
    const prisma = {
      chatConversationMember: {
        findMany: vi.fn().mockResolvedValue([]),
        findUnique,
      },
      chatConversation: { findMany: vi.fn().mockResolvedValue(rows) },
      chatMessage: { groupBy, count },
    } as unknown as PrismaService;
    const service = new ChatService(prisma, {} as ObjectStorageService, {} as AntivirusService);
    const mapper = service as unknown as {
      mapConversation: (
        row: { id: string },
        actor: string,
        unreadCount: number,
      ) => Promise<ChatConversationView>;
    };
    vi.spyOn(mapper, "mapConversation").mockImplementation((row, _actor, unreadCount) =>
      Promise.resolve({ id: row.id, unreadCount } as ChatConversationView),
    );

    const result = await service.listConversations(session);

    expect(result.map(({ id, unreadCount }) => ({ id, unreadCount }))).toEqual([
      { id: "conversation-a", unreadCount: 3 },
      { id: "conversation-b", unreadCount: 0 },
    ]);
    expect(count).not.toHaveBeenCalled();
    expect(findUnique).not.toHaveBeenCalled();
    expect(groupBy).toHaveBeenCalledTimes(1);
    expect(groupBy).toHaveBeenCalledWith({
      by: ["conversationId"],
      where: {
        senderId: { not: actorId },
        OR: [
          { conversationId: "conversation-a", createdAt: { gt: new Date("2026-10-08T00:00:00.000Z") } },
          { conversationId: "conversation-b", createdAt: {
            gt: new Date("2026-10-02T00:00:00.000Z"),
            lte: new Date("2026-10-12T00:00:00.000Z"),
          } },
        ],
      },
      _count: { _all: true },
    });
  });

  it("không truy vấn bảng tin nhắn khi người dùng chưa có hội thoại", async () => {
    const groupBy = vi.fn();
    const prisma = {
      chatConversationMember: { findMany: vi.fn().mockResolvedValue([]) },
      chatConversation: { findMany: vi.fn().mockResolvedValue([]) },
      chatMessage: { groupBy },
    } as unknown as PrismaService;
    const service = new ChatService(prisma, {} as ObjectStorageService, {} as AntivirusService);

    await expect(service.listConversations(session)).resolves.toEqual([]);
    expect(groupBy).not.toHaveBeenCalled();
  });
});
