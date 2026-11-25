// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { isCacheablePublicAsset, proxy } from "../../src/proxy";

afterEach(() => vi.unstubAllEnvs());

describe("document security policy and proxy cache rules (C04)", () => {
  it("uses a unique nonce, overrides spoofed headers, and excludes unsafe script execution in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_API_URL", "https://api.example.com/api/v1");
    const request = new NextRequest("https://web.example.com/login", {
      headers: { "x-nonce": "attacker", "Content-Security-Policy": "default-src *" },
    });
    const first = proxy(request);
    const policy = first.headers.get("Content-Security-Policy")!;
    expect(policy).toContain("'strict-dynamic'");
    expect(policy).toContain("connect-src 'self' https://api.example.com");
    expect(policy).toContain("frame-src 'self' blob: https://www.youtube.com https://www.facebook.com https://drive.google.com;");
    expect(policy).toContain("frame-ancestors 'none'");
    expect(policy).not.toContain("unsafe-eval");
    expect(policy).not.toContain("attacker");
    expect(policy.split(";")[1]).not.toContain("unsafe-inline");
    expect(first.headers.get("x-middleware-request-content-security-policy")).toBe(policy);
    expect(proxy(request).headers.get("Content-Security-Policy")).not.toBe(policy);
    expect(first.headers.get("Cache-Control")).toBe("private, no-store");
    expect(first.headers.get("Pragma")).toBe("no-cache");
  });

  it("allows development debugging and HMR only in development", () => {
    vi.stubEnv("NODE_ENV", "development");
    const policy = proxy(new NextRequest("http://localhost:3000/login")).headers.get("Content-Security-Policy");
    expect(policy).toContain("'unsafe-eval'");
    expect(policy).toContain("ws: wss:");
  });

  it("không cache chia sẻ HTML cá nhân hoặc trang mang token và áp Referrer-Policy no-referrer cho route token", () => {
    vi.stubEnv("NODE_ENV", "production");
    for (const path of ["/dashboard", "/courses/classes/cls-1", "/reset-password?token=abc", "/verify-email", "/verify-account"]) {
      const response = proxy(new NextRequest(`https://web.example.com${path}`));
      expect(response.headers.get("Cache-Control")).toBe("private, no-store");
      expect(response.headers.get("Content-Security-Policy")).toContain("'nonce-");
      if (path.startsWith("/reset-password") || path.startsWith("/verify-")) {
        expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
      } else {
        expect(response.headers.get("Referrer-Policy")).toBeNull();
      }
    }
  });

  it("cho phép cache tài nguyên tĩnh công khai không mang nonce và chặn giả mạo x-nonce", () => {
    vi.stubEnv("NODE_ENV", "production");
    for (const assetPath of ["/logo-web.jpg", "/icon.jpg", "/favicon.ico", "/robots.txt", "/fonts/app.woff2"]) {
      expect(isCacheablePublicAsset(assetPath)).toBe(true);
      const response = proxy(
        new NextRequest(`https://web.example.com${assetPath}`, { headers: { "x-nonce": "spoofed" } }),
      );
      expect(response.headers.get("Cache-Control")).toBe("public, max-age=86400, stale-while-revalidate=604800");
      expect(response.headers.get("Content-Security-Policy")).toBe("default-src 'none'; frame-ancestors 'none'");
      expect(response.headers.get("x-middleware-request-x-nonce")).toBeNull();
    }
  });

  it("không xếp SVG, HTML, JS hoặc đường dẫn API vào nhóm tài nguyên tĩnh công khai", () => {
    for (const riskyPath of ["/logo.svg", "/index.html", "/sw.js", "/api/v1/avatar.png", "/_next/data/abc/page.png", "/dashboard"]) {
      expect(isCacheablePublicAsset(riskyPath)).toBe(false);
      const response = proxy(new NextRequest(`https://web.example.com${riskyPath}`));
      expect(response.headers.get("Cache-Control")).toBe("private, no-store");
      expect(response.headers.get("Content-Security-Policy")).toContain("'nonce-");
    }
  });
});
