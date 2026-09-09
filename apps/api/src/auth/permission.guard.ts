import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request } from "express";
import { type PermissionCode, type RoleCode } from "./permissions.js";
import { AUTHENTICATION_REQUIRED_KEY, REQUIRED_PERMISSIONS_KEY } from "./require-permissions.decorator.js";
import { AuthService, type AuthenticatedSession } from "./auth.service.js";

export interface RequestWithRole extends Request {
  roleCode: RoleCode;
  auth: AuthenticatedSession;
}

@Injectable()
/** Khôi phục phiên, chọn vai trò đang dùng và bắt buộc đủ toàn bộ quyền khai báo trên route. */
export class PermissionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly authService: AuthService,
  ) {}

  /** Khôi phục session, gắn ngữ cảnh xác thực lên request và đối chiếu quyền route yêu cầu. */
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const permissions = this.reflector.getAllAndOverride<PermissionCode[]>(REQUIRED_PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const authenticationRequired = this.reflector.getAllAndOverride<boolean>(AUTHENTICATION_REQUIRED_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!authenticationRequired && !permissions?.length) return true;

    // Gắn phiên vào request để controller và @CurrentSession dùng lại, tránh giải mã phiên lần hai.
    const request = context.switchToHttp().getRequest<RequestWithRole>();
    const session = await this.authService.resolve(
      this.authService.readToken(request.header("cookie") ?? undefined),
      request.header("x-role-code") ?? undefined,
    );
    request.auth = session;
    request.roleCode = session.roleCode;
    const granted = session.permissions;

    if (permissions?.length && !permissions.every((permission) => granted.includes(permission))) {
      throw new ForbiddenException(`Vai trò ${session.roleCode} không có quyền: ${permissions.join(", ")}`);
    }
    return true;
  }

}
