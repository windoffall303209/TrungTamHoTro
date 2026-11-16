export interface Audit {
  id: string;
  actor: string;
  action: string;
  target: string;
  detail: string;
  createdAt: string;
}

export interface Backup {
  canRestore: boolean;
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
