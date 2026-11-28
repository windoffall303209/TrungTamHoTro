import { describe, expect, it, vi } from "vitest";
import { AiDocumentExtractionStore } from "../../src/domains/learning/ai/ai-document-extraction-store.js";
import type { DocumentPage } from "../../src/domains/system/ai/ai-document-context.js";
import { extractionDatabase } from "./ai-document-extraction.fixture.js";

const id = "a".repeat(64);
const key = `ai-doc:${id}`;
const pages = [{ page: 1, text: "Verified source text" }];

describe("durable document extraction", () => {
  it.each([
    [undefined, "NOT_REQUESTED"],
    [{ state: "READY", pages }, "READY"],
    [{ state: "GENERATING", pages: null }, "GENERATING"],
    [{ state: "UNCERTAIN", pages: null }, "UNCERTAIN"],
    [{ state: "READY", pages: [] }, "UNCERTAIN"],
    [{ state: "READY", pages: null }, "UNCERTAIN"],
    [{ state: "UNKNOWN", pages: null }, "UNCERTAIN"],
  ])("reads state without mutating claims %#", async (stored, expected) => {
    const { prisma, rows, aiDocumentExtraction } = extractionDatabase();
    if (stored !== undefined) {
      rows.set(id, { id, ownerId: "teacher", version: 3, leaseToken: null, leaseExpiresAt: null, ...stored });
    }
    const before = structuredClone([...rows]);
    const status = await new AiDocumentExtractionStore(prisma).status(key);
    expect(status.state).toBe(expected);
    if (status.state === "READY") {
      expect(status.pages).toEqual(pages);
      status.pages[0]!.text = "changed externally";
    }
    expect([...rows]).toEqual(before);
    expect(aiDocumentExtraction.create).not.toHaveBeenCalled();
    expect(aiDocumentExtraction.updateMany).not.toHaveBeenCalled();
  });

  it("rejects invalid read keys and missing durable storage", async () => {
    const { prisma, aiDocumentExtraction } = extractionDatabase();
    for (const invalid of ["", "ai-doc:wrong", `ai-doc-answer:${id}`]) {
      await expect(new AiDocumentExtractionStore(prisma).status(invalid)).rejects.toMatchObject({ status: 400 });
    }
    expect(aiDocumentExtraction.findUnique).not.toHaveBeenCalled();
    await expect(new AiDocumentExtractionStore().status(key)).rejects.toMatchObject({ status: 503 });
  });

  it("blocks another worker and replays after store replacement without another provider call", async () => {
    const { prisma } = extractionDatabase();
    const store = new AiDocumentExtractionStore(prisma);
    let release!: (value: DocumentPage[]) => void;
    let enter!: () => void;
    const entered = new Promise<void>((resolve) => { enter = resolve; });
    const extract = vi.fn(() => { enter(); return new Promise<DocumentPage[]>((resolve) => { release = resolve; }); });
    const first = store.generate(key, "teacher", extract);
    await entered;
    await expect(new AiDocumentExtractionStore(prisma).generate(key, "other-teacher", extract)).rejects.toMatchObject({ status: 409 });
    release(pages);
    expect(await first).toEqual({ pages, cached: false });
    const replay = await new AiDocumentExtractionStore(prisma).generate(key, "teacher", extract);
    expect(replay).toEqual({ pages, cached: true });
    replay.pages[0]!.text = "external mutation";
    expect((await store.generate(key, "teacher", extract)).pages).toEqual(pages);
    expect(extract).toHaveBeenCalledTimes(1);
  });

  it("preserves validated READY records without rewriting them", async () => {
    const { prisma, rows, aiDocumentExtraction } = extractionDatabase();
    rows.set(id, { id, ownerId: "teacher", state: "READY", pages, version: 4, leaseToken: null, leaseExpiresAt: null });
    const extract = vi.fn();
    expect(await new AiDocumentExtractionStore(prisma).generate(key, "teacher", extract)).toEqual({ pages, cached: true });
    expect(aiDocumentExtraction.updateMany).not.toHaveBeenCalled();
    expect(extract).not.toHaveBeenCalled();
  });

  it.each([
    { state: "READY", pages: [] },
    { state: "READY", pages: [{ page: 2, text: "Wrong order" }] },
    { state: "READY", pages: [{ page: 1, text: " " }] },
    { state: "READY", pages: [{ page: 1, text: "x".repeat(500_001) }] },
    { state: "UNCERTAIN", pages: null },
  ])("does not regenerate invalid or uncertain cache %#", async (stored) => {
    const { prisma, rows } = extractionDatabase();
    rows.set(id, { id, ownerId: "teacher", version: 1, leaseToken: null, leaseExpiresAt: null, ...stored });
    const extract = vi.fn();
    await expect(new AiDocumentExtractionStore(prisma).generate(key, "teacher", extract)).rejects.toMatchObject({ status: 409 });
    expect(extract).not.toHaveBeenCalled();
    expect(rows.get(id)).toMatchObject(stored);
  });

  it("keeps uncertain failures locked and rejects malformed provider output", async () => {
    const { prisma, rows } = extractionDatabase();
    const store = new AiDocumentExtractionStore(prisma);
    const extract = vi.fn().mockResolvedValue([{ page: 9, text: "Partial" }]);
    await expect(store.generate(key, "teacher", extract)).rejects.toMatchObject({ status: 503 });
    expect(rows.get(id)).toMatchObject({ state: "UNCERTAIN", leaseToken: null, leaseExpiresAt: null });
    await expect(store.generate(key, "teacher", extract)).rejects.toMatchObject({ status: 409 });
    expect(extract).toHaveBeenCalledTimes(1);
  });

  it("preserves READY when its database acknowledgement is lost", async () => {
    const { prisma, aiDocumentExtraction } = extractionDatabase();
    const update = aiDocumentExtraction.updateMany.getMockImplementation()!;
    aiDocumentExtraction.updateMany.mockImplementationOnce(async (args) => {
      await update(args);
      throw new Error("ack lost");
    });
    const store = new AiDocumentExtractionStore(prisma);
    const extract = vi.fn().mockResolvedValue(pages);
    await expect(store.generate(key, "teacher", extract)).rejects.toThrow("ack lost");
    expect(await store.generate(key, "teacher", extract)).toEqual({ pages, cached: true });
    expect(extract).toHaveBeenCalledTimes(1);
  });

  it("fails closed without database or when claim storage is unavailable", async () => {
    const extract = vi.fn();
    await expect(new AiDocumentExtractionStore().generate(key, "teacher", extract)).rejects.toMatchObject({ status: 503 });
    const { prisma, aiDocumentExtraction } = extractionDatabase();
    aiDocumentExtraction.create.mockRejectedValue(new Error("database offline"));
    await expect(new AiDocumentExtractionStore(prisma).generate(key, "teacher", extract)).rejects.toThrow("database offline");
    expect(extract).not.toHaveBeenCalled();
  });
});
