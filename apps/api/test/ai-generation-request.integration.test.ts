import { Test, type TestingModule } from "@nestjs/testing";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { AppModule } from "../src/app.module.js";
import { PrismaService } from "../src/database/prisma.service.js";
import { AiGenerationRequestService } from "../src/learning/ai-generation-request.service.js";
import { AiGradingOperationsService } from "../src/learning/ai-grading-operations.js";
import type { AuthenticatedSession } from "../src/auth/auth.service.js";
import type { GeneratedExamDraft } from "../src/system/ai-provider.service.js";
import type { AiGeneratedExamResult } from "../src/learning/learning.types.js";

const enabled = (process.env.DB_NAME ?? "").endsWith("_test") && process.env.DATABASE_CONNECT_ON_START === "true";
const prepared = { courseId: "fixture-course", generated: { model: "mock" } as GeneratedExamDraft };
const result = { exam: { id: "fixture-exam" } } as AiGeneratedExamResult;
// Mô phỏng chưa có đề đã lưu; không gọi AI hoặc tạo đề thật.
const noResult = (): Promise<undefined> => Promise.resolve(undefined);

describe.skipIf(!enabled)("Exam generation claims on dedicated MySQL test database", () => {
  const owner = `ai-dedupe-test-${randomUUID()}`;
  const adminId = `ai-reconcile-admin-${randomUUID()}`;
  let moduleRef: TestingModule;
  let prisma: PrismaService;

  // Dùng database test có sẵn, không reset hoặc thay đổi cấu hình provider.
  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    prisma = moduleRef.get(PrismaService);
    await prisma.user.create({ data: { id: adminId, username: adminId, email: `${adminId}@example.invalid`, displayName: "AI reconciliation fixture" } });
  });

  // Chỉ dọn các claim do định danh fixture độc lập của lượt test này tạo.
  afterAll(async () => {
    if (prisma) {
      await prisma.auditLog.deleteMany({ where: { actorId: adminId } });
      await prisma.systemSetting.deleteMany({ where: { updatedBy: { in: [owner, adminId] }, key: { startsWith: "ai-generation" } } });
      await prisma.user.deleteMany({ where: { id: adminId } });
    }
    if (moduleRef) await moduleRef.close();
  });

  it("resumes before-provider failures across eight workers and replays after restart", async () => {
    const original = randomUUID();
    const payload = { topic: "concurrent resume" };
    const generate = vi.fn(() => Promise.resolve(prepared));
    const save = vi.fn(() => Promise.resolve(result));
    await expect(new AiGenerationRequestService(prisma).run(original, owner, payload, generate, save, () => Promise.reject(new Error("lookup offline")))).rejects.toThrow("lookup offline");
    expect(generate).not.toHaveBeenCalled();
    const outcomes = await Promise.allSettled(Array.from({ length: 8 }, () =>
      new AiGenerationRequestService(prisma).run(randomUUID(), owner, payload, generate, save, noResult),
    ));
    expect(outcomes.some((outcome) => outcome.status === "fulfilled")).toBe(true);
    for (const outcome of outcomes) {
      if (outcome.status === "rejected") expect(outcome.reason).toMatchObject({ status: 409 });
      else expect(outcome.value).toEqual(result);
    }
    expect(await new AiGenerationRequestService(prisma).run(randomUUID(), owner, payload, generate, save, noResult)).toEqual(result);
    expect(generate).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledExactlyOnceWith(prepared, original);
    const stored = await prisma.systemSetting.findUniqueOrThrow({ where: { key: `ai-generation:${original}` } });
    expect(stored.value).toMatchObject({ state: "COMPLETED", result });
  });

  it("keeps uncertain outcomes blocked even with new request IDs after restart", async () => {
    const payload = { topic: "uncertain call" };
    const generate = vi.fn().mockRejectedValue(new Error("provider response lost"));
    const save = vi.fn();
    await expect(new AiGenerationRequestService(prisma).run(randomUUID(), owner, payload, generate, save, noResult)).rejects.toThrow("provider response lost");
    await expect(new AiGenerationRequestService(prisma).run(randomUUID(), owner, payload, generate, save, noResult)).rejects.toMatchObject({ status: 409 });
    expect(generate).toHaveBeenCalledTimes(1);
    expect(save).not.toHaveBeenCalled();
  });

  it("reopens an uncertain canonical claim only after durable evidence and keeps the next retry idempotent", async () => {
    const requestId = randomUUID();
    const payload = { topic: `evidence-recovery-${requestId}` };
    const generate = vi.fn().mockRejectedValueOnce(new Error("provider response lost")).mockResolvedValue(prepared);
    const save = vi.fn().mockResolvedValue(result);
    await expect(new AiGenerationRequestService(prisma).run(requestId, owner, payload, generate, save, noResult)).rejects.toThrow("provider response lost");
    const uncertain = await prisma.systemSetting.findUniqueOrThrow({ where: { key: `ai-generation:${requestId}` } });
    const operations = new AiGradingOperationsService(prisma);
    const session = { roleCode: "SYSTEM_ADMIN", permissions: ["system:configure"], user: { id: adminId } } as AuthenticatedSession;
    const reopened = await operations.reconcileExamNotProcessed(requestId, {
      expectedVersion: uncertain.version,
      evidenceReference: `provider-log-${requestId}`,
      evidenceNote: "Provider dashboard confirms that the request was not accepted or billed.",
      checkedAt: new Date(Math.max(Date.now(), uncertain.updatedAt.getTime() + 1_000)).toISOString(),
    }, session);
    expect(reopened).toMatchObject({ id: requestId, state: "CLAIMED", version: uncertain.version + 1 });
    expect(await new AiGenerationRequestService(prisma).run(randomUUID(), owner, payload, generate, save, noResult)).toEqual(result);
    expect(await new AiGenerationRequestService(prisma).run(randomUUID(), owner, payload, generate, save, noResult)).toEqual(result);
    expect(generate).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenCalledTimes(1);
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { actorId: adminId, action: "AI_EXAM_RETRY_AUTHORIZED", entityId: requestId } });
    expect(audit.context).toMatchObject({ previousState: "UNCERTAIN", previousVersion: uncertain.version, evidenceReference: `provider-log-${requestId}` });
  });

  it("lists canonical operations only and projects metadata instead of private JSON", async () => {
    const prefix = randomUUID();
    const ids = [`${prefix}-a`, `${prefix}-b`];
    const generate = vi.fn().mockRejectedValue(new Error("uncertain"));
    for (const id of ids) {
      await expect(new AiGenerationRequestService(prisma).run(id, owner, { topic: id }, generate, vi.fn(), noResult)).rejects.toThrow("uncertain");
      await expect(new AiGenerationRequestService(prisma).run(`${id}-alias`, owner, { topic: id }, generate, vi.fn(), noResult)).rejects.toMatchObject({ status: 409 });
    }
    await prisma.systemSetting.updateMany({ where: { updatedBy: owner, key: { in: ids.map((id) => `ai-generation:${id}`) } }, data: { effectiveAt: new Date("2099-09-08T00:00:00Z") } });
    const duplicated = await prisma.systemSetting.findUniqueOrThrow({ where: { key: `ai-generation:${ids[1]!}` } });
    const duplicatedValue = duplicated.value as { owner: string; hash: string };
    await prisma.systemSetting.create({ data: { key: `ai-generation-content:duplicate-${prefix}`, updatedBy: owner, value: { owner: duplicatedValue.owner, hash: duplicatedValue.hash, canonicalRequestId: ids[1] } } });
    const operations = new AiGradingOperationsService(prisma);
    const session = { roleCode: "SYSTEM_ADMIN", permissions: ["system:configure"], user: { id: owner } } as AuthenticatedSession;
    const first = await operations.listExams({ limit: 1, state: "UNCERTAIN" }, session);
    expect(first.items.map((item) => item.id)).toEqual([ids[1]]);
    expect(Object.keys(first.items[0]!).sort()).toEqual(["id", "ownerId", "state", "version", "createdAt", "updatedAt"].sort());
    const key = `ai-generation:${ids[1]!}`;
    const stored = await prisma.systemSetting.findUniqueOrThrow({ where: { key } });
    await prisma.systemSetting.update({ where: { key }, data: { value: { ...(stored.value as object), state: "COMPLETED", result: { secret: "private exam answer" } } } });
    const second = await operations.listExams({ limit: 1, state: "UNCERTAIN", cursor: first.nextCursor! }, session);
    expect(second.items.map((item) => item.id)).toEqual([ids[0]]);
    const complete = await operations.listExams({ limit: 1, state: "COMPLETED" }, session);
    expect(complete.items.map((item) => item.id)).toEqual([ids[1]]);
    expect(JSON.stringify(complete)).not.toContain("private exam answer");
    await expect(operations.listExams({ limit: 1, cursor: `${ids[0]!}-alias` }, session)).rejects.toMatchObject({ status: 400 });
    await expect(operations.listExams({ limit: 1, cursor: "' OR 1=1 --" }, session)).rejects.toMatchObject({ status: 400 });
    expect(generate).toHaveBeenCalledTimes(2);
  });

  it("reconciles unlinked claims without counting linked retry aliases or changing storage", async () => {
    const prefix = randomUUID();
    const ids = [`${prefix}-a`, `${prefix}-b`];
    for (const id of ids) await prisma.systemSetting.create({ data: {
      key: `ai-generation:${id}`, updatedBy: owner, effectiveAt: new Date("2100-09-08T00:00:00Z"),
      value: { owner, hash: id, state: "CLAIMED", prepared: { secret: "private orphan draft" } },
    } });
    // A newer retry alias must not displace actual unlinked claims in the first page.
    const canonicalId = `${prefix}-canonical`;
    const generate = vi.fn().mockRejectedValue(new Error("fixture uncertain"));
    await expect(new AiGenerationRequestService(prisma).run(canonicalId, owner, { topic: prefix }, generate, vi.fn(), noResult)).rejects.toThrow("fixture uncertain");
    const alias = `${prefix}-alias`;
    await expect(new AiGenerationRequestService(prisma).run(alias, owner, { topic: prefix }, generate, vi.fn(), noResult)).rejects.toMatchObject({ status: 409 });
    await prisma.systemSetting.update({ where: { key: `ai-generation:${alias}` }, data: { effectiveAt: new Date("2101-09-08T00:00:00Z") } });
    const operations = new AiGradingOperationsService(prisma);
    const session = { roleCode: "SYSTEM_ADMIN", permissions: ["system:configure"], user: { id: owner } } as AuthenticatedSession;
    const first = await operations.listExams({ limit: 1, state: "CLAIMED", scope: "unlinked" }, session);
    expect(first.items.map((item) => item.id)).toEqual([ids[1]]);
    expect(Object.keys(first.items[0]!).sort()).toEqual(["id", "ownerId", "state", "version", "createdAt", "updatedAt"].sort());
    expect(JSON.stringify(first)).not.toContain("private orphan draft");
    const second = await operations.listExams({ limit: 1, state: "CLAIMED", scope: "unlinked", cursor: first.nextCursor! }, session);
    expect(second.items.map((item) => item.id)).toEqual([ids[0]]);
    await expect(operations.listExams({ limit: 1, scope: "canonical", cursor: ids[0] }, session)).rejects.toMatchObject({ status: 400 });
    await expect(operations.listExams({ limit: 1, scope: "unlinked", cursor: alias }, session)).rejects.toMatchObject({ status: 400 });
    const stored = await prisma.systemSetting.findUniqueOrThrow({ where: { key: `ai-generation:${ids[1]}` } });
    expect(stored.version).toBe(1);
    expect(stored.value).toMatchObject({ state: "CLAIMED", prepared: { secret: "private orphan draft" } });
    // A binding added between reads removes the claim from this scope; a stale cursor fails explicitly.
    await prisma.systemSetting.create({ data: { key: `ai-generation-content:${prefix}`, updatedBy: owner, value: { owner, hash: ids[1], canonicalRequestId: ids[1] } } });
    const afterBinding = await operations.listExams({ limit: 1, state: "CLAIMED", scope: "unlinked" }, session);
    expect(afterBinding.items.map((item) => item.id)).toEqual([ids[0]]);
    await expect(operations.listExams({ limit: 1, scope: "unlinked", cursor: ids[1] }, session)).rejects.toMatchObject({ status: 400 });
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it("finds requests affected by malformed or dangling bindings without exposing private data", async () => {
    const prefix = randomUUID();
    const cases = ["missing-id", "numeric-id", "empty-id", "missing-target", "wrong-owner", "wrong-hash", "invalid-state", "valid"];
    for (const kind of cases) {
      const id = `${prefix}-${kind}`;
      const targetId = `${id}-target`;
      await prisma.systemSetting.create({ data: { key: `ai-generation:${id}`, updatedBy: owner, effectiveAt: new Date("2102-09-08T00:00:00Z"), value: { owner, hash: id, state: "CLAIMED", prepared: { secret: "private broken draft" } } } });
      const canonicalRequestId = kind === "numeric-id" ? 123 : kind === "empty-id" ? "" : targetId;
      await prisma.systemSetting.create({ data: { key: `ai-generation-content:${id}`, updatedBy: owner, value: { owner, hash: id, ...(kind === "missing-id" ? {} : { canonicalRequestId }) } } });
      if (["wrong-owner", "wrong-hash", "invalid-state", "valid"].includes(kind)) await prisma.systemSetting.create({ data: {
        key: `ai-generation:${targetId}`, updatedBy: owner,
        value: { owner: kind === "wrong-owner" ? `${owner}-other` : owner, hash: kind === "wrong-hash" ? "different" : id, state: kind === "invalid-state" ? "UNKNOWN" : "CLAIMED" },
      } });
    }
    const operations = new AiGradingOperationsService(prisma);
    const session = { roleCode: "SYSTEM_ADMIN", permissions: ["system:configure"], user: { id: owner } } as AuthenticatedSession;
    const expectedIds = cases.filter((kind) => kind !== "valid").map((kind) => `${prefix}-${kind}`).sort().reverse();
    const snapshot = await prisma.systemSetting.findMany({ where: { updatedBy: owner, key: { contains: prefix } }, orderBy: { key: "asc" } });
    const first = await operations.listExams({ limit: 1, scope: "broken", state: "CLAIMED" }, session);
    expect(first.items.map((item) => item.id)).toEqual(expectedIds.slice(0, 1));
    const rest = await operations.listExams({ limit: 50, scope: "broken", state: "CLAIMED", cursor: first.nextCursor! }, session);
    expect(rest.items.filter((item) => item.id.startsWith(prefix)).map((item) => item.id)).toEqual(expectedIds.slice(1));
    expect(Object.keys(first.items[0]!).sort()).toEqual(["id", "ownerId", "state", "version", "createdAt", "updatedAt"].sort());
    expect(JSON.stringify([first, rest])).not.toContain("private broken draft");
    await expect(operations.listExams({ limit: 1, scope: "broken", cursor: `${prefix}-valid` }, session)).rejects.toMatchObject({ status: 400 });
    await expect(operations.listExams({ limit: 1, scope: "unlinked", cursor: expectedIds[0] }, session)).rejects.toMatchObject({ status: 400 });
    expect(await prisma.systemSetting.findMany({ where: { updatedBy: owner, key: { contains: prefix } }, orderBy: { key: "asc" } })).toEqual(snapshot);
  });
});
