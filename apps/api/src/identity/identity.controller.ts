import { Body, Controller, Get, Param, Patch, Post, Put, Query } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import type { AuthenticatedSession } from "../auth/auth.service.js";
import { CurrentSession } from "../auth/current-session.decorator.js";
import { RequirePermissions } from "../auth/require-permissions.decorator.js";
import { CreateUserDto, UpdatePermissionsBodyDto, UpdateRolePermissionsDto, UpdateUserDto } from "./identity.dto.js";
import { IdentityService } from "./identity.service.js";
import type { IdentityAuditEvent, IdentityRole, IdentityUser } from "./identity.types.js";

@ApiTags("Identity")
@Controller("admin")
export class IdentityController {
  constructor(private readonly identityService: IdentityService) {}

  @Get("users")
  @RequirePermissions("user:view")
  @ApiOperation({ summary: "Danh sách và tìm kiếm tài khoản" })
  listUsers(@Query("query") query?: string): Promise<IdentityUser[]> {
    return this.identityService.listUsers(query);
  }

  @Post("users")
  @RequirePermissions("user:create")
  @ApiOperation({ summary: "Tạo tài khoản người dùng" })
  createUser(@Body() input: CreateUserDto, @CurrentSession() session: AuthenticatedSession): Promise<IdentityUser> {
    return this.identityService.createUser(input, session.user.id);
  }

  @Patch("users/:userId")
  @RequirePermissions("user:update")
  @ApiOperation({ summary: "Cập nhật thông tin hoặc trạng thái tài khoản" })
  updateUser(@Param("userId") userId: string, @Body() input: UpdateUserDto, @CurrentSession() session: AuthenticatedSession): Promise<IdentityUser> {
    return this.identityService.updateUser(userId, input, session.user.id);
  }

  @Get("roles")
  @RequirePermissions("role:view")
  listRoles(): Promise<IdentityRole[]> {
    return this.identityService.listRoles();
  }

  @Put("roles/:roleCode/permissions")
  @RequirePermissions("role:update")
  updateRolePermissions(
    @Param("roleCode") roleCode: UpdateRolePermissionsDto["roleCode"],
    @Body() input: UpdatePermissionsBodyDto,
    @CurrentSession() session: AuthenticatedSession,
  ): Promise<IdentityRole> {
    return this.identityService.updateRolePermissions({ roleCode, permissions: input.permissions }, session.user.id);
  }

  @Get("identity-audit")
  @RequirePermissions("user:view")
  listAuditEvents(): Promise<IdentityAuditEvent[]> {
    return this.identityService.listAuditEvents();
  }
}
