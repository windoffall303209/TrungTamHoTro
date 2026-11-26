import { BadRequestException } from "@nestjs/common";
import { Test, type TestingModule } from "@nestjs/testing";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { AppModule } from "../../src/app.module.js";
import {
  paginateArray,
  parseOptionalQueryInt,
  parseOptionalQueryString,
  parsePageQuery,
} from "../../src/common/pagination.js";
import { AcademicController } from "../../src/domains/learning/academic/academic.controller.js";
import { AcademicService } from "../../src/domains/learning/academic/academic.service.js";
import { ContentMaterialService } from "../../src/domains/learning/content/content-material.service.js";
import { ContentController } from "../../src/domains/learning/content/content.controller.js";
import { LearningService } from "../../src/domains/learning/core/learning.service.js";
import { CourseClassService } from "../../src/domains/learning/courses/course-class.service.js";
import { CourseController } from "../../src/domains/learning/courses/course.controller.js";
import { EngagementSupportService } from "../../src/domains/learning/engagement/engagement-support.service.js";
import { EngagementController } from "../../src/domains/learning/engagement/engagement.controller.js";
import { ExamAssessmentService } from "../../src/domains/learning/exams/exam-assessment.service.js";
import { SystemController } from "../../src/domains/system/core/system.controller.js";
import { SystemService } from "../../src/domains/system/core/system.service.js";

describe("Hàm chuẩn hóa phân trang dùng chung", () => {
  it("parsePageQuery nhận giá trị hợp lệ và áp dụng mặc định", () => {
    expect(parsePageQuery({})).toEqual({ page: 1, pageSize: 20 });
    expect(parsePageQuery({ page: "3", pageSize: "25" }, { maxPageSize: 50 })).toEqual({
      page: 3,
      pageSize: 25,
    });
  });

  it.each([
    { page: "0" },
    { page: "-1" },
    { page: "1.5" },
    { page: ["1"] },
    { pageSize: "101" },
    { pageSize: "0" },
  ])("từ chối tham số phân trang không hợp lệ %j", (raw) => {
    expect(() => parsePageQuery(raw)).toThrow(BadRequestException);
  });

  it("parseOptionalQueryString và parseOptionalQueryInt kiểm tra kiểu và giới hạn", () => {
    expect(parseOptionalQueryString("  toan  ", "query")).toBe("toan");
    expect(parseOptionalQueryString("   ", "query")).toBeUndefined();
    expect(() => parseOptionalQueryString(["a"], "query")).toThrow(BadRequestException);
    expect(() => parseOptionalQueryString("a".repeat(20), "query", 10)).toThrow(BadRequestException);

    expect(parseOptionalQueryInt("2", "difficulty", 1, 3)).toBe(2);
    expect(parseOptionalQueryInt("", "difficulty", 1, 3)).toBeUndefined();
    expect(() => parseOptionalQueryInt("4", "difficulty", 1, 3)).toThrow(BadRequestException);
    expect(() => parseOptionalQueryInt("abc", "difficulty", 1, 3)).toThrow(BadRequestException);
  });

  it("paginateArray kẹp trang vượt biên về trang cuối và tính totalPages đúng", () => {
    expect(paginateArray([1, 2, 3, 4, 5], 2, 2)).toEqual({
      items: [3, 4],
      total: 5,
      page: 2,
      pageSize: 2,
      totalPages: 3,
    });
    expect(paginateArray([1, 2], 9, 5)).toEqual({
      items: [1, 2],
      total: 2,
      page: 1,
      pageSize: 5,
      totalPages: 1,
    });
  });
});

