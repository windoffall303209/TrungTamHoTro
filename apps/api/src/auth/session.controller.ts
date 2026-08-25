import { Controller, ForbiddenException, Get, Headers, Optional } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { DEFAULT_ROLE_PERMISSIONS, ROLE_CODES, type RoleCode } from "./permissions.js";
import { PrismaService } from "../database/prisma.service.js";

const profiles: Record<RoleCode, { id: string; name: string; email: string; roleName: string }> = {
  SYSTEM_ADMIN: { id: "usr-admin", name: "Wind Of Fall", email: "admin@wind.edu.vn", roleName: "Quản trị hệ thống" },
  CENTER_MANAGER: { id: "usr-manager", name: "Nguyễn Minh Anh", email: "manager@wind.edu.vn", roleName: "Quản lý trung tâm" },
  INSTRUCTOR: { id: "usr-instructor", name: "Trần Thu Hà", email: "instructor@wind.edu.vn", roleName: "Giảng viên" },
  LEARNER: { id: "usr-learner", name: "Lê Hoàng Nam", email: "learner@wind.edu.vn", roleName: "Học viên" },
};

@ApiTags("Session")
@Controller("auth/session")
export class SessionController {
  constructor(@Optional() private readonly prisma?: PrismaService) {}

  @Get()
  @ApiOperation({ summary: "Lấy phiên demo theo vai trò" })
  async getSession(@Headers("x-role-code") rawRole?: string): Promise<object> {
    const roleCode = ROLE_CODES.includes(rawRole as RoleCode) ? rawRole as RoleCode : "LEARNER";
    if (this.prisma?.isStartupConnectionEnabled()) {
      const profile = profiles[roleCode];
      const user = await this.prisma.user.findFirst({
        where: { id: profile.id, status: "ACTIVE", roles: { some: { role: { code: roleCode } } } },
        include: { roles: { where: { role: { code: roleCode } }, include: { role: { include: { permissions: { include: { permission: true } } } } }, take: 1 } },
      });
      if (!user) throw new ForbiddenException("Tài khoản demo không hoạt động hoặc không còn vai trò được yêu cầu.");
      const role = user.roles[0]?.role;
      if (!role) throw new ForbiddenException("Tài khoản chưa có vai trò hợp lệ.");
      return {
        user: { id: user.id, name: user.displayName, email: user.email, roleName: role.name },
        roleCode,
        permissions: role.permissions.map(({ permission }) => permission.code),
      };
    }
    return { user: profiles[roleCode], roleCode, permissions: DEFAULT_ROLE_PERMISSIONS[roleCode] };
  }
}
