import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  Optional,
} from "@nestjs/common";
import { createHash } from "node:crypto";
import type { PrismaService } from "../../../database/prisma.service.js";
import { createAiClaimLease, isAiLeaseExpired } from "../../system/ai/ai-claim-policy.js";
import { AiProviderService, type ExamLanguage } from "../../system/ai/ai-provider.service.js";
import { SystemService } from "../../system/core/system.service.js";
import { LearningRuntimeService } from "../core/learning-runtime.service.js";
import { id } from "../core/learning.shared.js";
import type {
  AiTutorPresetKey,
  AiTutorPresetPrompt,
  ExamAttemptTutorState,
  ExamTutorAskResult,
  ExamTutorQuotaSnapshot,
  ExamTutorTurn,
  LearningQuestion,
} from "../core/learning.types.js";

/** Tập câu hỏi gợi mở Socratic chuẩn hóa cho phép tái sử dụng bộ nhớ đệm giữa các học viên. */
export const AI_TUTOR_PRESETS: readonly AiTutorPresetPrompt[] = Object.freeze([
  {
    key: "CONCEPT_HINT",
    label: "Kiến thức & công thức cần dùng",
    prompt: "Câu hỏi này cần vận dụng khái niệm, định lý hay công thức trọng tâm nào?",
  },
  {
    key: "FIRST_STEP",
    label: "Gợi ý bước đầu tiên",
    prompt: "Em chưa biết bắt đầu từ đâu, hãy gợi ý cho em bước phân tích đầu tiên để làm câu này.",
  },
  {
    key: "KEY_CLUES",
    label: "Dữ kiện quan trọng & bẫy dễ nhầm",
    prompt: "Trong đề bài này có những dữ kiện mấu chốt hay lỗi sai thường gặp nào em cần lưu ý?",
  },
  {
    key: "APPROACH_STRATEGY",
    label: "Chiến lược suy luận & tự kiểm tra",
    prompt: "Hướng dẫn em cách lập luận từng bước và tự kiểm tra tính hợp lý mà không nói đáp án.",
  },
]);

interface MemoryTutorTurn extends ExamTutorTurn {
  attemptId: string;
}

interface ResolvedAttemptQuestionContext {
  examId: string;
  aiTutorEnabled: boolean;
  attemptStatus: "IN_PROGRESS" | "SUBMITTED" | "GRADED";
  deadlinePassed: boolean;
  question?: {
    id: string;
    type: LearningQuestion["type"];
    content: string;
    contentHash: string;
    options: string[];
  };
}

// Loại bỏ ký hiệu đầu dòng A., B), C: khỏi phương án để cache gợi ý không phụ thuộc thứ tự hiển thị.
function stripOptionLabel(option: string): string {
  return option.replace(/^[A-F][.):\s-]+/iu, "").trim();
}

// Băm danh sách phương án đã chuẩn hóa để tự động làm mới cache khi giáo viên sửa lựa chọn.
function computeOptionsHash(options: string[]): string {
  const normalized = options.map(stripOptionLabel).filter(Boolean).sort();
  return createHash("sha256").update(JSON.stringify(normalized)).digest("hex");
}

// Tạo khóa định danh SHA-256 duy nhất cho một câu hỏi ngân hàng và một câu hỏi gợi mở mẫu.
function buildPresetCacheId(
  questionId: string,
  contentHash: string,
  optionsHash: string,
  presetKey: AiTutorPresetKey,
  language: ExamLanguage,
): string {
  return createHash("sha256")
    .update(JSON.stringify(["v1", questionId, contentHash, optionsHash, presetKey, language]))
    .digest("hex");
}

// Tạm dừng ngắn để đợi luồng sinh cache đồng thời hoàn tất thay vì gọi trùng sang AI provider.
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Tổng hợp số lượt đã hỏi theo từng câu và trên toàn đề từ danh sách lượt hỏi đáp của bài làm.
function buildQuotaSnapshot(
  turns: ExamTutorTurn[],
  maxPerQuestion: number,
  maxPerExam: number,
): ExamTutorQuotaSnapshot {
  const questionUsedById: Record<string, number> = {};
  for (const turn of turns) {
    questionUsedById[turn.questionId] = (questionUsedById[turn.questionId] ?? 0) + 1;
  }
  const examUsed = turns.length;
  return {
    maxPerQuestion,
    maxPerExam,
    examUsed,
    examRemaining: Math.max(0, maxPerExam - examUsed),
    questionUsedById,
  };
}

