import { NotFoundException } from "@nestjs/common";
import { now } from "../../core/learning.shared.js";

import type { LearningNotification } from "../../core/learning.types.js";
import type { LearningServiceContext } from "../../core/learning.context.js";

/** Liệt kê thông báo của đúng người nhận theo thời gian mới nhất. */
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

/** Đánh dấu mọi thông báo chưa đọc của người nhận bằng một lệnh UPDATE thay vì N request PATCH song song từ client. */
export async function markAllNotificationsRead(
  serviceContext: LearningServiceContext,
  recipientId: string,
): Promise<LearningNotification[]> {
  const prisma = serviceContext.database();
  if (prisma) {
    await prisma.notification.updateMany({ where: { recipientId, readAt: null }, data: { readAt: new Date() } });
    return listNotifications(serviceContext, recipientId);
  }
  const timestamp = now();
  for (const item of serviceContext.notifications) if (item.recipientId === recipientId) item.readAt ??= timestamp;
  return listNotifications(serviceContext, recipientId);
}
