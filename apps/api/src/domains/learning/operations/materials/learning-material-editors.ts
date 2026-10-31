import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import type { PrismaService } from "../../../../database/prisma.service.js";
import type { LearningServiceContext } from "../../core/learning.context.js";
import { canEditMaterial } from "../access/learning-access.js";

export interface MaterialEditorEntry {
  userId: string;
  displayName: string;
  username: string;
  grantedAt: string;
}

export interface MaterialEditorCandidate {
  id: string;
  displayName: string;
  username: string;
}

/** Phân quyền sửa học liệu chỉ hỗ trợ khi chạy với PostgreSQL. */
function requireDatabase(serviceContext: LearningServiceContext): PrismaService {
  const prisma = serviceContext.database();
  if (!prisma)
    throw new ServiceUnavailableException(
      "Cần kết nối PostgreSQL để phân quyền sửa học liệu.",
    );
  return prisma;
}

/** Liệt kê người được cấp quyền sửa; người tải lên và người đang có quyền sửa đều xem được. */
export async function listMaterialEditors(
  serviceContext: LearningServiceContext,
  materialId: string,
  actorId: string,
): Promise<{ ownerId: string; editors: MaterialEditorEntry[] }> {
  const prisma = requireDatabase(serviceContext);
  const material = await prisma.material.findUnique({
    where: { id: materialId },
    include: {
      editors: {
        include: { user: { select: { displayName: true, username: true } } },
        orderBy: { createdAt: "asc" },
      },
    },
  });
  if (!material) throw new NotFoundException("Không tìm thấy học liệu.");
  if (!canEditMaterial(material, actorId))
    throw new ForbiddenException(
      "Chỉ người tải lên hoặc người được cấp quyền mới sửa được học liệu này.",
    );
  return {
    ownerId: material.ownerId,
    editors: material.editors.map((item) => ({
      userId: item.userId,
      displayName: item.user.displayName,
      username: item.user.username,
      grantedAt: item.createdAt.toISOString(),
    })),
  };
}

/** Thay toàn bộ danh sách người được cấp quyền sửa; chỉ người tải lên được thực hiện. */
export async function replaceMaterialEditors(
  serviceContext: LearningServiceContext,
  materialId: string,
  userIds: string[],
  actorId: string,
): Promise<{ ownerId: string; editors: MaterialEditorEntry[] }> {
  const prisma = requireDatabase(serviceContext);
  const material = await prisma.material.findUnique({
    where: { id: materialId },
    select: { ownerId: true },
  });
  if (!material) throw new NotFoundException("Không tìm thấy học liệu.");
  if (material.ownerId !== actorId)
    throw new ForbiddenException(
      "Chỉ người tải lên mới cấp hoặc thu hồi quyền sửa học liệu.",
    );
  const targets = [...new Set(userIds)].filter((userId) => userId !== actorId);
  const instructors = await prisma.user.count({
    where: {
      id: { in: targets },
      status: "ACTIVE",
      roles: { some: { role: { code: "INSTRUCTOR" } } },
    },
  });
  if (instructors !== targets.length)
    throw new BadRequestException(
      "Chỉ cấp quyền sửa cho giảng viên đang hoạt động.",
    );
  await prisma.$transaction([
    prisma.materialEditor.deleteMany({
      where: { materialId, userId: { notIn: targets } },
    }),
    prisma.materialEditor.createMany({
      data: targets.map((userId) => ({ materialId, userId, grantedBy: actorId })),
      skipDuplicates: true,
    }),
    prisma.auditLog.create({
      data: {
        actorId,
        action: "MATERIAL_EDITORS_UPDATED",
        entityType: "material",
        entityId: materialId,
        context: { editorIds: targets },
      },
    }),
  ]);
  return listMaterialEditors(serviceContext, materialId, actorId);
}

/** Giảng viên đang hoạt động, trừ chính người gọi, để người tải lên chọn cấp quyền sửa. */
export async function listMaterialEditorCandidates(
  serviceContext: LearningServiceContext,
  actorId: string,
): Promise<MaterialEditorCandidate[]> {
  const prisma = requireDatabase(serviceContext);
  return prisma.user.findMany({
    where: {
      id: { not: actorId },
      status: "ACTIVE",
      roles: { some: { role: { code: "INSTRUCTOR" } } },
    },
    select: { id: true, displayName: true, username: true },
    orderBy: { displayName: "asc" },
    take: 500,
  });
}
