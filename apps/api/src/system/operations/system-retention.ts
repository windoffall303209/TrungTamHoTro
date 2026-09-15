import { BadRequestException, NotFoundException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import {
  LegalHoldView,
  RetentionJobView,
  RetentionPolicyView,
  RetentionPreview,
} from "../system.shared.js";
import type { SystemServiceContext } from "../system.context.js";

/** Tính cutoff và số bản ghi sẽ tác động, đồng thời phản ánh legal hold hiện tại. */
export async function previewRetention(
  serviceContext: SystemServiceContext,
  categoryInput: string,
): Promise<RetentionPreview> {
  const category = serviceContext.retentionCategory(categoryInput);
  const policy = await serviceContext.getLatestRetentionPolicy(category);
  const settings = await serviceContext.getSettings();
  const retentionDays = policy?.retentionDays ?? settings.retentionDays;
  const action = policy?.action ?? "ARCHIVE";
  return serviceContext.previewRetentionPolicy({
    category,
    retentionDays,
    action,
  });
}

/** Liệt kê mọi phiên bản chính sách lưu giữ. */
export async function listRetentionPolicies(
  serviceContext: SystemServiceContext,
): Promise<RetentionPolicyView[]> {
  const prisma = serviceContext.database();
  if (prisma)
    return (
      await prisma.retentionPolicy.findMany({
        orderBy: [{ category: "asc" }, { version: "desc" }],
      })
    ).map((row) => serviceContext.mapRetentionPolicy(row));
  return structuredClone(
    [...serviceContext.retentionPolicies].sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt),
    ),
  );
}

/** Validate phê duyệt/ngày hiệu lực, tạo version kế tiếp và ghi audit chính sách. */
export async function createRetentionPolicy(
  serviceContext: SystemServiceContext,
  input: {
    category: string;
    retentionDays: number;
    action: "ARCHIVE" | "DELETE";
    approvedBy?: string;
    effectiveAt?: string;
  },
  actorId = "usr-admin",
): Promise<RetentionPolicyView> {
  const category = serviceContext.retentionCategory(input.category);
  const approvedBy = actorId.trim();
  if (input.retentionDays < 30 || input.retentionDays > 3650)
    throw new BadRequestException("Thời hạn lưu phải từ 30 đến 3650 ngày.");
  if (approvedBy.length < 3)
    throw new BadRequestException("Cần người phê duyệt chính sách.");
  const effectiveAt = input.effectiveAt
    ? new Date(input.effectiveAt)
    : new Date();
  if (Number.isNaN(effectiveAt.getTime()))
    throw new BadRequestException("Thời điểm hiệu lực không hợp lệ.");
  const prisma = serviceContext.database();
  if (prisma) {
    const latest = await prisma.retentionPolicy.findFirst({
      where: { category },
      orderBy: { version: "desc" },
    });
    const row = await prisma.$transaction(async (transaction) => {
      const created = await transaction.retentionPolicy.create({
        data: {
          id: `retention-policy-${randomUUID()}`,
          category,
          version: (latest?.version ?? 0) + 1,
          retentionDays: input.retentionDays,
          action: input.action,
          approvedBy,
          effectiveAt,
        },
      });
      await serviceContext.logDatabase(
        transaction,
        actorId,
        "RETENTION_POLICY_PUBLISHED",
        created.id,
        `${category} · ${input.action} · ${input.retentionDays} ngày.`,
      );
      return created;
    });
    return serviceContext.mapRetentionPolicy(row);
  }
  const version =
    Math.max(
      0,
      ...serviceContext.retentionPolicies
        .filter((item) => item.category === category)
        .map((item) => item.version),
    ) + 1;
  const item: RetentionPolicyView = {
    id: `retention-policy-${randomUUID()}`,
    category,
    version,
    retentionDays: input.retentionDays,
    action: input.action,
    approvedBy,
    effectiveAt: effectiveAt.toISOString(),
    createdAt: new Date().toISOString(),
  };
  serviceContext.retentionPolicies.unshift(item);
  serviceContext.log(
    actorId,
    "RETENTION_POLICY_PUBLISHED",
    item.id,
    `${category} · ${input.action} · ${input.retentionDays} ngày.`,
  );
  return structuredClone(item);
}

/** Đặt legal hold đang hoạt động cho danh mục để chặn retention job. */
export async function createLegalHold(
  serviceContext: SystemServiceContext,
  categoryInput: string,
  reasonInput: string,
  actorId = "usr-admin",
): Promise<object> {
  const category = serviceContext.retentionCategory(categoryInput);
  const reason = reasonInput.trim();
  if (reason.length < 5)
    throw new BadRequestException(
      "Loại dữ liệu và lý do legal hold là bắt buộc.",
    );
  const prisma = serviceContext.database();
  if (prisma) {
    const item = await prisma.legalHold.create({
      data: {
        id: `legal-hold-${randomUUID()}`,
        category,
        reason,
        createdBy: actorId,
      },
    });
    await serviceContext.logDatabase(
      prisma,
      actorId,
      "LEGAL_HOLD_CREATED",
      item.id,
      `${category} · ${reason}`,
    );
    return item;
  }
  const item = {
    id: `legal-hold-${randomUUID()}`,
    category,
    reason,
    active: true,
    createdBy: actorId,
    createdAt: new Date().toISOString(),
  };
  serviceContext.legalHolds.unshift(item);
  serviceContext.log(
    actorId,
    "LEGAL_HOLD_CREATED",
    item.id,
    `${category} · ${reason}`,
  );
  return structuredClone(item);
}

