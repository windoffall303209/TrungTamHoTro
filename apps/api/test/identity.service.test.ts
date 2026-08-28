import { BadRequestException, ConflictException } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import { IdentityService } from "../src/identity/identity.service.js";

describe("IdentityService", () => {
  it("tạo tài khoản và chặn email trùng không phân biệt hoa thường", async () => {
    const service = new IdentityService();
    const created = await service.createUser({ displayName: "Người dùng mới", email: "new@wind.edu.vn", roleCode: "LEARNER" }, "admin-real");
    expect(created.status).toBe("ACTIVE");
    await expect(service.createUser({ displayName: "Trùng", email: "NEW@wind.edu.vn", roleCode: "LEARNER" })).rejects.toThrow(ConflictException);
    expect((await service.listAuditEvents())[0]).toMatchObject({ actorId: "admin-real", action: "USER_CREATED", targetId: created.id });
  });

  it("không cho khóa quản trị viên cuối cùng", async () => {
    const service = new IdentityService();
    await expect(service.updateUser("usr-admin", { status: "LOCKED" })).rejects.toThrow(BadRequestException);
  });

  it("tăng phiên bản khi cập nhật ma trận quyền", async () => {
    const service = new IdentityService();
    const role = await service.updateRolePermissions({ roleCode: "LEARNER", permissions: ["course:view", "support:create"] });
    expect(role.version).toBe(2);
    expect(role.permissions).toEqual(["course:view", "support:create"]);
  });
});
