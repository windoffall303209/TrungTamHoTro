import { Injectable, Optional } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Readable } from "node:stream";
import type { ByteRange } from "../../../infrastructure/http-range-stream.js";
import type { Environment } from "../../../config/environment.js";
import type { PaginatedResult } from "../../../common/pagination.js";
import { PrismaService } from "../../../database/prisma.service.js";
import type { Prisma } from "../../../generated/prisma/client.js";
import { DatabaseBackupService } from "../../../infrastructure/database-backup.service.js";
import { EmailDeliveryService } from "../../../infrastructure/email-delivery.service.js";
import { ObjectStorageService } from "../../../infrastructure/object-storage.service.js";
import { asPrismaJsonRecord } from "../../../infrastructure/prisma-json.js";
import * as audit_ops from "../operations/monitoring/system-audit.js";
import * as monitoring_ops from "../operations/monitoring/system-monitoring.js";
import * as notifications_ops from "../operations/notifications/system-notifications.js";
import * as backups_ops from "../operations/retention/system-backups.js";
import * as settings_ops from "../operations/settings/system-settings.js";
import * as export_download_ops from "../operations/storage/system-export-download.js";
import * as export_format_ops from "../operations/storage/system-export-format.js";
import * as exports_ops from "../operations/storage/system-exports.js";
import * as integrations_ops from "../operations/integrations/system-integrations.js";
import * as mapping_ops from "../operations/core/system-mapping.js";
import * as storage_audit_ops from "../operations/storage/system-storage-audit.js";
import * as worker_ops from "../operations/workers/system-worker.js";
import type { SystemServiceContext } from "./system.context.js";
import {
  AuditEvent,
  AuditFilter,
  AuditPageFilter,
  BackupRun,
  DataExport,
  defaultSettings,
  IntegrationConfig,
  RestoreRun,
  SnapshotAssetAudit,
  StorageCleanupFailure,
  StorageOverview,
  SystemSettings,
} from "./system.shared.js";
export * from "./system.shared.js";

@Injectable()
/** Quản lý cấu hình và vận hành hệ thống, đồng thời hỗ trợ fallback in-memory khi DB bị tắt. */
export class SystemService {
  private static readonly MAINTENANCE_CACHE_MS = 5_000;

  private settings: SystemSettings = defaultSettings();

  private maintenanceCache?: { value: boolean; expiresAt: number };
  private maintenanceRead?: Promise<boolean>;

  private integrations: IntegrationConfig[] = [
    "GOOGLE_MEET",
    "ZOOM",
    "JITSI",
  ].map((provider, index) => ({
    id: `int-${index + 1}`,
    provider: provider as IntegrationConfig["provider"],
    enabled: provider === "JITSI",
    isDefault: provider === "JITSI",
    healthStatus: provider === "JITSI" ? "HEALTHY" : "UNKNOWN",
    maskedCredential: provider === "JITSI" ? "Không yêu cầu" : "Chưa cấu hình",
    webhookConfigured: false,
    lastCheckedAt: provider === "JITSI" ? new Date().toISOString() : undefined,
    updatedAt: new Date().toISOString(),
  }));

  private backups: BackupRun[] = [
    {
      id: "backup-seed",
      canRestore: false,
      type: "FULL",
      status: "COMPLETED",
      createdAt: new Date(Date.now() - 86_400_000).toISOString(),
      checksum: "sha256:9e151f",
      sizeMb: 18.4,
      attempts: 1,
      progress: 100,
    },
  ];

  private restores: RestoreRun[] = [];

  private exports: DataExport[] = [];

  private exportFiles = new Map<string, Buffer>();

  private audit: AuditEvent[] = [
    {
      id: "audit-seed",
      actor: "system",
      action: "SYSTEM_STARTED",
      target: "platform",
      detail: "Khởi tạo cấu hình vận hành.",
      createdAt: new Date().toISOString(),
    },
  ];

  constructor(
    @Optional() private readonly prisma?: PrismaService,
    @Optional() private readonly emailDelivery?: EmailDeliveryService,
    @Optional() private readonly databaseBackup?: DatabaseBackupService,
    @Optional() private readonly objectStorage?: ObjectStorageService,
    @Optional() private readonly config?: ConfigService<Environment, true>,
  ) {}

