import { Controller, Get } from "@nestjs/common";
import { RequirePermissions } from "../auth/require-permissions.decorator.js";
import { MetricsService } from "./metrics.service.js";

@Controller("observability")
export class ObservabilityController {
  constructor(private readonly metrics: MetricsService) {}

  @Get("metrics")
  @RequirePermissions("system:configure")
  metricsSnapshot(): object { return this.metrics.snapshot(); }
}
