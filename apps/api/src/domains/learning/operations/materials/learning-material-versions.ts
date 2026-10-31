import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  DEFAULT_MATERIAL_MIME_TYPES,
  normalizeMultipartFileName,
} from "../../../../infrastructure/file-transfer.js";
import {
  id,
  MaterialAccessAction,
  MaterialDownload,
  now,
  UploadedMaterialFile,
} from "../../core/learning.shared.js";
import type {
  LearningMaterial,
  MaterialVersionSnapshot,
} from "../../core/learning.types.js";
import type { LearningServiceContext } from "../../core/learning.context.js";
import { assertMaterialReadAccess, assertMemoryMaterialReadAccess, canEditMaterial, MATERIAL_READ_RELATIONS } from "../access/learning-access.js";
import { readResolvedMaterialDownload, streamResolvedMaterialDownload } from "./learning-material-downloads.js";

// Mỗi học liệu chỉ giữ 3 tệp tải lên gần nhất, tính cả tệp hiện tại.
const MAX_MATERIAL_FILE_VERSIONS = 3;

/** Giữ chung quy tắc ẩn phiên bản khi học liệu bị cách ly hoặc người học chưa được công bố. */
function isUnavailableMaterialVersion(
  role: string,
  material: { quarantinedAt?: Date | string | null; visibility: string },
  versionVisibility: string,
): boolean {
  return Boolean(material.quarantinedAt) ||
    (role === "LEARNER" &&
      (versionVisibility !== "PUBLISHED" || material.visibility === "HIDDEN"));
}

/** Đọc phiên bản học liệu và kiểm tra quyền giống nhau ở cả luồng cấp URL và tải tệp. */
async function loadAuthorizedMaterialVersion(
  serviceContext: LearningServiceContext,
  materialId: string,
  version: number,
  role: string,
  actorId: string,
): Promise<{
  name: string;
  mimeType: string;
  objectKey?: string;
  checksum?: string;
  prisma: ReturnType<LearningServiceContext["database"]>;
}> {
  const prisma = serviceContext.database();
  if (prisma) {
    const row = await prisma.materialVersion.findUnique({
      where: { materialId_version: { materialId, version } },
      include: { material: { include: MATERIAL_READ_RELATIONS } },
    });
    if (!row || isUnavailableMaterialVersion(role, row.material, row.visibility))
      throw new NotFoundException("Không tìm thấy phiên bản học liệu.");
    assertMaterialReadAccess(row.material, role, actorId);
    return {
      name: row.name,
      mimeType: row.mimeType,
      objectKey: row.objectKey,
      checksum: row.checksum ?? undefined,
      prisma,
    };
  }

  const material = serviceContext.materials.find((item) => item.id === materialId);
  const row = serviceContext.materialVersions.find(
    (item) => item.materialId === materialId && item.version === version,
  );
  if (!material || !row || isUnavailableMaterialVersion(role, material, row.visibility))
    throw new NotFoundException("Không tìm thấy phiên bản học liệu.");
  assertMemoryMaterialReadAccess(serviceContext, material, role, actorId);
  return { name: row.name, mimeType: row.mimeType, objectKey: row.objectKey, checksum: row.checksum, prisma };
}

