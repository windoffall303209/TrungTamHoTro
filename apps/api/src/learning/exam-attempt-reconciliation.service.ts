import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { LearningService } from "./learning.service.js";

@Injectable()
/** Định kỳ nộp các lượt thi đã quá hạn để trạng thái không phụ thuộc trình duyệt học viên. */
export class ExamAttemptReconciliationService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ExamAttemptReconciliationService.name);
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(private readonly learning: LearningService) {}

  /** Chạy một lượt ngay khi khởi động và đăng ký sweep mỗi phút. */
  onModuleInit(): void {
    this.timer = setInterval(() => void this.sweep(), 30_000);
    this.timer.unref();
    void this.sweep();
  }

  /** Hủy timer khi Nest đóng module để tiến trình có thể thoát sạch. */
  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** Gọi LearningService hòa giải; khóa running ngăn hai lượt sweep chồng nhau. */
  private async sweep(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const count = await this.learning.reconcileExpiredAttempts();
      if (count) this.logger.log(`Đã tự động nộp ${count} lượt làm bài hết thời gian.`);
    } catch (error) {
      this.logger.error("Không thể đối soát lượt làm bài hết thời gian.", error instanceof Error ? error.stack : String(error));
    } finally {
      this.running = false;
    }
  }
}
