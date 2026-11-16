import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "../../../../generated/prisma/client.js";
import {
  paginateArray,
  type PaginatedResult,
} from "../../../../common/pagination.js";
import { id, now } from "../../core/learning.shared.js";
import type { ForumPost, ForumTopic } from "../../core/learning.types.js";
import type { LearningServiceContext } from "../../core/learning.context.js";

export interface ForumTopicPageFilters {
  classId?: string;
  query?: string;
  pinnedOnly?: boolean;
  mineOnly?: boolean;
  page?: number;
  pageSize?: number;
}

export interface ForumPostPageResult extends PaginatedResult<ForumPost> {
  totalPosts: number;
}

/** Tạo biểu thức Prisma giới hạn chủ đề diễn đàn theo vai trò và quan hệ lớp. */
function buildTopicRoleWhere(
  role: string,
  actorId: string,
): Prisma.ForumTopicWhereInput | undefined {
  if (role === "LEARNER") {
    return {
      status: "PUBLISHED",
      class: { enrollments: { some: { learnerId: actorId, status: "ACTIVE" } } },
    };
  }
  if (role === "INSTRUCTOR") {
    return { class: { instructors: { some: { instructorId: actorId } } } };
  }
  return undefined;
}

/** Kiểm tra chủ đề có thuộc phạm vi lớp của người dùng trong bộ nhớ fallback hay không. */
function canAccessMemoryTopic(
  serviceContext: LearningServiceContext,
  item: ForumTopic,
  role: string,
  actorId: string,
): boolean {
  const classItem = serviceContext.classes.find(
    (candidate) => candidate.id === item.classId,
  );
  if (role === "LEARNER") {
    return item.status === "VISIBLE" && Boolean(classItem?.learnerIds.includes(actorId));
  }
  if (role === "INSTRUCTOR") {
    return Boolean(classItem?.instructorIds.includes(actorId));
  }
  return true;
}

/** Kiểm tra quyền đọc một chủ đề cụ thể trước khi đọc danh sách bài viết của chủ đề đó. */
async function assertTopicReadAccess(
  serviceContext: LearningServiceContext,
  topicId: string,
  role: string,
  actorId: string,
): Promise<void> {
  const prisma = serviceContext.database();
  if (prisma) {
    const topic = await prisma.forumTopic.findUnique({
      where: { id: topicId },
      include: {
        class: { include: { enrollments: true, instructors: true } },
      },
    });
    if (!topic) throw new NotFoundException("Không tìm thấy chủ đề.");
    if (role === "LEARNER" && topic.status !== "PUBLISHED") {
      throw new NotFoundException("Không tìm thấy chủ đề trong lớp đã ghi danh.");
    }
    serviceContext.assertForumClassAccess(topic.class, role, actorId);
    return;
  }
  const topic = serviceContext.findTopic(topicId);
  if (role === "LEARNER" && topic.status !== "VISIBLE") {
    throw new NotFoundException("Không tìm thấy chủ đề trong lớp đã ghi danh.");
  }
  serviceContext.assertMemoryForumClassAccess(topic.classId, role, actorId);
}

/** Liệt kê chủ đề theo lớp truy cập được, ưu tiên chủ đề ghim rồi mới theo cập nhật. */
export async function listTopics(
  serviceContext: LearningServiceContext,
  role = "LEARNER",
  actorId = serviceContext.userIdForRole(role),
): Promise<ForumTopic[]> {
  const prisma = serviceContext.database();
  if (prisma) {
    const rows = await prisma.forumTopic.findMany({
      where: buildTopicRoleWhere(role, actorId),
      orderBy: [{ isPinned: "desc" }, { createdAt: "desc" }],
    });
    return rows.map((row) => serviceContext.mapTopic(row));
  }
  return serviceContext.topics
    .filter((item) => canAccessMemoryTopic(serviceContext, item, role, actorId))
    .map((item) => ({ ...item, tags: [...item.tags] }));
}

