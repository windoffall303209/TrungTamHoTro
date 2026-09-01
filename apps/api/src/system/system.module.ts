import { Module } from "@nestjs/common";
import { SystemController } from "./system.controller.js";
import { SystemService } from "./system.service.js";
import { AiProviderService } from "./ai-provider.service.js";

@Module({ controllers: [SystemController], providers: [SystemService, AiProviderService], exports: [SystemService, AiProviderService] })
export class SystemModule {}
