import { BadRequestException, NotFoundException } from "@nestjs/common";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { prepareVerifiedDownload } from "../../../../infrastructure/verified-download.js";
import {
  id,
  MaterialAccessAction,
  MaterialDownload,
  now,
} from "../../core/learning.shared.js";
import type { LearningServiceContext } from "../../core/learning.context.js";
import { assertMaterialReadAccess, assertMemoryMaterialReadAccess, MATERIAL_READ_RELATIONS } from "../access/learning-access.js";

/** Phát URL truy cập học liệu ký HMAC có thời hạn sau khi kiểm tra quyền. */
export async function createMaterialAccess(
  serviceContext: LearningServiceContext,
  materialId: string,
  role: string,
  action: MaterialAccessAction = "DOWNLOAD",
  actorId = serviceContext.userIdForRole(role),
): Promise<{ url: string; expiresAt: string }> {
  const prisma = serviceContext.database();
  if (prisma) {
    const material = await prisma.material.findUnique({
      where: { id: materialId },
      include: MATERIAL_READ_RELATIONS,
    });
    if (!material) throw new NotFoundException("Không tìm thấy học liệu.");
    if (material.quarantinedAt)
      throw new BadRequestException(
        "Tệp đang bị cách ly và không thể truy cập.",
      );
    if (role === "LEARNER" && material.visibility !== "PUBLISHED")
      throw new NotFoundException("Không tìm thấy học liệu đã phát hành.");
    assertMaterialReadAccess(material, role, actorId);
    if (!serviceContext.isMaterialObjectKey(material.objectKey))
      throw new NotFoundException("Học liệu này chưa có tệp bytes để tải.");
  } else {
    const material = serviceContext.materials.find(
      (item) => item.id === materialId,
    );
    if (material?.quarantinedAt)
      throw new BadRequestException(
        "Tệp đang bị cách ly và không thể truy cập.",
      );
    if (
      !material ||
      (role === "LEARNER" && material.visibility !== "PUBLISHED")
    )
      throw new NotFoundException("Không tìm thấy học liệu.");
    assertMemoryMaterialReadAccess(serviceContext, material, role, actorId);
    if (!serviceContext.materialFiles.has(materialId))
      throw new NotFoundException("Học liệu này chưa có tệp bytes để tải.");
  }
  const expires = Math.floor(Date.now() / 1000) + 300;
  const signature = serviceContext.signMaterialAccess(
    materialId,
    expires,
    action,
  );
  return {
    url: `/materials/${materialId}/download?expires=${expires}&action=${action}&signature=${encodeURIComponent(signature)}`,
    expiresAt: new Date(expires * 1000).toISOString(),
  };
}

/** Giữ API đọc bộ đệm cho tác vụ nội bộ và kiểm thử với xác minh checksum. */
export async function readMaterialDownload(
  serviceContext: LearningServiceContext,
  ...args: Parameters<LearningServiceContext["resolveMaterialDownload"]>
): Promise<MaterialDownload> {
  const file = await serviceContext.resolveMaterialDownload(...args);
  return readResolvedMaterialDownload(serviceContext, file);
}

/** Đọc bytes học liệu đã được phân quyền và kiểm tra checksum trước khi trả về. */
export async function readResolvedMaterialDownload(
  serviceContext: LearningServiceContext,
  file: Awaited<ReturnType<LearningServiceContext["resolveMaterialDownload"]>>,
): Promise<MaterialDownload> {
  const buffer = await serviceContext.readStoredFile(file.objectKey);
  if (
    file.checksum &&
    `sha256:${createHash("sha256").update(buffer).digest("hex")}` !==
      file.checksum
  )
    throw new BadRequestException("Checksum học liệu không hợp lệ.");
  return { fileName: file.fileName, mimeType: file.mimeType, buffer };
}

