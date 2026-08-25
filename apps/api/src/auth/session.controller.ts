import { Controller, Get, Headers } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { DEFAULT_ROLE_PERMISSIONS, ROLE_CODES, type RoleCode } from "./permissions.js";

const profiles: Record<RoleCode, { id: string; name: string; email: string; roleName: string }> = {
  SYSTEM_ADMIN: { id: "usr-admin", name: "Wind Of Fall", email: "admin@wind.edu.vn", roleName: "Quản trị hệ thống" },
  CENTER_MANAGER: { id: "usr-manager", name: "Nguyễn Minh Anh", email: "manager@wind.edu.vn", roleName: "Quản lý trung tâm" },
  INSTRUCTOR: { id: "usr-instructor", name: "Trần Thu Hà", email: "instructor@wind.edu.vn", roleName: "Giảng viên" },
  LEARNER: { id: "usr-learner", name: "Lê Hoàng Nam", email: "learner@wind.edu.vn", roleName: "Học viên" },
};

@ApiTags("Session")
@Controller("auth/session")
export class SessionController {
  @Get()
  @ApiOperation({ summary: "Lấy phiên demo theo vai trò" })
  getSession(@Headers("x-role-code") rawRole?: string): object {
    const roleCode = ROLE_CODES.includes(rawRole as RoleCode) ? rawRole as RoleCode : "SYSTEM_ADMIN";
    return { user: profiles[roleCode], roleCode, permissions: DEFAULT_ROLE_PERMISSIONS[roleCode] };
  }
}

