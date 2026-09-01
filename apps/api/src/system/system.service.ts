import { BadRequestException, Injectable, NotFoundException, Optional, ServiceUnavailableException } from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import type { Prisma } from "../generated/prisma/client.js";
import { PrismaService } from "../database/prisma.service.js";
import { EmailDeliveryService } from "../infrastructure/email-delivery.service.js";
import { DatabaseBackupService } from "../infrastructure/database-backup.service.js";
import { ObjectStorageService } from "../infrastructure/object-storage.service.js";
import { DEFAULT_MATERIAL_MIME_TYPES, includeSupportedDocumentMimeTypes } from "../infrastructure/file-transfer.js";

export type ExamApprovalMode = "AUTO" | "MANUAL";
export interface SystemSettings { centerName: string; timezone: string; locale: string; retentionDays: number; maxFileSizeMb: number; storageQuotaMb: number; allowedMimeTypes: string[]; moderationEnabled: boolean; examApprovalMode: ExamApprovalMode; notificationSender: string; maintenanceMode: boolean; version: number; effectiveAt: string; updatedBy: string; updatedAt: string }
export interface SystemSettingRevision extends SystemSettings { id: string; key: string }
export interface StorageOverview { quotaBytes: number; usedBytes: number; usagePercent: number; maxFileSizeMb: number; allowedMimeTypes: string[]; byClass: Array<{ classId: string; classCode: string; className: string; fileCount: number; usedBytes: number }> }
export interface IntegrationConfig { id: string; provider: "GOOGLE_MEET" | "ZOOM" | "JITSI"; enabled: boolean; isDefault: boolean; healthStatus: "UNKNOWN" | "HEALTHY" | "ERROR"; maskedCredential: string; webhookConfigured: boolean; lastCheckedAt?: string; updatedAt: string }
export interface BackupRun { id: string; type: "FULL" | "INCREMENTAL"; status: "PENDING" | "RUNNING" | "COMPLETED" | "FAILED"; createdAt: string; checksum: string; sizeMb: number }
export interface AuditEvent { id: string; actor: string; action: string; target: string; detail: string; createdAt: string }
export interface AuditFilter { query?: string; actor?: string; action?: string; target?: string; from?: string; to?: string; limit?: number }
export interface RestoreRun { id: string; backupId: string; status: "PENDING" | "RUNNING" | "COMPLETED" | "FAILED"; approvedBy: string; createdAt: string; verification: string }
export interface DataExport { id: string; category: string; format: "CSV" | "JSON"; status: "PENDING" | "RUNNING" | "COMPLETED" | "FAILED"; rowCount: number; expiresAt: string; createdAt: string }
export interface NotificationTemplate { id: string; eventCode: string; locale: string; subject: string; body: string; version: number; status: "DRAFT" | "PUBLISHED"; updatedAt: string }
export interface ModerationPolicy { version: number; prohibitedTerms: string[]; maxPostsPerMinute: number; action: "FLAG" | "HIDE_PENDING_REVIEW"; updatedAt: string }
export interface TemplateTestDelivery { recipient: string; subject: string; body: string; status: "SENT"; provider: "resend"; providerMessageId: string; sentAt: string }
export interface RetentionPreview { category: string; retentionDays: number; action: "ARCHIVE" | "DELETE"; estimatedRows: number; legalHoldRows: number; deletableRows: number; cutoffAt: string }
export interface RetentionPolicyView { id: string; category: string; version: number; retentionDays: number; action: "ARCHIVE" | "DELETE"; approvedBy: string; effectiveAt: string; createdAt: string }
export interface RetentionJobView { id: string; policyId: string; status: "PENDING" | "RUNNING" | "COMPLETED" | "FAILED"; affectedRows: number; skippedRows: number; requestedBy: string; approvedBy: string; evidence: Record<string, unknown>; createdAt: string; completedAt?: string }
export interface SystemAlertView { id: string; fingerprint: string; serviceName: string; severity: "WARNING" | "CRITICAL"; status: "OPEN" | "ACKNOWLEDGED" | "MUTED" | "RESOLVED"; summary: string; metricValue?: number; threshold?: number; detectedAt: string; acknowledgedBy?: string; mutedUntil?: string; recoveredAt?: string; updatedAt: string }

const templateVariables: Record<string, readonly string[]> = {
  ACCOUNT_UPDATED: ["displayName", "accountStatus"],
  CLASS_REMINDER: ["className", "sessionTitle", "startsAt"],
  EXAM_PUBLISHED: ["examTitle", "className", "openAt", "closeAt"],
  FORUM_MENTION: ["topicTitle", "authorName"],
  SUPPORT_UPDATED: ["ticketId", "status", "resolution"],
};

const defaultSettings = (): SystemSettings => ({
  centerName: "Trung tâm hỗ trợ giảng dạy Wind EDU",
  timezone: "Asia/Bangkok",
  locale: "vi-VN",
  retentionDays: 365,
  maxFileSizeMb: 50,
  storageQuotaMb: 10_240,
  allowedMimeTypes: [...DEFAULT_MATERIAL_MIME_TYPES],
  moderationEnabled: true,
  examApprovalMode: "AUTO",
  notificationSender: "Wind EDU",
  maintenanceMode: false,
  version: 1,
  effectiveAt: new Date().toISOString(),
  updatedBy: "system",
  updatedAt: new Date().toISOString(),
});

@Injectable()
export class SystemService {
  private settings: SystemSettings = defaultSettings();
  private integrations: IntegrationConfig[] = ["GOOGLE_MEET", "ZOOM", "JITSI"].map((provider, index) => ({ id: `int-${index + 1}`, provider: provider as IntegrationConfig["provider"], enabled: provider === "JITSI", isDefault: provider === "JITSI", healthStatus: provider === "JITSI" ? "HEALTHY" : "UNKNOWN", maskedCredential: provider === "JITSI" ? "Không yêu cầu" : "Chưa cấu hình", webhookConfigured: false, lastCheckedAt: provider === "JITSI" ? new Date().toISOString() : undefined, updatedAt: new Date().toISOString() }));
  private backups: BackupRun[] = [{ id: "backup-seed", type: "FULL", status: "COMPLETED", createdAt: new Date(Date.now() - 86_400_000).toISOString(), checksum: "sha256:9e151f", sizeMb: 18.4 }];
  private restores: RestoreRun[] = [];
  private exports: DataExport[] = [];
  private templates: NotificationTemplate[] = [{ id: "tpl-class-reminder", eventCode: "CLASS_REMINDER", locale: "vi-VN", subject: "Nhắc lịch học {{className}}", body: "Buổi học {{sessionTitle}} bắt đầu lúc {{startsAt}}.", version: 1, status: "PUBLISHED", updatedAt: new Date().toISOString() }];
  private moderation: ModerationPolicy = { version: 1, prohibitedTerms: ["spam", "lừa đảo"], maxPostsPerMinute: 5, action: "FLAG", updatedAt: new Date().toISOString() };
  private audit: AuditEvent[] = [{ id: "audit-seed", actor: "system", action: "SYSTEM_STARTED", target: "platform", detail: "Khởi tạo cấu hình vận hành.", createdAt: new Date().toISOString() }];
  private settingRevisions: SystemSettingRevision[] = [{ id: "setting-revision-1", key: "platform", ...defaultSettings() }];
  private retentionPolicies: RetentionPolicyView[] = [];
  private retentionJobs: RetentionJobView[] = [];
  private legalHolds: Array<{ id: string; category: string; reason: string; active: boolean; createdBy: string; createdAt: string }> = [];
  private alerts: SystemAlertView[] = [];

  constructor(
    @Optional() private readonly prisma?: PrismaService,
    @Optional() private readonly emailDelivery?: EmailDeliveryService,
    @Optional() private readonly databaseBackup?: DatabaseBackupService,
    @Optional() private readonly objectStorage?: ObjectStorageService,
  ) {}

