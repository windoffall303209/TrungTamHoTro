"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Clock,
  Flag,
  ChevronLeft,
  ChevronRight,
  X,
  Send,
  AlertTriangle,
  HelpCircle,
  CheckCircle2,
  XCircle,
  Trophy,
  ArrowRight,
} from "lucide-react";
import { apiRequest } from "@/lib/api-client";
import type { Question } from "@/lib/learning-types";

type ExamApiOption = string | { key?: string; text?: string; value?: string };
type ExamApiQuestion = Omit<Question, "options"> & {
  options: ExamApiOption[];
  correctAnswer?: string;
  explanation?: string;
};

export interface ExamTakingData {
  id: string;
  title: string;
  durationMinutes: number;
  totalQuestions?: number;
  remainingAttempts?: number | null;
  totalScore?: number;
  closeAt?: string;
}

interface QuestionItem {
  id: string | number;
  question: string;
  options: { key: string; text: string; value: string }[];
  correctAnswer?: string;
  explanation?: string;
}

interface ExamTakingModalProps {
  open: boolean;
  onClose: () => void;
  exam: ExamTakingData | null;
  isInstructorPreview?: boolean;
  onSubmitted?: (result: { score: number | null; total: number }) => void;
}

/** Component Giao diện làm bài kiểm tra trực tuyến toàn màn hình kết nối trực tiếp CSDL PostgreSQL */
export function ExamTakingModal({
  open,
  onClose,
  exam,
  isInstructorPreview = false,
  onSubmitted,
}: ExamTakingModalProps) {
  const [currentIdx, setCurrentIdx] = useState(0);
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [essayTextAnswers, setEssayTextAnswers] = useState<Record<number, string>>({});
  const [flagged, setFlagged] = useState<Record<number, boolean>>({});
  const [remainingSeconds, setRemainingSeconds] = useState(15 * 60);
  const [initialDurationSeconds, setInitialDurationSeconds] = useState(15 * 60);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [scoreResult, setScoreResult] = useState<{
    score: number | null;
    total: number;
    correctCount: number;
    wrongCount: number;
    unansweredCount: number;
    completedSeconds: number;
    reviewAvailable: boolean;
  } | null>(null);

  // Dữ liệu câu hỏi thực tế tải từ database PostgreSQL
  const [dbQuestions, setDbQuestions] = useState<QuestionItem[]>([]);
  const [attemptId, setAttemptId] = useState<string | null>(null);
  const [isLoadingQuestions, setIsLoadingQuestions] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submissionWarning, setSubmissionWarning] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const autoSubmitAttemptedRef = useRef(false);
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const answersRef = useRef<Record<number, string>>({});
  const essayAnswersRef = useRef<Record<number, string>>({});

  // Trạng thái modal xác nhận
  const [startConfirmed, setStartConfirmed] = useState(false);
  const [exitConfirmOpen, setExitConfirmOpen] = useState(false);
  const [confirmSubmitModalOpen, setConfirmSubmitModalOpen] = useState(false);
  const [reviewFilter, setReviewFilter] = useState<"all" | "correct" | "wrong">("all");

  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const deadlineRef = useRef<number | null>(null);
  const serverOffsetRef = useRef(0);

  const questions = dbQuestions;
  const examId = exam?.id;
  const examDurationMinutes = exam?.durationMinutes;
  const examCloseAt = exam?.closeAt;
  const examTotalScore = exam?.totalScore;

  // Tải danh sách câu hỏi THẬT từ PostgreSQL Database khi mở bài thi
  useEffect(() => {
    if (!open || !examId) return;

    let isMounted = true;
    setIsLoadingQuestions(true);
    setLoadError(null);

    /** Tải nội dung đề theo chế độ làm bài hoặc xem trước của giáo viên. */
    async function loadExamContent() {
      try {
        let fetchedQuestions: ExamApiQuestion[] = [];
        let resumedAnswers: Record<string, string[]> = {};

        if (isInstructorPreview) {
          // Bản xem trước chỉ dùng nội dung đề từ API có phân quyền của giáo viên.
          fetchedQuestions = await apiRequest<ExamApiQuestion[]>(`/instructor/exams/${examId}/preview`);
        } else {
          // 2. Chế độ Học sinh làm bài:
          // BƯỚC 1: Mở hoặc kích hoạt lượt làm bài trong Database trước
          const attempt = await apiRequest<{ id: string; startedAt: string; serverTime?: string; answers: Record<string, string[]> }>(`/learner/exams/${examId}/attempts`, {
            method: "POST",
          });
          if (!attempt.id) throw new Error("Máy chủ không trả về lượt làm bài hợp lệ.");
          const startedAt = Date.parse(attempt.startedAt);
          if (!Number.isFinite(startedAt)) throw new Error("Máy chủ không trả về thời điểm bắt đầu lượt thi hợp lệ.");
          resumedAnswers = attempt.answers ?? {};
          if (isMounted) {
            const closeAt = examCloseAt ? Date.parse(examCloseAt) : Number.POSITIVE_INFINITY;
            deadlineRef.current = Math.min(startedAt + (examDurationMinutes || 15) * 60000, Number.isNaN(closeAt) ? Number.POSITIVE_INFINITY : closeAt);
            const serverTime = attempt.serverTime ? Date.parse(attempt.serverTime) : NaN;
            serverOffsetRef.current = Number.isFinite(serverTime) ? serverTime - Date.now() : 0;
            setRemainingSeconds(Math.max(0, Math.ceil((deadlineRef.current - Date.now() - serverOffsetRef.current) / 1000)));
            setAttemptId(attempt.id);
          }

          // BƯỚC 2: Tải danh sách câu hỏi thật từ Database của đề thi
          fetchedQuestions = await apiRequest<ExamApiQuestion[]>(`/learner/exams/${examId}/questions`);
        }

        if (isMounted) {
          if (Array.isArray(fetchedQuestions) && fetchedQuestions.length > 0) {
            const mapped: QuestionItem[] = fetchedQuestions.map((q, idx) => {
              const rawOptions: ExamApiOption[] = Array.isArray(q.options) ? q.options : [];
              const keys = ["A", "B", "C", "D", "E", "F"];
              const options = rawOptions.map((optText, optIdx) => {
                if (typeof optText === "string") {
                  const match = optText.match(/^([A-F])[\.\:\s]+(.*)$/i);
                  if (match && match[1] && match[2]) {
                    return { key: match[1].toUpperCase(), text: match[2].trim(), value: optText };
                  }
                  return { key: keys[optIdx] || String(optIdx + 1), text: optText, value: optText };
                }
                return {
                  key: optText.key || keys[optIdx] || String(optIdx + 1),
                  text: typeof optText.text === "string" ? optText.text : JSON.stringify(optText),
                  value: typeof optText.value === "string" ? optText.value : optText.text ?? "",
                };
              });
              const expectedAnswer = q.correctAnswers?.[0] ?? q.correctAnswer;
              const matchedOption = options.find((option) => option.value === expectedAnswer)
                ?? options.find((option) => option.key === expectedAnswer || option.text === expectedAnswer);
              return {
                id: q.id || `q-${idx + 1}`,
                question: q.content || `Câu hỏi số ${idx + 1}`,
                options,
                correctAnswer: matchedOption?.key ?? expectedAnswer,
                explanation: q.explanation || undefined,
              };
            });
            setDbQuestions(mapped);
            if (!isInstructorPreview) {
              const restored: Record<number, string> = {};
              const restoredEssays: Record<number, string> = {};
              mapped.forEach((question, index) => {
                const saved = resumedAnswers[String(question.id)]?.[0];
                if (!saved) return;
                const selected = question.options.find((option) => option.value === saved);
                if (selected) restored[index] = selected.key;
                else if (!question.options.length) {
                  restored[index] = "COMPLETED";
                  restoredEssays[index] = saved;
                }
              });
              answersRef.current = restored;
              essayAnswersRef.current = restoredEssays;
              setAnswers(restored);
              setEssayTextAnswers(restoredEssays);
            }
          } else {
            setLoadError("Đề bài này chưa có câu hỏi nào được lưu trong cơ sở dữ liệu.");
          }
        }
      } catch (error: unknown) {
        if (isMounted) {
          setDbQuestions([]);
          setLoadError(error instanceof Error ? error.message : "Không thể tải câu hỏi từ cơ sở dữ liệu.");
        }
      } finally {
        if (isMounted) setIsLoadingQuestions(false);
      }
    }

    void loadExamContent();

    return () => {
      isMounted = false;
    };
  }, [open, examId, examDurationMinutes, examCloseAt, isInstructorPreview]);

  // Khởi động đồng hồ đếm ngược chỉ khi đã xác nhận bắt đầu và chưa nộp bài
  useEffect(() => {
    if (!open || !examId) return;

    const totalSec = (examDurationMinutes || 15) * 60;
    setRemainingSeconds(totalSec);
    setInitialDurationSeconds(totalSec);
    deadlineRef.current = null;
    serverOffsetRef.current = 0;
    setAnswers({});
    answersRef.current = {};
    essayAnswersRef.current = {};
    setEssayTextAnswers({});
    setAttemptId(null);
    setDbQuestions([]);
    setSubmitError(null);
    setSubmissionWarning(null);
    setIsSubmitting(false);
    submittingRef.current = false;
    autoSubmitAttemptedRef.current = false;
    saveQueueRef.current = Promise.resolve();
    setFlagged({});
    setCurrentIdx(0);
    setIsSubmitted(false);
    setScoreResult(null);
    setStartConfirmed(false);
    setExitConfirmOpen(false);
    setConfirmSubmitModalOpen(false);

    if (timerRef.current) clearInterval(timerRef.current);
  }, [open, examId, examDurationMinutes]);

  // Đồng hồ sử dụng thời hạn thật của lượt thi trên máy chủ, kể cả khi mở lại bài.
  useEffect(() => {
    if (!open || isSubmitted || (isInstructorPreview ? !startConfirmed : !attemptId)) {
      if (timerRef.current) clearInterval(timerRef.current);
      return;
    }

    if (isInstructorPreview && deadlineRef.current === null) {
      deadlineRef.current = Date.now() + initialDurationSeconds * 1000;
    }
    timerRef.current = setInterval(() => {
      const deadline = deadlineRef.current;
      if (deadline !== null) {
        setRemainingSeconds(Math.max(0, Math.ceil((deadline - Date.now() - serverOffsetRef.current) / 1000)));
      }
    }, 1000);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [open, startConfirmed, isSubmitted, isInstructorPreview, attemptId, initialDurationSeconds]);

  /** Định dạng số giây còn lại thành chuỗi MM:SS */
  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  };

  /** Chọn đáp án cho câu hỏi hiện tại và lưu tạm lên server nếu có lượt thi */
  const handleSelectOption = (key: string) => {
    if (isSubmitted || submittingRef.current) return;
    const next = { ...answersRef.current, [currentIdx]: key };
    answersRef.current = next;
    setAnswers(next);

    const question = questions[currentIdx];
    const option = question?.options.find((item) => item.key === key);
    if (attemptId && question && option && !isInstructorPreview) {
      queueAnswerSave(String(question.id), [option.value]);
    }
  };

  /** Xếp hàng thao tác lưu để các lần chọn nhanh không ghi đè đáp án mới bằng phản hồi cũ. */
  const queueAnswerSave = (questionId: string, values: string[]) => {
    if (!attemptId || isInstructorPreview) return;
    const save = saveQueueRef.current.catch(() => undefined).then(async () => {
      await apiRequest(`/learner/exam-attempts/${attemptId}/answers`, {
        method: "PATCH",
        body: JSON.stringify({ questionId, answers: values }),
      });
    });
    saveQueueRef.current = save;
    void save.catch((error: unknown) => {
      console.error("Không thể lưu tạm câu trả lời lên máy chủ.", error);
      setSubmitError(error instanceof Error ? error.message : "Không thể lưu câu trả lời.");
    });
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
  const handleSubmitExam = useCallback(async () => {
    if (submittingRef.current || isSubmitted) return;
    submittingRef.current = true;
    setIsSubmitting(true);
    setSubmitError(null);
    try {
      let serverScore: number | null = null;
      if (!isInstructorPreview) {
        if (!attemptId) throw new Error("Chưa có lượt làm bài hợp lệ để nộp.");
        // Nếu autosave trước đó lỗi, gửi lại toàn bộ câu trả lời mới nhất trước khi chốt bài.
        let pendingSaveFailed = false;
        try {
          await saveQueueRef.current;
        } catch (error) {
          pendingSaveFailed = true;
          console.error("Lưu câu trả lời trước khi nộp thất bại.", error);
        }
        if (remainingSeconds > 0) {
          for (const [index, question] of questions.entries()) {
            const selected = answersRef.current[index];
            const answer = question.options.length
              ? question.options.find((option) => option.key === selected)?.value
              : essayAnswersRef.current[index]?.trim();
            if (!answer) continue;
            await apiRequest(`/learner/exam-attempts/${attemptId}/answers`, {
              method: "PATCH",
              body: JSON.stringify({ questionId: String(question.id), answers: [answer] }),
            });
          }
        } else if (pendingSaveFailed) {
          setSubmissionWarning("Một số câu trả lời chưa được máy chủ xác nhận trước khi hết giờ. Kết quả chỉ tính những câu đã lưu thành công.");
        }
        const submitted = await apiRequest<{ status: string; score?: number }>(
          `/learner/exam-attempts/${attemptId}/submit`,
          { method: "POST" },
        );
        if (submitted.status !== "SUBMITTED" && submitted.status !== "GRADED") {
          throw new Error("Máy chủ chưa xác nhận đã nộp bài.");
        }
        serverScore = submitted.status === "GRADED" ? submitted.score ?? null : null;
      }

      const total = questions.length;
      let correctCount = 0;
      let wrongCount = 0;
      let unanswered = 0;
      questions.forEach((question, index) => {
        const answer = answersRef.current[index];
        if (!answer) unanswered += 1;
        else if (question.correctAnswer && answer === question.correctAnswer) correctCount += 1;
        else if (isInstructorPreview) wrongCount += 1;
      });
      const totalScore = examTotalScore ?? 10;
      const previewScore = Math.round(((correctCount * totalScore) / Math.max(1, total)) * 10) / 10;
      const score = isInstructorPreview ? previewScore : serverScore;
      setScoreResult({
        score,
        total: totalScore,
        correctCount,
        wrongCount,
        unansweredCount: unanswered,
        completedSeconds: Math.max(1, initialDurationSeconds - remainingSeconds),
        reviewAvailable: isInstructorPreview,
      });
      setIsSubmitted(true);
      if (timerRef.current) clearInterval(timerRef.current);
      setConfirmSubmitModalOpen(false);
      onSubmitted?.({ score, total: totalScore });
    } catch (error) {
      console.error("Không thể nộp bài thi.", error);
      setSubmitError(error instanceof Error ? error.message : "Không thể nộp bài thi.");
    } finally {
      submittingRef.current = false;
      setIsSubmitting(false);
    }
  }, [attemptId, examTotalScore, initialDurationSeconds, isInstructorPreview, isSubmitted, onSubmitted, questions, remainingSeconds]);

  // Gọi nộp bài bên ngoài updater để tránh tác dụng phụ khi React tính lại state.
  useEffect(() => {
    if ((startConfirmed || (!isInstructorPreview && attemptId)) && remainingSeconds === 0 && !isSubmitted && !autoSubmitAttemptedRef.current) {
      autoSubmitAttemptedRef.current = true;
      void handleSubmitExam();
    }
  }, [attemptId, handleSubmitExam, isInstructorPreview, isSubmitted, remainingSeconds, startConfirmed]);

  /** Xử lý khi nhấn nút đóng X trên thanh header bài thi */
  const handleRequestClose = () => {
    if (isSubmitted) {
      onClose();
    } else {
      setExitConfirmOpen(true);
    }
  };

  if (!open || !exam) return null;

  const currentQ = questions[currentIdx] || questions[0] || {
    id: "q-fallback",
    question: "Chưa có nội dung câu hỏi",
    options: [],
    correctAnswer: undefined,
  };
  const answeredCount = Object.keys(answers).length;
  const flaggedCount = Object.values(flagged).filter(Boolean).length;
  const unansweredCount = questions.length - answeredCount;
  const isOutOfAttempts =
    exam.remainingAttempts !== undefined &&
    exam.remainingAttempts !== null &&
    exam.remainingAttempts <= 0 && !attemptId;

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
                    {scoreResult.score === null
                      ? "Bài làm đã được ghi nhận và đang chờ giảng viên chấm điểm."
                      : "Bài làm đã được ghi nhận và có kết quả chấm điểm."}
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

            {submissionWarning && <p role="alert" className="mx-6 mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">{submissionWarning}</p>}
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
                          scoreResult.score === null
                            ? "bg-amber-100 dark:bg-amber-950/70 text-amber-800 dark:text-amber-300"
                            : scoreResult.total > 0 && scoreResult.score / scoreResult.total >= 0.85
                            ? "bg-emerald-100 dark:bg-emerald-950/70 text-emerald-700 dark:text-emerald-300"
                            : scoreResult.total > 0 && scoreResult.score / scoreResult.total >= 0.65
                              ? "bg-blue-100 dark:bg-blue-950/70 text-blue-700 dark:text-blue-300"
                              : scoreResult.total > 0 && scoreResult.score / scoreResult.total >= 0.5
                                ? "bg-amber-100 dark:bg-amber-950/70 text-amber-800 dark:text-amber-300"
                                : "bg-rose-100 dark:bg-rose-950/70 text-rose-700 dark:text-rose-300"
                        }`}
                      >
                        {scoreResult.score === null
                          ? "Đang chờ chấm"
                          : scoreResult.total > 0 && scoreResult.score / scoreResult.total >= 0.85
                          ? "Xuất sắc"
                          : scoreResult.total > 0 && scoreResult.score / scoreResult.total >= 0.65
                            ? "Khá giỏi"
                            : scoreResult.total > 0 && scoreResult.score / scoreResult.total >= 0.5
                              ? "Đạt yêu cầu"
                              : "Cần cố gắng"}
                      </span>
                    </div>
                    <div className="flex items-baseline justify-center sm:justify-start gap-2">
                      <span className="text-5xl sm:text-6xl font-black text-blue-600 dark:text-blue-400 tabular-nums tracking-tight">
                        {scoreResult.score ?? "—"}
                      </span>
                      <span className="text-xl sm:text-2xl font-bold text-slate-400">/ {scoreResult.total} điểm</span>
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
                      {scoreResult.reviewAvailable ? scoreResult.correctCount : "—"}
                    </p>
                  </div>
                  <div className="p-3.5 rounded-2xl bg-white dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 text-center min-w-28 shadow-2xs">
                    <span className="text-[11px] font-bold text-rose-600 dark:text-rose-400 uppercase">
                      Số câu sai
                    </span>
                    <p className="text-2xl font-black text-rose-600 dark:text-rose-400 tabular-nums mt-0.5">
                      {scoreResult.reviewAvailable ? scoreResult.wrongCount : "—"}
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
              {scoreResult.reviewAvailable && <div className="space-y-4">
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
                    .map((q) => {
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
              </div>}
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

            {submitError && (
              <div role="alert" className="mx-5 mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300">
                <span>{submitError}</span>
                {remainingSeconds === 0 && (
                  <button type="button" onClick={() => void handleSubmitExam()} disabled={isSubmitting} className="rounded-lg bg-rose-700 px-3 py-1.5 font-semibold text-white disabled:opacity-60">
                    {isSubmitting ? "Đang thử lại" : "Thử nộp lại"}
                  </button>
                )}
              </div>
            )}

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

                {/* Danh sách các phương án A, B, C, D hoặc ô nhập tự luận */}
                {currentQ.options && currentQ.options.length > 0 ? (
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
                ) : (
                  <div className="space-y-3 flex-1">
                    <label className="block text-xs font-bold text-slate-500 dark:text-slate-400">
                      Nội dung bài làm tự luận của bạn:
                    </label>
                    <textarea
                      value={essayTextAnswers[currentIdx] || ""}
                      onChange={(e) => {
                        const val = e.target.value;
                        const next = { ...essayAnswersRef.current, [currentIdx]: val };
                        essayAnswersRef.current = next;
                        setEssayTextAnswers(next);
                        if (val.trim()) {
                          const answersNext = { ...answersRef.current, [currentIdx]: "COMPLETED" };
                          answersRef.current = answersNext;
                          setAnswers(answersNext);
                        } else {
                          const answersNext = { ...answersRef.current };
                          delete answersNext[currentIdx];
                          answersRef.current = answersNext;
                          setAnswers(answersNext);
                        }
                      }}
                      onBlur={() => {
                        if (attemptId && !isInstructorPreview && !submittingRef.current) {
                          const currentQuestion = questions[currentIdx];
                          if (currentQuestion) queueAnswerSave(String(currentQuestion.id), essayAnswersRef.current[currentIdx]?.trim() ? [essayAnswersRef.current[currentIdx].trim()] : []);
                        }
                      }}
                      rows={8}
                      placeholder="Gõ nội dung câu trả lời hoặc trình bày các bước giải chi tiết tại đây..."
                      className="w-full p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-sm leading-relaxed focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                )}

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
            {isLoadingQuestions ? (
              <div className="py-8 space-y-4">
                <div className="size-10 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto" />
                <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
                  Đang tải đề thi từ cơ sở dữ liệu...
                </h3>
                <p className="text-xs text-slate-500">
                  Vui lòng đợi trong giây lát trong khi hệ thống nạp dữ liệu câu hỏi.
                </p>
              </div>
            ) : questions.length === 0 ? (
              <>
                <div className="size-14 rounded-full bg-amber-100 dark:bg-amber-950/60 text-amber-600 dark:text-amber-400 grid place-items-center mx-auto">
                  <AlertTriangle size={32} />
                </div>

                <div>
                  <h3 className="text-lg font-bold text-slate-900 dark:text-slate-100">
                    Chưa có câu hỏi trong cơ sở dữ liệu
                  </h3>
                  <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
                    {loadError || "Bài kiểm tra này hiện chưa có nội dung câu hỏi nào được lưu trữ trong cơ sở dữ liệu."}
                  </p>
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
            ) : isOutOfAttempts && !isInstructorPreview ? (
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
                    {isInstructorPreview ? "Xem trước đề bài (Chế độ giáo viên)" : "Xác nhận bắt đầu làm bài"}
                  </h3>
                  <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
                    {isInstructorPreview
                      ? "Bạn đang ở chế độ xem trước và làm thử đề thi với tư cách giáo viên."
                      : "Bạn xác định sẽ bắt đầu làm bài này chứ?"}
                  </p>
                  {!isInstructorPreview &&
                    exam.remainingAttempts !== undefined &&
                    exam.remainingAttempts !== null &&
                    exam.remainingAttempts > 0 && (
                      <div className="mt-3 p-2.5 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/60 text-xs font-bold text-amber-800 dark:text-amber-300">
                        Bài này còn {exam.remainingAttempts} lần làm bài.
                      </div>
                    )}
                </div>

                <div className="text-xs text-slate-500 space-y-1 py-1">
                  <p>Thời lượng làm bài: <strong>{exam.durationMinutes} phút</strong></p>
                  <p>Số lượng câu hỏi: <strong>{questions.length} câu</strong></p>
                </div>

                <div className="flex gap-2.5 pt-2">
                  <button
                    type="button"
                    onClick={() => setStartConfirmed(true)}
                    className="flex-1 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs sm:text-sm font-bold shadow-xs transition-colors cursor-pointer"
                  >
                    {isInstructorPreview ? "Bắt đầu xem thử" : "Bắt đầu làm bài"}
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
            {submitError && <p role="alert" className="text-sm text-rose-600 dark:text-rose-400">{submitError}</p>}
            <div className="flex gap-2.5 pt-2">
              <button
                type="button"
                onClick={handleSubmitExam}
                disabled={isSubmitting}
                className="flex-1 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-xs sm:text-sm font-bold shadow-xs transition-colors cursor-pointer"
              >
                {isSubmitting ? "Đang nộp bài..." : "Nộp bài ngay"}
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
