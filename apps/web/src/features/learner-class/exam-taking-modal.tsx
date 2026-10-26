"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Clock,
  Flag,
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  AlertCircle,
  X,
  Send,
  HelpCircle,
  Award,
} from "lucide-react";

export interface ExamTakingData {
  id: string;
  title: string;
  durationMinutes: number;
  totalQuestions?: number;
}

interface QuestionItem {
  id: number;
  question: string;
  options: { key: string; text: string }[];
}

interface ExamTakingModalProps {
  open: boolean;
  onClose: () => void;
  exam: ExamTakingData | null;
  onSubmitted?: (result: { score: number; total: number }) => void;
}

/** Component Giao diện làm bài kiểm tra trực tuyến dành cho Học sinh */
export function ExamTakingModal({ open, onClose, exam, onSubmitted }: ExamTakingModalProps) {
  const [currentIdx, setCurrentIdx] = useState(0);
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [flagged, setFlagged] = useState<Record<number, boolean>>({});
  const [remainingSeconds, setRemainingSeconds] = useState(15 * 60);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [scoreResult, setScoreResult] = useState<{ score: number; total: number } | null>(null);
  const [confirmModalOpen, setConfirmModalOpen] = useState(false);

  // Tạo danh sách câu hỏi mẫu phong phú cho bài thi
  const questions: QuestionItem[] = useMemo(() => {
    const total = exam?.totalQuestions || 10;
    return Array.from({ length: total }, (_, i) => ({
      id: i + 1,
      question: `Câu hỏi số ${i + 1}: Cho hàm số f(x) liên tục và có bảng biến thiên trên đoạn [-2; 3]. Tìm giá trị lớn nhất và giá trị nhỏ nhất của hàm số trên đoạn đã cho?`,
      options: [
        { key: "A", text: `Phương án A: Giá trị lớn nhất bằng ${i + 4}, giá trị nhỏ nhất bằng -${i + 1}` },
        { key: "B", text: `Phương án B: Giá trị lớn nhất bằng ${i + 2}, giá trị nhỏ nhất bằng 0` },
        { key: "C", text: `Phương án C: Hàm số không xác định cực trị trên miền này` },
        { key: "D", text: `Phương án D: Giá trị lớn nhất bằng ${i + 5}, giá trị nhỏ nhất bằng -${i + 3}` },
      ],
    }));
  }, [exam?.totalQuestions]);

  // Khởi động đồng hồ đếm ngược khi mở đề thi
  useEffect(() => {
    if (!open || !exam || isSubmitted) return;
    const initialSeconds = (exam.durationMinutes || 15) * 60;
    setRemainingSeconds(initialSeconds);
    setAnswers({});
    setFlagged({});
    setCurrentIdx(0);
    setIsSubmitted(false);
    setScoreResult(null);

    const timer = setInterval(() => {
      setRemainingSeconds((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          handleSubmitExam();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [open, exam]);

  /** Định dạng số giây còn lại thành chuỗi MM:SS */
  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  };

  /** Chọn đáp án cho câu hỏi hiện tại */
  const handleSelectOption = (key: string) => {
    if (isSubmitted) return;
    setAnswers((prev) => ({
      ...prev,
      [currentIdx]: key,
    }));
  };

  /** Bật/tắt cắm cờ đánh dấu cần xem lại cho câu hỏi hiện tại */
  const handleToggleFlag = () => {
    if (isSubmitted) return;
    setFlagged((prev) => ({
      ...prev,
      [currentIdx]: !prev[currentIdx],
    }));
  };

  /** Thực hiện nộp bài và tính điểm trắc nghiệm */
  const handleSubmitExam = () => {
    const total = questions.length;
    const answeredCount = Object.keys(answers).length;
    // Tính điểm mô phỏng dựa trên số câu đã làm
    const calculatedScore = Math.min(10, Math.round(((answeredCount * 0.9) / total) * 10 * 10) / 10);
    const result = { score: calculatedScore, total: 10 };
    setScoreResult(result);
    setIsSubmitted(true);
    setConfirmModalOpen(false);
    onSubmitted?.(result);
  };

  if (!open || !exam) return null;

  const currentQ = questions[currentIdx];
  const answeredCount = Object.keys(answers).length;
  const flaggedCount = Object.values(flagged).filter(Boolean).length;
  const unansweredCount = questions.length - answeredCount;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-3 sm:p-5">
      <div className="relative flex flex-col w-full max-w-6xl h-[92vh] rounded-2xl bg-white dark:bg-[#13141a] border border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden text-slate-900 dark:text-slate-100">
        {/* Header Phòng Thi */}
        <header className="flex items-center justify-between px-5 py-3.5 bg-slate-50 dark:bg-[#1a1b22] border-b border-slate-200 dark:border-slate-800 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <span className="px-2.5 py-1 rounded-lg bg-blue-100 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 text-xs font-bold uppercase tracking-wider">
              Bài kiểm tra
            </span>
            <h2 className="text-sm sm:text-base font-bold text-slate-900 dark:text-slate-100 truncate">
              {exam.title}
            </h2>
          </div>

          <div className="flex items-center gap-3 sm:gap-4 shrink-0">
            {/* Đồng hồ đếm ngược */}
            <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs sm:text-sm font-bold tabular-nums ${
              remainingSeconds < 180
                ? "bg-rose-50 border-rose-200 text-rose-600 dark:bg-rose-950/40 dark:border-rose-900 dark:text-rose-400 animate-pulse"
                : "bg-blue-50 border-blue-200 text-blue-700 dark:bg-blue-950/40 dark:border-blue-900 dark:text-blue-300"
            }`}>
              <Clock size={16} />
              <span>Thời gian còn: {formatTime(remainingSeconds)}</span>
            </div>

            {!isSubmitted ? (
              <button
                type="button"
                onClick={() => setConfirmModalOpen(true)}
                className="px-4 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs sm:text-sm font-bold shadow-xs transition-colors flex items-center gap-1.5 cursor-pointer"
              >
                <Send size={14} />
                <span>Nộp bài</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-1.5 rounded-xl bg-slate-600 hover:bg-slate-700 text-white text-xs sm:text-sm font-bold transition-colors"
              >
                Đóng
              </button>
            )}

            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-200/60 dark:hover:bg-slate-800 transition-colors"
            >
              <X size={20} />
            </button>
          </div>
        </header>

        {/* Thân Bài Thi (Bố cục 2 cột) */}
        <div className="flex-1 grid grid-cols-1 lg:grid-cols-12 min-h-0 overflow-hidden">
          {/* CỘT TRÁI (Lg 8): Nội dung câu hỏi và các đáp án */}
          <div className="lg:col-span-8 flex flex-col min-h-0 border-b lg:border-b-0 lg:border-r border-slate-200 dark:border-slate-800 p-5 sm:p-6 overflow-y-auto">
            {isSubmitted && scoreResult ? (
              /* Màn hình kết quả sau khi nộp bài */
              <div className="flex-1 flex flex-col items-center justify-center text-center p-8 space-y-4">
                <div className="size-20 rounded-full bg-emerald-100 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 grid place-items-center">
                  <Award size={48} />
                </div>
                <h3 className="text-2xl font-bold text-slate-900 dark:text-slate-100">
                  Đã hoàn thành bài kiểm tra!
                </h3>
                <p className="text-sm text-slate-500 max-w-md">
                  Bài làm của bạn đã được hệ thống ghi nhận thành công và tự động chấm điểm.
                </p>
                <div className="p-5 rounded-2xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 space-y-2 min-w-64">
                  <span className="text-xs uppercase font-bold text-slate-400">Điểm số đạt được</span>
                  <p className="text-4xl font-extrabold text-blue-600 dark:text-blue-400 tabular-nums">
                    {scoreResult.score} / {scoreResult.total}
                  </p>
                  <p className="text-xs text-slate-500">
                    Số câu trả lời: {answeredCount}/{questions.length} câu
                  </p>
                </div>
                <button
                  type="button"
                  onClick={onClose}
                  className="px-6 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-bold shadow-xs transition-colors"
                >
                  Quay lại không gian lớp
                </button>
              </div>
            ) : (
              /* Nội dung câu hỏi đang làm */
              <>
                <div className="flex items-center justify-between pb-4 border-b border-slate-100 dark:border-slate-800">
                  <div className="flex items-center gap-2">
                    <span className="text-base sm:text-lg font-bold text-slate-900 dark:text-slate-100">
                      Câu hỏi {currentIdx + 1}
                    </span>
                    <span className="text-xs text-slate-400">/ {questions.length} câu</span>
                  </div>

                  <button
                    type="button"
                    onClick={handleToggleFlag}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
                      flagged[currentIdx]
                        ? "bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-700"
                        : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200"
                    }`}
                  >
                    <Flag size={14} className={flagged[currentIdx] ? "fill-current" : ""} />
                    <span>{flagged[currentIdx] ? "Đã đánh dấu xem lại" : "Đánh dấu xem lại"}</span>
                  </button>
                </div>

                {/* Đề bài */}
                <div className="my-5 p-4 rounded-xl bg-slate-50/70 dark:bg-slate-800/40 border border-slate-100 dark:border-slate-800/80">
                  <p className="text-sm sm:text-base text-slate-800 dark:text-slate-200 leading-relaxed font-medium">
                    {currentQ.question}
                  </p>
                </div>

                {/* Danh sách các đáp án A, B, C, D */}
                <div className="space-y-3 flex-1">
                  {currentQ.options.map((opt) => {
                    const selected = answers[currentIdx] === opt.key;
                    return (
                      <div
                        key={opt.key}
                        onClick={() => handleSelectOption(opt.key)}
                        className={`flex items-start gap-3 p-4 rounded-xl border cursor-pointer transition-all ${
                          selected
                            ? "bg-blue-50/70 dark:bg-blue-950/30 border-blue-500 shadow-2xs"
                            : "bg-white dark:bg-slate-900/60 border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700"
                        }`}
                      >
                        <div className={`size-7 rounded-full grid place-items-center text-xs font-bold shrink-0 transition-colors ${
                          selected
                            ? "bg-blue-600 text-white"
                            : "bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300"
                        }`}>
                          {opt.key}
                        </div>
                        <p className={`text-xs sm:text-sm pt-0.5 leading-relaxed ${
                          selected
                            ? "font-bold text-blue-900 dark:text-blue-200"
                            : "text-slate-700 dark:text-slate-300"
                        }`}>
                          {opt.text}
                        </p>
                      </div>
                    );
                  })}
                </div>

                {/* Thanh điều hướng câu trước / câu sau */}
                <div className="pt-5 mt-4 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between">
                  <button
                    type="button"
                    disabled={currentIdx === 0}
                    onClick={() => setCurrentIdx((i) => Math.max(0, i - 1))}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-800 text-xs font-bold text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40 transition-colors"
                  >
                    <ChevronLeft size={16} />
                    <span>Câu trước</span>
                  </button>

                  <span className="text-xs font-semibold text-slate-400">
                    Đã hoàn thành {answeredCount}/{questions.length}
                  </span>

                  <button
                    type="button"
                    disabled={currentIdx === questions.length - 1}
                    onClick={() => setCurrentIdx((i) => Math.min(questions.length - 1, i + 1))}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold transition-colors disabled:opacity-40"
                  >
                    <span>Câu tiếp theo</span>
                    <ChevronRight size={16} />
                  </button>
                </div>
              </>
            )}
          </div>

          {/* CỘT PHẢI (Lg 4): Bảng Ô Thống Kê Các Câu Hỏi (Question Palette Grid) */}
          <div className="lg:col-span-4 flex flex-col p-4 sm:p-5 bg-slate-50/50 dark:bg-[#16171f] overflow-y-auto space-y-4">
            <div>
              <h3 className="text-xs font-extrabold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                Danh sách câu hỏi
              </h3>
              <p className="text-[11px] text-slate-400 mt-0.5">
                Nhấn vào số câu để chuyển đến câu hỏi tương ứng.
              </p>
            </div>

            {/* CHÚ THÍCH TRẠNG THÁI MÀU SẮC THEO YÊU CẦU NGƯỜI DÙNG */}
            <div className="p-3 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-2 text-xs">
              <div className="flex items-center gap-2">
                <span className="size-4 rounded-md bg-emerald-500 shrink-0" />
                <span className="text-slate-700 dark:text-slate-300">
                  Màu xanh: <strong>Đã làm ({answeredCount})</strong>
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="size-4 rounded-md bg-slate-200 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 shrink-0" />
                <span className="text-slate-700 dark:text-slate-300">
                  Màu xám: <strong>Chưa làm ({unansweredCount})</strong>
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="size-4 rounded-md bg-amber-200 border-2 border-amber-500 shrink-0" />
                <span className="text-slate-700 dark:text-slate-300">
                  Màu vàng nhạt: <strong>Cần xem lại ({flaggedCount})</strong>
                </span>
              </div>
            </div>

            {/* LƯỚI CÁC Ô SỐ THỨ TỰ CÂU HỎI */}
            <div className="grid grid-cols-5 gap-2.5 pt-1">
              {questions.map((q, idx) => {
                const hasAnswer = answers[idx] !== undefined;
                const isFlagged = Boolean(flagged[idx]);
                const isCurrent = currentIdx === idx;

                // Xác định màu sắc theo đúng quy tắc
                let statusClasses = "bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700"; // Chưa làm (xám)
                if (isFlagged) {
                  statusClasses = "bg-amber-100 dark:bg-amber-950/80 text-amber-800 dark:text-amber-200 border-2 border-amber-500 font-bold"; // Cần xem lại (vàng nhạt)
                } else if (hasAnswer) {
                  statusClasses = "bg-emerald-500 text-white border-emerald-600 font-bold"; // Đã làm (xanh)
                }

                return (
                  <button
                    key={q.id}
                    type="button"
                    onClick={() => setCurrentIdx(idx)}
                    className={`h-10 rounded-xl border text-xs flex items-center justify-center transition-all cursor-pointer ${statusClasses} ${
                      isCurrent ? "ring-2 ring-blue-500 ring-offset-2 ring-offset-white dark:ring-offset-slate-900 scale-105" : ""
                    }`}
                    title={`Câu ${idx + 1}`}
                  >
                    {idx + 1}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* Modal Xác Nhận Nộp Bài */}
      {confirmModalOpen && (
        <div className="fixed inset-0 z-60 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
          <div className="w-full max-w-md rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 space-y-4 shadow-xl">
            <div className="flex items-center gap-3 text-amber-600">
              <AlertCircle size={24} />
              <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
                Xác nhận nộp bài kiểm tra
              </h3>
            </div>
            <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
              Bạn có chắc chắn muốn nộp bài thi ngay bây giờ? Sau khi nộp, bạn sẽ không thể chỉnh sửa các câu trả lời.
            </p>
            <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-100 dark:border-slate-800 text-xs space-y-1.5">
              <p>• Số câu đã hoàn thành: <strong className="text-emerald-600">{answeredCount}/{questions.length}</strong> câu</p>
              <p>• Số câu chưa làm: <strong className="text-rose-600">{unansweredCount}</strong> câu</p>
              {flaggedCount > 0 && (
                <p>• Số câu đang đánh dấu xem lại: <strong className="text-amber-600">{flaggedCount}</strong> câu</p>
              )}
            </div>
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setConfirmModalOpen(false)}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
              >
                Tiếp tục làm bài
              </button>
              <button
                type="button"
                onClick={handleSubmitExam}
                className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold shadow-xs transition-colors"
              >
                Xác nhận nộp bài
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
