import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  Optional,
} from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import type { Prisma } from "../generated/prisma/client.js";
import { isPrismaUniqueConstraintError } from "../infrastructure/prisma-errors.js";
import { asPrismaJsonRecord } from "../infrastructure/prisma-json.js";
import {
  DEFAULT_ROLE_PERMISSIONS,
  type PermissionCode,
  type RoleCode,
} from "../auth/permissions.js";
import { PrismaService } from "../database/prisma.service.js";
import type {
  CreateUserDto,
  UserListQueryDto,
  UpdateRolePermissionsDto,
  UpdateUserDto,
} from "./identity.dto.js";
import { hashPassword } from "../auth/password.js";
import type {
  IdentityAuditEvent,
  IdentityChangeImpact,
  IdentityRole,
  IdentityUser,
} from "./identity.types.js";

/** Lấy thời điểm hiện tại theo định dạng ISO để lưu và trả về nhất quán. */
const now = (): string => new Date().toISOString();
type UserWithRoles = Prisma.UserGetPayload<{
  include: { roles: { include: { role: true } } };
}>;
type RoleWithPermissions = Prisma.RoleGetPayload<{
  include: { permissions: { include: { permission: true } } };
}>;

@Injectable()
/** Quản lý danh tính bằng Prisma khi có DB và dùng dữ liệu nhớ tương đương cho chế độ demo cục bộ. */
export class IdentityService {
  private readonly users: IdentityUser[] = [
    {
      id: "usr-admin",
      username: "admin@wind.edu.vn",
      displayName: "Wind Of Fall",
      email: "admin@wind.edu.vn",
      roleCode: "SYSTEM_ADMIN",
      roleCodes: ["SYSTEM_ADMIN"],
      status: "ACTIVE",
      createdAt: now(),
      updatedAt: now(),
    },
    {
      id: "usr-manager",
      username: "manager@wind.edu.vn",
      displayName: "Nguyễn Minh Anh",
      email: "manager@wind.edu.vn",
      roleCode: "CENTER_MANAGER",
      roleCodes: ["CENTER_MANAGER"],
      status: "ACTIVE",
      createdAt: now(),
      updatedAt: now(),
    },
    {
      id: "usr-instructor",
      username: "instructor@wind.edu.vn",
      displayName: "Trần Thu Hà",
      email: "instructor@wind.edu.vn",
      roleCode: "INSTRUCTOR",
      roleCodes: ["INSTRUCTOR"],
      status: "ACTIVE",
      createdAt: now(),
      updatedAt: now(),
    },
    {
      id: "usr-learner",
      username: "learner@wind.edu.vn",
      displayName: "Lê Hoàng Nam",
      email: "learner@wind.edu.vn",
      roleCode: "LEARNER",
      roleCodes: ["LEARNER"],
      status: "ACTIVE",
      createdAt: now(),
      updatedAt: now(),
    },
  ];

  private readonly roles: IdentityRole[] = [
    {
      code: "SYSTEM_ADMIN",
      name: "Quản trị hệ thống",
      description: "Toàn quyền cấu hình và vận hành.",
      permissions: [...DEFAULT_ROLE_PERMISSIONS.SYSTEM_ADMIN],
      version: 1,
    },
    {
      code: "CENTER_MANAGER",
      name: "Quản lý trung tâm",
      description: "Quản lý khóa học, lớp và vận hành trung tâm.",
      permissions: [...DEFAULT_ROLE_PERMISSIONS.CENTER_MANAGER],
      version: 1,
    },
    {
      code: "INSTRUCTOR",
      name: "Giảng viên",
      description: "Giảng dạy, đánh giá và điều phối lớp.",
      permissions: [...DEFAULT_ROLE_PERMISSIONS.INSTRUCTOR],
      version: 1,
    },
    {
      code: "LEARNER",
      name: "Học viên",
      description: "Học tập, làm bài và trao đổi.",
      permissions: [...DEFAULT_ROLE_PERMISSIONS.LEARNER],
      version: 1,
    },
  ];

  private readonly auditEvents: IdentityAuditEvent[] = [];

  constructor(@Optional() private readonly prisma?: PrismaService) {}

