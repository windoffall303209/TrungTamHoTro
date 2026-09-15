"use client";
import { Button, Field, inputClass, Modal } from "@/components/ui";
import {
  Download,
  Eye,
  FileText,
  Paperclip,
  Send,
  Trash2,
  X,
} from "lucide-react";
import type { useAcademicModel } from "./use-academic-model";

/** Nhập bài làm, quản lý tệp đính kèm và nộp bài tập. */
export function AssignmentSubmissionDialog({
  model,
}: {
  model: Pick<
    ReturnType<typeof useAcademicModel>,
    | "submitting"
    | "setSubmitting"
    | "submissionContent"
    | "setSubmissionContent"
    | "submissionFiles"
    | "setSubmissionFiles"
    | "submissionError"
    | "setSubmissionError"
    | "submissionBusy"
    | "submitAssignment"
    | "chooseSubmissionFiles"
    | "removeStoredAttachment"
    | "openAttachment"
  >;
}) {
  const {
    submitting,
    setSubmitting,
    submissionContent,
    setSubmissionContent,
    submissionFiles,
    setSubmissionFiles,
    submissionError,
    setSubmissionError,
    submissionBusy,
    submitAssignment,
    chooseSubmissionFiles,
    removeStoredAttachment,
    openAttachment,
  } = model;
  return (
    <Modal
      open={Boolean(submitting)}
      onClose={() => {
        if (!submissionBusy) setSubmitting(null);
      }}
      title={submitting?.title ?? "Nộp bài"}
      description={submitting?.instructions}
    >
      <form
        className="space-y-5"
        onSubmit={(event) => void submitAssignment(event)}
      >
        <Field label="Nội dung bài làm (không bắt buộc khi có tệp)">
          <textarea
            className={inputClass}
            maxLength={20_000}
            rows={7}
            value={submissionContent}
            onChange={(event) => {
              setSubmissionContent(event.target.value);
              setSubmissionError("");
            }}
          />
        </Field>
        <div>
          <p className="text-sm font-bold text-[var(--ink)]">Tệp bài làm</p>
          <p className="mt-1 text-xs leading-5 text-[var(--ink-muted)]">
            Tối đa 5 tệp, 20 MB/tệp · JPG, PNG, WebP, PDF, DOC, DOCX hoặc TXT.
          </p>
          <label className="mt-3 flex min-h-24 cursor-pointer items-center justify-center gap-2 border border-dashed border-[var(--rule-strong)] bg-[var(--surface)] px-4 py-5 text-sm font-bold text-[var(--ink)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent-ink)] focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-[var(--accent)]">
            <Paperclip size={18} />
            Chọn tệp từ máy
            <input
              accept=".jpg,.jpeg,.png,.webp,.pdf,.doc,.docx,.txt"
              className="sr-only"
              disabled={
                submissionBusy ||
                (submitting?.submission?.attachments.length ?? 0) +
                  submissionFiles.length >=
                  5
              }
              multiple
              onChange={(event) => {
                chooseSubmissionFiles(event.target.files);
                event.target.value = "";
              }}
              type="file"
            />
          </label>
        </div>
        {submitting?.submission?.attachments.length ||
        submissionFiles.length ? (
          <div className="divide-y divide-[var(--rule)] border-y border-[var(--rule)]">
            {submitting?.submission?.attachments.map((file) => (
              <div
                className="flex min-w-0 items-center gap-3 py-3"
                key={file.id}
              >
                <FileText
                  className="shrink-0 text-[var(--ink-muted)]"
                  size={18}
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold">
                    {file.originalName}
                  </p>
                  <p className="text-xs text-[var(--ink-muted)]">
                    {(file.sizeBytes / 1024 / 1024).toFixed(2)} MB · Đã lưu
                  </p>
                </div>
                {file.canPreview ? (
                  <button
                    aria-label={`Xem trước ${file.originalName}`}
                    className="rounded-lg p-2 text-[var(--ink-soft)] hover:bg-[var(--surface-muted)]"
                    onClick={() =>
                      void openAttachment(
                        submitting.submission!.id,
                        file.id,
                        true,
                      )
                    }
                    type="button"
                  >
                    <Eye size={17} />
                  </button>
                ) : null}
                <button
                  aria-label={`Tải ${file.originalName}`}
                  className="rounded-lg p-2 text-[var(--ink-soft)] hover:bg-[var(--surface-muted)]"
                  onClick={() =>
                    void openAttachment(
                      submitting.submission!.id,
                      file.id,
                      false,
                    )
                  }
                  type="button"
                >
                  <Download size={17} />
                </button>
                {submitting.submission?.status !== "GRADED" ? (
                  <button
                    aria-label={`Xóa ${file.originalName}`}
                    className="rounded-lg p-2 text-[var(--accent-ink)] hover:bg-[var(--accent-soft)]"
                    disabled={submissionBusy}
                    onClick={() => void removeStoredAttachment(file.id)}
                    type="button"
                  >
                    <Trash2 size={17} />
                  </button>
                ) : null}
              </div>
            ))}
            {submissionFiles.map((file, index) => (
              <div
                className="flex min-w-0 items-center gap-3 py-3"
                key={`${file.name}-${file.lastModified}-${index}`}
              >
                <FileText className="shrink-0 text-[var(--accent)]" size={18} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold">{file.name}</p>
                  <p className="text-xs text-[var(--ink-muted)]">
                    {(file.size / 1024 / 1024).toFixed(2)} MB · Chờ tải lên
                  </p>
                </div>
                <button
                  aria-label={`Bỏ ${file.name}`}
                  className="rounded-lg p-2 text-[var(--ink-soft)] hover:bg-[var(--surface-muted)]"
                  disabled={submissionBusy}
                  onClick={() =>
                    setSubmissionFiles((current) =>
                      current.filter((_, fileIndex) => fileIndex !== index),
                    )
                  }
                  type="button"
                >
                  <X size={17} />
                </button>
              </div>
            ))}
          </div>
        ) : null}
        {submissionError ? (
          <p
            aria-live="polite"
            className="text-sm font-semibold text-[var(--accent-ink)]"
          >
            {submissionError}
          </p>
        ) : null}
        <Button
          disabled={
            submissionBusy ||
            (!submissionContent.trim() &&
              !(submitting?.submission?.attachments.length ?? 0) &&
              !submissionFiles.length)
          }
          type="submit"
        >
          <Send size={15} />
          {submissionBusy
            ? "Đang lưu…"
            : submitting?.submission
              ? "Lưu thay đổi"
              : "Nộp bài"}
        </Button>
      </form>
    </Modal>
  );
}
