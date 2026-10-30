import { BadRequestException } from "@nestjs/common";
import { PrismaService } from "../../../database/prisma.service.js";
import type { Prisma } from "../../../generated/prisma/client.js";
import { includeSupportedDocumentMimeTypes } from "../../../infrastructure/file-transfer.js";
import {
  AuditEvent,
  BackupRun,
  DataExport,
  defaultSettings,
  IntegrationConfig,
  ModerationPolicy,
  NotificationTemplate,
  RestoreRun,
  RetentionJobView,
  RetentionPolicyView,
  SystemAlertView,
  SystemSettings,
} from "../system.shared.js";
import type { SystemServiceContext } from "../system.context.js";

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
  effectiveAt = updatedAt,
  updatedBy = "system",
): SystemSettings {
  const fallback = defaultSettings();
  const record = serviceContext.asRecord(value);
  return {
    centerName: serviceContext.stringValue(
      record.centerName,
      fallback.centerName,
    ),
    timezone: serviceContext.stringValue(record.timezone, fallback.timezone),
    locale: serviceContext.stringValue(record.locale, fallback.locale),
    retentionDays: serviceContext.numberValue(
      record.retentionDays,
      fallback.retentionDays,
    ),
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
    moderationEnabled: serviceContext.booleanValue(
      record.moderationEnabled,
      fallback.moderationEnabled,
    ),
    examApprovalMode: record.examApprovalMode === "MANUAL" ? "MANUAL" : "AUTO",
    questionApprovalMode:
      record.questionApprovalMode === "MANUAL" ? "MANUAL" : "AUTO",
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
    version,
    effectiveAt: effectiveAt.toISOString(),
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
  row: Prisma.BackupJobGetPayload<Record<string, never>>,
): BackupRun {
  return {
    id: row.id,
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
  row: Prisma.RestoreJobGetPayload<Record<string, never>>,
): RestoreRun {
  return {
    id: row.id,
    backupId: row.backupId,
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
  row: Prisma.DataExportJobGetPayload<Record<string, never>>,
): DataExport {
  return {
    id: row.id,
    category: row.category,
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

/** Ánh xạ mẫu thông báo Prisma sang hợp đồng quản trị. */
export function mapTemplate(
  row: Prisma.NotificationTemplateGetPayload<Record<string, never>>,
): NotificationTemplate {
  return {
    id: row.id,
    eventCode: row.eventCode,
    locale: row.locale,
    subject: row.subject,
    body: row.body,
    version: row.version,
    status: row.status === "PUBLISHED" ? "PUBLISHED" : "DRAFT",
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Ánh xạ JSON từ cấm và tham số kiểm duyệt sang policy. */
export function mapModeration(
  serviceContext: SystemServiceContext,
  row: Prisma.ModerationPolicyGetPayload<Record<string, never>>,
): ModerationPolicy {
  if (row.action !== "FLAG" && row.action !== "HIDE_PENDING_REVIEW")
    throw new BadRequestException("Hành động kiểm duyệt không hợp lệ.");
  return {
    version: row.version,
    prohibitedTerms: serviceContext.stringArray(row.prohibitedTerms, []),
    maxPostsPerMinute: row.maxPostsPerMinute,
    action: row.action,
    updatedAt: row.createdAt.toISOString(),
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

/** Ánh xạ chính sách lưu giữ và mốc hiệu lực sang view model. */
export function mapRetentionPolicy(
  row: Prisma.RetentionPolicyGetPayload<Record<string, never>>,
): RetentionPolicyView {
  if (row.action !== "ARCHIVE" && row.action !== "DELETE")
    throw new BadRequestException("Hành động retention không hợp lệ.");
  return {
    id: row.id,
    category: row.category,
    version: row.version,
    retentionDays: row.retentionDays,
    action: row.action,
    approvedBy: row.approvedBy,
    effectiveAt: row.effectiveAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
  };
}

/** Ánh xạ job retention cùng số bản ghi xử lý và lỗi. */
export function mapRetentionJob(
  serviceContext: SystemServiceContext,
  row: Prisma.RetentionJobGetPayload<Record<string, never>>,
): RetentionJobView {
  return {
    id: row.id,
    policyId: row.policyId,
    status: row.status,
    affectedRows: row.affectedRows,
    skippedRows: row.skippedRows,
    requestedBy: row.requestedBy,
    approvedBy: row.approvedBy,
    approvedAt: row.approvedAt?.toISOString(),
    evidence: serviceContext.asRecord(row.evidence),
    createdAt: row.createdAt.toISOString(),
    completedAt: row.completedAt?.toISOString(),
    attempts: row.attempts,
    progress: row.progress,
  };
}

/** Ánh xạ cảnh báo và các mốc acknowledge/mute/resolve. */
export function mapAlert(
  row: Prisma.SystemAlertGetPayload<Record<string, never>>,
): SystemAlertView {
  const severity = row.severity === "CRITICAL" ? "CRITICAL" : "WARNING";
  const status = ["OPEN", "ACKNOWLEDGED", "MUTED", "RESOLVED"].includes(
    row.status,
  )
    ? (row.status as SystemAlertView["status"])
    : "OPEN";
  return {
    id: row.id,
    fingerprint: row.fingerprint,
    serviceName: row.serviceName,
    severity,
    status,
    summary: row.summary,
    metricValue: row.metricValue ?? undefined,
    threshold: row.threshold ?? undefined,
    detectedAt: row.detectedAt.toISOString(),
    acknowledgedBy: row.acknowledgedBy ?? undefined,
    mutedUntil: row.mutedUntil?.toISOString(),
    recoveredAt: row.recoveredAt?.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
