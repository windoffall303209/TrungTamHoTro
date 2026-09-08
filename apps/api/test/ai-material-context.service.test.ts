import { describe, expect, it, vi } from "vitest";
import { NotFoundException } from "@nestjs/common";
import { AiMaterialContextService } from "../src/learning/ai-material-context.service.js";
import type { LearningService } from "../src/learning/learning.service.js";
import type { AiProviderService } from "../src/system/ai-provider.service.js";
import type { AiDocumentAnswerStore, SavedDocumentAnswer } from "../src/learning/ai-document-answer-store.js";

/** Tạo mock biên quyền và đọc file, không bỏ qua kiểm tra trước/sau extraction. */
function fixture(): { learning: { listMaterials: ReturnType<typeof vi.fn>; createMaterialVersionAccess: ReturnType<typeof vi.fn>; readMaterialVersionDownload: ReturnType<typeof vi.fn> }; ai: { resolveTask: ReturnType<typeof vi.fn>; extractDocumentPages: ReturnType<typeof vi.fn>; createStudyGuide: ReturnType<typeof vi.fn> }; material: { id: string; version: number; name: string }; service: AiMaterialContextService } {
  const material = { id: "material-1", version: 1, name: "HTTP.pdf" };
  const learning = { listMaterials: vi.fn().mockResolvedValue([material]), createMaterialVersionAccess: vi.fn().mockResolvedValue({ url: "/material?expires=123&signature=signed" }), readMaterialVersionDownload: vi.fn().mockResolvedValue({ fileName: material.name, mimeType: "application/pdf", buffer: Buffer.from("pdf-bytes") }) };
  const ai = { resolveTask: vi.fn().mockResolvedValue({ providerId: "gemini", model: "model-1" }), extractDocumentPages: vi.fn().mockResolvedValue([{ page: 1, text: "Giao thức HTTP truyền dữ liệu." }]), createStudyGuide: vi.fn().mockResolvedValue({ insufficientContext: false, summary: [], flashcards: [], model: "study-model" }) };
  const answers = { generate: (_identity: unknown, generate: () => Promise<SavedDocumentAnswer>) => generate() } as AiDocumentAnswerStore;
  return { learning, ai, material, service: new AiMaterialContextService(learning as unknown as LearningService, ai as unknown as AiProviderService, undefined, undefined, answers) };
}

