"use client";

import { QuestionImage } from "@/features/questions/question-image";
import { RichText } from "@/shared/ui/ui";

export interface QuestionRenderPreviewProps {
  content: string;
  options?: string[];
  /** Danh sách chỉ mục 0-based của các phương án đúng trong options. */
  correctOptionIndexes?: number[];
  /** Các đáp án tham khảo dạng văn bản (tự luận / điền khuyết khi không dùng danh sách options). */
  referenceAnswers?: string[];
  referenceLabel?: string;
  solution?: string;
  imageUrl?: string;
  emptyContentText?: string;
  className?: string;
}

/** Hiển thị nội dung câu hỏi, phương án trắc nghiệm, đáp án và lời giải đã render Markdown + LaTeX. */
export function QuestionRenderPreview({
  content,
  options = [],
  correctOptionIndexes = [],
  referenceAnswers = [],
  referenceLabel = "Đáp án:",
  solution,
  imageUrl,
  emptyContentText = "Chưa có nội dung câu hỏi.",
  className = "",
}: QuestionRenderPreviewProps) {
  const correctSet = new Set(correctOptionIndexes);

  return (
    <div className={`space-y-3 ${className}`}>
      {content.trim() ? (
        <RichText className="text-xs sm:text-sm font-bold leading-relaxed text-slate-800 dark:text-slate-200 [&>p:first-child]:mt-0 [&>p:last-child]:mb-0">
          {content}
        </RichText>
      ) : (
        <p className="text-xs italic text-slate-400 dark:text-slate-500">{emptyContentText}</p>
      )}

      <QuestionImage className="max-h-64" imageUrl={imageUrl} />

      {options.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
          {options.map((opt, optIdx) => {
            const isCorrect = correctSet.has(optIdx);
            const prefix = String.fromCharCode(65 + optIdx);
            return (
              <div
                key={`${optIdx}-${opt}`}
                className={`p-2 rounded-xl text-xs flex items-center gap-2 border ${
                  isCorrect
                    ? "border-emerald-300 dark:border-emerald-800 bg-emerald-50/60 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300 font-semibold"
                    : "border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/40 text-slate-600 dark:text-slate-400"
                }`}
              >
                <span
                  className={`w-5 h-5 rounded-full flex items-center justify-center font-bold text-[10px] shrink-0 ${
                    isCorrect
                      ? "bg-emerald-500 text-white"
                      : "bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300"
                  }`}
                >
                  {prefix}
                </span>
                <RichText className="min-w-0 flex-1 leading-relaxed [&>p]:my-0 [&_*]:text-inherit">
                  {opt}
                </RichText>
                {isCorrect && (
                  <span className="ml-auto shrink-0 text-[10px] font-extrabold text-emerald-600 dark:text-emerald-400">
                    ✓ Đúng
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}

      {referenceAnswers.length > 0 && (
        <div className="rounded-xl border border-emerald-200/80 dark:border-emerald-900/60 bg-emerald-50/50 dark:bg-emerald-950/30 p-2.5 text-xs text-emerald-800 dark:text-emerald-300 space-y-1">
          <span className="font-bold block">{referenceLabel}</span>
          <div className="space-y-1">
            {referenceAnswers.map((answer, answerIdx) => (
              <RichText
                key={`${answerIdx}-${answer}`}
                className="text-xs leading-relaxed [&>p]:my-0 [&_*]:text-inherit"
              >
                {answer}
              </RichText>
            ))}
          </div>
        </div>
      )}

      {solution && solution.trim().length > 0 && (
        <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-100 dark:border-slate-800 text-[11px] text-slate-600 dark:text-slate-300">
          <span className="font-bold text-slate-700 dark:text-slate-200 block mb-0.5">
            💡 Hướng dẫn giải:
          </span>
          <RichText className="text-[11px] sm:text-xs leading-relaxed [&>p:first-child]:mt-0 [&>p:last-child]:mb-0 [&_*]:text-inherit">
            {solution}
          </RichText>
        </div>
      )}
    </div>
  );
}