@Injectable()
/** Điều phối gia sư AI dẫn dắt theo từng câu hỏi trong bài làm, tích hợp cache câu hỏi mẫu và kiểm soát quota 2 tầng. */
export class AiExamTutorService {
  private readonly runtime: LearningRuntimeService;
  private readonly activeAttemptLocks = new Set<string>();
  private readonly memoryPresetCache = new Map<string, { reply: string; model: string }>();
  private readonly memoryTurns: MemoryTutorTurn[] = [];

  constructor(
    private readonly aiProviders: AiProviderService,
    private readonly system: SystemService,
    @Optional() runtime?: LearningRuntimeService,
    @Optional() private readonly prisma?: PrismaService,
  ) {
    this.runtime = runtime ?? new LearningRuntimeService();
  }

  /** Trả về trạng thái bật/tắt, danh sách gợi ý mẫu, hạn mức còn lại và lịch sử hỏi đáp theo từng câu của lượt làm bài. */
  async getAttemptTutorState(attemptId: string, learnerId: string): Promise<ExamAttemptTutorState> {
    const context = await this.resolveAttemptContext(attemptId, learnerId);
    const settings = await this.system.getSettings();
    const maxPerQuestion = settings.aiTutorMaxPerQuestion;
    const maxPerExam = settings.aiTutorMaxPerExam;

    if (!context.aiTutorEnabled) {
      return {
        enabled: false,
        presets: [],
        quota: buildQuotaSnapshot([], maxPerQuestion, maxPerExam),
        threads: {},
      };
    }

    const turns = await this.loadAttemptTurns(attemptId);
    const threads: Record<string, ExamTutorTurn[]> = {};
    for (const turn of turns) {
      const bucket = threads[turn.questionId] ?? [];
      bucket.push(turn);
      threads[turn.questionId] = bucket;
    }

    return {
      enabled: true,
      presets: [...AI_TUTOR_PRESETS],
      quota: buildQuotaSnapshot(turns, maxPerQuestion, maxPerExam),
      threads,
    };
  }

  /** Trả về cấu hình gia sư AI và hạn mức khởi tạo cho phiên làm thử của giảng viên phụ trách lớp. */
  async getInstructorPreviewTutorState(
    examId: string,
    instructorId: string,
  ): Promise<ExamAttemptTutorState> {
    const context = await this.resolveInstructorExamContext(examId, instructorId);
    const settings = await this.system.getSettings();
    const maxPerQuestion = settings.aiTutorMaxPerQuestion;
    const maxPerExam = settings.aiTutorMaxPerExam;
    return {
      enabled: context.aiTutorEnabled,
      presets: context.aiTutorEnabled ? [...AI_TUTOR_PRESETS] : [],
      quota: buildQuotaSnapshot([], maxPerQuestion, maxPerExam),
      threads: {},
    };
  }

  /** Phản hồi hỏi đáp Socratic trong chế độ làm thử của giảng viên, dùng chung cache câu mẫu nhưng không ghi lượt thi học viên. */
  async askInstructorPreviewTutor(
    examId: string,
    questionId: string,
    instructorId: string,
    input: {
      presetKey?: AiTutorPresetKey;
      message?: string;
      draftAnswer?: string;
      language?: ExamLanguage;
      priorTurns?: Array<{ userPrompt: string; aiReply: string }>;
    },
  ): Promise<{ turn: ExamTutorTurn; maxPerQuestion: number; maxPerExam: number }> {
    const preset = input.presetKey
      ? AI_TUTOR_PRESETS.find((item) => item.key === input.presetKey)
      : undefined;
    if (input.presetKey && !preset) {
      throw new BadRequestException("Câu hỏi gợi ý mẫu không hợp lệ.");
    }
    const customMessage = input.message?.trim() ?? "";
    if (!preset && (customMessage.length < 2 || customMessage.length > 1_000)) {
      throw new BadRequestException("Nội dung câu hỏi cần từ 2 đến 1.000 ký tự.");
    }

    const context = await this.resolveInstructorExamContext(examId, instructorId, questionId);
    if (!context.aiTutorEnabled) {
      throw new ForbiddenException("Đề kiểm tra này chưa bật tính năng hỏi đáp AI dẫn dắt.");
    }
    if (!context.question) {
      throw new BadRequestException("Câu hỏi không thuộc đề kiểm tra này.");
    }

    const settings = await this.system.getSettings();
    const language: ExamLanguage = input.language ?? "VI";
    const optionTexts = context.question.options.map(stripOptionLabel).filter(Boolean);
    const effectivePrompt = preset ? preset.prompt : customMessage;

    const guidance = preset
      ? await this.resolveOrGeneratePresetGuidance(context.question, optionTexts, preset, language)
      : {
          ...(await this.aiProviders.guideExamQuestion({
            questionType: context.question.type,
            questionContent: context.question.content,
            optionTexts,
            history: (input.priorTurns ?? []).slice(-6).map((turn) => ({
              userPrompt: turn.userPrompt,
              aiReply: turn.aiReply,
            })),
            studentPrompt: effectivePrompt,
            studentDraftAnswer: input.draftAnswer,
            isPresetSharedCache: false,
            language,
          })),
          fromCache: false,
        };

    return {
      turn: {
        id: id("tutor_preview"),
        questionId,
        presetKey: preset?.key ?? null,
        userPrompt: effectivePrompt,
        aiReply: guidance.reply,
        fromCache: guidance.fromCache,
        createdAt: new Date().toISOString(),
      },
      maxPerQuestion: settings.aiTutorMaxPerQuestion,
      maxPerExam: settings.aiTutorMaxPerExam,
    };
  }

