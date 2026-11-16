import { BadRequestException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { prepareVerifiedDownload } from "../../../../infrastructure/verified-download.js";
import type { AttachmentDocumentPreview } from "../../academic/academic.shared.js";
import { buildDocumentPreview } from "../academic/academic-document-preview.js";
import {
  MaterialAccessAction,
  MaterialDownload,
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
    if ((role === "SYSTEM_ADMIN" || role === "CENTER_MANAGER") && material.visibility === "HIDDEN")
      throw new ForbiddenException("Tài liệu đang ở trạng thái đã ẩn nên quản trị viên không thể xem hoặc tải xuống.");
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
    if ((role === "SYSTEM_ADMIN" || role === "CENTER_MANAGER") && material.visibility === "HIDDEN")
      throw new ForbiddenException("Tài liệu đang ở trạng thái đã ẩn nên quản trị viên không thể xem hoặc tải xuống.");
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
    if ((role === "SYSTEM_ADMIN" || role === "CENTER_MANAGER") && material.visibility === "HIDDEN")
      throw new ForbiddenException("Tài liệu đang ở trạng thái đã ẩn nên quản trị viên không thể xem hoặc tải xuống.");
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
    if ((role === "SYSTEM_ADMIN" || role === "CENTER_MANAGER") && material.visibility === "HIDDEN")
      throw new ForbiddenException("Tài liệu đang ở trạng thái đã ẩn nên quản trị viên không thể xem hoặc tải xuống.");
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
  return { fileName, mimeType, objectKey, checksum: expectedChecksum };
}

/** Đọc tài liệu học liệu sau khi xác thực quyền PREVIEW và trích xuất nội dung xem trước (DOCX/DOC/TXT). */
export async function readMaterialPreviewContent(
  serviceContext: LearningServiceContext,
  materialId: string,
  role: string,
  actorId = serviceContext.userIdForRole(role),
): Promise<AttachmentDocumentPreview> {
  const access = await createMaterialAccess(
    serviceContext,
    materialId,
    role,
    "PREVIEW",
    actorId,
  );
  const queryText = access.url.split("?")[1] ?? "";
  const params = new URLSearchParams(queryText);
  const expires = Number(params.get("expires") ?? "0");
  const signature = params.get("signature") ?? "";
  const file = await readMaterialDownload(
    serviceContext,
    materialId,
    expires,
    signature,
    role,
    "PREVIEW",
    actorId,
  );
  return await buildDocumentPreview(file);
}
