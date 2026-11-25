import { ServiceUnavailableException } from "@nestjs/common";
import { createHash } from "node:crypto";
import { PrismaService } from "../../../../database/prisma.service.js";
import { withTemporaryFile } from "../../../../infrastructure/file-streams.js";
import {
  ownedJobWhere,
  startOperationalLease,
} from "../operational-lease.js";
import { DataExport } from "../../core/system.shared.js";
import type { SystemServiceContext } from "../../core/system.context.js";

/** Thu hồi lease hết hạn rồi xử lý một batch backup và export theo hàng đợi DB. */
export async function drainOperationalJobs(
  serviceContext: SystemServiceContext,
  limit = 6,
): Promise<{
  backup: number;
  export: number;
}> {
  const prisma = serviceContext.database();
  if (!prisma) return { backup: 0, export: 0 };
  const now = new Date();
  await prisma.operationalJob.updateMany({
    where: {
      kind: { in: ["BACKUP", "EXPORT"] },
      status: { in: ["RUNNING", "PENDING"] },
      attempts: { gte: 5 },
      availableAt: { lte: now },
    },
    data: {
      status: "FAILED",
      progress: 0,
      completedAt: now,
      errorMessage: "Tác vụ hết hạn ở lần thử cuối.",
    },
  });
  await prisma.operationalJob.updateMany({
    where: {
      kind: { in: ["BACKUP", "EXPORT"] },
      status: "RUNNING",
      attempts: { lt: 5 },
      availableAt: { lte: now },
    },
    data: { status: "PENDING", progress: 0, availableAt: now },
  });
  // Thu hồi restore RUNNING bị kẹt sau sự cố tiến trình sang FAILED (tuyệt đối không tự chạy lại) để mở khóa bảo trì.
  await prisma.operationalJob.updateMany({
    where: {
      kind: "RESTORE",
      status: "RUNNING",
      availableAt: { lte: now },
    },
    data: {
      status: "FAILED",
      progress: 0,
      completedAt: now,
      verification:
        "Tiến trình khôi phục đã hết hạn lease do gián đoạn; đã đánh dấu thất bại để mở khóa bảo trì và không tự chạy lại.",
      errorMessage: "Restore bị gián đoạn quá hạn lease.",
    },
  });
  const processed = { backup: 0, export: 0 };
  for (let index = 0; index < Math.max(1, Math.min(limit, 30)); index += 1) {
    if (await serviceContext.processQueuedBackup(prisma)) {
      processed.backup += 1;
      continue;
    }
    if (await serviceContext.processQueuedExport(prisma)) {
      processed.export += 1;
      continue;
    }
    break;
  }
  return processed;
}

/** Claim và hoàn tất một backup bằng lease nguyên tử; lỗi tạm thời được retry có backoff. */
export async function processQueuedBackup(
  serviceContext: SystemServiceContext,
  prisma: PrismaService,
): Promise<boolean> {
  const candidate = await prisma.operationalJob.findFirst({
    where: {
      kind: "BACKUP",
      status: "PENDING",
      availableAt: { lte: new Date() },
      attempts: { lt: 5 },
    },
    orderBy: { createdAt: "asc" },
  });
  if (!candidate) return false;
  const claimed = await prisma.operationalJob.updateMany({
    where: {
      kind: "BACKUP",
      id: candidate.id,
      status: "PENDING",
      attempts: candidate.attempts,
    },
    data: {
      status: "RUNNING",
      attempts: { increment: 1 },
      progress: 10,
      availableAt: serviceContext.jobLeaseExpiry(),
      errorMessage: null,
    },
  });
  if (claimed.count !== 1) return true;
  const lease = startOperationalLease(() =>
    prisma.operationalJob.updateMany({
      where: { kind: "BACKUP", ...ownedJobWhere(candidate) },
      data: { availableAt: serviceContext.jobLeaseExpiry() },
    }),
  );
  try {
    if (!serviceContext.databaseBackup || !serviceContext.objectStorage)
      throw new ServiceUnavailableException("Hạ tầng backup chưa sẵn sàng.");
    await withTemporaryFile(async (path) => {
      const content =
        await serviceContext.databaseBackup!.createFullBackup(path);
      await lease.assertOwned();
      await prisma.operationalJob.updateMany({
        where: { kind: "BACKUP", ...ownedJobWhere(candidate) },
        data: { progress: 60 },
      });
      const objectKey = `backups/${new Date().toISOString().slice(0, 10)}/${candidate.id}-${candidate.attempts + 1}.dump`;
      const stored = await serviceContext.objectStorage!.putFile(
        objectKey,
        path,
      );
      const completed = await prisma.operationalJob.updateMany({
        where: { kind: "BACKUP", ...ownedJobWhere(candidate) },
        data: {
          status: "COMPLETED",
          progress: 100,
          checksum: stored.checksum,
          sizeBytes: BigInt(content.size),
          objectKey: stored.objectKey,
          completedAt: new Date(),
        },
      });
      if (completed.count !== 1) return;
      await serviceContext.logDatabase(
        prisma,
        candidate.requestedBy,
        "BACKUP_COMPLETED",
        candidate.id,
        `${candidate.type} · ${stored.checksum} · ${content.size} bytes`,
      );
    });
  } catch (error) {
    await serviceContext.retryBackupJob(
      prisma,
      candidate.id,
      candidate.attempts + 1,
      error,
    );
  } finally {
    await lease.stop();
  }
  return true;
}

