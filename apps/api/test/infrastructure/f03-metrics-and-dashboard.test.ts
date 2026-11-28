import { BadRequestException, type ExecutionContext } from "@nestjs/common";
import { SSE_METADATA } from "@nestjs/common/constants.js";
import { Test, type TestingModule } from "@nestjs/testing";
import { of, throwError, firstValueFrom } from "rxjs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { AppModule } from "../../src/app.module.js";
import { PrismaService } from "../../src/database/prisma.service.js";
import { SystemService } from "../../src/domains/system/core/system.service.js";
import { getDashboardSummary } from "../../src/domains/system/operations/monitoring/system-monitoring.js";
import type { SystemServiceContext } from "../../src/domains/system/core/system.context.js";
import { MetricsInterceptor } from "../../src/observability/metrics.interceptor.js";
import { MetricsService } from "../../src/observability/metrics.service.js";

/** Tạo ExecutionContext giả lập tối giản cho kiểm thử MetricsInterceptor. */
function fakeHttpContext(
  method: string,
  handler: () => void,
  statusCode: number,
  requestId = "req-test",
): ExecutionContext {
  class DemoController {}
  return {
    getClass: () => DemoController,
    getHandler: () => handler,
    switchToHttp: () => ({
      getRequest: () => ({ method, requestId }),
      getResponse: () => ({ statusCode }),
    }),
  } as unknown as ExecutionContext;
}

