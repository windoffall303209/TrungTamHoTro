import { createParamDecorator, ExecutionContext, InternalServerErrorException } from "@nestjs/common";
import type { AuthenticatedSession } from "./auth.service.js";
import type { RequestWithRole } from "./permission.guard.js";

/** Lấy phiên đã được PermissionGuard gắn vào request; báo lỗi cấu hình nếu route chưa bật xác thực. */
export const CurrentSession = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthenticatedSession => {
    const session = context.switchToHttp().getRequest<RequestWithRole>().auth;
    if (!session) throw new InternalServerErrorException("Route chưa được cấu hình xác thực phiên.");
    return session;
  },
);
