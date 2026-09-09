import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { PrismaService } from "../database/prisma.service.js";
import { EmailDeliveryService } from "./email-delivery.service.js";

@Injectable()
/** Chuyển outbox delivery sang email thật với claim nguyên tử, retry tăng dần và dedup provider. */
export class OutboxDeliveryService implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout;
  private draining = false;

  constructor(private readonly prisma: PrismaService, private readonly email: EmailDeliveryService) {}

  /** Bật worker định kỳ chỉ khi email provider đã cấu hình, tránh vòng retry vô ích ở môi trường dev. */
  onModuleInit(): void {
    if (!this.emailReady()) return;
    this.timer = setInterval(() => { void this.drain(); }, 5_000);
    this.timer.unref();
    void this.drain();
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
      const candidates = await this.prisma.outboxDelivery.findMany({ where: { status: { in: ["PENDING", "FAILED"] }, availableAt: { lte: new Date() }, attempts: { lt: 8 } }, orderBy: { availableAt: "asc" }, take: Math.max(1, Math.min(limit, 100)), include: { event: true } });
      for (const candidate of candidates) {
        const claimed = await this.prisma.outboxDelivery.updateMany({ where: { id: candidate.id, status: candidate.status, attempts: candidate.attempts }, data: { status: "PROCESSING", attempts: { increment: 1 }, lastError: null } });
        if (claimed.count !== 1) continue;
        try {
          const recipient = await this.prisma.user.findUnique({ where: { id: candidate.recipientId }, select: { email: true, displayName: true, status: true } });
          if (!recipient || recipient.status !== "ACTIVE") throw new Error("Người nhận không còn hoạt động.");
          const payload = candidate.event.payload as Record<string, unknown>;
          const title = typeof payload.title === "string" ? payload.title : "Thông báo mới từ Wind EDU";
          const result = await this.email.send({ to: recipient.email, subject: title, text: `${title}\n\nMở Wind EDU để xem chi tiết.`, idempotencyKey: candidate.dedupKey });
          await this.prisma.outboxDelivery.update({ where: { id: candidate.id }, data: { status: "DELIVERED", providerMessageId: result.providerMessageId, deliveredAt: new Date(), lastError: null } });
          delivered += 1;
        } catch (error) {
          const attempts = candidate.attempts + 1;
          const delayMinutes = Math.min(2 ** attempts, 360);
          await this.prisma.outboxDelivery.update({ where: { id: candidate.id }, data: { status: "FAILED", availableAt: new Date(Date.now() + delayMinutes * 60_000), lastError: (error instanceof Error ? error.message : "Gửi email thất bại.").slice(0, 500) } });
          failed += 1;
        }
      }
      return { processed: delivered + failed, delivered, failed };
    } finally {
      this.draining = false;
    }
  }

  /** Tương thích test double cũ và chỉ bật worker khi adapter khai báo sẵn sàng rõ ràng. */
  private emailReady(): boolean {
    return typeof this.email.isConfigured === "function" && this.email.isConfigured();
  }
}
