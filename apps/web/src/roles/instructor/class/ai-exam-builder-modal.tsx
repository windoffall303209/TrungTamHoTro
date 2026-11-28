"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  FileCheck2,
  LoaderCircle,
  Plus,
  Sparkles,
  Trash2,
  Wand2,
  X,
} from "lucide-react";
import {
  defaultDueAt,
  distributeEqualQuestionScores,
  type AssignmentBuilderModalProps,
  type ParsedQuestionItem,
} from "@/features/exams/assignment-builder-modal";
import { apiRequest } from "@/lib/api-client";
import type { RoleCode } from "@/lib/app-types";
import { toLocalDateTimeInput } from "@/lib/date-time";
import { useApp } from "@/providers/app-provider";
import { RichText } from "@/shared/ui/ui";

export type AiAssignmentMode = "MULTIPLE_CHOICE" | "ESSAY";

interface DraftAiApiQuestion {
  type: "SINGLE_CHOICE" | "MULTIPLE_CHOICE" | "TRUE_FALSE" | "SHORT_ANSWER" | "ESSAY";
  content: string;
  options?: string[];
  correctAnswers?: string[];
  difficulty?: 1 | 2 | 3;
  tags?: string[];
  confidence?: number;
  warnings?: string[];
}

interface DraftAiExamResponse {
  courseId: string;
  providerId: string;
  provider: string;
  model: string;
  questions: DraftAiApiQuestion[];
  context: {
    mode: "COURSE_MATERIALS" | "WEB_SEARCH";
    materialIds: string[];
    materialNames: string[];
    sources: Array<{ title: string; url: string }>;
  };
  warnings: string[];
}

interface EditableAiDraftQuestion {
  id: string;
  content: string;
  options: string[];
  correctIndex: number;
  gradingGuide: string;
  difficulty: 1 | 2 | 3;
  score: number;
  warnings: string[];
}

export interface AiExamBuilderModalProps {
  open: boolean;
  initialMode: AiAssignmentMode;
  classId: string;
  defaultSubject?: string;
  targetClassEndAt?: string;
  roleCode: RoleCode;
  onClose: () => void;
  onBackToHub?: () => void;
  onSaveAssignment: AssignmentBuilderModalProps["onSaveAssignment"];
}

const fieldInputClass =
  "w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs sm:text-sm text-slate-900 outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/15 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100";

const SUBJECT_SUGGESTIONS = [
  "Toán học",
  "Vật lý",
  "Hóa học",
  "Sinh học",
  "Tiếng Anh",
  "Ngữ văn",
  "Tin học",
  "Lịch sử",
  "Địa lý",
];

// Bóc bỏ tiền tố A., B) thừa đầu phương án do AI sinh để hiển thị gọn trong ô chỉnh sửa.
function stripLeadingOptionPrefix(raw: string, index: number): string {
  const cleaned = raw.trim().replace(/\*\*/g, "");
  const expectedLetter = String.fromCharCode(65 + index);
  const match = cleaned.match(/^([A-F])[.:)]\s+(.+)$/iu);
  if (match && match[1]!.toUpperCase() === expectedLetter) {
    return match[2]!.trim();
  }
  return cleaned;
}

// Chia đều tổng 10 điểm cho toàn bộ câu hỏi AI trong danh sách hiện tại.
function rebalanceAiDraftScores(
  items: EditableAiDraftQuestion[],
  targetTotal = 10,
): EditableAiDraftQuestion[] {
  const scores = distributeEqualQuestionScores(items.length, targetTotal);
  return items.map((item, idx) => ({
    ...item,
    score: scores[idx] ?? 1,
  }));
}

// Chuyển câu hỏi AI trả về sang cấu trúc thẻ nháp cho phép giảng viên sửa toàn diện trước khi phát hành.
function mapDraftQuestionToEditable(
  raw: DraftAiApiQuestion,
  mode: AiAssignmentMode,
): EditableAiDraftQuestion {
  if (mode === "ESSAY") {
    return {
      id: crypto.randomUUID(),
      content: (raw.content ?? "").trim(),
      options: [],
      correctIndex: 0,
      gradingGuide: (raw.correctAnswers ?? []).map((item) => item.trim()).filter(Boolean).join("\n"),
      difficulty: raw.difficulty ?? 2,
      score: 2,
      warnings: [...(raw.warnings ?? [])],
    };
  }

  const baseOptions =
    raw.options && raw.options.length >= 2 ? raw.options.slice(0, 6) : ["", "", "", ""];
  const options = baseOptions.map((opt, idx) => stripLeadingOptionPrefix(opt ?? "", idx));
  const firstAnswer = (raw.correctAnswers?.[0] ?? "").replace(/\*\*/g, "").trim();
  let correctIndex = options.findIndex(
    (opt) => opt.trim().toLocaleLowerCase() === firstAnswer.toLocaleLowerCase(),
  );
  if (correctIndex < 0) {
    const rawMatch = (raw.options ?? []).findIndex(
      (opt) => opt.trim().toLocaleLowerCase() === firstAnswer.toLocaleLowerCase(),
    );
    if (rawMatch >= 0 && rawMatch < options.length) {
      correctIndex = rawMatch;
    } else {
      const letterMatch = firstAnswer.match(/^([A-F])(?:[.:)]\s*(.*))?$/iu);
      if (letterMatch) {
        const candidate = letterMatch[1]!.toUpperCase().charCodeAt(0) - 65;
        if (candidate >= 0 && candidate < options.length) correctIndex = candidate;
      }
    }
  }

  const warnings = [...(raw.warnings ?? [])];
  if (correctIndex < 0) {
    warnings.push("AI chưa khớp rõ đáp án đúng; hệ thống tạm chọn A, vui lòng kiểm tra lại.");
    correctIndex = 0;
  }

  return {
    id: crypto.randomUUID(),
    content: (raw.content ?? "").trim(),
    options,
    correctIndex,
    gradingGuide: "",
    difficulty: raw.difficulty ?? 2,
    score: 2,
    warnings,
  };
}

