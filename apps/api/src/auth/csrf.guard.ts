import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Request } from "express";
import type { Environment } from "../config/environment.js";
import { AuthService } from "./auth.service.js";
import type { RequestWithRole } from "./permission.guard.js";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const PUBLIC_MUTATIONS = new Set([
  "/auth/login", "/auth/mfa/verify", "/auth/mfa/recovery", "/auth/mfa/email/send", "/auth/mfa/email/verify",
  "/auth/forgot-password", "/auth/reset-password", "/auth/verify-email",
  "/auth/verify-email/code", "/auth/verification-email/resend", "/auth/verification-email/change",
  "/auth/account-setup/otp", "/auth/account-setup/complete",
]);

@Injectable()
/** Bảo vệ các request thay đổi dữ liệu sử dụng cookie phiên khỏi tấn công CSRF. */
export class CsrfGuard implements CanActivate {
  constructor(
    private readonly auth: AuthService,
    private readonly config: ConfigService<Environment, true>,
  ) {}

  /** Bỏ qua request an toàn/công khai, còn mutation dùng cookie phải có CSRF token hợp lệ. */
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    if (SAFE_METHODS.has(request.method.toUpperCase())) return true;
    const prefix = `/${this.config.get("API_PREFIX", { infer: true }).replace(/^\/+|\/+$/g, "")}/v${this.config.get("API_VERSION", { infer: true })}`;
    const path = request.path.startsWith(prefix) ? request.path.slice(prefix.length) || "/" : request.path;
    if (PUBLIC_MUTATIONS.has(path) || path.startsWith("/integrations/webhooks/")) return true;
    // Request không dùng cookie phiên không mang quyền của người dùng nên không cần kiểm tra CSRF tại đây.
    const token = this.auth.readToken(request.header("cookie") ?? undefined);
    if (!token) return true;
    // PermissionGuard đã khôi phục phiên từ cùng cookie thì dùng lại sessionId, tránh truy vấn auth_sessions lần hai.
    const resolvedSessionId = (request as Partial<RequestWithRole>).auth?.sessionId;
    if (!(await this.auth.validateCsrf(token, request.header("x-csrf-token") ?? undefined, resolvedSessionId))) {
      throw new ForbiddenException("Yêu cầu bảo mật đã hết hạn. Hãy tải lại trang và thử lại.");
    }
    return true;
  }
}
