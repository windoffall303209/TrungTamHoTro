import "reflect-metadata";
import { ForbiddenException, type ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { ConfigService } from "@nestjs/config";
import type { Request } from "express";
import { describe, expect, it, vi } from "vitest";
import type { AuthenticatedSession, AuthService } from "../../src/auth/auth.service.js";
import type { Environment } from "../../src/config/environment.js";
import { CsrfGuard } from "../../src/auth/csrf.guard.js";
import { PermissionGuard, type RequestWithRole } from "../../src/auth/permission.guard.js";
import { AccountController } from "../../src/auth/session.controller.js";

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
    expect(validateCsrf).toHaveBeenCalledWith("session-token", "csrf-token", undefined);
  });

  it("chuyển sessionId đã được PermissionGuard khôi phục để không đọc lại auth_sessions", async () => {
    const header = vi.fn((name: string) => name === "cookie" ? "wind_edu_session=session-token" : name === "x-csrf-token" ? "v2.csrf" : undefined);
    const validateCsrf = vi.fn(() => Promise.resolve(true));
    const auth = { readToken: vi.fn(() => "session-token"), validateCsrf } as unknown as AuthService;
    const request = { method: "POST", path: "/api/v1/academic/exams", header, auth: { sessionId: "session-1" } } as unknown as Request;
    await expect(new CsrfGuard(auth, config()).canActivate(context(request))).resolves.toBe(true);
    expect(validateCsrf).toHaveBeenCalledWith("session-token", "v2.csrf", "session-1");
  });

  it("không chặn POST /auth/mfa/recovery khi trình duyệt còn cookie phiên cũ mà chưa có CSRF token", async () => {
    const header = vi.fn((name: string) => name === "cookie" ? "wind_edu_session=stale-expired-token" : undefined);
    const readToken = vi.fn(() => "stale-expired-token");
    const validateCsrf = vi.fn(() => Promise.resolve(false));
    const auth = { readToken, validateCsrf } as unknown as AuthService;
    const request = { method: "POST", path: "/api/v1/auth/mfa/recovery", header } as unknown as Request;
    await expect(new CsrfGuard(auth, config()).canActivate(context(request))).resolves.toBe(true);
    expect(readToken).not.toHaveBeenCalled();
    expect(validateCsrf).not.toHaveBeenCalled();
  });

  it("khôi phục phiên đúng một lần cho các thao tác trên AccountController", async () => {
    const activeSession: AuthenticatedSession = {
      sessionId: "sess-single-read",
      roleCode: "LEARNER",
      availableRoles: [{ code: "LEARNER", name: "Học viên" }],
      permissions: ["class:view"],
      user: {
        id: "usr-1",
        username: "learner01",
        name: "Học viên 01",
        email: "learner01@wind.local",
        roleName: "Học viên",
        locale: "vi-VN",
        avatarUrl: null,
      },
    };
    const resolve = vi.fn(() => Promise.resolve(activeSession));
    const validateCsrf = vi.fn(() => Promise.resolve(true));
    const updateProfile = vi.fn(() => Promise.resolve({ ok: true }));
    const auth = {
      readToken: vi.fn(() => "session-token"),
      resolve,
      validateCsrf,
      updateProfile,
    } as unknown as AuthService;

    const header = vi.fn((name: string) => {
      if (name === "cookie") return "wind_edu_session=session-token";
      if (name === "x-csrf-token") return "v2.csrf";
      return undefined;
    });
    const request = { method: "PATCH", path: "/api/v1/account/profile", header } as unknown as RequestWithRole;
    const controller = new AccountController(auth);
    const handler = Object.getOwnPropertyDescriptor(AccountController.prototype, "updateProfile")?.value as (...args: unknown[]) => unknown;
    const execContext = {
      switchToHttp: (): { getRequest: () => RequestWithRole } => ({ getRequest: (): RequestWithRole => request }),
      getHandler: (): ((...args: unknown[]) => unknown) => handler,
      getClass: (): typeof AccountController => AccountController,
    } as unknown as ExecutionContext;

    await expect(new PermissionGuard(new Reflector(), auth).canActivate(execContext)).resolves.toBe(true);
    await expect(new CsrfGuard(auth, config()).canActivate(execContext)).resolves.toBe(true);
    await expect(
      controller.updateProfile(request.auth, {
        displayName: "Học viên 01",
        phone: "0900000000",
        timezone: "Asia/Bangkok",
        locale: "vi-VN",
      }),
    ).resolves.toEqual({ ok: true });

    expect(resolve).toHaveBeenCalledTimes(1);
    expect(validateCsrf).toHaveBeenCalledWith("session-token", "v2.csrf", "sess-single-read");
    expect(updateProfile).toHaveBeenCalledWith("usr-1", expect.objectContaining({ displayName: "Học viên 01" }));
  });
});
