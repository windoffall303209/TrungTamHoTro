import { ConfigService } from "@nestjs/config";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Environment } from "../../src/config/environment.js";
import type { PrismaService } from "../../src/database/prisma.service.js";
import type { SystemServiceContext } from "../../src/domains/system/core/system.context.js";
import {
  queueStorageAudit,
  runPaginatedStorageAudit,
} from "../../src/domains/system/operations/storage/system-storage-audit.js";
import {
  drainOperationalJobs,
  processQueuedStorageAudit,
  retryStorageAuditJob,
} from "../../src/domains/system/operations/workers/system-worker.js";
import { ObjectStorageService } from "../../src/infrastructure/object-storage.service.js";

/** Tạo ObjectStorageService cục bộ trên thư mục tạm cho bài test storage audit phân trang. */
function createLocalStorage(root: string): ObjectStorageService {
  const values: Record<string, unknown> = {
    STORAGE_PROVIDER: "local",
    STORAGE_ROOT: root,
    CLOUDINARY_FOLDER: "wind-edu",
    CLOUDINARY_CLOUD_NAME: "",
    CLOUDINARY_API_KEY: "",
    CLOUDINARY_API_SECRET: "",
  };
  const config = {
    get: (key: keyof Environment): unknown => values[key],
  } as unknown as ConfigService<Environment, true>;
  return new ObjectStorageService(config);
}

/** Tạo prisma mock hỗ trợ phân trang cursor khóa chính cho các bảng đối soát tài sản. */
function createPaginatedAuditPrisma(
  materials: Array<{ id: string; objectKey: string; checksum: string }>,
): {
  prisma: PrismaService;
  materialFindMany: ReturnType<typeof vi.fn>;
} {
  const materialFindMany = vi.fn(
    (args: { take?: number; cursor?: { id: string }; skip?: number }) => {
      const take = args.take ?? materials.length;
      const start = args.cursor
        ? materials.findIndex((m) => m.id === args.cursor!.id) + (args.skip ?? 0)
        : 0;
      return Promise.resolve(materials.slice(start, start + take));
    },
  );
  const emptyFindMany = vi.fn().mockResolvedValue([]);
  const prisma = {
    courseVersion: { findMany: emptyFindMany },
    learningClass: { findMany: emptyFindMany },
    material: { findMany: materialFindMany },
    assignmentSubmissionAttachment: { findMany: emptyFindMany },
    question: { findMany: emptyFindMany },
    chatMessageAttachment: { findMany: emptyFindMany },
    supportAttachment: { findMany: emptyFindMany },
  } as unknown as PrismaService;
  return { prisma, materialFindMany };
}

