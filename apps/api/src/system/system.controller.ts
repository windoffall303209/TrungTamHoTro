import { Body, Controller, Get, Param, Patch, Post, Query } from "@nestjs/common";
import { ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { IsArray, IsBoolean, IsDateString, IsEmail, IsIn, IsInt, IsObject, IsOptional, IsString, Max, MaxLength, Min, MinLength } from "class-validator";
import type { AuthenticatedSession } from "../auth/auth.service.js";
import { CurrentSession } from "../auth/current-session.decorator.js";
import { RequirePermissions } from "../auth/require-permissions.decorator.js";
import { SystemService, type AuditEvent, type BackupRun, type DataExport, type IntegrationConfig, type ModerationPolicy, type NotificationTemplate, type RestoreRun, type RetentionJobView, type RetentionPolicyView, type StorageOverview, type SystemAlertView, type SystemSettingRevision, type SystemSettings, type TemplateTestDelivery } from "./system.service.js";

const modules = [{ key: "storage", name: "Kho dữ liệu", readiness: "operational" }, { key: "question-bank", name: "Ngân hàng câu hỏi", readiness: "operational" }, { key: "forum", name: "Diễn đàn trao đổi", readiness: "operational" }, { key: "live-class", name: "Lớp học online", readiness: "operational" }] as const;
class UpdateSettingsDto { @IsOptional() @IsString() centerName?: string; @IsOptional() @IsString() timezone?: string; @IsOptional() @IsString() locale?: string; @IsOptional() @IsInt() @Min(30) @Max(3650) retentionDays?: number; @IsOptional() @IsInt() @Min(1) @Max(500) maxFileSizeMb?: number; @IsOptional() @IsInt() @Min(100) @Max(1_000_000) storageQuotaMb?: number; @IsOptional() @IsArray() @IsString({ each: true }) allowedMimeTypes?: string[]; @IsOptional() @IsBoolean() moderationEnabled?: boolean; @IsOptional() @IsIn(["AUTO", "MANUAL"]) examApprovalMode?: "AUTO" | "MANUAL"; @IsOptional() @IsString() notificationSender?: string; @IsOptional() @IsBoolean() maintenanceMode?: boolean; @IsOptional() @IsDateString() effectiveAt?: string }
class ToggleIntegrationDto { @IsBoolean() enabled!: boolean }
class ConfigureIntegrationDto { @IsIn(["GOOGLE_MEET", "ZOOM", "JITSI"]) provider!: IntegrationConfig["provider"]; @IsOptional() @IsString() credentialReference?: string; @IsOptional() @IsString() webhookUrl?: string }
class RunBackupDto { @IsIn(["FULL", "INCREMENTAL"]) type!: "FULL" | "INCREMENTAL" }
class RestoreBackupDto { @IsString() backupId!: string; @IsString() approvedBy!: string }
class ExportDataDto { @IsString() category!: string; @IsIn(["CSV", "JSON"]) format!: "CSV" | "JSON" }
class SaveTemplateDto { @IsString() eventCode!: string; @IsString() locale!: string; @IsString() subject!: string; @IsString() body!: string }
class PreviewTemplateDto { @IsObject() variables!: Record<string, string> }
class TestTemplateDto extends PreviewTemplateDto { @IsEmail() recipient!: string }
class UpdateModerationDto { @IsArray() @IsString({ each: true }) prohibitedTerms!: string[]; @IsInt() @Min(1) @Max(100) maxPostsPerMinute!: number; @IsIn(["FLAG", "HIDE_PENDING_REVIEW"]) action!: "FLAG" | "HIDE_PENDING_REVIEW" }
class CreateRetentionPolicyDto { @IsString() category!: string; @IsInt() @Min(30) @Max(3650) retentionDays!: number; @IsIn(["ARCHIVE", "DELETE"]) action!: "ARCHIVE" | "DELETE"; @IsString() @MinLength(3) approvedBy!: string; @IsOptional() @IsDateString() effectiveAt?: string }
class RunRetentionDto { @IsString() policyId!: string; @IsString() @MinLength(3) requestedBy!: string; @IsString() @MinLength(3) approvedBy!: string }
class CreateLegalHoldDto { @IsString() category!: string; @IsString() @MinLength(5) @MaxLength(500) reason!: string }
class UpdateAlertDto { @IsIn(["ACKNOWLEDGE", "MUTE", "RESOLVE"]) action!: "ACKNOWLEDGE" | "MUTE" | "RESOLVE"; @IsOptional() @IsInt() @Min(5) @Max(1440) muteMinutes?: number }

@ApiTags("System") @Controller("system")
export class SystemController {
  constructor(private readonly system: SystemService) {}
  @Get("modules") @ApiOperation({ summary: "Liệt kê các phân hệ sản phẩm" }) @ApiOkResponse({ description: "Danh sách phân hệ và trạng thái nền tảng" }) getModules(): typeof modules { return modules; }
  @Get("settings") @RequirePermissions("system:configure") getSettings(): Promise<SystemSettings> { return this.system.getSettings(); }
  @Patch("settings") @RequirePermissions("system:configure") updateSettings(@Body() input: UpdateSettingsDto, @CurrentSession() session: AuthenticatedSession): Promise<SystemSettings> { return this.system.updateSettings(input, session.user.id); }
  @Get("settings/history") @RequirePermissions("system:configure") listSettingHistory(): Promise<SystemSettingRevision[]> { return this.system.listSettingRevisions(); }
  @Get("integrations") @RequirePermissions("system:configure") listIntegrations(): Promise<IntegrationConfig[]> { return this.system.listIntegrations(); }
  @Patch("integrations/:integrationId") @RequirePermissions("system:configure") updateIntegration(@Param("integrationId") id: string, @Body() input: ToggleIntegrationDto, @CurrentSession() session: AuthenticatedSession): Promise<IntegrationConfig> { return this.system.updateIntegration(id, input.enabled, session.user.id); }
  @Post("integrations/configure") @RequirePermissions("system:configure") configureIntegration(@Body() input: ConfigureIntegrationDto, @CurrentSession() session: AuthenticatedSession): Promise<IntegrationConfig> { return this.system.configureIntegration(input, session.user.id); }
  @Post("integrations/:integrationId/test") @RequirePermissions("system:configure") testIntegration(@Param("integrationId") id: string, @CurrentSession() session: AuthenticatedSession): Promise<IntegrationConfig> { return this.system.testIntegration(id, session.user.id); }
  @Post("integrations/:integrationId/default") @RequirePermissions("system:configure") setDefaultIntegration(@Param("integrationId") id: string, @CurrentSession() session: AuthenticatedSession): Promise<IntegrationConfig> { return this.system.setDefaultIntegration(id, session.user.id); }
  @Post("integrations/:integrationId/test-meeting") @RequirePermissions("system:configure") createTestMeeting(@Param("integrationId") id: string, @CurrentSession() session: AuthenticatedSession): Promise<{ provider: string; attendeeUrl: string; expiresAt: string }> { return this.system.createTestMeeting(id, session.user.id); }
  @Get("backups") @RequirePermissions("system:configure") listBackups(): Promise<BackupRun[]> { return this.system.listBackups(); }
  @Post("backups") @RequirePermissions("system:configure") runBackup(@Body() input: RunBackupDto, @CurrentSession() session: AuthenticatedSession): Promise<BackupRun> { return this.system.runBackup(input.type, session.user.id); }
  @Get("restores") @RequirePermissions("system:configure") listRestores(): Promise<RestoreRun[]> { return this.system.listRestores(); }
  @Post("restores") @RequirePermissions("system:configure") restoreBackup(@Body() input: RestoreBackupDto, @CurrentSession() session: AuthenticatedSession): Promise<RestoreRun> { return this.system.restoreBackup(input.backupId, input.approvedBy, session.user.id); }
  @Get("retention-preview") @RequirePermissions("system:configure") previewRetention(@Query("category") category = "LEARNING"): Promise<object> { return this.system.previewRetention(category); }
  @Get("retention-policies") @RequirePermissions("system:configure") listRetentionPolicies(): Promise<RetentionPolicyView[]> { return this.system.listRetentionPolicies(); }
  @Post("retention-policies") @RequirePermissions("system:configure") createRetentionPolicy(@Body() input: CreateRetentionPolicyDto, @CurrentSession() session: AuthenticatedSession): Promise<RetentionPolicyView> { return this.system.createRetentionPolicy(input, session.user.id); }
  @Post("legal-holds") @RequirePermissions("system:configure") createLegalHold(@Body() input: CreateLegalHoldDto, @CurrentSession() session: AuthenticatedSession): Promise<object> { return this.system.createLegalHold(input.category, input.reason, session.user.id); }
  @Get("retention-jobs") @RequirePermissions("system:configure") listRetentionJobs(): Promise<RetentionJobView[]> { return this.system.listRetentionJobs(); }
  @Post("retention-jobs") @RequirePermissions("system:configure") runRetention(@Body() input: RunRetentionDto, @CurrentSession() session: AuthenticatedSession): Promise<RetentionJobView> { return this.system.runRetention(input.policyId, session.user.id, input.approvedBy); }
  @Get("exports") @RequirePermissions("system:configure") listExports(): Promise<DataExport[]> { return this.system.listExports(); }
  @Post("exports") @RequirePermissions("system:configure") runExport(@Body() input: ExportDataDto, @CurrentSession() session: AuthenticatedSession): Promise<DataExport> { return this.system.runExport(input.category, input.format, session.user.id); }
  @Get("notification-templates") @RequirePermissions("system:configure") listTemplates(): Promise<NotificationTemplate[]> { return this.system.listTemplates(); }
  @Post("notification-templates") @RequirePermissions("system:configure") saveTemplate(@Body() input: SaveTemplateDto, @CurrentSession() session: AuthenticatedSession): Promise<NotificationTemplate> { return this.system.saveTemplate(input, session.user.id); }
  @Post("notification-templates/:templateId/preview") @RequirePermissions("system:configure") previewTemplate(@Param("templateId") id: string, @Body() input: PreviewTemplateDto): Promise<object> { return this.system.previewTemplate(id, input.variables ?? {}); }
  @Post("notification-templates/:templateId/test-send") @RequirePermissions("system:configure") testTemplate(@Param("templateId") id: string, @Body() input: TestTemplateDto, @CurrentSession() session: AuthenticatedSession): Promise<TemplateTestDelivery> { return this.system.sendTemplateTest(id, input.recipient, input.variables ?? {}, session.user.id); }
  @Get("moderation-policy") @RequirePermissions("system:configure") getModeration(): Promise<ModerationPolicy> { return this.system.getModerationPolicy(); }
  @Patch("moderation-policy") @RequirePermissions("system:configure") updateModeration(@Body() input: UpdateModerationDto, @CurrentSession() session: AuthenticatedSession): Promise<ModerationPolicy> { return this.system.updateModerationPolicy(input, session.user.id); }
  @Get("audit") @RequirePermissions("system:configure") listAudit(@Query("query") query?: string, @Query("actor") actor?: string, @Query("action") action?: string, @Query("target") target?: string, @Query("from") from?: string, @Query("to") to?: string): Promise<AuditEvent[]> { return this.system.listAudit({ query, actor, action, target, from, to }); }
  @Get("health-overview") @RequirePermissions("system:configure") healthOverview(): Promise<object> { return this.system.healthOverview(); }
  @Get("alerts") @RequirePermissions("system:configure") listAlerts(): Promise<SystemAlertView[]> { return this.system.listAlerts(); }
  @Patch("alerts/:alertId") @RequirePermissions("system:configure") updateAlert(@Param("alertId") alertId: string, @Body() input: UpdateAlertDto, @CurrentSession() session: AuthenticatedSession): Promise<SystemAlertView> { return this.system.updateAlert(alertId, input.action, session.user.id, input.muteMinutes); }
  @Get("storage-overview") @RequirePermissions("system:configure") storageOverview(): Promise<StorageOverview> { return this.system.getStorageOverview(); }
}
