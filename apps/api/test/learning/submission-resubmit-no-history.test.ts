import { BadRequestException, ConflictException, NotFoundException, ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { AppModule } from "../../src/app.module.js";
import type { AuthenticatedSession } from "../../src/auth/auth.service.js";
import { PrismaService } from "../../src/database/prisma.service.js";
import { SubmitAssignmentDto } from "../../src/domains/learning/academic/academic.dto.js";
import { AcademicService } from "../../src/domains/learning/academic/academic.service.js";
import { AiGradingAssistService } from "../../src/domains/learning/ai/ai-grading-assist.service.js";
import { AiProviderService } from "../../src/domains/system/ai/ai-provider.service.js";
import { AntivirusService } from "../../src/infrastructure/antivirus.service.js";
import { ObjectStorageService } from "../../src/infrastructure/object-storage.service.js";

const suffix = `${process.pid}-${Date.now().toString(36)}`;
const instructor: AuthenticatedSession = {
  sessionId: "test-instructor-resubmit",
  user: {
    id: "usr-instructor",
    username: "instructor",
    name: "Trần Giảng Viên",
    email: "instructor@wind.edu.vn",
    roleName: "Giảng viên",
  },
  roleCode: "INSTRUCTOR",
  permissions: ["exam:manage", "report:view"],
  availableRoles: [{ code: "INSTRUCTOR", name: "Giảng viên" }],
};
const learner: AuthenticatedSession = {
  sessionId: "test-learner-resubmit",
  user: {
    id: "usr-learner",
    username: "learner",
    name: "Lê Học Viên",
    email: "learner@wind.edu.vn",
    roleName: "Học viên",
  },
  roleCode: "LEARNER",
  permissions: ["exam:view"],
  availableRoles: [{ code: "LEARNER", name: "Học viên" }],
};

// Tạo buffer PDF hợp lệ tối thiểu dùng cho kiểm thử tải lên và thay tệp bài nộp.
function makePdfBuffer(label: string): Buffer {
  return Buffer.from(`%PDF-1.4\n% ${label}\n%%EOF`, "utf8");
}

// Tạo đối tượng tệp tải lên đủ các trường bắt buộc của UploadedAssignmentFile.
function makePdfUpload(
  originalName: string,
  label: string,
): { originalName: string; mimeType: string; size: number; buffer: Buffer } {
  const buffer = makePdfBuffer(label);
  return { originalName, mimeType: "application/pdf", size: buffer.length, buffer };
}

describe("Resubmit without assignment_submission_revisions history", () => {
  const testStartedAt = new Date();
  let service: AcademicService;
  let aiGrading: AiGradingAssistService;
  let prisma: PrismaService;
  let assignmentId = "";
  const storedFiles = new Map<string, Buffer>();
  const scanMock = vi.fn(() => Promise.resolve({ clean: true, engine: "clamav" }));

  beforeAll(async () => {
    const storage = {
      put: vi.fn((objectKey: string, buffer: Buffer) => {
        storedFiles.set(objectKey, buffer);
        return Promise.resolve({
          objectKey,
          checksum: `sha256:${createHash("sha256").update(buffer).digest("hex")}`,
        });
      }),
      get: vi.fn((objectKey: string) =>
        Promise.resolve(storedFiles.get(objectKey) ?? Buffer.alloc(0)),
      ),
      remove: vi.fn((objectKey: string) => {
        storedFiles.delete(objectKey);
        return Promise.resolve();
      }),
    };
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ObjectStorageService)
      .useValue(storage)
      .overrideProvider(AntivirusService)
      .useValue({ scan: scanMock })
      .overrideProvider(AiProviderService)
      .useValue({
        resolveTask: vi.fn(() => Promise.resolve({ provider: "GEMINI", model: "gemini-2.5-flash" })),
        extractDocumentPages: vi.fn((file: { name: string }) =>
          Promise.resolve([{ page: 1, text: `Noi dung hop le trong ${file.name}` }]),
        ),
        suggestGrading: vi.fn((input: { answer: string; rubric: Array<{ id: string; maxPoints: number }> }) => {
          const quote = input.answer.includes("Noi dung hop le") ? "Noi dung hop le" : input.answer.trim().slice(0, 30);
          return Promise.resolve({
            insufficientEvidence: false,
            feedback: "Nhận xét gợi ý từ AI.",
            criteria: input.rubric.map((criterion) => ({
              criterionId: criterion.id,
              suggestedPoints: criterion.maxPoints,
              reasoning: "Đủ dẫn chứng trong bài làm.",
              evidence: [quote],
            })),
            suggestedTotal: input.rubric.reduce((sum, criterion) => sum + criterion.maxPoints, 0),
            requiresHumanReview: true as const,
          });
        }),
      })
      .compile();

    service = module.get(AcademicService);
    aiGrading = module.get(AiGradingAssistService);
    prisma = module.get(PrismaService);
  });

  afterAll(async () => {
    if (assignmentId) {
      await prisma.notification.deleteMany({ where: { entityId: assignmentId } });
      await prisma.assignment.deleteMany({ where: { id: assignmentId } });
    }
    await prisma.systemSetting.deleteMany({
      where: {
        key: { startsWith: "ai-doc:" },
        updatedBy: instructor.user.id,
        updatedAt: { gte: testStartedAt },
      },
    });
    storedFiles.clear();
  });

  it("xác nhận bảng assignment_submission_revisions đã bị xóa khỏi schema PostgreSQL", async () => {
    const [row] = await prisma.$queryRaw<Array<{ reg: string | null }>>`
      SELECT to_regclass('public.assignment_submission_revisions')::text AS reg
    `;
    expect(row?.reg).toBeNull();
  });

  it("chạy trọn vẹn nộp bài, giữ nguyên bài hiện tại khi nộp lại lỗi, thay tệp & xóa gợi ý AI cũ, rồi chặn chấm nhầm revision cũ", async () => {
    const created = await service.createAssignment(
      "class-web-01",
      {
        title: `Tự luận không lưu lịch sử ${suffix}`,
        description: "Kiểm thử quy trình nộp lại giữ một bản mới nhất và xóa tệp cũ.",
        instructions: "Nộp đoạn phân tích và đính kèm tệp PDF.",
        dueAt: new Date(Date.now() + 3_600_000).toISOString(),
        maxScore: 10,
        rubric: [
          { title: "Nội dung", description: "Trình bày đúng trọng tâm", maxPoints: 10 },
        ],
      },
      instructor,
    );
    assignmentId = created.id;
    await service.publishAssignment(assignmentId, instructor);

    const oldUpload = makePdfUpload("ban-1.pdf", `old-${suffix}`);
    const first = await service.submitAssignment(
      assignmentId,
      "Noi dung hop le phien ban 1.",
      learner,
      [oldUpload],
      0,
    );
    expect(first.revision).toBe(1);
    expect(first.attachments).toHaveLength(1);
    const oldAttachment = first.attachments[0]!;
    const oldDbRow = await prisma.assignmentSubmissionAttachment.findUniqueOrThrow({
      where: { id: oldAttachment.id },
    });
    expect(storedFiles.has(oldDbRow.objectKey)).toBe(true);

    // Tạo gợi ý chấm AI gắn với revision 1 trước khi học viên nộp lại.
    const aiRev1 = await aiGrading.suggest(first.id, 1, "VI", instructor);
    expect(aiRev1.submissionRevision).toBe(1);
    expect(await prisma.aiGradingSuggestion.count({ where: { submissionId: first.id } })).toBe(1);

    // Trường hợp 1: nộp lại với tệp nhiễm mã độc -> từ chối, không làm mất bài nộp/tệp/gợi ý AI hiện tại.
    scanMock.mockResolvedValueOnce({ clean: false, engine: "clamav" });
    await expect(
      service.submitAssignment(
        assignmentId,
        "Bài nộp lỗi antivirus",
        learner,
        [makePdfUpload("infected.pdf", "bad")],
        1,
        [],
      ),
    ).rejects.toThrow(BadRequestException);

    // Trường hợp 2: giữ lại attachment không tồn tại -> từ chối, giữ nguyên bản cũ.
    await expect(
      service.submitAssignment(
        assignmentId,
        "Bài nộp sai tệp giữ lại",
        learner,
        [],
        1,
        ["att-khong-ton-tai"],
      ),
    ).rejects.toThrow(BadRequestException);

    // Trường hợp 3: expectedRevision cũ (0) -> ConflictException, giữ nguyên bản cũ.
    await expect(
      service.submitAssignment(
        assignmentId,
        "Bài nộp sai revision",
        learner,
        [makePdfUpload("stale.pdf", "stale")],
        0,
        [],
      ),
    ).rejects.toThrow(ConflictException);

    // Xác nhận sau 3 lần lỗi, bài nộp rev=1, ban-1.pdf và gợi ý AI vẫn nguyên vẹn và đọc được.
    const unchanged = await prisma.assignmentSubmission.findUniqueOrThrow({
      where: { id: first.id },
      include: { attachments: true },
    });
    expect(unchanged.revision).toBe(1);
    expect(unchanged.content).toBe("Noi dung hop le phien ban 1.");
    expect(unchanged.attachments.map((a) => a.id)).toEqual([oldAttachment.id]);
    expect(storedFiles.size).toBe(1);
    expect(storedFiles.has(oldDbRow.objectKey)).toBe(true);
    expect(await prisma.aiGradingSuggestion.count({ where: { submissionId: first.id } })).toBe(1);

    // Nộp lại hợp lệ: thay ban-1.pdf bằng ban-2.pdf (keepAttachmentIds = []).
    const newUpload = makePdfUpload("ban-2.pdf", `new-${suffix}`);
    const second = await service.submitAssignment(
      assignmentId,
      "Noi dung hop le phien ban 2 da thay tep.",
      learner,
      [newUpload],
      1,
      [],
    );
    expect(second.id).toBe(first.id);
    expect(second.revision).toBe(2);
    expect(second.attachments).toHaveLength(1);
    const newAttachment = second.attachments[0]!;
    expect(newAttachment.originalName).toBe("ban-2.pdf");

    // Chỉ có đúng 1 row trong assignment_submissions và chỉ còn ban-2.pdf trong assignment_submission_attachments.
    expect(await prisma.assignmentSubmission.count({ where: { assignmentId, learnerId: learner.user.id } })).toBe(1);
    const dbAttachments = await prisma.assignmentSubmissionAttachment.findMany({ where: { submissionId: first.id } });
    expect(dbAttachments.map((item) => item.id)).toEqual([newAttachment.id]);
    expect(storedFiles.has(oldDbRow.objectKey)).toBe(false);
    expect(storedFiles.has(dbAttachments[0]!.objectKey)).toBe(true);

    // Gợi ý AI của revision cũ đã bị xóa khỏi DB.
    expect(await prisma.aiGradingSuggestion.count({ where: { submissionId: first.id } })).toBe(0);

    // Đọc tệp cũ báo 404, đọc tệp mới thành công, đọc với revision cũ (1) báo Conflict.
    await expect(service.readSubmissionAttachment(first.id, oldAttachment.id, instructor)).rejects.toThrow(NotFoundException);
    await expect(service.readSubmissionAttachment(first.id, newAttachment.id, instructor, 1)).rejects.toThrow(ConflictException);
    const downloadedNew = await service.readSubmissionAttachment(first.id, newAttachment.id, instructor, 2);
    expect(downloadedNew.fileName).toBe("ban-2.pdf");
    expect(downloadedNew.buffer.equals(newUpload.buffer)).toBe(true);

    // Chấm bài và đọc/tạo gợi ý AI bằng revision cũ (1) đều bị chặn; revision 2 thành công.
    const criterionId = created.rubric[0]!.id;
    await expect(
      service.gradeSubmission(
        first.id,
        [{ criterionId, score: 8 }],
        "Chấm nhầm bản cũ",
        1,
        undefined,
        instructor,
      ),
    ).rejects.toThrow(ConflictException);
    await expect(aiGrading.inspect(first.id, 1, "VI", instructor)).rejects.toThrow(ConflictException);
    await expect(aiGrading.suggest(first.id, 1, "VI", instructor)).rejects.toThrow(ConflictException);

    const aiRev2 = await aiGrading.suggest(first.id, 2, "VI", instructor);
    expect(aiRev2.submissionRevision).toBe(2);
    const inspectedRev2 = await aiGrading.inspect(first.id, 2, "VI", instructor);
    expect(inspectedRev2.state).toBe("READY");
    expect(inspectedRev2.result?.submissionRevision).toBe(2);

    const graded = await service.gradeSubmission(
      first.id,
      [{ criterionId, score: 9 }],
      "Đã chấm đúng bản mới nhất.",
      2,
      undefined,
      instructor,
    );
    expect(graded.status).toBe("GRADED");
    expect(graded.revision).toBe(2);
    expect(graded.score).toBe(9);
  });

  it("chuyển đổi và xác thực keepAttachmentIds qua ValidationPipe đúng định dạng FormData", async () => {
    const pipe = new ValidationPipe({ transform: true, whitelist: true });
    const meta = { type: "body" as const, metatype: SubmitAssignmentDto };

    const parsedJson = (await pipe.transform(
      { content: "abc", expectedRevision: "1", keepAttachmentIds: '["att-1","att-2"]' },
      meta,
    )) as SubmitAssignmentDto;
    expect(parsedJson.keepAttachmentIds).toEqual(["att-1", "att-2"]);

    const parsedEmptyArray = (await pipe.transform(
      { content: "abc", expectedRevision: "1", keepAttachmentIds: "[]" },
      meta,
    )) as SubmitAssignmentDto;
    expect(parsedEmptyArray.keepAttachmentIds).toEqual([]);

    const parsedSingle = (await pipe.transform(
      { content: "abc", expectedRevision: "1", keepAttachmentIds: "att-only" },
      meta,
    )) as SubmitAssignmentDto;
    expect(parsedSingle.keepAttachmentIds).toEqual(["att-only"]);

    const parsedRepeated = (await pipe.transform(
      { content: "abc", expectedRevision: "1", keepAttachmentIds: ["att-1", "att-2"] },
      meta,
    )) as SubmitAssignmentDto;
    expect(parsedRepeated.keepAttachmentIds).toEqual(["att-1", "att-2"]);

    await expect(
      pipe.transform(
        { content: "abc", expectedRevision: "1", keepAttachmentIds: "[invalid-json" },
        meta,
      ),
    ).rejects.toThrow(BadRequestException);

    await expect(
      pipe.transform(
        { content: "abc", expectedRevision: "1", keepAttachmentIds: '["1","2","3","4","5","6"]' },
        meta,
      ),
    ).rejects.toThrow(BadRequestException);
  });
});
