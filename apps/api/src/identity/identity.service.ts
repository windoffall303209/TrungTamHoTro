import { BadRequestException, ConflictException, Injectable, NotFoundException, Optional } from "@nestjs/common";
import { randomBytes, randomUUID, scryptSync } from "node:crypto";
import type { Prisma } from "../generated/prisma/client.js";
import { DEFAULT_ROLE_PERMISSIONS, type PermissionCode, type RoleCode } from "../auth/permissions.js";
import { PrismaService } from "../database/prisma.service.js";
import type { CreateUserDto, UpdateRolePermissionsDto, UpdateUserDto } from "./identity.dto.js";
import { hashPassword } from "../auth/password.js";
import type { IdentityAuditEvent, IdentityRole, IdentityUser } from "./identity.types.js";

const now = (): string => new Date().toISOString();
const isUniqueConstraintError = (error: unknown): boolean =>
  typeof error === "object" && error !== null && "code" in error && error.code === "P2002";

type UserWithRoles = Prisma.UserGetPayload<{ include: { roles: { include: { role: true } } } }>;
type RoleWithPermissions = Prisma.RoleGetPayload<{
  include: { permissions: { include: { permission: true } } };
}>;

@Injectable()
export class IdentityService {
  private readonly users: IdentityUser[] = [
    { id: "usr-admin", username: "admin@wind.edu.vn", displayName: "Wind Of Fall", email: "admin@wind.edu.vn", roleCode: "SYSTEM_ADMIN", status: "ACTIVE", createdAt: now(), updatedAt: now() },
    { id: "usr-manager", username: "manager@wind.edu.vn", displayName: "Nguyễn Minh Anh", email: "manager@wind.edu.vn", roleCode: "CENTER_MANAGER", status: "ACTIVE", createdAt: now(), updatedAt: now() },
    { id: "usr-instructor", username: "instructor@wind.edu.vn", displayName: "Trần Thu Hà", email: "instructor@wind.edu.vn", roleCode: "INSTRUCTOR", status: "ACTIVE", createdAt: now(), updatedAt: now() },
    { id: "usr-learner", username: "learner@wind.edu.vn", displayName: "Lê Hoàng Nam", email: "learner@wind.edu.vn", roleCode: "LEARNER", status: "ACTIVE", createdAt: now(), updatedAt: now() },
  ];

  private readonly roles: IdentityRole[] = [
    { code: "SYSTEM_ADMIN", name: "Quản trị hệ thống", description: "Toàn quyền cấu hình và vận hành.", permissions: [...DEFAULT_ROLE_PERMISSIONS.SYSTEM_ADMIN], version: 1 },
    { code: "CENTER_MANAGER", name: "Quản lý trung tâm", description: "Quản lý khóa học, lớp và vận hành trung tâm.", permissions: [...DEFAULT_ROLE_PERMISSIONS.CENTER_MANAGER], version: 1 },
    { code: "INSTRUCTOR", name: "Giảng viên", description: "Giảng dạy, đánh giá và điều phối lớp.", permissions: [...DEFAULT_ROLE_PERMISSIONS.INSTRUCTOR], version: 1 },
    { code: "LEARNER", name: "Học viên", description: "Học tập, làm bài và trao đổi.", permissions: [...DEFAULT_ROLE_PERMISSIONS.LEARNER], version: 1 },
  ];

  private readonly auditEvents: IdentityAuditEvent[] = [];

  constructor(@Optional() private readonly prisma?: PrismaService) {}

  async listUsers(query?: string): Promise<IdentityUser[]> {
    const normalized = query?.trim() ?? "";
    const prisma = this.database();
    if (prisma) {
      const rows = await prisma.user.findMany({
        where: normalized
          ? { OR: [{ username: { contains: normalized } }, { displayName: { contains: normalized } }, { email: { contains: normalized } }] }
          : undefined,
        include: { roles: { include: { role: true }, take: 1 } },
        orderBy: { createdAt: "desc" },
      });
      return rows.map((row) => this.mapUser(row));
    }

    const memoryQuery = normalized.toLocaleLowerCase("vi");
    return this.users
      .filter((user) => !memoryQuery || `${user.username} ${user.displayName} ${user.email}`.toLocaleLowerCase("vi").includes(memoryQuery))
      .map((user) => ({ ...user }));
  }

