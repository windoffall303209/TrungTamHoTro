import { BadRequestException, ForbiddenException } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import { IdentityService } from "../../src/identity/identity.service.js";

const adminPermissions = ["user:view", "user:update", "user:suspend", "role:view", "role:update", "system:configure"];

describe("Ràng buộc RBAC khi quản trị danh tính", () => {
  it("bắt buộc quyền user:suspend khi khóa hoặc mở khóa tài khoản", async () => {
    const service = new IdentityService();
    await expect(service.updateUser("usr-learner", { status: "LOCKED" }, "usr-manager", "CENTER_MANAGER", ["user:view", "user:update"]))
      .rejects.toThrow("user:suspend");
  });

  it("không cho gỡ quyền của quản trị viên cuối cùng bằng roleCodes kể cả khi roleCode vẫn ghi SYSTEM_ADMIN", async () => {
    const service = new IdentityService();
    await expect(service.updateUser("usr-admin", { roleCode: "SYSTEM_ADMIN", roleCodes: ["LEARNER"] }, "usr-other", "SYSTEM_ADMIN", adminPermissions))
      .rejects.toThrow(BadRequestException);
    await expect(service.updateUser("usr-admin", { roleCodes: ["INSTRUCTOR"] }, "usr-other", "SYSTEM_ADMIN", adminPermissions))
      .rejects.toThrow("quản trị viên hoạt động cuối cùng");
  });

  it("không cho tự khóa hoặc tự đổi vai trò khi đã có quản trị viên khác", async () => {
    const service = new IdentityService();
    const second = await service.createUser({ username: "second.admin", roleCode: "SYSTEM_ADMIN", initialPassword: "Temp-2026-pass" }, "SYSTEM_ADMIN");
    const pending = await service.updateUser(second.id, { status: "ACTIVE" }, "usr-admin", "SYSTEM_ADMIN", adminPermissions).catch((error: unknown) => error);
    // Tài khoản PENDING chưa xác minh email không được kích hoạt thẳng.
    expect(pending).toBeInstanceOf(BadRequestException);
    await expect(service.updateUser("usr-admin", { roleCodes: ["SYSTEM_ADMIN", "LEARNER"] }, "usr-admin", "SYSTEM_ADMIN", adminPermissions))
      .rejects.toThrow(ForbiddenException);
  });

  it("chỉ SYSTEM_ADMIN sửa ma trận quyền, giữ quyền cốt lõi và không cấp quyền tối cao cho vai trò thấp hơn", async () => {
    const service = new IdentityService();
    await expect(service.updateRolePermissions({ roleCode: "LEARNER", permissions: ["course:view"] }, "usr-manager", "CENTER_MANAGER")).rejects.toThrow(ForbiddenException);
    await expect(service.updateRolePermissions({ roleCode: "CENTER_MANAGER", permissions: ["user:view", "role:update"] }, "usr-admin", "SYSTEM_ADMIN")).rejects.toThrow("role:update hoặc system:configure");
    await expect(service.updateRolePermissions({ roleCode: "SYSTEM_ADMIN", permissions: ["role:update", "user:view"] }, "usr-admin", "SYSTEM_ADMIN")).rejects.toThrow("quyền cốt lõi");
  });

  it("ẩn tài khoản quản trị hệ thống khỏi danh sách của quản lý trung tâm", async () => {
    const service = new IdentityService();
    const managerView = await service.listUsersPage({ page: 1, pageSize: 50 }, "CENTER_MANAGER");
    expect(managerView.items.some((user) => user.roleCodes.includes("SYSTEM_ADMIN"))).toBe(false);
    const adminView = await service.listUsersPage({ page: 1, pageSize: 50 }, "SYSTEM_ADMIN");
    expect(adminView.items.some((user) => user.roleCodes.includes("SYSTEM_ADMIN"))).toBe(true);
  });
});
