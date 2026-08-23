import { Controller, Get } from "@nestjs/common";
import { ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { HealthService, type HealthStatus } from "./health.service.js";

@ApiTags("Health")
@Controller("health")
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get()
  @ApiOperation({ summary: "Kiểm tra trạng thái API" })
  @ApiOkResponse({ description: "API đang hoạt động" })
  getHealth(): HealthStatus {
    return this.healthService.getStatus();
  }
}