  async createUser(input: CreateUserDto, actorId = "usr-admin"): Promise<IdentityUser> {
    const normalizedEmail = input.email.trim().toLowerCase();
    const normalizedUsername = input.username.trim().toLowerCase();
    const prisma = this.database();
    if (prisma) {
      try {
        const row = await prisma.$transaction(async (transaction) => {
          const role = await transaction.role.findUnique({ where: { code: input.roleCode } });
          if (!role) throw new BadRequestException("Vai trò chưa được khởi tạo trong MySQL.");
          const user = await transaction.user.create({
            data: {
              id: `usr-${randomUUID()}`,
              username: normalizedUsername,
              displayName: input.displayName.trim(),
              email: normalizedEmail,
              emailVerifiedAt: new Date(),
              passwordHash: input.initialPassword ? await hashPassword(input.initialPassword) : this.createDisabledPasswordHash(),
              roles: { create: { roleId: role.id } },
            },
            include: { roles: { include: { role: true }, take: 1 } },
          });
          await this.writeDatabaseAudit(transaction, actorId, "USER_CREATED", user.id, `Tạo tài khoản ${user.email}`);
          return user;
        });
        return this.mapUser(row);
      } catch (error) {
        if (isUniqueConstraintError(error)) throw new ConflictException("Tài khoản hoặc email đã tồn tại trong hệ thống.");
        throw error;
      }
    }

    if (this.users.some((user) => user.email.toLowerCase() === normalizedEmail || user.username === normalizedUsername)) {
      throw new ConflictException("Tài khoản hoặc email đã tồn tại trong hệ thống.");
    }
    const timestamp = now();
    const user: IdentityUser = {
      id: `usr-${randomUUID()}`,
      username: normalizedUsername,
      displayName: input.displayName.trim(),
      email: normalizedEmail,
      roleCode: input.roleCode,
      status: "ACTIVE",
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    this.users.unshift(user);
    this.audit(actorId, "USER_CREATED", user.id, `Tạo tài khoản ${user.email}`);
    return { ...user };
  }

  async updateUser(userId: string, input: UpdateUserDto, actorId = "usr-admin"): Promise<IdentityUser> {
    const prisma = this.database();
    if (prisma) {
      return prisma.$transaction(async (transaction) => {
        const current = await transaction.user.findUnique({
          where: { id: userId },
          include: { roles: { include: { role: true }, take: 1 } },
        });
        if (!current) throw new NotFoundException("Không tìm thấy tài khoản.");
        const currentRole = this.getRoleCode(current);
        const removesActiveAdmin = currentRole === "SYSTEM_ADMIN"
          && current.status === "ACTIVE"
          && Boolean((input.status && input.status !== "ACTIVE") || (input.roleCode && input.roleCode !== "SYSTEM_ADMIN"));
        if (removesActiveAdmin) {
          const activeAdmins = await transaction.user.count({
            where: { status: "ACTIVE", roles: { some: { role: { code: "SYSTEM_ADMIN" } } } },
          });
          if (activeAdmins === 1) throw new BadRequestException("Không thể khóa hoặc hạ quyền quản trị viên hoạt động cuối cùng.");
        }

        const nextRole = input.roleCode
          ? await transaction.role.findUnique({ where: { code: input.roleCode } })
          : undefined;
        if (input.roleCode && !nextRole) throw new BadRequestException("Vai trò chưa được khởi tạo trong MySQL.");
        if (nextRole && nextRole.code !== currentRole) {
          await transaction.userRole.deleteMany({ where: { userId } });
          await transaction.userRole.create({ data: { userId, roleId: nextRole.id } });
        }
        await transaction.user.update({
          where: { id: userId },
          data: { displayName: input.displayName?.trim(), status: input.status },
        });
        const updated = await transaction.user.findUniqueOrThrow({
          where: { id: userId },
          include: { roles: { include: { role: true }, take: 1 } },
        });
        await this.writeDatabaseAudit(
          transaction,
          actorId,
          "USER_UPDATED",
          userId,
          `${currentRole}/${current.status} → ${this.getRoleCode(updated)}/${updated.status}`,
        );
        return this.mapUser(updated);
      });
    }

    const user = this.users.find((item) => item.id === userId);
    if (!user) throw new NotFoundException("Không tìm thấy tài khoản.");
    const removesActiveAdmin = user.roleCode === "SYSTEM_ADMIN"
      && user.status === "ACTIVE"
      && Boolean((input.status && input.status !== "ACTIVE") || (input.roleCode && input.roleCode !== "SYSTEM_ADMIN"));
    if (removesActiveAdmin) {
      const activeAdmins = this.users.filter((item) => item.roleCode === "SYSTEM_ADMIN" && item.status === "ACTIVE");
      if (activeAdmins.length === 1) throw new BadRequestException("Không thể khóa hoặc hạ quyền quản trị viên hoạt động cuối cùng.");
    }

    const before = `${user.roleCode}/${user.status}`;
    if (input.displayName) user.displayName = input.displayName.trim();
    if (input.roleCode) user.roleCode = input.roleCode;
    if (input.status) user.status = input.status;
    user.updatedAt = now();
    this.audit(actorId, "USER_UPDATED", user.id, `${before} → ${user.roleCode}/${user.status}`);
    return { ...user };
  }

  async listRoles(): Promise<IdentityRole[]> {
    const prisma = this.database();
    if (prisma) {
      const rows = await prisma.role.findMany({
        include: { permissions: { include: { permission: true } } },
        orderBy: { name: "asc" },
      });
      return rows.map((row) => this.mapRole(row));
    }
    return this.roles.map((role) => ({ ...role, permissions: [...role.permissions] }));
  }

  async updateRolePermissions(input: UpdateRolePermissionsDto, actorId = "usr-admin"): Promise<IdentityRole> {
    if (input.roleCode === "SYSTEM_ADMIN" && !input.permissions.includes("role:update")) {
      throw new BadRequestException("Vai trò quản trị phải giữ quyền role:update.");
    }
    const prisma = this.database();
    if (prisma) {
      return prisma.$transaction(async (transaction) => {
        const role = await transaction.role.findUnique({ where: { code: input.roleCode } });
        if (!role) throw new NotFoundException("Không tìm thấy vai trò.");
        const uniquePermissions = [...new Set(input.permissions)];
        const permissionRows = await transaction.permission.findMany({
          where: { code: { in: uniquePermissions } },
          select: { id: true, code: true },
        });
        if (permissionRows.length !== uniquePermissions.length) {
          throw new BadRequestException("MySQL chưa có đủ danh mục quyền; cần chạy db:seed.");
        }
        await transaction.rolePermission.deleteMany({ where: { roleId: role.id } });
        if (permissionRows.length) {
          await transaction.rolePermission.createMany({
            data: permissionRows.map(({ id: permissionId }) => ({ roleId: role.id, permissionId })),
          });
        }
        await transaction.role.update({ where: { id: role.id }, data: { version: { increment: 1 } } });
        await this.writeDatabaseAudit(
          transaction,
          actorId,
          "ROLE_PERMISSIONS_UPDATED",
          role.code,
          `Cập nhật ${permissionRows.length} quyền, phiên bản ${role.version + 1}`,
        );
        const updated = await transaction.role.findUniqueOrThrow({
          where: { id: role.id },
          include: { permissions: { include: { permission: true } } },
        });
        return this.mapRole(updated);
      });
    }

    const role = this.roles.find((item) => item.code === input.roleCode);
    if (!role) throw new NotFoundException("Không tìm thấy vai trò.");
    role.permissions = [...new Set(input.permissions)];
    role.version += 1;
    this.audit(actorId, "ROLE_PERMISSIONS_UPDATED", role.code, `Cập nhật ${role.permissions.length} quyền, phiên bản ${role.version}`);
    return { ...role, permissions: [...role.permissions] };
  }

  async listAuditEvents(): Promise<IdentityAuditEvent[]> {
    const prisma = this.database();
    if (prisma) {
      const rows = await prisma.auditLog.findMany({
        where: { entityType: "identity" },
        orderBy: { createdAt: "desc" },
        take: 200,
      });
      return rows.map((row) => {
        const context = this.asRecord(row.context);
        return {
          id: row.id.toString(),
          actorId: row.actorId ?? "system",
          action: row.action,
          targetId: row.entityId ?? "unknown",
          summary: typeof context.summary === "string" ? context.summary : row.action,
          createdAt: row.createdAt.toISOString(),
        };
      });
    }
    return this.auditEvents.map((event) => ({ ...event }));
  }

  private database(): PrismaService | undefined {
    return this.prisma?.isStartupConnectionEnabled() ? this.prisma : undefined;
  }

  private mapUser(row: UserWithRoles): IdentityUser {
    return {
      id: row.id,
      username: row.username,
      displayName: row.displayName,
      email: row.email,
      roleCode: this.getRoleCode(row),
      status: row.status,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private getRoleCode(row: UserWithRoles): RoleCode {
    const code = row.roles[0]?.role.code;
    if (!code || !Object.hasOwn(DEFAULT_ROLE_PERMISSIONS, code)) {
      throw new BadRequestException(`Tài khoản ${row.email} chưa có vai trò hợp lệ.`);
    }
    return code as RoleCode;
  }

  private mapRole(row: RoleWithPermissions): IdentityRole {
    if (!Object.hasOwn(DEFAULT_ROLE_PERMISSIONS, row.code)) {
      throw new BadRequestException(`Mã vai trò ${row.code} không được ứng dụng hỗ trợ.`);
    }
    return {
      code: row.code as RoleCode,
      name: row.name,
      description: row.description ?? "",
      permissions: row.permissions.map(({ permission }) => permission.code as PermissionCode),
      version: row.version,
    };
  }

  private createDisabledPasswordHash(): string {
    const salt = randomBytes(16).toString("hex");
    const hash = scryptSync(randomBytes(32), salt, 64).toString("hex");
    return `scrypt:${salt}:${hash}`;
  }

  private async writeDatabaseAudit(
    transaction: Prisma.TransactionClient,
    actorId: string,
    action: string,
    targetId: string,
    summary: string,
  ): Promise<void> {
    await transaction.auditLog.create({
      data: { actorId, action, entityType: "identity", entityId: targetId, context: { summary } },
    });
  }

  private asRecord(value: Prisma.JsonValue | null): Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value)
      ? value as Record<string, unknown>
      : {};
  }

  private audit(actorId: string, action: string, targetId: string, summary: string): void {
    this.auditEvents.unshift({ id: randomUUID(), actorId, action, targetId, summary, createdAt: now() });
  }
}
