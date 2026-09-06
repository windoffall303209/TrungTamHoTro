import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { SystemService } from "./system.service.js";

@Injectable()
/** Chạy hàng đợi backup, export và retention định kỳ, không cho hai vòng xử lý chồng nhau. */
export class OperationalJobWorkerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OperationalJobWorkerService.name);
  private timer?: NodeJS.Timeout;
  private draining = false;

  constructor(private readonly system: SystemService) {}

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
  async drain(): Promise<{ backup: number; export: number; retention: number }> {
    if (this.draining) return { backup: 0, export: 0, retention: 0 };
    this.draining = true;
    try {
      return await this.system.drainOperationalJobs();
    } catch (error) {
      this.logger.error(error instanceof Error ? error.message : "Không thể quét hàng đợi vận hành.");
      return { backup: 0, export: 0, retention: 0 };
    } finally {
      this.draining = false;
    }
  }
}