describe("authorized material AI context", () => {
  it("reads answer status only after validation and source authorization", async () => {
    const { learning, ai, material } = fixture();
    const status = vi.fn().mockResolvedValue({ state: "NOT_REQUESTED" });
    const service = new AiMaterialContextService(learning as unknown as LearningService, ai as unknown as AiProviderService, undefined, undefined, { status } as unknown as AiDocumentAnswerStore);
    await expect(service.questionStatus(material.id, "teacher", "INSTRUCTOR", " ", "VI")).rejects.toMatchObject({ status: 400 });
    expect(status).not.toHaveBeenCalled();
    expect(await service.questionStatus(material.id, "teacher", "INSTRUCTOR", " HTTP? ", "VI")).toEqual({ state: "NOT_REQUESTED" });
    expect(status).toHaveBeenCalledExactlyOnceWith({ ownerId: "teacher", materialId: material.id, version: 1, question: "HTTP?", language: "VI" });
    expect(learning.createMaterialVersionAccess).toHaveBeenCalledTimes(2);
    expect(ai.resolveTask).not.toHaveBeenCalled();
    status.mockImplementationOnce(() => { learning.createMaterialVersionAccess.mockRejectedValueOnce(new Error("revoked during lookup")); return Promise.resolve({ state: "READY", result: {} }); });
    await expect(service.questionStatus(material.id, "teacher", "INSTRUCTOR", "HTTP?", "VI")).rejects.toThrow("revoked during lookup");
    status.mockClear();
    learning.listMaterials.mockResolvedValue([]);
    await expect(service.questionStatus(material.id, "teacher", "INSTRUCTOR", "HTTP?", "VI")).rejects.toMatchObject({ status: 404 });
    expect(status).not.toHaveBeenCalled();
  });
  it("checks source access before and after replaying a saved answer without resolving providers", async () => {
    const { learning, ai, material } = fixture();
    const result = { answer: "Cached", insufficientContext: false, citations: [], version: 1, warning: "Review source" };
    const generate = vi.fn().mockResolvedValue(result);
    const service = new AiMaterialContextService(learning as unknown as LearningService, ai as unknown as AiProviderService, undefined, undefined, { generate } as unknown as AiDocumentAnswerStore);
    expect(await service.ask(material.id, "teacher", "INSTRUCTOR", " HTTP? ", "EN")).toEqual(result);
    expect(generate).toHaveBeenCalledWith({ ownerId: "teacher", materialId: material.id, version: 1, question: "HTTP?", language: "EN" }, expect.any(Function));
    expect(learning.createMaterialVersionAccess).toHaveBeenCalledTimes(2);
    expect(ai.resolveTask).not.toHaveBeenCalled();
    generate.mockImplementationOnce(() => { learning.createMaterialVersionAccess.mockRejectedValueOnce(new Error("access revoked")); return Promise.resolve(result); });
    await expect(service.ask(material.id, "teacher", "INSTRUCTOR", "HTTP?", "EN")).rejects.toThrow("access revoked");
    learning.listMaterials.mockResolvedValue([]);
    generate.mockClear();
    await expect(service.ask(material.id, "teacher", "INSTRUCTOR", "HTTP?", "EN")).rejects.toMatchObject({ status: 404 });
    expect(generate).not.toHaveBeenCalled();
  });
  it("checks publication visibility, source version and current learner access without AI calls", async () => {
    const { learning, ai, material, service } = fixture();
    const source = { id: "source", materialId: material.id, version: 1, page: 1, name: material.name, text: "Evidence" };
    ai.createStudyGuide.mockResolvedValue({ insufficientContext: false, summary: [{ text: "Summary", citations: [source] }], flashcards: [{ front: "Question", back: "Answer", citations: [source] }] });
    const saved = await service.study(material.id, "teacher", "INSTRUCTOR", { cardCount: 1, language: "VI" });
    const input = { expectedRevision: 0, expectedPublicationRevision: 0, confirmReview: true };
    await expect(service.publishStudyDraft(material.id, saved.draftId, "teacher", "INSTRUCTOR", input)).rejects.toMatchObject({ status: 409 });
    learning.listMaterials.mockResolvedValue([{ ...material, visibility: "PUBLISHED", version: 2 }]);
    await expect(service.publishStudyDraft(material.id, saved.draftId, "teacher", "INSTRUCTOR", input)).rejects.toMatchObject({ status: 409 });
    learning.listMaterials.mockResolvedValue([{ ...material, visibility: "PUBLISHED" }]);
    await service.publishStudyDraft(material.id, saved.draftId, "teacher", "INSTRUCTOR", input);
    ai.resolveTask.mockClear();
    expect((await service.getPublishedStudyDraft(material.id, saved.draftId, "student", "LEARNER")).result.summary[0]?.text).toBe("Summary");
    expect((await service.listPublishedStudyDrafts(material.id, "student", "LEARNER")).items).toHaveLength(1);
    learning.createMaterialVersionAccess.mockRejectedValueOnce(new NotFoundException("hidden source"));
    expect((await service.listPublishedStudyDrafts(material.id, "student", "LEARNER")).items).toEqual([]);
    learning.createMaterialVersionAccess.mockRejectedValueOnce(new Error("database unavailable"));
    await expect(service.listPublishedStudyDrafts(material.id, "student", "LEARNER")).rejects.toThrow("database unavailable");
    expect(learning.createMaterialVersionAccess).toHaveBeenLastCalledWith(material.id, 1, "LEARNER", "PREVIEW", "student");
    learning.createMaterialVersionAccess.mockRejectedValueOnce(new Error("source hidden"));
    await expect(service.getPublishedStudyDraft(material.id, saved.draftId, "student", "LEARNER")).rejects.toThrow("source hidden");
    learning.listMaterials.mockResolvedValue([]);
    await expect(service.getPublishedStudyDraft(material.id, saved.draftId, "student", "LEARNER")).rejects.toMatchObject({ status: 404 });
    expect(ai.resolveTask).not.toHaveBeenCalled();
  });
  it("reopens a saved guide without calling providers and checks source access on every read", async () => {
    const { learning, ai, material, service } = fixture();
    const first = await service.study(material.id, "teacher", "INSTRUCTOR", { cardCount: 5, language: "EN" });
    const second = await service.study(material.id, "teacher", "INSTRUCTOR", { cardCount: 5, language: "EN" });
    expect(second.draftId).toBe(first.draftId);
    expect(ai.createStudyGuide).toHaveBeenCalledTimes(1);
    ai.resolveTask.mockRejectedValue(new Error("provider disabled"));
    const draft = await service.getStudyDraft(material.id, first.draftId, "teacher", "INSTRUCTOR");
    expect(draft.state).toBe("READY");
    expect(draft.result?.version).toBe(material.version);
    expect((await service.listStudyDrafts(material.id, "teacher", "INSTRUCTOR")).items).toHaveLength(1);
    learning.createMaterialVersionAccess.mockRejectedValue(new Error("source access revoked"));
    await expect(service.getStudyDraft(material.id, first.draftId, "teacher", "INSTRUCTOR")).rejects.toThrow("source access revoked");
    await expect(service.getStudyDraft(material.id, first.draftId, "other-teacher", "INSTRUCTOR")).rejects.toMatchObject({ status: 404 });
    expect(ai.createStudyGuide).toHaveBeenCalledTimes(1);
  });
  it("creates study aids from authorized source and rechecks the exact version afterwards", async () => {
    const { learning, ai, material, service } = fixture();
    const result = await service.study(material.id, "teacher", "INSTRUCTOR", { cardCount: 5, language: "EN" });
    expect(result.coverage).toMatchObject({ partial: false, selectedPages: [1] });
    expect(result.version).toBe(material.version);
    expect(ai.createStudyGuide).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({ materialId: material.id, version: material.version })]), { cardCount: 5, language: "EN" });
    expect(learning.createMaterialVersionAccess).toHaveBeenCalledTimes(3);
    expect(learning.createMaterialVersionAccess).toHaveBeenLastCalledWith(material.id, material.version, "INSTRUCTOR", "PREVIEW", "teacher");
  });

  it("never returns a generated guide when access was revoked during generation", async () => {
    const { learning, ai, material, service } = fixture();
    ai.createStudyGuide.mockImplementationOnce(() => {
      learning.createMaterialVersionAccess.mockRejectedValue(new Error("access revoked"));
      return { summary: [], flashcards: [] };
    });
    await expect(service.study(material.id, "teacher", "INSTRUCTOR", { cardCount: 5, language: "VI" })).rejects.toThrow("access revoked");
  });

  it("rejects missing permissions and invalid page pairs before provider work", async () => {
    const { learning, ai, material, service } = fixture();
    await expect(service.study(material.id, "teacher", "INSTRUCTOR", { cardCount: 5, language: "VI", fromPage: 3 })).rejects.toMatchObject({ status: 400 });
    expect(learning.listMaterials).not.toHaveBeenCalled();
    learning.listMaterials.mockResolvedValue([]);
    await expect(service.study(material.id, "teacher", "INSTRUCTOR", { cardCount: 5, language: "VI" })).rejects.toMatchObject({ status: 404 });
    expect(ai.extractDocumentPages).not.toHaveBeenCalled();
    expect(ai.createStudyGuide).not.toHaveBeenCalled();
  });

  it("rejects invalid questions before reading files or invoking extraction", async () => {
    const { learning, ai, material, service } = fixture();
    for (const question of ["  ", "x", "x".repeat(2001)]) {
      await expect(service.ask(material.id, "teacher", "INSTRUCTOR", question, "VI")).rejects.toMatchObject({ status: 400 });
    }
    expect(learning.readMaterialVersionDownload).not.toHaveBeenCalled();
    expect(ai.extractDocumentPages).not.toHaveBeenCalled();
  });

  it("requires current material and exact source-version access before accepting an edit", async () => {
    const { learning, ai, material, service } = fixture();
    const saved = await service.study(material.id, "teacher", "INSTRUCTOR", { cardCount: 5, language: "VI" });
    ai.resolveTask.mockClear();
    learning.createMaterialVersionAccess.mockRejectedValueOnce(new Error("version access revoked"));
    await expect(service.editStudyDraft(material.id, saved.draftId, "teacher", "INSTRUCTOR", {})).rejects.toThrow("version access revoked");
    learning.listMaterials.mockResolvedValue([]);
    await expect(service.editStudyDraft(material.id, saved.draftId, "teacher", "INSTRUCTOR", {})).rejects.toMatchObject({ status: 404 });
    expect(ai.resolveTask).not.toHaveBeenCalled();
  });

  it("requires the answer model before charging for extraction, after checking material access", async () => {
    const { learning, ai, material, service } = fixture();
    ai.resolveTask.mockRejectedValue(new Error("missing answer model"));
    await expect(service.ask(material.id, "teacher", "INSTRUCTOR", "HTTP là gì?", "VI")).rejects.toThrow("missing answer model");
    expect(learning.listMaterials).toHaveBeenCalled();
    expect(ai.resolveTask).toHaveBeenCalledExactlyOnceWith("DOCUMENT_QA");
    expect(ai.extractDocumentPages).not.toHaveBeenCalled();
    expect(learning.readMaterialVersionDownload).not.toHaveBeenCalled();
    learning.listMaterials.mockResolvedValue([]);
    ai.resolveTask.mockClear();
    await expect(service.ask(material.id, "teacher", "INSTRUCTOR", "HTTP là gì?", "VI")).rejects.toMatchObject({ status: 404 });
    expect(ai.resolveTask).not.toHaveBeenCalled();
  });

  it("reuses extraction while checking access every time and invalidates a changed version", async () => {
    const { learning, ai, material, service } = fixture();
    const first = await service.prepare(material.id, "teacher", "INSTRUCTOR");
    expect(first.cached).toBe(false);
    const second = await service.prepare(material.id, "teacher", "INSTRUCTOR", "HTTP");
    expect(second.cached).toBe(true);
    expect(second.chunks).toHaveLength(1);
    expect(ai.extractDocumentPages).toHaveBeenCalledTimes(1);
    expect(learning.createMaterialVersionAccess).toHaveBeenCalledTimes(4);
    material.version = 2;
    const newer = await service.prepare(material.id, "teacher", "INSTRUCTOR");
    expect(newer.chunks[0]?.id).not.toBe(first.chunks[0]?.id);
    expect(ai.extractDocumentPages).toHaveBeenCalledTimes(2);
  });
  it("does not expose cached text after access is revoked", async () => {
    const { learning, ai, material, service } = fixture();
    await service.prepare(material.id, "teacher", "INSTRUCTOR");
    learning.listMaterials.mockResolvedValue([]);
    await expect(service.prepare(material.id, "teacher", "INSTRUCTOR")).rejects.toThrow("được phép");
    expect(ai.extractDocumentPages).toHaveBeenCalledTimes(1);
  });
  it("checks access again after the provider returns", async () => {
    const { learning, material, service } = fixture();
    learning.createMaterialVersionAccess.mockResolvedValueOnce({ url: "/material?expires=123&signature=signed" }).mockRejectedValueOnce(new Error("access revoked"));
    await expect(service.prepare(material.id, "teacher", "INSTRUCTOR")).rejects.toThrow("access revoked");
  });
  it("does not cache an extraction failure", async () => {
    const { ai, material, service } = fixture();
    ai.extractDocumentPages.mockRejectedValueOnce(new Error("incomplete"));
    await expect(service.prepare(material.id, "teacher", "INSTRUCTOR")).rejects.toThrow("incomplete");
    expect((await service.prepare(material.id, "teacher", "INSTRUCTOR")).cached).toBe(false);
  });
});