  /** Giới hạn quản lý trung tâm thao tác và cấp vai trò cho giáo viên, học sinh. */
  private assertUserChangeScope(currentRoleCodes: RoleCode[], nextRoleCodes: RoleCode[], actorRoleCode: RoleCode): void {
    if (!["SYSTEM_ADMIN", "CENTER_MANAGER"].includes(actorRoleCode))
      throw new ForbiddenException("Vai trò hiện tại không được chỉnh sửa tài khoản.");
    if (actorRoleCode === "CENTER_MANAGER" &&
      [...currentRoleCodes, ...nextRoleCodes].some((code) => code !== "INSTRUCTOR" && code !== "LEARNER"))
      throw new ForbiddenException("Quản lý trung tâm chỉ được chỉnh sửa và cấp vai trò Giáo viên hoặc Học sinh.");
  }

  /** Tìm kiếm người dùng ở DB hoặc fallback in-memory, rồi trả bản sao/view model an toàn. */
  async listUsersPage(input: UserListQueryDto): Promise<{ items: IdentityUser[]; total: number; active: number; locked: number; page: number; pageSize: number }> {
    const { page, pageSize } = input;
    if (!Number.isInteger(page) || page < 1 || page > 10000 || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 50 || (input.query?.length ?? 0) > 200) throw new BadRequestException("Tham số phân trang không hợp lệ.");
    const prisma = this.database();
    if (!prisma) {
      let all = await this.listUsers(input.query);
      if (input.roleCode) {
        all = all.filter((u) => u.roleCodes?.includes(input.roleCode!) || u.roleCode === input.roleCode);
      }
      if (input.status) {
        all = all.filter((u) => u.status === input.status);
      }
      return { items: all.slice((page - 1) * pageSize, page * pageSize), total: all.length, active: all.filter((user) => user.status === "ACTIVE").length, locked: all.filter((user) => user.status === "LOCKED").length, page, pageSize };
    }
    const query = input.query?.trim();
    const where: Prisma.UserWhereInput = {};
    if (query) {
      where.OR = [
        { username: { contains: query, mode: "insensitive" } },
        { displayName: { contains: query, mode: "insensitive" } },
        { email: { contains: query, mode: "insensitive" } },
      ];
    }
    if (input.roleCode) {
      where.roles = {
        some: {
          role: {
            code: input.roleCode,
          },
        },
      };
    }
    if (input.status) {
      where.status = input.status;
    }
    const [rows, total, active, locked] = await prisma.$transaction([
      prisma.user.findMany({ where, skip: (page - 1) * pageSize, take: pageSize, include: { roles: { include: { role: true } } }, orderBy: [{ createdAt: "desc" }, { id: "asc" }] }),
      prisma.user.count({ where }), prisma.user.count({ where: { ...where, status: "ACTIVE" } }), prisma.user.count({ where: { ...where, status: "LOCKED" } }),
    ], { isolationLevel: "RepeatableRead" });
    return { items: rows.map((row) => this.mapUser(row)), total, active, locked, page, pageSize };
  }

  /** Cung cấp danh sách nội bộ cho chế độ dữ liệu mẫu. HTTP dùng listUsersPage có giới hạn. */
  async listUsers(query?: string): Promise<IdentityUser[]> {
    const normalized = query?.trim() ?? "";
    const prisma = this.database();
    if (prisma) {
      const rows = await prisma.user.findMany({
        where: normalized
          ? {
              OR: [
                { username: { contains: normalized, mode: "insensitive" } },
                { displayName: { contains: normalized, mode: "insensitive" } },
                { email: { contains: normalized, mode: "insensitive" } },
              ],
            }
          : undefined,
        include: { roles: { include: { role: true }, take: 1 } },
        orderBy: { createdAt: "desc" },
      });
      return rows.map((row) => this.mapUser(row));
    }

    const memoryQuery = normalized.toLocaleLowerCase("vi");
    return this.users
      .filter(
        (user) =>
          !memoryQuery ||
          `${user.username} ${user.displayName} ${user.email}`
            .toLocaleLowerCase("vi")
            .includes(memoryQuery),
      )
      .map((user) => ({ ...user }));
  }

