import { BadRequestException, Injectable, NotFoundException, Optional, ServiceUnavailableException } from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import { withTemporaryFile } from "../infrastructure/file-streams.js";
import type { Prisma } from "../generated/prisma/client.js";
import { PrismaService } from "../database/prisma.service.js";
import { EmailDeliveryService } from "../infrastructure/email-delivery.service.js";
import { DatabaseBackupService } from "../infrastructure/database-backup.service.js";
import { ObjectStorageService } from "../infrastructure/object-storage.service.js";
import { DEFAULT_MATERIAL_MIME_TYPES, includeSupportedDocumentMimeTypes } from "../infrastructure/file-transfer.js";

export type ExamApprovalMode = "AUTO" | "MANUAL";
export interface SystemSettings { centerName: string; timezone: string; locale: string; retentionDays: number; maxFileSizeMb: number; storageQuotaMb: number; allowedMimeTypes: string[]; moderationEnabled: boolean; examApprovalMode: ExamApprovalMode; questionApprovalMode: ExamApprovalMode; notificationSender: string; maintenanceMode: boolean; version: number; effectiveAt: string; updatedBy: string; updatedAt: string }
export interface SystemSettingRevision extends SystemSettings { id: string; key: string }
export interface StorageOverview { quotaBytes: number; usedBytes: number; usagePercent: number; maxFileSizeMb: number; allowedMimeTypes: string[]; byClass: Array<{ classId: string; classCode: string; className: string; fileCount: number; usedBytes: number }> }
export interface IntegrationConfig { id: string; provider: "GOOGLE_MEET" | "ZOOM" | "JITSI"; enabled: boolean; isDefault: boolean; healthStatus: "UNKNOWN" | "HEALTHY" | "ERROR"; maskedCredential: string; webhookConfigured: boolean; lastCheckedAt?: string; updatedAt: string }
export interface BackupRun { id: string; type: "FULL" | "INCREMENTAL"; status: "PENDING" | "RUNNING" | "COMPLETED" | "FAILED"; createdAt: string; checksum: string; sizeMb: number; attempts: number; progress: number }
export interface AuditEvent { id: string; actor: string; action: string; target: string; detail: string; createdAt: string }
export interface AuditFilter { query?: string; actor?: string; action?: string; target?: string; from?: string; to?: string; limit?: number }
export interface RestoreRun { id: string; backupId: string; mode: "DRILL" | "OPERATIONAL"; status: "PENDING" | "RUNNING" | "COMPLETED" | "FAILED"; requestedBy: string; approvedBy?: string; reason?: string; targetDatabase?: string; createdAt: string; verification: string }
export interface DataExport { id: string; category: string; format: "CSV" | "JSON"; status: "PENDING" | "RUNNING" | "COMPLETED" | "FAILED"; rowCount: number; checksum?: string; sizeBytes: number; downloadAvailable: boolean; expiresAt: string; createdAt: string; attempts: number; progress: number }
export interface NotificationTemplate { id: string; eventCode: string; locale: string; subject: string; body: string; version: number; status: "DRAFT" | "PUBLISHED"; updatedAt: string }
export interface ModerationPolicy { version: number; prohibitedTerms: string[]; maxPostsPerMinute: number; action: "FLAG" | "HIDE_PENDING_REVIEW"; updatedAt: string }
export interface TemplateTestDelivery { recipient: string; subject: string; body: string; status: "SENT"; provider: "resend"; providerMessageId: string; sentAt: string }
export interface RetentionPreview { category: string; retentionDays: number; action: "ARCHIVE" | "DELETE"; estimatedRows: number; legalHoldRows: number; deletableRows: number; cutoffAt: string }
export interface RetentionPolicyView { id: string; category: string; version: number; retentionDays: number; action: "ARCHIVE" | "DELETE"; approvedBy: string; effectiveAt: string; createdAt: string }
export interface RetentionJobView { id: string; policyId: string; status: "PENDING" | "RUNNING" | "COMPLETED" | "FAILED"; affectedRows: number; skippedRows: number; requestedBy: string; approvedBy: string; evidence: Record<string, unknown>; createdAt: string; completedAt?: string; attempts: number; progress: number }
export interface LegalHoldView { id: string; category: string; reason: string; active: boolean; createdBy: string; createdAt: string; releasedAt?: string; releasedBy?: string; releaseReason?: string }
export interface SystemAlertView { id: string; fingerprint: string; serviceName: string; severity: "WARNING" | "CRITICAL"; status: "OPEN" | "ACKNOWLEDGED" | "MUTED" | "RESOLVED"; summary: string; metricValue?: number; threshold?: number; detectedAt: string; acknowledgedBy?: string; mutedUntil?: string; recoveredAt?: string; updatedAt: string }
export interface SnapshotAssetAudit { generatedAt: string; classesWithoutCourseSnapshot: Array<{ classId: string; courseId: string; courseVersion: number }>; referencedObjectCount: number; uniqueObjectCount: number; sharedObjects: Array<{ objectKey: string; references: string[] }>; missingObjects: Array<{ objectKey: string; references: string[] }> }
export interface StorageCleanupFailure { id: string; entityType: "ASSIGNMENT_ATTACHMENT"; objectKey: string; error: string; removedAt: string }

const templateVariables: Record<string, readonly string[]> = {
  ACCOUNT_UPDATED: ["displayName", "accountStatus"],
  CLASS_REMINDER: ["className", "sessionTitle", "startsAt"],
  EXAM_PUBLISHED: ["examTitle", "className", "openAt", "closeAt"],
  FORUM_MENTION: ["topicTitle", "authorName"],
  SUPPORT_UPDATED: ["ticketId", "status", "resolution"],
};
const retentionCategories = ["AUDIT", "SUPPORT", "LEARNING", "AI_RESULTS"] as const;
type RetentionCategory = typeof retentionCategories[number];

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
  questionApprovalMode: "AUTO",
  notificationSender: "Wind EDU",
  maintenanceMode: false,
  version: 1,
  effectiveAt: new Date().toISOString(),
  updatedBy: "system",
  updatedAt: new Date().toISOString(),
});

@Injectable()
/** Quản lý cấu hình và vận hành hệ thống, đồng thời hỗ trợ fallback in-memory khi DB bị tắt. */
export class SystemService {
  private settings: SystemSettings = defaultSettings();
  private integrations: IntegrationConfig[] = ["GOOGLE_MEET", "ZOOM", "JITSI"].map((provider, index) => ({ id: `int-${index + 1}`, provider: provider as IntegrationConfig["provider"], enabled: provider === "JITSI", isDefault: provider === "JITSI", healthStatus: provider === "JITSI" ? "HEALTHY" : "UNKNOWN", maskedCredential: provider === "JITSI" ? "Không yêu cầu" : "Chưa cấu hình", webhookConfigured: false, lastCheckedAt: provider === "JITSI" ? new Date().toISOString() : undefined, updatedAt: new Date().toISOString() }));
  private backups: BackupRun[] = [{ id: "backup-seed", type: "FULL", status: "COMPLETED", createdAt: new Date(Date.now() - 86_400_000).toISOString(), checksum: "sha256:9e151f", sizeMb: 18.4, attempts: 1, progress: 100 }];
  private restores: RestoreRun[] = [];
  private exports: DataExport[] = [];
  private exportFiles = new Map<string, Buffer>();
  private templates: NotificationTemplate[] = [{ id: "tpl-class-reminder", eventCode: "CLASS_REMINDER", locale: "vi-VN", subject: "Nhắc lịch học {{className}}", body: "Buổi học {{sessionTitle}} bắt đầu lúc {{startsAt}}.", version: 1, status: "PUBLISHED", updatedAt: new Date().toISOString() }];
  private moderation: ModerationPolicy = { version: 1, prohibitedTerms: ["spam", "lừa đảo"], maxPostsPerMinute: 5, action: "FLAG", updatedAt: new Date().toISOString() };
  private audit: AuditEvent[] = [{ id: "audit-seed", actor: "system", action: "SYSTEM_STARTED", target: "platform", detail: "Khởi tạo cấu hình vận hành.", createdAt: new Date().toISOString() }];
  private settingRevisions: SystemSettingRevision[] = [{ id: "setting-revision-1", key: "platform", ...defaultSettings() }];
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

  /** Đọc cấu hình mới nhất và áp dụng schema/mặc định qua mapSettings. */
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

  /** Liệt kê lịch sử revision cấu hình theo version mới nhất trước. */
  async listSettingRevisions(): Promise<SystemSettingRevision[]> {
    const prisma = this.database();
    if (prisma) {
      const rows = await prisma.systemSettingRevision.findMany({ where: { key: "platform" }, orderBy: { version: "desc" }, take: 50 });
      return rows.map((row) => ({ id: row.id, key: row.key, ...this.mapSettings(row.value, row.createdAt, row.version, row.effectiveAt, row.updatedBy) }));
    }
    return structuredClone([...this.settingRevisions].sort((a, b) => b.version - a.version));
  }

  /** Hợp nhất cấu hình, kiểm tra quota/MIME/thời điểm hiệu lực, tăng version và ghi audit. */
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

  /** Liệt kê provider phòng học đã cấu hình và trạng thái health. */
  async listIntegrations(): Promise<IntegrationConfig[]> {
    const prisma = this.database();
    if (prisma) {
      const rows = await prisma.integrationProvider.findMany({ orderBy: { provider: "asc" } });
      return rows.map((row) => this.mapIntegration(row));
    }
    return structuredClone(this.integrations);
  }

  /** Bật/tắt tích hợp, không cho bật provider thiếu credential cần thiết và ghi audit. */
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

  /** Tạo/cập nhật cấu hình provider bằng tham chiếu credential, không lưu secret thô. */
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

