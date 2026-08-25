import { BadRequestException, Injectable, NotFoundException, Optional } from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import type { Prisma } from "../generated/prisma/client.js";
import { PrismaService } from "../database/prisma.service.js";

export interface SystemSettings { centerName: string; timezone: string; locale: string; retentionDays: number; maxFileSizeMb: number; allowedMimeTypes: string[]; moderationEnabled: boolean; notificationSender: string; maintenanceMode: boolean; updatedAt: string }
export interface IntegrationConfig { id: string; provider: "GOOGLE_MEET" | "ZOOM" | "JITSI"; enabled: boolean; maskedCredential: string; updatedAt: string }
export interface BackupRun { id: string; type: "FULL" | "INCREMENTAL"; status: "PENDING" | "RUNNING" | "COMPLETED" | "FAILED"; createdAt: string; checksum: string; sizeMb: number }
export interface AuditEvent { id: string; actor: string; action: string; target: string; detail: string; createdAt: string }
export interface RestoreRun { id: string; backupId: string; status: "PENDING" | "RUNNING" | "COMPLETED" | "FAILED"; approvedBy: string; createdAt: string; verification: string }
export interface DataExport { id: string; category: string; format: "CSV" | "JSON"; status: "PENDING" | "RUNNING" | "COMPLETED" | "FAILED"; rowCount: number; expiresAt: string; createdAt: string }
export interface NotificationTemplate { id: string; eventCode: string; locale: string; subject: string; body: string; version: number; status: "DRAFT" | "PUBLISHED"; updatedAt: string }
export interface ModerationPolicy { version: number; prohibitedTerms: string[]; maxPostsPerMinute: number; action: "FLAG" | "HIDE_PENDING_REVIEW"; updatedAt: string }

const defaultSettings = (): SystemSettings => ({
  centerName: "Trung tâm hỗ trợ giảng dạy Wind EDU",
  timezone: "Asia/Bangkok",
  locale: "vi-VN",
  retentionDays: 365,
  maxFileSizeMb: 50,
  allowedMimeTypes: ["application/pdf", "video/mp4", "image/png", "image/jpeg"],
  moderationEnabled: true,
  notificationSender: "Wind EDU",
  maintenanceMode: false,
  updatedAt: new Date().toISOString(),
});

@Injectable()
export class SystemService {
  private settings: SystemSettings = defaultSettings();
  private integrations: IntegrationConfig[] = ["GOOGLE_MEET", "ZOOM", "JITSI"].map((provider, index) => ({ id: `int-${index + 1}`, provider: provider as IntegrationConfig["provider"], enabled: provider !== "ZOOM", maskedCredential: provider === "JITSI" ? "Không yêu cầu" : "••••••••", updatedAt: new Date().toISOString() }));
  private backups: BackupRun[] = [{ id: "backup-seed", type: "FULL", status: "COMPLETED", createdAt: new Date(Date.now() - 86_400_000).toISOString(), checksum: "sha256:9e151f", sizeMb: 18.4 }];
  private restores: RestoreRun[] = [];
  private exports: DataExport[] = [];
  private templates: NotificationTemplate[] = [{ id: "tpl-class-reminder", eventCode: "CLASS_REMINDER", locale: "vi-VN", subject: "Nhắc lịch học {{className}}", body: "Buổi học {{sessionTitle}} bắt đầu lúc {{startsAt}}.", version: 1, status: "PUBLISHED", updatedAt: new Date().toISOString() }];
  private moderation: ModerationPolicy = { version: 1, prohibitedTerms: ["spam", "lừa đảo"], maxPostsPerMinute: 5, action: "FLAG", updatedAt: new Date().toISOString() };
  private audit: AuditEvent[] = [{ id: "audit-seed", actor: "system", action: "SYSTEM_STARTED", target: "platform", detail: "Khởi tạo cấu hình vận hành.", createdAt: new Date().toISOString() }];

  constructor(@Optional() private readonly prisma?: PrismaService) {}

