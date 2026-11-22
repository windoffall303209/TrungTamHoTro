import { BadRequestException, Body, Controller, Delete, Get, Header, Headers, HttpCode, Param, Patch, Post, Query, Req, Res, StreamableFile, UploadedFile, UseInterceptors } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { FileInterceptor } from "@nestjs/platform-express";
import type { Request, Response } from "express";
import { AuthService, type AuthenticatedSession } from "./auth.service.js";
import { AuthRateLimit } from "./auth-rate-limit.js";
import { AccountSetupOtpDto, ChangePasswordDto, ChangeVerificationEmailDto, CompleteAccountSetupDto, ConfirmEmailChangeDto, DisableMfaDto, DisableMfaPasswordDto, EmailChangeOtpDto, ForgotPasswordDto, LoginDto, MfaCodeDto, MfaLoginDto, MfaRecoveryLoginDto, PasswordChangeOtpDto, RegenerateRecoveryCodesDto, ResendVerificationDto, ResetPasswordDto, UpdateProfileDto, VerificationStatusDto, VerifyEmailCodeDto, VerifyEmailDto } from "./auth.dto.js";
import { USER_FILE_CSP } from "../infrastructure/file-signature.js";
import { AllowDuringMaintenance } from "../domains/system/operations/allow-during-maintenance.decorator.js";

@ApiTags("Authentication")
@Controller("auth")
/** Chuyển các luồng đăng nhập công khai thành cookie phiên an toàn và phản hồi cho web. */
export class SessionController {
  constructor(private readonly auth: AuthService) {}

  @Post("login") @AllowDuringMaintenance()
  @AuthRateLimit()
  @HttpCode(200)
  @ApiOperation({ summary: "Đăng nhập bằng tên tài khoản và mật khẩu" })
  /** Xác thực mật khẩu; nếu không cần MFA hay xác thực tài khoản tạm thì phát cookie phiên và CSRF token. */
  async login(@Body() input: LoginDto, @Req() request: Request, @Res({ passthrough: true }) response: Response): Promise<object> {
    const result = await this.auth.login(input.username, input.password, input.rememberMe, this.context(request));
    if ("requiresMfa" in result || "requiresAccountSetup" in result) return result;
    this.setSessionCookie(response, result.token, result.maxAgeMs);
    return { ...result.session, csrfToken: result.csrfToken };
  }

  @Post("account-setup/otp")
  @AuthRateLimit()
  @HttpCode(200)
  /** Gửi hoặc gửi lại mã OTP tới email người dùng nhập ở trang xác thực tài khoản. */
  sendAccountSetupOtp(@Body() input: AccountSetupOtpDto): Promise<object> {
    return this.auth.sendAccountSetupOtp(input.setupToken, input.email);
  }

  @Post("account-setup/complete")
  @AuthRateLimit()
  @HttpCode(200)
  /** Hoàn tất xác thực tài khoản tạm bằng mã OTP, tên tài khoản và mật khẩu mới. */
  completeAccountSetup(@Body() input: CompleteAccountSetupDto): Promise<object> {
    return this.auth.completeAccountSetup(input);
  }

  @Post("mfa/verify") @AllowDuringMaintenance()
  @AuthRateLimit()
  @HttpCode(200)
  /** Hoàn tất bước TOTP sau đăng nhập mật khẩu và phát phiên đăng nhập. */
  async verifyMfa(@Body() input: MfaLoginDto, @Req() request: Request, @Res({ passthrough: true }) response: Response): Promise<object> {
    const result = await this.auth.completeMfaLogin(input.challengeToken, input.code, input.rememberMe, this.context(request));
    this.setSessionCookie(response, result.token, result.maxAgeMs);
    return { ...result.session, csrfToken: result.csrfToken };
  }

  @Post("mfa/recovery") @AllowDuringMaintenance()
  @AuthRateLimit()
  @HttpCode(200)
  /** Hoàn tất đăng nhập hai bước bằng một mã khôi phục dùng một lần khi không truy cập được ứng dụng xác thực. */
  async verifyMfaRecovery(@Body() input: MfaRecoveryLoginDto, @Req() request: Request, @Res({ passthrough: true }) response: Response): Promise<object> {
    const result = await this.auth.completeMfaRecoveryLogin(input.challengeToken, input.recoveryCode, input.rememberMe, this.context(request));
    this.setSessionCookie(response, result.token, result.maxAgeMs);
    return { ...result.session, csrfToken: result.csrfToken };
  }