/** Phân trang chủ đề diễn đàn từ DB kèm lọc lớp, ghim, bài của tôi và tìm kiếm cả tiêu đề, nội dung lẫn tags. */
export async function listTopicsPage(
  serviceContext: LearningServiceContext,
  role = "LEARNER",
  actorId = serviceContext.userIdForRole(role),
  filters: ForumTopicPageFilters = {},
): Promise<PaginatedResult<ForumTopic>> {
  const query = filters.query?.trim();
  const classId = filters.classId?.trim();
  if ((query && query.length > 255) || (classId && classId.length > 255)) {
    throw new BadRequestException("Search filters must not exceed 255 characters.");
  }
  const page =
    Number.isSafeInteger(filters.page) &&
    (filters.page ?? 0) > 0 &&
    (filters.page ?? 0) <= 100_000
      ? (filters.page as number)
      : 1;
  const pageSize =
    Number.isInteger(filters.pageSize) && (filters.pageSize ?? 0) > 0
      ? Math.min(filters.pageSize as number, 100)
      : 10;
  const prisma = serviceContext.database();
  if (prisma) {
    const conditions: Prisma.Sql[] = [];
    if (role === "LEARNER") {
      conditions.push(
        Prisma.sql`ft.status::text = 'PUBLISHED' AND EXISTS (SELECT 1 FROM class_enrollments e WHERE e.class_id = ft.class_id AND e.learner_id = ${actorId} AND e.status = 'ACTIVE')`,
      );
    } else if (role === "INSTRUCTOR") {
      conditions.push(
        Prisma.sql`EXISTS (SELECT 1 FROM class_instructors i WHERE i.class_id = ft.class_id AND i.instructor_id = ${actorId})`,
      );
    }
    if (classId) conditions.push(Prisma.sql`ft.class_id = ${classId}`);
    if (filters.pinnedOnly) conditions.push(Prisma.sql`ft.is_pinned = TRUE`);
    if (filters.mineOnly) conditions.push(Prisma.sql`ft.author_id = ${actorId}`);
    if (query) {
      const pattern = `%${query.replace(/[\\%_]/g, "\\$&")}%`;
      const tags = Prisma.sql`jsonb_array_elements_text(CASE WHEN jsonb_typeof(ft.tags) = 'array' THEN ft.tags ELSE '[]'::jsonb END)`;
      conditions.push(
        Prisma.sql`(ft.title ILIKE ${pattern} OR ft.body ILIKE ${pattern} OR EXISTS (SELECT 1 FROM ${tags} AS tg(value) WHERE tg.value ILIKE ${pattern}))`,
      );
    }
    const where = conditions.length
      ? Prisma.join(conditions, " AND ")
      : Prisma.sql`TRUE`;
    const { rows, total, safePage, totalPages } = await prisma.$transaction(
      async (transaction) => {
        const counts = await transaction.$queryRaw<{ count: bigint }[]>(
          Prisma.sql`SELECT COUNT(*) AS count FROM forum_topics ft WHERE ${where}`,
        );
        const total = Number(counts[0]?.count ?? 0n);
        const totalPages = Math.max(1, Math.ceil(total / pageSize));
        const safePage = Math.min(page, totalPages);
        if (total === 0) {
          return { rows: [], total: 0, safePage, totalPages };
        }
        const offset = (safePage - 1) * pageSize;
        const ids = await transaction.$queryRaw<{ id: string }[]>(
          Prisma.sql`SELECT ft.id FROM forum_topics ft WHERE ${where} ORDER BY ft.is_pinned DESC, ft.created_at DESC, ft.id ASC LIMIT ${pageSize} OFFSET ${offset}`,
        );
        const rows =
          ids.length === 0
            ? []
            : await transaction.forumTopic.findMany({
                where: { id: { in: ids.map((item) => item.id) } },
                orderBy: [{ isPinned: "desc" }, { createdAt: "desc" }, { id: "asc" }],
              });
        return { rows, total, safePage, totalPages };
      },
      { isolationLevel: "RepeatableRead" },
    );
    return {
      items: rows.map((row) => serviceContext.mapTopic(row)),
      total,
      page: safePage,
      pageSize,
      totalPages,
    };
  }
  const normalizedQuery = query?.toLowerCase() ?? "";
  const filtered = serviceContext.topics
    .filter(
      (item) =>
        canAccessMemoryTopic(serviceContext, item, role, actorId) &&
        (!classId || item.classId === classId) &&
        (!filters.pinnedOnly || item.isPinned) &&
        (!filters.mineOnly || item.authorId === actorId) &&
        (!normalizedQuery ||
          item.title.toLowerCase().includes(normalizedQuery) ||
          item.body.toLowerCase().includes(normalizedQuery) ||
          item.tags.some((tag) => tag.toLowerCase().includes(normalizedQuery))),
    )
    .sort((a, b) => Number(b.isPinned) - Number(a.isPinned) || b.createdAt.localeCompare(a.createdAt))
    .map((item) => ({ ...item, tags: [...item.tags] }));
  return paginateArray(filtered, page, pageSize);
}

