import { ForbiddenException, ServiceUnavailableException } from "@nestjs/common";
import type { ConfigService } from "@nestjs/config";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Environment } from "../../src/config/environment.js";
import type { PrismaService } from "../../src/database/prisma.service.js";
import { AiExamTutorService } from "../../src/domains/learning/ai/ai-exam-tutor.service.js";
import { createLearningTestRuntime } from "../../src/domains/learning/core/learning-runtime.service.js";
import { ExamAssessmentService } from "../../src/domains/learning/exams/exam-assessment.service.js";
import { AiProviderService } from "../../src/domains/system/ai/ai-provider.service.js";
import { SystemService } from "../../src/domains/system/core/system.service.js";

const encryptionSecret = "test-tutor-encryption-secret-at-least-32-chars";
const providerConfig = {
  get: (key: string): string | undefined => (key === "AUTH_ENCRYPTION_SECRET" ? encryptionSecret : undefined),
} as unknown as ConfigService<Environment, true>;

interface MockPresetCacheRow {
  id: string;
  questionId: string;
  contentHash: string;
  presetKey: string;
  language: string;
  state: string;
  version: number;
  reply: string | null;
  model: string | null;
  leaseToken: string | null;
  leaseExpiresAt: Date | null;
}

interface MockTutorTurnRow {
  id: string;
  attemptId: string;
  questionId: string;
  presetKey: string | null;
  userPrompt: string;
  aiReply: string;
  fromCache: boolean;
  model: string | null;
  createdAt: Date;
}

/** Khởi tạo bộ dịch vụ kiểm thử gia sư AI trên bộ nhớ trong với hai học viên cùng lớp. */
function createMemoryTutorHarness(): {
  system: SystemService;
  aiProviders: AiProviderService;
  exams: ExamAssessmentService;
  tutor: AiExamTutorService;
  runtime: ReturnType<typeof createLearningTestRuntime>;
} {
  const system = new SystemService();
  const aiProviders = new AiProviderService(undefined, providerConfig);
  const runtime = createLearningTestRuntime({ system });
  runtime.context.classes[0]!.learnerIds.push("usr-learner-2");
  const exams = new ExamAssessmentService(runtime);
  const tutor = new AiExamTutorService(aiProviders, system, runtime);
  return { system, aiProviders, exams, tutor, runtime };
}

