import { Test, type TestingModule } from "@nestjs/testing";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../../src/app.module.js";
import { PrismaService } from "../../src/database/prisma.service.js";

describe.skipIf(!(process.env.DB_NAME ?? "").endsWith("_test"))("transactional class chat membership", () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let authorId: string;
  let instructorRoleId: string;
  const prefix = `cp-${randomUUID()}`;
  const classId = `${prefix}-class`;
  const userId = `${prefix}-user`;
  const conversationId = `${prefix}-conversation`;

  // Tạo lớp và tài khoản riêng để kiểm thử trigger mà không thay đổi dữ liệu seed.
  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    prisma = moduleRef.get(PrismaService);
    const source = await prisma.learningClass.findFirstOrThrow();
    authorId = (await prisma.classInstructor.findFirstOrThrow()).instructorId;
    const learnerRole = await prisma.role.findUniqueOrThrow({ where: { code: "LEARNER" } });
    instructorRoleId = (await prisma.role.findUniqueOrThrow({ where: { code: "INSTRUCTOR" } })).id;
    await prisma.user.create({ data: { id: userId, username: userId, displayName: prefix,
      roles: { create: { roleId: learnerRole.id } } } });
    await prisma.learningClass.create({ data: { id: classId, code: classId, name: prefix, term: "test", capacity: 20,
      courseId: source.courseId, courseVersion: source.courseVersion, startAt: new Date(), endAt: new Date("2030-01-01"),
      instructors: { create: { instructorId: authorId, role: "PRIMARY", assignedBy: authorId } },
      enrollments: { create: { learnerId: userId } } } });
  });

  // Xóa hội thoại trước lớp/tài khoản để dọn toàn bộ fixture và lịch sử projection.
  afterAll(async () => {
    if (prisma) {
      await prisma.chatConversation.deleteMany({ where: { classId } });
      await prisma.learningClass.deleteMany({ where: { id: classId } });
      await prisma.user.deleteMany({ where: { id: userId } });
    }
    await moduleRef?.close();
  });

  it("bootstraps, revokes immediately, rolls back, restores and preserves read preferences", async () => {
    await prisma.chatConversation.create({ data: { id: conversationId, classId, type: "CLASS", createdById: authorId } });
    const key = { conversationId_userId: { conversationId, userId } };
    const initial = await prisma.chatConversationMember.findUniqueOrThrow({ where: key });
    expect(initial).toMatchObject({ status: "ACTIVE", roleSnapshot: "LEARNER" });
    const lastReadAt = new Date("2026-01-01");
    const mutedUntil = new Date("2030-01-01");
    await prisma.chatConversationMember.update({ where: key, data: { lastReadAt, mutedUntil } });
    await prisma.classEnrollment.updateMany({ where: { classId, learnerId: userId }, data: { status: "CANCELLED" } });
    const removed = await prisma.chatConversationMember.findUniqueOrThrow({ where: key });
    expect(removed.status).toBe("REMOVED");
    expect(removed.removedAt).not.toBeNull();
    await expect(prisma.$transaction(async (tx) => {
      await tx.classEnrollment.updateMany({ where: { classId, learnerId: userId }, data: { status: "ACTIVE" } });
      expect((await tx.chatConversationMember.findUniqueOrThrow({ where: key })).status).toBe("ACTIVE");
      throw new Error("rollback projection");
    })).rejects.toThrow("rollback projection");
    expect((await prisma.chatConversationMember.findUniqueOrThrow({ where: key })).removedAt).toEqual(removed.removedAt);
    await prisma.classEnrollment.updateMany({ where: { classId, learnerId: userId }, data: { status: "ACTIVE" } });
    expect(await prisma.chatConversationMember.findUniqueOrThrow({ where: key })).toMatchObject({
      status: "ACTIVE", removedAt: null, joinedAt: initial.joinedAt, lastReadAt, mutedUntil,
    });
    await prisma.userRole.create({ data: { userId, roleId: instructorRoleId } });
    expect((await prisma.chatConversationMember.findUniqueOrThrow({ where: key })).roleSnapshot).toBe("INSTRUCTOR");
    await prisma.classInstructor.create({ data: { classId, instructorId: userId, assignedBy: authorId } });
    await prisma.classEnrollment.deleteMany({ where: { classId, learnerId: userId } });
    expect((await prisma.chatConversationMember.findUniqueOrThrow({ where: key })).status).toBe("ACTIVE");
    await prisma.classInstructor.delete({ where: { classId_instructorId: { classId, instructorId: userId } } });
    expect((await prisma.chatConversationMember.findUniqueOrThrow({ where: key })).status).toBe("REMOVED");
  });

  it("serializes conversation creation with enrollment changes", async () => {
    await prisma.chatConversation.delete({ where: { id: conversationId } });
    await Promise.all([
      prisma.chatConversation.create({ data: { id: conversationId, classId, type: "CLASS", createdById: authorId } }),
      prisma.classEnrollment.create({ data: { classId, learnerId: userId } }),
    ]);
    expect(await prisma.chatConversationMember.findUniqueOrThrow({ where: { conversationId_userId: { conversationId, userId } } }))
      .toMatchObject({ status: "ACTIVE" });
  });
});
