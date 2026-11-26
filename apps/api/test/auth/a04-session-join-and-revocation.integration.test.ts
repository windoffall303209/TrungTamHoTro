import { randomUUID } from "node:crypto";
import { ForbiddenException, UnauthorizedException } from "@nestjs/common";
import { Test, type TestingModule } from "@nestjs/testing";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../../src/app.module.js";
import { AuthService } from "../../src/auth/auth.service.js";
import { hashPassword } from "../../src/auth/password.js";
import { PrismaService } from "../../src/database/prisma.service.js";

/** Đếm chính xác số câu SQL thật gửi qua pg.Client.prototype.query trong một callback bất đồng bộ. */
async function countRealSqlQueries<T>(task: () => Promise<T>): Promise<{ result: T; queryCount: number }> {
  const originalQuery = Reflect.get(pg.Client.prototype, "query") as (this: pg.Client, ...params: unknown[]) => unknown;
  let queryCount = 0;
  // Tạm chặn pg.Client.prototype.query để đếm đúng số truy vấn SQL vật lý gửi tới PostgreSQL.
  Reflect.set(pg.Client.prototype, "query", function countedQuery(this: pg.Client, ...args: unknown[]): unknown {
    queryCount += 1;
    return originalQuery.apply(this, args);
  });
  try {
    const result = await task();
    return { result, queryCount };
  } finally {
    Reflect.set(pg.Client.prototype, "query", originalQuery);
  }
}

describe("A04 AuthService single-JOIN session/user resolution và thu hồi tức thì", () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let auth: AuthService;
  const createdUserIds: string[] = [];

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    prisma = moduleRef.get(PrismaService);
    auth = moduleRef.get(AuthService);
  });

  afterAll(async () => {
    if (createdUserIds.length) {
      await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    }
    await moduleRef.close();
  });

  it("giảm login xuống 2 SQL, resolve xuống 1 SQL, phát CSRF v3 0 SQL và thu hồi phiên/quyền ngay lập tức", async () => {
    const suffix = randomUUID().slice(0, 8);
    const userId = `usr-a04-${suffix}`;
    const username = `a04_user_${suffix}`;
    const password = "A04-Test-Password-2026!";
    const learnerRole = await prisma.role.findUniqueOrThrow({ where: { code: "LEARNER" } });
    const instructorRole = await prisma.role.findUniqueOrThrow({ where: { code: "INSTRUCTOR" } });

    await prisma.user.create({
      data: {
        id: userId,
        username,
        email: `${username}@test.local`,
        emailVerifiedAt: new Date(),
        passwordHash: await hashPassword(password),
        displayName: "Người dùng A04",
        status: "ACTIVE",
        roles: {
          create: [{ roleId: learnerRole.id }, { roleId: instructorRole.id }],
        },
      },
    });
    createdUserIds.push(userId);

    // 1. Login: 1 SELECT JOIN users/roles/permissions + 1 INSERT auth_sessions = đúng 2 SQL.
    const loginRun = await countRealSqlQueries(() => auth.login(username, password, false));
    expect(loginRun.queryCount).toBe(2);
    expect("token" in loginRun.result).toBe(true);
    if (!("token" in loginRun.result)) throw new Error("Mong đợi kết quả SessionIssue.");
    const { token, csrfToken, session } = loginRun.result;
    expect(csrfToken.startsWith("v3.")).toBe(true);
    expect(session.availableRoles.map((r) => r.code).sort()).toEqual(["INSTRUCTOR", "LEARNER"]);

    // 2. Resolve phiên khi lastSeenAt còn mới: đúng 1 SQL JOIN thay vì 6 SQL tách rời.
    const resolveRun = await countRealSqlQueries(() => auth.resolve(token, "INSTRUCTOR"));
    expect(resolveRun.queryCount).toBe(1);
    expect(resolveRun.result.roleCode).toBe("INSTRUCTOR");
    expect(resolveRun.result.permissions.length).toBeGreaterThan(0);

    // 3. Xác thực CSRF với resolvedSessionId dùng v3 ngay sau login: 0 SQL.
    const csrfRun = await countRealSqlQueries(() =>
      auth.validateCsrf(token, csrfToken, resolveRun.result.sessionId),
    );
    expect(csrfRun.queryCount).toBe(0);
    expect(csrfRun.result).toBe(true);

    // 4. Không có stale permission: gỡ vai trò INSTRUCTOR trong DB phải có hiệu lực ngay ở lần resolve kế tiếp.
    await prisma.userRole.delete({
      where: { userId_roleId: { userId, roleId: instructorRole.id } },
    });
    await expect(auth.resolve(token, "INSTRUCTOR")).rejects.toBeInstanceOf(ForbiddenException);
    const learnerStillWorks = await auth.resolve(token, "LEARNER");
    expect(learnerStillWorks.roleCode).toBe("LEARNER");
    expect(learnerStillWorks.availableRoles.map((r) => r.code)).toEqual(["LEARNER"]);

    // 5. Khóa tài khoản phải chặn ngay lập tức.
    await prisma.user.update({ where: { id: userId }, data: { status: "LOCKED" } });
    await expect(auth.resolve(token, "LEARNER")).rejects.toBeInstanceOf(ForbiddenException);

    // 6. Mở lại tài khoản nhưng thu hồi phiên phải chặn ngay lập tức.
    await prisma.user.update({ where: { id: userId }, data: { status: "ACTIVE" } });
    await auth.logout(token);
    await expect(auth.resolve(token, "LEARNER")).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
