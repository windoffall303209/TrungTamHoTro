import { ConfigService } from "@nestjs/config";
import { createReadStream } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Environment } from "../../src/config/environment.js";
import type { PrismaService } from "../../src/database/prisma.service.js";
import type { SystemServiceContext } from "../../src/domains/system/core/system.context.js";
import { downloadExportStream } from "../../src/domains/system/operations/storage/system-export-download.js";
import {
  EXPORT_CSV_COLUMNS,
  streamExportToFile,
  writeExportBatchesToFile,
} from "../../src/domains/system/operations/storage/system-export-format.js";
import { processQueuedExport } from "../../src/domains/system/operations/workers/system-worker.js";
import { ObjectStorageService } from "../../src/infrastructure/object-storage.service.js";

/** Tạo ObjectStorageService cục bộ trên thư mục tạm cho kiểm thử streaming export. */
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

/** Sinh 100.000 dòng tổng hợp theo từng lô 500 dòng (gồm cả chuỗi công thức CSV injection) để đo RAM tăng thực tế. */
async function* generateSyntheticAuditBatches(
  totalRows: number,
  batchSize = 500,
): AsyncGenerator<Array<Record<string, unknown>>> {
  await Promise.resolve();
  for (let offset = 0; offset < totalRows; offset += batchSize) {
    const count = Math.min(batchSize, totalRows - offset);
    const batch: Array<Record<string, unknown>> = [];
    for (let index = 0; index < count; index += 1) {
      const id = BigInt(offset + index + 1);
      batch.push({
        entity: "audit_log",
        id,
        actorId: `usr-${(offset + index) % 50}`,
        action:
          offset + index === 0
            ? "=SUM(A1:A10)"
            : offset + index === 1
              ? "+cmd|' /C calc'!A0"
              : offset + index === 2
                ? "-2+3"
                : offset + index === 3
                  ? "@HYPERLINK(\"http://evil\")"
                  : offset + index === 4
                    ? "\t=1+1"
                    : "USER_LOGIN",
        entityType: "session",
        entityId: `sess-${id.toString()}`,
        requestId: `req-${id.toString()}`,
        context: { ip: "127.0.0.1", note: `Log entry #${id.toString()}` },
        createdAt: new Date("2026-11-25T10:00:00.000Z"),
      });
    }
    yield batch;
  }
}

