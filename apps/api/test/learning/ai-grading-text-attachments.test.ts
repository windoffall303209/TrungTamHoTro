import { createHash } from "node:crypto";
import { testGradingStore } from "./ai-grading-store.fixture.js";
import { extractionDatabase } from "./ai-document-extraction.fixture.js";
import { describe, expect, it, vi } from "vitest";
import { AcademicService } from "../../src/domains/learning/academic/academic.service.js";
import { AiGradingAssistService } from "../../src/domains/learning/ai/ai-grading-assist.service.js";
import type { AuthenticatedSession } from "../../src/auth/auth.service.js";
import type { PrismaService } from "../../src/database/prisma.service.js";
import type { ObjectStorageService } from "../../src/infrastructure/object-storage.service.js";
import type { AntivirusService } from "../../src/infrastructure/antivirus.service.js";
import type { AiProviderService } from "../../src/domains/system/ai/ai-provider.service.js";
import { GRADING_DOCX_MIME } from "../../src/domains/learning/ai/ai-grading-source.js";
import { docxFixture } from "./docx.fixture.js";

const session = { user: { id: "teacher" }, roleCode: "INSTRUCTOR", permissions: ["exam:manage"] } as AuthenticatedSession;
type Attachment = { id: string; objectKey: string; originalName: string; mimeType: string; sizeBytes: bigint; checksum: string };
type Row = { id: string; content: string; revision: number; learnerId: string; attachments: Attachment[]; assignment: { classId: string; version: number; title: string; description: string; instructions: string; rubric: Array<{ id: string; title: string; description: string; maxPoints: number }> } };

/** Dựng bài TXT với checksum thật và chạy service quyền/đọc nguồn thật qua biên kho dữ liệu giả lập. */
function fixture(): {
  row: Row; files: Map<string, Buffer>; academic: AcademicService; service: AiGradingAssistService;
  prisma: {
    assignmentSubmission: { findUnique: ReturnType<typeof vi.fn> };
    assignmentSubmissionAttachment: { findFirst: ReturnType<typeof vi.fn> };
    learningClass: { findFirst: ReturnType<typeof vi.fn> };
  };
  storage: { get: ReturnType<typeof vi.fn<(...args: string[]) => Promise<Buffer>>> };
  ai: { resolveTask: ReturnType<typeof vi.fn>; suggestGrading: ReturnType<typeof vi.fn<(...args: unknown[]) => Promise<unknown>>> };
} {
  const files = new Map([["file1", Buffer.from("HTTP is an application-layer protocol.")], ["file2", Buffer.from("Clients send requests to servers.")]]);
  const row: Row = { id: "submission", content: "My answer follows.", revision: 2, learnerId: "private-learner", attachments: [...files].map(([id, buffer]) => ({ id, objectKey: id, originalName: `${id}.txt`, mimeType: "text/plain", sizeBytes: BigInt(buffer.length), checksum: `sha256:${createHash("sha256").update(buffer).digest("hex")}` })), assignment: { classId: "class", version: 3, title: "Explain HTTP", description: "Networking assignment", instructions: "Describe its layer and communication.", rubric: [{ id: "r1", title: "Accuracy", description: "Correct layer", maxPoints: 5 }] } };
  const prisma = {
    assignmentSubmission: { findUnique: vi.fn().mockImplementation(() => Promise.resolve(structuredClone(row))) },
    assignmentSubmissionAttachment: { findFirst: vi.fn().mockImplementation(({ where }: { where: { id: string } }) => { const file = row.attachments.find((item) => item.id === where.id); return Promise.resolve(file ? structuredClone({ ...file, submission: row }) : null); }) },
    learningClass: { findFirst: vi.fn().mockResolvedValue({ status: "ACTIVE" }) },
  };
  const storage = { get: vi.fn<(...args: string[]) => Promise<Buffer>>().mockImplementation((key) => Promise.resolve(files.get(key)!)) };
  const academic = new AcademicService(prisma as unknown as PrismaService, storage as unknown as ObjectStorageService, {} as AntivirusService);
  const ai = { resolveTask: vi.fn().mockResolvedValue({}), suggestGrading: vi.fn<(...args: unknown[]) => Promise<unknown>>().mockResolvedValue({ insufficientEvidence: false, feedback: "Correct explanation", suggestedTotal: 5, requiresHumanReview: true, model: "configured", criteria: [{ criterionId: "r1", suggestedPoints: 5, reasoning: "Correct layer", evidence: [files.get("file1")!.toString()] }] }) };
  return { row, files, prisma, storage, academic, ai, service: new AiGradingAssistService(academic, ai as unknown as AiProviderService, testGradingStore()) };
}

