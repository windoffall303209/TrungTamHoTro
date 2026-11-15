import { Prisma } from "../../../../generated/prisma/client.js";
import { ForumPostWithRelations } from "../../core/learning.shared.js";
import type { ForumPost, ForumTopic, ProgressIntervention } from "../../core/learning.types.js";
import type { LearningServiceContext } from "../../core/learning.context.js";

/** Ánh xạ chủ đề diễn đàn và trạng thái điều phối. */
export function mapTopic(
  serviceContext: LearningServiceContext,
  row: Prisma.ForumTopicGetPayload<Record<string, never>>,
): ForumTopic {
  return {
    id: row.id,
    classId: row.classId,
    title: row.title,
    body: row.body,
    authorId: row.authorId,
    tags: serviceContext.toStringArray(row.tags),
    isPinned: row.isPinned,
    isLocked: row.isLocked,
    status: row.status === "PUBLISHED" ? "VISIBLE" : "HIDDEN",
    createdAt: row.createdAt.toISOString(),
  };
}

/** Ánh xạ bài viết, mentions và tệp đính kèm nếu relation đã được include. */
export function mapPost(
  row:
    | Prisma.ForumPostGetPayload<Record<string, never>>
    | ForumPostWithRelations,
): ForumPost {
  return {
    id: row.id,
    topicId: row.topicId,
    authorId: row.authorId,
    body: row.status === "PUBLISHED" ? row.body : "[Nội dung đã bị ẩn]",
    parentId: row.parentId ?? undefined,
    status: row.status === "PUBLISHED" ? "VISIBLE" : "HIDDEN",
    attachmentIds:
      row.status === "PUBLISHED" && "attachments" in row
        ? row.attachments.map((item) => item.materialId)
        : [],
    mentionedUserIds:
      row.status === "PUBLISHED" && "mentions" in row
        ? row.mentions.map((item) => item.mentionedUserId)
        : [],
    createdAt: row.createdAt.toISOString(),
    editedAt: row.editedAt?.toISOString(),
    deletedAt: row.deletedAt?.toISOString(),
    editCount: Array.isArray(row.editHistory) ? row.editHistory.length : 0,
  };
}

/** Ánh xạ biện pháp can thiệp tiến độ sang kiểu ngày ISO. */
export function mapProgressIntervention(
  serviceContext: LearningServiceContext,
  row: Prisma.ProgressInterventionGetPayload<Record<string, never>>,
): ProgressIntervention {
  return {
    id: row.id,
    classId: row.classId,
    learnerId: row.learnerId,
    ownerId: row.ownerId,
    createdById: row.createdById,
    title: row.title,
    notes: row.notes ?? undefined,
    dueAt: row.dueAt.toISOString(),
    status: row.status,
    outcome: row.outcome ?? undefined,
    cancellationReason: row.cancellationReason ?? undefined,
    acceptedAt: row.acceptedAt?.toISOString(),
    completedAt: row.completedAt?.toISOString(),
    history: serviceContext.progressInterventionHistory(row.handoffHistory),
    createdAt: row.createdAt.toISOString(),
  };
}

/** Chuẩn hóa lịch sử bàn giao JSON trước khi đưa ra API hoặc ghi nối tiếp. */
export function progressInterventionHistory(
  value: Prisma.JsonValue,
): ProgressIntervention["history"] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
    const row = entry as Record<string, Prisma.JsonValue>;
    return typeof row.fromOwnerId === "string" &&
      typeof row.toOwnerId === "string" &&
      typeof row.reason === "string" &&
      typeof row.actorId === "string" &&
      typeof row.createdAt === "string"
      ? [
          {
            fromOwnerId: row.fromOwnerId,
            toOwnerId: row.toOwnerId,
            reason: row.reason,
            actorId: row.actorId,
            createdAt: row.createdAt,
          },
        ]
      : [];
  });
}
