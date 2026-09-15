import { Test, type TestingModule } from "@nestjs/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module.js";
import { LearningService } from "../src/learning/learning.service.js";
import { parseExamPageQuery } from "../src/learning/operations/learning-exam-page.js";

describe("Giới hạn query phân trang đề", () => {
  it("nhận mặc định và biên hợp lệ", () => {
    expect(parseExamPageQuery({})).toMatchObject({ page: 1, pageSize: 20 });
    expect(parseExamPageQuery({ page: "100000", pageSize: "100" })).toMatchObject({ page: 100000, pageSize: 100 });
  });
  it.each([{ page: "0" }, { page: "-1" }, { page: "1.5" }, { page: ["1"] }, { page: "Infinity" },
    { pageSize: "101" }, { pageSize: "" }, { classId: ["class-1"] }, { focusId: "a".repeat(192) }])("từ chối query lỗi %j", (query) => {
    expect(() => parseExamPageQuery(query)).toThrow();
  });
});

const enabled = (process.env.DB_NAME ?? "").endsWith("_test") && process.env.DATABASE_CONNECT_ON_START === "true";
describe.skipIf(!enabled)("Phân trang đề trên PostgreSQL test", () => {
  let moduleRef: TestingModule;
  let service: LearningService;
  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    service = moduleRef.get(LearningService);
  });
  afterAll(async () => { await moduleRef?.close(); });

  it("hai trang không trùng, tổng số khớp phạm vi giảng viên", async () => {
    const all = await service.listExams("INSTRUCTOR", "usr-instructor");
    const first = await service.listExamPage("INSTRUCTOR", "usr-instructor", { page: 1, pageSize: 2 });
    const second = await service.listExamPage("INSTRUCTOR", "usr-instructor", { page: 2, pageSize: 2 });
    expect(all.length).toBeGreaterThan(2);
    expect(first.total).toBe(all.length);
    expect(first.items).toHaveLength(2);
    expect(second.items.every((item) => !first.items.some((prior) => prior.id === item.id))).toBe(true);
    expect([...first.items, ...second.items].every((item) => all.some((allowed) => allowed.id === item.id))).toBe(true);
    const focus = await service.listExamPage("INSTRUCTOR", "usr-instructor", { page: 1, pageSize: 2, focusId: second.items[0]!.id });
    expect(focus.page).toBe(2);
    expect(focus.items.map((item) => item.id)).toEqual(second.items.map((item) => item.id));
  });
  it("học viên giữ count và trạng thái nhưng không tải danh sách câu hỏi", async () => {
    const all = await service.listLearnerExamSummaries(undefined, "usr-learner");
    const page = await service.listExamPage("LEARNER", "usr-learner", { page: 1, pageSize: 20 });
    expect(page.total).toBe(all.length);
    expect(page.items.length).toBeGreaterThan(0);
    for (const item of page.items) {
      const original = all.find((exam) => exam.id === item.id)!;
      expect(item).toMatchObject({ questionIds: [], questionScores: {}, questionCount: original.questionCount,
        remainingAttempts: original.remainingAttempts, availabilityStatus: original.availabilityStatus });
    }
  });
  it("lọc lớp và focus không vượt qua giới hạn quyền", async () => {
    const page = await service.listExamPage("LEARNER", "user-without-enrollment", {
      page: 1, pageSize: 20, focusId: "exam-rest-01",
    });
    expect(page).toMatchObject({ total: 0, items: [], page: 1 });
    const missing = await service.listExamPage("INSTRUCTOR", "usr-instructor", { page: 999, pageSize: 20, classId: "missing-class" });
    expect(missing).toMatchObject({ total: 0, items: [], page: 1 });
    await expect(service.listExamPage("UNSUPPORTED", "usr-instructor", { page: 1, pageSize: 20 })).rejects.toMatchObject({ status: 403 });
  });
});
