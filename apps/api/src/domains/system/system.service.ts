import { Injectable, Optional } from "@nestjs/common";
import { PrismaService } from "../../database/prisma.service.js";
import type { Prisma } from "../../generated/prisma/client.js";
import { DatabaseBackupService } from "../../infrastructure/database-backup.service.js";
import { EmailDeliveryService } from "../../infrastructure/email-delivery.service.js";
import { ObjectStorageService } from "../../infrastructure/object-storage.service.js";
import * as audit_ops from "./operations/system-audit.js";
import * as backups_ops from "./operations/system-backups.js";
import * as export_download_ops from "./operations/system-export-download.js";
import * as export_format_ops from "./operations/system-export-format.js";
import * as exports_ops from "./operations/system-exports.js";
import * as integrations_ops from "./operations/system-integrations.js";
import * as mapping_ops from "./operations/system-mapping.js";
import * as moderation_ops from "./operations/system-moderation.js";
import * as monitoring_ops from "./operations/system-monitoring.js";
import * as notifications_ops from "./operations/system-notifications.js";
import * as retention_execution_ops from "./operations/system-retention-execution.js";
import * as retention_ops from "./operations/system-retention.js";
import * as settings_ops from "./operations/system-settings.js";
import * as storage_audit_ops from "./operations/system-storage-audit.js";
import * as worker_ops from "./operations/system-worker.js";
import type { SystemServiceContext } from "./system.context.js";
import {
  AuditEvent,
  AuditFilter,
  BackupRun,
  DataExport,
  defaultSettings,
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
export * from "./system.shared.js";

@Injectable()
/** Quản lý cấu hình và vận hành hệ thống, đồng thời hỗ trợ fallback in-memory khi DB bị tắt. */
export class SystemService {
  private settings: SystemSettings = defaultSettings();

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

  private templates: NotificationTemplate[] = [
    {
      id: "tpl-class-reminder",
      eventCode: "CLASS_REMINDER",
      locale: "vi-VN",
      subject: "Nhắc lịch học {{className}}",
      body: "Buổi học {{sessionTitle}} bắt đầu lúc {{startsAt}}.",
      version: 1,
      status: "PUBLISHED",
      updatedAt: new Date().toISOString(),
    },
  ];

  private moderation: ModerationPolicy = {
    version: 1,
    prohibitedTerms: ["spam", "lừa đảo"],
    maxPostsPerMinute: 5,
    action: "FLAG",
    updatedAt: new Date().toISOString(),
  };

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

  private settingRevisions: SystemSettingRevision[] = [
    { id: "setting-revision-1", key: "platform", ...defaultSettings() },
  ];

  private retentionPolicies: RetentionPolicyView[] = [];

  private retentionJobs: RetentionJobView[] = [];

  private legalHolds: LegalHoldView[] = [];

  private alerts: SystemAlertView[] = [];

  constructor(
    @Optional() private readonly prisma?: PrismaService,
    @Optional() private readonly emailDelivery?: EmailDeliveryService,
    @Optional() private readonly databaseBackup?: DatabaseBackupService,
    @Optional() private readonly objectStorage?: ObjectStorageService,
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
      set integrations(value: SystemServiceContext["integrations"]) {
        owner.integrations = value;
      },
      get backups(): SystemServiceContext["backups"] {
        return owner.backups;
      },
      set backups(value: SystemServiceContext["backups"]) {
        owner.backups = value;
      },
      get restores(): SystemServiceContext["restores"] {
        return owner.restores;
      },
      set restores(value: SystemServiceContext["restores"]) {
        owner.restores = value;
      },
      get exports(): SystemServiceContext["exports"] {
        return owner.exports;
      },
      set exports(value: SystemServiceContext["exports"]) {
        owner.exports = value;
      },
      get exportFiles(): SystemServiceContext["exportFiles"] {
        return owner.exportFiles;
      },
      set exportFiles(value: SystemServiceContext["exportFiles"]) {
        owner.exportFiles = value;
      },
      get templates(): SystemServiceContext["templates"] {
        return owner.templates;
      },
      set templates(value: SystemServiceContext["templates"]) {
        owner.templates = value;
      },
      get moderation(): SystemServiceContext["moderation"] {
        return owner.moderation;
      },
      set moderation(value: SystemServiceContext["moderation"]) {
        owner.moderation = value;
      },
      get audit(): SystemServiceContext["audit"] {
        return owner.audit;
      },
      set audit(value: SystemServiceContext["audit"]) {
        owner.audit = value;
      },
      get settingRevisions(): SystemServiceContext["settingRevisions"] {
        return owner.settingRevisions;
      },
      set settingRevisions(value: SystemServiceContext["settingRevisions"]) {
        owner.settingRevisions = value;
      },
      get retentionPolicies(): SystemServiceContext["retentionPolicies"] {
        return owner.retentionPolicies;
      },
      set retentionPolicies(value: SystemServiceContext["retentionPolicies"]) {
        owner.retentionPolicies = value;
      },
      get retentionJobs(): SystemServiceContext["retentionJobs"] {
        return owner.retentionJobs;
      },
      set retentionJobs(value: SystemServiceContext["retentionJobs"]) {
        owner.retentionJobs = value;
      },
      get legalHolds(): SystemServiceContext["legalHolds"] {
        return owner.legalHolds;
      },
      set legalHolds(value: SystemServiceContext["legalHolds"]) {
        owner.legalHolds = value;
      },
      get alerts(): SystemServiceContext["alerts"] {
        return owner.alerts;
      },
      set alerts(value: SystemServiceContext["alerts"]) {
        owner.alerts = value;
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
      listSettingRevisions: (...args) => owner.listSettingRevisions(...args),
      updateSettings: (...args) => owner.updateSettings(...args),
      listIntegrations: (...args) => owner.listIntegrations(...args),
      updateIntegration: (...args) => owner.updateIntegration(...args),
      configureIntegration: (...args) => owner.configureIntegration(...args),
      testIntegration: (...args) => owner.testIntegration(...args),
      setDefaultIntegration: (...args) => owner.setDefaultIntegration(...args),
      createTestMeeting: (...args) => owner.createTestMeeting(...args),
      listBackups: (...args) => owner.listBackups(...args),
      runBackup: (...args) => owner.runBackup(...args),
      requestRestore: (...args) => owner.requestRestore(...args),
      approveRestore: (...args) => owner.approveRestore(...args),
      restoreBackup: (...args) => owner.restoreBackup(...args),
      listRestores: (...args) => owner.listRestores(...args),
      previewRetention: (...args) => owner.previewRetention(...args),
      listRetentionPolicies: (...args) => owner.listRetentionPolicies(...args),
      createRetentionPolicy: (...args) => owner.createRetentionPolicy(...args),
      createLegalHold: (...args) => owner.createLegalHold(...args),
      listLegalHolds: (...args) => owner.listLegalHolds(...args),
      releaseLegalHold: (...args) => owner.releaseLegalHold(...args),
      runRetention: (...args) => owner.runRetention(...args),
      approveRetention: (...args) => owner.approveRetention(...args),
      listRetentionJobs: (...args) => owner.listRetentionJobs(...args),
      previewRetentionPolicy: (...args) =>
        owner.previewRetentionPolicy(...args),
      runExport: (...args) => owner.runExport(...args),
      drainOperationalJobs: (...args) => owner.drainOperationalJobs(...args),
      processQueuedBackup: (...args) => owner.processQueuedBackup(...args),
      processQueuedExport: (...args) => owner.processQueuedExport(...args),
      processQueuedRetention: (...args) =>
        owner.processQueuedRetention(...args),
      retryBackupJob: (...args) => owner.retryBackupJob(...args),
      retryExportJob: (...args) => owner.retryExportJob(...args),
      retryRetentionJob: (...args) => owner.retryRetentionJob(...args),
      jobLeaseExpiry: (...args) => owner.jobLeaseExpiry(...args),
      jobRetryAt: (...args) => owner.jobRetryAt(...args),
      jobError: (...args) => owner.jobError(...args),
      downloadExport: (...args) => owner.downloadExport(...args),
      listExports: (...args) => owner.listExports(...args),
      listTemplates: (...args) => owner.listTemplates(...args),
      saveTemplate: (...args) => owner.saveTemplate(...args),
      previewTemplate: (...args) => owner.previewTemplate(...args),
      renderPublishedNotification: (...args) =>
        owner.renderPublishedNotification(...args),
      sendTemplateTest: (...args) => owner.sendTemplateTest(...args),
      getModerationPolicy: (...args) => owner.getModerationPolicy(...args),
      updateModerationPolicy: (...args) =>
        owner.updateModerationPolicy(...args),
      listAudit: (...args) => owner.listAudit(...args),
      healthOverview: (...args) => owner.healthOverview(...args),
      listAlerts: (...args) => owner.listAlerts(...args),
      updateAlert: (...args) => owner.updateAlert(...args),
      getStorageOverview: (...args) => owner.getStorageOverview(...args),
      database: (...args) => owner.database(...args),
      mapSettings: (...args) => owner.mapSettings(...args),
      mapIntegration: (...args) => owner.mapIntegration(...args),
      mapBackup: (...args) => owner.mapBackup(...args),
      mapRestore: (...args) => owner.mapRestore(...args),
      mapExport: (...args) => owner.mapExport(...args),
      mapTemplate: (...args) => owner.mapTemplate(...args),
      mapModeration: (...args) => owner.mapModeration(...args),
      mapAudit: (...args) => owner.mapAudit(...args),
      mapRetentionPolicy: (...args) => owner.mapRetentionPolicy(...args),
      mapRetentionJob: (...args) => owner.mapRetentionJob(...args),
      mapAlert: (...args) => owner.mapAlert(...args),
      getLatestRetentionPolicy: (...args) =>
        owner.getLatestRetentionPolicy(...args),
      countRetentionRows: (...args) => owner.countRetentionRows(...args),
      executeRetention: (...args) => owner.executeRetention(...args),
      aiResultSettings: (...args) => owner.aiResultSettings(...args),
      retentionCategory: (...args) => owner.retentionCategory(...args),
      snapshotAssetAudit: (...args) => owner.snapshotAssetAudit(...args),
      listStorageCleanupFailures: (...args) =>
        owner.listStorageCleanupFailures(...args),
      retryStorageCleanup: (...args) => owner.retryStorageCleanup(...args),
      verifyRetentionArchive: (...args) =>
        owner.verifyRetentionArchive(...args),
      validateRetentionArchive: (...args) =>
        owner.validateRetentionArchive(...args),
      collectExportRows: (...args) => owner.collectExportRows(...args),
      serializeExport: (...args) => owner.serializeExport(...args),
      recordAlert: (...args) => owner.recordAlert(...args),
      recoverAlert: (...args) => owner.recoverAlert(...args),
      countExportRows: (...args) => owner.countExportRows(...args),
      logDatabase: (...args) => owner.logDatabase(...args),
      asRecord: (...args) => owner.asRecord(...args),
      stringValue: (...args) => owner.stringValue(...args),
      numberValue: (...args) => owner.numberValue(...args),
      booleanValue: (...args) => owner.booleanValue(...args),
      stringArray: (...args) => owner.stringArray(...args),
      extractTemplateVariables: (...args) =>
        owner.extractTemplateVariables(...args),
      redactSensitive: (...args) => owner.redactSensitive(...args),
      isProvider: (value: string): value is IntegrationConfig["provider"] =>
        owner.isProvider(value),
      log: (...args) => owner.log(...args),
    };
  }

  /** Đọc cấu hình mới nhất và áp dụng schema/mặc định qua mapSettings. */
  async getSettings(): Promise<SystemSettings> {
    return await settings_ops.getSettings(this.operationContext);
  }

  /** Liệt kê lịch sử revision cấu hình theo version mới nhất trước. */
  async listSettingRevisions(): Promise<SystemSettingRevision[]> {
    return await settings_ops.listSettingRevisions(this.operationContext);
  }

  /** Hợp nhất cấu hình, kiểm tra quota/MIME/thời điểm hiệu lực, tăng version và ghi audit. */
  async updateSettings(
    input: Partial<Omit<SystemSettings, "updatedAt" | "version" | "updatedBy">>,
    actorId = "usr-admin",
  ): Promise<SystemSettings> {
    return await settings_ops.updateSettings(
      this.operationContext,
      input,
      actorId,
    );
  }

  /** Liệt kê provider phòng học đã cấu hình và trạng thái health. */
  async listIntegrations(): Promise<IntegrationConfig[]> {
    return await integrations_ops.listIntegrations(this.operationContext);
  }

  /** Bật/tắt tích hợp, không cho bật provider thiếu credential cần thiết và ghi audit. */
  async updateIntegration(
    integrationId: string,
    enabled: boolean,
    actorId = "usr-admin",
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
    actorId = "usr-admin",
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
    actorId = "usr-admin",
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
    actorId = "usr-admin",
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
    actorId = "usr-admin",
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
    actorId = "usr-admin",
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
    actorId = "usr-admin",
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
    actorId = "usr-admin",
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

  /** Tính cutoff và số bản ghi sẽ tác động, đồng thời phản ánh legal hold hiện tại. */
  async previewRetention(categoryInput: string): Promise<RetentionPreview> {
    return await retention_ops.previewRetention(
      this.operationContext,
      categoryInput,
    );
  }

  /** Liệt kê mọi phiên bản chính sách lưu giữ. */
  async listRetentionPolicies(): Promise<RetentionPolicyView[]> {
    return await retention_ops.listRetentionPolicies(this.operationContext);
  }

  /** Validate phê duyệt/ngày hiệu lực, tạo version kế tiếp và ghi audit chính sách. */
  async createRetentionPolicy(
    input: {
      category: string;
      retentionDays: number;
      action: "ARCHIVE" | "DELETE";
      approvedBy?: string;
      effectiveAt?: string;
    },
    actorId = "usr-admin",
  ): Promise<RetentionPolicyView> {
    return await retention_ops.createRetentionPolicy(
      this.operationContext,
      input,
      actorId,
    );
  }

  /** Đặt legal hold đang hoạt động cho danh mục để chặn retention job. */
  async createLegalHold(
    categoryInput: string,
    reasonInput: string,
    actorId = "usr-admin",
  ): Promise<object> {
    return await retention_ops.createLegalHold(
      this.operationContext,
      categoryInput,
      reasonInput,
      actorId,
    );
  }

  /** Liệt kê legal hold cùng trạng thái giải tỏa và người thực hiện. */
  async listLegalHolds(): Promise<LegalHoldView[]> {
    return await retention_ops.listLegalHolds(this.operationContext);
  }

  /** Giải tỏa đúng một hold, giữ các hold khác và lưu lý do vào audit. */
  async releaseLegalHold(
    holdId: string,
    reasonInput: string,
    actorId = "usr-admin",
  ): Promise<LegalHoldView> {
    return await retention_ops.releaseLegalHold(
      this.operationContext,
      holdId,
      reasonInput,
      actorId,
    );
  }

  /** Tạo yêu cầu chờ duyệt; danh tính người yêu cầu luôn lấy từ phiên đã xác thực. */
  async runRetention(
    policyId: string,
    requestedBy: string,
  ): Promise<RetentionJobView> {
    return await retention_ops.runRetention(
      this.operationContext,
      policyId,
      requestedBy,
    );
  }

  /** Phê duyệt nguyên tử bằng danh tính phiên độc lập, không nhận tên người duyệt từ body. */
  async approveRetention(
    jobId: string,
    approverId: string,
  ): Promise<RetentionJobView> {
    return await retention_ops.approveRetention(
      this.operationContext,
      jobId,
      approverId,
    );
  }

  /** Liệt kê các lần chạy retention cùng số bản ghi đã xử lý. */
  async listRetentionJobs(): Promise<RetentionJobView[]> {
    return await retention_ops.listRetentionJobs(this.operationContext);
  }

  /** Tạo snapshot preview từ đúng một policy thay vì trộn với phiên bản mới nhất. */
  private async previewRetentionPolicy(
    policy: Pick<RetentionPolicyView, "category" | "retentionDays" | "action">,
  ): Promise<RetentionPreview> {
    return await retention_ops.previewRetentionPolicy(
      this.operationContext,
      policy,
    );
  }

  /** Xếp export vào hàng đợi bền vững; worker mới tạo tệp và xác minh checksum. */
  async runExport(
    category: string,
    format: DataExport["format"],
    actorId = "usr-admin",
  ): Promise<DataExport> {
    return await exports_ops.runExport(
      this.operationContext,
      category,
      format,
      actorId,
    );
  }

  /** Thu hồi lease hết hạn rồi xử lý một batch backup, export và retention theo hàng đợi DB. */
  async drainOperationalJobs(limit = 6): Promise<{
    backup: number;
    export: number;
    retention: number;
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

  /** Claim retention theo policy đã ghim, kiểm tra lại legal hold rồi mới archive/delete. */
  private async processQueuedRetention(
    prisma: PrismaService,
  ): Promise<boolean> {
    return await worker_ops.processQueuedRetention(
      this.operationContext,
      prisma,
    );
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

  /** Đặt lại retention để retry hoặc chuyển FAILED, giữ snapshot và lỗi gần nhất trong evidence. */
  private async retryRetentionJob(
    prisma: PrismaService,
    idValue: string,
    attempts: number,
    evidence: Record<string, unknown>,
    error: unknown,
  ): Promise<void> {
    return await worker_ops.retryRetentionJob(
      this.operationContext,
      prisma,
      idValue,
      attempts,
      evidence,
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
  ): Promise<{ buffer: Buffer; filename: string; mimeType: string }> {
    return await export_download_ops.downloadExport(
      this.operationContext,
      exportId,
    );
  }

  /** Liệt kê các lần xuất dữ liệu hệ thống. */
  async listExports(): Promise<DataExport[]> {
    return await export_download_ops.listExports(this.operationContext);
  }

  /** Liệt kê phiên bản mẫu thông báo và trạng thái hiện hành. */
  async listTemplates(): Promise<NotificationTemplate[]> {
    return await notifications_ops.listTemplates(this.operationContext);
  }

  /** Validate biến mẫu, tạo version mới và ngừng dùng version trước cùng event/locale. */
  async saveTemplate(
    input: Omit<
      NotificationTemplate,
      "id" | "version" | "status" | "updatedAt"
    >,
    actorId = "usr-admin",
  ): Promise<NotificationTemplate> {
    return await notifications_ops.saveTemplate(
      this.operationContext,
      input,
      actorId,
    );
  }

  /** Thay thế placeholder bằng dữ liệu thử và báo các biến còn thiếu. */
  async previewTemplate(
    templateId: string,
    variables: Record<string, string>,
  ): Promise<object> {
    return await notifications_ops.previewTemplate(
      this.operationContext,
      templateId,
      variables,
    );
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

  /** Render và gửi email thử, lưu kết quả giao hàng cùng actor nhưng không lưu nội dung nhạy cảm. */
  async sendTemplateTest(
    templateId: string,
    recipient: string,
    variables: Record<string, string>,
    actorId = "usr-admin",
  ): Promise<TemplateTestDelivery> {
    return await notifications_ops.sendTemplateTest(
      this.operationContext,
      templateId,
      recipient,
      variables,
      actorId,
    );
  }

  /** Đọc chính sách kiểm duyệt mới nhất hoặc cấu hình mặc định. */
  async getModerationPolicy(): Promise<ModerationPolicy> {
    return await moderation_ops.getModerationPolicy(this.operationContext);
  }

  /** Chuẩn hóa từ cấm, kiểm tra rate limit và tạo version chính sách mới. */
  async updateModerationPolicy(
    input: Omit<ModerationPolicy, "version" | "updatedAt">,
    actorId = "usr-admin",
  ): Promise<ModerationPolicy> {
    return await moderation_ops.updateModerationPolicy(
      this.operationContext,
      input,
      actorId,
    );
  }

  /** Lọc audit theo nhiều tiêu chí và che token/secret trong phần detail trước khi trả. */
  async listAudit(filter: AuditFilter = {}): Promise<AuditEvent[]> {
    return await monitoring_ops.listAudit(this.operationContext, filter);
  }

  /** Tổng hợp health DB/integration/storage và tạo hoặc phục hồi cảnh báo theo ngưỡng. */
  async healthOverview(): Promise<object> {
    return await monitoring_ops.healthOverview(this.operationContext);
  }

  /** Liệt kê cảnh báo hệ thống mới nhất trước. */
  async listAlerts(): Promise<SystemAlertView[]> {
    return await monitoring_ops.listAlerts(this.operationContext);
  }

  /** Áp dụng thao tác vận hành lên cảnh báo và ghi nhận actor/thời hạn mute. */
  async updateAlert(
    alertId: string,
    action: "ACKNOWLEDGE" | "MUTE" | "RESOLVE",
    actorId = "usr-admin",
    muteMinutes = 60,
  ): Promise<SystemAlertView> {
    return await monitoring_ops.updateAlert(
      this.operationContext,
      alertId,
      action,
      actorId,
      muteMinutes,
    );
  }

  /** Tổng hợp byte lưu trữ theo MIME, so sánh quota và phát cảnh báo khi gần đầy. */
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
    effectiveAt = updatedAt,
    updatedBy = "system",
  ): SystemSettings {
    return mapping_ops.mapSettings(
      this.operationContext,
      value,
      updatedAt,
      version,
      effectiveAt,
      updatedBy,
    );
  }

  /** Ánh xạ integration Prisma và xác minh provider thuộc danh mục hỗ trợ. */
  private mapIntegration(
    row: Prisma.IntegrationProviderGetPayload<Record<string, never>>,
  ): IntegrationConfig {
    return mapping_ops.mapIntegration(this.operationContext, row);
  }

  /** Ánh xạ job sao lưu, bao gồm metadata và thông tin lỗi đã lưu. */
  private mapBackup(
    row: Prisma.BackupJobGetPayload<Record<string, never>>,
  ): BackupRun {
    return mapping_ops.mapBackup(row);
  }

  /** Ánh xạ yêu cầu phục hồi, loại thao tác và dấu vết hai người. */
  private mapRestore(
    row: Prisma.RestoreJobGetPayload<Record<string, never>>,
  ): RestoreRun {
    return mapping_ops.mapRestore(row);
  }

  /** Ánh xạ job xuất dữ liệu và URL/checksum khi hoàn thành. */
  private mapExport(
    row: Prisma.DataExportJobGetPayload<Record<string, never>>,
  ): DataExport {
    return mapping_ops.mapExport(row);
  }

  /** Ánh xạ mẫu thông báo Prisma sang hợp đồng quản trị. */
  private mapTemplate(
    row: Prisma.NotificationTemplateGetPayload<Record<string, never>>,
  ): NotificationTemplate {
    return mapping_ops.mapTemplate(row);
  }

  /** Ánh xạ JSON từ cấm và tham số kiểm duyệt sang policy. */
  private mapModeration(
    row: Prisma.ModerationPolicyGetPayload<Record<string, never>>,
  ): ModerationPolicy {
    return mapping_ops.mapModeration(this.operationContext, row);
  }

  /** Ánh xạ audit log và che chuỗi nhạy cảm trong detail. */
  private mapAudit(
    row: Prisma.AuditLogGetPayload<Record<string, never>>,
  ): AuditEvent {
    return mapping_ops.mapAudit(this.operationContext, row);
  }

  /** Ánh xạ chính sách lưu giữ và mốc hiệu lực sang view model. */
  private mapRetentionPolicy(
    row: Prisma.RetentionPolicyGetPayload<Record<string, never>>,
  ): RetentionPolicyView {
    return mapping_ops.mapRetentionPolicy(row);
  }

  /** Ánh xạ job retention cùng số bản ghi xử lý và lỗi. */
  private mapRetentionJob(
    row: Prisma.RetentionJobGetPayload<Record<string, never>>,
  ): RetentionJobView {
    return mapping_ops.mapRetentionJob(this.operationContext, row);
  }

  /** Ánh xạ cảnh báo và các mốc acknowledge/mute/resolve. */
  private mapAlert(
    row: Prisma.SystemAlertGetPayload<Record<string, never>>,
  ): SystemAlertView {
    return mapping_ops.mapAlert(row);
  }

  /** Lấy policy đã có hiệu lực mới nhất cho danh mục. */
  private async getLatestRetentionPolicy(
    category: string,
  ): Promise<RetentionPolicyView | undefined> {
    return await retention_execution_ops.getLatestRetentionPolicy(
      this.operationContext,
      category,
    );
  }

  /** Đếm bản ghi cũ hơn cutoff theo danh mục trước khi chạy retention. */
  private async countRetentionRows(
    prisma: PrismaService,
    category: string,
    cutoffAt: Date,
  ): Promise<number> {
    return await retention_execution_ops.countRetentionRows(
      this.operationContext,
      prisma,
      category,
      cutoffAt,
    );
  }

  /** Thực thi archive/delete theo category trong transaction và trả số dòng ảnh hưởng. */
  private async executeRetention(
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
  }> {
    return await retention_execution_ops.executeRetention(
      this.operationContext,
      prisma,
      category,
      action,
      cutoffAt,
      jobId,
      assertOwned,
      claim,
    );
  }

  /** Lấy riêng cache OCR/hỏi đáp READY quá hạn; claim đang chạy hoặc chưa rõ kết quả luôn được giữ lại để đối soát. */
  private async aiResultSettings(
    prisma: PrismaService,
    cutoffAt: Date,
  ): Promise<Array<Prisma.SystemSettingGetPayload<Record<string, never>>>> {
    return await retention_execution_ops.aiResultSettings(prisma, cutoffAt);
  }

  /** Chuẩn hóa danh mục retention và chặn policy không có executor tương ứng. */
  private retentionCategory(value: string): RetentionCategory {
    return retention_execution_ops.retentionCategory(value);
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

  /** Đọc archive của retention job và xác minh checksum gói cùng từng asset phục hồi được. */
  async verifyRetentionArchive(
    jobId: string,
  ): Promise<{
    valid: true;
    category: string;
    recordCount: number;
    assetCount: number;
    checksum: string;
  }> {
    return await storage_audit_ops.verifyRetentionArchive(
      this.operationContext,
      jobId,
    );
  }

  /** Parse archive version 2 và kiểm tra checksum/size của toàn bộ asset nhúng. */
  private validateRetentionArchive(content: Buffer): {
    category: string;
    records: unknown[];
    assets: Array<{
      objectKey: string;
      checksum: string;
      sizeBytes: number;
      contentBase64: string;
    }>;
  } {
    return storage_audit_ops.validateRetentionArchive(content);
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

  /** Upsert cảnh báo theo fingerprint để cùng sự cố không sinh bản ghi trùng. */
  private async recordAlert(
    fingerprint: string,
    serviceName: string,
    severity: SystemAlertView["severity"],
    summary: string,
    metricValue?: number,
    threshold?: number,
  ): Promise<void> {
    return await audit_ops.recordAlert(
      this.operationContext,
      fingerprint,
      serviceName,
      severity,
      summary,
      metricValue,
      threshold,
    );
  }

  /** Tự động giải quyết cảnh báo đang mở khi metric trở lại bình thường. */
  private async recoverAlert(fingerprint: string): Promise<void> {
    return await audit_ops.recoverAlert(this.operationContext, fingerprint);
  }

  /** Đếm số bản ghi thuộc danh mục để ghi metadata export. */
  private async countExportRows(
    prisma: PrismaService,
    category: string,
  ): Promise<number> {
    return await audit_ops.countExportRows(prisma, category);
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

  /** Thu hẹp Prisma JSON thành object để đọc cấu hình an toàn. */
  private asRecord(value: Prisma.JsonValue | null): Record<string, unknown> {
    return audit_ops.asRecord(value);
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

  /** Trích danh sách placeholder {{name}} duy nhất từ subject/body mẫu. */
  private extractTemplateVariables(value: string): string[] {
    return audit_ops.extractTemplateVariables(value);
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
