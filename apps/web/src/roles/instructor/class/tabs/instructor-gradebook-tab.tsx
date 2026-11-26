"use client";

import { memo, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Download, Loader2, Search, X } from "lucide-react";
import {
  ClassGradebookTable,
  type GradebookCellSelection,
} from "@/features/academic/class-gradebook-table";
import { QuestionImage } from "@/features/questions/question-image";
import { apiRequest } from "@/lib/api-client";
import type { RoleCode } from "@/lib/app-types";
import type {
  ExamAttemptReview,
  GradebookAssessmentColumn,
  GradebookRow,
} from "@/lib/learning-types";
import { useApp } from "@/providers/app-provider";
import { RichText } from "@/shared/ui/ui";
import { exportGradebookCsv } from "../instructor-class-workspace.helpers";

export interface InstructorGradebookTabProps {
  classId?: string;
  roleCode?: RoleCode;
  className: string;
  gradebook: GradebookRow[];
  assessments?: GradebookAssessmentColumn[];
  onRefreshGradebook?: () => void;
}

/** Tab Bảng điểm tổng hợp của giảng viên: nhấn "Chờ chấm" mở chấm bài, nhấn ô có điểm mở chi tiết bài làm. */
export const InstructorGradebookTab = memo(function InstructorGradebookTab({
  classId,
  roleCode = "INSTRUCTOR",
  className,
  gradebook,
  assessments,
  onRefreshGradebook,
}: InstructorGradebookTabProps) {
  const router = useRouter();
  const { notify } = useApp();
  const [searchQuery, setSearchQuery] = useState("");
  const [examModal, setExamModal] = useState<{
    mode: "GRADE" | "VIEW";
    review: ExamAttemptReview;
  } | null>(null);
  const [loadingAttempt, setLoadingAttempt] = useState(false);
  const [manualScores, setManualScores] = useState<Record<string, string>>({});
  const [feedback, setFeedback] = useState("");
  const [savingGrade, setSavingGrade] = useState(false);

  const filteredRows = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return gradebook;
    return gradebook.filter((row) =>
      `${row.learnerName} ${row.learnerEmail ?? ""}`.toLowerCase().includes(query),
    );
  }, [gradebook, searchQuery]);

  /** Mở đúng màn hình chấm bài hoặc xem chi tiết khi giảng viên nhấn vào một ô điểm trên bảng điểm. */
  const handleSelectCell = async ({ assessment, cell }: GradebookCellSelection) => {
    if (assessment.kind === "ASSIGNMENT") {
      if (!classId || !cell.submissionId) return;
      const basePath = `/courses/classes/${encodeURIComponent(classId)}/assignments/${encodeURIComponent(assessment.id)}/submissions`;
      const query = new URLSearchParams({
        submissionId: cell.submissionId,
        from: "gradebook",
      });
      if (cell.status === "GRADED") query.set("mode", "view");
      router.push(`${basePath}?${query.toString()}`);
      return;
    }

    if (!cell.attemptId || loadingAttempt) return;
    setLoadingAttempt(true);
    try {
      const review = await apiRequest<ExamAttemptReview>(
        `/instructor/exam-attempts/${encodeURIComponent(cell.attemptId)}/review`,
        { roleCode },
      );
      const isPendingGrade =
        cell.status === "AWAITING_GRADE" || review.attempt.status === "SUBMITTED";
      const initialManual: Record<string, string> = {};
      for (const question of review.questions) {
        if (question.requiresManualGrade) {
          initialManual[question.questionId] =
            question.awardedScore > 0 ? String(question.awardedScore) : "";
        }
      }
      setManualScores(initialManual);
      setFeedback(review.attempt.feedback ?? "");
      setExamModal({ mode: isPendingGrade ? "GRADE" : "VIEW", review });
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "Không tải được chi tiết bài làm.",
        "error",
      );
    } finally {
      setLoadingAttempt(false);
    }
  };

  /** Tính tổng điểm dự kiến gồm phần trắc nghiệm tự chấm và các câu tự luận đang nhập điểm. */
  const computedExamTotal = useMemo(() => {
    if (!examModal) return 0;
    const objective = examModal.review.questions
      .filter((question) => !question.requiresManualGrade)
      .reduce((sum, question) => sum + question.awardedScore, 0);
    const manual = examModal.review.questions
      .filter((question) => question.requiresManualGrade)
      .reduce((sum, question) => {
        const parsed = Number(manualScores[question.questionId]);
        return sum + (Number.isFinite(parsed) && parsed >= 0 ? parsed : 0);
      }, 0);
    return Math.round((objective + manual) * 100) / 100;
  }, [examModal, manualScores]);

  /** Lưu điểm chấm thủ công cho lượt thi đang chờ chấm và làm mới bảng điểm lớp. */
  const handleSaveExamGrade = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!examModal || savingGrade) return;
    const manualQuestions = examModal.review.questions.filter(
      (question) => question.requiresManualGrade,
    );
    const questionScores: Array<{ questionId: string; score: number }> = [];
    for (const question of manualQuestions) {
      const raw = manualScores[question.questionId]?.trim() ?? "";
      const parsed = Number(raw);
      if (raw === "" || !Number.isFinite(parsed) || parsed < 0 || parsed > question.maxScore) {
        notify(
          `Điểm câu tự luận phải nằm trong khoảng từ 0 đến ${question.maxScore}.`,
          "error",
        );
        return;
      }
      questionScores.push({ questionId: question.questionId, score: parsed });
    }

    setSavingGrade(true);
    try {
      await apiRequest(
        `/instructor/exam-attempts/${encodeURIComponent(examModal.review.attempt.id)}/grade`,
        {
          method: "PATCH",
          roleCode,
          body: JSON.stringify({
            score: computedExamTotal,
            feedback: feedback.trim(),
            questionScores,
          }),
        },
      );
      notify("Đã lưu điểm và công bố kết quả cho học sinh.", "success");
      setExamModal(null);
      onRefreshGradebook?.();
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "Không lưu được điểm bài thi.",
        "error",
      );
    } finally {
      setSavingGrade(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-extrabold text-slate-900 dark:text-slate-100">
            Bảng điểm tổng hợp ({className})
          </h2>
          <p className="text-xs text-slate-500">
            Nhấn vào ô “Chờ chấm” để chấm bài ngay hoặc nhấn vào điểm số để xem chi tiết bài làm của học sinh.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {loadingAttempt && (
            <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-blue-600 dark:text-blue-400">
              <Loader2 size={14} className="animate-spin" />
              <span>Đang mở bài làm...</span>
            </span>
          )}
          <div className="relative w-64">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
            <input
              type="text"
              placeholder="Tìm theo tên hoặc email..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs"
            />
          </div>
          <button
            type="button"
            onClick={() => exportGradebookCsv(gradebook, className, assessments)}
            className="px-3.5 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-bold hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center gap-1.5 cursor-pointer shadow-xs"
          >
            <Download size={14} />
            <span>Xuất CSV</span>
          </button>
        </div>
      </div>

      <ClassGradebookTable
        rows={filteredRows}
        assessments={assessments}
        emptyMessage={searchQuery ? "Không tìm thấy học sinh phù hợp." : "Chưa có dữ liệu bảng điểm."}
        onSelectCell={(selection) => void handleSelectCell(selection)}
      />

      {/* Modal chấm bài chờ chấm hoặc xem chi tiết bài thi đã có điểm ngay từ bảng điểm */}
      {examModal && (
        <div
          className="fixed inset-0 z-[85] flex items-center justify-center bg-slate-950/65 p-4 backdrop-blur-xs"
          role="presentation"
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-label={
              examModal.mode === "GRADE"
                ? `Chấm bài ${examModal.review.exam.title}`
                : `Chi tiết bài làm ${examModal.review.exam.title}`
            }
            className="w-full max-w-3xl max-h-[88dvh] flex flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900"
          >
            <div className="flex items-start justify-between gap-4 border-b border-slate-100 dark:border-slate-800 px-6 py-4 shrink-0">
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="text-base font-extrabold text-slate-900 dark:text-slate-100">
                    {examModal.mode === "GRADE" ? "Chấm bài chờ chấm" : "Chi tiết bài làm"} ·{" "}
                    {examModal.review.learner.name ||
                      examModal.review.learner.email ||
                      examModal.review.learner.id}
                  </h3>
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                      examModal.mode === "GRADE"
                        ? "bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300"
                        : "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300"
                    }`}
                  >
                    {examModal.mode === "GRADE" ? "Chờ chấm" : "Đã có điểm"}
                  </span>
                </div>
                <p className="mt-0.5 text-xs text-slate-500">
                  {examModal.review.exam.title} · Điểm:{" "}
                  <strong className="text-slate-900 dark:text-slate-100">
                    {examModal.mode === "GRADE"
                      ? computedExamTotal
                      : (examModal.review.attempt.score ?? 0)}{" "}
                    / {examModal.review.exam.totalScore}
                  </strong>
                </p>
              </div>
              <button
                type="button"
                aria-label="Đóng chi tiết bài làm"
                onClick={() => setExamModal(null)}
                className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>

            <form
              onSubmit={(event) => void handleSaveExamGrade(event)}
              className="flex flex-1 flex-col overflow-hidden"
            >
              <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3">
                {examModal.mode === "VIEW" && examModal.review.attempt.feedback && (
                  <div className="rounded-xl border border-blue-200 dark:border-blue-900/60 bg-blue-50/70 dark:bg-blue-950/30 p-3 text-xs text-slate-700 dark:text-slate-200">
                    <span className="font-bold text-blue-700 dark:text-blue-300">Nhận xét giảng viên: </span>
                    <span>{examModal.review.attempt.feedback}</span>
                  </div>
                )}

                {examModal.review.questions.map((question, idx) => (
                  <div
                    key={question.questionId}
                    className="rounded-xl border border-slate-200 dark:border-slate-800 p-4 space-y-2 text-xs"
                  >
                    <div className="flex items-center justify-between gap-2 font-bold">
                      <span>
                        Câu {idx + 1}
                        {question.requiresManualGrade ? " (Chấm tự luận)" : ""}
                      </span>
                      {examModal.mode === "GRADE" && question.requiresManualGrade ? (
                        <label className="inline-flex items-center gap-1.5 text-slate-700 dark:text-slate-200">
                          <span>Điểm:</span>
                          <input
                            type="number"
                            step="0.25"
                            min={0}
                            max={question.maxScore}
                            required
                            aria-label={`Điểm câu ${idx + 1}`}
                            value={manualScores[question.questionId] ?? ""}
                            onChange={(event) =>
                              setManualScores((current) => ({
                                ...current,
                                [question.questionId]: event.target.value,
                              }))
                            }
                            className="w-20 rounded-lg border border-blue-300 dark:border-blue-700 bg-white dark:bg-slate-950 px-2 py-1 text-right font-bold"
                          />
                          <span className="text-slate-400">/ {question.maxScore}</span>
                        </label>
                      ) : (
                        <span className="text-blue-600 dark:text-blue-400">
                          {question.awardedScore} / {question.maxScore} điểm
                        </span>
                      )}
                    </div>

                    <RichText className="text-sm text-slate-800 dark:text-slate-200 [&>p]:my-0">
                      {question.content}
                    </RichText>

                    {question.imageUrl && (
                      <QuestionImage
                        imageUrl={question.imageUrl}
                        alt={`Ảnh câu ${idx + 1}`}
                      />
                    )}

                    <div className="rounded-lg bg-slate-50 dark:bg-slate-800/60 px-3 py-2 text-slate-700 dark:text-slate-200">
                      <span className="font-bold">Câu trả lời của học sinh: </span>
                      {question.submittedAnswers.length ? (
                        <RichText className="inline-block [&>p]:my-0">
                          {question.submittedAnswers.join(", ")}
                        </RichText>
                      ) : (
                        <span className="italic text-slate-400">Bỏ trống</span>
                      )}
                    </div>
                  </div>
                ))}

                {examModal.mode === "GRADE" && (
                  <div className="pt-2 space-y-1.5">
                    <label
                      htmlFor="gradebook-exam-feedback"
                      className="block text-xs font-bold text-slate-700 dark:text-slate-200"
                    >
                      Nhận xét chung (không bắt buộc)
                    </label>
                    <textarea
                      id="gradebook-exam-feedback"
                      rows={2}
                      maxLength={2000}
                      value={feedback}
                      onChange={(event) => setFeedback(event.target.value)}
                      placeholder="Nhập nhận xét gửi tới học sinh..."
                      className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 p-2.5 text-xs focus:outline-hidden focus:border-blue-500"
                    />
                  </div>
                )}
              </div>

              <div className="flex items-center justify-end gap-2 border-t border-slate-100 dark:border-slate-800 px-6 py-3 shrink-0 bg-slate-50/70 dark:bg-slate-900">
                <button
                  type="button"
                  onClick={() => setExamModal(null)}
                  className="rounded-xl border border-slate-200 dark:border-slate-700 px-4 py-2 text-xs font-bold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                >
                  Đóng
                </button>
                {examModal.mode === "GRADE" && (
                  <button
                    type="submit"
                    disabled={savingGrade}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 hover:bg-blue-700 px-4 py-2 text-xs font-bold text-white disabled:opacity-50 cursor-pointer"
                  >
                    {savingGrade ? (
                      <Loader2 size={14} className="animate-spin" />
                    ) : (
                      <CheckCircle2 size={14} />
                    )}
                    <span>Lưu điểm & Công bố</span>
                  </button>
                )}
              </div>
            </form>
          </section>
        </div>
      )}
    </div>
  );
});
