import { BadGatewayException, BadRequestException, ConflictException, ForbiddenException, HttpException, HttpStatus, Injectable, Logger, NotFoundException, ServiceUnavailableException, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createHash, createHmac, randomBytes, randomInt, randomUUID, timingSafeEqual } from "node:crypto";
import { PrismaService } from "../database/prisma.service.js";
import type { Environment } from "../config/environment.js";
import { EmailDeliveryService } from "../infrastructure/email-delivery.service.js";
import { ObjectStorageService } from "../infrastructure/object-storage.service.js";
import { createMfaSecret, createRecoveryCodes, createTotpUri, decryptMfaSecret, encryptMfaSecret, verifyTotp } from "./mfa.js";
import type { PermissionCode, RoleCode } from "./permissions.js";
import { hashPassword, verifyPassword } from "./password.js";

const SESSION_COOKIE = "wind_edu_session";
const GOOGLE_STATE_COOKIE = "wind_edu_google_state";
const GOOGLE_MFA_COOKIE = "wind_edu_google_mfa";
const SHORT_SESSION_MS = 12 * 60 * 60 * 1000;
const LONG_SESSION_MS = 30 * 24 * 60 * 60 * 1000;
const EMAIL_TOKEN_MS = 24 * 60 * 60 * 1000;
const PASSWORD_TOKEN_MS = 30 * 60 * 1000;
const MFA_CHALLENGE_MS = 5 * 60 * 1000;
const GOOGLE_STATE_MS = 10 * 60 * 1000;
const EMAIL_STEP_UP_MS = 10 * 60 * 1000;

type SecurityEmailPurpose = "PASSWORD_CHANGE" | "MFA_SETUP" | "MFA_DISABLE";
type SecurityEmailTokenType = "PASSWORD_CHANGE_OTP" | "MFA_SETUP_OTP" | "MFA_DISABLE_OTP";

type UserWithRoles = {
  id: string; username: string; email: string; emailVerifiedAt: Date | null; passwordHash: string | null; googleSubject: string | null; displayName: string; status: string;
  mfaSecretEncrypted: string | null; mfaEnabledAt: Date | null; avatarObjectKey: string | null; avatarMimeType: string | null; avatarUpdatedAt: Date | null;
  roles: Array<{ role: { code: string; name: string; permissions: Array<{ permission: { code: string } }> } }>;
};

export interface AuthenticatedSession {
  sessionId: string;
  user: { id: string; username: string; name: string; email: string; roleName: string; avatarUrl?: string | null };
  roleCode: RoleCode;
  permissions: PermissionCode[];
  availableRoles: Array<{ code: RoleCode; name: string }>;
}