// Khởi tạo thẻ câu hỏi trắng để giảng viên thêm câu hỏi thủ công vào đề AI đang soạn.
function createBlankAiQuestion(mode: AiAssignmentMode): EditableAiDraftQuestion {
  return {
    id: crypto.randomUUID(),
    content: "",
    options: mode === "ESSAY" ? [] : ["", "", "", ""],
    correctIndex: 0,
    gradingGuide: "",
    difficulty: 2,
    score: 2,
    warnings: [],
  };
}

/** Modal tạo đề bằng AI khóa chặt theo loại đề đã chọn (Trắc nghiệm hoặc Tự luận), hỗ trợ duyệt sửa câu hỏi và quay lại chọn cách tạo khác. */
export function AiExamBuilderModal({
  open,
  initialMode,
  classId,
  defaultSubject,
  targetClassEndAt,
  roleCode,
  onClose,
  onBackToHub,
  onSaveAssignment,
}: AiExamBuilderModalProps) {
  const { notify } = useApp();
  const openedRef = useRef(false);
  const mode: AiAssignmentMode = initialMode;

  const [subject, setSubject] = useState(defaultSubject || "Toán học");
  const [topic, setTopic] = useState("Hàm số & Khảo sát đồ thị");
  const [questionCount, setQuestionCount] = useState(mode === "ESSAY" ? 3 : 5);
  const [difficulty, setDifficulty] = useState<1 | 2 | 3>(2);
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);

  const [questions, setQuestions] = useState<EditableAiDraftQuestion[]>([]);
  const [customScoresEdited, setCustomScoresEdited] = useState(false);
  const [aiMeta, setAiMeta] = useState<{
    provider: string;
    model: string;
    materialNames: string[];
    warnings: string[];
  } | null>(null);

  // Cấu hình phát hành bài tập
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [dueAt, setDueAt] = useState(() => defaultDueAt(targetClassEndAt));
  const [durationMinutes, setDurationMinutes] = useState(45);
  const [maxAttempts, setMaxAttempts] = useState(1);
  const [shuffleQuestions, setShuffleQuestions] = useState(false);
  const [aiTutorEnabled, setAiTutorEnabled] = useState(false);
  const [essayMaxScore, setEssayMaxScore] = useState(10);

  const totalObjectiveScore = useMemo(
    () =>
      Math.round(
        questions.reduce((sum, item) => sum + (Number(item.score) || 0), 0) * 100,
      ) / 100,
    [questions],
  );

  // Khởi tạo phiên mới hoàn toàn theo đúng loại đề (Trắc nghiệm hoặc Tự luận) mỗi khi mở modal.
  useEffect(() => {
    if (!open) {
      openedRef.current = false;
      return;
    }
    if (!openedRef.current) {
      openedRef.current = true;
      setSubject(defaultSubject || "Toán học");
      setQuestionCount(initialMode === "ESSAY" ? 3 : 5);
      setQuestions([]);
      setCustomScoresEdited(false);
      setAiMeta(null);
      setTitle("");
      setDescription("");
      setDueAt(defaultDueAt(targetClassEndAt));
      setDurationMinutes(45);
      setMaxAttempts(1);
      setShuffleQuestions(false);
      setAiTutorEnabled(false);
      setEssayMaxScore(10);
    }
  }, [defaultSubject, initialMode, open, targetClassEndAt]);

  if (!open) return null;

  // Gọi API sinh bản nháp câu hỏi AI và đưa vào cột bên phải để giảng viên kiểm tra, chỉnh sửa.
  const handleGenerateDraftQuestions = async () => {
    if (generating || saving) return;
    const cleanSubject = subject.trim();
    const cleanTopic = topic.trim();
    if (cleanSubject.length < 2) {
      notify("Vui lòng nhập tên môn học hợp lệ.", "error");
      return;
    }
    if (cleanTopic.length < 5) {
      notify("Chuyên đề / bài học cần ít nhất 5 ký tự để AI bám sát nội dung.", "error");
      return;
    }
    if (!Number.isInteger(questionCount) || questionCount < 1 || questionCount > 30) {
      notify("Số lượng câu hỏi mỗi lần sinh cần nằm trong khoảng 1–30.", "error");
      return;
    }

    setGenerating(true);
    try {
      const response = await apiRequest<DraftAiExamResponse>("/instructor/exams/ai-draft", {
        method: "POST",
        roleCode,
        body: JSON.stringify({
          classId,
          focus: `${cleanSubject}: ${cleanTopic}`,
          difficulty,
          distribution: [
            {
              type: mode === "ESSAY" ? "ESSAY" : "SINGLE_CHOICE",
              count: questionCount,
            },
          ],
          contextMode: "AUTO",
        }),
      });

      const mapped = (response.questions ?? []).map((q) =>
        mapDraftQuestionToEditable(q, mode),
      );
      if (!mapped.length) {
        throw new Error("AI chưa trả về câu hỏi nào. Vui lòng thử lại với chuyên đề cụ thể hơn.");
      }

      setQuestions((prev) => {
        const combined = [...prev, ...mapped];
        return mode === "MULTIPLE_CHOICE" && !customScoresEdited
          ? rebalanceAiDraftScores(combined, 10)
          : combined;
      });
      setAiMeta({
        provider: response.provider,
        model: response.model,
        materialNames: response.context?.materialNames ?? [],
        warnings: response.warnings ?? [],
      });
      setTitle((prev) =>
        prev.trim()
          ? prev
          : `${mode === "ESSAY" ? "Bài tự luận AI" : "Đề AI"}: ${cleanTopic} (${cleanSubject})`,
      );
      notify(
        `AI đã sinh ${mapped.length} câu ${mode === "ESSAY" ? "tự luận" : "trắc nghiệm"} nháp. Hãy xem và chỉnh sửa ở khung bên phải trước khi duyệt phát hành.`,
        "success",
      );
    } catch (error) {
      notify(error instanceof Error ? error.message : "Không thể sinh câu hỏi bằng AI.", "error");
    } finally {
      setGenerating(false);
    }
  };

  // Cập nhật một câu hỏi nháp cụ thể theo ID.
  const updateQuestion = (questionId: string, patch: Partial<EditableAiDraftQuestion>) => {
    setQuestions((prev) =>
      prev.map((item) => (item.id === questionId ? { ...item, ...patch } : item)),
    );
  };

  // Xác thực toàn bộ nội dung câu hỏi và thiết lập trước khi đóng gói phát hành cho học viên.
  const handleApproveAndPublish = async () => {
    if (saving || generating || questions.length === 0) return;
    const cleanTitle = title.trim();
    if (cleanTitle.length < 3) {
      notify("Vui lòng nhập tên bài tập tối thiểu 3 ký tự.", "error");
      return;
    }

    const deadlineMs = new Date(dueAt).getTime();
    const classEndMs = targetClassEndAt ? Date.parse(targetClassEndAt) : NaN;
    if (
      !Number.isFinite(deadlineMs) ||
      deadlineMs <= Date.now() ||
      (Number.isFinite(classEndMs) && deadlineMs > classEndMs)
    ) {
      notify("Hạn nộp phải ở tương lai và không vượt quá ngày kết thúc lớp học.", "error");
      return;
    }

    for (let idx = 0; idx < questions.length; idx += 1) {
      const q = questions[idx]!;
      if (q.content.trim().length < 5) {
        notify(`Câu ${idx + 1}: Nội dung câu hỏi cần ít nhất 5 ký tự.`, "error");
        return;
      }
      if (mode === "MULTIPLE_CHOICE") {
        const filled = q.options.map((o) => o.trim()).filter(Boolean);
        if (filled.length < 2) {
          notify(`Câu ${idx + 1}: Cần nhập ít nhất 2 phương án trả lời.`, "error");
          return;
        }
        const uniqueLower = new Set(filled.map((o) => o.toLocaleLowerCase()));
        if (uniqueLower.size !== filled.length) {
          notify(`Câu ${idx + 1}: Các phương án trả lời không được trùng nhau.`, "error");
          return;
        }
        if (!q.options[q.correctIndex]?.trim()) {
          notify(`Câu ${idx + 1}: Phương án được chọn làm đáp án đúng đang trống.`, "error");
          return;
        }
        if (
          !Number.isFinite(q.score) ||
          q.score < 0.01 ||
          Math.abs(Math.round(q.score * 100) - q.score * 100) > 1e-6
        ) {
          notify(`Câu ${idx + 1}: Điểm câu hỏi phải từ 0,01 và tối đa 2 chữ số thập phân.`, "error");
          return;
        }
      }
    }

    if (mode === "MULTIPLE_CHOICE") {
      if (totalObjectiveScore < 1) {
        notify("Tổng điểm đề trắc nghiệm phải đạt ít nhất 1 điểm.", "error");
        return;
      }
      if (!Number.isInteger(durationMinutes) || durationMinutes < 1 || durationMinutes > 600) {
        notify("Thời lượng làm bài cần nằm trong khoảng 1–600 phút.", "error");
        return;
      }
      if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 10) {
        notify("Số lượt làm bài cần nằm trong khoảng 1–10.", "error");
        return;
      }
    } else if (!Number.isFinite(essayMaxScore) || essayMaxScore < 1 || essayMaxScore > 1000) {
      notify("Thang điểm bài tự luận cần nằm trong khoảng 1–1000.", "error");
      return;
    }

    setSaving(true);
    try {
      const builderQuestions: ParsedQuestionItem[] =
        mode === "MULTIPLE_CHOICE"
          ? questions.map((q, idx) => {
              const compactOptions: Array<{ key: string; text: string }> = [];
              let resolvedCorrectKey = "A";
              q.options.forEach((optText, rawOptIdx) => {
                const trimmed = optText.trim();
                if (!trimmed) return;
                const key = String.fromCharCode(65 + compactOptions.length);
                compactOptions.push({ key, text: trimmed });
                if (rawOptIdx === q.correctIndex) {
                  resolvedCorrectKey = key;
                }
              });
              return {
                id: q.id,
                order: idx + 1,
                content: q.content.trim(),
                options: compactOptions,
                correctAnswer: resolvedCorrectKey,
                questionType: "SINGLE_CHOICE",
                type: "Trắc nghiệm một đáp án",
                score: q.score,
              };
            })
          : [];

      const essayItems =
        mode === "ESSAY" ? questions.map((q) => q.content.trim()).filter(Boolean) : [];

      await onSaveAssignment({
        title: cleanTitle,
        description: description.trim(),
        type: mode,
        questions: builderQuestions,
        essayQuestions: essayItems,
        ...(mode === "ESSAY"
          ? {
              scoreBreakdown: {
                multipleChoicePoints: 0,
                essayPoints: Math.round(essayMaxScore * 100) / 100,
              },
            }
          : {}),
        settings: {
          durationMinutes,
          hasDuration: mode === "MULTIPLE_CHOICE",
          startAt: toLocalDateTimeInput(new Date()),
          hasStartAt: false,
          dueAt,
          hasDueAt: true,
          maxAttempts,
          shuffleQuestions: mode === "MULTIPLE_CHOICE" && shuffleQuestions,
          aiTutorEnabled: mode === "MULTIPLE_CHOICE" && aiTutorEnabled,
        },
      });
      onClose();
    } catch (error) {
      notify(error instanceof Error ? error.message : "Không thể phát hành đề AI.", "error");
    } finally {
      setSaving(false);
    }
  };

  const quickCounts = mode === "ESSAY" ? [2, 3, 4, 5] : [4, 5, 10, 15, 20];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/65 p-3 sm:p-5 backdrop-blur-xs"
      role="presentation"
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="ai-exam-builder-title"
        className="flex h-[92dvh] max-h-[92dvh] w-[96vw] max-w-[1160px] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-900"
      >
        {/* Thanh tiêu đề khóa đúng loại đề đã chọn ở bước trước */}
        <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-6 py-4 dark:border-slate-800">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600 dark:bg-emerald-950/60 dark:text-emerald-400">
              <Wand2 size={19} />
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h3
                  id="ai-exam-builder-title"
                  className="text-base sm:text-lg font-extrabold text-slate-900 dark:text-slate-100"
                >
                  {mode === "ESSAY"
                    ? "Tạo đề tự luận bằng AI (Có duyệt & sửa câu hỏi)"
                    : "Tạo đề trắc nghiệm bằng AI (Có duyệt & sửa câu hỏi)"}
                </h3>
                <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-[11px] font-bold text-emerald-700 dark:bg-emerald-950/70 dark:text-emerald-300">
                  {mode === "ESSAY" ? "Đề Tự luận · Thang 10 điểm" : "Đề Trắc nghiệm · Thang 10 điểm"}
                </span>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Bước 1: Yêu cầu AI sinh câu hỏi nháp · Bước 2: Xem, chỉnh sửa nội dung rồi mới duyệt phát hành.
              </p>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            {onBackToHub && (
              <button
                type="button"
                disabled={saving || generating}
                onClick={onBackToHub}
                className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-100 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700 cursor-pointer"
              >
                <ArrowLeft size={14} />
                <span>Chọn cách tạo khác</span>
              </button>
            )}

            <button
              type="button"
              aria-label="Đóng cửa sổ tạo đề AI"
              disabled={saving || generating}
              onClick={onClose}
              className="rounded-xl p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-600 disabled:opacity-50 dark:hover:bg-slate-800 cursor-pointer"
            >
              <X size={20} />
            </button>
          </div>
        </header>

        {/* Bố cục 2 cột */}
        <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[390px_minmax(0,1fr)] overflow-hidden">
          {/* Cột trái: Yêu cầu AI sinh nháp & Cấu hình phát hành */}
          <div className="flex min-h-0 flex-col gap-4 overflow-y-auto border-b border-slate-200 p-5 lg:border-b-0 lg:border-r dark:border-slate-800">
            <div className="space-y-3 rounded-2xl border border-emerald-200 bg-emerald-50/40 p-4 dark:border-emerald-900/60 dark:bg-emerald-950/20">
              <span className="text-xs font-extrabold uppercase tracking-wider text-emerald-700 dark:text-emerald-400 block">
                1. Thông số sinh câu hỏi AI
              </span>

              <div>
                <label
                  htmlFor="ai-draft-subject"
                  className="mb-1 block text-xs font-bold text-slate-700 dark:text-slate-300"
                >
                  Môn học / Lĩnh vực:
                </label>
                <input
                  id="ai-draft-subject"
                  list="ai-subject-suggestions"
                  value={subject}
                  onChange={(event) => setSubject(event.target.value)}
                  placeholder="Ví dụ: Toán học, Lập trình Web..."
                  className={fieldInputClass}
                />
                <datalist id="ai-subject-suggestions">
                  {SUBJECT_SUGGESTIONS.map((item) => (
                    <option key={item} value={item} />
                  ))}
                </datalist>
              </div>

              <div>
                <label
                  htmlFor="ai-draft-topic"
                  className="mb-1 block text-xs font-bold text-slate-700 dark:text-slate-300"
                >
                  Chuyên đề / Bài học trọng tâm <span className="text-rose-500">*</span>:
                </label>
                <input
                  id="ai-draft-topic"
                  type="text"
                  value={topic}
                  onChange={(event) => setTopic(event.target.value)}
                  placeholder="Ví dụ: Hàm số & Khảo sát đồ thị..."
                  className={fieldInputClass}
                />
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label
                    htmlFor="ai-draft-count"
                    className="mb-1 block text-xs font-bold text-slate-700 dark:text-slate-300"
                  >
                    Số lượng câu:
                  </label>
                  <input
                    id="ai-draft-count"
                    type="number"
                    min={1}
                    max={30}
                    value={questionCount}
                    onChange={(event) => setQuestionCount(Number(event.target.value))}
                    className={fieldInputClass}
                  />
                </div>

                <div>
                  <label
                    htmlFor="ai-draft-difficulty"
                    className="mb-1 block text-xs font-bold text-slate-700 dark:text-slate-300"
                  >
                    Độ khó:
                  </label>
                  <select
                    id="ai-draft-difficulty"
                    value={difficulty}
                    onChange={(event) => setDifficulty(Number(event.target.value) as 1 | 2 | 3)}
                    className={fieldInputClass}
                  >
                    <option value={1}>Cơ bản (Nhận biết)</option>
                    <option value={2}>Thông hiểu</option>
                    <option value={3}>Vận dụng & Phân hóa</option>
                  </select>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[11px] text-slate-500">Chọn nhanh:</span>
                {quickCounts.map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => setQuestionCount(preset)}
                    className={`rounded-lg border px-2 py-0.5 text-[11px] font-bold transition cursor-pointer ${
                      questionCount === preset
                        ? "border-emerald-600 bg-emerald-600 text-white"
                        : "border-slate-200 bg-white text-slate-600 hover:border-emerald-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
                    }`}
                  >
                    {preset} câu
                  </button>
                ))}
              </div>

              <button
                type="button"
                onClick={() => void handleGenerateDraftQuestions()}
                disabled={generating || saving}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-xs sm:text-sm font-bold text-white shadow-xs transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
              >
                {generating ? (
                  <>
                    <LoaderCircle size={16} className="animate-spin" />
                    <span>AI đang biên soạn câu hỏi nháp...</span>
                  </>
                ) : (
                  <>
                    <Sparkles size={16} />
                    <span>
                      {questions.length > 0
                        ? `AI sinh thêm ${questionCount} câu (cộng dồn)`
                        : `AI sinh ${questionCount} câu ${mode === "ESSAY" ? "tự luận" : "trắc nghiệm"} nháp`}
                    </span>
                  </>
                )}
              </button>

              {aiMeta && (
                <div className="space-y-1 rounded-xl border border-emerald-200 bg-white/80 p-2.5 text-[11px] text-slate-600 dark:border-emerald-900/50 dark:bg-slate-900/70 dark:text-slate-300">
                  <p>
                    Nguồn AI: <strong>{aiMeta.provider} / {aiMeta.model}</strong>
                  </p>
                  {aiMeta.materialNames.length > 0 && (
                    <p>Tài liệu lớp tham chiếu: {aiMeta.materialNames.join(", ")}</p>
                  )}
                  {aiMeta.warnings.map((w, idx) => (
                    <p key={idx} className="text-amber-700 dark:text-amber-300">
                      {w}
                    </p>
                  ))}
                </div>
              )}
            </div>

            {/* Khung thiết lập bài tập phát hành */}
            <div className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50/70 p-4 dark:border-slate-800 dark:bg-slate-800/40">
              <div className="flex items-center gap-2">
                <FileCheck2 size={16} className="text-emerald-600 dark:text-emerald-400" />
                <span className="text-xs font-extrabold uppercase tracking-wider text-slate-800 dark:text-slate-200">
                  2. Thiết lập bài tập phát hành
                </span>
              </div>

              <div>
                <label
                  htmlFor="ai-exam-title"
                  className="mb-1 block text-xs font-bold text-slate-700 dark:text-slate-300"
                >
                  Tên bài tập <span className="text-rose-500">*</span>
                </label>
                <input
                  id="ai-exam-title"
                  type="text"
                  maxLength={255}
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder={
                    mode === "ESSAY"
                      ? "Ví dụ: Bài tự luận AI chương 1..."
                      : "Ví dụ: Đề trắc nghiệm AI chương 1..."
                  }
                  className={fieldInputClass}
                />
              </div>

              <div>
                <label
                  htmlFor="ai-exam-due-at"
                  className="mb-1 block text-xs font-bold text-slate-700 dark:text-slate-300"
                >
                  Hạn nộp <span className="text-rose-500">*</span>
                </label>
                <input
                  id="ai-exam-due-at"
                  type="datetime-local"
                  value={dueAt}
                  onChange={(event) => setDueAt(event.target.value)}
                  className={fieldInputClass}
                />
              </div>

              {mode === "MULTIPLE_CHOICE" ? (
                <>
                  <div className="grid grid-cols-2 gap-2.5">
                    <div>
                      <label
                        htmlFor="ai-exam-duration"
                        className="mb-1 block text-xs font-bold text-slate-700 dark:text-slate-300"
                      >
                        Thời lượng (phút)
                      </label>
                      <input
                        id="ai-exam-duration"
                        type="number"
                        min={1}
                        max={600}
                        value={durationMinutes}
                        onChange={(event) => setDurationMinutes(Number(event.target.value))}
                        className={fieldInputClass}
                      />
                    </div>
                    <div>
                      <label
                        htmlFor="ai-exam-attempts"
                        className="mb-1 block text-xs font-bold text-slate-700 dark:text-slate-300"
                      >
                        Số lượt làm
                      </label>
                      <input
                        id="ai-exam-attempts"
                        type="number"
                        min={1}
                        max={10}
                        value={maxAttempts}
                        onChange={(event) => setMaxAttempts(Number(event.target.value))}
                        className={fieldInputClass}
                      />
                    </div>
                  </div>

                  <label className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={shuffleQuestions}
                      onChange={(event) => setShuffleQuestions(event.target.checked)}
                      className="size-4 accent-emerald-600"
                    />
                    <span>Đảo thứ tự câu hỏi khi học viên làm bài</span>
                  </label>

                  <label className="flex items-start gap-2 rounded-xl border border-indigo-200 bg-indigo-50/70 p-2.5 text-xs text-slate-800 dark:border-indigo-900/60 dark:bg-indigo-950/30 dark:text-slate-200 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={aiTutorEnabled}
                      onChange={(event) => setAiTutorEnabled(event.target.checked)}
                      className="mt-0.5 size-4 accent-indigo-600"
                    />
                    <Sparkles size={14} className="mt-0.5 shrink-0 text-indigo-600 dark:text-indigo-400" />
                    <span>
                      <span className="block font-bold">
                        Cho phép học sinh hỏi đáp AI dẫn dắt khi làm bài
                      </span>
                      <span className="block text-[11px] text-slate-600 dark:text-slate-400">
                        AI chỉ gợi mở phương pháp giải theo từng câu hỏi, không đưa ra đáp án đúng.
                      </span>
                    </span>
                  </label>
                </>
              ) : (
                <>
                  <div>
                    <label
                      htmlFor="ai-essay-max-score"
                      className="mb-1 block text-xs font-bold text-slate-700 dark:text-slate-300"
                    >
                      Thang điểm bài tự luận
                    </label>
                    <input
                      id="ai-essay-max-score"
                      type="number"
                      min={1}
                      max={1000}
                      step={0.25}
                      value={essayMaxScore}
                      onChange={(event) => setEssayMaxScore(Number(event.target.value))}
                      className={fieldInputClass}
                    />
                  </div>
                  <div>
                    <label
                      htmlFor="ai-essay-description"
                      className="mb-1 block text-xs font-bold text-slate-700 dark:text-slate-300"
                    >
                      Mô tả / Hướng dẫn làm bài (tùy chọn)
                    </label>
                    <textarea
                      id="ai-essay-description"
                      rows={2}
                      value={description}
                      onChange={(event) => setDescription(event.target.value)}
                      placeholder="Lưu ý cách trình bày bài làm cho học viên..."
                      className={`${fieldInputClass} resize-y`}
                    />
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Cột phải: Xem và chỉnh sửa chi tiết từng câu hỏi trước khi duyệt phát hành */}
          <div className="flex min-h-0 flex-col overflow-hidden bg-slate-50/40 dark:bg-slate-950/30">
            <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-white px-5 py-3.5 dark:border-slate-800 dark:bg-slate-900">
              <div>
                <span className="text-xs font-extrabold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
                  Xem & Chỉnh sửa câu hỏi trước khi duyệt ({questions.length} câu · Tổng{" "}
                  {mode === "MULTIPLE_CHOICE" ? totalObjectiveScore : essayMaxScore} điểm)
                </span>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {mode === "ESSAY"
                    ? "Kiểm tra, chỉnh sửa yêu cầu từng câu hỏi tự luận hoặc thêm/xóa câu trước khi phát hành."
                    : "Kiểm tra, sửa nội dung câu hỏi, phương án A–D, đáp án đúng và điểm từng câu trước khi phát hành."}
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {mode === "MULTIPLE_CHOICE" && questions.length > 0 && (
                  <button
                    type="button"
                    disabled={saving || generating}
                    onClick={() => {
                      setCustomScoresEdited(false);
                      setQuestions((prev) => rebalanceAiDraftScores(prev, 10));
                    }}
                    className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-bold text-emerald-700 hover:bg-emerald-100 disabled:opacity-50 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-300 cursor-pointer"
                  >
                    Chia đều 10 điểm
                  </button>
                )}
                {questions.length > 0 && (
                  <button
                    type="button"
                    disabled={saving || generating}
                    onClick={() => {
                      setCustomScoresEdited(false);
                      setQuestions([]);
                    }}
                    className="rounded-xl border border-rose-200 bg-rose-50/70 px-3 py-1.5 text-xs font-bold text-rose-600 hover:bg-rose-100 disabled:opacity-50 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-300 cursor-pointer"
                  >
                    Xóa tất cả
                  </button>
                )}
                <button
                  type="button"
                  disabled={saving}
                  onClick={() =>
                    setQuestions((prev) => {
                      const next = [...prev, createBlankAiQuestion(mode)];
                      return mode === "MULTIPLE_CHOICE" && !customScoresEdited
                        ? rebalanceAiDraftScores(next, 10)
                        : next;
                    })
                  }
                  className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 cursor-pointer"
                >
                  <Plus size={14} />
                  Thêm câu thủ công
                </button>
              </div>
            </div>

            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
              {questions.length === 0 ? (
                <div className="flex h-full min-h-[300px] flex-col items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-white/70 p-8 text-center dark:border-slate-800 dark:bg-slate-900/50">
                  <Wand2 size={32} className="mb-3 text-emerald-400 dark:text-emerald-600" />
                  <p className="text-sm font-bold text-slate-700 dark:text-slate-200">
                    Chưa có câu hỏi nháp nào
                  </p>
                  <p className="mt-1 max-w-md text-xs leading-relaxed text-slate-500 dark:text-slate-400">
                    Điền môn học, chuyên đề ở cột bên trái rồi bấm{" "}
                    <strong>
                      AI sinh {questionCount} câu {mode === "ESSAY" ? "tự luận" : "trắc nghiệm"} nháp
                    </strong>{" "}
                    để xem trước và chỉnh sửa toàn bộ câu hỏi tại đây trước khi phát hành.
                  </p>
                </div>
              ) : (
                questions.map((question, index) => (
                  <div
                    key={question.id}
                    className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5 shadow-2xs space-y-3.5 dark:border-slate-800 dark:bg-slate-900"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-lg bg-emerald-50 px-2.5 py-1 text-xs font-extrabold text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300">
                          Câu {index + 1}
                        </span>
                        {mode === "ESSAY" ? (
                          <span className="rounded-lg bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                            Tự luận (~
                            {(essayMaxScore / Math.max(1, questions.length))
                              .toFixed(2)
                              .replace(/\.00$/, "")}{" "}
                            điểm)
                          </span>
                        ) : (
                          <label className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600 dark:text-slate-300">
                            <span>Điểm câu hỏi:</span>
                            <input
                              aria-label={`Điểm câu ${index + 1}`}
                              type="number"
                              min="0.01"
                              step="0.01"
                              disabled={saving}
                              value={question.score}
                              onChange={(event) => {
                                setCustomScoresEdited(true);
                                updateQuestion(question.id, { score: Number(event.target.value) });
                              }}
                              className="w-20 rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs font-bold text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                            />
                          </label>
                        )}
                      </div>

                      <button
                        type="button"
                        aria-label={`Xóa câu hỏi ${index + 1}`}
                        disabled={saving}
                        onClick={() =>
                          setQuestions((prev) => {
                            const filtered = prev.filter((entry) => entry.id !== question.id);
                            return mode === "MULTIPLE_CHOICE" && !customScoresEdited
                              ? rebalanceAiDraftScores(filtered, 10)
                              : filtered;
                          })
                        }
                        className="rounded-lg p-1.5 text-rose-600 hover:bg-rose-50 disabled:opacity-50 dark:hover:bg-rose-950/30 cursor-pointer"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>

                    {question.warnings.length > 0 && (
                      <div className="space-y-1 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200">
                        {question.warnings.map((warning, wIdx) => (
                          <p key={`${warning}-${wIdx}`} className="flex items-start gap-2">
                            <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                            <span>{warning}</span>
                          </p>
                        ))}
                      </div>
                    )}

                    <div className="space-y-1.5">
                      <textarea
                        aria-label={`Nội dung câu ${index + 1}`}
                        rows={mode === "ESSAY" ? 3 : 2}
                        maxLength={4000}
                        disabled={saving}
                        value={question.content}
                        onChange={(event) =>
                          updateQuestion(question.id, { content: event.target.value })
                        }
                        placeholder={
                          mode === "ESSAY"
                            ? "Nhập nội dung câu hỏi tự luận..."
                            : "Nhập nội dung câu hỏi trắc nghiệm..."
                        }
                        className={`${fieldInputClass} resize-y`}
                      />
                      {(question.content.includes("$") || question.content.includes("\\(")) && (
                        <div className="rounded-xl border border-slate-100 bg-slate-50/70 px-3 py-2 text-xs dark:border-slate-800 dark:bg-slate-800/40">
                          <span className="text-[10px] font-bold uppercase text-slate-400 block mb-1">
                            Xem trước công thức:
                          </span>
                          <RichText>{question.content}</RichText>
                        </div>
                      )}
                    </div>

                    {mode === "MULTIPLE_CHOICE" ? (
                      <div className="space-y-2.5">
                        <div className="grid gap-2.5 sm:grid-cols-2">
                          {question.options.map((optionText, optIdx) => {
                            const letter = String.fromCharCode(65 + optIdx);
                            const isChecked = question.correctIndex === optIdx;
                            return (
                              <div
                                key={`${question.id}-opt-${optIdx}`}
                                className={`flex items-center gap-2 rounded-xl border p-2 transition ${
                                  isChecked
                                    ? "border-emerald-400 bg-emerald-50/60 dark:border-emerald-700 dark:bg-emerald-950/25"
                                    : "border-slate-200 bg-slate-50/40 dark:border-slate-800 dark:bg-slate-900/40"
                                }`}
                              >
                                <input
                                  type="radio"
                                  name={`ai-correct-${question.id}`}
                                  aria-label={`Đáp án đúng ${letter} câu ${index + 1}`}
                                  checked={isChecked}
                                  disabled={saving}
                                  onChange={() =>
                                    updateQuestion(question.id, {
                                      correctIndex: optIdx,
                                      warnings: question.warnings.filter(
                                        (w) => !/đáp án/iu.test(w),
                                      ),
                                    })
                                  }
                                  className="size-4 shrink-0 accent-emerald-600 cursor-pointer"
                                />
                                <span className="w-4 shrink-0 text-xs font-extrabold text-slate-600 dark:text-slate-300">
                                  {letter}
                                </span>
                                <input
                                  type="text"
                                  aria-label={`Phương án ${letter} câu ${index + 1}`}
                                  value={optionText}
                                  disabled={saving}
                                  onChange={(event) =>
                                    updateQuestion(question.id, {
                                      options: question.options.map((val, idx) =>
                                        idx === optIdx ? event.target.value : val,
                                      ),
                                    })
                                  }
                                  placeholder={`Nội dung phương án ${letter}`}
                                  className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs sm:text-sm text-slate-900 outline-none focus:border-emerald-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                                />
                                {question.options.length > 2 && (
                                  <button
                                    type="button"
                                    aria-label={`Xóa phương án ${letter} câu ${index + 1}`}
                                    disabled={saving}
                                    onClick={() => {
                                      const nextOptions = question.options.filter(
                                        (_, idx) => idx !== optIdx,
                                      );
                                      const nextCorrect =
                                        question.correctIndex === optIdx
                                          ? 0
                                          : question.correctIndex > optIdx
                                            ? question.correctIndex - 1
                                            : question.correctIndex;
                                      updateQuestion(question.id, {
                                        options: nextOptions,
                                        correctIndex: nextCorrect,
                                      });
                                    }}
                                    className="rounded-md p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600 cursor-pointer"
                                  >
                                    <X size={14} />
                                  </button>
                                )}
                              </div>
                            );
                          })}
                        </div>

                        {question.options.length < 6 && (
                          <button
                            type="button"
                            disabled={saving}
                            onClick={() =>
                              updateQuestion(question.id, {
                                options: [...question.options, ""],
                              })
                            }
                            className="inline-flex items-center gap-1 text-xs font-bold text-emerald-600 hover:text-emerald-700 dark:text-emerald-400 cursor-pointer"
                          >
                            <Plus size={13} />
                            Thêm phương án
                          </button>
                        )}
                      </div>
                    ) : (
                      question.gradingGuide && (
                        <div className="rounded-xl border border-emerald-100 bg-emerald-50/40 p-3 text-xs text-slate-700 dark:border-emerald-900/40 dark:bg-emerald-950/20 dark:text-slate-300">
                          <span className="block text-[11px] font-bold text-emerald-700 dark:text-emerald-400 mb-1">
                            Dàn ý chấm tham khảo do AI đề xuất (chỉ hiển thị cho giảng viên):
                          </span>
                          <p className="whitespace-pre-line leading-relaxed">{question.gradingGuide}</p>
                        </div>
                      )
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* Chân modal */}
        <footer className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-slate-50/70 px-6 py-3.5 dark:border-slate-800 dark:bg-slate-900/70">
          <div className="flex flex-wrap items-center gap-3">
            {onBackToHub && (
              <button
                type="button"
                disabled={saving || generating}
                onClick={onBackToHub}
                className="inline-flex items-center gap-1.5 text-xs font-bold text-emerald-600 hover:underline disabled:opacity-50 dark:text-emerald-400 cursor-pointer"
              >
                <ArrowLeft size={14} />
                <span>Quay lại chọn cách tạo khác</span>
              </button>
            )}
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {questions.length > 0 ? (
                <>
                  Đã sẵn sàng duyệt:{" "}
                  <strong className="text-slate-900 dark:text-slate-100">
                    {questions.length} câu {mode === "ESSAY" ? "tự luận" : "trắc nghiệm"}
                  </strong>{" "}
                  · Tổng{" "}
                  <strong className="text-emerald-700 dark:text-emerald-400">
                    {mode === "MULTIPLE_CHOICE" ? totalObjectiveScore : essayMaxScore} điểm
                  </strong>
                </>
              ) : (
                "Hãy sinh câu hỏi nháp bằng AI và kiểm tra nội dung trước khi phát hành."
              )}
            </p>
          </div>

          <div className="flex items-center gap-2.5">
            <button
              type="button"
              disabled={saving || generating}
              onClick={onClose}
              className="rounded-xl border border-slate-300 px-4 py-2 text-xs sm:text-sm font-bold text-slate-700 hover:bg-slate-100 disabled:opacity-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800 cursor-pointer"
            >
              Hủy
            </button>
            <button
              type="button"
              disabled={saving || generating || questions.length === 0}
              onClick={() => void handleApproveAndPublish()}
              className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-5 py-2 text-xs sm:text-sm font-bold text-white shadow-xs transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
            >
              {saving ? (
                <>
                  <LoaderCircle size={15} className="animate-spin" />
                  <span>Đang phát hành...</span>
                </>
              ) : (
                <>
                  <Check size={15} />
                  <span>
                    {mode === "ESSAY"
                      ? `Duyệt & Phát hành bài tự luận (${questions.length} câu)`
                      : `Duyệt & Phát hành đề trắc nghiệm (${questions.length} câu)`}
                  </span>
                </>
              )}
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}
