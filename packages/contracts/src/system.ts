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

/** Chỉ số connection pool PostgreSQL theo thời gian thực (không phát sinh truy vấn SQL). */
export interface DatabasePoolMetrics {
  enabled: boolean;
  max: number;
  totalCount: number;
  idleCount: number;
  activeCount: number;
  waitingCount: number;
}

/** Chỉ số kết nối SSE và listener LISTEN/NOTIFY có cardinality hữu hạn. */
export interface SseMetrics {
  activeConnections: number;
  totalOpened: number;
  byChannel: Record<"realtime" | "notifications" | "chat" | "operations", number>;
  listenerConnected: boolean;
  listenerReconnects: number;
  activeBusWatchers: number;
  eventsReceived: number;
}

/** Thống kê lời gọi AI theo cặp (task, outcome) hữu hạn. */
export interface AiCallMetric {
  task:
    | "SCAN_IMAGE"
    | "GENERATE_EXAM"
    | "DOCUMENT_CONTEXT"
    | "DOCUMENT_QA"
    | "STUDY_GUIDE"
    | "GRADING_ASSIST"
    | "HEALTH_CHECK";
  outcome: "SUCCESS" | "ERROR";
  count: number;
  averageDurationMs: number;
  maxDurationMs: number;
}

/** Thống kê vòng chạy của từng worker nền (outbox, operational_jobs, exam_reconciliation). */
export interface WorkerRunMetric {
  worker: "outbox" | "operational_jobs" | "exam_reconciliation";
  runs: number;
  processed: number;
  failed: number;
  averageDurationMs: number;
  maxDurationMs: number;
  lastRunAt?: IsoDateTimeString;
}

/** Snapshot toàn diện các chỉ số vận hành HTTP, DB pool, SSE, AI, worker và truyền tệp. */
export interface ObservabilityMetricsSnapshot {
  startedAt: IsoDateTimeString;
  uptimeSeconds: number;
  process: {
    rssBytes: number;
    heapUsedBytes: number;
    heapTotalBytes: number;
  };
  databasePool: DatabasePoolMetrics;
  sse: SseMetrics;
  ai: AiCallMetric[];
  workers: WorkerRunMetric[];
  transfers: {
    activeDownloads: number;
  };
  routes: Array<{
    route: string;
    requestCount: number;
    status2xxCount: number;
    status4xxCount: number;
    serverErrorCount: number;
    averageDurationMs: number;
    maxDurationMs: number;
  }>;
}

/** Bảng tổng hợp dashboard quản trị tính trực tiếp bằng SQL aggregate (COUNT/GROUP BY), không tải danh sách thô. */
export interface DashboardSummary {
  generatedAt: IsoDateTimeString;
  database: "connected" | "disabled";
  users: {
    total: number;
    active: number;
    pending: number;
    locked: number;
  };
  academic: {
    courses: number;
    classes: number;
    activeClasses: number;
    activeEnrollments: number;
    exams: number;
    assignments: number;
    openTickets: number;
  };
  outbox: Record<string, number>;
  jobs: {
    pending: number;
    running: number;
    failed: number;
    byKind: Record<string, Record<string, number>>;
  };
  ai: {
    studyDrafts: Record<string, number>;
    gradingSuggestions: Record<string, number>;
    documentAnswers: Record<string, number>;
    generationRequests: Record<string, number>;
  };
  storage: {
    quotaBytes: ByteSizeNumber;
    usedBytes: ByteSizeNumber;
    usagePercent: number;
    materialCount: number;
  };
  runtime: {
    databasePool: DatabasePoolMetrics;
    sse: SseMetrics;
    activeDownloads: number;
  };
}
