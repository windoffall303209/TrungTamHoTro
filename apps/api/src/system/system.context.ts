import { PrismaService } from "../database/prisma.service.js";
import type { Prisma } from "../generated/prisma/client.js";
import { DatabaseBackupService } from "../infrastructure/database-backup.service.js";
import { EmailDeliveryService } from "../infrastructure/email-delivery.service.js";
import { ObjectStorageService } from "../infrastructure/object-storage.service.js";
import {
  AuditEvent,
  AuditFilter,
  BackupRun,
  DataExport,
  IntegrationConfig,
  LegalHoldView,
  ModerationPolicy,
  NotificationTemplate,
  RestoreRun,
  RetentionCategory,
  RetentionJobView,
  RetentionPolicyView,
  RetentionPreview,
  SnapshotAssetAudit,
  StorageCleanupFailure,
  StorageOverview,
  SystemAlertView,
  SystemSettingRevision,
  SystemSettings,
  TemplateTestDelivery,
} from "./system.shared.js";

/** Hợp đồng nội bộ của các nhóm nghiệp vụ; trạng thái vẫn thuộc một phiên bản service duy nhất. */
export interface SystemServiceContext {
  settings: SystemSettings;
  integrations: IntegrationConfig[];
  backups: BackupRun[];
  restores: RestoreRun[];
  exports: DataExport[];
  exportFiles: Map<string, Buffer<ArrayBufferLike>>;
  templates: NotificationTemplate[];
  moderation: ModerationPolicy;
  audit: AuditEvent[];
  settingRevisions: SystemSettingRevision[];
  retentionPolicies: RetentionPolicyView[];
  retentionJobs: RetentionJobView[];
  legalHolds: LegalHoldView[];
  alerts: SystemAlertView[];
  prisma: PrismaService | undefined;
  emailDelivery: EmailDeliveryService | undefined;
  databaseBackup: DatabaseBackupService | undefined;
  objectStorage: ObjectStorageService | undefined;
  getSettings(): Promise<SystemSettings>;
  listSettingRevisions(): Promise<SystemSettingRevision[]>;
  updateSettings(
    input: Partial<Omit<SystemSettings, "updatedAt" | "version" | "updatedBy">>,
    actorId?: string,
  ): Promise<SystemSettings>;
  listIntegrations(): Promise<IntegrationConfig[]>;
  updateIntegration(
    integrationId: string,
    enabled: boolean,
    actorId?: string,
  ): Promise<IntegrationConfig>;
  configureIntegration(
    input: {
      provider: IntegrationConfig["provider"];
      credentialReference?: string;
      webhookUrl?: string;
    },
    actorId?: string,
  ): Promise<IntegrationConfig>;
  testIntegration(
    integrationId: string,
    actorId?: string,
  ): Promise<IntegrationConfig>;
  setDefaultIntegration(
    integrationId: string,
    actorId?: string,
  ): Promise<IntegrationConfig>;
  createTestMeeting(
    integrationId: string,
    actorId?: string,
  ): Promise<{ provider: string; attendeeUrl: string; expiresAt: string }>;
  listBackups(): Promise<BackupRun[]>;
  runBackup(type: BackupRun["type"], actorId?: string): Promise<BackupRun>;
  requestRestore(
    input: {
      backupId: string;
      mode: "DRILL" | "OPERATIONAL";
      reason: string;
      targetDatabase?: string;
    },
    actorId?: string,
  ): Promise<RestoreRun>;
  approveRestore(restoreId: string, approverId: string): Promise<RestoreRun>;
  restoreBackup(
    backupId: string,
    approvedBy: string,
    actorId?: string,
  ): Promise<RestoreRun>;
  listRestores(): Promise<RestoreRun[]>;
  previewRetention(categoryInput: string): Promise<RetentionPreview>;
  listRetentionPolicies(): Promise<RetentionPolicyView[]>;
  createRetentionPolicy(
    input: {
      category: string;
      retentionDays: number;
      action: "ARCHIVE" | "DELETE";
      approvedBy?: string;
      effectiveAt?: string;
    },
    actorId?: string,
  ): Promise<RetentionPolicyView>;
  createLegalHold(
    categoryInput: string,
    reasonInput: string,
    actorId?: string,
  ): Promise<object>;
  listLegalHolds(): Promise<LegalHoldView[]>;
  releaseLegalHold(
    holdId: string,
    reasonInput: string,
    actorId?: string,
  ): Promise<LegalHoldView>;
  runRetention(
    policyId: string,
    requestedBy: string,
  ): Promise<RetentionJobView>;
  approveRetention(
    jobId: string,
    approverId: string,
  ): Promise<RetentionJobView>;
  listRetentionJobs(): Promise<RetentionJobView[]>;
  previewRetentionPolicy(
    policy: Pick<RetentionPolicyView, "category" | "retentionDays" | "action">,
  ): Promise<RetentionPreview>;
  runExport(
    category: string,
    format: DataExport["format"],
    actorId?: string,
  ): Promise<DataExport>;
  drainOperationalJobs(limit?: number): Promise<{
    backup: number;
    export: number;
    retention: number;
  }>;
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
  downloadExport(
    exportId: string,
  ): Promise<{ buffer: Buffer; filename: string; mimeType: string }>;
  listExports(): Promise<DataExport[]>;
  listTemplates(): Promise<NotificationTemplate[]>;
  saveTemplate(
    input: Omit<
      NotificationTemplate,
      "id" | "version" | "status" | "updatedAt"
    >,
    actorId?: string,
  ): Promise<NotificationTemplate>;
  previewTemplate(
    templateId: string,
    variables: Record<string, string>,
  ): Promise<object>;
  renderPublishedNotification(
    eventCode: string,
    variables: Record<string, string>,
    fallbackTitle: string,
  ): Promise<string>;
  sendTemplateTest(
    templateId: string,
    recipient: string,
    variables: Record<string, string>,
    actorId?: string,
  ): Promise<TemplateTestDelivery>;
  getModerationPolicy(): Promise<ModerationPolicy>;
  updateModerationPolicy(
    input: Omit<ModerationPolicy, "version" | "updatedAt">,
    actorId?: string,
  ): Promise<ModerationPolicy>;
  listAudit(filter?: AuditFilter): Promise<AuditEvent[]>;
  healthOverview(): Promise<object>;
  listAlerts(): Promise<SystemAlertView[]>;
  updateAlert(
    alertId: string,
    action: "ACKNOWLEDGE" | "MUTE" | "RESOLVE",
    actorId?: string,
    muteMinutes?: number,
  ): Promise<SystemAlertView>;
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
  mapBackup(row: Prisma.BackupJobGetPayload<Record<string, never>>): BackupRun;
  mapRestore(
    row: Prisma.RestoreJobGetPayload<Record<string, never>>,
  ): RestoreRun;
  mapExport(
    row: Prisma.DataExportJobGetPayload<Record<string, never>>,
  ): DataExport;
  mapTemplate(
    row: Prisma.NotificationTemplateGetPayload<Record<string, never>>,
  ): NotificationTemplate;
  mapModeration(
    row: Prisma.ModerationPolicyGetPayload<Record<string, never>>,
  ): ModerationPolicy;
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
  snapshotAssetAudit(): Promise<SnapshotAssetAudit>;
  listStorageCleanupFailures(): Promise<StorageCleanupFailure[]>;
  retryStorageCleanup(
    attachmentId: string,
    actorId: string,
  ): Promise<{ cleaned: true }>;
  verifyRetentionArchive(
    jobId: string,
  ): Promise<{
    valid: true;
    category: string;
    recordCount: number;
    assetCount: number;
    checksum: string;
  }>;
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
  countExportRows(prisma: PrismaService, category: string): Promise<number>;
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
  extractTemplateVariables(value: string): string[];
  redactSensitive(value: string): string;
  isProvider(value: string): value is IntegrationConfig["provider"];
  log(actorId: string, action: string, target: string, detail: string): void;
}
