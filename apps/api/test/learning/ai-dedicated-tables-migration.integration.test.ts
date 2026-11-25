import { Test, type TestingModule } from "@nestjs/testing";
import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { AppModule } from "../../src/app.module.js";
import { PrismaService } from "../../src/database/prisma.service.js";
import { AiDocumentAnswerStore } from "../../src/domains/learning/ai/ai-document-answer-store.js";
import { AiDocumentExtractionStore } from "../../src/domains/learning/ai/ai-document-extraction-store.js";
import { AiGenerationRequestService } from "../../src/domains/learning/ai/ai-generation-request.service.js";

const execFileAsync = promisify(execFile);
const enabled = (process.env.DB_NAME ?? "").endsWith("_test") && process.env.DATABASE_CONNECT_ON_START === "true";
const verifyScriptPath = fileURLToPath(new URL("../../scripts/verify-ai-table-migration.mjs", import.meta.url));

describe.skipIf(!enabled)("Kiểm chứng migrate theo giai đoạn (Expand/Backfill/Verify/Cutover/Rollback) cho bảng AI (D03)", () => {
  const suffix = randomUUID();
  const ownerId = `d03-mig-${suffix}`;
  const ocrArrayId = createHash("sha256").update(`d03-ocr-array:${suffix}`).digest("hex");
  const ocrUncertainId = createHash("sha256").update(`d03-ocr-uncertain:${suffix}`).digest("hex");
  const answerIdentity = {
    ownerId,
    materialId: `d03-mat-${suffix}`,
    version: 1,
    question: "Dữ liệu cũ có được bảo toàn khi tách bảng không?",
    language: "VI" as const,
  };
  const answerId = createHash("sha256")
    .update(JSON.stringify(["v1", answerIdentity.ownerId, answerIdentity.materialId, answerIdentity.version, answerIdentity.question, answerIdentity.language]))
    .digest("hex");
  const examPayload = { topic: `d03-legacy-exam-${suffix}` };
  const examHash = createHash("sha256").update(JSON.stringify(examPayload)).digest("hex");
  const examRequestId = `d03-req-${suffix}`;
  const examFingerprint = createHash("sha256")
    .update(JSON.stringify({ hash: examHash, owner: ownerId }))
    .digest("hex");

  const legacySettingKeys = [
    `ai-doc:${ocrArrayId}`,
    `ai-doc:${ocrUncertainId}`,
    `ai-doc-answer:${answerId}`,
    `ai-generation:${examRequestId}`,
    `ai-generation-content:${examFingerprint}`,
  ];

  let moduleRef: TestingModule;
  let prisma: PrismaService;

  /** Khởi tạo kết nối tới PostgreSQL test riêng đã áp dụng migration 20261125030000_dedicated_ai_claim_tables. */
  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    prisma = moduleRef.get(PrismaService);
  });

  /** Xóa sạch cả bản ghi giả lập legacy trong system_settings lẫn bản ghi sau backfill trong 4 bảng chuyên dụng. */
  afterAll(async () => {
    if (prisma) {
      await prisma.systemSetting.deleteMany({ where: { key: { in: legacySettingKeys } } });
      await prisma.aiDocumentExtraction.deleteMany({ where: { id: { in: [ocrArrayId, ocrUncertainId] } } });
      await prisma.aiDocumentAnswer.deleteMany({ where: { id: answerId } });
      await prisma.aiGenerationBinding.deleteMany({ where: { fingerprint: examFingerprint } });
      await prisma.aiGenerationRequest.deleteMany({ where: { id: examRequestId } });
    }
    if (moduleRef) await moduleRef.close();
  });

  it("backfill không mất dữ liệu cũ, xác minh đối chiếu bằng script CLI, phục vụ đọc ghi trên bảng mới và giữ nguyên dữ liệu rollback", async () => {
    const legacyPages = [{ page: 1, text: "Trang OCR cũ lưu dạng mảng trong system_settings." }];
    const legacyAnswer = {
      answer: "Không đủ bằng chứng trong tài liệu mẫu.",
      insufficientContext: true,
      citations: [],
      warning: "Legacy backfill fixture",
      version: 1,
    };
    const legacyExamResult = { exam: { id: `legacy-exam-${suffix}` } };

    // 1. Tạo dữ liệu cũ trong system_settings (gồm cả mảng OCR cũ, trạng thái UNCERTAIN, answer READY và exam COMPLETED).
    await prisma.systemSetting.createMany({
      data: [
        { key: legacySettingKeys[0]!, updatedBy: ownerId, version: 3, value: legacyPages },
        { key: legacySettingKeys[1]!, updatedBy: ownerId, version: 2, value: { state: "UNCERTAIN" } },
        {
          key: legacySettingKeys[2]!,
          updatedBy: ownerId,
          version: 4,
          value: {
            state: "READY",
            request: {
              materialId: answerIdentity.materialId,
              version: answerIdentity.version,
              question: answerIdentity.question,
              language: answerIdentity.language,
            },
            result: legacyAnswer,
          },
        },
        {
          key: legacySettingKeys[3]!,
          updatedBy: ownerId,
          version: 5,
          value: { owner: ownerId, hash: examHash, state: "COMPLETED", result: legacyExamResult },
        },
        {
          key: legacySettingKeys[4]!,
          updatedBy: ownerId,
          version: 1,
          value: { owner: ownerId, hash: examHash, canonicalRequestId: examRequestId },
        },
      ],
    });

    // 2. Chạy script backfill idempotent + đối chiếu parity trên đúng DB test hiện hành.
    const { stdout } = await execFileAsync(
      process.execPath,
      [verifyScriptPath, "--database", process.env.DB_NAME!, "--backfill", "--json"],
    );
    const report = JSON.parse(stdout) as {
      verified: boolean;
      prunedLegacyRows: number;
      parity: Record<string, { legacyCount: number; dedicatedCount: number; missingInDedicated: number }>;
    };
    expect(report.verified).toBe(true);
    expect(report.prunedLegacyRows).toBe(0);
    for (const domain of Object.values(report.parity)) {
      expect(domain.missingInDedicated).toBe(0);
    }

    // 3. Các store mới đọc trực tiếp từ 4 bảng chuyên dụng và phát lại đúng dữ liệu cũ với 0 lần gọi provider.
    const ocrStore = new AiDocumentExtractionStore(prisma);
    const ocrSpy = vi.fn();
    expect(await ocrStore.generate(`ai-doc:${ocrArrayId}`, ownerId, ocrSpy)).toEqual({ pages: legacyPages, cached: true });
    await expect(ocrStore.generate(`ai-doc:${ocrUncertainId}`, ownerId, ocrSpy)).rejects.toMatchObject({ status: 409 });
    expect(ocrSpy).not.toHaveBeenCalled();

    const answerStore = new AiDocumentAnswerStore(prisma);
    const answerSpy = vi.fn();
    expect(await answerStore.generate(answerIdentity, answerSpy)).toEqual(legacyAnswer);
    expect((await answerStore.list({ ownerId, materialId: answerIdentity.materialId, version: 1 })).items).toHaveLength(1);
    expect(answerSpy).not.toHaveBeenCalled();

    const examService = new AiGenerationRequestService(prisma);
    const examSpy = vi.fn();
    const replayedExam = await examService.run(
      randomUUID(),
      ownerId,
      examPayload,
      examSpy,
      vi.fn(),
      () => Promise.resolve(undefined),
    );
    expect(replayedExam).toEqual(legacyExamResult);
    expect(examSpy).not.toHaveBeenCalled();

    // 4. Dữ liệu cũ trong system_settings vẫn còn nguyên để rollback nhị phân an toàn nếu cần.
    expect(await prisma.systemSetting.count({ where: { key: { in: legacySettingKeys } } })).toBe(5);
  });
});
