export type {
  AuditEvent as Audit,
  BackupRun as Backup,
  DataExport as ExportJob,
  RestoreRun as RestoreJob,
  StorageCleanupFailure,
} from "@wind-of-fall/contracts";

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
