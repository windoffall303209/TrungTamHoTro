import { DEFAULT_MATERIAL_MIME_TYPES } from "../../../infrastructure/file-transfer.js";


export interface SystemSettings {
  centerName: string;
  timezone: string;
  locale: string;
  maxFileSizeMb: number;
  storageQuotaMb: number;
  allowedMimeTypes: string[];
  notificationSender: string;
  maintenanceMode: boolean;
  learnerEmailNotificationsEnabled: boolean;
  version: number;
  updatedBy: string;
  updatedAt: string;
}

export interface StorageOverview {
  quotaBytes: number;
  usedBytes: number;
  usagePercent: number;
  maxFileSizeMb: number;
  allowedMimeTypes: string[];
  byClass: Array<{
    classId: string;
    classCode: string;
    className: string;
    fileCount: number;
    usedBytes: number;
  }>;
}

export interface IntegrationConfig {
  id: string;
  provider: "GOOGLE_MEET" | "ZOOM" | "JITSI";
  enabled: boolean;
  isDefault: boolean;
  healthStatus: "UNKNOWN" | "HEALTHY" | "ERROR";
  maskedCredential: string;
  webhookConfigured: boolean;
  lastCheckedAt?: string;
  updatedAt: string;
}

export interface BackupRun {
  id: string;
  type: "FULL" | "INCREMENTAL";
  status: "PENDING" | "RUNNING" | "COMPLETED" | "FAILED";
  createdAt: string;
  canRestore: boolean;
  checksum: string;
  sizeMb: number;
  attempts: number;
  progress: number;
}

export interface AuditEvent {
  id: string;
  actor: string;
  action: string;
  target: string;
  detail: string;
  createdAt: string;
}

export interface AuditFilter {
  query?: string;
  actor?: string;
  action?: string;
  target?: string;
  from?: string;
  to?: string;
  limit?: number;
}

export interface AuditPageFilter extends AuditFilter {
  page?: number;
  pageSize?: number;
}

export interface RestoreRun {
  id: string;
  backupId: string;
  mode: "DRILL" | "OPERATIONAL";
  status: "PENDING" | "RUNNING" | "COMPLETED" | "FAILED";
  requestedBy: string;
  approvedBy?: string;
  reason?: string;
  targetDatabase?: string;
  createdAt: string;
  verification: string;
}

export interface DataExport {
  id: string;
  category: string;
  format: "CSV" | "JSON";
  status: "PENDING" | "RUNNING" | "COMPLETED" | "FAILED";
  rowCount: number;
  checksum?: string;
  sizeBytes: number;
  downloadAvailable: boolean;
  expiresAt: string;
  createdAt: string;
  attempts: number;
  progress: number;
}

export interface SnapshotAssetAudit {
  generatedAt: string;
  classesWithoutCourseSnapshot: Array<{
    classId: string;
    courseId: string;
    courseVersion: number;
  }>;
  referencedObjectCount: number;
  uniqueObjectCount: number;
  sharedObjects: Array<{ objectKey: string; references: string[] }>;
  missingObjects: Array<{ objectKey: string; references: string[] }>;
  verificationMode?: "STAT_HEAD_AND_SAMPLE" | "STREAM_FALLBACK";
  sampledChecksumCount?: number;
  checksumMismatches?: Array<{
    objectKey: string;
    expectedChecksum: string;
    actualChecksum: string;
    references: string[];
  }>;
}

export interface StorageAuditRun {
  id: string;
  status: "PENDING" | "RUNNING" | "COMPLETED" | "FAILED";
  sampleRate: number;
  progress: number;
  attempts: number;
  checkedObjects: number;
  requestedBy: string;
  createdAt: string;
  completedAt?: string;
  errorMessage?: string;
  report?: SnapshotAssetAudit;
}

export interface StorageCleanupFailure {
  id: string;
  entityType: "ASSIGNMENT_ATTACHMENT";
  objectKey: string;
  error: string;
  removedAt: string;
}

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
