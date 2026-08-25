import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";

export interface SystemSettings { centerName: string; timezone: string; locale: string; retentionDays: number; maxFileSizeMb: number; allowedMimeTypes: string[]; moderationEnabled: boolean; notificationSender: string; maintenanceMode: boolean; updatedAt: string }
export interface IntegrationConfig { id: string; provider: "GOOGLE_MEET" | "ZOOM" | "JITSI"; enabled: boolean; maskedCredential: string; updatedAt: string }
export interface BackupRun { id: string; type: "FULL" | "INCREMENTAL"; status: "COMPLETED"; createdAt: string; checksum: string; sizeMb: number }

@Injectable()
export class SystemService {
  private settings: SystemSettings = { centerName: "Trung tâm hỗ trợ giảng dạy Wind EDU", timezone: "Asia/Bangkok", locale: "vi-VN", retentionDays: 365, maxFileSizeMb: 50, allowedMimeTypes: ["application/pdf", "video/mp4", "image/png", "image/jpeg"], moderationEnabled: true, notificationSender: "Wind EDU", maintenanceMode: false, updatedAt: new Date().toISOString() };
  private integrations: IntegrationConfig[] = ["GOOGLE_MEET", "ZOOM", "JITSI"].map((provider, index) => ({ id: `int-${index + 1}`, provider: provider as IntegrationConfig["provider"], enabled: provider !== "ZOOM", maskedCredential: provider === "JITSI" ? "Không yêu cầu" : "••••••••", updatedAt: new Date().toISOString() }));
  private backups: BackupRun[] = [{ id: "backup-seed", type: "FULL", status: "COMPLETED", createdAt: new Date(Date.now() - 86_400_000).toISOString(), checksum: "sha256:9e151f", sizeMb: 18.4 }];
  getSettings(): SystemSettings { return structuredClone(this.settings); }
  updateSettings(input: Partial<Omit<SystemSettings, "updatedAt">>): SystemSettings { if (input.retentionDays !== undefined && (input.retentionDays < 30 || input.retentionDays > 3650)) throw new BadRequestException("Thời gian lưu trữ phải từ 30 đến 3650 ngày."); if (input.maxFileSizeMb !== undefined && (input.maxFileSizeMb < 1 || input.maxFileSizeMb > 500)) throw new BadRequestException("Giới hạn tệp phải từ 1 đến 500 MB."); this.settings = { ...this.settings, ...input, updatedAt: new Date().toISOString() }; return this.getSettings(); }
  listIntegrations(): IntegrationConfig[] { return structuredClone(this.integrations); }
  updateIntegration(id: string, enabled: boolean): IntegrationConfig { const item = this.integrations.find((entry) => entry.id === id); if (!item) throw new NotFoundException("Không tìm thấy tích hợp."); item.enabled = enabled; item.updatedAt = new Date().toISOString(); return structuredClone(item); }
  listBackups(): BackupRun[] { return structuredClone(this.backups); }
  runBackup(type: BackupRun["type"]): BackupRun { const item: BackupRun = { id: `backup-${crypto.randomUUID()}`, type, status: "COMPLETED", createdAt: new Date().toISOString(), checksum: `sha256:${crypto.randomUUID().slice(0, 8)}`, sizeMb: type === "FULL" ? 19.1 : 2.6 }; this.backups.unshift(item); return structuredClone(item); }
  healthOverview(): object { return { status: "healthy", database: "connected", apiLatencyMs: 24, storageUsagePercent: 32, queueDepth: 0, checkedAt: new Date().toISOString() }; }
}