/** Liệt kê lịch sử phiên bản sau khi kiểm tra quyền truy cập học liệu cha. */
export async function listMaterialVersions(
  serviceContext: LearningServiceContext,
  materialId: string,
  role: string,
  actorId = serviceContext.userIdForRole(role),
): Promise<MaterialVersionSnapshot[]> {
  const prisma = serviceContext.database();
  if (prisma) {
    const material = await prisma.material.findUnique({
      where: { id: materialId },
      include: MATERIAL_READ_RELATIONS,
    });
    if (!material) throw new NotFoundException("Không tìm thấy học liệu.");
    assertMaterialReadAccess(material, role, actorId);
    const rows = await prisma.materialVersion.findMany({
      where: {
        materialId,
        ...(role === "LEARNER" ? { visibility: "PUBLISHED" } : {}),
      },
      orderBy: { version: "desc" },
    });
    return rows.map((row) => serviceContext.mapMaterialVersion(row));
  }
  const material = serviceContext.materials.find(
    (item) => item.id === materialId,
  );
  if (!material) throw new NotFoundException("Không tìm thấy học liệu.");
  assertMemoryMaterialReadAccess(serviceContext, material, role, actorId);
  return serviceContext.materialVersions
    .filter(
      (item) =>
        item.materialId === materialId &&
        (role !== "LEARNER" || item.visibility === "PUBLISHED"),
    )
    .sort((a, b) => b.version - a.version)
    .map((item) => ({
      id: item.id,
      materialId: item.materialId,
      version: item.version,
      name: normalizeMultipartFileName(item.name),
      mimeType: item.mimeType,
      sizeBytes: item.sizeBytes,
      folder: item.folder,
      tags: [...item.tags],
      visibility: item.visibility,
      createdBy: item.createdBy,
      createdAt: item.createdAt,
    }));
}

/** Phát URL ký cho một version cụ thể và ràng buộc chữ ký với hành động xem/tải. */
export async function createMaterialVersionAccess(
  serviceContext: LearningServiceContext,
  materialId: string,
  version: number,
  role: string,
  action: MaterialAccessAction = "DOWNLOAD",
  actorId = serviceContext.userIdForRole(role),
): Promise<{ url: string; expiresAt: string }> {
  const row = await loadAuthorizedMaterialVersion(serviceContext, materialId, version, role, actorId);
  if (!row.objectKey || !serviceContext.isMaterialObjectKey(row.objectKey))
    throw new NotFoundException("Phiên bản này chưa có tệp bytes để tải.");
  const expires = Math.floor(Date.now() / 1000) + 300;
  const signature = serviceContext.signMaterialAccess(
    `${materialId}:${version}`,
    expires,
    action,
  );
  return {
    url: `/materials/${materialId}/versions/${version}/download?expires=${expires}&action=${action}&signature=${encodeURIComponent(signature)}`,
    expiresAt: new Date(expires * 1000).toISOString(),
  };
}

/** Giữ API đọc bộ đệm cho tác vụ nội bộ và kiểm thử với xác minh checksum. */
export async function readMaterialVersionDownload(
  serviceContext: LearningServiceContext,
  ...args: Parameters<LearningServiceContext["resolveMaterialVersionDownload"]>
): Promise<MaterialDownload> {
  const file = await serviceContext.resolveMaterialVersionDownload(...args);
  return readResolvedMaterialDownload(serviceContext, file);
}

/** Chuẩn bị luồng đã kiểm chứng với bộ nhớ giới hạn cho HTTP download. */
export async function readMaterialVersionDownloadStream(
  serviceContext: LearningServiceContext,
  ...args: Parameters<LearningServiceContext["resolveMaterialVersionDownload"]>
): Promise<{
  stream: ReturnType<typeof createReadStream>;
  size: number;
  fileName: string;
  mimeType: string;
}> {
  const file = await serviceContext.resolveMaterialVersionDownload(...args);
  return streamResolvedMaterialDownload(serviceContext, file);
}

/** Xác minh quyền/chữ ký phiên bản và lấy metadata của object được phép truy cập. */
export async function resolveMaterialVersionDownload(
  serviceContext: LearningServiceContext,
  materialId: string,
  version: number,
  expires: number,
  signature: string,
  role: string,
  action: MaterialAccessAction = "DOWNLOAD",
  actorId = serviceContext.userIdForRole(role),
): Promise<{
  fileName: string;
  mimeType: string;
  objectKey: string;
  checksum?: string;
}> {
  serviceContext.verifyMaterialAccess(
    `${materialId}:${version}`,
    expires,
    signature,
    action,
  );
  const { name: fileName, mimeType, objectKey, checksum, prisma } =
    await loadAuthorizedMaterialVersion(serviceContext, materialId, version, role, actorId);
  if (!objectKey || !serviceContext.isMaterialObjectKey(objectKey))
    throw new NotFoundException("Tệp phiên bản không tồn tại trong kho bytes.");
  if (prisma)
    await prisma.materialAccessLog.create({
      data: {
        id: id("material-access"),
        materialId,
        userId: actorId,
        action: `${action}_V${version}`,
      },
    });
  else
    serviceContext.materialAccessLogs.unshift({
      materialId,
      userId: actorId,
      action,
      createdAt: now(),
    });
  return { fileName, mimeType, objectKey, checksum };
}