  private readonly operationContext: SystemServiceContext =
    SystemService.createOperationContext(this);

  /** Cấp quyền truy cập có kiểu cho thao tác nội bộ, giữ nguyên trạng thái và điểm chặn kiểm thử của service. */
  private static createOperationContext(
    owner: SystemService,
  ): SystemServiceContext {
    return {
      get settings(): SystemServiceContext["settings"] {
        return owner.settings;
      },
      set settings(value: SystemServiceContext["settings"]) {
        owner.settings = value;
      },
      get integrations(): SystemServiceContext["integrations"] {
        return owner.integrations;
      },
      get backups(): SystemServiceContext["backups"] {
        return owner.backups;
      },
      get restores(): SystemServiceContext["restores"] {
        return owner.restores;
      },
      get exports(): SystemServiceContext["exports"] {
        return owner.exports;
      },
      get exportFiles(): SystemServiceContext["exportFiles"] {
        return owner.exportFiles;
      },
      get audit(): SystemServiceContext["audit"] {
        return owner.audit;
      },
      get prisma(): SystemServiceContext["prisma"] {
        return owner.prisma;
      },
      get emailDelivery(): SystemServiceContext["emailDelivery"] {
        return owner.emailDelivery;
      },
      get databaseBackup(): SystemServiceContext["databaseBackup"] {
        return owner.databaseBackup;
      },
      get objectStorage(): SystemServiceContext["objectStorage"] {
        return owner.objectStorage;
      },
      getSettings: (...args) => owner.getSettings(...args),
      listIntegrations: (...args) => owner.listIntegrations(...args),
      requestRestore: (...args) => owner.requestRestore(...args),
      processQueuedBackup: (...args) => owner.processQueuedBackup(...args),
      processQueuedExport: (...args) => owner.processQueuedExport(...args),
      retryBackupJob: (...args) => owner.retryBackupJob(...args),
      retryExportJob: (...args) => owner.retryExportJob(...args),
      jobLeaseExpiry: (...args) => owner.jobLeaseExpiry(...args),
      jobRetryAt: (...args) => owner.jobRetryAt(...args),
      jobError: (...args) => owner.jobError(...args),
      getStorageOverview: (...args) => owner.getStorageOverview(...args),
      database: (...args) => owner.database(...args),
      mapSettings: (...args) => owner.mapSettings(...args),
      mapIntegration: (...args) => owner.mapIntegration(...args),
      encryptionSecret: () => owner.encryptionSecret(),
      mapBackup: (...args) => owner.mapBackup(...args),
      mapRestore: (...args) => owner.mapRestore(...args),
      mapExport: (...args) => owner.mapExport(...args),
      mapAudit: (...args) => owner.mapAudit(...args),
      collectExportRows: (...args) => owner.collectExportRows(...args),
      serializeExport: (...args) => owner.serializeExport(...args),
      logDatabase: (...args) => owner.logDatabase(...args),
      asRecord: asPrismaJsonRecord,
      stringValue: (...args) => owner.stringValue(...args),
      numberValue: (...args) => owner.numberValue(...args),
      booleanValue: (...args) => owner.booleanValue(...args),
      stringArray: (...args) => owner.stringArray(...args),
      redactSensitive: (...args) => owner.redactSensitive(...args),
      isProvider: (value: string): value is IntegrationConfig["provider"] =>
        owner.isProvider(value),
      log: (...args) => owner.log(...args),
    };
  }

  /** Đọc cấu hình hiện hành từ system_settings và áp dụng giá trị mặc định an toàn. */
  async getSettings(): Promise<SystemSettings> {
    return await settings_ops.getSettings(this.operationContext);
  }

