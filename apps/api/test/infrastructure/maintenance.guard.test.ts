import { ServiceUnavailableException, type ExecutionContext } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { SessionController } from "../../src/auth/session.controller.js";
import { SystemController } from "../../src/domains/system/core/system.controller.js";
import { MaintenanceGuard } from "../../src/domains/system/operations/maintenance.guard.js";
import { SystemService } from "../../src/domains/system/core/system.service.js";

/** Handler giả không gắn @AllowDuringMaintenance(), đại diện cho route nghiệp vụ thông thường. */
class BusinessController {
  /** Route mutation nghiệp vụ dùng trong kiểm thử. */
  create(): void {}
}

/** Tạo ExecutionContext HTTP tối thiểu trỏ tới handler thật mà router đã chọn. */
function requestContext(method: string, path: string, controller: object = BusinessController, handler = "create"): ExecutionContext {
  const target = (controller as { prototype: Record<string, unknown> }).prototype[handler] as () => unknown;
  return {
    switchToHttp: () => ({ getRequest: () => ({ method, path }) }),
    getHandler: () => target,
    getClass: () => controller,
  } as unknown as ExecutionContext;
}

describe("MaintenanceGuard", () => {
  it("chỉ miễn trừ handler gắn @AllowDuringMaintenance(), không dựa vào chuỗi path", async () => {
    const system = new SystemService();
    const guard = new MaintenanceGuard(system);
    await system.updateSettings({ maintenanceMode: true }, "usr-admin");

    await expect(guard.canActivate(requestContext("POST", "/academic/exams"))).rejects.toThrow(ServiceUnavailableException);
    await expect(guard.canActivate(requestContext("GET", "/academic/exams"))).resolves.toBe(true);
    await expect(guard.canActivate(requestContext("PATCH", "/api/v1/system/settings", SystemController, "updateSettings"))).resolves.toBe(true);
    await expect(guard.canActivate(requestContext("POST", "/api/v1/auth/login", SessionController, "login"))).resolves.toBe(true);
    // Đường dẫn trông như /system/* hay /auth/* nhưng router định tuyến tới handler nghiệp vụ vẫn bị chặn.
    await expect(guard.canActivate(requestContext("POST", "/api/v1/system/../academic/exams"))).rejects.toThrow(ServiceUnavailableException);
    await expect(guard.canActivate(requestContext("POST", "/api/v1/auth/../classes"))).rejects.toThrow(ServiceUnavailableException);
    // Route hệ thống không được đánh dấu (vd. cấu hình AI) cũng bị khóa trong lúc bảo trì.
    await expect(guard.canActivate(requestContext("POST", "/api/v1/system/ai-providers", SystemController, "configureAiProvider"))).rejects.toThrow(ServiceUnavailableException);
  });

  it("đọc cờ bảo trì một lần trong cửa sổ cache và áp dụng ngay khi tắt bảo trì", async () => {
    const system = new SystemService();
    const guard = new MaintenanceGuard(system);
    const getSettings = vi.spyOn(system, "getSettings");
    await guard.canActivate(requestContext("POST", "/academic/exams"));
    await guard.canActivate(requestContext("POST", "/academic/exams"));
    expect(getSettings).toHaveBeenCalledOnce();

    await system.updateSettings({ maintenanceMode: true }, "usr-admin");
    await expect(guard.canActivate(requestContext("POST", "/academic/exams"))).rejects.toThrow(ServiceUnavailableException);
    await system.updateSettings({ maintenanceMode: false }, "usr-admin");
    await expect(guard.canActivate(requestContext("POST", "/academic/exams"))).resolves.toBe(true);
  });
});