/** Claim và tạo một export thật; chỉ COMPLETED sau khi đọc lại object và khớp checksum. */
export async function processQueuedExport(
  serviceContext: SystemServiceContext,
  prisma: PrismaService,
): Promise<boolean> {
  const candidate = await prisma.operationalJob.findFirst({
    where: {
      kind: "EXPORT",
      status: "PENDING",
      availableAt: { lte: new Date() },
      attempts: { lt: 5 },
    },
    orderBy: { createdAt: "asc" },
  });
  if (!candidate) return false;
  const claimed = await prisma.operationalJob.updateMany({
    where: {
      kind: "EXPORT",
      id: candidate.id,
      status: "PENDING",
      attempts: candidate.attempts,
    },
    data: {
      status: "RUNNING",
      attempts: { increment: 1 },
      progress: 10,
      availableAt: serviceContext.jobLeaseExpiry(),
      errorMessage: null,
    },
  });
  if (claimed.count !== 1) return true;
  const lease = startOperationalLease(() =>
    prisma.operationalJob.updateMany({
      where: { kind: "EXPORT", ...ownedJobWhere(candidate) },
      data: { availableAt: serviceContext.jobLeaseExpiry() },
    }),
  );
  try {
    if (!serviceContext.objectStorage)
      throw new ServiceUnavailableException("Kho object chưa sẵn sàng.");
    const format: DataExport["format"] =
      candidate.format === "JSON" ? "JSON" : "CSV";
    const objectKey = `exports/${candidate.category!.toLowerCase()}/${candidate.id}-${candidate.attempts + 1}.${format.toLowerCase()}`;
    let rowCount: number;
    let sizeBytes: number;
    let stored: { objectKey: string; checksum: string };

    // Đường chính production: đọc cursor theo lô và stream thẳng ra tệp tạm -> putFile, không giữ cả bảng trong RAM.
    if (serviceContext.streamExportToFile && typeof serviceContext.objectStorage.putFile === "function") {
      const streamed = await withTemporaryFile(async (tempPath) => {
        let lastBatchCheck = 0;
        const summary = await serviceContext.streamExportToFile!(
          prisma,
          candidate.category!,
          format,
          tempPath,
          async (writtenRows) => {
            if (writtenRows - lastBatchCheck >= 2_000) {
              lastBatchCheck = writtenRows;
              await lease.assertOwned();
            }
          },
        );
        await lease.assertOwned();
        await prisma.operationalJob.updateMany({
          where: { kind: "EXPORT", ...ownedJobWhere(candidate) },
          data: { progress: 55 },
        });
        const uploaded = await serviceContext.objectStorage!.putFile(objectKey, tempPath);
        if (uploaded.checksum !== summary.checksum) {
          throw new ServiceUnavailableException(
            "Tệp export lưu trữ không vượt qua kiểm tra checksum.",
          );
        }
        return { summary, uploaded };
      });
      rowCount = streamed.summary.rowCount;
      sizeBytes = streamed.summary.sizeBytes;
      stored = streamed.uploaded;
    } else {
      const rows = await serviceContext.collectExportRows(
        prisma,
        candidate.category!,
      );
      const content = serviceContext.serializeExport(rows, format);
      await lease.assertOwned();
      await prisma.operationalJob.updateMany({
        where: { kind: "EXPORT", ...ownedJobWhere(candidate) },
        data: { progress: 55 },
      });
      stored = await serviceContext.objectStorage.put(objectKey, content);
      rowCount = rows.length;
      sizeBytes = content.length;
    }

    const hash = createHash("sha256");
    for await (const chunk of await serviceContext.objectStorage.openReadStream(
      stored.objectKey,
    )) {
      hash.update(chunk as Buffer);
    }
    const checksum = `sha256:${hash.digest("hex")}`;
    if (checksum !== stored.checksum)
      throw new ServiceUnavailableException(
        "Tệp export lưu trữ không vượt qua kiểm tra checksum.",
      );
    const completed = await prisma.operationalJob.updateMany({
      where: { kind: "EXPORT", ...ownedJobWhere(candidate) },
      data: {
        status: "COMPLETED",
        progress: 100,
        rowCount,
        objectKey: stored.objectKey,
        checksum: stored.checksum,
        sizeBytes: BigInt(sizeBytes),
      },
    });
    if (completed.count !== 1) return true;
    await serviceContext.logDatabase(
      prisma,
      candidate.requestedBy,
      "DATA_EXPORTED",
      candidate.id,
      `${candidate.category} · ${format} · ${rowCount} dòng · ${stored.checksum}`,
    );
  } catch (error) {
    await serviceContext.retryExportJob(
      prisma,
      candidate.id,
      candidate.attempts + 1,
      error,
    );
  } finally {
    await lease.stop();
  }
  return true;
}

