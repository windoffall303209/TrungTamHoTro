import { Test, type TestingModule } from "@nestjs/testing";
import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { AppModule } from "../../src/app.module.js";
import { PrismaService } from "../../src/database/prisma.service.js";
import { AiDocumentExtractionStore } from "../../src/domains/learning/ai/ai-document-extraction-store.js";
import { AiGradingOperationsService } from "../../src/domains/learning/ai/ai-grading-operations.js";
import type { AuthenticatedSession } from "../../src/auth/auth.service.js";
import { deleteTestAuditLogs } from "../support/audit-maintenance.js";

const enabled = (process.env.DB_NAME ?? "").endsWith("_test") && process.env.DATABASE_CONNECT_ON_START === "true";

describe.skipIf(!enabled)("Durable extraction on PostgreSQL", () => {
  const ownerId = `extraction-test-${randomUUID()}`;
  const ids = ["race", "uncertain", "legacy", "operations-a", "operations-b", "operations-ready", "recovery"].map((name) =>
    createHash("sha256").update(`${ownerId}:${name}`).digest("hex"),
  );
  const keys = ids.map((id) => `ai-doc:${id}`);
  const pages = [{ page: 1, text: "Synthetic OCR result; no real provider invoked." }];
  let moduleRef: TestingModule;
  let prisma: PrismaService;

  // Nạp dịch vụ cơ sở dữ liệu thật; phần gọi nhà cung cấp vẫn được mô phỏng.
  beforeAll(async () => { moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile(); prisma = moduleRef.get(PrismaService); });

  // Chỉ xóa đúng bản ghi của lần chạy này trong bảng ai_document_extractions.
  afterAll(async () => {
    if (prisma) {
      await deleteTestAuditLogs(prisma, { action: "AI_DOCUMENT_EXTRACTION_RETRY_AUTHORIZED", entityId: ids[6]! });
      await prisma.aiDocumentExtraction.deleteMany({ where: { ownerId, id: { in: ids } } });
    }
    await moduleRef?.close();
  });

  it("allows one OCR invocation among six workers and replays after service replacement", async () => {
    expect(await new AiDocumentExtractionStore(prisma).status(keys[0]!)).toEqual({ state: "NOT_REQUESTED" });
    const extract = vi.fn(() => Promise.resolve(pages));
    const outcomes = await Promise.allSettled(Array.from({ length: 6 }, () => new AiDocumentExtractionStore(prisma).generate(keys[0]!, ownerId, extract)));
    expect(outcomes.some((outcome) => outcome.status === "fulfilled")).toBe(true);
    for (const outcome of outcomes) if (outcome.status === "rejected") expect(outcome.reason).toMatchObject({ status: 409 });
    expect(await new AiDocumentExtractionStore(prisma).generate(keys[0]!, ownerId, extract)).toEqual({ pages, cached: true });
    expect(extract).toHaveBeenCalledTimes(1);
    expect(await prisma.aiDocumentExtraction.count({ where: { id: ids[0] } })).toBe(1);
    const before = await prisma.aiDocumentExtraction.findUnique({ where: { id: ids[0] } });
    expect(await new AiDocumentExtractionStore(prisma).status(keys[0]!)).toEqual({ state: "READY", pages });
    expect(await prisma.aiDocumentExtraction.findUnique({ where: { id: ids[0] } })).toEqual(before);
  });

  it("persists uncertain state and refuses to retry after replacement", async () => {
    const extract = vi.fn().mockRejectedValue(new Error("response lost"));
    await expect(new AiDocumentExtractionStore(prisma).generate(keys[1]!, ownerId, extract)).rejects.toThrow("response lost");
    await expect(new AiDocumentExtractionStore(prisma).generate(keys[1]!, ownerId, extract)).rejects.toMatchObject({ status: 409 });
    expect(await prisma.aiDocumentExtraction.findUnique({ where: { id: ids[1] } })).toMatchObject({ state: "UNCERTAIN", pages: null });
    expect(extract).toHaveBeenCalledTimes(1);
    expect(await new AiDocumentExtractionStore(prisma).status(keys[1]!)).toEqual({ state: "UNCERTAIN" });
  });

  it("consumes one evidence-authorized OCR retry across concurrent workers", async () => {
    const id = ids[6]!;
    const key = keys[6]!;
    await expect(new AiDocumentExtractionStore(prisma).generate(key, ownerId, vi.fn().mockRejectedValue(new Error("response lost")))).rejects.toThrow("response lost");
    const claim = await prisma.aiDocumentExtraction.findUniqueOrThrow({ where: { id } });
    const admin = { roleCode: "SYSTEM_ADMIN", permissions: ["system:configure"], user: { id: null } } as unknown as AuthenticatedSession;
    await new AiGradingOperationsService(prisma).reconcileExtractionNotProcessed(id, {
      expectedVersion: claim.version,
      evidenceReference: "provider-dashboard-fixture",
      evidenceNote: "Provider fixture confirms that the original extraction was not accepted.",
      checkedAt: new Date(claim.updatedAt.getTime() + 1_000).toISOString(),
    }, admin);
    expect(await new AiDocumentExtractionStore(prisma).status(key)).toEqual({ state: "NOT_REQUESTED" });
    const extract = vi.fn(() => Promise.resolve(pages));
    const outcomes = await Promise.allSettled(Array.from({ length: 4 }, () => new AiDocumentExtractionStore(prisma).generate(key, ownerId, extract)));
    const fulfilled = outcomes.filter((outcome) => outcome.status === "fulfilled");
    expect(fulfilled.length).toBeGreaterThanOrEqual(1);
    for (const outcome of fulfilled) if (outcome.status === "fulfilled") expect(outcome.value).toMatchObject({ pages });
    for (const outcome of outcomes) if (outcome.status === "rejected") expect(outcome.reason).toMatchObject({ status: 409 });
    expect(extract).toHaveBeenCalledTimes(1);
    expect(await prisma.auditLog.count({ where: { action: "AI_DOCUMENT_EXTRACTION_RETRY_AUTHORIZED", entityId: id } })).toBe(1);
    expect(await new AiDocumentExtractionStore(prisma).status(key)).toEqual({ state: "READY", pages });
  });

  it("replays pre-backfilled READY caches without modifying the original record", async () => {
    await prisma.aiDocumentExtraction.create({ data: { id: ids[2]!, ownerId, state: "READY", pages } });
    const before = await prisma.aiDocumentExtraction.findUnique({ where: { id: ids[2] } });
    const extract = vi.fn();
    expect(await new AiDocumentExtractionStore(prisma).status(keys[2]!)).toEqual({ state: "READY", pages });
    expect(await new AiDocumentExtractionStore(prisma).generate(keys[2]!, ownerId, extract)).toEqual({ pages, cached: true });
    expect(await prisma.aiDocumentExtraction.findUnique({ where: { id: ids[2] } })).toEqual(before);
    expect(extract).not.toHaveBeenCalled();
  });

  it("paginates metadata without reading document pages or changing records", async () => {
    const operationIds = ids.slice(3, 5).sort().reverse();
    for (const id of operationIds) {
      await prisma.aiDocumentExtraction.create({
        data: {
          id,
          ownerId,
          state: "UNCERTAIN",
          createdAt: new Date("2099-01-01T00:00:00Z"),
          pages: [{ page: 1, text: "private OCR sentinel" }],
        },
      });
    }
    await prisma.aiDocumentExtraction.create({
      data: { id: ids[5]!, ownerId, state: "READY", createdAt: new Date("2099-01-02T00:00:00Z"), pages },
    });
    const operations = new AiGradingOperationsService(prisma);
    const admin = { roleCode: "SYSTEM_ADMIN", permissions: ["system:configure"] } as AuthenticatedSession;
    const before = await prisma.aiDocumentExtraction.findMany({ where: { id: { in: ids } }, orderBy: { id: "asc" } });
    const first = await operations.listExtractions({ limit: 1 }, admin);
    expect(first.items[0]).toMatchObject({ id: operationIds[0]!, ownerId, state: "UNCERTAIN" });
    expect(Object.keys(first.items[0]!).sort()).toEqual(["createdAt", "id", "ownerId", "state", "updatedAt", "version"]);
    expect(JSON.stringify(first)).not.toContain("sentinel");
    const next = await operations.listExtractions({ limit: 1, cursor: first.nextCursor! }, admin);
    expect(next.items[0]?.id).toBe(operationIds[1]!);
    const ready = await operations.listExtractions({ limit: 1, state: "READY" }, admin);
    expect(ready.items[0]?.id).toBe(ids[5]!);
    await expect(operations.listExtractions({ limit: 1, cursor: "missing" }, admin)).rejects.toMatchObject({ status: 400 });
    expect(await prisma.aiDocumentExtraction.findMany({ where: { id: { in: ids } }, orderBy: { id: "asc" } })).toEqual(before);
  });
});
