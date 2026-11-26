import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type {
  ClassFeedAttachmentView,
  ClassFeedAuthorRole,
  ClassFeedCommentView,
  ClassFeedLikeToggleResult,
  ClassFeedPostView,
  ClassFeedPreferenceResult,
} from "@wind-of-fall/contracts";
import { randomUUID } from "node:crypto";
import type { Readable } from "node:stream";
import type { AuthenticatedSession } from "../../../auth/auth.service.js";
import { PrismaService } from "../../../database/prisma.service.js";
import type { Prisma } from "../../../generated/prisma/client.js";
import { AntivirusService } from "../../../infrastructure/antivirus.service.js";
import {
  assertSafeUpload,
  isInlineSafeMime,
} from "../../../infrastructure/file-signature.js";
import { normalizeMultipartFileName } from "../../../infrastructure/file-transfer.js";
import type { ByteRange } from "../../../infrastructure/http-range-stream.js";
import { ObjectStorageService } from "../../../infrastructure/object-storage.service.js";
import { isPrismaUniqueConstraintError } from "../../../infrastructure/prisma-errors.js";
import { openVerifiedObjectStream } from "../../../infrastructure/verified-download.js";

export interface UploadedFeedFile {
  originalName: string;
  mimeType: string;
  size: number;
  buffer: Buffer;
  path?: string;
}

const MAX_FEED_FILES = 5;
const MAX_FEED_FILE_BYTES = 10 * 1024 * 1024;
const ALLOWED_FEED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "application/pdf",
  "text/plain",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
]);

type FeedPostIncludeShape = {
  class: { select: { code: true } };
  author: {
    select: {
      id: true;
      displayName: true;
      avatarObjectKey: true;
      avatarUpdatedAt: true;
    };
  };
  attachments: { orderBy: { createdAt: "asc" } };
  likes: { where: { userId: string }; select: { userId: true } };
  _count: { select: { likes: true } };
  editHistories: {
    orderBy: { editedAt: "desc" };
    take: number;
    include: { editor: { select: { displayName: true } } };
  };
  preferences: {
    where: { userId: string };
    select: { hidden: true; following: true };
  };
  comments: {
    orderBy: { createdAt: "asc" };
    include: {
      author: {
        select: {
          id: true;
          displayName: true;
          avatarObjectKey: true;
          avatarUpdatedAt: true;
        };
      };
      likes: { where: { userId: string }; select: { userId: true } };
      _count: { select: { likes: true } };
    };
  };
};

/** Cấu hình include chuẩn khi tải bài viết bảng tin kèm đính kèm, lượt thích, lịch sử sửa, tùy chọn và bình luận. */
function FEED_POST_INCLUDE(userId: string): FeedPostIncludeShape {
  return {
    class: { select: { code: true } },
    author: {
      select: {
        id: true,
        displayName: true,
        avatarObjectKey: true,
        avatarUpdatedAt: true,
      },
    },
    attachments: { orderBy: { createdAt: "asc" } },
    likes: { where: { userId }, select: { userId: true } },
    _count: { select: { likes: true } },
    editHistories: {
      orderBy: { editedAt: "desc" },
      take: 20,
      include: { editor: { select: { displayName: true } } },
    },
    preferences: {
      where: { userId },
      select: { hidden: true, following: true },
    },
    comments: {
      orderBy: { createdAt: "asc" },
      include: {
        author: {
          select: {
            id: true,
            displayName: true,
            avatarObjectKey: true,
            avatarUpdatedAt: true,
          },
        },
        likes: { where: { userId }, select: { userId: true } },
        _count: { select: { likes: true } },
      },
    },
  };
}

type LoadedFeedPost = Prisma.ClassFeedPostGetPayload<{
  include: FeedPostIncludeShape;
}>;

type LoadedFeedComment = LoadedFeedPost["comments"][number];

