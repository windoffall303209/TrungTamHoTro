import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException, ServiceUnavailableException, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { PrismaService } from "../database/prisma.service.js";
import type { Environment } from "../config/environment.js";
import { EmailDeliveryService } from "../infrastructure/email-delivery.service.js";
import { createMfaSecret, createRecoveryCodes, createTotpUri, decryptMfaSecret, encryptMfaSecret, verifyTotp } from "./mfa.js";
import type { PermissionCode, RoleCode } from "./permissions.js";
import { hashPassword, verifyPassword } from "./password.js";

const SESSION_COOKIE = "wind_edu_session";
const SHORT_SESSION_MS = 12 * 60 * 60 * 1000;
const LONG_SESSION_MS = 30 * 24 * 60 * 60 * 1000;
const EMAIL_TOKEN_MS = 24 * 60 * 60 * 1000;
const PASSWORD_TOKEN_MS = 30 * 60 * 1000;
const MFA_CHALLENGE_MS = 5 * 60 * 1000;

type UserWithRoles = {
  id: string; email: string; passwordHash: string; displayName: string; status: string;
  mfaSecretEncrypted: string | null; mfaEnabledAt: Date | null;
  roles: Array<{ role: { code: string; name: string; permissions: Array<{ permission: { code: string } }> } }>;
};

export interface AuthenticatedSession {
  sessionId: string;
  user: { id: string; name: string; email: string; roleName: string };
  roleCode: RoleCode;
  permissions: PermissionCode[];
  availableRoles: Array<{ code: RoleCode; name: string }>;
}

