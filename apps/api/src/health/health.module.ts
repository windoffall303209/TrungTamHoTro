import { Module } from "@nestjs/common";
import { HealthController } from "./health.controller.js";
import { HealthService } from "./health.service.js";

@Module({
  controllers: [HealthController],
  providers: [HealthService],
})
/** Đăng ký health controller và service cho hạ tầng giám sát. */
export class HealthModule {}

