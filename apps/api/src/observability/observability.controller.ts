import { Controller, Get } from "@nestjs/common";
import { RequirePermissions } from "../auth/require-permissions.decorator.js";
import { MetricsService } from "./metrics.service.js";

@Controller("observability")
/** Cung cấp snapshot vận hành cho tài khoản có quyền cấu hình hệ thống. */
export class ObservabilityController {
  constructor(private readonly metrics: MetricsService) {}

  @Get("metrics")
  @RequirePermissions("system:configure")
  /** Đọc snapshot hiện tại từ MetricsService; không reset bộ đếm. */
  metricsSnapshot(): object { return this.metrics.snapshot(); }
}
