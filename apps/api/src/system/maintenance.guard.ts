import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  ServiceUnavailableException,
} from "@nestjs/common";
import type { Request } from "express";
import { SystemService } from "./system.service.js";

@Injectable()
/** Chặn mutation nghiệp vụ khi maintenanceMode hiệu lực nhưng vẫn cho phép đăng nhập, kiểm tra sức khỏe và quản trị hệ thống. */
export class MaintenanceGuard implements CanActivate {
  constructor(private readonly system: SystemService) {}

  /** Đọc cấu hình hiệu lực tại thời điểm request và trả lỗi ổn định cho mutation bị tạm dừng. */
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    if (["GET", "HEAD", "OPTIONS"].includes(request.method.toUpperCase()))
      return true;
    const path = request.path || request.url.split("?")[0] || "/";
    if (
      path.startsWith("/auth/") ||
      path.startsWith("/health") ||
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
