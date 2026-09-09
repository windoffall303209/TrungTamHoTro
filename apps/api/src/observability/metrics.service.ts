import { Injectable, Logger } from "@nestjs/common";

interface RouteMetric { count: number; errors: number; totalDurationMs: number; maxDurationMs: number }

@Injectable()
/** Lưu metric HTTP trong bộ nhớ tiến trình và phát structured log cho từng request. */
export class MetricsService {
  private readonly logger = new Logger("HTTP");
  private readonly startedAt = Date.now();
  private readonly routes = new Map<string, RouteMetric>();

  /** Cộng dồn count, lỗi 5xx và latency theo cặp method/handler rồi ghi log tương quan. */
  record(method: string, route: string, statusCode: number, durationMs: number, requestId: string): void {
    const key = `${method} ${route}`;
    const current = this.routes.get(key) ?? { count: 0, errors: 0, totalDurationMs: 0, maxDurationMs: 0 };
    current.count += 1;
    current.errors += statusCode >= 500 ? 1 : 0;
    current.totalDurationMs += durationMs;
    current.maxDurationMs = Math.max(current.maxDurationMs, durationMs);
    this.routes.set(key, current);
    this.logger.log(JSON.stringify({ event: "http_request", requestId, method, route, statusCode, durationMs, timestamp: new Date().toISOString() }));
  }

  /** Chụp metric tiến trình và thống kê route ở dạng serializable cho trang vận hành. */
  snapshot(): object {
    const memory = process.memoryUsage();
    return {
      startedAt: new Date(this.startedAt).toISOString(),
      uptimeSeconds: Math.round(process.uptime()),
      process: { rssBytes: memory.rss, heapUsedBytes: memory.heapUsed, heapTotalBytes: memory.heapTotal },
      routes: [...this.routes.entries()].map(([route, value]) => ({
        route,
        requestCount: value.count,
        serverErrorCount: value.errors,
        averageDurationMs: value.count ? Math.round(value.totalDurationMs / value.count * 100) / 100 : 0,
        maxDurationMs: Math.round(value.maxDurationMs * 100) / 100,
      })).sort((a, b) => b.requestCount - a.requestCount),
    };
  }
}
