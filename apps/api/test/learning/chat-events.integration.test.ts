import { Test, type TestingModule } from "@nestjs/testing";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { filter, firstValueFrom, timeout, type Subscription } from "rxjs";
import { AppModule } from "../../src/app.module.js";
import { PrismaService } from "../../src/database/prisma.service.js";
import { DatabaseEventsService } from "../../src/database/database-events.service.js";
import { ChatService } from "../../src/domains/learning/chat/chat.service.js";
import type { AuthenticatedSession } from "../../src/auth/auth.service.js";

describe.skipIf(!(process.env.DB_NAME ?? "").endsWith("_test"))("chat events after commit", () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let chat: ChatService;
  let bus: DatabaseEventsService;
  let userId: string;
  let subscription: Subscription;
  const conversationId = `ce-${randomUUID()}`;
  const received: string[] = [];
  const errors: unknown[] = [];

  // Tạo hội thoại fixture với một người đọc để kiểm tra trigger và service SSE thật.
  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    prisma = moduleRef.get(PrismaService);
    chat = moduleRef.get(ChatService);
    bus = moduleRef.get(DatabaseEventsService);
    userId = (await prisma.user.findFirstOrThrow({ where: { status: "ACTIVE" } })).id;
    await firstValueFrom(bus.watch().pipe(filter((event) => event.kind === "resync"), timeout(5000)));
    await prisma.chatConversation.create({ data: { id: conversationId, type: "DIRECT", createdById: userId,
      members: { create: { userId, roleSnapshot: "LEARNER" } } } });
    subscription = chat.watchMessages(conversationId, { user: { id: userId } } as AuthenticatedSession)
      .subscribe({ next: (event) => { if ("data" in event) received.push(event.id); }, error: (error: unknown) => errors.push(error) });
  });

  // Dừng stream trước khi xóa fixture để không nhận sự kiện cleanup.
  afterAll(async () => {
    subscription?.unsubscribe();
    if (prisma) await prisma.chatConversation.deleteMany({ where: { id: conversationId } });
    await moduleRef?.close();
  });

  it("invalidates only the recipient list when read state commits", async () => {
    const signal = firstValueFrom(bus.watch().pipe(
      filter((event) => event.kind === "chat-list" && event.key === userId), timeout(5000)));
    await prisma.chatConversationMember.update({ where: { conversationId_userId: { conversationId, userId } },
      data: { lastReadAt: new Date() } });
    expect(await signal).toEqual({ kind: "chat-list", key: userId });
  });

  it("scopes list invalidations to active members and suppresses rolled-back writes", async () => {
    const members = await prisma.user.findMany({ where: { status: "ACTIVE" }, take: 3, select: { id: true } });
    expect(members).toHaveLength(3);
    const [sender, recipient, removed] = members.map((user) => user.id) as [string, string, string];
    const id = `list-${randomUUID()}`;
    const keys: string[] = [];
    const listener = bus.watch().subscribe((event) => { if (event.kind === "chat-list") keys.push(event.key); });
    /** Xác nhận listener đã nhận hết các notification commit trước mốc kiểm tra. */
    const barrier = async (): Promise<void> => {
      const key = randomUUID();
      const done = firstValueFrom(bus.watch().pipe(filter((event) => event.kind === "job" && event.key === key), timeout(5000)));
      await prisma.$executeRaw`SELECT pg_notify('wind_events', ${JSON.stringify({ kind: "job", key })})`;
      await done;
    };
    try {
      await prisma.chatConversation.create({ data: { id, type: "DIRECT", createdById: sender,
        members: { create: [
          { userId: sender, roleSnapshot: "LEARNER" },
          { userId: recipient, roleSnapshot: "LEARNER" },
          { userId: removed, roleSnapshot: "LEARNER", status: "REMOVED", removedAt: new Date() },
        ] } } });
      await barrier();
      keys.length = 0;
      await expect(prisma.$transaction(async (tx) => {
        await tx.chatMessage.create({ data: { conversationId: id, senderId: sender, clientMessageId: randomUUID(), content: "rollback" } });
        await tx.chatConversationMember.update({ where: { conversationId_userId: { conversationId: id, userId: recipient } }, data: { lastReadAt: new Date() } });
        throw new Error("rollback list");
      })).rejects.toThrow("rollback list");
      await barrier();
      expect(keys).toEqual([]);
      await prisma.chatMessage.create({ data: { conversationId: id, senderId: sender, clientMessageId: randomUUID(), content: "committed" } });
      await barrier();
      expect([...keys].sort()).toEqual([sender, recipient].sort());
      keys.length = 0;
      await prisma.chatConversationMember.update({ where: { conversationId_userId: { conversationId: id, userId: recipient } }, data: { mutedUntil: new Date(Date.now() + 60000) } });
      await barrier();
      expect(keys).toEqual([recipient]);
    } finally {
      listener.unsubscribe();
      await prisma.chatConversation.deleteMany({ where: { id } });
    }
  });

  it("drains committed bursts and excludes rolled-back or post-removal messages", async () => {
    await expect(prisma.$transaction(async (tx) => {
      await tx.chatMessage.create({ data: { id: `${conversationId}-rollback`, conversationId, senderId: userId,
        clientMessageId: `${conversationId}-rollback`, content: "rollback" } });
      throw new Error("rollback message");
    })).rejects.toThrow("rollback message");
    const createdAt = new Date();
    await prisma.chatMessage.createMany({ data: Array.from({ length: 151 }, (_, i) => ({
      id: `${conversationId}-${String(i).padStart(3, "0")}`, conversationId, senderId: userId,
      clientMessageId: `${conversationId}-${i}`, content: "Committed burst", createdAt,
    })) });
    await vi.waitFor(() => expect(received).toHaveLength(151), { timeout: 5000 });
    expect(new Set(received).size).toBe(151);
    expect(received).not.toContain(`${conversationId}-rollback`);
    await prisma.chatConversationMember.update({ where: { conversationId_userId: { conversationId, userId } },
      data: { status: "REMOVED", removedAt: new Date() } });
    await prisma.chatMessage.create({ data: { id: `${conversationId}-denied`, conversationId, senderId: userId,
      clientMessageId: `${conversationId}-denied`, content: "After removal", createdAt: new Date(Date.now() + 1000) } });
    const barrier = firstValueFrom(bus.watch().pipe(filter((event) => event.kind === "job" && event.key === conversationId), timeout(5000)));
    await prisma.$executeRaw`SELECT pg_notify('wind_events', ${JSON.stringify({ kind: "job", key: conversationId })})`;
    await barrier;
    expect(received).not.toContain(`${conversationId}-denied`);
    expect(errors).toEqual([]);
  });

  it("delivers old-timestamp commits and resumes them from the last event ID", async () => {
    await prisma.chatConversationMember.update({ where: { conversationId_userId: { conversationId, userId } },
      data: { status: "ACTIVE", removedAt: null } });
    const lateId = `${conversationId}-late`;
    await prisma.chatMessage.create({ data: { id: lateId, conversationId, senderId: userId,
      clientMessageId: lateId, content: "Committed late", createdAt: new Date("2020-01-01") } });
    await vi.waitFor(() => expect(received).toContain(lateId), { timeout: 5000 });
    const resumed: string[] = [];
    const resume = chat.watchMessages(conversationId, { user: { id: userId } } as AuthenticatedSession, `${conversationId}-150`)
      .subscribe({ next: (event) => {
        if (!("data" in event)) return;
        expect(event.data).not.toHaveProperty("streamSequence");
        resumed.push(event.id);
      }, error: (error: unknown) => errors.push(error) });
    try {
      await vi.waitFor(() => expect(resumed).toContain(lateId), { timeout: 5000 });
      expect(new Set(resumed).size).toBe(resumed.length);
      expect(resumed).not.toContain(`${conversationId}-150`);
      expect(errors).toEqual([]);
    } finally { resume.unsubscribe(); }
  });

  it("holds the next allocator until the earlier transaction commits", async () => {
    let release!: () => void;
    let allocated!: () => void;
    let secondStarted!: (pid: number) => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const ready = new Promise<void>((resolve) => { allocated = resolve; });
    const secondPid = new Promise<number>((resolve) => { secondStarted = resolve; });
    const first = prisma.$transaction(async (tx) => {
      const message = await tx.chatMessage.create({ data: { id: `${conversationId}-serial-a`, conversationId, senderId: userId,
        clientMessageId: `${conversationId}-serial-a`, content: "first" } });
      allocated();
      await gate;
      return message;
    }, { timeout: 15000 });
    await ready;
    const second = prisma.$transaction(async (tx) => {
      const [backend] = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`;
      secondStarted(backend!.pid);
      return tx.chatMessage.create({ data: { id: `${conversationId}-serial-b`, conversationId, senderId: userId,
        clientMessageId: `${conversationId}-serial-b`, content: "second", createdAt: new Date("2019-01-01") } });
    }, { timeout: 15000 });
    try {
      const pid = await secondPid;
      await vi.waitFor(async () => {
        const [state] = await prisma.$queryRaw<Array<{ blocked: boolean }>>`SELECT cardinality(pg_blocking_pids(${pid}::int)) > 0 AS blocked`;
        expect(state?.blocked).toBe(true);
      }, { timeout: 5000 });
    } finally { release(); }
    const [a, b] = await Promise.all([first, second]);
    expect(b.streamSequence).toBe(a.streamSequence + 1n);
    expect(b.createdAt.getTime()).toBeLessThan(a.createdAt.getTime());
    await vi.waitFor(() => expect(received).toContain(b.id), { timeout: 5000 });
    expect(received.indexOf(a.id)).toBeLessThan(received.indexOf(b.id));
  });
});
