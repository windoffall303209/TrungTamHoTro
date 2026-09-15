import { ForbiddenException, type ExecutionContext } from "@nestjs/common";
import type { Reflector } from "@nestjs/core";
import { describe, expect, it, vi } from "vitest";
import type { AuthService, AuthenticatedSession } from "../src/auth/auth.service.js";
import { PermissionGuard, type RequestWithRole } from "../src/auth/permission.guard.js";
import { AUTHENTICATION_REQUIRED_KEY, REQUIRED_PERMISSIONS_KEY } from "../src/auth/require-permissions.decorator.js";

const session: AuthenticatedSession = {
  sessionId: "session-test",
  user: { id: "user-test", username: "test.user", name: "Người dùng kiểm thử", email: "test@example.com", roleName: "Học viên" },
  roleCode: "LEARNER",
  permissions: ["exam:view"],
  availableRoles: [{ code: "LEARNER", name: "Học viên" }],
};

/** Tạo ngữ cảnh HTTP tối thiểu để kiểm tra phân quyền trên yêu cầu giả lập. */
function contextFor(request: Partial<RequestWithRole>): ExecutionContext {
  return {
    getHandler: () => function handler() {},
    getClass: () => class TestController {},
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

describe("PermissionGuard", () => {
  it("xác thực route chỉ yêu cầu có phiên và gắn danh tính vào request", async () => {
    const reflector = {
      getAllAndOverride: vi.fn((key: string) => key === AUTHENTICATION_REQUIRED_KEY ? true : undefined),
    } as unknown as Reflector;
    const auth = {
      readToken: vi.fn(() => "token-test"),
      resolve: vi.fn(() => Promise.resolve(session)),
    } as unknown as AuthService;
    const request = { header: vi.fn((name: string) => name === "cookie" ? "wind_edu_session=token-test" : undefined) } as unknown as RequestWithRole;

    await expect(new PermissionGuard(reflector, auth).canActivate(contextFor(request))).resolves.toBe(true);
    expect(request.auth).toEqual(session);
    expect(request.roleCode).toBe("LEARNER");
  });

  it("giữ route công khai và từ chối phiên thiếu quyền", async () => {
    const publicReflector = { getAllAndOverride: vi.fn(() => undefined) } as unknown as Reflector;
    const publicResolve = vi.fn();
    const publicAuth = { resolve: publicResolve } as unknown as AuthService;
    const request = { header: vi.fn() } as unknown as RequestWithRole;
    await expect(new PermissionGuard(publicReflector, publicAuth).canActivate(contextFor(request))).resolves.toBe(true);
    expect(publicResolve).not.toHaveBeenCalled();

    const protectedReflector = {
      getAllAndOverride: vi.fn((key: string) => key === REQUIRED_PERMISSIONS_KEY ? ["exam:manage"] : undefined),
    } as unknown as Reflector;
    const protectedAuth = {
      readToken: vi.fn(() => "token-test"),
      resolve: vi.fn(() => Promise.resolve(session)),
    } as unknown as AuthService;
    await expect(new PermissionGuard(protectedReflector, protectedAuth).canActivate(contextFor(request))).rejects.toThrow(ForbiddenException);
  });
});
