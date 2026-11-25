import type { SystemSettings } from "@wind-of-fall/contracts";
import { DEFAULT_MATERIAL_MIME_TYPES } from "../../../infrastructure/file-transfer.js";

export type {
  AuditEvent,
  AuditFilter,
  AuditPageFilter,
  BackupRun,
  DataExport,
  IntegrationConfig,
  RestoreRun,
  SnapshotAssetAudit,
  StorageAuditRun,
  StorageCleanupFailure,
  StorageOverview,
  SystemSettings,
} from "@wind-of-fall/contracts";

export const templateVariables: Record<string, readonly string[]> = {
  ACCOUNT_UPDATED: ["displayName", "accountStatus"],
  CLASS_REMINDER: ["className", "sessionTitle", "startsAt"],
  EXAM_PUBLISHED: ["examTitle", "className", "openAt", "closeAt"],
  FORUM_MENTION: ["topicTitle", "authorName"],
  SUPPORT_UPDATED: ["ticketId", "status", "resolution"],
};

/** Tạo cấu hình trung tâm mặc định với các danh sách độc lập cho mỗi lần khởi tạo. */
export const defaultSettings = (): SystemSettings => ({
  centerName: "Trung tâm hỗ trợ giảng dạy Wind EDU",
  timezone: "Asia/Bangkok",
  locale: "vi-VN",
  maxFileSizeMb: 50,
  storageQuotaMb: 10_240,
  allowedMimeTypes: [...DEFAULT_MATERIAL_MIME_TYPES],
  notificationSender: "Wind EDU",
  maintenanceMode: false,
  learnerEmailNotificationsEnabled: false,
  version: 1,
  updatedBy: "system",
  updatedAt: new Date().toISOString(),
});
