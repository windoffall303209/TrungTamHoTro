import { UnauthorizedException, ValidationPipe, type INestApplication } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { Test } from "@nestjs/testing";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthService, type AuthenticatedSession } from "../../src/auth/auth.service.js";
import { PermissionGuard } from "../../src/auth/permission.guard.js";
import { PrismaService } from "../../src/database/prisma.service.js";
import { AiGradingOperationsController, AiGradingOperationsService } from "../../src/domains/learning/ai/ai-grading-operations.js";

const admin = { roleCode: "SYSTEM_ADMIN", permissions: ["system:configure"], user: { id: "admin" } } as AuthenticatedSession;

describe.each([{ route: "document-answers", prefix: "ai-doc-answer:" }, { route: "extractions", prefix: "ai-doc:" }])("Document operations HTTP contract: $route", ({ route, prefix }) => {
  let app: INestApplication;
  let url: string;
  const queryRaw = vi.fn();
  const enabled = vi.fn(() => true);
  const transaction = vi.fn();
  const findUnique = vi.fn();
  const updateMany = vi.fn();
  const auditCreate = vi.fn();
  const row = { id: "a".repeat(64), ownerId: "teacher", state: "GENERATING", version: 1, createdAt: new Date("2026-09-08"), updatedAt: new Date("2026-09-08") };

  // Kiểm tra controller, service, DTO và guard thật; chỉ thay xác thực và ranh giới SQL.
  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ controllers: [AiGradingOperationsController], providers: [
      AiGradingOperationsService,
      { provide: PrismaService, useValue: { isStartupConnectionEnabled: enabled, $queryRaw: queryRaw, $transaction: transaction } },
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
    url = `${await app.getUrl()}/admin/ai-operations/${route}`;
  });
  // Đóng máy chủ kiểm thử mà không chạm dữ liệu ứng dụng.
  afterAll(async () => { await app?.close(); });
  beforeEach(() => {
    vi.resetAllMocks(); queryRaw.mockResolvedValue([row]); enabled.mockReturnValue(true); updateMany.mockResolvedValue({ count: 1 }); auditCreate.mockResolvedValue({});
    const request = { materialId: "material", version: 1, question: "Why HTTPS?", language: "EN" };
    findUnique.mockResolvedValue({ key: `${prefix}${row.id}`, value: { state: "UNCERTAIN", request }, version: 1, effectiveAt: row.createdAt, updatedBy: row.ownerId, updatedAt: row.updatedAt });
    const transactionClient = { systemSetting: { findUnique, updateMany }, auditLog: { create: auditCreate } };
    transaction.mockImplementation((callback: (client: typeof transactionClient) => Promise<unknown>) => callback(transactionClient));
  });
  // Đọc API thông tin quản lý bằng danh tính kiểm thử.
  const read = (query = "", cookie = "admin"): Promise<Response> => fetch(`${url}${query}`, { headers: { cookie } });

  it.each(["", "?state=RETRY_AUTHORIZED", "?state=GENERATING", "?state=READY", "?state=UNCERTAIN"])("reads bounded metadata without caching: %s", async (query) => {
    const response = await read(query);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ items: [JSON.parse(JSON.stringify(row))], nextCursor: null });
    expect(queryRaw).toHaveBeenCalledTimes(1);
    const sql = queryRaw.mock.calls[0]![0] as { sql: string; values: unknown[] };
    expect(sql.sql).toContain(`LIKE '${prefix}%'`);
    expect(sql.sql).not.toMatch(/\$\.(result|question|citations|pages)|SELECT\s+\*/i);
    expect(sql.values.at(-1)).toBe(21);
    if (!query) expect(sql.values).toEqual(["GENERATING", "UNCERTAIN", 21]);
  });

  it("uses an anchored timestamp/ID keyset and a single lookahead row", async () => {
    queryRaw.mockResolvedValueOnce([row]).mockResolvedValueOnce([row, { ...row, id: "older" }]);
    const response = await read(`?limit=1&state=READY&cursor=${row.id}`);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ items: [{ id: row.id }], nextCursor: row.id });
    const sql = queryRaw.mock.calls[1]![0] as { sql: string; values: unknown[] };
    expect(sql.sql).toContain("r.effective_at <");
    expect(sql.values).toEqual(["READY", row.createdAt, row.createdAt, `${prefix}${row.id}`, 2]);
  });

  it.each(["?state=FAILED", "?state=COMPLETED", "?limit=0", "?limit=51", "?limit=1.5", "?limit=1e1", "?limit=1&limit=2", "?cursor=", "?question=private", "?ownerId=teacher", "?model=override"])("rejects malformed or extra input before SQL: %s", async (query) => {
    expect((await read(query)).status).toBe(400);
    expect(queryRaw).not.toHaveBeenCalled();
  });
  it.each([["", 401], ["teacher", 403], ["no-permission", 403]])("requires system admin and configure permission: %s", async (cookie, status) => {
    expect((await read("", cookie)).status).toBe(status);
    expect(queryRaw).not.toHaveBeenCalled();
  });
  it("rejects missing cursors instead of restarting the page silently", async () => {
    queryRaw.mockResolvedValueOnce([]);
    expect((await read("?cursor=missing")).status).toBe(400);
    expect(queryRaw).toHaveBeenCalledTimes(1);
  });
  it("reports unavailable durable storage before reading", async () => {
    enabled.mockReturnValue(false);
    expect((await read()).status).toBe(503);
    expect(queryRaw).not.toHaveBeenCalled();
  });

  it("validates recovery evidence through the HTTP contract before storage", async () => {
    const endpoint = `${url}/${row.id}/reconcile-not-processed`;
    const valid = { expectedVersion: 1, evidenceReference: "provider-log-001", evidenceNote: "Provider confirms this request was neither accepted nor billed.", checkedAt: "2026-09-08T01:00:00.000Z" };
    for (const body of [{ ...valid, expectedVersion: 0 }, { ...valid, evidenceReference: "short" }, { ...valid, evidenceNote: "too short" }, { ...valid, extra: true }]) {
      expect((await fetch(endpoint, { method: "POST", headers: { cookie: "admin", "content-type": "application/json" }, body: JSON.stringify(body) })).status).toBe(400);
    }
    expect(transaction).not.toHaveBeenCalled();
  });
});
