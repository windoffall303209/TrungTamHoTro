"use client";

import { useEffect, useState, type ChangeEvent } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  Edit2,
  Eye,
  EyeOff,
  FileText,
  LoaderCircle,
  Play,
  Plus,
  Trash2,
  UploadCloud,
  X,
} from "lucide-react";
import { QuestionImage } from "@/features/questions/question-image";
import { toLocalDateTimeInput } from "@/features/exams/exams.shared";
import { apiRequest } from "@/lib/api-client";
import { localDateTimeToIso, parseLocalDateTimeInput } from "@/lib/date-time";
import type { RoleCode } from "@/lib/app-types";
import type { Assignment, Exam, ExamAttempt, Material, Question } from "@/lib/learning-types";
import { useApp } from "@/providers/app-provider";
import { ScoreStepperInput } from "@/shared/ui/score-stepper-input";
import { RichText } from "@/shared/ui/ui";
import type { ClassQuestion } from "./instructor-class-workspace.helpers";

const fieldClass =
  "w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-xs text-slate-900 dark:text-slate-100 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500";

const QUESTION_TYPE_LABELS: Record<Question["type"], string> = {
  SINGLE_CHOICE: "Trắc nghiệm một đáp án",
  MULTIPLE_CHOICE: "Trắc nghiệm nhiều đáp án",
  TRUE_FALSE: "Đúng / Sai",
  SHORT_ANSWER: "Điền khuyết / Trả lời ngắn",
  ESSAY: "Tự luận",
};

/** Kiểm tra một phương án có nằm trong danh sách đáp án đúng của câu hỏi hay không. */
function isOptionMarkedCorrect(option: string, optionIndex: number, correctAnswers: string[]): boolean {
  const key = String.fromCharCode(65 + optionIndex);
  const stripped = option.replace(/^[A-F][\.\:\)]\s*/i, "").trim();
  return correctAnswers.some((expected) => {
    const trimmed = expected.trim();
    return trimmed === option || trimmed === key || trimmed === stripped;
  });
}

/** Chuyển câu hỏi từ API sang dạng chỉnh sửa trong modal sửa đề của lớp học. */
interface EditableExamQuestion {
  id: string;
  originalId?: string;
  content: string;
  type: Question["type"];
  options: string[];
  correctAnswers: string[];
  score: number;
  isNew?: boolean;
  dirtyContent?: boolean;
}

