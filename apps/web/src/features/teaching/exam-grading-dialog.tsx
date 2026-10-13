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
          <div className="divide-y divide-[var(--rule)] border-y border-[var(--rule-strong)]">
            {review.questions.map((question, index) => (
              <section className="py-5" key={question.questionId}>
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-xs font-bold text-[var(--ink-muted)]">
                      Câu {index + 1} ·{" "}
                      {question.requiresManualGrade
                        ? "Chấm thủ công"
                        : "Đã chấm tự động"}
                    </p>
                    <RichText className="mt-2 font-semibold">
                      {question.content}
                    </RichText>
                  </div>
                  <span className="shrink-0 text-sm font-bold tabular-nums">
                    /{question.maxScore}
                  </span>
                </div>
                <div className="mt-3 bg-[var(--surface-muted)] px-4 py-3">
                  <p className="text-xs font-bold text-[var(--ink-muted)]">
                    Bài làm của học viên
                  </p>
                  {question.submittedAnswers.length ? (
                    question.submittedAnswers.map((answer, answerIndex) => (
                      <RichText
                        className="mt-1 whitespace-pre-wrap text-sm"
                        key={`${question.questionId}-${answerIndex}`}
                      >
                        {answer}
                      </RichText>
                    ))
                  ) : (
                    <p className="mt-1 text-sm italic text-[var(--ink-soft)]">
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
                  <p className="mt-3 text-sm font-bold text-[var(--success-deep)]">
                    Điểm tự động: {question.awardedScore}/{question.maxScore}
                  </p>
                )}
              </section>
            ))}
          </div>
          <aside className="space-y-4 lg:sticky lg:top-0 lg:self-start">
            <div className="border-y border-[var(--rule-strong)] py-4">
              <p className="text-sm text-[var(--ink-soft)]">
                Tổng điểm hiện tại
              </p>
              <p className="mt-1 text-3xl font-extrabold tabular-nums text-[var(--ink)]">
                {objectiveScore + manualScore}
                <span className="text-base font-semibold text-[var(--ink-soft)]">
                  /{review.exam.totalScore}
                </span>
              </p>
              <p className="mt-2 text-xs text-[var(--ink-muted)]">
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
                <textarea
                  className={inputClass}
                  maxLength={1000}
                  minLength={5}
                  required
                  rows={4}
                  value={regradeResolution}
                  onChange={(event) => setRegradeResolution(event.target.value)}
                />
              </Field>
            ) : null}
            {!activeRegrade && grading?.status === "GRADED" ? (
              <Field label="Lý do sửa điểm">
                <textarea
                  className={inputClass}
                  minLength={5}
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
