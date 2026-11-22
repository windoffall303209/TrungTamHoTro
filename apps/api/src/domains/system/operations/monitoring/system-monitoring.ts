import { BadRequestException } from "@nestjs/common";
import { Prisma } from "../../../../generated/prisma/client.js";
import {
  paginateArray,
  type PaginatedResult,
} from "../../../../common/pagination.js";
import {
  AuditEvent,
  AuditFilter,
  AuditPageFilter,
  StorageOverview,
} from "../../core/system.shared.js";
import type { SystemServiceContext } from "../../core/system.context.js";
import { readWithoutTransaction } from "../../../../database/read-without-transaction.js";

/** Kiểm tra và chuyển đổi khoảng thời gian audit từ chuỗi ISO sang Date hợp lệ. */
function parseAuditDateRange(filter: AuditFilter): { from?: Date; to?: Date } {
  const from = filter.from ? new Date(filter.from) : undefined;
  const to = filter.to ? new Date(filter.to) : undefined;
  if (
    (from && Number.isNaN(from.getTime())) ||
    (to && Number.isNaN(to.getTime()))
  ) {
    throw new BadRequestException("Khoảng thời gian audit không hợp lệ.");
  }
  if (from && to && from > to) {
    throw new BadRequestException(
      "Thời gian bắt đầu phải trước thời gian kết thúc.",
    );
  }
  return { from, to };
}

/** Lọc nhật ký audit trên bộ nhớ fallback khi chưa kết nối DB. */
function filterMemoryAudit(
  items: readonly AuditEvent[],
  filter: AuditFilter,
  from?: Date,
  to?: Date,
): AuditEvent[] {
  const normalized = filter.query?.trim().toLowerCase() ?? "";
  const actorFilter = filter.actor?.trim().toLowerCase() ?? "";
  const actionFilter = filter.action?.trim().toLowerCase() ?? "";
  const targetFilter = filter.target?.trim().toLowerCase() ?? "";
  return items.filter(
    (item) =>
      (!normalized ||
        `${item.actor} ${item.action} ${item.target} ${item.detail}`
          .toLowerCase()
          .includes(normalized)) &&
      (!actorFilter || item.actor.toLowerCase().includes(actorFilter)) &&
      (!actionFilter || item.action.toLowerCase().includes(actionFilter)) &&
      (!targetFilter || item.target.toLowerCase().includes(targetFilter)) &&
      (!from || new Date(item.createdAt) >= from) &&
      (!to || new Date(item.createdAt) <= to),
  );
}

/** Lọc audit theo nhiều tiêu chí và che token/secret trong phần detail trước khi trả. */
export async function listAudit(
  serviceContext: SystemServiceContext,
  filter: AuditFilter = {},
): Promise<AuditEvent[]> {
  const normalized = filter.query?.trim().toLowerCase() ?? "";
  const { from, to } = parseAuditDateRange(filter);
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
    filterMemoryAudit(serviceContext.audit, filter, from, to).slice(0, limit),
  );
}

