import { Test } from "@nestjs/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module.js";
import type { AuthenticatedSession } from "../src/auth/auth.service.js";
import { PrismaService } from "../src/database/prisma.service.js";
import { AcademicService } from "../src/learning/academic.service.js";

const suffix = `${process.pid}-${Date.now().toString(36)}`;
const instructor: AuthenticatedSession = { sessionId: "test-instructor", user: { id: "usr-instructor", name: "Trần Giảng Viên", email: "instructor@wind.edu.vn", roleName: "Giảng viên" }, roleCode: "INSTRUCTOR", permissions: ["exam:manage", "report:view"], availableRoles: [{ code: "INSTRUCTOR", name: "Giảng viên" }] };
const learner: AuthenticatedSession = { sessionId: "test-learner", user: { id: "usr-learner", name: "Lê Học Viên", email: "learner@wind.edu.vn", roleName: "Học viên" }, roleCode: "LEARNER", permissions: ["exam:view"], availableRoles: [{ code: "LEARNER", name: "Học viên" }] };

describe("AcademicService", () => {
  let service: AcademicService;
  let prisma: PrismaService;
  let assignmentId = "";
  let announcementId = "";

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    service = module.get(AcademicService); prisma = module.get(PrismaService);
    expect(await prisma.learningClass.findUnique({ where: { id: "class-web-01" } })).toBeTruthy();
  });

  afterAll(async () => {
    if (assignmentId) await prisma.notification.deleteMany({ where: { entityId: assignmentId } });
    if (announcementId) await prisma.notification.deleteMany({ where: { entityId: announcementId } });
    if (announcementId) await prisma.classAnnouncement.deleteMany({ where: { id: announcementId } });
    if (assignmentId) await prisma.assignment.deleteMany({ where: { id: assignmentId } });
  });

  it("chạy xuyên suốt tạo, xuất bản, nộp và chấm bài bằng rubric", async () => {
    const assignment = await service.createAssignment("class-web-01", { title: `Bài tập ${suffix}`, description: "Phân tích một luồng nghiệp vụ hoàn chỉnh.", instructions: "Nộp phần phân tích bằng văn bản.", dueAt: new Date(Date.now() + 3_600_000).toISOString(), maxScore: 10, rubric: [{ title: "Phân tích", description: "Nêu đúng tác nhân và quy tắc", maxPoints: 6 }, { title: "Trình bày", description: "Cấu trúc rõ ràng", maxPoints: 4 }] }, instructor);
    assignmentId = assignment.id;
    expect(assignment.status).toBe("DRAFT");
    expect((await service.publishAssignment(assignment.id, instructor)).status).toBe("PUBLISHED");
    const submission = await service.submitAssignment(assignment.id, "Bài phân tích có tác nhân, điều kiện và kết quả.", learner);
    const graded = await service.gradeSubmission(submission.id, assignment.rubric.map((criterion, index) => ({ criterionId: criterion.id, score: index === 0 ? 5 : 3.5 })), "Đúng hướng, cần bổ sung ngoại lệ.", instructor);
    expect(graded.score).toBe(8.5);
    expect((await service.gradebook("class-web-01", instructor)).find((row) => row.learnerId === learner.user.id)?.assignmentEarned).toBeGreaterThanOrEqual(8.5);
  });

  it("đưa bài tập vào lịch tổng và phát thông báo lớp", async () => {
    expect((await service.calendar(learner)).some((event) => event.id === `assignment-${assignmentId}`)).toBe(true);
    const announcement = await service.createAnnouncement("class-web-01", `Thông báo ${suffix}`, "Lớp kiểm tra lại lịch và bài tập mới.", instructor);
    announcementId = announcement.id;
    expect((await service.listAnnouncements(learner)).some((item) => item.id === announcement.id)).toBe(true);
  });
});
