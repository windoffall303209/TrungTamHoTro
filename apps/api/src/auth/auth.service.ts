import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, ServiceUnavailableException, UnauthorizedException } from "@nestjs/common";
import { createHash, randomBytes } from "node:crypto";
import { PrismaService } from "../database/prisma.service.js";
import type { PermissionCode, RoleCode } from "./permissions.js";
import { hashPassword, verifyPassword } from "./password.js";

const SESSION_COOKIE = "wind_edu_session";
const SHORT_SESSION_MS = 12 * 60 * 60 * 1000;
const LONG_SESSION_MS = 30 * 24 * 60 * 60 * 1000;

export interface AuthenticatedSession {
  sessionId: string;
  user: { id: string; name: string; email: string; roleName: string };
  roleCode: RoleCode;
  permissions: PermissionCode[];
  availableRoles: Array<{ code: RoleCode; name: string }>;
}

export interface SessionContext { ipAddress?: string; userAgent?: string }
export interface AccountProfile { id: string; displayName: string; email: string; phone: string; timezone: string; locale: string; status: string; createdAt: string }
export interface AccountSession { id: string; current: boolean; currentRoleCode: string; ipAddress: string; userAgent: string; createdAt: string; lastSeenAt: string; expiresAt: string }

@Injectable()
export class AuthService {
  constructor(private readonly prisma: PrismaService) {}

  cookieName(): string { return SESSION_COOKIE; }

