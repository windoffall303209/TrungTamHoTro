import { BadRequestException, HttpException, ServiceUnavailableException } from "@nestjs/common";
import type { ConfigService } from "@nestjs/config";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Environment } from "../../src/config/environment.js";
import type { PrismaService } from "../../src/database/prisma.service.js";
import { AiDocumentAnswerStore, type SavedDocumentAnswer } from "../../src/domains/learning/ai/ai-document-answer-store.js";
import { AiDocumentExtractionStore } from "../../src/domains/learning/ai/ai-document-extraction-store.js";
import { AiGenerationRequestService } from "../../src/domains/learning/ai/ai-generation-request.service.js";
import type { SavedGradingSuggestion } from "../../src/domains/learning/ai/ai-grading-store.service.js";
import { AiStudyDraftService, type SavedStudyGuide } from "../../src/domains/learning/ai/ai-study-draft.service.js";
import type { AiGeneratedExamResult } from "../../src/domains/learning/core/learning.types.js";
import {
  canReopenAiClaimAfterFailure,
  classifyAiFailure,
  createAiClaimLease,
  hasValidJsonLease,
  isAiLeaseExpired,
  markAiFailure,
} from "../../src/domains/system/ai/ai-claim-policy.js";
import { AiProviderService, type GeneratedExamDraft } from "../../src/domains/system/ai/ai-provider.service.js";
import { extractionDatabase } from "./ai-document-extraction.fixture.js";
import { testGradingStore } from "./ai-grading-store.fixture.js";

const encryptionSecret = "test-d02-encryption-secret-at-least-32-chars";
const providerConfig = {
  get: (key: string): string | undefined => (key === "AUTH_ENCRYPTION_SECRET" ? encryptionSecret : undefined),
} as unknown as ConfigService<Environment, true>;

const studyIdentity = {
  ownerId: "teacher-1",
  materialId: "mat-1",
  sourceVersion: 1,
  options: { cardCount: 1, language: "VI" as const },
};

const studyResult: SavedStudyGuide = {
  insufficientContext: true,
  summary: [],
  flashcards: [],
  version: 1,
  warning: "Review source",
  coverage: { totalChunks: 1, selectedChunks: 1, selectedPages: [1], partial: false, fromPage: null, toPage: null },
};

const gradingIdentity = {
  ownerId: "teacher-1",
  submissionId: "sub-1",
  contextHash: "a".repeat(64),
  language: "VI" as const,
};

const gradingResult: SavedGradingSuggestion = {
  insufficientEvidence: true,
  feedback: "Review required",
  criteria: [],
  suggestedTotal: null,
  requiresHumanReview: true,
  model: "mock-model",
  submissionRevision: 1,
  assignmentVersion: 1,
  contextHash: gradingIdentity.contextHash,
};

const answerIdentity = {
  ownerId: "teacher-1",
  materialId: "mat-1",
  version: 1,
  question: "HTTP là gì?",
  language: "VI" as const,
};

const answerResult: SavedDocumentAnswer = {
  answer: "Chưa đủ căn cứ trong đoạn tài liệu.",
  insufficientContext: true,
  citations: [],
  warning: "Review source",
  version: 1,
};

const examPrepared = { courseId: "course-1", generated: { model: "mock-model" } as GeneratedExamDraft };
const examResult = { exam: { id: "exam-1" } } as AiGeneratedExamResult;

/** Tạo kho in-memory hỗ trợ lọc leaseToken và leaseExpiresAt.lte cho kiểm thử đơn vị bộ ôn tập. */
function createStudyStoreWithClock(now: () => Date, leaseMs = 5_000): {
  service: AiStudyDraftService;
  rows: Map<string, Record<string, unknown>>;
} {
  const rows = new Map<string, Record<string, unknown>>();
  /** Kiểm tra điều kiện đối chiếu cột đơn giản và mốc hết hạn lease. */
  const matches = (row: Record<string, unknown>, where: Record<string, unknown>): boolean =>
    Object.entries(where).every(([key, value]) => {
      const actual = row[key];
      if (value && typeof value === "object" && "lte" in value) {
        const limit = (value as { lte: Date }).lte;
        return actual instanceof Date && actual.getTime() <= limit.getTime();
      }
      return actual === value;
    });
  const prisma = {
    isStartupConnectionEnabled: (): boolean => true,
    aiStudyDraft: {
      create: ({ data }: { data: Record<string, unknown> }): Promise<void> => {
        if (rows.has(String(data.fingerprint))) {
          return Promise.reject(Object.assign(new Error("Duplicate"), { code: "P2002" }));
        }
        rows.set(String(data.fingerprint), structuredClone({ ...data, state: "GENERATING", result: null, editedResult: null, publishedAt: null }));
        return Promise.resolve();
      },
      findUnique: ({ where }: { where: { fingerprint: string } }): Promise<Record<string, unknown> | null> =>
        Promise.resolve(structuredClone(rows.get(where.fingerprint) ?? null)),
      updateMany: ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }): Promise<{ count: number }> => {
        let count = 0;
        for (const row of rows.values()) {
          if (matches(row, where)) {
            Object.assign(row, structuredClone(data));
            count += 1;
          }
        }
        return Promise.resolve({ count });
      },
    },
  };
  return { service: new AiStudyDraftService(prisma as unknown as PrismaService, { leaseMs, now }), rows };
}