/** Kiểm tra thành viên/chính sách nội dung rồi tạo chủ đề và thông báo thành viên lớp. */
export async function createTopic(
  serviceContext: LearningServiceContext,
  classId: string,
  input: Pick<ForumTopic, "title" | "body" | "tags" | "isPinned">,
  authorId = "usr-instructor",
  authorRole = authorId === "usr-learner" ? "LEARNER" : "INSTRUCTOR",
): Promise<ForumTopic> {
  const safeTitle = serviceContext.validateForumContent(input.title, "Tiêu đề");
  const safeBody = serviceContext.validateForumContent(input.body, "Nội dung");
  const prisma = serviceContext.database();
  if (prisma) {
    const classItem = await prisma.learningClass.findUnique({
      where: { id: classId },
      include: { enrollments: true, instructors: true },
    });
    if (!classItem) throw new NotFoundException("Không tìm thấy lớp học.");
    if (classItem.status === "CLOSED")
      throw new ConflictException("Lớp đã lưu trữ và chỉ cho phép đọc.");
    if (
      authorRole === "LEARNER" &&
      !classItem.enrollments.some(
        (item) => item.learnerId === authorId && item.status === "ACTIVE",
      )
    )
      throw new NotFoundException("Học viên không thuộc lớp này.");
    if (
      authorRole === "INSTRUCTOR" &&
      !classItem.instructors.some((item) => item.instructorId === authorId)
    )
      throw new NotFoundException(
        "Giảng viên chưa được phân công vào lớp này.",
      );
    const created = await prisma.$transaction(async (transaction) => {
      const topic = await transaction.forumTopic.create({
        data: {
          id: id("topic"),
          classId,
          authorId,
          title: safeTitle,
          body: safeBody,
          tags: input.tags,
          isPinned: input.isPinned,
          status: "PUBLISHED",
        },
      });
      return topic;
    });
    if (created.status === "PUBLISHED")
      await serviceContext.notifyClassMembers(
        prisma,
        classId,
        "FORUM_TOPIC_CREATED",
        `Chủ đề mới: ${created.title}`,
        created.id,
      );
    return serviceContext.mapTopic(created);
  }
  const classItem = serviceContext.findClass(classId);
  if (classItem.status === "CLOSED")
    throw new ConflictException("Lớp đã lưu trữ và chỉ cho phép đọc.");
  if (authorRole === "LEARNER" && !classItem.learnerIds.includes(authorId))
    throw new NotFoundException("Học viên không thuộc lớp này.");
  if (
    authorRole === "INSTRUCTOR" &&
    !classItem.instructorIds.includes(authorId)
  )
    throw new NotFoundException("Giảng viên chưa được phân công vào lớp này.");
  const item: ForumTopic = {
    ...input,
    title: safeTitle,
    body: safeBody,
    id: id("topic"),
    classId,
    authorId,
    isLocked: false,
    status: "VISIBLE",
    createdAt: now(),
  };
  serviceContext.topics.unshift(item);
  for (const recipientId of new Set([
    ...classItem.learnerIds,
    ...classItem.instructorIds,
  ]))
    if (recipientId !== authorId)
      serviceContext.notifications.unshift({
        id: id("notification"),
        recipientId,
        type: "FORUM_TOPIC_CREATED",
        title: `Chủ đề mới: ${item.title}`,
        entityType: "FORUM_TOPIC",
        entityId: item.id,
        createdAt: now(),
      });
  return { ...item, tags: [...item.tags] };
}