export interface SessionContext { ipAddress?: string; userAgent?: string }
export interface AccountProfile { id: string; displayName: string; email: string; phone: string; timezone: string; locale: string; status: string; emailVerifiedAt: string | null; mfaEnabled: boolean; createdAt: string }
export interface AccountSession { id: string; current: boolean; currentRoleCode: string; ipAddress: string; userAgent: string; createdAt: string; lastSeenAt: string; expiresAt: string }
export interface SessionIssue { token: string; csrfToken: string; maxAgeMs: number; session: AuthenticatedSession }
export type LoginResult = SessionIssue | { requiresMfa: true; challengeToken: string };

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly encryptionSecret: string;
  private readonly issuer: string;
  private readonly webOrigin: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailDeliveryService,
    config: ConfigService<Environment, true>,
  ) {
    this.encryptionSecret = config.get("AUTH_ENCRYPTION_SECRET", { infer: true });
    this.issuer = config.get("MFA_ISSUER", { infer: true });
    this.webOrigin = config.get("WEB_ORIGIN", { infer: true }).replace(/\/$/, "");
  }

  cookieName(): string { return SESSION_COOKIE; }

  async login(email: string, password: string, rememberMe = false, context: SessionContext = {}): Promise<LoginResult> {
    this.assertDatabase();
    const user = await this.loadUserByEmail(email);
    if (!user || !(await verifyPassword(password, user.passwordHash))) throw new UnauthorizedException("Email hoặc mật khẩu không chính xác.");
    this.assertActive(user);
    if (user.mfaEnabledAt && user.mfaSecretEncrypted) {
      return { requiresMfa: true, challengeToken: await this.issueAccountToken(user.id, "MFA_LOGIN", MFA_CHALLENGE_MS) };
    }
    return this.createSession(user, rememberMe, context);
  }

  async completeMfaLogin(challengeToken: string, code: string, rememberMe = false, context: SessionContext = {}, recoveryCode?: string): Promise<SessionIssue> {
    const challenge = await this.validAccountToken(challengeToken, "MFA_LOGIN");
    const user = await this.loadUser(challenge.userId);
    if (!user?.mfaEnabledAt || !user.mfaSecretEncrypted) throw new UnauthorizedException("MFA không còn được bật cho tài khoản này.");
    if (recoveryCode) {
      const used = await this.prisma.mfaRecoveryCode.updateMany({
        where: { userId: user.id, codeHash: this.hashToken(recoveryCode.trim().toUpperCase()), usedAt: null },
        data: { usedAt: new Date() },
      });
      if (!used.count) throw new UnauthorizedException("Mã khôi phục không chính xác hoặc đã được sử dụng.");
    } else {
      const secret = decryptMfaSecret(user.mfaSecretEncrypted, this.encryptionSecret);
      if (!verifyTotp(secret, code)) throw new UnauthorizedException("Mã xác thực không chính xác hoặc đã hết hạn.");
    }
    await this.consumeAccountToken(challenge.id);
    return this.createSession(user, rememberMe, context);
  }

  async register(displayName: string, email: string, password: string, context: SessionContext = {}): Promise<SessionIssue & { verificationEmailSent: boolean }> {
    this.assertDatabase();
    const normalizedEmail = email.trim().toLowerCase();
    const learnerRole = await this.prisma.role.findUnique({ where: { code: "LEARNER" } });
    if (!learnerRole) throw new ServiceUnavailableException("Vai trò học viên chưa được khởi tạo.");
    let userId: string;
    try {
      const created = await this.prisma.user.create({ data: {
        email: normalizedEmail, displayName: displayName.trim(), passwordHash: await hashPassword(password),
        roles: { create: { roleId: learnerRole.id } },
      } });
      userId = created.id;
    } catch (error) {
      if (typeof error === "object" && error !== null && "code" in error && error.code === "P2002") throw new ConflictException("Email đã được sử dụng.");
      throw error;
    }
    const verificationEmailSent = await this.sendVerificationEmail(userId, normalizedEmail);
    const user = await this.loadUser(userId);
    if (!user) throw new ServiceUnavailableException("Không thể khởi tạo phiên tài khoản.");
    return { ...(await this.createSession(user, false, context)), verificationEmailSent };
  }

  async requestPasswordReset(email: string): Promise<{ accepted: true }> {
    const user = await this.loadUserByEmail(email);
    if (!user || user.status !== "ACTIVE") return { accepted: true };
    const token = await this.issueAccountToken(user.id, "PASSWORD_RESET", PASSWORD_TOKEN_MS);
    const link = `${this.webOrigin}/reset-password?token=${encodeURIComponent(token)}`;
    try {
      await this.email.send({
        to: user.email, subject: "Đặt lại mật khẩu Wind EDU",
        text: `Bạn đã yêu cầu đặt lại mật khẩu Wind EDU. Liên kết có hiệu lực trong 30 phút:\n${link}\n\nNếu không thực hiện yêu cầu này, bạn có thể bỏ qua email.`,
        idempotencyKey: `password-reset/${this.hashToken(token)}`,
      });
    } catch (error) {
      this.logger.error("Không gửi được email đặt lại mật khẩu.", error instanceof Error ? error.stack : String(error));
    }
    return { accepted: true };
  }

  async resetPassword(token: string, newPassword: string): Promise<{ reset: true }> {
    const row = await this.validAccountToken(token, "PASSWORD_RESET");
    const user = await this.prisma.user.findUnique({ where: { id: row.userId } });
    if (!user) throw new BadRequestException("Liên kết đặt lại mật khẩu không hợp lệ.");
    if (await verifyPassword(newPassword, user.passwordHash)) throw new BadRequestException("Mật khẩu mới phải khác mật khẩu hiện tại.");
    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.accountToken.update({ where: { id: row.id }, data: { consumedAt: now } }),
      this.prisma.user.update({ where: { id: row.userId }, data: { passwordHash: await hashPassword(newPassword) } }),
      this.prisma.authSession.updateMany({ where: { userId: row.userId, revokedAt: null }, data: { revokedAt: now } }),
      this.prisma.accountToken.updateMany({ where: { userId: row.userId, type: "PASSWORD_RESET", consumedAt: null }, data: { consumedAt: now } }),
    ]);
    return { reset: true };
  }

  async verifyEmail(token: string): Promise<{ verified: true }> {
    const row = await this.validAccountToken(token, "EMAIL_VERIFICATION");
    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.accountToken.update({ where: { id: row.id }, data: { consumedAt: now } }),
      this.prisma.user.update({ where: { id: row.userId }, data: { emailVerifiedAt: now } }),
      this.prisma.accountToken.updateMany({ where: { userId: row.userId, type: "EMAIL_VERIFICATION", consumedAt: null }, data: { consumedAt: now } }),
    ]);
    return { verified: true };
  }

  async resendVerification(userId: string): Promise<{ sent: boolean }> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException("Không tìm thấy tài khoản.");
    if (user.emailVerifiedAt) return { sent: false };
    return { sent: await this.sendVerificationEmail(user.id, user.email) };
  }

  async getProfile(userId: string): Promise<AccountProfile> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException("Không tìm thấy tài khoản.");
    return {
      id: user.id, displayName: user.displayName, email: user.email, phone: user.phone ?? "", timezone: user.timezone,
      locale: user.locale, status: user.status, emailVerifiedAt: user.emailVerifiedAt?.toISOString() ?? null,
      mfaEnabled: Boolean(user.mfaEnabledAt), createdAt: user.createdAt.toISOString(),
    };
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

  async startMfaSetup(userId: string): Promise<{ secret: string; otpauthUri: string }> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException("Không tìm thấy tài khoản.");
    if (user.mfaEnabledAt) throw new ConflictException("MFA đã được bật cho tài khoản.");
    const secret = createMfaSecret();
    await this.prisma.user.update({ where: { id: userId }, data: { mfaSecretEncrypted: encryptMfaSecret(secret, this.encryptionSecret) } });
    return { secret, otpauthUri: createTotpUri(secret, user.email, this.issuer) };
  }

  async confirmMfa(userId: string, code: string): Promise<{ recoveryCodes: string[] }> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user?.mfaSecretEncrypted) throw new BadRequestException("Hãy khởi tạo cấu hình MFA trước.");
    if (!verifyTotp(decryptMfaSecret(user.mfaSecretEncrypted, this.encryptionSecret), code)) throw new BadRequestException("Mã xác thực không chính xác.");
    const recoveryCodes = createRecoveryCodes();
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: userId }, data: { mfaEnabledAt: new Date() } }),
      this.prisma.mfaRecoveryCode.deleteMany({ where: { userId } }),
      this.prisma.mfaRecoveryCode.createMany({ data: recoveryCodes.map((value) => ({ userId, codeHash: this.hashToken(value) })) }),
    ]);
    return { recoveryCodes };
  }

  async disableMfa(userId: string, password: string, code: string): Promise<{ disabled: true }> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user?.mfaSecretEncrypted || !user.mfaEnabledAt) throw new BadRequestException("MFA chưa được bật.");
    if (!(await verifyPassword(password, user.passwordHash))) throw new UnauthorizedException("Mật khẩu hiện tại không chính xác.");
    if (!verifyTotp(decryptMfaSecret(user.mfaSecretEncrypted, this.encryptionSecret), code)) throw new UnauthorizedException("Mã xác thực không chính xác.");
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: userId }, data: { mfaEnabledAt: null, mfaSecretEncrypted: null } }),
      this.prisma.mfaRecoveryCode.deleteMany({ where: { userId } }),
    ]);
    return { disabled: true };
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
    this.assertActive(row.user);
    const roleCode = requestedRole ?? row.currentRoleCode;
    if (!row.user.roles.some(({ role }) => role.code === roleCode)) throw new ForbiddenException("Tài khoản không có vai trò được yêu cầu.");
    if (row.currentRoleCode !== roleCode || Date.now() - row.lastSeenAt.getTime() > 60_000) {
      await this.prisma.authSession.update({ where: { id: row.id }, data: { currentRoleCode: roleCode, lastSeenAt: new Date() } });
    }
    return this.mapSession(row.id, row.user, roleCode as RoleCode);
  }

  async issueCsrf(sessionId: string): Promise<string> {
    const csrfToken = randomBytes(32).toString("base64url");
    await this.prisma.authSession.update({ where: { id: sessionId }, data: { csrfTokenHash: this.hashToken(csrfToken) } });
    return csrfToken;
  }

  async validateCsrf(sessionToken: string, csrfToken: string | undefined): Promise<boolean> {
    if (!csrfToken) return false;
    const row = await this.prisma.authSession.findUnique({ where: { tokenHash: this.hashToken(sessionToken) }, select: { csrfTokenHash: true, revokedAt: true, expiresAt: true } });
    if (!row?.csrfTokenHash || row.revokedAt || row.expiresAt <= new Date()) return false;
    const expected = Buffer.from(row.csrfTokenHash, "hex");
    const actual = Buffer.from(this.hashToken(csrfToken), "hex");
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  }

  async logout(token: string | undefined): Promise<void> {
    if (!token || !this.prisma.isStartupConnectionEnabled()) return;
    await this.prisma.authSession.updateMany({ where: { tokenHash: this.hashToken(token), revokedAt: null }, data: { revokedAt: new Date() } });
  }

  readToken(cookieHeader?: string): string | undefined {
    return cookieHeader?.split(";").map((part) => part.trim().split("=")).find(([name]) => name === SESSION_COOKIE)?.slice(1).join("=");
  }

  private async createSession(user: UserWithRoles, rememberMe: boolean, context: SessionContext): Promise<SessionIssue> {
    const selectedRole = user.roles[0]?.role;
    if (!selectedRole) throw new ForbiddenException("Tài khoản chưa được cấp vai trò sử dụng.");
    const token = randomBytes(48).toString("base64url");
    const csrfToken = randomBytes(32).toString("base64url");
    const maxAgeMs = rememberMe ? LONG_SESSION_MS : SHORT_SESSION_MS;
    const row = await this.prisma.authSession.create({ data: {
      tokenHash: this.hashToken(token), csrfTokenHash: this.hashToken(csrfToken), userId: user.id, currentRoleCode: selectedRole.code,
      expiresAt: new Date(Date.now() + maxAgeMs), ipAddress: context.ipAddress?.slice(0, 45), userAgent: context.userAgent?.slice(0, 500),
    } });
    return { token, csrfToken, maxAgeMs, session: this.mapSession(row.id, user, selectedRole.code as RoleCode) };
  }

  private loadUserByEmail(email: string): Promise<UserWithRoles | null> {
    return this.prisma.user.findUnique({ where: { email: email.trim().toLowerCase() }, include: { roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } } } });
  }

  private loadUser(userId: string): Promise<UserWithRoles | null> {
    return this.prisma.user.findUnique({ where: { id: userId }, include: { roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } } } });
  }

  private assertActive(user: { status: string }): void {
    if (user.status !== "ACTIVE") throw new ForbiddenException("Tài khoản đang bị khóa hoặc chưa được kích hoạt.");
  }

  private async sendVerificationEmail(userId: string, email: string): Promise<boolean> {
    const token = await this.issueAccountToken(userId, "EMAIL_VERIFICATION", EMAIL_TOKEN_MS);
    const link = `${this.webOrigin}/verify-email?token=${encodeURIComponent(token)}`;
    try {
      await this.email.send({
        to: email, subject: "Xác minh email Wind EDU",
        text: `Xác minh địa chỉ email của bạn để bảo vệ tài khoản Wind EDU. Liên kết có hiệu lực trong 24 giờ:\n${link}`,
        idempotencyKey: `email-verification/${this.hashToken(token)}`,
      });
      return true;
    } catch (error) {
      this.logger.error("Không gửi được email xác minh.", error instanceof Error ? error.stack : String(error));
      return false;
    }
  }

  private async issueAccountToken(userId: string, type: "EMAIL_VERIFICATION" | "PASSWORD_RESET" | "MFA_LOGIN", ttlMs: number): Promise<string> {
    const token = randomBytes(48).toString("base64url");
    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.accountToken.updateMany({ where: { userId, type, consumedAt: null }, data: { consumedAt: now } }),
      this.prisma.accountToken.create({ data: { tokenHash: this.hashToken(token), type, userId, expiresAt: new Date(now.getTime() + ttlMs) } }),
    ]);
    return token;
  }

  private async validAccountToken(token: string, type: "EMAIL_VERIFICATION" | "PASSWORD_RESET" | "MFA_LOGIN"): Promise<{ id: string; userId: string }> {
    const row = await this.prisma.accountToken.findUnique({ where: { tokenHash: this.hashToken(token) } });
    if (!row || row.type !== type || row.consumedAt || row.expiresAt <= new Date()) throw new BadRequestException("Liên kết hoặc phiên xác thực không hợp lệ hay đã hết hạn.");
    return { id: row.id, userId: row.userId };
  }

  private async consumeAccountToken(id: string): Promise<void> {
    const result = await this.prisma.accountToken.updateMany({ where: { id, consumedAt: null }, data: { consumedAt: new Date() } });
    if (!result.count) throw new BadRequestException("Phiên xác thực đã được sử dụng.");
  }

  private mapSession(sessionId: string, user: UserWithRoles, roleCode: RoleCode): AuthenticatedSession {
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
