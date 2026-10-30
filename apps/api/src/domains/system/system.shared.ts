import { DEFAULT_MATERIAL_MIME_TYPES } from "../../infrastructure/file-transfer.js";

export type ExamApprovalMode = "AUTO" | "MANUAL";

export interface SystemSettings {
  centerName: string;
  timezone: string;
  locale: string;
  retentionDays: number;
  maxFileSizeMb: number;
  storageQuotaMb: number;
  allowedMimeTypes: string[];
  moderationEnabled: boolean;
  examApprovalMode: ExamApprovalMode;
  questionApprovalMode: ExamApprovalMode;
  notificationSender: string;
  maintenanceMode: boolean;
  learnerEmailNotificationsEnabled: boolean;
  version: number;
  effectiveAt: string;
  updatedBy: string;
  updatedAt: string;
}

export interface SystemSettingRevision extends SystemSettings {
  id: string;
  key: string;
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

export interface NotificationTemplate {
  id: string;
  eventCode: string;
  locale: string;
  subject: string;
  body: string;
  version: number;
  status: "DRAFT" | "PUBLISHED";
  updatedAt: string;
}

export interface ModerationPolicy {
  version: number;
  prohibitedTerms: string[];
  maxPostsPerMinute: number;
  action: "FLAG" | "HIDE_PENDING_REVIEW";
  updatedAt: string;
}

export interface TemplateTestDelivery {
  recipient: string;
  subject: string;
  body: string;
  status: "SENT";
  provider: "resend";
  providerMessageId: string;
  sentAt: string;
}

export interface RetentionPreview {
  category: string;
  retentionDays: number;
  action: "ARCHIVE" | "DELETE";
  estimatedRows: number;
  legalHoldRows: number;
  deletableRows: number;
  cutoffAt: string;
}

export interface RetentionPolicyView {
  id: string;
  category: string;
  version: number;
  retentionDays: number;
  action: "ARCHIVE" | "DELETE";
  approvedBy: string;
  effectiveAt: string;
  createdAt: string;
}

export interface RetentionJobView {
  id: string;
  policyId: string;
  status: "PENDING" | "RUNNING" | "COMPLETED" | "FAILED";
  affectedRows: number;
  skippedRows: number;
  requestedBy: string;
  approvedBy: string;
  approvedAt?: string;
  evidence: Record<string, unknown>;
  createdAt: string;
  completedAt?: string;
  attempts: number;
  progress: number;
}

export interface LegalHoldView {
  id: string;
  category: string;
  reason: string;
  active: boolean;
  createdBy: string;
  createdAt: string;
  releasedAt?: string;
  releasedBy?: string;
  releaseReason?: string;
}

export interface SystemAlertView {
  id: string;
  fingerprint: string;
  serviceName: string;
  severity: "WARNING" | "CRITICAL";
  status: "OPEN" | "ACKNOWLEDGED" | "MUTED" | "RESOLVED";
  summary: string;
  metricValue?: number;
  threshold?: number;
  detectedAt: string;
  acknowledgedBy?: string;
  mutedUntil?: string;
  recoveredAt?: string;
  updatedAt: string;
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

export const retentionCategories = [
  "AUDIT",
  "SUPPORT",
  "LEARNING",
  "AI_RESULTS",
] as const;

export type RetentionCategory = (typeof retentionCategories)[number];

/** Tạo cấu hình trung tâm mặc định với các danh sách độc lập cho mỗi lần khởi tạo. */
export const defaultSettings = (): SystemSettings => ({
  centerName: "Trung tâm hỗ trợ giảng dạy Wind EDU",
  timezone: "Asia/Bangkok",
  locale: "vi-VN",
  retentionDays: 365,
  maxFileSizeMb: 50,
  storageQuotaMb: 10_240,
  allowedMimeTypes: [...DEFAULT_MATERIAL_MIME_TYPES],
  moderationEnabled: true,
  examApprovalMode: "AUTO",
  questionApprovalMode: "AUTO",
  notificationSender: "Wind EDU",
  maintenanceMode: false,
  learnerEmailNotificationsEnabled: false,
  version: 1,
  effectiveAt: new Date().toISOString(),
  updatedBy: "system",
  updatedAt: new Date().toISOString(),
});