  @Post("forgot-password") @AllowDuringMaintenance()
  @AuthRateLimit()
  @HttpCode(202)
  /** Yêu cầu email đặt lại mật khẩu nhưng luôn trả accepted để tránh lộ tài khoản tồn tại. */
  requestPasswordReset(@Body() input: ForgotPasswordDto): Promise<{ accepted: true }> {
    return this.auth.requestPasswordReset(input.email);
  }

  @Post("reset-password") @AllowDuringMaintenance()
  @AuthRateLimit()
  /** Tiêu thụ token đặt lại và chuyển mật khẩu mới cho AuthService. */
  resetPassword(@Body() input: ResetPasswordDto): Promise<{ reset: true }> {
    return this.auth.resetPassword(input.token, input.newPassword);
  }

  @Post("verify-email")
  /** Xác minh email bằng token trong liên kết gửi qua thư. */
  verifyEmail(@Body() input: VerifyEmailDto): Promise<{ verified: true; verificationId: string }> {
    return this.auth.verifyEmail(input.token);
  }

  @Post("verify-email/code")
  @AuthRateLimit()
  /** Xác minh email bằng mã sáu chữ số gắn với verificationId. */
  verifyEmailCode(@Body() input: VerifyEmailCodeDto): Promise<{ verified: true; verificationId: string }> {
    return this.auth.verifyEmailCode(input.verificationId, input.code);
  }

  @Post("verification-email/resend")
  @AuthRateLimit()
  @HttpCode(202)
  /** Gửi lại xác minh theo luồng công khai mà không tiết lộ trạng thái tài khoản. */
  resendPublicVerification(@Body() input: ResendVerificationDto): Promise<{ accepted: true; verificationId?: string }> {
    return this.auth.resendPublicVerification(input.identifier, input.verificationId);
  }

  @Post("verification-email/change")
  @AuthRateLimit()
  @HttpCode(200)
  /** Đổi email của tài khoản chưa xác minh sau khi kiểm tra mật khẩu và phiên xác minh. */
  changeVerificationEmail(@Body() input: ChangeVerificationEmailDto): Promise<object> {
    return this.auth.changePendingVerificationEmail(input.verificationId, input.password, input.newEmail);
  }

  @Get("verification-status")
  /** Tra cứu trạng thái phiên xác minh để giao diện điều hướng người dùng. */
  verificationStatus(@Query() input: VerificationStatusDto): Promise<{ verified: boolean; expired: boolean }> {
    return this.auth.verificationStatus(input.verificationId);
  }

  @Get("session")
  @ApiOperation({ summary: "Lấy phiên đăng nhập hiện tại" })
  /** Khôi phục phiên và cấp CSRF token mới cho ứng dụng web. */
  async getSession(@Headers("cookie") cookies?: string, @Headers("x-role-code") roleCode?: string): Promise<object> {
    const session = await this.auth.resolve(this.auth.readToken(cookies), roleCode, true);
    return { ...session, csrfToken: await this.auth.issueCsrf(session.sessionId) };
  }

  @Post("logout") @AllowDuringMaintenance()
  @HttpCode(204)
  @ApiOperation({ summary: "Đăng xuất và thu hồi phiên" })
  /** Thu hồi session phía máy chủ và xóa cookie trên trình duyệt. */
  async logout(@Headers("cookie") cookies: string | undefined, @Res({ passthrough: true }) response: Response): Promise<void> {
    await this.auth.logout(this.auth.readToken(cookies));
    // Thuộc tính phải khớp lúc đặt cookie (kể cả Secure) thì trình duyệt mới xóa đúng cookie phiên.
    response.clearCookie(this.auth.cookieName(), { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/" });
  }

  /** Ghi session token vào cookie HttpOnly, chỉ bật Secure trong môi trường production. */
  private setSessionCookie(response: Response, token: string, maxAge: number): void {
    response.cookie(this.auth.cookieName(), token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge,
    });
  }

  /** Trích IP và user-agent để lưu dấu vết phiên/audit mà không truyền toàn bộ request vào service. */
  private context(request: Request): { ipAddress?: string; userAgent?: string } {
    return { ipAddress: request.ip, userAgent: request.header("user-agent") ?? undefined };
  }
}

@ApiTags("Account")
@Controller("account")
/** Cung cấp các thao tác tài khoản yêu cầu phiên hợp lệ: hồ sơ, avatar, mật khẩu, MFA và thiết bị. */
export class AccountController {
  constructor(private readonly auth: AuthService) {}

