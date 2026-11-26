import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";
import { Test, type TestingModule } from "@nestjs/testing";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../../src/app.module.js";
import type { AuthenticatedSession } from "../../src/auth/auth.service.js";
import { PrismaService } from "../../src/database/prisma.service.js";
import { ClassFeedService } from "../../src/domains/learning/class-feed/class-feed.service.js";
import { ObjectStorageService } from "../../src/infrastructure/object-storage.service.js";

/** Đọc toàn bộ luồng byte thành Buffer để kiểm tra nội dung tải về và HTTP Range. */
async function readStreamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

const VALID_PNG_BYTES = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53,
  0xde, 0x00, 0x00, 0x00, 0x0c, 0x49, 0x44, 0x41,
  0x54, 0x08, 0xd7, 0x63, 0xf8, 0xcf, 0xc0, 0x00,
  0x00, 0x03, 0x01, 0x01, 0x00, 0x18, 0xdd, 0x8d,
  0xb0, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e,
  0x44, 0xae, 0x42, 0x60, 0x82,
]);

describe("ClassFeedService tích hợp PostgreSQL thật: đăng bài đa vai trò, đính kèm, bình luận 2 tầng, thích và lịch sử sửa", () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let feed: ClassFeedService;
  let storage: ObjectStorageService;

  const prefix = `feed-${randomUUID().slice(0, 8)}`;
  const classId = `${prefix}-class`;
  const closedClassId = `${prefix}-closed`;
  const learnerAId = `${prefix}-learner-a`;
  const learnerBId = `${prefix}-learner-b`;
  const outsiderId = `${prefix}-outsider`;
  const instructorId = "usr-instructor";
  const managerId = "usr-manager";

  let sessionLearnerA: AuthenticatedSession;
  let sessionLearnerB: AuthenticatedSession;
  let sessionOutsider: AuthenticatedSession;
  let sessionInstructor: AuthenticatedSession;
  let sessionManager: AuthenticatedSession;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    prisma = moduleRef.get(PrismaService);
    feed = moduleRef.get(ClassFeedService);
    storage = moduleRef.get(ObjectStorageService);

    const sourceClass = await prisma.learningClass.findFirstOrThrow();
    const learnerRole = await prisma.role.findUniqueOrThrow({ where: { code: "LEARNER" } });

    await prisma.user.createMany({
      data: [
        { id: learnerAId, username: learnerAId, email: `${learnerAId}@test.local`, emailVerifiedAt: new Date(), displayName: "Feed Học viên A", status: "ACTIVE" },
        { id: learnerBId, username: learnerBId, email: `${learnerBId}@test.local`, emailVerifiedAt: new Date(), displayName: "Feed Học viên B", status: "ACTIVE" },
        { id: outsiderId, username: outsiderId, email: `${outsiderId}@test.local`, emailVerifiedAt: new Date(), displayName: "Feed Ngoài lớp", status: "ACTIVE" },
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
        name: `Lớp Bảng tin ${prefix}`,
        term: "test",
        capacity: 50,
        status: "ACTIVE",
        courseId: sourceClass.courseId,
        courseVersion: sourceClass.courseVersion,
        startAt: new Date(Date.now() - 86_400_000),
        endAt: new Date(Date.now() + 86_400_000 * 30),
        instructors: { create: { instructorId, role: "PRIMARY", assignedBy: instructorId } },
        enrollments: {
          create: [
            { learnerId: learnerAId, status: "ACTIVE", source: "TEST" },
            { learnerId: learnerBId, status: "ACTIVE", source: "TEST" },
          ],
        },
      },
    });
    await prisma.learningClass.create({
      data: {
        id: closedClassId,
        code: closedClassId,
        name: `Lớp đóng ${prefix}`,
        term: "test",
        capacity: 50,
        status: "CLOSED",
        courseId: sourceClass.courseId,
        courseVersion: sourceClass.courseVersion,
        startAt: new Date(Date.now() - 86_400_000 * 10),
        endAt: new Date(Date.now() - 86_400_000),
        instructors: { create: { instructorId, role: "PRIMARY", assignedBy: instructorId } },
        enrollments: { create: [{ learnerId: learnerAId, status: "ACTIVE", source: "TEST" }] },
      },
    });

    sessionLearnerA = {
      sessionId: `${prefix}-sess-a`,
      roleCode: "LEARNER",
      availableRoles: [{ code: "LEARNER", name: "Học viên" }],
      permissions: ["class:view"],
      user: { id: learnerAId, username: learnerAId, name: "Feed Học viên A", email: `${learnerAId}@test.local`, roleName: "Học viên", locale: "vi-VN", avatarUrl: null },
    };
    sessionLearnerB = {
      sessionId: `${prefix}-sess-b`,
      roleCode: "LEARNER",
      availableRoles: [{ code: "LEARNER", name: "Học viên" }],
      permissions: ["class:view"],
      user: { id: learnerBId, username: learnerBId, name: "Feed Học viên B", email: `${learnerBId}@test.local`, roleName: "Học viên", locale: "vi-VN", avatarUrl: null },
    };
    sessionOutsider = {
      sessionId: `${prefix}-sess-o`,
      roleCode: "LEARNER",
      availableRoles: [{ code: "LEARNER", name: "Học viên" }],
      permissions: ["class:view"],
      user: { id: outsiderId, username: outsiderId, name: "Feed Ngoài lớp", email: `${outsiderId}@test.local`, roleName: "Học viên", locale: "vi-VN", avatarUrl: null },
    };
    sessionInstructor = {
      sessionId: `${prefix}-sess-i`,
      roleCode: "INSTRUCTOR",
      availableRoles: [{ code: "INSTRUCTOR", name: "Giảng viên" }],
      permissions: ["class:view", "exam:manage"],
      user: { id: instructorId, username: "instructor", name: "Giảng viên", email: "instructor@test.local", roleName: "Giảng viên", locale: "vi-VN", avatarUrl: null },
    };
    sessionManager = {
      sessionId: `${prefix}-sess-m`,
      roleCode: "CENTER_MANAGER",
      availableRoles: [{ code: "CENTER_MANAGER", name: "Quản lý" }],
      permissions: ["class:view", "class:manage"],
      user: { id: managerId, username: "manager", name: "Quản lý", email: "manager@test.local", roleName: "Quản lý", locale: "vi-VN", avatarUrl: null },
    };
  });

  afterAll(async () => {
    const attachments = await prisma.classFeedAttachment.findMany({
      where: { post: { classId: { in: [classId, closedClassId] } } },
      select: { objectKey: true },
    });
    await Promise.allSettled(attachments.map((item) => storage.remove(item.objectKey)));
    await prisma.notification.deleteMany({
      where: { recipientId: { in: [learnerAId, learnerBId, outsiderId, instructorId] }, entityType: "CLASS_FEED_POST" },
    });
    await prisma.learningClass.deleteMany({ where: { id: { in: [classId, closedClassId] } } });
    await prisma.user.deleteMany({ where: { id: { in: [learnerAId, learnerBId, outsiderId] } } });
    await moduleRef.close();
  });

  it("mọi thành viên trong lớp (học viên, giảng viên, quản lý) đều đăng được bài kèm ảnh/tệp; chặn người ngoài lớp và lớp đã đóng", async () => {
    // Người ngoài lớp bị chặn 404 cả đọc lẫn ghi
    await expect(feed.listPosts(classId, sessionOutsider)).rejects.toBeInstanceOf(NotFoundException);
    await expect(feed.createPost(classId, "Lén đăng bài", [], sessionOutsider)).rejects.toBeInstanceOf(NotFoundException);

    // Lớp đã đóng chỉ cho đọc, chặn ghi 409
    expect(await feed.listPosts(closedClassId, sessionLearnerA)).toEqual([]);
    await expect(feed.createPost(closedClassId, "Ghi vào lớp đóng", [], sessionLearnerA)).rejects.toBeInstanceOf(ConflictException);

    // Chặn bài rỗng không nội dung và không tệp, chặn tệp giả mạo chữ ký HTML
    await expect(feed.createPost(classId, "   ", [], sessionLearnerA)).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      feed.createPost(
        classId,
        "Tệp giả mạo",
        [{ originalName: "fake.png", mimeType: "image/png", size: 24, buffer: Buffer.from("<html>alert(1)</html>") }],
        sessionLearnerA,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    // Học viên A đăng bài kèm 1 ảnh PNG + 1 tệp TXT thật
    const txtBuffer = Buffer.from("Đề cương ôn tập chương 1\nCâu 1: Hàm số", "utf8");
    const learnerPost = await feed.createPost(
      classId,
      "Em chia sẻ ảnh bảng và đề cương ôn tập ạ",
      [
        { originalName: "bang-lop.png", mimeType: "image/png", size: VALID_PNG_BYTES.length, buffer: VALID_PNG_BYTES },
        { originalName: "de-cuong.txt", mimeType: "text/plain", size: txtBuffer.length, buffer: txtBuffer },
      ],
      sessionLearnerA,
    );
    expect(learnerPost.authorRole).toBe("LEARNER");
    expect(learnerPost.attachments).toHaveLength(2);
    expect(learnerPost.attachments[0]?.isImage).toBe(true);
    expect(learnerPost.attachments[1]?.isImage).toBe(false);

    // Giảng viên và Quản lý cũng đăng được
    const managerPost = await feed.createPost(classId, "Thông báo lịch khai giảng từ quản lý", [], sessionManager);
    expect(managerPost.authorRole).toBe("CENTER_MANAGER");

    // Đọc luồng tệp có hỗ trợ HTTP Range cho thành viên lớp, chặn người ngoài lớp
    const txtAtt = learnerPost.attachments[1]!;
    const fullStream = await feed.readAttachmentStream(classId, learnerPost.id, txtAtt.id, sessionLearnerB);
    expect((await readStreamToBuffer(fullStream.stream)).toString("utf8")).toBe(txtBuffer.toString("utf8"));
    const rangeStream = await feed.readAttachmentStream(classId, learnerPost.id, txtAtt.id, sessionInstructor, "bytes=0-7");
    expect(rangeStream.range).toEqual({ start: 0, end: 7, length: 8 });
    expect((await readStreamToBuffer(rangeStream.stream)).length).toBe(8);
    await expect(feed.readAttachmentStream(classId, learnerPost.id, txtAtt.id, sessionOutsider)).rejects.toBeInstanceOf(NotFoundException);
  });

  it("hỗ trợ thích, bình luận 2 tầng, lịch sử chỉnh sửa thật, phân quyền sửa/xóa và ẩn/theo dõi bền vững trên PostgreSQL", async () => {
    const post = await feed.createPost(classId, "Nội dung ban đầu của học viên A", [], sessionLearnerA);

    // Học viên B không được sửa/xóa bài của học viên A
    await expect(feed.updatePost(classId, post.id, "Sửa trộm", sessionLearnerB)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(feed.deletePost(classId, post.id, sessionLearnerB)).rejects.toBeInstanceOf(ForbiddenException);

    // Học viên A tự sửa bài → lưu phiên bản cũ vào class_feed_post_edit_histories
    const edited = await feed.updatePost(classId, post.id, "Nội dung đã cập nhật lần 1", sessionLearnerA);
    expect(edited.isEdited).toBe(true);
    expect(edited.content).toBe("Nội dung đã cập nhật lần 1");
    expect(edited.editHistories).toHaveLength(1);
    expect(edited.editHistories[0]?.previousContent).toBe("Nội dung ban đầu của học viên A");

    // Thích / Bỏ thích bài viết nguyên tử
    expect(await feed.togglePostLike(classId, post.id, sessionLearnerB)).toEqual({ id: post.id, likes: 1, isLiked: true });
    expect(await feed.togglePostLike(classId, post.id, sessionInstructor)).toEqual({ id: post.id, likes: 2, isLiked: true });
    expect(await feed.togglePostLike(classId, post.id, sessionLearnerB)).toEqual({ id: post.id, likes: 1, isLiked: false });

    // Học viên B bật theo dõi, sau đó có bình luận cấp 1 và phản hồi cấp 2 (kể cả trả lời tiếp trên cấp 2 vẫn chuẩn hóa về cha cấp 1)
    expect(await feed.updatePostPreference(classId, post.id, { following: true }, sessionLearnerB)).toEqual({
      postId: post.id,
      isHidden: false,
      isFollowing: true,
    });
    const cmt1 = await feed.createComment(classId, post.id, { content: "Bình luận cấp 1 từ B" }, sessionLearnerB);
    const reply1 = await feed.createComment(
      classId,
      post.id,
      { content: "Phản hồi cấp 2 từ giảng viên", parentId: cmt1.id, replyToUserId: learnerBId, replyToName: "Feed Học viên B" },
      sessionInstructor,
    );
    const reply2 = await feed.createComment(
      classId,
      post.id,
      { content: "Trả lời tiếp phản hồi cấp 2", parentId: reply1.id },
      sessionLearnerA,
    );
    expect(reply1.parentId).toBe(cmt1.id);
    expect(reply2.parentId).toBe(cmt1.id);
    expect(reply2.replyToName).toBe(reply1.authorName);

    // Thích bình luận
    expect(await feed.toggleCommentLike(classId, post.id, reply1.id, sessionLearnerB)).toEqual({
      id: reply1.id,
      likes: 1,
      isLiked: true,
    });

    // Học viên B ẩn bài viết: danh sách mặc định không còn thấy, includeHidden=true vẫn thấy
    expect(await feed.updatePostPreference(classId, post.id, { hidden: true }, sessionLearnerB)).toEqual({
      postId: post.id,
      isHidden: true,
      isFollowing: true,
    });
    const visibleToB = await feed.listPosts(classId, sessionLearnerB);
    expect(visibleToB.some((item) => item.id === post.id)).toBe(false);
    const withHiddenToB = await feed.listPosts(classId, sessionLearnerB, { includeHidden: true });
    const loadedForB = withHiddenToB.find((item) => item.id === post.id);
    expect(loadedForB?.isHidden).toBe(true);
    expect(loadedForB?.comments[0]?.replies?.map((item) => item.id)).toEqual([reply1.id, reply2.id]);
    expect(loadedForB?.comments[0]?.replies?.[0]?.likes).toBe(1);

    // Giảng viên lớp được quyền kiểm duyệt xóa bài viết của học viên
    expect(await feed.deletePost(classId, post.id, sessionInstructor)).toEqual({ deleted: true, postId: post.id });
    const afterDelete = await feed.listPosts(classId, sessionInstructor, { includeHidden: true });
    expect(afterDelete.some((item) => item.id === post.id)).toBe(false);
  });
});
