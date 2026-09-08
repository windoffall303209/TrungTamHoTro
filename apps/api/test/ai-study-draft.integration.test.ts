import { Test, type TestingModule } from "@nestjs/testing";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { AppModule } from "../src/app.module.js";
import { PrismaService } from "../src/database/prisma.service.js";
import { AiStudyDraftService, type SavedStudyGuide } from "../src/learning/ai-study-draft.service.js";

const enabled = (process.env.DB_NAME ?? "").endsWith("_test") && process.env.DATABASE_CONNECT_ON_START === "true";
const result: SavedStudyGuide = { insufficientContext: true, summary: [], flashcards: [], version: 1, warning: "Integration fixture", coverage: { totalChunks: 1, selectedChunks: 1, selectedPages: [1], partial: false, fromPage: null, toPage: null } };

describe.skipIf(!enabled)("Study draft persistence on dedicated MySQL test database", () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let ownerId: string;
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
    if (prisma) await prisma.material.deleteMany({ where: { id: materialId } });
    if (moduleRef) await moduleRef.close();
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
    await service.edit(saved.draftId, ownerId, materialId, { ...input, expectedRevision: 1, summary: [{ text: "Private next edit", citationIds: [source.id] }] });
    expect((await new AiStudyDraftService(prisma).getPublished(saved.draftId, materialId)).result.summary[0]?.text).toBe("Edited");
    await expect(service.unpublish(saved.draftId, ownerId, materialId, 0)).rejects.toMatchObject({ status: 409 });
    await service.unpublish(saved.draftId, ownerId, materialId, 1);
    await expect(new AiStudyDraftService(prisma).getPublished(saved.draftId, materialId)).rejects.toMatchObject({ status: 404 });
    expect((await service.get(saved.draftId, ownerId, materialId)).editedResult?.summary[0]?.text).toBe("Private next edit");
  });
});
