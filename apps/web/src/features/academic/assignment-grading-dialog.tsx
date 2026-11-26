"use client";
import { SubmissionFile } from "@/features/academic/submission-file";
import { AssignmentAiGrading } from "@/features/academic/assignment-ai-grading";
import { Button, Field, inputClass, Modal } from "@/shared/ui/ui";
import type { useAcademicModel } from "./use-academic-model";

/** Chấm bài tập theo tiêu chí rubric và phản hồi giảng viên. */
export function AssignmentGradingDialog({
  model,
}: {
  model: Pick<
    ReturnType<typeof useAcademicModel>,
    | "reviewing"
    | "grading"
    | "setGrading"
    | "rubricScores"
    | "setRubricScores"
    | "feedback"
    | "setFeedback"
    | "canTeach"
    | "grade"
  >;
}) {
  const {
    reviewing,
    grading,
    setGrading,
    rubricScores,
    setRubricScores,
    feedback,
    setFeedback,
    canTeach,
    grade,
  } = model;
  return (
    <Modal
      open={Boolean(grading)}
      onClose={() => setGrading(null)}
      title={`Chấm bài · ${grading?.learnerName ?? ""}`}
    >
      <form className="space-y-4" onSubmit={(event) => void grade(event)}>
        <div className="max-h-40 overflow-auto border-y border-[var(--rule)] p-3 text-sm leading-6 whitespace-pre-wrap">
          {grading?.content || "Bài nộp chỉ có tệp đính kèm."}
        </div>
        {grading?.attachments.length ? (
          <div>
            <p className="mb-2 text-sm font-bold">Tệp bài làm</p>
            <div className="flex flex-wrap gap-2">
              {grading.attachments.map((file) => (
                  <SubmissionFile key={file.id} submissionId={grading.id} file={file} showImage />
                ))}
            </div>
          </div>
        ) : null}
        {canTeach && grading && reviewing ? (
          <AssignmentAiGrading
            assignment={reviewing}
            submission={grading}
            onUse={(scores, nextFeedback) => {
              setRubricScores(scores);
              setFeedback(nextFeedback);
            }}
          />
        ) : null}
        {reviewing?.rubric.map((criterion) => (
          <Field
            key={criterion.id}
            label={`${criterion.title} — tối đa ${criterion.maxPoints}`}
          >
            <input
              className={inputClass}
              max={criterion.maxPoints}
              min={0}
              required
              step="0.01"
              type="number"
              value={rubricScores[criterion.id] ?? 0}
              onChange={(event) =>
                setRubricScores({
                  ...rubricScores,
                  [criterion.id]: Number(event.target.value),
                })
              }
            />
            <span className="mt-1 block text-xs font-normal text-[var(--ink-muted)]">
              {criterion.description}
            </span>
          </Field>
        ))}
        <Field label="Phản hồi">
          <textarea
            className={inputClass}
            minLength={3}
            required
            rows={4}
            value={feedback}
            onChange={(event) => setFeedback(event.target.value)}
          />
        </Field>
        <Button type="submit">Lưu điểm rubric</Button>
      </form>
    </Modal>
  );
}
