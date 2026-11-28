import { NotFoundException } from "@nestjs/common";
import { now } from "../../core/learning.shared.js";

import type { LearningNotification } from "../../core/learning.types.js";
import type { LearningServiceContext } from "../../core/learning.context.js";

// Kiểm tra thông báo thuộc nhóm buổi học/bản ghi để đính kèm classId mở đúng tab Lịch học trong lớp.
function isSessionRelatedNotification(entityType: string, type: string): boolean {
  if (type.includes("FORUM") || type.includes("MENTION")) return false;
  return (
    entityType.trim().toUpperCase() === "LIVE_SESSION" ||
    type.includes("SESSION") ||
    type.includes("RECORDING")
  );
}

/** Liệt kê thông báo của đúng người nhận theo thời gian mới nhất kèm classId cho thông báo lịch học. */
export async function listNotifications(
  serviceContext: LearningServiceContext,
  recipientId: string,
): Promise<LearningNotification[]> {
  const prisma = serviceContext.database();
  if (prisma) {
    const rows = await prisma.notification.findMany({
      where: { recipientId },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    const sessionIds = Array.from(
      new Set(
        rows
          .filter((row) => isSessionRelatedNotification(row.entityType, row.type))
          .map((row) => row.entityId),
      ),
    );
    const sessionClassMap = new Map<string, string>();
    if (sessionIds.length > 0) {
      const sessions = await prisma.liveSession.findMany({
        where: { id: { in: sessionIds } },
        select: { id: true, classId: true },
      });
      for (const sessionItem of sessions) {
        sessionClassMap.set(sessionItem.id, sessionItem.classId);
      }
    }
    return rows.map((row) => {
      const classId = isSessionRelatedNotification(row.entityType, row.type)
        ? sessionClassMap.get(row.entityId)
        : undefined;
      return {
        id: row.id,
        recipientId: row.recipientId,
        type: row.type,
        title: row.title,
        entityType: row.entityType,
        entityId: row.entityId,
        ...(classId ? { classId } : {}),
        readAt: row.readAt?.toISOString(),
        createdAt: row.createdAt.toISOString(),
      };
    });
  }
  return serviceContext.notifications
    .filter((item) => item.recipientId === recipientId)
    .map((item) => {
      const resolvedClassId =
        item.classId ??
        (isSessionRelatedNotification(item.entityType, item.type)
          ? serviceContext.sessions.find((sessionItem) => sessionItem.id === item.entityId)?.classId
          : undefined);
      return {
        ...item,
        ...(resolvedClassId ? { classId: resolvedClassId } : {}),
      };
    });
}

/** Đánh dấu đã đọc bằng điều kiện recipientId để ngăn sửa thông báo người khác và giữ nguyên classId. */
export async function markNotificationRead(
  serviceContext: LearningServiceContext,
  notificationId: string,
  recipientId: string,
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
    let classId: string | undefined;
    if (isSessionRelatedNotification(row.entityType, row.type)) {
      const sessionItem = await prisma.liveSession.findUnique({
        where: { id: row.entityId },
        select: { classId: true },
      });
      classId = sessionItem?.classId;
    }
    return {
      id: row.id,
      recipientId: row.recipientId,
      type: row.type,
      title: row.title,
      entityType: row.entityType,
      entityId: row.entityId,
      ...(classId ? { classId } : {}),
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
  const resolvedClassId =
    item.classId ??
    (isSessionRelatedNotification(item.entityType, item.type)
      ? serviceContext.sessions.find((sessionItem) => sessionItem.id === item.entityId)?.classId
      : undefined);
  return {
    ...item,
    ...(resolvedClassId ? { classId: resolvedClassId } : {}),
  };
}

/** Đánh dấu mọi thông báo chưa đọc của người nhận bằng một lệnh UPDATE thay vì N request PATCH song song từ client. */
export async function markAllNotificationsRead(
  serviceContext: LearningServiceContext,
  recipientId: string,
): Promise<LearningNotification[]> {
  const prisma = serviceContext.database();
  if (prisma) {
    await prisma.notification.updateMany({
      where: { recipientId, readAt: null },
      data: { readAt: new Date() },
    });
    return listNotifications(serviceContext, recipientId);
  }
  const timestamp = now();
  for (const item of serviceContext.notifications) {
    if (item.recipientId === recipientId) item.readAt ??= timestamp;
  }
  return listNotifications(serviceContext, recipientId);
}
