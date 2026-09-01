import { BadRequestException, Body, Controller, Delete, Get, Headers, HttpCode, HttpException, Param, Patch, Post, Query, Req, Res, StreamableFile, UploadedFile, UseInterceptors } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { FileInterceptor } from "@nestjs/platform-express";
import type { Request, Response } from "express";
import { AuthService, type AuthenticatedSession } from "./auth.service.js";
import { ChangePasswordDto, ChangeVerificationEmailDto, DisableMfaDto, DisableMfaPasswordDto, ForgotPasswordDto, GoogleMfaRecoveryDto, LoginDto, MfaCodeDto, MfaLoginDto, RecoveryMfaLoginDto, RegisterDto, ResendVerificationDto, ResetPasswordDto, SecurityEmailChallengeDto, StartMfaSetupDto, UpdateProfileDto, VerificationStatusDto, VerifyEmailCodeDto, VerifyEmailDto } from "./auth.dto.js";

@ApiTags("Authentication")
@Controller("auth")
export class SessionController {
  constructor(private readonly auth: AuthService) {}

  @Post("login")
  @HttpCode(200)
  @ApiOperation({ summary: "Đăng nhập bằng tên tài khoản và mật khẩu" })
  async login(@Body() input: LoginDto, @Req() request: Request, @Res({ passthrough: true }) response: Response): Promise<object> {
    const result = await this.auth.login(input.username, input.password, input.rememberMe, this.context(request));
    if ("requiresMfa" in result) return result;
    this.setSessionCookie(response, result.token, result.maxAgeMs);
    return { ...result.session, csrfToken: result.csrfToken };
  }

  @Post("register")
  @ApiOperation({ summary: "Đăng ký tài khoản học viên" })
  register(@Body() input: RegisterDto): Promise<object> {
    return this.auth.register(input.username, input.displayName, input.email, input.password);
  }

  @Get("google/start")
  startGoogle(@Query("rememberMe") rememberMe: string | undefined, @Res() response: Response): void {
    const result = this.auth.startGoogleOAuth(rememberMe === "true");
    response.cookie(this.auth.googleStateCookieName(), result.stateCookie, this.temporaryCookieOptions(result.maxAgeMs));
    response.redirect(result.authorizationUrl);
  }

  @Get("google/callback")
  async googleCallback(
    @Query("code") code: string | undefined,
    @Query("state") state: string | undefined,
    @Query("error") oauthError: string | undefined,
    @Headers("cookie") cookies: string | undefined,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    const stateCookie = this.auth.readCookie(cookies, this.auth.googleStateCookieName());
    response.clearCookie(this.auth.googleStateCookieName(), { httpOnly: true, sameSite: "lax", path: "/" });
    if (oauthError || !code || !state) {
      response.redirect(this.auth.webUrl(`/login?googleError=${oauthError === "access_denied" ? "cancelled" : "invalid_callback"}`));
      return;
    }
    try {
      const completed = await this.auth.completeGoogleOAuth(code, state, stateCookie, this.context(request));
      if ("requiresMfa" in completed.result) {
        response.cookie(this.auth.googleMfaCookieName(), this.auth.createGoogleMfaCookie(completed.result.challengeToken, completed.rememberMe), this.temporaryCookieOptions(5 * 60 * 1000));
        response.redirect(this.auth.webUrl("/login?googleMfa=1"));
        return;
      }
      this.setSessionCookie(response, completed.result.token, completed.result.maxAgeMs);
      response.redirect(this.auth.webUrl("/dashboard"));
    } catch (error) {
      const status = error instanceof HttpException ? error.getStatus() : 500;
      const reason = status === 409 ? "account_conflict" : status === 403 ? "account_blocked" : status === 401 ? "expired" : "provider_failed";
      response.redirect(this.auth.webUrl(`/login?googleError=${reason}`));
    }
  }

  @Post("google/mfa/verify")
  @HttpCode(200)
  async verifyGoogleMfa(@Body() input: MfaCodeDto, @Headers("cookie") cookies: string | undefined, @Req() request: Request, @Res({ passthrough: true }) response: Response): Promise<object> {
    const result = await this.auth.completeGoogleMfa(this.auth.readCookie(cookies, this.auth.googleMfaCookieName()), input.code, this.context(request));
    response.clearCookie(this.auth.googleMfaCookieName(), { httpOnly: true, sameSite: "lax", path: "/" });
    this.setSessionCookie(response, result.token, result.maxAgeMs);
    return { ...result.session, csrfToken: result.csrfToken };
  }

