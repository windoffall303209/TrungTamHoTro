import { Body, Controller, Get, Headers, HttpCode, Post, Res } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import type { Response } from "express";
import { AuthService } from "./auth.service.js";
import { LoginDto, RegisterDto } from "./auth.dto.js";

@ApiTags("Authentication")
@Controller("auth")
export class SessionController {
  constructor(private readonly auth: AuthService) {}

  @Post("login")
  @HttpCode(200)
  @ApiOperation({ summary: "Đăng nhập bằng email và mật khẩu" })
  async login(@Body() input: LoginDto, @Res({ passthrough: true }) response: Response): Promise<object> {
    const result = await this.auth.login(input.email, input.password, input.rememberMe);
    this.setSessionCookie(response, result.token, result.maxAgeMs);
    return result.session;
  }

  @Post("register")
  @ApiOperation({ summary: "Đăng ký tài khoản học viên" })
  async register(@Body() input: RegisterDto, @Res({ passthrough: true }) response: Response): Promise<object> {
    const result = await this.auth.register(input.displayName, input.email, input.password);
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
}
