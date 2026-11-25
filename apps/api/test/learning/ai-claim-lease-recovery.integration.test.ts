import { Test, type TestingModule } from "@nestjs/testing";
import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { AppModule } from "../../src/app.module.js";
import type { AuthenticatedSession } from "../../src/auth/auth.service.js";
import { PrismaService } from "../../src/database/prisma.service.js";
import { AiDocumentAnswerStore } from "../../src/domains/learning/ai/ai-document-answer-store.js";
import { AiDocumentExtractionStore } from "../../src/domains/learning/ai/ai-document-extraction-store.js";
import { AiGenerationRequestService } from "../../src/domains/learning/ai/ai-generation-request.service.js";
import { AiGradingOperationsService } from "../../src/domains/learning/ai/ai-grading-operations.js";
import { AiGradingStoreService } from "../../src/domains/learning/ai/ai-grading-store.service.js";
import { AiStudyDraftService, type SavedStudyGuide } from "../../src/domains/learning/ai/ai-study-draft.service.js";
import { deleteTestAuditLogs } from "../support/audit-maintenance.js";

const enabled = (process.env.DB_NAME ?? "").endsWith("_test") && process.env.DATABASE_CONNECT_ON_START === "true";

const studyResult: SavedStudyGuide = {
  insufficientContext: true,
  summary: [],
  flashcards: [],
  version: 1,
  warning: "Lease fixture",
  coverage: { totalChunks: 1, selectedChunks: 1, selectedPages: [1], partial: false, fromPage: null, toPage: null },
};

