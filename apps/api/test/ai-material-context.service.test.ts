import { describe, expect, it, vi } from "vitest";
import { testStudyDraft } from "./ai-study-draft.fixture.js";
import { extractionDatabase } from "./ai-document-extraction.fixture.js";
import { NotFoundException } from "@nestjs/common";
import { AiMaterialContextService } from "../src/learning/ai-material-context.service.js";
import type { LearningService } from "../src/learning/learning.service.js";
import type { AiProviderService } from "../src/system/ai-provider.service.js";
import { AiDocumentAnswerStore, type SavedDocumentAnswer } from "../src/learning/ai-document-answer-store.js";

/** Tạo mock biên quyền và đọc file, không bỏ qua kiểm tra trước/sau extraction. */
function fixture(): { learning: { listMaterials: ReturnType<typeof vi.fn>; createMaterialVersionAccess: ReturnType<typeof vi.fn>; readMaterialVersionDownload: ReturnType<typeof vi.fn> }; ai: { resolveTask: ReturnType<typeof vi.fn>; extractDocumentPages: ReturnType<typeof vi.fn<() => Promise<unknown>>>; createStudyGuide: ReturnType<typeof vi.fn> }; material: { id: string; version: number; name: string }; service: AiMaterialContextService } {
  const material = { id: "material-1", version: 1, name: "HTTP.pdf" };
  const learning = { listMaterials: vi.fn().mockResolvedValue([material]), createMaterialVersionAccess: vi.fn().mockResolvedValue({ url: "/material?expires=123&signature=signed" }), readMaterialVersionDownload: vi.fn().mockResolvedValue({ fileName: material.name, mimeType: "application/pdf", buffer: Buffer.from("pdf-bytes") }) };
  const ai = { resolveTask: vi.fn().mockResolvedValue({ providerId: "gemini", model: "model-1" }), extractDocumentPages: vi.fn().mockResolvedValue([{ page: 1, text: "Giao thức HTTP truyền dữ liệu." }]), createStudyGuide: vi.fn().mockResolvedValue({ insufficientContext: false, summary: [], flashcards: [], model: "study-model" }) };
  const answers = { status: () => Promise.resolve({ state: "NOT_REQUESTED" }), generate: (_identity: unknown, generate: () => Promise<SavedDocumentAnswer>) => generate() } as unknown as AiDocumentAnswerStore;
  return { learning, ai, material, service: new AiMaterialContextService(learning as unknown as LearningService, ai as unknown as AiProviderService, extractionDatabase().prisma, testStudyDraft(), answers) };
}