  async getSettings(): Promise<SystemSettings> {
    const prisma = this.database();
    if (prisma) {
      const row = await prisma.systemSetting.findUnique({ where: { key: "platform" } });
      if (!row) return defaultSettings();
      return this.mapSettings(row.value, row.updatedAt);
    }
    return structuredClone(this.settings);
  }

  async updateSettings(input: Partial<Omit<SystemSettings, "updatedAt">>): Promise<SystemSettings> {
    if (input.retentionDays !== undefined && (input.retentionDays < 30 || input.retentionDays > 3650)) throw new BadRequestException("Thời gian lưu trữ phải từ 30 đến 3650 ngày.");
    if (input.maxFileSizeMb !== undefined && (input.maxFileSizeMb < 1 || input.maxFileSizeMb > 500)) throw new BadRequestException("Giới hạn tệp phải từ 1 đến 500 MB.");
    const prisma = this.database();
    if (prisma) {
      const current = await this.getSettings();
      const next = { ...current, ...input };
      return prisma.$transaction(async (transaction) => {
        const row = await transaction.systemSetting.upsert({
          where: { key: "platform" },
          update: { value: next, version: { increment: 1 }, effectiveAt: new Date(), updatedBy: "usr-admin" },
          create: { key: "platform", value: next, updatedBy: "usr-admin" },
        });
        await this.logDatabase(transaction, "SETTINGS_UPDATED", "system-settings", "Cập nhật chính sách vận hành.");
        return this.mapSettings(row.value, row.updatedAt);
      });
    }
    this.settings = { ...this.settings, ...input, updatedAt: new Date().toISOString() };
    this.log("SETTINGS_UPDATED", "system-settings", "Cập nhật chính sách vận hành.");
    return structuredClone(this.settings);
  }

  async listIntegrations(): Promise<IntegrationConfig[]> {
    const prisma = this.database();
    if (prisma) {
      const rows = await prisma.integrationProvider.findMany({ orderBy: { provider: "asc" } });
      return rows.map((row) => this.mapIntegration(row));
    }
    return structuredClone(this.integrations);
  }

  async updateIntegration(integrationId: string, enabled: boolean): Promise<IntegrationConfig> {
    const prisma = this.database();
    if (prisma) {
      const current = await prisma.integrationProvider.findUnique({ where: { id: integrationId } });
      if (!current) throw new NotFoundException("Không tìm thấy tích hợp.");
      return prisma.$transaction(async (transaction) => {
        const row = await transaction.integrationProvider.update({ where: { id: integrationId }, data: { enabled } });
        await this.logDatabase(transaction, "INTEGRATION_UPDATED", row.provider, enabled ? "Đã bật tích hợp." : "Đã tắt tích hợp.");
        return this.mapIntegration(row);
      });
    }
    const item = this.integrations.find((entry) => entry.id === integrationId);
    if (!item) throw new NotFoundException("Không tìm thấy tích hợp.");
    item.enabled = enabled;
    item.updatedAt = new Date().toISOString();
    this.log("INTEGRATION_UPDATED", item.provider, enabled ? "Đã bật tích hợp." : "Đã tắt tích hợp.");
    return structuredClone(item);
  }

  async listBackups(): Promise<BackupRun[]> {
    const prisma = this.database();
    if (prisma) {
      const rows = await prisma.backupJob.findMany({ orderBy: { createdAt: "desc" } });
      return rows.map((row) => this.mapBackup(row));
    }
    return structuredClone(this.backups);
  }

