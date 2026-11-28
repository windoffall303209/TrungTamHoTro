import { Injectable, Logger, Optional, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { MetricsService } from "../../../observability/metrics.service.js";
import { ExamAssessmentService } from "./exam-assessment.service.js";

@Injectable()
/** Định kỳ nộp các lượt thi đã quá hạn để trạng thái không phụ thuộc trình duyệt học viên. */
export class ExamAttemptReconciliationService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ExamAttemptReconciliationService.name);
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    private readonly exams: ExamAssessmentService,
    @Optional() private readonly metrics?: MetricsService,
  ) {}

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

  /** Gọi ExamAssessmentService hòa giải; khóa running ngăn hai lượt sweep chồng nhau. */
  private async sweep(): Promise<void> {
    if (this.running) return;
    this.running = true;
    const startedAt = performance.now();
    let processed = 0;
    let failed = 0;
    try {
      const count = await this.exams.reconcileExpiredAttempts();
      processed = count;
      if (count) this.logger.log(`Đã tự động nộp ${count} lượt làm bài hết thời gian.`);
    } catch (error) {
      failed = 1;
      this.logger.error("Không thể đối soát lượt làm bài hết thời gian.", error instanceof Error ? error.stack : String(error));
    } finally {
      this.metrics?.recordWorkerRun("exam_reconciliation", processed, failed, performance.now() - startedAt);
      this.running = false;
    }
  }
}
