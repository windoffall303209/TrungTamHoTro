import {
  BadRequestException,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import type { Prisma } from "../../../../generated/prisma/client.js";
import { hashFile } from "../../../../infrastructure/file-streams.js";
import {
  SnapshotAssetAudit,
  StorageAuditRun,
  StorageCleanupFailure,
} from "../../core/system.shared.js";
import type { SystemServiceContext } from "../../core/system.context.js";

const DEFAULT_AUDIT_DB_PAGE_SIZE = 500;
const DEFAULT_AUDIT_OBJECT_BATCH_SIZE = 50;
const DEFAULT_AUDIT_SAMPLE_RATE = 0.1;

export interface StorageAuditRunOptions {
  sampleRate?: number;
  seed?: string;
  dbPageSize?: number;
  objectBatchSize?: number;
  onProgress?: (progress: number, checkedObjects: number) => Promise<void> | void;
}

/** Đọc tuần tự một bảng theo cursor khóa chính, tự dừng nếu trang trả về trùng cursor cuối (an toàn cả với mock test). */
async function scanTableById<TRow extends { id: string }>(
  fetchPage: (cursor?: string) => Promise<TRow[]>,
  onRow: (row: TRow) => void,
  pageSize: number,
): Promise<void> {
  let cursor: string | undefined;
  while (true) {
    const page = await fetchPage(cursor);
    if (!page.length) break;
    const lastId = page[page.length - 1]!.id;
    if (cursor !== undefined && lastId === cursor) break;
    for (const row of page) onRow(row);
    if (page.length < pageSize) break;
    cursor = lastId;
  }
}

/** Quyết định có lấy mẫu kiểm tra SHA-256 cho object hay không dựa trên tỷ lệ cấu hình và seed xác định. */
export function shouldSampleChecksum(
  objectKey: string,
  sampleRate: number,
  seed: string,
): boolean {
  if (sampleRate <= 0) return false;
  if (sampleRate >= 1) return true;
  const digest = createHash("sha256").update(`${seed}:${objectKey}`).digest();
  const ratio = digest.readUInt32BE(0) / 0xffffffff;
  return ratio < sampleRate;
}

/** Tính SHA-256 của object theo luồng (ưu tiên hashFile cục bộ, fallback openReadStream), không nạp toàn tệp vào RAM. */
async function computeObjectChecksum(
  serviceContext: SystemServiceContext,
  objectKey: string,
  localPath?: string,
): Promise<string> {
  if (localPath) return hashFile(localPath);
  const hash = createHash("sha256");
  for await (const chunk of await serviceContext.objectStorage!.openReadStream(objectKey)) {
    hash.update(chunk as Buffer);
  }
  return `sha256:${hash.digest("hex")}`;
}

/** Chuyển bản ghi OperationalJob loại AUDIT sang DTO công khai kèm báo cáo JSON khi đã hoàn tất. */
export function mapStorageAudit(
  row: Prisma.OperationalJobGetPayload<Record<string, never>>,
): StorageAuditRun {
  let report: SnapshotAssetAudit | undefined;
  if (row.verification) {
    try {
      report = JSON.parse(row.verification) as SnapshotAssetAudit;
    } catch {
      report = undefined;
    }
  }
  const parsedSample = Number(row.category ?? DEFAULT_AUDIT_SAMPLE_RATE);
  return {
    id: row.id,
    status: row.status,
    sampleRate: Number.isFinite(parsedSample) ? parsedSample : DEFAULT_AUDIT_SAMPLE_RATE,
    progress: row.progress,
    attempts: row.attempts,
    checkedObjects: row.rowCount ?? 0,
    requestedBy: row.requestedBy,
    createdAt: row.createdAt.toISOString(),
    completedAt: row.completedAt?.toISOString(),
    errorMessage: row.errorMessage ?? undefined,
    report,
  };
}

/** Chạy đối soát snapshot và object phân trang bằng HEAD/stat kèm kiểm tra checksum lấy mẫu, cập nhật tiến độ theo lô. */
export async function runPaginatedStorageAudit(
  serviceContext: SystemServiceContext,
  options: StorageAuditRunOptions = {},
): Promise<SnapshotAssetAudit> {
  const prisma = serviceContext.database();
  if (!prisma || !serviceContext.objectStorage) {
    throw new ServiceUnavailableException(
      "Đối soát snapshot/asset cần database và kho object đang hoạt động.",
    );
  }

  const dbPageSize = Math.max(1, Math.min(options.dbPageSize ?? DEFAULT_AUDIT_DB_PAGE_SIZE, 2_000));
  const objectBatchSize = Math.max(1, Math.min(options.objectBatchSize ?? DEFAULT_AUDIT_OBJECT_BATCH_SIZE, 200));
  const sampleRate = Math.max(0, Math.min(options.sampleRate ?? DEFAULT_AUDIT_SAMPLE_RATE, 1));
  const seed = options.seed ?? new Date().toISOString().slice(0, 10);

  const snapshotKeys = new Set<string>();
  const classes: Array<{ id: string; courseId: string; courseVersion: number }> = [];
  const references = new Map<string, string[]>();
  const expectedChecksums = new Map<string, string>();

  /** Gom các tham chiếu và checksum kỳ vọng theo khóa tệp để đối chiếu một lần cho mỗi object duy nhất. */
  const add = (
    objectKey: string | null | undefined,
    reference: string,
    checksum?: string | null,
  ): void => {
    if (!objectKey) return;
    const owners = references.get(objectKey);
    if (owners) owners.push(reference);
    else references.set(objectKey, [reference]);
    if (checksum && !expectedChecksums.has(objectKey)) {
      expectedChecksums.set(objectKey, checksum);
    }
  };

  await scanTableById(
    (cursor) =>
      prisma.courseVersion.findMany({
        select: { id: true, courseId: true, version: true },
        take: dbPageSize,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        orderBy: { id: "asc" },
      }),
    (item) => {
      snapshotKeys.add(`${item.courseId}:${item.version}`);
    },
    dbPageSize,
  );
  await scanTableById(
    (cursor) =>
      prisma.learningClass.findMany({
        select: { id: true, courseId: true, courseVersion: true },
        take: dbPageSize,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        orderBy: { id: "asc" },
      }),
    (item) => {
      classes.push(item);
    },
    dbPageSize,
  );
  await scanTableById(
    (cursor) =>
      prisma.material.findMany({
        select: { id: true, objectKey: true, checksum: true },
        take: dbPageSize,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        orderBy: { id: "asc" },
      }),
    (item) => add(item.objectKey, `material:${item.id}`, item.checksum),
    dbPageSize,
  );
  await scanTableById(
    (cursor) =>
      prisma.assignmentSubmissionAttachment.findMany({
        where: { removedAt: null },
        select: { id: true, objectKey: true, checksum: true },
        take: dbPageSize,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        orderBy: { id: "asc" },
      }),
    (item) => add(item.objectKey, `assignment-attachment:${item.id}`, item.checksum),
    dbPageSize,
  );
  await scanTableById(
    (cursor) =>
      prisma.question.findMany({
        where: { imageObjectKey: { not: null } },
        select: { id: true, imageObjectKey: true },
        take: dbPageSize,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        orderBy: { id: "asc" },
      }),
    (item) => add(item.imageObjectKey, `question-image:${item.id}`),
    dbPageSize,
  );
  await scanTableById(
    (cursor) =>
      prisma.chatMessageAttachment.findMany({
        select: { id: true, objectKey: true },
        take: dbPageSize,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        orderBy: { id: "asc" },
      }),
    (item) => add(item.objectKey, `chat-attachment:${item.id}`),
    dbPageSize,
  );
  await scanTableById(
    (cursor) =>
      prisma.supportAttachment.findMany({
        select: { id: true, objectKey: true, checksum: true },
        take: dbPageSize,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        orderBy: { id: "asc" },
      }),
    (item) => add(item.objectKey, `support-attachment:${item.id}`, item.checksum),
    dbPageSize,
  );

  if (options.onProgress) await options.onProgress(25, 0);

  const classesWithoutCourseSnapshot = classes
    .filter((item) => !snapshotKeys.has(`${item.courseId}:${item.courseVersion}`))
    .map((item) => ({
      classId: item.id,
      courseId: item.courseId,
      courseVersion: item.courseVersion,
    }));

  const entries = [...references.entries()];
  const missingObjects: SnapshotAssetAudit["missingObjects"] = [];
  const checksumMismatches: NonNullable<SnapshotAssetAudit["checksumMismatches"]> = [];
  const supportsStat = typeof serviceContext.objectStorage.stat === "function";
  let sampledChecksumCount = 0;
  let checkedCount = 0;

  for (let offset = 0; offset < entries.length; offset += objectBatchSize) {
    const batch = entries.slice(offset, offset + objectBatchSize);
    for (const [objectKey, owners] of batch) {
      try {
        if (supportsStat) {
          // Ưu tiên kiểm tra HEAD/metadata không đọc nội dung; chỉ tính SHA-256 trên tập mẫu cấu hình.
          const info = await serviceContext.objectStorage.stat(objectKey);
          const expectedChecksum = expectedChecksums.get(objectKey);
          if (expectedChecksum && shouldSampleChecksum(objectKey, sampleRate, seed)) {
            sampledChecksumCount += 1;
            const actualChecksum = await computeObjectChecksum(
              serviceContext,
              objectKey,
              info.localPath,
            );
            if (actualChecksum !== expectedChecksum) {
              checksumMismatches.push({
                objectKey,
                expectedChecksum,
                actualChecksum,
                references: owners,
              });
            }
          }
        } else {
          // Fallback cho adapter cũ chưa hỗ trợ stat/HEAD: đọc stream đến cuối để kiểm khả năng đọc.
          for await (const chunk of await serviceContext.objectStorage.openReadStream(objectKey)) {
            void chunk;
          }
        }
      } catch {
        missingObjects.push({ objectKey, references: owners });
      }
      checkedCount += 1;
    }
    if (options.onProgress && entries.length > 0) {
      const pct = Math.min(95, 25 + Math.floor((checkedCount / entries.length) * 70));
      await options.onProgress(pct, checkedCount);
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
    sharedObjects: entries
      .filter(([, owners]) => owners.length > 1)
      .map(([objectKey, owners]) => ({ objectKey, references: owners })),
    missingObjects,
    verificationMode: supportsStat ? "STAT_HEAD_AND_SAMPLE" : "STREAM_FALLBACK",
    sampledChecksumCount,
    checksumMismatches,
  };
}

/** Đối soát snapshot lớp và mọi object reference bằng truy vấn phân trang + HEAD/metadata và lấy mẫu checksum. */
export async function snapshotAssetAudit(
  serviceContext: SystemServiceContext,
): Promise<SnapshotAssetAudit> {
  return runPaginatedStorageAudit(serviceContext, {
    sampleRate: DEFAULT_AUDIT_SAMPLE_RATE,
  });
}

/** Xếp tác vụ đối soát lưu trữ phân trang vào hàng đợi operational_jobs để chạy nền có lease và tiến độ. */
export async function queueStorageAudit(
  serviceContext: SystemServiceContext,
  actorId: string,
  sampleRate = DEFAULT_AUDIT_SAMPLE_RATE,
): Promise<StorageAuditRun> {
  if (!Number.isFinite(sampleRate) || sampleRate < 0 || sampleRate > 1) {
    throw new BadRequestException(
      "Tỷ lệ lấy mẫu checksum phải nằm trong khoảng từ 0 đến 1.",
    );
  }
  const prisma = serviceContext.database();
  if (!prisma || !serviceContext.objectStorage) {
    throw new ServiceUnavailableException(
      "Đối soát snapshot/asset cần database và kho object đang hoạt động.",
    );
  }
  const auditId = `storage-audit-${randomUUID()}`;
  const row = await prisma.operationalJob.create({
    data: {
      id: auditId,
      kind: "AUDIT",
      type: "STORAGE_AUDIT",
      category: String(sampleRate),
      status: "PENDING",
      progress: 0,
      requestedBy: actorId,
      availableAt: new Date(),
    },
  });
  await serviceContext.logDatabase(
    prisma,
    actorId,
    "STORAGE_AUDIT_QUEUED",
    row.id,
    `Xếp hàng đợi đối soát lưu trữ phân trang (tỷ lệ lấy mẫu checksum ${Math.round(sampleRate * 100)}%).`,
  );
  return mapStorageAudit(row);
}

/** Liệt kê lịch sử các lần chạy job nền đối soát lưu trữ mới nhất. */
export async function listStorageAudits(
  serviceContext: SystemServiceContext,
): Promise<StorageAuditRun[]> {
  const prisma = serviceContext.database();
  if (!prisma) return [];
  const rows = await prisma.operationalJob.findMany({
    where: { kind: "AUDIT" },
    orderBy: { createdAt: "desc" },
    take: 25,
  });
  return rows.map(mapStorageAudit);
}

/** Đọc trạng thái, tiến độ và báo cáo kết quả của một job đối soát lưu trữ. */
export async function getStorageAudit(
  serviceContext: SystemServiceContext,
  auditId: string,
): Promise<StorageAuditRun> {
  const prisma = serviceContext.database();
  if (!prisma) throw new NotFoundException("Không tìm thấy tác vụ đối soát lưu trữ.");
  const row = await prisma.operationalJob.findFirst({
    where: { id: auditId, kind: "AUDIT" },
  });
  if (!row) throw new NotFoundException("Không tìm thấy tác vụ đối soát lưu trữ.");
  return mapStorageAudit(row);
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