describe("API phân trang học liệu, câu hỏi, khóa học và lớp học (in-memory)", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-01T00:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("getMaterialSummary và searchAccessibleMaterials lọc đúng folderExact, kind và quyền xem", async () => {
    const service = new LearningService();
    await service.classFolders("class-web-01", "usr-instructor", { kind: "materials", name: "Tài liệu riêng" }, "INSTRUCTOR");
    await service.classFolders("class-web-01", "usr-instructor", { kind: "materials", name: "Tài liệu riêng mở rộng" }, "INSTRUCTOR");
    await service.classFolders("class-web-01", "usr-instructor", { kind: "lectures", name: "Bài giảng riêng" }, "INSTRUCTOR");

    const doc1 = await service.createMaterial(
      "class-web-01",
      { name: "De-cuong.pdf", mimeType: "application/pdf", sizeBytes: 1024, folder: "Tài liệu riêng", tags: ["de-cuong"], visibility: "PUBLISHED" },
      undefined,
      "usr-instructor",
      "INSTRUCTOR",
    );
    await service.createMaterial(
      "class-web-01",
      { name: "Nang-cao.pdf", mimeType: "application/pdf", sizeBytes: 1024, folder: "Tài liệu riêng mở rộng", tags: ["nang-cao"], visibility: "PUBLISHED" },
      undefined,
      "usr-instructor",
      "INSTRUCTOR",
    );
    await service.createMaterial(
      "class-web-01",
      { name: "Hidden.pdf", mimeType: "application/pdf", sizeBytes: 1024, folder: "Tài liệu riêng", tags: ["secret"], visibility: "HIDDEN" },
      undefined,
      "usr-instructor",
      "INSTRUCTOR",
    );
    await service.createMaterial(
      "class-web-01",
      { name: "Video bai 1", mimeType: "text/uri-list", sizeBytes: 28, folder: "Bài giảng riêng", tags: ["LECTURE", "lecture-url:https://youtu.be/dQw4w9WgXcQ"], visibility: "PUBLISHED" },
      undefined,
      "usr-instructor",
      "INSTRUCTOR",
    );

    const learnerSummary = await service.getMaterialSummary("usr-learner", "LEARNER", "class-web-01");
    expect(learnerSummary.find((b) => b.folder === "Tài liệu riêng" && b.kind === "materials")?.count).toBe(1);
    expect(learnerSummary.find((b) => b.folder === "Bài giảng riêng" && b.kind === "lectures")?.count).toBe(1);

    const instructorSummary = await service.getMaterialSummary("usr-instructor", "INSTRUCTOR", "class-web-01");
    expect(instructorSummary.find((b) => b.folder === "Tài liệu riêng" && b.kind === "materials")?.count).toBe(2);

    const exactFolder = await service.searchAccessibleMaterials(
      { classId: "class-web-01", folder: "Tài liệu riêng", folderExact: true, kind: "materials", page: 1, pageSize: 20 },
      "usr-learner",
      "LEARNER",
    );
    expect(exactFolder.items.map((item) => item.id)).toEqual([doc1.id]);

    const substringFolder = await service.searchAccessibleMaterials(
      { classId: "class-web-01", folder: "Tài liệu riêng", folderExact: false, kind: "materials", page: 1, pageSize: 20 },
      "usr-learner",
      "LEARNER",
    );
    expect(substringFolder.total).toBe(2);
    expect(substringFolder.items.some((item) => item.folder === "Tài liệu riêng mở rộng")).toBe(true);
  });

  it("listQuestionsPage chỉ lấy phiên bản mới nhất mỗi family và phân trang ổn định", async () => {
    const service = new LearningService();
    const created: string[] = [];
    for (let i = 1; i <= 5; i += 1) {
      const q = await service.createQuestion({
        courseId: "course-web",
        type: "SINGLE_CHOICE",
        content: `Cau hoi phan trang so ${i} voi bieu thuc $x_${i}$`,
        options: ["A", "B"],
        correctAnswers: ["A"],
        difficulty: 2,
        tags: ["phan-trang", `tag-${i}`],
      }, "usr-instructor");
      created.push(q.id);
    }
    const updated = await service.updateQuestion(created[0]!, {
      courseId: "course-web",
      type: "SINGLE_CHOICE",
      content: "Cau hoi phan trang so 1 ban v2 moi nhat",
      options: ["A", "B"],
      correctAnswers: ["A"],
      difficulty: 2,
      tags: ["phan-trang", "tag-1"],
    }, "usr-instructor");

    const page1 = await service.listQuestionsPage({
      courseId: "course-web",
      tag: "phan-trang",
      page: 1,
      pageSize: 2,
    }, { actorId: "usr-manager", actorRole: "CENTER_MANAGER" });
    const page2 = await service.listQuestionsPage({
      courseId: "course-web",
      tag: "phan-trang",
      page: 2,
      pageSize: 2,
    }, { actorId: "usr-manager", actorRole: "CENTER_MANAGER" });
    const page3 = await service.listQuestionsPage({
      courseId: "course-web",
      tag: "phan-trang",
      page: 3,
      pageSize: 2,
    }, { actorId: "usr-manager", actorRole: "CENTER_MANAGER" });

    expect(page1.total).toBe(5);
    expect(page1.totalPages).toBe(3);
    expect(page1.items[0]!.id).toBe(updated.id);
    expect(page1.items).toHaveLength(2);
    expect(page2.items).toHaveLength(2);
    expect(page3.items).toHaveLength(1);
    const allIds = [...page1.items, ...page2.items, ...page3.items].map((item) => item.id);
    expect(new Set(allIds).size).toBe(5);
  });

  it("listCoursesPage và listClassesPage lọc theo grade/subject/role và phân trang đúng", async () => {
    const service = new LearningService();
    const course = await service.createCourse({
      code: "TOAN-10-PAGE",
      name: "Toan lop 10 nang cao",
      description: "Chuong trinh phan trang",
      grade: "10",
      subject: "Toán học",
      outcomes: ["Nam vung dai so"],
    }, "usr-manager");
    await service.publishCourse(course.id, "usr-manager");

    const coursesPage = await service.listCoursesPage({
      grade: "10",
      subject: "Toán học",
      query: "TOAN-10-PAGE",
      page: 1,
      pageSize: 10,
    });
    expect(coursesPage.total).toBe(1);
    expect(coursesPage.items[0]!.id).toBe(course.id);

    const cls = await service.createClass({
      courseId: course.id,
      code: "CLS-10A1-PAGE",
      name: "Lop 10A1 chuyen Toan",
      term: "2026-2027",
      startAt: "2026-10-10T00:00:00.000Z",
      endAt: "2027-05-10T00:00:00.000Z",
      capacity: 30,
    }, "usr-manager");
    await service.assignInstructor(cls.id, "usr-instructor", "PRIMARY", "usr-manager");

    const managerPage = await service.listClassesPage("CENTER_MANAGER", "usr-manager", {
      grade: "10",
      subject: "Toán học",
      query: "CLS-10A1-PAGE",
      page: 1,
      pageSize: 10,
    });
    expect(managerPage.total).toBe(1);
    expect(managerPage.items[0]!.id).toBe(cls.id);

    const learnerPage = await service.listClassesPage("LEARNER", "usr-other-learner", {
      courseId: course.id,
      page: 1,
      pageSize: 10,
    });
    expect(learnerPage.total).toBe(0);
    expect(learnerPage.items).toEqual([]);
  });

  it("Controller kiểm tra chặt tham số truy vấn cho các endpoint phân trang", () => {
    const contentController = new ContentController(
      new ContentMaterialService(),
      new ExamAssessmentService(),
      {} as never,
      {} as never,
      {} as never,
    );
    const courseController = new CourseController(new CourseClassService());
    const session = { user: { id: "usr-manager" }, roleCode: "CENTER_MANAGER" } as never;

    expect(() =>
      contentController.searchMaterials(session, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, "invalid"),
    ).toThrow(BadRequestException);
    expect(() => contentController.listQuestionsPage({ page: "0" }, session)).toThrow(BadRequestException);
    expect(() => contentController.listQuestionsPage({ pageSize: "101" }, session)).toThrow(BadRequestException);
    expect(() => contentController.listQuestionsPage({ difficulty: "9" }, session)).toThrow(BadRequestException);
    expect(() => contentController.listQuestionsPage({ status: "UNKNOWN" }, session)).toThrow(BadRequestException);
    expect(() => courseController.listCoursesPage({ grade: "x".repeat(101) }, session)).toThrow(BadRequestException);
    expect(() => courseController.listCoursesPage({ grade: ["10"] }, session)).toThrow(BadRequestException);
    expect(() => courseController.listCoursesPage({ status: "ACTIVE" }, session)).toThrow(BadRequestException);
    expect(() => courseController.listClassesPage({ status: "PUBLISHED" }, session)).toThrow(BadRequestException);
    expect(() => contentController.listQuestionsPage({ typeGroup: "INVALID" }, session)).toThrow(BadRequestException);

    const engagementController = new EngagementController(new EngagementSupportService());
    expect(() => engagementController.listSessionsPage({ status: "INVALID" }, session)).toThrow(BadRequestException);
    expect(() => engagementController.listTicketsPage({ status: "INVALID" }, session)).toThrow(BadRequestException);

    const systemController = new SystemController(new SystemService(), {} as never, {} as never);
    expect(() => systemController.listAuditPage({ page: "0" })).toThrow(BadRequestException);

    const academicController = new AcademicController({} as never, {} as never);
    expect(() => academicController.assignmentsPage({ status: "INVALID" }, session)).toThrow(BadRequestException);
  });

  it("getQuestionSummary, typeGroup, audit, forum, support và live-sessions phân trang chính xác (in-memory)", async () => {
    const service = new LearningService();
    await service.createQuestion({
      courseId: "course-web",
      type: "ESSAY",
      content: "Phân tích kiến trúc hệ thống phân trang dữ liệu lớn trên PostgreSQL.",
      options: [],
      correctAnswers: ["Ý phân tích chuẩn"],
      difficulty: 3,
      tags: ["dot-2"],
    }, "usr-instructor");
    const summaryBefore = await service.getQuestionSummary("course-web", { actorId: "usr-manager", actorRole: "CENTER_MANAGER" });
    expect(summaryBefore.total).toBeGreaterThanOrEqual(1);
    expect(summaryBefore.essay).toBeGreaterThanOrEqual(1);
    expect(summaryBefore.multipleChoice + summaryBefore.essay).toBe(summaryBefore.total);

    const essayOnly = await service.listQuestionsPage({
      courseId: "course-web",
      typeGroup: "ESSAY",
      page: 1,
      pageSize: 50,
    }, { actorId: "usr-manager", actorRole: "CENTER_MANAGER" });
    expect(essayOnly.items.length).toBeGreaterThanOrEqual(1);
    expect(essayOnly.items.every((item) => item.type === "ESSAY")).toBe(true);

    const objectiveOnly = await service.listQuestionsPage({
      courseId: "course-web",
      typeGroup: "OBJECTIVE",
      page: 1,
      pageSize: 50,
    }, { actorId: "usr-manager", actorRole: "CENTER_MANAGER" });
    expect(objectiveOnly.items.every((item) => item.type !== "ESSAY")).toBe(true);

    const t1 = await service.createTopic(
      "class-web-01",
      { title: "Chu de 1 phan trang", body: "Noi dung thao luan 1", tags: ["kienthuc"], isPinned: true },
      "usr-instructor",
      "INSTRUCTOR",
    );
    await service.createTopic(
      "class-web-01",
      { title: "Chu de 2 thuong", body: "Noi dung thao luan 2", tags: ["khac"], isPinned: false },
      "usr-learner",
      "LEARNER",
    );
    const pinnedTopics = await service.listTopicsPage("LEARNER", "usr-learner", {
      pinnedOnly: true,
      page: 1,
      pageSize: 10,
    });
    expect(pinnedTopics.items.some((item) => item.id === t1.id)).toBe(true);
    expect(pinnedTopics.items.every((item) => item.isPinned)).toBe(true);

    const root1 = await service.createPost(t1.id, "Binh luan goc 1", "usr-learner");
    const root2 = await service.createPost(t1.id, "Binh luan goc 2", "usr-learner");
    const reply1 = await service.createPost(t1.id, "Phan hoi cho goc 1", "usr-learner", root1.id);
    const postsPage1 = await service.listPostsPage(t1.id, "LEARNER", "usr-learner", { page: 1, pageSize: 1 });
    expect(postsPage1.total).toBe(2);
    expect(postsPage1.totalPosts).toBe(3);
    expect(postsPage1.items.map((item) => item.id)).toEqual([root1.id, reply1.id]);
    const postsPage2 = await service.listPostsPage(t1.id, "LEARNER", "usr-learner", { page: 2, pageSize: 1 });
    expect(postsPage2.items.map((item) => item.id)).toEqual([root2.id]);

    const ticket = await service.createTicket(
      { category: "TECHNICAL", severity: "P2", description: "Can phan trang support ticket", contextId: "ctx-1" },
      "usr-learner",
    );
    const ticketsPage = await service.listTicketsPage("LEARNER", "usr-learner", {
      query: "phan trang support",
      page: 1,
      pageSize: 10,
    });
    expect(ticketsPage.items.some((item) => item.id === ticket.id)).toBe(true);

    const sessionsPage = await service.listSessionsPage("LEARNER", "usr-learner", { page: 1, pageSize: 10 });
    expect(sessionsPage.items.every((item) => item.hostUrl === "")).toBe(true);

    const system = new SystemService();
    await system.updateIntegration("int-1", false, "usr-admin");
    const auditPage = await system.listAuditPage({ page: 1, pageSize: 5 });
    expect(auditPage.total).toBeGreaterThanOrEqual(1);
    expect(auditPage.items.length).toBeLessThanOrEqual(5);
  });
});

