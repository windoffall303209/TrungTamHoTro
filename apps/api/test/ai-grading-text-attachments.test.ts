import { createHash } from "node:crypto";
import { testGradingStore } from "./ai-grading-store.fixture.js";
import { describe, expect, it, vi } from "vitest";
import { AcademicService } from "../src/learning/academic.service.js";
import { AiGradingAssistService } from "../src/learning/ai-grading-assist.service.js";
import type { AuthenticatedSession } from "../src/auth/auth.service.js";
import type { PrismaService } from "../src/database/prisma.service.js";
import type { ObjectStorageService } from "../src/infrastructure/object-storage.service.js";
import type { AntivirusService } from "../src/infrastructure/antivirus.service.js";
import type { AiProviderService } from "../src/system/ai-provider.service.js";

const session = { user: { id: "teacher" }, roleCode: "INSTRUCTOR", permissions: ["exam:manage"] } as AuthenticatedSession;
type Attachment = { id: string; objectKey: string; originalName: string; mimeType: string; sizeBytes: bigint; checksum: string };
type Row = { id: string; content: string; revision: number; learnerId: string; attachments: Attachment[]; assignment: { classId: string; version: number; title: string; description: string; instructions: string; rubric: Array<{ id: string; title: string; description: string; maxPoints: number }> } };

/** Dựng bài TXT với checksum thật và chạy service quyền/đọc nguồn thật qua biên kho dữ liệu giả lập. */
function fixture(): {
  row: Row; files: Map<string, Buffer>; academic: AcademicService; service: AiGradingAssistService;
  storage: { get: ReturnType<typeof vi.fn<(...args: string[]) => Promise<Buffer>>> };
  ai: { resolveTask: ReturnType<typeof vi.fn>; suggestGrading: ReturnType<typeof vi.fn> };
} {
  const files = new Map([["file1", Buffer.from("HTTP is an application-layer protocol.")], ["file2", Buffer.from("Clients send requests to servers.")]]);
  const row: Row = { id: "submission", content: "My answer follows.", revision: 2, learnerId: "private-learner", attachments: [...files].map(([id, buffer]) => ({ id, objectKey: id, originalName: `${id}.txt`, mimeType: "text/plain", sizeBytes: BigInt(buffer.length), checksum: `sha256:${createHash("sha256").update(buffer).digest("hex")}` })), assignment: { classId: "class", version: 3, title: "Explain HTTP", description: "Networking assignment", instructions: "Describe its layer and communication.", rubric: [{ id: "r1", title: "Accuracy", description: "Correct layer", maxPoints: 5 }] } };
  const prisma = {
    assignmentSubmission: { findUnique: vi.fn().mockImplementation(() => Promise.resolve(structuredClone(row))) },
    assignmentSubmissionAttachment: { findFirst: vi.fn().mockImplementation(({ where }: { where: { id: string } }) => { const file = row.attachments.find((item) => item.id === where.id); return Promise.resolve(file ? structuredClone({ ...file, submission: row }) : null); }) },
    classInstructor: { findMany: vi.fn().mockResolvedValue([{ classId: "class" }]) }, learningClass: { findUnique: vi.fn().mockResolvedValue({ status: "ACTIVE" }) },
  };
  const storage = { get: vi.fn<(...args: string[]) => Promise<Buffer>>().mockImplementation((key) => Promise.resolve(files.get(key)!)) };
  const academic = new AcademicService(prisma as unknown as PrismaService, storage as unknown as ObjectStorageService, {} as AntivirusService);
  const ai = { resolveTask: vi.fn().mockResolvedValue({}), suggestGrading: vi.fn().mockResolvedValue({ insufficientEvidence: false, feedback: "Correct explanation", suggestedTotal: 5, requiresHumanReview: true, model: "configured", criteria: [{ criterionId: "r1", suggestedPoints: 5, reasoning: "Correct layer", evidence: [files.get("file1")!.toString()] }] }) };
  return { row, files, storage, academic, ai, service: new AiGradingAssistService(academic, ai as unknown as AiProviderService, testGradingStore()) };
}

describe("TXT attachment grading context", () => {
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
});
