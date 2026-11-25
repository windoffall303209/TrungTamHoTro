import { Body, Controller, Delete, Get, Header, Optional, Param, Patch, Post, Query, Sse, StreamableFile } from "@nestjs/common";
import type { Observable } from "rxjs";
import { DatabaseEventsService, type SnapshotStreamEvent } from "../../../database/database-events.service.js";
import { ApiTags } from "@nestjs/swagger";
import { IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from "class-validator";
import { parseOptionalQueryString, parsePageQuery, type PaginatedResult } from "../../../common/pagination.js";
import type { AuthenticatedSession } from "../../../auth/auth.service.js";
import { CurrentSession } from "../../../auth/current-session.decorator.js";
import { RequirePermissions } from "../../../auth/require-permissions.decorator.js";
import {
  SystemService,
  type AuditEvent,
  type BackupRun,
  type DataExport,
  type IntegrationConfig,
  type RestoreRun,
  type SnapshotAssetAudit,
  type StorageCleanupFailure,
  type StorageOverview,
  type SystemSettings,
} from "./system.service.js";
import { AiProviderService, type AiProviderConfig, type AiProviderType } from "../ai/ai-provider.service.js";
import { OutboxDeliveryService } from "../../../infrastructure/outbox-delivery.service.js";
import { USER_FILE_CSP } from "../../../infrastructure/file-signature.js";
import { fileContentDisposition } from "../../../infrastructure/file-transfer.js";
import { AllowDuringMaintenance } from "../operations/allow-during-maintenance.decorator.js";

class ConfigureAiTaskDto {
  @IsOptional() @IsString() @MaxLength(200) contextProviderId?: string;
  @IsIn(["SCAN_IMAGE", "GENERATE_EXAM", "DOCUMENT_CONTEXT", "DOCUMENT_QA", "GRADING_ASSIST"]) task!: "SCAN_IMAGE" | "GENERATE_EXAM" | "DOCUMENT_CONTEXT" | "DOCUMENT_QA" | "GRADING_ASSIST";
  @IsString() @MinLength(1) @MaxLength(200) providerId!: string;
  @IsString() @MinLength(1) @MaxLength(200) model!: string;
}

class UpdateSettingsDto { @IsOptional() @IsString() centerName?: string; @IsOptional() @IsString() timezone?: string; @IsOptional() @IsString() locale?: string; @IsOptional() @IsInt() @Min(1) @Max(500) maxFileSizeMb?: number; @IsOptional() @IsInt() @Min(100) @Max(1_000_000) storageQuotaMb?: number; @IsOptional() @IsArray() @IsString({ each: true }) allowedMimeTypes?: string[]; @IsOptional() @IsString() notificationSender?: string; @IsOptional() @IsBoolean() maintenanceMode?: boolean; @IsOptional() @IsBoolean() learnerEmailNotificationsEnabled?: boolean }
class ToggleIntegrationDto { @IsBoolean() enabled!: boolean }
class ConfigureIntegrationDto { @IsIn(["GOOGLE_MEET", "ZOOM", "JITSI"]) provider!: IntegrationConfig["provider"]; @IsOptional() @IsString() @MaxLength(150) credentialReference?: string; @IsOptional() @IsString() @MaxLength(2048) webhookUrl?: string }
class RunBackupDto { @IsIn(["FULL", "INCREMENTAL"]) type!: "FULL" | "INCREMENTAL" }
class RestoreBackupDto { @IsString() backupId!: string; @IsIn(["DRILL", "OPERATIONAL"]) mode!: "DRILL" | "OPERATIONAL"; @IsString() @MinLength(10) @MaxLength(500) reason!: string; @IsOptional() @IsString() @MaxLength(191) targetDatabase?: string }
class ExportDataDto { @IsString() category!: string; @IsIn(["CSV", "JSON"]) format!: "CSV" | "JSON" }
class ConfigureAiProviderDto { @IsOptional() @IsString() id?: string; @IsIn(["GEMINI", "NVIDIA_NIM", "OPENAI", "CUSTOM"]) provider!: AiProviderType; @IsOptional() @IsString() @MaxLength(100) name?: string; @IsString() @MinLength(1) @MaxLength(200) model!: string; @IsOptional() @IsString() @MaxLength(1000) baseUrl?: string; @IsOptional() @IsString() @MinLength(8) @MaxLength(1000) apiKey?: string; @IsOptional() @IsBoolean() enabled?: boolean; @IsOptional() @IsBoolean() isDefault?: boolean }

@ApiTags("System") @Controller("system")
/** API quản trị tập trung cho cấu hình, AI, tích hợp, sao lưu, xuất dữ liệu và giám sát. */
export class SystemController {
  constructor(private readonly system: SystemService, private readonly aiProviders: AiProviderService, private readonly outbox: OutboxDeliveryService,
    @Optional() private readonly databaseEvents?: DatabaseEventsService) {}
  /** Chỉ báo dữ liệu vận hành thay đổi; client đọc lại qua các endpoint kiểm quyền hiện hành. */
  @Sse("operations/events") @RequirePermissions("system:configure")
  watchOperations(): Observable<SnapshotStreamEvent<{ revision: number }>> {
    if (!this.databaseEvents) throw new Error("Database event listener is unavailable.");
    let revision = 0;
    return this.databaseEvents.watchSnapshot("job", "operations", () => Promise.resolve({ revision: ++revision }));
  }
  /** Đọc cấu hình hệ thống hiện hành. */
  @Get("settings") @RequirePermissions("system:configure") getSettings(): Promise<SystemSettings> { return this.system.getSettings(); }
  /** Cập nhật trực tiếp cấu hình hiện hành và ghi audit log. */
  @Patch("settings") @AllowDuringMaintenance() @RequirePermissions("system:configure") updateSettings(@Body() input: UpdateSettingsDto, @CurrentSession() session: AuthenticatedSession): Promise<SystemSettings> { return this.system.updateSettings(input, session.user.id); }
  /** Liệt kê cấu hình các nhà cung cấp phòng học. */
  @Get("integrations") @RequirePermissions("system:configure") listIntegrations(): Promise<IntegrationConfig[]> { return this.system.listIntegrations(); }
  /** Trả catalog model/endpoint mặc định của các nhà cung cấp AI. */
  @Get("ai-providers/catalog") @RequirePermissions("system:configure") getAiProviderCatalog(): ReturnType<AiProviderService["getCatalog"]> { return this.aiProviders.getCatalog(); }
  /** Trả phân công provider/model cho các tác vụ AI. */
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
  @Delete("ai-providers/:providerId") @RequirePermissions("system:configure") async removeAiProvider(@Param("providerId") id: string, @CurrentSession() session: AuthenticatedSession): Promise<{ removed: true }> { await this.aiProviders.remove(id, session.user.id); return { removed: true }; }
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
  @Post("backups") @AllowDuringMaintenance() @RequirePermissions("system:configure") runBackup(@Body() input: RunBackupDto, @CurrentSession() session: AuthenticatedSession): Promise<BackupRun> { return this.system.runBackup(input.type, session.user.id); }
  /** Liệt kê lịch sử phục hồi dữ liệu. */
  @Get("restores") @RequirePermissions("system:configure") listRestores(): Promise<RestoreRun[]> { return this.system.listRestores(); }
  /** Tạo yêu cầu phục hồi chờ một quản trị viên khác phê duyệt. */
  @Post("restores") @AllowDuringMaintenance() @RequirePermissions("system:configure") requestRestore(@Body() input: RestoreBackupDto, @CurrentSession() session: AuthenticatedSession): Promise<RestoreRun> { return this.system.requestRestore(input, session.user.id); }
  /** Phê duyệt và thực thi yêu cầu phục hồi bằng danh tính phiên hiện tại. */
  @Post("restores/:restoreId/approve") @AllowDuringMaintenance() @RequirePermissions("system:configure") approveRestore(@Param("restoreId") restoreId: string, @CurrentSession() session: AuthenticatedSession): Promise<RestoreRun> { return this.system.approveRestore(restoreId, session.user.id); }
  /** Liệt kê các job xuất dữ liệu hệ thống. */
  @Get("exports") @RequirePermissions("system:configure") listExports(): Promise<DataExport[]> { return this.system.listExports(); }
  /** Chạy xuất dữ liệu theo danh mục và định dạng. */
  @Post("exports") @RequirePermissions("system:configure") runExport(@Body() input: ExportDataDto, @CurrentSession() session: AuthenticatedSession): Promise<DataExport> { return this.system.runExport(input.category, input.format, session.user.id); }
  /** Stream tệp export còn hạn sau khi xác minh checksum tại thời điểm tải. */
  @Get("exports/:exportId/download") @RequirePermissions("system:configure") @Header("Content-Security-Policy", USER_FILE_CSP) async downloadExport(@Param("exportId") exportId: string, @CurrentSession() session: AuthenticatedSession): Promise<StreamableFile> { const file = await this.system.downloadExport(exportId, session.user.id); return new StreamableFile(file.buffer, { type: file.mimeType, disposition: fileContentDisposition("attachment", file.filename) }); }
  /** Tìm audit theo từ khóa, actor, action, target và khoảng thời gian. */
  @Get("audit") @RequirePermissions("system:configure") listAudit(@Query("query") query?: string, @Query("actor") actor?: string, @Query("action") action?: string, @Query("target") target?: string, @Query("from") from?: string, @Query("to") to?: string): Promise<AuditEvent[]> { return this.system.listAudit({ query, actor, action, target, from, to }); }

  /** Trả danh sách nhật ký audit phân trang từ DB kèm bộ lọc thời gian và từ khóa. */
  @Get("audit/page") @RequirePermissions("system:configure")
  listAuditPage(@Query() raw: Record<string, unknown>): Promise<PaginatedResult<AuditEvent>> {
    const { page, pageSize } = parsePageQuery(raw, { pageSize: 20, maxPageSize: 100 });
    return this.system.listAuditPage({
      query: parseOptionalQueryString(raw.query, "query", 255),
      actor: parseOptionalQueryString(raw.actor, "actor", 191),
      action: parseOptionalQueryString(raw.action, "action", 191),
      target: parseOptionalQueryString(raw.target, "target", 191),
      from: parseOptionalQueryString(raw.from, "from", 64),
      to: parseOptionalQueryString(raw.to, "to", 64),
      page,
      pageSize,
    });
  }
  /** Tổng hợp sức khỏe DB, storage và hàng đợi operational_jobs. */
  @Get("health-overview") @RequirePermissions("system:configure") healthOverview(): Promise<object> { return this.system.healthOverview(); }
  /** Trả số email outbox theo trạng thái để giám sát backlog và lỗi retry. */
  @Get("outbox/stats") @RequirePermissions("system:configure") outboxStats(): Promise<Record<string, number>> { return this.outbox.stats(); }
  /** Cho phép vận hành kích hoạt một batch retry ngay thay vì đợi worker định kỳ. */
  @Post("outbox/drain") @RequirePermissions("system:configure") drainOutbox(): Promise<{ processed: number; delivered: number; failed: number }> { return this.outbox.drain(); }
  /** Tính dung lượng đã dùng, quota và phân bố theo loại tệp. */
  @Get("storage-overview") @RequirePermissions("system:configure") storageOverview(): Promise<StorageOverview> { return this.system.getStorageOverview(); }
  /** Đối soát snapshot bị thiếu, object dùng chung và metadata trỏ tới object mất. */
  @Get("snapshot-asset-audit") @RequirePermissions("system:configure") snapshotAssetAudit(): Promise<SnapshotAssetAudit> { return this.system.snapshotAssetAudit(); }
  /** Liệt kê các object đã xóa mềm nhưng storage cleanup chưa thành công. */
  @Get("storage-cleanup-failures") @RequirePermissions("system:configure") storageCleanupFailures(): Promise<StorageCleanupFailure[]> { return this.system.listStorageCleanupFailures(); }
  /** Thử lại một object cleanup thất bại bằng actor của phiên quản trị. */
  @Post("storage-cleanup-failures/:attachmentId/retry") @RequirePermissions("system:configure") retryStorageCleanup(@Param("attachmentId") attachmentId: string, @CurrentSession() session: AuthenticatedSession): Promise<{ cleaned: true }> { return this.system.retryStorageCleanup(attachmentId, session.user.id); }
}
