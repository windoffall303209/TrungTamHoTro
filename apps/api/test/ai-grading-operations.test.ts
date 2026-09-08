import { UnauthorizedException, ValidationPipe, type INestApplication } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { Test } from "@nestjs/testing";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthService, type AuthenticatedSession } from "../src/auth/auth.service.js";
import { PermissionGuard } from "../src/auth/permission.guard.js";
import { PrismaService } from "../src/database/prisma.service.js";
import type { Prisma } from "../src/generated/prisma/client.js";
import { AiGradingOperationsController, AiGradingOperationsService } from "../src/learning/ai-grading-operations.js";

const admin = { roleCode: "SYSTEM_ADMIN", permissions: ["system:configure"], user: { id: "admin" } } as AuthenticatedSession;
const record = { id: "claim", ownerId: "teacher", submissionId: "submission", language: "VI", state: "GENERATING", createdAt: new Date("2026-09-08"), updatedAt: new Date("2026-09-08") };

describe("AI grading operations with HTTP validation and real authorization service", () => {
  let app: INestApplication;
  let url: string;
  const enabled = vi.fn(() => true);
  const findMany = vi.fn<(args: Prisma.AiGradingSuggestionFindManyArgs) => Promise<Array<typeof record>>>();
  const findUnique = vi.fn();

  // Chạy route, guard, DTO và service thật; chỉ giả lập authentication và biên database.
  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ controllers: [AiGradingOperationsController], providers: [
      AiGradingOperationsService,
      { provide: PrismaService, useValue: { isStartupConnectionEnabled: enabled, aiGradingSuggestion: { findMany, findUnique } } },
      { provide: AuthService, useValue: {
        readToken: (cookie?: string): string | undefined => cookie,
        resolve: (token?: string): AuthenticatedSession => {
          if (!token) throw new UnauthorizedException();
          if (token === "teacher") return { ...admin, roleCode: "INSTRUCTOR" };
          if (token === "unprivileged") return { ...admin, permissions: [] };
          return admin;
        },
      } },
      { provide: APP_GUARD, useClass: PermissionGuard },
    ] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
    await app.listen(0, "127.0.0.1");
    url = `${await app.getUrl()}/admin/ai-operations/grading`;
  });
  // Đóng HTTP server test sau khi hoàn thành.
  afterAll(async () => { await app?.close(); });
  // Mỗi ca có storage và số lần gọi độc lập.
  beforeEach(() => { vi.resetAllMocks(); enabled.mockReturnValue(true); findMany.mockResolvedValue([record]); findUnique.mockResolvedValue(null); });
  // Gửi yêu cầu đọc metadata, không có phương thức mutation.
  const read = (query = "", cookie = "admin"): Promise<Response> => fetch(`${url}${query}`, { headers: { cookie } });

  it("returns bounded metadata with no-store and defaults to unresolved states", async () => {
    const response = await read();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ items: [JSON.parse(JSON.stringify(record))], nextCursor: null });
    const args = findMany.mock.calls[0]?.[0];
    expect(args?.take).toBe(21);
    expect(args?.where?.state).toEqual({ in: ["GENERATING", "UNCERTAIN"] });
    expect(args?.select).toEqual({ id: true, ownerId: true, submissionId: true, language: true, state: true, createdAt: true, updatedAt: true });
    expect(findUnique).not.toHaveBeenCalled();
  });

  it("uses timestamp/ID keysets, one lookahead row and explicit state filters", async () => {
    findUnique.mockResolvedValue({ id: "anchor", createdAt: record.createdAt });
    findMany.mockResolvedValue([record, { ...record, id: "older" }]);
    const response = await read("?limit=1&state=READY&cursor=anchor");
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ items: [{ id: "claim" }], nextCursor: "claim" });
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 2, orderBy: [{ createdAt: "desc" }, { id: "desc" }], where: { state: "READY", OR: [{ createdAt: { lt: record.createdAt } }, { createdAt: record.createdAt, id: { lt: "anchor" } }] } }));
  });

  it.each(["?limit=0", "?limit=51", "?limit=1.5", "?limit=true", "?limit=1e1", "?limit=1&limit=2", "?cursor=", "?state=FAILED", "?model=secret", "?ownerId=teacher"])("rejects malformed or extra filters %s before storage", async (query) => {
    expect((await read(query)).status).toBe(400);
    expect(findMany).not.toHaveBeenCalled();
  });

  it.each([["", 401], ["teacher", 403], ["unprivileged", 403]])("requires administrator identity and permission: %s", async (cookie, status) => {
    expect((await read("", cookie)).status).toBe(status);
    expect(findMany).not.toHaveBeenCalled();
    expect(findUnique).not.toHaveBeenCalled();
  });

  it("rejects a removed cursor rather than silently restarting pagination", async () => {
    expect((await read("?cursor=deleted")).status).toBe(400);
    expect(findMany).not.toHaveBeenCalled();
  });

  it("reports disabled database instead of claiming there are no requests", async () => {
    enabled.mockReturnValue(false);
    expect((await read()).status).toBe(503);
    expect(findMany).not.toHaveBeenCalled();
  });
});