  /**
   * Trả cờ bảo trì cho guard chạy trên mọi mutation với cache ngắn trong tiến trình.
   * Cập nhật cài đặt trên cùng tiến trình xóa cache ngay; tiến trình khác thấy thay đổi sau tối đa MAINTENANCE_CACHE_MS.
   */
  async isMaintenanceMode(): Promise<boolean> {
    if (this.maintenanceCache && this.maintenanceCache.expiresAt > Date.now()) return this.maintenanceCache.value;
    if (this.maintenanceRead) return this.maintenanceRead;
    const pending = this.getSettings().then((settings) => {
      // Cấu hình vừa được cập nhật: không trả hoặc cache kết quả của lượt đọc cũ.
      if (this.maintenanceRead !== pending) return this.isMaintenanceMode();
      const value = settings.maintenanceMode;
      this.maintenanceCache = { value, expiresAt: Date.now() + SystemService.MAINTENANCE_CACHE_MS };
      return value;
    }).finally(() => {
      if (this.maintenanceRead === pending) this.maintenanceRead = undefined;
    });
    this.maintenanceRead = pending;
    return pending;
  }

  /** Hợp nhất cấu hình, kiểm tra quota/múi giờ, lưu trực tiếp vào system_settings và ghi audit. */
  async updateSettings(
    input: Partial<Omit<SystemSettings, "updatedAt" | "version" | "updatedBy">>,
    actorId: string,
  ): Promise<SystemSettings> {
    try {
      return await settings_ops.updateSettings(
        this.operationContext,
        input,
        actorId,
      );
    } finally {
      this.maintenanceCache = undefined;
      this.maintenanceRead = undefined;
    }
  }

  /** Liệt kê provider phòng học đã cấu hình và trạng thái health. */
  async listIntegrations(): Promise<IntegrationConfig[]> {
    return await integrations_ops.listIntegrations(this.operationContext);
  }

  /** Bật/tắt tích hợp, không cho bật provider thiếu credential cần thiết và ghi audit. */
  async updateIntegration(
    integrationId: string,
    enabled: boolean,
    actorId: string,
  ): Promise<IntegrationConfig> {
    return await integrations_ops.updateIntegration(
      this.operationContext,
      integrationId,
      enabled,
      actorId,
    );
  }

  /** Tạo/cập nhật cấu hình provider bằng tham chiếu credential, không lưu secret thô. */
  async configureIntegration(
    input: {
      provider: IntegrationConfig["provider"];
      credentialReference?: string;
      webhookUrl?: string;
    },
    actorId: string,
  ): Promise<IntegrationConfig> {
    return await integrations_ops.configureIntegration(
      this.operationContext,
      input,
      actorId,
    );
  }

  /** Kiểm tra điều kiện kết nối và cập nhật trạng thái/lần kiểm tra của tích hợp. */
  async testIntegration(
    integrationId: string,
    actorId: string,
  ): Promise<IntegrationConfig> {
    return await integrations_ops.testIntegration(
      this.operationContext,
      integrationId,
      actorId,
    );
  }

  /** Đặt một provider enabled làm mặc định và gỡ cờ mặc định của các provider khác nguyên tử. */
  async setDefaultIntegration(
    integrationId: string,
    actorId: string,
  ): Promise<IntegrationConfig> {
    return await integrations_ops.setDefaultIntegration(
      this.operationContext,
      integrationId,
      actorId,
    );
  }

  /** Tạo URL phòng thử ngắn hạn sau khi integration vượt kiểm tra readiness. */
  async createTestMeeting(
    integrationId: string,
    actorId: string,
  ): Promise<{ provider: string; attendeeUrl: string; expiresAt: string }> {
    return await integrations_ops.createTestMeeting(
      this.operationContext,
      integrationId,
      actorId,
    );
  }

  /** Liệt kê các job sao lưu từ DB hoặc dữ liệu nhớ demo. */
  async listBackups(): Promise<BackupRun[]> {
    return await backups_ops.listBackups(this.operationContext);
  }

  /** Xếp sao lưu vào hàng đợi bền vững để request không phải chờ tác vụ nặng. */
  async runBackup(
    type: BackupRun["type"],
    actorId: string,
  ): Promise<BackupRun> {
    return await backups_ops.runBackup(this.operationContext, type, actorId);
  }

