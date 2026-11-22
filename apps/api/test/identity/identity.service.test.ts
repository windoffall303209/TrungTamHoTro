import { BadRequestException, ConflictException } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import { IdentityService } from "../../src/identity/identity.service.js";

describe("IdentityService", () => {
  it("tạo tài khoản chưa xác thực và chặn tên tài khoản trùng không phân biệt hoa thường", async () => {
    const service = new IdentityService();
    const created = await service.createUser(
      {
        username: "new.user",
        roleCode: "LEARNER",
        initialPassword: "Temp-2026-pass",
      },
      "SYSTEM_ADMIN",
    );
    expect(created).toMatchObject({
      status: "PENDING",
      email: null,
      roleCodes: ["LEARNER"],
    });
    await expect(
      service.createUser(
        {
          username: "NEW.user",
          roleCode: "LEARNER",
          initialPassword: "Temp-2026-pass",
        },
        "SYSTEM_ADMIN",
      ),
    ).rejects.toThrow(ConflictException);
  });

  it("giữ nhiều vai trò khi tạo tài khoản bằng mật khẩu tạm", async () => {
    const service = new IdentityService();
    const created = await service.createUser(
      {
        username: "multi.role",
        roleCode: "INSTRUCTOR",
        roleCodes: ["INSTRUCTOR", "LEARNER"],
        initialPassword: "Password-2030",
      },
      "SYSTEM_ADMIN",
    );

    expect(created).toMatchObject({
      status: "PENDING",
      roleCode: "INSTRUCTOR",
      roleCodes: ["INSTRUCTOR", "LEARNER"],
    });

    const impact = await service.previewUserChange(created.id, {
      roleCodes: ["INSTRUCTOR", "LEARNER", "CENTER_MANAGER"],
    }, "SYSTEM_ADMIN");
    const updated = await service.updateUser(created.id, {
      roleCodes: ["INSTRUCTOR", "LEARNER", "CENTER_MANAGER"],
      impactToken: impact.token,
    }, "usr-admin", "SYSTEM_ADMIN", ["user:suspend"]);
    expect(updated.roleCodes).toEqual([
      "INSTRUCTOR",
      "LEARNER",
      "CENTER_MANAGER",
    ]);
  });

  it("không cho khóa quản trị viên cuối cùng", async () => {
    const service = new IdentityService();
    await expect(
      service.updateUser("usr-admin", { status: "LOCKED" }, "usr-admin", "SYSTEM_ADMIN", ["user:suspend"]),
    ).rejects.toThrow(BadRequestException);
  });

  it("yêu cầu xem trước đúng phiên bản trước khi đổi quyền tài khoản", async () => {
    const service = new IdentityService();
    await expect(
      service.updateUser("usr-learner", { status: "LOCKED" }, "usr-admin", "SYSTEM_ADMIN", ["user:suspend"]),
    ).rejects.toThrow(ConflictException);
    const impact = await service.previewUserChange("usr-learner", {
      status: "LOCKED",
    }, "SYSTEM_ADMIN");
    const updated = await service.updateUser("usr-learner", {
      status: "LOCKED",
      impactToken: impact.token,
    }, "usr-admin", "SYSTEM_ADMIN", ["user:suspend"]);
    expect(updated.status).toBe("LOCKED");
  });

  it("tăng phiên bản khi cập nhật ma trận quyền", async () => {
    const service = new IdentityService();
    const role = await service.updateRolePermissions({
      roleCode: "LEARNER",
      permissions: ["course:view", "support:create"],
    }, "usr-admin", "SYSTEM_ADMIN");
    expect(role.version).toBe(2);
    expect(role.permissions).toEqual(["course:view", "support:create"]);
  });
});
