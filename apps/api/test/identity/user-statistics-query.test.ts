import { describe, expect, it, vi } from "vitest";
import type { PrismaService } from "../../src/database/prisma.service.js";
import type { UserListQueryDto } from "../../src/identity/identity.dto.js";
import { IdentityService } from "../../src/identity/identity.service.js";

/** Tạo biên DB có đủ trạng thái để phát hiện thay đổi ý nghĩa thống kê theo tab. */
function fixture(): {
  service: IdentityService;
  findMany: ReturnType<typeof vi.fn>;
  count: ReturnType<typeof vi.fn>;
  groupBy: ReturnType<typeof vi.fn>;
} {
  const findMany = vi.fn().mockResolvedValue([]);
  const count = vi.fn();
  const groupBy = vi.fn().mockResolvedValue([
    { status: "ACTIVE", _count: { _all: 8 } },
    { status: "LOCKED", _count: { _all: 2 } },
    { status: "PENDING", _count: { _all: 3 } },
    { status: "INACTIVE", _count: { _all: 1 } },
  ]);
  const prisma = { isStartupConnectionEnabled: () => true, user: { findMany, count, groupBy } } as unknown as PrismaService;
  return { service: new IdentityService(prisma), findMany, count, groupBy };
}

describe("user statistics consolidated query", () => {
  it.each([undefined, "ACTIVE", "LOCKED", "PENDING"] as const)("preserves counts with status %s using one aggregate", async (status) => {
    const { service, findMany, count, groupBy } = fixture();
    const input: UserListQueryDto = { page: 2, pageSize: 10, query: "  learner  ", roleCode: "LEARNER", status };
    const result = await service.listUsersPage(input, "CENTER_MANAGER");
    expect(result).toMatchObject({ total: status === "ACTIVE" ? 8 : status === "LOCKED" ? 2 : status === "PENDING" ? 3 : 14, active: 8, locked: 2, page: 2, pageSize: 10 });
    expect(findMany).toHaveBeenCalledTimes(1);
    expect(groupBy).toHaveBeenCalledTimes(1);
    expect(count).not.toHaveBeenCalled();
    const scope = { OR: [
      { username: { contains: "learner", mode: "insensitive" } },
      { displayName: { contains: "learner", mode: "insensitive" } },
      { email: { contains: "learner", mode: "insensitive" } },
    ], roles: { some: { role: { code: "LEARNER" } } }, NOT: { roles: { some: { role: { code: "SYSTEM_ADMIN" } } } } };
    expect(groupBy).toHaveBeenCalledWith({ by: ["status"], where: scope, _count: { _all: true } });
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { ...scope, ...(status ? { status } : {}) }, skip: 10, take: 10 }));
  });

  it("returns zeros for empty groups and keeps administrator scope", async () => {
    const { service, groupBy } = fixture();
    groupBy.mockResolvedValue([]);
    expect(await service.listUsersPage({ page: 1, pageSize: 20 }, "SYSTEM_ADMIN")).toMatchObject({ total: 0, active: 0, locked: 0 });
    expect(groupBy).toHaveBeenCalledWith({ by: ["status"], where: {}, _count: { _all: true } });
  });

  it("propagates aggregate failures instead of reporting misleading zero counts", async () => {
    const { service, groupBy } = fixture();
    groupBy.mockRejectedValue(new Error("database unavailable"));
    await expect(service.listUsersPage({ page: 1, pageSize: 20 }, "SYSTEM_ADMIN")).rejects.toThrow("database unavailable");
  });
});
