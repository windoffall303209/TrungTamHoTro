import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { PermissionGuard } from "./permission.guard.js";
import { SessionController } from "./session.controller.js";
import { AuthService } from "./auth.service.js";

@Module({
  controllers: [SessionController],
  providers: [AuthService, { provide: APP_GUARD, useClass: PermissionGuard }],
  exports: [AuthService],
})
export class AuthModule {}
