import { Test } from "@nestjs/testing";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { AppModule } from "../src/app.module.js";
import type { AuthenticatedSession } from "../src/auth/auth.service.js";
import { PrismaService } from "../src/database/prisma.service.js";
import { AcademicService } from "../src/learning/academic.service.js";
import { AntivirusService } from "../src/infrastructure/antivirus.service.js";
import { ObjectStorageService } from "../src/infrastructure/object-storage.service.js";

const suffix = `${process.pid}-${Date.now().toString(36)}`;
const instructor: AuthenticatedSession = { sessionId: "test-instructor", user: { id: "usr-instructor", username: "instructor", name: "Trần Giảng Viên", email: "instructor@wind.edu.vn", roleName: "Giảng viên" }, roleCode: "INSTRUCTOR", permissions: ["exam:manage", "report:view"], availableRoles: [{ code: "INSTRUCTOR", name: "Giảng viên" }] };
const learner: AuthenticatedSession = { sessionId: "test-learner", user: { id: "usr-learner", username: "learner", name: "Lê Học Viên", email: "learner@wind.edu.vn", roleName: "Học viên" }, roleCode: "LEARNER", permissions: ["exam:view"], availableRoles: [{ code: "LEARNER", name: "Học viên" }] };
const administrator: AuthenticatedSession = { sessionId: "test-admin", user: { id: "usr-admin", username: "admin", name: "Quản trị hệ thống", email: "admin@wind.edu.vn", roleName: "Quản trị hệ thống" }, roleCode: "SYSTEM_ADMIN", permissions: ["exam:manage", "report:view"], availableRoles: [{ code: "SYSTEM_ADMIN", name: "Quản trị hệ thống" }] };

describe("AcademicService", () => {
  let service: AcademicService;
  let prisma: PrismaService;
  let assignmentId = "";
  let attachmentAssignmentId = "";
  let announcementId = "";
  const storedFiles = new Map<string, Buffer>();

  beforeAll(async () => {
    const storage = {
      put: vi.fn((objectKey: string, buffer: Buffer) => { storedFiles.set(objectKey, buffer); return Promise.resolve({ objectKey, checksum: "sha256:test" }); }),
      get: vi.fn((objectKey: string) => Promise.resolve(storedFiles.get(objectKey) ?? Buffer.alloc(0))),
      remove: vi.fn((objectKey: string) => { storedFiles.delete(objectKey); return Promise.resolve(); }),
    };
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ObjectStorageService).useValue(storage)
      .overrideProvider(AntivirusService).useValue({ scan: vi.fn(() => Promise.resolve({ clean: true, engine: "disabled" })) })
      .compile();
    service = module.get(AcademicService); prisma = module.get(PrismaService);
    expect(await prisma.learningClass.findUnique({ where: { id: "class-web-01" } })).toBeTruthy();
  });

  afterAll(async () => {
    if (assignmentId) await prisma.notification.deleteMany({ where: { entityId: assignmentId } });
    if (announcementId) await prisma.notification.deleteMany({ where: { entityId: announcementId } });
    if (announcementId) await prisma.classAnnouncement.deleteMany({ where: { id: announcementId } });
    if (attachmentAssignmentId) await prisma.assignment.deleteMany({ where: { id: attachmentAssignmentId } });
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

  it("nộp bài chỉ bằng tệp và cho phép thêm, xóa từng tệp", async () => {
    const assignment = await service.createAssignment("class-web-01", { title: `Bài tệp ${suffix}`, description: "Kiểm thử bài nộp có nhiều tệp đính kèm.", instructions: "Nộp PDF hoặc tệp văn bản.", dueAt: new Date(Date.now() + 3_600_000).toISOString(), maxScore: 10, rubric: [{ title: "Nội dung", description: "Đủ minh chứng", maxPoints: 10 }] }, instructor);
    attachmentAssignmentId = assignment.id;
    await service.publishAssignment(assignment.id, instructor);
    const first = await service.submitAssignment(assignment.id, "", learner, [{ originalName: "bao-cao.txt", mimeType: "text/plain", size: 7, buffer: Buffer.from("bao cao") }]);
    expect(first.content).toBe("");
    expect(first.attachments).toHaveLength(1);
    const second = await service.addSubmissionAttachments(first.id, [{ originalName: "minh-chung.pdf", mimeType: "application/pdf", size: 4, buffer: Buffer.from("%PDF") }], learner);
    expect(second.attachments.map((item) => item.originalName)).toEqual(["bao-cao.txt", "minh-chung.pdf"]);
    const downloaded = await service.readSubmissionAttachment(second.id, second.attachments[1]!.id, instructor);
    expect(downloaded.fileName).toBe("minh-chung.pdf");
    const remaining = await service.removeSubmissionAttachment(second.id, second.attachments[0]!.id, learner);
    expect(remaining.attachments.map((item) => item.originalName)).toEqual(["minh-chung.pdf"]);
    await expect(service.submitAssignment(assignment.id, "", learner, Array.from({ length: 5 }, (_, index) => ({ originalName: `tep-${index}.txt`, mimeType: "text/plain", size: 1, buffer: Buffer.from("x") })))).rejects.toThrow("tối đa 5 tệp");
    await expect(service.submitAssignment(assignment.id, "", learner, [{ originalName: "gia-mao.png", mimeType: "image/png", size: 8, buffer: Buffer.from("notimage") }])).rejects.toThrow("không khớp");
  });

  it("không cho quản trị hệ thống thực hiện nghiệp vụ học thuật của giảng viên", async () => {
    await expect(service.createAnnouncement("class-web-01", `Thông báo quản trị ${suffix}`, "Nội dung không được phép phát từ vai trò quản trị.", administrator)).rejects.toThrow("Nghiệp vụ học thuật chỉ dành cho giảng viên được phân công.");
  });
});
