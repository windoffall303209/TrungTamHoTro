import { Injectable, Logger, OnModuleDestroy, OnModuleInit, Optional } from "@nestjs/common";
import { PrismaService } from "../database/prisma.service.js";
import { MetricsService } from "../observability/metrics.service.js";
import { EmailDeliveryService } from "./email-delivery.service.js";

interface ClaimedOutboxDelivery {
  id: string;
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  payload: unknown;
  recipientId: string;
  channel: string;
  dedupKey: string;
  status: string;
  attempts: number;
  availableAt: Date;
  createdAt: Date;
}

interface OutboxRecipient {
  id?: string;
  email: string | null;
  displayName?: string | null;
  status: string;
  roles?: Array<{ role?: { code?: string | null } | null }>;
}

const MAX_OUTBOX_ATTEMPTS = 8;
const IDEMPOTENCY_WINDOW_MS = 23 * 60 * 60_000;

/** Chạy danh sách tác vụ bất đồng bộ với giới hạn song song chặt chẽ (không vượt quá concurrency). */
async function runWithBoundedConcurrency<TItem>(
  items: readonly TItem[],
  concurrency: number,
  worker: (item: TItem) => Promise<void>,
): Promise<void> {
  if (!items.length) return;
  const limit = Math.max(1, Math.min(Math.trunc(concurrency), items.length));
  let cursor = 0;
  // Mỗi worker lấy chỉ số kế tiếp một cách đồng bộ trước khi await để không xử lý trùng phần tử.
  const runWorker = async (): Promise<void> => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      await worker(items[index]!);
    }
  };
  await Promise.all(Array.from({ length: limit }, () => runWorker()));
}

