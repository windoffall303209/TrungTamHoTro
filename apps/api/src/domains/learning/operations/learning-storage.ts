import { BadRequestException, ConflictException } from "@nestjs/common";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, stat, unlink, writeFile } from "node:fs/promises";
import { dirname, extname, resolve, sep } from "node:path";
import { PrismaService } from "../../../database/prisma.service.js";
import { streamToFile } from "../../../infrastructure/file-streams.js";
import {
  DEFAULT_MATERIAL_MIME_TYPES,
  includeSupportedDocumentMimeTypes,
} from "../../../infrastructure/file-transfer.js";
import { type StoredObject } from "../../../infrastructure/object-storage.service.js";
import {
  MaterialAccessAction,
  UploadedMaterialFile,
} from "../learning.shared.js";
import type { LearningServiceContext } from "../learning.context.js";

/** Đọc chính sách storage từ cấu hình hệ thống và áp dụng mặc định an toàn. */
export async function getStoragePolicy(database: PrismaService): Promise<{
  maxFileSizeMb: number;
  storageQuotaMb: number;
  allowedMimeTypes: string[];
}> {
  const row = await database.systemSetting.findUnique({
    where: { key: "platform" },
    select: { value: true },
  });
  const record =
    typeof row?.value === "object" &&
    row.value !== null &&
    !Array.isArray(row.value)
      ? (row.value as Record<string, unknown>)
      : {};
  return {
    maxFileSizeMb:
      typeof record.maxFileSizeMb === "number" ? record.maxFileSizeMb : 50,
    storageQuotaMb:
      typeof record.storageQuotaMb === "number"
        ? record.storageQuotaMb
        : 10_240,
    allowedMimeTypes: includeSupportedDocumentMimeTypes(
      Array.isArray(record.allowedMimeTypes) &&
        record.allowedMimeTypes.every((item) => typeof item === "string")
        ? record.allowedMimeTypes
        : DEFAULT_MATERIAL_MIME_TYPES,
    ),
  };
}

/** Kiểm tra quota/chính sách, quét virus rồi ghi upload vào namespace material/quarantine. */
export async function storeUpload(
  serviceContext: LearningServiceContext,
  classId: string,
  materialId: string,
  upload: UploadedMaterialFile,
  quarantined = false,
): Promise<{ objectKey: string; checksum: string }> {
  if (
    upload.size !==
    (upload.path ? (await stat(upload.path)).size : upload.buffer.length)
  )
    throw new BadRequestException(
      "Kích thước tệp tải lên không khớp nội dung nhận được.",
    );
  const safeExtension = extname(upload.originalName)
    .toLowerCase()
    .replace(/[^a-z0-9.]/g, "")
    .slice(0, 12);
  const objectKey = `${quarantined ? "quarantine" : "files"}/${classId}/${materialId}${safeExtension}`;
  if (serviceContext.objectStorage)
    return upload.path
      ? serviceContext.objectStorage.putFile(objectKey, upload.path)
      : serviceContext.objectStorage.put(objectKey, upload.buffer);
  const target = serviceContext.resolveObjectPath(objectKey);
  await mkdir(dirname(target), { recursive: true });
  if (upload.path)
    return {
      objectKey,
      ...(await streamToFile(
        createReadStream(upload.path),
        target,
        upload.size,
      )),
    };
  await writeFile(target, upload.buffer, { flag: "wx" }).catch(
    (error: unknown) => {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "EEXIST"
      )
        throw new ConflictException("Khóa lưu trữ học liệu đã tồn tại.");
      throw error;
    },
  );
  return {
    objectKey,
    checksum: `sha256:${createHash("sha256").update(upload.buffer).digest("hex")}`,
  };
}

/** Ghi object qua storage service hoặc filesystem fallback đã chặn path traversal. */
export async function writeStoredFile(
  serviceContext: LearningServiceContext,
  objectKey: string,
  buffer: Buffer,
): Promise<StoredObject> {
  if (serviceContext.objectStorage)
    return serviceContext.objectStorage.put(objectKey, buffer);
  const target = serviceContext.resolveObjectPath(objectKey);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, buffer, { flag: "wx" }).catch((error: unknown) => {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "EEXIST"
    )
      throw new ConflictException(
        "Tệp bằng chứng đã tồn tại trong kho lưu trữ.",
      );
    throw error;
  });
  return {
    objectKey,
    checksum: `sha256:${createHash("sha256").update(buffer).digest("hex")}`,
  };
}

