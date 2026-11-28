import { BadRequestException, ConflictException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import type { PrismaService } from "../../src/database/prisma.service.js";
import type { SystemServiceContext } from "../../src/domains/system/core/system.context.js";
import { approveRestore } from "../../src/domains/system/operations/retention/system-backups.js";
import { drainOperationalJobs } from "../../src/domains/system/operations/workers/system-worker.js";

type OperationalJobRow = {
  id: string;
  kind: "BACKUP" | "EXPORT" | "RESTORE";
  status: "PENDING" | "RUNNING" | "COMPLETED" | "FAILED";
  mode?: "DRILL" | "OPERATIONAL" | null;
  targetDatabase?: string | null;
  requestedBy: string;
  approvedBy?: string | null;
  approvedAt?: Date | null;
  availableAt: Date;
  attempts: number;
  checksum?: string | null;
  objectKey?: string | null;
  sizeBytes?: bigint | null;
  verification?: string | null;
  completedAt?: Date | null;
  errorMessage?: string | null;
  backup?: OperationalJobRow | null;
};

/** Dựng kho operational_jobs mô phỏng nguyên tử cho các tình huống lỗi restore và worker thu hồi lease. */
function createRestoreFixture(): {
  jobs: Map<string, OperationalJobRow>;
  context: SystemServiceContext;
  prisma: PrismaService;
} {
  const jobs = new Map<string, OperationalJobRow>();
  const prisma = {
    $transaction: vi.fn((callback: (tx: unknown) => Promise<unknown>) => callback(prisma)),
    $executeRaw: vi.fn().mockResolvedValue(1),
    systemSetting: {
      findUnique: vi.fn().mockResolvedValue({ key: "platform", value: { maintenanceMode: true }, updatedAt: new Date(), version: 1, updatedBy: "usr-admin-1" }),
    },
    user: {
      findUnique: vi.fn().mockResolvedValue({
        id: "usr-admin-2",
        status: "ACTIVE",
        roles: [{ role: { permissions: [{ permission: { code: "system:configure" } }] } }],
      }),
    },
    operationalJob: {
      findUnique: vi.fn(({ where }: { where: { id: string; kind?: string } }) => {
        const row = jobs.get(where.id);
        if (!row || (where.kind && row.kind !== where.kind)) return Promise.resolve(null);
        return Promise.resolve(structuredClone(row));
      }),
      findFirst: vi.fn().mockResolvedValue(null),
      count: vi.fn(({ where }: { where: { kind?: string; status?: string } }) => {
        const total = [...jobs.values()].filter(
          (row) => (!where.kind || row.kind === where.kind) && (!where.status || row.status === where.status),
        ).length;
        return Promise.resolve(total);
      }),
      updateMany: vi.fn(
        ({
          where,
          data,
        }: {
          where: {
            id?: string;
            kind?: string | { in: string[] };
            status?: string | { in: string[] };
            attempts?: { gte?: number; lt?: number };
            availableAt?: { lte?: Date; gt?: Date };
          };
          data: Partial<OperationalJobRow>;
        }) => {
          let count = 0;
          for (const [key, row] of jobs.entries()) {
            if (where.id && row.id !== where.id) continue;
            if (typeof where.kind === "string" && row.kind !== where.kind) continue;
            if (where.kind && typeof where.kind === "object" && !where.kind.in.includes(row.kind)) continue;
            if (typeof where.status === "string" && row.status !== where.status) continue;
            if (where.status && typeof where.status === "object" && !where.status.in.includes(row.status)) continue;
            if (where.attempts?.gte !== undefined && row.attempts < where.attempts.gte) continue;
            if (where.attempts?.lt !== undefined && row.attempts >= where.attempts.lt) continue;
            if (where.availableAt?.lte && row.availableAt > where.availableAt.lte) continue;
            if (where.availableAt?.gt && row.availableAt <= where.availableAt.gt) continue;
            jobs.set(key, { ...row, ...data });
            count += 1;
          }
          return Promise.resolve({ count });
        },
      ),
      update: vi.fn(({ where, data }: { where: { id: string }; data: Partial<OperationalJobRow> }) => {
        const row = jobs.get(where.id);
        if (!row) return Promise.reject(new Error("Missing row"));
        const next = { ...row, ...data };
        jobs.set(where.id, next);
        return Promise.resolve(structuredClone(next));
      }),
    },
  } as unknown as PrismaService;

  const context = {
    database: () => prisma,
    databaseBackup: {
      isCurrentDatabase: (name: string) => name.trim().toLowerCase() === "wind_edu",
      verifyRestore: vi.fn().mockResolvedValue({ database: "wind_tmp", tableCount: 10, rowCount: 100 }),
      restoreToDatabase: vi.fn().mockResolvedValue({ database: "wind_staging", tableCount: 10, rowCount: 100 }),
    },
    objectStorage: {
      getToFile: vi.fn().mockResolvedValue({ checksum: "sha256:valid", size: 128 }),
    },
    mapSettings: (value: { maintenanceMode?: boolean }) => ({ maintenanceMode: Boolean(value?.maintenanceMode) }),
    mapRestore: (row: OperationalJobRow) => row,
    logDatabase: vi.fn().mockResolvedValue(undefined),
    jobLeaseExpiry: () => new Date(Date.now() + 10 * 60_000),
    processQueuedBackup: vi.fn().mockResolvedValue(false),
    processQueuedExport: vi.fn().mockResolvedValue(false),
  } as unknown as SystemServiceContext;

  return { jobs, context, prisma };
}

describe("vòng đời restore và thu hồi lease worker (D06)", () => {
  it("từ chối phê duyệt OPERATIONAL restore nếu thiếu tên database đích", async () => {
    const { jobs, context } = createRestoreFixture();
    const backup: OperationalJobRow = {
      id: "backup-1",
      kind: "BACKUP",
      status: "COMPLETED",
      requestedBy: "usr-admin-1",
      availableAt: new Date(),
      attempts: 1,
      checksum: "sha256:valid",
      objectKey: "backups/b1.dump",
      sizeBytes: 128n,
    };
    jobs.set("restore-missing-target", {
      id: "restore-missing-target",
      kind: "RESTORE",
      status: "PENDING",
      mode: "OPERATIONAL",
      targetDatabase: "",
      requestedBy: "usr-admin-1",
      availableAt: new Date(),
      attempts: 0,
      backup,
    });

    await expect(approveRestore(context, "restore-missing-target", "usr-admin-2")).rejects.toThrow(BadRequestException);
  });

  it("chặn phê duyệt restore thứ hai khi một restore khác đang RUNNING", async () => {
    const { jobs, context } = createRestoreFixture();
    const backup: OperationalJobRow = {
      id: "backup-1",
      kind: "BACKUP",
      status: "COMPLETED",
      requestedBy: "usr-admin-1",
      availableAt: new Date(),
      attempts: 1,
      checksum: "sha256:valid",
      objectKey: "backups/b1.dump",
      sizeBytes: 128n,
    };
    jobs.set("restore-active", {
      id: "restore-active",
      kind: "RESTORE",
      status: "RUNNING",
      mode: "OPERATIONAL",
      targetDatabase: "wind_staging_a",
      requestedBy: "usr-admin-1",
      approvedBy: "usr-admin-2",
      availableAt: new Date(Date.now() + 5 * 60_000),
      attempts: 1,
      backup,
    });
    jobs.set("restore-second", {
      id: "restore-second",
      kind: "RESTORE",
      status: "PENDING",
      mode: "OPERATIONAL",
      targetDatabase: "wind_staging_b",
      requestedBy: "usr-admin-1",
      availableAt: new Date(),
      attempts: 0,
      backup,
    });

    await expect(approveRestore(context, "restore-second", "usr-admin-2")).rejects.toThrow(ConflictException);
    expect(jobs.get("restore-second")?.status).toBe("PENDING");
  });

  it("worker thu hồi restore RUNNING đã hết hạn lease sang FAILED (không tự chạy lại) để mở khóa chế độ bảo trì", async () => {
    const { jobs, context } = createRestoreFixture();
    jobs.set("restore-crashed", {
      id: "restore-crashed",
      kind: "RESTORE",
      status: "RUNNING",
      mode: "OPERATIONAL",
      targetDatabase: "wind_staging_crashed",
      requestedBy: "usr-admin-1",
      approvedBy: "usr-admin-2",
      availableAt: new Date(Date.now() - 60_000),
      attempts: 1,
    });

    await drainOperationalJobs(context, 4);
    const recovered = jobs.get("restore-crashed");
    expect(recovered?.status).toBe("FAILED");
    expect(recovered?.completedAt).toBeInstanceOf(Date);
    expect(recovered?.verification).toContain("hết hạn");
  });
});
