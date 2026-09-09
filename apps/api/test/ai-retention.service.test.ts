import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { PrismaService } from "../src/database/prisma.service.js";
import type { ObjectStorageService } from "../src/infrastructure/object-storage.service.js";
import { SystemService } from "../src/system/system.service.js";

type RetentionInternals = {
  countRetentionRows(prisma: PrismaService, category: string, cutoffAt: Date): Promise<number>;
  executeRetention(prisma: PrismaService, category: string, action: "ARCHIVE" | "DELETE", cutoffAt: Date, jobId: string): Promise<{ affectedRows: number }>;
};
type RetentionPrismaMocks = {
  systemSetting: { findMany: ReturnType<typeof vi.fn>; deleteMany: ReturnType<typeof vi.fn> };
  aiGradingSuggestion: { count: ReturnType<typeof vi.fn>; findMany: ReturnType<typeof vi.fn>; deleteMany: ReturnType<typeof vi.fn> };
  aiStudyDraft: { count: ReturnType<typeof vi.fn>; findMany: ReturnType<typeof vi.fn>; deleteMany: ReturnType<typeof vi.fn> };
  $transaction: ReturnType<typeof vi.fn>;
  systemDelete: ReturnType<typeof vi.fn>;
  gradingDelete: ReturnType<typeof vi.fn>;
  studyDelete: ReturnType<typeof vi.fn>;
};

/** Tạo Prisma mock đủ để kiểm tra phạm vi AI retention mà không cần database ngoài. */
function createRetentionPrisma(): { prisma: PrismaService; mocks: RetentionPrismaMocks } {
  const systemDelete = vi.fn().mockResolvedValue({ count: 2 });
  const gradingDelete = vi.fn().mockResolvedValue({ count: 1 });
  const studyDelete = vi.fn().mockResolvedValue({ count: 1 });
  const prisma = {
    systemSetting: {
      findMany: vi.fn().mockResolvedValue([
        { key: "ai-doc:ready-legacy", value: [{ page: 1, text: "Nội dung" }], updatedAt: new Date("2025-01-01") },
        { key: "ai-doc-answer:ready", value: { state: "READY", result: { answer: "Đã lưu" } }, updatedAt: new Date("2025-01-02") },
        { key: "ai-doc-answer:uncertain", value: { state: "UNCERTAIN" }, updatedAt: new Date("2025-01-03") },
        { key: "ai-doc:generating", value: { state: "GENERATING" }, updatedAt: new Date("2025-01-04") },
      ]),
      deleteMany: systemDelete,
    },
    aiGradingSuggestion: {
      count: vi.fn().mockResolvedValue(1),
      findMany: vi.fn().mockResolvedValue([{ id: "grading-ready", state: "READY", updatedAt: new Date("2025-01-01") }]),
      deleteMany: gradingDelete,
    },
    aiStudyDraft: {
      count: vi.fn().mockResolvedValue(1),
      findMany: vi.fn().mockResolvedValue([{ id: "study-ready-unpublished", state: "READY", publishedAt: null, updatedAt: new Date("2025-01-01") }]),
      deleteMany: studyDelete,
    },
    $transaction: vi.fn(async (operations: Array<Promise<unknown>>) => Promise.all(operations)),
  };
  return { prisma: prisma as unknown as PrismaService, mocks: { ...prisma, systemDelete, gradingDelete, studyDelete } };
}

describe("AI results retention", () => {
  it("counts only READY AI results and excludes published study drafts by query", async () => {
    const { prisma, mocks } = createRetentionPrisma();
    const service = new SystemService();

    await expect((service as unknown as RetentionInternals).countRetentionRows(prisma, "AI_RESULTS", new Date("2026-01-01"))).resolves.toBe(4);
    expect(mocks.aiGradingSuggestion.count).toHaveBeenCalledWith({ where: { state: "READY", updatedAt: { lt: new Date("2026-01-01") } } });
    expect(mocks.aiStudyDraft.count).toHaveBeenCalledWith({ where: { state: "READY", publishedAt: null, updatedAt: { lt: new Date("2026-01-01") } } });
  });

  it("archives typed AI records before deleting only the selected READY identifiers", async () => {
    const { prisma, mocks } = createRetentionPrisma();
    let archived: Buffer<ArrayBufferLike> = Buffer.alloc(0);
    const storage = {
      put: vi.fn((_key: string, content: Buffer) => {
        archived = content;
        return Promise.resolve({ objectKey: "retention/ai_results/job-ai.json", checksum: `sha256:${createHash("sha256").update(content).digest("hex")}`, sizeBytes: content.length });
      }),
      get: vi.fn(() => Promise.resolve(archived)),
      remove: vi.fn(),
    } as unknown as ObjectStorageService;
    const service = new SystemService(undefined, undefined, undefined, storage);

    await expect((service as unknown as RetentionInternals).executeRetention(prisma, "AI_RESULTS", "ARCHIVE", new Date("2026-01-01"), "job-ai")).resolves.toMatchObject({ affectedRows: 4 });
    const archive = JSON.parse(archived.toString("utf8")) as { category: string; records: Array<{ entity: string; record: { key?: string; id?: string } }> };
    expect(archive.category).toBe("AI_RESULTS");
    expect(archive.records.map((item) => item.entity)).toEqual([
      "system_setting_ai_result",
      "system_setting_ai_result",
      "ai_grading_suggestion",
      "ai_study_draft",
    ]);
    expect(mocks.systemDelete).toHaveBeenCalledWith({ where: { key: { in: ["ai-doc:ready-legacy", "ai-doc-answer:ready"] } } });
    expect(mocks.gradingDelete).toHaveBeenCalledWith({ where: { id: { in: ["grading-ready"] } } });
    expect(mocks.studyDelete).toHaveBeenCalledWith({ where: { id: { in: ["study-ready-unpublished"] } } });
  });

  it("rejects retention categories without a matching executor", async () => {
    const service = new SystemService();
    await expect(service.createRetentionPolicy({ category: "UNKNOWN", retentionDays: 90, action: "DELETE", approvedBy: "Data owner" })).rejects.toThrow("Danh mục retention không được hỗ trợ.");
    await expect(service.createLegalHold("UNKNOWN", "Compliance review")).rejects.toThrow("Danh mục retention không được hỗ trợ.");
  });
});
