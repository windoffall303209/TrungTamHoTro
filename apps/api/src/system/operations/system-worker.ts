import {
  BadRequestException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { createHash } from "node:crypto";
import { PrismaService } from "../../database/prisma.service.js";
import { withTemporaryFile } from "../../infrastructure/file-streams.js";
import {
  ownedJobWhere,
  startOperationalLease,
} from "../operational-lease.js";
import { DataExport } from "../system.shared.js";
import type { SystemServiceContext } from "../system.context.js";

/** Thu hồi lease hết hạn rồi xử lý một batch backup, export và retention theo hàng đợi DB. */
export async function drainOperationalJobs(
  serviceContext: SystemServiceContext,
  limit = 6,
): Promise<{
  backup: number;
  export: number;
  retention: number;
}> {
  const prisma = serviceContext.database();
  if (!prisma) return { backup: 0, export: 0, retention: 0 };
  const now = new Date();
  await Promise.all([
    prisma.backupJob.updateMany({
      where: {
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
    }),
    prisma.dataExportJob.updateMany({
      where: {
        status: { in: ["RUNNING", "PENDING"] },
        attempts: { gte: 5 },
        availableAt: { lte: now },
      },
      data: {
        status: "FAILED",
        progress: 0,
        errorMessage: "Tác vụ hết hạn ở lần thử cuối.",
      },
    }),
    prisma.retentionJob.updateMany({
      where: {
        status: { in: ["RUNNING", "PENDING"] },
        attempts: { gte: 5 },
        availableAt: { lte: now },
      },
      data: { status: "FAILED", progress: 0, completedAt: now },
    }),
  ]);
  await Promise.all([
    prisma.backupJob.updateMany({
      where: {
        status: "RUNNING",
        attempts: { lt: 5 },
        availableAt: { lte: now },
      },
      data: { status: "PENDING", progress: 0, availableAt: now },
    }),
    prisma.dataExportJob.updateMany({
      where: {
        status: "RUNNING",
        attempts: { lt: 5 },
        availableAt: { lte: now },
      },
      data: { status: "PENDING", progress: 0, availableAt: now },
    }),
    prisma.retentionJob.updateMany({
      where: {
        status: "RUNNING",
        attempts: { lt: 5 },
        availableAt: { lte: now },
      },
      data: { status: "PENDING", progress: 0, availableAt: now },
    }),
  ]);
  const processed = { backup: 0, export: 0, retention: 0 };
  for (let index = 0; index < Math.max(1, Math.min(limit, 30)); index += 1) {
    if (await serviceContext.processQueuedBackup(prisma)) {
      processed.backup += 1;
      continue;
    }
    if (await serviceContext.processQueuedExport(prisma)) {
      processed.export += 1;
      continue;
    }
    if (await serviceContext.processQueuedRetention(prisma)) {
      processed.retention += 1;
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
  const candidate = await prisma.backupJob.findFirst({
    where: {
      status: "PENDING",
      availableAt: { lte: new Date() },
      attempts: { lt: 5 },
    },
    orderBy: { createdAt: "asc" },
  });
  if (!candidate) return false;
  const claimed = await prisma.backupJob.updateMany({
    where: {
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
    prisma.backupJob.updateMany({
      where: ownedJobWhere(candidate),
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
      await prisma.backupJob.updateMany({
        where: ownedJobWhere(candidate),
        data: { progress: 60 },
      });
      const objectKey = `backups/${new Date().toISOString().slice(0, 10)}/${candidate.id}-${candidate.attempts + 1}.dump`;
      const stored = await serviceContext.objectStorage!.putFile(
        objectKey,
        path,
      );
      const completed = await prisma.backupJob.updateMany({
        where: ownedJobWhere(candidate),
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
  const candidate = await prisma.dataExportJob.findFirst({
    where: {
      status: "PENDING",
      availableAt: { lte: new Date() },
      attempts: { lt: 5 },
    },
    orderBy: { createdAt: "asc" },
  });
  if (!candidate) return false;
  const claimed = await prisma.dataExportJob.updateMany({
    where: {
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
    prisma.dataExportJob.updateMany({
      where: ownedJobWhere(candidate),
      data: { availableAt: serviceContext.jobLeaseExpiry() },
    }),
  );
  try {
    if (!serviceContext.objectStorage)
      throw new ServiceUnavailableException("Kho object chưa sẵn sàng.");
    const format: DataExport["format"] =
      candidate.format === "JSON" ? "JSON" : "CSV";
    const rows = await serviceContext.collectExportRows(
      prisma,
      candidate.category,
    );
    const content = serviceContext.serializeExport(rows, format);
    await lease.assertOwned();
    await prisma.dataExportJob.updateMany({
      where: ownedJobWhere(candidate),
      data: { progress: 55 },
    });
    const objectKey = `exports/${candidate.category.toLowerCase()}/${candidate.id}-${candidate.attempts + 1}.${format.toLowerCase()}`;
    const stored = await serviceContext.objectStorage.put(objectKey, content);
    const verified = await serviceContext.objectStorage.get(stored.objectKey);
    const checksum = `sha256:${createHash("sha256").update(verified).digest("hex")}`;
    if (checksum !== stored.checksum)
      throw new ServiceUnavailableException(
        "Tệp export lưu trữ không vượt qua kiểm tra checksum.",
      );
    const completed = await prisma.dataExportJob.updateMany({
      where: ownedJobWhere(candidate),
      data: {
        status: "COMPLETED",
        progress: 100,
        rowCount: rows.length,
        objectKey: stored.objectKey,
        checksum: stored.checksum,
        sizeBytes: BigInt(content.length),
      },
    });
    if (completed.count !== 1) return true;
    await serviceContext.logDatabase(
      prisma,
      candidate.requestedBy,
      "DATA_EXPORTED",
      candidate.id,
      `${candidate.category} · ${format} · ${rows.length} dòng · ${stored.checksum}`,
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

/** Claim retention theo policy đã ghim, kiểm tra lại legal hold rồi mới archive/delete. */
export async function processQueuedRetention(
  serviceContext: SystemServiceContext,
  prisma: PrismaService,
): Promise<boolean> {
  const candidate = await prisma.retentionJob.findFirst({
    where: {
      approvedAt: { not: null },
      status: "PENDING",
      availableAt: { lte: new Date() },
      attempts: { lt: 5 },
    },
    include: { policy: true },
    orderBy: { createdAt: "asc" },
  });
  if (!candidate) return false;
  const claimed = await prisma.retentionJob.updateMany({
    where: {
      id: candidate.id,
      status: "PENDING",
      attempts: candidate.attempts,
    },
    data: {
      status: "RUNNING",
      attempts: { increment: 1 },
      progress: 10,
      availableAt: serviceContext.jobLeaseExpiry(),
    },
  });
  if (claimed.count !== 1) return true;
  const lease = startOperationalLease(() =>
    prisma.retentionJob.updateMany({
      where: ownedJobWhere(candidate),
      data: { availableAt: serviceContext.jobLeaseExpiry() },
    }),
  );
  const evidence = serviceContext.asRecord(candidate.evidence);
  const cutoffAt = new Date(serviceContext.stringValue(evidence.cutoffAt, ""));
  const action = evidence.action === "DELETE" ? "DELETE" : "ARCHIVE";
  try {
    if (Number.isNaN(cutoffAt.getTime()))
      throw new BadRequestException(
        "Snapshot retention không có cutoff hợp lệ.",
      );
    const affectedCandidateRows = await serviceContext.countRetentionRows(
      prisma,
      candidate.policy.category,
      cutoffAt,
    );
    const legalHold = await prisma.legalHold.findFirst({
      where: { category: candidate.policy.category, active: true },
    });
    if (legalHold) {
      const completed = await prisma.retentionJob.updateMany({
        where: ownedJobWhere(candidate),
        data: {
          status: "COMPLETED",
          progress: 100,
          affectedRows: 0,
          skippedRows: affectedCandidateRows,
          evidence: { ...evidence, legalHoldProtected: affectedCandidateRows },
          completedAt: new Date(),
        },
      });
      if (completed.count !== 1) return true;
      await serviceContext.logDatabase(
        prisma,
        candidate.requestedBy,
        "RETENTION_JOB_SKIPPED",
        candidate.id,
        `${affectedCandidateRows} bản ghi được legal hold bảo vệ.`,
      );
      return true;
    }
    await lease.assertOwned();
    await prisma.retentionJob.updateMany({
      where: ownedJobWhere(candidate),
      data: { progress: 40 },
    });
    const result = await serviceContext.executeRetention(
      prisma,
      candidate.policy.category,
      action,
      cutoffAt,
      candidate.id,
      () => lease.assertOwned(),
      candidate,
    );
    const completed = await prisma.retentionJob.updateMany({
      where: ownedJobWhere(candidate),
      data: {
        status: "COMPLETED",
        progress: 100,
        affectedRows: result.affectedRows,
        skippedRows: result.skippedRows,
        evidence: {
          ...evidence,
          archiveObjectKey: result.archiveObjectKey,
          archiveChecksum: result.archiveChecksum,
          removedObjects: result.removedObjects,
          objectCleanupFailures: result.objectCleanupFailures,
        },
        completedAt: new Date(),
      },
    });
    if (completed.count !== 1) return true;
    await serviceContext.logDatabase(
      prisma,
      candidate.requestedBy,
      "RETENTION_JOB_COMPLETED",
      candidate.id,
      `${result.affectedRows} bản ghi đã ${action === "ARCHIVE" ? "lưu trữ và xóa" : "xóa"}.`,
    );
  } catch (error) {
    await serviceContext.retryRetentionJob(
      prisma,
      candidate.id,
      candidate.attempts + 1,
      evidence,
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
  const updated = await prisma.backupJob.updateMany({
    where: {
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
  const row = await prisma.backupJob.findUniqueOrThrow({
    where: { id: idValue },
  });
  await serviceContext.logDatabase(
    prisma,
    row.requestedBy,
    terminal ? "BACKUP_FAILED" : "BACKUP_RETRY_SCHEDULED",
    row.id,
    `Lần ${attempts}/5 · ${message}`,
  );
  if (terminal)
    await serviceContext.recordAlert(
      `job:backup:${row.id}`,
      "operational-job",
      "CRITICAL",
      `Backup ${row.id} thất bại sau 5 lần thử.`,
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
  const updated = await prisma.dataExportJob.updateMany({
    where: {
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
  const row = await prisma.dataExportJob.findUniqueOrThrow({
    where: { id: idValue },
  });
  await serviceContext.logDatabase(
    prisma,
    row.requestedBy,
    terminal ? "DATA_EXPORT_FAILED" : "DATA_EXPORT_RETRY_SCHEDULED",
    row.id,
    `Lần ${attempts}/5 · ${message}`,
  );
  if (terminal)
    await serviceContext.recordAlert(
      `job:export:${row.id}`,
      "operational-job",
      "WARNING",
      `Export ${row.id} thất bại sau 5 lần thử.`,
    );
}

/** Đặt lại retention để retry hoặc chuyển FAILED, giữ snapshot và lỗi gần nhất trong evidence. */
export async function retryRetentionJob(
  serviceContext: SystemServiceContext,
  prisma: PrismaService,
  idValue: string,
  attempts: number,
  evidence: Record<string, unknown>,
  error: unknown,
): Promise<void> {
  const terminal = attempts >= 5;
  const message = serviceContext.jobError(
    error,
    "Không thể thực thi retention.",
  );
  const updated = await prisma.retentionJob.updateMany({
    where: {
      id: idValue,
      status: "RUNNING",
      attempts,
      availableAt: { gt: new Date() },
    },
    data: {
      status: terminal ? "FAILED" : "PENDING",
      progress: 0,
      availableAt: serviceContext.jobRetryAt(attempts),
      evidence: { ...evidence, lastError: message },
      completedAt: terminal ? new Date() : null,
    },
  });
  if (updated.count !== 1) return;
  const row = await prisma.retentionJob.findUniqueOrThrow({
    where: { id: idValue },
  });
  await serviceContext.logDatabase(
    prisma,
    row.requestedBy,
    terminal ? "RETENTION_JOB_FAILED" : "RETENTION_JOB_RETRY_SCHEDULED",
    row.id,
    `Lần ${attempts}/5 · ${message}`,
  );
  if (terminal)
    await serviceContext.recordAlert(
      `job:retention:${row.id}`,
      "operational-job",
      "CRITICAL",
      `Retention ${row.id} thất bại sau 5 lần thử.`,
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
