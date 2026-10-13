import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  DEFAULT_MATERIAL_MIME_TYPES,
  normalizeMultipartFileName,
} from "../../infrastructure/file-transfer.js";
import { prepareVerifiedDownload } from "../../infrastructure/verified-download.js";
import {
  id,
  MaterialAccessAction,
  MaterialDownload,
  now,
  UploadedMaterialFile,
} from "../learning.shared.js";
import type {
  LearningMaterial,
  MaterialVersionSnapshot,
} from "../learning.types.js";
import type { LearningServiceContext } from "../learning.context.js";

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
      include: {
        class: { include: { enrollments: true, instructors: true } },
      },
    });
    if (!material) throw new NotFoundException("Không tìm thấy học liệu.");
    serviceContext.assertMaterialClassAccess(material.class, role, actorId);
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
  serviceContext.assertMemoryMaterialClassAccess(
    material.classId,
    role,
    actorId,
  );
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
  const prisma = serviceContext.database();
  if (prisma) {
    const row = await prisma.materialVersion.findUnique({
      where: { materialId_version: { materialId, version } },
      include: {
        material: {
          include: {
            class: { include: { enrollments: true, instructors: true } },
          },
        },
      },
    });
    if (
      !row ||
      row.material.quarantinedAt ||
      (role === "LEARNER" &&
        (row.visibility !== "PUBLISHED" ||
          row.material.visibility === "HIDDEN"))
    )
      throw new NotFoundException("Không tìm thấy phiên bản học liệu.");
    serviceContext.assertMaterialClassAccess(row.material.class, role, actorId);
    if (!serviceContext.isMaterialObjectKey(row.objectKey))
      throw new NotFoundException("Phiên bản này chưa có tệp bytes để tải.");
  } else {
    const material = serviceContext.materials.find(
      (item) => item.id === materialId,
    );
    const row = serviceContext.materialVersions.find(
      (item) => item.materialId === materialId && item.version === version,
    );
    if (
      !material ||
      !row ||
      material.quarantinedAt ||
      (role === "LEARNER" &&
        (row.visibility !== "PUBLISHED" || material.visibility === "HIDDEN"))
    )
      throw new NotFoundException("Không tìm thấy phiên bản học liệu.");
    serviceContext.assertMemoryMaterialClassAccess(
      material.classId,
      role,
      actorId,
    );
    if (!row.objectKey || !serviceContext.isMaterialObjectKey(row.objectKey))
      throw new NotFoundException("Phiên bản này chưa có tệp bytes để tải.");
  }
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
  const content = await prepareVerifiedDownload(
    async () =>
      serviceContext.objectStorage
        ? serviceContext.objectStorage.openReadStream(file.objectKey)
        : createReadStream(serviceContext.resolveObjectPath(file.objectKey)),
    file.checksum,
  );
  return { ...content, fileName: file.fileName, mimeType: file.mimeType };
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
  const prisma = serviceContext.database();
  let fileName: string;
  let mimeType: string;
  let objectKey: string | undefined;
  let checksum: string | undefined;
  if (prisma) {
    const row = await prisma.materialVersion.findUnique({
      where: { materialId_version: { materialId, version } },
      include: {
        material: {
          include: {
            class: { include: { enrollments: true, instructors: true } },
          },
        },
      },
    });
    if (
      !row ||
      row.material.quarantinedAt ||
      (role === "LEARNER" &&
        (row.visibility !== "PUBLISHED" ||
          row.material.visibility === "HIDDEN"))
    )
      throw new NotFoundException("Không tìm thấy phiên bản học liệu.");
    serviceContext.assertMaterialClassAccess(row.material.class, role, actorId);
    ({ name: fileName, mimeType, objectKey } = row);
    checksum = row.checksum ?? undefined;
  } else {
    const material = serviceContext.materials.find(
      (item) => item.id === materialId,
    );
    const row = serviceContext.materialVersions.find(
      (item) => item.materialId === materialId && item.version === version,
    );
    if (
      !material ||
      !row ||
      material.quarantinedAt ||
      (role === "LEARNER" &&
        (row.visibility !== "PUBLISHED" || material.visibility === "HIDDEN"))
    )
      throw new NotFoundException("Không tìm thấy phiên bản học liệu.");
    serviceContext.assertMemoryMaterialClassAccess(
      material.classId,
      role,
      actorId,
    );
    fileName = row.name;
    mimeType = row.mimeType;
    objectKey = row.objectKey;
    checksum = row.checksum;
  }
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
  return { fileName, mimeType, objectKey, checksum: checksum };
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
      include: { class: { include: { instructors: true } } },
    });
    if (
      !current ||
      !current.class.instructors.some((item) => item.instructorId === actorId)
    )
      throw new NotFoundException(
        "Không tìm thấy học liệu được phép cập nhật.",
      );
    if (current.class.status === "CLOSED")
      throw new ConflictException("Lớp đã lưu trữ và chỉ cho phép đọc.");
    const nextVersion = current.version + 1;
    const stored = await serviceContext.storeUpload(
      current.classId,
      `${materialId}-v${nextVersion}-${randomUUID()}`,
      upload,
      Boolean(quarantineReason),
    );
    try {
      return await prisma.$transaction(async (transaction) => {
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
        return serviceContext.mapMaterial(updated);
      });
    } catch (error) {
      await serviceContext.removeStoredFile(stored.objectKey);
      throw error;
    }
  }
  const current = serviceContext.materials.find(
    (item) => item.id === materialId,
  );
  if (
    !current ||
    !serviceContext.findClass(current.classId).instructorIds.includes(actorId)
  )
    throw new NotFoundException("Không tìm thấy học liệu được phép cập nhật.");
  if (serviceContext.findClass(current.classId).status === "CLOSED")
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
    current.classId,
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
  return { ...current, tags: [...current.tags] };
}