  /** Xử lý một lượt hỏi đáp dẫn dắt cho câu hỏi cụ thể, ưu tiên cache câu hỏi mẫu và khóa nguyên tử hạn mức hỏi. */
  async askQuestionTutor(
    attemptId: string,
    questionId: string,
    learnerId: string,
    input: {
      presetKey?: AiTutorPresetKey;
      message?: string;
      draftAnswer?: string;
      language?: ExamLanguage;
    },
  ): Promise<ExamTutorAskResult> {
    const preset = input.presetKey
      ? AI_TUTOR_PRESETS.find((item) => item.key === input.presetKey)
      : undefined;
    if (input.presetKey && !preset) {
      throw new BadRequestException("Câu hỏi gợi ý mẫu không hợp lệ.");
    }
    const customMessage = input.message?.trim() ?? "";
    if (!preset && (customMessage.length < 2 || customMessage.length > 1_000)) {
      throw new BadRequestException("Nội dung câu hỏi cần từ 2 đến 1.000 ký tự.");
    }

    if (this.activeAttemptLocks.has(attemptId)) {
      throw new ConflictException("Trợ lý AI đang phản hồi câu hỏi trước của bạn. Vui lòng đợi giây lát.");
    }

    this.activeAttemptLocks.add(attemptId);
    try {
      const context = await this.resolveAttemptContext(attemptId, learnerId, questionId);
      if (!context.aiTutorEnabled) {
        throw new ForbiddenException("Giảng viên không bật tính năng hỏi đáp AI cho đề này.");
      }
      if (context.attemptStatus !== "IN_PROGRESS") {
        throw new BadRequestException("Bài làm đã nộp nên không thể gửi thêm câu hỏi mới.");
      }
      if (context.deadlinePassed) {
        throw new BadRequestException("Lượt làm bài đã hết thời gian.");
      }
      if (!context.question) {
        throw new BadRequestException("Câu hỏi không thuộc đề kiểm tra này.");
      }

      const settings = await this.system.getSettings();
      const maxPerQuestion = settings.aiTutorMaxPerQuestion;
      const maxPerExam = settings.aiTutorMaxPerExam;
      const existingTurns = await this.loadAttemptTurns(attemptId);
      const questionTurns = existingTurns.filter((item) => item.questionId === questionId);

      // Nếu học viên bấm lại đúng câu gợi ý mẫu đã hỏi ở câu này thì trả lại ngay mà không trừ thêm quota.
      if (preset) {
        const duplicatePresetTurn = questionTurns.find((item) => item.presetKey === preset.key);
        if (duplicatePresetTurn) {
          return {
            turn: duplicatePresetTurn,
            quota: buildQuotaSnapshot(existingTurns, maxPerQuestion, maxPerExam),
          };
        }
      }

      if (questionTurns.length >= maxPerQuestion) {
        throw new BadRequestException("Bạn đã sử dụng hết số lượt hỏi AI cho câu hỏi này.");
      }
      if (existingTurns.length >= maxPerExam) {
        throw new BadRequestException("Bạn đã sử dụng hết tổng số lượt hỏi AI cho bài làm này.");
      }

      const language: ExamLanguage = input.language ?? "VI";
      const optionTexts = context.question.options.map(stripOptionLabel).filter(Boolean);
      const effectivePrompt = preset ? preset.prompt : customMessage;

      const guidance = preset
        ? await this.resolveOrGeneratePresetGuidance(context.question, optionTexts, preset, language)
        : {
            ...(await this.aiProviders.guideExamQuestion({
              questionType: context.question.type,
              questionContent: context.question.content,
              optionTexts,
              history: questionTurns.map((turn) => ({
                userPrompt: turn.userPrompt,
                aiReply: turn.aiReply,
              })),
              studentPrompt: effectivePrompt,
              studentDraftAnswer: input.draftAnswer,
              isPresetSharedCache: false,
              language,
            })),
            fromCache: false,
          };

      return await this.persistTutorTurn({
        attemptId,
        learnerId,
        questionId,
        presetKey: preset?.key ?? null,
        userPrompt: effectivePrompt,
        aiReply: guidance.reply,
        fromCache: guidance.fromCache,
        model: guidance.model,
        maxPerQuestion,
        maxPerExam,
      });
    } finally {
      this.activeAttemptLocks.delete(attemptId);
    }
  }

