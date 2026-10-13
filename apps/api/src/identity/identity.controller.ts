import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
} from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import type { AuthenticatedSession } from "../auth/auth.service.js";
import { CurrentSession } from "../auth/current-session.decorator.js";
import { RequirePermissions } from "../auth/require-permissions.decorator.js";
import {
  CreateUserDto,
  UserListQueryDto,
  UpdatePermissionsBodyDto,
  UpdateRolePermissionsDto,
  UpdateUserDto,
  UserChangeImpactQueryDto,
} from "./identity.dto.js";
import { IdentityService } from "./identity.service.js";
import type {
  IdentityAuditEvent,
  IdentityChangeImpact,
  IdentityRole,
  IdentityUser,
} from "./identity.types.js";

@ApiTags("Identity")
@Controller("admin")
/** API quản trị danh tính; từng handler khai báo quyền và chuyển actorId sang service để ghi audit. */
export class IdentityController {
  constructor(private readonly identityService: IdentityService) {}

  @Get("users")
  @RequirePermissions("user:view")
  @ApiOperation({ summary: "Danh sách và tìm kiếm tài khoản" })
  /** Tìm tài khoản theo tên đăng nhập, họ tên hoặc email. */
  listUsers(@Query() query: UserListQueryDto): ReturnType<IdentityService["listUsersPage"]> {
    return this.identityService.listUsersPage(query);
  }

  @Post("users")
  @RequirePermissions("user:create")
  @ApiOperation({ summary: "Tạo tài khoản người dùng" })
  /** Tạo tài khoản quản trị chỉ định và ghi người thực hiện vào nhật ký. */
  createUser(
    @Body() input: CreateUserDto,
    @CurrentSession() session: AuthenticatedSession,
  ): Promise<IdentityUser> {
    return this.identityService.createUser(input, session.user.id);
  }

  @Get("users/:userId/change-impact")
  @RequirePermissions("user:update")
  /** Xem lớp, công việc và phiên sẽ bị ảnh hưởng trước khi đổi quyền. */
  previewUserChange(
    @Param("userId") userId: string,
    @Query() query: UserChangeImpactQueryDto,
  ): Promise<IdentityChangeImpact> {
    return this.identityService.previewUserChange(userId, query);
  }

  @Patch("users/:userId")
  @RequirePermissions("user:update")
  @ApiOperation({ summary: "Cập nhật thông tin hoặc trạng thái tài khoản" })
  /** Cập nhật hồ sơ/vai trò/trạng thái của tài khoản theo quyền user:update. */
  updateUser(
    @Param("userId") userId: string,
    @Body() input: UpdateUserDto,
    @CurrentSession() session: AuthenticatedSession,
  ): Promise<IdentityUser> {
    return this.identityService.updateUser(userId, input, session.user.id);
  }

  @Get("roles")
  @RequirePermissions("role:view")
  /** Liệt kê vai trò cùng tập quyền hiện hành. */
  listRoles(): Promise<IdentityRole[]> {
    return this.identityService.listRoles();
  }

  @Put("roles/:roleCode/permissions")
  @RequirePermissions("role:update")
  /** Thay thế toàn bộ tập quyền của một vai trò và tăng phiên bản cấu hình. */
  updateRolePermissions(
    @Param("roleCode") roleCode: UpdateRolePermissionsDto["roleCode"],
    @Body() input: UpdatePermissionsBodyDto,
    @CurrentSession() session: AuthenticatedSession,
  ): Promise<IdentityRole> {
    return this.identityService.updateRolePermissions(
      { roleCode, permissions: input.permissions },
      session.user.id,
    );
  }

  @Get("identity-audit")
  @RequirePermissions("user:view")
  /** Trả tối đa các sự kiện danh tính gần nhất để quản trị truy vết thay đổi. */
  listAuditEvents(): Promise<IdentityAuditEvent[]> {
    return this.identityService.listAuditEvents();
  }
}