describe("authorized material AI context", () => {
  it("rejects page ranges outside extracted content before creating a study claim", async () => {
    const { service, ai, material } = fixture();
    const options = { cardCount: 1, language: "VI" as const, fromPage: 1, toPage: 2 };
    await expect(service.study(material.id, "teacher", "INSTRUCTOR", options)).rejects.toMatchObject({ status: 400 });
    expect(await service.listStudyDrafts(material.id, "teacher", "INSTRUCTOR")).toEqual({ items: [], nextCursor: null });
    expect(ai.createStudyGuide).not.toHaveBeenCalled();
    await service.study(material.id, "teacher", "INSTRUCTOR", { ...options, toPage: 1 });
    expect(ai.extractDocumentPages).toHaveBeenCalledTimes(1);
    expect(ai.createStudyGuide).toHaveBeenCalledTimes(1);
  });

  it("continues study generation after shared OCR completes without leaving a failed study claim", async () => {
    const { learning, ai, material } = fixture();
    const { prisma } = extractionDatabase();
    const drafts = testStudyDraft();
    const service = new AiMaterialContextService(learning as unknown as LearningService, ai as unknown as AiProviderService, prisma, drafts);
    const options = { cardCount: 1, language: "VI" as const };
    let finish!: (pages: Array<{ page: number; text: string }>) => void;
    let enter!: () => void;
    const entered = new Promise<void>((resolve) => { enter = resolve; });
    ai.extractDocumentPages.mockImplementationOnce(() => { enter(); return new Promise<Array<{ page: number; text: string }>>((resolve) => { finish = resolve; }); });
    const pending = service.prepare(material.id, "teacher", "INSTRUCTOR");
    await entered;
    try {
      await expect(service.study(material.id, "teacher", "INSTRUCTOR", options)).rejects.toMatchObject({ status: 409 });
      expect(await drafts.find({ ownerId: "teacher", materialId: material.id, sourceVersion: 1, options })).toBeNull();
      expect(ai.createStudyGuide).not.toHaveBeenCalled();
    } finally { finish([{ page: 1, text: "HTTP source" }]); await pending; }
    const first = await service.study(material.id, "teacher", "INSTRUCTOR", options);
    expect(await service.study(material.id, "teacher", "INSTRUCTOR", options)).toEqual(first);
    expect(ai.createStudyGuide).toHaveBeenCalledTimes(1);
    expect(ai.extractDocumentPages).toHaveBeenCalledTimes(1);
  });

  it("keeps uncertain study generation locked without re-extracting source pages", async () => {
    const { service, ai, material } = fixture();
    ai.createStudyGuide.mockRejectedValueOnce(new Error("response lost"));
    const options = { cardCount: 1, language: "VI" as const };
    await expect(service.study(material.id, "teacher", "INSTRUCTOR", options)).rejects.toThrow("response lost");
    ai.resolveTask.mockClear();
    await expect(service.study(material.id, "teacher", "INSTRUCTOR", options)).rejects.toMatchObject({ status: 409 });
    expect(ai.resolveTask).not.toHaveBeenCalled();
    expect(ai.createStudyGuide).toHaveBeenCalledTimes(1);
    expect(ai.extractDocumentPages).toHaveBeenCalledTimes(1);
  });

  it("can answer after another worker finishes OCR without reserving an uncertain answer while waiting", async () => {
    const { learning, ai, material } = fixture();
    const { prisma, rows } = extractionDatabase();
    const answerDocument = vi.fn().mockResolvedValue({ answer: "Not enough evidence", insufficientContext: true, citations: [] });
    const service = new AiMaterialContextService(learning as unknown as LearningService, { ...ai, answerDocument } as unknown as AiProviderService, prisma);
    let finish!: (pages: Array<{ page: number; text: string }>) => void;
    let enter!: () => void;
    const entered = new Promise<void>((resolve) => { enter = resolve; });
    ai.extractDocumentPages.mockImplementationOnce(() => { enter(); return new Promise<Array<{ page: number; text: string }>>((resolve) => { finish = resolve; }); });
    const first = service.prepare(material.id, "teacher", "INSTRUCTOR");
    await entered;
    try {
      await expect(service.ask(material.id, "teacher", "INSTRUCTOR", "What is HTTP?", "EN")).rejects.toMatchObject({ status: 409 });
      expect([...rows.keys()].filter((key) => key.startsWith("ai-doc-answer:"))).toEqual([]);
      expect(answerDocument).not.toHaveBeenCalled();
    } finally { finish([{ page: 1, text: "HTTP source" }]); await first; }
    const saved = await service.ask(material.id, "teacher", "INSTRUCTOR", "What is HTTP?", "EN");
    expect(await service.ask(material.id, "teacher", "INSTRUCTOR", "What is HTTP?", "EN")).toEqual(saved);
    expect(answerDocument).toHaveBeenCalledTimes(1);
    expect(ai.extractDocumentPages).toHaveBeenCalledTimes(1);
  });

  it.each(["GENERATING", "UNCERTAIN"])("does not prepare sources or retry a %s answer", async (state) => {
    const { learning, ai, material } = fixture();
    const status = vi.fn().mockResolvedValue({ state });
    const generate = vi.fn();
    const service = new AiMaterialContextService(learning as unknown as LearningService, ai as unknown as AiProviderService, undefined, undefined, { status, generate } as unknown as AiDocumentAnswerStore);
    await expect(service.ask(material.id, "teacher", "INSTRUCTOR", "What is HTTP?", "EN")).rejects.toMatchObject({ status: 409 });
    expect(ai.resolveTask).not.toHaveBeenCalled();
    expect(learning.readMaterialVersionDownload).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
  });

  it("checks the selected historical version on both sides of status lookup", async () => {
    const { learning, ai, material } = fixture();
    learning.listMaterials.mockResolvedValue([{ ...material, version: 4 }]);
    const status = vi.fn().mockResolvedValue({ state: "NOT_REQUESTED" });
    const service = new AiMaterialContextService(learning as unknown as LearningService, ai as unknown as AiProviderService, undefined, undefined, { status } as unknown as AiDocumentAnswerStore);
    await service.questionStatus(material.id, "teacher", "INSTRUCTOR", "Old question?", "EN", 2);
    expect(status).toHaveBeenCalledExactlyOnceWith({ ownerId: "teacher", materialId: material.id, version: 2, question: "Old question?", language: "EN" });
    expect(learning.createMaterialVersionAccess.mock.calls).toEqual(Array.from({ length: 2 }, () => [material.id, 2, "INSTRUCTOR", "PREVIEW", "teacher"]));
    status.mockClear();
    learning.createMaterialVersionAccess.mockRejectedValue(new NotFoundException("Old version revoked"));
    await expect(service.questionStatus(material.id, "teacher", "INSTRUCTOR", "Old question?", "EN", 2)).rejects.toMatchObject({ status: 404 });
    expect(status).not.toHaveBeenCalled();
    expect(ai.resolveTask).not.toHaveBeenCalled();
  });
  it("reads private history with exact source-version authorization before and after storage", async () => {
    const { learning, ai, material } = fixture();
    const list = vi.fn().mockResolvedValue({ items: [], nextCursor: null });
    const service = new AiMaterialContextService(learning as unknown as LearningService, ai as unknown as AiProviderService, undefined, undefined, { list } as unknown as AiDocumentAnswerStore);
    await expect(service.questionHistory(material.id, 0, "teacher", "INSTRUCTOR")).rejects.toMatchObject({ status: 400 });
    expect(list).not.toHaveBeenCalled();
    await expect(service.questionHistory(material.id, 1, "teacher", "INSTRUCTOR")).resolves.toEqual({ items: [], nextCursor: null });
    expect(list).toHaveBeenCalledWith({ ownerId: "teacher", materialId: material.id, version: 1 }, undefined);
    expect(learning.createMaterialVersionAccess).toHaveBeenCalledTimes(2);
    expect(ai.resolveTask).not.toHaveBeenCalled();
    learning.createMaterialVersionAccess.mockResolvedValueOnce({ url: "fixture" }).mockRejectedValueOnce(new NotFoundException("revoked"));
    await expect(service.questionHistory(material.id, 1, "teacher", "INSTRUCTOR")).rejects.toMatchObject({ status: 404 });
    list.mockClear();
    learning.createMaterialVersionAccess.mockRejectedValue(new NotFoundException("revoked"));
    await expect(service.questionHistory(material.id, 1, "teacher", "INSTRUCTOR")).rejects.toMatchObject({ status: 404 });
    expect(list).not.toHaveBeenCalled();
  });
  it("replays the same study request with providers disabled, but not after source access is revoked", async () => {
    const { service, ai, learning, material } = fixture();
    const options = { cardCount: 1, language: "VI" as const };
    const saved = await service.study(material.id, "teacher", "INSTRUCTOR", options);
    ai.resolveTask.mockClear().mockRejectedValue(new Error("disabled provider"));
    ai.createStudyGuide.mockClear(); ai.extractDocumentPages.mockClear();
    expect(await service.study(material.id, "teacher", "INSTRUCTOR", options)).toEqual(saved);
    expect(ai.resolveTask).not.toHaveBeenCalled();
    expect(ai.createStudyGuide).not.toHaveBeenCalled();
    expect(ai.extractDocumentPages).not.toHaveBeenCalled();
    learning.createMaterialVersionAccess.mockRejectedValue(new NotFoundException("revoked"));
    await expect(service.study(material.id, "teacher", "INSTRUCTOR", options)).rejects.toMatchObject({ status: 404 });
  });

  it("does not claim a new study request when provider configuration is missing", async () => {
    const { service, ai, material } = fixture();
    ai.resolveTask.mockRejectedValue(new Error("missing model"));
    await expect(service.study(material.id, "teacher", "INSTRUCTOR", { cardCount: 1, language: "VI" })).rejects.toThrow("missing model");
    expect(await service.listStudyDrafts(material.id, "teacher", "INSTRUCTOR")).toEqual({ items: [], nextCursor: null });
    expect(ai.createStudyGuide).not.toHaveBeenCalled();
  });
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
    const status = vi.fn().mockResolvedValue({ state: "READY", result });
    const service = new AiMaterialContextService(learning as unknown as LearningService, ai as unknown as AiProviderService, undefined, undefined, { status } as unknown as AiDocumentAnswerStore);
    expect(await service.ask(material.id, "teacher", "INSTRUCTOR", " HTTP? ", "EN")).toEqual(result);
    expect(status).toHaveBeenCalledWith({ ownerId: "teacher", materialId: material.id, version: 1, question: "HTTP?", language: "EN" });
    expect(learning.createMaterialVersionAccess).toHaveBeenCalledTimes(2);
    expect(ai.resolveTask).not.toHaveBeenCalled();
    status.mockImplementationOnce(() => { learning.createMaterialVersionAccess.mockRejectedValueOnce(new Error("access revoked")); return Promise.resolve({ state: "READY", result }); });
    await expect(service.ask(material.id, "teacher", "INSTRUCTOR", "HTTP?", "EN")).rejects.toThrow("access revoked");
    learning.listMaterials.mockResolvedValue([]);
    status.mockClear();
    await expect(service.ask(material.id, "teacher", "INSTRUCTOR", "HTTP?", "EN")).rejects.toMatchObject({ status: 404 });
    expect(status).not.toHaveBeenCalled();
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
  it("does not retry an uncertain extraction failure", async () => {
    const { ai, material, service } = fixture();
    ai.extractDocumentPages.mockRejectedValueOnce(new Error("incomplete"));
    await expect(service.prepare(material.id, "teacher", "INSTRUCTOR")).rejects.toThrow("incomplete");
    await expect(service.prepare(material.id, "teacher", "INSTRUCTOR")).rejects.toMatchObject({ status: 409 });
    expect(ai.extractDocumentPages).toHaveBeenCalledTimes(1);
  });
});