@Injectable()
/** Chuyển outbox delivery sang email thật với claim lô SKIP LOCKED, bounded concurrency, retry tăng dần và dedup provider. */
export class OutboxDeliveryService implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout;
  private draining = false;
  private readonly logger = new Logger(OutboxDeliveryService.name);
  private readonly leaseMs = 5 * 60_000;
  private readonly defaultConcurrency = Math.max(
    1,
    Math.min(Number(process.env.OUTBOX_CONCURRENCY) || 5, 20),
  );

  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailDeliveryService,
    @Optional() private readonly metrics?: MetricsService,
  ) {}

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

  /**
   * Claim tối đa một lô bằng `FOR UPDATE SKIP LOCKED` trên PostgreSQL (hoặc CAS fallback khi unit test mock),
   * tải trước người nhận theo lô và gửi song song có giới hạn concurrency.
   */
  async drain(
    limit = 25,
    concurrency = this.defaultConcurrency,
  ): Promise<{ processed: number; delivered: number; failed: number }> {
    if (this.draining || !this.emailReady()) return { processed: 0, delivered: 0, failed: 0 };
    this.draining = true;
    const startedAt = performance.now();
    let delivered = 0;
    let failed = 0;
    const batchLimit = Number.isFinite(limit) ? Math.max(1, Math.min(Math.trunc(limit), 100)) : 25;
    const workerConcurrency = Number.isFinite(concurrency)
      ? Math.max(1, Math.min(Math.trunc(concurrency), 20))
      : this.defaultConcurrency;
    try {
      const platformRow = await this.prisma.systemSetting?.findUnique?.({ where: { key: "platform" } }).catch((error: unknown) => {
        this.logger.warn(`Không thể đọc cấu hình thông báo email: ${error instanceof Error ? error.message : String(error)}`);
        return null;
      });
      const platformSettings = (platformRow?.value as Record<string, unknown>) ?? {};
      const learnerEmailEnabled = Boolean(platformSettings.learnerEmailNotificationsEnabled ?? false);

      const claimedBatch = await this.claimBatch(batchLimit);
      failed += claimedBatch.deadLettered;

      if (!claimedBatch.items.length) {
        return { processed: delivered + failed, delivered, failed };
      }

      const recipientsById = await this.loadRecipients(claimedBatch.items);

      await runWithBoundedConcurrency(claimedBatch.items, workerConcurrency, async (item) => {
        const outcome = await this.deliverClaimedItem(item, recipientsById, learnerEmailEnabled);
        delivered += outcome.delivered;
        failed += outcome.failed;
      });

      return { processed: delivered + failed, delivered, failed };
    } finally {
      this.metrics?.recordWorkerRun("outbox", delivered, failed, performance.now() - startedAt);
      this.draining = false;
    }
  }

  /** Claim nguyên tử một lô trên PostgreSQL bằng FOR UPDATE SKIP LOCKED, không để nhiều worker khóa chặn hoặc nhận trùng. */
  private async claimBatch(
    batchLimit: number,
  ): Promise<{ items: ClaimedOutboxDelivery[]; deadLettered: number }> {
    const now = new Date();
    const idempotencyCutoff = new Date(now.getTime() - IDEMPOTENCY_WINDOW_MS);
    const leaseUntil = new Date(now.getTime() + this.leaseMs);

    if (typeof this.prisma.$queryRaw === "function") {
      // Bước 1: Chuyển nguyên tử các bản ghi vượt số lần thử hoặc quá cửa sổ idempotency 23 giờ sang DEAD_LETTER.
      const deadRows = await this.prisma.$queryRaw<Array<{ id: string }>>`
        WITH expired AS (
          SELECT id
          FROM outbox_deliveries
          WHERE status IN ('PENDING', 'FAILED', 'PROCESSING')
            AND available_at <= ${now}
            AND (attempts >= ${MAX_OUTBOX_ATTEMPTS} OR (attempts > 0 AND created_at <= ${idempotencyCutoff}))
          ORDER BY available_at ASC, id ASC
          LIMIT ${batchLimit}
          FOR UPDATE SKIP LOCKED
        )
        UPDATE outbox_deliveries AS d
        SET status = 'DEAD_LETTER',
            last_error = 'Retry exhausted or idempotency window expired; reconcile with provider before retrying.',
            updated_at = NOW()
        FROM expired
        WHERE d.id = expired.id
        RETURNING d.id
      `;

      // Bước 2: Claim nguyên tử một lô hợp lệ với FOR UPDATE SKIP LOCKED và đặt lease mới.
      const items = await this.prisma.$queryRaw<ClaimedOutboxDelivery[]>`
        WITH claimed AS (
          SELECT id
          FROM outbox_deliveries
          WHERE status IN ('PENDING', 'FAILED', 'PROCESSING')
            AND available_at <= ${now}
            AND attempts < ${MAX_OUTBOX_ATTEMPTS}
            AND NOT (attempts > 0 AND created_at <= ${idempotencyCutoff})
          ORDER BY available_at ASC, id ASC
          LIMIT ${batchLimit}
          FOR UPDATE SKIP LOCKED
        )
        UPDATE outbox_deliveries AS d
        SET status = 'PROCESSING',
            attempts = d.attempts + 1,
            available_at = ${leaseUntil},
            last_error = NULL,
            updated_at = NOW()
        FROM claimed
        WHERE d.id = claimed.id
        RETURNING
          d.id,
          d.event_type AS "eventType",
          d.aggregate_type AS "aggregateType",
          d.aggregate_id AS "aggregateId",
          d.payload,
          d.recipient_id AS "recipientId",
          d.channel,
          d.dedup_key AS "dedupKey",
          d.status,
          d.attempts,
          d.available_at AS "availableAt",
          d.created_at AS "createdAt"
      `;

      return { items, deadLettered: deadRows.length };
    }

    // Fallback cho unit test không có kết nối PostgreSQL ($queryRaw): giữ nguyên cơ chế claim CAS qua Prisma.
    const candidates = await this.prisma.outboxDelivery.findMany({
      where: { status: { in: ["PENDING", "FAILED", "PROCESSING"] }, availableAt: { lte: now } },
      orderBy: { availableAt: "asc" },
      take: batchLimit,
    });
    const items: ClaimedOutboxDelivery[] = [];
    let deadLettered = 0;
    for (const candidate of candidates) {
      const claimWhere = {
        id: candidate.id,
        status: candidate.status,
        attempts: candidate.attempts,
        availableAt: candidate.availableAt,
      };
      if (
        candidate.attempts >= MAX_OUTBOX_ATTEMPTS ||
        (candidate.attempts > 0 && now.getTime() - candidate.createdAt.getTime() >= IDEMPOTENCY_WINDOW_MS)
      ) {
        const terminal = await this.prisma.outboxDelivery.updateMany({
          where: claimWhere,
          data: {
            status: "DEAD_LETTER",
            lastError: "Retry exhausted or idempotency window expired; reconcile with provider before retrying.",
          },
        });
        deadLettered += terminal.count;
        continue;
      }
      const claimed = await this.prisma.outboxDelivery.updateMany({
        where: claimWhere,
        data: {
          status: "PROCESSING",
          attempts: { increment: 1 },
          availableAt: leaseUntil,
          lastError: null,
        },
      });
      if (claimed.count !== 1) continue;
      items.push({
        id: candidate.id,
        eventType: candidate.eventType,
        aggregateType: candidate.aggregateType,
        aggregateId: candidate.aggregateId,
        payload: candidate.payload,
        recipientId: candidate.recipientId,
        channel: candidate.channel,
        dedupKey: candidate.dedupKey,
        status: "PROCESSING",
        attempts: candidate.attempts + 1,
        availableAt: leaseUntil,
        createdAt: candidate.createdAt,
      });
    }
    return { items, deadLettered };
  }

  /** Tải trước toàn bộ người nhận của lô bằng một truy vấn duy nhất để xóa N+1 user.findUnique. */
  private async loadRecipients(
    items: readonly ClaimedOutboxDelivery[],
  ): Promise<Map<string, OutboxRecipient> | null> {
    if (typeof this.prisma.user?.findMany !== "function") return null;
    const recipientIds = [...new Set(items.map((item) => item.recipientId))];
    if (!recipientIds.length) return new Map();
    const users = await this.prisma.user.findMany({
      where: { id: { in: recipientIds } },
      select: {
        id: true,
        email: true,
        displayName: true,
        status: true,
        roles: { select: { role: { select: { code: true } } } },
      },
    });
    return new Map(users.map((user) => [user.id, user]));
  }

  /** Gửi một delivery đã claim với fencing theo (id, PROCESSING, attempts, availableAt) và retry backoff khi lỗi. */
  private async deliverClaimedItem(
    item: ClaimedOutboxDelivery,
    recipientsById: Map<string, OutboxRecipient> | null,
    learnerEmailEnabled: boolean,
  ): Promise<{ delivered: number; failed: number }> {
    const owned = {
      id: item.id,
      status: "PROCESSING",
      attempts: item.attempts,
      availableAt: item.availableAt,
    };
    try {
      const recipient = recipientsById
        ? (recipientsById.get(item.recipientId) ?? null)
        : await this.prisma.user.findUnique({
            where: { id: item.recipientId },
            select: {
              email: true,
              displayName: true,
              status: true,
              roles: { select: { role: { select: { code: true } } } },
            },
          });
      if (!recipient || !["ACTIVE", "PENDING"].includes(recipient.status)) {
        throw new Error("Người nhận không còn hoạt động.");
      }
      const isLearner =
        Array.isArray(recipient.roles) &&
        recipient.roles.some((r) => r.role?.code === "LEARNER");
      if (isLearner && !learnerEmailEnabled && item.eventType === "NOTIFICATION_CREATED") {
        const skipped = await this.prisma.outboxDelivery.updateMany({
          where: owned,
          data: {
            status: "SKIPPED",
            lastError: "Thông báo email tới học viên đang tắt theo Cấu hình hệ thống.",
          },
        });
        return { delivered: 0, failed: skipped.count };
      }
      // Tài khoản vừa cấp chưa có email: bỏ qua thay vì thử gửi lại nhiều lần.
      if (!recipient.email) {
        const skipped = await this.prisma.outboxDelivery.updateMany({
          where: owned,
          data: { status: "SKIPPED", lastError: "Người nhận chưa cập nhật email." },
        });
        return { delivered: 0, failed: skipped.count };
      }
      const payload = (item.payload && typeof item.payload === "object"
        ? item.payload
        : {}) as Record<string, unknown>;
      const title =
        typeof payload.title === "string" ? payload.title : "Thông báo mới từ Wind EDU";
      const result = await this.email.send({
        to: recipient.email,
        subject: title,
        text: `${title}\n\nMở Wind EDU để xem chi tiết.`,
        idempotencyKey: item.dedupKey,
      });
      const completed = await this.prisma.outboxDelivery.updateMany({
        where: owned,
        data: {
          status: "DELIVERED",
          providerMessageId: result.providerMessageId,
          deliveredAt: new Date(),
          lastError: null,
        },
      });
      return { delivered: completed.count, failed: 0 };
    } catch (error) {
      const delayMinutes = Math.min(2 ** item.attempts, 360);
      const rejected = await this.prisma.outboxDelivery.updateMany({
        where: owned,
        data: {
          status: item.attempts >= MAX_OUTBOX_ATTEMPTS ? "DEAD_LETTER" : "FAILED",
          availableAt: new Date(Date.now() + delayMinutes * 60_000),
          lastError: (error instanceof Error ? error.message : "Gửi email thất bại.").slice(0, 500),
        },
      });
      return { delivered: 0, failed: rejected.count };
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
