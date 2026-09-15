// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "./proxy";

afterEach(() => vi.unstubAllEnvs());

describe("document security policy", () => {
  it("uses a unique nonce, overrides spoofed headers, and excludes unsafe script execution in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_API_URL", "https://api.example.com/api/v1");
    const request = new NextRequest("https://web.example.com/login", { headers: { "x-nonce": "attacker", "Content-Security-Policy": "default-src *" } });
    const first = proxy(request);
    const policy = first.headers.get("Content-Security-Policy")!;
    expect(policy).toContain("'strict-dynamic'");
    expect(policy).toContain("connect-src 'self' https://api.example.com");
    expect(policy).toContain("frame-ancestors 'none'");
    expect(policy).not.toContain("unsafe-eval");
    expect(policy).not.toContain("attacker");
    expect(policy.split(";")[1]).not.toContain("unsafe-inline");
    expect(first.headers.get("x-middleware-request-content-security-policy")).toBe(policy);
    expect(proxy(request).headers.get("Content-Security-Policy")).not.toBe(policy);
    expect(first.headers.get("Cache-Control")).toBe("private, no-store");
  });

  it("allows development debugging and HMR only in development", () => {
    vi.stubEnv("NODE_ENV", "development");
    const policy = proxy(new NextRequest("http://localhost:3000/login")).headers.get("Content-Security-Policy");
    expect(policy).toContain("'unsafe-eval'");
    expect(policy).toContain("ws: wss:");
  });
});
