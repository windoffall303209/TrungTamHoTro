import { BadRequestException, ValidationPipe } from "@nestjs/common";
import { Test, type TestingModule } from "@nestjs/testing";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { AppModule } from "../../src/app.module.js";
import { PrismaService } from "../../src/database/prisma.service.js";
import { SystemController } from "../../src/domains/system/core/system.controller.js";
import { SystemService } from "../../src/domains/system/core/system.service.js";
import { EmailDeliveryService } from "../../src/infrastructure/email-delivery.service.js";
import { OutboxDeliveryService } from "../../src/infrastructure/outbox-delivery.service.js";
import { deleteTestAuditLogs } from "../support/audit-maintenance.js";

describe("System streamline and merged outbox integration", () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let system: SystemService;
  let outbox: OutboxDeliveryService;
  const sendMock = vi.fn<() => Promise<{ providerMessageId: string }>>();
  let previousPlatformSetting: {
    value: unknown;
    version: number;
    updatedBy: string;
    effectiveAt: Date;
  } | null = null;
  const createdNotificationIds: string[] = [];
  const createdAuditIds: bigint[] = [];

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(EmailDeliveryService)
      .useValue({
        isConfigured: (): boolean => true,
        send: sendMock,
      })
      .compile();

    prisma = moduleRef.get(PrismaService);
    system = moduleRef.get(SystemService);
    outbox = moduleRef.get(OutboxDeliveryService);

    const existing = await prisma.systemSetting.findUnique({ where: { key: "platform" } });
    if (existing) {
      previousPlatformSetting = {
        value: existing.value,
        version: existing.version,
        updatedBy: existing.updatedBy,
        effectiveAt: existing.effectiveAt,
      };
    }
  });

  afterAll(async () => {
    if (createdNotificationIds.length) {
      await prisma.outboxDelivery.deleteMany({
        where: {
          id: { in: createdNotificationIds.map((id) => `delivery:email:${id}`) },
        },
      });
      await prisma.notification.deleteMany({
        where: { id: { in: createdNotificationIds } },
      });
    }
    if (createdAuditIds.length) {
      await deleteTestAuditLogs(prisma, { id: { in: createdAuditIds } });
    }
    if (previousPlatformSetting) {
      await prisma.systemSetting.upsert({
        where: { key: "platform" },
        update: {
          value: previousPlatformSetting.value as object,
          version: previousPlatformSetting.version,
          updatedBy: previousPlatformSetting.updatedBy,
          effectiveAt: previousPlatformSetting.effectiveAt,
        },
        create: {
          key: "platform",
          value: previousPlatformSetting.value as object,
          version: previousPlatformSetting.version,
          updatedBy: previousPlatformSetting.updatedBy,
          effectiveAt: previousPlatformSetting.effectiveAt,
        },
      });
    }
    await moduleRef?.close();
  });

  it("xác nhận đã xóa 6 bảng cũ, giữ audit_logs/operational_jobs/system_settings và di trú sạch outbox_deliveries", async () => {
    const dropped = await prisma.$queryRaw<
      Array<{
        retention_policies: string | null;
        retention_jobs: string | null;
        legal_holds: string | null;
        system_setting_revisions: string | null;
        system_alerts: string | null;
        outbox_events: string | null;
        audit_logs: string | null;
        operational_jobs: string | null;
        system_settings: string | null;
        outbox_deliveries: string | null;
      }>
    >`
      SELECT
        to_regclass('public.retention_policies')::text AS retention_policies,
        to_regclass('public.retention_jobs')::text AS retention_jobs,
        to_regclass('public.legal_holds')::text AS legal_holds,
        to_regclass('public.system_setting_revisions')::text AS system_setting_revisions,
        to_regclass('public.system_alerts')::text AS system_alerts,
        to_regclass('public.outbox_events')::text AS outbox_events,
        to_regclass('public.audit_logs')::text AS audit_logs,
        to_regclass('public.operational_jobs')::text AS operational_jobs,
        to_regclass('public.system_settings')::text AS system_settings,
        to_regclass('public.outbox_deliveries')::text AS outbox_deliveries
    `;
    expect(dropped[0]).toEqual({
      retention_policies: null,
      retention_jobs: null,
      legal_holds: null,
      system_setting_revisions: null,
      system_alerts: null,
      outbox_events: null,
      audit_logs: "audit_logs",
      operational_jobs: "operational_jobs",
      system_settings: "system_settings",
      outbox_deliveries: "outbox_deliveries",
    });

    const [nullCheck] = await prisma.$queryRaw<Array<{ invalid: number }>>`
      SELECT COUNT(*)::int AS invalid
      FROM "outbox_deliveries"
      WHERE "event_type" IS NULL
         OR "aggregate_type" IS NULL
         OR "aggregate_id" IS NULL
         OR "payload" IS NULL
         OR "created_at" IS NULL
    `;
    expect(nullCheck?.invalid).toBe(0);

    const [migrated] = await prisma.$queryRaw<Array<{ cnt: number }>>`
      SELECT COUNT(*)::int AS cnt
      FROM "outbox_deliveries"
      WHERE "event_type" = 'NOTIFICATION_CREATED'
    `;
    expect(migrated?.cnt ?? 0).toBeGreaterThan(0);
  });

  it("cập nhật cấu hình trực tiếp vào system_settings, từ chối trường cũ và giữ health-overview + audit_logs", async () => {
    const before = await system.getSettings();
    expect("retentionDays" in (before as unknown as Record<string, unknown>)).toBe(false);
    expect("effectiveAt" in (before as unknown as Record<string, unknown>)).toBe(false);

    await Promise.all([
      system.updateSettings({ centerName: "Wind EDU Verified" }, "usr-admin"),
      system.updateSettings({ learnerEmailNotificationsEnabled: !before.learnerEmailNotificationsEnabled }, "usr-admin"),
    ]);
    const updated = await system.getSettings();
    expect(updated.version).toBe(before.version + 2);
    expect(updated.centerName).toBe("Wind EDU Verified");
    expect(updated.learnerEmailNotificationsEnabled).toBe(!before.learnerEmailNotificationsEnabled);

    const audits = await prisma.auditLog.findMany({
      where: { action: "SETTINGS_UPDATED", entityId: "system-settings" },
      orderBy: { id: "desc" },
      take: 2,
    });
    expect(audits).toHaveLength(2);
    createdAuditIds.push(...audits.map((entry) => entry.id));

    const health = (await system.healthOverview()) as {
      status: string;
      database: string;
      apiLatencyMs: number;
      storageUsagePercent: number;
      queueDepth: number;
    };
    expect(health.database).toBe("connected");
    expect(typeof health.apiLatencyMs).toBe("number");

    const pipe = new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    });
    const controllerMetadata = Reflect.getMetadata(
      "design:paramtypes",
      SystemController.prototype,
      "updateSettings",
    ) as Array<new () => object>;
    const UpdateDto = controllerMetadata?.[0];
    expect(UpdateDto).toBeDefined();
    await expect(
      pipe.transform(
        { retentionDays: 90 },
        { type: "body", metatype: UpdateDto },
      ),
    ).rejects.toThrow(BadRequestException);
    const dtoInstance = plainToInstance(UpdateDto!, { effectiveAt: "2030-01-01T00:00:00.000Z" });
    const validationErrors = await validate(dtoInstance, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });
    expect(validationErrors.length).toBeGreaterThan(0);
  });

  it("trigger tạo hàng đợi trực tiếp trong outbox_deliveries cùng transaction, chống trùng và retry gửi email", async () => {
    await system.updateSettings({ learnerEmailNotificationsEnabled: true }, "usr-admin");

    const notifId = `notif-streamline-${randomUUID()}`;
    createdNotificationIds.push(notifId);

    const pastReadyAt = new Date(Date.now() - 120_000);
    await prisma.notification.create({
      data: {
        id: notifId,
        recipientId: "usr-learner",
        type: "ASSIGNMENT_PUBLISHED",
        title: "Thông báo kiểm thử outbox gộp",
        entityType: "ASSIGNMENT",
        entityId: "asg-streamline-1",
        dedupKey: notifId,
        createdAt: pastReadyAt,
      },
    });

    const deliveryId = `delivery:email:${notifId}`;
    const queued = await prisma.outboxDelivery.findUniqueOrThrow({ where: { id: deliveryId } });
    expect(queued).toMatchObject({
      id: deliveryId,
      eventType: "NOTIFICATION_CREATED",
      aggregateType: "ASSIGNMENT",
      aggregateId: "asg-streamline-1",
      recipientId: "usr-learner",
      channel: "EMAIL",
      status: "PENDING",
      attempts: 0,
      dedupKey: `notification:${notifId}:usr-learner:EMAIL`,
    });
    expect(queued.payload).toMatchObject({
      notificationId: notifId,
      recipientId: "usr-learner",
      title: "Thông báo kiểm thử outbox gộp",
      entityType: "ASSIGNMENT",
      entityId: "asg-streamline-1",
    });

    // Kiểm tra chống ghi trùng trên dedup_key ngay ở tầng DB.
    await expect(
      prisma.outboxDelivery.create({
        data: {
          id: `dup-${notifId}`,
          eventType: "NOTIFICATION_CREATED",
          aggregateType: "ASSIGNMENT",
          aggregateId: "asg-streamline-1",
          payload: queued.payload as object,
          recipientId: "usr-learner",
          channel: "EMAIL",
          dedupKey: queued.dedupKey,
        },
      }),
    ).rejects.toThrow();

    // Tạm hoãn các PENDING khác ở test DB để drain() xử lý đúng bản ghi đang kiểm thử.
    const futureHold = new Date(Date.now() + 3_600_000);
    const postponed = await prisma.outboxDelivery.updateMany({
      where: {
        id: { not: deliveryId },
        status: { in: ["PENDING", "FAILED", "PROCESSING"] },
        availableAt: { lte: new Date() },
      },
      data: { availableAt: futureHold },
    });

    try {
      // Lần 1: provider lỗi -> chuyển FAILED, tăng attempts = 1 và đặt backoff tương lai.
      sendMock.mockRejectedValueOnce(new Error("Temporary SMTP timeout"));
      const firstRun = await outbox.drain(10);
      expect(firstRun).toEqual({ processed: 1, delivered: 0, failed: 1 });
      const failedRow = await prisma.outboxDelivery.findUniqueOrThrow({ where: { id: deliveryId } });
      expect(failedRow.status).toBe("FAILED");
      expect(failedRow.attempts).toBe(1);
      expect(failedRow.lastError).toContain("Temporary SMTP timeout");
      expect(failedRow.availableAt.getTime()).toBeGreaterThan(Date.now());

      // Đặt availableAt về quá khứ để chạy retry lần 2 thành công.
      await prisma.outboxDelivery.update({
        where: { id: deliveryId },
        data: { availableAt: new Date(Date.now() - 10_000) },
      });
      sendMock.mockResolvedValueOnce({ providerMessageId: "resend-msg-ok" });
      const secondRun = await outbox.drain(10);
      expect(secondRun).toEqual({ processed: 1, delivered: 1, failed: 0 });
      const deliveredRow = await prisma.outboxDelivery.findUniqueOrThrow({ where: { id: deliveryId } });
      expect(deliveredRow.status).toBe("DELIVERED");
      expect(deliveredRow.attempts).toBe(2);
      expect(deliveredRow.providerMessageId).toBe("resend-msg-ok");
      expect(sendMock).toHaveBeenLastCalledWith(
        expect.objectContaining({
          subject: "Thông báo kiểm thử outbox gộp",
          idempotencyKey: `notification:${notifId}:usr-learner:EMAIL`,
        }),
      );
    } finally {
      if (postponed.count > 0) {
        await prisma.outboxDelivery.updateMany({
          where: { availableAt: futureHold },
          data: { availableAt: new Date() },
        });
      }
    }
  });
});
