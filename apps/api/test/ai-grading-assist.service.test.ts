import { describe, expect, it, vi } from "vitest";
import { AcademicService } from "../src/learning/academic.service.js";
import { AiGradingAssistService } from "../src/learning/ai-grading-assist.service.js";
import type { PrismaService } from "../src/database/prisma.service.js";
import type { ObjectStorageService } from "../src/infrastructure/object-storage.service.js";
import type { AntivirusService } from "../src/infrastructure/antivirus.service.js";
import type { AiProviderService } from "../src/system/ai-provider.service.js";
import type { AuthenticatedSession } from "../src/auth/auth.service.js";

const session = { roleCode: "INSTRUCTOR", permissions: ["exam:manage"], user: { id: "teacher" } } as AuthenticatedSession;

/** Dựng biên database để chạy kiểm tra phân công/lớp đóng thật của AcademicService, không mock bỏ quyền. */
function fixture(): {
  row: { id: string; content: string; revision: number; learnerId: string; score: number; attachments: Array<{ id: string }>; assignment: { classId: string; version: number; title: string; description: string; instructions: string; rubric: Array<{ id: string; title: string; description: string; maxPoints: number }> } };
  prisma: { assignmentSubmission: { findUnique: ReturnType<typeof vi.fn> }; classInstructor: { findMany: ReturnType<typeof vi.fn> }; learningClass: { findUnique: ReturnType<typeof vi.fn> } };
  academic: AcademicService; ai: { resolveTask: ReturnType<typeof vi.fn>; suggestGrading: ReturnType<typeof vi.fn<(...args: unknown[]) => Promise<unknown>>> }; service: AiGradingAssistService;
} {
  const row = { id: "submission", content: "HTTP is an application-layer protocol.", revision: 2, learnerId: "private-learner", score: 4, attachments: [] as Array<{ id: string }>, assignment: { classId: "class", version: 3, title: "HTTP assignment", description: "Explain the protocol.", instructions: "Name the correct network layer.", rubric: [{ id: "r1", title: "Accuracy", description: "Correct layer", maxPoints: 5 }] } };
  const prisma = { assignmentSubmission: { findUnique: vi.fn().mockImplementation(() => Promise.resolve(structuredClone(row))) }, classInstructor: { findMany: vi.fn().mockResolvedValue([{ classId: "class" }]) }, learningClass: { findUnique: vi.fn().mockResolvedValue({ status: "ACTIVE" }) } };
  const academic = new AcademicService(prisma as unknown as PrismaService, {} as ObjectStorageService, {} as AntivirusService);
  const ai = { resolveTask: vi.fn().mockResolvedValue({ providerId: "provider", model: "configured-model" }), suggestGrading: vi.fn<(...args: unknown[]) => Promise<unknown>>().mockResolvedValue({ insufficientEvidence: false, feedback: "Review this suggestion", criteria: [], suggestedTotal: 4, requiresHumanReview: true, model: "configured-model" }) };
  return { row, prisma, academic, ai, service: new AiGradingAssistService(academic, ai as unknown as AiProviderService) };
}

