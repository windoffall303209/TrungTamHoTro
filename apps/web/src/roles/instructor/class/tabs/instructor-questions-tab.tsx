"use client";

import { memo, useEffect, useState } from "react";
import { Edit3, FileCheck2, FileQuestion, Plus, Search, Sparkles } from "lucide-react";
import { QuestionRenderPreview } from "@/features/questions/question-render-preview";
import { Pagination } from "@/shared/ui/ui";
import type { ClassQuestion } from "../instructor-class-workspace.helpers";

export interface InstructorQuestionsTabProps {
  className: string;
  questionBankTab: "ALL" | "MULTIPLE_CHOICE" | "ESSAY";
  questionBankSearch: string;
  questionBankDifficulty: string;
  questionSummary: { total: number; multipleChoice: number; essay: number };
  questionBankLoading: boolean;
  questionBankError: string;
  pagedClassQuestions: ClassQuestion[];
  questionDisplayPage: number;
  questionPageSize: number;
  questionTotalItems: number;
  onChangeTab: (tab: "ALL" | "MULTIPLE_CHOICE" | "ESSAY") => void;
  onSearchCommit: (query: string) => void;
  onChangeDifficulty: (difficulty: string) => void;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
  onRetry: () => void;
  onOpenCreateExam: () => void;
  onOpenCreateQuestion: () => void;
  onEditQuestion: (question: ClassQuestion) => void;
}