/** Tạo kho hai bảng ai_generation_requests và ai_generation_bindings dùng chung cho kiểm thử lease sinh đề AI. */
function createExamRequestDb(): {
  prisma: PrismaService;
  requests: Map<string, { id: string; ownerId: string; payloadHash: string; state: string; version: number; prepared: unknown; result: unknown; leaseToken: string | null; leaseExpiresAt: Date | null }>;
} {
  const requests = new Map<string, { id: string; ownerId: string; payloadHash: string; state: string; version: number; prepared: unknown; result: unknown; leaseToken: string | null; leaseExpiresAt: Date | null }>();
  const bindings = new Map<string, { fingerprint: string; ownerId: string; payloadHash: string; canonicalRequestId: string | null; malformed: boolean }>();
  const prisma = {
    isStartupConnectionEnabled: (): boolean => true,
    aiGenerationRequest: {
      create: ({ data }: { data: { id: string; ownerId: string; payloadHash: string; state?: string } }): Promise<void> => {
        if (requests.has(data.id)) throw Object.assign(new Error("duplicate"), { code: "P2002" });
        requests.set(data.id, {
          id: data.id,
          ownerId: data.ownerId,
          payloadHash: data.payloadHash,
          state: data.state ?? "CLAIMED",
          version: 1,
          prepared: null,
          result: null,
          leaseToken: null,
          leaseExpiresAt: null,
        });
        return Promise.resolve();
      },
      findUnique: ({ where }: { where: { id: string } }): Promise<unknown> =>
        Promise.resolve(structuredClone(requests.get(where.id) ?? null)),
      updateMany: ({ where, data }: { where: { id: string; version: number }; data: Record<string, unknown> }): Promise<{ count: number }> => {
        const current = requests.get(where.id);
        if (!current || current.version !== where.version) return Promise.resolve({ count: 0 });
        requests.set(where.id, {
          ...current,
          state: typeof data.state === "string" ? data.state : current.state,
          prepared: "prepared" in data ? structuredClone(data.prepared) : current.prepared,
          result: "result" in data ? structuredClone(data.result) : current.result,
          leaseToken: "leaseToken" in data ? (data.leaseToken as string | null) : current.leaseToken,
          leaseExpiresAt: "leaseExpiresAt" in data ? (data.leaseExpiresAt as Date | null) : current.leaseExpiresAt,
          version: current.version + 1,
        });
        return Promise.resolve({ count: 1 });
      },
    },
    aiGenerationBinding: {
      create: ({ data }: { data: { fingerprint: string; ownerId: string; payloadHash: string; canonicalRequestId: string; malformed?: boolean } }): Promise<void> => {
        if (bindings.has(data.fingerprint)) throw Object.assign(new Error("duplicate"), { code: "P2002" });
        bindings.set(data.fingerprint, { ...data, malformed: data.malformed ?? false });
        return Promise.resolve();
      },
      findUnique: ({ where }: { where: { fingerprint: string } }): Promise<unknown> =>
        Promise.resolve(structuredClone(bindings.get(where.fingerprint) ?? null)),
    },
  } as unknown as PrismaService;
  return { prisma, requests };
}