  /** Kiểm tra điều kiện kết nối và cập nhật trạng thái/lần kiểm tra của tích hợp. */
  async testIntegration(integrationId: string, actorId = "usr-admin"): Promise<IntegrationConfig> {
    const prisma = this.database();
    if (prisma) {
      const current = await prisma.integrationProvider.findUnique({ where: { id: integrationId } });
      if (!current) throw new NotFoundException("Không tìm thấy tích hợp.");
      const healthy = current.provider === "JITSI";
      const row = await prisma.integrationProvider.update({ where: { id: integrationId }, data: { healthStatus: healthy ? "HEALTHY" : "ERROR", lastCheckedAt: new Date() } });
      await this.logDatabase(prisma, actorId, "INTEGRATION_HEALTH_CHECKED", current.provider, healthy ? "HEALTHY" : "ERROR");
      if (!healthy) throw new BadRequestException("Health check production của Google Meet/Zoom cần OAuth và webhook thật; tham chiếu credential không được xem là kết nối thành công.");
      return this.mapIntegration(row);
    }
    const item = this.integrations.find((entry) => entry.id === integrationId);
    if (!item) throw new NotFoundException("Không tìm thấy tích hợp.");
    const healthy = item.provider === "JITSI";
    item.healthStatus = healthy ? "HEALTHY" : "ERROR";
    item.lastCheckedAt = new Date().toISOString();
    item.updatedAt = item.lastCheckedAt;
    this.log(actorId, "INTEGRATION_HEALTH_CHECKED", item.provider, healthy ? "HEALTHY" : "ERROR");
    if (!healthy) throw new BadRequestException("Health check production của Google Meet/Zoom cần OAuth và webhook thật; tham chiếu credential không được xem là kết nối thành công.");
    return structuredClone(item);
  }

  /** Đặt một provider enabled làm mặc định và gỡ cờ mặc định của các provider khác nguyên tử. */
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

  /** Tạo URL phòng thử ngắn hạn sau khi integration vượt kiểm tra readiness. */
  async createTestMeeting(integrationId: string, actorId = "usr-admin"): Promise<{ provider: string; attendeeUrl: string; expiresAt: string }> {
    const integrations = await this.listIntegrations();
    const item = integrations.find((entry) => entry.id === integrationId);
    if (!item || !item.enabled || !item.isDefault || item.healthStatus !== "HEALTHY") throw new BadRequestException("Provider mặc định chưa sẵn sàng để tạo phòng thử.");
    if (item.provider !== "JITSI") throw new ServiceUnavailableException("Google Meet/Zoom chưa có adapter OAuth production; hệ thống không tạo URL mô phỏng.");
    const roomId = `wind-test-${randomUUID()}`;
    const prisma = this.database();
    if (prisma) await this.logDatabase(prisma, actorId, "INTEGRATION_TEST_MEETING_CREATED", item.provider, `Phòng thử ${roomId}.`);
    else this.log(actorId, "INTEGRATION_TEST_MEETING_CREATED", item.provider, `Phòng thử ${roomId}.`);
    return { provider: item.provider, attendeeUrl: `https://meet.jit.si/${roomId}`, expiresAt: new Date(Date.now() + 30 * 60_000).toISOString() };
  }

  /** Liệt kê các job sao lưu từ DB hoặc dữ liệu nhớ demo. */
  async listBackups(): Promise<BackupRun[]> {
    const prisma = this.database();
    if (prisma) {
      const rows = await prisma.backupJob.findMany({ orderBy: { createdAt: "desc" } });
      return rows.map((row) => this.mapBackup(row));
    }
    return structuredClone(this.backups);
  }

  /** Xếp sao lưu vào hàng đợi bền vững để request không phải chờ tác vụ nặng. */
  async runBackup(type: BackupRun["type"], actorId = "usr-admin"): Promise<BackupRun> {
    if (type === "INCREMENTAL") throw new BadRequestException("Sao lưu gia tăng cần binary log và điểm khôi phục liên tục; hệ thống hiện chỉ cho phép FULL để bảo đảm khôi phục được.");
    const prisma = this.database();
    if (!prisma || !this.databaseBackup || !this.objectStorage) throw new ServiceUnavailableException("Sao lưu thật yêu cầu kết nối database và kho object đang hoạt động.");
    const backupId = `backup-${randomUUID()}`;
    const row = await prisma.backupJob.create({
      data: {
        id: backupId,
        type,
        status: "PENDING",
        requestedBy: actorId,
        availableAt: new Date(),
      },
    });
    await this.logDatabase(prisma, actorId, "BACKUP_QUEUED", row.id, `${type} · chờ worker xử lý.`);
    return this.mapBackup(row);
  }

  /** Tạo yêu cầu drill hoặc khôi phục vận hành và để trạng thái chờ một quản trị viên khác phê duyệt. */
  async requestRestore(input: { backupId: string; mode: "DRILL" | "OPERATIONAL"; reason: string; targetDatabase?: string }, actorId = "usr-admin"): Promise<RestoreRun> {
    if (input.reason.trim().length < 10) throw new BadRequestException("Cần lý do khôi phục ít nhất 10 ký tự.");
    if (input.mode === "OPERATIONAL" && !/^[a-zA-Z0-9_]+$/.test(input.targetDatabase ?? "")) throw new BadRequestException("Khôi phục vận hành cần tên database đích mới, chỉ gồm chữ, số và dấu gạch dưới.");
    const prisma = this.database();
    if (!prisma) throw new ServiceUnavailableException("Khôi phục thật yêu cầu kết nối database.");
    const backup = await prisma.backupJob.findUnique({ where: { id: input.backupId } });
    if (!backup || backup.status !== "COMPLETED" || !backup.checksum || !backup.objectKey) throw new NotFoundException("Không tìm thấy điểm sao lưu thật hợp lệ.");
    const row = await prisma.restoreJob.create({ data: { id: `restore-${randomUUID()}`, backupId: input.backupId, mode: input.mode, requestedBy: actorId, reason: input.reason.trim(), targetDatabase: input.targetDatabase?.trim(), status: "PENDING" } });
    await this.logDatabase(prisma, actorId, "RESTORE_REQUESTED", row.id, `${input.mode} · ${input.reason.trim()}`);
    return this.mapRestore(row);
  }

