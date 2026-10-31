import { ServiceUnavailableException, type ExecutionContext } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import { MaintenanceGuard } from "../../src/domains/system/operations/maintenance.guard.js";
import { SystemService } from "../../src/domains/system/core/system.service.js";

/** Tạo ExecutionContext HTTP tối thiểu cho guard mà không cần khởi động Nest. */
function requestContext(method: string, path: string): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ method, path }) }),
  } as unknown as ExecutionContext;
}

describe("MaintenanceGuard", () => {
  it("chặn mutation nghiệp vụ nhưng giữ đường đọc và cấu hình hệ thống", async () => {
    const system = new SystemService();
    const guard = new MaintenanceGuard(system);
    await system.updateSettings({ maintenanceMode: true }, "usr-admin");

    await expect(
      guard.canActivate(requestContext("POST", "/academic/exams")),
    ).rejects.toThrow(ServiceUnavailableException);
    await expect(
      guard.canActivate(requestContext("GET", "/academic/exams")),
    ).resolves.toBe(true);
    await expect(
      guard.canActivate(requestContext("PATCH", "/system/settings")),
    ).resolves.toBe(true);
    await expect(guard.canActivate(requestContext("PATCH", "/api/v1/system/settings"))).resolves.toBe(true);
    await expect(guard.canActivate(requestContext("POST", "/api/v1/auth/login"))).resolves.toBe(true);
    await expect(guard.canActivate(requestContext("POST", "/api/v1/academic/exams"))).rejects.toThrow(ServiceUnavailableException);
    await expect(guard.canActivate(requestContext("POST", "/api/v1/health-fake"))).rejects.toThrow(ServiceUnavailableException);
  });
});
