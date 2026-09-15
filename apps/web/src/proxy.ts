import { randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";

/** Issue a fresh script nonce and protect document responses without trusting client-supplied policy headers. */
export function proxy(request: NextRequest) {
  const nonce = randomBytes(24).toString("base64");
  const isDev = process.env.NODE_ENV === "development";
  const apiOrigin = new URL(process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api/v1").origin;
  const policy = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    // React dynamic styles and KaTeX require inline CSS, but never inline JavaScript.
    "style-src 'self' 'unsafe-inline'",
    `connect-src 'self' ${apiOrigin}${isDev ? " ws: wss:" : ""}`,
    `img-src 'self' ${apiOrigin} https: data: blob:`,
    "font-src 'self' data:",
    `media-src 'self' ${apiOrigin} https: blob:`,
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
  // Nonced HTML must not be reused by shared caches across requests.
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
