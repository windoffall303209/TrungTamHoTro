import { describe, expect, it } from "vitest";
import type { PermissionCode } from "./app-types";
import { hasAnyPermission, hasEveryPermission, hasPermission } from "./access-control";

const session = { permissions: ["class:view", "class:manage", "report:view"] as PermissionCode[] };

describe("access-control", () => {
  it("kiểm tra một quyền chính xác", () => {
    expect(hasPermission(session, "class:manage")).toBe(true);
    expect(hasPermission(session, "user:update")).toBe(false);
  });

  it("hỗ trợ điều kiện có ít nhất một quyền", () => {
    expect(hasAnyPermission(session, ["user:view", "report:view"])).toBe(true);
    expect(hasAnyPermission(session, ["user:view", "role:view"])).toBe(false);
  });

  it("hỗ trợ điều kiện phải có đầy đủ quyền", () => {
    expect(hasEveryPermission(session, ["class:view", "class:manage"])).toBe(true);
    expect(hasEveryPermission(session, ["class:manage", "system:configure"])).toBe(false);
  });
});
