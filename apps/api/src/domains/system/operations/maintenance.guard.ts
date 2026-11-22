import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  Optional,
  ServiceUnavailableException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request } from "express";
import { SystemService } from "../core/system.service.js";
import { ALLOW_DURING_MAINTENANCE } from "./allow-during-maintenance.decorator.js";

@Injectable()
/**
 * Chặn mutation khi maintenanceMode hiệu lực. Chỉ handler gắn @AllowDuringMaintenance() (đăng nhập, tắt bảo trì,
 * sao lưu/khôi phục) được miễn trừ; không so khớp chuỗi path thô nên `/system/../<route>` không còn lách được.
 */
export class MaintenanceGuard implements CanActivate {
  constructor(private readonly system: SystemService, @Optional() private readonly reflector: Reflector = new Reflector()) {}

  /** Đọc metadata của handler đã định tuyến và cấu hình hiệu lực, trả lỗi ổn định cho mutation bị tạm dừng. */
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    if (["GET", "HEAD", "OPTIONS"].includes(request.method.toUpperCase()))
      return true;
    if (this.reflector.getAllAndOverride<boolean | undefined>(ALLOW_DURING_MAINTENANCE, [context.getHandler(), context.getClass()]))
      return true;
    if (!(await this.system.isMaintenanceMode())) return true;
    throw new ServiceUnavailableException({
      statusCode: 503,
      code: "MAINTENANCE_MODE",
      message:
        "Hệ thống đang bảo trì. Dữ liệu vẫn xem được nhưng thao tác thay đổi tạm thời bị khóa.",
    });
  }
}