describe("authorized AI grading context", () => {
  it("does not reserve a claim for missing configuration or invalid input", async () => {
    const { service, ai, row } = fixture();
    ai.resolveTask.mockRejectedValueOnce(new Error("missing model"));
    await expect(service.suggest("submission", 2, "VI", session)).rejects.toThrow("missing model");
    expect(await service.inspect("submission", 2, "VI", session)).toEqual({ state: "NOT_REQUESTED" });
    row.assignment.rubric = [];
    await expect(service.suggest("submission", 2, "VI", session)).rejects.toMatchObject({ status: 400 });
    expect(ai.suggestGrading).not.toHaveBeenCalled();
    row.assignment.rubric = [{ id: "r1", title: "Accuracy", description: "Correct layer", maxPoints: 5 }];
    await service.suggest("submission", 2, "VI", session);
    expect(ai.suggestGrading).toHaveBeenCalledTimes(1);
  });
  it("replays the saved result with the provider disabled but never after source or access changes", async () => {
    const { service, ai, row, prisma } = fixture();
    expect(await service.inspect("submission", 2, "VI", session)).toEqual({ state: "NOT_REQUESTED" });
    const first = await service.suggest("submission", 2, "VI", session);
    ai.resolveTask.mockRejectedValue(new Error("provider disabled"));
    expect(await service.suggest("submission", 2, "VI", session)).toEqual(first);
    expect((await service.inspect("submission", 2, "VI", session)).state).toBe("READY");
    expect(ai.suggestGrading).toHaveBeenCalledTimes(1);
    row.assignment.version++;
    expect(await service.inspect("submission", 2, "VI", session)).toEqual({ state: "NOT_REQUESTED" });
    prisma.classInstructor.findMany.mockResolvedValue([]);
    await expect(service.inspect("submission", 2, "VI", session)).rejects.toMatchObject({ status: 404 });
  });
  it("reads authoritative rubric without identity or prior grades and never writes a grade", async () => {
    const { service, ai, prisma, row } = fixture();
    const result = await service.suggest("submission", 2, "VI", session);
    expect(result).toMatchObject({ submissionRevision: 2, assignmentVersion: 3, requiresHumanReview: true });
    expect(result.contextHash).toHaveLength(64);
    expect(ai.suggestGrading).toHaveBeenCalledExactlyOnceWith({ instructions: [row.assignment.title, row.assignment.description, row.assignment.instructions].join("\n\n"), answer: row.content, rubric: row.assignment.rubric, language: "VI" });
    expect(prisma.classInstructor.findMany).toHaveBeenCalledTimes(2);
    expect(prisma.assignmentSubmission.findUnique).toHaveBeenCalledTimes(2);
    expect(row.score).toBe(4);
  });

  it("rejects wrong roles, missing teaching access, archived classes and stale revisions before AI", async () => {
    const { service, prisma, ai } = fixture();
    await expect(service.suggest("submission", 2, "VI", { ...session, roleCode: "LEARNER" })).rejects.toMatchObject({ status: 403 });
    prisma.classInstructor.findMany.mockResolvedValueOnce([]);
    await expect(service.suggest("submission", 2, "VI", session)).rejects.toMatchObject({ status: 404 });
    prisma.learningClass.findUnique.mockResolvedValueOnce({ status: "CLOSED" });
    await expect(service.suggest("submission", 2, "VI", session)).rejects.toMatchObject({ status: 409 });
    await expect(service.suggest("submission", 1, "VI", session)).rejects.toMatchObject({ status: 409 });
    await expect(service.suggest("submission", 0, "VI", session)).rejects.toMatchObject({ status: 400 });
    expect(ai.suggestGrading).not.toHaveBeenCalled();
  });

  it("does not silently grade incomplete attachment-based work", async () => {
    const { service, row, ai } = fixture();
    row.attachments = [{ id: "file" }];
    await expect(service.suggest("submission", 2, "VI", session)).rejects.toThrow("không bỏ sót");
    row.attachments = []; row.content = " ";
    await expect(service.suggest("submission", 2, "VI", session)).rejects.toMatchObject({ status: 400 });
    expect(ai.suggestGrading).not.toHaveBeenCalled();
  });

  it.each(["rubric", "revision", "permission"])("rejects a result after %s changes during provider execution", async (change) => {
    const { service, row, ai, prisma } = fixture();
    ai.suggestGrading.mockImplementationOnce(() => {
      if (change === "rubric") row.assignment.rubric[0]!.maxPoints = 3;
      if (change === "revision") row.revision++;
      if (change === "permission") prisma.classInstructor.findMany.mockResolvedValue([]);
      return Promise.resolve({ requiresHumanReview: true });
    });
    await expect(service.suggest("submission", 2, "VI", session)).rejects.toMatchObject({ status: change === "permission" ? 404 : 409 });
  });
});
