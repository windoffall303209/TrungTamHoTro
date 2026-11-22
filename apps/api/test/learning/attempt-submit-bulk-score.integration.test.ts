import { Test, type TestingModule } from "@nestjs/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../../src/app.module.js";
import { PrismaService } from "../../src/database/prisma.service.js";
import { LearningService } from "../../src/domains/learning/core/learning.service.js";

const enabled = (process.env.DB_NAME ?? "").endsWith("_test");
const suite = describe.skipIf(!enabled);

suite("Submit attempt bulk scoring on dedicated test database", () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let learning: LearningService;
  const attemptId = `attempt-bulk-${process.pid}-${Date.now()}`;

  // Khởi tạo service thật trên database có hậu tố _test.
  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    prisma = moduleRef.get(PrismaService);
    learning = moduleRef.get(LearningService);
  });

  // Chỉ dọn lượt làm bài do test tạo; câu trả lời bị xóa theo cascade.
  afterAll(async () => {
    await prisma.examAttempt.deleteMany({ where: { id: attemptId } });
    await moduleRef.close();
  });

  // Một lệnh UPDATE gộp phải ghi đúng điểm từng câu như vòng lặp cũ và tổng khớp điểm lượt làm.
  it("ghi điểm từng câu khách quan bằng một lệnh và tổng điểm khớp", async () => {
    const objectiveTypes = ["SINGLE_CHOICE", "MULTIPLE_CHOICE", "TRUE_FALSE"] as const;
    const exam = await prisma.exam.findFirstOrThrow({
      where: {
        hidden: false,
        questions: { some: { question: { type: { in: [...objectiveTypes] } } } },
      },
      include: { questions: { include: { question: true }, orderBy: { position: "asc" } } },
    });
    const objective = exam.questions.filter((item) => (objectiveTypes as readonly string[]).includes(item.question.type));
    expect(objective.length).toBeGreaterThanOrEqual(1);
    const learner = await prisma.user.findFirstOrThrow({ where: { status: "ACTIVE", roles: { some: { role: { code: "LEARNER" } } } }, select: { id: true } });
    const [correctItem, wrongItem] = objective;
    await prisma.examAttempt.create({
      data: {
        id: attemptId,
        examId: exam.id,
        learnerId: learner.id,
        attemptNo: 900_000 + (process.pid % 99_999),
        answers: {
          create: [
            { questionId: correctItem!.questionId, answerData: correctItem!.question.correctAnswers ?? [] },
            ...(wrongItem ? [{ questionId: wrongItem.questionId, answerData: ["__sai__"] }] : []),
          ],
        },
      },
    });

    // Học viên bất kỳ có thể chưa ghi danh lớp của đề nên chốt bài theo đường hệ thống (như tiến trình nộp quá hạn).
    const submitted = await learning.submitAttempt(attemptId, learner.id, "SYSTEM");

    const answers = await prisma.attemptAnswer.findMany({ where: { attemptId } });
    // Đọc điểm đã lưu trong attempt_answers của một câu theo questionId.
    const scoreOf = (questionId: string): number => Number(answers.find((item) => item.questionId === questionId)?.score);
    expect(scoreOf(correctItem!.questionId)).toBe(Number(correctItem!.score));
    if (wrongItem) expect(scoreOf(wrongItem.questionId)).toBe(0);
    const total = answers.reduce((sum, item) => sum + Number(item.score ?? 0), 0);
    expect(submitted.score).toBe(total);
  });
});
