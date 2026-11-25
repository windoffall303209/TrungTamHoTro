import { describe, expect, it, vi } from "vitest";
import type { PrismaService } from "../../src/database/prisma.service.js";
import { AiDocumentAnswerStore, type SavedDocumentAnswer } from "../../src/domains/learning/ai/ai-document-answer-store.js";

const identity = { ownerId: "owner", materialId: "material", version: 2, question: "Explain this?", language: "VI" as const };
const source = { id: "chunk", materialId: "material", version: 2, checksum: "checksum", name: "Lesson.pdf", page: 1, start: 0, end: 7, text: "Context" };
const answer = { answer: "Explanation", insufficientContext: false, version: 2, warning: "Check source", citations: [source] };

/** Mô phỏng bảng ai_document_answers; giữ nguyên quy tắc giữ quyền xử lý, đọc lại và kiểm tra dữ liệu. */
function fixture(stored: { state: string; result?: unknown }, duplicate = true): {
  store: AiDocumentAnswerStore;
  create: ReturnType<typeof vi.fn>;
  findUnique: ReturnType<typeof vi.fn>;
  updateMany: ReturnType<typeof vi.fn>;
} {
  let leaseToken: string | null = null;
  const create = duplicate
    ? vi.fn().mockRejectedValue({ code: "P2002" })
    : vi.fn(({ data }: { data: { leaseToken?: string | null } }) => {
        leaseToken = data.leaseToken ?? null;
        return Promise.resolve({});
      });
  const findUnique = vi.fn(() =>
    Promise.resolve({
      id: "answer-id",
      ownerId: identity.ownerId,
      materialId: identity.materialId,
      sourceVersion: identity.version,
      question: identity.question,
      language: identity.language,
      state: stored.state,
      result: stored.result ?? null,
      version: 1,
      leaseToken,
      leaseExpiresAt: null,
      createdAt: new Date(),
    }),
  );
  const updateMany = vi.fn().mockResolvedValue({ count: 1 });
  const prisma = {
    isStartupConnectionEnabled: () => true,
    aiDocumentAnswer: { create, findUnique, updateMany },
  } as unknown as PrismaService;
  return { store: new AiDocumentAnswerStore(prisma), create, findUnique, updateMany };
}

const malformed = [
  null, {}, { ...answer, answer: " " }, { ...answer, answer: "a".repeat(20_001) },
  { ...answer, version: 3 }, { ...answer, warning: null }, { ...answer, insufficientContext: "false" },
  { ...answer, citations: null }, { ...answer, citations: [] }, { ...answer, insufficientContext: true },
  { ...answer, citations: [source, source] }, { ...answer, model: 123 },
  ...[{ materialId: "other" }, { version: 1 }, { page: 0 }, { start: -1 }, { end: 0 }, { checksum: "" }, { text: null }, { id: "" }].map((change) => ({ ...answer, citations: [{ ...source, ...change }] })),
];

describe("Document answer integrity", () => {
  it.each(malformed.map((value, index) => ({ value, index })))("blocks malformed cached answer $index without mutation or generation", async ({ value }) => {
    const { store, updateMany, create } = fixture({ state: "READY", result: value });
    const generate = vi.fn();
    expect(await store.status(identity)).toEqual({ state: "UNCERTAIN" });
    expect(create).not.toHaveBeenCalled();
    await expect(store.generate(identity, generate)).rejects.toMatchObject({ status: 409 });
    expect(generate).not.toHaveBeenCalled();
    expect(updateMany).not.toHaveBeenCalled();
  });

  it.each(malformed.map((value, index) => ({ value, index })))("does not persist malformed fresh answer $index as READY", async ({ value }) => {
    const { store, updateMany } = fixture({ state: "GENERATING" }, false);
    const generate = vi.fn().mockResolvedValue(value);
    await expect(store.generate(identity, generate)).rejects.toMatchObject({ status: 409 });
    expect(generate).toHaveBeenCalledTimes(1);
    expect(updateMany).toHaveBeenCalledTimes(1);
    const callArg = updateMany.mock.calls[0]?.[0] as { data: Record<string, unknown> };
    expect(callArg.data).toMatchObject({ state: "UNCERTAIN", version: { increment: 1 } });
  });

  it.each([answer, { ...answer, answer: "Insufficient evidence", insufficientContext: true, citations: [] }])("replays valid answers and removes undeclared fields", async (result) => {
    const dirty = { ...result, privateToken: "secret", citations: result.citations.map((citation) => ({ ...citation, url: "https://untrusted.invalid" })) };
    const { store, updateMany } = fixture({ state: "READY", result: dirty });
    const generate = vi.fn();
    expect(await store.status(identity)).toEqual({ state: "READY", result });
    expect(await store.generate(identity, generate)).toEqual(result);
    expect(generate).not.toHaveBeenCalled();
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("sanitizes fresh valid output before persisting it", async () => {
    const { store, updateMany } = fixture({ state: "GENERATING" }, false);
    const generated = { ...answer, hidden: "not part of contract" } as SavedDocumentAnswer;
    expect(await store.generate(identity, () => Promise.resolve(generated))).toEqual(answer);
    expect(updateMany).toHaveBeenCalledTimes(1);
    const callArg = updateMany.mock.calls[0]?.[0] as { data: Record<string, unknown> };
    expect(callArg.data).toMatchObject({ state: "READY", result: answer, version: { increment: 1 } });
  });
});