/** Ghim hoặc khóa chủ đề với lý do bắt buộc và ghi audit người điều phối. */
export async function moderateTopic(
  serviceContext: LearningServiceContext,
  topicId: string,
  input: { isLocked?: boolean; isPinned?: boolean; reason: string },
  actorId = "usr-instructor",
): Promise<ForumTopic> {
  const reason = input.reason.trim();
  if (reason.length < 5)
    throw new BadRequestException("Lý do điều phối cần ít nhất 5 ký tự.");
  if (input.isLocked === undefined && input.isPinned === undefined)
    throw new BadRequestException(
      "Cần chọn trạng thái khóa hoặc ghim cần thay đổi.",
    );
  const prisma = serviceContext.database();
  if (prisma) {
    return prisma.$transaction(async (transaction) => {
      const current = await transaction.forumTopic.findFirst({
        where: {
          id: topicId,
          class: { instructors: { some: { instructorId: actorId } } },
        },
        include: { class: true },
      });
      if (!current)
        throw new NotFoundException(
          "Không tìm thấy chủ đề được phép điều phối.",
        );
      if (current.class.status === "CLOSED")
        throw new ConflictException("Lớp đã lưu trữ và chỉ cho phép đọc.");
      const updated = await transaction.forumTopic.update({
        where: { id: topicId },
        data: { isLocked: input.isLocked, isPinned: input.isPinned },
      });
      await transaction.auditLog.create({
        data: {
          actorId,
          action: "FORUM_TOPIC_MODERATED",
          entityType: "forum_topic",
          entityId: topicId,
          context: {
            reason,
            before: {
              isLocked: current.isLocked,
              isPinned: current.isPinned,
            },
            after: { isLocked: updated.isLocked, isPinned: updated.isPinned },
          },
        },
      });
      return serviceContext.mapTopic(updated);
    });
  }
  const current = serviceContext.findTopic(topicId);
  const classItem = serviceContext.findClass(current.classId);
  if (!classItem.instructorIds.includes(actorId))
    throw new NotFoundException("Không tìm thấy chủ đề được phép điều phối.");
  if (classItem.status === "CLOSED")
    throw new ConflictException("Lớp đã lưu trữ và chỉ cho phép đọc.");
  if (input.isLocked !== undefined) current.isLocked = input.isLocked;
  if (input.isPinned !== undefined) current.isPinned = input.isPinned;
  return { ...current, tags: [...current.tags] };
}

/** Kiểm tra quyền lớp rồi trả cây bài viết, ẩn nội dung đã xóa/kiểm duyệt phù hợp. */
export async function listPosts(
  serviceContext: LearningServiceContext,
  topicId: string,
  role = "LEARNER",
  actorId = serviceContext.userIdForRole(role),
): Promise<ForumPost[]> {
  await assertTopicReadAccess(serviceContext, topicId, role, actorId);
  const prisma = serviceContext.database();
  if (prisma) {
    const rows = await prisma.forumPost.findMany({
      where: { topicId },
      include: { attachments: true, mentions: true },
      orderBy: { createdAt: "asc" },
    });
    return rows.map((row) => serviceContext.mapPost(row));
  }
  return serviceContext.posts
    .filter((item) => item.topicId === topicId)
    .map((item) => ({
      ...item,
      body: item.status === "HIDDEN" ? "[Nội dung đã bị ẩn]" : item.body,
      attachmentIds: item.status === "HIDDEN" ? [] : [...item.attachmentIds],
      mentionedUserIds:
        item.status === "HIDDEN" ? [] : [...item.mentionedUserIds],
    }));
}

