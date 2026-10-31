import { ForbiddenException, type ExecutionContext } from "@nestjs/common";
import type { ConfigService } from "@nestjs/config";
import type { Request } from "express";
import { describe, expect, it, vi } from "vitest";
import type { AuthService } from "../../src/auth/auth.service.js";
import type { Environment } from "../../src/config/environment.js";
import { CsrfGuard } from "../../src/auth/csrf.guard.js";

/** Tạo ngữ cảnh HTTP tối thiểu để kiểm thử cổng bảo vệ CSRF. */
function context(request: Partial<Request>): ExecutionContext {
  return { switchToHttp: () => ({ getRequest: () => request }) } as unknown as ExecutionContext;
}

/** Tạo ConfigService giả với API prefix/version có thể cấu hình trong từng ca kiểm thử. */
function config(apiPrefix = "api", apiVersion = "1"): ConfigService<Environment, true> {
  return {
    get: vi.fn((key: string) => key === "API_PREFIX" ? apiPrefix : apiVersion),
  } as unknown as ConfigService<Environment, true>;
}

describe("CsrfGuard", () => {
  it("cho phép GET và mutation xác thực công khai", async () => {
    const auth = { validateCsrf: vi.fn(), readToken: vi.fn() } as unknown as AuthService;
    await expect(new CsrfGuard(auth, config()).canActivate(context({ method: "GET", path: "/api/v1/account/profile" }))).resolves.toBe(true);
    await expect(new CsrfGuard(auth, config()).canActivate(context({ method: "POST", path: "/api/v1/auth/login" }))).resolves.toBe(true);
  });

  it("buộc token CSRF hợp lệ khi mutation dùng cookie phiên", async () => {
    const header = vi.fn((name: string) => name === "cookie" ? "wind_edu_session=session-token" : name === "x-csrf-token" ? "csrf-token" : undefined);
    const accepted = { readToken: vi.fn(() => "session-token"), validateCsrf: vi.fn(() => Promise.resolve(true)) } as unknown as AuthService;
    const request = { method: "PATCH", path: "/api/v1/account/profile", header } as unknown as Request;
    await expect(new CsrfGuard(accepted, config()).canActivate(context(request))).resolves.toBe(true);

    const rejected = { readToken: vi.fn(() => "session-token"), validateCsrf: vi.fn(() => Promise.resolve(false)) } as unknown as AuthService;
    await expect(new CsrfGuard(rejected, config()).canActivate(context(request))).rejects.toThrow(ForbiddenException);
  });

  it("áp dụng prefix và version tùy chỉnh cho ngoại lệ công khai và mutation riêng tư", async () => {
    const configured = config("gateway/api", "2026");
    const publicAuth = { method: "POST", path: "/gateway/api/v2026/auth/login" } as unknown as Request;
    const readToken = vi.fn();
    const auth = { readToken, validateCsrf: vi.fn() } as unknown as AuthService;
    await expect(new CsrfGuard(auth, configured).canActivate(context(publicAuth))).resolves.toBe(true);
    expect(readToken).not.toHaveBeenCalled();

    const header = vi.fn((name: string) => name === "cookie" ? "wind_edu_session=session-token" : name === "x-csrf-token" ? "csrf-token" : undefined);
    const privateMutation = { method: "PATCH", path: "/gateway/api/v2026/account/profile", header } as unknown as Request;
    const validateCsrf = vi.fn(() => Promise.resolve(true));
    const protectedAuth = { readToken: vi.fn(() => "session-token"), validateCsrf } as unknown as AuthService;
    await expect(new CsrfGuard(protectedAuth, configured).canActivate(context(privateMutation))).resolves.toBe(true);
    expect(validateCsrf).toHaveBeenCalledWith("session-token", "csrf-token");
  });
});
