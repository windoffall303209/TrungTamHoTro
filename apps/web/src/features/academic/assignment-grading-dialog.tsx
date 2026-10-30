"use client";
import { AssignmentAiGrading } from "@/features/academic/assignment-ai-grading";
import { Button, Field, inputClass, Modal } from "@/shared/ui/ui";
import { activeLocale } from "@/i18n/runtime";
import { Download, Eye } from "lucide-react";
import type { useAcademicModel } from "./use-academic-model";

/** Chấm bài tập theo tiêu chí và ghi nhận lý do sửa điểm. */
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
    | "correctionReason"
    | "setCorrectionReason"
    | "canTeach"
    | "openAttachment"
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
    correctionReason,
    setCorrectionReason,
    canTeach,
    openAttachment,
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
                <Button
                  key={file.id}
                  onClick={() =>
                    void openAttachment(grading.id, file.id, file.canPreview)
                  }
                  variant="ghost"
                >
                  {file.canPreview ? <Eye size={15} /> : <Download size={15} />}
                  {file.originalName}
                </Button>
              ))}
            </div>
          </div>
        ) : null}
        {grading?.gradeHistory?.length ? (
          <details className="border-y border-[var(--rule)] py-3">
            <summary className="cursor-pointer text-sm font-bold">
              Lịch sử chấm · {grading.gradeHistory.length} lần
            </summary>
            <ol className="mt-3 space-y-2 text-xs text-[var(--ink-soft)]">
              {grading.gradeHistory.map((change) => (
                <li key={change.id}>
                  {new Date(change.createdAt).toLocaleString(activeLocale())} ·{" "}
                  {change.action === "CORRECTED"
                    ? `Sửa ${change.previousScore ?? 0} → ${change.nextScore}`
                    : `Chấm ${change.nextScore}`}{" "}
                  {change.reason ? `· ${change.reason}` : ""}
                </li>
              ))}
            </ol>
          </details>
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
        {grading?.status === "GRADED" ? (
          <Field label="Lý do sửa điểm đã công bố">
            <div className="mb-2 flex flex-wrap gap-1.5">
              {[
                "Sửa lỗi nhập điểm",
                "Chấm lại theo phản hồi học viên",
                "Cộng điểm khuyến khích / bổ sung",
                "Hiệu chỉnh thang đo tiêu chí",
              ].map((reason) => (
                <button
                  key={reason}
                  type="button"
                  onClick={() => setCorrectionReason(reason)}
                  className="rounded-full border border-[var(--rule)] bg-[var(--surface-muted)] px-2.5 py-1 text-xs font-medium text-[var(--ink)] hover:border-[var(--accent)] hover:text-[var(--accent)] transition-colors"
                >
                  {reason}
                </button>
              ))}
            </div>
            <textarea
              className={inputClass}
              minLength={3}
              placeholder="Chọn gợi ý nhanh ở trên hoặc tự nhập lý do sửa điểm..."
              required
              rows={3}
              value={correctionReason}
              onChange={(event) => setCorrectionReason(event.target.value)}
            />
          </Field>
        ) : null}
        <Button type="submit">Lưu điểm rubric</Button>
      </form>
    </Modal>
  );
}
