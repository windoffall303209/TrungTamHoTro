import { Test, TestingModule } from "@nestjs/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module.js";
import { PrismaService } from "../src/database/prisma.service.js";
import { LearningService } from "../src/domains/learning/learning.service.js";

const enabled = (process.env.DB_NAME ?? "").endsWith("_test") && process.env.DATABASE_CONNECT_ON_START === "true";
describe.skipIf(!enabled)("PostgreSQL paginated material search", () => {
  let module: TestingModule;
  let prisma: PrismaService;
  let learning: LearningService;
  let ownerId: string;
  let classId: string;
  const prefix = `search-${process.pid}-${Date.now()}`;
  beforeAll(async () => {
    module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    prisma = module.get(PrismaService);
    await prisma.$connect();
    learning = module.get(LearningService);
    const assigned = await prisma.classInstructor.findFirst({ include: { class: true } });
    if (!assigned) throw new Error("Dedicated test database must be seeded.");
    ownerId = assigned.instructorId;
    classId = assigned.classId;
    await prisma.material.createMany({ data: Array.from({ length: 120 }, (_, index) => ({ id: `${prefix}-${index}`, classId, courseId: assigned.class.courseId, ownerId, name: `${prefix}-Lesson-${index}.pdf`, objectKey: `${prefix}/${index}`, mimeType: "application/pdf", sizeBytes: 10, folder: "Folder", tags: ["MiXeD_Tag"], visibility: "PUBLISHED" as const })) });
  });
  afterAll(async () => {
    if (prisma) await prisma.material.deleteMany({ where: { id: { startsWith: prefix } } });
    await module?.close();
  });

  it("returns bounded pages, accurate totals and stable ordering while reducing payload size", async () => {
    const before = await prisma.material.findMany({ where: { id: { startsWith: prefix } } });
    const first = await learning.searchAccessibleMaterials({ query: prefix.toUpperCase(), pageSize: 10 }, ownerId, "INSTRUCTOR");
    const second = await learning.searchAccessibleMaterials({ query: prefix, page: 2, pageSize: 10 }, ownerId, "INSTRUCTOR");
    expect(first.total).toBe(120);
    expect(first.items).toHaveLength(10);
    expect(second.items).toHaveLength(10);
    expect(second.items.some((item) => first.items.some((previous) => previous.id === item.id))).toBe(false);
    const baselineBytes = Buffer.byteLength(JSON.stringify(before, (_key, value: unknown) => typeof value === "bigint" ? Number(value) : value));
    const pageBytes = Buffer.byteLength(JSON.stringify(first));
    expect(pageBytes).toBeLessThan(baselineBytes / 5);
    console.info(JSON.stringify({ metric: "material-search-payload", baselineRows: before.length, pageRows: first.items.length, baselineBytes, pageBytes }));
  });

  it("enforces role boundaries and parameterizes wildcard/injection strings", async () => {
    expect((await learning.searchAccessibleMaterials({ query: prefix }, "unassigned", "INSTRUCTOR")).total).toBe(0);
    expect((await learning.searchAccessibleMaterials({ query: prefix }, ownerId, "UNKNOWN")).total).toBe(0);
    expect((await learning.searchAccessibleMaterials({ query: "%' OR TRUE --" }, ownerId, "INSTRUCTOR")).total).toBe(0);
    expect((await learning.searchAccessibleMaterials({ query: prefix, tag: "mixed_tag" }, ownerId, "INSTRUCTOR")).total).toBe(120);
    expect((await learning.searchAccessibleMaterials({ query: "xed_t", classId }, ownerId, "INSTRUCTOR")).total).toBeGreaterThanOrEqual(120);
    expect((await learning.searchAccessibleMaterials({ query: prefix, pageSize: 1000 }, ownerId, "INSTRUCTOR")).items).toHaveLength(50);
    expect((await learning.searchAccessibleMaterials({ query: prefix, page: 999 }, ownerId, "INSTRUCTOR")).total).toBe(120);
    await expect(learning.searchAccessibleMaterials({ query: "x".repeat(256) }, ownerId, "INSTRUCTOR")).rejects.toThrow();
  });
});
