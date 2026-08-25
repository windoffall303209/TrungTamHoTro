import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request } from "express";
import {
  DEFAULT_ROLE_PERMISSIONS,
  ROLE_CODES,
  type PermissionCode,
  type RoleCode,
} from "./permissions.js";
import { REQUIRED_PERMISSIONS_KEY } from "./require-permissions.decorator.js";

export interface RequestWithRole extends Request {
  roleCode: RoleCode;
}

@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const permissions = this.reflector.getAllAndOverride<PermissionCode[]>(REQUIRED_PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!permissions?.length) return true;

    const request = context.switchToHttp().getRequest<RequestWithRole>();
    const rawRole = request.header("x-role-code") ?? "SYSTEM_ADMIN";
    const roleCode = ROLE_CODES.includes(rawRole as RoleCode) ? rawRole as RoleCode : "LEARNER";
    request.roleCode = roleCode;
    const granted = DEFAULT_ROLE_PERMISSIONS[roleCode];

    if (!permissions.every((permission) => granted.includes(permission))) {
      throw new ForbiddenException(`Vai trò ${roleCode} không có quyền: ${permissions.join(", ")}`);
    }
    return true;
  }
}

