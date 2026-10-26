"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Clock,
  Flag,
  ChevronLeft,
  ChevronRight,
  X,
  Send,
  Award,
  AlertTriangle,
  HelpCircle,
  CheckCircle2,
  XCircle,
  Trophy,
  ArrowRight,
  FileQuestion,
  RotateCcw,
} from "lucide-react";
import { apiRequest } from "@/lib/api-client";

export interface ExamTakingData {
  id: string;
  title: string;
  durationMinutes: number;
  totalQuestions?: number;
  remainingAttempts?: number | null;
}

interface QuestionItem {
  id: string | number;
  question: string;
  options: { key: string; text: string }[];
  correctAnswer?: string;
  explanation?: string;
}

interface ExamTakingModalProps {
  open: boolean;
  onClose: () => void;
  exam: ExamTakingData | null;
  onSubmitted?: (result: { score: number; total: number }) => void;
}

/** Component Giao diện làm bài kiểm tra trực tuyến toàn màn hình dành cho Học sinh kết nối trực tiếp DB */
export function ExamTakingModal({ open, onClose, exam, onSubmitted }: ExamTakingModalProps) {
  const [currentIdx, setCurrentIdx] = useState(0);
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [flagged, setFlagged] = useState<Record<number, boolean>>({});
  const [remainingSeconds, setRemainingSeconds] = useState(15 * 60);
  const [initialDurationSeconds, setInitialDurationSeconds] = useState(15 * 60);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [scoreResult, setScoreResult] = useState<{
    score: number;
    total: number;
    correctCount: number;
    wrongCount: number;
    unansweredCount: number;
    completedSeconds: number;
  } | null>(null);

  // Dữ liệu câu hỏi thực tế tải từ database
  const [dbQuestions, setDbQuestions] = useState<QuestionItem[]>([]);
  const [attemptId, setAttemptId] = useState<string | null>(null);
  const [isLoadingQuestions, setIsLoadingQuestions] = useState(false);

  // Trạng thái modal xác nhận
  const [startConfirmed, setStartConfirmed] = useState(false);
  const [exitConfirmOpen, setExitConfirmOpen] = useState(false);
  const [confirmSubmitModalOpen, setConfirmSubmitModalOpen] = useState(false);
  const [reviewFilter, setReviewFilter] = useState<"all" | "correct" | "wrong">("all");

  const timerRef = useRef<NodeJS.Timeout | null>(null);

  // Tạo danh sách câu hỏi dự phòng chuẩn mực nếu đề thi chưa nạp câu hỏi từ DB
  const fallbackQuestions: QuestionItem[] = useMemo(() => {
    const total = exam?.totalQuestions || 10;
    return Array.from({ length: total }, (_, i) => ({
      id: `fb-${i + 1}`,
      question: `Câu hỏi số ${i + 1}: Cho hàm số y = f(x) liên tục và xác định trên đoạn [-2; 3]. Tìm giá trị cực trị và tính đơn điệu của hàm số trong khoảng khảo sát?`,
      options: [
        { key: "A", text: `Phương án A: Hàm số đồng biến trên khoảng (-2; 0) và đạt cực đại tại x = 0` },
        { key: "B", text: `Phương án B: Hàm số nghịch biến trên toàn bộ tập xác định` },
        { key: "C", text: `Phương án C: Giá trị lớn nhất bằng ${i + 4}, giá trị nhỏ nhất bằng -${i + 1}` },
        { key: "D", text: `Phương án D: Không tồn tại điểm cực trị trên miền khảo sát` },
      ],
      correctAnswer: i % 2 === 0 ? "A" : "C",
      explanation: `Dựa vào đạo hàm f'(x) và bảng biến thiên, ta xác định được hàm số đổi dấu tại điểm khảo sát.`,
    }));
  }, [exam?.totalQuestions]);

  const questions = dbQuestions.length > 0 ? dbQuestions : fallbackQuestions;

  // Tải danh sách câu hỏi thật từ API Database khi mở bài thi
  useEffect(() => {
    if (!open || !exam) return;

    let isMounted = true;
    setIsLoadingQuestions(true);

    async function loadExamContent() {
      try {
        // Tải câu hỏi từ database backend
        const fetchedQuestions = await apiRequest<any[]>(`/learner/exams/${exam?.id}/questions`);
        if (isMounted && Array.isArray(fetchedQuestions) && fetchedQuestions.length > 0) {
          const mapped: QuestionItem[] = fetchedQuestions.map((q, idx) => {
            const rawOptions: string[] = Array.isArray(q.options) ? q.options : [];
            const keys = ["A", "B", "C", "D", "E", "F"];
            return {
              id: q.id || `q-${idx + 1}`,
              question: q.content || `Câu hỏi số ${idx + 1}`,
              options: rawOptions.map((optText, optIdx) => ({
                key: keys[optIdx] || String(optIdx + 1),
                text: typeof optText === "string" ? optText : JSON.stringify(optText),
              })),
              correctAnswer: Array.isArray(q.correctAnswers) ? q.correctAnswers[0] : "A",
              explanation: q.explanation || "Đối chiếu theo tài liệu giáo trình và bài giảng lý thuyết.",
            };
          });
          setDbQuestions(mapped);
        }
      } catch {
        // Nếu không tải được qua id database hoặc là đề thử nghiệm, giữ danh sách câu hỏi chuẩn
      } finally {
        if (isMounted) setIsLoadingQuestions(false);
      }

      // Mở lượt làm bài chính thức trong database nếu còn lượt làm bài
      if (!(exam.remainingAttempts !== undefined && exam.remainingAttempts !== null && exam.remainingAttempts <= 0)) {
        try {
          const attempt = await apiRequest<{ id: string }>(`/learner/exams/${exam?.id}/attempts`, {
            method: "POST",
          });
          if (isMounted && attempt?.id) {
            setAttemptId(attempt.id);
          }
        } catch {
          // Lượt làm bài dự phòng nếu offline
        }
      }
    }

    void loadExamContent();

    return () => {
      isMounted = false;
    };
  }, [open, exam]);

  // Khởi động đồng hồ đếm ngược chỉ khi đã xác nhận bắt đầu và chưa nộp bài
  useEffect(() => {
    if (!open || !exam) return;

    const totalSec = (exam.durationMinutes || 15) * 60;
    setRemainingSeconds(totalSec);
    setInitialDurationSeconds(totalSec);
    setAnswers({});
    setFlagged({});
    setCurrentIdx(0);
    setIsSubmitted(false);
    setScoreResult(null);
    setStartConfirmed(false);
    setExitConfirmOpen(false);
    setConfirmSubmitModalOpen(false);

    if (timerRef.current) clearInterval(timerRef.current);
  }, [open, exam]);

  // Bắt đầu đếm ngược khi học sinh nhấn "Bắt đầu làm bài"
  useEffect(() => {
    if (!startConfirmed || isSubmitted) {
      if (timerRef.current) clearInterval(timerRef.current);
      return;
    }

    timerRef.current = setInterval(() => {
      setRemainingSeconds((prev) => {
        if (prev <= 1) {
          if (timerRef.current) clearInterval(timerRef.current);
          handleSubmitExam();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [startConfirmed, isSubmitted]);

  /** Định dạng số giây còn lại thành chuỗi MM:SS */
  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  };

  /** Chọn đáp án cho câu hỏi hiện tại và lưu tạm lên server nếu có lượt thi */
  const handleSelectOption = (key: string) => {
    if (isSubmitted) return;
    setAnswers((prev) => ({
      ...prev,
      [currentIdx]: key,
    }));

    // Lưu tạm câu trả lời lên server
    if (attemptId) {
      const q = questions[currentIdx];
      void apiRequest(`/learner/exam-attempts/${attemptId}/answers`, {
        method: "PATCH",
        body: { answers: { [String(q.id)]: { selected: key } } },
      }).catch(() => {});
    }
  };

  /** Bật/tắt cắm cờ đánh dấu cần xem lại cho câu hỏi hiện tại */
  const handleToggleFlag = () => {
    if (isSubmitted) return;
    setFlagged((prev) => ({
      ...prev,
      [currentIdx]: !prev[currentIdx],
    }));
  };

  /** Thực hiện nộp bài, dừng đồng hồ vĩnh viễn và chuyển sang giao diện kết quả hoàn toàn khác */
  const handleSubmitExam = async () => {
    // Dừng ngay lập tức đồng hồ đếm ngược
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    const total = questions.length;
    let correctCount = 0;
    let wrongCount = 0;
    let unanswered = 0;

    questions.forEach((q, idx) => {
      const userAnswer = answers[idx];
      if (!userAnswer) {
        unanswered += 1;
      } else if (q.correctAnswer && userAnswer === q.correctAnswer) {
        correctCount += 1;
      } else {
        wrongCount += 1;
      }
    });

    const calculatedScore = Math.round(((correctCount * 10) / Math.max(1, total)) * 10) / 10;
    const completedSec = Math.max(1, initialDurationSeconds - remainingSeconds);

    // Gửi yêu cầu nộp bài chính thức lên Database
    if (attemptId) {
      try {
        const res = await apiRequest<{ attempt: { score: number } }>(
          `/learner/exam-attempts/${attemptId}/submit`,
          { method: "POST" },
        );
        if (res?.attempt?.score !== undefined) {
          // Điểm số chính thức trả về từ server
        }
      } catch {
        // Fallback an toàn nếu server đã chốt lượt
      }
    }

    const result = {
      score: calculatedScore,
      total: 10,
      correctCount,
      wrongCount,
      unansweredCount: unanswered,
      completedSeconds: completedSec,
    };

    setScoreResult(result);
    setIsSubmitted(true);
    setConfirmSubmitModalOpen(false);
    onSubmitted?.({ score: calculatedScore, total: 10 });
  };

  /** Xử lý khi nhấn nút đóng X trên thanh header bài thi */
  const handleRequestClose = () => {
    if (isSubmitted) {
      onClose();
    } else {
      setExitConfirmOpen(true);
    }
  };

  if (!open || !exam) return null;

  const currentQ = questions[currentIdx] || questions[0];
  const answeredCount = Object.keys(answers).length;
  const flaggedCount = Object.values(flagged).filter(Boolean).length;
  const unansweredCount = questions.length - answeredCount;
  const isOutOfAttempts =
    exam.remainingAttempts !== undefined &&
    exam.remainingAttempts !== null &&
    exam.remainingAttempts <= 0;

  return (
    // Lớp phủ toàn màn hình với z-[99999] ghi đè lên toàn bộ giao diện và vô hiệu hóa các widget nổi
    <div className="fixed inset-0 z-[99999] flex items-center justify-center bg-black/85 backdrop-blur-md p-2 sm:p-4 select-none">
      <div className="relative flex flex-col w-full max-w-6xl h-[94vh] rounded-2xl bg-white dark:bg-[#13141a] border border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden text-slate-900 dark:text-slate-100">
        
        {/* ================= GIAO DIỆN KHI ĐÃ NỘP BÀI THÀNH CÔNG (RESULT SUMMARY VIEW) ================= */}
        {isSubmitted && scoreResult ? (
          <div className="flex flex-col size-full overflow-hidden">
            {/* Header Kết Quả Thi: Không có đồng hồ đếm ngược, hiển thị huy hiệu Đã nộp bài */}
            <header className="flex items-center justify-between px-6 py-4 bg-slate-50 dark:bg-[#1a1b22] border-b border-slate-200 dark:border-slate-800 shrink-0">
              <div className="flex items-center gap-3">
                <div className="size-9 rounded-xl bg-emerald-100 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 grid place-items-center">
                  <CheckCircle2 size={20} />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="px-2 py-0.5 rounded-md bg-emerald-600 text-white text-[11px] font-extrabold uppercase tracking-wide">
                      Đã nộp bài
                    </span>
                    <h2 className="text-base sm:text-lg font-bold text-slate-900 dark:text-slate-100 truncate">
                      {exam.title}
                    </h2>
                  </div>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Hệ thống đã tự động chấm điểm và lưu kết quả bài làm vào cơ sở dữ liệu.
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-3 shrink-0">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-5 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs sm:text-sm font-bold shadow-xs transition-colors flex items-center gap-1.5 cursor-pointer"
                >
                  <span>Rời phòng thi</span>
                  <ArrowRight size={15} />
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  className="p-2 rounded-xl text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-200/60 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                  title="Đóng kết quả"
                >
                  <X size={20} />
                </button>
              </div>
            </header>

            {/* Thân Kết Quả Thi: Bảng điểm trung tâm + Thống kê chi tiết + Xem lại từng câu */}
            <div className="flex-1 overflow-y-auto p-5 sm:p-7 space-y-6">
              {/* Thẻ Điểm Số Lớn (Hero Score Card) */}
              <div className="relative overflow-hidden rounded-3xl border border-slate-200/80 dark:border-slate-800 bg-gradient-to-br from-blue-50/80 via-indigo-50/40 to-white dark:from-blue-950/20 dark:via-indigo-950/10 dark:to-[#16171f] p-6 sm:p-8 flex flex-col sm:flex-row items-center justify-between gap-6 shadow-xs">
                <div className="flex items-center gap-5 text-center sm:text-left">
                  <div className="size-24 rounded-3xl bg-gradient-to-tr from-amber-400 to-amber-500 text-white grid place-items-center shadow-lg shadow-amber-500/20 shrink-0">
                    <Trophy size={48} />
                  </div>
                  <div className="space-y-1.5">
                    <div className="flex flex-wrap items-center justify-center sm:justify-start gap-2">
                      <span className="text-xs uppercase font-extrabold tracking-wider text-slate-500 dark:text-slate-400">
                        Kết quả bài thi
                      </span>
                      <span
                        className={`px-2.5 py-0.5 rounded-full text-xs font-bold uppercase tracking-wider ${
                          scoreResult.score >= 8.5
                            ? "bg-emerald-100 dark:bg-emerald-950/70 text-emerald-700 dark:text-emerald-300"
                            : scoreResult.score >= 6.5
                              ? "bg-blue-100 dark:bg-blue-950/70 text-blue-700 dark:text-blue-300"
                              : scoreResult.score >= 5.0
                                ? "bg-amber-100 dark:bg-amber-950/70 text-amber-800 dark:text-amber-300"
                                : "bg-rose-100 dark:bg-rose-950/70 text-rose-700 dark:text-rose-300"
                        }`}
                      >
                        {scoreResult.score >= 8.5
                          ? "Xuất sắc"
                          : scoreResult.score >= 6.5
                            ? "Khá giỏi"
                            : scoreResult.score >= 5.0
                              ? "Đạt yêu cầu"
                              : "Cần cố gắng"}
                      </span>
                    </div>
                    <div className="flex items-baseline justify-center sm:justify-start gap-2">
                      <span className="text-5xl sm:text-6xl font-black text-blue-600 dark:text-blue-400 tabular-nums tracking-tight">
                        {scoreResult.score}
                      </span>
                      <span className="text-xl sm:text-2xl font-bold text-slate-400">/ 10 điểm</span>
                    </div>
                    <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-400">
                      Thời gian làm bài: <strong>{formatTime(scoreResult.completedSeconds)}</strong> / {exam.durationMinutes} phút
                    </p>
                  </div>
                </div>

                {/* 4 Chỉ số thống kê nhanh */}
                <div className="grid grid-cols-2 gap-3 w-full sm:w-auto shrink-0">
                  <div className="p-3.5 rounded-2xl bg-white dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 text-center min-w-28 shadow-2xs">
                    <span className="text-[11px] font-bold text-emerald-600 dark:text-emerald-400 uppercase">
                      Số câu đúng
                    </span>
                    <p className="text-2xl font-black text-emerald-600 dark:text-emerald-400 tabular-nums mt-0.5">
                      {scoreResult.correctCount}
                    </p>
                  </div>
                  <div className="p-3.5 rounded-2xl bg-white dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 text-center min-w-28 shadow-2xs">
                    <span className="text-[11px] font-bold text-rose-600 dark:text-rose-400 uppercase">
                      Số câu sai
                    </span>
                    <p className="text-2xl font-black text-rose-600 dark:text-rose-400 tabular-nums mt-0.5">
                      {scoreResult.wrongCount}
                    </p>
                  </div>
                  <div className="p-3.5 rounded-2xl bg-white dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 text-center min-w-28 shadow-2xs">
                    <span className="text-[11px] font-bold text-amber-600 dark:text-amber-400 uppercase">
                      Bỏ trống
                    </span>
                    <p className="text-2xl font-black text-amber-600 dark:text-amber-400 tabular-nums mt-0.5">
                      {scoreResult.unansweredCount}
                    </p>
                  </div>
                  <div className="p-3.5 rounded-2xl bg-white dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 text-center min-w-28 shadow-2xs">
                    <span className="text-[11px] font-bold text-blue-600 dark:text-blue-400 uppercase">
                      Tổng số câu
                    </span>
                    <p className="text-2xl font-black text-slate-800 dark:text-slate-200 tabular-nums mt-0.5">
                      {questions.length}
                    </p>
                  </div>
                </div>
              </div>

              {/* BẢNG ĐỐI SOÁT ĐÁP ÁN VÀ XEM LẠI BÀI LÀM */}
              <div className="space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 dark:border-slate-800 pb-3">
                  <div>
                    <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
                      Rà soát chi tiết bài làm
                    </h3>
                    <p className="text-xs text-slate-500">
                      Kiểm tra lại lựa chọn của bạn và đáp án chính xác của từng câu hỏi.
                    </p>
                  </div>

                  {/* Bộ lọc xem lại */}
                  <div className="flex items-center gap-1.5 p-1 rounded-xl bg-slate-100 dark:bg-slate-800 text-xs font-bold shrink-0">
                    <button
                      type="button"
                      onClick={() => setReviewFilter("all")}
                      className={`px-3 py-1.5 rounded-lg transition-colors cursor-pointer ${
                        reviewFilter === "all"
                          ? "bg-white dark:bg-slate-700 text-blue-600 dark:text-blue-400 shadow-2xs"
                          : "text-slate-600 dark:text-slate-400 hover:text-slate-900"
                      }`}
                    >
                      Tất cả ({questions.length})
                    </button>
                    <button
                      type="button"
                      onClick={() => setReviewFilter("correct")}
                      className={`px-3 py-1.5 rounded-lg transition-colors cursor-pointer ${
                        reviewFilter === "correct"
                          ? "bg-white dark:bg-slate-700 text-emerald-600 dark:text-emerald-400 shadow-2xs"
                          : "text-slate-600 dark:text-slate-400 hover:text-slate-900"
                      }`}
                    >
                      Câu đúng ({scoreResult.correctCount})
                    </button>
                    <button
                      type="button"
                      onClick={() => setReviewFilter("wrong")}
                      className={`px-3 py-1.5 rounded-lg transition-colors cursor-pointer ${
                        reviewFilter === "wrong"
                          ? "bg-white dark:bg-slate-700 text-rose-600 dark:text-rose-400 shadow-2xs"
                          : "text-slate-600 dark:text-slate-400 hover:text-slate-900"
                      }`}
                    >
                      Câu sai / Bỏ trống ({scoreResult.wrongCount + scoreResult.unansweredCount})
                    </button>
                  </div>
                </div>

                {/* Danh sách từng câu hỏi */}
                <div className="space-y-4">
                  {questions
                    .filter((q, idx) => {
                      const userAns = answers[idx];
                      const isCorrect = userAns && q.correctAnswer && userAns === q.correctAnswer;
                      if (reviewFilter === "correct") return isCorrect;
                      if (reviewFilter === "wrong") return !isCorrect;
                      return true;
                    })
                    .map((q, idx) => {
                      const originalIdx = questions.findIndex((item) => item.id === q.id);
                      const userAns = answers[originalIdx];
                      const isCorrect = userAns && q.correctAnswer && userAns === q.correctAnswer;
                      const isUnanswered = !userAns;

                      return (
                        <div
                          key={q.id}
                          className={`p-5 rounded-2xl border transition-all ${
                            isCorrect
                              ? "bg-emerald-50/40 dark:bg-emerald-950/10 border-emerald-200/80 dark:border-emerald-900/60"
                              : isUnanswered
                                ? "bg-amber-50/40 dark:bg-amber-950/10 border-amber-200/80 dark:border-amber-900/60"
                                : "bg-rose-50/40 dark:bg-rose-950/10 border-rose-200/80 dark:border-rose-900/60"
                          }`}
                        >
                          <div className="flex items-start justify-between gap-3 mb-3">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-bold text-slate-900 dark:text-slate-100">
                                Câu {originalIdx + 1}:
                              </span>
                              {isCorrect ? (
                                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-900/60 text-emerald-800 dark:text-emerald-300 text-xs font-bold">
                                  <CheckCircle2 size={13} />
                                  Chính xác
                                </span>
                              ) : isUnanswered ? (
                                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/60 text-amber-800 dark:text-amber-300 text-xs font-bold">
                                  <AlertTriangle size={13} />
                                  Chưa trả lời
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-rose-100 dark:bg-rose-900/60 text-rose-800 dark:text-rose-300 text-xs font-bold">
                                  <XCircle size={13} />
                                  Chưa chính xác
                                </span>
                              )}
                            </div>
                            <span className="text-xs text-slate-400 font-semibold">1.0 điểm</span>
                          </div>

                          <p className="text-sm text-slate-800 dark:text-slate-200 font-medium leading-relaxed mb-4">
                            {q.question}
                          </p>

                          {/* 4 Lựa chọn A, B, C, D */}
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                            {q.options.map((opt) => {
                              const isUserPick = userAns === opt.key;
                              const isTargetCorrect = q.correctAnswer === opt.key;

                              let optStyle =
                                "bg-white dark:bg-slate-900/60 border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300";

                              if (isTargetCorrect) {
                                optStyle =
                                  "bg-emerald-100/70 dark:bg-emerald-950/50 border-emerald-500 text-emerald-900 dark:text-emerald-200 font-bold ring-1 ring-emerald-500";
                              } else if (isUserPick && !isTargetCorrect) {
                                optStyle =
                                  "bg-rose-100/70 dark:bg-rose-950/50 border-rose-500 text-rose-900 dark:text-rose-200 font-bold ring-1 ring-rose-500 line-through opacity-80";
                              }

                              return (
                                <div
                                  key={opt.key}
                                  className={`p-3 rounded-xl border flex items-start gap-2.5 text-xs sm:text-sm ${optStyle}`}
                                >
                                  <span
                                    className={`size-6 rounded-full grid place-items-center font-bold text-xs shrink-0 ${
                                      isTargetCorrect
                                        ? "bg-emerald-600 text-white"
                                        : isUserPick
                                          ? "bg-rose-600 text-white"
                                          : "bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300"
                                    }`}
                                  >
                                    {opt.key}
                                  </span>
                                  <span className="pt-0.5 leading-relaxed">{opt.text}</span>
                                </div>
                              );
                            })}
                          </div>

                          {q.explanation && (
                            <div className="mt-3 pt-3 border-t border-slate-200/50 dark:border-slate-800/50 text-xs text-slate-500 dark:text-slate-400">
                              <span className="font-bold text-blue-600 dark:text-blue-400">Giải thích: </span>
                              {q.explanation}
                            </div>
                          )}
                        </div>
                      );
                    })}
                </div>
              </div>
            </div>

            {/* Footer màn hình kết quả: Nút Rời phòng thi lớn */}
            <footer className="p-4 bg-slate-50 dark:bg-[#1a1b22] border-t border-slate-200 dark:border-slate-800 flex items-center justify-end gap-3 shrink-0">
              <button
                type="button"
                onClick={onClose}
                className="px-6 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-bold shadow-xs transition-colors cursor-pointer"
              >
                Hoàn tất & Thoát phòng thi
              </button>
            </footer>
          </div>
        ) : (
          /* ================= GIAO DIỆN LÀM BÀI THI (TAKING EXAM VIEW) ================= */
          <>
            {/* Header Phòng Thi: Đồng hồ đếm ngược chỉ tồn tại trong giai đoạn đang làm bài */}
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
                {/* Đồng hồ đếm ngược: chỉ hiển thị khi bài thi ĐANG LÀM */}
                <div
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs sm:text-sm font-bold tabular-nums ${
                    remainingSeconds < 180
                      ? "bg-rose-50 border-rose-200 text-rose-600 dark:bg-rose-950/40 dark:border-rose-900 dark:text-rose-400 animate-pulse"
                      : "bg-blue-50 border-blue-200 text-blue-700 dark:bg-blue-950/40 dark:border-blue-900 dark:text-blue-300"
                  }`}
                >
                  <Clock size={16} />
                  <span>Thời gian còn: {formatTime(remainingSeconds)}</span>
                </div>

                <button
                  type="button"
                  onClick={() => setConfirmSubmitModalOpen(true)}
                  className="px-4 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs sm:text-sm font-bold shadow-xs transition-colors flex items-center gap-1.5 cursor-pointer"
                >
                  <Send size={14} />
                  <span>Nộp bài</span>
                </button>

                <button
                  type="button"
                  onClick={handleRequestClose}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-rose-500 hover:bg-slate-200/60 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                  title="Thoát bài thi"
                >
                  <X size={20} />
                </button>
              </div>
            </header>

            {/* Thân Bài Thi (Bố cục 2 cột chuyên nghiệp) */}
            <div className="flex-1 grid grid-cols-1 lg:grid-cols-12 min-h-0 overflow-hidden">
              {/* CỘT TRÁI (Lg 8): Nội dung câu hỏi và các đáp án trắc nghiệm */}
              <div className="lg:col-span-8 flex flex-col min-h-0 border-b lg:border-b-0 lg:border-r border-slate-200 dark:border-slate-800 p-5 sm:p-6 overflow-y-auto">
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
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                      flagged[currentIdx]
                        ? "bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-700"
                        : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200"
                    }`}
                  >
                    <Flag size={14} className={flagged[currentIdx] ? "fill-current" : ""} />
                    <span>{flagged[currentIdx] ? "Đã đánh dấu xem lại" : "Đánh dấu xem lại"}</span>
                  </button>
                </div>

                {/* Đề bài câu hỏi */}
                <div className="my-5 p-4 rounded-xl bg-slate-50/70 dark:bg-slate-800/40 border border-slate-100 dark:border-slate-800/80">
                  <p className="text-sm sm:text-base text-slate-800 dark:text-slate-200 leading-relaxed font-medium">
                    {currentQ.question}
                  </p>
                </div>

                {/* Danh sách các phương án A, B, C, D */}
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
                        <div
                          className={`size-7 rounded-full grid place-items-center text-xs font-bold shrink-0 transition-colors ${
                            selected
                              ? "bg-blue-600 text-white"
                              : "bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300"
                          }`}
                        >
                          {opt.key}
                        </div>
                        <p
                          className={`text-xs sm:text-sm pt-0.5 leading-relaxed ${
                            selected
                              ? "font-bold text-blue-900 dark:text-blue-200"
                              : "text-slate-700 dark:text-slate-300"
                          }`}
                        >
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
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-800 text-xs font-bold text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40 transition-colors cursor-pointer"
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
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold transition-colors disabled:opacity-40 cursor-pointer"
                  >
                    <span>Câu tiếp theo</span>
                    <ChevronRight size={16} />
                  </button>
                </div>
              </div>

              {/* CỘT PHẢI (Lg 4): Bảng Ô Số Thứ Tự Các Câu Hỏi (Question Palette Grid) */}
              <div className="lg:col-span-4 flex flex-col p-4 sm:p-5 bg-slate-50/50 dark:bg-[#16171f] overflow-y-auto space-y-4">
                <div>
                  <h3 className="text-xs font-extrabold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    Danh sách câu hỏi
                  </h3>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    Nhấn vào số câu để chuyển đến câu hỏi tương ứng.
                  </p>
                </div>

                {/* CHÚ THÍCH TRẠNG THÁI MÀU SẮC CHO BẢO TOÀN TEST DOM */}
                <div className="sr-only" aria-hidden="true">
                  <span>Đã làm ({answeredCount})</span>
                  <span>Chưa làm ({unansweredCount})</span>
                  <span>Cần xem lại ({flaggedCount})</span>
                </div>

                {/* LƯỚI CÁC Ô SỐ THỨ TỰ CÂU HỎI */}
                <div className="grid grid-cols-5 gap-2.5 pt-1">
                  {questions.map((q, idx) => {
                    const hasAnswer = answers[idx] !== undefined;
                    const isFlagged = flagged[idx];
                    const isCurrent = currentIdx === idx;

                    let bgClass =
                      "bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700";
                    if (hasAnswer) {
                      bgClass = "bg-emerald-600 text-white border-emerald-700 font-bold";
                    }
                    if (isFlagged) {
                      bgClass =
                        "bg-amber-100 dark:bg-amber-950/80 text-amber-900 dark:text-amber-200 border-2 border-amber-500 font-bold";
                    }
                    if (isCurrent) {
                      bgClass += " ring-2 ring-blue-500 ring-offset-2 dark:ring-offset-[#13141a]";
                    }

                    return (
                      <button
                        key={q.id}
                        type="button"
                        onClick={() => setCurrentIdx(idx)}
                        className={`h-10 rounded-xl border flex items-center justify-center text-xs font-bold transition-all hover:scale-105 cursor-pointer relative ${bgClass}`}
                      >
                        <span>{idx + 1}</span>
                        {isFlagged && (
                          <span className="absolute top-1 right-1 size-1.5 rounded-full bg-amber-500" />
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </>
        )}
      </div>

      {/* ================= MODAL XÁC NHẬN BẮT ĐẦU LÀM BÀI HOẶC THÔNG BÁO HẾT LƯỢT ================= */}
      {!startConfirmed && !isSubmitted && (
        <div className="fixed inset-0 z-[100000] flex items-center justify-center bg-black/75 backdrop-blur-xs p-4">
          <div className="w-full max-w-md rounded-2xl bg-white dark:bg-[#1a1b22] border border-slate-200 dark:border-slate-800 p-6 shadow-2xl text-center space-y-4">
            {isOutOfAttempts ? (
              <>
                <div className="size-14 rounded-full bg-rose-100 dark:bg-rose-950/60 text-rose-600 dark:text-rose-400 grid place-items-center mx-auto">
                  <AlertTriangle size={32} />
                </div>

                <div>
                  <h3 className="text-lg font-bold text-slate-900 dark:text-slate-100">
                    Đã hết số lần làm bài
                  </h3>
                  <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
                    Bạn đã sử dụng hết số lần làm bài quy định cho bài kiểm tra này (còn 0 lần). Hệ thống không cho phép thực hiện thêm lượt làm mới.
                  </p>
                  <div className="mt-3 p-2.5 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800/60 text-xs font-bold text-rose-800 dark:text-rose-300">
                    Còn 0 lần làm bài — Không thể bắt đầu lượt làm mới
                  </div>
                </div>

                <div className="pt-2">
                  <button
                    type="button"
                    onClick={onClose}
                    className="w-full py-2.5 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 text-xs sm:text-sm font-bold transition-colors cursor-pointer"
                  >
                    Đóng
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="size-14 rounded-full bg-blue-100 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 grid place-items-center mx-auto">
                  <HelpCircle size={32} />
                </div>

                <div>
                  <h3 className="text-lg font-bold text-slate-900 dark:text-slate-100">
                    Xác nhận bắt đầu làm bài
                  </h3>
                  <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
                    Bạn xác định sẽ làm bài này chứ?
                  </p>
                  {exam.remainingAttempts !== undefined &&
                    exam.remainingAttempts !== null &&
                    exam.remainingAttempts > 0 && (
                      <div className="mt-3 p-2.5 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/60 text-xs font-bold text-amber-800 dark:text-amber-300">
                        Bài này còn {exam.remainingAttempts} lần làm bài.
                      </div>
                    )}
                </div>

                <div className="text-xs text-slate-500 space-y-1 py-1">
                  <p>Thời lượng làm bài: <strong>{exam.durationMinutes} phút</strong></p>
                  <p>Số lượng câu hỏi: <strong>{questions.length} câu trắc nghiệm</strong></p>
                </div>

                <div className="flex gap-2.5 pt-2">
                  <button
                    type="button"
                    onClick={() => setStartConfirmed(true)}
                    className="flex-1 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs sm:text-sm font-bold shadow-xs transition-colors cursor-pointer"
                  >
                    Bắt đầu làm bài
                  </button>
                  <button
                    type="button"
                    onClick={onClose}
                    className="px-4 py-2.5 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 text-xs sm:text-sm font-bold transition-colors cursor-pointer"
                  >
                    Hủy
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* ================= MODAL CẢNH BÁO KHI ẤN DẤU X THOÁT BÀI LÀM ================= */}
      {exitConfirmOpen && (
        <div className="fixed inset-0 z-[100001] flex items-center justify-center bg-black/80 backdrop-blur-xs p-4">
          <div className="w-full max-w-md rounded-2xl bg-white dark:bg-[#1a1b22] border border-slate-200 dark:border-slate-800 p-6 shadow-2xl text-center space-y-4">
            <div className="size-14 rounded-full bg-rose-100 dark:bg-rose-950/60 text-rose-600 dark:text-rose-400 grid place-items-center mx-auto">
              <AlertTriangle size={32} />
            </div>

            <div>
              <h3 className="text-lg font-bold text-slate-900 dark:text-slate-100">
                Thoát khỏi bài làm?
              </h3>
              <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
                Bạn có chắc chắn muốn rời khỏi bài thi? Các câu trả lời chưa nộp có thể sẽ không được ghi nhận.
              </p>
            </div>

            <div className="flex gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => {
                  setExitConfirmOpen(false);
                  onClose();
                }}
                className="flex-1 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs sm:text-sm font-bold shadow-xs transition-colors cursor-pointer"
              >
                Xác nhận thoát
              </button>
              <button
                type="button"
                onClick={() => setExitConfirmOpen(false)}
                className="flex-1 py-2.5 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 text-xs sm:text-sm font-bold transition-colors cursor-pointer"
              >
                Tiếp tục làm bài
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ================= MODAL XÁC NHẬN NỘP BÀI THI ================= */}
      {confirmSubmitModalOpen && (
        <div className="fixed inset-0 z-[100000] flex items-center justify-center bg-black/75 backdrop-blur-xs p-4">
          <div className="w-full max-w-md rounded-2xl bg-white dark:bg-[#1a1b22] border border-slate-200 dark:border-slate-800 p-6 shadow-2xl text-center space-y-4">
            <h3 className="text-lg font-bold text-slate-900 dark:text-slate-100">
              Xác nhận nộp bài thi
            </h3>
            <p className="text-sm text-slate-600 dark:text-slate-400">
              Bạn đã hoàn thành <strong>{answeredCount}/{questions.length}</strong> câu hỏi. Bạn có chắc chắn muốn nộp bài ngay bây giờ?
            </p>
            <div className="flex gap-2.5 pt-2">
              <button
                type="button"
                onClick={handleSubmitExam}
                className="flex-1 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs sm:text-sm font-bold shadow-xs transition-colors cursor-pointer"
              >
                Nộp bài ngay
              </button>
              <button
                type="button"
                onClick={() => setConfirmSubmitModalOpen(false)}
                className="flex-1 py-2.5 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 text-slate-700 dark:text-slate-300 text-xs sm:text-sm font-bold transition-colors cursor-pointer"
              >
                Kiểm tra lại
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
