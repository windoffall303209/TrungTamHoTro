import { BadRequestException, NotFoundException } from "@nestjs/common";
import {
  AuditEvent,
  AuditFilter,
  StorageOverview,
  SystemAlertView,
} from "../system.shared.js";
import type { SystemServiceContext } from "../system.context.js";

/** Lọc audit theo nhiều tiêu chí và che token/secret trong phần detail trước khi trả. */
export async function listAudit(
  serviceContext: SystemServiceContext,
  filter: AuditFilter = {},
): Promise<AuditEvent[]> {
  const normalized = filter.query?.trim().toLowerCase() ?? "";
  const from = filter.from ? new Date(filter.from) : undefined;
  const to = filter.to ? new Date(filter.to) : undefined;
  if (
    (from && Number.isNaN(from.getTime())) ||
    (to && Number.isNaN(to.getTime()))
  )
    throw new BadRequestException("Khoảng thời gian audit không hợp lệ.");
  if (from && to && from > to)
    throw new BadRequestException(
      "Thời gian bắt đầu phải trước thời gian kết thúc.",
    );
  const limit = Math.min(500, Math.max(1, filter.limit ?? 100));
  const prisma = serviceContext.database();
  if (prisma) {
    const rows = await prisma.auditLog.findMany({
      where: {
        actorId: filter.actor ? { contains: filter.actor.trim() } : undefined,
        action: filter.action ? { contains: filter.action.trim() } : undefined,
        entityId: filter.target
          ? { contains: filter.target.trim() }
          : undefined,
        createdAt: from || to ? { gte: from, lte: to } : undefined,
      },
      orderBy: { createdAt: "desc" },
      take: limit,
    });
    return rows
      .map((row) => serviceContext.mapAudit(row))
      .filter(
        (item) =>
          !normalized ||
          `${item.actor} ${item.action} ${item.target} ${item.detail}`
            .toLowerCase()
            .includes(normalized),
      );
  }
  return structuredClone(
    serviceContext.audit
      .filter(
        (item) =>
          (!normalized ||
            `${item.actor} ${item.action} ${item.target} ${item.detail}`
              .toLowerCase()
              .includes(normalized)) &&
          (!filter.actor || item.actor.includes(filter.actor)) &&
          (!filter.action || item.action.includes(filter.action)) &&
          (!filter.target || item.target.includes(filter.target)) &&
          (!from || new Date(item.createdAt) >= from) &&
          (!to || new Date(item.createdAt) <= to),
      )
      .slice(0, limit),
  );
}

/** Tổng hợp health DB/integration/storage và tạo hoặc phục hồi cảnh báo theo ngưỡng. */
export async function healthOverview(
  serviceContext: SystemServiceContext,
): Promise<object> {
  const prisma = serviceContext.database();
  if (!prisma) {
    await serviceContext.recordAlert(
      "database:disabled",
      "database",
      "CRITICAL",
      "Kết nối cơ sở dữ liệu đang tắt.",
    );
    return {
      status: "degraded",
      database: "disabled",
      apiLatencyMs: 0,
      storageUsagePercent: 0,
      queueDepth: 0,
      checkedAt: new Date().toISOString(),
    };
  }
  const startedAt = performance.now();
  await prisma.$queryRaw`SELECT 1`;
  const storage = await serviceContext.getStorageOverview();
  const queueDepth = await prisma.$transaction([
    prisma.backupJob.count({
      where: { status: { in: ["PENDING", "RUNNING"] } },
    }),
    prisma.restoreJob.count({
      where: { status: { in: ["PENDING", "RUNNING"] } },
    }),
    prisma.dataExportJob.count({
      where: { status: { in: ["PENDING", "RUNNING"] } },
    }),
  ]);
  const apiLatencyMs = Math.max(1, Math.round(performance.now() - startedAt));
  const totalQueueDepth = queueDepth.reduce((sum, value) => sum + value, 0);
  if (storage.usagePercent >= 90)
    await serviceContext.recordAlert(
      "storage:usage",
      "storage",
      "CRITICAL",
      "Dung lượng lưu trữ vượt ngưỡng 90%.",
      storage.usagePercent,
      90,
    );
  else await serviceContext.recoverAlert("storage:usage");
  if (totalQueueDepth >= 20)
    await serviceContext.recordAlert(
      "queue:depth",
      "job-queue",
      "WARNING",
      "Hàng đợi tác vụ vượt ngưỡng 20.",
      totalQueueDepth,
      20,
    );
  else await serviceContext.recoverAlert("queue:depth");
  if (apiLatencyMs >= 1000)
    await serviceContext.recordAlert(
      "api:latency",
      "api",
      "WARNING",
      "Độ trễ API vượt ngưỡng 1000 ms.",
      apiLatencyMs,
      1000,
    );
  else await serviceContext.recoverAlert("api:latency");
  await serviceContext.recoverAlert("database:disabled");
  return {
    status: storage.usagePercent >= 90 ? "warning" : "healthy",
    database: "connected",
    apiLatencyMs,
    storageUsagePercent: storage.usagePercent,
    queueDepth: totalQueueDepth,
    checkedAt: new Date().toISOString(),
  };
}

