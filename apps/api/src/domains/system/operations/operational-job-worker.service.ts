import { Injectable, Logger, OnModuleDestroy, OnModuleInit, Optional } from "@nestjs/common";
import { MetricsService } from "../../../observability/metrics.service.js";
import { SystemService } from "../core/system.service.js";

@Injectable()
/** Chạy hàng đợi backup và export định kỳ trên operational_jobs, không cho hai vòng xử lý chồng nhau. */
export class OperationalJobWorkerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OperationalJobWorkerService.name);
  private timer?: NodeJS.Timeout;
  private draining = false;

  constructor(
    private readonly system: SystemService,
    @Optional() private readonly metrics?: MetricsService,
  ) {}

  /** Khởi động worker ngay khi module sẵn sàng và tiếp tục quét mỗi năm giây. */
  onModuleInit(): void {
    this.timer = setInterval(() => { void this.drain(); }, 5_000);
    this.timer.unref();
    void this.drain();
  }

  /** Dừng timer khi ứng dụng shutdown để không nhận thêm công việc. */
  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** Xử lý một batch an toàn và ghi lỗi đã thu gọn để vòng worker kế tiếp vẫn tiếp tục. */
  async drain(): Promise<{ backup: number; export: number; audit: number }> {
    if (this.draining) return { backup: 0, export: 0, audit: 0 };
    this.draining = true;
    const startedAt = performance.now();
    let processed = 0;
    let failed = 0;
    try {
      const result = await this.system.drainOperationalJobs();
      processed = result.backup + result.export + result.audit;
      return result;
    } catch (error) {
      failed = 1;
      this.logger.error(error instanceof Error ? error.message : "Không thể quét hàng đợi vận hành.");
      return { backup: 0, export: 0, audit: 0 };
    } finally {
      this.metrics?.recordWorkerRun("operational_jobs", processed, failed, performance.now() - startedAt);
      this.draining = false;
    }
  }
}