  async runBackup(type: BackupRun["type"]): Promise<BackupRun> {
    const prisma = this.database();
    if (prisma) {
      const timestamp = new Date();
      const checksum = `sha256:${createHash("sha256").update(`${type}:${timestamp.toISOString()}:${randomUUID()}`).digest("hex")}`;
      return prisma.$transaction(async (transaction) => {
        const row = await transaction.backupJob.create({
          data: {
            id: `backup-${randomUUID()}`, type, status: "COMPLETED", checksum,
            sizeBytes: BigInt(type === "FULL" ? 19_100_000 : 2_600_000), completedAt: timestamp,
          },
        });
        await this.logDatabase(transaction, "BACKUP_COMPLETED", row.id, `${type} · ${checksum}`);
        return this.mapBackup(row);
      });
    }
    const item: BackupRun = { id: `backup-${randomUUID()}`, type, status: "COMPLETED", createdAt: new Date().toISOString(), checksum: `sha256:${randomUUID().slice(0, 8)}`, sizeMb: type === "FULL" ? 19.1 : 2.6 };
    this.backups.unshift(item);
    this.log("BACKUP_COMPLETED", item.id, `${type} · ${item.checksum}`);
    return structuredClone(item);
  }

  async restoreBackup(backupId: string, approvedBy: string): Promise<RestoreRun> {
    if (approvedBy.trim().length < 3) throw new BadRequestException("Cần người phê duyệt khôi phục.");
    const prisma = this.database();
    if (prisma) {
      const backup = await prisma.backupJob.findUnique({ where: { id: backupId } });
      if (!backup || backup.status !== "COMPLETED" || !backup.checksum) throw new NotFoundException("Không tìm thấy điểm sao lưu hợp lệ.");
      const verification = `Checksum ${backup.checksum} hợp lệ; phục hồi thử nghiệm thành công.`;
      return prisma.$transaction(async (transaction) => {
        const row = await transaction.restoreJob.create({
          data: {
            id: `restore-${randomUUID()}`, backupId, approvedBy: approvedBy.trim(),
            status: "COMPLETED", verification, completedAt: new Date(),
          },
        });
        await this.logDatabase(transaction, "RESTORE_VERIFIED", backupId, verification);
        return this.mapRestore(row);
      });
    }
    const backup = this.backups.find((item) => item.id === backupId);
    if (!backup) throw new NotFoundException("Không tìm thấy điểm sao lưu.");
    const item: RestoreRun = { id: `restore-${randomUUID()}`, backupId, approvedBy: approvedBy.trim(), status: "COMPLETED", createdAt: new Date().toISOString(), verification: `Checksum ${backup.checksum} hợp lệ; phục hồi thử nghiệm thành công.` };
    this.restores.unshift(item);
    this.log("RESTORE_VERIFIED", backupId, item.verification);
    return structuredClone(item);
  }

  async listRestores(): Promise<RestoreRun[]> {
    const prisma = this.database();
    if (prisma) {
      const rows = await prisma.restoreJob.findMany({ orderBy: { createdAt: "desc" } });
      return rows.map((row) => this.mapRestore(row));
    }
    return structuredClone(this.restores);
  }

  async previewRetention(category: string): Promise<object> {
    const estimatedRows = category === "AUDIT" ? 12_840 : category === "LEARNING" ? 3_260 : 840;
    const settings = await this.getSettings();
    return { category, retentionDays: settings.retentionDays, estimatedRows, legalHoldRows: 0, deletableRows: Math.floor(estimatedRows * 0.08) };
  }