/** Khởi tạo giả lập PrismaService để kiểm thử bảng ai_tutor_preset_caches và giao dịch khóa dòng exam_attempts. */
function createMockPrismaTutorHarness(): {
  prisma: PrismaService;
  presetCaches: Map<string, MockPresetCacheRow>;
  tutorTurns: MockTutorTurnRow[];
} {
  const presetCaches = new Map<string, MockPresetCacheRow>();
  const tutorTurns: MockTutorTurnRow[] = [];
  const startedAt = new Date(Date.now() - 60_000);
  const closeAt = new Date(Date.now() + 3_600_000);

  /** Tạo đối tượng dữ liệu bài làm giả lập theo mã lượt thi và học viên. */
  const buildAttemptRecord = (
    attemptId: string,
    learnerId: string,
  ): {
    id: string;
    examId: string;
    learnerId: string;
    status: "IN_PROGRESS";
    startedAt: Date;
    exam: {
      id: string;
      hidden: boolean;
      status: "PUBLISHED";
      aiTutorEnabled: boolean;
      durationMinutes: number;
      closeAt: Date;
      questions: Array<{
        questionId: string;
        question: {
          id: string;
          type: "SINGLE_CHOICE";
          content: string;
          contentHash: string;
          options: string[];
        };
      }>;
    };
  } => ({
    id: attemptId,
    examId: "exam-db-1",
    learnerId,
    status: "IN_PROGRESS" as const,
    startedAt,
    exam: {
      id: "exam-db-1",
      hidden: false,
      status: "PUBLISHED" as const,
      aiTutorEnabled: true,
      durationMinutes: 45,
      closeAt,
      questions: [
        {
          questionId: "q-db-math",
          question: {
            id: "q-db-math",
            type: "SINGLE_CHOICE" as const,
            content: "Giải phương trình $x^2 - 5x + 6 = 0$.",
            contentHash: "hash-q-db-math-v1",
            options: ["A. x = 2 hoặc x = 3", "B. x = -2 hoặc x = -3"],
          },
        },
      ],
    },
  });

  const dbObject = {
    isStartupConnectionEnabled: (): boolean => true,
    $queryRaw: (): Promise<Array<{ id: string }>> => Promise.resolve([{ id: "locked" }]),
    $transaction: async <T>(callback: (tx: unknown) => Promise<T>): Promise<T> => callback(dbObject),
    examAttempt: {
      findFirst: ({ where }: { where: { id: string; learnerId: string } }): Promise<unknown> =>
        Promise.resolve(buildAttemptRecord(where.id, where.learnerId)),
    },
    aiTutorPresetCache: {
      findUnique: ({ where }: { where: { id: string } }): Promise<MockPresetCacheRow | null> =>
        Promise.resolve(structuredClone(presetCaches.get(where.id) ?? null)),
      create: ({ data }: { data: Omit<MockPresetCacheRow, "reply" | "model"> }): Promise<MockPresetCacheRow> => {
        if (presetCaches.has(data.id)) {
          return Promise.reject(Object.assign(new Error("Duplicate preset cache"), { code: "P2002" }));
        }
        const created: MockPresetCacheRow = { ...structuredClone(data), reply: null, model: null };
        presetCaches.set(data.id, created);
        return Promise.resolve(structuredClone(created));
      },
      updateMany: ({
        where,
        data,
      }: {
        where: { id: string; version: number; state?: string; leaseToken?: string };
        data: Record<string, unknown>;
      }): Promise<{ count: number }> => {
        const current = presetCaches.get(where.id);
        if (!current || current.version !== where.version) return Promise.resolve({ count: 0 });
        if (where.state && current.state !== where.state) return Promise.resolve({ count: 0 });
        if (where.leaseToken && current.leaseToken !== where.leaseToken) return Promise.resolve({ count: 0 });
        const next: MockPresetCacheRow = {
          ...current,
          state: typeof data.state === "string" ? data.state : current.state,
          reply: "reply" in data ? (data.reply as string | null) : current.reply,
          model: "model" in data ? (data.model as string | null) : current.model,
          leaseToken: "leaseToken" in data ? (data.leaseToken as string | null) : current.leaseToken,
          leaseExpiresAt: "leaseExpiresAt" in data ? (data.leaseExpiresAt as Date | null) : current.leaseExpiresAt,
          version: current.version + 1,
        };
        presetCaches.set(where.id, next);
        return Promise.resolve({ count: 1 });
      },
    },
    examAttemptTutorTurn: {
      findMany: ({ where }: { where: { attemptId: string } }): Promise<MockTutorTurnRow[]> =>
        Promise.resolve(structuredClone(tutorTurns.filter((item) => item.attemptId === where.attemptId))),
      create: ({ data }: { data: Omit<MockTutorTurnRow, "createdAt"> }): Promise<MockTutorTurnRow> => {
        const row: MockTutorTurnRow = { ...structuredClone(data), createdAt: new Date() };
        tutorTurns.push(row);
        return Promise.resolve(structuredClone(row));
      },
    },
  };

  return {
    prisma: dbObject as unknown as PrismaService,
    presetCaches,
    tutorTurns,
  };
}

