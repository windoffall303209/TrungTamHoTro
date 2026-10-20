"use client";
import { QuestionImage } from "@/components/question-image";
import {
  Button,
  Field,
  inputClass,
  Modal,
  RichText,
  StatusBadge,
} from "@/components/ui";
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
    | "setPreviewExam"
    | "previewQuestions"
    | "setPreviewQuestions"
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
    setPreviewExam,
    previewQuestions,
    setPreviewQuestions,
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
          setPreviewExam(null);
          setPreviewQuestions([]);
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
                    setPreviewExam(null);
                  }
                }}
              >
                Gửi phê duyệt
              </Button>
            </div>
          ) : null}
          <div className="grid gap-3 border-y border-[var(--rule)] py-4 sm:grid-cols-4">
            <div>
              <p className="text-xs font-bold text-[var(--ink-muted)]">
                Lớp học
              </p>
              <p className="mt-1 text-sm font-extrabold">
                {classes.find((item) => item.id === previewExam.classId)
                  ?.code ?? previewExam.classId}
              </p>
            </div>
            <div>
              <p className="text-xs font-bold text-[var(--ink-muted)]">
                Thời gian
              </p>
              <p className="mt-1 text-sm font-extrabold">
                {previewExam.durationMinutes} phút
              </p>
            </div>
            <div>
              <p className="text-xs font-bold text-[var(--ink-muted)]">
                Tổng điểm
              </p>
              <p className="mt-1 text-sm font-extrabold">
                {previewExam.totalScore}
              </p>
            </div>
            <div>
              <p className="text-xs font-bold text-[var(--ink-muted)]">
                Thứ tự học viên
              </p>
              <p className="mt-1 text-sm font-extrabold">
                {previewExam.shuffleQuestions
                  ? "Có xáo trộn"
                  : "Theo thứ tự gốc"}
              </p>
            </div>
          </div>
          {previewLoading ? (
            <p className="py-16 text-center text-sm font-semibold text-[var(--ink-muted)]">
              Đang tải nội dung đề…
            </p>
          ) : (
            <>
            {previewQuestions.some((question) => question.issues?.length) ? (
              <p className="mt-5 flex items-center gap-2 rounded-xl bg-[var(--warning)]/10 px-4 py-3 text-sm font-bold text-[var(--warning-deep)]" role="status">
                <AlertTriangle size={16} />
                {previewQuestions.filter((question) => question.issues?.length).length} câu cần sửa trước khi gửi duyệt.
              </p>
            ) : null}
            <ol className="mt-5 space-y-5">
              {previewQuestions.map((question, index) => (
                <li
                  className="rounded-xl border border-[var(--rule-strong)] bg-[var(--canvas)] p-4 md:p-5"
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
                            className={`flex items-start gap-3 rounded-lg border p-3 text-sm ${correct ? "border-[var(--success)] bg-[var(--success-soft)]" : "border-[var(--rule)] bg-[var(--surface)]"}`}
                            key={`${optionIndex}-${option}`}
                          >
                            <span className="grid size-7 shrink-0 place-items-center rounded-lg border border-current text-xs font-extrabold">
                              {String.fromCharCode(65 + optionIndex)}
                            </span>
                            <RichText className="min-w-0">{option}</RichText>
                            {correct ? (
                              <CheckCircle2
                                aria-label="Đáp án đúng"
                                className="ml-auto shrink-0 text-[var(--success-deep)]"
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
                    <div className="mt-4 rounded-lg bg-[var(--success-soft)] p-3">
                      <p className="text-xs font-bold text-[var(--success-deep)]">
                        Đáp án / ý tham khảo
                      </p>
                      {question.correctAnswers.map((answer) => (
                        <RichText className="mt-1 text-sm" key={answer}>
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
            <div className="mt-5 border-y border-[var(--rule-strong)] py-4">
              <p className="text-sm font-extrabold">Nguồn tạo đề AI</p>
              <p className="mt-1 text-xs text-[var(--ink-muted)]">
                {previewExam.aiContext.mode === "COURSE_MATERIALS"
                  ? `${previewExam.aiContext.materialIds.length} tài liệu trong môn học`
                  : `${previewExam.aiContext.sources.length} nguồn Internet`}
              </p>
              {previewExam.aiContext.sources.length ? (
                <ul className="mt-2 space-y-1">
                  {previewExam.aiContext.sources.map((source) => (
                    <li className="truncate text-xs" key={source.url}>
                      <a
                        className="text-[var(--accent-ink)] underline"
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
