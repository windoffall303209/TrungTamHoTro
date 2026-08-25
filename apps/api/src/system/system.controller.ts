import { Body, Controller, Get, Param, Patch, Post } from "@nestjs/common";
import { ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, Max, Min } from "class-validator";
import { RequirePermissions } from "../auth/require-permissions.decorator.js";
import { SystemService, type BackupRun, type IntegrationConfig, type SystemSettings } from "./system.service.js";

const modules = [{ key: "storage", name: "Kho dữ liệu", readiness: "operational" }, { key: "question-bank", name: "Ngân hàng câu hỏi", readiness: "operational" }, { key: "forum", name: "Diễn đàn trao đổi", readiness: "operational" }, { key: "live-class", name: "Lớp học online", readiness: "operational" }] as const;
class UpdateSettingsDto { @IsOptional() @IsString() centerName?: string; @IsOptional() @IsString() timezone?: string; @IsOptional() @IsString() locale?: string; @IsOptional() @IsInt() @Min(30) @Max(3650) retentionDays?: number; @IsOptional() @IsInt() @Min(1) @Max(500) maxFileSizeMb?: number; @IsOptional() @IsArray() @IsString({ each: true }) allowedMimeTypes?: string[]; @IsOptional() @IsBoolean() moderationEnabled?: boolean; @IsOptional() @IsString() notificationSender?: string; @IsOptional() @IsBoolean() maintenanceMode?: boolean }
class ToggleIntegrationDto { @IsBoolean() enabled!: boolean }
class RunBackupDto { @IsIn(["FULL", "INCREMENTAL"]) type!: "FULL" | "INCREMENTAL" }

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
  @Get("health-overview") @RequirePermissions("system:configure") healthOverview(): object { return this.system.healthOverview(); }
}
