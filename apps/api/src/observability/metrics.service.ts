import { Injectable, Logger, Optional } from "@nestjs/common";
import type {
  AiCallMetric,
  DatabasePoolMetrics,
  ObservabilityMetricsSnapshot,
  SseMetrics,
  WorkerRunMetric,
} from "@wind-of-fall/contracts";
import { DatabaseEventsService } from "../database/database-events.service.js";
import { PrismaService } from "../database/prisma.service.js";
import { getActiveDownloadCount } from "../infrastructure/verified-download.js";

interface RouteMetric {
  count: number;
  status2xx: number;
  status4xx: number;
  errors5xx: number;
  totalDurationMs: number;
  maxDurationMs: number;
}

interface AiCounter {
  task: AiCallMetric["task"];
  outcome: AiCallMetric["outcome"];
  count: number;
  totalDurationMs: number;
  maxDurationMs: number;
}

interface WorkerCounter {
  worker: WorkerRunMetric["worker"];
  runs: number;
  processed: number;
  failed: number;
  totalDurationMs: number;
  maxDurationMs: number;
  lastRunAt?: string;
}

export type SseChannelKind = "realtime" | "notifications" | "chat" | "operations";
export type AiMetricTask = AiCallMetric["task"];
export type AiMetricOutcome = AiCallMetric["outcome"];
export type WorkerMetricName = WorkerRunMetric["worker"];

const MAX_ROUTE_CARDINALITY = 256;
const OVERFLOW_ROUTE_KEY = "OTHER";

/** Làm tròn số thực độ trễ về 2 chữ số thập phân và chặn giá trị âm/NaN. */
function roundDurationMs(durationMs: number): number {
  const safe = Number.isFinite(durationMs) && durationMs > 0 ? durationMs : 0;
  return Math.round(safe * 100) / 100;
}

@Injectable()
/** Lưu metric HTTP, DB pool, SSE, AI và worker nền với cardinality hữu hạn, phát log có cấu trúc cho từng request. */
export class MetricsService {
  private readonly logger = new Logger("HTTP");
  private readonly startedAt = Date.now();
  private readonly routes = new Map<string, RouteMetric>();
  private readonly aiCalls = new Map<string, AiCounter>();
  private readonly workers = new Map<WorkerMetricName, WorkerCounter>();
  private readonly sseActiveByChannel: Record<SseChannelKind, number> = {
    realtime: 0,
    notifications: 0,
    chat: 0,
    operations: 0,
  };
  private sseTotalOpened = 0;

  constructor(
    @Optional() private readonly prisma?: PrismaService,
    @Optional() private readonly databaseEvents?: DatabaseEventsService,
  ) {}

  /** Cộng dồn lượt gọi, nhóm mã trạng thái (2xx/4xx/5xx) và latency theo khóa route hữu hạn. */
  record(
    method: string,
    route: string,
    statusCode: number,
    durationMs: number,
    requestId: string,
  ): void {
    const normalizedMethod = (method || "UNKNOWN").toUpperCase().slice(0, 16);
    const candidateKey = `${normalizedMethod} ${route.slice(0, 120)}`;
    const key =
      this.routes.has(candidateKey) || this.routes.size < MAX_ROUTE_CARDINALITY
        ? candidateKey
        : OVERFLOW_ROUTE_KEY;
    const current = this.routes.get(key) ?? {
      count: 0,
      status2xx: 0,
      status4xx: 0,
      errors5xx: 0,
      totalDurationMs: 0,
      maxDurationMs: 0,
    };
    const safeDuration = Number.isFinite(durationMs) && durationMs >= 0 ? durationMs : 0;
    current.count += 1;
    if (statusCode >= 500) current.errors5xx += 1;
    else if (statusCode >= 400) current.status4xx += 1;
    else if (statusCode >= 200 && statusCode < 300) current.status2xx += 1;
    current.totalDurationMs += safeDuration;
    current.maxDurationMs = Math.max(current.maxDurationMs, safeDuration);
    this.routes.set(key, current);
    this.logger.log(
      JSON.stringify({
        event: "http_request",
        requestId,
        method: normalizedMethod,
        route,
        statusCode,
        durationMs: roundDurationMs(safeDuration),
        timestamp: new Date().toISOString(),
      }),
    );
  }

  /** Ghi nhận một kết nối SSE đang mở theo loại kênh hữu hạn và trả hàm giải phóng idempotent. */
  trackSseConnection(channel: SseChannelKind): () => void {
    this.sseActiveByChannel[channel] += 1;
    this.sseTotalOpened += 1;
    let released = false;
    // Giảm bộ đếm đúng một lần khi luồng SSE hoàn tất, lỗi hoặc client ngắt kết nối.
    return (): void => {
      if (released) return;
      released = true;
      this.sseActiveByChannel[channel] = Math.max(0, this.sseActiveByChannel[channel] - 1);
    };
  }

