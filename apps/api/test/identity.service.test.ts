import { BadRequestException, ConflictException } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import { IdentityService } from "../src/identity/identity.service.js";

describe("IdentityService", () => {
  it("tạo tài khoản và chặn email trùng không phân biệt hoa thường", () => {
    const service = new IdentityService();
    const created = service.createUser({ displayName: "Người dùng mới", email: "new@wind.edu.vn", roleCode: "LEARNER" });
    expect(created.status).toBe("ACTIVE");
    expect(() => service.createUser({ displayName: "Trùng", email: "NEW@wind.edu.vn", roleCode: "LEARNER" })).toThrow(ConflictException);
  });

  it("không cho khóa quản trị viên cuối cùng", () => {
    const service = new IdentityService();
    expect(() => service.updateUser("usr-admin", { status: "LOCKED" })).toThrow(BadRequestException);
  });

  it("tăng phiên bản khi cập nhật ma trận quyền", () => {
    const service = new IdentityService();
    const role = service.updateRolePermissions({ roleCode: "LEARNER", permissions: ["course:view", "support:create"] });
    expect(role.version).toBe(2);
    expect(role.permissions).toEqual(["course:view", "support:create"]);
  });
});

