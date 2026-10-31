import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import type { PrismaService } from "../../src/database/prisma.service.js";
import type { SystemServiceContext } from "../../src/domains/system/core/system.context.js";
import { snapshotAssetAudit } from "../../src/domains/system/operations/storage/system-storage-audit.js";
import { processQueuedExport } from "../../src/domains/system/operations/workers/system-worker.js";

type SnapshotDatabase = Record<
  "learningClass" | "courseVersion" | "material" | "materialVersion" |
  "assignmentSubmissionAttachment" | "question" | "chatMessageAttachment" | "supportAttachment",
  { findMany: ReturnType<typeof vi.fn> }
>;

// Tạo dữ liệu giả lập để đối soát một object dùng chung và một object lỗi.
function snapshotDatabase(): SnapshotDatabase {
  return {
    learningClass: { findMany: vi.fn().mockResolvedValue([{ id: "class-1", courseId: "course-1", courseVersion: 3 }]) },
    courseVersion: { findMany: vi.fn().mockResolvedValue([{ courseId: "course-1", version: 3 }]) },
    material: { findMany: vi.fn().mockResolvedValue([{ id: "material-1", objectKey: "shared" }]) },
    materialVersion: { findMany: vi.fn().mockResolvedValue([{ id: "version-1", objectKey: "shared" }]) },
    assignmentSubmissionAttachment: { findMany: vi.fn().mockResolvedValue([{ id: "attachment-1", objectKey: "broken" }]) },
    question: { findMany: vi.fn().mockResolvedValue([]) },
    chatMessageAttachment: { findMany: vi.fn().mockResolvedValue([]) },
    supportAttachment: { findMany: vi.fn().mockResolvedValue([]) },
  };
}

describe("Đối soát object theo stream", () => {
  it("chỉ giữ metadata, đọc hết stream và ghi nhận object lỗi giữa chừng", async () => {
    const prisma = snapshotDatabase();
    const get = vi.fn();
    const openReadStream = vi.fn((key: string): Promise<Readable> => {
      if (key === "shared") return Promise.resolve(Readable.from([Buffer.from("chunk-1"), Buffer.from("chunk-2")]));
      return Promise.resolve(Readable.from((function* (): Generator<Buffer> {
        yield Buffer.from("partial");
        throw new Error("storage disconnected");
      })()));
    });
    const context = {
      database: () => prisma,
      objectStorage: { get, openReadStream },
    } as unknown as SystemServiceContext;

    const result = await snapshotAssetAudit(context);

    expect(result.classesWithoutCourseSnapshot).toEqual([]);
    expect(result.referencedObjectCount).toBe(3);
    expect(result.uniqueObjectCount).toBe(2);
    expect(result.sharedObjects).toEqual([{
      objectKey: "shared", references: ["material:material-1", "material-version:version-1"],
    }]);
    expect(result.missingObjects).toEqual([{
      objectKey: "broken", references: ["assignment-attachment:attachment-1"],
    }]);
    expect(openReadStream.mock.calls.map(([key]) => key)).toEqual(["shared", "broken"]);
    expect(get).not.toHaveBeenCalled();
  });

  it("gom nhiều tham chiếu tới cùng một object theo đúng thứ tự và chỉ đọc object một lần", async () => {
    const prisma = snapshotDatabase();
    const sharedMaterials = Array.from({ length: 2_000 }, (_, index) => ({
      id: `material-${index}`,
      objectKey: "shared",
    }));
    prisma.material.findMany.mockResolvedValue(sharedMaterials);
    prisma.materialVersion.findMany.mockResolvedValue([]);
    prisma.assignmentSubmissionAttachment.findMany.mockResolvedValue([]);
    const openReadStream = vi.fn().mockResolvedValue(Readable.from([Buffer.from("shared file")]));
    const context = {
      database: () => prisma,
      objectStorage: { openReadStream },
    } as unknown as SystemServiceContext;

    const result = await snapshotAssetAudit(context);

    expect(result.referencedObjectCount).toBe(2_000);
    expect(result.uniqueObjectCount).toBe(1);
    expect(result.missingObjects).toEqual([]);
    expect(result.sharedObjects).toHaveLength(1);
    expect(result.sharedObjects[0]?.references).toHaveLength(2_000);
    expect(result.sharedObjects[0]?.references[0]).toBe("material:material-0");
    expect(result.sharedObjects[0]?.references[1_999]).toBe("material:material-1999");
    expect(openReadStream).toHaveBeenCalledExactlyOnceWith("shared");
  });
});