  /** Đọc câu trả lời dẫn dắt từ bảng cache dùng chung hoặc giữ lease gọi AI đúng một lần cho mọi học viên. */
  private async resolveOrGeneratePresetGuidance(
    question: NonNullable<ResolvedAttemptQuestionContext["question"]>,
    optionTexts: string[],
    preset: AiTutorPresetPrompt,
    language: ExamLanguage,
  ): Promise<{ reply: string; model: string; fromCache: boolean }> {
    const optionsHash = computeOptionsHash(question.options);
    const cacheId = buildPresetCacheId(question.id, question.contentHash, optionsHash, preset.key, language);
    const db = this.database();

    if (!db) {
      const memHit = this.memoryPresetCache.get(cacheId);
      if (memHit) {
        return { reply: memHit.reply, model: memHit.model, fromCache: true };
      }
      const generated = await this.aiProviders.guideExamQuestion({
        questionType: question.type,
        questionContent: question.content,
        optionTexts,
        history: [],
        studentPrompt: preset.prompt,
        isPresetSharedCache: true,
        language,
      });
      this.memoryPresetCache.set(cacheId, generated);
      return { reply: generated.reply, model: generated.model, fromCache: false };
    }

    const existing = await db.aiTutorPresetCache.findUnique({ where: { id: cacheId } });
    if (existing?.state === "READY" && existing.reply?.trim()) {
      return {
        reply: existing.reply,
        model: existing.model ?? "cached",
        fromCache: true,
      };
    }

    const lease = createAiClaimLease();
    let claimed = false;
    let claimedVersion = 1;

    if (!existing) {
      try {
        await db.aiTutorPresetCache.create({
          data: {
            id: cacheId,
            questionId: question.id,
            contentHash: question.contentHash,
            presetKey: preset.key,
            language,
            state: "GENERATING",
            version: 1,
            leaseToken: lease.leaseToken,
            leaseExpiresAt: lease.leaseExpiresAt,
          },
        });
        claimed = true;
        claimedVersion = 1;
      } catch (error) {
        if (!error || typeof error !== "object" || !("code" in error) || error.code !== "P2002") {
          throw error;
        }
      }
    }

    if (!claimed) {
      const latest = await db.aiTutorPresetCache.findUnique({ where: { id: cacheId } });
      if (latest?.state === "READY" && latest.reply?.trim()) {
        return { reply: latest.reply, model: latest.model ?? "cached", fromCache: true };
      }

      const canStealExpiredGenerating =
        latest?.state === "GENERATING" && isAiLeaseExpired(latest.leaseExpiresAt, new Date());
      if (latest && (latest.state === "RETRY_AUTHORIZED" || latest.state === "UNCERTAIN" || canStealExpiredGenerating)) {
        const reopened = await db.aiTutorPresetCache.updateMany({
          where: { id: cacheId, version: latest.version },
          data: {
            state: "GENERATING",
            reply: null,
            leaseToken: lease.leaseToken,
            leaseExpiresAt: lease.leaseExpiresAt,
            version: { increment: 1 },
          },
        });
        if (reopened.count === 1) {
          claimed = true;
          claimedVersion = latest.version + 1;
        }
      }
    }

    // Nếu một học viên khác vừa bấm cùng câu hỏi mẫu vài mili-giây trước, chờ tối đa 3 giây để lấy thẳng bản cache vừa sinh xong.
    if (!claimed) {
      for (let attempt = 0; attempt < 6; attempt += 1) {
        await sleep(500);
        const polled = await db.aiTutorPresetCache.findUnique({ where: { id: cacheId } });
        if (polled?.state === "READY" && polled.reply?.trim()) {
          return { reply: polled.reply, model: polled.model ?? "cached", fromCache: true };
        }
      }
      throw new ConflictException("Gợi ý cho câu hỏi mẫu này đang được chuẩn bị. Vui lòng bấm lại sau vài giây.");
    }

    try {
      const generated = await this.aiProviders.guideExamQuestion({
        questionType: question.type,
        questionContent: question.content,
        optionTexts,
        history: [],
        studentPrompt: preset.prompt,
        isPresetSharedCache: true,
        language,
      });
      await db.aiTutorPresetCache.updateMany({
        where: { id: cacheId, version: claimedVersion, state: "GENERATING", leaseToken: lease.leaseToken },
        data: {
          state: "READY",
          reply: generated.reply,
          model: generated.model,
          leaseToken: null,
          leaseExpiresAt: null,
          version: { increment: 1 },
        },
      });
      return { reply: generated.reply, model: generated.model, fromCache: false };
    } catch (error) {
      await db.aiTutorPresetCache.updateMany({
        where: { id: cacheId, version: claimedVersion, state: "GENERATING", leaseToken: lease.leaseToken },
        data: {
          state: "RETRY_AUTHORIZED",
          reply: null,
          leaseToken: null,
          leaseExpiresAt: null,
          version: { increment: 1 },
        },
      });
      throw error;
    }
  }

