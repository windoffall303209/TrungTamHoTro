import { Body, Controller, Delete, Get, Param, Patch, Post, Query, StreamableFile } from "@nestjs/common";
import { ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { IsArray, IsBoolean, IsDateString, IsEmail, IsIn, IsInt, IsObject, IsOptional, IsString, Max, MaxLength, Min, MinLength } from "class-validator";
import type { AuthenticatedSession } from "../auth/auth.service.js";
import { CurrentSession } from "../auth/current-session.decorator.js";
import { RequirePermissions } from "../auth/require-permissions.decorator.js";
import { SystemService, type AuditEvent, type BackupRun, type DataExport, type IntegrationConfig, type LegalHoldView, type ModerationPolicy, type NotificationTemplate, type RestoreRun, type RetentionJobView, type RetentionPolicyView, type SnapshotAssetAudit, type StorageCleanupFailure, type StorageOverview, type SystemAlertView, type SystemSettingRevision, type SystemSettings, type TemplateTestDelivery } from "./system.service.js";
import { AiProviderService, type AiProviderConfig, type AiProviderType } from "./ai-provider.service.js";

class ConfigureAiTaskDto {
  @IsOptional() @IsString() @MaxLength(200) contextProviderId?: string;
  @IsIn(["SCAN_IMAGE", "GENERATE_EXAM", "DOCUMENT_CONTEXT", "DOCUMENT_QA", "GRADING_ASSIST"]) task!: "SCAN_IMAGE" | "GENERATE_EXAM" | "DOCUMENT_CONTEXT" | "DOCUMENT_QA" | "GRADING_ASSIST";
  @IsString() @MinLength(1) @MaxLength(200) providerId!: string;
  @IsString() @MinLength(1) @MaxLength(200) model!: string;
}
import { OutboxDeliveryService } from "../infrastructure/outbox-delivery.service.js";

const modules = [{ key: "storage", name: "Kho dữ liệu", readiness: "operational" }, { key: "question-bank", name: "Ngân hàng câu hỏi", readiness: "operational" }, { key: "forum", name: "Diễn đàn trao đổi", readiness: "operational" }, { key: "live-class", name: "Lớp học online", readiness: "operational" }] as const;
class UpdateSettingsDto { @IsOptional() @IsString() centerName?: string; @IsOptional() @IsString() timezone?: string; @IsOptional() @IsString() locale?: string; @IsOptional() @IsInt() @Min(30) @Max(3650) retentionDays?: number; @IsOptional() @IsInt() @Min(1) @Max(500) maxFileSizeMb?: number; @IsOptional() @IsInt() @Min(100) @Max(1_000_000) storageQuotaMb?: number; @IsOptional() @IsArray() @IsString({ each: true }) allowedMimeTypes?: string[]; @IsOptional() @IsBoolean() moderationEnabled?: boolean; @IsOptional() @IsIn(["AUTO", "MANUAL"]) examApprovalMode?: "AUTO" | "MANUAL"; @IsOptional() @IsIn(["AUTO", "MANUAL"]) questionApprovalMode?: "AUTO" | "MANUAL"; @IsOptional() @IsString() notificationSender?: string; @IsOptional() @IsBoolean() maintenanceMode?: boolean; @IsOptional() @IsDateString() effectiveAt?: string }
class ToggleIntegrationDto { @IsBoolean() enabled!: boolean }
class ConfigureIntegrationDto { @IsIn(["GOOGLE_MEET", "ZOOM", "JITSI"]) provider!: IntegrationConfig["provider"]; @IsOptional() @IsString() credentialReference?: string; @IsOptional() @IsString() webhookUrl?: string }
class RunBackupDto { @IsIn(["FULL", "INCREMENTAL"]) type!: "FULL" | "INCREMENTAL" }
class RestoreBackupDto { @IsString() backupId!: string; @IsIn(["DRILL", "OPERATIONAL"]) mode!: "DRILL" | "OPERATIONAL"; @IsString() @MinLength(10) @MaxLength(500) reason!: string; @IsOptional() @IsString() @MaxLength(191) targetDatabase?: string }
class ExportDataDto { @IsString() category!: string; @IsIn(["CSV", "JSON"]) format!: "CSV" | "JSON" }
class SaveTemplateDto { @IsString() eventCode!: string; @IsString() locale!: string; @IsString() subject!: string; @IsString() body!: string }
class PreviewTemplateDto { @IsObject() variables!: Record<string, string> }
class TestTemplateDto extends PreviewTemplateDto { @IsEmail() recipient!: string }
class UpdateModerationDto { @IsArray() @IsString({ each: true }) prohibitedTerms!: string[]; @IsInt() @Min(1) @Max(100) maxPostsPerMinute!: number; @IsIn(["FLAG", "HIDE_PENDING_REVIEW"]) action!: "FLAG" | "HIDE_PENDING_REVIEW" }
class CreateRetentionPolicyDto { @IsString() category!: string; @IsInt() @Min(30) @Max(3650) retentionDays!: number; @IsIn(["ARCHIVE", "DELETE"]) action!: "ARCHIVE" | "DELETE"; @IsOptional() @IsDateString() effectiveAt?: string }
class RunRetentionDto { @IsString() @MinLength(1) @MaxLength(191) policyId!: string }
class CreateLegalHoldDto { @IsString() category!: string; @IsString() @MinLength(5) @MaxLength(500) reason!: string }
class ReleaseLegalHoldDto { @IsString() @MinLength(5) @MaxLength(500) reason!: string }
class UpdateAlertDto { @IsIn(["ACKNOWLEDGE", "MUTE", "RESOLVE"]) action!: "ACKNOWLEDGE" | "MUTE" | "RESOLVE"; @IsOptional() @IsInt() @Min(5) @Max(1440) muteMinutes?: number }
class ConfigureAiProviderDto { @IsOptional() @IsString() id?: string; @IsIn(["GEMINI", "NVIDIA_NIM", "OPENAI", "CUSTOM"]) provider!: AiProviderType; @IsOptional() @IsString() @MaxLength(100) name?: string; @IsString() @MinLength(1) @MaxLength(200) model!: string; @IsOptional() @IsString() @MaxLength(1000) baseUrl?: string; @IsOptional() @IsString() @MinLength(8) @MaxLength(1000) apiKey?: string; @IsOptional() @IsBoolean() enabled?: boolean; @IsOptional() @IsBoolean() isDefault?: boolean }

@ApiTags("System") @Controller("system")
/** API quản trị tập trung cho cấu hình, AI, tích hợp, sao lưu, lưu giữ, mẫu tin và giám sát. */
export class SystemController {
  constructor(private readonly system: SystemService, private readonly aiProviders: AiProviderService, private readonly outbox: OutboxDeliveryService) {}
  /** Trả danh mục phân hệ tĩnh để giao diện hiển thị mức sẵn sàng. */
  @Get("modules") @ApiOperation({ summary: "Liệt kê các phân hệ sản phẩm" }) @ApiOkResponse({ description: "Danh sách phân hệ và trạng thái nền tảng" }) getModules(): typeof modules { return modules; }
  /** Đọc cấu hình hệ thống hiện hành. */
  @Get("settings") @RequirePermissions("system:configure") getSettings(): Promise<SystemSettings> { return this.system.getSettings(); }
  /** Cập nhật cấu hình và ghi người thực hiện từ phiên. */
  @Patch("settings") @RequirePermissions("system:configure") updateSettings(@Body() input: UpdateSettingsDto, @CurrentSession() session: AuthenticatedSession): Promise<SystemSettings> { return this.system.updateSettings(input, session.user.id); }
  /** Liệt kê lịch sử phiên bản cấu hình. */
  @Get("settings/history") @RequirePermissions("system:configure") listSettingHistory(): Promise<SystemSettingRevision[]> { return this.system.listSettingRevisions(); }
  /** Liệt kê cấu hình các nhà cung cấp phòng học. */
  @Get("integrations") @RequirePermissions("system:configure") listIntegrations(): Promise<IntegrationConfig[]> { return this.system.listIntegrations(); }
  /** Trả catalog model/endpoint mặc định của các nhà cung cấp AI. */
  @Get("ai-providers/catalog") @RequirePermissions("system:configure") getAiProviderCatalog(): ReturnType<AiProviderService["getCatalog"]> { return this.aiProviders.getCatalog(); }
  /** Trả phân công provider/model cho hai tác vụ AI. */
  @Get("ai-tasks") @RequirePermissions("system:configure") getAiTasks(): ReturnType<AiProviderService["getTaskConfigs"]> { return this.aiProviders.getTaskConfigs(); }
  /** Chỉ quản trị viên được đổi model thực thi tác vụ. */
  @Post("ai-tasks") @RequirePermissions("system:configure") saveAiTask(@Body() input: ConfigureAiTaskDto, @CurrentSession() session: AuthenticatedSession): ReturnType<AiProviderService["configureTask"]> { return this.aiProviders.configureTask(input.task, input, session.user.id); }
  /** Liệt kê cấu hình AI ở dạng đã che API key. */
  @Get("ai-providers") @RequirePermissions("system:configure") listAiProviders(): Promise<AiProviderConfig[]> { return this.aiProviders.list(); }
  /** Tạo/cập nhật provider AI và mã hóa API key trước khi lưu. */
  @Post("ai-providers") @RequirePermissions("system:configure") configureAiProvider(@Body() input: ConfigureAiProviderDto, @CurrentSession() session: AuthenticatedSession): Promise<AiProviderConfig> { return this.aiProviders.configure(input, session.user.id); }
  /** Gọi thử provider với request sức khỏe và lưu trạng thái kết nối. */
  @Post("ai-providers/:providerId/test") @RequirePermissions("system:configure") testAiProvider(@Param("providerId") id: string, @CurrentSession() session: AuthenticatedSession): Promise<AiProviderConfig> { return this.aiProviders.test(id, session.user.id); }
  /** Tải danh sách model provider hiện công bố; Gemini dùng models.list, provider khác dùng OpenAI-compatible /models. */
  @Get("ai-providers/:providerId/models") @RequirePermissions("system:configure") discoverAiProviderModels(@Param("providerId") id: string): ReturnType<AiProviderService["listModels"]> { return this.aiProviders.listModels(id); }
  /** Xóa cấu hình AI và secret liên quan. */
  @Delete("ai-providers/:providerId") @RequirePermissions("system:configure") async removeAiProvider(@Param("providerId") id: string): Promise<{ removed: true }> { await this.aiProviders.remove(id); return { removed: true }; }
  /** Bật hoặc tắt tích hợp phòng học. */
  @Patch("integrations/:integrationId") @RequirePermissions("system:configure") updateIntegration(@Param("integrationId") id: string, @Body() input: ToggleIntegrationDto, @CurrentSession() session: AuthenticatedSession): Promise<IntegrationConfig> { return this.system.updateIntegration(id, input.enabled, session.user.id); }
  /** Lưu thông tin provider, tham chiếu credential và webhook tích hợp. */
  @Post("integrations/configure") @RequirePermissions("system:configure") configureIntegration(@Body() input: ConfigureIntegrationDto, @CurrentSession() session: AuthenticatedSession): Promise<IntegrationConfig> { return this.system.configureIntegration(input, session.user.id); }
  /** Kiểm tra kết nối tích hợp và cập nhật health state. */
  @Post("integrations/:integrationId/test") @RequirePermissions("system:configure") testIntegration(@Param("integrationId") id: string, @CurrentSession() session: AuthenticatedSession): Promise<IntegrationConfig> { return this.system.testIntegration(id, session.user.id); }
  /** Chọn provider phòng học mặc định và bỏ mặc định ở provider còn lại. */
  @Post("integrations/:integrationId/default") @RequirePermissions("system:configure") setDefaultIntegration(@Param("integrationId") id: string, @CurrentSession() session: AuthenticatedSession): Promise<IntegrationConfig> { return this.system.setDefaultIntegration(id, session.user.id); }
  /** Tạo phòng thử có thời hạn để xác minh tích hợp cuối-cuối. */
  @Post("integrations/:integrationId/test-meeting") @RequirePermissions("system:configure") createTestMeeting(@Param("integrationId") id: string, @CurrentSession() session: AuthenticatedSession): Promise<{ provider: string; attendeeUrl: string; expiresAt: string }> { return this.system.createTestMeeting(id, session.user.id); }
  /** Liệt kê các lần sao lưu và trạng thái. */
  @Get("backups") @RequirePermissions("system:configure") listBackups(): Promise<BackupRun[]> { return this.system.listBackups(); }
  /** Khởi chạy sao lưu full hoặc incremental. */
  @Post("backups") @RequirePermissions("system:configure") runBackup(@Body() input: RunBackupDto, @CurrentSession() session: AuthenticatedSession): Promise<BackupRun> { return this.system.runBackup(input.type, session.user.id); }
  /** Liệt kê lịch sử phục hồi dữ liệu. */
  @Get("restores") @RequirePermissions("system:configure") listRestores(): Promise<RestoreRun[]> { return this.system.listRestores(); }
  /** Tạo yêu cầu phục hồi chờ một quản trị viên khác phê duyệt. */
  @Post("restores") @RequirePermissions("system:configure") requestRestore(@Body() input: RestoreBackupDto, @CurrentSession() session: AuthenticatedSession): Promise<RestoreRun> { return this.system.requestRestore(input, session.user.id); }
  /** Phê duyệt và thực thi yêu cầu phục hồi bằng danh tính phiên hiện tại. */
  @Post("restores/:restoreId/approve") @RequirePermissions("system:configure") approveRestore(@Param("restoreId") restoreId: string, @CurrentSession() session: AuthenticatedSession): Promise<RestoreRun> { return this.system.approveRestore(restoreId, session.user.id); }
  /** Xem trước số bản ghi bị tác động bởi chính sách lưu giữ. */
  @Get("retention-preview") @RequirePermissions("system:configure") previewRetention(@Query("category") category = "LEARNING"): Promise<object> { return this.system.previewRetention(category); }
  /** Liệt kê các phiên bản chính sách lưu giữ. */
  @Get("retention-policies") @RequirePermissions("system:configure") listRetentionPolicies(): Promise<RetentionPolicyView[]> { return this.system.listRetentionPolicies(); }
  /** Tạo chính sách lưu giữ mới với phê duyệt và ngày hiệu lực. */
  @Post("retention-policies") @RequirePermissions("system:configure") createRetentionPolicy(@Body() input: CreateRetentionPolicyDto, @CurrentSession() session: AuthenticatedSession): Promise<RetentionPolicyView> { return this.system.createRetentionPolicy(input, session.user.id); }
  /** Đặt legal hold để loại một danh mục khỏi xóa/lưu trữ tự động. */
  @Post("legal-holds") @RequirePermissions("system:configure") createLegalHold(@Body() input: CreateLegalHoldDto, @CurrentSession() session: AuthenticatedSession): Promise<object> { return this.system.createLegalHold(input.category, input.reason, session.user.id); }
  /** Liệt kê legal hold đang hoạt động và đã giải tỏa. */
  @Get("legal-holds") @RequirePermissions("system:configure") listLegalHolds(): Promise<LegalHoldView[]> { return this.system.listLegalHolds(); }
  /** Giải tỏa một legal hold với lý do và dấu vết người thực hiện. */
  @Patch("legal-holds/:holdId/release") @RequirePermissions("system:configure") releaseLegalHold(@Param("holdId") holdId: string, @Body() input: ReleaseLegalHoldDto, @CurrentSession() session: AuthenticatedSession): Promise<LegalHoldView> { return this.system.releaseLegalHold(holdId, input.reason, session.user.id); }
  /** Liệt kê lịch sử job lưu giữ. */
  @Get("retention-jobs") @RequirePermissions("system:configure") listRetentionJobs(): Promise<RetentionJobView[]> { return this.system.listRetentionJobs(); }
  /** Chạy chính sách lưu giữ với người yêu cầu và phê duyệt tách biệt. */
  @Post("retention-jobs") @RequirePermissions("system:configure") runRetention(@Body() input: RunRetentionDto, @CurrentSession() session: AuthenticatedSession): Promise<RetentionJobView> { return this.system.runRetention(input.policyId, session.user.id); }
  /** Chỉ phiên của người có quyền khác người yêu cầu mới được phê duyệt tác vụ. */
  @Post("retention-jobs/:jobId/approve") @RequirePermissions("system:configure") approveRetention(@Param("jobId") jobId: string, @CurrentSession() session: AuthenticatedSession): Promise<RetentionJobView> { return this.system.approveRetention(jobId, session.user.id); }
  /** Kiểm tra gói archive và toàn bộ asset nhúng của một retention job. */
  @Post("retention-jobs/:jobId/verify") @RequirePermissions("system:configure") verifyRetentionArchive(@Param("jobId") jobId: string): Promise<object> { return this.system.verifyRetentionArchive(jobId); }
  /** Liệt kê các job xuất dữ liệu hệ thống. */
  @Get("exports") @RequirePermissions("system:configure") listExports(): Promise<DataExport[]> { return this.system.listExports(); }
  /** Chạy xuất dữ liệu theo danh mục và định dạng. */
  @Post("exports") @RequirePermissions("system:configure") runExport(@Body() input: ExportDataDto, @CurrentSession() session: AuthenticatedSession): Promise<DataExport> { return this.system.runExport(input.category, input.format, session.user.id); }
  /** Stream tệp export còn hạn sau khi xác minh checksum tại thời điểm tải. */
  @Get("exports/:exportId/download") @RequirePermissions("system:configure") async downloadExport(@Param("exportId") exportId: string): Promise<StreamableFile> { const file = await this.system.downloadExport(exportId); return new StreamableFile(file.buffer, { type: file.mimeType, disposition: `attachment; filename="${file.filename}"` }); }
  /** Liệt kê các mẫu thông báo và version. */
  @Get("notification-templates") @RequirePermissions("system:configure") listTemplates(): Promise<NotificationTemplate[]> { return this.system.listTemplates(); }
  /** Lưu phiên bản mới của mẫu thông báo. */
  @Post("notification-templates") @RequirePermissions("system:configure") saveTemplate(@Body() input: SaveTemplateDto, @CurrentSession() session: AuthenticatedSession): Promise<NotificationTemplate> { return this.system.saveTemplate(input, session.user.id); }
  /** Render thử mẫu với biến do quản trị cung cấp. */
  @Post("notification-templates/:templateId/preview") @RequirePermissions("system:configure") previewTemplate(@Param("templateId") id: string, @Body() input: PreviewTemplateDto): Promise<object> { return this.system.previewTemplate(id, input.variables ?? {}); }
  /** Gửi email thử từ mẫu đã render và ghi audit kết quả. */
  @Post("notification-templates/:templateId/test-send") @RequirePermissions("system:configure") testTemplate(@Param("templateId") id: string, @Body() input: TestTemplateDto, @CurrentSession() session: AuthenticatedSession): Promise<TemplateTestDelivery> { return this.system.sendTemplateTest(id, input.recipient, input.variables ?? {}, session.user.id); }
  /** Đọc chính sách kiểm duyệt diễn đàn hiện hành. */
  @Get("moderation-policy") @RequirePermissions("system:configure") getModeration(): Promise<ModerationPolicy> { return this.system.getModerationPolicy(); }
  /** Cập nhật từ cấm, rate limit và hành động kiểm duyệt. */
  @Patch("moderation-policy") @RequirePermissions("system:configure") updateModeration(@Body() input: UpdateModerationDto, @CurrentSession() session: AuthenticatedSession): Promise<ModerationPolicy> { return this.system.updateModerationPolicy(input, session.user.id); }
  /** Tìm audit theo từ khóa, actor, action, target và khoảng thời gian. */
  @Get("audit") @RequirePermissions("system:configure") listAudit(@Query("query") query?: string, @Query("actor") actor?: string, @Query("action") action?: string, @Query("target") target?: string, @Query("from") from?: string, @Query("to") to?: string): Promise<AuditEvent[]> { return this.system.listAudit({ query, actor, action, target, from, to }); }
  /** Tổng hợp sức khỏe DB, storage và các dịch vụ ngoài. */
  @Get("health-overview") @RequirePermissions("system:configure") healthOverview(): Promise<object> { return this.system.healthOverview(); }
  /** Trả số email outbox theo trạng thái để giám sát backlog và lỗi retry. */
  @Get("outbox/stats") @RequirePermissions("system:configure") outboxStats(): Promise<Record<string, number>> { return this.outbox.stats(); }
  /** Cho phép vận hành kích hoạt một batch retry ngay thay vì đợi worker định kỳ. */
  @Post("outbox/drain") @RequirePermissions("system:configure") drainOutbox(): Promise<{ processed: number; delivered: number; failed: number }> { return this.outbox.drain(); }
  /** Liệt kê cảnh báo hệ thống đang hoạt động và lịch sử. */
  @Get("alerts") @RequirePermissions("system:configure") listAlerts(): Promise<SystemAlertView[]> { return this.system.listAlerts(); }
  /** Xác nhận, tạm ẩn hoặc giải quyết một cảnh báo. */
  @Patch("alerts/:alertId") @RequirePermissions("system:configure") updateAlert(@Param("alertId") alertId: string, @Body() input: UpdateAlertDto, @CurrentSession() session: AuthenticatedSession): Promise<SystemAlertView> { return this.system.updateAlert(alertId, input.action, session.user.id, input.muteMinutes); }
  /** Tính dung lượng đã dùng, quota và phân bố theo loại tệp. */
  @Get("storage-overview") @RequirePermissions("system:configure") storageOverview(): Promise<StorageOverview> { return this.system.getStorageOverview(); }
  /** Đối soát snapshot bị thiếu, object dùng chung và metadata trỏ tới object mất. */
  @Get("snapshot-asset-audit") @RequirePermissions("system:configure") snapshotAssetAudit(): Promise<SnapshotAssetAudit> { return this.system.snapshotAssetAudit(); }
  /** Liệt kê các object đã xóa mềm nhưng storage cleanup chưa thành công. */
  @Get("storage-cleanup-failures") @RequirePermissions("system:configure") storageCleanupFailures(): Promise<StorageCleanupFailure[]> { return this.system.listStorageCleanupFailures(); }
  /** Thử lại một object cleanup thất bại bằng actor của phiên quản trị. */
  @Post("storage-cleanup-failures/:attachmentId/retry") @RequirePermissions("system:configure") retryStorageCleanup(@Param("attachmentId") attachmentId: string, @CurrentSession() session: AuthenticatedSession): Promise<{ cleaned: true }> { return this.system.retryStorageCleanup(attachmentId, session.user.id); }
}