/** Phân trang bình luận gốc của chủ đề và kèm đầy đủ phản hồi con của từng gốc đang xem. */
export async function listPostsPage(
  serviceContext: LearningServiceContext,
  topicId: string,
  role = "LEARNER",
  actorId = serviceContext.userIdForRole(role),
  filters: { page?: number; pageSize?: number } = {},
): Promise<ForumPostPageResult> {
  await assertTopicReadAccess(serviceContext, topicId, role, actorId);
  const page =
    Number.isSafeInteger(filters.page) &&
    (filters.page ?? 0) > 0 &&
    (filters.page ?? 0) <= 100_000
      ? (filters.page as number)
      : 1;
  const pageSize =
    Number.isInteger(filters.pageSize) && (filters.pageSize ?? 0) > 0
      ? Math.min(filters.pageSize as number, 100)
      : 15;
  const prisma = serviceContext.database();
  if (prisma) {
    const { combined, totalRoots, totalPosts, safePage, totalPages } =
      await prisma.$transaction(
        async (transaction) => {
          const [totalRoots, totalPosts] = await Promise.all([
            transaction.forumPost.count({ where: { topicId, parentId: null } }),
            transaction.forumPost.count({ where: { topicId } }),
          ]);
          const totalPages = Math.max(1, Math.ceil(totalRoots / pageSize));
          const safePage = Math.min(page, totalPages);
          if (totalRoots === 0) {
            return {
              combined: [],
              totalRoots: 0,
              totalPosts,
              safePage,
              totalPages,
            };
          }
          const roots = await transaction.forumPost.findMany({
            where: { topicId, parentId: null },
            include: { attachments: true, mentions: true },
            orderBy: [{ createdAt: "asc" }, { id: "asc" }],
            skip: (safePage - 1) * pageSize,
            take: pageSize,
          });
          const rootIds = roots.map((item) => item.id);
          const level1 = rootIds.length
            ? await transaction.forumPost.findMany({
                where: { topicId, parentId: { in: rootIds } },
                include: { attachments: true, mentions: true },
                orderBy: [{ createdAt: "asc" }, { id: "asc" }],
              })
            : [];
          const level1Ids = level1.map((item) => item.id);
          const level2 = level1Ids.length
            ? await transaction.forumPost.findMany({
                where: { topicId, parentId: { in: level1Ids } },
                include: { attachments: true, mentions: true },
                orderBy: [{ createdAt: "asc" }, { id: "asc" }],
              })
            : [];
          return {
            combined: [...roots, ...level1, ...level2],
            totalRoots,
            totalPosts,
            safePage,
            totalPages,
          };
        },
        { isolationLevel: "RepeatableRead" },
      );
    return {
      items: combined.map((row) => serviceContext.mapPost(row)),
      total: totalRoots,
      totalPosts,
      page: safePage,
      pageSize,
      totalPages,
    };
  }
  const allPosts = serviceContext.posts
    .filter((item) => item.topicId === topicId)
    .map((item) => ({
      ...item,
      body: item.status === "HIDDEN" ? "[Nội dung đã bị ẩn]" : item.body,
      attachmentIds: item.status === "HIDDEN" ? [] : [...item.attachmentIds],
      mentionedUserIds:
        item.status === "HIDDEN" ? [] : [...item.mentionedUserIds],
    }));
  const roots = allPosts.filter((item) => !item.parentId);
  const pagedRoots = paginateArray(roots, page, pageSize);
  const rootIdSet = new Set(pagedRoots.items.map((item) => item.id));
  const level1 = allPosts.filter((item) => item.parentId && rootIdSet.has(item.parentId));
  const level1IdSet = new Set(level1.map((item) => item.id));
  const level2 = allPosts.filter((item) => item.parentId && level1IdSet.has(item.parentId));
  return {
    ...pagedRoots,
    items: [...pagedRoots.items, ...level1, ...level2],
    totalPosts: allPosts.length,
  };
}

