import { Test, type TestingModule } from "@nestjs/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../../src/app.module.js";
import { PrismaService } from "../../src/database/prisma.service.js";
import type { Prisma } from "../../src/generated/prisma/client.js";
import { IdentityService } from "../../src/identity/identity.service.js";

describe.skipIf(!(process.env.DB_NAME ?? "").endsWith("_test"))("user statistics database equivalence", () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let service: IdentityService;

  // Chỉ đọc seed trong DB test và đối chiếu với ba count trước tối ưu.
  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    prisma = moduleRef.get(PrismaService);
    service = moduleRef.get(IdentityService);
    expect(await prisma.user.count()).toBeGreaterThan(0);
  });

  // Đóng pool sau khi đối chiếu; không thay đổi dữ liệu tài khoản.
  afterAll(async () => { await moduleRef?.close(); });

  it.each(["SYSTEM_ADMIN", "CENTER_MANAGER"] as const)("matches previous counts for %s across status and role filters", async (actor) => {
    for (const status of [undefined, "ACTIVE", "LOCKED", "PENDING"] as const) {
      for (const roleCode of [undefined, "LEARNER", "SYSTEM_ADMIN"] as const) {
        for (const query of [undefined, "a", "__missing_user_statistics__"]) {
          const where: Prisma.UserWhereInput = {
            ...(status ? { status } : {}),
            ...(roleCode ? { roles: { some: { role: { code: roleCode } } } } : {}),
            ...(actor !== "SYSTEM_ADMIN" ? { NOT: { roles: { some: { role: { code: "SYSTEM_ADMIN" } } } } } : {}),
            ...(query ? { OR: ["username", "displayName", "email"].map((field) => ({ [field]: { contains: query, mode: "insensitive" } })) } : {}),
          };
          const [total, active, locked] = await Promise.all([
            prisma.user.count({ where }),
            prisma.user.count({ where: { ...where, status: "ACTIVE" } }),
            prisma.user.count({ where: { ...where, status: "LOCKED" } }),
          ]);
          const result = await service.listUsersPage({ page: 1, pageSize: 20, query, status, roleCode }, actor);
          expect(result).toMatchObject({ total, active, locked });
        }
      }
    }
  });
});