/** Liệt kê legal hold cùng trạng thái giải tỏa và người thực hiện. */
export async function listLegalHolds(
  serviceContext: SystemServiceContext,
): Promise<LegalHoldView[]> {
  const prisma = serviceContext.database();
  if (prisma) {
    const rows = await prisma.legalHold.findMany({
      orderBy: [{ active: "desc" }, { createdAt: "desc" }],
    });
    return rows.map((row) => ({
      id: row.id,
      category: row.category,
      reason: row.reason,
      active: row.active,
      createdBy: row.createdBy,
      createdAt: row.createdAt.toISOString(),
      releasedAt: row.releasedAt?.toISOString(),
      releasedBy: row.releasedBy ?? undefined,
      releaseReason: row.releaseReason ?? undefined,
    }));
  }
  return structuredClone(
    [...serviceContext.legalHolds].sort(
      (left, right) =>
        Number(right.active) - Number(left.active) ||
        right.createdAt.localeCompare(left.createdAt),
    ),
  );
}

/** Giải tỏa đúng một hold, giữ các hold khác và lưu lý do vào audit. */
export async function releaseLegalHold(
  serviceContext: SystemServiceContext,
  holdId: string,
  reasonInput: string,
  actorId = "usr-admin",
): Promise<LegalHoldView> {
  const reason = reasonInput.trim();
  if (reason.length < 5)
    throw new BadRequestException(
      "Lý do giải tỏa legal hold cần ít nhất 5 ký tự.",
    );
  const prisma = serviceContext.database();
  if (prisma) {
    const current = await prisma.legalHold.findUnique({
      where: { id: holdId },
    });
    if (!current) throw new NotFoundException("Không tìm thấy legal hold.");
    if (!current.active)
      throw new BadRequestException("Legal hold đã được giải tỏa trước đó.");
    const row = await prisma.$transaction(async (transaction) => {
      const changed = await transaction.legalHold.updateMany({
        where: { id: holdId, active: true },
        data: {
          active: false,
          releasedAt: new Date(),
          releasedBy: actorId,
          releaseReason: reason,
        },
      });
      if (changed.count !== 1)
        throw new BadRequestException(
          "Legal hold đã thay đổi; hãy tải lại danh sách.",
        );
      await serviceContext.logDatabase(
        transaction,
        actorId,
        "LEGAL_HOLD_RELEASED",
        holdId,
        `${current.category} · ${reason}`,
      );
      return transaction.legalHold.findUniqueOrThrow({ where: { id: holdId } });
    });
    return {
      id: row.id,
      category: row.category,
      reason: row.reason,
      active: row.active,
      createdBy: row.createdBy,
      createdAt: row.createdAt.toISOString(),
      releasedAt: row.releasedAt?.toISOString(),
      releasedBy: row.releasedBy ?? undefined,
      releaseReason: row.releaseReason ?? undefined,
    };
  }
  const item = serviceContext.legalHolds.find((hold) => hold.id === holdId);
  if (!item) throw new NotFoundException("Không tìm thấy legal hold.");
  if (!item.active)
    throw new BadRequestException("Legal hold đã được giải tỏa trước đó.");
  item.active = false;
  item.releasedAt = new Date().toISOString();
  item.releasedBy = actorId;
  item.releaseReason = reason;
  serviceContext.log(
    actorId,
    "LEGAL_HOLD_RELEASED",
    holdId,
    `${item.category} · ${reason}`,
  );
  return structuredClone(item);
}

