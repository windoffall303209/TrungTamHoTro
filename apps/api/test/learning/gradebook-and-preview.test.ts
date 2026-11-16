import { Test, type TestingModule } from "@nestjs/testing";
import { createHash } from "node:crypto";
import JSZip from "jszip";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { AppModule } from "../../src/app.module.js";
import type { AuthenticatedSession } from "../../src/auth/auth.service.js";
import { PrismaService } from "../../src/database/prisma.service.js";
import { AcademicController } from "../../src/domains/learning/academic/academic.controller.js";
import { AcademicService } from "../../src/domains/learning/academic/academic.service.js";
import { AntivirusService } from "../../src/infrastructure/antivirus.service.js";
import { ObjectStorageService } from "../../src/infrastructure/object-storage.service.js";
import {
  buildDocumentPreview,
  extractLegacyDocText,
  sanitizePreviewHtml,
} from "../../src/domains/learning/operations/academic/academic-document-preview.js";

/** Tạo một tệp DOCX tối thiểu hợp lệ trong bộ nhớ để kiểm thử trình trích xuất xem trước. */
async function createMinimalDocxBuffer(paragraphText: string): Promise<Buffer> {
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
  );
  zip.file(
    "_rels/.rels",
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
  );
  zip.file(
    "word/document.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${paragraphText}</w:t></w:r></w:p></w:body></w:document>`,
  );
  return await zip.generateAsync({ type: "nodebuffer" });
}

describe("Xem trước tài liệu bài nộp (DOCX / DOC / TXT & XSS sanitize)", () => {
  it("loại bỏ thẻ script, SVG, event handler và javascript: URL khỏi HTML xem trước", () => {
    const dirty =
      '<p onclick="alert(1)">Doan van</p><script>evil()</script><a href="javascript:steal()">Bad</a><img src="https://evil.test/x.png"><img src="data:image/png;base64,iVBORw0KGgo=">';
    const clean = sanitizePreviewHtml(dirty);
    expect(clean).toContain("<p>Doan van</p>");
    expect(clean).not.toContain("<script>");
    expect(clean).not.toContain("onclick");
    expect(clean).not.toContain("javascript:");
    expect(clean).not.toContain("https://evil.test");
    expect(clean).toContain("data:image/png;base64,iVBORw0KGgo=");
  });

  it("chuyển DOCX hợp lệ thành HTML an toàn và trích xuất được TXT / DOC cũ", async () => {
    const docx = await createMinimalDocxBuffer("Bai lam tu luan cau 1 cua hoc sinh");
    const docxPreview = await buildDocumentPreview({
      buffer: docx,
      fileName: "bailam.docx",
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });
    expect(docxPreview.kind).toBe("html");
    expect(docxPreview.html).toContain("Bai lam tu luan cau 1 cua hoc sinh");

    const txtPreview = await buildDocumentPreview({
      buffer: Buffer.from("Dong 1\r\nDong 2", "utf8"),
      fileName: "note.txt",
      mimeType: "text/plain",
    });
    expect(txtPreview).toMatchObject({ kind: "text", text: "Dong 1\nDong 2" });

    // Mô phỏng tệp .doc OLE2 chứa chuỗi UTF-16LE tiếng Việt
    const header = Buffer.alloc(512);
    header.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1], 0);
    const body = Buffer.from("Noi dung bai lam Word cu 2003\u0000", "utf16le");
    const docBuffer = Buffer.concat([header, body]);
    expect(extractLegacyDocText(docBuffer)).toContain("Noi dung bai lam Word cu 2003");
    const docPreview = await buildDocumentPreview({
      buffer: docBuffer,
      fileName: "legacy.doc",
      mimeType: "application/msword",
    });
    expect(docPreview.kind).toBe("text");
    expect(docPreview.warnings.length).toBeGreaterThan(0);
  });
});

const enabled = (process.env.DB_NAME ?? "").endsWith("_test") && process.env.DATABASE_CONNECT_ON_START === "true";