/** Tab Ngân hàng câu hỏi lớp học, cô lập ô nhập tìm kiếm với debounce 250ms để tránh gọi API và re-render cha trên từng ký tự. */
export const InstructorQuestionsTab = memo(function InstructorQuestionsTab({
  className,
  questionBankTab,
  questionBankSearch,
  questionBankDifficulty,
  questionSummary,
  questionBankLoading,
  questionBankError,
  pagedClassQuestions,
  questionDisplayPage,
  questionPageSize,
  questionTotalItems,
  onChangeTab,
  onSearchCommit,
  onChangeDifficulty,
  onPageChange,
  onPageSizeChange,
  onRetry,
  onOpenCreateExam,
  onOpenCreateQuestion,
  onEditQuestion,
}: InstructorQuestionsTabProps) {
  const [searchDraft, setSearchDraft] = useState(questionBankSearch);

  useEffect(() => {
    setSearchDraft(questionBankSearch);
  }, [questionBankSearch]);

  // Trì hoãn 250ms sau lần gõ cuối mới báo lên workspace để tải trang câu hỏi từ máy chủ.
  useEffect(() => {
    if (searchDraft === questionBankSearch) return;
    const timer = window.setTimeout(() => {
      onSearchCommit(searchDraft);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [searchDraft, questionBankSearch, onSearchCommit]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-xl font-extrabold text-slate-900 dark:text-slate-100">
            Ngân hàng câu hỏi riêng lớp {className}
          </h2>
          <p className="text-xs text-slate-500">
            Tổng hợp tất cả câu hỏi được tách tự động từ bài tập và đề kiểm tra trong lớp này
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onOpenCreateExam}
            className="px-3.5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold transition inline-flex items-center gap-1.5 cursor-pointer shadow-xs"
          >
            <FileCheck2 size={15} />
            <span>Tạo đề</span>
          </button>
          <button
            type="button"
            onClick={onOpenCreateQuestion}
            className="px-3.5 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold transition inline-flex items-center gap-1.5 cursor-pointer shadow-xs"
          >
            <Plus size={15} />
            <span>Soạn câu hỏi mới</span>
          </button>
        </div>
      </div>

      {/* Thanh phân loại Trắc nghiệm / Tự luận và Tìm kiếm */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 p-3 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xs">
        <div className="flex items-center gap-1.5 p-1 rounded-xl bg-slate-100 dark:bg-slate-800/80 text-xs font-bold">
          <button
            type="button"
            onClick={() => onChangeTab("ALL")}
            className={`px-3 py-1.5 rounded-lg transition cursor-pointer flex items-center gap-1.5 ${
              questionBankTab === "ALL"
                ? "bg-white dark:bg-slate-700 text-blue-600 dark:text-blue-400 shadow-2xs font-extrabold"
                : "text-slate-600 dark:text-slate-400 hover:text-slate-900"
            }`}
          >
            <span>Tất cả</span>
            <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-slate-200 dark:bg-slate-600 text-slate-700 dark:text-slate-200 font-bold">
              {questionSummary.total}
            </span>
          </button>

          <button
            type="button"
            onClick={() => onChangeTab("MULTIPLE_CHOICE")}
            className={`px-3 py-1.5 rounded-lg transition cursor-pointer flex items-center gap-1.5 ${
              questionBankTab === "MULTIPLE_CHOICE"
                ? "bg-white dark:bg-slate-700 text-blue-600 dark:text-blue-400 shadow-2xs font-extrabold"
                : "text-slate-600 dark:text-slate-400 hover:text-slate-900"
            }`}
          >
            <span>Trắc nghiệm</span>
            <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-blue-100 dark:bg-blue-900/60 text-blue-700 dark:text-blue-300 font-bold">
              {questionSummary.multipleChoice}
            </span>
          </button>

          <button
            type="button"
            onClick={() => onChangeTab("ESSAY")}
            className={`px-3 py-1.5 rounded-lg transition cursor-pointer flex items-center gap-1.5 ${
              questionBankTab === "ESSAY"
                ? "bg-white dark:bg-slate-700 text-blue-600 dark:text-blue-400 shadow-2xs font-extrabold"
                : "text-slate-600 dark:text-slate-400 hover:text-slate-900"
            }`}
          >
            <span>Tự luận</span>
            <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-amber-100 dark:bg-amber-900/60 text-amber-700 dark:text-amber-300 font-bold">
              {questionSummary.essay}
            </span>
          </button>
        </div>

        {/* Ô tìm kiếm và lọc độ khó */}
        <div className="flex items-center gap-2">
          <div className="relative flex-1 sm:w-60">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Tìm câu hỏi, nguồn..."
              value={searchDraft}
              onChange={(e) => setSearchDraft(e.target.value)}
              className="w-full pl-8 pr-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs text-slate-900 dark:text-slate-100"
            />
          </div>

          <select
            value={questionBankDifficulty}
            onChange={(e) => onChangeDifficulty(e.target.value)}
            className="px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs font-medium text-slate-900 dark:text-slate-100"
          >
            <option value="ALL">Tất cả độ khó</option>
            <option value="Cơ bản">Cơ bản</option>
            <option value="Thông hiểu">Thông hiểu</option>
            <option value="Vận dụng">Vận dụng</option>
            <option value="Vận dụng cao">Vận dụng cao</option>
          </select>
        </div>
      </div>

      {questionBankError ? (
        <div className="rounded-2xl border border-rose-200 dark:border-rose-900/60 bg-rose-50/70 dark:bg-rose-950/30 p-4 flex items-center justify-between gap-3">
          <p className="text-xs font-medium text-rose-700 dark:text-rose-300">{questionBankError}</p>
          <button
            type="button"
            onClick={onRetry}
            className="px-3 py-1.5 rounded-lg bg-rose-600 text-white text-xs font-bold hover:bg-rose-700 cursor-pointer shrink-0"
          >
            Thử lại
          </button>
        </div>
      ) : null}

      <div className="space-y-3">
        {questionBankLoading && pagedClassQuestions.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-300 dark:border-slate-800 p-8 text-center">
            <p className="text-xs text-slate-500 font-medium">Đang tải ngân hàng câu hỏi...</p>
          </div>
        ) : pagedClassQuestions.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-300 dark:border-slate-800 p-8 text-center space-y-3">
            <FileQuestion size={32} className="mx-auto text-slate-400" />
            <p className="text-xs text-slate-500 font-medium">
              {questionSummary.total === 0
                ? "Chưa có câu hỏi nào trong ngân hàng riêng của lớp."
                : "Không tìm thấy câu hỏi nào phù hợp với bộ lọc hiện tại."}
            </p>
            <button
              type="button"
              onClick={onOpenCreateQuestion}
              className="px-4 py-2 rounded-xl bg-blue-600 text-white text-xs font-bold hover:bg-blue-700 cursor-pointer shadow-xs inline-flex items-center gap-1.5"
            >
              <Sparkles size={14} />
              <span>Khởi tạo câu hỏi bằng AI hoặc Thủ công</span>
            </button>
          </div>
        ) : (
          pagedClassQuestions.map((q) => (
            <div
              key={q.id}
              className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-4 shadow-xs space-y-3 hover:border-slate-300 dark:hover:border-slate-700 transition"
            >
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="px-2.5 py-0.5 rounded-full text-[10px] font-extrabold bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-900/60">
                    {q.type}
                  </span>
                  <span className="px-2.5 py-0.5 rounded-full text-[10px] font-extrabold bg-amber-50 dark:bg-amber-950/60 text-amber-600 dark:text-amber-400 border border-amber-200 dark:border-amber-900/60">
                    {q.difficulty}
                  </span>
                  <span className="text-[11px] text-slate-400 font-medium">
                    Nguồn: <strong className="text-slate-600 dark:text-slate-300">{q.source}</strong>
                  </span>
                  <span className="text-[10px] text-slate-400">({q.createdAt})</span>
                </div>

                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => onEditQuestion(q)}
                    className="px-2.5 py-1 rounded-lg text-[11px] font-bold border border-slate-200 dark:border-slate-700 bg-slate-50 hover:bg-slate-100 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 transition inline-flex items-center gap-1 cursor-pointer"
                  >
                    <Edit3 size={12} />
                    <span>Chỉnh sửa</span>
                  </button>
                </div>
              </div>

              <QuestionRenderPreview
                content={q.content}
                options={q.options}
                correctOptionIndexes={q.correctAnswers}
                solution={q.solution}
              />
            </div>
          ))
        )}
      </div>

      <Pagination
        page={questionDisplayPage}
        pageSize={questionPageSize}
        totalItems={questionTotalItems}
        itemLabel="câu hỏi"
        onPageChange={onPageChange}
        onPageSizeChange={onPageSizeChange}
      />
    </div>
  );
});
