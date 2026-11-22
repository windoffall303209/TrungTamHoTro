import { Injectable, SetMetadata, type CustomDecorator, type ExecutionContext } from "@nestjs/common";
import { ThrottlerGuard, type ThrottlerRequest } from "@nestjs/throttler";
import { createHash } from "node:crypto";

/** Tên throttler riêng cho các route xác thực nhạy cảm (đăng nhập, MFA, đặt lại mật khẩu, mã OTP). */
export const AUTH_THROTTLER = "auth";
const AUTH_RATE_LIMIT_KEY = "wind-edu:auth-rate-limit";
// Các trường định danh tài khoản/thử thách có thể xuất hiện trong body của route xác thực.
const ACCOUNT_FIELDS = ["username", "email", "identifier", "challengeToken", "setupToken", "verificationId", "token"] as const;

/** Đánh dấu route chịu thêm giới hạn chặt theo cặp tài khoản + IP (mặc định 5 lần/15 phút). */
export function AuthRateLimit(): CustomDecorator {
  return SetMetadata(AUTH_RATE_LIMIT_KEY, true);
}

/** Rút khóa định danh tài khoản từ body (đã chuẩn hóa và băm) để tách giới hạn của từng tài khoản sau cùng một NAT. */
export function authAccountKey(body: unknown): string {
  if (!body || typeof body !== "object") return "anonymous";
  const record = body as Record<string, unknown>;
  for (const field of ACCOUNT_FIELDS) {
    const value = record[field];
    if (typeof value === "string" && value.trim()) {
      return createHash("sha256").update(`${field}:${value.trim().toLowerCase()}`).digest("hex").slice(0, 32);
    }
  }
  return "anonymous";
}

@Injectable()
/**
 * Guard giới hạn tốc độ của ứng dụng: throttler mặc định áp cho mọi route theo IP; throttler "auth" chỉ áp cho route
 * gắn @AuthRateLimit() và đếm theo cặp IP + tài khoản để chặn vét cạn mật khẩu/TOTP/OTP mà không khóa cả phòng máy.
 */
export class AppThrottlerGuard extends ThrottlerGuard {
  /** Bỏ qua throttler auth ở route thường và đổi tracker của nó sang khóa IP + tài khoản. */
  protected override async handleRequest(requestProps: ThrottlerRequest): Promise<boolean> {
    if (requestProps.throttler.name !== AUTH_THROTTLER) return super.handleRequest(requestProps);
    if (!this.isAuthRateLimited(requestProps.context)) return true;
    const { req } = this.getRequestResponse(requestProps.context);
    const baseTracker = requestProps.getTracker;
    return super.handleRequest({
      ...requestProps,
      getTracker: async (request, context) => `${await baseTracker(request, context)}:${authAccountKey((req as { body?: unknown }).body)}`,
    });
  }

  /** Route hoặc controller có gắn @AuthRateLimit() hay không. */
  private isAuthRateLimited(context: ExecutionContext): boolean {
    return Boolean(this.reflector.getAllAndOverride<boolean>(AUTH_RATE_LIMIT_KEY, [context.getHandler(), context.getClass()]));
  }
}
