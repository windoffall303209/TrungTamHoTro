import "reflect-metadata";
import type { ExecutionContext } from "@nestjs/common";
import type { ConfigService } from "@nestjs/config";
import { Reflector } from "@nestjs/core";
import { describe, expect, it, vi } from "vitest";
import { AuthService } from "../../src/auth/auth.service.js";
import { PermissionGuard } from "../../src/auth/permission.guard.js";
import { AUTHENTICATION_REQUIRED_KEY } from "../../src/auth/require-permissions.decorator.js";
import type { Environment } from "../../src/config/environment.js";
import type { PrismaService } from "../../src/database/prisma.service.js";
import type { EmailDeliveryService } from "../../src/infrastructure/email-delivery.service.js";
import type { ObjectStorageService } from "../../src/infrastructure/object-storage.service.js";

const config = { get: vi.fn((key: string) => ({ AUTH_ENCRYPTION_SECRET: "test-auth-encryption-secret-at-least-32-characters", MFA_ISSUER: "Wind EDU", WEB_ORIGIN: "http://localhost:3000" })[key]) } as unknown as ConfigService<Environment, true>;

/** Tạo AuthService với một phiên đa vai trò (giảng viên + học viên) đang lưu vai trò INSTRUCTOR. */
function createService(): { service: AuthService; update: ReturnType<typeof vi.fn> } {
  /** Gán một vai trò có quyền xem lớp cho người dùng giả. */
  const role = (code: string): object => ({ role: { code, name: code, permissions: [{ permission: { code: "class:view" } }] } });
  const row = {
    id: "session-1", userId: "usr-1", revokedAt: null, expiresAt: new Date(Date.now() + 3_600_000), lastSeenAt: new Date(), currentRoleCode: "INSTRUCTOR",
    user: { id: "usr-1", username: "gv", displayName: "GV", email: null, status: "ACTIVE", locale: "vi-VN", avatarObjectKey: null, avatarUpdatedAt: null, roles: [role("INSTRUCTOR"), role("LEARNER")] },
  };
  const update = vi.fn((): Promise<object> => Promise.resolve({}));
  const prisma = { isStartupConnectionEnabled: (): boolean => true, authSession: { findUnique: vi.fn((): Promise<typeof row> => Promise.resolve(row)), update } };
  return { service: new AuthService(prisma as unknown as PrismaService, {} as EmailDeliveryService, {} as ObjectStorageService, config), update };
}

describe("Vai trò theo từng request, không ghi đè vai trò phiên", () => {
  it("request thường dùng vai trò yêu cầu nhưng không ghi currentRoleCode xuống DB", async () => {
    const { service, update } = createService();
    expect((await service.resolve("token", "LEARNER")).roleCode).toBe("LEARNER");
    expect(update).not.toHaveBeenCalled();
    expect((await service.resolve("token")).roleCode).toBe("INSTRUCTOR");
  });

  it("chỉ GET /auth/session (persistRole) mới lưu vai trò người dùng chủ động chọn", async () => {
    const { service, update } = createService();
    await service.resolve("token", "LEARNER", true);
    const [args] = update.mock.calls[0] as unknown as [{ data: { currentRoleCode?: string } }];
    expect(args.data.currentRoleCode).toBe("LEARNER");
  });

  it("PermissionGuard đọc ?roleCode= cho GET (SSE) và ưu tiên header X-Role-Code", async () => {
    const resolve = vi.fn(() => Promise.resolve({ roleCode: "LEARNER", permissions: [] }));
    const auth = { resolve, readToken: () => "token" } as unknown as AuthService;
    const reflector = { getAllAndOverride: vi.fn((key: string) => key === AUTHENTICATION_REQUIRED_KEY ? true : undefined) } as unknown as Reflector;
    const guard = new PermissionGuard(reflector, auth);
    /** Tạo ExecutionContext HTTP với method, header và query cho trước. */
    const context = (method: string, headers: Record<string, string>, query: Record<string, string>): ExecutionContext => ({
      getHandler: () => undefined,
      getClass: () => undefined,
      switchToHttp: () => ({ getRequest: () => ({ method, query, header: (name: string) => headers[name] }) }),
    }) as unknown as ExecutionContext;
    await guard.canActivate(context("GET", {}, { roleCode: "LEARNER" }));
    expect(resolve).toHaveBeenLastCalledWith("token", "LEARNER");
    await guard.canActivate(context("GET", { "x-role-code": "INSTRUCTOR" }, { roleCode: "LEARNER" }));
    expect(resolve).toHaveBeenLastCalledWith("token", "INSTRUCTOR");
    await guard.canActivate(context("POST", {}, { roleCode: "LEARNER" }));
    expect(resolve).toHaveBeenLastCalledWith("token", undefined);
  });
});
