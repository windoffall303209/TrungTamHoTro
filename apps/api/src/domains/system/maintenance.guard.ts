import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  Optional,
  ServiceUnavailableException,
} from "@nestjs/common";
import type { Request } from "express";
import { ConfigService } from "@nestjs/config";
import type { Environment } from "../../config/environment.js";
import { SystemService } from "./system.service.js";

@Injectable()
/** Chặn mutation nghiệp vụ khi maintenanceMode hiệu lực nhưng vẫn cho phép đăng nhập, kiểm tra sức khỏe và quản trị hệ thống. */
export class MaintenanceGuard implements CanActivate {
  constructor(private readonly system: SystemService, @Optional() private readonly config?: ConfigService<Environment, true>) {}

  /** Đọc cấu hình hiệu lực tại thời điểm request và trả lỗi ổn định cho mutation bị tạm dừng. */
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    if (["GET", "HEAD", "OPTIONS"].includes(request.method.toUpperCase()))
      return true;
    const rawPath = request.path || request.url.split("?")[0] || "/";
    const prefix = `/${(this.config?.get("API_PREFIX", { infer: true }) ?? "api").replace(/^\/+|\/+$/g, "")}/v${this.config?.get("API_VERSION", { infer: true }) ?? "1"}`;
    const path = rawPath.startsWith(`${prefix}/`) ? rawPath.slice(prefix.length) : rawPath;
    if (
      path.startsWith("/auth/") ||
      path === "/health" || path.startsWith("/health/") ||
      path.startsWith("/system/")
    )
      return true;
    if (!(await this.system.getSettings()).maintenanceMode) return true;
    throw new ServiceUnavailableException({
      statusCode: 503,
      code: "MAINTENANCE_MODE",
      message:
        "Hệ thống đang bảo trì. Dữ liệu vẫn xem được nhưng thao tác thay đổi tạm thời bị khóa.",
    });
  }
}
