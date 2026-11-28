import { BadRequestException } from "@nestjs/common";
import type { DashboardSummary } from "@wind-of-fall/contracts";
import { Prisma } from "../../../../generated/prisma/client.js";
import {
  paginateArray,
  type PaginatedResult,
} from "../../../../common/pagination.js";
import { getActiveDownloadCount } from "../../../../infrastructure/verified-download.js";
import type { MetricsService } from "../../../../observability/metrics.service.js";
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
      const actorPattern = contains(filter.actor.trim());
      conditions.push(
        Prisma.sql`public.wind_audit_search_text(a.actor_id, a.action, a.entity_id, a.entity_type, a.context) ILIKE ${actorPattern}`,
        Prisma.sql`COALESCE(a.actor_id, 'system') ILIKE ${actorPattern}`,
      );
    }
    if (filter.action?.trim()) {
      const actionPattern = contains(filter.action.trim());
      conditions.push(
        Prisma.sql`public.wind_audit_search_text(a.actor_id, a.action, a.entity_id, a.entity_type, a.context) ILIKE ${actionPattern}`,
        Prisma.sql`a.action ILIKE ${actionPattern}`,
      );
    }
    if (filter.target?.trim()) {
      const targetPattern = contains(filter.target.trim());
      conditions.push(
        Prisma.sql`public.wind_audit_search_text(a.actor_id, a.action, a.entity_id, a.entity_type, a.context) ILIKE ${targetPattern}`,
        Prisma.sql`COALESCE(a.entity_id, a.entity_type) ILIKE ${targetPattern}`,
      );
    }
    if (from) conditions.push(Prisma.sql`a.created_at >= ${from}`);
    if (to) conditions.push(Prisma.sql`a.created_at <= ${to}`);
    if (filter.query?.trim()) {
      const pattern = contains(filter.query.trim());
      // Prefilter qua GIN pg_trgm rồi giữ nguyên điều kiện OR từng trường để chống khớp chéo ranh giới trường.
      conditions.push(
        Prisma.sql`public.wind_audit_search_text(a.actor_id, a.action, a.entity_id, a.entity_type, a.context) ILIKE ${pattern}`,
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
  const [storage, totalQueueDepth] = await Promise.all([
    serviceContext.getStorageOverview(),
    prisma.operationalJob.count({
      where: {
        kind: { in: ["BACKUP", "RESTORE", "EXPORT", "AUDIT"] },
        status: { in: ["PENDING", "RUNNING"] },
      },
    }),
  ]);
  const apiLatencyMs = Math.max(1, Math.round(performance.now() - startedAt));
  return {
    status: storage.usagePercent >= 90 ? "warning" : "healthy",
    database: "connected",
    apiLatencyMs,
    storageUsagePercent: storage.usagePercent,
    queueDepth: totalQueueDepth,
    checkedAt: new Date().toISOString(),
  };
}

/** Chuyển kết quả groupBy có `_count._all` sang map đếm gọn không tải bản ghi thô. */
function countsByKey(
  rows: ReadonlyArray<{ key: string; count: number }>,
): Record<string, number> {
  const result: Record<string, number> = {};
  for (const row of rows) {
    result[row.key] = (result[row.key] ?? 0) + row.count;
  }
  return result;
}

/**
 * Tổng hợp toàn bộ chỉ số dashboard quản trị trực tiếp từ SQL aggregate (COUNT/GROUP BY/SUM),
 * tuyệt đối không tải danh sách thô người dùng, lớp học, audit hay hàng đợi về bộ nhớ ứng dụng.
 */
export async function getDashboardSummary(
  serviceContext: SystemServiceContext,
  metrics?: MetricsService,
): Promise<DashboardSummary> {
  const settings = await serviceContext.getSettings();
  const quotaBytes = settings.storageQuotaMb * 1_000_000;
  const runtime = {
    databasePool: metrics?.getDatabasePoolMetrics() ?? {
      enabled: false,
      max: 0,
      totalCount: 0,
      idleCount: 0,
      activeCount: 0,
      waitingCount: 0,
    },
    sse: metrics?.getSseMetrics() ?? {
      activeConnections: 0,
      totalOpened: 0,
      byChannel: { realtime: 0, notifications: 0, chat: 0, operations: 0 },
      listenerConnected: false,
      listenerReconnects: 0,
      activeBusWatchers: 0,
      eventsReceived: 0,
    },
    activeDownloads: getActiveDownloadCount(),
  };
  const prisma = serviceContext.database();
  if (!prisma) {
    return {
      generatedAt: new Date().toISOString(),
      database: "disabled",
      users: { total: 0, active: 0, pending: 0, locked: 0 },
      academic: {
        courses: 0,
        classes: 0,
        activeClasses: 0,
        activeEnrollments: 0,
        exams: 0,
        assignments: 0,
        openTickets: 0,
      },
      outbox: {},
      jobs: { pending: 0, running: 0, failed: 0, byKind: {} },
      ai: {
        studyDrafts: {},
        gradingSuggestions: {},
        documentAnswers: {},
        generationRequests: {},
      },
      storage: { quotaBytes, usedBytes: 0, usagePercent: 0, materialCount: 0 },
      runtime,
    };
  }

  const [
    userGroups,
    courseCount,
    classGroups,
    activeEnrollments,
    examCount,
    assignmentCount,
    openTickets,
    outboxGroups,
    jobGroups,
    studyGroups,
    gradingGroups,
    answerGroups,
    generationGroups,
    materialAgg,
  ] = await Promise.all([
    prisma.user.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.course.count(),
    prisma.learningClass.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.classEnrollment.count({ where: { status: "ACTIVE" } }),
    prisma.exam.count(),
    prisma.assignment.count(),
    prisma.supportTicket.count({ where: { status: { in: ["OPEN", "IN_PROGRESS"] } } }),
    prisma.outboxDelivery.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.operationalJob.groupBy({ by: ["kind", "status"], _count: { _all: true } }),
    prisma.aiStudyDraft.groupBy({ by: ["state"], _count: { _all: true } }),
    prisma.aiGradingSuggestion.groupBy({ by: ["state"], _count: { _all: true } }),
    prisma.aiDocumentAnswer.groupBy({ by: ["state"], _count: { _all: true } }),
    prisma.aiGenerationRequest.groupBy({ by: ["state"], _count: { _all: true } }),
    prisma.material.aggregate({ _sum: { sizeBytes: true }, _count: { _all: true } }),
  ]);

  const userCounts = countsByKey(
    userGroups.map((row) => ({ key: row.status, count: row._count._all })),
  );
  const totalUsers = Object.values(userCounts).reduce((sum, value) => sum + value, 0);
  const classCounts = countsByKey(
    classGroups.map((row) => ({ key: row.status, count: row._count._all })),
  );
  const totalClasses = Object.values(classCounts).reduce((sum, value) => sum + value, 0);

  const byKind: Record<string, Record<string, number>> = {};
  let pendingJobs = 0;
  let runningJobs = 0;
  let failedJobs = 0;
  for (const row of jobGroups) {
    const bucket = (byKind[row.kind] ??= {});
    bucket[row.status] = (bucket[row.status] ?? 0) + row._count._all;
    if (row.status === "PENDING") pendingJobs += row._count._all;
    else if (row.status === "RUNNING") runningJobs += row._count._all;
    else if (row.status === "FAILED") failedJobs += row._count._all;
  }

  const usedBytes = Number(materialAgg._sum.sizeBytes ?? 0n);
  const usagePercent =
    quotaBytes > 0 ? Math.min(100, Math.round((usedBytes / quotaBytes) * 1000) / 10) : 0;

  return {
    generatedAt: new Date().toISOString(),
    database: "connected",
    users: {
      total: totalUsers,
      active: userCounts.ACTIVE ?? 0,
      pending: (userCounts.PENDING ?? 0) + (userCounts.PENDING_VERIFICATION ?? 0),
      locked: userCounts.LOCKED ?? 0,
    },
    academic: {
      courses: courseCount,
      classes: totalClasses,
      activeClasses: classCounts.ACTIVE ?? 0,
      activeEnrollments,
      exams: examCount,
      assignments: assignmentCount,
      openTickets,
    },
    outbox: countsByKey(
      outboxGroups.map((row) => ({ key: row.status, count: row._count._all })),
    ),
    jobs: {
      pending: pendingJobs,
      running: runningJobs,
      failed: failedJobs,
      byKind,
    },
    ai: {
      studyDrafts: countsByKey(
        studyGroups.map((row) => ({ key: row.state, count: row._count._all })),
      ),
      gradingSuggestions: countsByKey(
        gradingGroups.map((row) => ({ key: row.state, count: row._count._all })),
      ),
      documentAnswers: countsByKey(
        answerGroups.map((row) => ({ key: row.state, count: row._count._all })),
      ),
      generationRequests: countsByKey(
        generationGroups.map((row) => ({ key: row.state, count: row._count._all })),
      ),
    },
    storage: {
      quotaBytes,
      usedBytes,
      usagePercent,
      materialCount: materialAgg._count._all,
    },
    runtime,
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