/** Liệt kê cảnh báo hệ thống mới nhất trước. */
export async function listAlerts(
  serviceContext: SystemServiceContext,
): Promise<SystemAlertView[]> {
  const prisma = serviceContext.database();
  if (prisma)
    return (
      await prisma.systemAlert.findMany({
        orderBy: { detectedAt: "desc" },
        take: 200,
      })
    ).map((row) => serviceContext.mapAlert(row));
  return structuredClone(serviceContext.alerts);
}

/** Áp dụng thao tác vận hành lên cảnh báo và ghi nhận actor/thời hạn mute. */
export async function updateAlert(
  serviceContext: SystemServiceContext,
  alertId: string,
  action: "ACKNOWLEDGE" | "MUTE" | "RESOLVE",
  actorId = "usr-admin",
  muteMinutes = 60,
): Promise<SystemAlertView> {
  const prisma = serviceContext.database();
  const data =
    action === "ACKNOWLEDGE"
      ? { status: "ACKNOWLEDGED", acknowledgedBy: actorId }
      : action === "MUTE"
        ? {
            status: "MUTED",
            acknowledgedBy: actorId,
            mutedUntil: new Date(
              Date.now() + Math.min(1440, Math.max(5, muteMinutes)) * 60_000,
            ),
          }
        : {
            status: "RESOLVED",
            recoveredAt: new Date(),
            acknowledgedBy: actorId,
          };
  if (prisma) {
    const current = await prisma.systemAlert.findUnique({
      where: { id: alertId },
    });
    if (!current) throw new NotFoundException("Không tìm thấy cảnh báo.");
    const row = await prisma.systemAlert.update({
      where: { id: alertId },
      data,
    });
    await serviceContext.logDatabase(
      prisma,
      actorId,
      `ALERT_${action}`,
      alertId,
      row.summary,
    );
    return serviceContext.mapAlert(row);
  }
  const item = serviceContext.alerts.find((row) => row.id === alertId);
  if (!item) throw new NotFoundException("Không tìm thấy cảnh báo.");
  Object.assign(item, {
    ...data,
    mutedUntil: data.mutedUntil?.toISOString(),
    recoveredAt: data.recoveredAt?.toISOString(),
    updatedAt: new Date().toISOString(),
  });
  serviceContext.log(actorId, `ALERT_${action}`, alertId, item.summary);
  return structuredClone(item);
}

/** Tổng hợp byte lưu trữ theo MIME, so sánh quota và phát cảnh báo khi gần đầy. */
export async function getStorageOverview(
  serviceContext: SystemServiceContext,
): Promise<StorageOverview> {
  const settings = await serviceContext.getSettings();
  const quotaBytes = settings.storageQuotaMb * 1_000_000;
  const prisma = serviceContext.database();
  if (!prisma) {
    return {
      quotaBytes,
      usedBytes: 0,
      usagePercent: 0,
      maxFileSizeMb: settings.maxFileSizeMb,
      allowedMimeTypes: settings.allowedMimeTypes,
      byClass: [],
    };
  }
  const groups = await prisma.material.groupBy({
    by: ["classId"],
    _sum: { sizeBytes: true },
    _count: { id: true },
  });
  const classes = await prisma.learningClass.findMany({
    where: { id: { in: groups.flatMap((item) => (item.classId ? [item.classId] : [])) } },
    select: { id: true, code: true, name: true },
  });
  const classMap = new Map(classes.map((item) => [item.id, item]));
  const byClass = groups
    .map((group) => {
      // Học liệu dùng chung theo môn không thuộc lớp nào nên được gộp thành một dòng riêng.
      if (!group.classId)
        return {
          classId: "",
          classCode: "—",
          className: "Học liệu dùng chung theo môn",
          fileCount: group._count.id,
          usedBytes: Number(group._sum.sizeBytes ?? 0n),
        };
      const classItem = classMap.get(group.classId);
      return {
        classId: group.classId,
        classCode: classItem?.code ?? group.classId,
        className: classItem?.name ?? "Lớp không xác định",
        fileCount: group._count.id,
        usedBytes: Number(group._sum.sizeBytes ?? 0n),
      };
    })
    .sort((a, b) => b.usedBytes - a.usedBytes);
  const usedBytes = byClass.reduce((sum, item) => sum + item.usedBytes, 0);
  return {
    quotaBytes,
    usedBytes,
    usagePercent: quotaBytes
      ? Math.min(100, Math.round((usedBytes / quotaBytes) * 10_000) / 100)
      : 100,
    maxFileSizeMb: settings.maxFileSizeMb,
    allowedMimeTypes: settings.allowedMimeTypes,
    byClass,
  };
}