  /** Khóa dòng lượt làm bài ngắn hạn để kiểm tra lại hạn mức rồi lưu lượt hỏi đáp mới một cách nguyên tử. */
  private async persistTutorTurn(params: {
    attemptId: string;
    learnerId: string;
    questionId: string;
    presetKey: AiTutorPresetKey | null;
    userPrompt: string;
    aiReply: string;
    fromCache: boolean;
    model: string;
    maxPerQuestion: number;
    maxPerExam: number;
  }): Promise<ExamTutorAskResult> {
    const db = this.database();
    if (db) {
      return db.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM exam_attempts WHERE id = ${params.attemptId} FOR UPDATE`;
        const attempt = await tx.examAttempt.findFirst({
          where: { id: params.attemptId, learnerId: params.learnerId },
          include: { exam: true },
        });
        if (!attempt || attempt.exam.hidden) {
          throw new NotFoundException("Không tìm thấy lượt làm bài.");
        }
        if (!attempt.exam.aiTutorEnabled) {
          throw new ForbiddenException("Giảng viên không bật tính năng hỏi đáp AI cho đề này.");
        }
        if (attempt.status !== "IN_PROGRESS") {
          throw new BadRequestException("Bài làm đã khóa nên không thể ghi nhận lượt hỏi mới.");
        }
        const deadline = this.runtime.context.attemptDeadline(
          attempt.startedAt,
          attempt.exam.durationMinutes,
          attempt.exam.closeAt,
        );
        if (deadline <= new Date()) {
          throw new BadRequestException("Lượt làm bài đã hết thời gian.");
        }

        const existingRows = await tx.examAttemptTutorTurn.findMany({
          where: { attemptId: params.attemptId },
          orderBy: { createdAt: "asc" },
        });
        const questionCount = existingRows.filter((row) => row.questionId === params.questionId).length;
        if (questionCount >= params.maxPerQuestion) {
          throw new BadRequestException("Bạn đã sử dụng hết số lượt hỏi AI cho câu hỏi này.");
        }
        if (existingRows.length >= params.maxPerExam) {
          throw new BadRequestException("Bạn đã sử dụng hết tổng số lượt hỏi AI cho bài làm này.");
        }

        const created = await tx.examAttemptTutorTurn.create({
          data: {
            id: id("tutor-turn"),
            attemptId: params.attemptId,
            questionId: params.questionId,
            presetKey: params.presetKey,
            userPrompt: params.userPrompt,
            aiReply: params.aiReply,
            fromCache: params.fromCache,
            model: params.model,
          },
        });
        const mappedTurns = [...existingRows, created].map((row) => this.mapTurnRow(row));
        return {
          turn: this.mapTurnRow(created),
          quota: buildQuotaSnapshot(mappedTurns, params.maxPerQuestion, params.maxPerExam),
        };
      });
    }

    const memExisting = this.memoryTurns.filter((item) => item.attemptId === params.attemptId);
    const memQuestionCount = memExisting.filter((item) => item.questionId === params.questionId).length;
    if (memQuestionCount >= params.maxPerQuestion) {
      throw new BadRequestException("Bạn đã sử dụng hết số lượt hỏi AI cho câu hỏi này.");
    }
    if (memExisting.length >= params.maxPerExam) {
      throw new BadRequestException("Bạn đã sử dụng hết tổng số lượt hỏi AI cho bài làm này.");
    }

    const createdTurn: MemoryTutorTurn = {
      id: id("tutor-turn"),
      attemptId: params.attemptId,
      questionId: params.questionId,
      presetKey: params.presetKey,
      userPrompt: params.userPrompt,
      aiReply: params.aiReply,
      fromCache: params.fromCache,
      createdAt: new Date().toISOString(),
    };
    this.memoryTurns.push(createdTurn);
    const allTurns: ExamTutorTurn[] = [...memExisting, createdTurn].map(({ attemptId: _unused, ...turn }) => {
      void _unused;
      return turn;
    });
    const { attemptId: _ignored, ...publicTurn } = createdTurn;
    void _ignored;
    return {
      turn: publicTurn,
      quota: buildQuotaSnapshot(allTurns, params.maxPerQuestion, params.maxPerExam),
    };
  }

  /** Xác minh giảng viên phụ trách lớp của đề kiểm tra và nạp nội dung câu hỏi phục vụ chế độ làm thử. */
  private async resolveInstructorExamContext(
    examId: string,
    instructorId: string,
    questionId?: string,
  ): Promise<{
    examId: string;
    aiTutorEnabled: boolean;
    question?: NonNullable<ResolvedAttemptQuestionContext["question"]>;
  }> {
    const db = this.database();
    if (db) {
      const exam = await db.exam.findFirst({
        where: {
          id: examId,
          class: {
            instructors: { some: { instructorId } },
          },
        },
        include: {
          questions: {
            where: { questionId: questionId ?? "" },
            include: { question: true },
            take: questionId ? 1 : 0,
          },
        },
      });
      if (!exam) {
        throw new NotFoundException("Không tìm thấy đề kiểm tra thuộc lớp giảng dạy của bạn.");
      }
      const linkedQuestion = questionId ? exam.questions[0]?.question : undefined;
      return {
        examId: exam.id,
        aiTutorEnabled: exam.aiTutorEnabled,
        question: linkedQuestion
          ? {
              id: linkedQuestion.id,
              type: linkedQuestion.type,
              content: linkedQuestion.content,
              contentHash: linkedQuestion.contentHash,
              options: this.runtime.context.toStringArray(linkedQuestion.options),
            }
          : undefined,
      };
    }

    const exam = this.runtime.context.findExam(examId);
    const classItem = this.runtime.context.findClass(exam.classId);
    if (!classItem.instructorIds.includes(instructorId)) {
      throw new NotFoundException("Không tìm thấy đề kiểm tra thuộc lớp giảng dạy của bạn.");
    }
    const question =
      questionId && exam.questionIds.includes(questionId)
        ? this.runtime.context.questions.find((item) => item.id === questionId)
        : undefined;
    return {
      examId: exam.id,
      aiTutorEnabled: Boolean(exam.aiTutorEnabled),
      question: question
        ? {
            id: question.id,
            type: question.type,
            content: question.content,
            contentHash: this.runtime.context.questionContentHash(question.content),
            options: [...question.options],
          }
        : undefined,
    };
  }

  /** Kiểm tra quyền sở hữu lượt thi, thời hạn làm bài và nạp nội dung câu hỏi thuộc đề từ CSDL hoặc kho nhớ. */
  private async resolveAttemptContext(
    attemptId: string,
    learnerId: string,
    questionId?: string,
  ): Promise<ResolvedAttemptQuestionContext> {
    const db = this.database();
    if (db) {
      const attempt = await db.examAttempt.findFirst({
        where: {
          id: attemptId,
          learnerId,
          exam: {
            hidden: false,
            status: "PUBLISHED",
            class: {
              enrollments: { some: { learnerId, status: "ACTIVE" } },
            },
          },
        },
        include: {
          exam: {
            include: {
              questions: {
                where: { questionId: questionId ?? "" },
                include: { question: true },
                take: questionId ? 1 : 0,
              },
            },
          },
        },
      });
      if (!attempt) {
        throw new NotFoundException("Không tìm thấy lượt làm bài hợp lệ.");
      }
      const deadline = this.runtime.context.attemptDeadline(
        attempt.startedAt,
        attempt.exam.durationMinutes,
        attempt.exam.closeAt,
      );
      const linkedQuestion = questionId ? attempt.exam.questions[0]?.question : undefined;
      return {
        examId: attempt.examId,
        aiTutorEnabled: attempt.exam.aiTutorEnabled,
        attemptStatus: attempt.status,
        deadlinePassed: deadline <= new Date(),
        question: linkedQuestion
          ? {
              id: linkedQuestion.id,
              type: linkedQuestion.type,
              content: linkedQuestion.content,
              contentHash: linkedQuestion.contentHash,
              options: this.runtime.context.toStringArray(linkedQuestion.options),
            }
          : undefined,
      };
    }

    const attempt = this.runtime.context.attempts.find(
      (item) => item.id === attemptId && item.learnerId === learnerId,
    );
    if (!attempt) {
      throw new NotFoundException("Không tìm thấy lượt làm bài hợp lệ.");
    }
    const exam = this.runtime.context.findExam(attempt.examId);
    if (exam.hidden || exam.status !== "PUBLISHED") {
      throw new NotFoundException("Không tìm thấy lượt làm bài hợp lệ.");
    }
    const classItem = this.runtime.context.findClass(exam.classId);
    if (!classItem.learnerIds.includes(learnerId)) {
      throw new NotFoundException("Không tìm thấy lượt làm bài hợp lệ.");
    }
    const deadline = this.runtime.context.attemptDeadline(
      new Date(attempt.startedAt),
      exam.durationMinutes,
      new Date(exam.closeAt),
    );
    const question =
      questionId && exam.questionIds.includes(questionId)
        ? this.runtime.context.questions.find((item) => item.id === questionId)
        : undefined;
    return {
      examId: exam.id,
      aiTutorEnabled: Boolean(exam.aiTutorEnabled),
      attemptStatus: attempt.status,
      deadlinePassed: deadline <= new Date(),
      question: question
        ? {
            id: question.id,
            type: question.type,
            content: question.content,
            contentHash: this.runtime.context.questionContentHash(question.content),
            options: [...question.options],
          }
        : undefined,
    };
  }

  /** Tải toàn bộ lượt hỏi đáp đã lưu của một lượt làm bài theo thứ tự thời gian tăng dần. */
  private async loadAttemptTurns(attemptId: string): Promise<ExamTutorTurn[]> {
    const db = this.database();
    if (db) {
      const rows = await db.examAttemptTutorTurn.findMany({
        where: { attemptId },
        orderBy: { createdAt: "asc" },
      });
      return rows.map((row) => this.mapTurnRow(row));
    }
    return this.memoryTurns
      .filter((item) => item.attemptId === attemptId)
      .map(({ attemptId: _unused, ...turn }) => {
        void _unused;
        return turn;
      });
  }

  /** Ánh xạ bản ghi lượt hỏi đáp trong CSDL sang cấu trúc hợp đồng trả về cho client. */
  private mapTurnRow(row: {
    id: string;
    questionId: string;
    presetKey: string | null;
    userPrompt: string;
    aiReply: string;
    fromCache: boolean;
    createdAt: Date;
  }): ExamTutorTurn {
    const validPreset = AI_TUTOR_PRESETS.some((item) => item.key === row.presetKey)
      ? (row.presetKey as AiTutorPresetKey)
      : null;
    return {
      id: row.id,
      questionId: row.questionId,
      presetKey: validPreset,
      userPrompt: row.userPrompt,
      aiReply: row.aiReply,
      fromCache: row.fromCache,
      createdAt: row.createdAt.toISOString(),
    };
  }

  /** Trả về PrismaService khi kết nối PostgreSQL đang hoạt động, ngược lại dùng bộ nhớ trong cho kiểm thử. */
  private database(): PrismaService | undefined {
    const runtimeDb = this.runtime.context.database();
    if (runtimeDb) return runtimeDb;
    return this.prisma?.isStartupConnectionEnabled() ? this.prisma : undefined;
  }
}