  /** Tạo yêu cầu drill hoặc khôi phục vận hành và để trạng thái chờ một quản trị viên khác phê duyệt. */
  async requestRestore(
    input: {
      backupId: string;
      mode: "DRILL" | "OPERATIONAL";
      reason: string;
      targetDatabase?: string;
    },
    actorId: string,
  ): Promise<RestoreRun> {
    return await backups_ops.requestRestore(
      this.operationContext,
      input,
      actorId,
    );
  }

  /** Xác thực người duyệt độc lập rồi chạy drill hoặc phục hồi vào database staging mới. */
  async approveRestore(
    restoreId: string,
    approverId: string,
  ): Promise<RestoreRun> {
    return await backups_ops.approveRestore(
      this.operationContext,
      restoreId,
      approverId,
    );
  }

  /** Giữ API service cũ ở dạng drill một bước chỉ để tương thích test không kết nối DB. */
  async restoreBackup(
    backupId: string,
    approvedBy: string,
    actorId: string,
  ): Promise<RestoreRun> {
    return await backups_ops.restoreBackup(
      this.operationContext,
      backupId,
      approvedBy,
      actorId,
    );
  }

  /** Liệt kê lịch sử kiểm tra phục hồi sao lưu. */
  async listRestores(): Promise<RestoreRun[]> {
    return await backups_ops.listRestores(this.operationContext);
  }

  /** Xếp export vào hàng đợi bền vững; worker mới tạo tệp và xác minh checksum. */
  async runExport(
    category: string,
    format: DataExport["format"],
    actorId: string,
  ): Promise<DataExport> {
    return await exports_ops.runExport(
      this.operationContext,
      category,
      format,
      actorId,
    );
  }

  /** Thu hồi lease hết hạn rồi xử lý một batch backup và export trên operational_jobs. */
  async drainOperationalJobs(limit = 6): Promise<{
    backup: number;
    export: number;
  }> {
    return await worker_ops.drainOperationalJobs(this.operationContext, limit);
  }

  /** Claim và hoàn tất một backup bằng lease nguyên tử; lỗi tạm thời được retry có backoff. */
  private async processQueuedBackup(prisma: PrismaService): Promise<boolean> {
    return await worker_ops.processQueuedBackup(this.operationContext, prisma);
  }

  /** Claim và tạo một export thật; chỉ COMPLETED sau khi đọc lại object và khớp checksum. */
  private async processQueuedExport(prisma: PrismaService): Promise<boolean> {
    return await worker_ops.processQueuedExport(this.operationContext, prisma);
  }

  /** Đặt lại backup để retry hoặc chuyển FAILED sau lần thử cuối. */
  private async retryBackupJob(
    prisma: PrismaService,
    idValue: string,
    attempts: number,
    error: unknown,
  ): Promise<void> {
    return await worker_ops.retryBackupJob(
      this.operationContext,
      prisma,
      idValue,
      attempts,
      error,
    );
  }

  /** Đặt lại export để retry hoặc chuyển FAILED sau lần thử cuối. */
  private async retryExportJob(
    prisma: PrismaService,
    idValue: string,
    attempts: number,
    error: unknown,
  ): Promise<void> {
    return await worker_ops.retryExportJob(
      this.operationContext,
      prisma,
      idValue,
      attempts,
      error,
    );
  }

  /** Tạo lease 10 phút để job RUNNING bị worker chết có thể được nhận lại. */
  private jobLeaseExpiry(): Date {
    return worker_ops.jobLeaseExpiry();
  }

  /** Tạo backoff lũy tiến tối đa một giờ cho lần retry tiếp theo. */
  private jobRetryAt(attempts: number): Date {
    return worker_ops.jobRetryAt(attempts);
  }

  /** Chuẩn hóa lỗi worker, giới hạn độ dài và không làm lộ stack hay credential. */
  private jobError(error: unknown, fallback: string): string {
    return worker_ops.jobError(error, fallback);
  }

  /** Đọc lại tệp export còn hạn và kiểm tra checksum ngay trước khi tải xuống. */
  async downloadExport(
    exportId: string,
    actorId: string,
  ): Promise<{ buffer: Buffer; filename: string; mimeType: string }> {
    return await export_download_ops.downloadExport(
      this.operationContext,
      exportId,
      actorId,
    );
  }

