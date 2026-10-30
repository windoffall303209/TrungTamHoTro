import { Test, type TestingModule } from "@nestjs/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AuthenticatedSession } from "../src/auth/auth.service.js";
import { PrismaService } from "../src/database/prisma.service.js";
import { ChatService } from "../src/domains/learning/chat.service.js";
import { AppModule } from "../src/app.module.js";

const instructor: AuthenticatedSession = { sessionId: "chat-instructor", user: { id: "usr-instructor", username: "instructor", name: "Trần Giảng Viên", email: "instructor@wind.edu.vn", roleName: "Giảng viên" }, roleCode: "INSTRUCTOR", permissions: [], availableRoles: [{ code: "INSTRUCTOR", name: "Giảng viên" }] };

describe("ChatService", () => {
  let service: ChatService;
  let prisma: PrismaService;
  let module: TestingModule;
  let learner: AuthenticatedSession;
  let conversationId = "";
  const testLearnerId = `usr-chat-test-${process.pid}-${Date.now()}`;

  beforeAll(async () => {
    module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    service = module.get(ChatService);
    prisma = module.get(PrismaService);
    const learnerRole = await prisma.role.findUniqueOrThrow({ where: { code: "LEARNER" } });
    const username = `chat.test.${process.pid}.${Date.now()}`;
    await prisma.user.create({
      data: {
        id: testLearnerId,
        username,
        email: `${username}@wind.edu.vn`,
        displayName: "Học viên Chat Test",
        status: "ACTIVE",
        emailVerifiedAt: new Date(),
        roles: { create: { roleId: learnerRole.id } },
      },
    });
    await prisma.classEnrollment.create({ data: { classId: "class-web-01", learnerId: testLearnerId, status: "ACTIVE", source: "TEST" } });
    learner = { sessionId: "chat-learner", user: { id: testLearnerId, username, name: "Học viên Chat Test", email: `${username}@wind.edu.vn`, roleName: "Học viên" }, roleCode: "LEARNER", permissions: [], availableRoles: [{ code: "LEARNER", name: "Học viên" }] };
  });

  afterAll(async () => {
    if (conversationId) {
      await prisma.notification.deleteMany({ where: { entityType: "CHAT_CONVERSATION", entityId: conversationId } });
      await prisma.chatConversation.deleteMany({ where: { id: conversationId } });
    }
    await prisma.userBlock.deleteMany({ where: { blockerId: learner.user.id, blockedId: instructor.user.id } });
    await prisma.classEnrollment.deleteMany({ where: { learnerId: testLearnerId } });
    await prisma.user.deleteMany({ where: { id: testLearnerId } });
    await module.close();
  });

  it("tìm tên không dấu và không lộ người ngoài quan hệ lớp", async () => {
    const rows = await service.directory(instructor, "hoc vien chat test");
    expect(rows).toEqual(expect.arrayContaining([expect.objectContaining({ id: learner.user.id, roleCode: "LEARNER" })]));
    expect(rows.every((item) => item.sharedClasses.some((classItem) => classItem.id === "class-web-01"))).toBe(true);
  });

  it("mở chat riêng idempotent, gửi retry không trùng và đồng bộ chưa đọc", async () => {
    const first = await service.openDirect(instructor, learner.user.id);
    const second = await service.openDirect(instructor, learner.user.id);
    conversationId = first.id;
    expect(second.id).toBe(first.id);
    const clientMessageId = `chat-test-${Date.now()}`;
    const sent = await service.sendMessage(first.id, { clientMessageId, content: "Em kiểm tra lại yêu cầu bài tập nhé." }, instructor);
    expect((await service.sendMessage(first.id, { clientMessageId, content: "Em kiểm tra lại yêu cầu bài tập nhé." }, instructor)).id).toBe(sent.id);
    expect((await service.listConversations(learner)).find((item) => item.id === first.id)?.unreadCount).toBe(1);
    await service.markRead(first.id, learner);
    expect((await service.listConversations(learner)).find((item) => item.id === first.id)?.unreadCount).toBe(0);
    const reply = await service.sendMessage(first.id, { clientMessageId: `${clientMessageId}-reply`, content: "Em đã nhận được ạ.", replyToId: sent.id }, learner);
    expect(reply.replyTo?.id).toBe(sent.id);
  });

  it("tìm tin, tắt thông báo, nhắc tên, gắn context, báo cáo và chặn liên hệ", async () => {
    const conversation = await service.openDirect(instructor, learner.user.id);
    conversationId = conversation.id;
    const sent = await service.sendMessage(conversation.id, { clientMessageId: `chat-features-${Date.now()}`, content: "Xem lại đề giữa kỳ trong ngữ cảnh này.", mentionedUserIds: [learner.user.id], contextType: "EXAM", contextId: "exam-mid-web" }, instructor);
    expect(sent.mentionedUserIds).toEqual([learner.user.id]);
    expect(sent.context).toMatchObject({ type: "EXAM", id: "exam-mid-web" });
    expect((await service.searchMessages(conversation.id, "giữa kỳ", learner))[0]?.id).toBe(sent.id);
    expect((await service.muteConversation(conversation.id, new Date(Date.now() + 3_600_000).toISOString(), learner)).mutedUntil).toBeTruthy();
    expect((await service.reportMessage(sent.id, "Nội dung cần bộ phận kiểm duyệt xem xét", learner)).status).toBe("OPEN");
    await service.blockUser(instructor.user.id, "Tạm dừng liên hệ", learner);
    await expect(service.sendMessage(conversation.id, { clientMessageId: `chat-blocked-${Date.now()}`, content: "Tin không được gửi" }, instructor)).rejects.toThrow("đã chặn");
    await service.unblockUser(instructor.user.id, learner);
  });
});
