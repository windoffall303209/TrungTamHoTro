import { Test, type TestingModule } from "@nestjs/testing";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { AppModule } from "../src/app.module.js";
import { PrismaService } from "../src/database/prisma.service.js";
import { AiGradingStoreService, type SavedGradingSuggestion } from "../src/learning/ai-grading-store.service.js";

const enabled = (process.env.DB_NAME ?? "").endsWith("_test") && process.env.DATABASE_CONNECT_ON_START === "true";
const contextHash = "a".repeat(64);
const result: SavedGradingSuggestion = { insufficientEvidence: true, feedback: "Integration fixture", criteria: [], suggestedTotal: null, requiresHumanReview: true, model: "mock", submissionRevision: 1, assignmentVersion: 1, contextHash, sources: [{ attachmentId: "fixture-file", name: "bài-làm.txt", checksum: "sha256:fixture", text: "Nguồn bài làm UTF-8 🌿" }] };

describe.skipIf(!enabled)("Grading claims on dedicated MySQL test database", () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let ownerId: string;
  let submissionId: string;
  const assignmentId = `grading-test-${randomUUID()}`;

  // Tạo bài nộp riêng trong database test; không gọi provider hoặc sửa điểm của dữ liệu seed.
  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    prisma = moduleRef.get(PrismaService);
    const courseClass = await prisma.learningClass.findFirstOrThrow();
    ownerId = (await prisma.user.findFirstOrThrow({ where: { status: "ACTIVE" } })).id;
    await prisma.assignment.create({ data: { id: assignmentId, classId: courseClass.id, createdById: ownerId, title: "Grading fixture", description: "Test", instructions: "Test only", dueAt: new Date(), maxScore: 10, rubric: [] } });
    submissionId = (await prisma.assignmentSubmission.create({ data: { assignmentId, learnerId: ownerId, content: "Test answer" } })).id;
  });

  // Xóa đúng bài tập fixture và các bản ghi phụ thuộc qua cascade.
  afterAll(async () => {
    if (prisma) await prisma.assignment.deleteMany({ where: { id: assignmentId } });
    if (moduleRef) await moduleRef.close();
  });

  it("calls once across workers and replays after service restart", async () => {
    const identity = { ownerId, submissionId, contextHash, language: "VI" as const };
    let release!: (value: SavedGradingSuggestion) => void;
    let entered!: () => void;
    const started = new Promise<void>((resolve) => { entered = resolve; });
    const generate = vi.fn(() => { entered(); return new Promise<SavedGradingSuggestion>((resolve) => { release = resolve; }); });
    const first = new AiGradingStoreService(prisma).generate(identity, generate);
    await started;
    const competing = await Promise.allSettled(Array.from({ length: 5 }, () => new AiGradingStoreService(prisma).generate(identity, generate)));
    release(result);
    const saved = await first;
    for (const attempt of competing) {
      expect(attempt.status).toBe("rejected");
      if (attempt.status === "rejected") expect(attempt.reason).toMatchObject({ status: 409 });
    }
    expect(await new AiGradingStoreService(prisma).generate(identity, generate)).toEqual(saved);
    expect(await prisma.aiGradingSuggestion.count({ where: { submissionId } })).toBe(1);
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it("retains uncertainty after restart and never reissues the provider call", async () => {
    const identity = { ownerId, submissionId, contextHash, language: "EN" as const };
    const generate = vi.fn().mockRejectedValue(new Error("provider response lost"));
    await expect(new AiGradingStoreService(prisma).generate(identity, generate)).rejects.toThrow("provider response lost");
    const restarted = new AiGradingStoreService(prisma);
    expect(await restarted.find(identity)).toMatchObject({ state: "UNCERTAIN", result: null });
    await expect(restarted.generate(identity, generate)).rejects.toMatchObject({ status: 409 });
    expect(generate).toHaveBeenCalledTimes(1);
  });
});