describe("E04 Paginated background storage audit job (HEAD/metadata, sampled checksum, lease, progress & retry)", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    for (const dir of tempDirs.splice(0)) {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("dùng cursor phân trang và HEAD/stat (không đọc toàn tệp khi sampleRate = 0), đồng thời bắt tệp thiếu và tệp sai checksum khi lấy mẫu 100%", async () => {
    const root = await mkdtemp(join(tmpdir(), "wind-e04-storage-"));
    tempDirs.push(root);
    const storage = createLocalStorage(root);

    // Tạo 12 tệp thật: 10 hợp lệ, 1 bị sửa checksum trên đĩa, 1 thiếu trên kho lưu trữ.
    const materials: Array<{ id: string; objectKey: string; checksum: string }> = [];
    for (let i = 1; i <= 10; i += 1) {
      const saved = await storage.put(`materials/ok-${i}.bin`, Buffer.from(`valid-content-${i}`));
      materials.push({ id: `mat-${String(i).padStart(2, "0")}`, ...saved });
    }
    const tampered = await storage.put("materials/tampered.bin", Buffer.from("original-bytes"));
    const tamperedStat = await storage.stat(tampered.objectKey);
    await writeFile(tamperedStat.localPath!, Buffer.from("corrupted-bytes"));
    materials.push({ id: "mat-11", ...tampered });
    materials.push({
      id: "mat-12",
      objectKey: "materials/missing.bin",
      checksum: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
    });

    const statSpy = vi.spyOn(storage, "stat");
    const openStreamSpy = vi.spyOn(storage, "openReadStream");
    const { prisma, materialFindMany } = createPaginatedAuditPrisma(materials);
    const context = {
      database: () => prisma,
      objectStorage: storage,
    } as unknown as SystemServiceContext;

    // Lượt 1: sampleRate = 0 -> chỉ dùng stat/HEAD, 0 openReadStream, phân trang 4 dòng/trang -> 4 lượt findMany (4+4+4+0).
    const progressMarks: number[] = [];
    const headOnlyReport = await runPaginatedStorageAudit(context, {
      sampleRate: 0,
      dbPageSize: 4,
      objectBatchSize: 5,
      onProgress: (pct) => {
        progressMarks.push(pct);
      },
    });
    expect(headOnlyReport.verificationMode).toBe("STAT_HEAD_AND_SAMPLE");
    expect(headOnlyReport.uniqueObjectCount).toBe(12);
    expect(headOnlyReport.missingObjects.map((m) => m.objectKey)).toEqual(["materials/missing.bin"]);
    expect(headOnlyReport.sampledChecksumCount).toBe(0);
    expect(headOnlyReport.checksumMismatches).toEqual([]);
    expect(statSpy).toHaveBeenCalledTimes(12);
    expect(openStreamSpy).not.toHaveBeenCalled();
    expect(materialFindMany.mock.calls.length).toBeGreaterThanOrEqual(3);
    expect(progressMarks[0]).toBe(25);
    expect(progressMarks[progressMarks.length - 1]).toBe(95);

    // Lượt 2: sampleRate = 1 -> kiểm tra checksum toàn bộ 11 object hiện hữu và phát hiện chính xác materials/tampered.bin.
    const fullSampleReport = await runPaginatedStorageAudit(context, {
      sampleRate: 1,
      seed: "e04-seed",
      dbPageSize: 5,
      objectBatchSize: 4,
    });
    expect(fullSampleReport.sampledChecksumCount).toBe(11);
    expect(fullSampleReport.missingObjects.map((m) => m.objectKey)).toEqual(["materials/missing.bin"]);
    expect(fullSampleReport.checksumMismatches).toHaveLength(1);
    expect(fullSampleReport.checksumMismatches?.[0]?.objectKey).toBe("materials/tampered.bin");
  });

  it("chạy vòng đời job nền AUDIT đầy đủ: queue -> claim/lease/progress -> COMPLETED, retry backoff và thu hồi lease quá hạn", async () => {
    const root = await mkdtemp(join(tmpdir(), "wind-e04-job-"));
    tempDirs.push(root);
    const storage = createLocalStorage(root);
    const saved = await storage.put("materials/doc-1.bin", Buffer.from("doc-content"));

    const { prisma: basePrisma } = createPaginatedAuditPrisma([
      { id: "mat-1", ...saved },
    ]);

    const state: { job: Record<string, unknown> | null } = { job: null };
    const progressUpdates: number[] = [];
    const prisma = {
      ...basePrisma,
      operationalJob: {
        create: vi.fn((args: { data: Record<string, unknown> }) => {
          state.job = {
            ...args.data,
            attempts: 0,
            rowCount: 0,
            verification: null,
            errorMessage: null,
            completedAt: null,
            createdAt: new Date(),
          };
          return Promise.resolve(state.job);
        }),
        findFirst: vi.fn((args: { where: { kind: string; status?: string } }) => {
          if (args.where.kind !== "AUDIT" || !state.job) return Promise.resolve(null);
          if (args.where.status && state.job.status !== args.where.status) return Promise.resolve(null);
          return Promise.resolve(state.job);
        }),
        findUniqueOrThrow: vi.fn(() => Promise.resolve(state.job)),
        updateMany: vi.fn((args: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
          if (!state.job) return Promise.resolve({ count: 0 });
          if (args.where.kind && args.where.kind !== state.job.kind) {
            const kindFilter = args.where.kind as { in?: string[] } | string;
            if (typeof kindFilter === "string" && kindFilter !== state.job.kind) {
              return Promise.resolve({ count: 0 });
            }
            if (typeof kindFilter === "object" && kindFilter.in && !kindFilter.in.includes(String(state.job.kind))) {
              return Promise.resolve({ count: 0 });
            }
          }
          if (args.where.status) {
            const statusFilter = args.where.status as { in?: string[] } | string;
            if (typeof statusFilter === "string" && statusFilter !== state.job.status) {
              return Promise.resolve({ count: 0 });
            }
            if (typeof statusFilter === "object" && statusFilter.in && !statusFilter.in.includes(String(state.job.status))) {
              return Promise.resolve({ count: 0 });
            }
          }
          if (args.where.attempts && typeof args.where.attempts === "object") {
            const filter = args.where.attempts as { gte?: number; lt?: number };
            const cur = Number(state.job.attempts ?? 0);
            if (filter.gte !== undefined && cur < filter.gte) return Promise.resolve({ count: 0 });
            if (filter.lt !== undefined && cur >= filter.lt) return Promise.resolve({ count: 0 });
          }
          if (args.where.availableAt && typeof args.where.availableAt === "object") {
            const filter = args.where.availableAt as { lte?: Date; gt?: Date };
            const cur = state.job.availableAt as Date;
            if (filter.lte && cur.getTime() > filter.lte.getTime()) return Promise.resolve({ count: 0 });
            if (filter.gt && cur.getTime() <= filter.gt.getTime()) return Promise.resolve({ count: 0 });
          }

          if (typeof args.data.progress === "number") progressUpdates.push(args.data.progress);
          const nextAttempts =
            typeof args.data.attempts === "object" && args.data.attempts && "increment" in args.data.attempts
              ? Number(state.job.attempts ?? 0) + Number((args.data.attempts as { increment: number }).increment)
              : (args.data.attempts ?? state.job.attempts);
          state.job = { ...state.job, ...args.data, attempts: nextAttempts };
          return Promise.resolve({ count: 1 });
        }),
      },
    } as unknown as PrismaService;

    const logDatabase = vi.fn().mockResolvedValue(undefined);
    const context = {
      database: () => prisma,
      objectStorage: storage,
      jobLeaseExpiry: () => new Date(Date.now() + 60_000),
      jobRetryAt: (attempts: number) => new Date(Date.now() + attempts * 30_000),
      jobError: (error: unknown, fallback: string) => (error instanceof Error ? error.message : fallback),
      logDatabase,
      processQueuedBackup: vi.fn().mockResolvedValue(false),
      processQueuedExport: vi.fn().mockResolvedValue(false),
      processQueuedStorageAudit: (db: PrismaService) => processQueuedStorageAudit(context, db),
      retryStorageAuditJob: (db: PrismaService, id: string, attempts: number, err: unknown) =>
        retryStorageAuditJob(context, db, id, attempts, err),
    } as unknown as SystemServiceContext;

    // 1. Queue job nền và chạy worker -> tiến độ tăng dần (5 -> 25 -> 95 -> 100) và lưu báo cáo hoàn tất.
    const queued = await queueStorageAudit(context, "admin-1", 1);
    expect(queued.status).toBe("PENDING");
    expect(queued.sampleRate).toBe(1);

    const processed = await processQueuedStorageAudit(context, prisma);
    expect(processed).toBe(true);
    expect(state.job?.status).toBe("COMPLETED");
    expect(state.job?.progress).toBe(100);
    expect(progressUpdates).toContain(5);
    expect(progressUpdates).toContain(25);
    expect(progressUpdates).toContain(100);
    const report = JSON.parse(String(state.job?.verification)) as { uniqueObjectCount: number; sampledChecksumCount: number };
    expect(report.uniqueObjectCount).toBe(1);
    expect(report.sampledChecksumCount).toBe(1);

    // 2. Retry backoff khi gặp lỗi tạm thời (attempts = 1 -> PENDING) và chuyển FAILED ở lần thử thứ 5.
    state.job = {
      ...state.job!,
      status: "RUNNING",
      attempts: 1,
      availableAt: new Date(Date.now() + 60_000),
    };
    await retryStorageAuditJob(context, prisma, String(state.job.id), 1, new Error("Storage timeout"));
    expect(state.job.status).toBe("PENDING");
    expect(state.job.errorMessage).toBe("Storage timeout");

    state.job = {
      ...state.job,
      status: "RUNNING",
      attempts: 5,
      availableAt: new Date(Date.now() + 60_000),
    };
    await retryStorageAuditJob(context, prisma, String(state.job.id), 5, new Error("Persistent failure"));
    expect(state.job.status).toBe("FAILED");

    // 3. Thu hồi lease RUNNING quá hạn trong drainOperationalJobs và tự chạy lại thành công.
    state.job = {
      ...state.job,
      status: "RUNNING",
      attempts: 1,
      progress: 40,
      availableAt: new Date(Date.now() - 10_000),
      completedAt: null,
    };
    const drained = await drainOperationalJobs(context, 3);
    expect(drained.audit).toBe(1);
    expect(state.job.status).toBe("COMPLETED");
  });
});
