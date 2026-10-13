import { Test, type TestingModule } from "@nestjs/testing";
import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { AppModule } from "../src/app.module.js";
import { PrismaService } from "../src/database/prisma.service.js";
import { LearningService } from "../src/learning/learning.service.js";
import { AiGenerationRequestService } from "../src/learning/ai-generation-request.service.js";
import type { GeneratedExamDraft } from "../src/system/ai-provider.service.js";
import type { AiGeneratedExamResult } from "../src/learning/learning.types.js";

const enabled = (process.env.DB_NAME ?? "").endsWith("_test") && process.env.DATABASE_CONNECT_ON_START === "true";

describe.skipIf(!enabled)("AI exam persistence on dedicated PostgreSQL", () => {
  const fixture = `ai-save-${randomUUID()}`;
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let learning: LearningService;

  // Tạo dữ liệu quan hệ riêng cho kiểm thử, không sửa khóa học hoặc cấu hình nhà cung cấp có sẵn.
  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    prisma = moduleRef.get(PrismaService);
    learning = moduleRef.get(LearningService);
    await prisma.user.create({ data: { id: fixture, username: fixture, email: `${fixture}@example.test`, displayName: "AI persistence fixture" } });
    await prisma.course.create({ data: { id: fixture, code: fixture, name: "AI fixture", description: "Isolated test", outcomes: [], ownerId: fixture } });
    await prisma.learningClass.create({ data: { id: fixture, courseId: fixture, courseVersion: 1, code: fixture, name: "AI fixture", term: "test", startAt: new Date("2026-01-01"), endAt: new Date("2027-01-01"), capacity: 1, status: "ACTIVE", instructors: { create: { instructorId: fixture, assignedBy: fixture } } } });
  });

  // Chỉ xóa bản ghi thuộc bộ dữ liệu duy nhất này, theo thứ tự khóa ngoại.
  afterAll(async () => {
    if (prisma) {
      await prisma.systemSetting.deleteMany({ where: { updatedBy: fixture, key: { startsWith: "ai-generation" } } });
      await prisma.auditLog.deleteMany({ where: { actorId: fixture } });
      await prisma.exam.deleteMany({ where: { classId: fixture } });
      await prisma.question.deleteMany({ where: { courseId: fixture } });
      await prisma.learningClass.deleteMany({ where: { id: fixture } });
      await prisma.course.deleteMany({ where: { id: fixture } });
      await prisma.user.deleteMany({ where: { id: fixture } });
    }
    await moduleRef?.close();
  });

  it("keeps one exam and one question when concurrent saves race on the same request", async () => {
    const requestId = randomUUID();
    const input = { classId: fixture, title: "Concurrent save", durationMinutes: 30, totalScore: 10, attemptLimit: 1, openAt: "2026-09-10T00:00:00Z", closeAt: "2026-10-10T00:00:00Z" };
    const generated = { type: "SHORT_ANSWER" as const, content: `Concurrent question ${requestId}`, options: [], correctAnswers: ["HTTP"], difficulty: 1 as const, tags: [], warnings: [], confidence: 1 };
    const context = { mode: "WEB_SEARCH" as const, materialIds: [], sources: [] };
    const outcomes = await Promise.allSettled(Array.from({ length: 4 }, () => learning.createGeneratedExam(input, [generated], fixture, context, requestId, fixture)));
    expect(outcomes.some((outcome) => outcome.status === "fulfilled")).toBe(true);
    const stored = await prisma.exam.findUniqueOrThrow({ where: { generationRequestId: requestId } });
    for (const outcome of outcomes) if (outcome.status === "fulfilled") expect(outcome.value.id).toBe(stored.id);
    expect(await prisma.question.count({ where: { courseId: fixture, content: generated.content } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { actorId: fixture, entityId: stored.id, action: "AI_EXAM_DRAFT_CREATED" } })).toBe(1);
    expect((await learning.createGeneratedExam(input, [generated], fixture, context, requestId, fixture)).id).toBe(stored.id);
  });

  it("recovers an interrupted SAVING claim through concurrent retries without calling AI again", async () => {
    const requestId = randomUUID();
    const input = { classId: fixture, title: "Resume save", durationMinutes: 30, totalScore: 10, attemptLimit: 1, openAt: "2026-09-10T00:00:00Z", closeAt: "2026-10-10T00:00:00Z" };
    const question = { type: "SHORT_ANSWER" as const, content: `Resume question ${requestId}`, options: [], correctAnswers: ["HTTP"], difficulty: 1 as const, tags: [], warnings: [], confidence: 1 };
    const context = { mode: "WEB_SEARCH" as const, materialIds: [], sources: [] };
    const prepared = { courseId: fixture, generated: { questions: [question], model: "fixture", context: { ...context, materialNames: [] }, providerId: "fixture", provider: "CUSTOM", warnings: [] } satisfies GeneratedExamDraft };
    const generate = vi.fn(() => Promise.resolve(prepared));
    /** Mô phỏng thao tác bất đồng bộ không trả bản ghi tại ranh giới lưu trữ. */
    const noResult = (): Promise<undefined> => Promise.resolve(undefined);
    await expect(new AiGenerationRequestService(prisma).run(requestId, fixture, input, generate, () => Promise.reject(new Error("fixture interruption")), noResult)).rejects.toThrow("fixture interruption");
    const key = `ai-generation:${requestId}`;
    const claim = await prisma.systemSetting.findUniqueOrThrow({ where: { key } });
    // Mô phỏng tiến trình dừng sau khi lưu trạng thái SAVING, trước khi bắt đầu giao dịch tạo đề.
    await prisma.systemSetting.update({ where: { key }, data: { value: { ...(claim.value as object), state: "SAVING" }, version: { increment: 1 } } });
    // Callback này dùng giao dịch thật cùng ràng buộc duy nhất generationRequestId.
    const save = async (draft: { courseId: string; generated: GeneratedExamDraft }, canonicalId: string): Promise<AiGeneratedExamResult> => ({ exam: await learning.createGeneratedExam(input, draft.generated.questions, draft.courseId, context, canonicalId, fixture) } as AiGeneratedExamResult);
    const outcomes = await Promise.allSettled(Array.from({ length: 4 }, () => new AiGenerationRequestService(prisma).run(randomUUID(), fixture, input, generate, save, noResult, { idempotentSave: true })));
    expect(outcomes.some((outcome) => outcome.status === "fulfilled")).toBe(true);
    const replay = await new AiGenerationRequestService(prisma).run(randomUUID(), fixture, input, generate, save, noResult, { idempotentSave: true });
    expect(generate).toHaveBeenCalledTimes(1);
    expect(await prisma.exam.count({ where: { generationRequestId: requestId } })).toBe(1);
    expect(await prisma.question.count({ where: { courseId: fixture, content: question.content } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { actorId: fixture, entityId: replay.exam.id, action: "AI_EXAM_DRAFT_CREATED" } })).toBe(1);
    expect((await prisma.systemSetting.findUniqueOrThrow({ where: { key } })).value).toMatchObject({ state: "COMPLETED", result: { exam: { id: replay.exam.id } } });
  });

  it.each(["same", "answer", "options", "type", "difficulty", "case", "image"])("preserves generated question identity: %s", async (variant) => {
    const content = `Choose the HTTP method for ${variant}.`;
    const originalId = `${fixture}-${variant}`;
    const base = { content, type: "SINGLE_CHOICE" as const, difficulty: 1 as const, options: ["GET", "POST"], correctAnswers: ["GET"] };
    await prisma.question.create({ data: { ...base, id: originalId, familyId: originalId, authorId: fixture, courseId: fixture, contentHash: createHash("sha256").update(content.toLowerCase()).digest("hex"), tags: [], status: "PUBLISHED", ...(variant === "image" ? { imageObjectKey: `${fixture}/image` } : {}) } });
    const generated = { ...base, tags: [], warnings: [], confidence: 1,
      ...(variant === "answer" ? { correctAnswers: ["POST"] } : {}),
      ...(variant === "options" ? { options: ["POST", "GET"] } : {}),
      ...(variant === "type" ? { type: "MULTIPLE_CHOICE" as const, correctAnswers: ["GET", "POST"] } : {}),
      ...(variant === "difficulty" ? { difficulty: 2 as const } : {}),
      ...(variant === "case" ? { content: content.toUpperCase() } : {}),
    };
    const input = { classId: fixture, title: `AI ${variant}`, durationMinutes: 30, totalScore: 10, attemptLimit: 1, openAt: "2026-09-10T00:00:00Z", closeAt: "2026-10-10T00:00:00Z" };
    const context = { mode: "WEB_SEARCH" as const, materialIds: [], sources: [] };
    const requestId = randomUUID();
    const exam = await learning.createGeneratedExam(input, [generated], fixture, context, requestId, fixture);
    if (variant === "same") expect(exam.questionIds).toEqual([originalId]);
    else {
      expect(exam.questionIds[0]).not.toBe(originalId);
      const stored = await prisma.question.findUniqueOrThrow({ where: { id: exam.questionIds[0] } });
      expect(stored).toMatchObject({ content: generated.content, type: generated.type, difficulty: generated.difficulty, options: generated.options, correctAnswers: generated.correctAnswers, status: "DRAFT", imageObjectKey: null });
    }
    const before = await prisma.question.count({ where: { courseId: fixture } });
    const replay = await learning.createGeneratedExam(input, [generated], fixture, context, requestId, fixture);
    expect(replay.id).toBe(exam.id);
    expect(await prisma.exam.count({ where: { generationRequestId: requestId } })).toBe(1);
    expect(await prisma.question.count({ where: { courseId: fixture } })).toBe(before);
    expect(await prisma.auditLog.count({ where: { actorId: fixture, entityId: exam.id, action: "AI_EXAM_DRAFT_CREATED" } })).toBe(1);
  });

  it("rechecks class access before replaying a persisted exam", async () => {
    const requestId = randomUUID();
    const input = { classId: fixture, title: "Authorized replay", durationMinutes: 30, totalScore: 10, attemptLimit: 1, openAt: "2026-09-10T00:00:00Z", closeAt: "2026-10-10T00:00:00Z" };
    const generated = { type: "SHORT_ANSWER" as const, content: `Access question ${requestId}`, options: [], correctAnswers: ["HTTP"], difficulty: 1 as const, tags: [], warnings: [], confidence: 1 };
    const context = { mode: "WEB_SEARCH" as const, materialIds: [], sources: [] };
    const exam = await learning.createGeneratedExam(input, [generated], fixture, context, requestId, fixture);
    await expect(learning.createGeneratedExam(input, [generated], fixture, context, requestId, `${fixture}-outsider`)).rejects.toMatchObject({ status: 404 });
    await expect(learning.createGeneratedExam(input, [generated], `${fixture}-wrong-course`, context, requestId, fixture)).rejects.toMatchObject({ status: 404 });
    await prisma.classInstructor.delete({ where: { classId_instructorId: { classId: fixture, instructorId: fixture } } });
    try {
      await expect(learning.createGeneratedExam(input, [generated], fixture, context, requestId, fixture)).rejects.toMatchObject({ status: 404 });
      expect(await learning.getGeneratedExamByRequest(requestId, fixture, fixture)).toBeUndefined();
    } finally {
      await prisma.classInstructor.create({ data: { classId: fixture, instructorId: fixture, assignedBy: fixture } });
    }
    expect((await learning.createGeneratedExam(input, [generated], fixture, context, requestId, fixture)).id).toBe(exam.id);
    expect(await prisma.exam.count({ where: { generationRequestId: requestId } })).toBe(1);
    expect(await prisma.question.count({ where: { courseId: fixture, content: generated.content } })).toBe(1);
  });
});
