import { randomUUID } from "node:crypto";
import { NotFoundException } from "@nestjs/common";
import { Test, type TestingModule } from "@nestjs/testing";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../../src/app.module.js";
import type { AuthenticatedSession } from "../../src/auth/auth.service.js";
import { PrismaService } from "../../src/database/prisma.service.js";
import { ChatService } from "../../src/domains/learning/chat/chat.service.js";

/** Đếm số truy vấn SQL thật gửi qua pg.Client.prototype.query trong suốt một thao tác bất đồng bộ. */
async function countRealSql<T>(task: () => Promise<T>): Promise<{ result: T; queries: number }> {
  const originalQuery = Reflect.get(pg.Client.prototype, "query") as (this: pg.Client, ...params: unknown[]) => unknown;
  let queries = 0;
  Reflect.set(pg.Client.prototype, "query", function countedQuery(this: pg.Client, ...args: unknown[]): unknown {
    queries += 1;
    return originalQuery.apply(this, args);
  });
  try {
    const result = await task();
    return { result, queries };
  } finally {
    Reflect.set(pg.Client.prototype, "query", originalQuery);
  }
}

describe("A06 Tối ưu truy vấn chat-open/list/messages, thành viên gỡ/thêm mới và mở đồng thời", () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let chat: ChatService;

  const prefix = `a06-${randomUUID().slice(0, 8)}`;
  const classId = `${prefix}-class`;
  const learnerAId = `${prefix}-learner-a`;
  const learnerBId = `${prefix}-learner-b`;
  const outsiderId = `${prefix}-outsider`;
  const instructorId = "usr-instructor";
  const createdConversationIds: string[] = [];

  let sessionA: AuthenticatedSession;
  let sessionB: AuthenticatedSession;
  let sessionInstructor: AuthenticatedSession;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    prisma = moduleRef.get(PrismaService);
    chat = moduleRef.get(ChatService);

    const sourceClass = await prisma.learningClass.findFirstOrThrow();
    const learnerRole = await prisma.role.findUniqueOrThrow({ where: { code: "LEARNER" } });

    await prisma.user.createMany({
      data: [
        { id: learnerAId, username: learnerAId, email: `${learnerAId}@test.local`, emailVerifiedAt: new Date(), displayName: "A06 Học viên A", status: "ACTIVE" },
        { id: learnerBId, username: learnerBId, email: `${learnerBId}@test.local`, emailVerifiedAt: new Date(), displayName: "A06 Học viên B", status: "ACTIVE" },
        { id: outsiderId, username: outsiderId, email: `${outsiderId}@test.local`, emailVerifiedAt: new Date(), displayName: "A06 Ngoài lớp", status: "ACTIVE" },
      ],
    });
    await prisma.userRole.createMany({
      data: [
        { userId: learnerAId, roleId: learnerRole.id },
        { userId: learnerBId, roleId: learnerRole.id },
        { userId: outsiderId, roleId: learnerRole.id },
      ],
    });
    await prisma.learningClass.create({
      data: {
        id: classId,
        code: classId,
        name: `Lớp A06 ${prefix}`,
        term: "test",
        capacity: 50,
        status: "ACTIVE",
        courseId: sourceClass.courseId,
        courseVersion: sourceClass.courseVersion,
        startAt: new Date(Date.now() - 86_400_000),
        endAt: new Date(Date.now() + 86_400_000 * 30),
        instructors: { create: { instructorId, role: "PRIMARY", assignedBy: instructorId } },
        enrollments: { create: [{ learnerId: learnerAId, status: "ACTIVE", source: "TEST" }] },
      },
    });

    sessionA = {
      sessionId: `${prefix}-s-a`,
      user: { id: learnerAId, username: learnerAId, name: "A06 Học viên A", email: `${learnerAId}@test.local`, roleName: "Học viên" },
      roleCode: "LEARNER",
      permissions: [],
      availableRoles: [{ code: "LEARNER", name: "Học viên" }],
    };
    sessionB = {
      sessionId: `${prefix}-s-b`,
      user: { id: learnerBId, username: learnerBId, name: "A06 Học viên B", email: `${learnerBId}@test.local`, roleName: "Học viên" },
      roleCode: "LEARNER",
      permissions: [],
      availableRoles: [{ code: "LEARNER", name: "Học viên" }],
    };
    sessionInstructor = {
      sessionId: `${prefix}-s-inst`,
      user: { id: instructorId, username: "instructor@wind.edu.vn", name: "Giảng viên", email: "instructor@wind.edu.vn", roleName: "Giảng viên" },
      roleCode: "INSTRUCTOR",
      permissions: [],
      availableRoles: [{ code: "INSTRUCTOR", name: "Giảng viên" }],
    };
  });

  afterAll(async () => {
    if (createdConversationIds.length) {
      await prisma.notification.deleteMany({
        where: { entityType: "CHAT_CONVERSATION", entityId: { in: createdConversationIds } },
      });
      await prisma.chatConversation.deleteMany({
        where: { id: { in: createdConversationIds } },
      });
    }
    await prisma.chatConversation.deleteMany({ where: { classId } });
    await prisma.learningClass.deleteMany({ where: { id: classId } });
    await prisma.user.deleteMany({ where: { id: { in: [learnerAId, learnerBId, outsiderId] } } });
    await moduleRef.close();
  });

  it("chặn người ngoài lớp, xử lý thành viên thêm mới/bị gỡ và mở đồng thời an toàn với số SQL thấp", async () => {
    // 1. Không cùng lớp -> chặn mở chat riêng.
    await expect(chat.openDirect(sessionA, outsiderId)).rejects.toBeInstanceOf(NotFoundException);
    await expect(chat.openDirect(sessionA, learnerBId)).rejects.toBeInstanceOf(NotFoundException);

    // 2. Thêm học viên B vào lớp -> ngay lập tức mở được chat lớp và chat riêng đồng thời không trùng.
    await prisma.classEnrollment.create({
      data: { classId, learnerId: learnerBId, status: "ACTIVE", source: "TEST" },
    });

    const concurrentClass = await Promise.all([
      chat.openClass(sessionA, classId),
      chat.openClass(sessionB, classId),
      chat.openClass(sessionInstructor, classId),
    ]);
    const classConvId = concurrentClass[0].id;
    createdConversationIds.push(classConvId);
    expect(concurrentClass.every((c) => c.id === classConvId)).toBe(true);

    const concurrentDirect = await Promise.all([
      chat.openDirect(sessionA, learnerBId),
      chat.openDirect(sessionB, learnerAId),
    ]);
    const directConvId = concurrentDirect[0].id;
    createdConversationIds.push(directConvId);
    expect(concurrentDirect[1].id).toBe(directConvId);

    // 3. Đo chính xác số câu SQL thật trên đường đọc/mở nóng.
    const directWarm = await countRealSql(() => chat.openDirect(sessionA, learnerBId));
    expect(directWarm.queries).toBeLessThanOrEqual(2);

    const classWarm = await countRealSql(() => chat.openClass(sessionA, classId));
    expect(classWarm.queries).toBeLessThanOrEqual(2);

    const listWarm = await countRealSql(() => chat.listConversations(sessionA));
    expect(listWarm.queries).toBe(1);
    expect(listWarm.result.some((c) => c.id === classConvId)).toBe(true);
    expect(listWarm.result.some((c) => c.id === directConvId)).toBe(true);

    const messagesWarm = await countRealSql(() => chat.listMessages(classConvId, sessionA));
    expect(messagesWarm.queries).toBe(2);

    // 4. Gỡ học viên B khỏi lớp -> không thể mở lại hội thoại lớp và hội thoại lớp chuyển sang chỉ đọc.
    await prisma.classEnrollment.updateMany({
      where: { classId, learnerId: learnerBId },
      data: { status: "CANCELLED" },
    });
    await expect(chat.openClass(sessionB, classId)).rejects.toBeInstanceOf(NotFoundException);
    const afterRemovalList = await chat.listConversations(sessionB);
    const removedClassConv = afterRemovalList.find((c) => c.id === classConvId);
    expect(removedClassConv?.readOnly).toBe(true);
  });
});