/** Chuẩn bị luồng đã kiểm chứng với bộ nhớ giới hạn cho HTTP download. */
export async function readMaterialDownloadStream(
  serviceContext: LearningServiceContext,
  ...args: Parameters<LearningServiceContext["resolveMaterialDownload"]>
): Promise<{
  stream: ReturnType<typeof createReadStream>;
  size: number;
  fileName: string;
  mimeType: string;
}> {
  const file = await serviceContext.resolveMaterialDownload(...args);
  return streamResolvedMaterialDownload(serviceContext, file);
}

/** Tạo luồng tải tạm đã xác minh từ metadata của học liệu được phân quyền. */
export async function streamResolvedMaterialDownload(
  serviceContext: LearningServiceContext,
  file: Awaited<ReturnType<LearningServiceContext["resolveMaterialDownload"]>>,
): Promise<{
  stream: ReturnType<typeof createReadStream>;
  size: number;
  fileName: string;
  mimeType: string;
}> {
  const content = await prepareVerifiedDownload(
    async () =>
      serviceContext.objectStorage
        ? serviceContext.objectStorage.openReadStream(file.objectKey)
        : createReadStream(serviceContext.resolveObjectPath(file.objectKey)),
    file.checksum,
  );
  return { ...content, fileName: file.fileName, mimeType: file.mimeType };
}

/** Xác minh chữ ký/quyền và lấy vị trí object, không nạp toàn bộ nội dung vào RAM. */
export async function resolveMaterialDownload(
  serviceContext: LearningServiceContext,
  materialId: string,
  expires: number,
  signature: string,
  role: string,
  action: MaterialAccessAction = "DOWNLOAD",
  context: { ipAddress?: string; userAgent?: string } = {},
  actorId = serviceContext.userIdForRole(role),
): Promise<{
  fileName: string;
  mimeType: string;
  objectKey: string;
  checksum?: string;
}> {
  serviceContext.verifyMaterialAccess(materialId, expires, signature, action);
  const prisma = serviceContext.database();
  let fileName: string;
  let mimeType: string;
  let objectKey: string | undefined;
  let expectedChecksum: string | undefined;
  if (prisma) {
    const material = await prisma.material.findUnique({
      where: { id: materialId },
      include: MATERIAL_READ_RELATIONS,
    });
    if (
      !material ||
      (role === "LEARNER" && material.visibility !== "PUBLISHED")
    )
      throw new NotFoundException("Không tìm thấy học liệu.");
    if (material.quarantinedAt)
      throw new BadRequestException(
        "Tệp đang bị cách ly và không thể truy cập.",
      );
    assertMaterialReadAccess(material, role, actorId);
    fileName = material.name;
    mimeType = material.mimeType;
    objectKey = material.objectKey;
    expectedChecksum = material.checksum ?? undefined;
  } else {
    const material = serviceContext.materials.find(
      (item) => item.id === materialId,
    );
    const stored = serviceContext.materialFiles.get(materialId);
    if (
      !material ||
      !stored ||
      (role === "LEARNER" && material.visibility !== "PUBLISHED")
    )
      throw new NotFoundException("Không tìm thấy học liệu.");
    if (material.quarantinedAt)
      throw new BadRequestException(
        "Tệp đang bị cách ly và không thể truy cập.",
      );
    assertMemoryMaterialReadAccess(serviceContext, material, role, actorId);
    fileName = material.name;
    mimeType = material.mimeType;
    objectKey = stored.objectKey;
    expectedChecksum = stored.checksum;
  }
  if (!objectKey || !serviceContext.isMaterialObjectKey(objectKey))
    throw new NotFoundException("Tệp học liệu không tồn tại trong kho bytes.");
  const userId = actorId;
  if (prisma) {
    await prisma.materialAccessLog.create({
      data: {
        id: id("material-access"),
        materialId,
        userId,
        action,
        ipAddress: context.ipAddress?.slice(0, 45),
        userAgent: context.userAgent?.slice(0, 500),
      },
    });
  } else {
    serviceContext.materialAccessLogs.unshift({
      materialId,
      userId,
      action,
      createdAt: now(),
    });
  }
  return { fileName, mimeType, objectKey, checksum: expectedChecksum };
}
