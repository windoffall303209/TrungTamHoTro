export interface Audit {
  id: string;
  actor: string;
  action: string;
  target: string;
  detail: string;
  createdAt: string;
}

export interface Backup {
  id: string;
  type: string;
  checksum: string;
  createdAt: string;
  status: string;
  attempts: number;
  progress: number;
}

export interface ExportJob {
  id: string;
  category: string;
  format: string;
  rowCount: number;
  expiresAt: string;
  status: string;
  checksum?: string;
  sizeBytes: number;
  downloadAvailable: boolean;
  attempts: number;
  progress: number;
}

export interface RestoreJob {
  id: string;
  backupId: string;
  mode: "DRILL" | "OPERATIONAL";
  status: string;
  requestedBy: string;
  approvedBy?: string;
  reason?: string;
  targetDatabase?: string;
  verification: string;
  createdAt: string;
}

export interface Template {
  id: string;
  eventCode: string;
  locale: string;
  subject: string;
  body: string;
  version: number;
  status: string;
}

export interface Policy {
  version: number;
  prohibitedTerms: string[];
  maxPostsPerMinute: number;
  action: "FLAG" | "HIDE_PENDING_REVIEW";
  updatedAt: string;
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

export interface RetentionPolicy {
  id: string;
  category: string;
  version: number;
  retentionDays: number;
  action: "ARCHIVE" | "DELETE";
  approvedBy: string;
  effectiveAt: string;
  createdAt: string;
}

export interface RetentionJob {
  id: string;
  policyId: string;
  status: string;
  affectedRows: number;
  skippedRows: number;
  requestedBy: string;
  approvedBy: string;
  approvedAt?: string;
  createdAt: string;
  evidence: Record<string, unknown>;
  attempts: number;
  progress: number;
}

export interface LegalHold {
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

export interface SystemAlert {
  id: string;
  serviceName: string;
  severity: "WARNING" | "CRITICAL";
  status: "OPEN" | "ACKNOWLEDGED" | "MUTED" | "RESOLVED";
  summary: string;
  metricValue?: number;
  threshold?: number;
  detectedAt: string;
  mutedUntil?: string;
  recoveredAt?: string;
}

export interface StorageCleanupFailure {
  id: string;
  entityType: string;
  objectKey: string;
  error: string;
  removedAt: string;
}

/** Chuyển trạng thái job kỹ thuật thành mô tả ngắn có tiến độ và số lần thử. */
export function operationalStatusText(item: {
  status: string;
  progress: number;
  attempts: number;
}): string {
  if (item.status === "PENDING")
    return item.attempts > 0
      ? `Chờ thử lại · lần ${item.attempts}/5`
      : "Đang chờ worker";
  if (item.status === "RUNNING") return `Đang xử lý · ${item.progress}%`;
  if (item.status === "FAILED") return `Thất bại sau ${item.attempts} lần`;
  return "Hoàn tất";
}