  /** Ghi nhận lời gọi AI theo cặp (task, outcome) hữu hạn, không lưu userId hay nội dung prompt. */
  recordAiCall(task: AiMetricTask, outcome: AiMetricOutcome, durationMs: number): void {
    const key = `${task}:${outcome}`;
    const current = this.aiCalls.get(key) ?? {
      task,
      outcome,
      count: 0,
      totalDurationMs: 0,
      maxDurationMs: 0,
    };
    const safeDuration = Number.isFinite(durationMs) && durationMs >= 0 ? durationMs : 0;
    current.count += 1;
    current.totalDurationMs += safeDuration;
    current.maxDurationMs = Math.max(current.maxDurationMs, safeDuration);
    this.aiCalls.set(key, current);
  }

  /** Ghi nhận một lượt chạy của worker nền (outbox, operational_jobs, exam_reconciliation). */
  recordWorkerRun(
    worker: WorkerMetricName,
    processed: number,
    failed: number,
    durationMs: number,
  ): void {
    const current = this.workers.get(worker) ?? {
      worker,
      runs: 0,
      processed: 0,
      failed: 0,
      totalDurationMs: 0,
      maxDurationMs: 0,
    };
    const safeDuration = Number.isFinite(durationMs) && durationMs >= 0 ? durationMs : 0;
    current.runs += 1;
    current.processed += Math.max(0, Math.trunc(processed));
    current.failed += Math.max(0, Math.trunc(failed));
    current.totalDurationMs += safeDuration;
    current.maxDurationMs = Math.max(current.maxDurationMs, safeDuration);
    current.lastRunAt = new Date().toISOString();
    this.workers.set(worker, current);
  }

  /** Đọc số liệu DB pool hiện hành hoặc trả trạng thái tắt khi không có PrismaService. */
  getDatabasePoolMetrics(): DatabasePoolMetrics {
    if (typeof this.prisma?.getPoolStats === "function") {
      return this.prisma.getPoolStats();
    }
    return {
      enabled: false,
      max: 0,
      totalCount: 0,
      idleCount: 0,
      activeCount: 0,
      waitingCount: 0,
    };
  }

  /** Tổng hợp số kết nối SSE đang mở cùng trạng thái listener PostgreSQL LISTEN/NOTIFY. */
  getSseMetrics(): SseMetrics {
    const bus =
      typeof this.databaseEvents?.getMetrics === "function"
        ? this.databaseEvents.getMetrics()
        : {
            listenerConnected: false,
            listenerReconnects: 0,
            activeBusWatchers: 0,
            eventsReceived: 0,
          };
    const activeConnections =
      this.sseActiveByChannel.realtime +
      this.sseActiveByChannel.notifications +
      this.sseActiveByChannel.chat +
      this.sseActiveByChannel.operations;
    return {
      activeConnections,
      totalOpened: this.sseTotalOpened,
      byChannel: { ...this.sseActiveByChannel },
      ...bus,
    };
  }

  /** Chụp toàn bộ metric tiến trình, pool DB, SSE, AI, worker và route ở dạng serializable cho vận hành. */
  snapshot(): ObservabilityMetricsSnapshot {
    const memory = process.memoryUsage();
    return {
      startedAt: new Date(this.startedAt).toISOString(),
      uptimeSeconds: Math.round(process.uptime()),
      process: {
        rssBytes: memory.rss,
        heapUsedBytes: memory.heapUsed,
        heapTotalBytes: memory.heapTotal,
      },
      databasePool: this.getDatabasePoolMetrics(),
      sse: this.getSseMetrics(),
      ai: [...this.aiCalls.values()]
        .map((entry) => ({
          task: entry.task,
          outcome: entry.outcome,
          count: entry.count,
          averageDurationMs: entry.count ? roundDurationMs(entry.totalDurationMs / entry.count) : 0,
          maxDurationMs: roundDurationMs(entry.maxDurationMs),
        }))
        .sort((a, b) => b.count - a.count),
      workers: [...this.workers.values()]
        .map((entry) => ({
          worker: entry.worker,
          runs: entry.runs,
          processed: entry.processed,
          failed: entry.failed,
          averageDurationMs: entry.runs ? roundDurationMs(entry.totalDurationMs / entry.runs) : 0,
          maxDurationMs: roundDurationMs(entry.maxDurationMs),
          lastRunAt: entry.lastRunAt,
        }))
        .sort((a, b) => a.worker.localeCompare(b.worker)),
      transfers: {
        activeDownloads: getActiveDownloadCount(),
      },
      routes: [...this.routes.entries()]
        .map(([route, value]) => ({
          route,
          requestCount: value.count,
          status2xxCount: value.status2xx,
          status4xxCount: value.status4xx,
          serverErrorCount: value.errors5xx,
          averageDurationMs: value.count ? roundDurationMs(value.totalDurationMs / value.count) : 0,
          maxDurationMs: roundDurationMs(value.maxDurationMs),
        }))
        .sort((a, b) => b.requestCount - a.requestCount),
    };
  }
}
