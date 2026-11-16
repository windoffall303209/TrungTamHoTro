import { NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import { SnapshotAssetAudit, StorageCleanupFailure } from "../../core/system.shared.js";
import type { SystemServiceContext } from "../../core/system.context.js";

/** Đối soát snapshot lớp và mọi object reference để migration không tự sửa hoặc xóa dữ liệu mơ hồ. */
export async function snapshotAssetAudit(
  serviceContext: SystemServiceContext,
): Promise<SnapshotAssetAudit> {
  const prisma = serviceContext.database();
  if (!prisma || !serviceContext.objectStorage)
    throw new ServiceUnavailableException(
      "Đối soát snapshot/asset cần database và kho object đang hoạt động.",
    );
  const [
    classes,
    courseVersions,
    materials,
    submissionAttachments,
    questionImages,
    chatAttachments,
    supportAttachments,
  ] = await Promise.all([
    prisma.learningClass.findMany({
      select: { id: true, courseId: true, courseVersion: true },
    }),
    prisma.courseVersion.findMany({
      select: { courseId: true, version: true },
    }),
    prisma.material.findMany({ select: { id: true, objectKey: true } }),
    prisma.assignmentSubmissionAttachment.findMany({
      where: { removedAt: null },
      select: { id: true, objectKey: true },
    }),
    prisma.question.findMany({
      where: { imageObjectKey: { not: null } },
      select: { id: true, imageObjectKey: true },
    }),
    prisma.chatMessageAttachment.findMany({
      select: { id: true, objectKey: true },
    }),
    prisma.supportAttachment.findMany({
      select: { id: true, objectKey: true },
    }),
  ]);
  const snapshotKeys = new Set(
    courseVersions.map((item) => `${item.courseId}:${item.version}`),
  );
  const classesWithoutCourseSnapshot = classes
    .filter(
      (item) => !snapshotKeys.has(`${item.courseId}:${item.courseVersion}`),
    )
    .map((item) => ({
      classId: item.id,
      courseId: item.courseId,
      courseVersion: item.courseVersion,
    }));
  const references = new Map<string, string[]>();
  /** Gom các tham chiếu theo khóa tệp để đối chiếu tài sản lưu trữ. */
  const add = (objectKey: string | null, reference: string): void => {
    if (!objectKey) return;
    const owners = references.get(objectKey);
    if (owners) owners.push(reference);
    else references.set(objectKey, [reference]);
  };
  materials.forEach((item) => add(item.objectKey, `material:${item.id}`));
  submissionAttachments.forEach((item) =>
    add(item.objectKey, `assignment-attachment:${item.id}`),
  );
  questionImages.forEach((item) =>
    add(item.imageObjectKey, `question-image:${item.id}`),
  );
  chatAttachments.forEach((item) =>
    add(item.objectKey, `chat-attachment:${item.id}`),
  );
  supportAttachments.forEach((item) =>
    add(item.objectKey, `support-attachment:${item.id}`),
  );
  const missingObjects: SnapshotAssetAudit["missingObjects"] = [];
  for (const [objectKey, owners] of references) {
    try {
      // Đọc đến cuối để phát hiện lỗi tải giữa chừng, không giữ toàn bộ tệp trong RAM.
      for await (const chunk of await serviceContext.objectStorage.openReadStream(objectKey)) {
        // Tiêu thụ chunk để giải phóng bộ nhớ và chờ hết luồng.
        void chunk;
      }
    } catch {
      missingObjects.push({ objectKey, references: owners });
    }
  }
  return {
    generatedAt: new Date().toISOString(),
    classesWithoutCourseSnapshot,
    referencedObjectCount: [...references.values()].reduce(
      (sum, owners) => sum + owners.length,
      0,
    ),
    uniqueObjectCount: references.size,
    sharedObjects: [...references.entries()]
      .filter(([, owners]) => owners.length > 1)
      .map(([objectKey, owners]) => ({ objectKey, references: owners })),
    missingObjects,
  };
}

/** Liệt kê metadata đã xóa mềm nhưng object cleanup thất bại để vận hành có thể retry. */
export async function listStorageCleanupFailures(
  serviceContext: SystemServiceContext,
): Promise<StorageCleanupFailure[]> {
  const prisma = serviceContext.database();
  if (!prisma) return [];
  const rows = await prisma.assignmentSubmissionAttachment.findMany({
    where: { removedAt: { not: null }, removalError: { not: null } },
    orderBy: { removedAt: "asc" },
    take: 100,
  });
  return rows.map((row) => ({
    id: row.id,
    entityType: "ASSIGNMENT_ATTACHMENT",
    objectKey: row.objectKey,
    error: row.removalError ?? "Không rõ lỗi",
    removedAt: row.removedAt!.toISOString(),
  }));
}

/** Retry xóa đúng object đã được ghi lỗi và chỉ xóa cờ lỗi sau khi storage xác nhận thành công. */
export async function retryStorageCleanup(
  serviceContext: SystemServiceContext,
  attachmentId: string,
  actorId: string,
): Promise<{ cleaned: true }> {
  const prisma = serviceContext.database();
  if (!prisma || !serviceContext.objectStorage)
    throw new ServiceUnavailableException(
      "Cần database và kho object để retry cleanup.",
    );
  const row = await prisma.assignmentSubmissionAttachment.findUnique({
    where: { id: attachmentId },
  });
  if (!row || !row.removedAt || !row.removalError)
    throw new NotFoundException("Không tìm thấy lỗi cleanup đang chờ xử lý.");
  await serviceContext.objectStorage.remove(row.objectKey);
  await prisma.$transaction([
    prisma.assignmentSubmissionAttachment.update({
      where: { id: attachmentId },
      data: { removalError: null },
    }),
    prisma.auditLog.create({
      data: {
        actorId,
        action: "STORAGE_CLEANUP_RETRIED",
        entityType: "assignment_attachment",
        entityId: attachmentId,
        context: { objectKey: row.objectKey },
      },
    }),
  ]);
  return { cleaned: true };
}
