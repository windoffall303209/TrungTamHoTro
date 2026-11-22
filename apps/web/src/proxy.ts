import { randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";

/** Tạo nonce mới cho script và bảo vệ phản hồi HTML; không tin các header chính sách do client gửi. */
export function proxy(request: NextRequest) {
  const nonce = randomBytes(24).toString("base64");
  const isDev = process.env.NODE_ENV === "development";
  const apiOrigin = new URL(process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api/v1").origin;
  const policy = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    // Kiểu động của React và KaTeX cần CSS nội tuyến, nhưng không cho phép JavaScript nội tuyến.
    "style-src 'self' 'unsafe-inline'",
    `connect-src 'self' ${apiOrigin}${isDev ? " ws: wss:" : ""}`,
    `img-src 'self' ${apiOrigin} https: data: blob:`,
    "font-src 'self' data:",
    `media-src 'self' ${apiOrigin} https: blob:`,
    "frame-src 'self' blob: https://www.youtube.com https://www.facebook.com https://drive.google.com",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", policy);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", policy);
  // Không cho bộ nhớ đệm dùng chung tái sử dụng HTML có nonce giữa các yêu cầu.
  response.headers.set("Cache-Control", "private, no-store");
  // Trang mang token trong URL (đặt lại mật khẩu, xác minh email/tài khoản) không gửi Referer ra tài nguyên ngoài.
  if (/^\/(?:reset-password|verify-email|verify-account)(?:\/|$)/.test(request.nextUrl.pathname)) response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
