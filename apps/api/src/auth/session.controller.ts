import { Body, Controller, Delete, Get, Headers, HttpCode, Param, Patch, Post, Req, Res } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import type { Request, Response } from "express";
import { AuthService, type AuthenticatedSession } from "./auth.service.js";
import { ChangePasswordDto, LoginDto, RegisterDto, UpdateProfileDto } from "./auth.dto.js";

@ApiTags("Authentication")
@Controller("auth")
export class SessionController {
  constructor(private readonly auth: AuthService) {}

  @Post("login")
  @HttpCode(200)
  @ApiOperation({ summary: "Đăng nhập bằng email và mật khẩu" })
  async login(@Body() input: LoginDto, @Req() request: Request, @Res({ passthrough: true }) response: Response): Promise<object> {
    const result = await this.auth.login(input.email, input.password, input.rememberMe, this.context(request));
    this.setSessionCookie(response, result.token, result.maxAgeMs);
    return result.session;
  }

  @Post("register")
  @ApiOperation({ summary: "Đăng ký tài khoản học viên" })
  async register(@Body() input: RegisterDto, @Req() request: Request, @Res({ passthrough: true }) response: Response): Promise<object> {
    const result = await this.auth.register(input.displayName, input.email, input.password, this.context(request));
    this.setSessionCookie(response, result.token, result.maxAgeMs);
    return result.session;
  }

  @Get("session")
  @ApiOperation({ summary: "Lấy phiên đăng nhập hiện tại" })
  getSession(@Headers("cookie") cookies?: string, @Headers("x-role-code") roleCode?: string): Promise<object> {
    return this.auth.resolve(this.auth.readToken(cookies), roleCode);
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

  private session(cookies?: string): Promise<AuthenticatedSession> { return this.auth.resolve(this.auth.readToken(cookies)); }
}
