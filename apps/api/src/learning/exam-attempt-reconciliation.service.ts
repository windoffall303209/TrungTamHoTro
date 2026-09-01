import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { LearningService } from "./learning.service.js";

@Injectable()
export class ExamAttemptReconciliationService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ExamAttemptReconciliationService.name);
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(private readonly learning: LearningService) {}

  onModuleInit(): void {
    this.timer = setInterval(() => void this.sweep(), 30_000);
    this.timer.unref();
    void this.sweep();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

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