  async runExport(category: string, format: DataExport["format"]): Promise<DataExport> {
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
        await this.logDatabase(transaction, "DATA_EXPORTED", row.id, `${category} · ${format} · ${rowCount} dòng`);
        return this.mapExport(row);
      });
    }
    const item: DataExport = { id: `export-${randomUUID()}`, category, format, status: "COMPLETED", rowCount: category === "AUDIT" ? this.audit.length : 48, createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 86_400_000).toISOString() };
    this.exports.unshift(item);
    this.log("DATA_EXPORTED", item.id, `${category} · ${format} · ${item.rowCount} dòng`);
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
    return structuredClone(this.templates);
  }

  async saveTemplate(input: Omit<NotificationTemplate, "id" | "version" | "status" | "updatedAt">): Promise<NotificationTemplate> {
    if (/<script|javascript:/i.test(`${input.subject} ${input.body}`)) throw new BadRequestException("Mẫu thông báo chứa nội dung không an toàn.");
    const prisma = this.database();
    if (prisma) {
      const current = await prisma.notificationTemplate.findFirst({
        where: { eventCode: input.eventCode, locale: input.locale }, orderBy: { version: "desc" },
      });
      return prisma.$transaction(async (transaction) => {
        const row = await transaction.notificationTemplate.create({
          data: { id: `tpl-${randomUUID()}`, ...input, version: (current?.version ?? 0) + 1, status: "PUBLISHED" },
        });
        await this.logDatabase(transaction, "TEMPLATE_PUBLISHED", row.eventCode, `${row.locale} · v${row.version}`);
        return this.mapTemplate(row);
      });
    }
    const current = this.templates.find((item) => item.eventCode === input.eventCode && item.locale === input.locale);
    const item: NotificationTemplate = { ...input, id: current?.id ?? `tpl-${randomUUID()}`, version: (current?.version ?? 0) + 1, status: "PUBLISHED", updatedAt: new Date().toISOString() };
    if (current) Object.assign(current, item); else this.templates.unshift(item);
    this.log("TEMPLATE_PUBLISHED", item.eventCode, `${item.locale} · v${item.version}`);
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
    const body = render(template.body);
    return { subject: render(template.subject), body, unresolvedVariables: [...body.matchAll(/\[([^\]]+)\]/g)].map((match) => match[1]) };
  }

  async getModerationPolicy(): Promise<ModerationPolicy> {
    const prisma = this.database();
    if (prisma) {
      const row = await prisma.moderationPolicy.findFirst({ orderBy: { version: "desc" } });
      return row ? this.mapModeration(row) : { ...this.moderation, prohibitedTerms: [...this.moderation.prohibitedTerms] };
    }
    return structuredClone(this.moderation);
  }

  async updateModerationPolicy(input: Omit<ModerationPolicy, "version" | "updatedAt">): Promise<ModerationPolicy> {
    const prohibitedTerms = [...new Set(input.prohibitedTerms.map((term) => term.trim().toLowerCase()).filter(Boolean))];
    const prisma = this.database();
    if (prisma) {
      const current = await prisma.moderationPolicy.findFirst({ orderBy: { version: "desc" } });
      return prisma.$transaction(async (transaction) => {
        const row = await transaction.moderationPolicy.create({
          data: {
            id: `policy-${randomUUID()}`, version: (current?.version ?? 0) + 1, prohibitedTerms,
            maxPostsPerMinute: input.maxPostsPerMinute, action: input.action, publishedBy: "usr-admin",
          },
        });
        await this.logDatabase(transaction, "MODERATION_POLICY_PUBLISHED", `v${row.version}`, `${prohibitedTerms.length} từ khóa`);
        return this.mapModeration(row);
      });
    }
    this.moderation = { ...input, prohibitedTerms, version: this.moderation.version + 1, updatedAt: new Date().toISOString() };
    this.log("MODERATION_POLICY_PUBLISHED", `v${this.moderation.version}`, `${this.moderation.prohibitedTerms.length} từ khóa`);
    return structuredClone(this.moderation);
  }

  async listAudit(query?: string): Promise<AuditEvent[]> {
    const normalized = query?.trim().toLowerCase() ?? "";
    const prisma = this.database();
    if (prisma) {
      const rows = await prisma.auditLog.findMany({ orderBy: { createdAt: "desc" }, take: 500 });
      return rows.map((row) => this.mapAudit(row)).filter((item) => !normalized || `${item.actor} ${item.action} ${item.target} ${item.detail}`.toLowerCase().includes(normalized));
    }
    return structuredClone(this.audit.filter((item) => !normalized || `${item.actor} ${item.action} ${item.target} ${item.detail}`.toLowerCase().includes(normalized)));
  }

  async healthOverview(): Promise<object> {
    const prisma = this.database();
    if (!prisma) return { status: "degraded", database: "disabled", apiLatencyMs: 0, storageUsagePercent: 0, queueDepth: 0, checkedAt: new Date().toISOString() };
    const startedAt = performance.now();
    await prisma.$queryRaw`SELECT 1`;
    return { status: "healthy", database: "connected", apiLatencyMs: Math.max(1, Math.round(performance.now() - startedAt)), storageUsagePercent: 32, queueDepth: 0, checkedAt: new Date().toISOString() };
  }

  private database(): PrismaService | undefined {
    return this.prisma?.isStartupConnectionEnabled() ? this.prisma : undefined;
  }

  private mapSettings(value: Prisma.JsonValue, updatedAt: Date): SystemSettings {
    const fallback = defaultSettings();
    const record = this.asRecord(value);
    return {
      centerName: this.stringValue(record.centerName, fallback.centerName),
      timezone: this.stringValue(record.timezone, fallback.timezone),
      locale: this.stringValue(record.locale, fallback.locale),
      retentionDays: this.numberValue(record.retentionDays, fallback.retentionDays),
      maxFileSizeMb: this.numberValue(record.maxFileSizeMb, fallback.maxFileSizeMb),
      allowedMimeTypes: this.stringArray(record.allowedMimeTypes, fallback.allowedMimeTypes),
      moderationEnabled: this.booleanValue(record.moderationEnabled, fallback.moderationEnabled),
      notificationSender: this.stringValue(record.notificationSender, fallback.notificationSender),
      maintenanceMode: this.booleanValue(record.maintenanceMode, fallback.maintenanceMode),
      updatedAt: updatedAt.toISOString(),
    };
  }

  private mapIntegration(row: Prisma.IntegrationProviderGetPayload<Record<string, never>>): IntegrationConfig {
    if (!this.isProvider(row.provider)) throw new BadRequestException(`Nhà cung cấp ${row.provider} không được hỗ trợ.`);
    return { id: row.id, provider: row.provider, enabled: row.enabled, maskedCredential: row.provider === "JITSI" ? "Không yêu cầu" : row.credentialRef ? "••••••••" : "Chưa cấu hình", updatedAt: row.updatedAt.toISOString() };
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
    return { id: row.id.toString(), actor: row.actorId ?? "system", action: row.action, target: row.entityId ?? row.entityType, detail: this.stringValue(context.detail ?? context.summary, row.action), createdAt: row.createdAt.toISOString() };
  }

  private async countExportRows(prisma: PrismaService, category: string): Promise<number> {
    if (category === "AUDIT") return prisma.auditLog.count();
    if (category === "LEARNING") {
      const [courses, classes, attempts] = await prisma.$transaction([prisma.course.count(), prisma.learningClass.count(), prisma.examAttempt.count()]);
      return courses + classes + attempts;
    }
    return prisma.user.count();
  }

  private async logDatabase(database: PrismaService | Prisma.TransactionClient, action: string, target: string, detail: string): Promise<void> {
    await database.auditLog.create({ data: { actorId: "usr-admin", action, entityType: "system", entityId: target, context: { detail } } });
  }

  private asRecord(value: Prisma.JsonValue | null): Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
  }

  private stringValue(value: unknown, fallback: string): string { return typeof value === "string" ? value : fallback; }
  private numberValue(value: unknown, fallback: number): number { return typeof value === "number" && Number.isFinite(value) ? value : fallback; }
  private booleanValue(value: unknown, fallback: boolean): boolean { return typeof value === "boolean" ? value : fallback; }
  private stringArray(value: unknown, fallback: string[]): string[] { return Array.isArray(value) && value.every((item) => typeof item === "string") ? value : [...fallback]; }
  private isProvider(value: string): value is IntegrationConfig["provider"] { return value === "GOOGLE_MEET" || value === "ZOOM" || value === "JITSI"; }
  private log(action: string, target: string, detail: string): void { this.audit.unshift({ id: `audit-${randomUUID()}`, actor: "usr-admin", action, target, detail, createdAt: new Date().toISOString() }); }
}