@Injectable()
/** Xử lý nghiệp vụ Bảng tin lớp trên PostgreSQL: đăng bài, tệp đính kèm, bình luận đa tầng, lượt thích và lịch sử sửa. */
export class ClassFeedService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly objectStorage: ObjectStorageService,
    private readonly antivirus: AntivirusService,
  ) {}

  /** Liệt kê bài viết bảng tin của lớp kèm tệp đính kèm, bình luận 2 tầng, lượt thích và lịch sử chỉnh sửa. */
  async listPosts(
    classId: string,
    session: AuthenticatedSession,
    options: { includeHidden?: boolean; limit?: number } = {},
  ): Promise<ClassFeedPostView[]> {
    await this.requireClassAccess(classId, session, false);
    const limit = Math.min(Math.max(options.limit ?? 50, 1), 100);
    const rows = await this.prisma.classFeedPost.findMany({
      where: {
        classId,
        ...(options.includeHidden
          ? {}
          : {
              preferences: {
                none: { userId: session.user.id, hidden: true },
              },
            }),
      },
      include: FEED_POST_INCLUDE(session.user.id),
      orderBy: { createdAt: "desc" },
      take: limit,
    });
    return rows.map((row) => this.mapPost(row, session));
  }

  /** Đăng bài viết mới (mọi thành viên trong lớp đều đăng được) kèm tối đa 5 ảnh/tệp đính kèm và gửi thông báo lớp. */
  async createPost(
    classId: string,
    content: string | undefined,
    files: UploadedFeedFile[],
    session: AuthenticatedSession,
  ): Promise<ClassFeedPostView> {
    await this.requireClassAccess(classId, session, true);
    const normalizedContent = (content ?? "").trim();
    if (!normalizedContent && files.length === 0) {
      throw new BadRequestException(
        "Cần nhập nội dung hoặc đính kèm ít nhất một tệp.",
      );
    }
    await this.validateFiles(files);

    const stored: Array<
      UploadedFeedFile & { objectKey: string; checksum: string }
    > = [];
    try {
      for (const file of files) {
        const scan = file.path
          ? await this.antivirus.scanFile(file.path)
          : await this.antivirus.scan(file.buffer);
        if (!scan.clean) {
          throw new BadRequestException(
            `Tệp ${file.originalName} không an toàn và đã bị từ chối.`,
          );
        }
        const objectKey = `class-feed/${classId}/${session.user.id}/${randomUUID()}`;
        const saved = file.path
          ? await this.objectStorage.putFile(objectKey, file.path)
          : await this.objectStorage.put(objectKey, file.buffer);
        stored.push({ ...file, ...saved });
      }

      const created = await this.prisma.$transaction(async (transaction) => {
        const post = await transaction.classFeedPost.create({
          data: {
            id: `feed-post-${randomUUID()}`,
            classId,
            authorId: session.user.id,
            authorRole: session.roleCode,
            content: normalizedContent,
            ...(stored.length
              ? {
                  attachments: {
                    create: stored.map((file) => ({
                      id: `feed-file-${randomUUID()}`,
                      objectKey: file.objectKey,
                      originalName: normalizeMultipartFileName(
                        file.originalName,
                      ),
                      mimeType: file.mimeType,
                      sizeBytes: BigInt(file.size),
                      checksum: file.checksum,
                    })),
                  },
                }
              : {}),
          },
          include: FEED_POST_INCLUDE(session.user.id),
        });

        await this.notifyClassMembersOnNewPost(transaction, classId, post, session);
        return post;
      });

      return this.mapPost(created, session);
    } catch (error) {
      await Promise.allSettled(
        stored.map((file) => this.objectStorage.remove(file.objectKey)),
      );
      throw error;
    }
  }

  /** Cập nhật nội dung bài viết và lưu phiên bản cũ vào bảng lịch sử chỉnh sửa trong cùng transaction. */
  async updatePost(
    classId: string,
    postId: string,
    content: string,
    session: AuthenticatedSession,
  ): Promise<ClassFeedPostView> {
    await this.requireClassAccess(classId, session, true);
    const existing = await this.prisma.classFeedPost.findFirst({
      where: { id: postId, classId },
      include: { _count: { select: { attachments: true } } },
    });
    if (!existing) {
      throw new NotFoundException("Không tìm thấy bài viết trên bảng tin lớp.");
    }
    if (!this.canManageRecord(existing.authorId, session)) {
      throw new ForbiddenException(
        "Bạn không có quyền chỉnh sửa bài viết này.",
      );
    }

    const nextContent = content.trim();
    if (!nextContent && existing._count.attachments === 0) {
      throw new BadRequestException("Nội dung bài viết không được để trống.");
    }

    const updated = await this.prisma.$transaction(async (transaction) => {
      if (nextContent !== existing.content) {
        await transaction.classFeedPostEditHistory.create({
          data: {
            id: `feed-hist-${randomUUID()}`,
            postId: existing.id,
            editorId: session.user.id,
            previousContent: existing.content,
          },
        });
        return transaction.classFeedPost.update({
          where: { id: existing.id },
          data: { content: nextContent, isEdited: true },
          include: FEED_POST_INCLUDE(session.user.id),
        });
      }
      return transaction.classFeedPost.findUniqueOrThrow({
        where: { id: existing.id },
        include: FEED_POST_INCLUDE(session.user.id),
      });
    });

    return this.mapPost(updated, session);
  }

  /** Xóa bài viết khỏi cơ sở dữ liệu và dọn các tệp đính kèm tương ứng trên object storage sau khi commit. */
  async deletePost(
    classId: string,
    postId: string,
    session: AuthenticatedSession,
  ): Promise<{ deleted: true; postId: string }> {
    await this.requireClassAccess(classId, session, true);
    const existing = await this.prisma.classFeedPost.findFirst({
      where: { id: postId, classId },
      include: { attachments: { select: { objectKey: true } } },
    });
    if (!existing) {
      throw new NotFoundException("Không tìm thấy bài viết trên bảng tin lớp.");
    }
    if (!this.canManageRecord(existing.authorId, session)) {
      throw new ForbiddenException("Bạn không có quyền xóa bài viết này.");
    }

    await this.prisma.classFeedPost.delete({ where: { id: existing.id } });
    if (existing.attachments.length) {
      await Promise.allSettled(
        existing.attachments.map((file) =>
          this.objectStorage.remove(file.objectKey),
        ),
      );
    }
    return { deleted: true, postId: existing.id };
  }

  /** Chuyển đổi trạng thái Thích / Bỏ thích bài viết bằng khóa chính kép trong transaction. */
  async togglePostLike(
    classId: string,
    postId: string,
    session: AuthenticatedSession,
  ): Promise<ClassFeedLikeToggleResult> {
    await this.requireClassAccess(classId, session, true);
    const post = await this.prisma.classFeedPost.findFirst({
      where: { id: postId, classId },
      select: { id: true },
    });
    if (!post) {
      throw new NotFoundException("Không tìm thấy bài viết trên bảng tin lớp.");
    }

    return this.prisma.$transaction(async (transaction) => {
      const removed = await transaction.classFeedPostLike.deleteMany({
        where: { postId, userId: session.user.id },
      });
      let isLiked = false;
      if (removed.count === 0) {
        try {
          await transaction.classFeedPostLike.create({
            data: { postId, userId: session.user.id },
          });
        } catch (error) {
          if (!isPrismaUniqueConstraintError(error)) throw error;
        }
        isLiked = true;
      }
      const likes = await transaction.classFeedPostLike.count({
        where: { postId },
      });
      return { id: postId, likes, isLiked };
    });
  }

  /** Lưu trạng thái ẩn hoặc theo dõi bài viết riêng cho tài khoản hiện tại. */
  async updatePostPreference(
    classId: string,
    postId: string,
    input: { hidden?: boolean; following?: boolean },
    session: AuthenticatedSession,
  ): Promise<ClassFeedPreferenceResult> {
    await this.requireClassAccess(classId, session, false);
    const post = await this.prisma.classFeedPost.findFirst({
      where: { id: postId, classId },
      select: { id: true },
    });
    if (!post) {
      throw new NotFoundException("Không tìm thấy bài viết trên bảng tin lớp.");
    }
    const updated = await this.prisma.classFeedPostPreference.upsert({
      where: { postId_userId: { postId, userId: session.user.id } },
      create: {
        postId,
        userId: session.user.id,
        hidden: input.hidden ?? false,
        following: input.following ?? false,
      },
      update: {
        ...(input.hidden !== undefined ? { hidden: input.hidden } : {}),
        ...(input.following !== undefined
          ? { following: input.following }
          : {}),
      },
    });
    return {
      postId,
      isHidden: updated.hidden,
      isFollowing: updated.following,
    };
  }

  /** Thêm bình luận cấp 1 hoặc phản hồi con cấp 2 (tự chuẩn hóa về tối đa 2 cấp) và phát thông báo cho người liên quan. */
  async createComment(
    classId: string,
    postId: string,
    input: {
      content: string;
      parentId?: string;
      replyToUserId?: string;
      replyToName?: string;
    },
    session: AuthenticatedSession,
  ): Promise<ClassFeedCommentView> {
    await this.requireClassAccess(classId, session, true);
    const trimmed = input.content.trim();
    if (!trimmed) {
      throw new BadRequestException("Nội dung bình luận không được để trống.");
    }
    const post = await this.prisma.classFeedPost.findFirst({
      where: { id: postId, classId },
      select: {
        id: true,
        authorId: true,
        preferences: {
          where: { following: true },
          select: { userId: true },
        },
      },
    });
    if (!post) {
      throw new NotFoundException("Không tìm thấy bài viết trên bảng tin lớp.");
    }

    let effectiveParentId: string | null = null;
    let effectiveReplyToUserId: string | null = input.replyToUserId ?? null;
    let effectiveReplyToName: string | null = input.replyToName?.trim() || null;

    if (input.parentId) {
      const parent = await this.prisma.classFeedComment.findFirst({
        where: { id: input.parentId, postId },
        include: { author: { select: { id: true, displayName: true } } },
      });
      if (!parent) {
        throw new NotFoundException("Không tìm thấy bình luận cần trả lời.");
      }
      // Giữ cấu trúc tối đa 2 tầng giống giao diện gốc: trả lời một phản hồi cấp 2 sẽ gắn cùng cha cấp 1.
      effectiveParentId = parent.parentId ?? parent.id;
      if (!effectiveReplyToName) {
        effectiveReplyToName = parent.author.displayName;
      }
      if (!effectiveReplyToUserId) {
        effectiveReplyToUserId = parent.author.id;
      }
    }

    const created = await this.prisma.$transaction(async (transaction) => {
      const comment = await transaction.classFeedComment.create({
        data: {
          id: `feed-cmt-${randomUUID()}`,
          postId,
          parentId: effectiveParentId,
          authorId: session.user.id,
          authorRole: session.roleCode,
          replyToUserId: effectiveReplyToUserId,
          replyToName: effectiveReplyToName,
          content: trimmed,
        },
        include: {
          author: {
            select: {
              id: true,
              displayName: true,
              avatarObjectKey: true,
              avatarUpdatedAt: true,
            },
          },
          likes: { where: { userId: session.user.id }, select: { userId: true } },
          _count: { select: { likes: true } },
        },
      });

      const recipients = new Set<string>([
        post.authorId,
        ...post.preferences.map((pref) => pref.userId),
      ]);
      if (effectiveReplyToUserId) recipients.add(effectiveReplyToUserId);
      recipients.delete(session.user.id);

      if (recipients.size > 0) {
        const preview = trimmed.length > 80 ? `${trimmed.slice(0, 77)}...` : trimmed;
        await transaction.notification.createMany({
          data: [...recipients].map((recipientId) => ({
            id: `notification-${randomUUID()}`,
            recipientId,
            type: "CLASS_FEED_COMMENT",
            title: `${session.user.name} đã bình luận trên bảng tin: ${preview}`,
            entityType: "CLASS_FEED_POST",
            entityId: postId,
            dedupKey: `class-feed-comment:${comment.id}:${recipientId}`,
          })),
        });
      }

      return comment;
    });

    return this.mapComment(created, session, effectiveParentId ? undefined : []);
  }

  /** Xóa bình luận (và tự động cascade các phản hồi con nếu là bình luận cấp 1). */
  async deleteComment(
    classId: string,
    postId: string,
    commentId: string,
    session: AuthenticatedSession,
  ): Promise<{ deleted: true; commentId: string }> {
    await this.requireClassAccess(classId, session, true);
    const existing = await this.prisma.classFeedComment.findFirst({
      where: { id: commentId, postId, post: { classId } },
      select: { id: true, authorId: true },
    });
    if (!existing) {
      throw new NotFoundException("Không tìm thấy bình luận cần xóa.");
    }
    if (!this.canManageRecord(existing.authorId, session)) {
      throw new ForbiddenException("Bạn không có quyền xóa bình luận này.");
    }
    await this.prisma.classFeedComment.delete({ where: { id: existing.id } });
    return { deleted: true, commentId: existing.id };
  }

  /** Chuyển đổi trạng thái Thích / Bỏ thích một bình luận (cấp 1 hoặc cấp 2). */
  async toggleCommentLike(
    classId: string,
    postId: string,
    commentId: string,
    session: AuthenticatedSession,
  ): Promise<ClassFeedLikeToggleResult> {
    await this.requireClassAccess(classId, session, true);
    const comment = await this.prisma.classFeedComment.findFirst({
      where: { id: commentId, postId, post: { classId } },
      select: { id: true },
    });
    if (!comment) {
      throw new NotFoundException("Không tìm thấy bình luận.");
    }

    return this.prisma.$transaction(async (transaction) => {
      const removed = await transaction.classFeedCommentLike.deleteMany({
        where: { commentId, userId: session.user.id },
      });
      let isLiked = false;
      if (removed.count === 0) {
        try {
          await transaction.classFeedCommentLike.create({
            data: { commentId, userId: session.user.id },
          });
        } catch (error) {
          if (!isPrismaUniqueConstraintError(error)) throw error;
        }
        isLiked = true;
      }
      const likes = await transaction.classFeedCommentLike.count({
        where: { commentId },
      });
      return { id: commentId, likes, isLiked };
    });
  }

  /** Mở luồng đọc tệp đính kèm bảng tin có hỗ trợ HTTP Range sau khi kiểm tra quyền thành viên lớp. */
  async readAttachmentStream(
    classId: string,
    postId: string,
    attachmentId: string,
    session: AuthenticatedSession,
    rangeHeader?: string,
  ): Promise<{
    stream: Readable;
    totalSize: number;
    range?: ByteRange;
    fileName: string;
    mimeType: string;
  }> {
    await this.requireClassAccess(classId, session, false);
    const attachment = await this.prisma.classFeedAttachment.findFirst({
      where: { id: attachmentId, postId, post: { classId } },
    });
    if (!attachment) {
      throw new NotFoundException("Không tìm thấy tệp đính kèm trên bảng tin.");
    }
    const opened = await openVerifiedObjectStream({
      objectStorage: this.objectStorage,
      objectKey: attachment.objectKey,
      expectedSize: Number(attachment.sizeBytes),
      rangeHeader,
    });
    return {
      ...opened,
      fileName: attachment.originalName,
      mimeType: attachment.mimeType,
    };
  }

  /** Kiểm tra quyền thành viên lớp trong 1 truy vấn duy nhất và chặn thao tác ghi khi lớp đã đóng. */
  private async requireClassAccess(
    classId: string,
    session: AuthenticatedSession,
    requireWritable: boolean,
  ): Promise<{ id: string; code: string; status: string }> {
    const where: Prisma.LearningClassWhereInput =
      session.roleCode === "SYSTEM_ADMIN" ||
      session.roleCode === "CENTER_MANAGER"
        ? { id: classId }
        : session.roleCode === "INSTRUCTOR"
          ? {
              id: classId,
              instructors: { some: { instructorId: session.user.id } },
            }
          : {
              id: classId,
              enrollments: {
                some: { learnerId: session.user.id, status: "ACTIVE" },
              },
            };

    const classRow = await this.prisma.learningClass.findFirst({
      where,
      select: { id: true, code: true, status: true },
    });
    if (!classRow) {
      throw new NotFoundException(
        "Không tìm thấy lớp học trong phạm vi truy cập.",
      );
    }
    if (requireWritable && classRow.status === "CLOSED") {
      throw new ConflictException("Lớp đã lưu trữ và chỉ cho phép đọc.");
    }
    return classRow;
  }

  /** Tác giả, giảng viên được phân công trong lớp hoặc quản lý/quản trị được phép sửa/xóa bản ghi bảng tin. */
  private canManageRecord(
    authorId: string,
    session: AuthenticatedSession,
  ): boolean {
    return (
      authorId === session.user.id ||
      session.roleCode === "INSTRUCTOR" ||
      session.roleCode === "CENTER_MANAGER" ||
      session.roleCode === "SYSTEM_ADMIN"
    );
  }

  /** Kiểm tra giới hạn số lượng, dung lượng, định dạng và magic bytes của các tệp đính kèm bảng tin. */
  private async validateFiles(files: UploadedFeedFile[]): Promise<void> {
    if (files.length > MAX_FEED_FILES) {
      throw new BadRequestException(
        `Mỗi bài viết chỉ được đính kèm tối đa ${MAX_FEED_FILES} tệp.`,
      );
    }
    for (const file of files) {
      const cleanName = file.originalName.trim();
      if (!cleanName || cleanName.length > 255) {
        throw new BadRequestException("Tên tệp đính kèm không hợp lệ.");
      }
      if (file.size <= 0 || file.size > MAX_FEED_FILE_BYTES) {
        throw new BadRequestException(
          `Tệp ${file.originalName} phải có dung lượng từ 1 byte đến 10 MB.`,
        );
      }
      if (!file.path && file.buffer.length !== file.size) {
        throw new BadRequestException(
          `Kích thước tệp ${file.originalName} không khớp dữ liệu tải lên.`,
        );
      }
      if (!ALLOWED_FEED_MIME_TYPES.has(file.mimeType.toLowerCase())) {
        throw new BadRequestException(
          `Định dạng tệp ${file.originalName} không được hỗ trợ trên bảng tin.`,
        );
      }
      await assertSafeUpload(file);
    }
  }

  /** Gửi thông báo hệ thống tới các thành viên đang hoạt động khác trong lớp khi có bài viết mới. */
  private async notifyClassMembersOnNewPost(
    transaction: Prisma.TransactionClient,
    classId: string,
    post: LoadedFeedPost,
    session: AuthenticatedSession,
  ): Promise<void> {
    const members = await transaction.learningClass.findUnique({
      where: { id: classId },
      include: {
        instructors: { select: { instructorId: true } },
        enrollments: {
          where: { status: "ACTIVE" },
          select: { learnerId: true },
        },
      },
    });
    const recipients = new Set<string>([
      ...(members?.instructors.map((item) => item.instructorId) ?? []),
      ...(members?.enrollments.map((item) => item.learnerId) ?? []),
    ]);
    recipients.delete(session.user.id);
    if (!recipients.size) return;

    const snippet = post.content
      ? post.content.length > 80
        ? `${post.content.slice(0, 77)}...`
        : post.content
      : `Đã gửi ${post.attachments.length} tệp đính kèm`;
    await transaction.notification.createMany({
      data: [...recipients].map((recipientId) => ({
        id: `notification-${randomUUID()}`,
        recipientId,
        type: "CLASS_FEED_POST",
        title: `Bảng tin lớp ${post.class.code}: ${session.user.name} — ${snippet}`,
        entityType: "CLASS_FEED_POST",
        entityId: post.id,
        dedupKey: `class-feed-post:${post.id}:${recipientId}`,
      })),
    });
  }

  /** Chuyển bản ghi bài viết từ Prisma sang view model hoàn chỉnh kèm cây bình luận 2 tầng. */
  private mapPost(
    row: LoadedFeedPost,
    session: AuthenticatedSession,
  ): ClassFeedPostView {
    const repliesByParent = new Map<string, ClassFeedCommentView[]>();
    const topComments: LoadedFeedComment[] = [];

    for (const comment of row.comments) {
      if (comment.parentId) {
        const bucket = repliesByParent.get(comment.parentId) ?? [];
        bucket.push(this.mapComment(comment, session));
        repliesByParent.set(comment.parentId, bucket);
      } else {
        topComments.push(comment);
      }
    }

    const canManage = this.canManageRecord(row.authorId, session);
    const preference = row.preferences[0];

    return {
      id: row.id,
      classId: row.classId,
      classCode: row.class.code,
      authorId: row.authorId,
      authorName: row.author.displayName,
      authorAvatarUrl: this.avatarUrl(row.author),
      authorRole: this.normalizeAuthorRole(row.authorRole),
      content: row.content,
      attachments: row.attachments.map((file) => this.mapAttachment(file)),
      likes: row._count.likes,
      isLiked: row.likes.length > 0,
      isEdited: row.isEdited,
      isHidden: preference?.hidden ?? false,
      isFollowing: preference?.following ?? false,
      canEdit: canManage,
      canDelete: canManage,
      editHistories: row.editHistories.map((history) => ({
        id: history.id,
        previousContent: history.previousContent,
        editorName: history.editor.displayName,
        editedAt: history.editedAt.toISOString(),
      })),
      comments: topComments.map((comment) =>
        this.mapComment(comment, session, repliesByParent.get(comment.id) ?? []),
      ),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  /** Chuyển bản ghi bình luận sang view model dùng chung giữa API và giao diện web. */
  private mapComment(
    row: LoadedFeedComment,
    session: AuthenticatedSession,
    replies?: ClassFeedCommentView[],
  ): ClassFeedCommentView {
    return {
      id: row.id,
      postId: row.postId,
      parentId: row.parentId,
      authorId: row.authorId,
      authorName: row.author.displayName,
      authorAvatarUrl: this.avatarUrl(row.author),
      authorRole: this.normalizeAuthorRole(row.authorRole),
      replyToUserId: row.replyToUserId,
      replyToName: row.replyToName,
      content: row.content,
      likes: row._count.likes,
      isLiked: row.likes.length > 0,
      isEdited: row.isEdited,
      canDelete: this.canManageRecord(row.authorId, session),
      createdAt: row.createdAt.toISOString(),
      ...(replies !== undefined ? { replies } : {}),
    };
  }

  /** Ánh xạ metadata tệp đính kèm kèm cờ nhận diện ảnh và khả năng xem trước trực tiếp. */
  private mapAttachment(
    file: LoadedFeedPost["attachments"][number],
  ): ClassFeedAttachmentView {
    const mimeType = file.mimeType.toLowerCase();
    return {
      id: file.id,
      originalName: file.originalName,
      mimeType: file.mimeType,
      sizeBytes: Number(file.sizeBytes),
      createdAt: file.createdAt.toISOString(),
      isImage: mimeType.startsWith("image/"),
      canPreview: isInlineSafeMime(mimeType),
    };
  }

  /** Chuẩn hóa mã vai trò tác giả về tập vai trò hợp lệ của hệ thống. */
  private normalizeAuthorRole(role: string): ClassFeedAuthorRole {
    if (
      role === "SYSTEM_ADMIN" ||
      role === "CENTER_MANAGER" ||
      role === "INSTRUCTOR" ||
      role === "LEARNER"
    ) {
      return role;
    }
    return "LEARNER";
  }

  /** Tạo đường dẫn avatar công khai có tham số phiên bản để tránh cache cũ khi người dùng đổi ảnh. */
  private avatarUrl(user: {
    id: string;
    avatarObjectKey: string | null;
    avatarUpdatedAt: Date | null;
  }): string | null {
    return user.avatarObjectKey
      ? `/account/users/${encodeURIComponent(user.id)}/avatar?v=${user.avatarUpdatedAt?.getTime() ?? 0}`
      : null;
  }
}
