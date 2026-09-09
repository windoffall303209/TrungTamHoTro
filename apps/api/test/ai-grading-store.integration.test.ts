import { Test, type TestingModule } from "@nestjs/testing";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { AppModule } from "../src/app.module.js";
import { PrismaService } from "../src/database/prisma.service.js";
import { AiGradingStoreService, type SavedGradingSuggestion } from "../src/learning/ai-grading-store.service.js";
import { AiGradingOperationsService } from "../src/learning/ai-grading-operations.js";
import type { AuthenticatedSession } from "../src/auth/auth.service.js";

const enabled = (process.env.DB_NAME ?? "").endsWith("_test") && process.env.DATABASE_CONNECT_ON_START === "true";
const contextHash = "a".repeat(64);
const result: SavedGradingSuggestion = { insufficientEvidence: true, feedback: "Integration fixture", criteria: [], suggestedTotal: null, requiresHumanReview: true, model: "mock", submissionRevision: 1, assignmentVersion: 1, contextHash, sources: [{ attachmentId: "fixture-file", name: "bài-làm.txt", checksum: "sha256:fixture", text: "Nguồn bài làm UTF-8 🌿" }] };

describe.skipIf(!enabled)("Grading claims on dedicated MySQL test database", () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let ownerId: string;
  let submissionId: string;
  let retryClaimId: string | undefined;
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
    if (prisma) {
      if (retryClaimId) await prisma.auditLog.deleteMany({ where: { entityId: retryClaimId, action: "AI_GRADING_RETRY_AUTHORIZED" } });
      await prisma.assignment.deleteMany({ where: { id: assignmentId } });
    }
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

  it("uses evidence authorization once across concurrent retries", async () => {
    const identity = { ownerId, submissionId, contextHash, language: "BILINGUAL" as const };
    await expect(new AiGradingStoreService(prisma).generate(identity, () => Promise.reject(new Error("provider did not acknowledge")))).rejects.toThrow("provider did not acknowledge");
    const claim = await prisma.aiGradingSuggestion.findUniqueOrThrow({ where: { fingerprint: (await new AiGradingStoreService(prisma).find(identity))!.fingerprint } });
    retryClaimId = claim.id;
    const session = { roleCode: "SYSTEM_ADMIN", permissions: ["system:configure"], user: { id: ownerId } } as AuthenticatedSession;
    await new AiGradingOperationsService(prisma).reconcileGradingNotProcessed(claim.id, {
      expectedUpdatedAt: claim.updatedAt.toISOString(),
      evidenceReference: `provider-log-${assignmentId}`,
      evidenceNote: "Provider dashboard confirms this grading request was not accepted or billed.",
      checkedAt: new Date(claim.updatedAt.getTime() + 1_000).toISOString(),
    }, session);
    const generate = vi.fn().mockResolvedValue(result);
    const outcomes = await Promise.allSettled(Array.from({ length: 4 }, () => new AiGradingStoreService(prisma).generate(identity, generate)));

    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
    expect(generate).toHaveBeenCalledOnce();
    expect(await prisma.aiGradingSuggestion.findUniqueOrThrow({ where: { id: claim.id } })).toMatchObject({ state: "READY" });
    expect(await prisma.auditLog.count({ where: { entityId: claim.id, action: "AI_GRADING_RETRY_AUTHORIZED" } })).toBe(1);
  });

  it("paginates tied timestamps without leaking saved answers or duplicating rows after a state change", async () => {
    const session = { roleCode: "SYSTEM_ADMIN", permissions: ["system:configure"], user: { id: ownerId } } as AuthenticatedSession;
    const service = new AiGradingOperationsService(prisma);
    // Ghim mốc tương lai riêng để fixture đứng trước dữ liệu khác mà không sửa các claim có sẵn.
    const createdAt = new Date("2099-09-08T00:00:00Z");
    const ids = ["a", "b", "c"].map((suffix) => `${assignmentId}-${suffix}`);
    for (const [index, id] of ids.entries()) {
      await prisma.aiGradingSuggestion.create({ data: {
        id, ownerId, submissionId, fingerprint: randomUUID().replaceAll("-", "").padEnd(64, "0"),
        contextHash, language: "VI", state: "UNCERTAIN", createdAt,
        result: { ...result, feedback: `private fixture ${index}` },
      } });
    }
    const first = await service.list({ limit: 1, state: "UNCERTAIN" }, session);
    expect(first.items.map((item) => item.id)).toEqual([ids[2]]);
    expect(first.nextCursor).toBe(ids[2]);
    expect(Object.keys(first.items[0]!).sort()).toEqual(["id", "ownerId", "submissionId", "language", "state", "createdAt", "updatedAt"].sort());
    // Đổi trạng thái cursor không được làm mất vị trí phân trang theo thời điểm tạo.
    await prisma.aiGradingSuggestion.update({ where: { id: ids[2]! }, data: { state: "READY" } });
    const second = await new AiGradingOperationsService(prisma).list({ limit: 1, state: "UNCERTAIN", cursor: first.nextCursor! }, session);
    expect(second.items.map((item) => item.id)).toEqual([ids[1]]);
    const third = await service.list({ limit: 1, state: "UNCERTAIN", cursor: second.nextCursor! }, session);
    expect(third.items.map((item) => item.id)).toEqual([ids[0]]);
    expect(await prisma.aiGradingSuggestion.count({ where: { submissionId, id: { in: ids } } })).toBe(3);
    const saved = await prisma.aiGradingSuggestion.findUniqueOrThrow({ where: { id: ids[0]! } });
    expect(saved.result).toMatchObject({ feedback: "private fixture 0" });
    // Dọn đúng một cursor fixture để kiểm tra hướng dẫn tải lại; không đụng claim người dùng.
    await prisma.aiGradingSuggestion.delete({ where: { id: ids[1]! } });
    await expect(service.list({ limit: 1, cursor: ids[1]! }, session)).rejects.toMatchObject({ status: 400 });
  });

  it("has the migrated status/time/ID index available to MySQL", async () => {
    const indexes = await prisma.$queryRaw<Array<{ Column_name: string }>>`SHOW INDEX FROM ai_grading_suggestions WHERE Key_name = 'ai_grading_operations_state_created_id'`;
    expect(indexes.map((item) => item.Column_name)).toEqual(["state", "created_at", "id"]);
  });
});