/** Phân trang nhật ký audit trực tiếp ở SQL kèm lọc từ khóa trên actor, action, target và context. */
export async function listAuditPage(
  serviceContext: SystemServiceContext,
  filter: AuditPageFilter = {},
): Promise<PaginatedResult<AuditEvent>> {
  const { from, to } = parseAuditDateRange(filter);
  const page =
    Number.isSafeInteger(filter.page) &&
    (filter.page ?? 0) > 0 &&
    (filter.page ?? 0) <= 100_000
      ? (filter.page as number)
      : 1;
  const pageSize =
    Number.isInteger(filter.pageSize) && (filter.pageSize ?? 0) > 0
      ? Math.min(filter.pageSize as number, 100)
      : 20;
  const prisma = serviceContext.database();
  if (prisma) {
    // Chuẩn hóa từ khóa tìm kiếm LIKE an toàn.
    const contains = (value: string): string =>
      `%${value.replace(/[\\%_]/g, "\\$&")}%`;
    const conditions: Prisma.Sql[] = [];
    if (filter.actor?.trim()) {
      conditions.push(
        Prisma.sql`COALESCE(a.actor_id, 'system') ILIKE ${contains(filter.actor.trim())}`,
      );
    }
    if (filter.action?.trim()) {
      conditions.push(
        Prisma.sql`a.action ILIKE ${contains(filter.action.trim())}`,
      );
    }
    if (filter.target?.trim()) {
      conditions.push(
        Prisma.sql`COALESCE(a.entity_id, a.entity_type) ILIKE ${contains(filter.target.trim())}`,
      );
    }
    if (from) conditions.push(Prisma.sql`a.created_at >= ${from}`);
    if (to) conditions.push(Prisma.sql`a.created_at <= ${to}`);
    if (filter.query?.trim()) {
      const pattern = contains(filter.query.trim());
      conditions.push(
        Prisma.sql`(COALESCE(a.actor_id, 'system') ILIKE ${pattern} OR a.action ILIKE ${pattern} OR COALESCE(a.entity_id, a.entity_type) ILIKE ${pattern} OR COALESCE(a.context::text, '') ILIKE ${pattern})`,
      );
    }
    const where = conditions.length
      ? Prisma.join(conditions, " AND ")
      : Prisma.sql`TRUE`;
    const { rows, total, safePage, totalPages } = await readWithoutTransaction(prisma,
      async (transaction) => {
        const counts = await transaction.$queryRaw<{ count: bigint }[]>(
          Prisma.sql`SELECT COUNT(*) AS count FROM audit_logs a WHERE ${where}`,
        );
        const total = Number(counts[0]?.count ?? 0n);
        const totalPages = Math.max(1, Math.ceil(total / pageSize));
        const safePage = Math.min(page, totalPages);
        if (total === 0) {
          return { rows: [], total: 0, safePage, totalPages };
        }
        const offset = (safePage - 1) * pageSize;
        const ids = await transaction.$queryRaw<{ id: bigint }[]>(
          Prisma.sql`SELECT a.id FROM audit_logs a WHERE ${where} ORDER BY a.created_at DESC, a.id DESC LIMIT ${pageSize} OFFSET ${offset}`,
        );
        const rows =
          ids.length === 0
            ? []
            : await transaction.auditLog.findMany({
                where: { id: { in: ids.map((item) => item.id) } },
                orderBy: [{ createdAt: "desc" }, { id: "desc" }],
              });
        return { rows, total, safePage, totalPages };
      }
    );
    return {
      items: rows.map((row) => serviceContext.mapAudit(row)),
      total,
      page: safePage,
      pageSize,
      totalPages,
    };
  }
  const filtered = structuredClone(
    filterMemoryAudit(serviceContext.audit, filter, from, to),
  );
  return paginateArray(filtered, page, pageSize);
}

/** Tổng hợp chỉ số sức khỏe DB, độ trễ API, dung lượng lưu trữ và hàng đợi operational_jobs. */
export async function healthOverview(
  serviceContext: SystemServiceContext,
): Promise<object> {
  const prisma = serviceContext.database();
  if (!prisma) {
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
    prisma.operationalJob.count({
      where: { kind: "BACKUP", status: { in: ["PENDING", "RUNNING"] } },
    }),
    prisma.operationalJob.count({
      where: { kind: "RESTORE", status: { in: ["PENDING", "RUNNING"] } },
    }),
    prisma.operationalJob.count({
      where: { kind: "EXPORT", status: { in: ["PENDING", "RUNNING"] } },
    }),
  ]);
  const apiLatencyMs = Math.max(1, Math.round(performance.now() - startedAt));
  const totalQueueDepth = queueDepth.reduce((sum, value) => sum + value, 0);
  return {
    status: storage.usagePercent >= 90 ? "warning" : "healthy",
    database: "connected",
    apiLatencyMs,
    storageUsagePercent: storage.usagePercent,
    queueDepth: totalQueueDepth,
    checkedAt: new Date().toISOString(),
  };
}

/** Tổng hợp dung lượng lưu trữ theo lớp so với quota hệ thống. */
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
    where: {
      id: { in: groups.flatMap((item) => (item.classId ? [item.classId] : [])) },
    },
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
