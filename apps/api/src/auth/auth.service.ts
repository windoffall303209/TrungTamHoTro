import { BadRequestException, ConflictException, ForbiddenException, HttpException, HttpStatus, Injectable, Logger, NotFoundException, ServiceUnavailableException, UnauthorizedException } from "@nestjs/common";
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
const SHORT_SESSION_MS = 12 * 60 * 60 * 1000;
const LONG_SESSION_MS = 30 * 24 * 60 * 60 * 1000;
const EMAIL_TOKEN_MS = 24 * 60 * 60 * 1000;
const PASSWORD_TOKEN_MS = 30 * 60 * 1000;
const MFA_CHALLENGE_MS = 5 * 60 * 1000;

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
export interface AccountProfile { id: string; username: string; displayName: string; email: string | null; phone: string; timezone: string; locale: string; avatarUrl: string | null; status: string; emailVerifiedAt: string | null; mfaEnabled: boolean; hasPassword: boolean; createdAt: string }
export interface AccountSession { id: string; current: boolean; currentRoleCode: string; ipAddress: string; userAgent: string; createdAt: string; lastSeenAt: string; expiresAt: string }
export interface SessionIssue { token: string; csrfToken: string; maxAgeMs: number; session: AuthenticatedSession }
export type LoginResult = SessionIssue | { requiresMfa: true; challengeToken: string };
export interface RegistrationResult { verificationRequired: true; verificationId: string; email: string; verificationEmailSent: boolean }

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
  ) {
    this.encryptionSecret = config.get("AUTH_ENCRYPTION_SECRET", { infer: true });
    this.issuer = config.get("MFA_ISSUER", { infer: true });
    this.webOrigin = config.get("WEB_ORIGIN", { infer: true }).replace(/\/$/, "");
  }

  /** Cung cấp tên cookie tập trung để controller không lặp hằng số xác thực. */
  cookieName(): string { return SESSION_COOKIE; }

  /** Kiểm tra tài khoản/mật khẩu với lỗi chung chống dò tài khoản, sau đó phát MFA hoặc phiên. */
  async login(username: string, password: string, rememberMe = false, context: SessionContext = {}): Promise<LoginResult> {
    this.assertDatabase();
    const user = await this.loadUserByUsername(username);
    if (!user || !(await verifyPassword(password, user.passwordHash))) throw new UnauthorizedException("Tài khoản hoặc mật khẩu không chính xác.");
    // Tài khoản chưa xác thực bị chặn ở assertActive; chỉ tài khoản có email mới đi luồng xác minh email.
    if (user.status !== "PENDING" && user.email && (user.status === "PENDING_VERIFICATION" || !user.emailVerifiedAt)) {
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

  /** Tiêu thụ thử thách đăng nhập và xác minh TOTP hoặc mã khôi phục một lần trước khi tạo phiên. */
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
      const secret = await decryptMfaSecret(user.mfaSecretEncrypted, this.encryptionSecret);
      if (!verifyTotp(secret, code)) throw new UnauthorizedException("Mã xác thực không chính xác hoặc đã hết hạn.");
    }
    await this.consumeAccountToken(challenge.id);
    return this.createSession(user, rememberMe, context);
  }

  /** Phát token đặt lại nếu email hợp lệ nhưng luôn trả cùng kết quả để chống liệt kê tài khoản. */
  async requestPasswordReset(email: string): Promise<{ accepted: true }> {
    const user = await this.loadUserByEmail(email);
    if (!user?.email || user.status !== "ACTIVE" || !user.passwordHash) return { accepted: true };
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
    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.accountToken.update({ where: { id: row.id }, data: { consumedAt: now } }),
      this.prisma.user.update({
        where: { id: row.userId },
        data: {
          passwordHash: await hashPassword(newPassword),
          status: user.status === "PENDING_VERIFICATION" ? "ACTIVE" : undefined,
          emailVerifiedAt: user.emailVerifiedAt ?? now,
        },
      }),
      this.prisma.authSession.updateMany({ where: { userId: row.userId, revokedAt: null }, data: { revokedAt: now } }),
      this.prisma.accountToken.updateMany({ where: { userId: row.userId, type: "PASSWORD_RESET", consumedAt: null }, data: { consumedAt: now } }),
    ]);
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
      const consumed = await transaction.accountToken.updateMany({ where: { id: row.id, consumedAt: null, expiresAt: { gt: now } }, data: { consumedAt: now } });
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
      mfaEnabled: Boolean(user.mfaEnabledAt), hasPassword: Boolean(user.passwordHash), createdAt: user.createdAt.toISOString(),
    };
  }

  /** Cập nhật trường hồ sơ cho phép rồi đọc lại view model nhất quán. */
  async updateProfile(userId: string, input: { displayName: string; phone?: string; timezone: string; locale: string }): Promise<AccountProfile> {
    await this.prisma.user.update({ where: { id: userId }, data: { displayName: input.displayName.trim(), phone: input.phone?.trim() || null, timezone: input.timezone, locale: input.locale } });
    return this.getProfile(userId);
  }

  /** Kiểm tra chữ ký ảnh, lưu object mới, cập nhật DB và hoàn tác object nếu cập nhật thất bại. */
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

  /** Xác thực mật khẩu hiện tại, đổi mật khẩu và thu hồi mọi phiên khác. */
  async changePassword(userId: string, currentSessionId: string, currentPassword: string, newPassword: string): Promise<{ revokedSessions: number }> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException("Không tìm thấy tài khoản.");
    if (user.passwordHash && await verifyPassword(newPassword, user.passwordHash)) throw new BadRequestException("Mật khẩu mới phải khác mật khẩu hiện tại.");
    if (!(await verifyPassword(currentPassword, user.passwordHash))) throw new UnauthorizedException("Mật khẩu hiện tại không chính xác.");
    const now = new Date();
    const [, revoked] = await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: userId }, data: { passwordHash: await hashPassword(newPassword) } }),
      this.prisma.authSession.updateMany({ where: { userId, id: { not: currentSessionId }, revokedAt: null }, data: { revokedAt: now } }),
      this.prisma.auditLog.create({ data: { actorId: userId, action: "PASSWORD_CHANGED", entityType: "user", entityId: userId, context: { verificationMethod: "CURRENT_PASSWORD" } } }),
    ]);
    return { revokedSessions: revoked.count };
  }

  /** Sinh bí mật TOTP mã hóa và trả URI cấu hình cho ứng dụng xác thực. */
  async startMfaSetup(userId: string): Promise<{ secret: string; otpauthUri: string }> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException("Không tìm thấy tài khoản.");
    if (user.mfaEnabledAt) throw new ConflictException("MFA đã được bật cho tài khoản.");
    const secret = createMfaSecret();
    await this.prisma.user.update({ where: { id: userId }, data: { mfaSecretEncrypted: await encryptMfaSecret(secret, this.encryptionSecret) } });
    return { secret, otpauthUri: createTotpUri(secret, user.username, this.issuer) };
  }

  /** Xác minh bí mật TOTP đang chờ, bật MFA và lưu bản băm mã khôi phục. */
  async confirmMfa(userId: string, code: string): Promise<{ recoveryCodes: string[] }> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user?.mfaSecretEncrypted) throw new BadRequestException("Hãy khởi tạo cấu hình MFA trước.");
    if (!verifyTotp(await decryptMfaSecret(user.mfaSecretEncrypted, this.encryptionSecret), code)) throw new BadRequestException("Mã xác thực không chính xác.");
    const recoveryCodes = createRecoveryCodes();
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: userId }, data: { mfaEnabledAt: new Date() } }),
      this.prisma.mfaRecoveryCode.deleteMany({ where: { userId } }),
      this.prisma.mfaRecoveryCode.createMany({ data: recoveryCodes.map((value) => ({ userId, codeHash: this.hashToken(value) })) }),
    ]);
    return { recoveryCodes };
  }

  /** Xác thực lại chủ tài khoản rồi phát token một lần cho bước tắt MFA. */
  async startDisableMfa(userId: string, password: string): Promise<{ challengeToken: string; expiresInSeconds: number }> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user?.mfaSecretEncrypted || !user.mfaEnabledAt) throw new BadRequestException("MFA chưa được bật.");
    if (!(await verifyPassword(password, user.passwordHash))) throw new UnauthorizedException("Mật khẩu hiện tại không chính xác.");
    return { challengeToken: await this.issueAccountToken(userId, "MFA_DISABLE", MFA_CHALLENGE_MS), expiresInSeconds: MFA_CHALLENGE_MS / 1000 };
  }

  /** Tiêu thụ token tắt MFA, xác minh TOTP và xóa bí mật cùng mã khôi phục. */
  async disableMfa(userId: string, challengeToken: string, code: string): Promise<{ disabled: true }> {
    const challenge = await this.validAccountToken(challengeToken, "MFA_DISABLE");
    if (challenge.userId !== userId) throw new UnauthorizedException("Phiên tắt xác thực hai bước không hợp lệ.");
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user?.mfaSecretEncrypted || !user.mfaEnabledAt) throw new BadRequestException("MFA chưa được bật.");
    if (!verifyTotp(await decryptMfaSecret(user.mfaSecretEncrypted, this.encryptionSecret), code)) throw new UnauthorizedException("Mã xác thực không chính xác.");
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: userId }, data: { mfaEnabledAt: null, mfaSecretEncrypted: null } }),
      this.prisma.mfaRecoveryCode.deleteMany({ where: { userId } }),
      this.prisma.accountToken.update({ where: { id: challenge.id }, data: { consumedAt: new Date() } }),
    ]);
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

  /** Dẫn xuất token theo phiên bằng HMAC để việc mở tab mới không thu hồi token của tab cũ. */
  issueCsrf(sessionId: string): Promise<string> {
    return Promise.resolve(`v2.${createHmac("sha256", this.encryptionSecret).update(`wind-edu:csrf:v2:${sessionId}`).digest("base64url")}`);
  }

  /** Xác nhận CSRF token thuộc đúng phiên cookie và so sánh theo constant-time. */
  async validateCsrf(sessionToken: string, csrfToken: string | undefined): Promise<boolean> {
    if (!csrfToken) return false;
    const row = await this.prisma.authSession.findUnique({ where: { tokenHash: this.hashToken(sessionToken) }, select: { id: true, csrfTokenHash: true, revokedAt: true, expiresAt: true } });
    if (!row || row.revokedAt || row.expiresAt <= new Date()) return false;
    // Giữ tương thích token ngẫu nhiên cũ đến khi phiên hết hạn, không ghi đè bản băm của chúng.
    const expectedHash = csrfToken.startsWith("v2.") ? this.hashToken(await this.issueCsrf(row.id)) : row.csrfTokenHash;
    if (!expectedHash) return false;
    const expected = Buffer.from(expectedHash, "hex");
    const actual = Buffer.from(this.hashToken(csrfToken), "hex");
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
  private async issueAccountToken(userId: string, type: "PASSWORD_RESET" | "MFA_LOGIN" | "MFA_DISABLE", ttlMs: number): Promise<string> {
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
  private avatarUrl(objectKey: string | null, updatedAt: Date | null): string | null { return objectKey ? `/account/avatar?v=${updatedAt?.getTime() ?? 0}` : null; }
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
  private hashVerificationCode(verificationId: string, code: string): string { return createHmac("sha256", this.encryptionSecret).update(`${verificationId}:${code}`).digest("hex"); }
  /** Chặn nghiệp vụ xác thực khi cấu hình chủ động không kết nối cơ sở dữ liệu. */
  private assertDatabase(): void {
    if (!this.prisma.isStartupConnectionEnabled()) throw new ServiceUnavailableException("Xác thực cần kết nối PostgreSQL. Hãy bật DATABASE_CONNECT_ON_START.");
  }
}
