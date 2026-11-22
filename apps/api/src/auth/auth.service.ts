import { BadRequestException, ConflictException, ForbiddenException, HttpException, HttpStatus, Injectable, Logger, NotFoundException, Optional, ServiceUnavailableException, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createHash, createHmac, randomBytes, randomInt, randomUUID, timingSafeEqual } from "node:crypto";
import { PrismaService } from "../database/prisma.service.js";
import type { Environment } from "../config/environment.js";
import { EmailDeliveryService } from "../infrastructure/email-delivery.service.js";
import { ObjectStorageService } from "../infrastructure/object-storage.service.js";
import { createMfaSecret, createTotpUri, decryptMfaSecret, encryptMfaSecret, matchTotpStep } from "./mfa.js";
import type { PermissionCode, RoleCode } from "./permissions.js";
import { dummyPasswordHash, hashPassword, verifyPassword } from "./password.js";
import { purposeKey } from "../infrastructure/purpose-key.js";
import { AntivirusService } from "../infrastructure/antivirus.service.js";
import { stripImageMetadata } from "../infrastructure/image-metadata.js";

const SESSION_COOKIE = "wind_edu_session";
const SHORT_SESSION_MS = 12 * 60 * 60 * 1000;
const LONG_SESSION_MS = 30 * 24 * 60 * 60 * 1000;
const EMAIL_TOKEN_MS = 24 * 60 * 60 * 1000;
const PASSWORD_TOKEN_MS = 30 * 60 * 1000;
const MFA_CHALLENGE_MS = 5 * 60 * 1000;
const ACCOUNT_SETUP_MS = 30 * 60 * 1000;
const EMAIL_OTP_MS = 5 * 60 * 1000;
const EMAIL_OTP_RESEND_MS = 60 * 1000;
const RECOVERY_CODE_COUNT = 10;
const MFA_MAX_FAILED_ATTEMPTS = 5;
const MFA_LOCK_MS = 15 * 60 * 1000;
const PASSWORD_RESET_COOLDOWN_MS = 60 * 1000;
const PASSWORD_RESET_MAX_PER_HOUR = 5;
// Bỏ các ký tự dễ nhầm (0/O, 1/I/L) để người dùng chép tay mã khôi phục chính xác.
const RECOVERY_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

type EmailOtpType = "ACCOUNT_SETUP_OTP" | "PASSWORD_CHANGE_OTP" | "EMAIL_CHANGE_OTP";
/** Nhân tố xác thực lại do người dùng nhập trước thao tác nhạy cảm trên tài khoản. */
export interface StepUpInput { currentPassword?: string; mfaCode?: string }

type UserWithRoles = {
  id: string; username: string; email: string | null; emailVerifiedAt: Date | null; passwordHash: string | null; displayName: string; status: string; locale: string;
  mfaSecretEncrypted: string | null; mfaEnabledAt: Date | null; avatarObjectKey: string | null; avatarMimeType: string | null; avatarUpdatedAt: Date | null;
  roles: Array<{ role: { code: string; name: string; permissions: Array<{ permission: { code: string } }> } }>;
};

export interface AuthenticatedSession {
  sessionId: string;
  user: { id: string; username: string; name: string; email: string | null; roleName: string; locale?: "vi-VN" | "en-US"; avatarUrl?: string | null };
  roleCode: RoleCode;
  permissions: PermissionCode[];
  availableRoles: Array<{ code: RoleCode; name: string }>;
}

export interface SessionContext { ipAddress?: string; userAgent?: string }
export interface AccountProfile { id: string; username: string; displayName: string; email: string | null; phone: string; timezone: string; locale: string; avatarUrl: string | null; status: string; emailVerifiedAt: string | null; mfaEnabled: boolean; mfaRecoveryCodesRemaining: number; hasPassword: boolean; createdAt: string }
export interface AccountSession { id: string; current: boolean; currentRoleCode: string; ipAddress: string; userAgent: string; createdAt: string; lastSeenAt: string; expiresAt: string }
export interface SessionIssue { token: string; csrfToken: string; maxAgeMs: number; session: AuthenticatedSession }
export interface AccountSetupRequired { requiresAccountSetup: true; setupToken: string; username: string }
export type LoginResult = SessionIssue | { requiresMfa: true; challengeToken: string } | AccountSetupRequired;
export interface RegistrationResult { verificationRequired: true; verificationId: string; email: string; verificationEmailSent: boolean }
export interface EmailOtpChallenge { challengeId: string; email: string; expiresInSeconds: number; resendAfterSeconds: number }
export interface AccountSetupInput { setupToken: string; challengeId: string; email: string; code: string; username: string; newPassword: string }

