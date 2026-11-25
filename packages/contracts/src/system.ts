import type { ByteSizeNumber, IsoDateTimeString, SerializedBigIntId } from "./primitives.js";

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
  updatedAt: IsoDateTimeString;
}

export interface StorageOverview {
  quotaBytes: ByteSizeNumber;
  usedBytes: ByteSizeNumber;
  usagePercent: number;
  maxFileSizeMb: number;
  allowedMimeTypes: string[];
  byClass: Array<{
    classId: string;
    classCode: string;
    className: string;
    fileCount: number;
    usedBytes: ByteSizeNumber;
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
  lastCheckedAt?: IsoDateTimeString;
  updatedAt: IsoDateTimeString;
}

export type OperationalJobStatus = "PENDING" | "RUNNING" | "COMPLETED" | "FAILED";

export interface BackupRun {
  id: string;
  type: "FULL" | "INCREMENTAL";
  status: OperationalJobStatus;
  createdAt: IsoDateTimeString;
  canRestore: boolean;
  checksum: string;
  sizeMb: number;
  attempts: number;
  progress: number;
}

/** Sự kiện nhật ký kiểm toán; `id` tuần tự hóa từ PostgreSQL BIGINT sang chuỗi thập phân. */
export interface AuditEvent {
  id: SerializedBigIntId;
  actor: string;
  action: string;
  target: string;
  detail: string;
  createdAt: IsoDateTimeString;
}

export interface AuditFilter {
  query?: string;
  actor?: string;
  action?: string;
  target?: string;
  from?: IsoDateTimeString;
  to?: IsoDateTimeString;
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
  status: OperationalJobStatus;
  requestedBy: string;
  approvedBy?: string;
  reason?: string;
  targetDatabase?: string;
  createdAt: IsoDateTimeString;
  verification: string;
}

export interface DataExport {
  id: string;
  category: string;
  format: "CSV" | "JSON";
  status: OperationalJobStatus;
  rowCount: number;
  checksum?: string;
  sizeBytes: ByteSizeNumber;
  downloadAvailable: boolean;
  expiresAt: IsoDateTimeString;
  createdAt: IsoDateTimeString;
  attempts: number;
  progress: number;
}

export interface SnapshotAssetAudit {
  generatedAt: IsoDateTimeString;
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
  status: OperationalJobStatus;
  sampleRate: number;
  progress: number;
  attempts: number;
  checkedObjects: number;
  requestedBy: string;
  createdAt: IsoDateTimeString;
  completedAt?: IsoDateTimeString;
  errorMessage?: string;
  report?: SnapshotAssetAudit;
}

export interface StorageCleanupFailure {
  id: string;
  entityType: "ASSIGNMENT_ATTACHMENT";
  objectKey: string;
  error: string;
  removedAt: IsoDateTimeString;
}
