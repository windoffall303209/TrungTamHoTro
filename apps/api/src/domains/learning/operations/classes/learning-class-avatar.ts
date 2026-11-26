import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { AuthenticatedSession } from "../../../../auth/auth.service.js";
import { matchesFileSignature } from "../../../../infrastructure/file-signature.js";
import { stripImageMetadata } from "../../../../infrastructure/image-metadata.js";
import type { LearningServiceContext } from "../../core/learning.context.js";
import type { LearningClass } from "../../core/learning.types.js";
import { updateClass } from "./learning-classes.js";

export interface ClassAvatarUpload {
  mimeType: string;
  size: number;
  buffer: Buffer;
}

const MAX_CLASS_AVATAR_BYTES = 3 * 1024 * 1024;

/** Kiểm tra quyền chỉnh sửa cài đặt/avatar lớp cho quản lý có class:manage hoặc giảng viên được phân công. */
async function requireClassSettingsEditor(
  serviceContext: LearningServiceContext,
  classId: string,
  session: AuthenticatedSession,
): Promise<{ id: string; status: string; avatarObjectKey: string | null }> {
  const prisma = serviceContext.database();
  if (!prisma) {
    const existing = serviceContext.findClass(classId);
    if (!existing) throw new NotFoundException("Không tìm thấy lớp học.");
    if (session.roleCode === "LEARNER") {
      throw new ForbiddenException(
        "Chỉ giảng viên phụ trách hoặc quản lý mới được chỉnh sửa cài đặt lớp học.",
      );
    }
    if (
      session.roleCode === "INSTRUCTOR" &&
      !existing.instructorIds.includes(session.user.id)
    ) {
      throw new NotFoundException("Không tìm thấy lớp học trong phạm vi giảng dạy.");
    }
    if (session.roleCode === "INSTRUCTOR" && existing.status === "CLOSED") {
      throw new ConflictException("Lớp đã lưu trữ và chỉ cho phép đọc.");
    }
    return { id: existing.id, status: existing.status, avatarObjectKey: null };
  }

  if (
    session.roleCode === "SYSTEM_ADMIN" ||
    session.roleCode === "CENTER_MANAGER"
  ) {
    if (!session.permissions.includes("class:manage")) {
      throw new ForbiddenException(
        "Bạn không có quyền chỉnh sửa cài đặt lớp học.",
      );
    }
    const existing = await prisma.learningClass.findUnique({
      where: { id: classId },
      select: { id: true, status: true, avatarObjectKey: true },
    });
    if (!existing) throw new NotFoundException("Không tìm thấy lớp học.");
    return existing;
  }

  if (session.roleCode === "INSTRUCTOR") {
    const existing = await prisma.learningClass.findFirst({
      where: {
        id: classId,
        instructors: { some: { instructorId: session.user.id } },
      },
      select: { id: true, status: true, avatarObjectKey: true },
    });
    if (!existing) {
      throw new NotFoundException(
        "Không tìm thấy lớp học trong phạm vi giảng dạy.",
      );
    }
    if (existing.status === "CLOSED") {
      throw new ConflictException("Lớp đã lưu trữ và chỉ cho phép đọc.");
    }
    return existing;
  }

  throw new ForbiddenException(
    "Chỉ giảng viên phụ trách hoặc quản lý mới được chỉnh sửa cài đặt lớp học.",
  );
}

/** Xác thực dung lượng, MIME và magic bytes cho ảnh đại diện lớp học (PNG/JPEG/WebP tối đa 3 MB). */
function validateClassAvatar(upload: ClassAvatarUpload): "png" | "jpg" | "webp" {
  if (
    upload.size !== upload.buffer.length ||
    upload.size < 1 ||
    upload.size > MAX_CLASS_AVATAR_BYTES
  ) {
    throw new BadRequestException(
      "Ảnh đại diện lớp học phải có kích thước từ 1 byte đến 3 MB.",
    );
  }
  const mime = upload.mimeType.toLowerCase();
  if (
    (mime === "image/png" || mime === "image/jpeg" || mime === "image/webp") &&
    matchesFileSignature(mime, upload.buffer) === true
  ) {
    if (mime === "image/png") return "png";
    if (mime === "image/jpeg") return "jpg";
    return "webp";
  }
  throw new BadRequestException(
    "Ảnh đại diện lớp học chỉ chấp nhận PNG, JPEG hoặc WebP hợp lệ.",
  );
}

/** Cho phép giảng viên phụ trách hoặc quản lý cập nhật toàn bộ cài đặt lớp học. */
export async function updateClassSettings(
  serviceContext: LearningServiceContext,
  classId: string,
  input: {
    name?: string;
    capacity?: number;
    allowPeerGradeViewing?: boolean;
    allowLearnerFeedPosting?: boolean;
  },
  session: AuthenticatedSession,
): Promise<LearningClass> {
  await requireClassSettingsEditor(serviceContext, classId, session);
  return updateClass(serviceContext, classId, input, session.user.id);
}

