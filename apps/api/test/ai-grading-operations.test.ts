import { UnauthorizedException, ValidationPipe, type INestApplication } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { Test } from "@nestjs/testing";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthService, type AuthenticatedSession } from "../src/auth/auth.service.js";
import { PermissionGuard } from "../src/auth/permission.guard.js";
import { PrismaService } from "../src/database/prisma.service.js";
import type { Prisma } from "../src/generated/prisma/client.js";
import { AiGradingOperationsController, AiGradingOperationsService } from "../src/domains/learning/ai-grading-operations.js";

const admin = { roleCode: "SYSTEM_ADMIN", permissions: ["system:configure"], user: { id: "admin" } } as AuthenticatedSession;
describe.each(["grading", "study"])("AI %s operations with HTTP validation and real authorization service", (domain) => {
  const record = { id: "claim", ownerId: "teacher", ...(domain === "grading" ? { submissionId: "submission", language: "VI" } : { materialId: "material", sourceVersion: 2 }), state: "GENERATING", createdAt: new Date("2026-09-08"), updatedAt: new Date("2026-09-08") };
  let app: INestApplication;
  let url: string;
  const enabled = vi.fn(() => true);
  const findMany = vi.fn<(args: Prisma.AiGradingSuggestionFindManyArgs) => Promise<Array<typeof record>>>();
  const findUnique = vi.fn();
  const updateMany = vi.fn();
  const auditCreate = vi.fn();
  const transaction = vi.fn();

  // Chạy route, guard, DTO và service thật; chỉ giả lập authentication và biên database.
  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ controllers: [AiGradingOperationsController], providers: [
      AiGradingOperationsService,
      { provide: PrismaService, useValue: { isStartupConnectionEnabled: enabled, $transaction: transaction, [domain === "grading" ? "aiGradingSuggestion" : "aiStudyDraft"]: { findMany, findUnique, updateMany } } },
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
    url = `${await app.getUrl()}/admin/ai-operations/${domain}`;
  });
  // Đóng HTTP server test sau khi hoàn thành.
  afterAll(async () => { await app?.close(); });
  // Mỗi ca có storage và số lần gọi độc lập.
  beforeEach(() => {
    vi.resetAllMocks();
    enabled.mockReturnValue(true);
    findMany.mockResolvedValue([record]);
    findUnique.mockResolvedValue(null);
    updateMany.mockResolvedValue({ count: 1 });
    auditCreate.mockResolvedValue({});
    const transactionClient = { [domain === "grading" ? "aiGradingSuggestion" : "aiStudyDraft"]: { findUnique, updateMany }, auditLog: { create: auditCreate } };
    transaction.mockImplementation((callback: (client: typeof transactionClient) => Promise<unknown>) => callback(transactionClient));
  });
  // Gửi yêu cầu đọc metadata, không có phương thức mutation.
  const read = (query = "", cookie = "admin"): Promise<Response> => fetch(`${url}${query}`, { headers: { cookie } });
  // Gửi bằng chứng mở lại claim chấm; route khác không được gắn mutation này.
  const reconcile = (body: object, cookie = "admin"): Promise<Response> => fetch(`${url}/claim/reconcile-not-processed`, { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify(body) });

  it("returns bounded metadata with no-store and defaults to unresolved states", async () => {
    const response = await read();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ items: [JSON.parse(JSON.stringify(record))], nextCursor: null });
    const args = findMany.mock.calls[0]?.[0];
    expect(args?.take).toBe(21);
    expect(args?.where?.state).toEqual({ in: ["GENERATING", "UNCERTAIN"] });
    expect(args?.select).toEqual({ id: true, ownerId: true, ...(domain === "grading" ? { submissionId: true, language: true } : { materialId: true, sourceVersion: true }), state: true, createdAt: true, updatedAt: true });
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

  it.runIf(domain === "grading")("validates and protects grading recovery before opening a transaction", async () => {
    const valid = { expectedUpdatedAt: "2026-09-08T00:00:00.000Z", evidenceReference: "provider-log-001", evidenceNote: "Provider confirms this request was neither accepted nor billed.", checkedAt: "2026-09-08T01:00:00.000Z" };
    for (const body of [{ ...valid, evidenceReference: "short" }, { ...valid, evidenceNote: "too short" }, { ...valid, expectedUpdatedAt: "invalid" }, { ...valid, extra: true }]) {
      expect((await reconcile(body)).status).toBe(400);
    }
    expect(transaction).not.toHaveBeenCalled();
    for (const [cookie, status] of [["", 401], ["teacher", 403], ["unprivileged", 403]] as const) expect((await reconcile(valid, cookie)).status).toBe(status);
    expect(transaction).not.toHaveBeenCalled();
  });

  it.runIf(domain === "grading")("accepts complete grading evidence through the HTTP contract", async () => {
    const uncertain = { ...record, state: "UNCERTAIN", updatedAt: new Date("2026-09-08T00:00:00.000Z") };
    findUnique.mockResolvedValue(uncertain);
    const response = await reconcile({ expectedUpdatedAt: uncertain.updatedAt.toISOString(), evidenceReference: "provider-log-001", evidenceNote: "Provider confirms this request was neither accepted nor billed.", checkedAt: "2026-09-08T01:00:00.000Z" });
    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toMatchObject({ id: "claim", state: "RETRY_AUTHORIZED" });
    expect(auditCreate).toHaveBeenCalledOnce();
  });

  it.runIf(domain === "study")("accepts complete study evidence and keeps published state private", async () => {
    const uncertain = { ...record, state: "UNCERTAIN", publishedAt: null, updatedAt: new Date("2026-09-08T00:00:00.000Z") };
    findUnique.mockResolvedValue(uncertain);
    const response = await reconcile({ expectedUpdatedAt: uncertain.updatedAt.toISOString(), evidenceReference: "provider-log-001", evidenceNote: "Provider confirms this request was neither accepted nor billed.", checkedAt: "2026-09-08T01:00:00.000Z" });
    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = await response.json() as Record<string, unknown>;
    expect(body).toMatchObject({ id: "claim", state: "RETRY_AUTHORIZED" });
    expect(body).not.toHaveProperty("publishedAt");
    expect(auditCreate).toHaveBeenCalledOnce();
  });
});