  /** Tạo tài khoản chưa xác thực bằng mật khẩu tạm; chỉ vai trò Quản trị hệ thống được cấp vai trò quản trị. */
  async createUser(
    input: CreateUserDto,
    actorId: string,
    actorRoleCode: RoleCode,
  ): Promise<IdentityUser> {
    const normalizedUsername = input.username.trim().toLowerCase();
    const roleCodes = [...new Set(input.roleCodes?.length ? input.roleCodes : [input.roleCode])];
    if (actorRoleCode !== "SYSTEM_ADMIN" && roleCodes.some((code) => code !== "INSTRUCTOR" && code !== "LEARNER"))
      throw new ForbiddenException(
        "Quản lý trung tâm chỉ được tạo tài khoản Giáo viên hoặc Học sinh.",
      );
    const prisma = this.database();
    if (prisma) {
      const passwordHash = await hashPassword(input.initialPassword);
      try {
        const row = await prisma.$transaction(async (transaction) => {
          const roles = await transaction.role.findMany({
            where: { code: { in: roleCodes } },
          });
          if (roles.length !== roleCodes.length)
            throw new BadRequestException(
              "Một hoặc nhiều vai trò chưa được khởi tạo trong PostgreSQL.",
            );
          const user = await transaction.user.create({
            data: {
              id: `usr-${randomUUID()}`,
              username: normalizedUsername,
              // Họ tên tạm lấy theo tên tài khoản; email và hồ sơ do người dùng bổ sung sau khi đăng nhập.
              displayName: normalizedUsername,
              status: "PENDING",
              passwordHash,
              roles: {
                create: roles.map((role) => ({ roleId: role.id })),
              },
            },
            include: { roles: { include: { role: true } } },
          });
          await this.writeDatabaseAudit(
            transaction,
            actorId,
            "USER_CREATED",
            user.id,
            `Tạo tài khoản ${user.username}`,
          );
          return user;
        });
        return this.mapUser(row);
      } catch (error) {
        if (isPrismaUniqueConstraintError(error))
          throw new ConflictException(
            "Tên tài khoản đã được sử dụng. Hãy chọn tên khác.",
          );
        throw error;
      }
    }

    if (this.users.some((user) => user.username === normalizedUsername)) {
      throw new ConflictException(
        "Tên tài khoản đã được sử dụng. Hãy chọn tên khác.",
      );
    }
    const timestamp = now();
    const user: IdentityUser = {
      id: `usr-${randomUUID()}`,
      username: normalizedUsername,
      displayName: normalizedUsername,
      email: null,
      roleCode: roleCodes[0]!,
      roleCodes,
      status: "PENDING",
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    this.users.unshift(user);
    this.audit(actorId, "USER_CREATED", user.id, `Tạo tài khoản ${user.username}`);
    return { ...user };
  }

  /** Tính ảnh hưởng và token nhất quán để giao diện xác nhận trước khi thay quyền. */
  async previewUserChange(
    userId: string,
    target: Pick<UpdateUserDto, "roleCode" | "roleCodes" | "status">,
    actorRoleCode: RoleCode = "SYSTEM_ADMIN",
  ): Promise<IdentityChangeImpact> {
    const prisma = this.database();
    if (!prisma) {
      const user = this.users.find((item) => item.id === userId);
      if (!user) throw new NotFoundException("Không tìm thấy tài khoản.");
      const nextRoleCodes = target.roleCodes?.length ? target.roleCodes : target.roleCode ? [target.roleCode] : [user.roleCode];
      this.assertUserChangeScope(user.roleCodes ?? [user.roleCode], nextRoleCodes, actorRoleCode);
      const nextRoleCode = target.roleCodes?.[0] ?? target.roleCode ?? user.roleCode;
      const nextStatus = target.status ?? user.status;
      const token = createHash("sha256")
        .update(`${user.id}:${user.updatedAt}:${nextRoleCode}:${nextStatus}`)
        .digest("hex");
      return {
        userId,
        currentRoleCode: user.roleCode,
        currentStatus: user.status,
        nextRoleCode,
        nextStatus,
        token,
        requiresHandoff: false,
        activeSessions: 0,
        classes: [],
        openWork: {
          regrades: 0,
          interventions: 0,
          supportTickets: 0,
          moderationReports: 0,
          upcomingSessions: 0,
        },
      };
    }
    return prisma.$transaction(async (transaction) => {
      const user = await transaction.user.findUnique({ where: { id: userId }, include: { roles: { include: { role: true } } } });
      if (!user) throw new NotFoundException("Không tìm thấy tài khoản.");
      const currentRoleCodes = user.roles.map(({ role }) => role.code as RoleCode);
      const nextRoleCodes = target.roleCodes?.length ? target.roleCodes : target.roleCode ? [target.roleCode] : currentRoleCodes;
      this.assertUserChangeScope(currentRoleCodes, nextRoleCodes, actorRoleCode);
      return this.buildDatabaseImpact(transaction, userId, target);
    });
  }

  /** Cập nhật user/vai trò, bàn giao việc đang mở và thu hồi mọi phiên trong cùng transaction. */
  async updateUser(
    userId: string,
    input: UpdateUserDto,
    actorId = "usr-admin",
    actorRoleCode: RoleCode = "SYSTEM_ADMIN",
  ): Promise<IdentityUser> {
    const prisma = this.database();
    if (prisma) {
      return prisma.$transaction(async (transaction) => {
        const current = await transaction.user.findUnique({
          where: { id: userId },
          include: { roles: { include: { role: true } } },
        });
        if (!current) throw new NotFoundException("Không tìm thấy tài khoản.");
        // Chỉ tài khoản chưa từng xác thực (chưa có email) mới về Chưa xác thực, ví dụ khi được mở khóa.
        if (input.status === "PENDING" && current.email)
          throw new BadRequestException("Tài khoản đã xác thực email nên không thể chuyển về trạng thái Chưa xác thực.");
        const currentRole = this.getRoleCode(current);
        const nextRoleCodes = input.roleCodes?.length
          ? [...new Set(input.roleCodes)]
          : input.roleCode
            ? [input.roleCode]
            : undefined;
        this.assertUserChangeScope(
          current.roles.map(({ role }) => role.code as RoleCode),
          nextRoleCodes ?? current.roles.map(({ role }) => role.code as RoleCode),
          actorRoleCode,
        );
        const changesAccess = Boolean(
          (nextRoleCodes &&
            !this.sameRoleSet(
              nextRoleCodes,
              current.roles.map(({ role }) => role.code as RoleCode),
            )) ||
            (input.status && input.status !== current.status),
        );
        const impact = changesAccess
          ? await this.buildDatabaseImpact(transaction, userId, input)
          : undefined;
        if (impact && input.impactToken !== impact.token)
          throw new ConflictException(
            "Ảnh hưởng công việc đã thay đổi hoặc chưa được xác nhận. Hãy xem trước lại.",
          );
        if (
          impact?.requiresHandoff &&
          (!input.handoffUserId || !input.handoffReason?.trim())
        )
          throw new BadRequestException(
            "Cần chọn người nhận bàn giao và ghi lý do trước khi đổi quyền tài khoản.",
          );
        const removesActiveAdmin =
          currentRole === "SYSTEM_ADMIN" &&
          current.status === "ACTIVE" &&
          Boolean(
            (input.status && input.status !== "ACTIVE") ||
              (input.roleCode && input.roleCode !== "SYSTEM_ADMIN"),
          );
        if (removesActiveAdmin) {
          const activeAdmins = await transaction.user.count({
            where: {
              status: "ACTIVE",
              roles: { some: { role: { code: "SYSTEM_ADMIN" } } },
            },
          });
          if (activeAdmins === 1)
            throw new BadRequestException(
              "Không thể khóa hoặc hạ quyền quản trị viên hoạt động cuối cùng.",
            );
        }

        const nextRoles = nextRoleCodes
          ? await transaction.role.findMany({
              where: { code: { in: nextRoleCodes } },
            })
          : [];
        if (nextRoleCodes && nextRoles.length !== nextRoleCodes.length)
          throw new BadRequestException("Một hoặc nhiều vai trò chưa được khởi tạo trong PostgreSQL.");
        if (impact?.requiresHandoff && input.handoffUserId)
          await this.handoffDatabaseWork(
            transaction,
            userId,
            input.handoffUserId,
            input.handoffReason!.trim(),
            actorId,
            impact,
          );
        if (nextRoleCodes) {
          await transaction.userRole.deleteMany({ where: { userId } });
          await transaction.userRole.createMany({
            data: nextRoles.map((role) => ({ userId, roleId: role.id })),
          });
        }
        await transaction.user.update({
          where: { id: userId },
          data: {
            status: input.status,
          },
        });
        const updated = await transaction.user.findUniqueOrThrow({
          where: { id: userId },
          include: { roles: { include: { role: true } } },
        });
        if (changesAccess) {
          await transaction.authSession.updateMany({
            where: { userId, revokedAt: null },
            data: { revokedAt: new Date() },
          });
          await transaction.accountToken.updateMany({
            where: { userId, consumedAt: null },
            data: { consumedAt: new Date() },
          });
        }
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
    const memoryRoleCodes = input.roleCodes?.length ? [...new Set(input.roleCodes)] : input.roleCode ? [input.roleCode] : user.roleCodes ?? [user.roleCode];
    this.assertUserChangeScope(user.roleCodes ?? [user.roleCode], memoryRoleCodes, actorRoleCode);
    if (input.status === "PENDING" && user.email)
      throw new BadRequestException("Tài khoản đã xác thực email nên không thể chuyển về trạng thái Chưa xác thực.");
    const removesActiveAdmin =
      user.roleCode === "SYSTEM_ADMIN" &&
      user.status === "ACTIVE" &&
      Boolean(
        (input.status && input.status !== "ACTIVE") ||
          (input.roleCode && input.roleCode !== "SYSTEM_ADMIN"),
      );
    if (removesActiveAdmin) {
      const activeAdmins = this.users.filter(
        (item) => item.roleCode === "SYSTEM_ADMIN" && item.status === "ACTIVE",
      );
      if (activeAdmins.length === 1)
        throw new BadRequestException(
          "Không thể khóa hoặc hạ quyền quản trị viên hoạt động cuối cùng.",
        );
    }
    const fallbackChangesAccess = Boolean(
      !this.sameRoleSet(memoryRoleCodes, user.roleCodes ?? [user.roleCode]) ||
        (input.status && input.status !== user.status),
    );
    if (fallbackChangesAccess) {
      const impact = await this.previewUserChange(userId, input, actorRoleCode);
      if (input.impactToken !== impact.token)
        throw new ConflictException(
          "Ảnh hưởng công việc đã thay đổi hoặc chưa được xác nhận. Hãy xem trước lại.",
        );
    }

    const before = `${user.roleCode}/${user.status}`;
    if (memoryRoleCodes.length) {
      user.roleCodes = memoryRoleCodes;
      user.roleCode = memoryRoleCodes[0]!;
    }
    if (input.status) user.status = input.status;
    user.updatedAt = now();
    this.audit(
      actorId,
      "USER_UPDATED",
      user.id,
      `${before} → ${user.roleCode}/${user.status}`,
    );
    return { ...user };
  }

  /** Đọc vai trò và quyền từ DB hoặc trả bản sao dữ liệu demo để tránh mutation ngoài ý muốn. */
  async listRoles(): Promise<IdentityRole[]> {
    const prisma = this.database();
    if (prisma) {
      const rows = await prisma.role.findMany({
        include: { permissions: { include: { permission: true } } },
        orderBy: { name: "asc" },
      });
      return rows.map((row) => this.mapRole(row));
    }
    return this.roles.map((role) => ({
      ...role,
      permissions: [...role.permissions],
    }));
  }

  /** Thay thế tập quyền nguyên tử, giữ quyền tự quản trị bắt buộc và tăng version để theo dõi thay đổi. */
  async updateRolePermissions(
    input: UpdateRolePermissionsDto,
    actorId = "usr-admin",
  ): Promise<IdentityRole> {
    if (
      input.roleCode === "SYSTEM_ADMIN" &&
      !input.permissions.includes("role:update")
    ) {
      throw new BadRequestException(
        "Vai trò quản trị phải giữ quyền role:update.",
      );
    }
    const prisma = this.database();
    if (prisma) {
      return prisma.$transaction(async (transaction) => {
        const role = await transaction.role.findUnique({
          where: { code: input.roleCode },
        });
        if (!role) throw new NotFoundException("Không tìm thấy vai trò.");
        const uniquePermissions = [...new Set(input.permissions)];
        const permissionRows = await transaction.permission.findMany({
          where: { code: { in: uniquePermissions } },
          select: { id: true, code: true },
        });
        if (permissionRows.length !== uniquePermissions.length) {
          throw new BadRequestException(
            "PostgreSQL chưa có đủ danh mục quyền; cần chạy db:seed.",
          );
        }
        await transaction.rolePermission.deleteMany({
          where: { roleId: role.id },
        });
        if (permissionRows.length) {
          await transaction.rolePermission.createMany({
            data: permissionRows.map(({ id: permissionId }) => ({
              roleId: role.id,
              permissionId,
            })),
          });
        }
        await transaction.role.update({
          where: { id: role.id },
          data: { version: { increment: 1 } },
        });
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
    this.audit(
      actorId,
      "ROLE_PERMISSIONS_UPDATED",
      role.code,
      `Cập nhật ${role.permissions.length} quyền, phiên bản ${role.version}`,
    );
    return { ...role, permissions: [...role.permissions] };
  }

  /** Đọc 200 sự kiện danh tính gần nhất và chuẩn hóa context JSON thành nội dung hiển thị. */
  async listAuditEvents(): Promise<IdentityAuditEvent[]> {
    const prisma = this.database();
    if (prisma) {
      const rows = await prisma.auditLog.findMany({
        where: { entityType: "identity" },
        orderBy: { createdAt: "desc" },
        take: 200,
      });
      return rows.map((row) => {
        const context = asPrismaJsonRecord(row.context);
        return {
          id: row.id.toString(),
          actorId: row.actorId ?? "system",
          action: row.action,
          targetId: row.entityId ?? "unknown",
          summary:
            typeof context.summary === "string" ? context.summary : row.action,
          createdAt: row.createdAt.toISOString(),
        };
      });
    }
    return this.auditEvents.map((event) => ({ ...event }));
  }

  /** Chỉ chọn Prisma khi ứng dụng được cấu hình kết nối DB; nếu không dùng kho nhớ demo. */
  private database(): PrismaService | undefined {
    return this.prisma?.isStartupConnectionEnabled() ? this.prisma : undefined;
  }

  /** Đọc toàn bộ quyền sở hữu đang mở và tạo token chống xác nhận trên dữ liệu cũ. */
  private async buildDatabaseImpact(
    transaction: Prisma.TransactionClient,
    userId: string,
    target: Pick<UpdateUserDto, "roleCode" | "roleCodes" | "status">,
  ): Promise<IdentityChangeImpact> {
    const user = await transaction.user.findUnique({
      where: { id: userId },
      include: { roles: { include: { role: true } } },
    });
    if (!user) throw new NotFoundException("Không tìm thấy tài khoản.");
    const currentRoleCode = this.getRoleCode(user);
    const currentRoleCodes = user.roles.map(({ role }) => role.code as RoleCode);
    const nextRoleCodes = target.roleCodes?.length
      ? target.roleCodes
      : target.roleCode
        ? [target.roleCode]
        : currentRoleCodes;
    const nextRoleCode = nextRoleCodes[0] ?? currentRoleCode;
    const nextStatus = target.status ?? user.status;
    // Prisma dùng một kết nối cho transaction; đọc lần lượt để tránh truy vấn chồng nhau.
    const assignments = await transaction.classInstructor.findMany({
      where: {
        instructorId: userId,
        class: { status: { in: ["DRAFT", "ACTIVE"] } },
      },
      include: {
        class: { select: { id: true, code: true, name: true, status: true } },
      },
      orderBy: { class: { code: "asc" } },
    });
    const regrades = await transaction.regradeRequest.count({
      where: { assignedToId: userId, status: { in: ["OPEN", "IN_REVIEW"] } },
    });
    const interventions = await transaction.progressIntervention.count({
      where: { ownerId: userId, status: { in: ["OPEN", "IN_PROGRESS"] } },
    });
    const supportTickets = await transaction.supportTicket.count({
      where: { assigneeId: userId, status: { in: ["OPEN", "IN_PROGRESS"] } },
    });
    const moderationReports = await transaction.contentReport.count({
      where: {
        assignedToId: userId,
        status: { in: ["OPEN", "IN_REVIEW", "ESCALATED"] },
      },
    });
    const upcomingSessions = await transaction.liveSession.count({
      where: { hostId: userId, status: { in: ["SCHEDULED", "LIVE"] } },
    });
    const activeSessions = await transaction.authSession.count({
      where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
    });
    const classes = assignments.map((item) => ({
      id: item.class.id,
      code: item.class.code,
      name: item.class.name,
      status: item.class.status,
      assignmentRole: item.role as "PRIMARY" | "CO_INSTRUCTOR",
    }));
    const openWork = {
      regrades,
      interventions,
      supportTickets,
      moderationReports,
      upcomingSessions,
    };
    const changesAccess =
      !this.sameRoleSet(currentRoleCodes, nextRoleCodes) ||
      nextStatus !== user.status;
    const requiresHandoff =
      changesAccess &&
      (nextStatus !== "ACTIVE" || !currentRoleCodes.every((code) => nextRoleCodes.includes(code))) &&
      (classes.length > 0 ||
        Object.values(openWork).some((count) => count > 0));
    const tokenPayload = JSON.stringify({
      userId,
      updatedAt: user.updatedAt.toISOString(),
      currentRoleCode,
      currentStatus: user.status,
      nextRoleCode,
      nextRoleCodes,
      nextStatus,
      classes: classes.map((item) => `${item.id}:${item.assignmentRole}`),
      openWork,
    });
    const token = createHash("sha256").update(tokenPayload).digest("hex");
    return {
      userId,
      currentRoleCode,
      currentStatus: user.status,
      nextRoleCode,
      nextStatus,
      token,
      requiresHandoff,
      activeSessions,
      classes,
      openWork,
    };
  }

  /** Chuyển mọi quyền sở hữu đang mở sang một tài khoản hoạt động có vai trò phù hợp. */
  private async handoffDatabaseWork(
    transaction: Prisma.TransactionClient,
    fromUserId: string,
    toUserId: string,
    reason: string,
    actorId: string,
    impact: IdentityChangeImpact,
  ): Promise<void> {
    if (fromUserId === toUserId)
      throw new BadRequestException(
        "Người nhận bàn giao phải khác tài khoản đang thay đổi.",
      );
    const target = await transaction.user.findUnique({
      where: { id: toUserId },
      include: { roles: { include: { role: true }, take: 1 } },
    });
    if (!target || target.status !== "ACTIVE")
      throw new BadRequestException(
        "Người nhận bàn giao phải là tài khoản đang hoạt động.",
      );
    const targetRole = this.getRoleCode(target);
    const teachingWork =
      impact.classes.length +
      impact.openWork.regrades +
      impact.openWork.interventions +
      impact.openWork.upcomingSessions;
    const operationalWork =
      impact.openWork.supportTickets + impact.openWork.moderationReports;
    if (teachingWork && targetRole !== "INSTRUCTOR")
      throw new BadRequestException(
        "Công việc giảng dạy phải bàn giao cho một giảng viên đang hoạt động.",
      );
    if (
      operationalWork &&
      !["CENTER_MANAGER", "SYSTEM_ADMIN"].includes(targetRole)
    )
      throw new BadRequestException(
        "Phiếu hỗ trợ hoặc kiểm duyệt phải bàn giao cho quản lý hay quản trị viên.",
      );
    if (teachingWork && operationalWork)
      throw new BadRequestException(
        "Tài khoản đang giữ việc ở nhiều miền quyền; cần bàn giao từng miền trước khi đổi vai trò.",
      );
    for (const classItem of impact.classes) {
      const existingTarget = await transaction.classInstructor.findUnique({
        where: {
          classId_instructorId: {
            classId: classItem.id,
            instructorId: toUserId,
          },
        },
      });
      if (classItem.assignmentRole === "PRIMARY") {
        await transaction.classInstructor.upsert({
          where: {
            classId_instructorId: {
              classId: classItem.id,
              instructorId: toUserId,
            },
          },
          update: {
            role: "PRIMARY",
            assignedBy: actorId,
            assignedAt: new Date(),
          },
          create: {
            classId: classItem.id,
            instructorId: toUserId,
            role: "PRIMARY",
            assignedBy: actorId,
          },
        });
      } else if (!existingTarget) {
        await transaction.classInstructor.create({
          data: {
            classId: classItem.id,
            instructorId: toUserId,
            role: "CO_INSTRUCTOR",
            assignedBy: actorId,
          },
        });
      }
      await transaction.classInstructor.delete({
        where: {
          classId_instructorId: {
            classId: classItem.id,
            instructorId: fromUserId,
          },
        },
      });
      await transaction.classInstructorHistory.createMany({
        data: [
          {
            id: `class-instructor-history-${randomUUID()}`,
            classId: classItem.id,
            instructorId: fromUserId,
            role: classItem.assignmentRole,
            action: "REMOVED",
            reason,
            actorId,
          },
          {
            id: `class-instructor-history-${randomUUID()}`,
            classId: classItem.id,
            instructorId: toUserId,
            role: classItem.assignmentRole,
            action: "ASSIGNED",
            reason,
            actorId,
          },
        ],
      });
    }
    // Mọi cập nhật thuộc cùng transaction, phải chờ truy vấn trước hoàn tất.
    await transaction.regradeRequest.updateMany({
      where: {
        assignedToId: fromUserId,
        status: { in: ["OPEN", "IN_REVIEW"] },
      },
      data: { assignedToId: toUserId },
    });
    await transaction.progressIntervention.updateMany({
      where: { ownerId: fromUserId, status: { in: ["OPEN", "IN_PROGRESS"] } },
      data: { ownerId: toUserId },
    });
    await transaction.liveSession.updateMany({
      where: { hostId: fromUserId, status: { in: ["SCHEDULED", "LIVE"] } },
      data: { hostId: toUserId },
    });
    await transaction.supportTicket.updateMany({
      where: {
        assigneeId: fromUserId,
        status: { in: ["OPEN", "IN_PROGRESS"] },
      },
      data: { assigneeId: toUserId },
    });
    await transaction.contentReport.updateMany({
      where: {
        assignedToId: fromUserId,
        status: { in: ["OPEN", "IN_REVIEW", "ESCALATED"] },
      },
      data: { assignedToId: toUserId },
    });
    await transaction.auditLog.create({
      data: {
        actorId,
        action: "IDENTITY_WORK_HANDOFF",
        entityType: "identity",
        entityId: fromUserId,
        context: {
          toUserId,
          reason,
          classes: impact.classes.map((item) => item.id),
          openWork: impact.openWork,
        },
      },
    });
  }

  /** Ánh xạ bản ghi Prisma sang hợp đồng IdentityUser không chứa trường bí mật. */
  private mapUser(row: UserWithRoles): IdentityUser {
    const roleCodes = row.roles.map(({ role }) => role.code as RoleCode);
    return {
      id: row.id,
      username: row.username,
      displayName: row.displayName,
      email: row.email,
      roleCode: this.getRoleCode(row),
      roleCodes,
      status: row.status,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  /** Lấy vai trò chính và từ chối dữ liệu DB không thuộc danh mục ứng dụng hỗ trợ. */
  private getRoleCode(row: UserWithRoles): RoleCode {
    const code = row.roles[0]?.role.code;
    if (!code || !Object.hasOwn(DEFAULT_ROLE_PERMISSIONS, code)) {
      throw new BadRequestException(
        `Tài khoản ${row.username} chưa có vai trò hợp lệ.`,
      );
    }
    return code as RoleCode;
  }

  /** So sánh hai tập vai trò không phụ thuộc thứ tự để tránh thu hồi phiên không cần thiết. */
  private sameRoleSet(left: RoleCode[], right: RoleCode[]): boolean {
    return left.length === right.length && left.every((code) => right.includes(code));
  }

  /** Ánh xạ vai trò Prisma và kiểm tra mã vai trò trước khi ép kiểu. */
  private mapRole(row: RoleWithPermissions): IdentityRole {
    if (!Object.hasOwn(DEFAULT_ROLE_PERMISSIONS, row.code)) {
      throw new BadRequestException(
        `Mã vai trò ${row.code} không được ứng dụng hỗ trợ.`,
      );
    }
    return {
      code: row.code as RoleCode,
      name: row.name,
      description: row.description ?? "",
      permissions: row.permissions.map(
        ({ permission }) => permission.code as PermissionCode,
      ),
      version: row.version,
    };
  }

  /** Ghi audit vào cùng transaction nghiệp vụ để thay đổi và dấu vết luôn nhất quán. */
  private async writeDatabaseAudit(
    transaction: Prisma.TransactionClient,
    actorId: string,
    action: string,
    targetId: string,
    summary: string,
  ): Promise<void> {
    await transaction.auditLog.create({
      data: {
        actorId,
        action,
        entityType: "identity",
        entityId: targetId,
        context: { summary },
      },
    });
  }

  /** Thêm sự kiện audit vào đầu danh sách fallback in-memory. */
  private audit(
    actorId: string,
    action: string,
    targetId: string,
    summary: string,
  ): void {
    this.auditEvents.unshift({
      id: randomUUID(),
      actorId,
      action,
      targetId,
      summary,
      createdAt: now(),
    });
  }
}