/** Xóa object theo best-effort ở provider chính hoặc filesystem fallback. */
export async function removeStoredFile(
  serviceContext: LearningServiceContext,
  objectKey: string,
): Promise<void> {
  if (serviceContext.objectStorage) {
    await serviceContext.objectStorage.remove(objectKey);
    return;
  }
  await unlink(serviceContext.resolveObjectPath(objectKey)).catch(
    (error: unknown) => {
      if (
        !(
          typeof error === "object" &&
          error !== null &&
          "code" in error &&
          error.code === "ENOENT"
        )
      )
        throw error;
    },
  );
}

/** Chỉ xóa ảnh câu hỏi khi không còn version nào tham chiếu cùng object key. */
export async function removeQuestionObjectIfUnreferenced(
  serviceContext: LearningServiceContext,
  objectKey: string,
): Promise<void> {
  const prisma = serviceContext.database();
  if (
    prisma &&
    (await prisma.question.count({ where: { imageObjectKey: objectKey } })) > 0
  )
    return;
  await serviceContext.removeStoredFile(objectKey);
}

/** Resolve đường dẫn fallback và từ chối object key thoát khỏi storage root. */
export function resolveObjectPath(
  serviceContext: LearningServiceContext,
  objectKey: string,
): string {
  const root = resolve(
    serviceContext.config?.get("STORAGE_ROOT", { infer: true }) ??
      "../TestDoAn-data",
  );
  const target = resolve(root, objectKey);
  if (target !== root && !target.startsWith(`${root}${sep}`))
    throw new BadRequestException("Đường dẫn lưu trữ không hợp lệ.");
  return target;
}

/** Ký HMAC liên kết học liệu, ràng buộc id, hạn và loại hành động. */
export function signMaterialAccess(
  serviceContext: LearningServiceContext,
  materialId: string,
  expires: number,
  action: MaterialAccessAction,
): string {
  const secret =
    serviceContext.config?.get("STORAGE_SIGNING_SECRET", { infer: true }) ??
    "development-storage-signing-key-change-me";
  return createHmac("sha256", secret)
    .update(`${materialId}.${expires}.${action}`)
    .digest("base64url");
}

/** Ký liên kết bản ghi gắn riêng với buổi học và học viên. */
export function signRecordingAccess(
  serviceContext: LearningServiceContext,
  sessionId: string,
  expires: number,
  learnerId: string,
): string {
  const secret =
    serviceContext.config?.get("STORAGE_SIGNING_SECRET", { infer: true }) ??
    "development-storage-signing-key-change-me";
  return createHmac("sha256", secret)
    .update(`recording.${sessionId}.${learnerId}.${expires}`)
    .digest("base64url");
}

/** Kiểm tra hạn và so sánh chữ ký constant-time, trả thông báo nghiệp vụ tương ứng. */
export function verifyExpiringSignature(
  expectedSignature: string,
  expires: number,
  signature: string,
  message: string,
): void {
  const current = Math.floor(Date.now() / 1000);
  if (
    !Number.isSafeInteger(expires) ||
    expires < current ||
    expires > current + 600
  )
    throw new BadRequestException("Liên kết đã hết hạn hoặc không hợp lệ.");
  const expected = Buffer.from(expectedSignature);
  const received = Buffer.from(signature);
  if (
    expected.length !== received.length ||
    !timingSafeEqual(expected, received)
  )
    throw new BadRequestException(message);
}

/** Dựng lại chữ ký học liệu mong đợi và dùng bộ kiểm tra liên kết hết hạn. */
export function verifyMaterialAccess(
  serviceContext: LearningServiceContext,
  materialId: string,
  expires: number,
  signature: string,
  action: MaterialAccessAction,
): void {
  const current = Math.floor(Date.now() / 1000);
  if (
    !Number.isSafeInteger(expires) ||
    expires < current ||
    expires > current + 600
  )
    throw new BadRequestException(
      "Liên kết tải học liệu đã hết hạn hoặc không hợp lệ.",
    );
  const expected = Buffer.from(
    serviceContext.signMaterialAccess(materialId, expires, action),
  );
  const received = Buffer.from(signature);
  if (
    expected.length !== received.length ||
    !timingSafeEqual(expected, received)
  )
    throw new BadRequestException("Chữ ký tải học liệu không hợp lệ.");
}