/** Validate nội dung, chủ đề chưa khóa, parent/tệp/mention hợp lệ rồi tạo post và thông báo. */
export async function createPost(
  serviceContext: LearningServiceContext,
  topicId: string,
  body: string,
  authorId = "usr-learner",
  parentId?: string,
  rawAttachmentIds: string[] = [],
  rawMentionedUserIds: string[] = [],
): Promise<ForumPost> {
  const safeBody = serviceContext.validateForumContent(
    body,
    "Nội dung phản hồi",
  );
  const attachmentIds = [...new Set(rawAttachmentIds)];
  const mentionedUserIds = [...new Set(rawMentionedUserIds)].filter(
    (userId) => userId !== authorId,
  );
  if (attachmentIds.length > 5)
    throw new BadRequestException(
      "Mỗi phản hồi chỉ được đính kèm tối đa 5 tệp.",
    );
  if (mentionedUserIds.length > 10)
    throw new BadRequestException(
      "Mỗi phản hồi chỉ được nhắc tối đa 10 thành viên.",
    );
  const prisma = serviceContext.database();
  const since = new Date(Date.now() - 60_000);
  const recentPosts = prisma
    ? await prisma.forumPost.count({ where: { authorId, createdAt: { gte: since } } })
    : serviceContext.posts.filter((post) => post.authorId === authorId && new Date(post.createdAt) >= since).length;
  if (recentPosts >= 5) throw new BadRequestException("Bạn đã vượt giới hạn bài viết trong một phút.");
  if (prisma) {
    const topic = await prisma.forumTopic.findUnique({
      where: { id: topicId },
      include: {
        class: { include: { enrollments: true, instructors: true } },
      },
    });
    if (!topic) throw new NotFoundException("Không tìm thấy chủ đề.");
    if (topic.isLocked) throw new BadRequestException("Chủ đề đã khóa.");
    if (topic.class.status === "CLOSED")
      throw new ConflictException("Lớp đã lưu trữ và chỉ cho phép đọc.");
    if (
      !topic.class.enrollments.some(
        (item) => item.learnerId === authorId && item.status === "ACTIVE",
      )
    )
      throw new NotFoundException("Học viên không thuộc lớp của chủ đề.");
    if (parentId) {
      const parent = await prisma.forumPost.findFirst({
        where: { id: parentId, topicId },
        include: { parent: { include: { parent: true } } },
      });
      if (!parent) throw new BadRequestException("Bài cha không hợp lệ.");
      if (parent.parent?.parentId)
        throw new BadRequestException("Phản hồi chỉ được lồng tối đa 2 cấp.");
    }
    const validAttachments = attachmentIds.length
      ? await prisma.material.findMany({
          where: {
            id: { in: attachmentIds },
            classId: topic.classId,
            visibility: "PUBLISHED",
          },
          select: { id: true },
        })
      : [];
    if (validAttachments.length !== attachmentIds.length)
      throw new BadRequestException(
        "Tệp đính kèm phải thuộc lớp và đã được phát hành.",
      );
    const validMentions = mentionedUserIds.length
      ? await prisma.user.findMany({
          where: {
            id: { in: mentionedUserIds },
            OR: [
              {
                enrollments: {
                  some: { classId: topic.classId, status: "ACTIVE" },
                },
              },
              { instructedClasses: { some: { classId: topic.classId } } },
            ],
          },
          select: { id: true },
        })
      : [];
    if (validMentions.length !== mentionedUserIds.length)
      throw new BadRequestException("Chỉ được nhắc thành viên đang thuộc lớp.");
    return prisma.$transaction(async (transaction) => {
      const postId = id("post");
      const post = await transaction.forumPost.create({
        data: {
          id: postId,
          topicId,
          authorId,
          body: safeBody,
          parentId,
          status: "PUBLISHED",
          attachments: {
            create: attachmentIds.map((materialId) => ({ materialId })),
          },
          mentions: {
            create: mentionedUserIds.map((mentionedUserId) => ({
              mentionedUserId,
            })),
          },
        },
        include: { attachments: true, mentions: true },
      });
      if (mentionedUserIds.length && post.status === "PUBLISHED") {
        await transaction.notification.createMany({
          data: mentionedUserIds.map((recipientId) => ({
            id: id("notification"),
            recipientId,
            type: "FORUM_MENTION",
            title: `Bạn được nhắc trong chủ đề ${topic.title}`,
            entityType: "FORUM_POST",
            entityId: postId,
            dedupKey: `forum-mention:${postId}:${recipientId}`,
          })),
          skipDuplicates: true,
        });
      }
      return serviceContext.mapPost(post);
    });
  }
  const topic = serviceContext.findTopic(topicId);
  if (topic.isLocked) throw new BadRequestException("Chủ đề đã khóa.");
  if (serviceContext.findClass(topic.classId).status === "CLOSED")
    throw new ConflictException("Lớp đã lưu trữ và chỉ cho phép đọc.");
  const classItem = serviceContext.findClass(topic.classId);
  if (!classItem.learnerIds.includes(authorId))
    throw new NotFoundException("Học viên không thuộc lớp của chủ đề.");
  const parent = parentId
    ? serviceContext.posts.find(
        (item) => item.id === parentId && item.topicId === topicId,
      )
    : undefined;
  if (parentId && !parent)
    throw new BadRequestException("Bài cha không hợp lệ.");
  if (
    parent?.parentId &&
    serviceContext.posts.find((item) => item.id === parent.parentId)?.parentId
  )
    throw new BadRequestException("Phản hồi chỉ được lồng tối đa 2 cấp.");
  if (
    attachmentIds.some(
      (materialId) =>
        !serviceContext.materials.some(
          (item) =>
            item.id === materialId &&
            item.classId === topic.classId &&
            item.visibility === "PUBLISHED",
        ),
    )
  ) {
    throw new BadRequestException(
      "Tệp đính kèm phải thuộc lớp và đã được phát hành.",
    );
  }
  const classMembers = new Set([
    ...classItem.learnerIds,
    ...classItem.instructorIds,
  ]);
  if (mentionedUserIds.some((userId) => !classMembers.has(userId)))
    throw new BadRequestException("Chỉ được nhắc thành viên đang thuộc lớp.");
  const item: ForumPost = {
    id: id("post"),
    topicId,
    authorId,
    body: safeBody,
    parentId,
    status: "VISIBLE",
    attachmentIds,
    mentionedUserIds,
    createdAt: now(),
  };
  serviceContext.posts.push(item);
  for (const recipientId of mentionedUserIds) {
    if (
      !serviceContext.notifications.some(
        (notification) =>
          notification.entityId === item.id &&
          notification.recipientId === recipientId,
      )
    ) {
      serviceContext.notifications.unshift({
        id: id("notification"),
        recipientId,
        type: "FORUM_MENTION",
        title: `Bạn được nhắc trong chủ đề ${topic.title}`,
        entityType: "FORUM_POST",
        entityId: item.id,
        createdAt: now(),
      });
    }
  }
  return {
    ...item,
    attachmentIds: [...item.attachmentIds],
    mentionedUserIds: [...item.mentionedUserIds],
  };
}

