import { BadRequestException, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../../../../database/prisma.service.js";
import { ClassWithMembers } from "../../core/learning.shared.js";
import type { LearningServiceContext } from "../../core/learning.context.js";

/** Áp dụng cấu hình kiểm duyệt hiệu lực và trả trạng thái ẩn chờ duyệt khi nội dung bị gắn cờ. */
export async function enforceForumPolicy(
  serviceContext: LearningServiceContext,
  database: PrismaService,
  authorId: string,
  content: string,
): Promise<"FLAG" | "HIDE_PENDING_REVIEW" | undefined> {
  if (!serviceContext.system) {
    const policy = await database.moderationPolicy.findFirst({
      orderBy: { version: "desc" },
    });
    const terms = serviceContext.toStringArray(policy?.prohibitedTerms ?? []);
    if (
      terms.some((term) => content.toLowerCase().includes(term.toLowerCase()))
    )
      throw new BadRequestException(
        "Nội dung chứa từ khóa bị chính sách diễn đàn chặn.",
      );
    const recentPosts = await database.forumPost.count({
      where: { authorId, createdAt: { gte: new Date(Date.now() - 60_000) } },
    });
    if (recentPosts >= (policy?.maxPostsPerMinute ?? 5))
      throw new BadRequestException(
        "Bạn đã vượt giới hạn bài viết trong một phút.",
      );
    return undefined;
  }
  const settings = await serviceContext.system.getSettings();
  if (!settings.moderationEnabled) return undefined;
  const policy = await serviceContext.system.getModerationPolicy();
  const recentPosts = await database.forumPost.count({
    where: { authorId, createdAt: { gte: new Date(Date.now() - 60_000) } },
  });
  if (recentPosts >= policy.maxPostsPerMinute)
    throw new BadRequestException(
      "Bạn đã vượt giới hạn bài viết trong một phút.",
    );
  const matched = policy.prohibitedTerms.some((term) =>
    content.toLocaleLowerCase("vi").includes(term.toLocaleLowerCase("vi")),
  );
  if (!matched) return undefined;
  return policy.action;
}

/** Áp dụng chính sách kiểm duyệt tương đương trên kho nhớ demo. */
export async function enforceMemoryForumPolicy(
  serviceContext: LearningServiceContext,
  authorId: string,
  content: string,
): Promise<"FLAG" | "HIDE_PENDING_REVIEW" | undefined> {
  if (!serviceContext.system) {
    if (
      serviceContext
        .moderationTerms()
        .some((term) => content.toLowerCase().includes(term))
    )
      throw new BadRequestException(
        "Nội dung chứa từ khóa bị chính sách diễn đàn chặn.",
      );
  } else if (!(await serviceContext.system.getSettings()).moderationEnabled) {
    return undefined;
  }
  const policy = serviceContext.system
    ? await serviceContext.system.getModerationPolicy()
    : {
        prohibitedTerms: serviceContext.moderationTerms(),
        maxPostsPerMinute: 5,
        action: "FLAG" as const,
      };
  const recentPosts = serviceContext.posts.filter(
    (item) =>
      item.authorId === authorId &&
      Date.now() - new Date(item.createdAt).getTime() <= 60_000,
  ).length;
  if (recentPosts >= policy.maxPostsPerMinute)
    throw new BadRequestException(
      "Bạn đã vượt giới hạn bài viết trong một phút.",
    );
  if (!serviceContext.system) return undefined;
  return policy.prohibitedTerms.some((term) =>
    content.toLocaleLowerCase("vi").includes(term.toLocaleLowerCase("vi")),
  )
    ? policy.action
    : undefined;
}

/** Trả danh sách từ khóa kiểm duyệt được chuẩn hóa từ cấu hình môi trường. */
export function moderationTerms(): string[] {
  return ["spam", "lừa đảo"];
}

/** Xác minh vai trò quản trị hoặc thành viên lớp trước thao tác diễn đàn Prisma. */
export function assertForumClassAccess(
  classItem: ClassWithMembers,
  role: string,
  actorId: string,
): void {
  if (
    role === "LEARNER" &&
    !classItem.enrollments.some(
      (item) => item.learnerId === actorId && item.status === "ACTIVE",
    )
  )
    throw new NotFoundException("Không tìm thấy chủ đề trong lớp đã ghi danh.");
  if (
    role === "INSTRUCTOR" &&
    !classItem.instructors.some((item) => item.instructorId === actorId)
  )
    throw new NotFoundException(
      "Không tìm thấy chủ đề trong lớp được phân công.",
    );
}

/** Xác minh quyền diễn đàn tương đương trên dữ liệu lớp in-memory. */
export function assertMemoryForumClassAccess(
  serviceContext: LearningServiceContext,
  classId: string,
  role: string,
  actorId: string,
): void {
  const classItem = serviceContext.findClass(classId);
  if (role === "LEARNER" && !classItem.learnerIds.includes(actorId))
    throw new NotFoundException("Không tìm thấy chủ đề trong lớp đã ghi danh.");
  if (role === "INSTRUCTOR" && !classItem.instructorIds.includes(actorId))
    throw new NotFoundException(
      "Không tìm thấy chủ đề trong lớp được phân công.",
    );
}