/** Tạo yêu cầu chờ duyệt; danh tính người yêu cầu luôn lấy từ phiên đã xác thực. */
export async function runRetention(
  serviceContext: SystemServiceContext,
  policyId: string,
  requestedBy: string,
): Promise<RetentionJobView> {
  if (!requestedBy.trim()) throw new BadRequestException("Cần người yêu cầu.");
  const prisma = serviceContext.database();
  const policy = prisma
    ? await prisma.retentionPolicy.findUnique({ where: { id: policyId } })
    : serviceContext.retentionPolicies.find((item) => item.id === policyId);
  if (!policy)
    throw new NotFoundException("Không tìm thấy chính sách retention.");
  if (new Date(policy.effectiveAt) > new Date())
    throw new BadRequestException(
      "Chính sách retention chưa đến thời điểm hiệu lực.",
    );
  const preview = await serviceContext.previewRetentionPolicy({
    category: policy.category,
    retentionDays: policy.retentionDays,
    action: policy.action === "DELETE" ? "DELETE" : "ARCHIVE",
  });
  const data = {
    id: `retention-job-${randomUUID()}`,
    policyId,
    status: "PENDING" as const,
    requestedBy,
    approvedBy: "",
    evidence: {
      category: policy.category,
      action: policy.action,
      cutoffAt: preview.cutoffAt,
    },
    availableAt: new Date(),
  };
  if (prisma) {
    return prisma.$transaction(async (transaction) => {
      const row = await transaction.retentionJob.create({ data });
      await serviceContext.logDatabase(
        transaction,
        requestedBy,
        "RETENTION_APPROVAL_REQUESTED",
        row.id,
        "Chờ người dùng khác phê duyệt bằng phiên đăng nhập.",
      );
      return serviceContext.mapRetentionJob(row);
    });
  }
  const item: RetentionJobView = {
    ...data,
    affectedRows: 0,
    skippedRows: 0,
    attempts: 0,
    progress: 0,
    createdAt: new Date().toISOString(),
  };
  serviceContext.retentionJobs.unshift(item);
  return structuredClone(item);
}

/** Phê duyệt nguyên tử bằng danh tính phiên độc lập, không nhận tên người duyệt từ body. */
export async function approveRetention(
  serviceContext: SystemServiceContext,
  jobId: string,
  approverId: string,
): Promise<RetentionJobView> {
  const prisma = serviceContext.database();
  if (prisma) {
    return prisma.$transaction(async (transaction) => {
      const current = await transaction.retentionJob.findUnique({
        where: { id: jobId },
      });
      if (!current)
        throw new NotFoundException("Không tìm thấy tác vụ lưu giữ.");
      if (current.requestedBy === approverId)
        throw new BadRequestException(
          "Người phê duyệt phải khác người yêu cầu.",
        );
      const updated = await transaction.retentionJob.updateMany({
        where: {
          id: jobId,
          status: "PENDING",
          approvedAt: null,
          requestedBy: { not: approverId },
        },
        data: {
          approvedBy: approverId,
          approvedAt: new Date(),
          availableAt: new Date(),
        },
      });
      if (updated.count !== 1)
        throw new BadRequestException(
          "Tác vụ không còn chờ phê duyệt. Hãy tải lại danh sách.",
        );
      await serviceContext.logDatabase(
        transaction,
        approverId,
        "RETENTION_JOB_APPROVED",
        jobId,
        "Phê duyệt độc lập bằng phiên đăng nhập.",
      );
      return serviceContext.mapRetentionJob(
        await transaction.retentionJob.findUniqueOrThrow({
          where: { id: jobId },
        }),
      );
    });
  }
  const item = serviceContext.retentionJobs.find((row) => row.id === jobId);
  if (!item) throw new NotFoundException("Không tìm thấy tác vụ lưu giữ.");
  if (item.requestedBy === approverId)
    throw new BadRequestException("Người phê duyệt phải khác người yêu cầu.");
  if (item.status !== "PENDING" || item.approvedAt)
    throw new BadRequestException(
      "Tác vụ không còn chờ phê duyệt. Hãy tải lại danh sách.",
    );
  item.approvedBy = approverId;
  item.approvedAt = new Date().toISOString();
  return structuredClone(item);
}

/** Liệt kê các lần chạy retention cùng số bản ghi đã xử lý. */
export async function listRetentionJobs(
  serviceContext: SystemServiceContext,
): Promise<RetentionJobView[]> {
  const prisma = serviceContext.database();
  if (prisma)
    return (
      await prisma.retentionJob.findMany({ orderBy: { createdAt: "desc" } })
    ).map((row) => serviceContext.mapRetentionJob(row));
  return structuredClone(serviceContext.retentionJobs);
}

/** Tạo snapshot preview từ đúng một policy thay vì trộn với phiên bản mới nhất. */
export async function previewRetentionPolicy(
  serviceContext: SystemServiceContext,
  policy: Pick<RetentionPolicyView, "category" | "retentionDays" | "action">,
): Promise<RetentionPreview> {
  const cutoffAt = new Date(Date.now() - policy.retentionDays * 86_400_000);
  const prisma = serviceContext.database();
  const estimatedRows = prisma
    ? await serviceContext.countRetentionRows(prisma, policy.category, cutoffAt)
    : policy.category === "AUDIT"
      ? 12_840
      : policy.category === "LEARNING"
        ? 3_260
        : policy.category === "AI_RESULTS"
          ? 0
          : 840;
  const hasLegalHold = prisma
    ? Boolean(
        await prisma.legalHold.findFirst({
          where: { category: policy.category, active: true },
        }),
      )
    : serviceContext.legalHolds.some(
        (item) => item.category === policy.category && item.active,
      );
  const legalHoldRows = hasLegalHold ? estimatedRows : 0;
  return {
    category: policy.category,
    retentionDays: policy.retentionDays,
    action: policy.action,
    estimatedRows,
    legalHoldRows,
    deletableRows: estimatedRows - legalHoldRows,
    cutoffAt: cutoffAt.toISOString(),
  };
}