/** Tải ảnh đại diện tùy chỉnh cho lớp học, xóa metadata EXIF/GPS, quét mã độc và dọn object cũ. */
export async function updateClassAvatar(
  serviceContext: LearningServiceContext,
  classId: string,
  upload: ClassAvatarUpload,
  session: AuthenticatedSession,
): Promise<LearningClass> {
  const existing = await requireClassSettingsEditor(
    serviceContext,
    classId,
    session,
  );
  const extension = validateClassAvatar(upload);
  const prisma = serviceContext.database();
  if (!prisma || !serviceContext.objectStorage) {
    throw new BadRequestException(
      "Chức năng ảnh đại diện lớp học cần kết nối PostgreSQL và kho lưu trữ.",
    );
  }

  const sanitized = stripImageMetadata(upload.buffer, upload.mimeType);
  const scan = await serviceContext.antivirus?.scan(sanitized);
  if (scan && !scan.clean) {
    throw new BadRequestException(
      "Ảnh đại diện lớp học bị từ chối vì phát hiện mã độc.",
    );
  }

  const stored = await serviceContext.objectStorage.put(
    `class-avatars/${classId}/${randomUUID()}.${extension}`,
    sanitized,
  );
  let committed: {
    row: Parameters<LearningServiceContext["mapClass"]>[0];
    previousObjectKey: string | null;
  };
  try {
    committed = await prisma.$transaction(async (transaction) => {
      if (typeof transaction.$queryRaw === "function") {
        await transaction.$queryRaw`SELECT id FROM learning_classes WHERE id = ${classId} FOR UPDATE`;
      }
      const current = await transaction.learningClass.findUnique({
        where: { id: classId },
        select: { avatarObjectKey: true },
      });
      const row = await transaction.learningClass.update({
        where: { id: classId },
        data: {
          avatarObjectKey: stored.objectKey,
          avatarMimeType: upload.mimeType.toLowerCase(),
          avatarUpdatedAt: new Date(),
        },
        include: { instructors: true, enrollments: true },
      });
      await transaction.auditLog.create({
        data: {
          actorId: session.user.id,
          action: "CLASS_AVATAR_UPDATED",
          entityType: "learning_class",
          entityId: classId,
          context: { mimeType: upload.mimeType.toLowerCase(), size: upload.size },
        },
      });
      return {
        row,
        previousObjectKey:
          current !== undefined && current !== null
            ? current.avatarObjectKey
            : existing.avatarObjectKey,
      };
    });
  } catch (error) {
    await serviceContext.objectStorage.remove(stored.objectKey).catch(() => undefined);
    throw error;
  }

  if (
    committed.previousObjectKey &&
    committed.previousObjectKey !== stored.objectKey
  ) {
    await serviceContext.objectStorage
      .remove(committed.previousObjectKey)
      .catch(() => undefined);
  }
  return serviceContext.mapClass(committed.row);
}

/** Xóa ảnh đại diện tùy chỉnh của lớp học để quay về icon mặc định. */
export async function removeClassAvatar(
  serviceContext: LearningServiceContext,
  classId: string,
  session: AuthenticatedSession,
): Promise<LearningClass> {
  const existing = await requireClassSettingsEditor(
    serviceContext,
    classId,
    session,
  );
  const prisma = serviceContext.database();
  if (!prisma) {
    throw new NotFoundException("Không tìm thấy lớp học.");
  }

  const committed = await prisma.$transaction(async (transaction) => {
    if (typeof transaction.$queryRaw === "function") {
      await transaction.$queryRaw`SELECT id FROM learning_classes WHERE id = ${classId} FOR UPDATE`;
    }
    const current = await transaction.learningClass.findUnique({
      where: { id: classId },
      select: { avatarObjectKey: true },
    });
    const row = await transaction.learningClass.update({
      where: { id: classId },
      data: {
        avatarObjectKey: null,
        avatarMimeType: null,
        avatarUpdatedAt: null,
      },
      include: { instructors: true, enrollments: true },
    });
    await transaction.auditLog.create({
      data: {
        actorId: session.user.id,
        action: "CLASS_AVATAR_REMOVED",
        entityType: "learning_class",
        entityId: classId,
        context: {},
      },
    });
    return {
      row,
      previousObjectKey:
        current !== undefined && current !== null
          ? current.avatarObjectKey
          : existing.avatarObjectKey,
    };
  });
  if (committed.previousObjectKey && serviceContext.objectStorage) {
    await serviceContext.objectStorage
      .remove(committed.previousObjectKey)
      .catch(() => undefined);
  }
  return serviceContext.mapClass(committed.row);
}

/** Đọc ảnh đại diện của lớp học từ object storage sau khi kiểm tra quyền xem lớp cụ thể của phiên. */
export async function readClassAvatar(
  serviceContext: LearningServiceContext,
  classId: string,
  session: AuthenticatedSession,
): Promise<{ buffer: Buffer; mimeType: string }> {
  if (
    !session.permissions.includes("class:view") &&
    !session.permissions.includes("class:manage")
  ) {
    throw new ForbiddenException("Bạn không có quyền xem lớp học này.");
  }
  const prisma = serviceContext.database();
  if (!prisma || !serviceContext.objectStorage) {
    throw new NotFoundException("Lớp học chưa có ảnh đại diện.");
  }
  const where =
    session.roleCode === "SYSTEM_ADMIN" || session.roleCode === "CENTER_MANAGER"
      ? { id: classId }
      : session.roleCode === "INSTRUCTOR"
        ? {
            id: classId,
            instructors: { some: { instructorId: session.user.id } },
          }
        : {
            id: classId,
            status: { not: "DRAFT" as const },
            enrollments: {
              some: { learnerId: session.user.id, status: "ACTIVE" as const },
            },
          };
  const row = await prisma.learningClass.findFirst({
    where,
    select: { avatarObjectKey: true, avatarMimeType: true },
  });
  if (!row) {
    throw new NotFoundException("Không tìm thấy lớp học trong phạm vi truy cập.");
  }
  if (!row.avatarObjectKey || !row.avatarMimeType) {
    throw new NotFoundException("Lớp học chưa có ảnh đại diện.");
  }
  return {
    buffer: await serviceContext.objectStorage.get(row.avatarObjectKey),
    mimeType: row.avatarMimeType,
  };
}