describe("TXT attachment grading context", () => {
  it("grades DOCX locally and replays without a document-extraction provider call", async () => {
    const { row, files, service, ai } = fixture();
    const extracted = "DOCX answer explains HTTP requests and responses.";
    const docx = await docxFixture(`<w:p><w:r><w:t>${extracted}</w:t></w:r></w:p>`);
    files.set("file1", docx);
    Object.assign(row.attachments[0]!, { originalName: "answer.docx", mimeType: GRADING_DOCX_MIME, sizeBytes: BigInt(docx.length), checksum: `sha256:${createHash("sha256").update(docx).digest("hex")}` });
    ai.suggestGrading.mockResolvedValue({ insufficientEvidence: false, feedback: "Correct DOCX answer", suggestedTotal: 5, requiresHumanReview: true, model: "configured", criteria: [{ criterionId: "r1", suggestedPoints: 5, reasoning: "Correct explanation", evidence: [extracted] }] });
    expect(await service.inspect("submission", 2, "VI", session)).toEqual({ state: "NOT_REQUESTED" });
    const saved = await service.suggest("submission", 2, "VI", session);
    expect(saved.sources?.[1]?.name).toBe("answer.docx");
    expect(saved.sources?.[1]?.text).toContain("DOCX answer explains HTTP");
    expect(await service.suggest("submission", 2, "VI", session)).toEqual(saved);
    expect(ai.resolveTask).toHaveBeenCalledTimes(1);
    expect(ai.suggestGrading).toHaveBeenCalledTimes(1);
  });

  it("grades mixed PDF/TXT work with durable OCR and inspects without another paid call", async () => {
    const { row, academic, ai, files } = fixture();
    row.attachments[0]!.originalName = "answer.pdf";
    row.attachments[0]!.mimeType = "application/pdf";
    const extractDocumentPages = vi.fn().mockResolvedValue([{ page: 1, text: files.get("file1")!.toString() }]);
    const provider = { ...ai, extractDocumentPages };
    const { prisma } = extractionDatabase();
    const store = testGradingStore();
    const service = new AiGradingAssistService(academic, provider as unknown as AiProviderService, store, prisma);
    await expect(service.inspect("submission", 2, "VI", session)).resolves.toEqual({ state: "NOT_REQUESTED" });
    expect(extractDocumentPages).not.toHaveBeenCalled();
    const saved = await service.suggest("submission", 2, "VI", session);
    expect(saved.sources?.map((source) => source.attachmentId)).toEqual([null, "file1", "file2"]);
    ai.resolveTask.mockRejectedValue(new Error("disabled provider"));
    const restarted = new AiGradingAssistService(academic, provider as unknown as AiProviderService, store, prisma);
    expect((await restarted.inspect("submission", 2, "VI", session)).result?.sources).toEqual(saved.sources);
    expect(await restarted.suggest("submission", 2, "VI", session)).toEqual(saved);
    expect(extractDocumentPages).toHaveBeenCalledTimes(1);
    expect(ai.suggestGrading).toHaveBeenCalledTimes(1);
  });

  it.each(["empty rubric", "duplicate rubric", "invalid language"])("rejects %s before OCR configuration, source download or claims", async (change) => {
    const { row, academic, ai, storage } = fixture();
    row.attachments[0]!.originalName = "answer.pdf";
    row.attachments[0]!.mimeType = "application/pdf";
    if (change === "empty rubric") row.assignment.rubric = [];
    if (change === "duplicate rubric") row.assignment.rubric.push({ ...row.assignment.rubric[0]! });
    const { prisma, rows } = extractionDatabase();
    const service = new AiGradingAssistService(academic, ai as unknown as AiProviderService, testGradingStore(), prisma);
    await expect(service.suggest("submission", 2, change === "invalid language" ? "INVALID" as "VI" : "VI", session)).rejects.toMatchObject({ status: 400 });
    expect(storage.get).not.toHaveBeenCalled();
    expect(ai.resolveTask).not.toHaveBeenCalled();
    expect(ai.suggestGrading).not.toHaveBeenCalled();
    expect(rows.size).toBe(0);
  });

  it("combines verified PDF extraction with every TXT and inline source", async () => {
    const { row, academic, files } = fixture();
    row.attachments[0]!.originalName = "answer.pdf";
    row.attachments[0]!.mimeType = "application/pdf";
    const read = vi.fn().mockResolvedValue("Extracted PDF answer");
    const context = await academic.gradingAiContext("submission", 2, session, read);
    expect(read).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ attachmentId: "file1", fileName: "answer.pdf", mimeType: "application/pdf", checksum: row.attachments[0]!.checksum, submissionRevision: 2, buffer: files.get("file1") }));
    expect(context.sources?.map((source) => source.text)).toEqual([row.content, "Extracted PDF answer", files.get("file2")!.toString()]);
    expect(context.answer).toBe(context.sources?.map((source) => source.text).join("\n\n"));
  });

  it.each(["wrong extension", "oversize", "corrupt bytes"])("rejects %s before invoking the document reader", async (change) => {
    const { row, academic, files } = fixture();
    row.attachments[0]!.originalName = change === "wrong extension" ? "answer.docx" : "answer.pdf";
    row.attachments[0]!.mimeType = "application/pdf";
    if (change === "oversize") row.attachments[0]!.sizeBytes = 12n * 1024n * 1024n + 1n;
    if (change === "corrupt bytes") files.set("file1", Buffer.from("corrupt"));
    const read = vi.fn();
    await expect(academic.gradingAiContext("submission", 2, session, read)).rejects.toThrow();
    expect(read).not.toHaveBeenCalled();
  });

  it.each(["", "x".repeat(20001), "bad\u0000text"])("rejects unusable extracted text %# without discarding it", async (text) => {
    const { row, academic } = fixture();
    row.attachments[0]!.originalName = "answer.png";
    row.attachments[0]!.mimeType = "image/png";
    await expect(academic.gradingAiContext("submission", 2, session, vi.fn().mockResolvedValue(text))).rejects.toMatchObject({ status: 400 });
  });

  it("rechecks source revision after the document reader returns", async () => {
    const { row, academic } = fixture();
    row.attachments[0]!.originalName = "answer.pdf";
    row.attachments[0]!.mimeType = "application/pdf";
    const read = vi.fn().mockImplementation(() => { row.revision++; return Promise.resolve("Extracted text"); });
    await expect(academic.gradingAiContext("submission", 2, session, read)).rejects.toMatchObject({ status: 409 });
  });

  it("includes all files and inline work, persists verified source snapshots and replays without AI", async () => {
    const { service, ai, row, files } = fixture();
    const saved = await service.suggest("submission", 2, "EN", session);
    expect(saved.sources?.map((source) => source.attachmentId)).toEqual([null, "file1", "file2"]);
    expect(ai.suggestGrading).toHaveBeenCalledExactlyOnceWith({ instructions: [row.assignment.title, row.assignment.description, row.assignment.instructions].join("\n\n"), answer: [row.content, ...files.values()].map(String).join("\n\n"), rubric: row.assignment.rubric, language: "EN" });
    expect((await service.inspect("submission", 2, "EN", session)).result?.sources).toEqual(saved.sources);
    expect(await service.suggest("submission", 2, "EN", session)).toEqual(saved);
    expect(ai.suggestGrading).toHaveBeenCalledTimes(1);
  });

  it("supports attachment-only submissions without pretending inline text exists", async () => {
    const { row, service } = fixture(); row.content = "";
    expect((await service.suggest("submission", 2, "VI", session)).sources).toHaveLength(2);
  });

  it.each(["mixed format", "over limit", "invalid utf8", "corrupt object"])("rejects %s before the grading provider", async (change) => {
    const { row, files, storage, service, ai } = fixture();
    if (change === "mixed format") row.attachments[1]!.mimeType = "application/pdf";
    if (change === "over limit") row.attachments[1]!.sizeBytes = 80001n;
    if (change === "invalid utf8") { const buffer = Buffer.from([0xc3, 0x28]); files.set("file2", buffer); row.attachments[1]!.sizeBytes = BigInt(buffer.length); row.attachments[1]!.checksum = `sha256:${createHash("sha256").update(buffer).digest("hex")}`; }
    if (change === "corrupt object") files.set("file2", Buffer.from("tampered"));
    await expect(service.suggest("submission", 2, "VI", session)).rejects.toThrow();
    expect(ai.suggestGrading).not.toHaveBeenCalled();
    if (["mixed format", "over limit"].includes(change)) expect(storage.get).not.toHaveBeenCalled();
  });

  it("rejects quotes stitched across different sources and does not retry the paid call", async () => {
    const { service, ai, row, files } = fixture();
    ai.suggestGrading.mockResolvedValue({ criteria: [{ evidence: [`${row.content}\n\n${files.get("file1")!.toString()}`] }] });
    await expect(service.suggest("submission", 2, "VI", session)).rejects.toMatchObject({ status: 503 });
    expect((await service.inspect("submission", 2, "VI", session)).state).toBe("UNCERTAIN");
    await expect(service.suggest("submission", 2, "VI", session)).rejects.toMatchObject({ status: 409 });
    expect(ai.suggestGrading).toHaveBeenCalledTimes(1);
  });

  it("checks the aggregate limit before generation instead of discarding a file", async () => {
    const { row, service, ai } = fixture(); row.content = "x".repeat(20000);
    await expect(service.suggest("submission", 2, "VI", session)).rejects.toThrow("không tự cắt");
    expect(ai.suggestGrading).not.toHaveBeenCalled();
  });

  it("rejects metadata changes to an earlier file while reading a later file", async () => {
    const { row, files, storage, service, ai } = fixture();
    storage.get.mockImplementation((key) => {
      if (key === "file2") row.attachments[0]!.originalName = "renamed.txt";
      return Promise.resolve(files.get(key)!);
    });
    await expect(service.suggest("submission", 2, "VI", session)).rejects.toMatchObject({ status: 409 });
    expect(ai.suggestGrading).not.toHaveBeenCalled();
  });

  it("inspects TXT, DOCX and mixed PDF/TXT submissions via metadata/cache with zero object storage reads and downloads once during suggest", async () => {
    const { row, files, storage, academic, ai } = fixture();
    row.attachments[0]!.originalName = "answer.pdf";
    row.attachments[0]!.mimeType = "application/pdf";
    const extractDocumentPages = vi.fn().mockResolvedValue([{ page: 1, text: files.get("file1")!.toString() }]);
    const provider = { ...ai, extractDocumentPages };
    const { prisma: extractionPrisma } = extractionDatabase();
    const store = testGradingStore();
    const service = new AiGradingAssistService(academic, provider as unknown as AiProviderService, store, extractionPrisma);

    expect(await service.inspect("submission", 2, "VI", session)).toEqual({ state: "NOT_REQUESTED" });
    expect(storage.get).toHaveBeenCalledTimes(0);

    const saved = await service.suggest("submission", 2, "VI", session);
    // Mỗi tệp đính kèm chỉ tải đúng một lần trong suggest; hậu kiểm chỉ đối chiếu metadata DB.
    expect(storage.get).toHaveBeenCalledTimes(2);

    storage.get.mockClear();
    const restarted = new AiGradingAssistService(academic, provider as unknown as AiProviderService, store, extractionPrisma);
    const inspected = await restarted.inspect("submission", 2, "VI", session);
    expect(inspected.state).toBe("READY");
    expect(inspected.suggestionId).toBe(saved.suggestionId);
    expect(inspected.result?.contextHash).toBe(saved.contextHash);
    expect(inspected.result?.sources).toEqual(saved.sources);
    expect(storage.get).toHaveBeenCalledTimes(0);

    // Đổi version bài tập hoặc checksum tệp khiến bản ghi READY cũ không còn khớp, vẫn 0 lần đọc object storage.
    row.assignment.version += 1;
    expect(await restarted.inspect("submission", 2, "VI", session)).toEqual({ state: "NOT_REQUESTED" });
    expect(storage.get).toHaveBeenCalledTimes(0);

    row.assignment.version -= 1;
    row.attachments[1]!.checksum = `sha256:${"a".repeat(64)}`;
    expect(await restarted.inspect("submission", 2, "VI", session)).toEqual({ state: "NOT_REQUESTED" });
    expect(storage.get).toHaveBeenCalledTimes(0);
  });

  it.each(["permission", "closed", "rubric", "checksum"])("rejects attachment inspect when %s changes mid-lookup without touching object storage", async (change) => {
    const { row, prisma, storage, academic, ai } = fixture();
    const store = testGradingStore();
    const service = new AiGradingAssistService(academic, ai as unknown as AiProviderService, store);
    await service.suggest("submission", 2, "VI", session);
    storage.get.mockClear();

    const originalList = store.listForSubmission.bind(store);
    vi.spyOn(store, "listForSubmission").mockImplementationOnce(async (ownerId, submissionId, language) => {
      const rows = await originalList(ownerId, submissionId, language);
      if (change === "permission") prisma.learningClass.findFirst.mockResolvedValue(null);
      if (change === "closed") prisma.learningClass.findFirst.mockResolvedValue({ status: "CLOSED" });
      if (change === "rubric") row.assignment.rubric[0]!.maxPoints = 3;
      if (change === "checksum") row.attachments[0]!.checksum = `sha256:${"b".repeat(64)}`;
      return rows;
    });

    await expect(service.inspect("submission", 2, "VI", session)).rejects.toMatchObject({ status: change === "permission" ? 404 : 409 });
    expect(storage.get).toHaveBeenCalledTimes(0);
  });

  it("inspects PDF-only UNCERTAIN suggestion from OCR cache with zero storage reads and TXT UNCERTAIN with single download", async () => {
    const { row, files, storage, academic, ai } = fixture();
    row.attachments = [row.attachments[0]!];
    row.attachments[0]!.originalName = "answer.pdf";
    row.attachments[0]!.mimeType = "application/pdf";
    const extractDocumentPages = vi.fn().mockResolvedValue([{ page: 1, text: files.get("file1")!.toString() }]);
    const provider = {
      ...ai,
      extractDocumentPages,
      suggestGrading: vi.fn().mockRejectedValue(new Error("provider timeout")),
    };
    const { prisma: extractionPrisma } = extractionDatabase();
    const store = testGradingStore();
    const pdfService = new AiGradingAssistService(academic, provider as unknown as AiProviderService, store, extractionPrisma);

    await expect(pdfService.suggest("submission", 2, "VI", session)).rejects.toThrow("provider timeout");
    expect(storage.get).toHaveBeenCalledTimes(1);

    storage.get.mockClear();
    expect((await pdfService.inspect("submission", 2, "VI", session)).state).toBe("UNCERTAIN");
    expect(storage.get).toHaveBeenCalledTimes(0);

    // Trường hợp tệp TXT đang ở UNCERTAIN: chỉ đọc mỗi tệp đúng một lần, không đọc hai lần như trước.
    const txtFixture = fixture();
    txtFixture.ai.suggestGrading.mockRejectedValueOnce(new Error("provider timeout"));
    await expect(txtFixture.service.suggest("submission", 2, "VI", session)).rejects.toThrow("provider timeout");
    txtFixture.storage.get.mockClear();
    expect((await txtFixture.service.inspect("submission", 2, "VI", session)).state).toBe("UNCERTAIN");
    expect(txtFixture.storage.get).toHaveBeenCalledTimes(2);
  });

  it("rejects attachment metadata change during suggest without a second object storage download", async () => {
    const { row, storage, service, ai } = fixture();
    ai.suggestGrading.mockImplementationOnce(() => {
      row.attachments[0]!.originalName = "replaced.txt";
      return Promise.resolve({ insufficientEvidence: false, feedback: "Ok", suggestedTotal: 5, requiresHumanReview: true, model: "configured", criteria: [] });
    });
    await expect(service.suggest("submission", 2, "VI", session)).rejects.toMatchObject({ status: 409 });
    expect(storage.get).toHaveBeenCalledTimes(2);
  });
});