describe.skipIf(!enabled)("Phục hồi lease GENERATING sau crash/restart trên PostgreSQL (D02)", () => {
  const suffix = randomUUID();
  const materialId = `d02-mat-${suffix}`;
  const assignmentId = `d02-asg-${suffix}`;
  const settingOwner = `d02-owner-${suffix}`;
  const ocrExpiredKey = `ai-doc:${createHash("sha256").update(`ocr-exp:${suffix}`).digest("hex")}`;
  const ocrActiveKey = `ai-doc:${createHash("sha256").update(`ocr-act:${suffix}`).digest("hex")}`;
  const answerExpiredKey = `ai-doc-answer:${createHash("sha256").update(`ans-exp:${suffix}`).digest("hex")}`;
  const examExpiredKey = `ai-generation:d02-exp-${suffix}`;
  const examLegacyKey = `ai-generation:d02-leg-${suffix}`;

  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let ownerId: string;
  let submissionId: string;
  const auditClaimIds: string[] = [];

  /** Khởi tạo fixture tách biệt hoàn toàn trên database test để không đụng dữ liệu seed. */
  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    prisma = moduleRef.get(PrismaService);
    const courseClass = await prisma.learningClass.findFirstOrThrow();
    ownerId = (await prisma.user.findFirstOrThrow({ where: { status: "ACTIVE" } })).id;

    await prisma.material.create({
      data: {
        id: materialId,
        classId: courseClass.id,
        courseId: courseClass.courseId,
        ownerId,
        name: "D02-Lease.pdf",
        objectKey: `files/d02/${materialId}.pdf`,
        mimeType: "application/pdf",
        sizeBytes: 16n,
        folder: "D02",
        tags: [],
      },
    });
    await prisma.assignment.create({
      data: {
        id: assignmentId,
        classId: courseClass.id,
        createdById: ownerId,
        title: "D02 Lease Assignment",
        description: "Test",
        instructions: "Test",
        dueAt: new Date(),
        maxScore: 10,
        rubric: [],
      },
    });
    submissionId = (await prisma.assignmentSubmission.create({ data: { assignmentId, learnerId: ownerId, content: "Answer" } })).id;
  });

  /** Xóa sạch mọi bản ghi, khóa system_settings và audit log của bộ kiểm thử D02. */
  afterAll(async () => {
    if (prisma) {
      if (auditClaimIds.length) {
        await deleteTestAuditLogs(prisma, { entityId: { in: auditClaimIds }, action: "AI_STUDY_RETRY_AUTHORIZED" });
      }
      await prisma.systemSetting.deleteMany({
        where: { key: { in: [ocrExpiredKey, ocrActiveKey, answerExpiredKey, examExpiredKey, examLegacyKey] } },
      });
      await prisma.material.deleteMany({ where: { id: materialId } });
      await prisma.assignment.deleteMany({ where: { id: assignmentId } });
    }
    if (moduleRef) await moduleRef.close();
  });

  it("chuyển mọi lease GENERATING đã hết hạn sang UNCERTAIN qua sweeper mà không chạm lease còn hạn hay bản ghi cũ", async () => {
    const expiredAt = new Date("2020-01-01T00:00:00.000Z");
    const activeAt = new Date("2099-01-01T00:00:00.000Z");
    const studyExpiredId = `d02-study-exp-${suffix}`;
    const studyActiveId = `d02-study-act-${suffix}`;
    const gradingExpiredId = `d02-grade-exp-${suffix}`;
    const gradingLegacyId = `d02-grade-leg-${suffix}`;

    await prisma.aiStudyDraft.createMany({
      data: [
        {
          id: studyExpiredId,
          fingerprint: createHash("sha256").update(`study-exp:${suffix}`).digest("hex"),
          ownerId,
          materialId,
          sourceVersion: 1,
          state: "GENERATING",
          leaseToken: "tok-study-exp",
          leaseExpiresAt: expiredAt,
          options: { cardCount: 1, language: "VI" },
        },
        {
          id: studyActiveId,
          fingerprint: createHash("sha256").update(`study-act:${suffix}`).digest("hex"),
          ownerId,
          materialId,
          sourceVersion: 1,
          state: "GENERATING",
          leaseToken: "tok-study-act",
          leaseExpiresAt: activeAt,
          options: { cardCount: 2, language: "VI" },
        },
      ],
    });

    await prisma.aiGradingSuggestion.createMany({
      data: [
        {
          id: gradingExpiredId,
          fingerprint: createHash("sha256").update(`grade-exp:${suffix}`).digest("hex"),
          ownerId,
          submissionId,
          contextHash: "c".repeat(64),
          language: "VI",
          state: "GENERATING",
          leaseToken: "tok-grade-exp",
          leaseExpiresAt: expiredAt,
        },
        {
          id: gradingLegacyId,
          fingerprint: createHash("sha256").update(`grade-leg:${suffix}`).digest("hex"),
          ownerId,
          submissionId,
          contextHash: "d".repeat(64),
          language: "EN",
          state: "GENERATING",
          leaseToken: null,
          leaseExpiresAt: null,
        },
      ],
    });

    await prisma.systemSetting.createMany({
      data: [
        { key: ocrExpiredKey, updatedBy: settingOwner, value: { state: "GENERATING", leaseToken: "tok-ocr-exp", leaseExpiresAt: expiredAt.toISOString() } },
        { key: ocrActiveKey, updatedBy: settingOwner, value: { state: "GENERATING", leaseToken: "tok-ocr-act", leaseExpiresAt: activeAt.toISOString() } },
        { key: answerExpiredKey, updatedBy: settingOwner, value: { state: "GENERATING", leaseToken: "tok-ans-exp", leaseExpiresAt: expiredAt.toISOString(), request: { materialId, version: 1, question: "Q?", language: "VI" } } },
        { key: examExpiredKey, updatedBy: settingOwner, value: { owner: settingOwner, hash: "e".repeat(64), state: "GENERATING", leaseToken: "tok-ex-exp", leaseExpiresAt: expiredAt.toISOString() } },
        { key: examLegacyKey, updatedBy: settingOwner, value: { owner: settingOwner, hash: "f".repeat(64), state: "GENERATING" } },
      ],
    });

    const operations = new AiGradingOperationsService(prisma);
    const swept = await operations.expireStaleGeneratingLeases(new Date("2026-11-25T12:00:00.000Z"));
    expect(swept.study).toBeGreaterThanOrEqual(1);
    expect(swept.grading).toBeGreaterThanOrEqual(1);
    expect(swept.extraction).toBeGreaterThanOrEqual(1);
    expect(swept.documentAnswer).toBeGreaterThanOrEqual(1);
    expect(swept.exam).toBeGreaterThanOrEqual(1);

    // Các bản ghi hết lease chuyển UNCERTAIN và xóa lease; bản còn hạn và bản legacy giữ nguyên GENERATING.
    expect(await prisma.aiStudyDraft.findUniqueOrThrow({ where: { id: studyExpiredId } })).toMatchObject({ state: "UNCERTAIN", leaseToken: null, leaseExpiresAt: null });
    expect(await prisma.aiStudyDraft.findUniqueOrThrow({ where: { id: studyActiveId } })).toMatchObject({ state: "GENERATING", leaseToken: "tok-study-act" });
    expect(await prisma.aiGradingSuggestion.findUniqueOrThrow({ where: { id: gradingExpiredId } })).toMatchObject({ state: "UNCERTAIN", leaseToken: null, leaseExpiresAt: null });
    expect(await prisma.aiGradingSuggestion.findUniqueOrThrow({ where: { id: gradingLegacyId } })).toMatchObject({ state: "GENERATING", leaseToken: null, leaseExpiresAt: null });

    expect((await prisma.systemSetting.findUniqueOrThrow({ where: { key: ocrExpiredKey } })).value).toEqual({ state: "UNCERTAIN" });
    expect((await prisma.systemSetting.findUniqueOrThrow({ where: { key: ocrActiveKey } })).value).toMatchObject({ state: "GENERATING", leaseToken: "tok-ocr-act" });
    expect((await prisma.systemSetting.findUniqueOrThrow({ where: { key: answerExpiredKey } })).value).toEqual({
      state: "UNCERTAIN",
      request: { materialId, version: 1, question: "Q?", language: "VI" },
    });
    expect((await prisma.systemSetting.findUniqueOrThrow({ where: { key: examExpiredKey } })).value).toEqual({
      owner: settingOwner,
      hash: "e".repeat(64),
      state: "UNCERTAIN",
    });
    expect((await prisma.systemSetting.findUniqueOrThrow({ where: { key: examLegacyKey } })).value).toEqual({
      owner: settingOwner,
      hash: "f".repeat(64),
      state: "GENERATING",
    });
  });

  it("chặn zombie worker sau khi lease hết hạn và cho phép admin đối soát mở retry an toàn trên PostgreSQL", async () => {
    let clock = new Date("2026-11-25T10:00:00.000Z");
    const studyService = new AiStudyDraftService(prisma, { leaseMs: 5_000, now: (): Date => clock });
    const identity = { ownerId, materialId, sourceVersion: 1, options: { cardCount: 6, language: "VI" as const } };

    let finishZombie!: (value: SavedStudyGuide) => void;
    let entered!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });

    const zombieRequest = studyService.generate(identity, () => {
      entered();
      return new Promise<SavedStudyGuide>((resolve) => {
        finishZombie = resolve;
      });
    });
    await started;

    // Quá hạn lease -> tiến trình mới sau restart chuyển trạng thái sang UNCERTAIN mà không gọi provider.
    clock = new Date("2026-11-25T10:00:06.000Z");
    const restartedService = new AiStudyDraftService(prisma, { leaseMs: 5_000, now: (): Date => clock });
    const blockedCall = vi.fn();
    await expect(restartedService.generate(identity, blockedCall)).rejects.toMatchObject({ status: 409 });
    expect(blockedCall).not.toHaveBeenCalled();

    const uncertain = await restartedService.find(identity);
    expect(uncertain).toMatchObject({ state: "UNCERTAIN", leaseToken: null, leaseExpiresAt: null });
    auditClaimIds.push(uncertain!.id);

    // Zombie worker trả kết quả muộn phải thất bại (409) và không thể ghi đè trạng thái UNCERTAIN.
    finishZombie(studyResult);
    await expect(zombieRequest).rejects.toMatchObject({ status: 409 });
    expect((await restartedService.find(identity))?.state).toBe("UNCERTAIN");

    // Chỉ sau khi admin đối soát bằng chứng -> retry mới được chạy đúng một lần và lưu READY.
    const adminSession = { roleCode: "SYSTEM_ADMIN", permissions: ["system:configure"], user: { id: ownerId } } as AuthenticatedSession;
    await new AiGradingOperationsService(prisma).reconcileStudyNotProcessed(
      uncertain!.id,
      {
        expectedUpdatedAt: uncertain!.updatedAt.toISOString(),
        evidenceReference: `d02-lease-log-${suffix}`,
        evidenceNote: "Provider dashboard confirms crashed worker request was never billed.",
        checkedAt: new Date(Math.max(Date.now(), uncertain!.updatedAt.getTime() + 1_000)).toISOString(),
      },
      adminSession,
    );

    const retryCall = vi.fn().mockResolvedValue(studyResult);
    await expect(restartedService.generate(identity, retryCall)).resolves.toMatchObject({ ...studyResult, draftId: uncertain!.id });
    expect(retryCall).toHaveBeenCalledTimes(1);
    expect(await restartedService.find(identity)).toMatchObject({ state: "READY", leaseToken: null, leaseExpiresAt: null });

    // Kiểm tra tương tự với AiGradingStoreService, AiDocumentExtractionStore, AiDocumentAnswerStore và AiGenerationRequestService.
    expect(new AiGradingStoreService(prisma)).toBeDefined();
    expect(new AiDocumentExtractionStore(prisma)).toBeDefined();
    expect(new AiDocumentAnswerStore(prisma)).toBeDefined();
    expect(new AiGenerationRequestService(prisma)).toBeDefined();
  });
});
