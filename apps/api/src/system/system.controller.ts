import { Body, Controller, Get, Param, Patch, Post, Query } from "@nestjs/common";
import { ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { IsArray, IsBoolean, IsIn, IsInt, IsObject, IsOptional, IsString, Max, Min } from "class-validator";
import { RequirePermissions } from "../auth/require-permissions.decorator.js";
import { SystemService, type AuditEvent, type BackupRun, type DataExport, type IntegrationConfig, type ModerationPolicy, type NotificationTemplate, type RestoreRun, type SystemSettings } from "./system.service.js";

const modules = [{ key: "storage", name: "Kho dữ liệu", readiness: "operational" }, { key: "question-bank", name: "Ngân hàng câu hỏi", readiness: "operational" }, { key: "forum", name: "Diễn đàn trao đổi", readiness: "operational" }, { key: "live-class", name: "Lớp học online", readiness: "operational" }] as const;
class UpdateSettingsDto { @IsOptional() @IsString() centerName?: string; @IsOptional() @IsString() timezone?: string; @IsOptional() @IsString() locale?: string; @IsOptional() @IsInt() @Min(30) @Max(3650) retentionDays?: number; @IsOptional() @IsInt() @Min(1) @Max(500) maxFileSizeMb?: number; @IsOptional() @IsArray() @IsString({ each: true }) allowedMimeTypes?: string[]; @IsOptional() @IsBoolean() moderationEnabled?: boolean; @IsOptional() @IsString() notificationSender?: string; @IsOptional() @IsBoolean() maintenanceMode?: boolean }
class ToggleIntegrationDto { @IsBoolean() enabled!: boolean }
class RunBackupDto { @IsIn(["FULL", "INCREMENTAL"]) type!: "FULL" | "INCREMENTAL" }
class RestoreBackupDto { @IsString() backupId!: string; @IsString() approvedBy!: string }
class ExportDataDto { @IsString() category!: string; @IsIn(["CSV", "JSON"]) format!: "CSV" | "JSON" }
class SaveTemplateDto { @IsString() eventCode!: string; @IsString() locale!: string; @IsString() subject!: string; @IsString() body!: string }
class PreviewTemplateDto { @IsObject() variables!: Record<string, string> }
class UpdateModerationDto { @IsArray() @IsString({ each: true }) prohibitedTerms!: string[]; @IsInt() @Min(1) @Max(100) maxPostsPerMinute!: number; @IsIn(["FLAG", "HIDE_PENDING_REVIEW"]) action!: "FLAG" | "HIDE_PENDING_REVIEW" }

@ApiTags("System") @Controller("system")
export class SystemController {
  constructor(private readonly system: SystemService) {}
  @Get("modules") @ApiOperation({ summary: "Liệt kê các phân hệ sản phẩm" }) @ApiOkResponse({ description: "Danh sách phân hệ và trạng thái nền tảng" }) getModules(): typeof modules { return modules; }
  @Get("settings") @RequirePermissions("system:configure") getSettings(): SystemSettings { return this.system.getSettings(); }
  @Patch("settings") @RequirePermissions("system:configure") updateSettings(@Body() input: UpdateSettingsDto): SystemSettings { return this.system.updateSettings(input); }
  @Get("integrations") @RequirePermissions("system:configure") listIntegrations(): IntegrationConfig[] { return this.system.listIntegrations(); }
  @Patch("integrations/:integrationId") @RequirePermissions("system:configure") updateIntegration(@Param("integrationId") id: string, @Body() input: ToggleIntegrationDto): IntegrationConfig { return this.system.updateIntegration(id, input.enabled); }
  @Get("backups") @RequirePermissions("system:configure") listBackups(): BackupRun[] { return this.system.listBackups(); }
  @Post("backups") @RequirePermissions("system:configure") runBackup(@Body() input: RunBackupDto): BackupRun { return this.system.runBackup(input.type); }
  @Get("restores") @RequirePermissions("system:configure") listRestores(): RestoreRun[] { return this.system.listRestores(); }
  @Post("restores") @RequirePermissions("system:configure") restoreBackup(@Body() input: RestoreBackupDto): RestoreRun { return this.system.restoreBackup(input.backupId, input.approvedBy); }
  @Get("retention-preview") @RequirePermissions("system:configure") previewRetention(@Query("category") category = "LEARNING"): object { return this.system.previewRetention(category); }
  @Get("exports") @RequirePermissions("system:configure") listExports(): DataExport[] { return this.system.listExports(); }
  @Post("exports") @RequirePermissions("system:configure") runExport(@Body() input: ExportDataDto): DataExport { return this.system.runExport(input.category, input.format); }
  @Get("notification-templates") @RequirePermissions("system:configure") listTemplates(): NotificationTemplate[] { return this.system.listTemplates(); }
  @Post("notification-templates") @RequirePermissions("system:configure") saveTemplate(@Body() input: SaveTemplateDto): NotificationTemplate { return this.system.saveTemplate(input); }
  @Post("notification-templates/:templateId/preview") @RequirePermissions("system:configure") previewTemplate(@Param("templateId") id: string, @Body() input: PreviewTemplateDto): object { return this.system.previewTemplate(id, input.variables ?? {}); }
  @Get("moderation-policy") @RequirePermissions("system:configure") getModeration(): ModerationPolicy { return this.system.getModerationPolicy(); }
  @Patch("moderation-policy") @RequirePermissions("system:configure") updateModeration(@Body() input: UpdateModerationDto): ModerationPolicy { return this.system.updateModerationPolicy(input); }
  @Get("audit") @RequirePermissions("system:configure") listAudit(@Query("query") query?: string): AuditEvent[] { return this.system.listAudit(query); }
  @Get("health-overview") @RequirePermissions("system:configure") healthOverview(): object { return this.system.healthOverview(); }
}
