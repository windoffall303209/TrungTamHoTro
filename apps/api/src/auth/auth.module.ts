import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { PermissionGuard } from "./permission.guard.js";
import { AccountController, SessionController } from "./session.controller.js";
import { AuthService } from "./auth.service.js";
import { CsrfGuard } from "./csrf.guard.js";

@Module({
  controllers: [SessionController, AccountController],
  providers: [AuthService, { provide: APP_GUARD, useClass: PermissionGuard }, { provide: APP_GUARD, useClass: CsrfGuard }],
  exports: [AuthService],
})
export class AuthModule {}