  async getSettings(): Promise<SystemSettings> {
    const prisma = this.database();
    if (prisma) {
      const revision = await prisma.systemSettingRevision.findFirst({ where: { key: "platform", effectiveAt: { lte: new Date() } }, orderBy: { version: "desc" } });
      if (revision) return this.mapSettings(revision.value, revision.createdAt, revision.version, revision.effectiveAt, revision.updatedBy);
      const row = await prisma.systemSetting.findUnique({ where: { key: "platform" } });
      if (!row) return defaultSettings();
      return this.mapSettings(row.value, row.updatedAt, row.version, row.effectiveAt, row.updatedBy);
    }
    const active = this.settingRevisions.filter((item) => new Date(item.effectiveAt) <= new Date()).sort((a, b) => b.version - a.version)[0];
    return structuredClone(active ?? this.settings);
  }

  async listSettingRevisions(): Promise<SystemSettingRevision[]> {
    const prisma = this.database();
    if (prisma) {
      const rows = await prisma.systemSettingRevision.findMany({ where: { key: "platform" }, orderBy: { version: "desc" }, take: 50 });
      return rows.map((row) => ({ id: row.id, key: row.key, ...this.mapSettings(row.value, row.createdAt, row.version, row.effectiveAt, row.updatedBy) }));
    }
    return structuredClone([...this.settingRevisions].sort((a, b) => b.version - a.version));
  }

  async updateSettings(input: Partial<Omit<SystemSettings, "updatedAt" | "version" | "updatedBy">>, actorId = "usr-admin"): Promise<SystemSettings> {
    if (input.retentionDays !== undefined && (input.retentionDays < 30 || input.retentionDays > 3650)) throw new BadRequestException("Thời gian lưu trữ phải từ 30 đến 3650 ngày.");
    if (input.maxFileSizeMb !== undefined && (input.maxFileSizeMb < 1 || input.maxFileSizeMb > 500)) throw new BadRequestException("Giới hạn tệp phải từ 1 đến 500 MB.");
    if (input.storageQuotaMb !== undefined && (input.storageQuotaMb < 100 || input.storageQuotaMb > 1_000_000)) throw new BadRequestException("Quota lưu trữ phải từ 100 đến 1.000.000 MB.");
    if (input.timezone) { try { new Intl.DateTimeFormat("vi-VN", { timeZone: input.timezone }).format(); } catch { throw new BadRequestException("Múi giờ IANA không hợp lệ."); } }
    const effectiveAt = input.effectiveAt ? new Date(input.effectiveAt) : new Date();
    if (Number.isNaN(effectiveAt.getTime())) throw new BadRequestException("Thời điểm hiệu lực không hợp lệ.");
    const settingValues = { ...input };
    delete settingValues.effectiveAt;
    const prisma = this.database();
    if (prisma) {
      const current = await this.getSettings();
      const next = { ...current, ...settingValues };
      return prisma.$transaction(async (transaction) => {
        const latest = await transaction.systemSettingRevision.findFirst({ where: { key: "platform" }, orderBy: { version: "desc" } });
        const version = (latest?.version ?? current.version) + 1;
        const revision = await transaction.systemSettingRevision.create({ data: { id: `setting-revision-${randomUUID()}`, key: "platform", value: next, version, effectiveAt, updatedBy: actorId } });
        if (effectiveAt <= new Date()) await transaction.systemSetting.upsert({ where: { key: "platform" }, update: { value: next, version, effectiveAt, updatedBy: actorId }, create: { key: "platform", value: next, version, effectiveAt, updatedBy: actorId } });
        await this.logDatabase(transaction, actorId, "SETTINGS_VERSION_PUBLISHED", "system-settings", `Phiên bản ${version}; hiệu lực ${effectiveAt.toISOString()}.`);
        return this.mapSettings(revision.value, revision.createdAt, revision.version, revision.effectiveAt, revision.updatedBy);
      });
    }
    const latestVersion = Math.max(0, ...this.settingRevisions.map((item) => item.version));
    const revision: SystemSettingRevision = { id: `setting-revision-${randomUUID()}`, key: "platform", ...this.settings, ...settingValues, version: latestVersion + 1, effectiveAt: effectiveAt.toISOString(), updatedBy: actorId, updatedAt: new Date().toISOString() };
    this.settingRevisions.unshift(revision);
    if (effectiveAt <= new Date()) this.settings = { ...revision };
    this.log(actorId, "SETTINGS_VERSION_PUBLISHED", "system-settings", `Phiên bản ${revision.version}; hiệu lực ${revision.effectiveAt}.`);
    return structuredClone(revision);
  }

  async listIntegrations(): Promise<IntegrationConfig[]> {
    const prisma = this.database();
    if (prisma) {
      const rows = await prisma.integrationProvider.findMany({ orderBy: { provider: "asc" } });
      return rows.map((row) => this.mapIntegration(row));
    }
    return structuredClone(this.integrations);
  }

  async updateIntegration(integrationId: string, enabled: boolean, actorId = "usr-admin"): Promise<IntegrationConfig> {
    const prisma = this.database();
    if (prisma) {
      const current = await prisma.integrationProvider.findUnique({ where: { id: integrationId } });
      if (!current) throw new NotFoundException("Không tìm thấy tích hợp.");
      if (enabled && current.healthStatus !== "HEALTHY") throw new BadRequestException("Cần health check thành công trước khi bật tích hợp.");
      return prisma.$transaction(async (transaction) => {
        const row = await transaction.integrationProvider.update({ where: { id: integrationId }, data: { enabled, isDefault: enabled ? current.isDefault : false } });
        await this.logDatabase(transaction, actorId, "INTEGRATION_UPDATED", row.provider, enabled ? "Đã bật tích hợp." : "Đã tắt tích hợp.");
        return this.mapIntegration(row);
      });
    }
    const item = this.integrations.find((entry) => entry.id === integrationId);
    if (!item) throw new NotFoundException("Không tìm thấy tích hợp.");
    if (enabled && item.healthStatus !== "HEALTHY") throw new BadRequestException("Cần health check thành công trước khi bật tích hợp.");
    item.enabled = enabled;
    if (!enabled) item.isDefault = false;
    item.updatedAt = new Date().toISOString();
    this.log(actorId, "INTEGRATION_UPDATED", item.provider, enabled ? "Đã bật tích hợp." : "Đã tắt tích hợp.");
    return structuredClone(item);
  }

