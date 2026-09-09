import { Module } from "@nestjs/common";
import { InfrastructureModule } from "../infrastructure/infrastructure.module.js";
import { IdentityController } from "./identity.controller.js";
import { IdentityService } from "./identity.service.js";

@Module({
  imports: [InfrastructureModule],
  controllers: [IdentityController],
  providers: [IdentityService],
  exports: [IdentityService],
})
/** Đóng gói API và nghiệp vụ quản trị người dùng, vai trò, quyền và audit danh tính. */
export class IdentityModule {}

