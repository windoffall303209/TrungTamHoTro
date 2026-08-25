import { CanActivate, ExecutionContext, ForbiddenException, Injectable, Optional } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request } from "express";
import {
  DEFAULT_ROLE_PERMISSIONS,
  ROLE_CODES,
  type PermissionCode,
  type RoleCode,
} from "./permissions.js";
import { REQUIRED_PERMISSIONS_KEY } from "./require-permissions.decorator.js";
import { PrismaService } from "../database/prisma.service.js";

export interface RequestWithRole extends Request {
  roleCode: RoleCode;
}

@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Optional() private readonly prisma?: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const permissions = this.reflector.getAllAndOverride<PermissionCode[]>(REQUIRED_PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!permissions?.length) return true;

    const request = context.switchToHttp().getRequest<RequestWithRole>();
    const rawRole = request.header("x-role-code") ?? "LEARNER";
    const roleCode = ROLE_CODES.includes(rawRole as RoleCode) ? rawRole as RoleCode : "LEARNER";
    request.roleCode = roleCode;
    const granted = await this.getPermissions(roleCode);

    if (!permissions.every((permission) => granted.includes(permission))) {
      throw new ForbiddenException(`Vai trò ${roleCode} không có quyền: ${permissions.join(", ")}`);
    }
    return true;
  }

  private async getPermissions(roleCode: RoleCode): Promise<PermissionCode[]> {
    if (!this.prisma?.isStartupConnectionEnabled()) return DEFAULT_ROLE_PERMISSIONS[roleCode];
    const role = await this.prisma.role.findUnique({
      where: { code: roleCode },
      include: { permissions: { include: { permission: true } } },
    });
    if (!role) throw new ForbiddenException(`Vai trò ${roleCode} chưa được cấu hình trong MySQL.`);
    return role.permissions.map(({ permission }) => permission.code).filter(
      (code): code is PermissionCode => (DEFAULT_ROLE_PERMISSIONS.SYSTEM_ADMIN as string[]).includes(code),
    );
  }
}
