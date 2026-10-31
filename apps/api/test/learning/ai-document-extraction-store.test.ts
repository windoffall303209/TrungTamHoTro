import { describe, expect, it, vi } from "vitest";
import { AiDocumentExtractionStore } from "../../src/domains/learning/ai/ai-document-extraction-store.js";
import type { DocumentPage } from "../../src/domains/system/ai/ai-document-context.js";
import { extractionDatabase } from "./ai-document-extraction.fixture.js";

const key = `ai-doc:${"a".repeat(64)}`;
const pages = [{ page: 1, text: "Verified source text" }];

describe("durable document extraction", () => {
  it.each([
    [undefined, "NOT_REQUESTED"], [pages, "READY"], [{ state: "READY", pages }, "READY"],
    [{ state: "GENERATING" }, "GENERATING"], [{ state: "UNCERTAIN" }, "UNCERTAIN"],
    [{ state: "READY", pages: [] }, "UNCERTAIN"], [null, "UNCERTAIN"], [{ state: "UNKNOWN" }, "UNCERTAIN"],
  ])("reads state without mutating claims %#", async (value, expected) => {
    const { prisma, rows, systemSetting } = extractionDatabase();
    if (value !== undefined) rows.set(key, { key, value, version: 3 });
    const before = structuredClone([...rows]);
    const status = await new AiDocumentExtractionStore(prisma).status(key);
    expect(status.state).toBe(expected);
    if (status.state === "READY") { expect(status.pages).toEqual(pages); status.pages[0]!.text = "changed externally"; }
    expect([...rows]).toEqual(before);
    expect(systemSetting.create).not.toHaveBeenCalled();
    expect(systemSetting.updateMany).not.toHaveBeenCalled();
  });

  it("rejects invalid read keys and missing durable storage", async () => {
    const { prisma, systemSetting } = extractionDatabase();
    for (const invalid of ["", "ai-doc:wrong", `ai-doc-answer:${"a".repeat(64)}`]) {
      await expect(new AiDocumentExtractionStore(prisma).status(invalid)).rejects.toMatchObject({ status: 400 });
    }
    expect(systemSetting.findUnique).not.toHaveBeenCalled();
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

  it("preserves validated legacy caches without rewriting them", async () => {
    const { prisma, rows, systemSetting } = extractionDatabase();
    rows.set(key, { key, value: pages, version: 4 });
    const extract = vi.fn();
    expect(await new AiDocumentExtractionStore(prisma).generate(key, "teacher", extract)).toEqual({ pages, cached: true });
    expect(systemSetting.updateMany).not.toHaveBeenCalled();
    expect(extract).not.toHaveBeenCalled();
  });

  it.each([[], [{ page: 2, text: "Wrong order" }], [{ page: 1, text: " " }], [{ page: 1, text: "x".repeat(500_001) }], { state: "READY", pages: [] }, { state: "UNCERTAIN" }])("does not regenerate invalid or uncertain cache %#", async (value) => {
    const { prisma, rows } = extractionDatabase();
    rows.set(key, { key, value, version: 1 });
    const extract = vi.fn();
    await expect(new AiDocumentExtractionStore(prisma).generate(key, "teacher", extract)).rejects.toMatchObject({ status: 409 });
    expect(extract).not.toHaveBeenCalled();
    expect(rows.get(key)?.value).toEqual(value);
  });

  it("keeps uncertain failures locked and rejects malformed provider output", async () => {
    const { prisma, rows } = extractionDatabase();
    const store = new AiDocumentExtractionStore(prisma);
    const extract = vi.fn().mockResolvedValue([{ page: 9, text: "Partial" }]);
    await expect(store.generate(key, "teacher", extract)).rejects.toMatchObject({ status: 503 });
    expect(rows.get(key)?.value).toEqual({ state: "UNCERTAIN" });
    await expect(store.generate(key, "teacher", extract)).rejects.toMatchObject({ status: 409 });
    expect(extract).toHaveBeenCalledTimes(1);
  });

  it("preserves READY when its database acknowledgement is lost", async () => {
    const { prisma, systemSetting } = extractionDatabase();
    const update = systemSetting.updateMany.getMockImplementation()!;
    systemSetting.updateMany.mockImplementationOnce(async (args) => {
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
    const { prisma, systemSetting } = extractionDatabase();
    systemSetting.create.mockRejectedValue(new Error("database offline"));
    await expect(new AiDocumentExtractionStore(prisma).generate(key, "teacher", extract)).rejects.toThrow("database offline");
    expect(extract).not.toHaveBeenCalled();
  });
});