  async login(email: string, password: string, rememberMe = false, context: SessionContext = {}): Promise<{ token: string; maxAgeMs: number; session: AuthenticatedSession }> {
    this.assertDatabase();
    const user = await this.prisma.user.findUnique({
      where: { email: email.trim().toLowerCase() },
      include: { roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } } },
    });
    if (!user || !(await verifyPassword(password, user.passwordHash))) throw new UnauthorizedException("Email hoặc mật khẩu không chính xác.");
    if (user.status !== "ACTIVE") throw new ForbiddenException("Tài khoản đang bị khóa hoặc chưa được kích hoạt.");
    const selectedRole = user.roles[0]?.role;
    if (!selectedRole) throw new ForbiddenException("Tài khoản chưa được cấp vai trò sử dụng.");

    const token = randomBytes(48).toString("base64url");
    const maxAgeMs = rememberMe ? LONG_SESSION_MS : SHORT_SESSION_MS;
    const row = await this.prisma.authSession.create({ data: {
      tokenHash: this.hashToken(token), userId: user.id, currentRoleCode: selectedRole.code,
      expiresAt: new Date(Date.now() + maxAgeMs),
      ipAddress: context.ipAddress?.slice(0, 45), userAgent: context.userAgent?.slice(0, 500),
    } });
    return { token, maxAgeMs, session: this.mapSession(row.id, user, selectedRole.code as RoleCode) };
  }

  async register(displayName: string, email: string, password: string, context: SessionContext = {}): Promise<{ token: string; maxAgeMs: number; session: AuthenticatedSession }> {
    this.assertDatabase();
    const normalizedEmail = email.trim().toLowerCase();
    const learnerRole = await this.prisma.role.findUnique({ where: { code: "LEARNER" } });
    if (!learnerRole) throw new ServiceUnavailableException("Vai trò học viên chưa được khởi tạo.");
    try {
      await this.prisma.user.create({ data: {
        email: normalizedEmail, displayName: displayName.trim(), passwordHash: await hashPassword(password),
        roles: { create: { roleId: learnerRole.id } },
      } });
    } catch (error) {
      if (typeof error === "object" && error !== null && "code" in error && error.code === "P2002") {
        throw new ConflictException("Email đã được sử dụng.");
      }
      throw error;
    }
    return this.login(normalizedEmail, password, false, context);
  }

  async getProfile(userId: string): Promise<AccountProfile> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException("Không tìm thấy tài khoản.");
    return { id: user.id, displayName: user.displayName, email: user.email, phone: user.phone ?? "", timezone: user.timezone, locale: user.locale, status: user.status, createdAt: user.createdAt.toISOString() };
  }

  async updateProfile(userId: string, input: { displayName: string; phone?: string; timezone: string; locale: string }): Promise<AccountProfile> {
    await this.prisma.user.update({ where: { id: userId }, data: { displayName: input.displayName.trim(), phone: input.phone?.trim() || null, timezone: input.timezone, locale: input.locale } });
    return this.getProfile(userId);
  }

  async changePassword(userId: string, currentSessionId: string, currentPassword: string, newPassword: string): Promise<{ revokedSessions: number }> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || !(await verifyPassword(currentPassword, user.passwordHash))) throw new UnauthorizedException("Mật khẩu hiện tại không chính xác.");
    if (await verifyPassword(newPassword, user.passwordHash)) throw new BadRequestException("Mật khẩu mới phải khác mật khẩu hiện tại.");
    const now = new Date();
    const [, revoked] = await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: userId }, data: { passwordHash: await hashPassword(newPassword) } }),
      this.prisma.authSession.updateMany({ where: { userId, id: { not: currentSessionId }, revokedAt: null }, data: { revokedAt: now } }),
    ]);
    return { revokedSessions: revoked.count };
  }

  async listSessions(userId: string, currentSessionId: string): Promise<AccountSession[]> {
    const rows = await this.prisma.authSession.findMany({ where: { userId, revokedAt: null, expiresAt: { gt: new Date() } }, orderBy: { lastSeenAt: "desc" } });
    return rows.map((row) => ({ id: row.id, current: row.id === currentSessionId, currentRoleCode: row.currentRoleCode, ipAddress: row.ipAddress ?? "Không xác định", userAgent: row.userAgent ?? "Thiết bị không xác định", createdAt: row.createdAt.toISOString(), lastSeenAt: row.lastSeenAt.toISOString(), expiresAt: row.expiresAt.toISOString() }));
  }

  async revokeSession(userId: string, currentSessionId: string, sessionId: string): Promise<void> {
    if (sessionId === currentSessionId) throw new BadRequestException("Hãy dùng chức năng đăng xuất để đóng phiên hiện tại.");
    const result = await this.prisma.authSession.updateMany({ where: { id: sessionId, userId, revokedAt: null }, data: { revokedAt: new Date() } });
    if (!result.count) throw new NotFoundException("Phiên đăng nhập không còn tồn tại.");
  }

  async revokeOtherSessions(userId: string, currentSessionId: string): Promise<{ revokedSessions: number }> {
    const result = await this.prisma.authSession.updateMany({ where: { userId, id: { not: currentSessionId }, revokedAt: null }, data: { revokedAt: new Date() } });
    return { revokedSessions: result.count };
  }

  async resolve(token: string | undefined, requestedRole?: string): Promise<AuthenticatedSession> {
    this.assertDatabase();
    if (!token) throw new UnauthorizedException("Vui lòng đăng nhập để tiếp tục.");
    const row = await this.prisma.authSession.findUnique({
      where: { tokenHash: this.hashToken(token) },
      include: { user: { include: { roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } } } } },
    });
    if (!row || row.revokedAt || row.expiresAt <= new Date()) throw new UnauthorizedException("Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.");
    if (row.user.status !== "ACTIVE") throw new ForbiddenException("Tài khoản đang bị khóa hoặc chưa được kích hoạt.");
    const roleCode = requestedRole ?? row.currentRoleCode;
    const selected = row.user.roles.find(({ role }) => role.code === roleCode)?.role;
    if (!selected) throw new ForbiddenException("Tài khoản không có vai trò được yêu cầu.");
    if (row.currentRoleCode !== roleCode || Date.now() - row.lastSeenAt.getTime() > 60_000) {
      await this.prisma.authSession.update({ where: { id: row.id }, data: { currentRoleCode: roleCode, lastSeenAt: new Date() } });
    }
    return this.mapSession(row.id, row.user, roleCode as RoleCode);
  }

  async logout(token: string | undefined): Promise<void> {
    if (!token || !this.prisma.isStartupConnectionEnabled()) return;
    await this.prisma.authSession.updateMany({ where: { tokenHash: this.hashToken(token), revokedAt: null }, data: { revokedAt: new Date() } });
  }

  readToken(cookieHeader?: string): string | undefined {
    return cookieHeader?.split(";").map((part) => part.trim().split("=")).find(([name]) => name === SESSION_COOKIE)?.slice(1).join("=");
  }

  private mapSession(sessionId: string, user: { id: string; displayName: string; email: string; roles: Array<{ role: { code: string; name: string; permissions: Array<{ permission: { code: string } }> } }> }, roleCode: RoleCode): AuthenticatedSession {
    const selected = user.roles.find(({ role }) => role.code === roleCode)?.role;
    if (!selected) throw new ForbiddenException("Vai trò của phiên không còn hợp lệ.");
    return {
      sessionId,
      user: { id: user.id, name: user.displayName, email: user.email, roleName: selected.name },
      roleCode,
      permissions: selected.permissions.map(({ permission }) => permission.code as PermissionCode),
      availableRoles: user.roles.map(({ role }) => ({ code: role.code as RoleCode, name: role.name })),
    };
  }

  private hashToken(token: string): string { return createHash("sha256").update(token).digest("hex"); }
  private assertDatabase(): void {
    if (!this.prisma.isStartupConnectionEnabled()) throw new ServiceUnavailableException("Xác thực cần kết nối MySQL. Hãy bật DATABASE_CONNECT_ON_START.");
  }
}