describe.skipIf(!enabled)("Bảng điểm tổng hợp theo từng bài (điểm cao nhất) & Preview API (PostgreSQL)", () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let service: AcademicService;
  let controller: AcademicController;
  let instructorSession: AuthenticatedSession;
  let learnerSession: AuthenticatedSession;
  const suffix = `gb-${Date.now()}`;
  const storedFiles = new Map<string, Buffer>();
  const createdIds: { exams: string[]; assignments: string[] } = {
    exams: [],
    assignments: [],
  };

  beforeAll(async () => {
    const storage = {
      put: vi.fn((objectKey: string, buffer: Buffer) => {
        storedFiles.set(objectKey, buffer);
        return Promise.resolve({
          objectKey,
          checksum: `sha256:${createHash("sha256").update(buffer).digest("hex")}`,
        });
      }),
      get: vi.fn((objectKey: string) => Promise.resolve(storedFiles.get(objectKey) ?? Buffer.alloc(0))),
      remove: vi.fn((objectKey: string) => {
        storedFiles.delete(objectKey);
        return Promise.resolve();
      }),
    };
    moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ObjectStorageService)
      .useValue(storage)
      .overrideProvider(AntivirusService)
      .useValue({ scan: vi.fn(() => Promise.resolve({ clean: true, engine: "disabled" })) })
      .compile();
    prisma = moduleRef.get(PrismaService);
    service = moduleRef.get(AcademicService);
    controller = moduleRef.get(AcademicController);
    const instructor = await prisma.user.findUniqueOrThrow({ where: { id: "usr-instructor" } });
    const learner = await prisma.user.findUniqueOrThrow({ where: { id: "usr-learner" } });
    instructorSession = {
      sessionId: "test-inst",
      roleCode: "INSTRUCTOR",
      permissions: ["exam:manage", "class:view"],
      availableRoles: [{ code: "INSTRUCTOR", name: "Giảng viên" }],
      user: {
        id: instructor.id,
        username: instructor.username,
        name: instructor.displayName,
        email: instructor.email,
        roleName: "Giảng viên",
      },
    };
    learnerSession = {
      sessionId: "test-lrn",
      roleCode: "LEARNER",
      permissions: ["exam:view", "class:view"],
      availableRoles: [{ code: "LEARNER", name: "Học viên" }],
      user: {
        id: learner.id,
        username: learner.username,
        name: learner.displayName,
        email: learner.email,
        roleName: "Học viên",
      },
    };
  });

  afterAll(async () => {
    if (!moduleRef) return;
    if (createdIds.exams.length) {
      await prisma.examAttempt.deleteMany({ where: { examId: { in: createdIds.exams } } });
      await prisma.exam.deleteMany({ where: { id: { in: createdIds.exams } } });
    }
    if (createdIds.assignments.length) {
      await prisma.assignment.deleteMany({ where: { id: { in: createdIds.assignments } } });
    }
    await moduleRef.close();
  });

  it("chọn điểm cao nhất qua nhiều lần làm bài thi và trả về danh sách cột bài chi tiết", async () => {
    const examId = `exam-${suffix}`;
    createdIds.exams.push(examId);
    const openAt = new Date(Date.now() - 86_400_000);
    const closeAt = new Date(Date.now() + 86_400_000);
    await prisma.exam.create({
      data: {
        id: examId,
        classId: "class-web-01",
        title: `Đề nhiều lượt ${suffix}`,
        totalScore: 10,
        durationMinutes: 15,
        attemptLimit: 3,
        openAt,
        closeAt,
        status: "PUBLISHED",
      },
    });
    await prisma.examAttempt.createMany({
      data: [
        {
          id: `att-1-${suffix}`,
          examId,
          learnerId: learnerSession.user.id,
          attemptNo: 1,
          status: "GRADED",
          score: 5.0,
          startedAt: new Date(Date.now() - 3600_000),
          submittedAt: new Date(Date.now() - 3500_000),
        },
        {
          id: `att-2-${suffix}`,
          examId,
          learnerId: learnerSession.user.id,
          attemptNo: 2,
          status: "GRADED",
          score: 9.5,
          startedAt: new Date(Date.now() - 2600_000),
          submittedAt: new Date(Date.now() - 2500_000),
        },
        {
          id: `att-3-${suffix}`,
          examId,
          learnerId: learnerSession.user.id,
          attemptNo: 3,
          status: "GRADED",
          score: 6.25,
          startedAt: new Date(Date.now() - 1600_000),
          submittedAt: new Date(Date.now() - 1500_000),
        },
      ],
    });

    const rows = await service.gradebook("class-web-01", instructorSession);
    const row = rows.find((item) => item.learnerId === learnerSession.user.id);
    expect(row).toBeDefined();
    expect(row?.assessments?.some((col) => col.id === examId)).toBe(true);
    const cell = row?.cells?.find((item) => item.assessmentId === examId);
    expect(cell).toMatchObject({
      assessmentId: examId,
      kind: "EXAM",
      score: 9.5,
      maxScore: 10,
      status: "GRADED",
      attemptCount: 3,
    });
  });

  it("hỗ trợ endpoint xem trước DOCX đính kèm bài nộp sau khi kiểm tra quyền", async () => {
    const assignment = await service.createAssignment(
      "class-web-01",
      {
        title: `Tự luận preview ${suffix}`,
        description: "Kiểm tra preview DOCX",
        instructions: "Câu 1: Phân tích đề\nCâu 2: Viết kết luận",
        dueAt: new Date(Date.now() + 86_400_000).toISOString(),
        maxScore: 10,
        rubric: [{ title: "Nội dung", description: "Đầy đủ", maxPoints: 10 }],
      },
      instructorSession,
    );
    createdIds.assignments.push(assignment.id);
    const docxBuffer = await createMinimalDocxBuffer("Tra loi cau 1 va cau 2");
    const submitted = await service.submitAssignment(
      assignment.id,
      "Noi dung kem file docx",
      learnerSession,
      [
        {
          originalName: "baitap.docx",
          mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          size: docxBuffer.length,
          buffer: docxBuffer,
        },
      ],
    );
    expect(submitted.attachments[0]?.canPreview).toBe(true);
    const preview = await controller.previewAttachmentContent(
      submitted.id,
      submitted.attachments[0]!.id,
      instructorSession,
    );
    expect(preview.kind).toBe("html");
    expect(preview.html).toContain("Tra loi cau 1 va cau 2");
  });
});
