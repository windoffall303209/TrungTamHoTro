import { UnauthorizedException, ValidationPipe, type INestApplication } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { Test } from "@nestjs/testing";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthService, type AuthenticatedSession } from "../src/auth/auth.service.js";
import { PermissionGuard } from "../src/auth/permission.guard.js";
import { PrismaService } from "../src/database/prisma.service.js";
import { AiGradingOperationsController, AiGradingOperationsService } from "../src/learning/ai-grading-operations.js";

const admin = { roleCode: "SYSTEM_ADMIN", permissions: ["system:configure"], user: { id: "admin" } } as AuthenticatedSession;

describe("Exam operations HTTP contract", () => {
  let app: INestApplication;
  let url: string;
  const queryRaw = vi.fn();
  const enabled = vi.fn(() => true);

  // Dùng controller, service, guard và DTO thật; mock đúng biên auth và SQL.
  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ controllers: [AiGradingOperationsController], providers: [
      AiGradingOperationsService,
      { provide: PrismaService, useValue: { isStartupConnectionEnabled: enabled, $queryRaw: queryRaw } },
      { provide: AuthService, useValue: {
        readToken: (cookie?: string): string | undefined => cookie,
        resolve: (token?: string): AuthenticatedSession => {
          if (!token) throw new UnauthorizedException();
          if (token === "teacher") return { ...admin, roleCode: "INSTRUCTOR" };
          if (token === "no-permission") return { ...admin, permissions: [] };
          return admin;
        },
      } },
      { provide: APP_GUARD, useClass: PermissionGuard },
    ] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
    await app.listen(0, "127.0.0.1");
    url = `${await app.getUrl()}/admin/ai-operations/exams`;
  });
  // Đóng server test, không để lại cổng nền.
  afterAll(async () => { await app?.close(); });
  beforeEach(() => { vi.resetAllMocks(); queryRaw.mockResolvedValue([]); enabled.mockReturnValue(true); });
  // Đọc endpoint metadata với cookie fixture.
  const read = (query = "", cookie = "admin"): Promise<Response> => fetch(`${url}${query}`, { headers: { cookie } });

  it.each(["", "?state=CLAIMED", "?state=GENERATING", "?state=READY", "?state=SAVING", "?state=COMPLETED", "?state=UNCERTAIN"])("supports exam workflow states %s without mutation", async (query) => {
    const response = await read(query);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ items: [], nextCursor: null });
    expect(queryRaw).toHaveBeenCalledTimes(1);
  });

  it.each(["?state=FAILED", "?scope=all", "?scope=", "?scope=unlinked&scope=canonical", "?limit=0", "?limit=51", "?limit=true", "?limit=1e1", "?limit=1&limit=2", "?cursor=", "?answer=private", "?model=override"])("rejects invalid or extra input %s before SQL", async (query) => {
    expect((await read(query)).status).toBe(400);
    expect(queryRaw).not.toHaveBeenCalled();
  });

  it.each([["", 401], ["teacher", 403], ["no-permission", 403]])("checks identity and permission before SQL for %s", async (cookie, status) => {
    expect((await read("", cookie)).status).toBe(status);
    expect(queryRaw).not.toHaveBeenCalled();
  });

  it("rejects an unknown canonical cursor", async () => {
    expect((await read("?cursor=missing")).status).toBe(400);
    expect(queryRaw).toHaveBeenCalledTimes(1);
  });

  it.each(["canonical", "unlinked"])("supports explicit %s scope with the same read-only contract", async (scope) => {
    const response = await read(`?scope=${scope}&state=CLAIMED`);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(queryRaw).toHaveBeenCalledTimes(1);
    const sql = queryRaw.mock.calls[0]![0] as { sql: string };
    expect(sql.sql).toContain(scope === "unlinked" ? "NOT EXISTS" : "AND EXISTS");
  });

  it("fails explicitly when durable storage is disabled", async () => {
    enabled.mockReturnValue(false);
    expect((await read()).status).toBe(503);
    expect(queryRaw).not.toHaveBeenCalled();
  });
});