  @Post("google/mfa/recovery")
  @HttpCode(200)
  async recoverGoogleMfa(@Body() input: GoogleMfaRecoveryDto, @Headers("cookie") cookies: string | undefined, @Req() request: Request, @Res({ passthrough: true }) response: Response): Promise<object> {
    const result = await this.auth.completeGoogleMfa(this.auth.readCookie(cookies, this.auth.googleMfaCookieName()), "000000", this.context(request), input.recoveryCode);
    response.clearCookie(this.auth.googleMfaCookieName(), { httpOnly: true, sameSite: "lax", path: "/" });
    this.setSessionCookie(response, result.token, result.maxAgeMs);
    return { ...result.session, csrfToken: result.csrfToken };
  }

  @Post("mfa/verify")
  @HttpCode(200)
  async verifyMfa(@Body() input: MfaLoginDto, @Req() request: Request, @Res({ passthrough: true }) response: Response): Promise<object> {
    const result = await this.auth.completeMfaLogin(input.challengeToken, input.code, input.rememberMe, this.context(request));
    this.setSessionCookie(response, result.token, result.maxAgeMs);
    return { ...result.session, csrfToken: result.csrfToken };
  }

  @Post("mfa/recovery")
  @HttpCode(200)
  async recoverMfa(@Body() input: RecoveryMfaLoginDto, @Req() request: Request, @Res({ passthrough: true }) response: Response): Promise<object> {
    const result = await this.auth.completeMfaLogin(input.challengeToken, "000000", input.rememberMe, this.context(request), input.recoveryCode);
    this.setSessionCookie(response, result.token, result.maxAgeMs);
    return { ...result.session, csrfToken: result.csrfToken };
  }

  @Post("forgot-password")
  @HttpCode(202)
  requestPasswordReset(@Body() input: ForgotPasswordDto): Promise<{ accepted: true }> {
    return this.auth.requestPasswordReset(input.email);
  }

  @Post("reset-password")
  resetPassword(@Body() input: ResetPasswordDto): Promise<{ reset: true }> {
    return this.auth.resetPassword(input.token, input.newPassword);
  }

  @Post("verify-email")
  verifyEmail(@Body() input: VerifyEmailDto): Promise<{ verified: true; verificationId: string }> {
    return this.auth.verifyEmail(input.token);
  }

  @Post("verify-email/code")
  verifyEmailCode(@Body() input: VerifyEmailCodeDto): Promise<{ verified: true; verificationId: string }> {
    return this.auth.verifyEmailCode(input.verificationId, input.code);
  }

  @Post("verification-email/resend")
  @HttpCode(202)
  resendPublicVerification(@Body() input: ResendVerificationDto): Promise<{ accepted: true; verificationId?: string }> {
    return this.auth.resendPublicVerification(input.identifier, input.verificationId);
  }

  @Post("verification-email/change")
  @HttpCode(200)
  changeVerificationEmail(@Body() input: ChangeVerificationEmailDto): Promise<object> {
    return this.auth.changePendingVerificationEmail(input.verificationId, input.password, input.newEmail);
  }

  @Get("verification-status")
  verificationStatus(@Query() input: VerificationStatusDto): Promise<{ verified: boolean; expired: boolean }> {
    return this.auth.verificationStatus(input.verificationId);
  }

  @Get("session")
  @ApiOperation({ summary: "Lấy phiên đăng nhập hiện tại" })
  async getSession(@Headers("cookie") cookies?: string, @Headers("x-role-code") roleCode?: string): Promise<object> {
    const session = await this.auth.resolve(this.auth.readToken(cookies), roleCode);
    return { ...session, csrfToken: await this.auth.issueCsrf(session.sessionId) };
  }

  @Post("logout")
  @HttpCode(204)
  @ApiOperation({ summary: "Đăng xuất và thu hồi phiên" })
  async logout(@Headers("cookie") cookies: string | undefined, @Res({ passthrough: true }) response: Response): Promise<void> {
    await this.auth.logout(this.auth.readToken(cookies));
    response.clearCookie(this.auth.cookieName(), { httpOnly: true, sameSite: "lax", path: "/" });
  }

  private setSessionCookie(response: Response, token: string, maxAge: number): void {
    response.cookie(this.auth.cookieName(), token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge,
    });
  }

  private temporaryCookieOptions(maxAge: number): { httpOnly: true; secure: boolean; sameSite: "lax"; path: "/"; maxAge: number } {
    return { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge };
  }

  private context(request: Request): { ipAddress?: string; userAgent?: string } {
    return { ipAddress: request.ip, userAgent: request.header("user-agent") ?? undefined };
  }
}

@ApiTags("Account")
@Controller("account")
export class AccountController {
  constructor(private readonly auth: AuthService) {}