  /** Mở luồng tải tệp export còn hạn có hỗ trợ HTTP Range và xác minh checksum theo stream. */
  async downloadExportStream(
    exportId: string,
    actorId: string,
    rangeHeader?: string,
  ): Promise<{
    stream: Readable;
    totalSize: number;
    range?: ByteRange;
    filename: string;
    mimeType: string;
  }> {
    return await export_download_ops.downloadExportStream(
      this.operationContext,
      exportId,
      actorId,
      rangeHeader,
    );
  }

  /** Liệt kê các lần xuất dữ liệu hệ thống. */
  async listExports(): Promise<DataExport[]> {
    return await export_download_ops.listExports(this.operationContext);
  }

  /** Render mẫu PUBLISHED mới nhất cho runtime; dùng tiêu đề fallback nếu thiếu mẫu hoặc biến. */
  async renderPublishedNotification(
    eventCode: string,
    variables: Record<string, string>,
    fallbackTitle: string,
  ): Promise<string> {
    return await notifications_ops.renderPublishedNotification(
      this.operationContext,
      eventCode,
      variables,
      fallbackTitle,
    );
  }

  /** Lọc audit theo nhiều tiêu chí và che token/secret trong phần detail trước khi trả. */
  async listAudit(filter: AuditFilter = {}): Promise<AuditEvent[]> {
    return await monitoring_ops.listAudit(this.operationContext, filter);
  }

  /** Phân trang nhật ký audit trực tiếp ở DB kèm lọc từ khóa và khoảng thời gian. */
  async listAuditPage(
    filter: AuditPageFilter = {},
  ): Promise<PaginatedResult<AuditEvent>> {
    return await monitoring_ops.listAuditPage(this.operationContext, filter);
  }

  /** Tổng hợp sức khỏe DB, độ trễ API, dung lượng lưu trữ và hàng đợi operational_jobs. */
  async healthOverview(): Promise<object> {
    return await monitoring_ops.healthOverview(this.operationContext);
  }

  /** Tổng hợp byte lưu trữ theo lớp và so sánh với quota hệ thống. */
  async getStorageOverview(): Promise<StorageOverview> {
    return await monitoring_ops.getStorageOverview(this.operationContext);
  }

  /** Chọn Prisma khi DB được bật, nếu không dùng state in-memory của service. */
  private database(): PrismaService | undefined {
    return mapping_ops.database(this.operationContext);
  }

  /** Thu hẹp JSON cấu hình theo từng kiểu và áp dụng giá trị mặc định an toàn. */
  private mapSettings(
    value: Prisma.JsonValue,
    updatedAt: Date,
    version = 1,
    updatedBy = "system",
  ): SystemSettings {
    return mapping_ops.mapSettings(
      this.operationContext,
      value,
      updatedAt,
      version,
      updatedBy,
    );
  }

  /** Khóa chủ dùng để mã hóa tham chiếu credential tích hợp bằng SecretVault. */
  private encryptionSecret(): string {
    return this.config?.get("AUTH_ENCRYPTION_SECRET", { infer: true }) ?? "development-auth-encryption-key-change-me";
  }

  /** Ánh xạ integration Prisma và xác minh provider thuộc danh mục hỗ trợ. */
  private mapIntegration(
    row: Prisma.IntegrationProviderGetPayload<Record<string, never>>,
  ): IntegrationConfig {
    return mapping_ops.mapIntegration(this.operationContext, row);
  }

  /** Ánh xạ job sao lưu, bao gồm metadata và thông tin lỗi đã lưu. */
  private mapBackup(
    row: Prisma.OperationalJobGetPayload<Record<string, never>>,
  ): BackupRun {
    return mapping_ops.mapBackup(row);
  }

  /** Ánh xạ yêu cầu phục hồi, loại thao tác và dấu vết hai người. */
  private mapRestore(
    row: Prisma.OperationalJobGetPayload<Record<string, never>>,
  ): RestoreRun {
    return mapping_ops.mapRestore(row);
  }

