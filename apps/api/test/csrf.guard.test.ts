import { ForbiddenException, type ExecutionContext } from "@nestjs/common";
import type { Request } from "express";
import { describe, expect, it, vi } from "vitest";
import type { AuthService } from "../src/auth/auth.service.js";
import { CsrfGuard } from "../src/auth/csrf.guard.js";

/** Tạo ngữ cảnh HTTP tối thiểu để kiểm thử cổng bảo vệ CSRF. */
function context(request: Partial<Request>): ExecutionContext {
  return { switchToHttp: () => ({ getRequest: () => request }) } as unknown as ExecutionContext;
}

describe("CsrfGuard", () => {
  it("cho phép GET và mutation xác thực công khai", async () => {
    const auth = { validateCsrf: vi.fn(), readToken: vi.fn() } as unknown as AuthService;
    await expect(new CsrfGuard(auth).canActivate(context({ method: "GET", path: "/api/v1/account/profile" }))).resolves.toBe(true);
    await expect(new CsrfGuard(auth).canActivate(context({ method: "POST", path: "/api/v1/auth/login" }))).resolves.toBe(true);
  });

  it("buộc token CSRF hợp lệ khi mutation dùng cookie phiên", async () => {
    const header = vi.fn((name: string) => name === "cookie" ? "wind_edu_session=session-token" : name === "x-csrf-token" ? "csrf-token" : undefined);
    const accepted = { readToken: vi.fn(() => "session-token"), validateCsrf: vi.fn(() => Promise.resolve(true)) } as unknown as AuthService;
    const request = { method: "PATCH", path: "/api/v1/account/profile", header } as unknown as Request;
    await expect(new CsrfGuard(accepted).canActivate(context(request))).resolves.toBe(true);

    const rejected = { readToken: vi.fn(() => "session-token"), validateCsrf: vi.fn(() => Promise.resolve(false)) } as unknown as AuthService;
    await expect(new CsrfGuard(rejected).canActivate(context(request))).rejects.toThrow(ForbiddenException);
  });
});
