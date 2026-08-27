import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request } from "express";
import { type PermissionCode, type RoleCode } from "./permissions.js";
import { REQUIRED_PERMISSIONS_KEY } from "./require-permissions.decorator.js";
import { AuthService, type AuthenticatedSession } from "./auth.service.js";

export interface RequestWithRole extends Request {
  roleCode: RoleCode;
  auth: AuthenticatedSession;
}

@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly authService: AuthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const permissions = this.reflector.getAllAndOverride<PermissionCode[]>(REQUIRED_PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!permissions?.length) return true;

    const request = context.switchToHttp().getRequest<RequestWithRole>();
    const session = await this.authService.resolve(
      this.authService.readToken(request.header("cookie") ?? undefined),
      request.header("x-role-code") ?? undefined,
    );
    request.auth = session;
    request.roleCode = session.roleCode;
    const granted = session.permissions;

    if (!permissions.every((permission) => granted.includes(permission))) {
      throw new ForbiddenException(`Vai trò ${session.roleCode} không có quyền: ${permissions.join(", ")}`);
    }
    return true;
  }

}
