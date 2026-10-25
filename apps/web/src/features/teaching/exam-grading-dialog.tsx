"use client";
import { Button, Field, inputClass, Modal, RichText } from "@/components/ui";
import { CheckCircle2, XCircle } from "lucide-react";

import type { useTeachingModel } from "./use-teaching-model";

/** Chấm bài thi và xử lý yêu cầu phúc khảo của học viên. */
export function ExamGradingDialog({
  model,
}: {
  model: Pick<
    ReturnType<typeof useTeachingModel>,
    | "grading"
    | "setGrading"
    | "activeRegrade"
    | "setActiveRegrade"
    | "regradeResolution"
    | "setRegradeResolution"
    | "review"
    | "setReview"
    | "reviewLoading"
    | "gradeSaving"
    | "questionScores"
    | "setQuestionScores"
    | "grade"
    | "setGrade"
    | "saveGrade"
    | "rejectRegrade"
    | "objectiveScore"
    | "manualScore"
  >;
}) {
  const {
    grading,
    setGrading,
    activeRegrade,
    setActiveRegrade,
    regradeResolution,
    setRegradeResolution,
    review,
    setReview,
    reviewLoading,
    gradeSaving,
    questionScores,
    setQuestionScores,
    grade,
    setGrade,
    saveGrade,
    rejectRegrade,
    objectiveScore,
    manualScore,
  } = model;
  return (
    <Modal
      open={Boolean(grading)}
      onClose={() => {
        if (!gradeSaving) {
          setGrading(null);
          setActiveRegrade(null);
          setReview(null);
          setRegradeResolution("");
        }
      }}
      title={
        review
          ? `${activeRegrade ? "Phúc khảo" : "Chấm bài"} · ${review.exam.title}`
          : "Đang mở bài làm"
      }
      description={
        review
          ? `${review.learner.name ?? review.learner.id}${review.learner.email ? ` · ${review.learner.email}` : ""}${activeRegrade ? ` · Yêu cầu: ${activeRegrade.reason}` : ""}`
          : "Đang tải đề thi và câu trả lời của học viên."
      }
      size="xl"
    >
      {reviewLoading || !review ? (
        <p className="py-12 text-center text-sm font-semibold text-[var(--ink-soft)]">
          Đang tải bài làm…
        </p>
      ) : (
        <form
          className="grid gap-6 lg:grid-cols-[minmax(0,1.35fr)_minmax(18rem,.65fr)]"
          onSubmit={(e) => void saveGrade(e)}
        >
          <div className="space-y-4">
            {review.questions.map((question, index) => (
              <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-5 shadow-xs" key={question.questionId}>
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md bg-sky-50 dark:bg-sky-950/40 border border-sky-200/80 dark:border-sky-800/60 text-xs font-semibold text-sky-700 dark:text-sky-300">
                      Câu {index + 1} ·{" "}
                      {question.requiresManualGrade
                        ? "Chấm thủ công"
                        : "Đã chấm tự động"}
                    </span>
                    <RichText className="mt-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
                      {question.content}
                    </RichText>
                  </div>
                  <span className="shrink-0 text-sm font-bold tabular-nums text-slate-500">
                    /{question.maxScore}
                  </span>
                </div>
                <div className="mt-3 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-800 p-3.5">
                  <p className="text-xs font-bold text-slate-500 dark:text-slate-400">
                    Bài làm của học viên
                  </p>
                  {question.submittedAnswers.length ? (
                    question.submittedAnswers.map((answer, answerIndex) => (
                      <RichText
                        className="mt-1 whitespace-pre-wrap text-sm text-slate-800 dark:text-slate-200"
                        key={`${question.questionId}-${answerIndex}`}
                      >
                        {answer}
                      </RichText>
                    ))
                  ) : (
                    <p className="mt-1 text-sm italic text-slate-400">
                      Không có câu trả lời.
                    </p>
                  )}
                </div>
                {question.requiresManualGrade ? (
                  <Field label={`Điểm câu ${index + 1}`}>
                    <input
                      className={`${inputClass} mt-3`}
                      max={question.maxScore}
                      min={0}
                      onChange={(event) =>
                        setQuestionScores({
                          ...questionScores,
                          [question.questionId]: Number(event.target.value),
                        })
                      }
                      required
                      step="0.25"
                      type="number"
                      value={questionScores[question.questionId] ?? 0}
                    />
                  </Field>
                ) : (
                  <p className="mt-3 text-sm font-bold text-emerald-600 dark:text-emerald-400">
                    Điểm tự động: {question.awardedScore}/{question.maxScore}
                  </p>
                )}
              </section>
            ))}
          </div>
          <aside className="space-y-4 lg:sticky lg:top-0 lg:self-start">
            <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-5 shadow-xs">
              <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
                Tổng điểm hiện tại
              </p>
              <p className="mt-1 text-3xl font-extrabold tabular-nums text-slate-900 dark:text-slate-100">
                {objectiveScore + manualScore}
                <span className="text-base font-semibold text-slate-400">
                  /{review.exam.totalScore}
                </span>
              </p>
              <p className="mt-2 text-xs text-slate-500">
                Tự động {objectiveScore} · Tự luận {manualScore}
              </p>
            </div>
            <Field label="Phản hồi">
              <textarea
                className={inputClass}
                minLength={3}
                required
                rows={4}
                value={grade.feedback}
                onChange={(e) =>
                  setGrade({ ...grade, feedback: e.target.value })
                }
              />
            </Field>
            {activeRegrade ? (
              <Field label="Kết luận phúc khảo">
                <div className="mb-2 flex flex-wrap gap-1.5">
                  {[
                    "Chấp nhận khiếu nại, đã rà soát và cộng bổ sung điểm.",
                    "Bài làm đáp ứng đúng yêu cầu thang điểm chi tiết.",
                    "Đã xem lại và giữ nguyên điểm do lập luận chưa đầy đủ.",
                    "Đáp án không khớp với biểu điểm chuẩn đã công bố.",
                  ].map((res) => (
                    <button
                      key={res}
                      type="button"
                      onClick={() => setRegradeResolution(res)}
                      className="rounded-full border border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-800 px-2.5 py-1 text-xs font-medium text-slate-700 dark:text-slate-300 hover:border-sky-400 hover:text-sky-600 dark:hover:text-sky-400 transition-colors"
                    >
                      {res}
                    </button>
                  ))}
                </div>
                <textarea
                  className={inputClass}
                  maxLength={1000}
                  minLength={5}
                  placeholder="Chọn gợi ý nhanh ở trên hoặc tự nhập lý do giải quyết phúc khảo..."
                  required
                  rows={4}
                  value={regradeResolution}
                  onChange={(event) => setRegradeResolution(event.target.value)}
                />
              </Field>
            ) : null}
            {!activeRegrade && grading?.status === "GRADED" ? (
              <Field label="Lý do sửa điểm">
                <div className="mb-2 flex flex-wrap gap-1.5">
                  {[
                    "Sửa lỗi nhập điểm số",
                    "Chấm lại theo phản hồi học viên",
                    "Cộng điểm khuyến khích phần tự luận",
                    "Hiệu chỉnh theo đáp án chuẩn cập nhật",
                  ].map((reason) => (
                    <button
                      key={reason}
                      type="button"
                      onClick={() =>
                        setGrade({
                          ...grade,
                          correctionReason: reason,
                        })
                      }
                      className="rounded-full border border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-800 px-2.5 py-1 text-xs font-medium text-slate-700 dark:text-slate-300 hover:border-sky-400 hover:text-sky-600 dark:hover:text-sky-400 transition-colors"
                    >
                      {reason}
                    </button>
                  ))}
                </div>
                <textarea
                  className={inputClass}
                  minLength={5}
                  placeholder="Chọn gợi ý nhanh ở trên hoặc tự nhập lý do sửa điểm..."
                  required
                  rows={3}
                  value={grade.correctionReason}
                  onChange={(event) =>
                    setGrade({
                      ...grade,
                      correctionReason: event.target.value,
                    })
                  }
                />
              </Field>
            ) : null}
            <Button className="w-full" loading={gradeSaving} type="submit">
              <CheckCircle2 size={16} />
              {activeRegrade ? "Chấp nhận & công bố điểm" : "Công bố kết quả"}
            </Button>
            {activeRegrade ? (
              <Button
                className="w-full"
                disabled={gradeSaving || regradeResolution.trim().length < 5}
                onClick={() => void rejectRegrade()}
                type="button"
                variant="secondary"
              >
                <XCircle size={16} />
                Từ chối, giữ nguyên điểm
              </Button>
            ) : null}
          </aside>
        </form>
      )}
    </Modal>
  );
}