/** Quét và lưu tệp mới, tăng version nguyên tử, giữ snapshot cũ và dọn object khi lỗi. */
export async function replaceMaterialVersion(
  serviceContext: LearningServiceContext,
  materialId: string,
  input: Pick<LearningMaterial, "folder" | "tags">,
  upload: UploadedMaterialFile,
  actorId = "usr-instructor",
): Promise<LearningMaterial> {
  const prisma = serviceContext.database();
  const policy = prisma
    ? await serviceContext.getStoragePolicy(prisma)
    : {
        maxFileSizeMb: 50,
        storageQuotaMb: 10_240,
        allowedMimeTypes: [...DEFAULT_MATERIAL_MIME_TYPES],
      };
  if (upload.size > policy.maxFileSizeMb * 1_000_000)
    throw new BadRequestException(
      `Tệp vượt giới hạn ${policy.maxFileSizeMb} MB.`,
    );
  if (!policy.allowedMimeTypes.includes(upload.mimeType))
    throw new BadRequestException(
      "Loại MIME không được chính sách lưu trữ cho phép.",
    );
  const quarantineReason = await serviceContext.scanUpload(upload);
  if (prisma) {
    const storedVersions = await prisma.materialVersion.findMany({
      distinct: ["objectKey"],
      select: { sizeBytes: true },
    });
    if (
      storedVersions.reduce((sum, item) => sum + item.sizeBytes, 0n) +
        BigInt(upload.size) >
      BigInt(policy.storageQuotaMb) * 1_000_000n
    )
      throw new BadRequestException("Kho lưu trữ đã vượt quota hệ thống.");
    const current = await prisma.material.findUnique({
      where: { id: materialId },
      include: { class: true, editors: { select: { userId: true } } },
    });
    if (!current) throw new NotFoundException("Không tìm thấy học liệu.");
    if (!canEditMaterial(current, actorId))
      throw new ForbiddenException(
        "Chỉ người tải lên hoặc người được cấp quyền mới sửa được học liệu này.",
      );
    if (current.class?.status === "CLOSED")
      throw new ConflictException("Lớp đã lưu trữ và chỉ cho phép đọc.");
    const nextVersion = current.version + 1;
    const stored = await serviceContext.storeUpload(
      current.classId ?? `course-${current.courseId}`,
      `${materialId}-v${nextVersion}-${randomUUID()}`,
      upload,
      Boolean(quarantineReason),
    );
    let result: { material: LearningMaterial; prunedKeys: string[] };
    try {
      result = await prisma.$transaction(async (transaction) => {
        const updated = await transaction.material.update({
          where: { id: materialId },
          data: {
            name: upload.originalName.trim(),
            objectKey: stored.objectKey,
            checksum: stored.checksum,
            mimeType: upload.mimeType,
            sizeBytes: BigInt(upload.size),
            folder: input.folder.trim(),
            tags: input.tags,
            version: nextVersion,
            visibility: quarantineReason ? "HIDDEN" : "DRAFT",
            quarantinedAt: quarantineReason ? new Date() : null,
            quarantineReason,
          },
        });
        await transaction.materialVersion.create({
          data: {
            id: id("material-version"),
            materialId,
            version: nextVersion,
            name: updated.name,
            objectKey: updated.objectKey,
            mimeType: updated.mimeType,
            sizeBytes: updated.sizeBytes,
            checksum: updated.checksum,
            folder: updated.folder,
            tags: serviceContext.toStringArray(updated.tags),
            visibility: updated.visibility,
            createdBy: actorId,
          },
        });
        // Đổi thư mục, thẻ hay xuất bản tạo phiên bản dùng lại tệp cũ, nên đếm theo tệp chứ không theo số dòng.
        const history = await transaction.materialVersion.findMany({
          where: { materialId },
          select: { objectKey: true },
          orderBy: { version: "desc" },
        });
        const prunedKeys = [
          ...new Set(history.map((item) => item.objectKey)),
        ].slice(MAX_MATERIAL_FILE_VERSIONS);
        if (prunedKeys.length)
          await transaction.materialVersion.deleteMany({
            where: { materialId, objectKey: { in: prunedKeys } },
          });
        return { material: serviceContext.mapMaterial(updated), prunedKeys };
      });
    } catch (error) {
      await serviceContext.removeStoredFile(stored.objectKey);
      throw error;
    }
    // Xóa tệp của phiên bản cũ sau khi giao dịch thành công; lỗi kho không làm hỏng lần tải lên.
    await Promise.all(
      result.prunedKeys
        .filter((key) => serviceContext.isMaterialObjectKey(key))
        .map((key) => serviceContext.removeStoredFile(key).catch((error: unknown) => {
          Logger.warn(`Không thể dọn tệp phiên bản học liệu ${key}: ${error instanceof Error ? error.message : String(error)}`, "LearningMaterialVersions");
        })),
    );
    return result.material;
  }
  const current = serviceContext.materials.find(
    (item) => item.id === materialId,
  );
  if (!current) throw new NotFoundException("Không tìm thấy học liệu.");
  if (!canEditMaterial(current, actorId))
    throw new ForbiddenException(
      "Chỉ người tải lên hoặc người được cấp quyền mới sửa được học liệu này.",
    );
  if (current.classId && serviceContext.findClass(current.classId).status === "CLOSED")
    throw new ConflictException("Lớp đã lưu trữ và chỉ cho phép đọc.");
  const distinctStoredBytes = [
    ...new Map(
      serviceContext.materialVersions
        .filter((item) => item.objectKey)
        .map((item) => [item.objectKey, item.sizeBytes]),
    ).values(),
  ].reduce((sum, size) => sum + size, 0);
  if (distinctStoredBytes + upload.size > policy.storageQuotaMb * 1_000_000)
    throw new BadRequestException("Kho lưu trữ đã vượt quota hệ thống.");
  const nextVersion = current.version + 1;
  const stored = await serviceContext.storeUpload(
    current.classId ?? `course-${current.courseId}`,
    `${materialId}-v${nextVersion}-${randomUUID()}`,
    upload,
    Boolean(quarantineReason),
  );
  Object.assign(current, {
    name: upload.originalName.trim(),
    mimeType: upload.mimeType,
    sizeBytes: upload.size,
    folder: input.folder.trim(),
    tags: [...input.tags],
    version: nextVersion,
    visibility: quarantineReason ? "HIDDEN" : "DRAFT",
    quarantinedAt: quarantineReason ? now() : undefined,
    quarantineReason,
  });
  serviceContext.materialFiles.set(materialId, stored);
  serviceContext.materialVersions.unshift({
    ...current,
    id: id("material-version"),
    materialId,
    createdBy: actorId,
    objectKey: stored.objectKey,
    checksum: stored.checksum,
    tags: [...current.tags],
  });
  const keptKeys = new Set(
    [
      ...new Set(
        serviceContext.materialVersions
          .filter((item) => item.materialId === materialId)
          .sort((a, b) => b.version - a.version)
          .map((item) => item.objectKey),
      ),
    ].slice(0, MAX_MATERIAL_FILE_VERSIONS),
  );
  for (let index = serviceContext.materialVersions.length - 1; index >= 0; index -= 1) {
    const item = serviceContext.materialVersions[index]!;
    if (item.materialId === materialId && !keptKeys.has(item.objectKey))
      serviceContext.materialVersions.splice(index, 1);
  }
  return { ...current, tags: [...current.tags] };
}
