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
  const transaction = vi.fn();
  const enabled = vi.fn(() => true);

  // Dùng controller, service, guard và DTO thật; mock đúng biên auth và SQL.
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
    url = `${await app.getUrl()}/admin/ai-operations/exams`;
  });
  // Đóng server test, không để lại cổng nền.
  afterAll(async () => { await app?.close(); });
  beforeEach(() => { vi.resetAllMocks(); queryRaw.mockResolvedValue([]); enabled.mockReturnValue(true); });
  // Đọc endpoint metadata với cookie fixture.
  const read = (query = "", cookie = "admin"): Promise<Response> => fetch(`${url}${query}`, { headers: { cookie } });
  // Gửi lệnh đối soát có validation/guard thật; transaction chỉ chạy khi payload và quyền hợp lệ.
  const reconcile = (id: string, body: object, cookie = "admin"): Promise<Response> => fetch(`${url}/${id}/reconcile-not-processed`, { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify(body) });

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

  it.each(["canonical", "unlinked", "broken"])("supports explicit %s scope with the same read-only contract", async (scope) => {
    const response = await read(`?scope=${scope}&state=CLAIMED`);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(queryRaw).toHaveBeenCalledTimes(1);
    const sql = queryRaw.mock.calls[0]![0] as { sql: string };
    if (scope === "canonical") {
      expect(sql.sql).toContain("SELECT DISTINCT");
      expect(sql.sql).toContain("JOIN system_settings r");
    } else expect(sql.sql).toContain(scope === "unlinked" ? "NOT EXISTS" : "AND EXISTS");
    if (scope === "broken") expect(sql.sql).toContain("FROM system_settings target");
  });

  it("fails explicitly when durable storage is disabled", async () => {
    enabled.mockReturnValue(false);
    expect((await read()).status).toBe(503);
    expect(queryRaw).not.toHaveBeenCalled();
  });

  it.each([
    [{ expectedVersion: 1, evidenceReference: "short", evidenceNote: "Provider did not process this request.", checkedAt: "2026-09-09T00:00:00.000Z" }],
    [{ expectedVersion: 0, evidenceReference: "provider-log-123", evidenceNote: "Provider did not process this request.", checkedAt: "2026-09-09T00:00:00.000Z" }],
    [{ expectedVersion: 1, evidenceReference: "provider-log-123", evidenceNote: "too short", checkedAt: "2026-09-09T00:00:00.000Z" }],
    [{ expectedVersion: 1, evidenceReference: "provider-log-123", evidenceNote: "Provider did not process this request.", checkedAt: "not-a-date" }],
    [{ expectedVersion: 1, evidenceReference: "provider-log-123", evidenceNote: "Provider did not process this request.", checkedAt: "2026-09-09T00:00:00.000Z", extra: true }],
  ])("rejects incomplete reconciliation evidence before transaction: %#", async (body) => {
    expect((await reconcile("request-1", body)).status).toBe(400);
    expect(transaction).not.toHaveBeenCalled();
  });

  it.each([["", 401], ["teacher", 403], ["no-permission", 403]])("protects reconciliation from unauthorized callers: %s", async (cookie, status) => {
    const response = await reconcile("request-1", { expectedVersion: 1, evidenceReference: "provider-log-123", evidenceNote: "Provider logs confirm that this request was not processed.", checkedAt: "2026-09-09T00:00:00.000Z" }, cookie);
    expect(response.status).toBe(status);
    expect(transaction).not.toHaveBeenCalled();
  });
});

describe("Exam claim evidence reconciliation", () => {
  const updatedAt = new Date("2026-09-08T01:00:00.000Z");
  const row = { key: "ai-generation:request-1", version: 4, updatedAt, effectiveAt: new Date("2026-09-08T00:00:00.000Z"), value: { owner: "teacher-1", hash: "a".repeat(64), state: "UNCERTAIN" } };
  const findUnique = vi.fn();
  const updateMany = vi.fn();
  const queryRaw = vi.fn();
  const auditCreate = vi.fn<(args: { data: { actorId: string; action: string; entityId: string; context: Record<string, unknown> } }) => Promise<object>>();
  const transaction = vi.fn();
  const database = { isStartupConnectionEnabled: () => true, $transaction: transaction } as unknown as PrismaService;
  const service = new AiGradingOperationsService(database);
  const input = { expectedVersion: 4, evidenceReference: "provider-log-20260908-001", evidenceNote: "Provider dashboard confirms no request was accepted or billed.", checkedAt: "2026-09-08T02:00:00.000Z", providerRequestId: "provider-request-1" };

  beforeEach(() => {
    vi.resetAllMocks();
    findUnique.mockResolvedValue(row);
    updateMany.mockResolvedValue({ count: 1 });
    queryRaw.mockResolvedValue([{ present: 1 }]);
    auditCreate.mockResolvedValue({});
    const transactionClient = { systemSetting: { findUnique, updateMany }, $queryRaw: queryRaw, auditLog: { create: auditCreate } };
    transaction.mockImplementation((callback: (client: typeof transactionClient) => Promise<unknown>) => callback(transactionClient));
  });

  it("reopens a canonical claim with CAS and writes the complete evidence audit atomically", async () => {
    const result = await service.reconcileExamNotProcessed("request-1", input, admin);
    expect(result).toMatchObject({ id: "request-1", ownerId: "teacher-1", state: "CLAIMED", version: 5 });
    expect(updateMany).toHaveBeenCalledWith({ where: { key: row.key, version: 4 }, data: { value: { owner: "teacher-1", hash: "a".repeat(64), state: "CLAIMED" }, version: { increment: 1 }, updatedBy: "admin" } });
    const audit = auditCreate.mock.calls[0]?.[0].data;
    expect(audit).toMatchObject({ actorId: "admin", action: "AI_EXAM_RETRY_AUTHORIZED", entityId: "request-1" });
    expect(audit?.context).toMatchObject({ previousState: "UNCERTAIN", previousVersion: 4, evidenceReference: input.evidenceReference, providerRequestId: input.providerRequestId });
  });

  it.each([
    ["changed version", { ...input, expectedVersion: 3 }, row, [{ present: 1 }], { count: 1 }],
    ["unsafe state", input, { ...row, value: { ...row.value, state: "READY" } }, [{ present: 1 }], { count: 1 }],
    ["missing canonical binding", input, row, [], { count: 1 }],
    ["stale evidence", { ...input, checkedAt: "2026-09-08T00:30:00.000Z" }, row, [{ present: 1 }], { count: 1 }],
    ["CAS race", input, row, [{ present: 1 }], { count: 0 }],
  ])("refuses %s without an audit record", async (_name, currentInput, currentRow, bindings, update) => {
    findUnique.mockResolvedValue(currentRow);
    queryRaw.mockResolvedValue(bindings);
    updateMany.mockResolvedValue(update);
    await expect(service.reconcileExamNotProcessed("request-1", currentInput as typeof input, admin)).rejects.toThrow();
    expect(auditCreate).not.toHaveBeenCalled();
  });
});
