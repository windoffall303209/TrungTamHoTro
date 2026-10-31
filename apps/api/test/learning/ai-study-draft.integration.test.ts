import { Test, type TestingModule } from "@nestjs/testing";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { AppModule } from "../../src/app.module.js";
import { PrismaService } from "../../src/database/prisma.service.js";
import { AiStudyDraftService, type SavedStudyGuide } from "../../src/domains/learning/ai/ai-study-draft.service.js";
import { AiGradingOperationsService } from "../../src/domains/learning/ai/ai-grading-operations.js";
import type { AuthenticatedSession } from "../../src/auth/auth.service.js";

const enabled = (process.env.DB_NAME ?? "").endsWith("_test") && process.env.DATABASE_CONNECT_ON_START === "true";
const result: SavedStudyGuide = { insufficientContext: true, summary: [], flashcards: [], version: 1, warning: "Integration fixture", coverage: { totalChunks: 1, selectedChunks: 1, selectedPages: [1], partial: false, fromPage: null, toPage: null } };

describe.skipIf(!enabled)("Study draft persistence on dedicated PostgreSQL test database", () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let ownerId: string;
  let retryClaimId: string | undefined;
  const materialId = `study-test-${randomUUID()}`;

  // Tạo metadata nguồn độc lập, không tải file hoặc gọi AI ngoài trong kiểm thử database.
  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    prisma = moduleRef.get(PrismaService);
    const courseClass = await prisma.learningClass.findFirstOrThrow();
    const owner = await prisma.user.findFirstOrThrow({ where: { status: "ACTIVE" } });
    ownerId = owner.id;
    const source = { name: "Study test.pdf", objectKey: `study-test/${materialId}.pdf`, mimeType: "application/pdf", sizeBytes: 1, folder: "Test", tags: [] };
    await prisma.material.create({ data: { id: materialId, classId: courseClass.id, courseId: courseClass.courseId, ownerId, ...source, versions: { create: { ...source, version: 1, visibility: "DRAFT", createdBy: ownerId } } } });
  });

  // Xóa đúng tài liệu fixture cùng bản nháp cascade; giữ nguyên mọi dữ liệu seed và học liệu khác.
  afterAll(async () => {
    if (prisma) {
      if (retryClaimId) await prisma.auditLog.deleteMany({ where: { entityId: retryClaimId, action: "AI_STUDY_RETRY_AUTHORIZED" } });
      await prisma.material.deleteMany({ where: { id: materialId } });
    }
    if (moduleRef) await moduleRef.close();
  });

  it("reads only operations metadata with stable pagination and a migrated index", async () => {
    const service = new AiGradingOperationsService(prisma);
    const session = { roleCode: "SYSTEM_ADMIN", permissions: ["system:configure"], user: { id: ownerId } } as AuthenticatedSession;
    const ids = [`${materialId}-a`, `${materialId}-b`];
    for (const id of ids) await prisma.aiStudyDraft.create({ data: {
      id, ownerId, materialId, sourceVersion: 1, fingerprint: randomUUID().replaceAll("-", "").padEnd(64, "0"),
      state: "GENERATING", createdAt: new Date("2099-09-08T00:00:00Z"),
      options: { private: "private options" }, result: { private: "private answer" }, editedResult: { private: "private edit" }, publishedResult: { private: "published answer" },
    } });
    try {
      const first = await service.listStudy({ limit: 1 }, session);
      expect(first.items.map((item) => item.id)).toEqual([ids[1]]);
      expect(Object.keys(first.items[0]!).sort()).toEqual(["id", "ownerId", "materialId", "sourceVersion", "state", "createdAt", "updatedAt"].sort());
      await prisma.aiStudyDraft.update({ where: { id: ids[1]! }, data: { state: "READY" } });
      const second = await service.listStudy({ limit: 1, cursor: first.nextCursor! }, session);
      expect(second.items.map((item) => item.id)).toEqual([ids[0]]);
      expect((await prisma.aiStudyDraft.findUniqueOrThrow({ where: { id: ids[0]! } })).editedResult).toEqual({ private: "private edit" });
      await expect(service.listStudy({ limit: 1, cursor: "other-domain-cursor" }, session)).rejects.toMatchObject({ status: 400 });
      const indexes = await prisma.$queryRaw<Array<{ indexdef: string }>>`
        SELECT indexdef FROM pg_indexes
        WHERE schemaname = 'public'
          AND tablename = 'ai_study_drafts'
          AND indexname = 'ai_study_operations_state_created_id'
      `;
      expect(indexes).toHaveLength(1);
      expect(indexes[0]?.indexdef).toContain("(state, created_at, id)");
    } finally {
      // Chỉ xóa hai claim fixture, không ảnh hưởng số lượng bản nháp ở các ca còn lại.
      await prisma.aiStudyDraft.deleteMany({ where: { id: { in: ids }, materialId } });
    }
  });

  it("calls the generator once across workers and reloads the same draft after restart", async () => {
    const identity = { ownerId, materialId, sourceVersion: 1, options: { cardCount: 1, language: "EN" as const } };
    let release!: (value: SavedStudyGuide) => void;
    let start!: () => void;
    const entered = new Promise<void>((resolve) => { start = resolve; });
    const generate = vi.fn(() => { start(); return new Promise<SavedStudyGuide>((resolve) => { release = resolve; }); });
    const first = new AiStudyDraftService(prisma).generate(identity, generate);
    await entered;
    const concurrent = await Promise.allSettled(Array.from({ length: 5 }, () => new AiStudyDraftService(prisma).generate(identity, generate)));
    for (const value of concurrent) { expect(value.status).toBe("rejected"); if (value.status === "rejected") expect(value.reason).toMatchObject({ status: 409 }); }
    release(result);
    const saved = await first;
    const restarted = new AiStudyDraftService(prisma);
    expect(await restarted.generate(identity, generate)).toEqual(saved);
    expect((await restarted.get(saved.draftId, ownerId, materialId)).result).toEqual(result);
    expect(await prisma.aiStudyDraft.count({ where: { ownerId, materialId } })).toBe(1);
    expect(generate).toHaveBeenCalledTimes(1);
    await expect(restarted.get(saved.draftId, "other-owner", materialId)).rejects.toMatchObject({ status: 404 });
    const list = await restarted.list(ownerId, materialId);
    expect(list.items[0]).not.toHaveProperty("result");
    expect(list.items[0]?.state).toBe("READY");
  });

  it("persists uncertain outcomes instead of regenerating them after restart", async () => {
    const identity = { ownerId, materialId, sourceVersion: 1, options: { cardCount: 2, language: "EN" as const } };
    const generate = vi.fn().mockRejectedValue(new Error("provider response lost"));
    await expect(new AiStudyDraftService(prisma).generate(identity, generate)).rejects.toThrow("provider response lost");
    await expect(new AiStudyDraftService(prisma).generate(identity, generate)).rejects.toMatchObject({ status: 409 });
    expect(generate).toHaveBeenCalledTimes(1);
    expect(await prisma.aiStudyDraft.count({ where: { materialId, state: "UNCERTAIN" } })).toBe(1);
  });

  it("consumes an evidence-authorized retry once without changing published snapshots", async () => {
    const identity = { ownerId, materialId, sourceVersion: 1, options: { cardCount: 4, language: "BILINGUAL" as const } };
    await expect(new AiStudyDraftService(prisma).generate(identity, () => Promise.reject(new Error("provider did not acknowledge")))).rejects.toThrow("provider did not acknowledge");
    const claim = await new AiStudyDraftService(prisma).find(identity);
    retryClaimId = claim!.id;
    const session = { roleCode: "SYSTEM_ADMIN", permissions: ["system:configure"], user: { id: ownerId } } as AuthenticatedSession;
    await new AiGradingOperationsService(prisma).reconcileStudyNotProcessed(claim!.id, {
      expectedUpdatedAt: claim!.updatedAt.toISOString(),
      evidenceReference: `provider-log-${materialId}`,
      evidenceNote: "Provider dashboard confirms this study request was not accepted or billed.",
      checkedAt: new Date(claim!.updatedAt.getTime() + 1_000).toISOString(),
    }, session);
    const generate = vi.fn().mockResolvedValue(result);
    const outcomes = await Promise.allSettled(Array.from({ length: 4 }, () => new AiStudyDraftService(prisma).generate(identity, generate)));

    const fulfilled = outcomes.filter((outcome) => outcome.status === "fulfilled");
    expect(fulfilled.length).toBeGreaterThanOrEqual(1);
    for (const outcome of fulfilled) if (outcome.status === "fulfilled") expect(outcome.value).toMatchObject(result);
    for (const outcome of outcomes) if (outcome.status === "rejected") expect(outcome.reason).toMatchObject({ status: 409 });
    expect(generate).toHaveBeenCalledOnce();
    expect(await prisma.aiStudyDraft.findUniqueOrThrow({ where: { id: claim!.id } })).toMatchObject({ state: "READY", publishedAt: null });
    expect(await prisma.auditLog.count({ where: { entityId: claim!.id, action: "AI_STUDY_RETRY_AUTHORIZED" } })).toBe(1);
  });

  it("persists human edits separately and allows only one concurrent revision update", async () => {
    const identity = { ownerId, materialId, sourceVersion: 1, options: { cardCount: 3, language: "EN" as const } };
    const source = { id: "source-fixture", materialId, version: 1, checksum: "fixture", name: "Fixture", page: 1, start: 0, end: 8, text: "Evidence" };
    const original = { ...result, insufficientContext: false, summary: [{ text: "Original", citations: [source] }], flashcards: [{ front: "Question", back: "Answer", citations: [source] }] };
    const saved = await new AiStudyDraftService(prisma).generate(identity, () => Promise.resolve(original));
    const input = { expectedRevision: 0, summary: [{ text: "Edited", citationIds: [source.id] }], flashcards: [{ front: "Revised question", back: "Revised answer", citationIds: [source.id] }] };
    const attempts = await Promise.allSettled(Array.from({ length: 4 }, () => new AiStudyDraftService(prisma).edit(saved.draftId, ownerId, materialId, input)));
    expect(attempts.filter((attempt) => attempt.status === "fulfilled")).toHaveLength(1);
    for (const attempt of attempts) if (attempt.status === "rejected") expect(attempt.reason).toMatchObject({ status: 409 });
    const reopened = await new AiStudyDraftService(prisma).get(saved.draftId, ownerId, materialId);
    expect(reopened.editRevision).toBe(1);
    expect(reopened.result).toEqual(original);
    expect(reopened.editedResult?.summary[0]?.text).toBe("Edited");
    const publicationInput = { expectedRevision: 1, expectedPublicationRevision: 0, confirmReview: true };
    const publications = await Promise.allSettled(Array.from({ length: 4 }, () => new AiStudyDraftService(prisma).publish(saved.draftId, ownerId, materialId, publicationInput)));
    expect(publications.filter((attempt) => attempt.status === "fulfilled")).toHaveLength(1);
    for (const attempt of publications) if (attempt.status === "rejected") expect(attempt.reason).toMatchObject({ status: 409 });
    const service = new AiStudyDraftService(prisma);
    const publicList = await service.listPublished(materialId);
    expect(publicList.items).toHaveLength(1);
    expect(publicList.items[0]?.id).toBe(saved.draftId);
    expect(publicList.items[0]).not.toHaveProperty("publishedResult");
    expect(publicList.items[0]).not.toHaveProperty("ownerId");
    await service.edit(saved.draftId, ownerId, materialId, { ...input, expectedRevision: 1, summary: [{ text: "Private next edit", citationIds: [source.id] }] });
    expect((await new AiStudyDraftService(prisma).getPublished(saved.draftId, materialId)).result.summary[0]?.text).toBe("Edited");
    await expect(service.unpublish(saved.draftId, ownerId, materialId, 0)).rejects.toMatchObject({ status: 409 });
    await service.unpublish(saved.draftId, ownerId, materialId, 1);
    expect((await new AiStudyDraftService(prisma).listPublished(materialId)).items).toEqual([]);
    await expect(new AiStudyDraftService(prisma).getPublished(saved.draftId, materialId)).rejects.toMatchObject({ status: 404 });
    expect((await service.get(saved.draftId, ownerId, materialId)).editedResult?.summary[0]?.text).toBe("Private next edit");
  });
});