  @Get("avatar")
  async avatar(@Headers("cookie") cookies?: string): Promise<StreamableFile> {
    const session = await this.session(cookies);
    const avatar = await this.auth.readAvatar(session.user.id);
    return new StreamableFile(avatar.buffer, { type: avatar.mimeType, disposition: "inline", length: avatar.buffer.length });
  }

  @Post("avatar")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: 3 * 1024 * 1024, files: 1 } }))
  async updateAvatar(@Headers("cookie") cookies: string | undefined, @UploadedFile() file?: { mimetype: string; size: number; buffer: Buffer }): Promise<object> {
    if (!file) throw new BadRequestException("Hãy chọn một ảnh đại diện.");
    const session = await this.session(cookies);
    return this.auth.updateAvatar(session.user.id, { mimeType: file.mimetype, size: file.size, buffer: file.buffer });
  }

  @Delete("avatar")
  async removeAvatar(@Headers("cookie") cookies?: string): Promise<object> {
    const session = await this.session(cookies);
    return this.auth.removeAvatar(session.user.id);
  }

  @Get("profile")
  async profile(@Headers("cookie") cookies?: string): Promise<object> {
    const session = await this.session(cookies);
    return this.auth.getProfile(session.user.id);
  }

  @Patch("profile")
  async updateProfile(@Headers("cookie") cookies: string | undefined, @Body() input: UpdateProfileDto): Promise<object> {
    const session = await this.session(cookies);
    return this.auth.updateProfile(session.user.id, input);
  }

  @Patch("password")
  async changePassword(@Headers("cookie") cookies: string | undefined, @Body() input: ChangePasswordDto): Promise<object> {
    const session = await this.session(cookies);
    return this.auth.changePassword(session.user.id, session.sessionId, input.currentPassword, input.newPassword, input.challengeId, input.code);
  }

  @Get("sessions")
  async sessions(@Headers("cookie") cookies?: string): Promise<object> {
    const session = await this.session(cookies);
    return this.auth.listSessions(session.user.id, session.sessionId);
  }

  @Delete("sessions/:sessionId")
  @HttpCode(204)
  async revoke(@Headers("cookie") cookies: string | undefined, @Param("sessionId") sessionId: string): Promise<void> {
    const session = await this.session(cookies);
    await this.auth.revokeSession(session.user.id, session.sessionId, sessionId);
  }

  @Post("sessions/revoke-others")
  async revokeOthers(@Headers("cookie") cookies?: string): Promise<object> {
    const session = await this.session(cookies);
    return this.auth.revokeOtherSessions(session.user.id, session.sessionId);
  }

  @Post("verification-email")
  resendVerification(@Headers("cookie") cookies?: string): Promise<{ sent: boolean }> {
    return this.session(cookies).then((session) => this.auth.resendVerification(session.user.id));
  }

  @Post("security-email-challenges")
  async securityEmailChallenge(@Headers("cookie") cookies: string | undefined, @Body() input: SecurityEmailChallengeDto): Promise<object> {
    const session = await this.session(cookies);
    return this.auth.requestSecurityEmailCode(session.user.id, input.purpose);
  }

  @Post("mfa/setup")
  async setupMfa(@Headers("cookie") cookies: string | undefined, @Body() input?: StartMfaSetupDto): Promise<{ secret: string; otpauthUri: string }> {
    const session = await this.session(cookies);
    return this.auth.startMfaSetup(session.user.id, input?.challengeId, input?.code);
  }

  @Post("mfa/confirm")
  async confirmMfa(@Headers("cookie") cookies: string | undefined, @Body() input: MfaCodeDto): Promise<{ recoveryCodes: string[] }> {
    const session = await this.session(cookies);
    return this.auth.confirmMfa(session.user.id, input.code);
  }

  @Post("mfa/disable-challenge")
  async startDisableMfa(@Headers("cookie") cookies: string | undefined, @Body() input: DisableMfaPasswordDto): Promise<{ challengeToken: string; expiresInSeconds: number }> {
    const session = await this.session(cookies);
    return this.auth.startDisableMfa(session.user.id, input.password, input.challengeId, input.code);
  }

  @Delete("mfa")
  async disableMfa(@Headers("cookie") cookies: string | undefined, @Body() input: DisableMfaDto): Promise<{ disabled: true }> {
    const session = await this.session(cookies);
    return this.auth.disableMfa(session.user.id, input.challengeToken, input.code);
  }

  private session(cookies?: string): Promise<AuthenticatedSession> { return this.auth.resolve(this.auth.readToken(cookies)); }
}