/** Cho đúng tác giả sửa bài chưa bị xóa/ẩn và chạy lại chính sách nội dung. */
export async function updatePost(
  serviceContext: LearningServiceContext,
  postId: string,
  body: string,
  authorId = "usr-learner",
): Promise<ForumPost> {
  const safeBody = serviceContext.validateForumContent(
    body,
    "Nội dung phản hồi",
  );
  const prisma = serviceContext.database();
  if (prisma) {
    const current = await prisma.forumPost.findFirst({
      where: { id: postId, authorId },
      include: {
        topic: { include: { class: true } },
        attachments: true,
        mentions: true,
      },
    });
    if (!current)
      throw new NotFoundException("Không tìm thấy phản hồi được phép sửa.");
    if (current.topic.class.status === "CLOSED")
      throw new ConflictException("Lớp đã lưu trữ và chỉ cho phép đọc.");
    const activeMembership = await prisma.classEnrollment.findFirst({
      where: {
        classId: current.topic.classId,
        learnerId: authorId,
        status: "ACTIVE",
      },
      select: { id: true },
    });
    if (!activeMembership)
      throw new ConflictException(
        "Bạn đã rời lớp và không còn quyền sửa bài viết cũ.",
      );
    if (current.deletedAt || current.status !== "PUBLISHED")
      throw new ConflictException("Phản hồi đã bị xóa hoặc ẩn.");
    if (current.topic.isLocked) throw new ConflictException("Chủ đề đã khóa.");
    const history = Array.isArray(current.editHistory)
      ? current.editHistory
      : [];
    return serviceContext.mapPost(
      await prisma.forumPost.update({
        where: { id: postId },
        data: {
          body: safeBody,
          editedAt: new Date(),
          editHistory: [
            ...history,
            { body: current.body, editedAt: new Date().toISOString() },
          ],
        },
        include: { attachments: true, mentions: true },
      }),
    );
  }
  const current = serviceContext.posts.find(
    (item) => item.id === postId && item.authorId === authorId,
  );
  if (!current)
    throw new NotFoundException("Không tìm thấy phản hồi được phép sửa.");
  if (current.deletedAt || current.status !== "VISIBLE")
    throw new ConflictException("Phản hồi đã bị xóa hoặc ẩn.");
  const topic = serviceContext.findTopic(current.topicId);
  if (serviceContext.findClass(topic.classId).status === "CLOSED")
    throw new ConflictException("Lớp đã lưu trữ và chỉ cho phép đọc.");
  if (!serviceContext.findClass(topic.classId).learnerIds.includes(authorId))
    throw new ConflictException(
      "Bạn đã rời lớp và không còn quyền sửa bài viết cũ.",
    );
  if (topic.isLocked) throw new ConflictException("Chủ đề đã khóa.");
  current.body = safeBody;
  current.editedAt = now();
  current.editCount = (current.editCount ?? 0) + 1;
  return {
    ...current,
    attachmentIds: [...current.attachmentIds],
    mentionedUserIds: [...current.mentionedUserIds],
  };
}