  @Get("avatar")
  @Header("Content-Security-Policy", USER_FILE_CSP)
  @Header("Cross-Origin-Resource-Policy", "cross-origin")
  @Header("Cache-Control", "private, max-age=86400, stale-while-revalidate=604800")
  /** Đọc ảnh đại diện từ object storage và stream đúng MIME để trình duyệt hiển thị nội tuyến. */
  async avatar(@Headers("cookie") cookies?: string): Promise<StreamableFile> {
    const session = await this.session(cookies);
    const avatar = await this.auth.readAvatar(session.user.id);
    return new StreamableFile(avatar.buffer, { type: avatar.mimeType, disposition: "inline", length: avatar.buffer.length });
  }

  @Get("users/:id/avatar")
  @Header("Content-Security-Policy", USER_FILE_CSP)
  @Header("Cross-Origin-Resource-Policy", "cross-origin")
  @Header("Cache-Control", "private, max-age=86400, stale-while-revalidate=604800")
  /** Cho phép tải ảnh đại diện công khai của người dùng trong hệ thống mà không phụ thuộc phiên hiện tại. */
  async userAvatar(@Param("id") id: string, @Headers("cookie") cookies?: string): Promise<StreamableFile> {
    // Chỉ người đã đăng nhập mới xem avatar của người khác; proxy/CDN dùng chung không được cache (private).
    await this.session(cookies);
    const avatar = await this.auth.readAvatar(id);
    return new StreamableFile(avatar.buffer, { type: avatar.mimeType, disposition: "inline", length: avatar.buffer.length });
  }