  /** Ánh xạ job xuất dữ liệu và URL/checksum khi hoàn thành. */
  private mapExport(
    row: Prisma.OperationalJobGetPayload<Record<string, never>>,
  ): DataExport {
    return mapping_ops.mapExport(row);
  }

  /** Ánh xạ audit log và che chuỗi nhạy cảm trong detail. */
  private mapAudit(
    row: Prisma.AuditLogGetPayload<Record<string, never>>,
  ): AuditEvent {
    return mapping_ops.mapAudit(this.operationContext, row);
  }

  /** Đối soát snapshot lớp và mọi object reference để migration không tự sửa hoặc xóa dữ liệu mơ hồ. */
  async snapshotAssetAudit(): Promise<SnapshotAssetAudit> {
    return await storage_audit_ops.snapshotAssetAudit(this.operationContext);
  }

  /** Liệt kê metadata đã xóa mềm nhưng object cleanup thất bại để vận hành có thể retry. */
  async listStorageCleanupFailures(): Promise<StorageCleanupFailure[]> {
    return await storage_audit_ops.listStorageCleanupFailures(
      this.operationContext,
    );
  }

  /** Retry xóa đúng object đã được ghi lỗi và chỉ xóa cờ lỗi sau khi storage xác nhận thành công. */
  async retryStorageCleanup(
    attachmentId: string,
    actorId: string,
  ): Promise<{ cleaned: true }> {
    return await storage_audit_ops.retryStorageCleanup(
      this.operationContext,
      attachmentId,
      actorId,
    );
  }

  /** Thu thập từng dòng export với nhãn thực thể để CSV và JSON cùng một phạm vi. */
  private async collectExportRows(
    prisma: PrismaService,
    category: string,
  ): Promise<Array<Record<string, unknown>>> {
    return await export_format_ops.collectExportRows(prisma, category);
  }

  /** Tuần tự hóa export thành JSON hoặc CSV có BOM và escape đúng chuẩn bảng tính. */
  private serializeExport(
    rows: Array<Record<string, unknown>>,
    format: DataExport["format"],
  ): Buffer {
    return export_format_ops.serializeExport(rows, format);
  }

  /** Ghi audit vào DB và che dữ liệu nhạy cảm trước khi lưu. */
  private async logDatabase(
    database: PrismaService | Prisma.TransactionClient,
    actorId: string,
    action: string,
    target: string,
    detail: string,
  ): Promise<void> {
    return await audit_ops.logDatabase(
      database,
      actorId,
      action,
      target,
      detail,
    );
  }

  /** Đọc chuỗi từ JSON hoặc dùng fallback. */
  private stringValue(value: unknown, fallback: string): string {
    return audit_ops.stringValue(value, fallback);
  }

  /** Đọc số hữu hạn từ JSON hoặc dùng fallback. */
  private numberValue(value: unknown, fallback: number): number {
    return audit_ops.numberValue(value, fallback);
  }

  /** Đọc boolean từ JSON hoặc dùng fallback. */
  private booleanValue(value: unknown, fallback: boolean): boolean {
    return audit_ops.booleanValue(value, fallback);
  }

  /** Đọc mảng chuỗi từ JSON và sao chép fallback để tránh mutation. */
  private stringArray(value: unknown, fallback: string[]): string[] {
    return audit_ops.stringArray(value, fallback);
  }

  /** Che giá trị password/token/secret/credential trong chuỗi audit. */
  private redactSensitive(value: string): string {
    return audit_ops.redactSensitive(value);
  }

  /** Type guard cho danh mục provider phòng học được hỗ trợ. */
  private isProvider(value: string): value is IntegrationConfig["provider"] {
    return audit_ops.isProvider(value);
  }

  /** Ghi audit vào đầu state in-memory cho chế độ không kết nối DB. */
  private log(
    actorId: string,
    action: string,
    target: string,
    detail: string,
  ): void {
    return audit_ops.log(
      this.operationContext,
      actorId,
      action,
      target,
      detail,
    );
  }
}
