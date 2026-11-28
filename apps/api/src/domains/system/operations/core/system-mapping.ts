import { BadRequestException } from "@nestjs/common";
import { PrismaService } from "../../../../database/prisma.service.js";
import type { Prisma } from "../../../../generated/prisma/client.js";
import { includeSupportedDocumentMimeTypes } from "../../../../infrastructure/file-transfer.js";
import { AuditEvent, BackupRun, DataExport, defaultSettings, IntegrationConfig, RestoreRun, SystemSettings } from "../../core/system.shared.js";
import type { SystemServiceContext } from "../../core/system.context.js";

/** Chọn Prisma khi DB được bật, nếu không dùng state in-memory của service. */
export function database(
  serviceContext: SystemServiceContext,
): PrismaService | undefined {
  return serviceContext.prisma?.isStartupConnectionEnabled()
    ? serviceContext.prisma
    : undefined;
}

/** Thu hẹp JSON cấu hình theo từng kiểu và áp dụng giá trị mặc định an toàn. */
export function mapSettings(
  serviceContext: SystemServiceContext,
  value: Prisma.JsonValue,
  updatedAt: Date,
  version = 1,
  updatedBy = "system",
): SystemSettings {
  const fallback = defaultSettings();
  const record = serviceContext.asRecord(value);
  const rawPerQuestion = Math.trunc(
    serviceContext.numberValue(
      record.aiTutorMaxPerQuestion,
      fallback.aiTutorMaxPerQuestion,
    ),
  );
  const aiTutorMaxPerQuestion = Math.max(1, Math.min(20, rawPerQuestion || fallback.aiTutorMaxPerQuestion));
  const rawPerExam = Math.trunc(
    serviceContext.numberValue(
      record.aiTutorMaxPerExam,
      fallback.aiTutorMaxPerExam,
    ),
  );
  const aiTutorMaxPerExam = Math.max(
    aiTutorMaxPerQuestion,
    Math.min(200, rawPerExam || fallback.aiTutorMaxPerExam),
  );
  return {
    centerName: serviceContext.stringValue(
      record.centerName,
      fallback.centerName,
    ),
    timezone: serviceContext.stringValue(record.timezone, fallback.timezone),
    locale: serviceContext.stringValue(record.locale, fallback.locale),
    maxFileSizeMb: serviceContext.numberValue(
      record.maxFileSizeMb,
      fallback.maxFileSizeMb,
    ),
    storageQuotaMb: serviceContext.numberValue(
      record.storageQuotaMb,
      fallback.storageQuotaMb,
    ),
    allowedMimeTypes: includeSupportedDocumentMimeTypes(
      serviceContext.stringArray(
        record.allowedMimeTypes,
        fallback.allowedMimeTypes,
      ),
    ),
    notificationSender: serviceContext.stringValue(
      record.notificationSender,
      fallback.notificationSender,
    ),
    maintenanceMode: serviceContext.booleanValue(
      record.maintenanceMode,
      fallback.maintenanceMode,
    ),
    learnerEmailNotificationsEnabled: serviceContext.booleanValue(
      record.learnerEmailNotificationsEnabled,
      fallback.learnerEmailNotificationsEnabled,
    ),
    aiTutorMaxPerQuestion,
    aiTutorMaxPerExam,
    version,
    updatedBy,
    updatedAt: updatedAt.toISOString(),
  };
}

/** Ánh xạ integration Prisma và xác minh provider thuộc danh mục hỗ trợ. */
export function mapIntegration(
  serviceContext: SystemServiceContext,
  row: Prisma.IntegrationProviderGetPayload<Record<string, never>>,
): IntegrationConfig {
  if (!serviceContext.isProvider(row.provider))
    throw new BadRequestException(
      `Nhà cung cấp ${row.provider} không được hỗ trợ.`,
    );
  const healthStatus =
    row.healthStatus === "HEALTHY" || row.healthStatus === "ERROR"
      ? row.healthStatus
      : "UNKNOWN";
  return {
    id: row.id,
    provider: row.provider,
    enabled: row.enabled,
    isDefault: row.isDefault,
    healthStatus,
    maskedCredential:
      row.provider === "JITSI"
        ? "Không yêu cầu"
        : row.credentialRef
          ? "••••••••"
          : "Chưa cấu hình",
    webhookConfigured: Boolean(row.webhookUrl),
    lastCheckedAt: row.lastCheckedAt?.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Ánh xạ job sao lưu, bao gồm metadata và thông tin lỗi đã lưu. */
export function mapBackup(
  row: Prisma.OperationalJobGetPayload<Record<string, never>>,
): BackupRun {
  return {
    id: row.id,
    canRestore: row.status === "COMPLETED" && Boolean(row.objectKey && row.checksum),
    type: row.type === "INCREMENTAL" ? "INCREMENTAL" : "FULL",
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    checksum: row.checksum ?? "",
    sizeMb:
      row.sizeBytes === null
        ? 0
        : Math.round(Number(row.sizeBytes) / 100_000) / 10,
    attempts: row.attempts,
    progress: row.progress,
  };
}

/** Ánh xạ yêu cầu phục hồi, loại thao tác và dấu vết hai người. */
export function mapRestore(
  row: Prisma.OperationalJobGetPayload<Record<string, never>>,
): RestoreRun {
  return {
    id: row.id,
    backupId: row.backupId!,
    mode: row.mode === "OPERATIONAL" ? "OPERATIONAL" : "DRILL",
    status: row.status,
    requestedBy: row.requestedBy,
    approvedBy: row.approvedBy ?? undefined,
    reason: row.reason ?? undefined,
    targetDatabase: row.targetDatabase ?? undefined,
    createdAt: row.createdAt.toISOString(),
    verification: row.verification ?? "",
  };
}

/** Ánh xạ job xuất dữ liệu và URL/checksum khi hoàn thành. */
export function mapExport(
  row: Prisma.OperationalJobGetPayload<Record<string, never>>,
): DataExport {
  return {
    id: row.id,
    category: row.category!,
    format: row.format === "JSON" ? "JSON" : "CSV",
    status: row.status,
    rowCount: row.rowCount ?? 0,
    checksum: row.checksum ?? undefined,
    sizeBytes: row.sizeBytes === null ? 0 : Number(row.sizeBytes),
    downloadAvailable:
      row.status === "COMPLETED" &&
      Boolean(row.objectKey) &&
      Boolean(row.expiresAt && row.expiresAt > new Date()),
    expiresAt: row.expiresAt?.toISOString() ?? row.createdAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    attempts: row.attempts,
    progress: row.progress,
  };
}

/** Ánh xạ audit log và che chuỗi nhạy cảm trong detail. */
export function mapAudit(
  serviceContext: SystemServiceContext,
  row: Prisma.AuditLogGetPayload<Record<string, never>>,
): AuditEvent {
  const context = serviceContext.asRecord(row.context);
  return {
    id: row.id.toString(),
    actor: row.actorId ?? "system",
    action: row.action,
    target: row.entityId ?? row.entityType,
    detail: serviceContext.redactSensitive(
      serviceContext.stringValue(context.detail ?? context.summary, row.action),
    ),
    createdAt: row.createdAt.toISOString(),
  };
}
