import { PrismaService } from "../../../database/prisma.service.js";
import type { Prisma } from "../../../generated/prisma/client.js";
import { DatabaseBackupService } from "../../../infrastructure/database-backup.service.js";
import { EmailDeliveryService } from "../../../infrastructure/email-delivery.service.js";
import { ObjectStorageService } from "../../../infrastructure/object-storage.service.js";
import type { AuditEvent, BackupRun, DataExport, IntegrationConfig, LegalHoldView, RestoreRun, RetentionCategory, RetentionJobView, RetentionPolicyView, RetentionPreview, StorageOverview, SystemAlertView, SystemSettingRevision, SystemSettings } from "./system.shared.js";

/** Hợp đồng nội bộ của các nhóm nghiệp vụ; trạng thái vẫn thuộc một phiên bản service duy nhất. */
export interface SystemServiceContext {
  settings: SystemSettings;
  readonly integrations: IntegrationConfig[];
  readonly backups: BackupRun[];
  readonly restores: RestoreRun[];
  readonly exports: DataExport[];
  readonly exportFiles: Map<string, Buffer<ArrayBufferLike>>;
  readonly audit: AuditEvent[];
  readonly settingRevisions: SystemSettingRevision[];
  readonly retentionPolicies: RetentionPolicyView[];
  readonly retentionJobs: RetentionJobView[];
  readonly legalHolds: LegalHoldView[];
  readonly alerts: SystemAlertView[];
  prisma: PrismaService | undefined;
  emailDelivery: EmailDeliveryService | undefined;
  databaseBackup: DatabaseBackupService | undefined;
  objectStorage: ObjectStorageService | undefined;
  getSettings(): Promise<SystemSettings>;
  listIntegrations(): Promise<IntegrationConfig[]>;
  requestRestore(
    input: {
      backupId: string;
      mode: "DRILL" | "OPERATIONAL";
      reason: string;
      targetDatabase?: string;
    },
    actorId?: string,
  ): Promise<RestoreRun>;
  previewRetentionPolicy(
    policy: Pick<RetentionPolicyView, "category" | "retentionDays" | "action">,
  ): Promise<RetentionPreview>;
  processQueuedBackup(prisma: PrismaService): Promise<boolean>;
  processQueuedExport(prisma: PrismaService): Promise<boolean>;
  processQueuedRetention(prisma: PrismaService): Promise<boolean>;
  retryBackupJob(
    prisma: PrismaService,
    idValue: string,
    attempts: number,
    error: unknown,
  ): Promise<void>;
  retryExportJob(
    prisma: PrismaService,
    idValue: string,
    attempts: number,
    error: unknown,
  ): Promise<void>;
  retryRetentionJob(
    prisma: PrismaService,
    idValue: string,
    attempts: number,
    evidence: Record<string, unknown>,
    error: unknown,
  ): Promise<void>;
  jobLeaseExpiry(): Date;
  jobRetryAt(attempts: number): Date;
  jobError(error: unknown, fallback: string): string;
  getStorageOverview(): Promise<StorageOverview>;
  database(): PrismaService | undefined;
  mapSettings(
    value: Prisma.JsonValue,
    updatedAt: Date,
    version?: number,
    effectiveAt?: Date,
    updatedBy?: string,
  ): SystemSettings;
  mapIntegration(
    row: Prisma.IntegrationProviderGetPayload<Record<string, never>>,
  ): IntegrationConfig;
  mapBackup(row: Prisma.OperationalJobGetPayload<Record<string, never>>): BackupRun;
  mapRestore(
    row: Prisma.OperationalJobGetPayload<Record<string, never>>,
  ): RestoreRun;
  mapExport(
    row: Prisma.OperationalJobGetPayload<Record<string, never>>,
  ): DataExport;
  mapAudit(row: Prisma.AuditLogGetPayload<Record<string, never>>): AuditEvent;
  mapRetentionPolicy(
    row: Prisma.RetentionPolicyGetPayload<Record<string, never>>,
  ): RetentionPolicyView;
  mapRetentionJob(
    row: Prisma.RetentionJobGetPayload<Record<string, never>>,
  ): RetentionJobView;
  mapAlert(
    row: Prisma.SystemAlertGetPayload<Record<string, never>>,
  ): SystemAlertView;
  getLatestRetentionPolicy(
    category: string,
  ): Promise<RetentionPolicyView | undefined>;
  countRetentionRows(
    prisma: PrismaService,
    category: string,
    cutoffAt: Date,
  ): Promise<number>;
  executeRetention(
    prisma: PrismaService,
    category: string,
    action: "ARCHIVE" | "DELETE",
    cutoffAt: Date,
    jobId: string,
    assertOwned?: () => Promise<void>,
    claim?: { id: string; attempts: number },
  ): Promise<{
    affectedRows: number;
    skippedRows: number;
    archiveObjectKey?: string;
    archiveChecksum?: string;
    removedObjects: number;
    objectCleanupFailures: number;
  }>;
  aiResultSettings(
    prisma: PrismaService,
    cutoffAt: Date,
  ): Promise<Array<Prisma.SystemSettingGetPayload<Record<string, never>>>>;
  retentionCategory(value: string): RetentionCategory;
  validateRetentionArchive(content: Buffer): {
    category: string;
    records: unknown[];
    assets: Array<{
      objectKey: string;
      checksum: string;
      sizeBytes: number;
      contentBase64: string;
    }>;
  };
  collectExportRows(
    prisma: PrismaService,
    category: string,
  ): Promise<Array<Record<string, unknown>>>;
  serializeExport(
    rows: Array<Record<string, unknown>>,
    format: DataExport["format"],
  ): Buffer;
  recordAlert(
    fingerprint: string,
    serviceName: string,
    severity: SystemAlertView["severity"],
    summary: string,
    metricValue?: number,
    threshold?: number,
  ): Promise<void>;
  recoverAlert(fingerprint: string): Promise<void>;
  logDatabase(
    database: PrismaService | Prisma.TransactionClient,
    actorId: string,
    action: string,
    target: string,
    detail: string,
  ): Promise<void>;
  asRecord(value: Prisma.JsonValue | null): Record<string, unknown>;
  stringValue(value: unknown, fallback: string): string;
  numberValue(value: unknown, fallback: number): number;
  booleanValue(value: unknown, fallback: boolean): boolean;
  stringArray(value: unknown, fallback: string[]): string[];
  redactSensitive(value: string): string;
  isProvider(value: string): value is IntegrationConfig["provider"];
  log(actorId: string, action: string, target: string, detail: string): void;
}
