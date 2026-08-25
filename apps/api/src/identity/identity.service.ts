import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { DEFAULT_ROLE_PERMISSIONS } from "../auth/permissions.js";
import type { CreateUserDto, UpdateRolePermissionsDto, UpdateUserDto } from "./identity.dto.js";
import type { IdentityAuditEvent, IdentityRole, IdentityUser } from "./identity.types.js";

const now = (): string => new Date().toISOString();

@Injectable()
export class IdentityService {
  private readonly users: IdentityUser[] = [
    { id: "usr-admin", displayName: "Wind Of Fall", email: "admin@wind.edu.vn", roleCode: "SYSTEM_ADMIN", status: "ACTIVE", createdAt: now(), updatedAt: now() },
    { id: "usr-manager", displayName: "Nguyễn Minh Anh", email: "manager@wind.edu.vn", roleCode: "CENTER_MANAGER", status: "ACTIVE", createdAt: now(), updatedAt: now() },
    { id: "usr-instructor", displayName: "Trần Thu Hà", email: "instructor@wind.edu.vn", roleCode: "INSTRUCTOR", status: "ACTIVE", createdAt: now(), updatedAt: now() },
    { id: "usr-learner", displayName: "Lê Hoàng Nam", email: "learner@wind.edu.vn", roleCode: "LEARNER", status: "ACTIVE", createdAt: now(), updatedAt: now() },
  ];

  private readonly roles: IdentityRole[] = [
    { code: "SYSTEM_ADMIN", name: "Quản trị hệ thống", description: "Toàn quyền cấu hình và vận hành.", permissions: [...DEFAULT_ROLE_PERMISSIONS.SYSTEM_ADMIN], version: 1 },
    { code: "CENTER_MANAGER", name: "Quản lý trung tâm", description: "Quản lý khóa học, lớp và vận hành trung tâm.", permissions: [...DEFAULT_ROLE_PERMISSIONS.CENTER_MANAGER], version: 1 },
    { code: "INSTRUCTOR", name: "Giảng viên", description: "Giảng dạy, đánh giá và điều phối lớp.", permissions: [...DEFAULT_ROLE_PERMISSIONS.INSTRUCTOR], version: 1 },
    { code: "LEARNER", name: "Học viên", description: "Học tập, làm bài và trao đổi.", permissions: [...DEFAULT_ROLE_PERMISSIONS.LEARNER], version: 1 },
  ];

  private readonly auditEvents: IdentityAuditEvent[] = [];

  listUsers(query?: string): IdentityUser[] {
    const normalized = query?.trim().toLocaleLowerCase("vi") ?? "";
    return this.users
      .filter((user) => !normalized || `${user.displayName} ${user.email}`.toLocaleLowerCase("vi").includes(normalized))
      .map((user) => ({ ...user }));
  }

  createUser(input: CreateUserDto): IdentityUser {
    const normalizedEmail = input.email.trim().toLowerCase();
    if (this.users.some((user) => user.email.toLowerCase() === normalizedEmail)) {
      throw new ConflictException("Email đã tồn tại trong hệ thống.");
    }
    const timestamp = now();
    const user: IdentityUser = {
      id: `usr-${randomUUID()}`,
      displayName: input.displayName.trim(),
      email: normalizedEmail,
      roleCode: input.roleCode,
      status: "ACTIVE",
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    this.users.unshift(user);
    this.audit("USER_CREATED", user.id, `Tạo tài khoản ${user.email}`);
    return { ...user };
  }

  updateUser(userId: string, input: UpdateUserDto): IdentityUser {
    const user = this.users.find((item) => item.id === userId);
    if (!user) throw new NotFoundException("Không tìm thấy tài khoản.");

    if (user.roleCode === "SYSTEM_ADMIN" && user.status === "ACTIVE" && input.status && input.status !== "ACTIVE") {
      const activeAdmins = this.users.filter((item) => item.roleCode === "SYSTEM_ADMIN" && item.status === "ACTIVE");
      if (activeAdmins.length === 1) throw new BadRequestException("Không thể khóa quản trị viên hoạt động cuối cùng.");
    }

    const before = `${user.roleCode}/${user.status}`;
    if (input.displayName) user.displayName = input.displayName.trim();
    if (input.roleCode) user.roleCode = input.roleCode;
    if (input.status) user.status = input.status;
    user.updatedAt = now();
    this.audit("USER_UPDATED", user.id, `${before} → ${user.roleCode}/${user.status}`);
    return { ...user };
  }

  listRoles(): IdentityRole[] {
    return this.roles.map((role) => ({ ...role, permissions: [...role.permissions] }));
  }

  updateRolePermissions(input: UpdateRolePermissionsDto): IdentityRole {
    const role = this.roles.find((item) => item.code === input.roleCode);
    if (!role) throw new NotFoundException("Không tìm thấy vai trò.");
    if (input.roleCode === "SYSTEM_ADMIN" && !input.permissions.includes("role:update")) {
      throw new BadRequestException("Vai trò quản trị phải giữ quyền role:update.");
    }
    role.permissions = [...new Set(input.permissions)];
    role.version += 1;
    this.audit("ROLE_PERMISSIONS_UPDATED", role.code, `Cập nhật ${role.permissions.length} quyền, phiên bản ${role.version}`);
    return { ...role, permissions: [...role.permissions] };
  }

  listAuditEvents(): IdentityAuditEvent[] {
    return this.auditEvents.map((event) => ({ ...event }));
  }

  private audit(action: string, targetId: string, summary: string): void {
    this.auditEvents.unshift({ id: randomUUID(), action, targetId, summary, createdAt: now() });
  }
}
