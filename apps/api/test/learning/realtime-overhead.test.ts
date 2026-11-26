import "reflect-metadata";
import { BadRequestException, type CallHandler, type ExecutionContext } from "@nestjs/common";
import { SSE_METADATA } from "@nestjs/common/constants.js";
import { lastValueFrom, of, throwError } from "rxjs";
import { describe, expect, it, vi } from "vitest";
import { createLearningTestRuntime } from "../../src/domains/learning/core/learning-runtime.service.js";
import { EngagementSupportService } from "../../src/domains/learning/engagement/engagement-support.service.js";
import { MetricsInterceptor } from "../../src/observability/metrics.interceptor.js";
import type { MetricsService } from "../../src/observability/metrics.service.js";

/** Controller giả có một handler thường và một handler SSE. */
class FakeController {
  /** Handler HTTP thông thường. */
  list(this: void): void {}
  /** Handler luồng sự kiện. */
  events(this: void): void {}
}
Reflect.defineMetadata(SSE_METADATA, true, FakeController.prototype.events);

/** Tạo ExecutionContext tối thiểu cho interceptor. */
function context(handler: "list" | "events", statusCode = 200): ExecutionContext {
  return {
    getClass: () => FakeController,
    getHandler: () => FakeController.prototype[handler],
    switchToHttp: () => ({ getRequest: () => ({ method: "GET", requestId: "req-1" }), getResponse: () => ({ statusCode }) }),
  } as unknown as ExecutionContext;
}

describe("Giảm tải luồng thời gian thực", () => {
  it("không ghi metric cho luồng @Sse và ghi đúng mã lỗi của exception", async () => {
    const record = vi.fn();
    const interceptor = new MetricsInterceptor({ record } as unknown as MetricsService);
    await lastValueFrom(interceptor.intercept(context("events"), { handle: () => of(1, 2, 3) } as CallHandler));
    expect(record).not.toHaveBeenCalled();
    await expect(lastValueFrom(interceptor.intercept(context("list"), { handle: () => throwError(() => new BadRequestException("x")) } as CallHandler))).rejects.toThrow();
    expect(record).toHaveBeenCalledWith("GET", "FakeController.list", 400, expect.any(Number), "req-1");
    record.mockClear();
    await lastValueFrom(interceptor.intercept(context("list"), { handle: () => of({ ok: true }) } as CallHandler));
    expect(record).toHaveBeenCalledOnce();
  });

  it("đánh dấu tất cả thông báo đã đọc trong một lệnh", async () => {
    const runtime = createLearningTestRuntime();
    const service = new EngagementSupportService(runtime);
    for (const id of ["n-read-all-1", "n-read-all-2"])
      runtime.memoryState.notifications.unshift({ id, recipientId: "usr-read-all", type: "INFO", title: id, entityType: "CLASS", entityId: "class-web-01", createdAt: new Date().toISOString() });
    expect((await service.listNotifications("usr-read-all")).some((item) => !item.readAt)).toBe(true);
    const after = await service.markAllNotificationsRead("usr-read-all");
    expect(after).toHaveLength(2);
    expect(after.every((item) => item.readAt)).toBe(true);
  });
});
