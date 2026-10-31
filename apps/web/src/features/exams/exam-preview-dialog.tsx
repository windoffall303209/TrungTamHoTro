"use client";
import { QuestionImage } from "@/features/questions/question-image";
import {
  Button,
  Field,
  inputClass,
  Modal,
  RichText,
  StatusBadge,
} from "@/shared/ui/ui";
import { AlertTriangle, CheckCircle2, ListOrdered, Pencil, Send } from "lucide-react";
import type { useExamsModel } from "./use-exams-model";

/** Xem trước đề thi và chỉnh sửa câu hỏi trước khi gửi duyệt. */
export function ExamPreviewDialog({
  model,
}: {
  model: Pick<
    ReturnType<typeof useExamsModel>,
    | "instructor"
    | "items"
    | "classes"
    | "previewExam"
    | "closePreview"
    | "previewQuestions"
    | "setConfirmExam"
    | "editingQuestion"
    | "setEditingQuestion"
    | "savingQuestion"
    | "previewLoading"
    | "submitGeneratedQuestion"
    | "savePreviewQuestion"
  >;
}) {
  const {
    instructor,
    items,
    classes,
    previewExam,
    closePreview,
    previewQuestions,
    setConfirmExam,
    editingQuestion,
    setEditingQuestion,
    savingQuestion,
    previewLoading,
    submitGeneratedQuestion,
    savePreviewQuestion,
  } = model;
  return (
    <Modal
      open={Boolean(previewExam)}
      onClose={() => {
        if (!previewLoading && !savingQuestion && !editingQuestion) {
          closePreview();
        }
      }}
      size="xl"
      title={previewExam?.title ?? "Xem đề thi"}
      description="Bản dành cho giảng viên — luôn hiển thị theo thứ tự gốc khi tạo đề, không áp dụng xáo trộn câu hỏi."
    >
      {previewExam ? (
        <div>
          {instructor && previewExam.status === "DRAFT" ? (
            <div className="mb-4 flex justify-end">
              <Button
                disabled={Boolean(editingQuestion) || savingQuestion}
                onClick={() => {
                  const item = items.find(
                    (entry) => entry.id === previewExam.id,
                  );
                  if (item) {
                    setConfirmExam({ ...item, version: previewExam.version });
                    closePreview();
                  }
                }}
              >
                Phát hành đề thi
              </Button>
            </div>
          ) : null}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 my-5">
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/40 p-3.5 text-center">
              <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
                Lớp học
              </p>
              <p className="mt-1 text-sm font-bold text-slate-900 dark:text-slate-100">
                {classes.find((item) => item.id === previewExam.classId)
                  ?.code ?? previewExam.classId}
              </p>
            </div>
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/40 p-3.5 text-center">
              <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
                Thời gian
              </p>
              <p className="mt-1 text-sm font-bold text-sky-600 dark:text-sky-400">
                {previewExam.durationMinutes} phút
              </p>
            </div>
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/40 p-3.5 text-center">
              <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
                Tổng điểm
              </p>
              <p className="mt-1 text-sm font-bold text-slate-900 dark:text-slate-100">
                {previewExam.totalScore}
              </p>
            </div>
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/40 p-3.5 text-center">
              <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
                Thứ tự học viên
              </p>
              <p className="mt-1 text-sm font-bold text-slate-900 dark:text-slate-100">
                {previewExam.shuffleQuestions
                  ? "Có xáo trộn"
                  : "Theo thứ tự gốc"}
              </p>
            </div>
          </div>
          {previewLoading ? (
            <p className="py-16 text-center text-sm font-semibold text-slate-500">
              Đang tải nội dung đề…
            </p>
          ) : (
            <>
            {previewQuestions.some((question) => question.issues?.length) ? (
              <p className="mt-5 flex items-center gap-2 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/60 px-4 py-3 text-sm font-bold text-amber-800 dark:text-amber-200" role="status">
                <AlertTriangle size={16} />
                {previewQuestions.filter((question) => question.issues?.length).length} câu cần sửa trước khi gửi duyệt.
              </p>
            ) : null}
            <ol className="mt-5 space-y-4">
              {previewQuestions.map((question, index) => (
                <li
                  className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-5 shadow-xs"
                  key={question.id}
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="flex items-center gap-2 text-sm font-extrabold">
                      <ListOrdered size={16} />
                      Câu {index + 1} ·{" "}
                      {previewExam.questionScores?.[question.id] ??
                        Math.round(
                          (previewExam.totalScore /
                            Math.max(1, previewQuestions.length)) *
                            100,
                        ) / 100}{" "}
                      điểm
                    </p>
                    <div className="flex items-center gap-2">
                      <StatusBadge status={question.status} />
                      {instructor && previewExam.status === "DRAFT" ? (
                        <Button
                          disabled={savingQuestion || Boolean(editingQuestion)}
                          variant="ghost"
                          onClick={() =>
                            setEditingQuestion({
                              ...question,
                              options: [...question.options],
                              correctAnswers: [...question.correctAnswers],
                            })
                          }
                        >
                          <Pencil size={14} />
                          Sửa câu hỏi
                        </Button>
                      ) : null}
                      {instructor &&
                      question.status === "DRAFT" &&
                      previewExam.status !== "DRAFT" ? (
                        <Button
                          onClick={() =>
                            void submitGeneratedQuestion(question.id)
                          }
                          variant="ghost"
                        >
                          <Send size={14} />
                          Gửi duyệt câu
                        </Button>
                      ) : null}
                      <span className="text-xs font-bold text-[var(--ink-muted)]">
                        {question.type} · Mức {question.difficulty}
                      </span>
                    </div>
                  </div>
                  {question.issues?.length ? (
                    <ul className="mt-3 space-y-1 rounded-lg bg-[var(--warning)]/10 px-3 py-2 text-xs font-bold text-[var(--warning-deep)]">
                      {question.issues.map((issue) => <li key={issue}>{issue}</li>)}
                    </ul>
                  ) : null}
                  {editingQuestion?.id === question.id ? (
                    <div className="mt-4 space-y-3">
                      <Field label="Nội dung câu hỏi">
                        <textarea
                          className={inputClass}
                          rows={5}
                          maxLength={20000}
                          value={editingQuestion.content}
                          onChange={(event) =>
                            setEditingQuestion({
                              ...editingQuestion,
                              content: event.target.value,
                            })
                          }
                        />
                      </Field>
                      {question.options.length > 0 || ["SINGLE_CHOICE", "MULTIPLE_CHOICE", "TRUE_FALSE"].includes(question.type) ? (
                        <Field label="Lựa chọn, mỗi dòng một đáp án">
                          <textarea
                            className={inputClass}
                            rows={5}
                            value={editingQuestion.options.join("\n")}
                            onChange={(event) =>
                              setEditingQuestion({
                                ...editingQuestion,
                                options: event.target.value.split("\n"),
                              })
                            }
                          />
                        </Field>
                      ) : null}
                      <Field label="Đáp án đúng / ý tham khảo, mỗi dòng một ý">
                        <textarea
                          className={inputClass}
                          rows={4}
                          value={editingQuestion.correctAnswers.join("\n")}
                          onChange={(event) =>
                            setEditingQuestion({
                              ...editingQuestion,
                              correctAnswers: event.target.value.split("\n"),
                            })
                          }
                        />
                      </Field>
                      <div className="flex justify-end gap-3">
                        <Button
                          disabled={savingQuestion}
                          variant="ghost"
                          onClick={() => setEditingQuestion(null)}
                        >
                          Hủy
                        </Button>
                        <Button
                          disabled={
                            editingQuestion.content.trim().length < 5 ||
                            !editingQuestion.correctAnswers.some((answer) =>
                              answer.trim(),
                            )
                          }
                          loading={savingQuestion}
                          onClick={() => void savePreviewQuestion()}
                        >
                          Lưu câu hỏi
                        </Button>
                      </div>
                    </div>
                  ) : null}
                  <RichText className="mt-3 font-semibold">
                    {question.content}
                  </RichText>
                  <QuestionImage
                    className="mt-4"
                    imageUrl={question.imageUrl}
                  />
                  {question.options.length ? (
                    <div className="mt-4 grid gap-2 sm:grid-cols-2">
                      {question.options.map((option, optionIndex) => {
                        const correct =
                          question.correctAnswers.includes(option);
                        return (
                          <div
                            className={`flex items-start gap-3 rounded-xl border p-3 text-sm transition-all ${correct ? "border-emerald-300 dark:border-emerald-800 bg-emerald-50/70 dark:bg-emerald-950/30 text-emerald-900 dark:text-emerald-200 font-medium" : "border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/40 text-slate-700 dark:text-slate-300"}`}
                            key={`${optionIndex}-${option}`}
                          >
                            <span className="grid size-7 shrink-0 place-items-center rounded-lg border border-current text-xs font-bold">
                              {String.fromCharCode(65 + optionIndex)}
                            </span>
                            <RichText className="min-w-0">{option}</RichText>
                            {correct ? (
                              <CheckCircle2
                                aria-label="Đáp án đúng"
                                className="ml-auto shrink-0 text-emerald-600 dark:text-emerald-400"
                                size={17}
                              />
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  ) : null}
                  {question.correctAnswers.length &&
                  !question.options.length ? (
                    <div className="mt-4 rounded-xl bg-emerald-50/70 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800/60 p-3.5">
                      <p className="text-xs font-bold text-emerald-700 dark:text-emerald-300">
                        Đáp án / ý tham khảo
                      </p>
                      {question.correctAnswers.map((answer) => (
                        <RichText className="mt-1 text-sm text-emerald-900 dark:text-emerald-200" key={answer}>
                          {answer}
                        </RichText>
                      ))}
                    </div>
                  ) : null}
                </li>
              ))}
            </ol>
            </>
          )}
          {previewExam.aiContext ? (
            <div className="mt-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-5 shadow-xs">
              <p className="text-sm font-bold text-slate-900 dark:text-slate-100">Nguồn tạo đề AI</p>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                {previewExam.aiContext.mode === "COURSE_MATERIALS"
                  ? `${previewExam.aiContext.materialIds.length} tài liệu trong môn học`
                  : `${previewExam.aiContext.sources.length} nguồn Internet`}
              </p>
              {previewExam.aiContext.sources.length ? (
                <ul className="mt-2 space-y-1">
                  {previewExam.aiContext.sources.map((source) => (
                    <li className="truncate text-xs" key={source.url}>
                      <a
                        className="text-sky-600 dark:text-sky-400 hover:underline"
                        href={source.url}
                        rel="noreferrer"
                        target="_blank"
                      >
                        {source.title}
                      </a>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </Modal>
  );
}
