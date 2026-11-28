import { Test, type TestingModule } from "@nestjs/testing";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../../src/app.module.js";
import { PrismaService } from "../../src/database/prisma.service.js";
import { LearningService } from "../../src/domains/learning/core/learning.service.js";
import { deleteTestAuditLogs } from "../support/audit-maintenance.js";

describe.skipIf(!(process.env.DB_NAME ?? "").endsWith("_test"))("manual grade bulk upsert on PostgreSQL", () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let learning: LearningService;
  let teacherId: string;
  const examId = `grade-bulk-${randomUUID()}`;
  const attemptId = `${examId}-attempt`;
  const questionIds = Array.from({ length: 50 }, (_, i) => `${examId}-q${i}`);

  // Tạo đề riêng 50 câu tự luận, một đáp án đã lưu và 49 câu chưa trả lời.
  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    prisma = moduleRef.get(PrismaService);
    learning = moduleRef.get(LearningService);
    const assignment = await prisma.classInstructor.findFirstOrThrow({ include: { class: true } });
    teacherId = assignment.instructorId;
    const learner = await prisma.user.findFirstOrThrow({ where: { roles: { some: { role: { code: "LEARNER" } } } } });
    await prisma.question.createMany({ data: questionIds.map((id) => ({ id, courseId: assignment.class.courseId, authorId: teacherId,
      type: "ESSAY" as const, content: "Bulk grading fixture", options: [], correctAnswers: [], tags: [], familyId: id, contentHash: "bulk-fixture" })) });
    await prisma.exam.create({ data: { id: examId, classId: assignment.classId, title: "Bulk grading fixture", durationMinutes: 30,
      totalScore: 100, openAt: new Date(Date.now() - 3_600_000), closeAt: new Date(Date.now() - 60_000),
      questions: { create: questionIds.map((questionId, position) => ({ questionId, position, score: 2 })) } } });
    await prisma.examAttempt.create({ data: { id: attemptId, examId, learnerId: learner.id, attemptNo: 1,
      status: "SUBMITTED", submittedAt: new Date(), answers: { create: { questionId: questionIds[0]!, answerData: ["Nội dung giữ nguyên"] } } } });
  });

  // Chỉ xóa fixture và audit do lượt kiểm thử này tạo.
  afterAll(async () => {
    if (prisma) {
      await deleteTestAuditLogs(prisma, { entityId: attemptId });
      await prisma.examAttempt.deleteMany({ where: { id: attemptId } });
      await prisma.exam.deleteMany({ where: { id: examId } });
      await prisma.question.deleteMany({ where: { id: { in: questionIds } } });
    }
    await moduleRef?.close();
  });

  it("creates missing answers, preserves submitted text and audits corrections", async () => {
    await learning.gradeAttempt(attemptId, 0, "Chấm lần đầu", undefined, teacherId,
      questionIds.map((questionId) => ({ questionId, score: 1.25 })));
    let answers = await prisma.attemptAnswer.findMany({ where: { attemptId } });
    expect(answers).toHaveLength(50);
    expect(answers.every((row) => Number(row.score) === 1.25)).toBe(true);
    expect(answers.find((row) => row.questionId === questionIds[0])?.answerData).toEqual(["Nội dung giữ nguyên"]);
    expect(answers.find((row) => row.questionId === questionIds[1])?.answerData).toEqual([]);
    expect(Number((await prisma.examAttempt.findUniqueOrThrow({ where: { id: attemptId } })).score)).toBe(62.5);
    await learning.gradeAttempt(attemptId, 0, "Sau đối chiếu", "Đối chiếu rubric", teacherId,
      questionIds.map((questionId) => ({ questionId, score: 1.5 })));
    answers = await prisma.attemptAnswer.findMany({ where: { attemptId } });
    expect(answers).toHaveLength(50);
    expect(answers.every((row) => Number(row.score) === 1.5)).toBe(true);
    expect(answers.find((row) => row.questionId === questionIds[0])?.answerData).toEqual(["Nội dung giữ nguyên"]);
    expect(Number((await prisma.examAttempt.findUniqueOrThrow({ where: { id: attemptId } })).score)).toBe(75);
    expect(await prisma.auditLog.count({ where: { entityId: attemptId, action: "EXAM_GRADE_CORRECTED" } })).toBe(1);
    await expect(learning.gradeAttempt(attemptId, 0, "", "Điểm không hợp lệ", teacherId,
      questionIds.map((questionId) => ({ questionId, score: -1 })))).rejects.toMatchObject({ status: 400 });
    expect(Number((await prisma.examAttempt.findUniqueOrThrow({ where: { id: attemptId } })).score)).toBe(75);
  });
});
