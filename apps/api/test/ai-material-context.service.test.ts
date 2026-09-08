import { describe, expect, it, vi } from "vitest";
import { AiMaterialContextService } from "../src/learning/ai-material-context.service.js";
import type { LearningService } from "../src/learning/learning.service.js";
import type { AiProviderService } from "../src/system/ai-provider.service.js";

/** Tạo mock biên quyền và đọc file, không bỏ qua kiểm tra trước/sau extraction. */
function fixture(): { learning: { listMaterials: ReturnType<typeof vi.fn>; createMaterialVersionAccess: ReturnType<typeof vi.fn>; readMaterialVersionDownload: ReturnType<typeof vi.fn> }; ai: { resolveTask: ReturnType<typeof vi.fn>; extractDocumentPages: ReturnType<typeof vi.fn> }; material: { id: string; version: number; name: string }; service: AiMaterialContextService } {
  const material = { id: "material-1", version: 1, name: "HTTP.pdf" };
  const learning = { listMaterials: vi.fn().mockResolvedValue([material]), createMaterialVersionAccess: vi.fn().mockResolvedValue({ url: "/material?expires=123&signature=signed" }), readMaterialVersionDownload: vi.fn().mockResolvedValue({ fileName: material.name, mimeType: "application/pdf", buffer: Buffer.from("pdf-bytes") }) };
  const ai = { resolveTask: vi.fn().mockResolvedValue({ providerId: "gemini", model: "model-1" }), extractDocumentPages: vi.fn().mockResolvedValue([{ page: 1, text: "Giao thức HTTP truyền dữ liệu." }]) };
  return { learning, ai, material, service: new AiMaterialContextService(learning as unknown as LearningService, ai as unknown as AiProviderService) };
}

describe("authorized material AI context", () => {
  it("rejects invalid questions before reading files or invoking extraction", async () => {
    const { learning, ai, material, service } = fixture();
    for (const question of ["  ", "x", "x".repeat(2001)]) {
      await expect(service.ask(material.id, "teacher", "INSTRUCTOR", question, "VI")).rejects.toMatchObject({ status: 400 });
    }
    expect(learning.readMaterialVersionDownload).not.toHaveBeenCalled();
    expect(ai.extractDocumentPages).not.toHaveBeenCalled();
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