  async configureIntegration(input: { provider: IntegrationConfig["provider"]; credentialReference?: string; webhookUrl?: string }, actorId = "usr-admin"): Promise<IntegrationConfig> {
    const credentialReference = input.credentialReference?.trim();
    if (input.provider !== "JITSI" && !credentialReference) throw new BadRequestException("Provider này cần tham chiếu credential trong kho bí mật.");
    if (input.webhookUrl && !/^https:\/\//i.test(input.webhookUrl)) throw new BadRequestException("Webhook phải sử dụng HTTPS.");
    const prisma = this.database();
    if (prisma) {
      return prisma.$transaction(async (transaction) => {
        const row = await transaction.integrationProvider.upsert({
          where: { provider: input.provider },
          update: { credentialRef: credentialReference, webhookUrl: input.webhookUrl?.trim() || null, isDefault: false, healthStatus: "UNKNOWN", enabled: false },
          create: { id: `integration-${randomUUID()}`, provider: input.provider, credentialRef: credentialReference, webhookUrl: input.webhookUrl?.trim() || null },
        });
        await this.logDatabase(transaction, actorId, "INTEGRATION_CONFIGURED", input.provider, "Đã lưu tham chiếu credential; secret không được ghi log.");
        return this.mapIntegration(row);
      });
    }
    let item = this.integrations.find((entry) => entry.provider === input.provider);
    if (!item) {
      item = { id: `integration-${randomUUID()}`, provider: input.provider, enabled: false, isDefault: false, healthStatus: "UNKNOWN", maskedCredential: input.provider === "JITSI" ? "Không yêu cầu" : "••••••••", webhookConfigured: Boolean(input.webhookUrl), updatedAt: new Date().toISOString() };
      this.integrations.push(item);
    }
    Object.assign(item, { enabled: false, isDefault: false, healthStatus: "UNKNOWN", maskedCredential: input.provider === "JITSI" ? "Không yêu cầu" : "••••••••", webhookConfigured: Boolean(input.webhookUrl), lastCheckedAt: undefined, updatedAt: new Date().toISOString() });
    this.log(actorId, "INTEGRATION_CONFIGURED", input.provider, "Đã lưu tham chiếu credential; secret không được ghi log.");
    return structuredClone(item);
  }

  async testIntegration(integrationId: string, actorId = "usr-admin"): Promise<IntegrationConfig> {
    const prisma = this.database();
    if (prisma) {
      const current = await prisma.integrationProvider.findUnique({ where: { id: integrationId } });
      if (!current) throw new NotFoundException("Không tìm thấy tích hợp.");
      const healthy = current.provider === "JITSI" || Boolean(current.credentialRef);
      const row = await prisma.integrationProvider.update({ where: { id: integrationId }, data: { healthStatus: healthy ? "HEALTHY" : "ERROR", lastCheckedAt: new Date() } });
      await this.logDatabase(prisma, actorId, "INTEGRATION_HEALTH_CHECKED", current.provider, healthy ? "HEALTHY" : "ERROR");
      if (!healthy) throw new BadRequestException("Health check thất bại: chưa cấu hình credential reference.");
      return this.mapIntegration(row);
    }
    const item = this.integrations.find((entry) => entry.id === integrationId);
    if (!item) throw new NotFoundException("Không tìm thấy tích hợp.");
    const healthy = item.provider === "JITSI" || item.maskedCredential === "••••••••";
    item.healthStatus = healthy ? "HEALTHY" : "ERROR";
    item.lastCheckedAt = new Date().toISOString();
    item.updatedAt = item.lastCheckedAt;
    this.log(actorId, "INTEGRATION_HEALTH_CHECKED", item.provider, healthy ? "HEALTHY" : "ERROR");
    if (!healthy) throw new BadRequestException("Health check thất bại: chưa cấu hình credential reference.");
    return structuredClone(item);
  }

  async setDefaultIntegration(integrationId: string, actorId = "usr-admin"): Promise<IntegrationConfig> {
    const prisma = this.database();
    if (prisma) {
      const current = await prisma.integrationProvider.findUnique({ where: { id: integrationId } });
      if (!current || !current.enabled || current.healthStatus !== "HEALTHY") throw new BadRequestException("Chỉ provider đang bật và khỏe mạnh mới được đặt mặc định.");
      return prisma.$transaction(async (transaction) => {
        await transaction.integrationProvider.updateMany({ data: { isDefault: false } });
        const updated = await transaction.integrationProvider.update({ where: { id: integrationId }, data: { isDefault: true } });
        await this.logDatabase(transaction, actorId, "INTEGRATION_DEFAULT_CHANGED", updated.provider, "Đặt làm nhà cung cấp mặc định.");
        return this.mapIntegration(updated);
      });
    }
    const item = this.integrations.find((entry) => entry.id === integrationId);
    if (!item || !item.enabled || item.healthStatus !== "HEALTHY") throw new BadRequestException("Chỉ provider đang bật và khỏe mạnh mới được đặt mặc định.");
    for (const integration of this.integrations) integration.isDefault = integration.id === integrationId;
    this.log(actorId, "INTEGRATION_DEFAULT_CHANGED", item.provider, "Đặt làm nhà cung cấp mặc định.");
    return structuredClone(item);
  }

  async createTestMeeting(integrationId: string, actorId = "usr-admin"): Promise<{ provider: string; attendeeUrl: string; expiresAt: string }> {
    const integrations = await this.listIntegrations();
    const item = integrations.find((entry) => entry.id === integrationId);
    if (!item || !item.enabled || !item.isDefault || item.healthStatus !== "HEALTHY") throw new BadRequestException("Provider mặc định chưa sẵn sàng để tạo phòng thử.");
    const roomId = `wind-test-${randomUUID()}`;
    const prisma = this.database();
    if (prisma) await this.logDatabase(prisma, actorId, "INTEGRATION_TEST_MEETING_CREATED", item.provider, `Phòng thử ${roomId}.`);
    else this.log(actorId, "INTEGRATION_TEST_MEETING_CREATED", item.provider, `Phòng thử ${roomId}.`);
    return { provider: item.provider, attendeeUrl: item.provider === "JITSI" ? `https://meet.jit.si/${roomId}` : `https://meeting.local/${item.provider.toLowerCase()}/${roomId}`, expiresAt: new Date(Date.now() + 30 * 60_000).toISOString() };
  }

  async listBackups(): Promise<BackupRun[]> {
    const prisma = this.database();
    if (prisma) {
      const rows = await prisma.backupJob.findMany({ orderBy: { createdAt: "desc" } });
      return rows.map((row) => this.mapBackup(row));
    }
    return structuredClone(this.backups);
  }

  async runBackup(type: BackupRun["type"], actorId = "usr-admin"): Promise<BackupRun> {
    if (type === "INCREMENTAL") throw new BadRequestException("Sao lưu gia tăng cần binary log và điểm khôi phục liên tục; hệ thống hiện chỉ cho phép FULL để bảo đảm khôi phục được.");
    const prisma = this.database();
    if (!prisma || !this.databaseBackup || !this.objectStorage) throw new ServiceUnavailableException("Sao lưu thật yêu cầu kết nối database và kho object đang hoạt động.");
    const backupId = `backup-${randomUUID()}`;
    const objectKey = `backups/${new Date().toISOString().slice(0, 10)}/${backupId}.json`;
    await prisma.backupJob.create({ data: { id: backupId, type, status: "RUNNING" } });
    try {
      const content = await this.databaseBackup.createFullBackup();
      const stored = await this.objectStorage.put(objectKey, content);
      const row = await prisma.backupJob.update({ where: { id: backupId }, data: { status: "COMPLETED", checksum: stored.checksum, sizeBytes: BigInt(content.length), objectKey: stored.objectKey, completedAt: new Date() } });
      await this.logDatabase(prisma, actorId, "BACKUP_COMPLETED", row.id, `${type} · ${stored.checksum} · ${content.length} bytes`);
      return this.mapBackup(row);
    } catch (error) {
      await prisma.backupJob.update({ where: { id: backupId }, data: { status: "FAILED", errorMessage: "Không thể tạo hoặc lưu bản sao lưu.", completedAt: new Date() } }).catch(() => undefined);
      await this.logDatabase(prisma, actorId, "BACKUP_FAILED", backupId, "Không thể tạo hoặc lưu bản sao lưu.").catch(() => undefined);
      if (error instanceof BadRequestException || error instanceof ServiceUnavailableException) throw error;
      throw new ServiceUnavailableException("Không thể tạo hoặc lưu bản sao lưu.");
    }
  }

  async restoreBackup(backupId: string, approvedBy: string, actorId = "usr-admin"): Promise<RestoreRun> {
    if (approvedBy.trim().length < 3) throw new BadRequestException("Cần người phê duyệt khôi phục.");
    const prisma = this.database();
    if (prisma) {
      const backup = await prisma.backupJob.findUnique({ where: { id: backupId } });
      if (!backup || backup.status !== "COMPLETED" || !backup.checksum || !backup.objectKey) throw new NotFoundException("Không tìm thấy điểm sao lưu thật hợp lệ.");
      if (!this.databaseBackup || !this.objectStorage) throw new ServiceUnavailableException("Dịch vụ khôi phục chưa sẵn sàng.");
      const restoreId = `restore-${randomUUID()}`;
      await prisma.restoreJob.create({ data: { id: restoreId, backupId, approvedBy: approvedBy.trim(), status: "RUNNING" } });
      try {
        const content = await this.objectStorage.get(backup.objectKey);
        const checksum = `sha256:${createHash("sha256").update(content).digest("hex")}`;
        if (checksum !== backup.checksum) throw new BadRequestException("Checksum bản sao lưu không hợp lệ; đã dừng khôi phục.");
        const result = await this.databaseBackup.verifyRestore(content);
        const verification = `Checksum hợp lệ; đã phục hồi thử nghiệm ${result.tableCount} bảng và ${result.rowCount} dòng vào database tạm, sau đó dọn dẹp an toàn.`;
        const row = await prisma.restoreJob.update({ where: { id: restoreId }, data: { status: "COMPLETED", verification, completedAt: new Date() } });
        await this.logDatabase(prisma, actorId, "RESTORE_VERIFIED", backupId, verification);
        return this.mapRestore(row);
      } catch (error) {
        await prisma.restoreJob.update({ where: { id: restoreId }, data: { status: "FAILED", verification: "Phục hồi thử nghiệm thất bại.", completedAt: new Date() } }).catch(() => undefined);
        if (error instanceof BadRequestException || error instanceof ServiceUnavailableException) throw error;
        throw new ServiceUnavailableException("Phục hồi thử nghiệm thất bại.");
      }
    }
    throw new ServiceUnavailableException("Khôi phục thật yêu cầu kết nối database.");
  }

  async listRestores(): Promise<RestoreRun[]> {
    const prisma = this.database();
    if (prisma) {
      const rows = await prisma.restoreJob.findMany({ orderBy: { createdAt: "desc" } });
      return rows.map((row) => this.mapRestore(row));
    }
    return structuredClone(this.restores);
  }

  async previewRetention(categoryInput: string): Promise<RetentionPreview> {
    const category = categoryInput.trim().toUpperCase();
    if (!category) throw new BadRequestException("Cần chọn loại dữ liệu.");
    const policy = await this.getLatestRetentionPolicy(category);
    const settings = await this.getSettings();
    const retentionDays = policy?.retentionDays ?? settings.retentionDays;
    const action = policy?.action ?? "ARCHIVE";
    const cutoffAt = new Date(Date.now() - retentionDays * 86_400_000);
    const prisma = this.database();
    const estimatedRows = prisma ? await this.countRetentionRows(prisma, category, cutoffAt) : category === "AUDIT" ? 12_840 : category === "LEARNING" ? 3_260 : 840;
    const hasLegalHold = prisma ? Boolean(await prisma.legalHold.findFirst({ where: { category, active: true } })) : this.legalHolds.some((item) => item.category === category && item.active);
    const legalHoldRows = hasLegalHold ? estimatedRows : 0;
    return { category, retentionDays, action, estimatedRows, legalHoldRows, deletableRows: estimatedRows - legalHoldRows, cutoffAt: cutoffAt.toISOString() };
  }

  async listRetentionPolicies(): Promise<RetentionPolicyView[]> {
    const prisma = this.database();
    if (prisma) return (await prisma.retentionPolicy.findMany({ orderBy: [{ category: "asc" }, { version: "desc" }] })).map((row) => this.mapRetentionPolicy(row));
    return structuredClone([...this.retentionPolicies].sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
  }

  async createRetentionPolicy(input: { category: string; retentionDays: number; action: "ARCHIVE" | "DELETE"; approvedBy: string; effectiveAt?: string }, actorId = "usr-admin"): Promise<RetentionPolicyView> {
    const category = input.category.trim().toUpperCase(); const approvedBy = input.approvedBy.trim();
    if (!category) throw new BadRequestException("Cần chọn loại dữ liệu.");
    if (input.retentionDays < 30 || input.retentionDays > 3650) throw new BadRequestException("Thời hạn lưu phải từ 30 đến 3650 ngày.");
    if (approvedBy.length < 3) throw new BadRequestException("Cần người phê duyệt chính sách.");
    const effectiveAt = input.effectiveAt ? new Date(input.effectiveAt) : new Date(); if (Number.isNaN(effectiveAt.getTime())) throw new BadRequestException("Thời điểm hiệu lực không hợp lệ.");
    const prisma = this.database();
    if (prisma) {
      const latest = await prisma.retentionPolicy.findFirst({ where: { category }, orderBy: { version: "desc" } });
      const row = await prisma.$transaction(async (transaction) => {
        const created = await transaction.retentionPolicy.create({ data: { id: `retention-policy-${randomUUID()}`, category, version: (latest?.version ?? 0) + 1, retentionDays: input.retentionDays, action: input.action, approvedBy, effectiveAt } });
        await this.logDatabase(transaction, actorId, "RETENTION_POLICY_PUBLISHED", created.id, `${category} · ${input.action} · ${input.retentionDays} ngày.`); return created;
      });
      return this.mapRetentionPolicy(row);
    }
    const version = Math.max(0, ...this.retentionPolicies.filter((item) => item.category === category).map((item) => item.version)) + 1;
    const item: RetentionPolicyView = { id: `retention-policy-${randomUUID()}`, category, version, retentionDays: input.retentionDays, action: input.action, approvedBy, effectiveAt: effectiveAt.toISOString(), createdAt: new Date().toISOString() };
    this.retentionPolicies.unshift(item); this.log(actorId, "RETENTION_POLICY_PUBLISHED", item.id, `${category} · ${input.action} · ${input.retentionDays} ngày.`); return structuredClone(item);
  }

  async createLegalHold(categoryInput: string, reasonInput: string, actorId = "usr-admin"): Promise<object> {
    const category = categoryInput.trim().toUpperCase(); const reason = reasonInput.trim(); if (!category || reason.length < 5) throw new BadRequestException("Loại dữ liệu và lý do legal hold là bắt buộc.");
    const prisma = this.database();
    if (prisma) {
      const item = await prisma.legalHold.create({ data: { id: `legal-hold-${randomUUID()}`, category, reason, createdBy: actorId } });
      await this.logDatabase(prisma, actorId, "LEGAL_HOLD_CREATED", item.id, `${category} · ${reason}`);
      return item;
    }
    const item = { id: `legal-hold-${randomUUID()}`, category, reason, active: true, createdBy: actorId, createdAt: new Date().toISOString() };
    this.legalHolds.unshift(item);
    this.log(actorId, "LEGAL_HOLD_CREATED", item.id, `${category} · ${reason}`);
    return structuredClone(item);
  }

  async runRetention(policyId: string, requestedBy: string, approvedBy: string): Promise<RetentionJobView> {
    if (!requestedBy.trim() || !approvedBy.trim()) throw new BadRequestException("Cần người yêu cầu và người phê duyệt.");
    if (requestedBy.trim().toLowerCase() === approvedBy.trim().toLowerCase()) throw new BadRequestException("Người phê duyệt phải khác người yêu cầu.");
    const prisma = this.database();
    if (prisma) {
      const policy = await prisma.retentionPolicy.findUnique({ where: { id: policyId } }); if (!policy) throw new NotFoundException("Không tìm thấy chính sách retention.");
      const preview = await this.previewRetention(policy.category);
      const jobId = `retention-job-${randomUUID()}`;
      await prisma.retentionJob.create({ data: { id: jobId, policyId, status: "RUNNING", requestedBy: requestedBy.trim(), approvedBy: approvedBy.trim(), evidence: { category: policy.category, action: policy.action, cutoffAt: preview.cutoffAt } } });
      try {
        if (preview.legalHoldRows > 0) {
          const row = await prisma.retentionJob.update({ where: { id: jobId }, data: { status: "COMPLETED", affectedRows: 0, skippedRows: preview.legalHoldRows, evidence: { category: policy.category, action: policy.action, cutoffAt: preview.cutoffAt, legalHoldProtected: preview.legalHoldRows }, completedAt: new Date() } });
          await this.logDatabase(prisma, requestedBy, "RETENTION_JOB_SKIPPED", jobId, `${preview.legalHoldRows} bản ghi được legal hold bảo vệ.`);
          return this.mapRetentionJob(row);
        }
        const result = await this.executeRetention(prisma, policy.category, policy.action === "DELETE" ? "DELETE" : "ARCHIVE", new Date(preview.cutoffAt), jobId);
        const row = await prisma.retentionJob.update({ where: { id: jobId }, data: { status: "COMPLETED", affectedRows: result.affectedRows, skippedRows: 0, evidence: { category: policy.category, action: policy.action, cutoffAt: preview.cutoffAt, archiveObjectKey: result.archiveObjectKey, archiveChecksum: result.archiveChecksum, removedObjects: result.removedObjects, objectCleanupFailures: result.objectCleanupFailures }, completedAt: new Date() } });
        await this.logDatabase(prisma, requestedBy, "RETENTION_JOB_COMPLETED", jobId, `${result.affectedRows} bản ghi đã ${policy.action === "ARCHIVE" ? "lưu trữ và xóa" : "xóa"}.`);
        return this.mapRetentionJob(row);
      } catch (error) {
        await prisma.retentionJob.update({ where: { id: jobId }, data: { status: "FAILED", evidence: { category: policy.category, action: policy.action, cutoffAt: preview.cutoffAt, error: "Không thể thực thi retention." }, completedAt: new Date() } }).catch(() => undefined);
        if (error instanceof BadRequestException || error instanceof ServiceUnavailableException) throw error;
        throw new ServiceUnavailableException("Không thể thực thi retention.");
      }
    }
    const policy = this.retentionPolicies.find((item) => item.id === policyId); if (!policy) throw new NotFoundException("Không tìm thấy chính sách retention."); const preview = await this.previewRetention(policy.category);
    const item: RetentionJobView = { id: `retention-job-${randomUUID()}`, policyId, status: "COMPLETED", affectedRows: preview.deletableRows, skippedRows: preview.legalHoldRows, requestedBy: requestedBy.trim(), approvedBy: approvedBy.trim(), evidence: { category: policy.category, action: policy.action, cutoffAt: preview.cutoffAt, legalHoldProtected: preview.legalHoldRows }, createdAt: new Date().toISOString(), completedAt: new Date().toISOString() };
    this.retentionJobs.unshift(item); this.log(requestedBy, "RETENTION_JOB_COMPLETED", item.id, `${item.affectedRows} bản ghi xử lý; ${item.skippedRows} bản ghi được giữ.`); return structuredClone(item);
  }

  async listRetentionJobs(): Promise<RetentionJobView[]> {
    const prisma = this.database(); if (prisma) return (await prisma.retentionJob.findMany({ orderBy: { createdAt: "desc" } })).map((row) => this.mapRetentionJob(row)); return structuredClone(this.retentionJobs);
  }

  async runExport(category: string, format: DataExport["format"], actorId = "usr-admin"): Promise<DataExport> {
    const prisma = this.database();
    if (prisma) {
      const rowCount = await this.countExportRows(prisma, category);
      const createdAt = new Date();
      const expiresAt = new Date(createdAt.getTime() + 86_400_000);
      return prisma.$transaction(async (transaction) => {
        const row = await transaction.dataExportJob.create({
          data: {
            id: `export-${randomUUID()}`, category, format, status: "COMPLETED", rowCount,
            objectKey: `exports/${category.toLowerCase()}/${createdAt.getTime()}.${format.toLowerCase()}`, expiresAt,
          },
        });
        await this.logDatabase(transaction, actorId, "DATA_EXPORTED", row.id, `${category} · ${format} · ${rowCount} dòng`);
        return this.mapExport(row);
      });
    }
    const item: DataExport = { id: `export-${randomUUID()}`, category, format, status: "COMPLETED", rowCount: category === "AUDIT" ? this.audit.length : 48, createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 86_400_000).toISOString() };
    this.exports.unshift(item);
    this.log(actorId, "DATA_EXPORTED", item.id, `${category} · ${format} · ${item.rowCount} dòng`);
    return structuredClone(item);
  }

  async listExports(): Promise<DataExport[]> {
    const prisma = this.database();
    if (prisma) {
      const rows = await prisma.dataExportJob.findMany({ orderBy: { createdAt: "desc" } });
      return rows.map((row) => this.mapExport(row));
    }
    return structuredClone(this.exports);
  }

  async listTemplates(): Promise<NotificationTemplate[]> {
    const prisma = this.database();
    if (prisma) {
      const rows = await prisma.notificationTemplate.findMany({ orderBy: [{ eventCode: "asc" }, { locale: "asc" }, { version: "desc" }] });
      const latest = new Map<string, NotificationTemplate>();
      for (const row of rows) {
        const key = `${row.eventCode}:${row.locale}`;
        if (!latest.has(key)) latest.set(key, this.mapTemplate(row));
      }
      return [...latest.values()];
    }
    const latest = new Map<string, NotificationTemplate>();
    for (const item of [...this.templates].sort((left, right) => right.version - left.version)) {
      const key = `${item.eventCode}:${item.locale}`;
      if (!latest.has(key)) latest.set(key, item);
    }
    return structuredClone([...latest.values()]);
  }

  async saveTemplate(input: Omit<NotificationTemplate, "id" | "version" | "status" | "updatedAt">, actorId = "usr-admin"): Promise<NotificationTemplate> {
    if (/<script|javascript:/i.test(`${input.subject} ${input.body}`)) throw new BadRequestException("Mẫu thông báo chứa nội dung không an toàn.");
    const eventCode = input.eventCode.trim().toUpperCase();
    const allowedVariables = templateVariables[eventCode];
    if (!allowedVariables) throw new BadRequestException("Mã sự kiện thông báo chưa được hệ thống hỗ trợ.");
    const usedVariables = this.extractTemplateVariables(`${input.subject} ${input.body}`);
    const invalidVariables = usedVariables.filter((variable) => !allowedVariables.includes(variable));
    if (invalidVariables.length) throw new BadRequestException(`Biến mẫu không được phép: ${invalidVariables.join(", ")}.`);
    const normalized = { ...input, eventCode, locale: input.locale.trim() };
    const prisma = this.database();
    if (prisma) {
      const current = await prisma.notificationTemplate.findFirst({
        where: { eventCode, locale: normalized.locale }, orderBy: { version: "desc" },
      });
      return prisma.$transaction(async (transaction) => {
        const row = await transaction.notificationTemplate.create({
          data: { id: `tpl-${randomUUID()}`, ...normalized, version: (current?.version ?? 0) + 1, status: "PUBLISHED" },
        });
        await this.logDatabase(transaction, actorId, "TEMPLATE_PUBLISHED", row.eventCode, `${row.locale} · v${row.version}`);
        return this.mapTemplate(row);
      });
    }
    const current = this.templates.find((item) => item.eventCode === eventCode && item.locale === normalized.locale);
    const item: NotificationTemplate = { ...normalized, id: `tpl-${randomUUID()}`, version: (current?.version ?? 0) + 1, status: "PUBLISHED", updatedAt: new Date().toISOString() };
    this.templates.unshift(item);
    this.log(actorId, "TEMPLATE_PUBLISHED", item.eventCode, `${item.locale} · v${item.version}`);
    return structuredClone(item);
  }

  async previewTemplate(templateId: string, variables: Record<string, string>): Promise<object> {
    const prisma = this.database();
    let template: NotificationTemplate | undefined;
    if (prisma) {
      const row = await prisma.notificationTemplate.findUnique({ where: { id: templateId } });
      template = row ? this.mapTemplate(row) : undefined;
    } else template = this.templates.find((item) => item.id === templateId);
    if (!template) throw new NotFoundException("Không tìm thấy mẫu thông báo.");
    const render = (text: string): string => text.replace(/{{([a-zA-Z0-9_]+)}}/g, (_, key: string) => variables[key] ?? `[${key}]`);
    const subject = render(template.subject);
    const body = render(template.body);
    return { subject, body, unresolvedVariables: [...new Set([...subject.matchAll(/\[([^\]]+)\]/g), ...body.matchAll(/\[([^\]]+)\]/g)].map((match) => match[1]))] };
  }

  async sendTemplateTest(templateId: string, recipient: string, variables: Record<string, string>, actorId = "usr-admin"): Promise<TemplateTestDelivery> {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) throw new BadRequestException("Email nhận bản thử không hợp lệ.");
    const preview = await this.previewTemplate(templateId, variables) as { subject: string; body: string; unresolvedVariables: string[] };
    if (preview.unresolvedVariables.length) throw new BadRequestException(`Chưa cung cấp biến: ${preview.unresolvedVariables.join(", ")}.`);
    if (!this.emailDelivery) throw new BadRequestException("Dịch vụ email Resend chưa được khởi tạo.");
    const accepted = await this.emailDelivery.send({
      to: recipient,
      subject: preview.subject,
      text: preview.body,
      idempotencyKey: `template-test/${templateId}/${randomUUID()}`,
    });
    const delivery: TemplateTestDelivery = {
      recipient,
      subject: preview.subject,
      body: preview.body,
      status: "SENT",
      provider: accepted.provider,
      providerMessageId: accepted.providerMessageId,
      sentAt: accepted.acceptedAt,
    };
    const prisma = this.database();
    if (prisma) await this.logDatabase(prisma, actorId, "TEMPLATE_TEST_SENT", templateId, `Resend ${accepted.providerMessageId} đã chấp nhận email tới ${recipient}.`);
    else this.log(actorId, "TEMPLATE_TEST_SENT", templateId, `Gửi thử tới ${recipient}.`);
    return delivery;
  }

  async getModerationPolicy(): Promise<ModerationPolicy> {
    const prisma = this.database();
    if (prisma) {
      const row = await prisma.moderationPolicy.findFirst({ orderBy: { version: "desc" } });
      return row ? this.mapModeration(row) : { ...this.moderation, prohibitedTerms: [...this.moderation.prohibitedTerms] };
    }
    return structuredClone(this.moderation);
  }

  async updateModerationPolicy(input: Omit<ModerationPolicy, "version" | "updatedAt">, actorId = "usr-admin"): Promise<ModerationPolicy> {
    const prohibitedTerms = [...new Set(input.prohibitedTerms.map((term) => term.trim().toLowerCase()).filter(Boolean))];
    const prisma = this.database();
    if (prisma) {
      const current = await prisma.moderationPolicy.findFirst({ orderBy: { version: "desc" } });
      return prisma.$transaction(async (transaction) => {
        const row = await transaction.moderationPolicy.create({
          data: {
            id: `policy-${randomUUID()}`, version: (current?.version ?? 0) + 1, prohibitedTerms,
            maxPostsPerMinute: input.maxPostsPerMinute, action: input.action, publishedBy: actorId,
          },
        });
        await this.logDatabase(transaction, actorId, "MODERATION_POLICY_PUBLISHED", `v${row.version}`, `${prohibitedTerms.length} từ khóa`);
        return this.mapModeration(row);
      });
    }
    this.moderation = { ...input, prohibitedTerms, version: this.moderation.version + 1, updatedAt: new Date().toISOString() };
    this.log(actorId, "MODERATION_POLICY_PUBLISHED", `v${this.moderation.version}`, `${this.moderation.prohibitedTerms.length} từ khóa`);
    return structuredClone(this.moderation);
  }

  async listAudit(filter: AuditFilter = {}): Promise<AuditEvent[]> {
    const normalized = filter.query?.trim().toLowerCase() ?? "";
    const from = filter.from ? new Date(filter.from) : undefined; const to = filter.to ? new Date(filter.to) : undefined;
    if (from && Number.isNaN(from.getTime()) || to && Number.isNaN(to.getTime())) throw new BadRequestException("Khoảng thời gian audit không hợp lệ.");
    if (from && to && from > to) throw new BadRequestException("Thời gian bắt đầu phải trước thời gian kết thúc.");
    const limit = Math.min(500, Math.max(1, filter.limit ?? 100));
    const prisma = this.database();
    if (prisma) {
      const rows = await prisma.auditLog.findMany({ where: { actorId: filter.actor ? { contains: filter.actor.trim() } : undefined, action: filter.action ? { contains: filter.action.trim() } : undefined, entityId: filter.target ? { contains: filter.target.trim() } : undefined, createdAt: from || to ? { gte: from, lte: to } : undefined }, orderBy: { createdAt: "desc" }, take: limit });
      return rows.map((row) => this.mapAudit(row)).filter((item) => !normalized || `${item.actor} ${item.action} ${item.target} ${item.detail}`.toLowerCase().includes(normalized));
    }
    return structuredClone(this.audit.filter((item) => (!normalized || `${item.actor} ${item.action} ${item.target} ${item.detail}`.toLowerCase().includes(normalized)) && (!filter.actor || item.actor.includes(filter.actor)) && (!filter.action || item.action.includes(filter.action)) && (!filter.target || item.target.includes(filter.target)) && (!from || new Date(item.createdAt) >= from) && (!to || new Date(item.createdAt) <= to)).slice(0, limit));
  }

  async healthOverview(): Promise<object> {
    const prisma = this.database();
    if (!prisma) { await this.recordAlert("database:disabled", "database", "CRITICAL", "Kết nối cơ sở dữ liệu đang tắt."); return { status: "degraded", database: "disabled", apiLatencyMs: 0, storageUsagePercent: 0, queueDepth: 0, checkedAt: new Date().toISOString() }; }
    const startedAt = performance.now();
    await prisma.$queryRaw`SELECT 1`;
    const storage = await this.getStorageOverview();
    const queueDepth = await prisma.$transaction([
      prisma.backupJob.count({ where: { status: { in: ["PENDING", "RUNNING"] } } }),
      prisma.restoreJob.count({ where: { status: { in: ["PENDING", "RUNNING"] } } }),
      prisma.dataExportJob.count({ where: { status: { in: ["PENDING", "RUNNING"] } } }),
    ]);
    const apiLatencyMs = Math.max(1, Math.round(performance.now() - startedAt)); const totalQueueDepth = queueDepth.reduce((sum, value) => sum + value, 0);
    if (storage.usagePercent >= 90) await this.recordAlert("storage:usage", "storage", "CRITICAL", "Dung lượng lưu trữ vượt ngưỡng 90%.", storage.usagePercent, 90); else await this.recoverAlert("storage:usage");
    if (totalQueueDepth >= 20) await this.recordAlert("queue:depth", "job-queue", "WARNING", "Hàng đợi tác vụ vượt ngưỡng 20.", totalQueueDepth, 20); else await this.recoverAlert("queue:depth");
    if (apiLatencyMs >= 1000) await this.recordAlert("api:latency", "api", "WARNING", "Độ trễ API vượt ngưỡng 1000 ms.", apiLatencyMs, 1000); else await this.recoverAlert("api:latency");
    await this.recoverAlert("database:disabled");
    return { status: storage.usagePercent >= 90 ? "warning" : "healthy", database: "connected", apiLatencyMs, storageUsagePercent: storage.usagePercent, queueDepth: totalQueueDepth, checkedAt: new Date().toISOString() };
  }

  async listAlerts(): Promise<SystemAlertView[]> {
    const prisma = this.database(); if (prisma) return (await prisma.systemAlert.findMany({ orderBy: { detectedAt: "desc" }, take: 200 })).map((row) => this.mapAlert(row)); return structuredClone(this.alerts);
  }

  async updateAlert(alertId: string, action: "ACKNOWLEDGE" | "MUTE" | "RESOLVE", actorId = "usr-admin", muteMinutes = 60): Promise<SystemAlertView> {
    const prisma = this.database();
    const data = action === "ACKNOWLEDGE" ? { status: "ACKNOWLEDGED", acknowledgedBy: actorId } : action === "MUTE" ? { status: "MUTED", acknowledgedBy: actorId, mutedUntil: new Date(Date.now() + Math.min(1440, Math.max(5, muteMinutes)) * 60_000) } : { status: "RESOLVED", recoveredAt: new Date(), acknowledgedBy: actorId };
    if (prisma) { const current = await prisma.systemAlert.findUnique({ where: { id: alertId } }); if (!current) throw new NotFoundException("Không tìm thấy cảnh báo."); const row = await prisma.systemAlert.update({ where: { id: alertId }, data }); await this.logDatabase(prisma, actorId, `ALERT_${action}`, alertId, row.summary); return this.mapAlert(row); }
    const item = this.alerts.find((row) => row.id === alertId); if (!item) throw new NotFoundException("Không tìm thấy cảnh báo."); Object.assign(item, { ...data, mutedUntil: data.mutedUntil?.toISOString(), recoveredAt: data.recoveredAt?.toISOString(), updatedAt: new Date().toISOString() }); this.log(actorId, `ALERT_${action}`, alertId, item.summary); return structuredClone(item);
  }

  async getStorageOverview(): Promise<StorageOverview> {
    const settings = await this.getSettings();
    const quotaBytes = settings.storageQuotaMb * 1_000_000;
    const prisma = this.database();
    if (!prisma) {
      return { quotaBytes, usedBytes: 0, usagePercent: 0, maxFileSizeMb: settings.maxFileSizeMb, allowedMimeTypes: settings.allowedMimeTypes, byClass: [] };
    }
    const groups = await prisma.material.groupBy({ by: ["classId"], _sum: { sizeBytes: true }, _count: { id: true } });
    const classes = await prisma.learningClass.findMany({ where: { id: { in: groups.map((item) => item.classId) } }, select: { id: true, code: true, name: true } });
    const classMap = new Map(classes.map((item) => [item.id, item]));
    const byClass = groups.map((group) => {
      const classItem = classMap.get(group.classId);
      return { classId: group.classId, classCode: classItem?.code ?? group.classId, className: classItem?.name ?? "Lớp không xác định", fileCount: group._count.id, usedBytes: Number(group._sum.sizeBytes ?? 0n) };
    }).sort((a, b) => b.usedBytes - a.usedBytes);
    const usedBytes = byClass.reduce((sum, item) => sum + item.usedBytes, 0);
    return { quotaBytes, usedBytes, usagePercent: quotaBytes ? Math.min(100, Math.round((usedBytes / quotaBytes) * 10_000) / 100) : 100, maxFileSizeMb: settings.maxFileSizeMb, allowedMimeTypes: settings.allowedMimeTypes, byClass };
  }

  private database(): PrismaService | undefined {
    return this.prisma?.isStartupConnectionEnabled() ? this.prisma : undefined;
  }

  private mapSettings(value: Prisma.JsonValue, updatedAt: Date, version = 1, effectiveAt = updatedAt, updatedBy = "system"): SystemSettings {
    const fallback = defaultSettings();
    const record = this.asRecord(value);
    return {
      centerName: this.stringValue(record.centerName, fallback.centerName),
      timezone: this.stringValue(record.timezone, fallback.timezone),
      locale: this.stringValue(record.locale, fallback.locale),
      retentionDays: this.numberValue(record.retentionDays, fallback.retentionDays),
      maxFileSizeMb: this.numberValue(record.maxFileSizeMb, fallback.maxFileSizeMb),
      storageQuotaMb: this.numberValue(record.storageQuotaMb, fallback.storageQuotaMb),
      allowedMimeTypes: includeSupportedDocumentMimeTypes(this.stringArray(record.allowedMimeTypes, fallback.allowedMimeTypes)),
      moderationEnabled: this.booleanValue(record.moderationEnabled, fallback.moderationEnabled),
      examApprovalMode: record.examApprovalMode === "MANUAL" ? "MANUAL" : "AUTO",
      notificationSender: this.stringValue(record.notificationSender, fallback.notificationSender),
      maintenanceMode: this.booleanValue(record.maintenanceMode, fallback.maintenanceMode),
      version,
      effectiveAt: effectiveAt.toISOString(),
      updatedBy,
      updatedAt: updatedAt.toISOString(),
    };
  }

  private mapIntegration(row: Prisma.IntegrationProviderGetPayload<Record<string, never>>): IntegrationConfig {
    if (!this.isProvider(row.provider)) throw new BadRequestException(`Nhà cung cấp ${row.provider} không được hỗ trợ.`);
    const healthStatus = row.healthStatus === "HEALTHY" || row.healthStatus === "ERROR" ? row.healthStatus : "UNKNOWN";
    return { id: row.id, provider: row.provider, enabled: row.enabled, isDefault: row.isDefault, healthStatus, maskedCredential: row.provider === "JITSI" ? "Không yêu cầu" : row.credentialRef ? "••••••••" : "Chưa cấu hình", webhookConfigured: Boolean(row.webhookUrl), lastCheckedAt: row.lastCheckedAt?.toISOString(), updatedAt: row.updatedAt.toISOString() };
  }

  private mapBackup(row: Prisma.BackupJobGetPayload<Record<string, never>>): BackupRun {
    return {
      id: row.id,
      type: row.type === "INCREMENTAL" ? "INCREMENTAL" : "FULL",
      status: row.status,
      createdAt: row.createdAt.toISOString(),
      checksum: row.checksum ?? "",
      sizeMb: row.sizeBytes === null ? 0 : Math.round(Number(row.sizeBytes) / 100_000) / 10,
    };
  }

  private mapRestore(row: Prisma.RestoreJobGetPayload<Record<string, never>>): RestoreRun {
    return { id: row.id, backupId: row.backupId, status: row.status, approvedBy: row.approvedBy, createdAt: row.createdAt.toISOString(), verification: row.verification ?? "" };
  }

  private mapExport(row: Prisma.DataExportJobGetPayload<Record<string, never>>): DataExport {
    return {
      id: row.id,
      category: row.category,
      format: row.format === "JSON" ? "JSON" : "CSV",
      status: row.status,
      rowCount: row.rowCount ?? 0,
      expiresAt: row.expiresAt?.toISOString() ?? row.createdAt.toISOString(),
      createdAt: row.createdAt.toISOString(),
    };
  }

  private mapTemplate(row: Prisma.NotificationTemplateGetPayload<Record<string, never>>): NotificationTemplate {
    return { id: row.id, eventCode: row.eventCode, locale: row.locale, subject: row.subject, body: row.body, version: row.version, status: row.status === "PUBLISHED" ? "PUBLISHED" : "DRAFT", updatedAt: row.updatedAt.toISOString() };
  }

  private mapModeration(row: Prisma.ModerationPolicyGetPayload<Record<string, never>>): ModerationPolicy {
    if (row.action !== "FLAG" && row.action !== "HIDE_PENDING_REVIEW") throw new BadRequestException("Hành động kiểm duyệt không hợp lệ.");
    return { version: row.version, prohibitedTerms: this.stringArray(row.prohibitedTerms, []), maxPostsPerMinute: row.maxPostsPerMinute, action: row.action, updatedAt: row.createdAt.toISOString() };
  }

  private mapAudit(row: Prisma.AuditLogGetPayload<Record<string, never>>): AuditEvent {
    const context = this.asRecord(row.context);
    return { id: row.id.toString(), actor: row.actorId ?? "system", action: row.action, target: row.entityId ?? row.entityType, detail: this.redactSensitive(this.stringValue(context.detail ?? context.summary, row.action)), createdAt: row.createdAt.toISOString() };
  }

  private mapRetentionPolicy(row: Prisma.RetentionPolicyGetPayload<Record<string, never>>): RetentionPolicyView {
    if (row.action !== "ARCHIVE" && row.action !== "DELETE") throw new BadRequestException("Hành động retention không hợp lệ.");
    return { id: row.id, category: row.category, version: row.version, retentionDays: row.retentionDays, action: row.action, approvedBy: row.approvedBy, effectiveAt: row.effectiveAt.toISOString(), createdAt: row.createdAt.toISOString() };
  }

  private mapRetentionJob(row: Prisma.RetentionJobGetPayload<Record<string, never>>): RetentionJobView {
    return { id: row.id, policyId: row.policyId, status: row.status, affectedRows: row.affectedRows, skippedRows: row.skippedRows, requestedBy: row.requestedBy, approvedBy: row.approvedBy, evidence: this.asRecord(row.evidence), createdAt: row.createdAt.toISOString(), completedAt: row.completedAt?.toISOString() };
  }

  private mapAlert(row: Prisma.SystemAlertGetPayload<Record<string, never>>): SystemAlertView {
    const severity = row.severity === "CRITICAL" ? "CRITICAL" : "WARNING"; const status = ["OPEN", "ACKNOWLEDGED", "MUTED", "RESOLVED"].includes(row.status) ? row.status as SystemAlertView["status"] : "OPEN";
    return { id: row.id, fingerprint: row.fingerprint, serviceName: row.serviceName, severity, status, summary: row.summary, metricValue: row.metricValue ?? undefined, threshold: row.threshold ?? undefined, detectedAt: row.detectedAt.toISOString(), acknowledgedBy: row.acknowledgedBy ?? undefined, mutedUntil: row.mutedUntil?.toISOString(), recoveredAt: row.recoveredAt?.toISOString(), updatedAt: row.updatedAt.toISOString() };
  }

  private async getLatestRetentionPolicy(category: string): Promise<RetentionPolicyView | undefined> {
    const prisma = this.database(); if (prisma) { const row = await prisma.retentionPolicy.findFirst({ where: { category, effectiveAt: { lte: new Date() } }, orderBy: { version: "desc" } }); return row ? this.mapRetentionPolicy(row) : undefined; }
    return this.retentionPolicies.filter((item) => item.category === category && new Date(item.effectiveAt) <= new Date()).sort((a, b) => b.version - a.version)[0];
  }

  private async countRetentionRows(prisma: PrismaService, category: string, cutoffAt: Date): Promise<number> {
    if (category === "AUDIT") return prisma.auditLog.count({ where: { createdAt: { lt: cutoffAt } } });
    if (category === "SUPPORT") return prisma.supportTicket.count({ where: { createdAt: { lt: cutoffAt }, status: "CLOSED" } });
    if (category === "LEARNING") return prisma.learningClass.count({ where: { archivedAt: { lt: cutoffAt } } });
    return 0;
  }

  private async executeRetention(
    prisma: PrismaService,
    category: string,
    action: "ARCHIVE" | "DELETE",
    cutoffAt: Date,
    jobId: string,
  ): Promise<{ affectedRows: number; archiveObjectKey?: string; archiveChecksum?: string; removedObjects: number; objectCleanupFailures: number }> {
    let records: unknown[];
    let objectKeys: string[] = [];
    if (category === "AUDIT") {
      records = await prisma.auditLog.findMany({ where: { createdAt: { lt: cutoffAt } }, orderBy: { createdAt: "asc" } });
    } else if (category === "SUPPORT") {
      const tickets = await prisma.supportTicket.findMany({ where: { createdAt: { lt: cutoffAt }, status: "CLOSED" }, include: { comments: true, attachments: true } });
      records = tickets;
      objectKeys = tickets.flatMap((ticket) => ticket.attachments.map((attachment) => attachment.objectKey));
    } else if (category === "LEARNING") {
      const classes = await prisma.learningClass.findMany({
        where: { archivedAt: { lt: cutoffAt } },
        include: {
          instructors: true, instructorHistory: true, enrollments: true, enrollmentHistory: true,
          materials: { include: { versions: true, accessLogs: true, reviews: true, forumAttachments: true } },
          exams: { include: { questions: true, approvals: true, attempts: { include: { answers: true, regradeRequests: true, gradeHistory: true } } } },
          forumTopics: { include: { posts: { include: { attachments: true, mentions: true } } } },
          sessions: { include: { attendance: true, appeals: true } }, assignments: { include: { submissions: true } }, announcements: true,
        },
      });
      records = classes;
      objectKeys = classes.flatMap((classItem) => classItem.materials.flatMap((material) => [material.objectKey, ...material.versions.map((version) => version.objectKey)]));
    } else {
      throw new BadRequestException("Retention chỉ hỗ trợ AUDIT, SUPPORT hoặc LEARNING.");
    }

    let archiveObjectKey: string | undefined;
    let archiveChecksum: string | undefined;
    if (action === "ARCHIVE" && records.length) {
      if (!this.objectStorage) throw new ServiceUnavailableException("Kho object chưa sẵn sàng để lưu archive retention.");
      const content = Buffer.from(JSON.stringify({ format: "wind-edu-retention-archive", version: 1, category, cutoffAt: cutoffAt.toISOString(), createdAt: new Date().toISOString(), records }, (_key, value: unknown) => typeof value === "bigint" ? value.toString() : value), "utf8");
      const stored = await this.objectStorage.put(`retention/${category.toLowerCase()}/${jobId}.json`, content);
      archiveObjectKey = stored.objectKey;
      archiveChecksum = stored.checksum;
    }

    if (records.length) {
      if (category === "AUDIT") await prisma.auditLog.deleteMany({ where: { createdAt: { lt: cutoffAt } } });
      if (category === "SUPPORT") await prisma.supportTicket.deleteMany({ where: { id: { in: (records as Array<{ id: string }>).map((item) => item.id) } } });
      if (category === "LEARNING") await prisma.learningClass.deleteMany({ where: { id: { in: (records as Array<{ id: string }>).map((item) => item.id) } } });
    }

    let removedObjects = 0;
    let objectCleanupFailures = 0;
    if (this.objectStorage) {
      for (const objectKey of [...new Set(objectKeys)]) {
        try { await this.objectStorage.remove(objectKey); removedObjects += 1; }
        catch { objectCleanupFailures += 1; }
      }
    } else objectCleanupFailures = new Set(objectKeys).size;
    return { affectedRows: records.length, archiveObjectKey, archiveChecksum, removedObjects, objectCleanupFailures };
  }

  private async recordAlert(fingerprint: string, serviceName: string, severity: SystemAlertView["severity"], summary: string, metricValue?: number, threshold?: number): Promise<void> {
    const prisma = this.database();
    if (prisma) { const current = await prisma.systemAlert.findUnique({ where: { fingerprint } }); if (current?.status === "MUTED" && current.mutedUntil && current.mutedUntil > new Date()) return; await prisma.systemAlert.upsert({ where: { fingerprint }, update: { serviceName, severity, summary, metricValue, threshold, status: current?.status === "ACKNOWLEDGED" ? "ACKNOWLEDGED" : "OPEN", recoveredAt: null }, create: { id: `alert-${randomUUID()}`, fingerprint, serviceName, severity, summary, metricValue, threshold } }); return; }
    const current = this.alerts.find((item) => item.fingerprint === fingerprint); if (current?.status === "MUTED" && current.mutedUntil && new Date(current.mutedUntil) > new Date()) return;
    if (current) Object.assign(current, { serviceName, severity, summary, metricValue, threshold, status: current.status === "ACKNOWLEDGED" ? "ACKNOWLEDGED" : "OPEN", recoveredAt: undefined, updatedAt: new Date().toISOString() });
    else { const timestamp = new Date().toISOString(); this.alerts.unshift({ id: `alert-${randomUUID()}`, fingerprint, serviceName, severity, status: "OPEN", summary, metricValue, threshold, detectedAt: timestamp, updatedAt: timestamp }); }
  }

  private async recoverAlert(fingerprint: string): Promise<void> {
    const prisma = this.database(); if (prisma) { await prisma.systemAlert.updateMany({ where: { fingerprint, status: { not: "RESOLVED" } }, data: { status: "RESOLVED", recoveredAt: new Date() } }); return; }
    const current = this.alerts.find((item) => item.fingerprint === fingerprint && item.status !== "RESOLVED"); if (current) Object.assign(current, { status: "RESOLVED", recoveredAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
  }

  private async countExportRows(prisma: PrismaService, category: string): Promise<number> {
    if (category === "AUDIT") return prisma.auditLog.count();
    if (category === "LEARNING") {
      const [courses, classes, attempts] = await prisma.$transaction([prisma.course.count(), prisma.learningClass.count(), prisma.examAttempt.count()]);
      return courses + classes + attempts;
    }
    return prisma.user.count();
  }

  private async logDatabase(database: PrismaService | Prisma.TransactionClient, actorId: string, action: string, target: string, detail: string): Promise<void> {
    await database.auditLog.create({ data: { actorId, action, entityType: "system", entityId: target, context: { detail } } });
  }

  private asRecord(value: Prisma.JsonValue | null): Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
  }

  private stringValue(value: unknown, fallback: string): string { return typeof value === "string" ? value : fallback; }
  private numberValue(value: unknown, fallback: number): number { return typeof value === "number" && Number.isFinite(value) ? value : fallback; }
  private booleanValue(value: unknown, fallback: boolean): boolean { return typeof value === "boolean" ? value : fallback; }
  private stringArray(value: unknown, fallback: string[]): string[] { return Array.isArray(value) && value.every((item) => typeof item === "string") ? value : [...fallback]; }
  private extractTemplateVariables(value: string): string[] { return [...new Set([...value.matchAll(/{{([a-zA-Z0-9_]+)}}/g)].map((match) => match[1] ?? "").filter(Boolean))]; }
  private redactSensitive(value: string): string { return value.replace(/(password|token|secret|credential|authorization)\s*[:=]\s*[^\s,;]+/gi, "$1=[REDACTED]"); }
  private isProvider(value: string): value is IntegrationConfig["provider"] { return value === "GOOGLE_MEET" || value === "ZOOM" || value === "JITSI"; }
  private log(actorId: string, action: string, target: string, detail: string): void { this.audit.unshift({ id: `audit-${randomUUID()}`, actor: actorId, action, target, detail, createdAt: new Date().toISOString() }); }
}