/** Đặt lại backup để retry hoặc chuyển FAILED sau lần thử cuối. */
export async function retryBackupJob(
  serviceContext: SystemServiceContext,
  prisma: PrismaService,
  idValue: string,
  attempts: number,
  error: unknown,
): Promise<void> {
  const terminal = attempts >= 5;
  const message = serviceContext.jobError(
    error,
    "Không thể tạo hoặc lưu bản sao lưu.",
  );
  const updated = await prisma.operationalJob.updateMany({
    where: {
      kind: "BACKUP",
      id: idValue,
      status: "RUNNING",
      attempts,
      availableAt: { gt: new Date() },
    },
    data: {
      status: terminal ? "FAILED" : "PENDING",
      progress: 0,
      availableAt: serviceContext.jobRetryAt(attempts),
      errorMessage: message,
      completedAt: terminal ? new Date() : null,
    },
  });
  if (updated.count !== 1) return;
  const row = await prisma.operationalJob.findUniqueOrThrow({
    where: { kind: "BACKUP", id: idValue },
  });
  await serviceContext.logDatabase(
    prisma,
    row.requestedBy,
    terminal ? "BACKUP_FAILED" : "BACKUP_RETRY_SCHEDULED",
    row.id,
    `Lần ${attempts}/5 · ${message}`,
  );
}

/** Đặt lại export để retry hoặc chuyển FAILED sau lần thử cuối. */
export async function retryExportJob(
  serviceContext: SystemServiceContext,
  prisma: PrismaService,
  idValue: string,
  attempts: number,
  error: unknown,
): Promise<void> {
  const terminal = attempts >= 5;
  const message = serviceContext.jobError(
    error,
    "Không thể tạo hoặc kiểm chứng tệp export.",
  );
  const updated = await prisma.operationalJob.updateMany({
    where: {
      kind: "EXPORT",
      id: idValue,
      status: "RUNNING",
      attempts,
      availableAt: { gt: new Date() },
    },
    data: {
      status: terminal ? "FAILED" : "PENDING",
      progress: 0,
      availableAt: serviceContext.jobRetryAt(attempts),
      errorMessage: message,
    },
  });
  if (updated.count !== 1) return;
  const row = await prisma.operationalJob.findUniqueOrThrow({
    where: { kind: "EXPORT", id: idValue },
  });
  await serviceContext.logDatabase(
    prisma,
    row.requestedBy,
    terminal ? "DATA_EXPORT_FAILED" : "DATA_EXPORT_RETRY_SCHEDULED",
    row.id,
    `Lần ${attempts}/5 · ${message}`,
  );
}

/** Tạo lease 10 phút để job RUNNING bị worker chết có thể được nhận lại. */
export function jobLeaseExpiry(): Date {
  return new Date(Date.now() + 10 * 60_000);
}

/** Tạo backoff lũy tiến tối đa một giờ cho lần retry tiếp theo. */
export function jobRetryAt(attempts: number): Date {
  return new Date(
    Date.now() + Math.min(60, 2 ** Math.max(0, attempts - 1)) * 60_000,
  );
}

/** Chuẩn hóa lỗi worker, giới hạn độ dài và không làm lộ stack hay credential. */
export function jobError(error: unknown, fallback: string): string {
  return (error instanceof Error ? error.message : fallback).slice(0, 500);
}
