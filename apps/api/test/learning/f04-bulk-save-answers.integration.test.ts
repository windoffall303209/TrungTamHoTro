import { randomUUID } from "node:crypto";
import { Test, type TestingModule } from "@nestjs/testing";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../../src/app.module.js";
import { PrismaService } from "../../src/database/prisma.service.js";
import { ExamAssessmentService } from "../../src/domains/learning/exams/exam-assessment.service.js";

/** Đếm số câu SQL vật lý gửi qua pg.Client.prototype.query trong suốt một thao tác bất đồng bộ. */
async function countRealSql<T>(task: () => Promise<T>): Promise<{ result: T; queries: number }> {
  const originalQuery = Reflect.get(pg.Client.prototype, "query") as (this: pg.Client, ...params: unknown[]) => unknown;
  let queries = 0;
  Reflect.set(pg.Client.prototype, "query", function countedQuery(this: pg.Client, ...args: unknown[]): unknown {
    queries += 1;
    return originalQuery.apply(this, args);
  });
  try {
    const result = await task();
    return { result, queries };
  } finally {
    Reflect.set(pg.Client.prototype, "query", originalQuery);
  }
}

describe("F04 Ghi lô đáp án (bulk saveAnswers) và đối chiếu điểm 5 loại câu hỏi trên PostgreSQL thật", () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let exams: ExamAssessmentService;

  const prefix = `f04-unit-${randomUUID().slice(0, 8)}`;
  const classId = `${prefix}-class`;
  const examId = `${prefix}-exam`;
  const learnerId = `${prefix}-learner`;
  const questionIds: string[] = [];

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    prisma = moduleRef.get(PrismaService);
    exams = moduleRef.get(ExamAssessmentService);

    const sourceClass = await prisma.learningClass.findFirstOrThrow();
    const learnerRole = await prisma.role.findUniqueOrThrow({ where: { code: "LEARNER" } });

    await prisma.user.create({
      data: {
        id: learnerId,
        username: learnerId,
        email: `${learnerId}@test.local`,
        emailVerifiedAt: new Date(),
        displayName: "Học viên F04 Unit",
        status: "ACTIVE",
        roles: { create: { roleId: learnerRole.id } },
      },
    });
    await prisma.learningClass.create({
      data: {
        id: classId,
        code: classId,
        name: "Lớp F04 Unit",
        term: "test",
        capacity: 20,
        status: "ACTIVE",
        courseId: sourceClass.courseId,
        courseVersion: sourceClass.courseVersion,
        startAt: new Date(Date.now() - 86_400_000),
        endAt: new Date(Date.now() + 86_400_000 * 30),
        instructors: { create: { instructorId: "usr-instructor", role: "PRIMARY", assignedBy: "usr-instructor" } },
        enrollments: { create: { learnerId, status: "ACTIVE", source: "TEST" } },
      },
    });

    // Tạo 10 câu hỏi đủ 5 loại (4 SINGLE, 2 MULTIPLE, 2 TRUE_FALSE, 1 SHORT_ANSWER, 1 ESSAY).
    const specs: Array<{
      type: "SINGLE_CHOICE" | "MULTIPLE_CHOICE" | "TRUE_FALSE" | "SHORT_ANSWER" | "ESSAY";
      options: string[];
      correctAnswers: string[];
      score: number;
    }> = [
      ...Array.from({ length: 4 }, () => ({ type: "SINGLE_CHOICE" as const, options: ["A", "B", "C", "D"], correctAnswers: ["A"], score: 1 })),
      ...Array.from({ length: 2 }, () => ({ type: "MULTIPLE_CHOICE" as const, options: ["A", "B", "C", "D"], correctAnswers: ["A", "C"], score: 1.5 })),
      ...Array.from({ length: 2 }, () => ({ type: "TRUE_FALSE" as const, options: ["Đúng", "Sai"], correctAnswers: ["Đúng"], score: 0.5 })),
      { type: "SHORT_ANSWER", options: [], correctAnswers: ["TCP"], score: 1 },
      { type: "ESSAY", options: [], correctAnswers: [], score: 1 },
    ];

    for (let i = 0; i < specs.length; i += 1) {
      const qId = `${prefix}-q-${i + 1}`;
      questionIds.push(qId);
      const spec = specs[i]!;
      await prisma.question.create({
        data: {
          id: qId,
          courseId: sourceClass.courseId,
          authorId: "usr-instructor",
          type: spec.type,
          content: `Câu hỏi F04 số ${i + 1} (${spec.type})`,
          options: spec.options,
          correctAnswers: spec.correctAnswers,
          difficulty: 2,
          tags: ["f04"],
          status: "PUBLISHED",
          version: 1,
          familyId: qId,
          contentHash: `${prefix}-hash-${i + 1}`,
        },
      });
    }

    await prisma.exam.create({
      data: {
        id: examId,
        classId,
        title: "Đề hỗn hợp F04 Unit",
        durationMinutes: 60,
        totalScore: 10,
        openAt: new Date(Date.now() - 60_000),
        closeAt: new Date(Date.now() + 3_600_000),
        attemptLimit: 1,
        shuffleQuestions: false,
        status: "PUBLISHED",
        questions: {
          create: questionIds.map((questionId, position) => ({
            questionId,
            position,
            score: specs[position]!.score,
          })),
        },
      },
    });
  });

  afterAll(async () => {
    await prisma.exam.deleteMany({ where: { id: examId } });
    await prisma.question.deleteMany({ where: { id: { in: questionIds } } });
    await prisma.learningClass.deleteMany({ where: { id: classId } });
    await prisma.user.deleteMany({ where: { id: learnerId } });
    await moduleRef.close();
  });

  it("nộp gộp 10 câu hỗn hợp (kèm khử trùng questionId) ghi bằng 1 lệnh SQL bulk và chấm khớp DB", async () => {
    const started = await exams.startAttempt(examId, learnerId);
    // Đúng: 3/4 SINGLE (3.0) + 1/2 MULTIPLE (1.5) + 2/2 TRUE_FALSE (1.0) = 5.50 điểm khách quan; 2 câu tự luận chờ chấm.
    const bulkPayload = [
      { questionId: questionIds[0]!, answers: ["B"] }, // ghi đè bằng phần tử trùng bên dưới -> phải nhận "A"
      { questionId: questionIds[0]!, answers: ["A"] },
      { questionId: questionIds[1]!, answers: ["A"] },
      { questionId: questionIds[2]!, answers: ["A"] },
      { questionId: questionIds[3]!, answers: ["D"] }, // sai
      { questionId: questionIds[4]!, answers: ["C", "A"] }, // đúng không phụ thuộc thứ tự
      { questionId: questionIds[5]!, answers: ["A", "B"] }, // sai
      { questionId: questionIds[6]!, answers: ["Đúng"] },
      { questionId: questionIds[7]!, answers: ["Đúng"] },
      { questionId: questionIds[8]!, answers: ["TCP"] },
      { questionId: questionIds[9]!, answers: ["Bài luận mẫu F04 trình bày đầy đủ phân tích."] },
    ];

    const run = await countRealSql(() =>
      exams.submitAttemptWithAnswers(started.id, learnerId, bulkPayload),
    );
    // Không còn 11 upsert riêng lẻ; tổng SQL của cả saveAnswers + submitAttempt nhỏ hơn rất nhiều so với N+1 cũ.
    expect(run.queries).toBeLessThanOrEqual(22);
    expect(run.result.status).toBe("SUBMITTED");
    expect(run.result.submissionReceipt).toMatch(/^SUB-[A-F0-9]{20}$/);
    expect(run.result.score).toBeUndefined(); // Ẩn điểm cho tới khi chấm xong tự luận

    const dbAttempt = await prisma.examAttempt.findUniqueOrThrow({
      where: { id: started.id },
      include: { answers: true },
    });
    expect(dbAttempt.status).toBe("SUBMITTED");
    expect(dbAttempt.gradePublishedAt).toBeNull();
    expect(Number(dbAttempt.score)).toBe(5.5);
    expect(dbAttempt.answers.length).toBe(10);
    const byQ = new Map(dbAttempt.answers.map((a) => [a.questionId, a]));
    expect(Number(byQ.get(questionIds[0]!)?.score)).toBe(1);
    expect(Number(byQ.get(questionIds[3]!)?.score)).toBe(0);
    expect(Number(byQ.get(questionIds[4]!)?.score)).toBe(1.5);
    expect(byQ.get(questionIds[8]!)?.score).toBeNull();
    expect(byQ.get(questionIds[9]!)?.score).toBeNull();
  });
});