  @Post("avatar")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: 3 * 1024 * 1024, files: 1 } }))
  /** Nhận duy nhất một ảnh tối đa 3 MB rồi giao AuthService kiểm tra chữ ký tệp và lưu trữ. */
  async updateAvatar(@Headers("cookie") cookies: string | undefined, @UploadedFile() file?: { mimetype: string; size: number; buffer: Buffer }): Promise<object> {
    if (!file) throw new BadRequestException("Hãy chọn một ảnh đại diện.");
    const session = await this.session(cookies);
    return this.auth.updateAvatar(session.user.id, { mimeType: file.mimetype, size: file.size, buffer: file.buffer });
  }

  @Delete("avatar")
  /** Xóa liên kết avatar khỏi hồ sơ và dọn object cũ theo cơ chế best-effort. */
  async removeAvatar(@Headers("cookie") cookies?: string): Promise<object> {
    const session = await this.session(cookies);
    return this.auth.removeAvatar(session.user.id);
  }

  @Get("profile")
  /** Trả hồ sơ chi tiết của chính người dùng đang đăng nhập. */
  async profile(@Headers("cookie") cookies?: string): Promise<object> {
    const session = await this.session(cookies);
    return this.auth.getProfile(session.user.id);
  }

  @Patch("profile")
  /** Cập nhật các trường hồ sơ đã được DTO giới hạn. */
  async updateProfile(@Headers("cookie") cookies: string | undefined, @Body() input: UpdateProfileDto): Promise<object> {
    const session = await this.session(cookies);
    return this.auth.updateProfile(session.user.id, input);
  }

  @Post("email/otp")
  @HttpCode(200)
  /** Xác thực lại mật khẩu hiện tại rồi gửi mã OTP 6 chữ số tới địa chỉ email mới trước khi cập nhật tài khoản. */
  async sendEmailChangeOtp(@Headers("cookie") cookies: string | undefined, @Body() input: EmailChangeOtpDto): Promise<object> {
    const session = await this.session(cookies);
    return this.auth.sendEmailChangeOtp(session.user.id, input.email, { currentPassword: input.currentPassword });
  }

  @Patch("email")
  /** Xác thực lại mật khẩu + TOTP, xác minh mã OTP và cập nhật email mới; các phiên khác bị đăng xuất. */
  async confirmEmailChange(@Headers("cookie") cookies: string | undefined, @Body() input: ConfirmEmailChangeDto): Promise<object> {
    const session = await this.session(cookies);
    return this.auth.confirmEmailChange(session.user.id, input.challengeId, input.email, input.code, { currentPassword: input.currentPassword, mfaCode: input.mfaCode }, session.sessionId);
  }

  @Post("password/otp")
  @HttpCode(200)
  /** Xác thực lại mật khẩu hiện tại rồi gửi mã OTP đổi mật khẩu tới email đã xác thực của tài khoản. */
  async sendPasswordChangeOtp(@Headers("cookie") cookies: string | undefined, @Body() input: PasswordChangeOtpDto): Promise<object> {
    const session = await this.session(cookies);
    return this.auth.sendPasswordChangeOtp(session.user.id, input.email, { currentPassword: input.currentPassword });
  }

  @Patch("password")
  /** Đổi mật khẩu sau khi xác thực lại mật khẩu + TOTP và mã OTP email; giữ lại phiên đang thao tác. */
  async changePassword(@Headers("cookie") cookies: string | undefined, @Body() input: ChangePasswordDto): Promise<object> {
    const session = await this.session(cookies);
    return this.auth.changePassword(session.user.id, session.sessionId, input.challengeId, input.code, input.newPassword, { currentPassword: input.currentPassword, mfaCode: input.mfaCode });
  }

  @Get("sessions")
  /** Liệt kê thiết bị đăng nhập và đánh dấu phiên hiện tại cho giao diện. */
  async sessions(@Headers("cookie") cookies?: string): Promise<object> {
    const session = await this.session(cookies);
    return this.auth.listSessions(session.user.id, session.sessionId);
  }

  @Delete("sessions/:sessionId")
  @HttpCode(204)
  /** Thu hồi một phiên thuộc chính người dùng, ngoại trừ phiên đang thao tác. */
  async revoke(@Headers("cookie") cookies: string | undefined, @Param("sessionId") sessionId: string): Promise<void> {
    const session = await this.session(cookies);
    await this.auth.revokeSession(session.user.id, session.sessionId, sessionId);
  }

  @Post("sessions/revoke-others")
  /** Thu hồi toàn bộ thiết bị khác nhưng giữ nguyên phiên hiện tại. */
  async revokeOthers(@Headers("cookie") cookies?: string): Promise<object> {
    const session = await this.session(cookies);
    return this.auth.revokeOtherSessions(session.user.id, session.sessionId);
  }

  @Post("verification-email")
  /** Gửi lại email xác minh cho tài khoản đang đăng nhập. */
  resendVerification(@Headers("cookie") cookies?: string): Promise<{ sent: boolean }> {
    return this.session(cookies).then((session) => this.auth.resendVerification(session.user.id));
  }

  @Post("mfa/setup")
  /** Tạo bí mật và URI TOTP để người dùng quét bằng ứng dụng xác thực. */
  async setupMfa(@Headers("cookie") cookies?: string): Promise<{ secret: string; otpauthUri: string }> {
    const session = await this.session(cookies);
    return this.auth.startMfaSetup(session.user.id);
  }

  @Post("mfa/confirm")
  /** Xác nhận mã TOTP đầu tiên, bật MFA khi email đã xác minh và trả bộ mã khôi phục hiển thị một lần. */
  async confirmMfa(@Headers("cookie") cookies: string | undefined, @Body() input: MfaCodeDto): Promise<{ enabled: true; recoveryCodes: string[] }> {
    const session = await this.session(cookies);
    return this.auth.confirmMfa(session.user.id, input.code);
  }

  @Post("mfa/recovery-codes")
  /** Xác thực lại bằng mật khẩu + TOTP rồi thay toàn bộ mã khôi phục cũ bằng bộ mã mới. */
  async regenerateRecoveryCodes(@Headers("cookie") cookies: string | undefined, @Body() input: RegenerateRecoveryCodesDto): Promise<{ recoveryCodes: string[] }> {
    const session = await this.session(cookies);
    return this.auth.regenerateRecoveryCodes(session.user.id, { currentPassword: input.currentPassword, mfaCode: input.mfaCode });
  }

  @Post("mfa/disable-challenge")
  /** Kiểm tra mật khẩu hiện tại rồi phát token ngắn hạn cho bước tắt MFA. */
  async startDisableMfa(@Headers("cookie") cookies: string | undefined, @Body() input: DisableMfaPasswordDto): Promise<{ challengeToken: string; expiresInSeconds: number }> {
    const session = await this.session(cookies);
    return this.auth.startDisableMfa(session.user.id, input.password);
  }

  @Delete("mfa")
  /** Xác minh TOTP lần cuối rồi xóa bí mật MFA. */
  async disableMfa(@Headers("cookie") cookies: string | undefined, @Body() input: DisableMfaDto): Promise<{ disabled: true }> {
    const session = await this.session(cookies);
    return this.auth.disableMfa(session.user.id, input.challengeToken, input.code);
  }

  /** Khôi phục phiên từ cookie dùng chung cho mọi endpoint tài khoản. */
  private session(cookies?: string): Promise<AuthenticatedSession> { return this.auth.resolve(this.auth.readToken(cookies)); }
}