describe("Xác minh export theo stream", () => {
  // Tạo tác vụ export giả lập với luồng đọc lại có thể điều khiển trong kiểm thử.
  function exportFixture(readBack: () => Readable): {
    context: SystemServiceContext;
    prisma: PrismaService;
    get: ReturnType<typeof vi.fn>;
    openReadStream: ReturnType<typeof vi.fn>;
    updateMany: ReturnType<typeof vi.fn<(input: { data: { status?: string } }) => Promise<{ count: number }>>>;
    retryExportJob: ReturnType<typeof vi.fn<(db: PrismaService, id: string, attempts: number, error: unknown) => Promise<void>>>;
    logDatabase: ReturnType<typeof vi.fn>;
  } {
    const content = Buffer.from("header\nrow\n");
    const checksum = `sha256:${createHash("sha256").update(content).digest("hex")}`;
    const get = vi.fn();
    const put = vi.fn().mockResolvedValue({ objectKey: "exports/audit/job-1.csv", checksum });
    const openReadStream = vi.fn((): Promise<Readable> => Promise.resolve(readBack()));
    const updateMany = vi.fn<(input: { data: { status?: string } }) => Promise<{ count: number }>>().mockResolvedValue({ count: 1 });
    const prisma = {
      dataExportJob: {
        findFirst: vi.fn().mockResolvedValue({ id: "job-1", attempts: 0, category: "AUDIT", format: "CSV", requestedBy: "admin" }),
        updateMany,
      },
    } as unknown as PrismaService;
    const retryExportJob = vi.fn<(db: PrismaService, id: string, attempts: number, error: unknown) => Promise<void>>().mockResolvedValue(undefined);
    const logDatabase = vi.fn().mockResolvedValue(undefined);
    const context = {
      objectStorage: { put, get, openReadStream },
      collectExportRows: vi.fn().mockResolvedValue([{}]),
      serializeExport: vi.fn().mockReturnValue(content),
      jobLeaseExpiry: () => new Date(Date.now() + 60_000),
      retryExportJob,
      logDatabase,
    } as unknown as SystemServiceContext;
    return { context, prisma, get, openReadStream, updateMany, retryExportJob, logDatabase };
  }

  it("hoàn tất khi checksum khớp sau khi đọc nhiều chunk", async () => {
    const fixture = exportFixture(() => Readable.from([Buffer.from("header\n"), Buffer.from("row\n")]));

    expect(await processQueuedExport(fixture.context, fixture.prisma)).toBe(true);

    expect(fixture.get).not.toHaveBeenCalled();
    expect(fixture.openReadStream).toHaveBeenCalledWith("exports/audit/job-1.csv");
    expect(fixture.updateMany.mock.calls.some(([input]) => input.data.status === "COMPLETED")).toBe(true);
    expect(fixture.retryExportJob).not.toHaveBeenCalled();
    expect(fixture.logDatabase).toHaveBeenCalledOnce();
  });

  it("retry khi dữ liệu đọc lại bị sửa đổi", async () => {
    const fixture = exportFixture(() => Readable.from([Buffer.from("tampered") ]));

    expect(await processQueuedExport(fixture.context, fixture.prisma)).toBe(true);

    expect(fixture.updateMany.mock.calls.some(([input]) => input.data.status === "COMPLETED")).toBe(false);
    expect(fixture.retryExportJob).toHaveBeenCalledOnce();
    expect((fixture.retryExportJob.mock.calls[0]?.[3] as Error).message).toContain("checksum");
    expect(fixture.logDatabase).not.toHaveBeenCalled();
  });

  it("retry khi kết nối đọc stream đứt giữa chừng", async () => {
    const fixture = exportFixture(() => Readable.from((function* (): Generator<Buffer> {
      yield Buffer.from("partial");
      throw new Error("storage disconnected");
    })()));

    expect(await processQueuedExport(fixture.context, fixture.prisma)).toBe(true);

    expect(fixture.retryExportJob).toHaveBeenCalledOnce();
    expect(fixture.retryExportJob.mock.calls[0]?.[3]).toMatchObject({ message: "storage disconnected" });
    expect(fixture.logDatabase).not.toHaveBeenCalled();
  });
});
