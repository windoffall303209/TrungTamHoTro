import { ConflictException, ForbiddenException, Injectable, ServiceUnavailableException, UnauthorizedException } from "@nestjs/common";
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

@Injectable()
export class AuthService {
  constructor(private readonly prisma: PrismaService) {}

  cookieName(): string { return SESSION_COOKIE; }

  async login(email: string, password: string, rememberMe = false): Promise<{ token: string; maxAgeMs: number; session: AuthenticatedSession }> {
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
    } });
    return { token, maxAgeMs, session: this.mapSession(row.id, user, selectedRole.code as RoleCode) };
  }

  async register(displayName: string, email: string, password: string): Promise<{ token: string; maxAgeMs: number; session: AuthenticatedSession }> {
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
    return this.login(normalizedEmail, password, false);
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