export interface SessionContext { ipAddress?: string; userAgent?: string }
export interface AccountProfile { id: string; username: string; displayName: string; email: string; phone: string; timezone: string; locale: string; avatarUrl: string | null; status: string; emailVerifiedAt: string | null; mfaEnabled: boolean; hasPassword: boolean; googleConnected: boolean; createdAt: string }
export interface AccountSession { id: string; current: boolean; currentRoleCode: string; ipAddress: string; userAgent: string; createdAt: string; lastSeenAt: string; expiresAt: string }
export interface SessionIssue { token: string; csrfToken: string; maxAgeMs: number; session: AuthenticatedSession }
export type LoginResult = SessionIssue | { requiresMfa: true; challengeToken: string };
export interface RegistrationResult { verificationRequired: true; verificationId: string; email: string; verificationEmailSent: boolean }

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly encryptionSecret: string;
  private readonly issuer: string;
  private readonly webOrigin: string;
  private readonly googleClientId: string;
  private readonly googleClientSecret: string;
  private readonly googleCallbackUrl: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailDeliveryService,
    private readonly objectStorage: ObjectStorageService,
    config: ConfigService<Environment, true>,
  ) {
    this.encryptionSecret = config.get("AUTH_ENCRYPTION_SECRET", { infer: true });
    this.issuer = config.get("MFA_ISSUER", { infer: true });
    this.webOrigin = config.get("WEB_ORIGIN", { infer: true }).replace(/\/$/, "");
    this.googleClientId = config.get("GOOGLE_CLIENT_ID", { infer: true });
    this.googleClientSecret = config.get("GOOGLE_CLIENT_SECRET", { infer: true });
    this.googleCallbackUrl = config.get("GOOGLE_CALLBACK_URL", { infer: true });
  }

  cookieName(): string { return SESSION_COOKIE; }
  googleStateCookieName(): string { return GOOGLE_STATE_COOKIE; }
  googleMfaCookieName(): string { return GOOGLE_MFA_COOKIE; }
  webUrl(path: string): string { return `${this.webOrigin}${path.startsWith("/") ? path : `/${path}`}`; }

  startGoogleOAuth(rememberMe = false): { authorizationUrl: string; stateCookie: string; maxAgeMs: number } {
    this.assertGoogleConfigured();
    const state = randomBytes(32).toString("base64url");
    const verifier = randomBytes(48).toString("base64url");
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    const stateCookie = this.signPayload({ kind: "google_state", state, verifier, rememberMe, expiresAt: Date.now() + GOOGLE_STATE_MS });
    const query = new URLSearchParams({
      client_id: this.googleClientId,
      redirect_uri: this.googleCallbackUrl,
      response_type: "code",
      scope: "openid email profile",
      state,
      code_challenge: challenge,
      code_challenge_method: "S256",
      prompt: "select_account",
    });
    return { authorizationUrl: `https://accounts.google.com/o/oauth2/v2/auth?${query.toString()}`, stateCookie, maxAgeMs: GOOGLE_STATE_MS };
  }

  async completeGoogleOAuth(code: string, state: string, stateCookie: string | undefined, context: SessionContext = {}): Promise<{ result: LoginResult; rememberMe: boolean }> {
    this.assertDatabase();
    this.assertGoogleConfigured();
    const payload = this.readSignedPayload<{ kind: string; state: string; verifier: string; rememberMe: boolean; expiresAt: number }>(stateCookie);
    if (!payload || payload.kind !== "google_state" || payload.expiresAt <= Date.now() || !this.safeEqual(payload.state, state)) {
      throw new UnauthorizedException("Phiên đăng nhập Google không hợp lệ hoặc đã hết hạn.");
    }

    let accessToken: string;
    try {
      const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
        body: new URLSearchParams({ code, client_id: this.googleClientId, client_secret: this.googleClientSecret, redirect_uri: this.googleCallbackUrl, grant_type: "authorization_code", code_verifier: payload.verifier }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!tokenResponse.ok) throw new Error(`Google token endpoint trả HTTP ${tokenResponse.status}.`);
      const tokenPayload = await tokenResponse.json() as { access_token?: unknown };
      if (typeof tokenPayload.access_token !== "string" || !tokenPayload.access_token) throw new Error("Google không trả access token hợp lệ.");
      accessToken = tokenPayload.access_token;
    } catch (error) {
      this.logger.error("Không thể đổi Google authorization code.", error instanceof Error ? error.message : String(error));
      throw new BadGatewayException("Không thể hoàn tất đăng nhập Google. Hãy thử lại.");
    }

    let googleProfile: { sub: string; email: string; name: string };
    try {
      const profileResponse = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
        headers: { authorization: `Bearer ${accessToken}`, accept: "application/json" },
        signal: AbortSignal.timeout(10_000),
      });
      if (!profileResponse.ok) throw new Error(`Google userinfo trả HTTP ${profileResponse.status}.`);
      const profile = await profileResponse.json() as { sub?: unknown; email?: unknown; email_verified?: unknown; name?: unknown };
      if (typeof profile.sub !== "string" || typeof profile.email !== "string" || profile.email_verified !== true) throw new Error("Google không xác nhận email của tài khoản.");
      googleProfile = { sub: profile.sub, email: profile.email.trim().toLowerCase(), name: typeof profile.name === "string" && profile.name.trim() ? profile.name.trim() : profile.email };
    } catch (error) {
      this.logger.error("Không thể đọc hồ sơ Google đã xác minh.", error instanceof Error ? error.message : String(error));
      throw new BadGatewayException("Google chưa cung cấp hồ sơ email đã xác minh.");
    }

    const user = await this.upsertGoogleUser(googleProfile);
    this.assertActive(user);
    const result: LoginResult = user.mfaEnabledAt && user.mfaSecretEncrypted
      ? { requiresMfa: true, challengeToken: await this.issueAccountToken(user.id, "MFA_LOGIN", MFA_CHALLENGE_MS) }
      : await this.createSession(user, payload.rememberMe, context);
    return { result, rememberMe: payload.rememberMe };
  }

  createGoogleMfaCookie(challengeToken: string, rememberMe: boolean): string {
    return this.signPayload({ kind: "google_mfa", challengeToken, rememberMe, expiresAt: Date.now() + MFA_CHALLENGE_MS });
  }

  async completeGoogleMfa(mfaCookie: string | undefined, code: string, context: SessionContext = {}, recoveryCode?: string): Promise<SessionIssue> {
    const payload = this.readSignedPayload<{ kind: string; challengeToken: string; rememberMe: boolean; expiresAt: number }>(mfaCookie);
    if (!payload || payload.kind !== "google_mfa" || payload.expiresAt <= Date.now()) throw new UnauthorizedException("Phiên xác thực Google đã hết hạn. Hãy đăng nhập lại.");
    return this.completeMfaLogin(payload.challengeToken, code, payload.rememberMe, context, recoveryCode);
  }

  async login(username: string, password: string, rememberMe = false, context: SessionContext = {}): Promise<LoginResult> {
    this.assertDatabase();
    const user = await this.loadUserByUsername(username);
    if (!user || !(await verifyPassword(password, user.passwordHash))) throw new UnauthorizedException("Tài khoản hoặc mật khẩu không chính xác.");
    if (user.status === "PENDING_VERIFICATION" || !user.emailVerifiedAt) {
      const verificationId = await this.pendingVerificationId(user.id) ?? (await this.sendVerificationEmail(user.id, user.email)).verificationId;
      throw new ForbiddenException({
        statusCode: 403,
        code: "EMAIL_VERIFICATION_REQUIRED",
        message: "Tài khoản chưa hoàn tất xác minh email. Hãy nhập mã 6 số hoặc mở liên kết đã gửi tới email của bạn.",
        verificationRequired: true,
        verificationId,
        email: user.email,
      });
    }
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

  async register(username: string, displayName: string, email: string, password: string): Promise<RegistrationResult> {
    this.assertDatabase();
    const normalizedUsername = username.trim().toLowerCase();
    const normalizedEmail = email.trim().toLowerCase();
    const learnerRole = await this.prisma.role.findUnique({ where: { code: "LEARNER" } });
    if (!learnerRole) throw new ServiceUnavailableException("Vai trò học viên chưa được khởi tạo.");
    const [usernameOwner, emailOwner] = await Promise.all([
      this.prisma.user.findUnique({ where: { username: normalizedUsername } }),
      this.prisma.user.findUnique({ where: { email: normalizedEmail } }),
    ]);
    if (usernameOwner) throw new ConflictException("Tên tài khoản đã được sử dụng. Hãy chọn tên khác.");
    if (emailOwner) {
      if (emailOwner.status === "PENDING_VERIFICATION" && !emailOwner.emailVerifiedAt) {
        throw new ConflictException({
          statusCode: 409,
          code: "EMAIL_PENDING_VERIFICATION",
          message: "Email này đang liên kết với một tài khoản chưa hoàn tất xác minh. Bạn có thể tiếp tục xác minh tài khoản hiện có hoặc dùng email khác để tạo tài khoản mới.",
          canContinueVerification: true,
        });
      }
      throw new ConflictException("Email đã được liên kết với một tài khoản khác.");
    }
    let userId: string;
    try {
      const created = await this.prisma.user.create({ data: {
        username: normalizedUsername, email: normalizedEmail, displayName: displayName.trim(), passwordHash: await hashPassword(password), status: "PENDING_VERIFICATION",
        roles: { create: { roleId: learnerRole.id } },
      } });
      userId = created.id;
    } catch (error) {
      if (typeof error === "object" && error !== null && "code" in error && error.code === "P2002") throw new ConflictException("Tên tài khoản hoặc email vừa được sử dụng. Hãy kiểm tra lại.");
      throw error;
    }
    const verification = await this.sendVerificationEmail(userId, normalizedEmail);
    return { verificationRequired: true, verificationId: verification.verificationId, email: normalizedEmail, verificationEmailSent: verification.sent };
  }

  async requestPasswordReset(email: string): Promise<{ accepted: true }> {
    const user = await this.loadUserByEmail(email);
    if (!user || user.status !== "ACTIVE" || !user.passwordHash) return { accepted: true };
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
    if (user.passwordHash && await verifyPassword(newPassword, user.passwordHash)) throw new BadRequestException("Mật khẩu mới phải khác mật khẩu hiện tại.");
    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.accountToken.update({ where: { id: row.id }, data: { consumedAt: now } }),
      this.prisma.user.update({ where: { id: row.userId }, data: { passwordHash: await hashPassword(newPassword) } }),
      this.prisma.authSession.updateMany({ where: { userId: row.userId, revokedAt: null }, data: { revokedAt: now } }),
      this.prisma.accountToken.updateMany({ where: { userId: row.userId, type: "PASSWORD_RESET", consumedAt: null }, data: { consumedAt: now } }),
    ]);
    return { reset: true };
  }

  async verifyEmail(token: string): Promise<{ verified: true; verificationId: string }> {
    const row = await this.validAccountToken(token, "EMAIL_VERIFICATION");
    const now = new Date();
    await this.prisma.$transaction(async (transaction) => {
      const consumed = await transaction.accountToken.updateMany({ where: { id: row.id, consumedAt: null, expiresAt: { gt: now } }, data: { consumedAt: now } });
      if (consumed.count !== 1) throw new BadRequestException("Liên kết xác minh email đã được sử dụng hoặc đã hết hạn.");
      await transaction.user.update({ where: { id: row.userId }, data: { emailVerifiedAt: now } });
      await transaction.user.updateMany({ where: { id: row.userId, status: "PENDING_VERIFICATION" }, data: { status: "ACTIVE" } });
      await transaction.accountToken.updateMany({ where: { userId: row.userId, type: "EMAIL_VERIFICATION", consumedAt: null }, data: { consumedAt: now } });
    });
    return { verified: true, verificationId: row.id };
  }

  async verifyEmailCode(verificationId: string, code: string): Promise<{ verified: true; verificationId: string }> {
    const row = await this.prisma.accountToken.findUnique({ where: { id: verificationId } });
    if (!row || row.type !== "EMAIL_VERIFICATION" || row.consumedAt || row.expiresAt <= new Date() || !row.codeHash) {
      throw new BadRequestException("Phiên xác minh email không hợp lệ hoặc đã hết hạn.");
    }
    if (row.failedAttempts >= 5) throw new UnauthorizedException("Bạn đã nhập sai quá nhiều lần. Hãy yêu cầu gửi mã mới.");
    const expected = Buffer.from(row.codeHash, "hex");
    const actual = Buffer.from(this.hashVerificationCode(verificationId, code), "hex");
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
      await this.prisma.accountToken.update({ where: { id: row.id }, data: { failedAttempts: { increment: 1 } } });
      throw new UnauthorizedException("Mã xác minh không chính xác.");
    }
    const now = new Date();
    await this.prisma.$transaction(async (transaction) => {
      const consumed = await transaction.accountToken.updateMany({ where: { id: row.id, consumedAt: null, expiresAt: { gt: now } }, data: { consumedAt: now } });
      if (consumed.count !== 1) throw new BadRequestException("Mã xác minh đã được sử dụng hoặc đã hết hạn.");
      await transaction.user.update({ where: { id: row.userId }, data: { emailVerifiedAt: now } });
      await transaction.user.updateMany({ where: { id: row.userId, status: "PENDING_VERIFICATION" }, data: { status: "ACTIVE" } });
      await transaction.accountToken.updateMany({ where: { userId: row.userId, type: "EMAIL_VERIFICATION", consumedAt: null }, data: { consumedAt: now } });
    });
    return { verified: true, verificationId };
  }

  async verificationStatus(verificationId: string): Promise<{ verified: boolean; expired: boolean }> {
    const row = await this.prisma.accountToken.findUnique({ where: { id: verificationId }, include: { user: { select: { emailVerifiedAt: true } } } });
    if (!row || row.type !== "EMAIL_VERIFICATION") throw new NotFoundException("Không tìm thấy phiên xác minh email.");
    return { verified: Boolean(row.user.emailVerifiedAt), expired: !row.user.emailVerifiedAt && row.expiresAt <= new Date() };
  }

  async changePendingVerificationEmail(verificationId: string, password: string, newEmail: string): Promise<RegistrationResult> {
    this.assertDatabase();
    const now = new Date();
    const token = await this.prisma.accountToken.findUnique({ where: { id: verificationId }, include: { user: true } });
    if (!token || token.type !== "EMAIL_VERIFICATION" || token.consumedAt || token.expiresAt <= now
      || token.user.status !== "PENDING_VERIFICATION" || token.user.emailVerifiedAt) {
      throw new BadRequestException("Phiên xác minh email không hợp lệ hoặc đã hết hạn.");
    }
    if (!token.user.passwordHash || !(await verifyPassword(password, token.user.passwordHash))) {
      throw new UnauthorizedException("Mật khẩu hiện tại không chính xác.");
    }

    const normalizedEmail = newEmail.trim().toLowerCase();
    if (normalizedEmail === token.user.email.toLowerCase()) {
      throw new BadRequestException("Email mới phải khác email đang chờ xác minh.");
    }
    const emailOwner = await this.prisma.user.findUnique({ where: { email: normalizedEmail }, select: { id: true } });
    if (emailOwner && emailOwner.id !== token.userId) {
      throw new ConflictException("Email này đã được liên kết với một tài khoản khác.");
    }

    const recentDeliveries = await this.prisma.accountToken.count({
      where: { userId: token.userId, type: "EMAIL_VERIFICATION", createdAt: { gt: new Date(now.getTime() - 60 * 60 * 1000) } },
    });
    if (recentDeliveries >= 5) {
      throw new HttpException("Bạn đã yêu cầu gửi email quá nhiều lần. Hãy thử lại sau một giờ.", HttpStatus.TOO_MANY_REQUESTS);
    }

    const usernameFollowsEmail = token.user.username.toLowerCase() === token.user.email.toLowerCase();
    try {
      await this.prisma.$transaction(async (transaction) => {
        const claimed = await transaction.accountToken.updateMany({
          where: { id: verificationId, consumedAt: null, expiresAt: { gt: now } },
          data: { consumedAt: now },
        });
        if (claimed.count !== 1) throw new BadRequestException("Phiên xác minh email đã được sử dụng hoặc đã hết hạn.");
        await transaction.user.update({
          where: { id: token.userId },
          data: { email: normalizedEmail, ...(usernameFollowsEmail ? { username: normalizedEmail } : {}) },
        });
        await transaction.auditLog.create({
          data: {
            actorId: token.userId,
            action: "PENDING_VERIFICATION_EMAIL_CHANGED",
            entityType: "user",
            entityId: token.userId,
            context: { previousEmail: token.user.email, newEmail: normalizedEmail, usernameUpdated: usernameFollowsEmail },
          },
        });
      });
    } catch (error) {
      if (typeof error === "object" && error !== null && "code" in error && error.code === "P2002") {
        throw new ConflictException("Email này đã được liên kết với một tài khoản khác.");
      }
      throw error;
    }

    const verification = await this.sendVerificationEmail(token.userId, normalizedEmail);
    return {
      verificationRequired: true,
      verificationId: verification.verificationId,
      email: normalizedEmail,
      verificationEmailSent: verification.sent,
    };
  }

  async resendPublicVerification(identifier: string, verificationId?: string): Promise<{ accepted: true; verificationId?: string }> {
    const normalized = identifier.trim().toLowerCase();
    const user = normalized.includes("@") ? await this.loadUserByEmail(normalized) : await this.loadUserByUsername(normalized);
    if (!user || user.emailVerifiedAt || user.status !== "PENDING_VERIFICATION") return { accepted: true };
    const current = verificationId ? await this.prisma.accountToken.findUnique({ where: { id: verificationId } }) : null;
    const canReturnId = Boolean(current && current.userId === user.id && current.type === "EMAIL_VERIFICATION");
    const recent = await this.prisma.accountToken.findFirst({
      where: { userId: user.id, type: "EMAIL_VERIFICATION", consumedAt: null, createdAt: { gt: new Date(Date.now() - 60_000) } },
      orderBy: { createdAt: "desc" },
    });
    if (recent) return canReturnId ? { accepted: true, verificationId: recent.id } : { accepted: true };
    const result = await this.sendVerificationEmail(user.id, user.email);
    return canReturnId ? { accepted: true, verificationId: result.verificationId } : { accepted: true };
  }

  async resendVerification(userId: string): Promise<{ sent: boolean }> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException("Không tìm thấy tài khoản.");
    if (user.emailVerifiedAt) return { sent: false };
    return { sent: (await this.sendVerificationEmail(user.id, user.email)).sent };
  }

  async requestSecurityEmailCode(userId: string, purpose: SecurityEmailPurpose): Promise<{ challengeId: string; email: string; sent: boolean; expiresInSeconds: number }> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user?.googleSubject || !user.emailVerifiedAt || user.status !== "ACTIVE") {
      throw new BadRequestException("Xác thực email cho thao tác này chỉ áp dụng với tài khoản Google đang hoạt động.");
    }
    if (purpose === "MFA_SETUP" && user.mfaEnabledAt) throw new ConflictException("MFA đã được bật cho tài khoản.");
    if (purpose === "MFA_DISABLE" && !user.mfaEnabledAt) throw new BadRequestException("MFA chưa được bật.");

    const tokenType = this.securityTokenType(purpose);
    const now = new Date();
    const recent = await this.prisma.accountToken.findFirst({
      where: { userId, type: tokenType, consumedAt: null, expiresAt: { gt: now }, createdAt: { gt: new Date(now.getTime() - 60_000) } },
      orderBy: { createdAt: "desc" },
    });
    if (recent) return { challengeId: recent.id, email: this.maskEmail(user.email), sent: false, expiresInSeconds: Math.max(1, Math.floor((recent.expiresAt.getTime() - now.getTime()) / 1000)) };

    const recentCount = await this.prisma.accountToken.count({
      where: { userId, type: { in: ["PASSWORD_CHANGE_OTP", "MFA_SETUP_OTP", "MFA_DISABLE_OTP"] }, createdAt: { gt: new Date(now.getTime() - 60 * 60 * 1000) } },
    });
    if (recentCount >= 5) throw new HttpException("Bạn đã yêu cầu quá nhiều mã bảo mật. Hãy thử lại sau một giờ.", HttpStatus.TOO_MANY_REQUESTS);

    const challengeId = randomBytes(18).toString("hex");
    const code = randomInt(0, 1_000_000).toString().padStart(6, "0");
    const expiresAt = new Date(now.getTime() + EMAIL_STEP_UP_MS);
    await this.prisma.$transaction([
      this.prisma.accountToken.updateMany({ where: { userId, type: tokenType, consumedAt: null }, data: { consumedAt: now } }),
      this.prisma.accountToken.create({ data: { id: challengeId, tokenHash: this.hashToken(randomBytes(48).toString("base64url")), codeHash: this.hashVerificationCode(challengeId, code), type: tokenType, userId, expiresAt } }),
    ]);

    const action = purpose === "PASSWORD_CHANGE" ? "đặt hoặc đổi mật khẩu" : purpose === "MFA_SETUP" ? "bật xác thực hai bước" : "tắt xác thực hai bước";
    let sent = false;
    try {
      await this.email.send({
        to: user.email,
        subject: `Mã bảo mật để ${action} trên Wind EDU`,
        text: `Mã bảo mật Wind EDU của bạn là: ${code}\n\nMã dùng để ${action}, có hiệu lực trong 10 phút và chỉ dùng được một lần. Nếu bạn không thực hiện yêu cầu này, hãy đổi quyền truy cập Google và liên hệ quản trị viên.`,
        idempotencyKey: `security-email/${tokenType.toLowerCase()}/${challengeId}`,
      });
      sent = true;
    } catch (error) {
      this.logger.error("Không gửi được mã bảo mật qua email.", error instanceof Error ? error.stack : String(error));
    }
    return { challengeId, email: this.maskEmail(user.email), sent, expiresInSeconds: EMAIL_STEP_UP_MS / 1000 };
  }

  async getProfile(userId: string): Promise<AccountProfile> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException("Không tìm thấy tài khoản.");
    return {
      id: user.id, username: user.username, displayName: user.displayName, email: user.email, phone: user.phone ?? "", timezone: user.timezone,
      locale: user.locale, avatarUrl: this.avatarUrl(user.avatarObjectKey, user.avatarUpdatedAt), status: user.status, emailVerifiedAt: user.emailVerifiedAt?.toISOString() ?? null,
      mfaEnabled: Boolean(user.mfaEnabledAt), hasPassword: Boolean(user.passwordHash), googleConnected: Boolean(user.googleSubject), createdAt: user.createdAt.toISOString(),
    };
  }

  async updateProfile(userId: string, input: { displayName: string; phone?: string; timezone: string; locale: string }): Promise<AccountProfile> {
    await this.prisma.user.update({ where: { id: userId }, data: { displayName: input.displayName.trim(), phone: input.phone?.trim() || null, timezone: input.timezone, locale: input.locale } });
    return this.getProfile(userId);
  }

  async updateAvatar(userId: string, upload: { mimeType: string; size: number; buffer: Buffer }): Promise<AccountProfile> {
    const extension = this.validateAvatar(upload);
    const current = await this.prisma.user.findUnique({ where: { id: userId }, select: { avatarObjectKey: true } });
    if (!current) throw new NotFoundException("Không tìm thấy tài khoản.");
    const stored = await this.objectStorage.put(`avatars/${userId}/${randomUUID()}.${extension}`, upload.buffer);
    try {
      await this.prisma.user.update({ where: { id: userId }, data: { avatarObjectKey: stored.objectKey, avatarMimeType: upload.mimeType, avatarUpdatedAt: new Date() } });
    } catch (error) {
      await this.objectStorage.remove(stored.objectKey).catch(() => undefined);
      throw error;
    }
    if (current.avatarObjectKey) await this.objectStorage.remove(current.avatarObjectKey).catch((error: unknown) => this.logger.warn(`Không xóa được avatar cũ: ${error instanceof Error ? error.message : String(error)}`));
    return this.getProfile(userId);
  }

  async removeAvatar(userId: string): Promise<AccountProfile> {
    const current = await this.prisma.user.findUnique({ where: { id: userId }, select: { avatarObjectKey: true } });
    if (!current) throw new NotFoundException("Không tìm thấy tài khoản.");
    await this.prisma.user.update({ where: { id: userId }, data: { avatarObjectKey: null, avatarMimeType: null, avatarUpdatedAt: null } });
    if (current.avatarObjectKey) await this.objectStorage.remove(current.avatarObjectKey).catch((error: unknown) => this.logger.warn(`Không xóa được avatar: ${error instanceof Error ? error.message : String(error)}`));
    return this.getProfile(userId);
  }

  async readAvatar(userId: string): Promise<{ buffer: Buffer; mimeType: string }> {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { avatarObjectKey: true, avatarMimeType: true } });
    if (!user?.avatarObjectKey || !user.avatarMimeType) throw new NotFoundException("Tài khoản chưa có ảnh đại diện.");
    return { buffer: await this.objectStorage.get(user.avatarObjectKey), mimeType: user.avatarMimeType };
  }

  async changePassword(userId: string, currentSessionId: string, currentPassword: string | undefined, newPassword: string, challengeId?: string, code?: string): Promise<{ revokedSessions: number }> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException("Không tìm thấy tài khoản.");
    if (user.passwordHash && await verifyPassword(newPassword, user.passwordHash)) throw new BadRequestException("Mật khẩu mới phải khác mật khẩu hiện tại.");
    if (user.googleSubject) await this.consumeSecurityEmailCode(userId, "PASSWORD_CHANGE_OTP", challengeId, code);
    else if (!currentPassword || !(await verifyPassword(currentPassword, user.passwordHash))) throw new UnauthorizedException("Mật khẩu hiện tại không chính xác.");
    const now = new Date();
    const [, revoked] = await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: userId }, data: { passwordHash: await hashPassword(newPassword) } }),
      this.prisma.authSession.updateMany({ where: { userId, id: { not: currentSessionId }, revokedAt: null }, data: { revokedAt: now } }),
      this.prisma.auditLog.create({ data: { actorId: userId, action: user.passwordHash ? "PASSWORD_CHANGED" : "PASSWORD_CREATED", entityType: "user", entityId: userId, context: { verificationMethod: user.googleSubject ? "EMAIL_OTP" : "CURRENT_PASSWORD" } } }),
    ]);
    return { revokedSessions: revoked.count };
  }

  async startMfaSetup(userId: string, challengeId?: string, code?: string): Promise<{ secret: string; otpauthUri: string }> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException("Không tìm thấy tài khoản.");
    if (user.mfaEnabledAt) throw new ConflictException("MFA đã được bật cho tài khoản.");
    if (user.googleSubject) await this.consumeSecurityEmailCode(userId, "MFA_SETUP_OTP", challengeId, code);
    const secret = createMfaSecret();
    await this.prisma.user.update({ where: { id: userId }, data: { mfaSecretEncrypted: encryptMfaSecret(secret, this.encryptionSecret) } });
    return { secret, otpauthUri: createTotpUri(secret, user.username, this.issuer) };
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

  async startDisableMfa(userId: string, password?: string, challengeId?: string, code?: string): Promise<{ challengeToken: string; expiresInSeconds: number }> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user?.mfaSecretEncrypted || !user.mfaEnabledAt) throw new BadRequestException("MFA chưa được bật.");
    if (user.googleSubject) await this.consumeSecurityEmailCode(userId, "MFA_DISABLE_OTP", challengeId, code);
    else if (!password || !(await verifyPassword(password, user.passwordHash))) throw new UnauthorizedException("Mật khẩu hiện tại không chính xác.");
    return { challengeToken: await this.issueAccountToken(userId, "MFA_DISABLE", MFA_CHALLENGE_MS), expiresInSeconds: MFA_CHALLENGE_MS / 1000 };
  }

  async disableMfa(userId: string, challengeToken: string, code: string): Promise<{ disabled: true }> {
    const challenge = await this.validAccountToken(challengeToken, "MFA_DISABLE");
    if (challenge.userId !== userId) throw new UnauthorizedException("Phiên tắt xác thực hai bước không hợp lệ.");
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user?.mfaSecretEncrypted || !user.mfaEnabledAt) throw new BadRequestException("MFA chưa được bật.");
    if (!verifyTotp(decryptMfaSecret(user.mfaSecretEncrypted, this.encryptionSecret), code)) throw new UnauthorizedException("Mã xác thực không chính xác.");
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: userId }, data: { mfaEnabledAt: null, mfaSecretEncrypted: null } }),
      this.prisma.mfaRecoveryCode.deleteMany({ where: { userId } }),
      this.prisma.accountToken.update({ where: { id: challenge.id }, data: { consumedAt: new Date() } }),
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
    return this.readCookie(cookieHeader, SESSION_COOKIE);
  }

  readCookie(cookieHeader: string | undefined, name: string): string | undefined {
    return cookieHeader?.split(";").map((part) => part.trim().split("=")).find(([cookieName]) => cookieName === name)?.slice(1).join("=");
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

  private loadUserByUsername(username: string): Promise<UserWithRoles | null> {
    return this.prisma.user.findUnique({ where: { username: username.trim().toLowerCase() }, include: { roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } } } });
  }

  private loadUser(userId: string): Promise<UserWithRoles | null> {
    return this.prisma.user.findUnique({ where: { id: userId }, include: { roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } } } });
  }

  private async upsertGoogleUser(profile: { sub: string; email: string; name: string }): Promise<UserWithRoles> {
    const learnerRole = await this.prisma.role.findUnique({ where: { code: "LEARNER" } });
    if (!learnerRole) throw new ServiceUnavailableException("Vai trò học viên chưa được khởi tạo.");
    const [subjectOwner, emailOwner] = await Promise.all([
      this.prisma.user.findUnique({ where: { googleSubject: profile.sub } }),
      this.prisma.user.findUnique({ where: { email: profile.email } }),
    ]);
    if (subjectOwner && emailOwner && subjectOwner.id !== emailOwner.id) throw new ConflictException("Email Google đang liên kết với một tài khoản khác.");
    const existing = subjectOwner ?? emailOwner;
    if (existing && !["ACTIVE", "PENDING_VERIFICATION"].includes(existing.status)) throw new ForbiddenException("Tài khoản đang bị khóa hoặc chưa được kích hoạt.");

    let userId: string;
    try {
      userId = await this.prisma.$transaction(async (transaction) => {
        const now = new Date();
        if (existing) {
          const firstGoogleLink = !existing.googleSubject;
          const updated = await transaction.user.update({
            where: { id: existing.id },
            data: {
              googleSubject: profile.sub,
              username: profile.email,
              email: profile.email,
              emailVerifiedAt: now,
              status: existing.status === "PENDING_VERIFICATION" ? "ACTIVE" : existing.status,
              ...(firstGoogleLink && !existing.mfaEnabledAt ? { mfaSecretEncrypted: null } : {}),
            },
          });
          await transaction.auditLog.create({ data: { actorId: updated.id, action: firstGoogleLink ? "GOOGLE_ACCOUNT_LINKED" : "GOOGLE_LOGIN", entityType: "user", entityId: updated.id, context: { email: profile.email } } });
          return updated.id;
        }
        const created = await transaction.user.create({ data: {
          username: profile.email,
          email: profile.email,
          displayName: profile.name.slice(0, 150),
          passwordHash: null,
          googleSubject: profile.sub,
          emailVerifiedAt: now,
          status: "ACTIVE",
          roles: { create: { roleId: learnerRole.id } },
        } });
        await transaction.auditLog.create({ data: { actorId: created.id, action: "GOOGLE_ACCOUNT_CREATED", entityType: "user", entityId: created.id, context: { email: profile.email } } });
        return created.id;
      });
    } catch (error) {
      if (typeof error === "object" && error !== null && "code" in error && error.code === "P2002") throw new ConflictException("Email Google đang liên kết với một tài khoản khác.");
      throw error;
    }
    const user = await this.loadUser(userId);
    if (!user) throw new ServiceUnavailableException("Không thể nạp tài khoản sau đăng nhập Google.");
    return user;
  }

  private async consumeSecurityEmailCode(userId: string, type: SecurityEmailTokenType, challengeId?: string, code?: string): Promise<void> {
    if (!challengeId || !code) throw new BadRequestException("Hãy gửi và nhập mã xác thực 6 số từ email trước khi tiếp tục.");
    const row = await this.prisma.accountToken.findUnique({ where: { id: challengeId } });
    if (!row || row.userId !== userId || row.type !== type || row.consumedAt || row.expiresAt <= new Date() || !row.codeHash) {
      throw new BadRequestException("Phiên xác thực email không hợp lệ hoặc đã hết hạn.");
    }
    if (row.failedAttempts >= 5) throw new UnauthorizedException("Bạn đã nhập sai quá nhiều lần. Hãy yêu cầu mã bảo mật mới.");
    const expected = Buffer.from(row.codeHash, "hex");
    const actual = Buffer.from(this.hashVerificationCode(challengeId, code), "hex");
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
      await this.prisma.accountToken.update({ where: { id: row.id }, data: { failedAttempts: { increment: 1 } } });
      throw new UnauthorizedException("Mã xác thực email không chính xác.");
    }
    const consumed = await this.prisma.accountToken.updateMany({ where: { id: row.id, consumedAt: null, expiresAt: { gt: new Date() } }, data: { consumedAt: new Date() } });
    if (consumed.count !== 1) throw new BadRequestException("Mã xác thực email đã được sử dụng hoặc hết hạn.");
  }

  private securityTokenType(purpose: SecurityEmailPurpose): SecurityEmailTokenType {
    if (purpose === "PASSWORD_CHANGE") return "PASSWORD_CHANGE_OTP";
    if (purpose === "MFA_SETUP") return "MFA_SETUP_OTP";
    return "MFA_DISABLE_OTP";
  }

  private signPayload(payload: object): string {
    const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
    const signature = createHmac("sha256", this.encryptionSecret).update(encoded).digest("base64url");
    return `${encoded}.${signature}`;
  }

  private readSignedPayload<T>(value: string | undefined): T | null {
    if (!value) return null;
    const parts = value.split(".");
    if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
    const expected = createHmac("sha256", this.encryptionSecret).update(parts[0]).digest("base64url");
    if (!this.safeEqual(expected, parts[1])) return null;
    try { return JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8")) as T; }
    catch { return null; }
  }

  private safeEqual(left: string, right: string): boolean {
    const leftHash = createHash("sha256").update(left).digest();
    const rightHash = createHash("sha256").update(right).digest();
    return timingSafeEqual(leftHash, rightHash);
  }

  private maskEmail(email: string): string {
    const [name, domain] = email.split("@");
    if (!name || !domain) return "email đã xác minh";
    return `${name.slice(0, 2)}${"*".repeat(Math.max(2, Math.min(name.length - 2, 5)))}@${domain}`;
  }

  private assertGoogleConfigured(): void {
    if (!this.googleClientId || !this.googleClientSecret || !this.googleCallbackUrl) throw new ServiceUnavailableException("Đăng nhập Google chưa được cấu hình đầy đủ.");
  }

  private assertActive(user: { status: string; emailVerifiedAt?: Date | null }): void {
    if (user.status === "PENDING_VERIFICATION" || !user.emailVerifiedAt) {
      throw new ForbiddenException({ statusCode: 403, code: "EMAIL_VERIFICATION_REQUIRED", message: "Tài khoản chưa hoàn tất xác minh email. Hãy nhập mã 6 số hoặc mở liên kết đã gửi tới email của bạn.", verificationRequired: true });
    }
    if (user.status !== "ACTIVE") throw new ForbiddenException("Tài khoản đang bị khóa hoặc chưa được kích hoạt.");
  }

  private async sendVerificationEmail(userId: string, email: string): Promise<{ sent: boolean; verificationId: string }> {
    const verificationId = randomBytes(18).toString("hex");
    const token = randomBytes(48).toString("base64url");
    const code = randomInt(0, 1_000_000).toString().padStart(6, "0");
    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.accountToken.updateMany({ where: { userId, type: "EMAIL_VERIFICATION", consumedAt: null }, data: { consumedAt: now } }),
      this.prisma.accountToken.create({ data: { id: verificationId, tokenHash: this.hashToken(token), codeHash: this.hashVerificationCode(verificationId, code), type: "EMAIL_VERIFICATION", userId, expiresAt: new Date(now.getTime() + EMAIL_TOKEN_MS) } }),
    ]);
    const link = `${this.webOrigin}/verify-email?token=${encodeURIComponent(token)}`;
    try {
      await this.email.send({
        to: email, subject: "Xác minh email Wind EDU",
        text: `Mã xác minh Wind EDU của bạn là: ${code}\n\nHoặc mở liên kết sau để xác minh ngay:\n${link}\n\nMã và liên kết có hiệu lực trong 24 giờ. Nếu bạn không tạo tài khoản này, hãy bỏ qua email.`,
        idempotencyKey: `email-verification/${this.hashToken(token)}`,
      });
      return { sent: true, verificationId };
    } catch (error) {
      this.logger.error("Không gửi được email xác minh.", error instanceof Error ? error.stack : String(error));
      return { sent: false, verificationId };
    }
  }

  private async pendingVerificationId(userId: string): Promise<string | undefined> {
    const row = await this.prisma.accountToken.findFirst({
      where: { userId, type: "EMAIL_VERIFICATION", consumedAt: null, expiresAt: { gt: new Date() } },
      select: { id: true },
      orderBy: { createdAt: "desc" },
    });
    return row?.id;
  }

  private async issueAccountToken(userId: string, type: "PASSWORD_RESET" | "MFA_LOGIN" | "MFA_DISABLE", ttlMs: number): Promise<string> {
    const token = randomBytes(48).toString("base64url");
    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.accountToken.updateMany({ where: { userId, type, consumedAt: null }, data: { consumedAt: now } }),
      this.prisma.accountToken.create({ data: { tokenHash: this.hashToken(token), type, userId, expiresAt: new Date(now.getTime() + ttlMs) } }),
    ]);
    return token;
  }

  private async validAccountToken(token: string, type: "EMAIL_VERIFICATION" | "PASSWORD_RESET" | "MFA_LOGIN" | "MFA_DISABLE"): Promise<{ id: string; userId: string }> {
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
      user: { id: user.id, username: user.username, name: user.displayName, email: user.email, roleName: selected.name, avatarUrl: this.avatarUrl(user.avatarObjectKey, user.avatarUpdatedAt) },
      roleCode,
      permissions: selected.permissions.map(({ permission }) => permission.code as PermissionCode),
      availableRoles: user.roles.map(({ role }) => ({ code: role.code as RoleCode, name: role.name })),
    };
  }

  private hashToken(token: string): string { return createHash("sha256").update(token).digest("hex"); }
  private avatarUrl(objectKey: string | null, updatedAt: Date | null): string | null { return objectKey ? `/account/avatar?v=${updatedAt?.getTime() ?? 0}` : null; }
  private validateAvatar(upload: { mimeType: string; size: number; buffer: Buffer }): "png" | "jpg" | "webp" {
    if (upload.size !== upload.buffer.length || upload.size < 1 || upload.size > 3 * 1024 * 1024) throw new BadRequestException("Ảnh đại diện phải có kích thước từ 1 byte đến 3 MB.");
    const png = upload.mimeType === "image/png" && upload.buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    const jpeg = upload.mimeType === "image/jpeg" && upload.buffer[0] === 0xff && upload.buffer[1] === 0xd8 && upload.buffer[2] === 0xff;
    const webp = upload.mimeType === "image/webp" && upload.buffer.subarray(0, 4).toString("ascii") === "RIFF" && upload.buffer.subarray(8, 12).toString("ascii") === "WEBP";
    if (!png && !jpeg && !webp) throw new BadRequestException("Chỉ chấp nhận ảnh PNG, JPEG hoặc WebP hợp lệ.");
    return png ? "png" : jpeg ? "jpg" : "webp";
  }
  private hashVerificationCode(verificationId: string, code: string): string { return createHmac("sha256", this.encryptionSecret).update(`${verificationId}:${code}`).digest("hex"); }
  private assertDatabase(): void {
    if (!this.prisma.isStartupConnectionEnabled()) throw new ServiceUnavailableException("Xác thực cần kết nối MySQL. Hãy bật DATABASE_CONNECT_ON_START.");
  }
}
