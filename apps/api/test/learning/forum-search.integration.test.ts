import { Test, type TestingModule } from "@nestjs/testing";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../../src/app.module.js";
import { PrismaService } from "../../src/database/prisma.service.js";
import { LearningService } from "../../src/domains/learning/core/learning.service.js";

describe.skipIf(!(process.env.DB_NAME ?? "").endsWith("_test"))("forum indexed search", () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let service: LearningService;
  let ownerId: string;
  let classId: string;
  const prefix = `forum-search-${randomUUID()}`;

  // Tạo chủ đề riêng trên lớp có phân công seed, phủ tìm kiếm tiêu đề/nội dung/tag.
  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    prisma = moduleRef.get(PrismaService);
    service = moduleRef.get(LearningService);
    const assignment = await prisma.classInstructor.findFirstOrThrow();
    ownerId = assignment.instructorId;
    classId = assignment.classId;
    await prisma.forumTopic.createMany({ data: Array.from({ length: 30 }, (_, i) => ({
      id: `${prefix}-${i}`, classId, authorId: ownerId, title: i % 3 === 0 ? `${prefix} title` : "Tiêu đề",
      body: i % 3 === 1 ? `${prefix} body` : "Nội dung", tags: i % 3 === 2 ? [prefix] : [],
      isPinned: i % 5 === 0, status: "PUBLISHED", createdAt: new Date(1_700_000_000_000 + i * 1000),
    })) });
    await prisma.forumTopic.create({ data: { id: `${prefix}-special`, classId, authorId: ownerId,
      title: `${prefix}left`, body: `${prefix}right`, tags: [`${prefix} Tiếng Việt "quote"`, `${prefix}back\\slash`, `${prefix}%_`, `${prefix}alpha`, `${prefix}beta`] } });
  });

  // Chỉ dọn các chủ đề fixture, không thay đổi thành viên lớp seed.
  afterAll(async () => {
    if (prisma) await prisma.forumTopic.deleteMany({ where: { id: { startsWith: prefix } } });
    await moduleRef?.close();
  });

  it("keeps totals, pinned ordering and disjoint pages with scope filters", async () => {
    const expected = await prisma.forumTopic.findMany({ where: { id: { startsWith: prefix } }, orderBy: [{ isPinned: "desc" }, { createdAt: "desc" }, { id: "asc" }] });
    const first = await service.listTopicsPage("INSTRUCTOR", ownerId, { query: prefix.toUpperCase(), classId, pageSize: 10 });
    const second = await service.listTopicsPage("INSTRUCTOR", ownerId, { query: prefix, classId, page: 2, pageSize: 10 });
    expect(first.total).toBe(31);
    expect(first.items.map((row) => row.id)).toEqual(expected.slice(0, 10).map((row) => row.id));
    expect(second.items.map((row) => row.id)).toEqual(expected.slice(10, 20).map((row) => row.id));
    expect((await service.listTopicsPage("INSTRUCTOR", ownerId, { query: prefix, pinnedOnly: true, mineOnly: true })).total).toBe(6);
    for (const role of ["INSTRUCTOR", "LEARNER"]) {
      expect((await service.listTopicsPage(role, `${prefix}-outsider`, { query: prefix })).total).toBe(0);
    }
  });

  it("preserves literal wildcards, decoded Unicode tags and field boundaries", async () => {
    for (const query of [`${prefix} Tiếng Việt "quote"`, `${prefix}back\\slash`, `${prefix}%_`]) {
      const result = await service.listTopicsPage("INSTRUCTOR", ownerId, { query, classId });
      expect(result.items.map((row) => row.id)).toEqual([`${prefix}-special`]);
    }
    for (const query of [`${prefix}left\n${prefix}right`, `${prefix}alpha\n${prefix}beta`, `${prefix}%' OR TRUE --`]) {
      expect((await service.listTopicsPage("INSTRUCTOR", ownerId, { query, classId })).total).toBe(0);
    }
  });
});
