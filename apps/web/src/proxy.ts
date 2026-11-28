import { randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";

const STATIC_PUBLIC_ASSET_PATTERN =
  /^\/(?:(?:favicon\.ico|robots\.txt|sitemap\.xml|manifest\.webmanifest)|[^?]+\.(?:jpg|jpeg|png|webp|avif|gif|ico|woff|woff2))$/i;

const TOKEN_SENSITIVE_PATH_PATTERN =
  /^\/(?:reset-password|verify-email|verify-account)(?:\/|$)/;

/** Nhận diện tài nguyên tĩnh công khai (ảnh raster, font, metadata) không mang HTML/nonce cá nhân. */
export function isCacheablePublicAsset(pathname: string): boolean {
  if (pathname.startsWith("/api/") || pathname.startsWith("/_next/data/")) return false;
  return STATIC_PUBLIC_ASSET_PATTERN.test(pathname);
}

/** Tạo nonce mới cho script và áp dụng cache/CSP đúng theo loại tài nguyên; không tin header từ client. */
export function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;

  // Tài nguyên tĩnh công khai (ảnh raster, icon, font) không mang dữ liệu phiên hay nonce HTML nên cho phép cache an toàn.
  if (isCacheablePublicAsset(pathname)) {
    const requestHeaders = new Headers(request.headers);
    requestHeaders.delete("x-nonce");
    const assetResponse = NextResponse.next({ request: { headers: requestHeaders } });
    assetResponse.headers.set("Cache-Control", "public, max-age=86400, stale-while-revalidate=604800");
    assetResponse.headers.set("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'");
    return assetResponse;
  }

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
  // Tuyệt đối không cho trình duyệt hay proxy trung gian cache HTML/RSC chứa nonce và dữ liệu phiên cá nhân.
  response.headers.set("Cache-Control", "private, no-store");
  response.headers.set("Pragma", "no-cache");
  // Trang mang token trong URL (đặt lại mật khẩu, xác minh email/tài khoản) không gửi Referer ra tài nguyên ngoài.
  if (TOKEN_SENSITIVE_PATH_PATTERN.test(pathname)) {
    response.headers.set("Referrer-Policy", "no-referrer");
  }
  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|manifest.webmanifest|.*\\.(?:jpg|jpeg|png|webp|avif|gif|ico|woff|woff2)$).*)",
  ],
};