describe("Phân loại lỗi AI và chính sách lease (D02)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("phân loại fail-closed mọi lỗi không gắn nhãn, chỉ cho phép mở lại lỗi chắc chắn chưa tính phí", () => {
    const preDispatch = markAiFailure(new BadRequestException("Thiếu cấu hình"), "PRE_DISPATCH_REJECTED");
    const providerRejected = markAiFailure(new HttpException("Rate limited", 429), "PROVIDER_REJECTED_UNBILLED");
    const ambiguous = markAiFailure(new ServiceUnavailableException("Upstream 503"), "REQUIRES_RECONCILIATION");

    expect(classifyAiFailure(preDispatch)).toBe("PRE_DISPATCH_REJECTED");
    expect(canReopenAiClaimAfterFailure(preDispatch)).toBe(true);
    expect(classifyAiFailure(providerRejected)).toBe("PROVIDER_REJECTED_UNBILLED");
    expect(canReopenAiClaimAfterFailure(providerRejected)).toBe(true);

    expect(classifyAiFailure(ambiguous)).toBe("REQUIRES_RECONCILIATION");
    expect(canReopenAiClaimAfterFailure(ambiguous)).toBe(false);
    expect(classifyAiFailure(new Error("socket hang up"))).toBe("REQUIRES_RECONCILIATION");
    expect(canReopenAiClaimAfterFailure(new BadRequestException("Lỗi không có nhãn"))).toBe(false);
    expect(classifyAiFailure(null)).toBe("REQUIRES_RECONCILIATION");

    const now = new Date("2026-11-25T10:00:00.000Z");
    const lease = createAiClaimLease({ leaseMs: 10_000, now: () => now });
    expect(isAiLeaseExpired(lease.leaseExpiresAt, new Date("2026-11-25T10:00:09.999Z"))).toBe(false);
    expect(isAiLeaseExpired(lease.leaseExpiresAt, new Date("2026-11-25T10:00:10.000Z"))).toBe(true);
    expect(isAiLeaseExpired(null, now)).toBe(false);
    expect(hasValidJsonLease({})).toBe(true);
    expect(hasValidJsonLease({ leaseToken: lease.leaseToken, leaseExpiresAt: lease.leaseExpiresAt.toISOString() })).toBe(true);
    expect(hasValidJsonLease({ leaseToken: "", leaseExpiresAt: lease.leaseExpiresAt.toISOString() })).toBe(false);
    expect(hasValidJsonLease({ leaseToken: "tok", leaseExpiresAt: "not-a-date" })).toBe(false);
  });

  it("gắn nhãn phân loại đúng cho lỗi cấu hình, HTTP 400/401/403/404/429 và HTTP 5xx/mất mạng tại AiProviderService", async () => {
    const service = new AiProviderService(undefined, providerConfig);

    // Lỗi cấu hình chưa gửi request -> PRE_DISPATCH_REJECTED.
    const missingTask = await service.resolveTask("DOCUMENT_QA").catch((error: unknown) => error);
    expect(classifyAiFailure(missingTask)).toBe("PRE_DISPATCH_REJECTED");

    const provider = await service.configure(
      { provider: "GEMINI", model: "gemini-2.5-flash", apiKey: "d02-secret-key", enabled: true },
      "usr-admin",
    );
    const task = await service.configureTask("DOCUMENT_CONTEXT", { providerId: provider.id, model: provider.model }, "usr-admin");

    const badMime = await service
      .extractDocumentPages({ name: "doc.doc", mimeType: "application/msword", buffer: Buffer.from("doc") }, task)
      .catch((error: unknown) => error);
    expect(classifyAiFailure(badMime)).toBe("PRE_DISPATCH_REJECTED");

    // Provider trả 400/401/403/404/429 rõ ràng -> PROVIDER_REJECTED_UNBILLED.
    for (const status of [400, 401, 403, 404, 429]) {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status })));
      const error = await service
        .extractDocumentPages({ name: "a.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF") }, task)
        .catch((caught: unknown) => caught);
      expect(classifyAiFailure(error)).toBe("PROVIDER_REJECTED_UNBILLED");
    }

    // Provider trả 500/503 hoặc mất mạng/JSON hỏng -> REQUIRES_RECONCILIATION.
    for (const status of [500, 502, 503]) {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status })));
      const error = await service
        .extractDocumentPages({ name: "a.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF") }, task)
        .catch((caught: unknown) => caught);
      expect(classifyAiFailure(error)).toBe("REQUIRES_RECONCILIATION");
    }

    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network reset")));
    const networkError = await service
      .extractDocumentPages({ name: "a.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF") }, task)
      .catch((caught: unknown) => caught);
    expect(classifyAiFailure(networkError)).toBe("REQUIRES_RECONCILIATION");
  });

  it("chuyển lease hết hạn sang UNCERTAIN và chặn zombie worker ghi đè ở kho bộ ôn tập", async () => {
    let clock = new Date("2026-11-25T10:00:00.000Z");
    const { service, rows } = createStudyStoreWithClock(() => clock, 5_000);
    let finishZombie!: (value: SavedStudyGuide) => void;
    let entered!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const zombieCall = vi.fn(() => {
      entered();
      return new Promise<SavedStudyGuide>((resolve) => {
        finishZombie = resolve;
      });
    });

    const first = service.generate(studyIdentity, zombieCall);
    await started;

    // Lease còn hạn: worker khác bị chặn 409 và trạng thái vẫn là GENERATING.
    clock = new Date("2026-11-25T10:00:04.000Z");
    await expect(service.generate(studyIdentity, zombieCall)).rejects.toMatchObject({ status: 409 });
    expect([...rows.values()][0]?.state).toBe("GENERATING");

    // Sau khi hết lease (mô phỏng crash/restart): chuyển UNCERTAIN và tuyệt đối không gọi lại provider.
    clock = new Date("2026-11-25T10:00:05.000Z");
    await expect(service.generate(studyIdentity, zombieCall)).rejects.toMatchObject({ status: 409 });
    expect([...rows.values()][0]?.state).toBe("UNCERTAIN");
    expect([...rows.values()][0]?.leaseToken).toBeNull();
    expect(zombieCall).toHaveBeenCalledTimes(1);

    // Zombie worker trả kết quả muộn phải bị fencing token từ chối, không ghi đè thành READY.
    finishZombie(studyResult);
    await expect(first).rejects.toMatchObject({ status: 409 });
    expect([...rows.values()][0]?.state).toBe("UNCERTAIN");
  });

  it("chỉ mở lại claim khi gặp lỗi PROVIDER_REJECTED_UNBILLED và khóa UNCERTAIN khi lỗi mơ hồ", async () => {
    const clock = new Date("2026-11-25T10:00:00.000Z");
    const { service } = createStudyStoreWithClock(() => clock, 5_000);

    const rateLimitError = markAiFailure(new HttpException("429 quota", 429), "PROVIDER_REJECTED_UNBILLED");
    const call = vi.fn().mockRejectedValueOnce(rateLimitError).mockResolvedValueOnce(studyResult);

    await expect(service.generate(studyIdentity, call)).rejects.toMatchObject({ status: 429 });
    expect((await service.find(studyIdentity))?.state).toBe("RETRY_AUTHORIZED");
    expect(call).toHaveBeenCalledTimes(1);

    // Người dùng chủ động gọi lại sau khi hết rate limit -> được phép chạy đúng một lần.
    await expect(service.generate(studyIdentity, call)).resolves.toMatchObject(studyResult);
    expect(call).toHaveBeenCalledTimes(2);

    // Ở kho chấm bài: lỗi 429 mở RETRY_AUTHORIZED, lỗi 503 chuyển UNCERTAIN và lease hết hạn chuyển UNCERTAIN.
    let gradingClock = new Date("2026-11-25T10:00:00.000Z");
    const gradingStore = testGradingStore({ leaseMs: 5_000, now: () => gradingClock });
    await expect(gradingStore.generate(gradingIdentity, () => Promise.reject(rateLimitError))).rejects.toMatchObject({ status: 429 });
    expect((await gradingStore.find(gradingIdentity))?.state).toBe("RETRY_AUTHORIZED");

    let finishGrading!: (value: SavedGradingSuggestion) => void;
    let enteredGrading!: () => void;
    const gradingStarted = new Promise<void>((resolve) => {
      enteredGrading = resolve;
    });
    const hanging = gradingStore.generate(gradingIdentity, () => {
      enteredGrading();
      return new Promise<SavedGradingSuggestion>((resolve) => {
        finishGrading = resolve;
      });
    });
    await gradingStarted;

    gradingClock = new Date("2026-11-25T10:00:06.000Z");
    await expect(gradingStore.generate(gradingIdentity, vi.fn())).rejects.toMatchObject({ status: 409 });
    expect((await gradingStore.find(gradingIdentity))?.state).toBe("UNCERTAIN");

    finishGrading(gradingResult);
    await expect(hanging).rejects.toMatchObject({ status: 409 });
    expect((await gradingStore.find(gradingIdentity))?.state).toBe("UNCERTAIN");
  });

  it("áp dụng đồng nhất lease hết hạn và phân loại lỗi cho Extraction, DocumentAnswer và ExamGeneration", async () => {
    const nowRef = { value: new Date("2026-11-25T10:00:00.000Z") };
    const leaseOpts = { leaseMs: 5_000, now: (): Date => nowRef.value };

    // 1. Extraction store: lease hết hạn báo UNCERTAIN khi status() và chuyển UNCERTAIN khi generate().
    const { prisma: ocrPrisma, rows: ocrRows } = extractionDatabase();
    const ocrId = "b".repeat(64);
    const ocrKey = `ai-doc:${ocrId}`;
    const ocrStore = new AiDocumentExtractionStore(ocrPrisma, leaseOpts);
    let releaseOcr!: () => void;
    const pendingOcr = ocrStore.generate(ocrKey, "teacher-1", () => new Promise((resolve) => {
      releaseOcr = (): void => resolve([{ page: 1, text: "OCR" }]);
    }));
    await vi.waitFor(() => expect(ocrRows.has(ocrId)).toBe(true));
    nowRef.value = new Date("2026-11-25T10:00:06.000Z");
    expect(await ocrStore.status(ocrKey)).toEqual({ state: "UNCERTAIN" });
    await expect(ocrStore.generate(ocrKey, "teacher-1", vi.fn())).rejects.toMatchObject({ status: 409 });
    expect(ocrRows.get(ocrId)).toMatchObject({ state: "UNCERTAIN", leaseToken: null, leaseExpiresAt: null });
    releaseOcr();
    await expect(pendingOcr).rejects.toMatchObject({ status: 409 });

    // 2. DocumentAnswer store: lỗi 429 mở RETRY_AUTHORIZED, không khóa vĩnh viễn.
    const { prisma: answerPrisma } = extractionDatabase();
    const answerStore = new AiDocumentAnswerStore(answerPrisma, leaseOpts);
    const quotaError = markAiFailure(new HttpException("429", 429), "PROVIDER_REJECTED_UNBILLED");
    await expect(answerStore.generate(answerIdentity, () => Promise.reject(quotaError))).rejects.toMatchObject({ status: 429 });
    expect(await answerStore.status(answerIdentity)).toEqual({ state: "NOT_REQUESTED" });
    await expect(answerStore.generate(answerIdentity, () => Promise.resolve(answerResult))).resolves.toEqual(answerResult);

    // 3. ExamGeneration store: lỗi 429 trả về CLAIMED; lease GENERATING hết hạn chuyển UNCERTAIN.
    const { prisma: examPrisma, requests: examRows } = createExamRequestDb();
    const examService = new AiGenerationRequestService(examPrisma, leaseOpts);
    /** Giả lập chưa có bản đề thi đã lưu để kiểm tra nhánh gọi provider. */
    const noRecover = (): Promise<undefined> => Promise.resolve(undefined);
    await expect(examService.run("req-429", "owner-1", { k: 1 }, () => Promise.reject(quotaError), vi.fn(), noRecover)).rejects.toMatchObject({ status: 429 });
    expect(examRows.get("req-429")?.state).toBe("CLAIMED");
    await expect(examService.run("req-429", "owner-1", { k: 1 }, () => Promise.resolve(examPrepared), () => Promise.resolve(examResult), noRecover)).resolves.toEqual(examResult);

    nowRef.value = new Date("2026-11-25T10:00:00.000Z");
    let releaseExam!: () => void;
    const hangingExam = examService.run("req-crash", "owner-1", { k: 2 }, () => new Promise((resolve) => {
      releaseExam = (): void => resolve(examPrepared);
    }), () => Promise.resolve(examResult), noRecover);
    await vi.waitFor(() => expect(examRows.get("req-crash")?.state).toBe("GENERATING"));
    nowRef.value = new Date("2026-11-25T10:00:06.000Z");
    await expect(examService.run("req-crash", "owner-1", { k: 2 }, vi.fn(), vi.fn(), noRecover)).rejects.toMatchObject({ status: 409 });
    expect(examRows.get("req-crash")).toMatchObject({ state: "UNCERTAIN", leaseToken: null, leaseExpiresAt: null });
    releaseExam();
    await expect(hangingExam).rejects.toMatchObject({ status: 409 });
  });
});
