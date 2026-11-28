"use client";

import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import {
  Bot,
  Check,
  Lightbulb,
  LoaderCircle,
  Send,
  Sparkles,
  Zap,
} from "lucide-react";
import { apiRequest } from "@/lib/api-client";
import type {
  AiTutorPresetKey,
  AiTutorPresetPrompt,
  ExamAttemptTutorState,
  ExamTutorAskResult,
  ExamTutorTurn,
} from "@/lib/learning-types";
import { useI18n } from "@/providers/i18n-provider";
import { RichText } from "@/shared/ui/ui";

const PREVIEW_PRESETS: readonly AiTutorPresetPrompt[] = [
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
];

export interface QuestionAiTutorPanelProps {
  examId?: string;
  attemptId: string | null;
  questionId: string;
  questionNumber: number;
  enabled: boolean;
  isInstructorPreview?: boolean;
  draftAnswer?: string;
  tutorState: ExamAttemptTutorState | null;
  loadingState?: boolean;
  loadStateError?: string | null;
  onRetryLoadState?: () => void;
  onTurnCompleted: (result: ExamTutorAskResult) => void;
}

/** Khung chat gia sư AI Socratic độc lập cho từng câu hỏi, hỗ trợ cả học viên làm bài thật và giảng viên làm thử. */
export function QuestionAiTutorPanel({
  examId,
  attemptId,
  questionId,
  questionNumber,
  enabled,
  isInstructorPreview = false,
  draftAnswer,
  tutorState,
  loadingState = false,
  loadStateError = null,
  onRetryLoadState,
  onTurnCompleted,
}: QuestionAiTutorPanelProps) {
  const { locale } = useI18n();
  const [draftByQuestion, setDraftByQuestion] = useState<Record<string, string>>({});
  const [asking, setAsking] = useState(false);
  const [pendingPresetKey, setPendingPresetKey] = useState<AiTutorPresetKey | null>(null);
  const [askError, setAskError] = useState<string | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);

  const turns = tutorState?.threads[questionId] ?? [];
  const presets = tutorState?.presets.length ? tutorState.presets : PREVIEW_PRESETS;
  const maxPerQuestion = tutorState?.quota.maxPerQuestion ?? 3;
  const maxPerExam = tutorState?.quota.maxPerExam ?? 15;
  const questionUsed = tutorState?.quota.questionUsedById[questionId] ?? turns.length;
  const examUsed = tutorState?.quota.examUsed ?? 0;
  const questionRemaining = Math.max(0, maxPerQuestion - questionUsed);
  const examRemaining = tutorState ? tutorState.quota.examRemaining : Math.max(0, maxPerExam - examUsed);
  const effectiveRemaining = Math.min(questionRemaining, examRemaining);
  const currentInput = draftByQuestion[questionId] ?? "";
  const apiLanguage = locale.startsWith("en") ? "EN" : "VI";

  // Xóa thông báo lỗi tạm thời khi người dùng chuyển sang câu hỏi khác.
  useEffect(() => {
    setAskError(null);
  }, [questionId]);

  // Tự động cuộn khung hội thoại xuống lượt hướng dẫn mới nhất của câu hiện tại.
  useEffect(() => {
    const node = scrollContainerRef.current;
    if (!node) return;
    node.scrollTop = node.scrollHeight;
  }, [questionId, turns.length, asking]);

  if (!enabled) return null;

  // Cập nhật nội dung nháp riêng của câu hỏi đang mở mà không làm ảnh hưởng câu khác.
  const updateQuestionInput = (value: string) => {
    setDraftByQuestion((prev) => ({ ...prev, [questionId]: value }));
    if (askError) setAskError(null);
  };

  // Gửi câu hỏi gợi ý mẫu hoặc câu hỏi tự gõ lên API gia sư AI (tự chọn nhánh học viên hoặc làm thử giảng viên).
  const sendInquiry = async (options: { presetKey?: AiTutorPresetKey; message?: string }) => {
    if (asking) return;
    if (isInstructorPreview ? !examId : !attemptId) return;

    if (!options.presetKey) {
      const trimmed = (options.message ?? "").trim();
      if (trimmed.length < 2) {
        setAskError("Vui lòng nhập câu hỏi ít nhất 2 ký tự hoặc bấm chọn một gợi ý mẫu.");
        return;
      }
      if (trimmed.length > 1000) {
        setAskError("Câu hỏi gửi trợ lý AI tối đa 1.000 ký tự.");
        return;
      }
    }

    if (isInstructorPreview && options.presetKey) {
      const existingPresetTurn = turns.find((item) => item.presetKey === options.presetKey);
      if (existingPresetTurn && tutorState) {
        onTurnCompleted({ turn: existingPresetTurn, quota: tutorState.quota });
        return;
      }
    }

    if (effectiveRemaining <= 0) {
      setAskError(
        questionRemaining <= 0
          ? "Bạn đã sử dụng hết số lượt hỏi AI cho câu hỏi này."
          : "Bạn đã sử dụng hết tổng số lượt hỏi AI cho bài làm này.",
      );
      return;
    }

    setAsking(true);
    setPendingPresetKey(options.presetKey ?? null);
    setAskError(null);
    try {
      if (isInstructorPreview && examId) {
        const previewResult = await apiRequest<{
          turn: ExamTutorTurn;
          maxPerQuestion: number;
          maxPerExam: number;
        }>(
          `/instructor/exams/${encodeURIComponent(examId)}/questions/${encodeURIComponent(questionId)}/ai-tutor`,
          {
            method: "POST",
            roleCode: "INSTRUCTOR",
            body: JSON.stringify({
              ...(options.presetKey
                ? { presetKey: options.presetKey }
                : { message: options.message?.trim() }),
              ...(draftAnswer?.trim() ? { draftAnswer: draftAnswer.trim().slice(0, 1000) } : {}),
              priorTurns: turns.slice(-6).map((turn) => ({
                userPrompt: turn.userPrompt,
                aiReply: turn.aiReply,
              })),
              language: apiLanguage,
            }),
          },
        );

        const nextQuestionUsedById: Record<string, number> = {
          ...(tutorState?.quota.questionUsedById ?? {}),
          [questionId]: questionUsed + 1,
        };
        const nextExamUsed = Object.values(nextQuestionUsedById).reduce((sum, n) => sum + n, 0);

        if (!options.presetKey) {
          setDraftByQuestion((prev) => ({ ...prev, [questionId]: "" }));
        }
        onTurnCompleted({
          turn: previewResult.turn,
          quota: {
            maxPerQuestion: previewResult.maxPerQuestion,
            maxPerExam: previewResult.maxPerExam,
            examUsed: nextExamUsed,
            examRemaining: Math.max(0, previewResult.maxPerExam - nextExamUsed),
            questionUsedById: nextQuestionUsedById,
          },
        });
        return;
      }

      const result = await apiRequest<ExamTutorAskResult>(
        `/learner/exam-attempts/${encodeURIComponent(attemptId!)}/questions/${encodeURIComponent(questionId)}/ai-tutor`,
        {
          method: "POST",
          body: JSON.stringify({
            ...(options.presetKey ? { presetKey: options.presetKey } : { message: options.message?.trim() }),
            ...(draftAnswer?.trim() ? { draftAnswer: draftAnswer.trim().slice(0, 1000) } : {}),
            language: apiLanguage,
          }),
        },
      );
      if (!options.presetKey) {
        setDraftByQuestion((prev) => ({ ...prev, [questionId]: "" }));
      }
      onTurnCompleted(result);
    } catch (error) {
      setAskError(
        error instanceof Error
          ? error.message
          : "Không thể kết nối trợ lý AI lúc này. Lượt hỏi của bạn chưa bị trừ.",
      );
    } finally {
      setAsking(false);
      setPendingPresetKey(null);
    }
  };

  // Xử lý sự kiện submit biểu mẫu hỏi đáp tự do.
  const handleFormSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (effectiveRemaining <= 0 || asking) return;
    void sendInquiry({ message: currentInput });
  };

  // Hỗ trợ nhấn Enter để gửi nhanh và Shift+Enter để xuống dòng trong ô nhập.
  const handleInputKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      if (effectiveRemaining > 0 && !asking && currentInput.trim().length >= 2) {
        void sendInquiry({ message: currentInput });
      }
    }
  };

  return (
    <section
      aria-label={`Gia sư AI dẫn dắt câu ${questionNumber}`}
      className="flex flex-1 min-h-[320px] flex-col overflow-hidden rounded-2xl border border-indigo-200/90 bg-white shadow-xs dark:border-indigo-900/60 dark:bg-[#131520]"
    >
      {/* Thanh tiêu đề và bộ đếm quota 2 tầng */}
      <div className="border-b border-indigo-100 bg-gradient-to-r from-indigo-50/90 via-blue-50/60 to-white px-3.5 py-3 dark:border-indigo-950/80 dark:from-indigo-950/50 dark:via-slate-900 dark:to-[#131520]">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <span className="grid size-7 shrink-0 place-items-center rounded-xl bg-indigo-600 text-white shadow-2xs">
              <Sparkles size={14} />
            </span>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <h4 className="truncate text-xs font-extrabold text-slate-900 dark:text-slate-100">
                  Gia sư AI dẫn dắt · Câu {questionNumber}
                </h4>
                {isInstructorPreview && (
                  <span className="rounded-md bg-emerald-100 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700 dark:bg-emerald-950/70 dark:text-emerald-300">
                    Làm thử
                  </span>
                )}
              </div>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                Gợi mở cách tư duy, không tiết lộ đáp án
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-bold tabular-nums">
            <span
              className={`rounded-lg px-2 py-0.5 border ${
                questionRemaining > 0
                  ? "border-indigo-200 bg-white text-indigo-700 dark:border-indigo-800 dark:bg-indigo-950/60 dark:text-indigo-300"
                  : "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/50 dark:text-rose-300"
              }`}
            >
              Câu này: {questionRemaining}/{maxPerQuestion}
            </span>
            <span
              className={`rounded-lg px-2 py-0.5 border ${
                examRemaining > 0
                  ? "border-slate-200 bg-white text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
                  : "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/50 dark:text-rose-300"
              }`}
            >
              Toàn đề: {examRemaining}/{maxPerExam}
            </span>
          </div>
        </div>
      </div>

      {/* Thân khung hỏi đáp theo từng câu */}
      {loadingState ? (
        <div className="flex flex-1 items-center justify-center gap-2 p-6 text-xs font-semibold text-slate-500">
          <LoaderCircle size={16} className="animate-spin text-indigo-600" />
          <span>Đang tải khung gia sư AI...</span>
        </div>
      ) : loadStateError ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2.5 p-5 text-center text-xs">
          <p className="text-rose-600 dark:text-rose-400 font-semibold">{loadStateError}</p>
          {onRetryLoadState && (
            <button
              type="button"
              onClick={onRetryLoadState}
              className="rounded-xl bg-indigo-600 px-3.5 py-1.5 font-bold text-white hover:bg-indigo-700 cursor-pointer"
            >
              Thử tải lại
            </button>
          )}
        </div>
      ) : (
        <>
          <div ref={scrollContainerRef} className="flex-1 space-y-3 overflow-y-auto p-3.5">
            {/* Cụm câu hỏi dẫn dắt mẫu bấm chọn 1 chạm */}
            <div className="space-y-1.5">
              <p className="text-[11px] font-bold text-slate-500 dark:text-slate-400">
                Chọn nhanh gợi ý dẫn dắt cho Câu {questionNumber}:
              </p>
              <div className="flex flex-wrap gap-1.5">
                {presets.map((preset) => {
                  const alreadyUsed = turns.some((turn) => turn.presetKey === preset.key);
                  const isPendingThis = asking && pendingPresetKey === preset.key;
                  const disabled = asking || alreadyUsed || effectiveRemaining <= 0;
                  return (
                    <button
                      key={preset.key}
                      type="button"
                      disabled={disabled}
                      onClick={() => void sendInquiry({ presetKey: preset.key })}
                      className={`inline-flex items-center gap-1.5 rounded-xl border px-2.5 py-1.5 text-left text-[11px] font-semibold transition-all ${
                        alreadyUsed
                          ? "border-emerald-200 bg-emerald-50/70 text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-300"
                          : disabled
                            ? "border-slate-200 bg-slate-50 text-slate-400 opacity-60 dark:border-slate-800 dark:bg-slate-900"
                            : "border-indigo-200 bg-indigo-50/60 text-indigo-800 hover:border-indigo-400 hover:bg-indigo-100/70 dark:border-indigo-900/70 dark:bg-indigo-950/40 dark:text-indigo-200 dark:hover:border-indigo-700 cursor-pointer"
                      }`}
                    >
                      {isPendingThis ? (
                        <LoaderCircle size={12} className="animate-spin shrink-0 text-indigo-600" />
                      ) : alreadyUsed ? (
                        <Check size={12} className="shrink-0 text-emerald-600 dark:text-emerald-400" />
                      ) : (
                        <Lightbulb size={12} className="shrink-0 text-amber-500" />
                      )}
                      <span>{preset.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Lịch sử trao đổi riêng của câu hỏi hiện tại */}
            {turns.length === 0 && !asking ? (
              <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/60 p-3.5 text-center text-xs text-slate-500 dark:border-slate-800 dark:bg-slate-900/40 dark:text-slate-400">
                Chưa có trao đổi nào ở Câu {questionNumber}. Hãy bấm một câu hỏi mẫu phía trên hoặc nhập vướng mắc của bạn để AI gợi mở cách làm.
              </div>
            ) : (
              <div className="space-y-3 pt-1">
                {turns.map((turn) => (
                  <div key={turn.id} className="space-y-2">
                    <div className="flex justify-end">
                      <div className="max-w-[88%] rounded-2xl rounded-tr-sm bg-indigo-600 px-3 py-2 text-xs text-white shadow-2xs">
                        <p className="whitespace-pre-wrap leading-relaxed">{turn.userPrompt}</p>
                      </div>
                    </div>

                    <div className="flex items-start gap-2">
                      <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-lg bg-indigo-100 text-indigo-700 dark:bg-indigo-950/80 dark:text-indigo-300">
                        <Bot size={13} />
                      </span>
                      <div className="min-w-0 flex-1 rounded-2xl rounded-tl-sm border border-slate-200 bg-slate-50/90 px-3 py-2.5 text-xs text-slate-800 dark:border-slate-800 dark:bg-slate-900/90 dark:text-slate-200">
                        <div className="mb-1 flex items-center justify-between gap-2">
                          <span className="text-[10px] font-extrabold uppercase tracking-wider text-indigo-600 dark:text-indigo-400">
                            Gia sư dẫn dắt
                          </span>
                          {turn.fromCache && (
                            <span className="inline-flex items-center gap-0.5 rounded-full bg-amber-100/80 px-1.5 py-0.5 text-[10px] font-bold text-amber-800 dark:bg-amber-950/60 dark:text-amber-300">
                              <Zap size={10} />
                              <span>Gợi ý tức thì</span>
                            </span>
                          )}
                        </div>
                        <RichText className="text-xs leading-relaxed [&>p:first-child]:mt-0 [&>p:last-child]:mb-0">
                          {turn.aiReply}
                        </RichText>
                      </div>
                    </div>
                  </div>
                ))}

                {asking && (
                  <div className="flex items-center gap-2 rounded-xl border border-indigo-100 bg-indigo-50/50 px-3 py-2 text-xs text-indigo-700 dark:border-indigo-900/50 dark:bg-indigo-950/30 dark:text-indigo-300">
                    <LoaderCircle size={14} className="animate-spin shrink-0" />
                    <span>Gia sư AI đang phân tích hướng dẫn cho bạn...</span>
                  </div>
                )}
              </div>
            )}
          </div>

          {askError && (
            <div
              role="alert"
              className="mx-3.5 mb-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-[11px] font-semibold text-rose-700 dark:border-rose-900/70 dark:bg-rose-950/40 dark:text-rose-300"
            >
              {askError}
            </div>
          )}

          {/* Vùng nhập câu hỏi hoặc thông báo hết hạn mức */}
          <div className="border-t border-slate-200 bg-slate-50/70 p-3 dark:border-slate-800 dark:bg-slate-900/60">
            {questionRemaining <= 0 ? (
              <p className="rounded-xl bg-amber-50 px-3 py-2 text-center text-[11px] font-semibold text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
                Bạn đã dùng hết {maxPerQuestion} lượt hỏi AI cho Câu {questionNumber}. Hãy dựa vào các gợi ý trên để tự hoàn thành câu trả lời.
              </p>
            ) : examRemaining <= 0 ? (
              <p className="rounded-xl bg-amber-50 px-3 py-2 text-center text-[11px] font-semibold text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
                Bạn đã dùng hết tổng cộng {maxPerExam} lượt hỏi AI của bài làm này.
              </p>
            ) : (
              <form onSubmit={handleFormSubmit} className="flex items-end gap-2">
                <textarea
                  aria-label={`Nhập câu hỏi cho gia sư AI ở câu ${questionNumber}`}
                  rows={2}
                  maxLength={1000}
                  disabled={asking}
                  value={currentInput}
                  onChange={(event) => updateQuestionInput(event.target.value)}
                  onKeyDown={handleInputKeyDown}
                  placeholder="Hỏi cách suy luận hoặc nêu bước làm của bạn để AI góp ý..."
                  className="min-w-0 flex-1 resize-none rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/15 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                />
                <button
                  type="submit"
                  aria-label="Gửi câu hỏi tới gia sư AI"
                  disabled={asking || currentInput.trim().length < 2}
                  className="inline-flex h-9 shrink-0 items-center justify-center gap-1 rounded-xl bg-indigo-600 px-3 text-xs font-bold text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-45 cursor-pointer"
                >
                  <Send size={13} />
                  <span>Hỏi</span>
                </button>
              </form>
            )}
          </div>
        </>
      )}
    </section>
  );
}
