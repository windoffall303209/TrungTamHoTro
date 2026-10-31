import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from "@nestjs/common";
import { id, now } from "../../core/learning.shared.js";
import { isPrismaUniqueConstraintError } from "../../../../infrastructure/prisma-errors.js";
import type {
  ContentReport,
  LearningNotification,
  ModerationContext,
} from "../../core/learning.types.js";
import type { LearningServiceContext } from "../../core/learning.context.js";

/** Liệt kê thông báo của đúng người nhận theo thời gian mới nhất. */
export async function listNotifications(
  serviceContext: LearningServiceContext,
  recipientId = "usr-learner",
): Promise<LearningNotification[]> {
  const prisma = serviceContext.database();
  if (prisma) {
    const rows = await prisma.notification.findMany({
      where: { recipientId },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    return rows.map((row) => ({
      id: row.id,
      recipientId: row.recipientId,
      type: row.type,
      title: row.title,
      entityType: row.entityType,
      entityId: row.entityId,
      readAt: row.readAt?.toISOString(),
      createdAt: row.createdAt.toISOString(),
    }));
  }
  return serviceContext.notifications
    .filter((item) => item.recipientId === recipientId)
    .map((item) => ({ ...item }));
}

/** Đánh dấu đã đọc bằng điều kiện recipientId để ngăn sửa thông báo người khác. */
export async function markNotificationRead(
  serviceContext: LearningServiceContext,
  notificationId: string,
  recipientId = "usr-learner",
): Promise<LearningNotification> {
  const prisma = serviceContext.database();
  if (prisma) {
    const existing = await prisma.notification.findFirst({
      where: { id: notificationId, recipientId },
    });
    if (!existing) throw new NotFoundException("Không tìm thấy thông báo.");
    const row = await prisma.notification.update({
      where: { id: notificationId },
      data: { readAt: existing.readAt ?? new Date() },
    });
    return {
      id: row.id,
      recipientId: row.recipientId,
      type: row.type,
      title: row.title,
      entityType: row.entityType,
      entityId: row.entityId,
      readAt: row.readAt?.toISOString(),
      createdAt: row.createdAt.toISOString(),
    };
  }
  const item = serviceContext.notifications.find(
    (notification) =>
      notification.id === notificationId &&
      notification.recipientId === recipientId,
  );
  if (!item) throw new NotFoundException("Không tìm thấy thông báo.");
  item.readAt ??= now();
  return { ...item };
}

/** Kiểm tra đối tượng tồn tại và tạo báo cáo tránh trùng đang mở từ cùng người gửi. */
export async function reportContent(
  serviceContext: LearningServiceContext,
  input: Pick<
    ContentReport,
    "targetType" | "targetId" | "reporterId" | "reason" | "details"
  >,
): Promise<ContentReport> {
  const prisma = serviceContext.database();
  if (prisma) {
    const targetClass =
      input.targetType === "POST"
        ? (
            await prisma.forumPost.findFirst({
              where: {
                id: input.targetId,
                topic: {
                  class: {
                    enrollments: {
                      some: { learnerId: input.reporterId, status: "ACTIVE" },
                    },
                  },
                },
              },
              select: {
                topic: { select: { class: { select: { status: true } } } },
              },
            })
          )?.topic.class
        : (
            await prisma.forumTopic.findFirst({
              where: {
                id: input.targetId,
                class: {
                  enrollments: {
                    some: { learnerId: input.reporterId, status: "ACTIVE" },
                  },
                },
              },
              select: { class: { select: { status: true } } },
            })
          )?.class;
    if (!targetClass)
      throw new NotFoundException("Không tìm thấy nội dung cần báo cáo.");
    if (targetClass.status === "CLOSED")
      throw new ConflictException("Lớp đã lưu trữ và chỉ cho phép đọc.");
    try {
      return serviceContext.mapReport(
        await prisma.contentReport.create({
          data: { id: id("report"), ...input },
          include: { actions: true },
        }),
      );
    } catch (error) {
      if (isPrismaUniqueConstraintError(error))
        throw new ConflictException("Bạn đã báo cáo nội dung này.");
      throw error;
    }
  }
  const targetClassId =
    input.targetType === "TOPIC"
      ? serviceContext.topics.find((item) => item.id === input.targetId)
          ?.classId
      : serviceContext.topics.find(
          (topic) =>
            topic.id ===
            serviceContext.posts.find((post) => post.id === input.targetId)
              ?.topicId,
        )?.classId;
  if (
    !targetClassId ||
    !serviceContext
      .findClass(targetClassId)
      .learnerIds.includes(input.reporterId)
  )
    throw new NotFoundException(
      "Không tìm thấy nội dung trong lớp đã ghi danh.",
    );
  if (serviceContext.findClass(targetClassId).status === "CLOSED")
    throw new ConflictException("Lớp đã lưu trữ và chỉ cho phép đọc.");
  if (
    serviceContext.reports.some(
      (item) =>
        item.targetId === input.targetId &&
        item.reporterId === input.reporterId &&
        item.status === "OPEN",
    )
  )
    throw new ConflictException("Bạn đã báo cáo nội dung này.");
  const timestamp = now();
  const item: ContentReport = {
    ...input,
    id: id("report"),
    status: "OPEN",
    escalationLevel: 0,
    createdAt: timestamp,
    updatedAt: timestamp,
    actions: [],
  };
  serviceContext.reports.unshift(item);
  return { ...item };
}

/** Liệt kê hàng đợi kiểm duyệt cùng lịch sử hành động. */
export async function listReports(
  serviceContext: LearningServiceContext,
): Promise<ContentReport[]> {
  const prisma = serviceContext.database();
  if (prisma) {
    const rows = await prisma.contentReport.findMany({
      include: { actions: { orderBy: { createdAt: "asc" } } },
      orderBy: { createdAt: "desc" },
    });
    return rows.map((row) => serviceContext.mapReport(row));
  }
  return serviceContext.reports.map((item) => ({ ...item }));
}

/** Liệt kê báo cáo và kết quả xử lý thuộc người học. */
export async function listLearnerReports(
  serviceContext: LearningServiceContext,
  learnerId = "usr-learner",
): Promise<ContentReport[]> {
  const prisma = serviceContext.database();
  if (prisma) {
    const rows = await prisma.contentReport.findMany({
      where: { reporterId: learnerId },
      include: { actions: { orderBy: { createdAt: "asc" } } },
      orderBy: { createdAt: "desc" },
    });
    return rows.map((row) => serviceContext.mapReport(row));
  }
  return serviceContext.reports
    .filter((item) => item.reporterId === learnerId)
    .map((item) => ({ ...item }));
}

/** Ghép báo cáo với nội dung đích và ngữ cảnh lân cận để ra quyết định. */
export async function getReportContext(
  serviceContext: LearningServiceContext,
  reportId: string,
): Promise<ModerationContext> {
  const prisma = serviceContext.database();
  if (prisma) {
    const report = await prisma.contentReport.findUnique({
      where: { id: reportId },
      include: { actions: { orderBy: { createdAt: "asc" } } },
    });
    if (!report) throw new NotFoundException("Không tìm thấy báo cáo.");
    if (report.targetType === "TOPIC") {
      const topic = await prisma.forumTopic.findUnique({
        where: { id: report.targetId },
        include: { posts: { orderBy: { createdAt: "asc" }, take: 20 } },
      });
      if (!topic)
        throw new NotFoundException("Nội dung báo cáo không còn tồn tại.");
      return {
        report: serviceContext.mapReport(report),
        classId: topic.classId,
        topicTitle: topic.title,
        targetAuthorId: topic.authorId,
        targetBody: topic.body,
        surroundingPosts: topic.posts.map((post) => ({
          id: post.id,
          authorId: post.authorId,
          body: post.body,
          createdAt: post.createdAt.toISOString(),
        })),
      };
    }
    const post = await prisma.forumPost.findUnique({
      where: { id: report.targetId },
      include: {
        topic: {
          include: { posts: { orderBy: { createdAt: "asc" }, take: 20 } },
        },
      },
    });
    if (!post)
      throw new NotFoundException("Nội dung báo cáo không còn tồn tại.");
    return {
      report: serviceContext.mapReport(report),
      classId: post.topic.classId,
      topicTitle: post.topic.title,
      targetAuthorId: post.authorId,
      targetBody: post.body,
      surroundingPosts: post.topic.posts.map((item) => ({
        id: item.id,
        authorId: item.authorId,
        body: item.body,
        createdAt: item.createdAt.toISOString(),
      })),
    };
  }
  const report = serviceContext.findReport(reportId);
  const topic =
    report.targetType === "TOPIC"
      ? serviceContext.findTopic(report.targetId)
      : serviceContext.findTopic(
          serviceContext.findPost(report.targetId).topicId,
        );
  const target =
    report.targetType === "TOPIC"
      ? { authorId: topic.authorId, body: topic.body }
      : serviceContext.findPost(report.targetId);
  return {
    report: {
      ...report,
      actions: report.actions.map((action) => ({ ...action })),
    },
    classId: topic.classId,
    topicTitle: topic.title,
    targetAuthorId: target.authorId,
    targetBody: target.body,
    surroundingPosts: serviceContext.posts
      .filter((post) => post.topicId === topic.id)
      .map((post) => ({
        id: post.id,
        authorId: post.authorId,
        body: post.body,
        createdAt: post.createdAt,
      })),
  };
}

/** Nhận quyền xử lý báo cáo bằng cập nhật có điều kiện để tránh claim đồng thời. */
export async function claimReport(
  serviceContext: LearningServiceContext,
  reportId: string,
  moderatorId = "usr-manager",
  moderatorRole = "CENTER_MANAGER",
): Promise<ContentReport> {
  const prisma = serviceContext.database();
  if (prisma) {
    return prisma.$transaction(async (transaction) => {
      const current = await transaction.contentReport.findUnique({
        where: { id: reportId },
      });
      if (!current) throw new NotFoundException("Không tìm thấy báo cáo.");
      if (
        current.status === "IN_REVIEW" &&
        current.assignedToId === moderatorId
      )
        return serviceContext.mapReport(
          await transaction.contentReport.findUniqueOrThrow({
            where: { id: reportId },
            include: { actions: { orderBy: { createdAt: "asc" } } },
          }),
        );
      if (current.status === "ESCALATED" && moderatorRole !== "SYSTEM_ADMIN")
        throw new ConflictException(
          "Báo cáo đã chuyển cấp và chỉ quản trị hệ thống được nhận xử lý.",
        );
      if (!["OPEN", "ESCALATED"].includes(current.status))
        throw new ConflictException(
          "Chỉ báo cáo đang mở hoặc đã chuyển cấp mới có thể nhận xử lý.",
        );
      await transaction.moderationAction.create({
        data: {
          id: id("mod-action"),
          reportId,
          actorId: moderatorId,
          action: "CLAIM",
          reason: "Nhận xử lý báo cáo",
          previousStatus: current.status,
          nextStatus: "IN_REVIEW",
        },
      });
      await transaction.auditLog.create({
        data: {
          actorId: moderatorId,
          action: "FORUM_REPORT_CLAIM",
          entityType: "content_report",
          entityId: reportId,
          context: {
            previousStatus: current.status,
            nextStatus: "IN_REVIEW",
          },
        },
      });
      return serviceContext.mapReport(
        await transaction.contentReport.update({
          where: { id: reportId },
          data: { status: "IN_REVIEW", assignedToId: moderatorId },
          include: { actions: { orderBy: { createdAt: "asc" } } },
        }),
      );
    });
  }
  const current = serviceContext.findReport(reportId);
  if (current.status === "IN_REVIEW" && current.assignedToId === moderatorId)
    return {
      ...current,
      actions: current.actions.map((action) => ({ ...action })),
    };
  if (current.status === "ESCALATED" && moderatorRole !== "SYSTEM_ADMIN")
    throw new ConflictException(
      "Báo cáo đã chuyển cấp và chỉ quản trị hệ thống được nhận xử lý.",
    );
  if (!["OPEN", "ESCALATED"].includes(current.status))
    throw new ConflictException(
      "Chỉ báo cáo đang mở hoặc đã chuyển cấp mới có thể nhận xử lý.",
    );
  serviceContext.recordMemoryModeration(
    current,
    moderatorId,
    "CLAIM",
    "Nhận xử lý báo cáo",
    "IN_REVIEW",
  );
  current.assignedToId = moderatorId;
  return {
    ...current,
    actions: current.actions.map((action) => ({ ...action })),
  };
}

/** Áp dụng hành động kiểm duyệt, ghi action history và thông báo các bên liên quan. */
export async function resolveReport(
  serviceContext: LearningServiceContext,
  reportId: string,
  action: "HIDE_CONTENT" | "KEEP_CONTENT" | "ESCALATE_ADMIN",
  resolution: string,
  moderatorId = "usr-manager",
  moderatorRole = "CENTER_MANAGER",
): Promise<ContentReport> {
  const normalizedResolution = resolution.trim();
  if (normalizedResolution.length < 3)
    throw new BadRequestException("Lý do xử lý phải có ít nhất 3 ký tự.");
  const nextStatus =
    action === "HIDE_CONTENT"
      ? "RESOLVED"
      : action === "KEEP_CONTENT"
        ? "REJECTED"
        : "ESCALATED";
  const prisma = serviceContext.database();
  if (prisma) {
    return prisma.$transaction(async (transaction) => {
      const item = await transaction.contentReport.findUnique({
        where: { id: reportId },
      });
      if (!item) throw new NotFoundException("Không tìm thấy báo cáo.");
      if (item.escalationLevel > 0 && moderatorRole !== "SYSTEM_ADMIN")
        throw new ConflictException(
          "Báo cáo đã chuyển cấp và chỉ quản trị hệ thống được kết luận.",
        );
      if (!["OPEN", "IN_REVIEW", "ESCALATED"].includes(item.status))
        throw new ConflictException("Báo cáo đã được xử lý.");
      if (action === "ESCALATE_ADMIN" && moderatorRole === "SYSTEM_ADMIN")
        throw new ConflictException(
          "Quản trị hệ thống phải đưa ra kết luận cuối cùng.",
        );
      if (item.assignedToId && item.assignedToId !== moderatorId)
        throw new ConflictException("Báo cáo đang do quản lý khác xử lý.");
      let targetAuthorId: string | undefined;
      if (item.targetType === "POST") {
        targetAuthorId = (
          await transaction.forumPost.findUnique({
            where: { id: item.targetId },
            select: { authorId: true },
          })
        )?.authorId;
      } else {
        targetAuthorId = (
          await transaction.forumTopic.findUnique({
            where: { id: item.targetId },
            select: { authorId: true },
          })
        )?.authorId;
      }
      if (!targetAuthorId)
        throw new NotFoundException("Nội dung báo cáo không còn tồn tại.");
      if (action === "HIDE_CONTENT" && item.targetType === "POST") {
        await transaction.forumPost.updateMany({
          where: { id: item.targetId },
          data: { status: "ARCHIVED" },
        });
      }
      if (action === "HIDE_CONTENT" && item.targetType === "TOPIC")
        await transaction.forumTopic.updateMany({
          where: { id: item.targetId },
          data: { status: "ARCHIVED", isLocked: true },
        });
      if (action === "KEEP_CONTENT" && item.targetType === "POST")
        await transaction.forumPost.updateMany({
          where: { id: item.targetId },
          data: { status: "PUBLISHED" },
        });
      if (action === "KEEP_CONTENT" && item.targetType === "TOPIC")
        await transaction.forumTopic.updateMany({
          where: { id: item.targetId },
          data: { status: "PUBLISHED", isLocked: false },
        });
      await transaction.moderationAction.create({
        data: {
          id: id("mod-action"),
          reportId,
          actorId: moderatorId,
          action,
          reason: normalizedResolution,
          previousStatus: item.status,
          nextStatus,
        },
      });
      await transaction.auditLog.create({
        data: {
          actorId: moderatorId,
          action: `FORUM_REPORT_${action}`,
          entityType: "content_report",
          entityId: reportId,
          context: {
            targetType: item.targetType,
            targetId: item.targetId,
            previousStatus: item.status,
            nextStatus,
            resolution: normalizedResolution,
          },
        },
      });
      const adminIds =
        action === "ESCALATE_ADMIN"
          ? await serviceContext.userIdsForRole(transaction, "SYSTEM_ADMIN")
          : [];
      const recipients = [
        ...new Set([item.reporterId, targetAuthorId, ...adminIds]),
      ];
      await transaction.notification.createMany({
        data: recipients.map((recipientId) => ({
          id: id("notification"),
          recipientId,
          type: "FORUM_MODERATION",
          title:
            action === "ESCALATE_ADMIN"
              ? "Báo cáo diễn đàn đã được chuyển cấp"
              : "Báo cáo diễn đàn đã có kết quả",
          entityType: "CONTENT_REPORT",
          entityId: reportId,
          dedupKey: `forum-report:${reportId}:${action}:${recipientId}`,
        })),
        skipDuplicates: true,
      });
      return serviceContext.mapReport(
        await transaction.contentReport.update({
          where: { id: reportId },
          data: {
            status: nextStatus,
            assignedToId: moderatorId,
            escalationLevel:
              action === "ESCALATE_ADMIN"
                ? { increment: 1 }
                : item.escalationLevel,
            resolution: normalizedResolution,
            resolvedAt: action === "ESCALATE_ADMIN" ? null : new Date(),
          },
          include: { actions: { orderBy: { createdAt: "asc" } } },
        }),
      );
    });
  }
  const item = serviceContext.findReport(reportId);
  if (item.escalationLevel > 0 && moderatorRole !== "SYSTEM_ADMIN")
    throw new ConflictException(
      "Báo cáo đã chuyển cấp và chỉ quản trị hệ thống được kết luận.",
    );
  if (!["OPEN", "IN_REVIEW", "ESCALATED"].includes(item.status))
    throw new ConflictException("Báo cáo đã được xử lý.");
  if (action === "ESCALATE_ADMIN" && moderatorRole === "SYSTEM_ADMIN")
    throw new ConflictException(
      "Quản trị hệ thống phải đưa ra kết luận cuối cùng.",
    );
  if (item.assignedToId && item.assignedToId !== moderatorId)
    throw new ConflictException("Báo cáo đang do quản lý khác xử lý.");
  const topic =
    item.targetType === "TOPIC"
      ? serviceContext.findTopic(item.targetId)
      : serviceContext.findTopic(
          serviceContext.findPost(item.targetId).topicId,
        );
  const targetAuthorId =
    item.targetType === "TOPIC"
      ? topic.authorId
      : serviceContext.findPost(item.targetId).authorId;
  if (action === "HIDE_CONTENT" && item.targetType === "POST")
    serviceContext.findPost(item.targetId).status = "HIDDEN";
  if (action === "HIDE_CONTENT" && item.targetType === "TOPIC") {
    topic.status = "HIDDEN";
    topic.isLocked = true;
  }
  if (action === "KEEP_CONTENT" && item.targetType === "POST")
    serviceContext.findPost(item.targetId).status = "VISIBLE";
  if (action === "KEEP_CONTENT" && item.targetType === "TOPIC") {
    topic.status = "VISIBLE";
    topic.isLocked = false;
  }
  serviceContext.recordMemoryModeration(
    item,
    moderatorId,
    action,
    normalizedResolution,
    nextStatus,
  );
  item.assignedToId = moderatorId;
  item.resolution = normalizedResolution;
  item.escalationLevel += action === "ESCALATE_ADMIN" ? 1 : 0;
  if (action !== "ESCALATE_ADMIN") item.resolvedAt = now();
  for (const recipientId of new Set([
    item.reporterId,
    targetAuthorId,
    ...(action === "ESCALATE_ADMIN"
      ? [serviceContext.userIdForRole("SYSTEM_ADMIN")]
      : []),
  ]))
    serviceContext.notifications.unshift({
      id: id("notification"),
      recipientId,
      type: "FORUM_MODERATION",
      title:
        action === "ESCALATE_ADMIN"
          ? "Báo cáo diễn đàn đã được chuyển cấp"
          : "Báo cáo diễn đàn đã có kết quả",
      entityType: "CONTENT_REPORT",
      entityId: reportId,
      createdAt: now(),
    });
  return { ...item, actions: item.actions.map((record) => ({ ...record })) };
}

/** Mở khiếu nại một lần cho báo cáo đã xử lý thuộc người gửi và đưa lại vào hàng đợi. */
export async function appealReport(
  serviceContext: LearningServiceContext,
  reportId: string,
  reason: string,
  learnerId = "usr-learner",
): Promise<ContentReport> {
  const normalizedReason = reason.trim();
  if (normalizedReason.length < 10)
    throw new BadRequestException("Lý do kháng nghị phải có ít nhất 10 ký tự.");
  const prisma = serviceContext.database();
  if (prisma) {
    return prisma.$transaction(async (transaction) => {
      const item = await transaction.contentReport.findFirst({
        where: { id: reportId, reporterId: learnerId },
      });
      if (!item)
        throw new NotFoundException(
          "Không tìm thấy báo cáo được phép kháng nghị.",
        );
      if (!["RESOLVED", "REJECTED"].includes(item.status))
        throw new ConflictException(
          "Chỉ kết quả đã xử lý mới có thể kháng nghị.",
        );
      if (item.appealedAt)
        throw new ConflictException("Báo cáo này đã được kháng nghị trước đó.");
      await transaction.moderationAction.create({
        data: {
          id: id("mod-action"),
          reportId,
          actorId: learnerId,
          action: "APPEAL",
          reason: normalizedReason,
          previousStatus: item.status,
          nextStatus: "IN_REVIEW",
        },
      });
      await transaction.auditLog.create({
        data: {
          actorId: learnerId,
          action: "FORUM_REPORT_APPEAL",
          entityType: "content_report",
          entityId: reportId,
          context: { reason: normalizedReason, previousStatus: item.status },
        },
      });
      const managerIds = await serviceContext.userIdsForRole(
        transaction,
        "CENTER_MANAGER",
      );
      await transaction.notification.createMany({
        data: managerIds.map((recipientId) => ({
          id: id("notification"),
          recipientId,
          type: "FORUM_MODERATION_APPEAL",
          title: "Có kháng nghị kiểm duyệt mới",
          entityType: "CONTENT_REPORT",
          entityId: reportId,
          dedupKey: `forum-report:${reportId}:appeal:${recipientId}`,
        })),
        skipDuplicates: true,
      });
      return serviceContext.mapReport(
        await transaction.contentReport.update({
          where: { id: reportId },
          data: {
            status: "IN_REVIEW",
            assignedToId: null,
            appealReason: normalizedReason,
            appealedAt: new Date(),
            resolvedAt: null,
          },
          include: { actions: { orderBy: { createdAt: "asc" } } },
        }),
      );
    });
  }
  const item = serviceContext.reports.find(
    (report) => report.id === reportId && report.reporterId === learnerId,
  );
  if (!item)
    throw new NotFoundException("Không tìm thấy báo cáo được phép kháng nghị.");
  if (!["RESOLVED", "REJECTED"].includes(item.status))
    throw new ConflictException("Chỉ kết quả đã xử lý mới có thể kháng nghị.");
  if (item.appealedAt)
    throw new ConflictException("Báo cáo này đã được kháng nghị trước đó.");
  serviceContext.recordMemoryModeration(
    item,
    learnerId,
    "APPEAL",
    normalizedReason,
    "IN_REVIEW",
  );
  item.assignedToId = undefined;
  item.appealReason = normalizedReason;
  item.appealedAt = now();
  item.resolvedAt = undefined;
  serviceContext.notifications.unshift({
    id: id("notification"),
    recipientId: serviceContext.userIdForRole("CENTER_MANAGER"),
    type: "FORUM_MODERATION_APPEAL",
    title: "Có kháng nghị kiểm duyệt mới",
    entityType: "CONTENT_REPORT",
    entityId: reportId,
    createdAt: now(),
  });
  return { ...item, actions: item.actions.map((record) => ({ ...record })) };
}