describe("F03 Observability metrics (status, cardinality, pool, SSE, AI, worker) & aggregate dashboard", () => {
  it("MetricsInterceptor phân loại đúng mã 2xx/4xx/5xx, bỏ qua @Sse và khóa trần cardinality route", async () => {
    const metrics = new MetricsService();
    const interceptor = new MetricsInterceptor(metrics);

    // 1. Thành công 200 -> status2xxCount = 1, serverErrorCount = 0.
    function okHandler(): void { /* noop */ }
    await firstValueFrom(interceptor.intercept(fakeHttpContext("GET", okHandler, 200), { handle: () => of("ok") }));

    // 2. Lỗi 400 HttpException -> status4xxCount = 1, tuyệt đối KHÔNG tăng serverErrorCount (5xx).
    function badReqHandler(): void { /* noop */ }
    await expect(
      firstValueFrom(
        interceptor.intercept(fakeHttpContext("POST", badReqHandler, 200), {
          handle: () => throwError(() => new BadRequestException("Dữ liệu không hợp lệ.")),
        }),
      ),
    ).rejects.toThrow(BadRequestException);

    // 3. Lỗi không xác định -> serverErrorCount = 1.
    function crashHandler(): void { /* noop */ }
    await expect(
      firstValueFrom(
        interceptor.intercept(fakeHttpContext("GET", crashHandler, 200), {
          handle: () => throwError(() => new Error("DB lost")),
        }),
      ),
    ).rejects.toThrow("DB lost");

    // 4. Handler @Sse không bị ghi vào route latency HTTP.
    function sseHandler(): void { /* noop */ }
    Reflect.defineMetadata(SSE_METADATA, true, sseHandler);
    await firstValueFrom(interceptor.intercept(fakeHttpContext("GET", sseHandler, 200), { handle: () => of({ data: 1 }) }));

    // 5. Khóa trần cardinality <= 256 route riêng + 1 bucket OTHER.
    for (let idx = 0; idx < 300; idx += 1) {
      metrics.record("GET", `DynamicController.route${idx}`, 200, 1.5, `req-${idx}`);
    }

    const snap = metrics.snapshot();
    expect(snap.routes.length).toBeLessThanOrEqual(257);
    expect(snap.routes.find((r) => r.route === "GET DemoController.okHandler")).toMatchObject({
      requestCount: 1,
      status2xxCount: 1,
      status4xxCount: 0,
      serverErrorCount: 0,
    });
    expect(snap.routes.find((r) => r.route === "POST DemoController.badReqHandler")).toMatchObject({
      requestCount: 1,
      status2xxCount: 0,
      status4xxCount: 1,
      serverErrorCount: 0,
    });
    expect(snap.routes.find((r) => r.route === "GET DemoController.crashHandler")).toMatchObject({
      requestCount: 1,
      serverErrorCount: 1,
    });
    expect(snap.routes.find((r) => r.route.includes("sseHandler"))).toBeUndefined();
    expect(snap.routes.find((r) => r.route === "OTHER")?.requestCount).toBeGreaterThan(0);
  });

  it("MetricsService theo dõi chính xác kết nối SSE (idempotent release), AI calls và worker runs", () => {
    const metrics = new MetricsService();
    const releaseRealtime = metrics.trackSseConnection("realtime");
    const releaseNotif = metrics.trackSseConnection("notifications");
    expect(metrics.snapshot().sse.activeConnections).toBe(2);
    expect(metrics.snapshot().sse.byChannel.realtime).toBe(1);
    expect(metrics.snapshot().sse.byChannel.notifications).toBe(1);

    // Gọi release hai lần phải idempotent, không bị âm bộ đếm.
    releaseRealtime();
    releaseRealtime();
    expect(metrics.snapshot().sse.activeConnections).toBe(1);
    releaseNotif();
    expect(metrics.snapshot().sse.activeConnections).toBe(0);
    expect(metrics.snapshot().sse.totalOpened).toBe(2);

    metrics.recordAiCall("GRADING_ASSIST", "SUCCESS", 420.5);
    metrics.recordAiCall("GRADING_ASSIST", "ERROR", 80.2);
    metrics.recordWorkerRun("outbox", 12, 1, 55.4);
    metrics.recordWorkerRun("operational_jobs", 2, 0, 120.1);

    const snap = metrics.snapshot();
    expect(snap.ai).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ task: "GRADING_ASSIST", outcome: "SUCCESS", count: 1 }),
        expect.objectContaining({ task: "GRADING_ASSIST", outcome: "ERROR", count: 1 }),
      ]),
    );
    expect(snap.workers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ worker: "outbox", runs: 1, processed: 12, failed: 1 }),
        expect.objectContaining({ worker: "operational_jobs", runs: 1, processed: 2, failed: 0 }),
      ]),
    );
  });

  it("getDashboardSummary chỉ dùng SQL aggregate (groupBy/count/aggregate), tuyệt đối không gọi findMany tải danh sách thô", async () => {
    const findManyGuard = vi.fn(() => {
      throw new Error("Không được gọi findMany trên endpoint dashboard tổng hợp!");
    });
    const fakePrisma = {
      user: {
        groupBy: vi.fn().mockResolvedValue([
          { status: "ACTIVE", _count: { _all: 42 } },
          { status: "PENDING", _count: { _all: 3 } },
          { status: "LOCKED", _count: { _all: 1 } },
        ]),
        findMany: findManyGuard,
      },
      course: { count: vi.fn().mockResolvedValue(8), findMany: findManyGuard },
      learningClass: {
        groupBy: vi.fn().mockResolvedValue([
          { status: "ACTIVE", _count: { _all: 5 } },
          { status: "CLOSED", _count: { _all: 2 } },
        ]),
        findMany: findManyGuard,
      },
      classEnrollment: { count: vi.fn().mockResolvedValue(120), findMany: findManyGuard },
      exam: { count: vi.fn().mockResolvedValue(14), findMany: findManyGuard },
      assignment: { count: vi.fn().mockResolvedValue(22), findMany: findManyGuard },
      supportTicket: { count: vi.fn().mockResolvedValue(4), findMany: findManyGuard },
      outboxDelivery: {
        groupBy: vi.fn().mockResolvedValue([{ status: "PENDING", _count: { _all: 2 } }]),
        findMany: findManyGuard,
      },
      operationalJob: {
        groupBy: vi.fn().mockResolvedValue([
          { kind: "EXPORT", status: "PENDING", _count: { _all: 1 } },
          { kind: "AUDIT", status: "RUNNING", _count: { _all: 1 } },
          { kind: "BACKUP", status: "FAILED", _count: { _all: 2 } },
        ]),
        findMany: findManyGuard,
      },
      aiStudyDraft: { groupBy: vi.fn().mockResolvedValue([{ state: "READY", _count: { _all: 9 } }]) },
      aiGradingSuggestion: { groupBy: vi.fn().mockResolvedValue([{ state: "READY", _count: { _all: 6 } }]) },
      aiDocumentAnswer: { groupBy: vi.fn().mockResolvedValue([{ state: "READY", _count: { _all: 15 } }]) },
      aiGenerationRequest: { groupBy: vi.fn().mockResolvedValue([{ state: "COMPLETED", _count: { _all: 3 } }]) },
      material: {
        aggregate: vi.fn().mockResolvedValue({ _sum: { sizeBytes: 50_000_000n }, _count: { _all: 35 } }),
        findMany: findManyGuard,
      },
    };
    const ctx = {
      database: () => fakePrisma,
      getSettings: () => Promise.resolve({ storageQuotaMb: 1000 }),
    } as unknown as SystemServiceContext;

    const summary = await getDashboardSummary(ctx, new MetricsService());
    expect(findManyGuard).not.toHaveBeenCalled();
    expect(summary.users).toEqual({ total: 46, active: 42, pending: 3, locked: 1 });
    expect(summary.academic).toEqual({
      courses: 8,
      classes: 7,
      activeClasses: 5,
      activeEnrollments: 120,
      exams: 14,
      assignments: 22,
      openTickets: 4,
    });
    expect(summary.jobs).toMatchObject({ pending: 1, running: 1, failed: 2 });
    expect(summary.storage).toEqual({
      quotaBytes: 1_000_000_000,
      usedBytes: 50_000_000,
      usagePercent: 5,
      materialCount: 35,
    });
  });

  const dbEnabled = (process.env.DB_NAME ?? "").endsWith("_test");
  describe.skipIf(!dbEnabled)("tích hợp PostgreSQL thật cho DB pool metrics và dashboard-summary", () => {
    let moduleRef: TestingModule;
    let systemService: SystemService;
    let metricsService: MetricsService;
    let prisma: PrismaService;

    beforeAll(async () => {
      moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
      systemService = moduleRef.get(SystemService);
      metricsService = moduleRef.get(MetricsService);
      prisma = moduleRef.get(PrismaService);
    });

    afterAll(async () => {
      if (moduleRef) await moduleRef.close();
    });

    it("đọc live pg.Pool stats và tổng hợp dashboard-summary trực tiếp từ PostgreSQL test", async () => {
      await prisma.$queryRaw`SELECT 1`;
      const metricsSnap = metricsService.snapshot();
      expect(metricsSnap.databasePool.enabled).toBe(true);
      expect(metricsSnap.databasePool.max).toBeGreaterThan(0);
      expect(metricsSnap.databasePool.totalCount).toBeGreaterThanOrEqual(1);

      const summary = await systemService.getDashboardSummary();
      expect(summary.database).toBe("connected");
      expect(summary.users.total).toBeGreaterThan(0);
      expect(summary.runtime.databasePool.max).toBeGreaterThan(0);
    });
  });
});
