import { Injectable, SetMetadata, type CustomDecorator, type ExecutionContext } from "@nestjs/common";
import { ThrottlerGuard, type ThrottlerRequest } from "@nestjs/throttler";
import { createHash } from "node:crypto";

/** Tên throttler riêng cho các route xác thực nhạy cảm (đăng nhập, MFA, đặt lại mật khẩu, mã OTP). */
export const AUTH_THROTTLER = "auth";
/** Tên throttler trần theo IP, áp cho mọi route. */
export const IP_THROTTLER = "ip";
const SESSION_COOKIE = "wind_edu_session";
const AUTH_RATE_LIMIT_KEY = "wind-edu:auth-rate-limit";
// Các trường định danh tài khoản/thử thách có thể xuất hiện trong body của route xác thực.
const ACCOUNT_FIELDS = ["username", "email", "identifier", "challengeToken", "setupToken", "verificationId", "token"] as const;

/** Đánh dấu route chịu thêm giới hạn chặt theo cặp tài khoản + IP (mặc định 5 lần/15 phút). */
export function AuthRateLimit(): CustomDecorator {
  return SetMetadata(AUTH_RATE_LIMIT_KEY, true);
}

/** IP người dùng do Express tính theo cấu hình trust proxy; không đọc X-Forwarded-For thô để tránh bị giả. */
export function clientIp(req: { ip?: string; socket?: { remoteAddress?: string } }): string {
  return req.ip ?? req.socket?.remoteAddress ?? "unknown";
}

/** Băm cookie phiên (nếu có) để đếm giới hạn theo người dùng thay vì theo NAT dùng chung của cả phòng máy. */
export function sessionKey(cookieHeader: unknown): string | undefined {
  if (typeof cookieHeader !== "string") return undefined;
  const token = cookieHeader.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${SESSION_COOKIE}=`))?.slice(SESSION_COOKIE.length + 1);
  return token ? createHash("sha256").update(token).digest("hex").slice(0, 32) : undefined;
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
 * Guard giới hạn tốc độ của ứng dụng:
 * - "default": đếm theo phiên đăng nhập (cookie) nếu có, ngược lại theo IP, để học viên chung NAT không khóa nhau;
 * - "ip": trần theo IP cho mọi request, chặn việc xoay cookie giả để lách giới hạn theo phiên;
 * - "auth": chỉ áp cho route gắn @AuthRateLimit(), đếm theo cặp IP + tài khoản để chặn vét cạn mật khẩu/TOTP/OTP.
 */
export class AppThrottlerGuard extends ThrottlerGuard {
  /** Dùng req.ip (đã áp trust proxy) thay vì req.ips[0] có thể là giá trị client tự khai. */
  protected override getTracker(req: Record<string, unknown>): Promise<string> {
    return Promise.resolve(clientIp(req as { ip?: string; socket?: { remoteAddress?: string } }));
  }

  /** Chọn khóa đếm theo từng throttler và bỏ qua throttler auth ở route thường. */
  protected override async handleRequest(requestProps: ThrottlerRequest): Promise<boolean> {
    const { req } = this.getRequestResponse(requestProps.context);
    const request = req as { ip?: string; socket?: { remoteAddress?: string }; headers?: { cookie?: unknown }; body?: unknown };
    const ip = clientIp(request);
    const name = requestProps.throttler.name;
    if (name === AUTH_THROTTLER) {
      if (!this.isAuthRateLimited(requestProps.context)) return true;
      return super.handleRequest({ ...requestProps, getTracker: () => Promise.resolve(`${ip}:${authAccountKey(request.body)}`) });
    }
    if (name === IP_THROTTLER) return super.handleRequest({ ...requestProps, getTracker: () => Promise.resolve(ip) });
    const session = sessionKey(request.headers?.cookie);
    return super.handleRequest({ ...requestProps, getTracker: () => Promise.resolve(session ? `session:${session}` : `ip:${ip}`) });
  }

  /** Route hoặc controller có gắn @AuthRateLimit() hay không. */
  private isAuthRateLimited(context: ExecutionContext): boolean {
    return Boolean(this.reflector.getAllAndOverride<boolean>(AUTH_RATE_LIMIT_KEY, [context.getHandler(), context.getClass()]));
  }
}