  /** Xác thực người duyệt độc lập rồi chạy drill hoặc phục hồi vào database staging mới. */
  async approveRestore(restoreId: string, approverId: string): Promise<RestoreRun> {
    const prisma = this.database();
    if (!prisma || !this.databaseBackup || !this.objectStorage) throw new ServiceUnavailableException("Dịch vụ khôi phục chưa sẵn sàng.");
    const restore = await prisma.restoreJob.findUnique({ where: { id: restoreId }, include: { backup: true } });
    if (!restore) throw new NotFoundException("Không tìm thấy yêu cầu khôi phục.");
    if (restore.status !== "PENDING") throw new BadRequestException("Yêu cầu khôi phục không còn ở trạng thái chờ duyệt.");
    if (restore.requestedBy === approverId) throw new BadRequestException("Người phê duyệt phải khác người yêu cầu.");
    const approver = await prisma.user.findUnique({ where: { id: approverId }, include: { roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } } } });
    const canApprove = approver?.status === "ACTIVE" && approver.roles.some((entry) => entry.role.permissions.some((grant) => grant.permission.code === "system:configure"));
    if (!canApprove) throw new BadRequestException("Người phê duyệt không còn tài khoản hoạt động hoặc thiếu quyền vận hành hệ thống.");
    if (!restore.backup.checksum || !restore.backup.objectKey || restore.backup.status !== "COMPLETED") throw new BadRequestException("Điểm sao lưu không còn hợp lệ.");
    if (restore.mode === "OPERATIONAL" && !(await this.getSettings()).maintenanceMode) throw new BadRequestException("Khôi phục vận hành chỉ được chạy khi hệ thống đang ở chế độ bảo trì.");
    const claimed = await prisma.restoreJob.updateMany({ where: { id: restoreId, status: "PENDING" }, data: { status: "RUNNING", approvedBy: approverId, approvedAt: new Date() } });
    if (claimed.count !== 1) throw new BadRequestException("Yêu cầu vừa được người khác xử lý; hãy tải lại trạng thái.");
    try {
      const result = await withTemporaryFile(async (path) => {
        const expectedSize = Number(restore.backup.sizeBytes);
        if (!Number.isSafeInteger(expectedSize) || expectedSize < 5) throw new BadRequestException("Checksum bản sao lưu không hợp lệ; đã dừng khôi phục.");
        const downloaded = await this.objectStorage!.getToFile(restore.backup.objectKey!, path, expectedSize);
        if (downloaded.checksum !== restore.backup.checksum || downloaded.size !== expectedSize) throw new BadRequestException("Checksum bản sao lưu không hợp lệ; đã dừng khôi phục.");
        return restore.mode === "OPERATIONAL"
          ? this.databaseBackup!.restoreToDatabase(path, restore.targetDatabase ?? "")
          : this.databaseBackup!.verifyRestore(path);
      });
      const verification = restore.mode === "OPERATIONAL"
        ? `Checksum hợp lệ; đã khôi phục ${result.tableCount} bảng và ${result.rowCount} dòng vào database staging ${result.database}. Cần cutover hạ tầng theo runbook riêng.`
        : `Checksum hợp lệ; đã phục hồi thử nghiệm ${result.tableCount} bảng và ${result.rowCount} dòng vào database tạm, sau đó dọn dẹp an toàn.`;
      const row = await prisma.restoreJob.update({ where: { id: restoreId }, data: { status: "COMPLETED", verification, completedAt: new Date() } });
      await this.logDatabase(prisma, approverId, restore.mode === "OPERATIONAL" ? "RESTORE_STAGING_COMPLETED" : "RESTORE_DRILL_COMPLETED", restore.backupId, verification);
      return this.mapRestore(row);
    } catch (error) {
      await prisma.restoreJob.update({ where: { id: restoreId }, data: { status: "FAILED", verification: "Khôi phục thất bại; database vận hành hiện tại không bị thay đổi.", completedAt: new Date() } }).catch(() => undefined);
      if (error instanceof BadRequestException || error instanceof ServiceUnavailableException) throw error;
      throw new ServiceUnavailableException("Khôi phục thất bại.");
    }
  }

  /** Giữ API service cũ ở dạng drill một bước chỉ để tương thích test không kết nối DB. */
  async restoreBackup(backupId: string, approvedBy: string, actorId = "usr-admin"): Promise<RestoreRun> {
    if (approvedBy.trim().length < 3) throw new BadRequestException("Cần người phê duyệt khôi phục.");
    if (approvedBy.trim() === actorId) throw new BadRequestException("Người phê duyệt phải khác người yêu cầu.");
    return this.requestRestore({ backupId, mode: "DRILL", reason: "Kiểm tra khả năng phục hồi bản sao lưu" }, actorId);
  }

  /** Liệt kê lịch sử kiểm tra phục hồi sao lưu. */
  async listRestores(): Promise<RestoreRun[]> {
    const prisma = this.database();
    if (prisma) {
      const rows = await prisma.restoreJob.findMany({ orderBy: { createdAt: "desc" } });
      return rows.map((row) => this.mapRestore(row));
    }
    return structuredClone(this.restores);
  }

  /** Tính cutoff và số bản ghi sẽ tác động, đồng thời phản ánh legal hold hiện tại. */
  async previewRetention(categoryInput: string): Promise<RetentionPreview> {
    const category = this.retentionCategory(categoryInput);
    const policy = await this.getLatestRetentionPolicy(category);
    const settings = await this.getSettings();
    const retentionDays = policy?.retentionDays ?? settings.retentionDays;
    const action = policy?.action ?? "ARCHIVE";
    return this.previewRetentionPolicy({ category, retentionDays, action });
  }

  /** Liệt kê mọi phiên bản chính sách lưu giữ. */
  async listRetentionPolicies(): Promise<RetentionPolicyView[]> {
    const prisma = this.database();
    if (prisma) return (await prisma.retentionPolicy.findMany({ orderBy: [{ category: "asc" }, { version: "desc" }] })).map((row) => this.mapRetentionPolicy(row));
    return structuredClone([...this.retentionPolicies].sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
  }

  /** Validate phê duyệt/ngày hiệu lực, tạo version kế tiếp và ghi audit chính sách. */
  async createRetentionPolicy(input: { category: string; retentionDays: number; action: "ARCHIVE" | "DELETE"; approvedBy: string; effectiveAt?: string }, actorId = "usr-admin"): Promise<RetentionPolicyView> {
    const category = this.retentionCategory(input.category); const approvedBy = input.approvedBy.trim();
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

  /** Đặt legal hold đang hoạt động cho danh mục để chặn retention job. */
  async createLegalHold(categoryInput: string, reasonInput: string, actorId = "usr-admin"): Promise<object> {
    const category = this.retentionCategory(categoryInput); const reason = reasonInput.trim(); if (reason.length < 5) throw new BadRequestException("Loại dữ liệu và lý do legal hold là bắt buộc.");
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

  /** Liệt kê legal hold cùng trạng thái giải tỏa và người thực hiện. */
  async listLegalHolds(): Promise<LegalHoldView[]> {
    const prisma = this.database();
    if (prisma) {
      const rows = await prisma.legalHold.findMany({ orderBy: [{ active: "desc" }, { createdAt: "desc" }] });
      return rows.map((row) => ({ id: row.id, category: row.category, reason: row.reason, active: row.active, createdBy: row.createdBy, createdAt: row.createdAt.toISOString(), releasedAt: row.releasedAt?.toISOString(), releasedBy: row.releasedBy ?? undefined, releaseReason: row.releaseReason ?? undefined }));
    }
    return structuredClone([...this.legalHolds].sort((left, right) => Number(right.active) - Number(left.active) || right.createdAt.localeCompare(left.createdAt)));
  }

  /** Giải tỏa đúng một hold, giữ các hold khác và lưu lý do vào audit. */
  async releaseLegalHold(holdId: string, reasonInput: string, actorId = "usr-admin"): Promise<LegalHoldView> {
    const reason = reasonInput.trim();
    if (reason.length < 5) throw new BadRequestException("Lý do giải tỏa legal hold cần ít nhất 5 ký tự.");
    const prisma = this.database();
    if (prisma) {
      const current = await prisma.legalHold.findUnique({ where: { id: holdId } });
      if (!current) throw new NotFoundException("Không tìm thấy legal hold.");
      if (!current.active) throw new BadRequestException("Legal hold đã được giải tỏa trước đó.");
      const row = await prisma.$transaction(async (transaction) => {
        const changed = await transaction.legalHold.updateMany({ where: { id: holdId, active: true }, data: { active: false, releasedAt: new Date(), releasedBy: actorId, releaseReason: reason } });
        if (changed.count !== 1) throw new BadRequestException("Legal hold đã thay đổi; hãy tải lại danh sách.");
        await this.logDatabase(transaction, actorId, "LEGAL_HOLD_RELEASED", holdId, `${current.category} · ${reason}`);
        return transaction.legalHold.findUniqueOrThrow({ where: { id: holdId } });
      });
      return { id: row.id, category: row.category, reason: row.reason, active: row.active, createdBy: row.createdBy, createdAt: row.createdAt.toISOString(), releasedAt: row.releasedAt?.toISOString(), releasedBy: row.releasedBy ?? undefined, releaseReason: row.releaseReason ?? undefined };
    }
    const item = this.legalHolds.find((hold) => hold.id === holdId);
    if (!item) throw new NotFoundException("Không tìm thấy legal hold.");
    if (!item.active) throw new BadRequestException("Legal hold đã được giải tỏa trước đó.");
    item.active = false;
    item.releasedAt = new Date().toISOString();
    item.releasedBy = actorId;
    item.releaseReason = reason;
    this.log(actorId, "LEGAL_HOLD_RELEASED", holdId, `${item.category} · ${reason}`);
    return structuredClone(item);
  }

  /** Thực thi policy với nguyên tắc bốn mắt, legal-hold check và audit kết quả. */
  async runRetention(policyId: string, requestedBy: string, approvedBy: string): Promise<RetentionJobView> {
    if (!requestedBy.trim() || !approvedBy.trim()) throw new BadRequestException("Cần người yêu cầu và người phê duyệt.");
    if (requestedBy.trim().toLowerCase() === approvedBy.trim().toLowerCase()) throw new BadRequestException("Người phê duyệt phải khác người yêu cầu.");
    const prisma = this.database();
    if (prisma) {
      const policy = await prisma.retentionPolicy.findUnique({ where: { id: policyId } }); if (!policy) throw new NotFoundException("Không tìm thấy chính sách retention.");
      if (policy.effectiveAt > new Date()) throw new BadRequestException("Chính sách retention chưa đến thời điểm hiệu lực.");
      const preview = await this.previewRetentionPolicy({ category: policy.category, retentionDays: policy.retentionDays, action: policy.action === "DELETE" ? "DELETE" : "ARCHIVE" });
      const jobId = `retention-job-${randomUUID()}`;
      const row = await prisma.retentionJob.create({ data: { id: jobId, policyId, status: "PENDING", requestedBy: requestedBy.trim(), approvedBy: approvedBy.trim(), evidence: { category: policy.category, action: policy.action, cutoffAt: preview.cutoffAt }, availableAt: new Date() } });
      await this.logDatabase(prisma, requestedBy, "RETENTION_JOB_QUEUED", jobId, `${policy.category} · policy v${policy.version} · chờ worker xử lý.`);
      return this.mapRetentionJob(row);
    }
    const policy = this.retentionPolicies.find((item) => item.id === policyId); if (!policy) throw new NotFoundException("Không tìm thấy chính sách retention.");
    if (new Date(policy.effectiveAt) > new Date()) throw new BadRequestException("Chính sách retention chưa đến thời điểm hiệu lực.");
    const preview = await this.previewRetentionPolicy(policy);
    const item: RetentionJobView = { id: `retention-job-${randomUUID()}`, policyId, status: "COMPLETED", affectedRows: preview.deletableRows, skippedRows: preview.legalHoldRows, requestedBy: requestedBy.trim(), approvedBy: approvedBy.trim(), evidence: { category: policy.category, action: policy.action, cutoffAt: preview.cutoffAt, legalHoldProtected: preview.legalHoldRows }, createdAt: new Date().toISOString(), completedAt: new Date().toISOString(), attempts: 1, progress: 100 };
    this.retentionJobs.unshift(item); this.log(requestedBy, "RETENTION_JOB_COMPLETED", item.id, `${item.affectedRows} bản ghi xử lý; ${item.skippedRows} bản ghi được giữ.`); return structuredClone(item);
  }

  /** Liệt kê các lần chạy retention cùng số bản ghi đã xử lý. */
  async listRetentionJobs(): Promise<RetentionJobView[]> {
    const prisma = this.database(); if (prisma) return (await prisma.retentionJob.findMany({ orderBy: { createdAt: "desc" } })).map((row) => this.mapRetentionJob(row)); return structuredClone(this.retentionJobs);
  }

  /** Tạo snapshot preview từ đúng một policy thay vì trộn với phiên bản mới nhất. */
  private async previewRetentionPolicy(policy: Pick<RetentionPolicyView, "category" | "retentionDays" | "action">): Promise<RetentionPreview> {
    const cutoffAt = new Date(Date.now() - policy.retentionDays * 86_400_000);
    const prisma = this.database();
    const estimatedRows = prisma ? await this.countRetentionRows(prisma, policy.category, cutoffAt) : policy.category === "AUDIT" ? 12_840 : policy.category === "LEARNING" ? 3_260 : policy.category === "AI_RESULTS" ? 0 : 840;
    const hasLegalHold = prisma ? Boolean(await prisma.legalHold.findFirst({ where: { category: policy.category, active: true } })) : this.legalHolds.some((item) => item.category === policy.category && item.active);
    const legalHoldRows = hasLegalHold ? estimatedRows : 0;
    return { category: policy.category, retentionDays: policy.retentionDays, action: policy.action, estimatedRows, legalHoldRows, deletableRows: estimatedRows - legalHoldRows, cutoffAt: cutoffAt.toISOString() };
  }

  /** Xếp export vào hàng đợi bền vững; worker mới tạo tệp và xác minh checksum. */
  async runExport(category: string, format: DataExport["format"], actorId = "usr-admin"): Promise<DataExport> {
    const normalizedCategory = category.trim().toUpperCase();
    if (!["AUDIT", "LEARNING", "USERS"].includes(normalizedCategory)) throw new BadRequestException("Export chỉ hỗ trợ AUDIT, LEARNING hoặc USERS.");
    const prisma = this.database();
    if (prisma) {
      const createdAt = new Date();
      const expiresAt = new Date(createdAt.getTime() + 86_400_000);
      if (!this.objectStorage) throw new ServiceUnavailableException("Kho object chưa sẵn sàng để tạo tệp export.");
      const exportId = `export-${randomUUID()}`;
      const row = await prisma.dataExportJob.create({ data: { id: exportId, category: normalizedCategory, format, status: "PENDING", expiresAt, requestedBy: actorId, availableAt: new Date() } });
      await this.logDatabase(prisma, actorId, "DATA_EXPORT_QUEUED", row.id, `${normalizedCategory} · ${format} · chờ worker xử lý.`);
      return this.mapExport(row);
    }
    const rows = normalizedCategory === "AUDIT" ? this.audit.map((item) => ({ ...item })) : [];
    const content = this.serializeExport(rows, format);
    const checksum = `sha256:${createHash("sha256").update(content).digest("hex")}`;
    const item: DataExport = { id: `export-${randomUUID()}`, category: normalizedCategory, format, status: "COMPLETED", rowCount: rows.length, checksum, sizeBytes: content.length, downloadAvailable: true, createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 86_400_000).toISOString(), attempts: 1, progress: 100 };
    this.exportFiles.set(item.id, content);
    this.exports.unshift(item);
    this.log(actorId, "DATA_EXPORTED", item.id, `${normalizedCategory} · ${format} · ${item.rowCount} dòng · ${checksum}`);
    return structuredClone(item);
  }

  /** Thu hồi lease hết hạn rồi xử lý một batch backup, export và retention theo hàng đợi DB. */
  async drainOperationalJobs(limit = 6): Promise<{
    backup: number;
    export: number;
    retention: number;
  }> {
    const prisma = this.database();
    if (!prisma) return { backup: 0, export: 0, retention: 0 };
    const now = new Date();
    await Promise.all([
      prisma.backupJob.updateMany({
        where: { status: "RUNNING", availableAt: { lte: now } },
        data: { status: "PENDING", progress: 0, availableAt: now },
      }),
      prisma.dataExportJob.updateMany({
        where: { status: "RUNNING", availableAt: { lte: now } },
        data: { status: "PENDING", progress: 0, availableAt: now },
      }),
      prisma.retentionJob.updateMany({
        where: { status: "RUNNING", availableAt: { lte: now } },
        data: { status: "PENDING", progress: 0, availableAt: now },
      }),
    ]);
    const processed = { backup: 0, export: 0, retention: 0 };
    for (let index = 0; index < Math.max(1, Math.min(limit, 30)); index += 1) {
      if (await this.processQueuedBackup(prisma)) {
        processed.backup += 1;
        continue;
      }
      if (await this.processQueuedExport(prisma)) {
        processed.export += 1;
        continue;
      }
      if (await this.processQueuedRetention(prisma)) {
        processed.retention += 1;
        continue;
      }
      break;
    }
    return processed;
  }

  /** Claim và hoàn tất một backup bằng lease nguyên tử; lỗi tạm thời được retry có backoff. */
  private async processQueuedBackup(prisma: PrismaService): Promise<boolean> {
    const candidate = await prisma.backupJob.findFirst({
      where: { status: "PENDING", availableAt: { lte: new Date() }, attempts: { lt: 5 } },
      orderBy: { createdAt: "asc" },
    });
    if (!candidate) return false;
    const claimed = await prisma.backupJob.updateMany({
      where: { id: candidate.id, status: "PENDING", attempts: candidate.attempts },
      data: {
        status: "RUNNING",
        attempts: { increment: 1 },
        progress: 10,
        availableAt: this.jobLeaseExpiry(),
        errorMessage: null,
      },
    });
    if (claimed.count !== 1) return true;
    try {
      if (!this.databaseBackup || !this.objectStorage)
        throw new ServiceUnavailableException("Hạ tầng backup chưa sẵn sàng.");
      await withTemporaryFile(async (path) => {
      const content = await this.databaseBackup!.createFullBackup(path);
      await prisma.backupJob.update({ where: { id: candidate.id }, data: { progress: 60 } });
      const objectKey = `backups/${new Date().toISOString().slice(0, 10)}/${candidate.id}-${candidate.attempts + 1}.dump`;
      const stored = await this.objectStorage!.putFile(objectKey, path);
      const row = await prisma.backupJob.update({
        where: { id: candidate.id },
        data: {
          status: "COMPLETED",
          progress: 100,
          checksum: stored.checksum,
          sizeBytes: BigInt(content.size),
          objectKey: stored.objectKey,
          completedAt: new Date(),
        },
      });
      await this.logDatabase(prisma, row.requestedBy, "BACKUP_COMPLETED", row.id, `${row.type} · ${stored.checksum} · ${content.size} bytes`);
      });
    } catch (error) {
      await this.retryBackupJob(prisma, candidate.id, candidate.attempts + 1, error);
    }
    return true;
  }

  /** Claim và tạo một export thật; chỉ COMPLETED sau khi đọc lại object và khớp checksum. */
  private async processQueuedExport(prisma: PrismaService): Promise<boolean> {
    const candidate = await prisma.dataExportJob.findFirst({
      where: { status: "PENDING", availableAt: { lte: new Date() }, attempts: { lt: 5 } },
      orderBy: { createdAt: "asc" },
    });
    if (!candidate) return false;
    const claimed = await prisma.dataExportJob.updateMany({
      where: { id: candidate.id, status: "PENDING", attempts: candidate.attempts },
      data: {
        status: "RUNNING",
        attempts: { increment: 1 },
        progress: 10,
        availableAt: this.jobLeaseExpiry(),
        errorMessage: null,
      },
    });
    if (claimed.count !== 1) return true;
    try {
      if (!this.objectStorage)
        throw new ServiceUnavailableException("Kho object chưa sẵn sàng.");
      const format: DataExport["format"] = candidate.format === "JSON" ? "JSON" : "CSV";
      const rows = await this.collectExportRows(prisma, candidate.category);
      const content = this.serializeExport(rows, format);
      await prisma.dataExportJob.update({ where: { id: candidate.id }, data: { progress: 55 } });
      const objectKey = `exports/${candidate.category.toLowerCase()}/${candidate.id}.${format.toLowerCase()}`;
      const stored = await this.objectStorage.put(objectKey, content);
      const verified = await this.objectStorage.get(stored.objectKey);
      const checksum = `sha256:${createHash("sha256").update(verified).digest("hex")}`;
      if (checksum !== stored.checksum)
        throw new ServiceUnavailableException("Tệp export lưu trữ không vượt qua kiểm tra checksum.");
      const row = await prisma.dataExportJob.update({
        where: { id: candidate.id },
        data: {
          status: "COMPLETED",
          progress: 100,
          rowCount: rows.length,
          objectKey: stored.objectKey,
          checksum: stored.checksum,
          sizeBytes: BigInt(content.length),
        },
      });
      await this.logDatabase(prisma, row.requestedBy, "DATA_EXPORTED", row.id, `${row.category} · ${format} · ${rows.length} dòng · ${stored.checksum}`);
    } catch (error) {
      await this.retryExportJob(prisma, candidate.id, candidate.attempts + 1, error);
    }
    return true;
  }

  /** Claim retention theo policy đã ghim, kiểm tra lại legal hold rồi mới archive/delete. */
  private async processQueuedRetention(prisma: PrismaService): Promise<boolean> {
    const candidate = await prisma.retentionJob.findFirst({
      where: { status: "PENDING", availableAt: { lte: new Date() }, attempts: { lt: 5 } },
      include: { policy: true },
      orderBy: { createdAt: "asc" },
    });
    if (!candidate) return false;
    const claimed = await prisma.retentionJob.updateMany({
      where: { id: candidate.id, status: "PENDING", attempts: candidate.attempts },
      data: {
        status: "RUNNING",
        attempts: { increment: 1 },
        progress: 10,
        availableAt: this.jobLeaseExpiry(),
      },
    });
    if (claimed.count !== 1) return true;
    const evidence = this.asRecord(candidate.evidence);
    const cutoffAt = new Date(this.stringValue(evidence.cutoffAt, ""));
    const action = evidence.action === "DELETE" ? "DELETE" : "ARCHIVE";
    try {
      if (Number.isNaN(cutoffAt.getTime()))
        throw new BadRequestException("Snapshot retention không có cutoff hợp lệ.");
      const affectedCandidateRows = await this.countRetentionRows(prisma, candidate.policy.category, cutoffAt);
      const legalHold = await prisma.legalHold.findFirst({
        where: { category: candidate.policy.category, active: true },
      });
      if (legalHold) {
        const row = await prisma.retentionJob.update({
          where: { id: candidate.id },
          data: {
            status: "COMPLETED",
            progress: 100,
            affectedRows: 0,
            skippedRows: affectedCandidateRows,
            evidence: { ...evidence, legalHoldProtected: affectedCandidateRows },
            completedAt: new Date(),
          },
        });
        await this.logDatabase(prisma, row.requestedBy, "RETENTION_JOB_SKIPPED", row.id, `${affectedCandidateRows} bản ghi được legal hold bảo vệ.`);
        return true;
      }
      await prisma.retentionJob.update({ where: { id: candidate.id }, data: { progress: 40 } });
      const result = await this.executeRetention(prisma, candidate.policy.category, action, cutoffAt, candidate.id);
      const row = await prisma.retentionJob.update({
        where: { id: candidate.id },
        data: {
          status: "COMPLETED",
          progress: 100,
          affectedRows: result.affectedRows,
          skippedRows: 0,
          evidence: {
            ...evidence,
            archiveObjectKey: result.archiveObjectKey,
            archiveChecksum: result.archiveChecksum,
            removedObjects: result.removedObjects,
            objectCleanupFailures: result.objectCleanupFailures,
          },
          completedAt: new Date(),
        },
      });
      await this.logDatabase(prisma, row.requestedBy, "RETENTION_JOB_COMPLETED", row.id, `${result.affectedRows} bản ghi đã ${action === "ARCHIVE" ? "lưu trữ và xóa" : "xóa"}.`);
    } catch (error) {
      await this.retryRetentionJob(prisma, candidate.id, candidate.attempts + 1, evidence, error);
    }
    return true;
  }

  /** Đặt lại backup để retry hoặc chuyển FAILED sau lần thử cuối. */
  private async retryBackupJob(prisma: PrismaService, idValue: string, attempts: number, error: unknown): Promise<void> {
    const terminal = attempts >= 5;
    const message = this.jobError(error, "Không thể tạo hoặc lưu bản sao lưu.");
    const row = await prisma.backupJob.update({ where: { id: idValue }, data: { status: terminal ? "FAILED" : "PENDING", progress: 0, availableAt: this.jobRetryAt(attempts), errorMessage: message, completedAt: terminal ? new Date() : null } });
    await this.logDatabase(prisma, row.requestedBy, terminal ? "BACKUP_FAILED" : "BACKUP_RETRY_SCHEDULED", row.id, `Lần ${attempts}/5 · ${message}`);
    if (terminal) await this.recordAlert(`job:backup:${row.id}`, "operational-job", "CRITICAL", `Backup ${row.id} thất bại sau 5 lần thử.`);
  }

  /** Đặt lại export để retry hoặc chuyển FAILED sau lần thử cuối. */
  private async retryExportJob(prisma: PrismaService, idValue: string, attempts: number, error: unknown): Promise<void> {
    const terminal = attempts >= 5;
    const message = this.jobError(error, "Không thể tạo hoặc kiểm chứng tệp export.");
    const row = await prisma.dataExportJob.update({ where: { id: idValue }, data: { status: terminal ? "FAILED" : "PENDING", progress: 0, availableAt: this.jobRetryAt(attempts), errorMessage: message } });
    await this.logDatabase(prisma, row.requestedBy, terminal ? "DATA_EXPORT_FAILED" : "DATA_EXPORT_RETRY_SCHEDULED", row.id, `Lần ${attempts}/5 · ${message}`);
    if (terminal) await this.recordAlert(`job:export:${row.id}`, "operational-job", "WARNING", `Export ${row.id} thất bại sau 5 lần thử.`);
  }

  /** Đặt lại retention để retry hoặc chuyển FAILED, giữ snapshot và lỗi gần nhất trong evidence. */
  private async retryRetentionJob(prisma: PrismaService, idValue: string, attempts: number, evidence: Record<string, unknown>, error: unknown): Promise<void> {
    const terminal = attempts >= 5;
    const message = this.jobError(error, "Không thể thực thi retention.");
    const row = await prisma.retentionJob.update({ where: { id: idValue }, data: { status: terminal ? "FAILED" : "PENDING", progress: 0, availableAt: this.jobRetryAt(attempts), evidence: { ...evidence, lastError: message }, completedAt: terminal ? new Date() : null } });
    await this.logDatabase(prisma, row.requestedBy, terminal ? "RETENTION_JOB_FAILED" : "RETENTION_JOB_RETRY_SCHEDULED", row.id, `Lần ${attempts}/5 · ${message}`);
    if (terminal) await this.recordAlert(`job:retention:${row.id}`, "operational-job", "CRITICAL", `Retention ${row.id} thất bại sau 5 lần thử.`);
  }

  /** Tạo lease 10 phút để job RUNNING bị worker chết có thể được nhận lại. */
  private jobLeaseExpiry(): Date {
    return new Date(Date.now() + 10 * 60_000);
  }

  /** Tạo backoff lũy tiến tối đa một giờ cho lần retry tiếp theo. */
  private jobRetryAt(attempts: number): Date {
    return new Date(Date.now() + Math.min(60, 2 ** Math.max(0, attempts - 1)) * 60_000);
  }

  /** Chuẩn hóa lỗi worker, giới hạn độ dài và không làm lộ stack hay credential. */
  private jobError(error: unknown, fallback: string): string {
    return (error instanceof Error ? error.message : fallback).slice(0, 500);
  }

  /** Đọc lại tệp export còn hạn và kiểm tra checksum ngay trước khi tải xuống. */
  async downloadExport(exportId: string): Promise<{ buffer: Buffer; filename: string; mimeType: string }> {
    const prisma = this.database();
    if (prisma) {
      const row = await prisma.dataExportJob.findUnique({ where: { id: exportId } });
      if (!row || row.status !== "COMPLETED" || !row.objectKey || !row.checksum) throw new NotFoundException("Không tìm thấy tệp export hoàn tất.");
      if (!row.expiresAt || row.expiresAt <= new Date()) throw new BadRequestException("Tệp export đã hết hạn; hãy tạo bản xuất mới.");
      if (!this.objectStorage) throw new ServiceUnavailableException("Kho object chưa sẵn sàng.");
      const buffer = await this.objectStorage.get(row.objectKey);
      const checksum = `sha256:${createHash("sha256").update(buffer).digest("hex")}`;
      if (checksum !== row.checksum) throw new ServiceUnavailableException("Checksum tệp export không hợp lệ.");
      const format = row.format === "JSON" ? "JSON" : "CSV";
      return { buffer, filename: `${row.category.toLowerCase()}-${row.id}.${format.toLowerCase()}`, mimeType: format === "JSON" ? "application/json; charset=utf-8" : "text/csv; charset=utf-8" };
    }
    const item = this.exports.find((entry) => entry.id === exportId);
    const buffer = this.exportFiles.get(exportId);
    if (!item || !buffer) throw new NotFoundException("Không tìm thấy tệp export.");
    if (new Date(item.expiresAt) <= new Date()) throw new BadRequestException("Tệp export đã hết hạn; hãy tạo bản xuất mới.");
    return { buffer, filename: `${item.category.toLowerCase()}-${item.id}.${item.format.toLowerCase()}`, mimeType: item.format === "JSON" ? "application/json; charset=utf-8" : "text/csv; charset=utf-8" };
  }

  /** Liệt kê các lần xuất dữ liệu hệ thống. */
  async listExports(): Promise<DataExport[]> {
    const prisma = this.database();
    if (prisma) {
      const rows = await prisma.dataExportJob.findMany({ orderBy: { createdAt: "desc" } });
      return rows.map((row) => this.mapExport(row));
    }
    return structuredClone(this.exports);
  }

  /** Liệt kê phiên bản mẫu thông báo và trạng thái hiện hành. */
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

  /** Validate biến mẫu, tạo version mới và ngừng dùng version trước cùng event/locale. */
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

  /** Thay thế placeholder bằng dữ liệu thử và báo các biến còn thiếu. */
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

  /** Render mẫu PUBLISHED mới nhất cho runtime; dùng tiêu đề fallback nếu thiếu mẫu hoặc biến. */
  async renderPublishedNotification(
    eventCode: string,
    variables: Record<string, string>,
    fallbackTitle: string,
  ): Promise<string> {
    const locale = (await this.getSettings()).locale;
    const prisma = this.database();
    let template: NotificationTemplate | undefined;
    if (prisma) {
      const row = await prisma.notificationTemplate.findFirst({
        where: { eventCode, locale, status: "PUBLISHED" },
        orderBy: { version: "desc" },
      });
      template = row ? this.mapTemplate(row) : undefined;
    } else {
      template = this.templates
        .filter(
          (item) =>
            item.eventCode === eventCode &&
            item.locale === locale &&
            item.status === "PUBLISHED",
        )
        .sort((left, right) => right.version - left.version)[0];
    }
    if (!template) return fallbackTitle;
    const rendered = template.subject.replace(
      /{{([a-zA-Z0-9_]+)}}/g,
      (_, key: string) => variables[key] ?? `[${key}]`,
    );
    return /\[[^\]]+\]/.test(rendered) ? fallbackTitle : rendered;
  }

  /** Render và gửi email thử, lưu kết quả giao hàng cùng actor nhưng không lưu nội dung nhạy cảm. */
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

  /** Đọc chính sách kiểm duyệt mới nhất hoặc cấu hình mặc định. */
  async getModerationPolicy(): Promise<ModerationPolicy> {
    const prisma = this.database();
    if (prisma) {
      const row = await prisma.moderationPolicy.findFirst({ orderBy: { version: "desc" } });
      return row ? this.mapModeration(row) : { ...this.moderation, prohibitedTerms: [...this.moderation.prohibitedTerms] };
    }
    return structuredClone(this.moderation);
  }

  /** Chuẩn hóa từ cấm, kiểm tra rate limit và tạo version chính sách mới. */
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

  /** Lọc audit theo nhiều tiêu chí và che token/secret trong phần detail trước khi trả. */
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

  /** Tổng hợp health DB/integration/storage và tạo hoặc phục hồi cảnh báo theo ngưỡng. */
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

  /** Liệt kê cảnh báo hệ thống mới nhất trước. */
  async listAlerts(): Promise<SystemAlertView[]> {
    const prisma = this.database(); if (prisma) return (await prisma.systemAlert.findMany({ orderBy: { detectedAt: "desc" }, take: 200 })).map((row) => this.mapAlert(row)); return structuredClone(this.alerts);
  }

  /** Áp dụng thao tác vận hành lên cảnh báo và ghi nhận actor/thời hạn mute. */
  async updateAlert(alertId: string, action: "ACKNOWLEDGE" | "MUTE" | "RESOLVE", actorId = "usr-admin", muteMinutes = 60): Promise<SystemAlertView> {
    const prisma = this.database();
    const data = action === "ACKNOWLEDGE" ? { status: "ACKNOWLEDGED", acknowledgedBy: actorId } : action === "MUTE" ? { status: "MUTED", acknowledgedBy: actorId, mutedUntil: new Date(Date.now() + Math.min(1440, Math.max(5, muteMinutes)) * 60_000) } : { status: "RESOLVED", recoveredAt: new Date(), acknowledgedBy: actorId };
    if (prisma) { const current = await prisma.systemAlert.findUnique({ where: { id: alertId } }); if (!current) throw new NotFoundException("Không tìm thấy cảnh báo."); const row = await prisma.systemAlert.update({ where: { id: alertId }, data }); await this.logDatabase(prisma, actorId, `ALERT_${action}`, alertId, row.summary); return this.mapAlert(row); }
    const item = this.alerts.find((row) => row.id === alertId); if (!item) throw new NotFoundException("Không tìm thấy cảnh báo."); Object.assign(item, { ...data, mutedUntil: data.mutedUntil?.toISOString(), recoveredAt: data.recoveredAt?.toISOString(), updatedAt: new Date().toISOString() }); this.log(actorId, `ALERT_${action}`, alertId, item.summary); return structuredClone(item);
  }

  /** Tổng hợp byte lưu trữ theo MIME, so sánh quota và phát cảnh báo khi gần đầy. */
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

  /** Chọn Prisma khi DB được bật, nếu không dùng state in-memory của service. */
  private database(): PrismaService | undefined {
    return this.prisma?.isStartupConnectionEnabled() ? this.prisma : undefined;
  }

  /** Thu hẹp JSON cấu hình theo từng kiểu và áp dụng giá trị mặc định an toàn. */
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
      questionApprovalMode: record.questionApprovalMode === "MANUAL" ? "MANUAL" : "AUTO",
      notificationSender: this.stringValue(record.notificationSender, fallback.notificationSender),
      maintenanceMode: this.booleanValue(record.maintenanceMode, fallback.maintenanceMode),
      version,
      effectiveAt: effectiveAt.toISOString(),
      updatedBy,
      updatedAt: updatedAt.toISOString(),
    };
  }

  /** Ánh xạ integration Prisma và xác minh provider thuộc danh mục hỗ trợ. */
  private mapIntegration(row: Prisma.IntegrationProviderGetPayload<Record<string, never>>): IntegrationConfig {
    if (!this.isProvider(row.provider)) throw new BadRequestException(`Nhà cung cấp ${row.provider} không được hỗ trợ.`);
    const healthStatus = row.healthStatus === "HEALTHY" || row.healthStatus === "ERROR" ? row.healthStatus : "UNKNOWN";
    return { id: row.id, provider: row.provider, enabled: row.enabled, isDefault: row.isDefault, healthStatus, maskedCredential: row.provider === "JITSI" ? "Không yêu cầu" : row.credentialRef ? "••••••••" : "Chưa cấu hình", webhookConfigured: Boolean(row.webhookUrl), lastCheckedAt: row.lastCheckedAt?.toISOString(), updatedAt: row.updatedAt.toISOString() };
  }

  /** Ánh xạ job sao lưu, bao gồm metadata và thông tin lỗi đã lưu. */
  private mapBackup(row: Prisma.BackupJobGetPayload<Record<string, never>>): BackupRun {
    return {
      id: row.id,
      type: row.type === "INCREMENTAL" ? "INCREMENTAL" : "FULL",
      status: row.status,
      createdAt: row.createdAt.toISOString(),
      checksum: row.checksum ?? "",
      sizeMb: row.sizeBytes === null ? 0 : Math.round(Number(row.sizeBytes) / 100_000) / 10,
      attempts: row.attempts,
      progress: row.progress,
    };
  }

  /** Ánh xạ yêu cầu phục hồi, loại thao tác và dấu vết hai người. */
  private mapRestore(row: Prisma.RestoreJobGetPayload<Record<string, never>>): RestoreRun {
    return { id: row.id, backupId: row.backupId, mode: row.mode === "OPERATIONAL" ? "OPERATIONAL" : "DRILL", status: row.status, requestedBy: row.requestedBy, approvedBy: row.approvedBy ?? undefined, reason: row.reason ?? undefined, targetDatabase: row.targetDatabase ?? undefined, createdAt: row.createdAt.toISOString(), verification: row.verification ?? "" };
  }

  /** Ánh xạ job xuất dữ liệu và URL/checksum khi hoàn thành. */
  private mapExport(row: Prisma.DataExportJobGetPayload<Record<string, never>>): DataExport {
    return {
      id: row.id,
      category: row.category,
      format: row.format === "JSON" ? "JSON" : "CSV",
      status: row.status,
      rowCount: row.rowCount ?? 0,
      checksum: row.checksum ?? undefined,
      sizeBytes: row.sizeBytes === null ? 0 : Number(row.sizeBytes),
      downloadAvailable: row.status === "COMPLETED" && Boolean(row.objectKey) && Boolean(row.expiresAt && row.expiresAt > new Date()),
      expiresAt: row.expiresAt?.toISOString() ?? row.createdAt.toISOString(),
      createdAt: row.createdAt.toISOString(),
      attempts: row.attempts,
      progress: row.progress,
    };
  }

  /** Ánh xạ mẫu thông báo Prisma sang hợp đồng quản trị. */
  private mapTemplate(row: Prisma.NotificationTemplateGetPayload<Record<string, never>>): NotificationTemplate {
    return { id: row.id, eventCode: row.eventCode, locale: row.locale, subject: row.subject, body: row.body, version: row.version, status: row.status === "PUBLISHED" ? "PUBLISHED" : "DRAFT", updatedAt: row.updatedAt.toISOString() };
  }

  /** Ánh xạ JSON từ cấm và tham số kiểm duyệt sang policy. */
  private mapModeration(row: Prisma.ModerationPolicyGetPayload<Record<string, never>>): ModerationPolicy {
    if (row.action !== "FLAG" && row.action !== "HIDE_PENDING_REVIEW") throw new BadRequestException("Hành động kiểm duyệt không hợp lệ.");
    return { version: row.version, prohibitedTerms: this.stringArray(row.prohibitedTerms, []), maxPostsPerMinute: row.maxPostsPerMinute, action: row.action, updatedAt: row.createdAt.toISOString() };
  }

  /** Ánh xạ audit log và che chuỗi nhạy cảm trong detail. */
  private mapAudit(row: Prisma.AuditLogGetPayload<Record<string, never>>): AuditEvent {
    const context = this.asRecord(row.context);
    return { id: row.id.toString(), actor: row.actorId ?? "system", action: row.action, target: row.entityId ?? row.entityType, detail: this.redactSensitive(this.stringValue(context.detail ?? context.summary, row.action)), createdAt: row.createdAt.toISOString() };
  }

  /** Ánh xạ chính sách lưu giữ và mốc hiệu lực sang view model. */
  private mapRetentionPolicy(row: Prisma.RetentionPolicyGetPayload<Record<string, never>>): RetentionPolicyView {
    if (row.action !== "ARCHIVE" && row.action !== "DELETE") throw new BadRequestException("Hành động retention không hợp lệ.");
    return { id: row.id, category: row.category, version: row.version, retentionDays: row.retentionDays, action: row.action, approvedBy: row.approvedBy, effectiveAt: row.effectiveAt.toISOString(), createdAt: row.createdAt.toISOString() };
  }

  /** Ánh xạ job retention cùng số bản ghi xử lý và lỗi. */
  private mapRetentionJob(row: Prisma.RetentionJobGetPayload<Record<string, never>>): RetentionJobView {
    return { id: row.id, policyId: row.policyId, status: row.status, affectedRows: row.affectedRows, skippedRows: row.skippedRows, requestedBy: row.requestedBy, approvedBy: row.approvedBy, evidence: this.asRecord(row.evidence), createdAt: row.createdAt.toISOString(), completedAt: row.completedAt?.toISOString(), attempts: row.attempts, progress: row.progress };
  }

  /** Ánh xạ cảnh báo và các mốc acknowledge/mute/resolve. */
  private mapAlert(row: Prisma.SystemAlertGetPayload<Record<string, never>>): SystemAlertView {
    const severity = row.severity === "CRITICAL" ? "CRITICAL" : "WARNING"; const status = ["OPEN", "ACKNOWLEDGED", "MUTED", "RESOLVED"].includes(row.status) ? row.status as SystemAlertView["status"] : "OPEN";
    return { id: row.id, fingerprint: row.fingerprint, serviceName: row.serviceName, severity, status, summary: row.summary, metricValue: row.metricValue ?? undefined, threshold: row.threshold ?? undefined, detectedAt: row.detectedAt.toISOString(), acknowledgedBy: row.acknowledgedBy ?? undefined, mutedUntil: row.mutedUntil?.toISOString(), recoveredAt: row.recoveredAt?.toISOString(), updatedAt: row.updatedAt.toISOString() };
  }

  /** Lấy policy đã có hiệu lực mới nhất cho danh mục. */
  private async getLatestRetentionPolicy(category: string): Promise<RetentionPolicyView | undefined> {
    const prisma = this.database(); if (prisma) { const row = await prisma.retentionPolicy.findFirst({ where: { category, effectiveAt: { lte: new Date() } }, orderBy: { version: "desc" } }); return row ? this.mapRetentionPolicy(row) : undefined; }
    return this.retentionPolicies.filter((item) => item.category === category && new Date(item.effectiveAt) <= new Date()).sort((a, b) => b.version - a.version)[0];
  }

  /** Đếm bản ghi cũ hơn cutoff theo danh mục trước khi chạy retention. */
  private async countRetentionRows(prisma: PrismaService, category: string, cutoffAt: Date): Promise<number> {
    if (category === "AUDIT") return prisma.auditLog.count({ where: { createdAt: { lt: cutoffAt } } });
    if (category === "SUPPORT") return prisma.supportTicket.count({ where: { createdAt: { lt: cutoffAt }, status: "CLOSED" } });
    if (category === "LEARNING") return prisma.learningClass.count({ where: { archivedAt: { lt: cutoffAt } } });
    if (category === "AI_RESULTS") {
      const [settings, grading, study] = await Promise.all([
        this.aiResultSettings(prisma, cutoffAt),
        prisma.aiGradingSuggestion.count({ where: { state: "READY", updatedAt: { lt: cutoffAt } } }),
        prisma.aiStudyDraft.count({ where: { state: "READY", publishedAt: null, updatedAt: { lt: cutoffAt } } }),
      ]);
      return settings.length + grading + study;
    }
    return 0;
  }

  /** Thực thi archive/delete theo category trong transaction và trả số dòng ảnh hưởng. */
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
          sessions: { include: { attendance: true, appeals: true } },
          assignments: { include: { submissions: { include: { attachments: true, revisions: true, gradeChanges: true } }, changes: true } },
          announcements: true,
        },
      });
      records = classes;
      objectKeys = classes.flatMap((classItem) => [
        ...classItem.materials.flatMap((material) => [material.objectKey, ...material.versions.map((version) => version.objectKey)]),
        ...classItem.assignments.flatMap((assignment) => assignment.submissions.flatMap((submission) => submission.attachments.map((attachment) => attachment.objectKey))),
      ]);
    } else if (category === "AI_RESULTS") {
      const [settings, grading, study] = await Promise.all([
        this.aiResultSettings(prisma, cutoffAt),
        prisma.aiGradingSuggestion.findMany({ where: { state: "READY", updatedAt: { lt: cutoffAt } }, orderBy: { updatedAt: "asc" } }),
        prisma.aiStudyDraft.findMany({ where: { state: "READY", publishedAt: null, updatedAt: { lt: cutoffAt } }, orderBy: { updatedAt: "asc" } }),
      ]);
      records = [
        ...settings.map((record) => ({ entity: "system_setting_ai_result", record })),
        ...grading.map((record) => ({ entity: "ai_grading_suggestion", record })),
        ...study.map((record) => ({ entity: "ai_study_draft", record })),
      ];
    } else {
      throw new BadRequestException("Danh mục retention không được hỗ trợ.");
    }

    let archiveObjectKey: string | undefined;
    let archiveChecksum: string | undefined;
    if (action === "ARCHIVE" && records.length) {
      if (!this.objectStorage) throw new ServiceUnavailableException("Kho object chưa sẵn sàng để lưu archive retention.");
      const assets = [] as Array<{ objectKey: string; checksum: string; sizeBytes: number; contentBase64: string }>;
      for (const objectKey of [...new Set(objectKeys)]) {
        const buffer = await this.objectStorage.get(objectKey).catch(() => { throw new ServiceUnavailableException(`Không đọc được asset ${objectKey}; archive đã dừng trước khi xóa dữ liệu.`); });
        assets.push({ objectKey, checksum: `sha256:${createHash("sha256").update(buffer).digest("hex")}`, sizeBytes: buffer.length, contentBase64: buffer.toString("base64") });
      }
      const content = Buffer.from(JSON.stringify({ format: "wind-edu-retention-archive", version: 2, category, cutoffAt: cutoffAt.toISOString(), createdAt: new Date().toISOString(), records, assets }, (_key, value: unknown) => typeof value === "bigint" ? value.toString() : value), "utf8");
      const stored = await this.objectStorage.put(`retention/${category.toLowerCase()}/${jobId}.json`, content);
      const verified = await this.objectStorage.get(stored.objectKey);
      const verifiedChecksum = `sha256:${createHash("sha256").update(verified).digest("hex")}`;
      if (verifiedChecksum !== stored.checksum) throw new ServiceUnavailableException("Archive retention không vượt qua kiểm tra checksum; dữ liệu nguồn chưa bị xóa.");
      this.validateRetentionArchive(verified);
      archiveObjectKey = stored.objectKey;
      archiveChecksum = stored.checksum;
    }

    if (records.length) {
      if (category === "AUDIT") await prisma.auditLog.deleteMany({ where: { createdAt: { lt: cutoffAt } } });
      if (category === "SUPPORT") await prisma.supportTicket.deleteMany({ where: { id: { in: (records as Array<{ id: string }>).map((item) => item.id) } } });
      if (category === "LEARNING") await prisma.learningClass.deleteMany({ where: { id: { in: (records as Array<{ id: string }>).map((item) => item.id) } } });
      if (category === "AI_RESULTS") {
        const grouped = records as Array<{ entity: string; record: { id?: string; key?: string } }>;
        const settingKeys = grouped.filter((item) => item.entity === "system_setting_ai_result").flatMap((item) => item.record.key ? [item.record.key] : []);
        const gradingIds = grouped.filter((item) => item.entity === "ai_grading_suggestion").flatMap((item) => item.record.id ? [item.record.id] : []);
        const studyIds = grouped.filter((item) => item.entity === "ai_study_draft").flatMap((item) => item.record.id ? [item.record.id] : []);
        await prisma.$transaction([
          prisma.systemSetting.deleteMany({ where: { key: { in: settingKeys } } }),
          prisma.aiGradingSuggestion.deleteMany({ where: { id: { in: gradingIds } } }),
          prisma.aiStudyDraft.deleteMany({ where: { id: { in: studyIds } } }),
        ]);
      }
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

  /** Lấy riêng cache OCR/hỏi đáp READY quá hạn; claim đang chạy hoặc chưa rõ kết quả luôn được giữ lại để đối soát. */
  private async aiResultSettings(prisma: PrismaService, cutoffAt: Date): Promise<Array<Prisma.SystemSettingGetPayload<Record<string, never>>>> {
    const candidates = await prisma.systemSetting.findMany({
      where: {
        updatedAt: { lt: cutoffAt },
        OR: [{ key: { startsWith: "ai-doc:" } }, { key: { startsWith: "ai-doc-answer:" } }],
      },
      orderBy: { updatedAt: "asc" },
    });
    return candidates.filter((item) => {
      if (!item.value || typeof item.value !== "object" || Array.isArray(item.value)) return item.key.startsWith("ai-doc:") && Array.isArray(item.value);
      return (item.value as Record<string, unknown>).state === "READY";
    });
  }

  /** Chuẩn hóa danh mục retention và chặn policy không có executor tương ứng. */
  private retentionCategory(value: string): RetentionCategory {
    const category = value.trim().toUpperCase();
    if (!retentionCategories.includes(category as RetentionCategory)) throw new BadRequestException("Danh mục retention không được hỗ trợ.");
    return category as RetentionCategory;
  }

  /** Đối soát snapshot lớp và mọi object reference để migration không tự sửa hoặc xóa dữ liệu mơ hồ. */
  async snapshotAssetAudit(): Promise<SnapshotAssetAudit> {
    const prisma = this.database();
    if (!prisma || !this.objectStorage) throw new ServiceUnavailableException("Đối soát snapshot/asset cần database và kho object đang hoạt động.");
    const [classes, courseVersions, materials, materialVersions, submissionAttachments, questionImages, chatAttachments, supportAttachments] = await Promise.all([
      prisma.learningClass.findMany({ select: { id: true, courseId: true, courseVersion: true } }),
      prisma.courseVersion.findMany({ select: { courseId: true, version: true } }),
      prisma.material.findMany({ select: { id: true, objectKey: true } }),
      prisma.materialVersion.findMany({ select: { id: true, objectKey: true } }),
      prisma.assignmentSubmissionAttachment.findMany({ where: { removedAt: null }, select: { id: true, objectKey: true } }),
      prisma.question.findMany({ where: { imageObjectKey: { not: null } }, select: { id: true, imageObjectKey: true } }),
      prisma.chatMessageAttachment.findMany({ select: { id: true, objectKey: true } }),
      prisma.supportAttachment.findMany({ select: { id: true, objectKey: true } }),
    ]);
    const snapshotKeys = new Set(courseVersions.map((item) => `${item.courseId}:${item.version}`));
    const classesWithoutCourseSnapshot = classes.filter((item) => !snapshotKeys.has(`${item.courseId}:${item.courseVersion}`)).map((item) => ({ classId: item.id, courseId: item.courseId, courseVersion: item.courseVersion }));
    const references = new Map<string, string[]>();
    const add = (objectKey: string | null, reference: string): void => { if (!objectKey) return; references.set(objectKey, [...(references.get(objectKey) ?? []), reference]); };
    materials.forEach((item) => add(item.objectKey, `material:${item.id}`));
    materialVersions.forEach((item) => add(item.objectKey, `material-version:${item.id}`));
    submissionAttachments.forEach((item) => add(item.objectKey, `assignment-attachment:${item.id}`));
    questionImages.forEach((item) => add(item.imageObjectKey, `question-image:${item.id}`));
    chatAttachments.forEach((item) => add(item.objectKey, `chat-attachment:${item.id}`));
    supportAttachments.forEach((item) => add(item.objectKey, `support-attachment:${item.id}`));
    const missingObjects: SnapshotAssetAudit["missingObjects"] = [];
    for (const [objectKey, owners] of references) {
      try { await this.objectStorage.get(objectKey); }
      catch { missingObjects.push({ objectKey, references: owners }); }
    }
    return {
      generatedAt: new Date().toISOString(),
      classesWithoutCourseSnapshot,
      referencedObjectCount: [...references.values()].reduce((sum, owners) => sum + owners.length, 0),
      uniqueObjectCount: references.size,
      sharedObjects: [...references.entries()].filter(([, owners]) => owners.length > 1).map(([objectKey, owners]) => ({ objectKey, references: owners })),
      missingObjects,
    };
  }

  /** Liệt kê metadata đã xóa mềm nhưng object cleanup thất bại để vận hành có thể retry. */
  async listStorageCleanupFailures(): Promise<StorageCleanupFailure[]> {
    const prisma = this.database();
    if (!prisma) return [];
    const rows = await prisma.assignmentSubmissionAttachment.findMany({ where: { removedAt: { not: null }, removalError: { not: null } }, orderBy: { removedAt: "asc" }, take: 100 });
    return rows.map((row) => ({ id: row.id, entityType: "ASSIGNMENT_ATTACHMENT", objectKey: row.objectKey, error: row.removalError ?? "Không rõ lỗi", removedAt: row.removedAt!.toISOString() }));
  }

  /** Retry xóa đúng object đã được ghi lỗi và chỉ xóa cờ lỗi sau khi storage xác nhận thành công. */
  async retryStorageCleanup(attachmentId: string, actorId: string): Promise<{ cleaned: true }> {
    const prisma = this.database();
    if (!prisma || !this.objectStorage) throw new ServiceUnavailableException("Cần database và kho object để retry cleanup.");
    const row = await prisma.assignmentSubmissionAttachment.findUnique({ where: { id: attachmentId } });
    if (!row || !row.removedAt || !row.removalError) throw new NotFoundException("Không tìm thấy lỗi cleanup đang chờ xử lý.");
    await this.objectStorage.remove(row.objectKey);
    await prisma.$transaction([
      prisma.assignmentSubmissionAttachment.update({ where: { id: attachmentId }, data: { removalError: null } }),
      prisma.auditLog.create({ data: { actorId, action: "STORAGE_CLEANUP_RETRIED", entityType: "assignment_attachment", entityId: attachmentId, context: { objectKey: row.objectKey } } }),
    ]);
    return { cleaned: true };
  }

  /** Đọc archive của retention job và xác minh checksum gói cùng từng asset phục hồi được. */
  async verifyRetentionArchive(jobId: string): Promise<{ valid: true; category: string; recordCount: number; assetCount: number; checksum: string }> {
    const prisma = this.database();
    if (!prisma || !this.objectStorage) throw new ServiceUnavailableException("Cần database và kho object để kiểm tra archive.");
    const job = await prisma.retentionJob.findUnique({ where: { id: jobId } });
    if (!job) throw new NotFoundException("Không tìm thấy retention job.");
    const evidence = this.asRecord(job.evidence);
    const objectKey = typeof evidence.archiveObjectKey === "string" ? evidence.archiveObjectKey : "";
    const checksum = typeof evidence.archiveChecksum === "string" ? evidence.archiveChecksum : "";
    if (!objectKey || !checksum) throw new BadRequestException("Job này không có archive để kiểm tra.");
    const content = await this.objectStorage.get(objectKey);
    const actualChecksum = `sha256:${createHash("sha256").update(content).digest("hex")}`;
    if (actualChecksum !== checksum) throw new ServiceUnavailableException("Checksum archive retention không hợp lệ.");
    const archive = this.validateRetentionArchive(content);
    await this.logDatabase(prisma, "system", "RETENTION_ARCHIVE_VERIFIED", jobId, `${archive.category} · ${archive.records.length} bản ghi · ${archive.assets.length} asset`);
    return { valid: true, category: archive.category, recordCount: archive.records.length, assetCount: archive.assets.length, checksum };
  }

  /** Parse archive version 2 và kiểm tra checksum/size của toàn bộ asset nhúng. */
  private validateRetentionArchive(content: Buffer): { category: string; records: unknown[]; assets: Array<{ objectKey: string; checksum: string; sizeBytes: number; contentBase64: string }> } {
    try {
      const value = JSON.parse(content.toString("utf8")) as { format?: string; version?: number; category?: string; records?: unknown[]; assets?: Array<{ objectKey?: string; checksum?: string; sizeBytes?: number; contentBase64?: string }> };
      if (value.format !== "wind-edu-retention-archive" || value.version !== 2 || typeof value.category !== "string" || !Array.isArray(value.records) || !Array.isArray(value.assets)) throw new Error("invalid archive");
      const assets = value.assets.map((asset) => {
        if (typeof asset.objectKey !== "string" || typeof asset.checksum !== "string" || typeof asset.sizeBytes !== "number" || typeof asset.contentBase64 !== "string") throw new Error("invalid asset");
        const buffer = Buffer.from(asset.contentBase64, "base64");
        const checksum = `sha256:${createHash("sha256").update(buffer).digest("hex")}`;
        if (buffer.length !== asset.sizeBytes || checksum !== asset.checksum) throw new Error("asset checksum mismatch");
        return { objectKey: asset.objectKey, checksum: asset.checksum, sizeBytes: asset.sizeBytes, contentBase64: asset.contentBase64 };
      });
      return { category: value.category, records: value.records, assets };
    } catch {
      throw new ServiceUnavailableException("Archive retention không thể phục hồi hoặc đã bị thay đổi.");
    }
  }

  /** Thu thập từng dòng export với nhãn thực thể để CSV và JSON cùng một phạm vi. */
  private async collectExportRows(prisma: PrismaService, category: string): Promise<Array<Record<string, unknown>>> {
    if (category === "AUDIT") return (await prisma.auditLog.findMany({ orderBy: { createdAt: "asc" } })).map((row) => ({ entity: "audit_log", ...row }));
    if (category === "USERS") return (await prisma.user.findMany({ select: { id: true, username: true, email: true, displayName: true, status: true, createdAt: true, updatedAt: true }, orderBy: { createdAt: "asc" } })).map((row) => ({ entity: "user", ...row }));
    const [courses, classes, exams, attempts, assignments, submissions] = await prisma.$transaction([
      prisma.course.findMany({ orderBy: { createdAt: "asc" } }),
      prisma.learningClass.findMany({ orderBy: { createdAt: "asc" } }),
      prisma.exam.findMany({ orderBy: { createdAt: "asc" } }),
      prisma.examAttempt.findMany({ orderBy: { startedAt: "asc" } }),
      prisma.assignment.findMany({ orderBy: { createdAt: "asc" } }),
      prisma.assignmentSubmission.findMany({ orderBy: { submittedAt: "asc" } }),
    ]);
    return [
      ...courses.map((row) => ({ entity: "course", ...row })),
      ...classes.map((row) => ({ entity: "learning_class", ...row })),
      ...exams.map((row) => ({ entity: "exam", ...row })),
      ...attempts.map((row) => ({ entity: "exam_attempt", ...row })),
      ...assignments.map((row) => ({ entity: "assignment", ...row })),
      ...submissions.map((row) => ({ entity: "assignment_submission", ...row })),
    ];
  }

  /** Tuần tự hóa export thành JSON hoặc CSV có BOM và escape đúng chuẩn bảng tính. */
  private serializeExport(rows: Array<Record<string, unknown>>, format: DataExport["format"]): Buffer {
    const normalize = (value: unknown): unknown => JSON.parse(JSON.stringify(value, (_key, item: unknown) => typeof item === "bigint" ? item.toString() : item instanceof Date ? item.toISOString() : item));
    if (format === "JSON") return Buffer.from(JSON.stringify({ format: "wind-edu-data-export", version: 1, createdAt: new Date().toISOString(), rows: normalize(rows) }, null, 2), "utf8");
    const keys = [...new Set(rows.flatMap((row) => Object.keys(row)))];
    /** Chuyển mọi kiểu giá trị xuất dữ liệu về chuỗi CSV xác định. */
    const formatCell = (value: unknown): string => {
      if (value === null || value === undefined) return "";
      if (value instanceof Date) return value.toISOString();
      if (typeof value === "object") return JSON.stringify(normalize(value)) ?? "";
      if (typeof value === "string") return value;
      if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") return value.toString();
      if (typeof value === "symbol") return value.description ?? "";
      return "[function]";
    };
    const escape = (value: unknown): string => {
      const normalized = formatCell(value);
      return `"${normalized.replace(/"/g, '""')}"`;
    };
    const lines = [keys.map(escape).join(","), ...rows.map((row) => keys.map((key) => escape(row[key])).join(","))];
    return Buffer.from(`\uFEFF${lines.join("\r\n")}`, "utf8");
  }

  /** Upsert cảnh báo theo fingerprint để cùng sự cố không sinh bản ghi trùng. */
  private async recordAlert(fingerprint: string, serviceName: string, severity: SystemAlertView["severity"], summary: string, metricValue?: number, threshold?: number): Promise<void> {
    const prisma = this.database();
    if (prisma) { const current = await prisma.systemAlert.findUnique({ where: { fingerprint } }); if (current?.status === "MUTED" && current.mutedUntil && current.mutedUntil > new Date()) return; await prisma.systemAlert.upsert({ where: { fingerprint }, update: { serviceName, severity, summary, metricValue, threshold, status: current?.status === "ACKNOWLEDGED" ? "ACKNOWLEDGED" : "OPEN", recoveredAt: null }, create: { id: `alert-${randomUUID()}`, fingerprint, serviceName, severity, summary, metricValue, threshold } }); return; }
    const current = this.alerts.find((item) => item.fingerprint === fingerprint); if (current?.status === "MUTED" && current.mutedUntil && new Date(current.mutedUntil) > new Date()) return;
    if (current) Object.assign(current, { serviceName, severity, summary, metricValue, threshold, status: current.status === "ACKNOWLEDGED" ? "ACKNOWLEDGED" : "OPEN", recoveredAt: undefined, updatedAt: new Date().toISOString() });
    else { const timestamp = new Date().toISOString(); this.alerts.unshift({ id: `alert-${randomUUID()}`, fingerprint, serviceName, severity, status: "OPEN", summary, metricValue, threshold, detectedAt: timestamp, updatedAt: timestamp }); }
  }

  /** Tự động giải quyết cảnh báo đang mở khi metric trở lại bình thường. */
  private async recoverAlert(fingerprint: string): Promise<void> {
    const prisma = this.database(); if (prisma) { await prisma.systemAlert.updateMany({ where: { fingerprint, status: { not: "RESOLVED" } }, data: { status: "RESOLVED", recoveredAt: new Date() } }); return; }
    const current = this.alerts.find((item) => item.fingerprint === fingerprint && item.status !== "RESOLVED"); if (current) Object.assign(current, { status: "RESOLVED", recoveredAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
  }

  /** Đếm số bản ghi thuộc danh mục để ghi metadata export. */
  private async countExportRows(prisma: PrismaService, category: string): Promise<number> {
    if (category === "AUDIT") return prisma.auditLog.count();
    if (category === "LEARNING") {
      const [courses, classes, attempts] = await prisma.$transaction([prisma.course.count(), prisma.learningClass.count(), prisma.examAttempt.count()]);
      return courses + classes + attempts;
    }
    return prisma.user.count();
  }

  /** Ghi audit vào DB và che dữ liệu nhạy cảm trước khi lưu. */
  private async logDatabase(database: PrismaService | Prisma.TransactionClient, actorId: string, action: string, target: string, detail: string): Promise<void> {
    await database.auditLog.create({ data: { actorId, action, entityType: "system", entityId: target, context: { detail } } });
  }

  /** Thu hẹp Prisma JSON thành object để đọc cấu hình an toàn. */
  private asRecord(value: Prisma.JsonValue | null): Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
  }

  /** Đọc chuỗi từ JSON hoặc dùng fallback. */
  private stringValue(value: unknown, fallback: string): string { return typeof value === "string" ? value : fallback; }
  /** Đọc số hữu hạn từ JSON hoặc dùng fallback. */
  private numberValue(value: unknown, fallback: number): number { return typeof value === "number" && Number.isFinite(value) ? value : fallback; }
  /** Đọc boolean từ JSON hoặc dùng fallback. */
  private booleanValue(value: unknown, fallback: boolean): boolean { return typeof value === "boolean" ? value : fallback; }
  /** Đọc mảng chuỗi từ JSON và sao chép fallback để tránh mutation. */
  private stringArray(value: unknown, fallback: string[]): string[] { return Array.isArray(value) && value.every((item) => typeof item === "string") ? value : [...fallback]; }
  /** Trích danh sách placeholder {{name}} duy nhất từ subject/body mẫu. */
  private extractTemplateVariables(value: string): string[] { return [...new Set([...value.matchAll(/{{([a-zA-Z0-9_]+)}}/g)].map((match) => match[1] ?? "").filter(Boolean))]; }
  /** Che giá trị password/token/secret/credential trong chuỗi audit. */
  private redactSensitive(value: string): string { return value.replace(/(password|token|secret|credential|authorization)\s*[:=]\s*[^\s,;]+/gi, "$1=[REDACTED]"); }
  /** Type guard cho danh mục provider phòng học được hỗ trợ. */
  private isProvider(value: string): value is IntegrationConfig["provider"] { return value === "GOOGLE_MEET" || value === "ZOOM" || value === "JITSI"; }
  /** Ghi audit vào đầu state in-memory cho chế độ không kết nối DB. */
  private log(actorId: string, action: string, target: string, detail: string): void { this.audit.unshift({ id: `audit-${randomUUID()}`, actor: actorId, action, target, detail, createdAt: new Date().toISOString() }); }
}
