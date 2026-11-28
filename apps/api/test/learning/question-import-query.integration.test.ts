import { Test, type TestingModule } from "@nestjs/testing";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { AppModule } from "../../src/app.module.js";
import { PrismaService } from "../../src/database/prisma.service.js";
import { LearningService } from "../../src/domains/learning/core/learning.service.js";
import type { LearningQuestion } from "../../src/domains/learning/core/learning.types.js";

describe.skipIf(!(process.env.DB_NAME ?? "").endsWith("_test"))("question import consolidated reads", () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let service: LearningService;
  let courseId: string;
  let authorId: string;
  const prefix = `import-query-${randomUUID()}`;

  // Dùng phân công seed sẵn có, chỉ tạo các câu hỏi có marker riêng để dọn sau test.
  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    prisma = moduleRef.get(PrismaService);
    service = moduleRef.get(LearningService);
    const assignment = await prisma.classInstructor.findFirstOrThrow({ include: { class: true } });
    courseId = assignment.class.courseId;
    authorId = assignment.instructorId;
  });

  // Khôi phục spy và xóa đúng các câu hỏi thuộc fixture này.
  afterAll(async () => {
    vi.restoreAllMocks();
    if (prisma) await prisma.question.deleteMany({ where: { content: { startsWith: prefix } } });
    await moduleRef?.close();
  });

  // Tạo câu đúng/sai hợp lệ theo cùng hợp đồng import của ứng dụng.
  function question(suffix: string): Omit<LearningQuestion, "id" | "status" | "version"> {
    return { courseId, content: `${prefix} ${suffix}`, type: "TRUE_FALSE", options: ["Đúng", "Sai"],
      correctAnswers: ["Đúng"], difficulty: 1, tags: [prefix] };
  }

  it("imports 50 rows with one validation read and one write per row", async () => {
    const read = vi.spyOn(prisma, "$queryRaw");
    const create = vi.spyOn(prisma.question, "create");
    const courseRead = vi.spyOn(prisma.course, "findUnique");
    const accessRead = vi.spyOn(prisma.learningClass, "count");
    const duplicateRead = vi.spyOn(prisma.question, "findFirst");
    const result = await service.importQuestions(Array.from({ length: 50 }, (_, i) => question(String(i))), authorId);
    expect(result).toHaveLength(50);
    expect(result.every((row) => row.status === "IMPORTED")).toBe(true);
    expect(read).toHaveBeenCalledTimes(50);
    expect(create).toHaveBeenCalledTimes(50);
    expect(courseRead).not.toHaveBeenCalled();
    expect(accessRead).not.toHaveBeenCalled();
    expect(duplicateRead).not.toHaveBeenCalled();
    vi.restoreAllMocks();
    expect(await prisma.question.count({ where: { content: { startsWith: prefix } } })).toBe(50);
  });

  it("allows duplicate question content with distinct IDs while keeping validation, missing course and permission errors", async () => {
    const result = await service.importQuestions([
      question("0"),
      { ...question("invalid"), type: "SINGLE_CHOICE", options: ["one"], correctAnswers: ["one"] },
      { ...question("missing"), courseId: `${prefix}-missing` },
      question("fresh"), question("fresh"), question("last"),
    ], authorId);
    expect(result.map((row) => row.status)).toEqual(["IMPORTED", "FAILED", "FAILED", "IMPORTED", "IMPORTED", "IMPORTED"]);
    expect(result[1]?.message).toContain("hai lựa chọn");
    expect(result[2]?.message).toBe("Không tìm thấy khóa học.");
    expect(result[3]?.questionId).not.toBe(result[4]?.questionId);
    const denied = await service.importQuestions([question("0"), question("denied")], `${prefix}-outsider`);
    expect(denied.map((row) => row.message)).toEqual(["Không tìm thấy khóa học.", "Không tìm thấy khóa học."]);
    expect(await prisma.question.count({ where: { content: { startsWith: prefix } } })).toBe(54);
  });
});