/** Modal xem đề bài tập trắc nghiệm ngay trong màn hình lớp học. */
export function ClassExamPreviewModal({
  exam,
  classNameLabel,
  roleCode,
  onClose,
  onTryExam,
  onEditExam,
}: {
  exam: Exam | null;
  classNameLabel: string;
  roleCode: RoleCode;
  onClose: () => void;
  onTryExam: (exam: Exam) => void;
  onEditExam: (exam: Exam) => void;
}) {
  const [questions, setQuestions] = useState<Question[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!exam) return;
    const controller = new AbortController();
    setLoading(true);
    setError("");
    setQuestions([]);
    void apiRequest<Question[]>(`/instructor/exams/${encodeURIComponent(exam.id)}/preview`, {
      roleCode,
      signal: controller.signal,
    })
      .then((rows) => {
        if (!controller.signal.aborted) setQuestions(Array.isArray(rows) ? rows : []);
      })
      .catch((err: unknown) => {
        if (!controller.signal.aborted) {
          setError(err instanceof Error ? err.message : "Không thể tải nội dung đề bài.");
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [exam, roleCode]);

  if (!exam) return null;

  const equalSplit = Math.round((exam.totalScore / Math.max(1, questions.length || exam.questionIds.length)) * 100) / 100;

  return (
    <div className="fixed inset-0 z-[75] flex items-center justify-center bg-slate-950/65 p-4 backdrop-blur-xs" role="presentation">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="class-exam-preview-title"
        className="flex max-h-[90dvh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900"
      >
        <header className="flex items-start justify-between gap-4 border-b border-slate-200 px-6 py-4 dark:border-slate-800">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-md bg-blue-100 px-2 py-0.5 text-[11px] font-bold text-blue-700 dark:bg-blue-950/60 dark:text-blue-300">
                Xem đề trắc nghiệm
              </span>
              <span
                className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold ${
                  exam.hidden
                    ? "bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300"
                    : "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300"
                }`}
              >
                {exam.hidden ? <EyeOff size={11} /> : <Eye size={11} />}
                <span>{exam.hidden ? "Đã ẩn với học sinh" : "Đang hiển thị"}</span>
              </span>
              <span
                className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold ${
                  exam.aiTutorEnabled
                    ? "bg-indigo-100 text-indigo-800 dark:bg-indigo-950/60 dark:text-indigo-300"
                    : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400"
                }`}
              >
                <span>{exam.aiTutorEnabled ? "Hỏi đáp AI: Đang bật" : "Hỏi đáp AI: Đang tắt"}</span>
              </span>
            </div>
            <h2 id="class-exam-preview-title" className="mt-1.5 text-lg font-extrabold text-slate-900 dark:text-white">
              {exam.title}
            </h2>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              {classNameLabel} · Hiển thị theo thứ tự câu gốc khi tạo đề
            </p>
          </div>
          <button
            type="button"
            aria-label="Đóng xem đề"
            onClick={onClose}
            className="rounded-xl p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
          >
            <X size={19} />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/40 p-3 text-center">
              <p className="text-[11px] font-medium text-slate-500">Số câu hỏi</p>
              <p className="mt-0.5 text-sm font-extrabold text-slate-900 dark:text-slate-100">
                {questions.length || exam.questionIds.length} câu
              </p>
            </div>
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/40 p-3 text-center">
              <p className="text-[11px] font-medium text-slate-500">Thời lượng</p>
              <p className="mt-0.5 text-sm font-extrabold text-blue-600 dark:text-blue-400">
                {exam.durationMinutes} phút
              </p>
            </div>
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/40 p-3 text-center">
              <p className="text-[11px] font-medium text-slate-500">Tổng điểm</p>
              <p className="mt-0.5 text-sm font-extrabold text-slate-900 dark:text-slate-100">
                {exam.totalScore} điểm
              </p>
            </div>
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/40 p-3 text-center">
              <p className="text-[11px] font-medium text-slate-500">Thứ tự học viên</p>
              <p className="mt-0.5 text-sm font-extrabold text-slate-900 dark:text-slate-100">
                {exam.shuffleQuestions ? "Có xáo trộn" : "Theo thứ tự gốc"}
              </p>
            </div>
          </div>

          {loading ? (
            <div className="flex items-center justify-center gap-2 py-12 text-xs font-semibold text-slate-500">
              <LoaderCircle size={18} className="animate-spin text-blue-600" />
              <span>Đang tải danh sách câu hỏi...</span>
            </div>
          ) : error ? (
            <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-xs font-semibold text-rose-700 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-300">
              {error}
            </div>
          ) : questions.length === 0 ? (
            <p className="py-10 text-center text-xs text-slate-500">Đề này chưa có câu hỏi nào.</p>
          ) : (
            <ol className="space-y-4">
              {questions.map((question, index) => (
                <li
                  key={question.id}
                  className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-5 shadow-2xs space-y-3"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-sm font-extrabold text-slate-900 dark:text-slate-100">
                      Câu {index + 1} · {exam.questionScores?.[question.id] ?? equalSplit} điểm
                    </span>
                    <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400">
                      {QUESTION_TYPE_LABELS[question.type] ?? question.type}
                    </span>
                  </div>

                  {question.issues?.length ? (
                    <div className="rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 px-3 py-2 text-xs font-semibold text-amber-800 dark:text-amber-200 space-y-1">
                      {question.issues.map((issue) => (
                        <p key={issue} className="flex items-center gap-1.5">
                          <AlertTriangle size={13} />
                          <span>{issue}</span>
                        </p>
                      ))}
                    </div>
                  ) : null}

                  <RichText className="text-sm font-medium text-slate-800 dark:text-slate-200">
                    {question.content}
                  </RichText>

                  <QuestionImage imageUrl={question.imageUrl} />

                  {question.options.length > 0 ? (
                    <div className="grid gap-2 sm:grid-cols-2">
                      {question.options.map((option, optIdx) => {
                        const correct = isOptionMarkedCorrect(option, optIdx, question.correctAnswers);
                        return (
                          <div
                            key={`${question.id}-${optIdx}`}
                            className={`flex items-start gap-2.5 rounded-xl border p-3 text-xs sm:text-sm ${
                              correct
                                ? "border-emerald-400 bg-emerald-50/70 text-emerald-900 font-semibold dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-200"
                                : "border-slate-200 bg-slate-50/60 text-slate-700 dark:border-slate-800 dark:bg-slate-800/40 dark:text-slate-300"
                            }`}
                          >
                            <span className="grid size-6 shrink-0 place-items-center rounded-md border border-current text-[11px] font-bold">
                              {String.fromCharCode(65 + optIdx)}
                            </span>
                            <RichText className="min-w-0 flex-1 [&>p]:my-0">{option}</RichText>
                            {correct && (
                              <CheckCircle2
                                aria-label="Đáp án đúng"
                                size={16}
                                className="shrink-0 text-emerald-600 dark:text-emerald-400"
                              />
                            )}
                          </div>
                        );
                      })}
                    </div>
                  ) : question.correctAnswers.length > 0 ? (
                    <div className="rounded-xl border border-emerald-200 bg-emerald-50/70 p-3 dark:border-emerald-800/60 dark:bg-emerald-950/30">
                      <p className="text-[11px] font-bold text-emerald-700 dark:text-emerald-300">
                        Đáp án / Ý tham khảo:
                      </p>
                      <div className="mt-1 space-y-1 text-xs text-emerald-900 dark:text-emerald-200">
                        {question.correctAnswers.map((ans) => (
                          <RichText key={ans}>{ans}</RichText>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </li>
              ))}
            </ol>
          )}
        </div>

        <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-200 px-6 py-4 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/60">
          <button
            type="button"
            onClick={() => {
              onClose();
              onTryExam(exam);
            }}
            className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-700 cursor-pointer"
          >
            <Play size={14} />
            <span>Làm thử</span>
          </button>
          <button
            type="button"
            onClick={() => {
              onClose();
              onEditExam(exam);
            }}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700 cursor-pointer"
          >
            <Edit2 size={14} />
            <span>Chỉnh sửa</span>
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl bg-slate-900 px-4 py-2 text-xs font-bold text-white hover:bg-slate-700 dark:bg-white dark:text-slate-900 cursor-pointer"
          >
            Đóng
          </button>
        </footer>
      </section>
    </div>
  );
}

/** Modal xem đề bài tập tự luận ngay trong màn hình lớp học. */
export function ClassAssignmentPreviewModal({
  assignment,
  locale,
  onClose,
  onPreviewMaterial,
  onDownloadMaterial,
  onTryAssignment,
  onEditAssignment,
}: {
  assignment: Assignment | null;
  locale: string;
  onClose: () => void;
  onPreviewMaterial: (materialId: string) => void;
  onDownloadMaterial: (materialId: string) => void;
  onTryAssignment: (assignment: Assignment) => void;
  onEditAssignment: (assignment: Assignment) => void;
}) {
  if (!assignment) return null;
  const hasDistinctDescription =
    Boolean(assignment.description?.trim()) &&
    assignment.description.trim() !== `Bài tập tự luận: ${assignment.title.trim()}`;

  return (
    <div className="fixed inset-0 z-[75] flex items-center justify-center bg-slate-950/65 p-4 backdrop-blur-xs" role="presentation">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="assignment-preview-title"
        className="flex max-h-[90dvh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900"
      >
        <header className="flex items-start justify-between gap-4 border-b border-slate-200 px-6 py-4 dark:border-slate-800">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-md bg-sky-100 px-2 py-0.5 text-[11px] font-bold text-sky-700 dark:bg-sky-950/60 dark:text-sky-300">
                Xem đề bài tự luận
              </span>
              <span
                className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold ${
                  assignment.hidden
                    ? "bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300"
                    : "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300"
                }`}
              >
                {assignment.hidden ? <EyeOff size={11} /> : <Eye size={11} />}
                <span>{assignment.hidden ? "Đã ẩn với học sinh" : "Đang hiển thị"}</span>
              </span>
            </div>
            <h2 id="assignment-preview-title" className="mt-1.5 text-lg font-extrabold text-slate-900 dark:text-white">
              {assignment.title}
            </h2>
            <p className="mt-0.5 text-xs text-slate-500">
              Hạn nộp: {new Date(assignment.dueAt).toLocaleString(locale)} · Thang điểm: {assignment.maxScore} điểm
            </p>
          </div>
          <button
            type="button"
            aria-label="Đóng xem đề bài tự luận"
            onClick={onClose}
            className="rounded-xl p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
          >
            <X size={19} />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {hasDistinctDescription && (
            <p className="whitespace-pre-wrap text-sm leading-6 text-slate-700 dark:text-slate-300">
              {assignment.description}
            </p>
          )}

          <div className="rounded-xl bg-slate-50 p-4 dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-800">
            <h3 className="text-xs font-extrabold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Đề bài & Hướng dẫn
            </h3>
            <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-800 dark:text-slate-200">
              {assignment.instructions}
            </p>
          </div>

          {assignment.sourceMaterial && (
            <div className="rounded-xl border border-sky-200 bg-sky-50 p-4 dark:border-sky-900 dark:bg-sky-950/30">
              <h3 className="text-xs font-extrabold uppercase tracking-wider text-sky-700 dark:text-sky-300">
                Tệp đề đính kèm
              </h3>
              <p className="mt-1 break-all text-sm font-semibold text-slate-800 dark:text-slate-200">
                {assignment.sourceMaterial.name}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => onPreviewMaterial(assignment.sourceMaterial!.id)}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-sky-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-sky-700 cursor-pointer"
                >
                  <Eye size={14} />
                  <span>Xem tệp</span>
                </button>
                <button
                  type="button"
                  onClick={() => onDownloadMaterial(assignment.sourceMaterial!.id)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-sky-300 px-3 py-1.5 text-xs font-bold text-sky-800 hover:bg-sky-100 dark:border-sky-700 dark:text-sky-200 dark:hover:bg-sky-950 cursor-pointer"
                >
                  <Download size={14} />
                  <span>Tải tệp về</span>
                </button>
              </div>
            </div>
          )}

          {assignment.rubric.length > 0 && (
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-4 space-y-2">
              <h3 className="text-xs font-extrabold uppercase tracking-wider text-slate-500">
                Tiêu chí đánh giá ({assignment.rubric.length})
              </h3>
              <div className="divide-y divide-slate-100 dark:divide-slate-800">
                {assignment.rubric.map((criterion) => (
                  <div key={criterion.id} className="flex items-center justify-between gap-4 py-2 text-xs">
                    <div>
                      <p className="font-bold text-slate-800 dark:text-slate-200">
                        {criterion.title === "Mức độ hoàn thành" || criterion.title === "Nội dung"
                          ? "Phần tự luận"
                          : criterion.title}
                      </p>
                      {criterion.description && (
                        <p className="text-slate-500 dark:text-slate-400">{criterion.description}</p>
                      )}
                    </div>
                    <span className="shrink-0 font-extrabold text-blue-600 dark:text-blue-400">
                      {criterion.maxPoints} điểm
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-200 px-6 py-4 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/60">
          <button
            type="button"
            onClick={() => {
              onClose();
              onTryAssignment(assignment);
            }}
            className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-700 cursor-pointer"
          >
            <Play size={14} />
            <span>Làm thử</span>
          </button>
          <button
            type="button"
            onClick={() => {
              onClose();
              onEditAssignment(assignment);
            }}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700 cursor-pointer"
          >
            <Edit2 size={14} />
            <span>Chỉnh sửa</span>
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl bg-slate-900 px-4 py-2 text-xs font-bold text-white hover:bg-slate-700 dark:bg-white dark:text-slate-900 cursor-pointer"
          >
            Đóng
          </button>
        </footer>
      </section>
    </div>
  );
}

/** Modal làm thử bài tập tự luận giống học sinh, trả kết quả mô phỏng nhưng không lưu lịch sử vào hệ thống. */
export function ClassAssignmentTrialModal({
  assignment,
  locale,
  onClose,
  onPreviewMaterial,
  onDownloadMaterial,
}: {
  assignment: Assignment | null;
  locale: string;
  onClose: () => void;
  onPreviewMaterial: (materialId: string) => void;
  onDownloadMaterial: (materialId: string) => void;
}) {
  const [content, setContent] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState("");
  const [submittedPreview, setSubmittedPreview] = useState<{
    content: string;
    fileNames: string[];
    submittedAt: string;
  } | null>(null);

  useEffect(() => {
    setContent("");
    setFiles([]);
    setError("");
    setSubmittedPreview(null);
  }, [assignment?.id]);

  if (!assignment) return null;

  const wordCount = content.trim() ? content.trim().split(/\s+/).length : 0;

  // Xử lý nộp thử bài tập tự luận của giảng viên mà không ghi dữ liệu vào hệ thống.
  const handleTrialSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!content.trim() && files.length === 0) {
      setError("Nhập nội dung bài làm hoặc đính kèm ít nhất một tệp để nộp thử.");
      return;
    }
    setError("");
    setSubmittedPreview({
      content: content.trim(),
      fileNames: files.map((file) => `${file.name} (${(file.size / 1024).toFixed(1)} KB)`),
      submittedAt: new Date().toLocaleString(locale),
    });
  };

  return (
    <div className="fixed inset-0 z-[90] flex flex-col w-screen h-dvh bg-slate-50 dark:bg-slate-950 overflow-hidden" role="presentation">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="essay-trial-title"
        className="flex flex-col w-full h-full bg-white dark:bg-slate-900 overflow-hidden"
      >
        <header className="flex items-center justify-between gap-4 border-b border-slate-200 px-6 py-4 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-900/90 shrink-0">
          <div className="min-w-0">
            <span className="inline-flex items-center gap-1 rounded-md bg-amber-100 px-2.5 py-0.5 text-[11px] font-bold text-amber-800 dark:bg-amber-950/60 dark:text-amber-300">
              Làm thử bài tập
            </span>
            <h2 id="essay-trial-title" className="mt-1 text-lg font-extrabold text-slate-900 dark:text-white break-words">
              {assignment.title}
            </h2>
            <p className="mt-0.5 text-xs text-slate-500">
              Hạn nộp: {new Date(assignment.dueAt).toLocaleString(locale)} · Điểm tối đa: {assignment.maxScore}
            </p>
          </div>
          <button
            type="button"
            aria-label="Đóng làm thử tự luận"
            onClick={onClose}
            className="rounded-xl border border-slate-200 dark:border-slate-700 p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer shrink-0"
          >
            <X size={19} />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-6 py-6">
          <div className="mx-auto w-full max-w-6xl">
            {submittedPreview ? (
              <div className="mx-auto max-w-3xl space-y-5">
                <div className="rounded-2xl border border-emerald-200 bg-emerald-50/70 p-5 dark:border-emerald-800 dark:bg-emerald-950/30 space-y-2">
                  <div className="flex items-center gap-2 text-emerald-700 dark:text-emerald-300 font-extrabold text-sm">
                    <CheckCircle2 size={18} />
                    <span>Đã nộp bài thử thành công</span>
                  </div>
                  <p className="text-xs text-emerald-800 dark:text-emerald-200">
                    Thời gian nộp thử: {submittedPreview.submittedAt} · Độ dài văn bản: {wordCount} từ · Tệp đính kèm: {submittedPreview.fileNames.length}
                  </p>
                </div>

                {submittedPreview.content && (
                  <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-5 space-y-2">
                    <h3 className="text-xs font-extrabold uppercase text-slate-500">Nội dung bài làm đã nhập</h3>
                    <p className="whitespace-pre-wrap text-sm text-slate-800 dark:text-slate-200">
                      {submittedPreview.content}
                    </p>
                  </div>
                )}

                {submittedPreview.fileNames.length > 0 && (
                  <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-5 space-y-2">
                    <h3 className="text-xs font-extrabold uppercase text-slate-500">Tệp đã chọn</h3>
                    <ul className="list-disc pl-5 text-xs text-slate-700 dark:text-slate-300 space-y-1">
                      {submittedPreview.fileNames.map((name, idx) => (
                        <li key={`${name}-${idx}`}>{name}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {assignment.rubric.length > 0 && (
                  <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-5 space-y-2.5">
                    <h3 className="text-xs font-extrabold uppercase text-slate-500">
                      Thang điểm chấm đối chiếu ({assignment.maxScore} điểm)
                    </h3>
                    {assignment.rubric.map((criterion) => (
                      <div key={criterion.id} className="flex items-center justify-between text-xs">
                        <span className="font-semibold text-slate-700 dark:text-slate-300">{criterion.title}</span>
                        <span className="font-bold text-blue-600 dark:text-blue-400">{criterion.maxPoints} điểm</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <form id="essay-trial-form" onSubmit={handleTrialSubmit} className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
                <div className="lg:col-span-5 space-y-4">
                  {assignment.instructions && (
                    <div className="rounded-2xl bg-slate-50 p-5 dark:bg-slate-800/70 border border-slate-200/80 dark:border-slate-700">
                      <h3 className="text-xs font-bold text-slate-500 uppercase mb-2">Đề bài</h3>
                      <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-slate-800 dark:text-slate-200">
                        {assignment.instructions}
                      </p>
                    </div>
                  )}

                  {assignment.sourceMaterial && (
                    <div className="rounded-2xl border border-sky-200 bg-sky-50 p-5 dark:border-sky-900 dark:bg-sky-950/30">
                      <h3 className="text-xs font-bold text-slate-900 dark:text-white">Tệp đề bài</h3>
                      <p className="mt-1 break-all text-xs text-slate-700 dark:text-slate-300">
                        {assignment.sourceMaterial.name}
                      </p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => onPreviewMaterial(assignment.sourceMaterial!.id)}
                          className="rounded-lg bg-sky-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-sky-700 cursor-pointer"
                        >
                          Xem đề
                        </button>
                        <button
                          type="button"
                          onClick={() => onDownloadMaterial(assignment.sourceMaterial!.id)}
                          className="rounded-lg border border-sky-300 px-3 py-1.5 text-xs font-semibold text-sky-800 hover:bg-sky-100 dark:border-sky-700 dark:text-sky-200 cursor-pointer"
                        >
                          Tải đề về
                        </button>
                      </div>
                    </div>
                  )}

                  {assignment.rubric.length > 0 && (
                    <div className="rounded-2xl border border-slate-200 dark:border-slate-800 p-5 space-y-2">
                      <h3 className="text-xs font-bold text-slate-500 uppercase">
                        Thang điểm chấm đối chiếu ({assignment.maxScore} điểm)
                      </h3>
                      {assignment.rubric.map((criterion) => (
                        <div key={criterion.id} className="flex items-center justify-between text-xs pt-1">
                          <span className="font-semibold text-slate-700 dark:text-slate-300">{criterion.title}</span>
                          <span className="font-bold text-blue-600 dark:text-blue-400">{criterion.maxPoints} điểm</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="lg:col-span-7 space-y-4">
                  <div>
                    <label htmlFor="essay-trial-content" className="mb-1.5 block text-xs font-bold text-slate-800 dark:text-slate-100">
                      Nội dung bài làm
                    </label>
                    <textarea
                      id="essay-trial-content"
                      value={content}
                      onChange={(event) => setContent(event.target.value)}
                      rows={14}
                      placeholder="Nhập nội dung bài làm thử của bạn..."
                      className="w-full resize-y rounded-2xl border border-slate-300 bg-white p-4 text-sm leading-relaxed text-slate-900 focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                    />
                  </div>

                  <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30 p-4">
                    <span className="mb-2 block text-xs font-bold text-slate-800 dark:text-slate-100">
                      Tệp đính kèm
                    </span>
                    <div className="flex flex-wrap items-center gap-3">
                      <label
                        htmlFor="essay-trial-files"
                        className="inline-flex items-center gap-2 rounded-lg bg-sky-100 px-3 py-1.5 text-xs font-semibold text-sky-800 hover:bg-sky-200 dark:bg-sky-950/60 dark:text-sky-200 cursor-pointer"
                      >
                        <span>Chọn tệp</span>
                        <input
                          id="essay-trial-files"
                          type="file"
                          multiple
                          accept=".jpg,.jpeg,.png,.webp,.pdf,.doc,.docx,.txt"
                          onChange={(event) => {
                            const picked = Array.from(event.target.files ?? []);
                            if (picked.length) setFiles((prev) => [...prev, ...picked].slice(0, 5));
                            event.target.value = "";
                          }}
                          className="sr-only"
                        />
                      </label>
                      <span className="text-xs text-slate-500 dark:text-slate-400">
                        {files.length === 0 ? "Chưa có tệp nào được chọn" : `Đã chọn ${files.length} tệp`}
                      </span>
                    </div>
                    {files.map((file, index) => (
                      <div key={`${file.name}-${index}`} className="mt-2 flex items-center justify-between text-xs text-slate-600 dark:text-slate-300">
                        <span className="truncate">{file.name}</span>
                        <button
                          type="button"
                          onClick={() => setFiles((prev) => prev.filter((_, idx) => idx !== index))}
                          className="text-rose-600 hover:underline cursor-pointer"
                        >
                          Bỏ tệp
                        </button>
                      </div>
                    ))}
                  </div>

                  {error && (
                    <p role="alert" className="rounded-lg bg-rose-50 p-3 text-xs font-semibold text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">
                      {error}
                    </p>
                  )}
                </div>
              </form>
            )}
          </div>
        </div>

        <footer className="flex flex-wrap justify-end gap-2.5 border-t border-slate-200 px-6 py-4 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-900/90 shrink-0">
          {submittedPreview ? (
            <>
              <button
                type="button"
                onClick={() => {
                  setSubmittedPreview(null);
                }}
                className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 cursor-pointer"
              >
                Làm thử lại
              </button>
              <button
                type="button"
                onClick={onClose}
                className="rounded-xl bg-blue-600 px-5 py-2 text-xs font-bold text-white hover:bg-blue-700 cursor-pointer"
              >
                Đóng
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={onClose}
                className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 cursor-pointer"
              >
                Hủy
              </button>
              <button
                type="submit"
                form="essay-trial-form"
                className="rounded-xl bg-emerald-600 px-5 py-2 text-xs font-bold text-white hover:bg-emerald-700 cursor-pointer"
              >
                Nộp bài thử
              </button>
            </>
          )}
        </footer>
      </section>
    </div>
  );
}

/** Modal chỉnh sửa bài tập trắc nghiệm trực tiếp trong màn hình lớp học. */
export function ClassExamEditModal({
  exam,
  roleCode,
  classCourseId,
  classEndAt,
  classQuestions,
  onClose,
  onSaved,
}: {
  exam: Exam | null;
  roleCode: RoleCode;
  classCourseId?: string;
  classEndAt?: string;
  classQuestions: ClassQuestion[];
  onClose: () => void;
  onSaved: () => Promise<void> | void;
}) {
  const { notify } = useApp();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [hasAttempts, setHasAttempts] = useState(false);
  const [attemptsCount, setAttemptsCount] = useState(0);
  const [title, setTitle] = useState("");
  const [durationMinutes, setDurationMinutes] = useState(45);
  const [openAt, setOpenAt] = useState("");
  const [closeAt, setCloseAt] = useState("");
  const [attemptLimit, setAttemptLimit] = useState(1);
  const [shuffleQuestions, setShuffleQuestions] = useState(false);
  const [aiTutorEnabled, setAiTutorEnabled] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [balanceTargetScore, setBalanceTargetScore] = useState(10);
  const [questions, setQuestions] = useState<EditableExamQuestion[]>([]);
  const [selectedBankQuestionId, setSelectedBankQuestionId] = useState("");

  useEffect(() => {
    if (!exam) return;
    const controller = new AbortController();
    setTitle(exam.title);
    setDurationMinutes(exam.durationMinutes);
    setOpenAt(toLocalDateTimeInput(exam.openAt));
    setCloseAt(toLocalDateTimeInput(exam.closeAt));
    setAttemptLimit(exam.attemptLimit);
    setShuffleQuestions(Boolean(exam.shuffleQuestions));
    setAiTutorEnabled(Boolean(exam.aiTutorEnabled));
    setHidden(Boolean(exam.hidden));
    setBalanceTargetScore(exam.totalScore >= 0.25 ? exam.totalScore : 10);
    setQuestions([]);
    setSelectedBankQuestionId("");
    setLoading(true);
    setHasAttempts(false);
    setAttemptsCount(0);

    void Promise.all([
      apiRequest<Question[]>(`/instructor/exams/${encodeURIComponent(exam.id)}/preview`, {
        roleCode,
        signal: controller.signal,
      }),
      apiRequest<ExamAttempt[]>(`/instructor/exam-attempts?examId=${encodeURIComponent(exam.id)}`, {
        roleCode,
        signal: controller.signal,
      }).catch(() => [] as ExamAttempt[]),
    ])
      .then(([previewRows, attempts]) => {
        if (controller.signal.aborted) return;
        const rows = Array.isArray(previewRows) ? previewRows : [];
        const defaultScore = Math.round((exam.totalScore / Math.max(1, rows.length)) * 100) / 100;
        setQuestions(
          rows.map((q) => ({
            id: q.id,
            originalId: q.id,
            content: q.content,
            type: q.type,
            options: [...q.options],
            correctAnswers: [...q.correctAnswers],
            score: exam.questionScores?.[q.id] ?? defaultScore,
          })),
        );
        const count = Array.isArray(attempts) ? attempts.length : 0;
        setAttemptsCount(count);
        setHasAttempts(count > 0);
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          notify(error instanceof Error ? error.message : "Không tải được dữ liệu đề thi để chỉnh sửa.", "error");
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [exam, roleCode, notify]);

  if (!exam) return null;

  const computedTotalScore = Math.round(questions.reduce((sum, q) => sum + (Number(q.score) || 0), 0) * 100) / 100;
  const availableBankQuestions = classQuestions.filter(
    (q) => q.status === "PUBLISHED" && !questions.some((entry) => entry.id === q.id || entry.originalId === q.id),
  );

  // Cập nhật thuộc tính một câu hỏi đang chỉnh sửa trong modal đề thi.
  const updateQuestion = (index: number, patch: Partial<EditableExamQuestion>) => {
    setQuestions((prev) =>
      prev.map((q, idx) => (idx === index ? { ...q, ...patch, dirtyContent: patch.dirtyContent ?? true } : q)),
    );
  };

  // Chia đều điểm tổng mục tiêu cho các câu hỏi hiện có trong đề.
  const handleBalanceScores = () => {
    if (!questions.length) return;
    const target = balanceTargetScore >= 0.25 ? balanceTargetScore : 10;
    const base = Math.floor((target / questions.length) * 100) / 100;
    const remainder = Math.round((target - base * (questions.length - 1)) * 100) / 100;
    setQuestions((prev) =>
      prev.map((q, idx) => ({ ...q, score: idx === prev.length - 1 ? remainder : base })),
    );
  };

  // Thêm nhanh một câu hỏi trắc nghiệm mới trực tiếp vào danh sách câu của đề.
  const handleAddInlineQuestion = () => {
    const newId = `new-${crypto.randomUUID()}`;
    setQuestions((prev) => [
      ...prev,
      {
        id: newId,
        content: "",
        type: "SINGLE_CHOICE",
        options: ["A. Phương án A", "B. Phương án B", "C. Phương án C", "D. Phương án D"],
        correctAnswers: ["A. Phương án A"],
        score: 1,
        isNew: true,
      },
    ]);
  };

  // Đưa câu hỏi đã chọn từ ngân hàng câu hỏi lớp vào danh sách câu của đề.
  const handleAddFromBank = () => {
    const picked = availableBankQuestions.find((q) => q.id === selectedBankQuestionId);
    if (!picked) return;
    const mappedType: Question["type"] =
      picked.type === "Tự luận" ? "ESSAY"
        : picked.type === "Nhiều đáp án" ? "MULTIPLE_CHOICE"
          : picked.type === "Đúng / Sai" ? "TRUE_FALSE"
            : picked.type === "Điền khuyết" ? "SHORT_ANSWER"
              : "SINGLE_CHOICE";
    const opts = picked.options ?? [];
    const answers = (picked.correctAnswers ?? [])
      .map((idx) => opts[idx])
      .filter((val): val is string => Boolean(val));
    setQuestions((prev) => [
      ...prev,
      {
        id: picked.id,
        originalId: picked.id,
        content: picked.content,
        type: mappedType,
        options: [...opts],
        correctAnswers: answers,
        score: 1,
      },
    ]);
    setSelectedBankQuestionId("");
  };

  // Kiểm tra hợp lệ thời gian/thang điểm và lưu cấu hình chỉnh sửa đề thi lên API.
  const handleSave = async () => {
    if (saving || loading) return;
    const trimmedTitle = title.trim();
    if (trimmedTitle.length < 3 || trimmedTitle.length > 255) {
      notify("Tên bài tập cần từ 3 đến 255 ký tự.", "error");
      return;
    }
    const parsedOpen = parseLocalDateTimeInput(openAt);
    const parsedClose = parseLocalDateTimeInput(closeAt);
    const openMs = parsedOpen ? parsedOpen.getTime() : NaN;
    const closeMs = parsedClose ? parsedClose.getTime() : NaN;
    const classEndMs = classEndAt ? Date.parse(classEndAt) : NaN;
    if (!Number.isFinite(openMs) || !Number.isFinite(closeMs) || closeMs <= openMs) {
      notify("Thời gian đóng đề phải hợp lệ và muộn hơn thời gian mở.", "error");
      return;
    }
    if (Number.isFinite(classEndMs) && closeMs > classEndMs) {
      notify("Hạn nộp không được vượt quá ngày kết thúc lớp.", "error");
      return;
    }
    if (!Number.isInteger(durationMinutes) || durationMinutes < 1 || durationMinutes > 600) {
      notify("Thời lượng phải là số nguyên từ 1 đến 600 phút.", "error");
      return;
    }
    if (!Number.isInteger(attemptLimit) || attemptLimit < 1 || attemptLimit > 10) {
      notify("Số lần làm bài phải từ 1 đến 10.", "error");
      return;
    }
    if (questions.length === 0) {
      notify("Đề trắc nghiệm cần ít nhất một câu hỏi.", "error");
      return;
    }
    if (!hasAttempts) {
      for (const [idx, q] of questions.entries()) {
        const cleanOptions = q.options.map((opt) => opt.trim()).filter(Boolean);
        const cleanAnswers = q.correctAnswers.map((ans) => ans.trim()).filter(Boolean);
        if (q.content.trim().length < 5) {
          notify(`Câu ${idx + 1}: nội dung cần ít nhất 5 ký tự.`, "error");
          return;
        }
        if (["SINGLE_CHOICE", "MULTIPLE_CHOICE", "TRUE_FALSE"].includes(q.type)) {
          if (cleanOptions.length < 2 || new Set(cleanOptions).size !== cleanOptions.length) {
            notify(`Câu ${idx + 1}: cần ít nhất 2 phương án không trùng nhau.`, "error");
            return;
          }
          if (!cleanAnswers.length || !cleanAnswers.every((ans) => cleanOptions.includes(ans))) {
            notify(`Câu ${idx + 1}: cần chọn ít nhất một đáp án đúng thuộc danh sách phương án.`, "error");
            return;
          }
        } else if (!cleanAnswers.length) {
          notify(`Câu ${idx + 1}: cần nhập ít nhất một đáp án hoặc ý tham khảo.`, "error");
          return;
        }
        if (!Number.isFinite(q.score) || q.score < 0.01) {
          notify(`Câu ${idx + 1}: điểm câu hỏi phải từ 0,01 trở lên.`, "error");
          return;
        }
      }
      if (computedTotalScore < 0.25) {
        notify("Tổng điểm của đề phải đạt ít nhất 0,25 điểm.", "error");
        return;
      }
    }

    setSaving(true);
    try {
      let currentVersion = exam.version;
      if (hidden !== Boolean(exam.hidden)) {
        const vis = await apiRequest<{ hidden: boolean; version: number }>(
          `/instructor/exams/${encodeURIComponent(exam.id)}/visibility`,
          {
            method: "PATCH",
            roleCode,
            body: JSON.stringify({ hidden, expectedVersion: currentVersion }),
          },
        );
        currentVersion = vis.version;
      }

      const resolvedQuestions = [...questions];
      if (!hasAttempts) {
        for (let i = 0; i < resolvedQuestions.length; i += 1) {
          const entry = resolvedQuestions[i]!;
          if (entry.isNew || !entry.dirtyContent || !entry.originalId) continue;
          const cleanOptions = entry.options.map((opt) => opt.trim()).filter(Boolean);
          const cleanAnswers = entry.correctAnswers.map((ans) => ans.trim()).filter(Boolean);
          const updatedQuestion = await apiRequest<Question>(
            `/instructor/exams/${encodeURIComponent(exam.id)}/questions/${encodeURIComponent(entry.originalId)}`,
            {
              method: "PATCH",
              roleCode,
              body: JSON.stringify({
                content: entry.content.trim(),
                options: cleanOptions,
                correctAnswers: cleanAnswers,
                expectedVersion: currentVersion,
              }),
            },
          );
          resolvedQuestions[i] = { ...entry, id: updatedQuestion.id, originalId: updatedQuestion.id };
          currentVersion += 1;
        }

        const brandNew = resolvedQuestions.filter((q) => q.isNew);
        if (brandNew.length > 0) {
          if (!classCourseId) {
            throw new Error("Lớp chưa liên kết khóa học nên không thể thêm câu hỏi mới.");
          }
          const imported = await apiRequest<Array<{ row: number; status: string; questionId?: string; message: string }>>(
            "/instructor/question-bank/questions/import",
            {
              method: "POST",
              roleCode,
              body: JSON.stringify({
                questions: brandNew.map((q) => ({
                  courseId: classCourseId,
                  type: q.type,
                  content: q.content.trim(),
                  options: q.options.map((opt) => opt.trim()).filter(Boolean),
                  correctAnswers: q.correctAnswers.map((ans) => ans.trim()).filter(Boolean),
                  difficulty: 2,
                  tags: ["Trắc nghiệm", "Chỉnh sửa trong lớp"],
                })),
              }),
            },
          );
          const createdIds = imported.map((item) => item.questionId);
          if (createdIds.some((idVal) => !idVal)) {
            throw new Error("Không thể lưu câu hỏi mới vào ngân hàng.");
          }
          let cursor = 0;
          for (let i = 0; i < resolvedQuestions.length; i += 1) {
            if (resolvedQuestions[i]!.isNew) {
              resolvedQuestions[i] = { ...resolvedQuestions[i]!, id: createdIds[cursor]!, isNew: false };
              cursor += 1;
            }
          }
        }
      }

      const finalQuestionIds = hasAttempts ? exam.questionIds : resolvedQuestions.map((q) => q.id);
      const finalTotalScore = hasAttempts ? exam.totalScore : computedTotalScore;
      const finalDuration = hasAttempts ? exam.durationMinutes : durationMinutes;
      const finalScores = hasAttempts
        ? finalQuestionIds.map((qid) => ({
            questionId: qid,
            score: exam.questionScores?.[qid] ?? Math.round((exam.totalScore / Math.max(1, finalQuestionIds.length)) * 100) / 100,
          }))
        : resolvedQuestions.map((q) => ({ questionId: q.id, score: Number(q.score) }));

      await apiRequest<Exam>(`/instructor/exams/${encodeURIComponent(exam.id)}`, {
        method: "PATCH",
        roleCode,
        body: JSON.stringify({
          classId: exam.classId,
          title: trimmedTitle,
          questionIds: finalQuestionIds,
          durationMinutes: finalDuration,
          totalScore: finalTotalScore,
          openAt: localDateTimeToIso(openAt),
          closeAt: localDateTimeToIso(closeAt),
          attemptLimit,
          shuffleQuestions,
          aiTutorEnabled,
          ...(exam.randomSeed ? { randomSeed: exam.randomSeed } : {}),
          scoreAllocations: finalScores,
          expectedVersion: currentVersion,
        }),
      });

      await onSaved();
      notify("Đã cập nhật bài tập trắc nghiệm.", "success");
      onClose();
    } catch (error: unknown) {
      notify(error instanceof Error ? error.message : "Không thể cập nhật bài tập trắc nghiệm.", "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/65 p-4 backdrop-blur-xs" role="presentation">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="class-exam-edit-title"
        className="flex max-h-[92dvh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900"
      >
        <header className="flex items-center justify-between border-b border-slate-200 px-6 py-4 dark:border-slate-800">
          <div>
            <h2 id="class-exam-edit-title" className="text-base font-extrabold text-slate-900 dark:text-slate-100">
              Chỉnh sửa bài tập trắc nghiệm: {exam.title}
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Cập nhật cấu hình, thời hạn và nội dung câu hỏi ngay trong lớp học.
            </p>
          </div>
          <button
            type="button"
            aria-label="Đóng chỉnh sửa bài tập trắc nghiệm"
            disabled={saving}
            onClick={onClose}
            className="rounded-xl p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
          >
            <X size={18} />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto p-6 space-y-5 text-xs">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-12 text-slate-500">
              <LoaderCircle size={18} className="animate-spin text-blue-600" />
              <span>Đang tải dữ liệu đề...</span>
            </div>
          ) : (
            <>
              {hasAttempts && (
                <div role="status" className="rounded-xl border border-amber-200 bg-amber-50 p-3.5 text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200 flex items-start gap-2.5">
                  <AlertTriangle size={16} className="shrink-0 mt-0.5" />
                  <p>
                    Đề đã có {attemptsCount} lượt làm bài của học sinh. Câu hỏi, thời lượng và thang điểm được khóa để bảo toàn điểm đã chấm; bạn vẫn có thể chỉnh tiêu đề, thời gian mở/đóng, số lượt làm, xáo trộn và trạng thái ẩn/hiện.
                  </p>
                </div>
              )}

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <label htmlFor="edit-exam-title" className="mb-1 block font-bold text-slate-700 dark:text-slate-300">
                    Tiêu đề bài tập <span className="text-rose-500">*</span>
                  </label>
                  <input
                    id="edit-exam-title"
                    type="text"
                    value={title}
                    onChange={(event) => setTitle(event.target.value)}
                    className={fieldClass}
                  />
                </div>

                <div>
                  <label htmlFor="edit-exam-open" className="mb-1 block font-bold text-slate-700 dark:text-slate-300">
                    Thời gian mở
                  </label>
                  <input
                    id="edit-exam-open"
                    type="datetime-local"
                    value={openAt}
                    onChange={(event) => setOpenAt(event.target.value)}
                    className={fieldClass}
                  />
                </div>

                <div>
                  <label htmlFor="edit-exam-close" className="mb-1 block font-bold text-slate-700 dark:text-slate-300">
                    Hạn nộp / Đóng đề
                  </label>
                  <input
                    id="edit-exam-close"
                    type="datetime-local"
                    value={closeAt}
                    onChange={(event) => setCloseAt(event.target.value)}
                    className={fieldClass}
                  />
                </div>

                <div>
                  <label htmlFor="edit-exam-duration" className="mb-1 block font-bold text-slate-700 dark:text-slate-300">
                    Thời lượng (phút)
                  </label>
                  <input
                    id="edit-exam-duration"
                    type="number"
                    min={1}
                    max={600}
                    disabled={hasAttempts}
                    value={durationMinutes}
                    onChange={(event) => setDurationMinutes(Number(event.target.value))}
                    className={`${fieldClass} disabled:opacity-60`}
                  />
                </div>

                <div>
                  <label htmlFor="edit-exam-attempts" className="mb-1 block font-bold text-slate-700 dark:text-slate-300">
                    Số lần làm bài tối đa
                  </label>
                  <input
                    id="edit-exam-attempts"
                    type="number"
                    min={1}
                    max={10}
                    value={attemptLimit}
                    onChange={(event) => setAttemptLimit(Number(event.target.value))}
                    className={fieldClass}
                  />
                </div>
              </div>

              <div className="flex flex-wrap gap-5 pt-1">
                <label className="inline-flex items-center gap-2 font-semibold text-slate-700 dark:text-slate-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={shuffleQuestions}
                    onChange={(event) => setShuffleQuestions(event.target.checked)}
                    className="size-4 accent-blue-600"
                  />
                  <span>Xáo trộn thứ tự câu hỏi</span>
                </label>

                <label className="inline-flex items-center gap-2 font-semibold text-slate-700 dark:text-slate-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={hidden}
                    onChange={(event) => setHidden(event.target.checked)}
                    className="size-4 accent-blue-600"
                  />
                  <span>Ẩn bài tập với học sinh</span>
                </label>

                <label className="inline-flex items-center gap-2 font-semibold text-indigo-700 dark:text-indigo-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={aiTutorEnabled}
                    onChange={(event) => setAiTutorEnabled(event.target.checked)}
                    className="size-4 accent-indigo-600"
                  />
                  <span>Cho phép hỏi đáp AI dẫn dắt theo từng câu</span>
                </label>
              </div>

              <div className="space-y-3 border-t border-slate-200 dark:border-slate-800 pt-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h3 className="text-sm font-extrabold text-slate-900 dark:text-slate-100">
                      Câu hỏi trong đề ({questions.length} câu · Tổng {computedTotalScore} điểm)
                    </h3>
                  </div>
                  {!hasAttempts && (
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-slate-600 dark:text-slate-300">Thang chia đều:</span>
                      <ScoreStepperInput
                        ariaLabel="Thang điểm chia đều đề thi"
                        stepTargetLabel="thang điểm chia đều"
                        min={0.25}
                        max={1000}
                        value={balanceTargetScore}
                        onChange={(val) => setBalanceTargetScore(val >= 0.25 ? val : 0.25)}
                      />
                      <button
                        type="button"
                        onClick={handleBalanceScores}
                        className="rounded-lg border border-slate-200 dark:border-slate-700 px-2.5 py-1.5 font-bold text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                      >
                        Chia đều điểm
                      </button>
                      <button
                        type="button"
                        onClick={handleAddInlineQuestion}
                        className="inline-flex items-center gap-1 rounded-lg bg-blue-50 dark:bg-blue-950/50 border border-blue-200 dark:border-blue-800 px-2.5 py-1.5 font-bold text-blue-700 dark:text-blue-300 hover:bg-blue-100 cursor-pointer"
                      >
                        <Plus size={13} />
                        <span>Thêm câu hỏi</span>
                      </button>
                    </div>
                  )}
                </div>

                {!hasAttempts && availableBankQuestions.length > 0 && (
                  <div className="flex flex-wrap items-center gap-2 rounded-xl bg-slate-50 dark:bg-slate-800/50 p-3 border border-slate-200/80 dark:border-slate-800">
                    <select
                      aria-label="Chọn câu hỏi từ ngân hàng lớp"
                      value={selectedBankQuestionId}
                      onChange={(event) => setSelectedBankQuestionId(event.target.value)}
                      className={`${fieldClass} flex-1`}
                    >
                      <option value="">-- Thêm câu đã xuất bản từ ngân hàng lớp --</option>
                      {availableBankQuestions.map((bankQ) => (
                        <option key={bankQ.id} value={bankQ.id}>
                          {bankQ.content.slice(0, 90)}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      disabled={!selectedBankQuestionId}
                      onClick={handleAddFromBank}
                      className="rounded-xl bg-slate-900 px-3 py-2 font-bold text-white disabled:opacity-40 dark:bg-white dark:text-slate-900 cursor-pointer"
                    >
                      Thêm vào đề
                    </button>
                  </div>
                )}

                <div className="space-y-3">
                  {questions.map((q, qIdx) => {
                    const isChoice = ["SINGLE_CHOICE", "MULTIPLE_CHOICE", "TRUE_FALSE"].includes(q.type);
                    return (
                      <div key={q.id} className="rounded-xl border border-slate-200 dark:border-slate-800 p-4 space-y-3 bg-white dark:bg-slate-900/60">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-extrabold text-slate-900 dark:text-slate-100">
                            Câu {qIdx + 1} · {QUESTION_TYPE_LABELS[q.type] ?? q.type}
                          </span>
                          <div className="flex items-center gap-2">
                            <span className="inline-flex items-center gap-1.5 text-slate-600 dark:text-slate-300">
                              <span>Điểm:</span>
                              <ScoreStepperInput
                                ariaLabel={`Điểm câu ${qIdx + 1}`}
                                stepTargetLabel={`câu ${qIdx + 1}`}
                                min={0.25}
                                max={1000}
                                disabled={hasAttempts}
                                value={q.score}
                                onChange={(val) =>
                                  updateQuestion(qIdx, { score: val, dirtyContent: q.dirtyContent })
                                }
                              />
                            </span>
                            {!hasAttempts && questions.length > 1 && (
                              <button
                                type="button"
                                aria-label={`Xóa câu ${qIdx + 1}`}
                                onClick={() => setQuestions((prev) => prev.filter((_, idx) => idx !== qIdx))}
                                className="rounded-lg p-1.5 text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/30 cursor-pointer"
                              >
                                <Trash2 size={14} />
                              </button>
                            )}
                          </div>
                        </div>

                        <textarea
                          aria-label={`Nội dung câu ${qIdx + 1}`}
                          rows={2}
                          disabled={hasAttempts}
                          value={q.content}
                          onChange={(event) => updateQuestion(qIdx, { content: event.target.value })}
                          className={`${fieldClass} disabled:opacity-60`}
                        />

                        {isChoice ? (
                          <div className="space-y-2">
                            {q.options.map((opt, optIdx) => {
                              const checked = q.correctAnswers.includes(opt);
                              return (
                                <div key={`${q.id}-opt-${optIdx}`} className="flex items-center gap-2">
                                  <input
                                    type={q.type === "MULTIPLE_CHOICE" ? "checkbox" : "radio"}
                                    name={`edit-q-${q.id}`}
                                    disabled={hasAttempts}
                                    checked={checked}
                                    onChange={() => {
                                      if (q.type === "MULTIPLE_CHOICE") {
                                        const nextAns = checked
                                          ? q.correctAnswers.filter((ans) => ans !== opt)
                                          : [...q.correctAnswers, opt];
                                        updateQuestion(qIdx, { correctAnswers: nextAns });
                                      } else {
                                        updateQuestion(qIdx, { correctAnswers: [opt] });
                                      }
                                    }}
                                    className="size-4 accent-emerald-600 shrink-0"
                                    title="Đánh dấu đáp án đúng"
                                  />
                                  <input
                                    type="text"
                                    disabled={hasAttempts}
                                    value={opt}
                                    onChange={(event) => {
                                      const nextText = event.target.value;
                                      const nextOptions = q.options.map((item, idx) => (idx === optIdx ? nextText : item));
                                      const nextAnswers = q.correctAnswers.map((ans) => (ans === opt ? nextText : ans));
                                      updateQuestion(qIdx, { options: nextOptions, correctAnswers: nextAnswers });
                                    }}
                                    className={`${fieldClass} flex-1 disabled:opacity-60`}
                                  />
                                  {!hasAttempts && q.options.length > 2 && (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        const nextOptions = q.options.filter((_, idx) => idx !== optIdx);
                                        const nextAnswers = q.correctAnswers.filter((ans) => ans !== opt);
                                        updateQuestion(qIdx, {
                                          options: nextOptions,
                                          correctAnswers: nextAnswers.length ? nextAnswers : [nextOptions[0]!],
                                        });
                                      }}
                                      className="p-1 text-slate-400 hover:text-rose-600 cursor-pointer"
                                      title="Xóa phương án"
                                    >
                                      <Trash2 size={13} />
                                    </button>
                                  )}
                                </div>
                              );
                            })}
                            {!hasAttempts && (
                              <button
                                type="button"
                                onClick={() => {
                                  const letter = String.fromCharCode(65 + q.options.length);
                                  updateQuestion(qIdx, { options: [...q.options, `${letter}. Phương án ${letter}`] });
                                }}
                                className="text-[11px] font-bold text-blue-600 hover:underline cursor-pointer"
                              >
                                + Thêm phương án
                              </button>
                            )}
                          </div>
                        ) : (
                          <div>
                            <label className="mb-1 block text-[11px] font-bold text-slate-500">
                              Đáp án / ý tham khảo (mỗi dòng một ý):
                            </label>
                            <textarea
                              rows={2}
                              disabled={hasAttempts}
                              value={q.correctAnswers.join("\n")}
                              onChange={(event) =>
                                updateQuestion(qIdx, {
                                  correctAnswers: event.target.value.split("\n"),
                                })
                              }
                              className={`${fieldClass} disabled:opacity-60`}
                            />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </>
          )}
        </div>

        <footer className="flex items-center justify-end gap-2 border-t border-slate-200 px-6 py-4 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/60">
          <button
            type="button"
            disabled={saving}
            onClick={onClose}
            className="rounded-xl border border-slate-200 dark:border-slate-700 px-4 py-2 text-xs font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
          >
            Hủy
          </button>
          <button
            type="button"
            disabled={saving || loading}
            onClick={() => void handleSave()}
            className="rounded-xl bg-blue-600 px-5 py-2 text-xs font-bold text-white hover:bg-blue-700 disabled:opacity-50 cursor-pointer"
          >
            {saving ? "Đang lưu..." : "Lưu thay đổi"}
          </button>
        </footer>
      </section>
    </div>
  );
}

/** Modal chỉnh sửa bài tập tự luận hoàn chỉnh (không yêu cầu mô tả thừa, hỗ trợ sửa tệp đề đính kèm). */
export function ClassAssignmentEditModal({
  assignment,
  classId,
  classEndAt,
  roleCode,
  onClose,
  onSaved,
}: {
  assignment: Assignment | null;
  classId: string;
  classEndAt?: string;
  roleCode: RoleCode;
  onClose: () => void;
  onSaved: () => Promise<void> | void;
}) {
  const { notify } = useApp();
  const [title, setTitle] = useState("");
  const [instructions, setInstructions] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [maxScore, setMaxScore] = useState(10);
  const [mcScoreInput, setMcScoreInput] = useState("0");
  const [essayScoreInput, setEssayScoreInput] = useState("10");
  const [usesStandardSections, setUsesStandardSections] = useState(true);
  const [hidden, setHidden] = useState(false);
  const [rubric, setRubric] = useState<Assignment["rubric"]>([]);
  const [replacementFile, setReplacementFile] = useState<File | null>(null);
  const [removeSourceMaterial, setRemoveSourceMaterial] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!assignment) return;
    setTitle(assignment.title);
    setInstructions(assignment.instructions || "");
    setDueAt(toLocalDateTimeInput(assignment.dueAt));
    setMaxScore(assignment.maxScore);
    setHidden(Boolean(assignment.hidden));
    setRubric(assignment.rubric.map((entry) => ({ ...entry })));
    const isLegacySingle =
      assignment.rubric.length === 1 &&
      (assignment.rubric[0]!.title === "Mức độ hoàn thành" ||
        assignment.rubric[0]!.title === "Nội dung");
    const isStandard =
      assignment.rubric.length === 0 ||
      isLegacySingle ||
      assignment.rubric.every(
        (entry) =>
          entry.title === "Phần trắc nghiệm" || entry.title === "Phần tự luận",
      );
    setUsesStandardSections(isStandard);
    if (isStandard) {
      if (isLegacySingle) {
        setMcScoreInput("0");
        setEssayScoreInput(String(assignment.rubric[0]!.maxPoints));
      } else if (assignment.rubric.length === 0) {
        setMcScoreInput("0");
        setEssayScoreInput(String(assignment.maxScore || 10));
      } else {
        const mc = assignment.rubric.find((entry) => entry.title === "Phần trắc nghiệm");
        const essay = assignment.rubric.find((entry) => entry.title === "Phần tự luận");
        setMcScoreInput(String(mc?.maxPoints ?? 0));
        setEssayScoreInput(String(essay?.maxPoints ?? 0));
      }
    }
    setReplacementFile(null);
    setRemoveSourceMaterial(false);
  }, [assignment]);

  if (!assignment) return null;

  const isClosed = assignment.status === "CLOSED";

  // Tiếp nhận tệp đề bài mới được chọn để thay thế tệp đề hiện tại.
  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setReplacementFile(file);
    setRemoveSourceMaterial(false);
  };

  // Kiểm tra dữ liệu chỉnh sửa bài tập tự luận và gửi yêu cầu cập nhật kèm tệp đề mới nếu có.
  const handleSave = async () => {
    if (saving || isClosed) return;
    const trimmedTitle = title.trim();
    const trimmedInstructions = instructions.trim();
    const parsedDue = parseLocalDateTimeInput(dueAt);
    const classEndMs = classEndAt ? Date.parse(classEndAt) : NaN;
    if (trimmedTitle.length < 3 || trimmedTitle.length > 255) {
      notify("Tiêu đề bài tập cần từ 3 đến 255 ký tự.", "error");
      return;
    }
    if (trimmedInstructions.length < 5 || trimmedInstructions.length > 10_000) {
      notify("Nội dung đề bài / hướng dẫn cần từ 5 đến 10.000 ký tự.", "error");
      return;
    }
    if (!parsedDue || parsedDue.getTime() <= Date.now()) {
      notify("Hạn nộp phải nằm ở tương lai.", "error");
      return;
    }
    if (Number.isFinite(classEndMs) && parsedDue.getTime() > classEndMs) {
      notify("Hạn nộp không được vượt quá ngày kết thúc lớp.", "error");
      return;
    }

    let resolvedMaxScore = maxScore;
    let nextRubric: Array<{ title: string; description: string; maxPoints: number }> = [];
    if (usesStandardSections) {
      const parsedMc = Number((mcScoreInput || "0").trim().replace(",", "."));
      const parsedEssay = Number((essayScoreInput || "0").trim().replace(",", "."));
      if (
        !Number.isFinite(parsedMc) ||
        !Number.isFinite(parsedEssay) ||
        parsedMc < 0 ||
        parsedEssay < 0 ||
        Math.abs(Math.round(parsedMc * 100) - parsedMc * 100) > 1e-6 ||
        Math.abs(Math.round(parsedEssay * 100) - parsedEssay * 100) > 1e-6
      ) {
        notify("Điểm các phần phải không âm và có tối đa 2 chữ số thập phân.", "error");
        return;
      }
      if ((parsedMc > 0 && parsedMc < 0.25) || (parsedEssay > 0 && parsedEssay < 0.25)) {
        notify("Mỗi phần có tính điểm cần đạt từ 0,25 điểm trở lên (hoặc để 0 nếu không có).", "error");
        return;
      }
      resolvedMaxScore = Math.round((parsedMc + parsedEssay) * 100) / 100;
      if (resolvedMaxScore < 0.25 || resolvedMaxScore > 1000) {
        notify("Điểm tối đa phải nằm trong khoảng 0,25–1000.", "error");
        return;
      }
      if (parsedMc > 0) {
        nextRubric.push({
          title: "Phần trắc nghiệm",
          description: "Điểm phần trắc nghiệm.",
          maxPoints: Math.round(parsedMc * 100) / 100,
        });
      }
      if (parsedEssay > 0) {
        nextRubric.push({
          title: "Phần tự luận",
          description: "Điểm phần tự luận.",
          maxPoints: Math.round(parsedEssay * 100) / 100,
        });
      }
    } else {
      if (
        !Number.isFinite(maxScore) ||
        maxScore < 0.25 ||
        maxScore > 1000 ||
        Math.abs(Math.round(maxScore * 100) - maxScore * 100) > 1e-8
      ) {
        notify("Điểm tối đa phải nằm trong khoảng 0,25–1000.", "error");
        return;
      }
      nextRubric = rubric.map((criterion) => ({
        title: criterion.title.trim() || "Phần tự luận",
        description: criterion.description?.trim() || "Đánh giá chất lượng bài làm.",
        maxPoints: criterion.maxPoints,
      }));
      if (!nextRubric.length) {
        nextRubric.push({
          title: "Phần tự luận",
          description: "Điểm phần tự luận.",
          maxPoints: maxScore,
        });
      } else if (nextRubric.length === 1) {
        nextRubric[0]!.maxPoints = maxScore;
      }
      const rubricSum = nextRubric.reduce((sum, entry) => sum + entry.maxPoints, 0);
      if (
        nextRubric.some((entry) => !Number.isFinite(entry.maxPoints) || entry.maxPoints < 0.25 || entry.maxPoints > 1000) ||
        Math.abs(rubricSum - maxScore) > 0.001
      ) {
        notify("Mỗi tiêu chí cần ít nhất 0,25 điểm và tổng điểm các tiêu chí phải bằng điểm tối đa.", "error");
        return;
      }
    }

    setSaving(true);
    try {
      let sourceMaterialIdPatch: string | undefined;
      if (replacementFile) {
        const form = new FormData();
        form.append("file", replacementFile);
        form.append("folder", "Bài tập tự luận");
        form.append("tags", "ESSAY,ASSIGNMENT");
        form.append("visibility", hidden ? "HIDDEN" : "PUBLISHED");
        form.append("scope", "CLASS");
        const uploaded = await apiRequest<Material>(
          `/instructor/classes/${encodeURIComponent(classId)}/material-uploads`,
          { method: "POST", roleCode, body: form },
        );
        sourceMaterialIdPatch = uploaded.id;
      } else if (removeSourceMaterial) {
        sourceMaterialIdPatch = "";
      }

      const fallbackDesc =
        assignment.description?.trim().length >= 10
          ? assignment.description.trim()
          : `Bài tập tự luận: ${trimmedTitle}`;

      await apiRequest<Assignment>(`/instructor/assignments/${encodeURIComponent(assignment.id)}`, {
        method: "PATCH",
        roleCode,
        body: JSON.stringify({
          title: trimmedTitle,
          description: fallbackDesc,
          instructions: trimmedInstructions,
          dueAt: parsedDue.toISOString(),
          maxScore: resolvedMaxScore,
          rubric: nextRubric,
          hidden,
          ...(sourceMaterialIdPatch !== undefined ? { sourceMaterialId: sourceMaterialIdPatch } : {}),
          expectedVersion: assignment.version,
        }),
      });

      await onSaved();
      notify("Đã cập nhật bài tập tự luận.", "success");
      onClose();
    } catch (error: unknown) {
      notify(error instanceof Error ? error.message : "Không thể lưu bài tập tự luận.", "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/65 p-4 backdrop-blur-xs" role="presentation">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="class-assignment-edit-title"
        className="flex max-h-[90dvh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900"
      >
        <header className="flex items-center justify-between border-b border-slate-200 px-6 py-4 dark:border-slate-800">
          <div>
            <h2 id="class-assignment-edit-title" className="text-base font-extrabold text-slate-900 dark:text-slate-100">
              Chỉnh sửa bài tập tự luận: {assignment.title}
            </h2>
            <p className="text-xs text-slate-500">Cập nhật đề bài, tệp đính kèm, hạn nộp và thang điểm.</p>
          </div>
          <button
            type="button"
            aria-label="Đóng chỉnh sửa bài tập tự luận"
            disabled={saving}
            onClick={onClose}
            className="rounded-xl p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
          >
            <X size={18} />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto p-6 space-y-4 text-xs">
          {isClosed && (
            <div role="status" className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
              Bài tập đã đóng nên không thể chỉnh sửa nội dung.
            </div>
          )}

          <label className="inline-flex items-center gap-2 font-semibold text-slate-700 dark:text-slate-300 cursor-pointer">
            <input
              type="checkbox"
              checked={hidden}
              disabled={isClosed}
              onChange={(event) => setHidden(event.target.checked)}
              className="size-4 accent-blue-600"
            />
            <span>Ẩn bài tập với học sinh</span>
          </label>

          <div>
            <label htmlFor="edit-assignment-title" className="mb-1 block font-bold text-slate-700 dark:text-slate-300">
              Tiêu đề bài tập <span className="text-rose-500">*</span>
            </label>
            <input
              id="edit-assignment-title"
              type="text"
              disabled={isClosed}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              className={fieldClass}
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            {!usesStandardSections && (
              <div>
                <label htmlFor="edit-assignment-score" className="mb-1 block font-bold text-slate-700 dark:text-slate-300">
                  Điểm tối đa
                </label>
                <ScoreStepperInput
                  id="edit-assignment-score"
                  stepTargetLabel="điểm tối đa"
                  min={0.25}
                  max={1000}
                  disabled={isClosed}
                  value={maxScore}
                  onChange={(val) => setMaxScore(val)}
                />
              </div>
            )}

            <div className={usesStandardSections ? "sm:col-span-2" : ""}>
              <label htmlFor="edit-assignment-due" className="mb-1 block font-bold text-slate-700 dark:text-slate-300">
                Hạn nộp bài (Deadline)
              </label>
              <input
                id="edit-assignment-due"
                type="datetime-local"
                disabled={isClosed}
                value={dueAt}
                onChange={(event) => setDueAt(event.target.value)}
                className={fieldClass}
              />
            </div>
          </div>

          {usesStandardSections ? (
            <fieldset className="rounded-xl border border-slate-200 dark:border-slate-800 p-3.5 space-y-2.5">
              <legend className="px-1 font-bold text-slate-700 dark:text-slate-300">
                Thang điểm ban đầu
              </legend>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label htmlFor="edit-assignment-mc-score" className="mb-1 block font-semibold text-slate-700 dark:text-slate-300">
                    Phần trắc nghiệm
                  </label>
                  <ScoreStepperInput
                    id="edit-assignment-mc-score"
                    stepTargetLabel="phần trắc nghiệm"
                    min={0}
                    max={1000}
                    disabled={isClosed}
                    value={mcScoreInput}
                    onChange={(_val, raw) => setMcScoreInput(raw)}
                  />
                </div>
                <div>
                  <label htmlFor="edit-assignment-essay-score" className="mb-1 block font-semibold text-slate-700 dark:text-slate-300">
                    Phần tự luận
                  </label>
                  <ScoreStepperInput
                    id="edit-assignment-essay-score"
                    stepTargetLabel="phần tự luận"
                    min={0}
                    max={1000}
                    disabled={isClosed}
                    value={essayScoreInput}
                    onChange={(_val, raw) => setEssayScoreInput(raw)}
                  />
                </div>
              </div>
            </fieldset>
          ) : (
            rubric.length > 1 && (
              <fieldset className="rounded-xl border border-slate-200 dark:border-slate-800 p-3.5 space-y-2">
                <legend className="px-1 font-bold text-slate-700 dark:text-slate-300">
                  Điểm theo tiêu chí (tổng phải bằng {maxScore})
                </legend>
                {rubric.map((criterion, index) => (
                  <div key={criterion.id} className="flex items-center justify-between gap-3">
                    <input
                      type="text"
                      disabled={isClosed}
                      value={criterion.title}
                      onChange={(event) =>
                        setRubric((rows) =>
                          rows.map((row, idx) => (idx === index ? { ...row, title: event.target.value } : row)),
                        )
                      }
                      className={`${fieldClass} flex-1`}
                    />
                    <ScoreStepperInput
                      ariaLabel={`Điểm tiêu chí ${index + 1}`}
                      stepTargetLabel={`tiêu chí ${index + 1}`}
                      min={0.25}
                      max={1000}
                      disabled={isClosed}
                      value={criterion.maxPoints}
                      onChange={(val) =>
                        setRubric((rows) =>
                          rows.map((row, idx) =>
                            idx === index ? { ...row, maxPoints: val } : row,
                          ),
                        )
                      }
                    />
                  </div>
                ))}
              </fieldset>
            )
          )}

          <div>
            <label htmlFor="edit-assignment-instructions" className="mb-1 block font-bold text-slate-700 dark:text-slate-300">
              Nội dung đề bài / Hướng dẫn làm bài <span className="text-rose-500">*</span>
            </label>
            <textarea
              id="edit-assignment-instructions"
              rows={5}
              disabled={isClosed}
              value={instructions}
              onChange={(event) => setInstructions(event.target.value)}
              className={`${fieldClass} resize-y`}
            />
          </div>

          <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-3.5 space-y-2 bg-slate-50/50 dark:bg-slate-800/30">
            <div className="flex items-center justify-between gap-2">
              <span className="font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                <FileText size={14} className="text-blue-600" />
                <span>Tệp đề đính kèm</span>
              </span>
              {!isClosed && (assignment.sourceMaterial && !removeSourceMaterial || replacementFile) && (
                <button
                  type="button"
                  onClick={() => {
                    setReplacementFile(null);
                    setRemoveSourceMaterial(true);
                  }}
                  className="text-[11px] font-bold text-rose-600 hover:underline cursor-pointer"
                >
                  Gỡ tệp đính kèm
                </button>
              )}
            </div>

            {replacementFile ? (
              <p className="text-emerald-700 dark:text-emerald-300 font-semibold">
                Tệp mới thay thế: {replacementFile.name}
              </p>
            ) : assignment.sourceMaterial && !removeSourceMaterial ? (
              <p className="text-slate-600 dark:text-slate-300">
                Hiện tại: <strong>{assignment.sourceMaterial.name}</strong>
              </p>
            ) : (
              <p className="text-slate-400">Chưa có tệp đề đính kèm.</p>
            )}

            {!isClosed && (
              <label className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1.5 font-bold text-slate-700 dark:text-slate-200 hover:bg-slate-100 cursor-pointer">
                <UploadCloud size={14} />
                <span>{assignment.sourceMaterial && !removeSourceMaterial ? "Thay tệp đề mới" : "Chọn tệp đề"}</span>
                <input
                  type="file"
                  accept=".pdf,.doc,.docx,.png,.jpg,.jpeg,.webp"
                  onChange={handleFileChange}
                  className="hidden"
                />
              </label>
            )}
          </div>
        </div>

        <footer className="flex items-center justify-end gap-2 border-t border-slate-200 px-6 py-4 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/60">
          <button
            type="button"
            disabled={saving}
            onClick={onClose}
            className="rounded-xl border border-slate-200 dark:border-slate-700 px-4 py-2 text-xs font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
          >
            Hủy
          </button>
          <button
            type="button"
            disabled={saving || isClosed}
            onClick={() => void handleSave()}
            className="rounded-xl bg-blue-600 px-5 py-2 text-xs font-bold text-white hover:bg-blue-700 disabled:opacity-50 cursor-pointer"
          >
            {saving ? "Đang lưu..." : "Lưu bài tập"}
          </button>
        </footer>
      </section>
    </div>
  );
}
