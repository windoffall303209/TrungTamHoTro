import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { PrismaService } from "../database/prisma.service.js";
import { EmailDeliveryService } from "./email-delivery.service.js";

@Injectable()
/** Chuyển outbox delivery sang email thật với claim nguyên tử, retry tăng dần và dedup provider. */
export class OutboxDeliveryService implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout;
  private draining = false;
  private readonly logger = new Logger(OutboxDeliveryService.name);
  private readonly leaseMs = 5 * 60_000;

  constructor(private readonly prisma: PrismaService, private readonly email: EmailDeliveryService) {}

  /** Bật worker định kỳ chỉ khi email provider đã cấu hình, tránh vòng retry vô ích ở môi trường dev. */
  onModuleInit(): void {
    if (!this.emailReady()) return;
    this.timer = setInterval(() => { this.runSafely(); }, 5_000);
    this.timer.unref();
    this.runSafely();
  }

  /** Dừng timer khi ứng dụng shutdown để không giữ tiến trình hoặc nhận job mới. */
  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** Trả số delivery theo trạng thái để vận hành theo dõi tồn đọng và lỗi. */
  async stats(): Promise<Record<string, number>> {
    const groups = await this.prisma.outboxDelivery.groupBy({ by: ["status"], _count: { _all: true } });
    return Object.fromEntries(groups.map((group) => [group.status, group._count._all]));
  }

  /** Claim tối đa một batch, gửi email và lập lịch retry mà không đánh dấu enqueue thành delivered. */
  async drain(limit = 25): Promise<{ processed: number; delivered: number; failed: number }> {
    if (this.draining || !this.emailReady()) return { processed: 0, delivered: 0, failed: 0 };
    this.draining = true;
    let delivered = 0;
    let failed = 0;
    try {
      const platformRow = await this.prisma.systemSetting?.findUnique?.({ where: { key: "platform" } }).catch(() => null);
      const platformSettings = (platformRow?.value as Record<string, unknown>) ?? {};
      const learnerEmailEnabled = Boolean(platformSettings.learnerEmailNotificationsEnabled ?? false);
      const candidates = await this.prisma.outboxDelivery.findMany({ where: { status: { in: ["PENDING", "FAILED", "PROCESSING"] }, availableAt: { lte: new Date() } }, orderBy: { availableAt: "asc" }, take: Number.isFinite(limit) ? Math.max(1, Math.min(Math.trunc(limit), 100)) : 25, include: { event: true } });
      for (const candidate of candidates) {
        const claimWhere = { id: candidate.id, status: candidate.status, attempts: candidate.attempts, availableAt: candidate.availableAt };
        // Resend chống gửi trùng trong 24 giờ; tính thận trọng từ lúc tạo sự kiện, không tính từ lần thử lại.
        // Lượt gửi cũ chưa rõ kết quả phải được đối soát thủ công để tránh gửi thư trùng.
        if (candidate.attempts >= 8 || (candidate.attempts > 0 && Date.now() - candidate.event.createdAt.getTime() >= 23 * 60 * 60_000)) {
          const terminal = await this.prisma.outboxDelivery.updateMany({ where: claimWhere, data: { status: "DEAD_LETTER", lastError: "Retry exhausted or idempotency window expired; reconcile with provider before retrying." } });
          failed += terminal.count;
          continue;
        }
        const leaseUntil = new Date(Date.now() + this.leaseMs);
        const claimed = await this.prisma.outboxDelivery.updateMany({ where: claimWhere, data: { status: "PROCESSING", attempts: { increment: 1 }, availableAt: leaseUntil, lastError: null } });
        if (claimed.count !== 1) continue;
        const owned = { id: candidate.id, status: "PROCESSING", attempts: candidate.attempts + 1, availableAt: leaseUntil };
        try {
          const recipient = await this.prisma.user.findUnique({
            where: { id: candidate.recipientId },
            select: {
              email: true,
              displayName: true,
              status: true,
              roles: { select: { role: { select: { code: true } } } },
            },
          });
          if (!recipient || recipient.status !== "ACTIVE") throw new Error("Người nhận không còn hoạt động.");
          const isLearner = Array.isArray(recipient.roles) && recipient.roles.some((r) => r.role?.code === "LEARNER");
          if (isLearner && !learnerEmailEnabled && (candidate.event as { type?: string }).type === "NOTIFICATION_CREATED") {
            const skipped = await this.prisma.outboxDelivery.updateMany({
              where: owned,
              data: {
                status: "SKIPPED",
                lastError: "Thông báo email tới học viên đang tắt theo Cấu hình hệ thống.",
              },
            });
            failed += skipped.count;
            continue;
          }
          const payload = candidate.event.payload as Record<string, unknown>;
          const title = typeof payload.title === "string" ? payload.title : "Thông báo mới từ Wind EDU";
          const result = await this.email.send({ to: recipient.email, subject: title, text: `${title}\n\nMở Wind EDU để xem chi tiết.`, idempotencyKey: candidate.dedupKey });
          const completed = await this.prisma.outboxDelivery.updateMany({ where: owned, data: { status: "DELIVERED", providerMessageId: result.providerMessageId, deliveredAt: new Date(), lastError: null } });
          delivered += completed.count;
        } catch (error) {
          const attempts = candidate.attempts + 1;
          const delayMinutes = Math.min(2 ** attempts, 360);
          const rejected = await this.prisma.outboxDelivery.updateMany({ where: owned, data: { status: attempts >= 8 ? "DEAD_LETTER" : "FAILED", availableAt: new Date(Date.now() + delayMinutes * 60_000), lastError: (error instanceof Error ? error.message : "Gửi email thất bại.").slice(0, 500) } });
          failed += rejected.count;
        }
      }
      return { processed: delivered + failed, delivered, failed };
    } finally {
      this.draining = false;
    }
  }

  /** Chặn lỗi cơ sở dữ liệu hoặc nhà cung cấp để tác vụ định kỳ không phát sinh Promise bị từ chối mà không được xử lý. */
  private runSafely(): void {
    void this.drain().catch(() => this.logger.error("Outbox drain failed; pending leases will be retried."));
  }

  /** Tương thích test double cũ và chỉ bật worker khi adapter khai báo sẵn sàng rõ ràng. */
  private emailReady(): boolean {
    return typeof this.email.isConfigured === "function" && this.email.isConfigured();
  }
}
