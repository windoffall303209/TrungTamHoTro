import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { PermissionGuard } from "./permission.guard.js";
import { SessionController } from "./session.controller.js";

@Module({
  controllers: [SessionController],
  providers: [{ provide: APP_GUARD, useClass: PermissionGuard }],
})
export class AuthModule {}

