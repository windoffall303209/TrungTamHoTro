import { Body, Controller, Delete, Get, Headers, HttpCode, Param, Patch, Post, Req, Res } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import type { Request, Response } from "express";
import { AuthService, type AuthenticatedSession } from "./auth.service.js";
import { ChangePasswordDto, DisableMfaDto, ForgotPasswordDto, LoginDto, MfaCodeDto, MfaLoginDto, RecoveryMfaLoginDto, RegisterDto, ResetPasswordDto, UpdateProfileDto, VerifyEmailDto } from "./auth.dto.js";

@ApiTags("Authentication")
@Controller("auth")
export class SessionController {
  constructor(private readonly auth: AuthService) {}

  @Post("login")
  @HttpCode(200)
  @ApiOperation({ summary: "Đăng nhập bằng email và mật khẩu" })
  async login(@Body() input: LoginDto, @Req() request: Request, @Res({ passthrough: true }) response: Response): Promise<object> {
    const result = await this.auth.login(input.email, input.password, input.rememberMe, this.context(request));
    if ("requiresMfa" in result) return result;
    this.setSessionCookie(response, result.token, result.maxAgeMs);
    return { ...result.session, csrfToken: result.csrfToken };
  }

  @Post("register")
  @ApiOperation({ summary: "Đăng ký tài khoản học viên" })
  async register(@Body() input: RegisterDto, @Req() request: Request, @Res({ passthrough: true }) response: Response): Promise<object> {
    const result = await this.auth.register(input.displayName, input.email, input.password, this.context(request));
    this.setSessionCookie(response, result.token, result.maxAgeMs);
    return { ...result.session, csrfToken: result.csrfToken, verificationEmailSent: result.verificationEmailSent };
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
  verifyEmail(@Body() input: VerifyEmailDto): Promise<{ verified: true }> {
    return this.auth.verifyEmail(input.token);
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

  private context(request: Request): { ipAddress?: string; userAgent?: string } {
    return { ipAddress: request.ip, userAgent: request.header("user-agent") ?? undefined };
  }
}

@ApiTags("Account")
@Controller("account")
export class AccountController {
  constructor(private readonly auth: AuthService) {}

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
    return this.auth.changePassword(session.user.id, session.sessionId, input.currentPassword, input.newPassword);
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

  @Post("mfa/setup")
  async setupMfa(@Headers("cookie") cookies?: string): Promise<{ secret: string; otpauthUri: string }> {
    const session = await this.session(cookies);
    return this.auth.startMfaSetup(session.user.id);
  }

  @Post("mfa/confirm")
  async confirmMfa(@Headers("cookie") cookies: string | undefined, @Body() input: MfaCodeDto): Promise<{ recoveryCodes: string[] }> {
    const session = await this.session(cookies);
    return this.auth.confirmMfa(session.user.id, input.code);
  }

  @Delete("mfa")
  async disableMfa(@Headers("cookie") cookies: string | undefined, @Body() input: DisableMfaDto): Promise<{ disabled: true }> {
    const session = await this.session(cookies);
    return this.auth.disableMfa(session.user.id, input.password, input.code);
  }

  private session(cookies?: string): Promise<AuthenticatedSession> { return this.auth.resolve(this.auth.readToken(cookies)); }
}
