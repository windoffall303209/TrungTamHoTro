import { PrismaService } from "../../../database/prisma.service.js";
import type { Prisma } from "../../../generated/prisma/client.js";
import { DatabaseBackupService } from "../../../infrastructure/database-backup.service.js";
import { EmailDeliveryService } from "../../../infrastructure/email-delivery.service.js";
import { ObjectStorageService } from "../../../infrastructure/object-storage.service.js";
import type {
  AuditEvent,
  BackupRun,
  DataExport,
  IntegrationConfig,
  RestoreRun,
  StorageOverview,
  SystemSettings,
} from "./system.shared.js";

/** Hợp đồng nội bộ của các nhóm nghiệp vụ; trạng thái vẫn thuộc một phiên bản service duy nhất. */
export interface SystemServiceContext {
  settings: SystemSettings;
  readonly integrations: IntegrationConfig[];
  readonly backups: BackupRun[];
  readonly restores: RestoreRun[];
  readonly exports: DataExport[];
  readonly exportFiles: Map<string, Buffer<ArrayBufferLike>>;
  readonly audit: AuditEvent[];
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
  processQueuedBackup(prisma: PrismaService): Promise<boolean>;
  processQueuedExport(prisma: PrismaService): Promise<boolean>;
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
  jobLeaseExpiry(): Date;
  jobRetryAt(attempts: number): Date;
  jobError(error: unknown, fallback: string): string;
  getStorageOverview(): Promise<StorageOverview>;
  database(): PrismaService | undefined;
  mapSettings(
    value: Prisma.JsonValue,
    updatedAt: Date,
    version?: number,
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
  collectExportRows(
    prisma: PrismaService,
    category: string,
  ): Promise<Array<Record<string, unknown>>>;
  serializeExport(
    rows: Array<Record<string, unknown>>,
    format: DataExport["format"],
  ): Buffer;
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