const enabled = (process.env.DB_NAME ?? "").endsWith("_test") && process.env.DATABASE_CONNECT_ON_START === "true";
describe.skipIf(!enabled)("Phân trang DB PostgreSQL cho học liệu, câu hỏi, khóa học và lớp học", () => {
  let moduleRef: TestingModule;
  let service: LearningService;
  let academicService: AcademicService;
  let systemService: SystemService;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    service = moduleRef.get(LearningService);
    academicService = moduleRef.get(AcademicService);
    systemService = moduleRef.get(SystemService);
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  it("truy vấn phân trang SQL khớp dữ liệu tổng và không trùng lặp giữa các trang", async () => {
    const allQuestions = await service.listQuestions({}, { actorId: "usr-manager", actorRole: "CENTER_MANAGER" });
    const qPage1 = await service.listQuestionsPage({ page: 1, pageSize: 2 }, { actorId: "usr-manager", actorRole: "CENTER_MANAGER" });
    const qPage2 = await service.listQuestionsPage({ page: 2, pageSize: 2 }, { actorId: "usr-manager", actorRole: "CENTER_MANAGER" });
    expect(qPage1.total).toBe(allQuestions.length);
    if (allQuestions.length > 2) {
      expect(qPage2.items.every((item) => !qPage1.items.some((prior) => prior.id === item.id))).toBe(true);
    }
    const qSummary = await service.getQuestionSummary(undefined, { actorId: "usr-manager", actorRole: "CENTER_MANAGER" });
    expect(qSummary.total).toBe(allQuestions.length);
    expect(qSummary.multipleChoice + qSummary.essay).toBe(qSummary.total);

    const summary = await service.getMaterialSummary("usr-instructor", "INSTRUCTOR");
    expect(Array.isArray(summary)).toBe(true);

    const coursesPage = await service.listCoursesPage({ page: 1, pageSize: 5 });
    expect(coursesPage.items.length).toBeLessThanOrEqual(5);

    const classesPage = await service.listClassesPage("CENTER_MANAGER", "usr-manager", { page: 1, pageSize: 5 });
    expect(classesPage.items.length).toBeLessThanOrEqual(5);

    const auditPage = await systemService.listAuditPage({ page: 1, pageSize: 5 });
    expect(auditPage.items.length).toBeLessThanOrEqual(5);

    const topicsPage = await service.listTopicsPage("INSTRUCTOR", "usr-instructor", { page: 1, pageSize: 5 });
    expect(topicsPage.items.length).toBeLessThanOrEqual(5);

    const sessionsPage = await service.listSessionsPage("INSTRUCTOR", "usr-instructor", { page: 1, pageSize: 5 });
    expect(sessionsPage.items.length).toBeLessThanOrEqual(5);

    const ticketsPage = await service.listTicketsPage("SYSTEM_ADMIN", "usr-admin", { page: 1, pageSize: 5 });
    expect(ticketsPage.items.length).toBeLessThanOrEqual(5);

    const instructorSession = {
      sessionId: "test-instructor",
      user: { id: "usr-instructor", username: "instructor", name: "GV", email: "i@test.local", roleName: "Giảng viên" },
      roleCode: "INSTRUCTOR",
      permissions: ["exam:manage"],
      availableRoles: [{ code: "INSTRUCTOR", name: "Giảng viên" }],
    } as never;
    const allAssignments = await academicService.listAssignments(instructorSession);
    const assignPage = await academicService.listAssignmentsPage(instructorSession, { page: 1, pageSize: 5 });
    expect(assignPage.total).toBe(allAssignments.length);
    expect(assignPage.items.length).toBeLessThanOrEqual(5);
  });
});
