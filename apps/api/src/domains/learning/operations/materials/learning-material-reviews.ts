import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";
import { id, now } from "../../core/learning.shared.js";
import type {
  FileReviewRecord,
  LearningMaterial,
  MaterialReviewDecision,
} from "../../core/learning.types.js";
import type { LearningServiceContext } from "../../core/learning.context.js";
import { canEditMaterial } from "../access/learning-access.js";

/** Ghi rõ quyết định và lý do để giảng viên biết cần sửa gì. */
function reviewNotificationTitle(
  name: string,
  action: MaterialReviewDecision,
  reason?: string,
): string {
  const title =
    action === "APPROVE"
      ? `Học liệu "${name}" đã được duyệt và phát hành.`
      : `Học liệu "${name}" bị thu hồi: ${reason}`;
  return title.slice(0, 255);
}

/** Áp dụng quyết định kiểm duyệt học liệu, cập nhật cách ly/visibility và ghi lịch sử. */
export async function reviewClassMaterial(
  serviceContext: LearningServiceContext,
  materialId: string,
  action: MaterialReviewDecision,
  rawReason?: string,
  reviewerId = "usr-manager",
): Promise<LearningMaterial> {
  const reason = rawReason?.trim();
  if (action === "REVOKE" && (!reason || reason.length < 5)) {
    throw new BadRequestException(
      "Cần lý do ít nhất 5 ký tự khi thu hồi học liệu.",
    );
  }
  // Thu hồi ẩn học liệu khỏi học viên; giảng viên tự sửa hoặc xóa rồi gửi duyệt lại.
  const visibility: LearningMaterial["visibility"] =
    action === "APPROVE" ? "PUBLISHED" : "HIDDEN";
  const prisma = serviceContext.database();
  if (prisma) {
    return prisma.$transaction(async (transaction) => {
      const current = await transaction.material.findUnique({
        where: { id: materialId },
        include: { class: true },
      });
      if (!current) throw new NotFoundException("Không tìm thấy học liệu.");
      if (current.class?.status === "CLOSED")
        throw new ConflictException("Lớp đã lưu trữ và chỉ cho phép đọc.");
      if (current.quarantinedAt && action === "APPROVE")
        throw new BadRequestException("Không thể duyệt tệp đang bị cách ly.");
      const material = await transaction.material.update({
        where: { id: materialId },
        data: { visibility, version: { increment: 1 } },
      });
      await transaction.materialVersion.create({
        data: {
          id: id("material-version"),
          materialId,
          version: material.version,
          name: material.name,
          objectKey: material.objectKey,
          mimeType: material.mimeType,
          sizeBytes: material.sizeBytes,
          checksum: material.checksum,
          folder: material.folder,
          tags: serviceContext.toStringArray(material.tags),
          visibility: material.visibility,
          createdBy: reviewerId,
        },
      });
      const reviewId = id("file-review");
      await transaction.fileReview.create({
        data: { id: reviewId, materialId, reviewerId, action, reason },
      });
      await transaction.auditLog.create({
        data: {
          actorId: reviewerId,
          action: `MATERIAL_${action}`,
          entityType: "material",
          entityId: materialId,
          context: {
            reason: reason ?? "Duyệt phát hành",
            before: current.visibility,
            after: visibility,
          },
        },
      });
      await transaction.notification.create({
        data: {
          id: id("notification"),
          recipientId: current.ownerId,
          type: "MATERIAL_REVIEWED",
          title: reviewNotificationTitle(current.name, action, reason),
          entityType: "MATERIAL",
          entityId: materialId,
          dedupKey: `material-review:${reviewId}:${current.ownerId}`,
        },
      });
      return serviceContext.mapMaterial(material);
    });
  }
  const item = serviceContext.materials.find(
    (material) => material.id === materialId,
  );
  if (!item) throw new NotFoundException("Không tìm thấy học liệu.");
  if (item.classId && serviceContext.findClass(item.classId).status === "CLOSED")
    throw new ConflictException("Lớp đã lưu trữ và chỉ cho phép đọc.");
  if (item.quarantinedAt && action === "APPROVE")
    throw new BadRequestException("Không thể duyệt tệp đang bị cách ly.");
  const review: FileReviewRecord = {
    id: id("file-review"),
    materialId,
    reviewerId,
    action,
    reason,
    createdAt: now(),
  };
  serviceContext.materialReviews.unshift(review);
  item.visibility = visibility;
  item.version += 1;
  const stored = serviceContext.materialFiles.get(materialId);
  serviceContext.materialVersions.unshift({
    ...item,
    id: id("material-version"),
    materialId,
    createdBy: reviewerId,
    objectKey: stored?.objectKey,
    checksum: stored?.checksum,
    tags: [...item.tags],
  });
  serviceContext.notifications.unshift({
    id: id("notification"),
    recipientId: item.ownerId,
    type: "MATERIAL_REVIEWED",
    title: reviewNotificationTitle(item.name, action, reason),
    entityType: "MATERIAL",
    entityId: materialId,
    createdAt: now(),
  });
  return { ...item, tags: [...item.tags] };
}

/** Liệt kê các quyết định kiểm duyệt mới nhất trước; editorId giới hạn cho người tải lên hoặc được cấp quyền sửa. */
export async function listMaterialReviews(
  serviceContext: LearningServiceContext,
  materialId: string,
  editorId?: string,
): Promise<FileReviewRecord[]> {
  const prisma = serviceContext.database();
  if (prisma) {
    const material = await prisma.material.findUnique({
      where: { id: materialId },
      select: { ownerId: true, editors: { select: { userId: true } } },
    });
    if (!material) throw new NotFoundException("Không tìm thấy học liệu.");
    if (editorId && !canEditMaterial(material, editorId))
      throw new ForbiddenException(
        "Chỉ người tải lên hoặc người được cấp quyền mới xem được lịch sử kiểm duyệt.",
      );
    const rows = await prisma.fileReview.findMany({
      where: { materialId },
      orderBy: { createdAt: "desc" },
    });
    return rows.map((row) => ({
      id: row.id,
      materialId: row.materialId,
      reviewerId: row.reviewerId,
      action: serviceContext.fileReviewAction(row.action),
      reason: row.reason ?? undefined,
      createdAt: row.createdAt.toISOString(),
    }));
  }
  const material = serviceContext.materials.find(
    (item) => item.id === materialId,
  );
  if (!material) throw new NotFoundException("Không tìm thấy học liệu.");
  if (editorId && !canEditMaterial(material, editorId))
    throw new ForbiddenException(
      "Chỉ người tải lên hoặc người được cấp quyền mới xem được lịch sử kiểm duyệt.",
    );
  return serviceContext.materialReviews
    .filter((review) => review.materialId === materialId)
    .map((review) => ({ ...review }));
}