/** Xóa mềm bài viết của tác giả để giữ tính toàn vẹn chuỗi thảo luận. */
export async function deletePost(
  serviceContext: LearningServiceContext,
  postId: string,
  authorId = "usr-learner",
): Promise<ForumPost> {
  const prisma = serviceContext.database();
  if (prisma) {
    const current = await prisma.forumPost.findFirst({
      where: { id: postId, authorId },
      include: {
        topic: { include: { class: true } },
        attachments: true,
        mentions: true,
      },
    });
    if (!current)
      throw new NotFoundException("Không tìm thấy phản hồi được phép xóa.");
    if (current.topic.class.status === "CLOSED")
      throw new ConflictException("Lớp đã lưu trữ và chỉ cho phép đọc.");
    const activeMembership = await prisma.classEnrollment.findFirst({
      where: {
        classId: current.topic.classId,
        learnerId: authorId,
        status: "ACTIVE",
      },
      select: { id: true },
    });
    if (!activeMembership)
      throw new ConflictException(
        "Bạn đã rời lớp và không còn quyền xóa bài viết cũ.",
      );
    if (current.topic.isLocked) throw new ConflictException("Chủ đề đã khóa.");
    if (current.deletedAt) return serviceContext.mapPost(current);
    return serviceContext.mapPost(
      await prisma.forumPost.update({
        where: { id: postId },
        data: { status: "ARCHIVED", deletedAt: new Date() },
        include: { attachments: true, mentions: true },
      }),
    );
  }
  const current = serviceContext.posts.find(
    (item) => item.id === postId && item.authorId === authorId,
  );
  if (!current)
    throw new NotFoundException("Không tìm thấy phản hồi được phép xóa.");
  const topic = serviceContext.findTopic(current.topicId);
  if (serviceContext.findClass(topic.classId).status === "CLOSED")
    throw new ConflictException("Lớp đã lưu trữ và chỉ cho phép đọc.");
  if (!serviceContext.findClass(topic.classId).learnerIds.includes(authorId))
    throw new ConflictException(
      "Bạn đã rời lớp và không còn quyền xóa bài viết cũ.",
    );
  if (topic.isLocked) throw new ConflictException("Chủ đề đã khóa.");
  current.status = "HIDDEN";
  current.deletedAt ??= now();
  return {
    ...current,
    body: "[Nội dung đã bị xóa]",
    attachmentIds: [],
    mentionedUserIds: [],
  };
}
