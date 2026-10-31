import { Module } from "@nestjs/common";
import { SystemController } from "./system.controller.js";
import { SystemService } from "./system.service.js";
import { AiProviderService } from "../ai/ai-provider.service.js";
import { OperationalJobWorkerService } from "../operations/operational-job-worker.service.js";

@Module({ controllers: [SystemController], providers: [SystemService, AiProviderService, OperationalJobWorkerService], exports: [SystemService, AiProviderService] })
/** Đăng ký nghiệp vụ cấu hình hệ thống và AI provider cho các module khác sử dụng. */
export class SystemModule {}
