import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createHash, randomBytes, randomUUID, scryptSync } from "node:crypto";
import type { Prisma } from "../generated/prisma/client.js";
import {
  DEFAULT_ROLE_PERMISSIONS,
  type PermissionCode,
  type RoleCode,
} from "../auth/permissions.js";
import { PrismaService } from "../database/prisma.service.js";
import type { Environment } from "../config/environment.js";
import { EmailDeliveryService } from "../infrastructure/email-delivery.service.js";
import type {
  CreateUserDto,
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

const now = (): string => new Date().toISOString();
const isUniqueConstraintError = (error: unknown): boolean =>
  typeof error === "object" &&
  error !== null &&
  "code" in error &&
  error.code === "P2002";

type UserWithRoles = Prisma.UserGetPayload<{
  include: { roles: { include: { role: true } } };
}>;
type RoleWithPermissions = Prisma.RoleGetPayload<{
  include: { permissions: { include: { permission: true } } };
}>;

@Injectable()
/** Quản lý danh tính bằng Prisma khi có DB và dùng dữ liệu nhớ tương đương cho chế độ demo cục bộ. */
export class IdentityService {
  private readonly logger = new Logger(IdentityService.name);
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

  constructor(
    @Optional() private readonly prisma?: PrismaService,
    @Optional() private readonly emailDelivery?: EmailDeliveryService,
    @Optional() private readonly config?: ConfigService<Environment, true>,
  ) {}

  /** Tìm kiếm người dùng ở DB hoặc fallback in-memory, rồi trả bản sao/view model an toàn. */
  async listUsers(query?: string): Promise<IdentityUser[]> {
    const normalized = query?.trim() ?? "";
    const prisma = this.database();
    if (prisma) {
      const rows = await prisma.user.findMany({
        where: normalized
          ? {
              OR: [
                { username: { contains: normalized } },
                { displayName: { contains: normalized } },
                { email: { contains: normalized } },
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

  /** Tạo user, gán vai trò và ghi audit trong cùng transaction; xử lý cả xung đột unique. */
  async createUser(
    input: CreateUserDto,
    actorId = "usr-admin",
  ): Promise<IdentityUser> {
    const normalizedEmail = input.email.trim().toLowerCase();
    const normalizedUsername = input.username.trim().toLowerCase();
    const roleCodes = [...new Set(input.roleCodes?.length ? input.roleCodes : [input.roleCode])];
    const invitationToken = input.initialPassword
      ? undefined
      : randomBytes(48).toString("base64url");
    const invitationExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const prisma = this.database();
    if (prisma) {
      try {
        const row = await prisma.$transaction(async (transaction) => {
          const roles = await transaction.role.findMany({
            where: { code: { in: roleCodes } },
          });
          if (roles.length !== roleCodes.length)
            throw new BadRequestException(
              "Một hoặc nhiều vai trò chưa được khởi tạo trong MySQL.",
            );
          const user = await transaction.user.create({
            data: {
              id: `usr-${randomUUID()}`,
              username: normalizedUsername,
              displayName: input.displayName.trim(),
              email: normalizedEmail,
              status: invitationToken ? "PENDING_VERIFICATION" : "ACTIVE",
              emailVerifiedAt: invitationToken ? null : new Date(),
              passwordHash: input.initialPassword
                ? await hashPassword(input.initialPassword)
                : null,
              roles: {
                create: roles.map((role) => ({ roleId: role.id })),
              },
              accountTokens: invitationToken
                ? {
                    create: {
                      tokenHash: createHash("sha256")
                        .update(invitationToken)
                        .digest("hex"),
                      type: "PASSWORD_RESET",
                      expiresAt: invitationExpiresAt,
                    },
                  }
                : undefined,
            },
            include: { roles: { include: { role: true } } },
          });
          await this.writeDatabaseAudit(
            transaction,
            actorId,
            "USER_CREATED",
            user.id,
            `Tạo tài khoản ${user.email}`,
          );
          return user;
        });
        const invitationSent = invitationToken
          ? await this.sendInvitationEmail(
              row.id,
              row.email,
              row.displayName,
              invitationToken,
              invitationExpiresAt,
            )
          : undefined;
        return { ...this.mapUser(row), invitationSent };
      } catch (error) {
        if (isUniqueConstraintError(error))
          throw new ConflictException(
            "Tài khoản hoặc email đã tồn tại trong hệ thống.",
          );
        throw error;
      }
    }

    if (
      this.users.some(
        (user) =>
          user.email.toLowerCase() === normalizedEmail ||
          user.username === normalizedUsername,
      )
    ) {
      throw new ConflictException(
        "Tài khoản hoặc email đã tồn tại trong hệ thống.",
      );
    }
    const timestamp = now();
    const user: IdentityUser = {
      id: `usr-${randomUUID()}`,
      username: normalizedUsername,
      displayName: input.displayName.trim(),
      email: normalizedEmail,
      roleCode: roleCodes[0]!,
      roleCodes,
      status: invitationToken ? "PENDING_VERIFICATION" : "ACTIVE",
      invitationSent: false,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    this.users.unshift(user);
    this.audit(actorId, "USER_CREATED", user.id, `Tạo tài khoản ${user.email}`);
    return { ...user };
  }

  /** Tính ảnh hưởng và token nhất quán để giao diện xác nhận trước khi thay quyền. */
  async previewUserChange(
    userId: string,
    target: Pick<UpdateUserDto, "roleCode" | "roleCodes" | "status">,
  ): Promise<IdentityChangeImpact> {
    const prisma = this.database();
    if (!prisma) {
      const user = this.users.find((item) => item.id === userId);
      if (!user) throw new NotFoundException("Không tìm thấy tài khoản.");
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
    return prisma.$transaction((transaction) =>
      this.buildDatabaseImpact(transaction, userId, target),
    );
  }

  /** Cập nhật user/vai trò, bàn giao việc đang mở và thu hồi mọi phiên trong cùng transaction. */
  async updateUser(
    userId: string,
    input: UpdateUserDto,
    actorId = "usr-admin",
  ): Promise<IdentityUser> {
    const prisma = this.database();
    if (prisma) {
      return prisma.$transaction(async (transaction) => {
        const current = await transaction.user.findUnique({
          where: { id: userId },
          include: { roles: { include: { role: true } } },
        });
        if (!current) throw new NotFoundException("Không tìm thấy tài khoản.");
        const currentRole = this.getRoleCode(current);
        const nextRoleCodes = input.roleCodes?.length
          ? [...new Set(input.roleCodes)]
          : input.roleCode
            ? [input.roleCode]
            : undefined;
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
          throw new BadRequestException("Một hoặc nhiều vai trò chưa được khởi tạo trong MySQL.");
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
            displayName: input.displayName?.trim(),
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
      (input.roleCode && input.roleCode !== user.roleCode) ||
        (input.status && input.status !== user.status),
    );
    if (fallbackChangesAccess) {
      const impact = await this.previewUserChange(userId, input);
      if (input.impactToken !== impact.token)
        throw new ConflictException(
          "Ảnh hưởng công việc đã thay đổi hoặc chưa được xác nhận. Hãy xem trước lại.",
        );
    }

    const before = `${user.roleCode}/${user.status}`;
    if (input.displayName) user.displayName = input.displayName.trim();
    const memoryRoleCodes = input.roleCodes?.length
      ? [...new Set(input.roleCodes)]
      : input.roleCode
        ? [input.roleCode]
        : undefined;
    if (memoryRoleCodes) {
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
            "MySQL chưa có đủ danh mục quyền; cần chạy db:seed.",
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
        const context = this.asRecord(row.context);
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
    const [
      assignments,
      regrades,
      interventions,
      supportTickets,
      moderationReports,
      upcomingSessions,
      activeSessions,
    ] = await Promise.all([
      transaction.classInstructor.findMany({
        where: {
          instructorId: userId,
          class: { status: { in: ["DRAFT", "ACTIVE"] } },
        },
        include: {
          class: { select: { id: true, code: true, name: true, status: true } },
        },
        orderBy: { class: { code: "asc" } },
      }),
      transaction.regradeRequest.count({
        where: { assignedToId: userId, status: { in: ["OPEN", "IN_REVIEW"] } },
      }),
      transaction.progressIntervention.count({
        where: { ownerId: userId, status: { in: ["OPEN", "IN_PROGRESS"] } },
      }),
      transaction.supportTicket.count({
        where: { assigneeId: userId, status: { in: ["OPEN", "IN_PROGRESS"] } },
      }),
      transaction.contentReport.count({
        where: {
          assignedToId: userId,
          status: { in: ["OPEN", "IN_REVIEW", "ESCALATED"] },
        },
      }),
      transaction.liveSession.count({
        where: { hostId: userId, status: { in: ["SCHEDULED", "LIVE"] } },
      }),
      transaction.authSession.count({
        where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
      }),
    ]);
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
    await Promise.all([
      transaction.regradeRequest.updateMany({
        where: {
          assignedToId: fromUserId,
          status: { in: ["OPEN", "IN_REVIEW"] },
        },
        data: { assignedToId: toUserId },
      }),
      transaction.progressIntervention.updateMany({
        where: { ownerId: fromUserId, status: { in: ["OPEN", "IN_PROGRESS"] } },
        data: { ownerId: toUserId },
      }),
      transaction.liveSession.updateMany({
        where: { hostId: fromUserId, status: { in: ["SCHEDULED", "LIVE"] } },
        data: { hostId: toUserId },
      }),
      transaction.supportTicket.updateMany({
        where: {
          assigneeId: fromUserId,
          status: { in: ["OPEN", "IN_PROGRESS"] },
        },
        data: { assigneeId: toUserId },
      }),
      transaction.contentReport.updateMany({
        where: {
          assignedToId: fromUserId,
          status: { in: ["OPEN", "IN_REVIEW", "ESCALATED"] },
        },
        data: { assignedToId: toUserId },
      }),
    ]);
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
        `Tài khoản ${row.email} chưa có vai trò hợp lệ.`,
      );
    }
    return code as RoleCode;
  }

  /** So sánh hai tập vai trò không phụ thuộc thứ tự để tránh thu hồi phiên không cần thiết. */
  private sameRoleSet(left: RoleCode[], right: RoleCode[]): boolean {
    return left.length === right.length && left.every((code) => right.includes(code));
  }

  /** Gửi liên kết kích hoạt một lần; lỗi provider giữ tài khoản ở trạng thái chờ để quản trị viên xử lý lại. */
  private async sendInvitationEmail(
    userId: string,
    email: string,
    displayName: string,
    token: string,
    expiresAt: Date,
  ): Promise<boolean> {
    if (!this.emailDelivery?.isConfigured()) return false;
    const origin = this.config?.get("WEB_ORIGIN", { infer: true })?.replace(/\/$/, "") ?? "http://localhost:3000";
    const link = `${origin}/reset-password?token=${encodeURIComponent(token)}&invitation=1`;
    try {
      await this.emailDelivery.send({
        to: email,
        subject: "Kích hoạt tài khoản Wind EDU",
        text: `Xin chào ${displayName},\n\nTài khoản Wind EDU của bạn đã được tạo. Hãy đặt mật khẩu bằng liên kết dùng một lần trước ${expiresAt.toISOString()}:\n${link}`,
        idempotencyKey: `account-invitation/${userId}/${createHash("sha256").update(token).digest("hex")}`,
      });
      return true;
    } catch (error) {
      this.logger.error("Không gửi được email kích hoạt tài khoản.", error instanceof Error ? error.stack : String(error));
      return false;
    }
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

  /** Tạo hash ngẫu nhiên không thể đăng nhập cho tài khoản quản trị tạo mà chưa đặt mật khẩu. */
  private createDisabledPasswordHash(): string {
    const salt = randomBytes(16).toString("hex");
    const hash = scryptSync(randomBytes(32), salt, 64).toString("hex");
    return `scrypt:${salt}:${hash}`;
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

  /** Thu hẹp Prisma JSON thành object trước khi đọc trường summary. */
  private asRecord(value: Prisma.JsonValue | null): Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
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