@Injectable()
/** Điều phối toàn bộ vòng đời xác thực: mật khẩu, MFA, phiên, CSRF và hồ sơ tài khoản. */
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly encryptionSecret: string;
  private readonly issuer: string;
  private readonly webOrigin: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailDeliveryService,
    private readonly objectStorage: ObjectStorageService,
    config: ConfigService<Environment, true>,
    @Optional() private readonly antivirus?: AntivirusService,
  ) {
    this.encryptionSecret = config.get("AUTH_ENCRYPTION_SECRET", { infer: true });
    this.issuer = config.get("MFA_ISSUER", { infer: true });
    this.webOrigin = config.get("WEB_ORIGIN", { infer: true }).replace(/\/$/, "");
  }

  /** Cung cấp tên cookie tập trung để controller không lặp hằng số xác thực. */
  cookieName(): string { return SESSION_COOKIE; }

  /** Kiểm tra tài khoản/mật khẩu với lỗi chung chống dò tài khoản, sau đó phát MFA, phiên hoặc phiên xác thực lần đầu. */
  async login(username: string, password: string, rememberMe = false, context: SessionContext = {}): Promise<LoginResult> {
    this.assertDatabase();
    const user = await this.loadUserByUsername(username);
    // Luôn chạy scrypt (hash giả khi không có tài khoản/mật khẩu) để thời gian phản hồi không làm lộ tài khoản tồn tại.
    const passwordValid = await verifyPassword(password, user?.passwordHash ?? await dummyPasswordHash());
    if (!user?.passwordHash || !passwordValid) throw new UnauthorizedException("Tài khoản hoặc mật khẩu không chính xác.");
    // Tài khoản được cấp bằng mật khẩu tạm phải xác thực email và đổi mật khẩu trước khi có phiên đăng nhập.
    if (user.status === "PENDING") return this.startAccountSetup(user);
    if (user.email && (user.status === "PENDING_VERIFICATION" || !user.emailVerifiedAt)) {
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

  /**
   * Xác minh TOTP và tiêu thụ thử thách trước khi phát phiên.
   * OTP email không được dùng thay TOTP vì ai chiếm được hộp thư sẽ vượt qua nhân tố thứ hai; khi mất thiết bị phải dùng mã khôi phục.
   */
  async completeMfaLogin(challengeToken: string, code: string, rememberMe = false, context: SessionContext = {}): Promise<SessionIssue> {
    const challenge = await this.validAccountToken(challengeToken, "MFA_LOGIN");
    const user = await this.loadUser(challenge.userId);
    if (!user?.mfaEnabledAt || !user.mfaSecretEncrypted) throw new UnauthorizedException("MFA không còn được bật cho tài khoản này.");
    this.assertActive(user);
    if (!(await this.verifyAccountTotp(user.id, user.mfaSecretEncrypted, code))) throw new UnauthorizedException("Mã xác thực không chính xác hoặc đã hết hạn.");
    await this.consumeAccountToken(challenge.id);
    return this.createSession(user, rememberMe, context);
  }

  /** Hoàn tất đăng nhập hai bước bằng một mã khôi phục, tiêu thụ nguyên tử cả mã lẫn thử thách rồi báo về email tài khoản. */
  async completeMfaRecoveryLogin(challengeToken: string, recoveryCode: string, rememberMe = false, context: SessionContext = {}): Promise<SessionIssue> {
    const challenge = await this.validAccountToken(challengeToken, "MFA_LOGIN");
    const user = await this.loadUser(challenge.userId);
    if (!user?.mfaEnabledAt || !user.mfaSecretEncrypted) throw new UnauthorizedException("MFA không còn được bật cho tài khoản này.");
    this.assertActive(user);
    const now = new Date();
    const remaining = await this.prisma.$transaction(async (transaction) => {
      const used = await transaction.mfaRecoveryCode.updateMany({
        where: { userId: user.id, codeHash: this.hashRecoveryCode(user.id, recoveryCode), usedAt: null },
        data: { usedAt: now },
      });
      if (used.count !== 1) throw new UnauthorizedException("Mã khôi phục không chính xác hoặc đã được sử dụng.");
      const login = await transaction.accountToken.updateMany({ where: { id: challenge.id, consumedAt: null, expiresAt: { gt: now } }, data: { consumedAt: now } });
      if (login.count !== 1) throw new UnauthorizedException("Phiên xác thực đã hết hạn hoặc đã sử dụng.");
      const left = await transaction.mfaRecoveryCode.count({ where: { userId: user.id, usedAt: null } });
      await transaction.auditLog.create({ data: { actorId: user.id, action: "MFA_RECOVERY_CODE_USED", entityType: "user", entityId: user.id, context: { remainingCodes: left } } });
      return left;
    });
    if (user.email) {
      await this.notifySecurityEvent(user.email, "Đăng nhập Wind EDU bằng mã khôi phục",
        `Tài khoản Wind EDU của bạn vừa đăng nhập bằng một mã khôi phục xác thực hai bước. Còn lại ${remaining} mã chưa dùng.\n\nNếu không phải bạn, hãy đổi mật khẩu và tạo lại mã khôi phục ngay.`,
        `mfa-recovery-used/${challenge.id}`);
    }
    return this.createSession(user, rememberMe, context);
  }

  /** Gửi hoặc gửi lại mã OTP tới email người dùng nhập; email chỉ ràng buộc vào mã, chưa ghi vào tài khoản. */
  async sendAccountSetupOtp(setupToken: string, email: string): Promise<EmailOtpChallenge> {
    this.assertDatabase();
    const setup = await this.validAccountSetup(setupToken);
    const normalizedEmail = email.trim().toLowerCase();
    // Email đã thuộc tài khoản khác: trả thử thách giả cùng dạng thay vì 409 để không dò được email đã đăng ký.
    if (await this.isEmailTakenByOther(setup.userId, normalizedEmail)) return this.decoyEmailOtpChallenge(normalizedEmail);
    return this.sendEmailOtp(setup.userId, normalizedEmail, "ACCOUNT_SETUP_OTP", "xác thực tài khoản");
  }

  /** Xác minh OTP rồi lưu cùng lúc email, tên tài khoản, mật khẩu mới và trạng thái đã xác thực. */
  async completeAccountSetup(input: AccountSetupInput): Promise<{ completed: true; username: string }> {
    this.assertDatabase();
    const setup = await this.validAccountSetup(input.setupToken);
    const email = input.email.trim().toLowerCase();
    const otp = await this.verifyEmailOtp(input.challengeId, setup.userId, email, input.code, "ACCOUNT_SETUP_OTP");

    const username = input.username.trim().toLowerCase();
    if (username !== setup.user.username && await this.prisma.user.findUnique({ where: { username }, select: { id: true } })) {
      throw new ConflictException("Tên tài khoản đã được sử dụng. Hãy chọn tên khác.");
    }
    await this.assertEmailAvailable(setup.userId, email);
    if (await verifyPassword(input.newPassword, setup.user.passwordHash)) throw new BadRequestException("Mật khẩu mới phải khác mật khẩu tạm thời.");
    const passwordHash = await hashPassword(input.newPassword);
    const now = new Date();
    try {
      await this.prisma.$transaction(async (transaction) => {
        const claimedSetup = await transaction.accountToken.updateMany({ where: { id: setup.id, consumedAt: null, expiresAt: { gt: now } }, data: { consumedAt: now } });
        if (claimedSetup.count !== 1) throw this.accountSetupExpired();
        const claimedOtp = await transaction.accountToken.updateMany({ where: { id: otp.id, consumedAt: null, expiresAt: { gt: now }, failedAttempts: { lt: 5 } }, data: { consumedAt: now } });
        if (claimedOtp.count !== 1) throw new BadRequestException("Mã OTP không còn hiệu lực. Hãy nhận mã OTP mới.");
        const updated = await transaction.user.updateMany({
          where: { id: setup.userId, status: "PENDING" },
          data: {
            username, email, emailVerifiedAt: now, passwordHash, status: "ACTIVE",
            // Họ tên mặc định lấy theo tên tài khoản lúc tạo; nếu chưa được sửa thì đổi theo tên tài khoản mới.
            ...(setup.user.displayName === setup.user.username ? { displayName: username } : {}),
          },
        });
        if (updated.count !== 1) throw new BadRequestException("Tài khoản không còn ở trạng thái chờ xác thực.");
        await transaction.accountToken.updateMany({ where: { userId: setup.userId, consumedAt: null }, data: { consumedAt: now } });
        await transaction.auditLog.create({
          data: { actorId: setup.userId, action: "ACCOUNT_SETUP_COMPLETED", entityType: "user", entityId: setup.userId, context: { previousUsername: setup.user.username, username } },
        });
      });
    } catch (error) {
      if (typeof error === "object" && error !== null && "code" in error && error.code === "P2002") {
        throw new ConflictException("Tên tài khoản hoặc email vừa được tài khoản khác sử dụng. Hãy kiểm tra lại.");
      }
      throw error;
    }
    return { completed: true, username };
  }

  /** Phát token đặt lại nếu email hợp lệ nhưng luôn trả cùng kết quả để chống liệt kê tài khoản. */
  async requestPasswordReset(email: string): Promise<{ accepted: true }> {
    const user = await this.loadUserByEmail(email);
    if (!user?.email || user.status !== "ACTIVE" || !user.passwordHash) return { accepted: true };
    // Chống bom thư và vô hiệu hóa liên tục link của nạn nhân: chờ 60 giây giữa hai lần, tối đa 5 lần/giờ/tài khoản.
    const now = Date.now();
    const [recent, hourly] = await Promise.all([
      this.prisma.accountToken.count({ where: { userId: user.id, type: "PASSWORD_RESET", createdAt: { gt: new Date(now - PASSWORD_RESET_COOLDOWN_MS) } } }),
      this.prisma.accountToken.count({ where: { userId: user.id, type: "PASSWORD_RESET", createdAt: { gt: new Date(now - 60 * 60 * 1000) } } }),
    ]);
    if (recent > 0 || hourly >= PASSWORD_RESET_MAX_PER_HOUR) return { accepted: true };
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

  /** Đặt mật khẩu mới và thu hồi toàn bộ phiên/token liên quan trong cùng giao dịch. */
  async resetPassword(token: string, newPassword: string): Promise<{ reset: true }> {
    const row = await this.validAccountToken(token, "PASSWORD_RESET");
    const user = await this.prisma.user.findUnique({ where: { id: row.userId } });
    if (!user) throw new BadRequestException("Liên kết đặt lại mật khẩu không hợp lệ.");
    if (user.passwordHash && await verifyPassword(newPassword, user.passwordHash)) throw new BadRequestException("Mật khẩu mới phải khác mật khẩu hiện tại.");
    const passwordHash = await hashPassword(newPassword);
    const now = new Date();
    await this.prisma.$transaction(async (transaction) => {
      // Tiêu thụ có điều kiện để hai request song song không cùng dùng một link đặt lại.
      const claimed = await transaction.accountToken.updateMany({ where: { id: row.id, consumedAt: null, expiresAt: { gt: now } }, data: { consumedAt: now } });
      if (claimed.count !== 1) throw new BadRequestException("Liên kết hoặc phiên xác thực không hợp lệ hay đã hết hạn.");
      await transaction.user.update({
        where: { id: row.userId },
        data: {
          passwordHash,
          status: user.status === "PENDING_VERIFICATION" ? "ACTIVE" : undefined,
          emailVerifiedAt: user.emailVerifiedAt ?? now,
        },
      });
      await transaction.authSession.updateMany({ where: { userId: row.userId, revokedAt: null }, data: { revokedAt: now } });
      await transaction.accountToken.updateMany({ where: { userId: row.userId, type: "PASSWORD_RESET", consumedAt: null }, data: { consumedAt: now } });
    });
    return { reset: true };
  }

  /** Tiêu thụ token liên kết và kích hoạt tài khoản đang chờ xác minh. */
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

  /** So sánh mã email theo constant-time, giới hạn lần sai rồi kích hoạt tài khoản một cách nguyên tử. */
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
      const consumed = await transaction.accountToken.updateMany({ where: { id: row.id, consumedAt: null, expiresAt: { gt: now }, failedAttempts: { lt: 5 } }, data: { consumedAt: now } });
      if (consumed.count !== 1) throw new BadRequestException("Mã xác minh đã được sử dụng hoặc đã hết hạn.");
      await transaction.user.update({ where: { id: row.userId }, data: { emailVerifiedAt: now } });
      await transaction.user.updateMany({ where: { id: row.userId, status: "PENDING_VERIFICATION" }, data: { status: "ACTIVE" } });
      await transaction.accountToken.updateMany({ where: { userId: row.userId, type: "EMAIL_VERIFICATION", consumedAt: null }, data: { consumedAt: now } });
    });
    return { verified: true, verificationId };
  }

  /** Trả trạng thái tối thiểu của phiên xác minh, không để lộ hồ sơ tài khoản. */
  async verificationStatus(verificationId: string): Promise<{ verified: boolean; expired: boolean }> {
    const row = await this.prisma.accountToken.findUnique({ where: { id: verificationId }, include: { user: { select: { emailVerifiedAt: true } } } });
    if (!row || row.type !== "EMAIL_VERIFICATION") throw new NotFoundException("Không tìm thấy phiên xác minh email.");
    return { verified: Boolean(row.user.emailVerifiedAt), expired: !row.user.emailVerifiedAt && row.expiresAt <= new Date() };
  }

  /** Đổi email chưa xác minh sau khi kiểm tra mật khẩu, chống trùng/race và phát phiên xác minh mới. */
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
    if (normalizedEmail === token.user.email?.toLowerCase()) {
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

    const usernameFollowsEmail = token.user.username.toLowerCase() === token.user.email?.toLowerCase();
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

  /** Gửi lại email xác minh công khai với phản hồi hạn chế nhằm tránh lộ danh tính tài khoản. */
  async resendPublicVerification(identifier: string, verificationId?: string): Promise<{ accepted: true; verificationId?: string }> {
    const normalized = identifier.trim().toLowerCase();
    const user = normalized.includes("@") ? await this.loadUserByEmail(normalized) : await this.loadUserByUsername(normalized);
    if (!user?.email || user.emailVerifiedAt || user.status !== "PENDING_VERIFICATION") return { accepted: true };
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

  /** Gửi lại xác minh cho người dùng đã có phiên và bỏ qua nếu email đã được xác minh. */
  async resendVerification(userId: string): Promise<{ sent: boolean }> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException("Không tìm thấy tài khoản.");
    if (!user.email || user.emailVerifiedAt) return { sent: false };
    return { sent: (await this.sendVerificationEmail(user.id, user.email)).sent };
  }

  /** Đọc và ánh xạ hồ sơ tài khoản sang dữ liệu an toàn cho giao diện. */
  async getProfile(userId: string): Promise<AccountProfile> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException("Không tìm thấy tài khoản.");
    return {
      id: user.id, username: user.username, displayName: user.displayName, email: user.email, phone: user.phone ?? "", timezone: user.timezone,
      locale: user.locale, avatarUrl: this.avatarUrl(user.avatarObjectKey, user.avatarUpdatedAt), status: user.status, emailVerifiedAt: user.emailVerifiedAt?.toISOString() ?? null,
      mfaEnabled: Boolean(user.mfaEnabledAt),
      mfaRecoveryCodesRemaining: user.mfaEnabledAt ? await this.prisma.mfaRecoveryCode.count({ where: { userId, usedAt: null } }) : 0,
      hasPassword: Boolean(user.passwordHash), createdAt: user.createdAt.toISOString(),
    };
  }

  /** Cập nhật trường hồ sơ cho phép (họ tên, SĐT, múi giờ, ngôn ngữ; giữ cố định username và email). */
  async updateProfile(
    userId: string,
    input: { displayName: string; phone?: string; timezone: string; locale: string },
  ): Promise<AccountProfile> {
    const current = await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!current) throw new NotFoundException("Không tìm thấy tài khoản.");

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        displayName: input.displayName.trim(),
        phone: input.phone?.trim() || null,
        timezone: input.timezone,
        locale: input.locale,
      },
    });

    return this.getProfile(userId);
  }

  /** Chuẩn hóa email mới, xác nhận tài khoản tồn tại, email khác hiện tại và (khi requireAvailable) chưa bị tài khoản khác dùng. */
  private async validateTargetNewEmail(userId: string, rawEmail: string, requireAvailable = true): Promise<{ previousEmail: string | null; nextEmail: string }> {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true, email: true } });
    if (!user) throw new NotFoundException("Không tìm thấy tài khoản.");
    const nextEmail = rawEmail.trim().toLowerCase();
    if (user.email?.toLowerCase() === nextEmail) {
      throw new BadRequestException("Email mới phải khác email hiện tại của tài khoản.");
    }
    if (requireAvailable) await this.assertEmailAvailable(userId, nextEmail);
    return { previousEmail: user.email, nextEmail };
  }

  /** Xác thực lại mật khẩu hiện tại rồi gửi mã OTP 6 chữ số tới địa chỉ email mới trước khi cập nhật tài khoản. */
  async sendEmailChangeOtp(userId: string, rawEmail: string, stepUp: StepUpInput = {}): Promise<EmailOtpChallenge> {
    await this.assertStepUp(userId, { currentPassword: stepUp.currentPassword }, false);
    const { nextEmail } = await this.validateTargetNewEmail(userId, rawEmail, false);
    // Không phản hồi 409 cho email đã thuộc tài khoản khác: trả thử thách giả, bước xác nhận sẽ không bao giờ khớp.
    if (await this.isEmailTakenByOther(userId, nextEmail)) return this.decoyEmailOtpChallenge(nextEmail);
    return this.sendEmailOtp(userId, nextEmail, "EMAIL_CHANGE_OTP", "xác minh email mới");
  }

  /**
   * Xác thực lại mật khẩu + TOTP (nếu đã bật), xác minh OTP gửi tới email mới rồi cập nhật email (giữ nguyên username).
   * Mọi phiên khác bị thu hồi và email cũ nhận cảnh báo để chủ tài khoản kịp phản ứng nếu không phải họ thao tác.
   */
  async confirmEmailChange(userId: string, challengeId: string, rawEmail: string, code: string, stepUp: StepUpInput = {}, currentSessionId?: string): Promise<AccountProfile> {
    await this.assertStepUp(userId, stepUp, true);
    const { previousEmail, nextEmail } = await this.validateTargetNewEmail(userId, rawEmail);
    const otp = await this.verifyEmailOtp(challengeId, userId, nextEmail, code, "EMAIL_CHANGE_OTP");
    const now = new Date();
    try {
      await this.prisma.$transaction(async (transaction) => {
        const claimed = await transaction.accountToken.updateMany({
          where: { id: otp.id, consumedAt: null, expiresAt: { gt: now }, failedAttempts: { lt: 5 } },
          data: { consumedAt: now },
        });
        if (claimed.count !== 1) throw new BadRequestException("Mã OTP không còn hiệu lực. Hãy nhận mã OTP mới.");
        await transaction.accountToken.updateMany({
          where: {
            userId,
            id: { not: otp.id },
            type: { in: ["EMAIL_VERIFICATION", "PASSWORD_RESET", "PASSWORD_CHANGE_OTP", "EMAIL_CHANGE_OTP", "MFA_LOGIN", "MFA_DISABLE"] },
            consumedAt: null,
          },
          data: { consumedAt: now },
        });
        await transaction.user.update({
          where: { id: userId },
          data: { email: nextEmail, emailVerifiedAt: now },
        });
        const revoked = await transaction.authSession.updateMany({
          where: { userId, revokedAt: null, ...(currentSessionId ? { id: { not: currentSessionId } } : {}) },
          data: { revokedAt: now },
        });
        await transaction.auditLog.create({
          data: {
            actorId: userId,
            action: "PROFILE_EMAIL_UPDATED",
            entityType: "user",
            entityId: userId,
            context: { previousEmail, newEmail: nextEmail, verificationMethod: "PASSWORD+EMAIL_OTP", revokedSessions: revoked.count },
          },
        });
      });
    } catch (error) {
      if (typeof error === "object" && error !== null && "code" in error && error.code === "P2002") {
        throw new ConflictException("Email này đã được liên kết với một tài khoản khác.");
      }
      throw error;
    }

    if (previousEmail) {
      await this.notifySecurityEvent(previousEmail, "Email tài khoản Wind EDU vừa được thay đổi",
        `Email đăng nhập của tài khoản Wind EDU đã được đổi sang ${this.maskEmail(nextEmail)}. Các phiên đăng nhập khác đã bị đăng xuất.\n\nNếu không phải bạn thực hiện, hãy liên hệ quản trị viên trung tâm ngay để khóa tài khoản.`,
        `email-changed/${otp.id}`);
    }
    return this.getProfile(userId);
  }

  /** Kiểm tra chữ ký ảnh, bỏ metadata Exif/GPS, quét mã độc, lưu object mới và hoàn tác object nếu cập nhật thất bại. */
  async updateAvatar(userId: string, upload: { mimeType: string; size: number; buffer: Buffer }): Promise<AccountProfile> {
    const extension = this.validateAvatar(upload);
    const current = await this.prisma.user.findUnique({ where: { id: userId }, select: { avatarObjectKey: true } });
    if (!current) throw new NotFoundException("Không tìm thấy tài khoản.");
    // Avatar được mọi người dùng trong hệ thống xem: không giữ vị trí GPS/thiết bị chụp trong Exif/XMP.
    const content = stripImageMetadata(upload.buffer, upload.mimeType);
    const scan = await this.antivirus?.scan(content);
    if (scan && !scan.clean) throw new BadRequestException("Ảnh đại diện bị từ chối vì phát hiện mã độc.");
    const stored = await this.objectStorage.put(`avatars/${userId}/${randomUUID()}.${extension}`, content);
    try {
      await this.prisma.user.update({ where: { id: userId }, data: { avatarObjectKey: stored.objectKey, avatarMimeType: upload.mimeType, avatarUpdatedAt: new Date() } });
    } catch (error) {
      await this.objectStorage.remove(stored.objectKey).catch((cleanupError: unknown) => {
        this.logger.warn(`Không thể hoàn tác avatar tải lên khi cập nhật tài khoản thất bại: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`);
      });
      throw error;
    }
    if (current.avatarObjectKey) await this.objectStorage.remove(current.avatarObjectKey).catch((error: unknown) => this.logger.warn(`Không xóa được avatar cũ: ${error instanceof Error ? error.message : String(error)}`));
    return this.getProfile(userId);
  }

  /** Gỡ avatar khỏi hồ sơ trước, sau đó dọn object cũ theo cơ chế best-effort. */
  async removeAvatar(userId: string): Promise<AccountProfile> {
    const current = await this.prisma.user.findUnique({ where: { id: userId }, select: { avatarObjectKey: true } });
    if (!current) throw new NotFoundException("Không tìm thấy tài khoản.");
    await this.prisma.user.update({ where: { id: userId }, data: { avatarObjectKey: null, avatarMimeType: null, avatarUpdatedAt: null } });
    if (current.avatarObjectKey) await this.objectStorage.remove(current.avatarObjectKey).catch((error: unknown) => this.logger.warn(`Không xóa được avatar: ${error instanceof Error ? error.message : String(error)}`));
    return this.getProfile(userId);
  }

  /** Xác định object avatar hiện tại và tải nội dung từ lớp lưu trữ. */
  async readAvatar(userId: string): Promise<{ buffer: Buffer; mimeType: string }> {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { avatarObjectKey: true, avatarMimeType: true } });
    if (!user?.avatarObjectKey || !user.avatarMimeType) throw new NotFoundException("Tài khoản chưa có ảnh đại diện.");
    return { buffer: await this.objectStorage.get(user.avatarObjectKey), mimeType: user.avatarMimeType };
  }

  /** Xác thực lại mật khẩu hiện tại rồi gửi OTP đổi mật khẩu khi email người dùng nhập khớp email đã xác thực. */
  async sendPasswordChangeOtp(userId: string, email: string, stepUp: StepUpInput = {}): Promise<EmailOtpChallenge> {
    await this.assertStepUp(userId, { currentPassword: stepUp.currentPassword }, false);
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { email: true, emailVerifiedAt: true } });
    if (!user) throw new NotFoundException("Không tìm thấy tài khoản.");
    const accountEmail = this.verifiedEmail(user);
    if (email.trim().toLowerCase() !== accountEmail) throw new BadRequestException("Email không khớp với email đã xác thực của tài khoản.");
    return this.sendEmailOtp(userId, accountEmail, "PASSWORD_CHANGE_OTP", "đổi mật khẩu");
  }

  /** Xác thực lại mật khẩu + TOTP (nếu đã bật), xác minh OTP gửi tới email tài khoản, đổi mật khẩu và thu hồi mọi phiên khác. */
  async changePassword(userId: string, currentSessionId: string, challengeId: string, code: string, newPassword: string, stepUp: StepUpInput = {}): Promise<{ revokedSessions: number }> {
    await this.assertStepUp(userId, stepUp, true);
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { email: true, emailVerifiedAt: true, passwordHash: true } });
    if (!user) throw new NotFoundException("Không tìm thấy tài khoản.");
    const otp = await this.verifyEmailOtp(challengeId, userId, this.verifiedEmail(user), code, "PASSWORD_CHANGE_OTP");
    if (user.passwordHash && await verifyPassword(newPassword, user.passwordHash)) throw new BadRequestException("Mật khẩu mới phải khác mật khẩu hiện tại.");
    const passwordHash = await hashPassword(newPassword);
    const now = new Date();
    const result = await this.prisma.$transaction(async (transaction) => {
      const claimed = await transaction.accountToken.updateMany({ where: { id: otp.id, consumedAt: null, expiresAt: { gt: now }, failedAttempts: { lt: 5 } }, data: { consumedAt: now } });
      if (claimed.count !== 1) throw new BadRequestException("Mã OTP không còn hiệu lực. Hãy nhận mã OTP mới.");
      await transaction.user.update({ where: { id: userId }, data: { passwordHash } });
      const revoked = await transaction.authSession.updateMany({ where: { userId, id: { not: currentSessionId }, revokedAt: null }, data: { revokedAt: now } });
      await transaction.auditLog.create({ data: { actorId: userId, action: "PASSWORD_CHANGED", entityType: "user", entityId: userId, context: { verificationMethod: "PASSWORD+EMAIL_OTP" } } });
      return { revokedSessions: revoked.count };
    });
    await this.notifySecurityEvent(this.verifiedEmail(user), "Mật khẩu Wind EDU vừa được thay đổi",
      "Mật khẩu tài khoản Wind EDU của bạn vừa được thay đổi và các phiên đăng nhập khác đã bị đăng xuất.\n\nNếu không phải bạn thực hiện, hãy dùng chức năng Quên mật khẩu và liên hệ quản trị viên trung tâm ngay.",
      `password-changed/${otp.id}`);
    return result;
  }

  /** Sinh bí mật TOTP mã hóa và trả URI cấu hình cho ứng dụng xác thực. */
  async startMfaSetup(userId: string): Promise<{ secret: string; otpauthUri: string }> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException("Không tìm thấy tài khoản.");
    if (user.mfaEnabledAt) throw new ConflictException("MFA đã được bật cho tài khoản.");
    this.verifiedEmail(user);
    const secret = createMfaSecret();
    const started = await this.prisma.user.updateMany({ where: { id: userId, mfaEnabledAt: null, email: user.email, emailVerifiedAt: user.emailVerifiedAt }, data: { mfaSecretEncrypted: await encryptMfaSecret(secret, this.encryptionSecret), mfaLastUsedStep: null, mfaFailedAttempts: 0, mfaLockedUntil: null } });
    if (!started.count) throw new ConflictException("Trạng thái tài khoản đã thay đổi.");
    return { secret, otpauthUri: createTotpUri(secret, user.username, this.issuer) };
  }

  /** Xác minh bí mật TOTP đang chờ, bật MFA cho tài khoản đã xác minh email và phát bộ mã khôi phục dùng một lần. */
  async confirmMfa(userId: string, code: string): Promise<{ enabled: true; recoveryCodes: string[] }> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user?.mfaSecretEncrypted) throw new BadRequestException("Hãy khởi tạo cấu hình MFA trước.");
    this.verifiedEmail(user);
    if (!(await this.verifyAccountTotp(userId, user.mfaSecretEncrypted, code))) throw new BadRequestException("Mã xác thực không chính xác.");
    const recoveryCodes = this.createRecoveryCodes();
    await this.prisma.$transaction(async (transaction) => {
      const enabled = await transaction.user.updateMany({
        where: { id: userId, email: user.email, emailVerifiedAt: user.emailVerifiedAt, mfaEnabledAt: null, mfaSecretEncrypted: user.mfaSecretEncrypted },
        data: { mfaEnabledAt: new Date() },
      });
      if (!enabled.count) throw new ConflictException("Cấu hình xác thực đã thay đổi. Hãy thử lại.");
      await this.replaceRecoveryCodes(transaction, userId, recoveryCodes);
      await transaction.auditLog.create({ data: { actorId: userId, action: "MFA_ENABLED", entityType: "user", entityId: userId, context: { recoveryCodes: recoveryCodes.length } } });
    });
    return { enabled: true, recoveryCodes };
  }

  /** Xác thực lại bằng mật khẩu + TOTP, thu hồi toàn bộ mã khôi phục cũ và phát bộ mã mới. */
  async regenerateRecoveryCodes(userId: string, stepUp: StepUpInput): Promise<{ recoveryCodes: string[] }> {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { mfaEnabledAt: true } });
    if (!user?.mfaEnabledAt) throw new BadRequestException("MFA chưa được bật.");
    await this.assertStepUp(userId, stepUp, true);
    const recoveryCodes = this.createRecoveryCodes();
    await this.prisma.$transaction(async (transaction) => {
      await this.replaceRecoveryCodes(transaction, userId, recoveryCodes);
      await transaction.auditLog.create({ data: { actorId: userId, action: "MFA_RECOVERY_CODES_REGENERATED", entityType: "user", entityId: userId, context: { recoveryCodes: recoveryCodes.length } } });
    });
    return { recoveryCodes };
  }

  /** Xác thực lại chủ tài khoản rồi phát token một lần cho bước tắt MFA. */
  async startDisableMfa(userId: string, password: string): Promise<{ challengeToken: string; expiresInSeconds: number }> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user?.mfaSecretEncrypted || !user.mfaEnabledAt) throw new BadRequestException("MFA chưa được bật.");
    if (!(await verifyPassword(password, user.passwordHash))) throw new UnauthorizedException("Mật khẩu hiện tại không chính xác.");
    return { challengeToken: await this.issueAccountToken(userId, "MFA_DISABLE", MFA_CHALLENGE_MS), expiresInSeconds: MFA_CHALLENGE_MS / 1000 };
  }

  /** Tiêu thụ token tắt MFA, xác minh TOTP và xóa bí mật. */
  async disableMfa(userId: string, challengeToken: string, code: string): Promise<{ disabled: true }> {
    const challenge = await this.validAccountToken(challengeToken, "MFA_DISABLE");
    if (challenge.userId !== userId) throw new UnauthorizedException("Phiên tắt xác thực hai bước không hợp lệ.");
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user?.mfaSecretEncrypted || !user.mfaEnabledAt) throw new BadRequestException("MFA chưa được bật.");
    if (!(await this.verifyAccountTotp(userId, user.mfaSecretEncrypted, code))) throw new UnauthorizedException("Mã xác thực không chính xác.");
    const now = new Date();
    await this.prisma.$transaction(async (transaction) => {
      const claimed = await transaction.accountToken.updateMany({ where: { id: challenge.id, consumedAt: null, expiresAt: { gt: now } }, data: { consumedAt: now } });
      if (claimed.count !== 1) throw new BadRequestException("Phiên xác thực đã được sử dụng.");
      await transaction.user.update({ where: { id: userId }, data: { mfaEnabledAt: null, mfaSecretEncrypted: null, mfaLastUsedStep: null, mfaFailedAttempts: 0, mfaLockedUntil: null } });
      await transaction.mfaRecoveryCode.deleteMany({ where: { userId } });
      await transaction.auditLog.create({ data: { actorId: userId, action: "MFA_DISABLED", entityType: "user", entityId: userId } });
    });
    return { disabled: true };
  }

  /** Liệt kê phiên còn hiệu lực và đánh dấu phiên đang gọi. */
  async listSessions(userId: string, currentSessionId: string): Promise<AccountSession[]> {
    const rows = await this.prisma.authSession.findMany({ where: { userId, revokedAt: null, expiresAt: { gt: new Date() } }, orderBy: { lastSeenAt: "desc" } });
    return rows.map((row) => ({ id: row.id, current: row.id === currentSessionId, currentRoleCode: row.currentRoleCode, ipAddress: row.ipAddress ?? "Không xác định", userAgent: row.userAgent ?? "Thiết bị không xác định", createdAt: row.createdAt.toISOString(), lastSeenAt: row.lastSeenAt.toISOString(), expiresAt: row.expiresAt.toISOString() }));
  }

  /** Thu hồi một phiên sở hữu bởi người dùng và không cho tự thu hồi phiên hiện tại qua endpoint này. */
  async revokeSession(userId: string, currentSessionId: string, sessionId: string): Promise<void> {
    if (sessionId === currentSessionId) throw new BadRequestException("Hãy dùng chức năng đăng xuất để đóng phiên hiện tại.");
    const result = await this.prisma.authSession.updateMany({ where: { id: sessionId, userId, revokedAt: null }, data: { revokedAt: new Date() } });
    if (!result.count) throw new NotFoundException("Phiên đăng nhập không còn tồn tại.");
  }

  /** Thu hồi toàn bộ phiên khác của người dùng trong một lệnh cập nhật. */
  async revokeOtherSessions(userId: string, currentSessionId: string): Promise<{ revokedSessions: number }> {
    const result = await this.prisma.authSession.updateMany({ where: { userId, id: { not: currentSessionId }, revokedAt: null }, data: { revokedAt: new Date() } });
    return { revokedSessions: result.count };
  }

  /** Băm token cookie để tìm phiên, kiểm tra hạn/trạng thái và áp dụng vai trò được yêu cầu. */
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

  /** Dẫn xuất token theo phiên bằng HMAC với khóa con riêng cho CSRF (HKDF) để mở tab mới không thu hồi token tab cũ. */
  issueCsrf(sessionId: string): Promise<string> {
    return Promise.resolve(`v3.${createHmac("sha256", purposeKey(this.encryptionSecret, "csrf")).update(`wind-edu:csrf:v3:${sessionId}`).digest("base64url")}`);
  }

  /**
   * Token v2 cũ dùng thẳng khóa chủ; chỉ còn được chấp nhận để tab đang mở không lỗi CSRF ngay sau khi nâng cấp.
   * Phiên mới luôn nhận token v3 từ issueCsrf.
   */
  private legacyCsrf(sessionId: string): string {
    return `v2.${createHmac("sha256", this.encryptionSecret).update(`wind-edu:csrf:v2:${sessionId}`).digest("base64url")}`;
  }

  /** Tính lại token CSRF dẫn xuất theo đúng phiên bản token client gửi lên. */
  private async derivedCsrf(sessionId: string, csrfToken: string): Promise<string> {
    return csrfToken.startsWith("v3.") ? this.issueCsrf(sessionId) : this.legacyCsrf(sessionId);
  }

  /**
   * Xác nhận CSRF token thuộc đúng phiên cookie và so sánh theo constant-time.
   * Khi guard trước đã khôi phục phiên từ cùng cookie, token v2 được kiểm bằng HMAC theo sessionId mà không đọc DB lần hai.
   */
  async validateCsrf(sessionToken: string, csrfToken: string | undefined, resolvedSessionId?: string): Promise<boolean> {
    if (!csrfToken) return false;
    const derived = csrfToken.startsWith("v3.") || csrfToken.startsWith("v2.");
    if (resolvedSessionId && derived) return this.matchesHash(this.hashToken(await this.derivedCsrf(resolvedSessionId, csrfToken)), csrfToken);
    const row = await this.prisma.authSession.findUnique({ where: { tokenHash: this.hashToken(sessionToken) }, select: { id: true, csrfTokenHash: true, revokedAt: true, expiresAt: true } });
    if (!row || row.revokedAt || row.expiresAt <= new Date()) return false;
    // Giữ tương thích token ngẫu nhiên cũ đến khi phiên hết hạn, không ghi đè bản băm của chúng.
    const expectedHash = derived ? this.hashToken(await this.derivedCsrf(row.id, csrfToken)) : row.csrfTokenHash;
    if (!expectedHash) return false;
    return this.matchesHash(expectedHash, csrfToken);
  }

  /** So sánh constant-time bản băm kỳ vọng với bản băm của token người dùng gửi lên. */
  private matchesHash(expectedHash: string, token: string): boolean {
    const expected = Buffer.from(expectedHash, "hex");
    const actual = Buffer.from(this.hashToken(token), "hex");
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  }

  /** Thu hồi phiên tương ứng token cookie; bỏ qua an toàn khi DB khởi động bị tắt. */
  async logout(token: string | undefined): Promise<void> {
    if (!token || !this.prisma.isStartupConnectionEnabled()) return;
    await this.prisma.authSession.updateMany({ where: { tokenHash: this.hashToken(token), revokedAt: null }, data: { revokedAt: new Date() } });
  }

  /** Trích session token từ chuỗi Cookie mà không phụ thuộc middleware cookie-parser. */
  readToken(cookieHeader?: string): string | undefined {
    return this.readCookie(cookieHeader, SESSION_COOKIE);
  }

  /** Phân tích một cookie theo tên và giải mã giá trị percent-encoded nếu có. */
  readCookie(cookieHeader: string | undefined, name: string): string | undefined {
    return cookieHeader?.split(";").map((part) => part.trim().split("=")).find(([cookieName]) => cookieName === name)?.slice(1).join("=");
  }

  /** Tạo token phiên/CSRF, lưu bản băm cùng dấu vết thiết bị rồi trả session đã ánh xạ. */
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

  /** Tải người dùng và toàn bộ vai trò/quyền cần cho xác thực theo email. */
  private loadUserByEmail(email: string): Promise<UserWithRoles | null> {
    return this.prisma.user.findUnique({ where: { email: email.trim().toLowerCase() }, include: { roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } } } });
  }

  /** Tải người dùng và ma trận quyền theo tên đăng nhập đã chuẩn hóa. */
  private loadUserByUsername(username: string): Promise<UserWithRoles | null> {
    return this.prisma.user.findUnique({ where: { username: username.trim().toLowerCase() }, include: { roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } } } });
  }

  /** Tải người dùng theo khóa chính với cùng cấu trúc vai trò dùng để tạo phiên. */
  private loadUser(userId: string): Promise<UserWithRoles | null> {
    return this.prisma.user.findUnique({ where: { id: userId }, include: { roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } } } });
  }

  /** Chỉ cấp quyền cho tài khoản ACTIVE đã xác thực; tài khoản có email phải xác minh email trước. */
  private assertActive(user: { status: string; email: string | null; emailVerifiedAt: Date | null }): void {
    if (user.status === "PENDING") throw new ForbiddenException("Tài khoản chưa được xác thực nên chưa thể đăng nhập.");
    if (user.email && (user.status === "PENDING_VERIFICATION" || !user.emailVerifiedAt)) {
      throw new ForbiddenException({ statusCode: 403, code: "EMAIL_VERIFICATION_REQUIRED", message: "Tài khoản chưa hoàn tất xác minh email. Hãy nhập mã 6 số hoặc mở liên kết đã gửi tới email của bạn.", verificationRequired: true });
    }
    if (user.status !== "ACTIVE") throw new ForbiddenException("Tài khoản đang bị khóa hoặc chưa được kích hoạt.");
  }

  /** Thay thế token xác minh cũ, lưu bản băm mã/link rồi gửi cả hai lựa chọn qua email. */
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

  /** Mở phiên xác thực lần đầu mới và hủy phiên cùng mã OTP còn dang dở của lần đăng nhập trước. */
  private async startAccountSetup(user: { id: string; username: string }): Promise<AccountSetupRequired> {
    await this.prisma.accountToken.updateMany({ where: { userId: user.id, type: "ACCOUNT_SETUP_OTP", consumedAt: null }, data: { consumedAt: new Date() } });
    const setupToken = await this.issueAccountToken(user.id, "ACCOUNT_SETUP", ACCOUNT_SETUP_MS);
    return { requiresAccountSetup: true, setupToken, username: user.username };
  }

  /** Xác nhận phiên xác thực lần đầu còn hạn và tài khoản vẫn đang chờ xác thực. */
  private async validAccountSetup(setupToken: string): Promise<{ id: string; userId: string; user: { username: string; displayName: string; passwordHash: string | null } }> {
    const row = await this.prisma.accountToken.findUnique({
      where: { tokenHash: this.hashToken(setupToken) },
      include: { user: { select: { username: true, displayName: true, passwordHash: true, status: true } } },
    });
    if (!row || row.type !== "ACCOUNT_SETUP" || row.consumedAt || row.expiresAt <= new Date() || row.user.status !== "PENDING") throw this.accountSetupExpired();
    return row;
  }

  /** Lỗi có mã riêng để giao diện đưa người dùng về đăng nhập lại khi phiên xác thực không còn hiệu lực. */
  private accountSetupExpired(): UnauthorizedException {
    return new UnauthorizedException({ statusCode: 401, code: "ACCOUNT_SETUP_EXPIRED", message: "Phiên xác thực tài khoản đã hết hạn. Hãy đăng nhập lại bằng mật khẩu tạm thời." });
  }

  /** Gửi mã OTP 6 số tới email, thay mã cũ cùng loại, có thời gian chờ gửi lại và giới hạn theo giờ. */
  private async sendEmailOtp(userId: string, email: string, type: EmailOtpType, purpose: string): Promise<EmailOtpChallenge> {
    const now = Date.now();
    const waiting = await this.prisma.accountToken.findFirst({
      where: { userId, type, consumedAt: null, createdAt: { gt: new Date(now - EMAIL_OTP_RESEND_MS) } },
      select: { id: true },
    });
    if (waiting) throw new HttpException("Vui lòng đợi một phút trước khi nhận mã OTP mới.", HttpStatus.TOO_MANY_REQUESTS);
    const recentDeliveries = await this.prisma.accountToken.count({ where: { userId, type, createdAt: { gt: new Date(now - 60 * 60 * 1000) } } });
    if (recentDeliveries >= 5) throw new HttpException("Bạn đã yêu cầu mã OTP quá nhiều lần. Hãy thử lại sau một giờ.", HttpStatus.TOO_MANY_REQUESTS);

    const challengeId = randomBytes(18).toString("hex");
    const code = randomInt(0, 1_000_000).toString().padStart(6, "0");
    await this.prisma.$transaction([
      this.prisma.accountToken.updateMany({ where: { userId, type, consumedAt: null }, data: { consumedAt: new Date(now) } }),
      // Mã OTP không có liên kết đi kèm nên token_hash chỉ là giá trị ngẫu nhiên giữ ràng buộc duy nhất của bảng.
      this.prisma.accountToken.create({ data: {
        id: challengeId, tokenHash: this.hashToken(randomBytes(32).toString("base64url")), codeHash: this.hashEmailOtp(type, challengeId, email, code),
        type, userId, expiresAt: new Date(now + EMAIL_OTP_MS),
      } }),
    ]);
    try {
      await this.email.send({
        to: email, subject: `Mã OTP ${purpose} Wind EDU`,
        text: `Mã OTP ${purpose} Wind EDU của bạn là: ${code}\n\nMã có hiệu lực trong 5 phút. Nếu bạn không yêu cầu mã này, hãy bỏ qua email.`,
        idempotencyKey: `email-otp/${challengeId}`,
      });
    } catch (error) {
      this.logger.error("Không gửi được mã OTP qua email.", error instanceof Error ? error.stack : String(error));
      await this.prisma.accountToken.updateMany({ where: { id: challengeId, consumedAt: null }, data: { consumedAt: new Date() } });
      throw new ServiceUnavailableException("Không gửi được mã OTP tới email này. Hãy kiểm tra lại email hoặc thử lại sau.");
    }
    return { challengeId, email, expiresInSeconds: EMAIL_OTP_MS / 1000, resendAfterSeconds: EMAIL_OTP_RESEND_MS / 1000 };
  }

  /** Kiểm tra mã OTP còn hiệu lực, đúng người dùng và đúng email đã nhận mã; nhập sai thì tăng bộ đếm. */
  private async verifyEmailOtp(challengeId: string, userId: string, email: string, code: string, type: EmailOtpType): Promise<{ id: string }> {
    const otp = await this.prisma.accountToken.findUnique({ where: { id: challengeId } });
    if (!otp || otp.type !== type || otp.userId !== userId || otp.consumedAt || !otp.codeHash) {
      throw new BadRequestException("Mã OTP không còn hiệu lực. Hãy nhận mã OTP mới.");
    }
    if (otp.expiresAt <= new Date()) throw new BadRequestException("Mã OTP đã hết hạn. Hãy nhận mã OTP mới.");
    if (otp.failedAttempts >= 5) throw new UnauthorizedException("Bạn đã nhập sai mã OTP quá nhiều lần. Hãy nhận mã OTP mới.");
    const expected = Buffer.from(otp.codeHash, "hex");
    const actual = Buffer.from(this.hashEmailOtp(type, otp.id, email, code), "hex");
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
      await this.prisma.accountToken.update({ where: { id: otp.id }, data: { failedAttempts: { increment: 1 } } });
      throw new UnauthorizedException("Mã OTP không chính xác.");
    }
    return { id: otp.id };
  }

  /**
   * Xác thực lại chủ tài khoản trước thao tác nhạy cảm: luôn kiểm mật khẩu hiện tại (nếu tài khoản có mật khẩu),
   * và kiểm thêm TOTP khi requireMfa và tài khoản đã bật xác thực hai bước.
   */
  private async assertStepUp(userId: string, input: StepUpInput, requireMfa: boolean): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { passwordHash: true, mfaEnabledAt: true, mfaSecretEncrypted: true } });
    if (!user) throw new NotFoundException("Không tìm thấy tài khoản.");
    if (user.passwordHash && !(await verifyPassword(input.currentPassword ?? "", user.passwordHash))) {
      throw new UnauthorizedException("Mật khẩu hiện tại không chính xác.");
    }
    if (!requireMfa || !user.mfaEnabledAt || !user.mfaSecretEncrypted) return;
    if (!input.mfaCode || !(await this.verifyAccountTotp(userId, user.mfaSecretEncrypted, input.mfaCode))) {
      throw new UnauthorizedException("Mã xác thực không chính xác hoặc đã hết hạn.");
    }
  }

  /**
   * Kiểm tra TOTP của tài khoản có chống vét cạn và phát lại: khóa 15 phút sau 5 lần sai, chỉ chấp nhận bước thời gian
   * lớn hơn bước đã dùng gần nhất (cập nhật nguyên tử để hai request song song không cùng dùng một mã).
   */
  private async verifyAccountTotp(userId: string, secretEncrypted: string, code: string): Promise<boolean> {
    const state = await this.prisma.user.findUnique({ where: { id: userId }, select: { mfaLastUsedStep: true, mfaFailedAttempts: true, mfaLockedUntil: true } });
    if (!state) throw new NotFoundException("Không tìm thấy tài khoản.");
    const now = new Date();
    if (state.mfaLockedUntil && state.mfaLockedUntil > now) {
      throw new HttpException("Bạn đã nhập sai mã xác thực quá nhiều lần. Hãy thử lại sau 15 phút.", HttpStatus.TOO_MANY_REQUESTS);
    }
    const step = matchTotpStep(await decryptMfaSecret(secretEncrypted, this.encryptionSecret), code, now.getTime());
    if (step !== null) {
      const accepted = await this.prisma.user.updateMany({
        where: { id: userId, OR: [{ mfaLastUsedStep: null }, { mfaLastUsedStep: { lt: step } }] },
        data: { mfaLastUsedStep: step, mfaFailedAttempts: 0, mfaLockedUntil: null },
      });
      if (accepted.count === 1) return true;
    }
    const failures = state.mfaFailedAttempts + 1;
    await this.prisma.user.update({
      where: { id: userId },
      data: failures >= MFA_MAX_FAILED_ATTEMPTS
        ? { mfaFailedAttempts: 0, mfaLockedUntil: new Date(now.getTime() + MFA_LOCK_MS) }
        : { mfaFailedAttempts: { increment: 1 } },
    });
    return false;
  }

  /** Email đã thuộc một tài khoản khác hay chưa (không ném lỗi để caller tự chọn phản hồi chống dò). */
  private async isEmailTakenByOther(userId: string, email: string): Promise<boolean> {
    const owner = await this.prisma.user.findUnique({ where: { email }, select: { id: true } });
    return Boolean(owner && owner.id !== userId);
  }

  /** Thử thách OTP giả cùng dạng với thử thách thật: không lưu, không gửi mail nên bước xác nhận luôn thất bại. */
  private decoyEmailOtpChallenge(email: string): EmailOtpChallenge {
    return { challengeId: randomBytes(18).toString("hex"), email, expiresInSeconds: EMAIL_OTP_MS / 1000, resendAfterSeconds: EMAIL_OTP_RESEND_MS / 1000 };
  }

  /** Sinh bộ mã khôi phục ngẫu nhiên dạng XXXXX-XXXXX từ bảng chữ cái không gây nhầm lẫn. */
  private createRecoveryCodes(): string[] {
    return Array.from({ length: RECOVERY_CODE_COUNT }, () => {
      const characters = Array.from({ length: 10 }, () => RECOVERY_CODE_ALPHABET[randomInt(0, RECOVERY_CODE_ALPHABET.length)]).join("");
      return `${characters.slice(0, 5)}-${characters.slice(5)}`;
    });
  }

  /** Xóa toàn bộ mã khôi phục cũ của người dùng và lưu bản băm của bộ mã mới trong cùng giao dịch. */
  private async replaceRecoveryCodes(transaction: Pick<PrismaService, "mfaRecoveryCode">, userId: string, codes: string[]): Promise<void> {
    await transaction.mfaRecoveryCode.deleteMany({ where: { userId } });
    await transaction.mfaRecoveryCode.createMany({ data: codes.map((code) => ({ userId, codeHash: this.hashRecoveryCode(userId, code) })) });
  }

  /** Gửi email cảnh báo bảo mật theo cơ chế best-effort; lỗi gửi chỉ ghi log để không chặn thao tác đã hoàn tất. */
  private async notifySecurityEvent(to: string, subject: string, text: string, idempotencyKey: string): Promise<void> {
    try {
      await this.email.send({ to, subject, text, idempotencyKey });
    } catch (error) {
      this.logger.error("Không gửi được email cảnh báo bảo mật.", error instanceof Error ? error.stack : String(error));
    }
  }

  /** Che phần lớn tên hộp thư khi nhắc tới email mới trong cảnh báo gửi về email cũ. */
  private maskEmail(email: string): string {
    const [local = "", domain = ""] = email.split("@");
    return `${local.slice(0, 2)}${"*".repeat(Math.max(1, local.length - 2))}@${domain}`;
  }

  /** Lấy email đã xác thực của tài khoản; chưa có thì không thể nhận OTP đổi mật khẩu. */
  private verifiedEmail(user: { email: string | null; emailVerifiedAt: Date | null }): string {
    if (!user.email || !user.emailVerifiedAt) throw new BadRequestException("Hãy xác minh email của tài khoản để tiếp tục.");
    return user.email.toLowerCase();
  }

  /** Chặn email đã thuộc tài khoản khác trước khi gửi OTP và trước khi lưu. */
  private async assertEmailAvailable(userId: string, email: string): Promise<void> {
    const owner = await this.prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (owner && owner.id !== userId) throw new ConflictException("Email này đã được liên kết với một tài khoản khác.");
  }

  /** Tìm phiên xác minh email mới nhất còn hiệu lực của người dùng. */
  private async pendingVerificationId(userId: string): Promise<string | undefined> {
    const row = await this.prisma.accountToken.findFirst({
      where: { userId, type: "EMAIL_VERIFICATION", consumedAt: null, expiresAt: { gt: new Date() } },
      select: { id: true },
      orderBy: { createdAt: "desc" },
    });
    return row?.id;
  }

  /** Vô hiệu hóa token cũ cùng loại và phát token tài khoản mới chỉ lưu dưới dạng băm. */
  private async issueAccountToken(userId: string, type: "PASSWORD_RESET" | "MFA_LOGIN" | "MFA_DISABLE" | "ACCOUNT_SETUP", ttlMs: number): Promise<string> {
    const token = randomBytes(48).toString("base64url");
    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.accountToken.updateMany({ where: { userId, type, consumedAt: null }, data: { consumedAt: now } }),
      this.prisma.accountToken.create({ data: { tokenHash: this.hashToken(token), type, userId, expiresAt: new Date(now.getTime() + ttlMs) } }),
    ]);
    return token;
  }

  /** Xác thực loại, hạn và trạng thái chưa tiêu thụ của token tài khoản. */
  private async validAccountToken(token: string, type: "EMAIL_VERIFICATION" | "PASSWORD_RESET" | "MFA_LOGIN" | "MFA_DISABLE"): Promise<{ id: string; userId: string }> {
    const row = await this.prisma.accountToken.findUnique({ where: { tokenHash: this.hashToken(token) } });
    if (!row || row.type !== type || row.consumedAt || row.expiresAt <= new Date()) throw new BadRequestException("Liên kết hoặc phiên xác thực không hợp lệ hay đã hết hạn.");
    return { id: row.id, userId: row.userId };
  }

  /** Đánh dấu token đã dùng bằng cập nhật có điều kiện để chống sử dụng lặp/race. */
  private async consumeAccountToken(id: string): Promise<void> {
    const result = await this.prisma.accountToken.updateMany({ where: { id, consumedAt: null }, data: { consumedAt: new Date() } });
    if (!result.count) throw new BadRequestException("Phiên xác thực đã được sử dụng.");
  }

  /** Chuyển user/role từ Prisma thành phiên công khai và kiểm tra vai trò vẫn thuộc người dùng. */
  private mapSession(sessionId: string, user: UserWithRoles, roleCode: RoleCode): AuthenticatedSession {
    const selected = user.roles.find(({ role }) => role.code === roleCode)?.role;
    if (!selected) throw new ForbiddenException("Vai trò của phiên không còn hợp lệ.");
    return {
      sessionId,
      user: { id: user.id, username: user.username, name: user.displayName, email: user.email, roleName: selected.name, locale: user.locale as "vi-VN" | "en-US", avatarUrl: this.avatarUrl(user.avatarObjectKey, user.avatarUpdatedAt) },
      roleCode,
      permissions: selected.permissions.map(({ permission }) => permission.code as PermissionCode),
      availableRoles: user.roles.map(({ role }) => ({ code: role.code as RoleCode, name: role.name })),
    };
  }

  /** Băm token bí mật trước khi dùng làm khóa tra cứu trong cơ sở dữ liệu. */
  private hashToken(token: string): string { return createHash("sha256").update(token).digest("hex"); }
  /** Tạo URL avatar có cache-buster theo lần cập nhật gần nhất. */
  private avatarUrl(objectKey: string | null, updatedAt: Date | null): string | null {
    if (!objectKey) return null;
    const v = updatedAt?.getTime() ?? 0;
    return `/account/avatar?v=${v}`;
  }
  /** Đối chiếu kích thước, MIME và magic bytes để không tin riêng metadata upload. */
  private validateAvatar(upload: { mimeType: string; size: number; buffer: Buffer }): "png" | "jpg" | "webp" {
    if (upload.size !== upload.buffer.length || upload.size < 1 || upload.size > 3 * 1024 * 1024) throw new BadRequestException("Ảnh đại diện phải có kích thước từ 1 byte đến 3 MB.");
    const png = upload.mimeType === "image/png" && upload.buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    const jpeg = upload.mimeType === "image/jpeg" && upload.buffer[0] === 0xff && upload.buffer[1] === 0xd8 && upload.buffer[2] === 0xff;
    const webp = upload.mimeType === "image/webp" && upload.buffer.subarray(0, 4).toString("ascii") === "RIFF" && upload.buffer.subarray(8, 12).toString("ascii") === "WEBP";
    if (!png && !jpeg && !webp) throw new BadRequestException("Chỉ chấp nhận ảnh PNG, JPEG hoặc WebP hợp lệ.");
    return png ? "png" : jpeg ? "jpg" : "webp";
  }
  /** Ràng buộc mã xác minh với verificationId bằng HMAC trước khi lưu/so sánh. */
  private hashVerificationCode(verificationId: string, code: string): string { return createHmac("sha256", purposeKey(this.encryptionSecret, "email-verification")).update(`${verificationId}:${code}`).digest("hex"); }
  /** Ràng buộc mã OTP với loại mã, challenge và email đã nhận mã, nhờ vậy không phải lưu email trước khi xác thực xong. */
  private hashEmailOtp(type: EmailOtpType, challengeId: string, email: string, code: string): string { return createHmac("sha256", purposeKey(this.encryptionSecret, "email-otp")).update(`${type}:${challengeId}:${email}:${code}`).digest("hex"); }
  /** Băm mã khôi phục đã chuẩn hóa bằng HMAC gắn với userId để bản băm lộ ra không dùng được cho tài khoản khác. */
  private hashRecoveryCode(userId: string, code: string): string {
    const normalized = code.toUpperCase().replace(/[^A-Z0-9]/g, "");
    return createHmac("sha256", purposeKey(this.encryptionSecret, "mfa-recovery")).update(`mfa-recovery:${userId}:${normalized}`).digest("hex");
  }
  /** Chặn nghiệp vụ xác thực khi cấu hình chủ động không kết nối cơ sở dữ liệu. */
  private assertDatabase(): void {
    if (!this.prisma.isStartupConnectionEnabled()) throw new ServiceUnavailableException("Xác thực cần kết nối PostgreSQL. Hãy bật DATABASE_CONNECT_ON_START.");
  }
}
