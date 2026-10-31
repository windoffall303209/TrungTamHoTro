import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { AcademicService } from "../../src/domains/learning/academic/academic.service.js";
import type { AuthenticatedSession } from "../../src/auth/auth.service.js";
import type { PrismaService } from "../../src/database/prisma.service.js";
import type { ObjectStorageService } from "../../src/infrastructure/object-storage.service.js";
import type { AntivirusService } from "../../src/infrastructure/antivirus.service.js";

const teacher = { user: { id: "teacher" }, roleCode: "INSTRUCTOR", permissions: ["exam:manage"] } as AuthenticatedSession;
const learner = { user: { id: "learner" }, roleCode: "LEARNER", permissions: ["exam:view"] } as AuthenticatedSession;
const bytes = Buffer.from("Evidence from the submission.");

/** Dựng metadata nguồn và kho bytes; permission service chạy thật trên phân công được mock. */
function fixture(): {
  row: { id: string; objectKey: string; originalName: string; mimeType: string; checksum: string; sizeBytes: bigint; submission: { revision: number; learnerId: string; assignment: { classId: string; version: number } } };
  prisma: { assignmentSubmissionAttachment: { findFirst: ReturnType<typeof vi.fn> }; classInstructor: { findMany: ReturnType<typeof vi.fn> } };
  storage: { get: ReturnType<typeof vi.fn<(...args: unknown[]) => Promise<Buffer>>> };
  service: AcademicService;
} {
  const row = { id: "file", objectKey: "private/file", originalName: "answer.txt", mimeType: "text/plain", checksum: `sha256:${createHash("sha256").update(bytes).digest("hex")}`, sizeBytes: BigInt(bytes.length), submission: { revision: 2, learnerId: "learner", assignment: { classId: "class", version: 3 } } };
  const prisma = { assignmentSubmissionAttachment: { findFirst: vi.fn().mockImplementation(() => Promise.resolve(structuredClone(row))) }, classInstructor: { findMany: vi.fn().mockResolvedValue([{ classId: "class" }]) } };
  const storage = { get: vi.fn<(...args: unknown[]) => Promise<Buffer>>().mockResolvedValue(bytes) };
  return { row, prisma, storage, service: new AcademicService(prisma as unknown as PrismaService, storage as unknown as ObjectStorageService, {} as AntivirusService) };
}

describe("verified submission attachment reads", () => {
  it.each([teacher, learner])("returns matching bytes and revision to an authorized %j", async (session) => {
    const { service, prisma, row } = fixture();
    expect(await service.readSubmissionAttachment("submission", "file", session, 2)).toEqual({ buffer: bytes, fileName: "answer.txt", mimeType: "text/plain", checksum: row.checksum, submissionRevision: 2 });
    expect(prisma.assignmentSubmissionAttachment.findFirst).toHaveBeenCalledTimes(2);
    expect(prisma.assignmentSubmissionAttachment.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "file", submissionId: "submission", removedAt: null } }));
  });

  it("rejects missing files, other learners, unassigned teachers and stale revisions before storage", async () => {
    const { service, prisma, storage } = fixture();
    prisma.assignmentSubmissionAttachment.findFirst.mockResolvedValueOnce(null);
    await expect(service.readSubmissionAttachment("submission", "file", teacher)).rejects.toMatchObject({ status: 404 });
    await expect(service.readSubmissionAttachment("submission", "file", { ...learner, user: { ...learner.user, id: "other" } })).rejects.toMatchObject({ status: 404 });
    prisma.classInstructor.findMany.mockResolvedValueOnce([]);
    await expect(service.readSubmissionAttachment("submission", "file", teacher)).rejects.toMatchObject({ status: 404 });
    await expect(service.readSubmissionAttachment("submission", "file", teacher, 1)).rejects.toMatchObject({ status: 409 });
    await expect(service.readSubmissionAttachment("submission", "file", teacher, 0)).rejects.toMatchObject({ status: 400 });
    expect(storage.get).not.toHaveBeenCalled();
  });

  it.each(["bytes", "size", "missing checksum"])("fails closed for a corrupt %s", async (change) => {
    const { service, row, storage } = fixture();
    if (change === "bytes") storage.get.mockResolvedValue(Buffer.alloc(bytes.length));
    if (change === "size") row.sizeBytes++;
    if (change === "missing checksum") row.checksum = "";
    await expect(service.readSubmissionAttachment("submission", "file", teacher)).rejects.toMatchObject({ status: 409 });
  });

  it.each(["revision", "removed", "checksum", "object", "mime", "name", "assignment", "permission", "owner"])("withholds bytes after %s changes during download", async (change) => {
    const { service, row, storage, prisma } = fixture();
    storage.get.mockImplementationOnce(() => {
      if (change === "revision") row.submission.revision++;
      if (change === "removed") prisma.assignmentSubmissionAttachment.findFirst.mockResolvedValueOnce(null);
      if (change === "checksum") row.checksum = "changed";
      if (change === "object") row.objectKey = "different";
      if (change === "mime") row.mimeType = "application/pdf";
      if (change === "name") row.originalName = "changed.txt";
      if (change === "assignment") row.submission.assignment.version++;
      if (change === "permission") prisma.classInstructor.findMany.mockResolvedValueOnce([]);
      if (change === "owner") row.submission.learnerId = "other";
      return Promise.resolve(bytes);
    });
    await expect(service.readSubmissionAttachment("submission", "file", change === "owner" ? learner : teacher)).rejects.toMatchObject({ status: ["removed", "permission", "owner"].includes(change) ? 404 : 409 });
  });
});
