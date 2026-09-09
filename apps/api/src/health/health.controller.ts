import { Controller, Get } from "@nestjs/common";
import { ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { SkipThrottle } from "@nestjs/throttler";
import { HealthService, type HealthStatus } from "./health.service.js";

@ApiTags("Health")
@Controller("health")
/** Public health endpoint dùng cho kiểm tra sống của API mà không bị rate limit. */
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get()
  @SkipThrottle()
  @ApiOperation({ summary: "Kiểm tra trạng thái API" })
  @ApiOkResponse({ description: "API đang hoạt động" })
  /** Trả snapshot nhẹ, không tạo query database trong mỗi lần probe. */
  getHealth(): HealthStatus {
    return this.healthService.getStatus();
  }
}