describe("E03 Cursor streaming export (100,000 rows, <50 MB RAM, CSV injection & download RBAC)", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    for (const dir of tempDirs.splice(0)) {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("stream 100.000 dòng ra CSV và JSON với mức tăng RAM < 50 MB và vô hiệu hóa công thức CSV injection", async () => {
    const dir = await mkdtemp(join(tmpdir(), "wind-e03-export-"));
    tempDirs.push(dir);
    const csvPath = join(dir, "audit-100k.csv");
    const jsonPath = join(dir, "audit-100k.json");

    // Đo mức tăng RSS/heap trong suốt quá trình stream 100.000 dòng CSV.
    const csvMemStart = process.memoryUsage();
    let csvPeakHeap = csvMemStart.heapUsed;
    let csvPeakRss = csvMemStart.rss;
    const csvSummary = await writeExportBatchesToFile(
      generateSyntheticAuditBatches(100_000, 500),
      "CSV",
      csvPath,
      EXPORT_CSV_COLUMNS.AUDIT!,
      () => {
        const mem = process.memoryUsage();
        if (mem.heapUsed > csvPeakHeap) csvPeakHeap = mem.heapUsed;
        if (mem.rss > csvPeakRss) csvPeakRss = mem.rss;
      },
    );

    expect(csvSummary.rowCount).toBe(100_000);
    expect(csvSummary.sizeBytes).toBeGreaterThan(10_000_000);
    expect(csvSummary.checksum).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(csvPeakHeap - csvMemStart.heapUsed).toBeLessThan(50 * 1024 * 1024);
    expect(csvPeakRss - csvMemStart.rss).toBeLessThan(50 * 1024 * 1024);

    // Đọc phần đầu tệp CSV để xác minh BOM UTF-8, tiêu đề và toàn bộ payload công thức đã bị vô hiệu hóa bằng dấu nháy đơn.
    const headChunks: Buffer[] = [];
    for await (const chunk of createReadStream(csvPath, { start: 0, end: 4095 })) {
      headChunks.push(chunk as Buffer);
    }
    const csvHead = Buffer.concat(headChunks).toString("utf8");
    expect(csvHead.startsWith("\uFEFF")).toBe(true);
    expect(csvHead).toContain('"\'=SUM(A1:A10)"');
    expect(csvHead).toContain('"\'+cmd|\' /C calc\'!A0"');
    expect(csvHead).toContain('"\'-2+3"');
    expect(csvHead).toContain('"\'@HYPERLINK(""http://evil"")"');
    expect(csvHead).toContain('"\'\t=1+1"');

    // Đo stream 100.000 dòng JSON hợp lệ với mức tăng RAM < 50 MB.
    const jsonMemStart = process.memoryUsage();
    let jsonPeakHeap = jsonMemStart.heapUsed;
    const jsonSummary = await writeExportBatchesToFile(
      generateSyntheticAuditBatches(100_000, 500),
      "JSON",
      jsonPath,
      EXPORT_CSV_COLUMNS.AUDIT!,
      () => {
        const mem = process.memoryUsage();
        if (mem.heapUsed > jsonPeakHeap) jsonPeakHeap = mem.heapUsed;
      },
    );

    expect(jsonSummary.rowCount).toBe(100_000);
    expect(jsonSummary.sizeBytes).toBeGreaterThan(15_000_000);
    expect(jsonPeakHeap - jsonMemStart.heapUsed).toBeLessThan(50 * 1024 * 1024);
    const jsonHead = (await readFile(jsonPath)).subarray(0, 128).toString("utf8");
    expect(jsonHead).toContain('"format":"wind-edu-data-export"');
    expect(jsonHead).toContain('"rows":[{"entity":"audit_log","id":"1"');
  });

  it("chạy trọn luồng cursor worker -> putFile -> checksum và giữ nguyên quyền download chỉ cho người tạo bản xuất", async () => {
    const storageRoot = await mkdtemp(join(tmpdir(), "wind-e03-storage-"));
    tempDirs.push(storageRoot);
    const storage = createLocalStorage(storageRoot);
    const putFileSpy = vi.spyOn(storage, "putFile");
    const putBufferSpy = vi.spyOn(storage, "put");

    // Giả lập bảng auditLog gồm 1.200 dòng trả về theo từng trang cursor (take = 500).
    const allAuditRows = Array.from({ length: 1_200 }, (_, i) => ({
      id: BigInt(i + 1),
      actorId: "admin-owner",
      action: i === 0 ? "=1+1" : "SYSTEM_EVENT",
      entityType: "system",
      entityId: `e-${i + 1}`,
      requestId: `r-${i + 1}`,
      context: { token: "secret-should-redact", index: i + 1 },
      createdAt: new Date("2026-11-25T10:00:00.000Z"),
    }));
    const findMany = vi.fn(
      (args: { take: number; cursor?: { id: bigint }; skip?: number }) => {
        const startIdx = args.cursor
          ? allAuditRows.findIndex((row) => row.id === args.cursor!.id) + (args.skip ?? 0)
          : 0;
        return Promise.resolve(allAuditRows.slice(startIdx, startIdx + args.take));
      },
    );

    let completedData: Record<string, unknown> | null = null;
    const prisma = {
      auditLog: { findMany },
      operationalJob: {
        findFirst: vi.fn().mockResolvedValue({
          id: "export-e03",
          kind: "EXPORT",
          attempts: 0,
          category: "AUDIT",
          format: "CSV",
          requestedBy: "admin-owner",
        }),
        updateMany: vi.fn((args: { data: Record<string, unknown> }) => {
          if (args.data.status === "COMPLETED") completedData = args.data;
          return Promise.resolve({ count: 1 });
        }),
        findUnique: vi.fn(() =>
          Promise.resolve(
            completedData
              ? {
                  id: "export-e03",
                  kind: "EXPORT",
                  category: "AUDIT",
                  format: "CSV",
                  status: "COMPLETED",
                  requestedBy: "admin-owner",
                  objectKey: completedData.objectKey,
                  checksum: completedData.checksum,
                  sizeBytes: completedData.sizeBytes,
                  expiresAt: new Date(Date.now() + 3600_000),
                }
              : null,
          ),
        ),
      },
    } as unknown as PrismaService;

    const logDatabase = vi.fn().mockResolvedValue(undefined);
    const context = {
      database: () => prisma,
      objectStorage: storage,
      streamExportToFile,
      jobLeaseExpiry: () => new Date(Date.now() + 60_000),
      retryExportJob: vi.fn().mockResolvedValue(undefined),
      logDatabase,
    } as unknown as SystemServiceContext;

    expect(await processQueuedExport(context, prisma)).toBe(true);
    // 1.200 dòng với batch 500 -> gọi đúng 3 trang cursor (500 + 500 + 200), dùng putFile chứ không gọi put(buffer).
    expect(findMany).toHaveBeenCalledTimes(3);
    expect(putFileSpy).toHaveBeenCalledOnce();
    expect(putBufferSpy).not.toHaveBeenCalled();
    expect(completedData).toMatchObject({ status: "COMPLETED", rowCount: 1_200, progress: 100 });

    // Người tạo tải được bằng streaming và nội dung giữ nguyên CSV injection neutralization + redaction.
    const downloaded = await downloadExportStream(context, "export-e03", "admin-owner");
    const chunks: Buffer[] = [];
    for await (const chunk of downloaded.stream) chunks.push(chunk as Buffer);
    const text = Buffer.concat(chunks).toString("utf8");
    expect(text).toContain('"\'=1+1"');
    expect(text).not.toContain("secret-should-redact");

    // Quản trị viên khác KHÔNG phải người tạo vẫn bị chặn 404.
    await expect(
      downloadExportStream(context, "export-e03", "another-admin"),
    ).rejects.toMatchObject({ status: 404 });
  });
});