describe("Gia sư AI dẫn dắt theo câu hỏi (AiExamTutorService & SystemService)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("xác thực cấu hình quota hỏi đáp AI hai tầng phía Admin (mỗi câu và tổng đề)", async () => {
    const system = new SystemService();
    const initial = await system.getSettings();
    expect(initial.aiTutorMaxPerQuestion).toBe(3);
    expect(initial.aiTutorMaxPerExam).toBe(15);

    await expect(
      system.updateSettings({ aiTutorMaxPerQuestion: 0 }, "usr-admin"),
    ).rejects.toThrow("Giới hạn hỏi AI mỗi câu phải từ 1 đến 20 lượt.");

    await expect(
      system.updateSettings({ aiTutorMaxPerExam: 205 }, "usr-admin"),
    ).rejects.toThrow("Giới hạn hỏi AI mỗi đề phải từ 1 đến 200 lượt.");

    await expect(
      system.updateSettings({ aiTutorMaxPerQuestion: 8, aiTutorMaxPerExam: 5 }, "usr-admin"),
    ).rejects.toThrow("Giới hạn hỏi AI mỗi đề không được nhỏ hơn giới hạn của một câu hỏi.");

    const updated = await system.updateSettings(
      { aiTutorMaxPerQuestion: 4, aiTutorMaxPerExam: 12 },
      "usr-admin",
    );
    expect(updated.aiTutorMaxPerQuestion).toBe(4);
    expect(updated.aiTutorMaxPerExam).toBe(12);
  });

  it("chặn hoàn toàn hỏi đáp AI khi giảng viên không tích bật aiTutorEnabled trên đề thi", async () => {
    const { exams, tutor, aiProviders } = createMemoryTutorHarness();
    const guideSpy = vi.spyOn(aiProviders, "guideExamQuestion");

    const disabledExam = await exams.createExam(
      {
        classId: "class-web-01",
        title: "Đề không bật AI",
        durationMinutes: 30,
        openAt: new Date(Date.now() - 60_000).toISOString(),
        closeAt: new Date(Date.now() + 3_600_000).toISOString(),
        totalScore: 10,
        attemptLimit: 2,
        shuffleQuestions: false,
        aiTutorEnabled: false,
        questionIds: ["q-rest-01", "q-db-01"],
      },
      "usr-instructor",
    );
    await exams.submitExamForReview(disabledExam.id, "usr-instructor", true, undefined, true);
    const attempt = await exams.startAttempt(disabledExam.id, "usr-learner");

    const state = await tutor.getAttemptTutorState(attempt.id, "usr-learner");
    expect(state.enabled).toBe(false);
    expect(state.presets).toEqual([]);

    await expect(
      tutor.askQuestionTutor(attempt.id, "q-rest-01", "usr-learner", { presetKey: "FIRST_STEP" }),
    ).rejects.toThrow(ForbiddenException);
    expect(guideSpy).not.toHaveBeenCalled();
  });

  it("tách biệt khung chat theo câu, tái sử dụng cache câu hỏi mẫu giữa các học viên và kiểm soát quota 2 tầng", async () => {
    const { system, exams, tutor, aiProviders, runtime } = createMemoryTutorHarness();
    await system.updateSettings({ aiTutorMaxPerQuestion: 2, aiTutorMaxPerExam: 3 }, "usr-admin");

    const guideSpy = vi.spyOn(aiProviders, "guideExamQuestion").mockImplementation((input) =>
      Promise.resolve({
        reply: `Hướng dẫn cho "${input.studentPrompt.slice(0, 24)}": Hãy phân tích bản chất từng phương thức HTTP.\n\n**Câu hỏi gợi mở:** Phương thức nào dùng để cập nhật một phần tài nguyên?`,
        model: "gemini-2.5-flash",
      }),
    );

    const enabledExam = await exams.createExam(
      {
        classId: "class-web-01",
        title: "Đề có bật gia sư AI",
        durationMinutes: 45,
        openAt: new Date(Date.now() - 60_000).toISOString(),
        closeAt: new Date(Date.now() + 3_600_000).toISOString(),
        totalScore: 10,
        attemptLimit: 2,
        shuffleQuestions: false,
        aiTutorEnabled: true,
        questionIds: ["q-rest-01", "q-db-01"],
      },
      "usr-instructor",
    );
    expect(enabledExam.aiTutorEnabled).toBe(true);
    await exams.submitExamForReview(enabledExam.id, "usr-instructor", true, undefined, true);

    const attempt1 = await exams.startAttempt(enabledExam.id, "usr-learner");
    const attempt2 = await exams.startAttempt(enabledExam.id, "usr-learner-2");

    // Học viên 1 bấm câu hỏi mẫu FIRST_STEP ở câu 1 -> gọi AI lần đầu và lưu cache.
    const firstTurn = await tutor.askQuestionTutor(attempt1.id, "q-rest-01", "usr-learner", {
      presetKey: "FIRST_STEP",
    });
    expect(firstTurn.turn.fromCache).toBe(false);
    expect(firstTurn.quota).toMatchObject({
      maxPerQuestion: 2,
      maxPerExam: 3,
      examUsed: 1,
      examRemaining: 2,
      questionUsedById: { "q-rest-01": 1 },
    });
    expect(guideSpy).toHaveBeenCalledTimes(1);

    // Học viên 1 bấm lại đúng câu hỏi mẫu FIRST_STEP ở cùng câu 1 -> idempotent, không trừ thêm quota.
    const replaySamePreset = await tutor.askQuestionTutor(attempt1.id, "q-rest-01", "usr-learner", {
      presetKey: "FIRST_STEP",
    });
    expect(replaySamePreset.turn.id).toBe(firstTurn.turn.id);
    expect(replaySamePreset.quota.examUsed).toBe(1);
    expect(guideSpy).toHaveBeenCalledTimes(1);

    // Học viên 2 ở lượt làm bài khác bấm cùng câu hỏi mẫu FIRST_STEP trên cùng câu 1 -> lấy từ cache dùng chung, không gọi AI lại!
    const learner2Turn = await tutor.askQuestionTutor(attempt2.id, "q-rest-01", "usr-learner-2", {
      presetKey: "FIRST_STEP",
    });
    expect(learner2Turn.turn.fromCache).toBe(true);
    expect(learner2Turn.turn.aiReply).toBe(firstTurn.turn.aiReply);
    expect(learner2Turn.quota.examUsed).toBe(1);
    expect(guideSpy).toHaveBeenCalledTimes(1);

    // Học viên 1 đặt câu hỏi tự do thứ 2 ở câu 1 -> chạm trần quota câu 1 (2/2).
    const secondTurnQ1 = await tutor.askQuestionTutor(attempt1.id, "q-rest-01", "usr-learner", {
      message: "Em phân vân giữa PUT và PATCH thì khác nhau ở điểm nào?",
      draftAnswer: "PUT",
    });
    expect(secondTurnQ1.turn.fromCache).toBe(false);
    expect(secondTurnQ1.quota).toMatchObject({
      examUsed: 2,
      examRemaining: 1,
      questionUsedById: { "q-rest-01": 2 },
    });
    expect(guideSpy).toHaveBeenCalledTimes(2);

    // Hỏi lần 3 ở câu 1 bị chặn bởi quota câu dù toàn đề vẫn còn 1 lượt.
    await expect(
      tutor.askQuestionTutor(attempt1.id, "q-rest-01", "usr-learner", {
        message: "Cho em hỏi thêm một ý nữa ở câu 1?",
      }),
    ).rejects.toThrow("Bạn đã sử dụng hết số lượt hỏi AI cho câu hỏi này.");

    // Sang câu 2: lịch sử câu 2 rỗng và hỏi được thêm 1 lượt cuối cùng của toàn đề (3/3).
    const firstTurnQ2 = await tutor.askQuestionTutor(attempt1.id, "q-db-01", "usr-learner", {
      presetKey: "CONCEPT_HINT",
    });
    expect(firstTurnQ2.quota).toMatchObject({
      examUsed: 3,
      examRemaining: 0,
      questionUsedById: { "q-rest-01": 2, "q-db-01": 1 },
    });

    // Hỏi tiếp ở câu 2 bị chặn bởi quota tổng toàn đề.
    await expect(
      tutor.askQuestionTutor(attempt1.id, "q-db-01", "usr-learner", {
        message: "Em muốn hỏi thêm ở câu 2?",
      }),
    ).rejects.toThrow("Bạn đã sử dụng hết tổng số lượt hỏi AI cho bài làm này.");

    // Kiểm tra trạng thái lưu tách biệt luồng chat theo từng câu hỏi.
    const savedState = await tutor.getAttemptTutorState(attempt1.id, "usr-learner");
    expect(savedState.threads["q-rest-01"]).toHaveLength(2);
    expect(savedState.threads["q-db-01"]).toHaveLength(1);

    // Khi nội dung câu hỏi ngân hàng thay đổi, khóa cache tự động đổi và gọi lại AI cho câu mẫu.
    const targetQuestion = runtime.context.questions.find((q) => q.id === "q-rest-01")!;
    targetQuestion.content = `${targetQuestion.content} (cập nhật tình huống mới)`;
    const afterEditTurn = await tutor.askQuestionTutor(attempt2.id, "q-rest-01", "usr-learner-2", {
      presetKey: "CONCEPT_HINT",
    });
    expect(afterEditTurn.turn.fromCache).toBe(false);
  });

  it("lưu bền vững cache câu hỏi mẫu vào ai_tutor_preset_caches và không trừ quota khi AI lỗi", async () => {
    const system = new SystemService();
    const aiProviders = new AiProviderService(undefined, providerConfig);
    const { prisma, presetCaches, tutorTurns } = createMockPrismaTutorHarness();
    const runtime = createLearningTestRuntime({ system });
    const tutor = new AiExamTutorService(aiProviders, system, runtime, prisma);

    const guideSpy = vi
      .spyOn(aiProviders, "guideExamQuestion")
      .mockRejectedValueOnce(new ServiceUnavailableException("Provider tạm thời quá tải"))
      .mockResolvedValueOnce({
        reply: "Hãy phân tích tam thức thành nhân tử $(x - 2)(x - 3) = 0$.\n\n**Câu hỏi gợi mở:** Tích bằng 0 khi nào?",
        model: "gemini-2.5-flash",
      });

    // Lần 1: Provider lỗi -> không trừ quota, bản ghi cache chuyển sang RETRY_AUTHORIZED để lần sau thử lại được.
    await expect(
      tutor.askQuestionTutor("attempt-db-1", "q-db-math", "usr-learner-a", { presetKey: "FIRST_STEP" }),
    ).rejects.toThrow(ServiceUnavailableException);
    expect(tutorTurns).toHaveLength(0);
    expect([...presetCaches.values()][0]?.state).toBe("RETRY_AUTHORIZED");

    // Lần 2: Thử lại thành công -> lưu READY vào ai_tutor_preset_caches.
    const turnA = await tutor.askQuestionTutor("attempt-db-1", "q-db-math", "usr-learner-a", {
      presetKey: "FIRST_STEP",
    });
    expect(turnA.turn.fromCache).toBe(false);
    expect([...presetCaches.values()][0]?.state).toBe("READY");
    expect(guideSpy).toHaveBeenCalledTimes(2);

    // Lần 3: Học viên B hỏi cùng câu mẫu trên DB -> lấy ngay từ bảng ai_tutor_preset_caches, không gọi thêm AI.
    const turnB = await tutor.askQuestionTutor("attempt-db-2", "q-db-math", "usr-learner-b", {
      presetKey: "FIRST_STEP",
    });
    expect(turnB.turn.fromCache).toBe(true);
    expect(turnB.turn.aiReply).toBe(turnA.turn.aiReply);
    expect(guideSpy).toHaveBeenCalledTimes(2);
  });

  it("chặn phản hồi AI làm lộ đáp án trực tiếp và tuyệt đối không gửi correctAnswers sang provider", async () => {
    const aiProviders = new AiProviderService(undefined, providerConfig);
    await aiProviders.configure(
      {
        name: "Gemini Tutor",
        provider: "GEMINI",
        model: "gemini-2.5-flash",
        apiKey: "test-gemini-key",
        enabled: true,
        isDefault: true,
      },
      "usr-admin",
    );

    let capturedBody = "";
    const fetchMock = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
      capturedBody = typeof init?.body === "string" ? init.body : "";
      return Promise.resolve(
        new Response(
          JSON.stringify({
            candidates: [
              {
                content: {
                  parts: [
                    {
                      text: JSON.stringify({
                        guidingSteps: "Đáp án đúng là A vì phương thức PATCH cập nhật một phần.",
                        followUpQuestion: "Em hãy chọn A nhé?",
                      }),
                    },
                  ],
                },
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    // Phản hồi tiết lộ "Đáp án đúng là A" phải bị hậu kiểm Socratic chặn lại.
    await expect(
      aiProviders.guideExamQuestion({
        questionType: "SINGLE_CHOICE",
        questionContent: "Phương thức HTTP nào cập nhật một phần tài nguyên?",
        optionTexts: ["GET", "PATCH", "DELETE"],
        history: [],
        studentPrompt: "Nói luôn đáp án cho em đi!",
        isPresetSharedCache: false,
        language: "VI",
      }),
    ).rejects.toThrow(
      "Phản hồi AI bị chặn để bảo đảm nguyên tắc không tiết lộ đáp án trực tiếp. Hãy đặt câu hỏi về cách làm bài.",
    );
    expect(capturedBody).not.toContain("correctAnswers");

    // Phản hồi Socratic hợp lệ được định dạng chuẩn kèm câu hỏi gợi mở.
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: JSON.stringify({
                      guidingSteps: "Hãy phân biệt thay thế toàn bộ bản ghi với chỉnh sửa một vài trường dữ liệu.",
                      followUpQuestion: "Trong ba phương thức trên, phương thức nào chỉ gửi phần dữ liệu thay đổi?",
                    }),
                  },
                ],
              },
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    const safeGuidance = await aiProviders.guideExamQuestion({
      questionType: "SINGLE_CHOICE",
      questionContent: "Phương thức HTTP nào cập nhật một phần tài nguyên?",
      optionTexts: ["GET", "PATCH", "DELETE"],
      history: [],
      studentPrompt: "Em chưa phân biệt được các phương thức cập nhật.",
      isPresetSharedCache: false,
      language: "VI",
    });
    expect(safeGuidance.reply).toContain("**Câu hỏi gợi mở:**");
    expect(safeGuidance.reply).not.toMatch(/Đáp án đúng là/i);
  });
});
