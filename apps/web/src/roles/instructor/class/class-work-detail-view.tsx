"use client";

import { useRouter } from "next/navigation";
import { memo, useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  Download,
  Edit3,
  ExternalLink,
  Eye,
  EyeOff,
  LoaderCircle,
  Play,
  Printer,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { QuestionImage } from "@/features/questions/question-image";
import { apiRequest } from "@/lib/api-client";
import type { RoleCode } from "@/lib/app-types";
import type {
  Assignment,
  AssignmentSubmission,
  DirectoryUser,
  Exam,
  ExamAttempt,
  ExamAttemptReview,
  Question,
} from "@/lib/learning-types";
import { useApp } from "@/providers/app-provider";
import { RichText } from "@/shared/ui/ui";
import { getScoreColorClass } from "./instructor-class-workspace.helpers";

export type DetailSubTab = "gradebook" | "overview" | "stats" | "exam_content";
export type DetailStatusFilter = "ALL" | "NOT_STARTED" | "IN_PROGRESS" | "SUBMITTED";

/** Tính khoảng thời gian làm bài từ lúc bắt đầu đến lúc nộp. */
function formatAttemptDuration(startedAt?: string, submittedAt?: string): string {
  if (!startedAt || !submittedAt) return "—";
  const diffSec = Math.max(1, Math.round((Date.parse(submittedAt) - Date.parse(startedAt)) / 1000));
  if (!Number.isFinite(diffSec)) return "—";
  const minutes = Math.floor(diffSec / 60);
  const seconds = diffSec % 60;
  return `${minutes}p ${String(seconds).padStart(2, "0")}s`;
}

/** Giao diện Xem chi tiết & Bảng điểm thống nhất, tự cô lập state tìm kiếm/lọc để gõ phím không re-render workspace cha. */
export const ClassWorkDetailView = memo(function ClassWorkDetailView({
  work,
  roleCode,
  locale,
  learners,
  submissions,
  subTab: controlledSubTab,
  onChangeSubTab: controlledOnChangeSubTab,
  statusFilter: controlledStatusFilter,
  onChangeStatusFilter: controlledOnChangeStatusFilter,
  studentSearch: controlledStudentSearch,
  onChangeStudentSearch: controlledOnChangeStudentSearch,
  changingWork,
  onBack,
  onOpenPreviewModal,
  onTryWork,
  onEditWork,
  onToggleVisibility,
  onDeleteWork,
  onPreviewMaterial,
  onDownloadMaterial,
}: {
  work: { kind: "EXAM"; exam: Exam } | { kind: "ASSIGNMENT"; assignment: Assignment };
  roleCode: RoleCode;
  locale: string;
  learners: DirectoryUser[];
  submissions: AssignmentSubmission[];
  subTab?: DetailSubTab;
  onChangeSubTab?: (tab: DetailSubTab) => void;
  statusFilter?: DetailStatusFilter;
  onChangeStatusFilter?: (filter: DetailStatusFilter) => void;
  studentSearch?: string;
  onChangeStudentSearch?: (value: string) => void;
  changingWork: boolean;
  onBack: () => void;
  onOpenPreviewModal: () => void;
  onTryWork: () => void;
  onEditWork: () => void;
  onToggleVisibility: () => void;
  onDeleteWork: () => void;
  onPreviewMaterial: (materialId: string) => void;
  onDownloadMaterial: (materialId: string) => void;
}) {
  const { notify } = useApp();
  const router = useRouter();
  const [localSubTab, setLocalSubTab] = useState<DetailSubTab>(controlledSubTab ?? "gradebook");
  const [localStatusFilter, setLocalStatusFilter] = useState<DetailStatusFilter>(controlledStatusFilter ?? "ALL");
  const [localStudentSearch, setLocalStudentSearch] = useState(controlledStudentSearch ?? "");
  const subTab = controlledSubTab ?? localSubTab;
  const onChangeSubTab = controlledOnChangeSubTab ?? setLocalSubTab;
  const statusFilter = controlledStatusFilter ?? localStatusFilter;
  const onChangeStatusFilter = controlledOnChangeStatusFilter ?? setLocalStatusFilter;
  const studentSearch = controlledStudentSearch ?? localStudentSearch;
  const onChangeStudentSearch = controlledOnChangeStudentSearch ?? setLocalStudentSearch;
  const [examAttempts, setExamAttempts] = useState<ExamAttempt[]>([]);
  const [examQuestions, setExamQuestions] = useState<Question[]>([]);
  const [loadingExamData, setLoadingExamData] = useState(false);
  const [examError, setExamError] = useState("");
  const [attemptReview, setAttemptReview] = useState<ExamAttemptReview | null>(null);
  const [reviewLoading, setReviewLoading] = useState(false);

  const isExam = work.kind === "EXAM";
  const examId = isExam ? work.exam.id : "";
  const workTitle = isExam ? work.exam.title : work.assignment.title;
  const workHidden = Boolean(isExam ? work.exam.hidden : work.assignment.hidden);
  const maxScore = isExam ? work.exam.totalScore : work.assignment.maxScore;

  // Mở trang chấm bài và xem trước tài liệu tự luận chuyên biệt cho bài tập.
  const openAssignmentReviewPage = (submissionId?: string) => {
    if (isExam) return;
    const basePath = `/courses/classes/${encodeURIComponent(work.assignment.classId)}/assignments/${encodeURIComponent(work.assignment.id)}/submissions`;
    router.push(submissionId ? `${basePath}?submissionId=${encodeURIComponent(submissionId)}` : basePath);
  };

  useEffect(() => {
    setAttemptReview(null);
    if (!isExam || !examId) {
      setExamAttempts([]);
      setExamQuestions([]);
      setExamError("");
      return;
    }
    const controller = new AbortController();
    setLoadingExamData(true);
    setExamError("");
    void Promise.all([
      apiRequest<ExamAttempt[]>(`/instructor/exam-attempts?examId=${encodeURIComponent(examId)}`, {
        roleCode,
        signal: controller.signal,
      }),
      apiRequest<Question[]>(`/instructor/exams/${encodeURIComponent(examId)}/preview`, {
        roleCode,
        signal: controller.signal,
      }),
    ])
      .then(([attempts, questions]) => {
        if (controller.signal.aborted) return;
        setExamAttempts(Array.isArray(attempts) ? attempts : []);
        setExamQuestions(Array.isArray(questions) ? questions : []);
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setExamError(error instanceof Error ? error.message : "Không tải được bảng điểm bài trắc nghiệm.");
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoadingExamData(false);
      });
    return () => controller.abort();
  }, [isExam, examId, roleCode]);

  // Tải chi tiết bài làm trắc nghiệm của học sinh để giảng viên xem lại từng câu.
  const handleOpenAttemptReview = async (attemptId: string) => {
    setReviewLoading(true);
    try {
      const review = await apiRequest<ExamAttemptReview>(
        `/instructor/exam-attempts/${encodeURIComponent(attemptId)}/review`,
        { roleCode },
      );
      setAttemptReview(review);
    } catch (error: unknown) {
      notify(error instanceof Error ? error.message : "Không tải được chi tiết bài làm.", "error");
    } finally {
      setReviewLoading(false);
    }
  };

  /** Tổng hợp trạng thái và điểm của từng học sinh trong lớp cho bài tập hiện tại. */
  const learnerRows = useMemo(() => {
    return learners.map((learner) => {
      const name = learner.displayName || learner.email || "Học sinh";
      const initials =
        name
          .split(" ")
          .map((part) => part[0] || "")
          .slice(-2)
          .join("")
          .toUpperCase() || "HS";

      if (isExam) {
        const attempts = examAttempts.filter((item) => item.learnerId === learner.id);
        const graded = attempts.filter((item) => item.status === "GRADED");
        const submitted = attempts.filter((item) => item.status === "SUBMITTED" || item.status === "GRADED");
        const inProgress = attempts.some((item) => item.status === "IN_PROGRESS");
        const latestAttempt = [...(graded.length ? graded : submitted)].sort((a, b) =>
          (b.attemptNo ?? 0) - (a.attemptNo ?? 0) || Date.parse(b.startedAt) - Date.parse(a.startedAt)
        )[0];
        const status: Exclude<DetailStatusFilter, "ALL"> = submitted.length
          ? "SUBMITTED"
          : inProgress
            ? "IN_PROGRESS"
            : "NOT_STARTED";
        return {
          learner,
          name,
          initials,
          status,
          doneLabel: `${attempts.length}/${work.exam.attemptLimit}`,
          statusLabel: graded.length
            ? "Đã chấm"
            : submitted.length
              ? "Chờ chấm"
              : inProgress
                ? "Đang làm"
                : "Chưa làm",
          score: latestAttempt?.score ?? undefined,
          durationLabel: latestAttempt ? formatAttemptDuration(latestAttempt.startedAt, latestAttempt.submittedAt) : "—",
          submittedAt: latestAttempt?.submittedAt,
          attempt: latestAttempt,
          submission: undefined as AssignmentSubmission | undefined,
        };
      }

      const submission = submissions.find((entry) => entry.learnerId === learner.id);
      const status: Exclude<DetailStatusFilter, "ALL"> = submission ? "SUBMITTED" : "NOT_STARTED";
      return {
        learner,
        name,
        initials,
        status,
        doneLabel: submission ? "1/1" : "0/1",
        statusLabel: submission?.status === "GRADED" ? "Đã chấm" : submission ? "Đã nộp" : "Chưa làm",
        score: submission?.score,
        durationLabel: "—",
        submittedAt: submission?.submittedAt,
        attempt: undefined as ExamAttempt | undefined,
        submission,
      };
    });
  }, [learners, isExam, examAttempts, submissions, work]);

  const filteredRows = useMemo(() => {
    const query = studentSearch.trim().toLowerCase();
    return learnerRows.filter((row) => {
      if (statusFilter !== "ALL" && row.status !== statusFilter) return false;
      if (!query) return true;
      return row.name.toLowerCase().includes(query) || (row.learner.email?.toLowerCase().includes(query) ?? false);
    });
  }, [learnerRows, statusFilter, studentSearch]);

  const summary = useMemo(() => {
    const submittedCount = learnerRows.filter((row) => row.status === "SUBMITTED").length;
    const inProgressCount = learnerRows.filter((row) => row.status === "IN_PROGRESS").length;
    const notStartedCount = learnerRows.filter((row) => row.status === "NOT_STARTED").length;
    const scores = learnerRows
      .map((row) => row.score)
      .filter((value): value is number => typeof value === "number");
    const avg = scores.length ? Math.round((scores.reduce((sum, val) => sum + val, 0) / scores.length) * 100) / 100 : null;
    const maxVal = scores.length ? Math.max(...scores) : null;
    const minVal = scores.length ? Math.min(...scores) : null;
    return { submittedCount, inProgressCount, notStartedCount, scoredCount: scores.length, avg, maxVal, minVal };
  }, [learnerRows]);

  return (
    <div className="space-y-4">
      {/* Header: Breadcrumb trái + tab con & thao tác nhanh phải */}
      <div className="flex flex-col gap-3 pb-3 border-b border-slate-200 dark:border-slate-800">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-sm min-w-0">
            <button
              type="button"
              onClick={onBack}
              className="font-bold text-slate-700 dark:text-slate-300 hover:text-blue-600 dark:hover:text-blue-400 cursor-pointer flex items-center gap-1 shrink-0"
            >
              <ArrowLeft size={16} className="text-slate-400" />
              <span>Bài tập</span>
            </button>
            <ChevronRight size={14} className="text-slate-400 shrink-0" />
            <span className="font-extrabold text-slate-900 dark:text-slate-100 truncate max-w-[260px] sm:max-w-md">
              {workTitle}
            </span>
            {workHidden && (
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-800 dark:bg-amber-950/60 dark:text-amber-300">
                <EyeOff size={11} />
                <span>Đã ẩn</span>
              </span>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            {!isExam && (
              <button
                type="button"
                onClick={() => openAssignmentReviewPage()}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold border border-indigo-200 dark:border-indigo-900/60 bg-indigo-50/80 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-100 cursor-pointer"
              >
                <ExternalLink size={13} />
                <span>Trang chấm bài</span>
              </button>
            )}
            <button
              type="button"
              onClick={onOpenPreviewModal}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 cursor-pointer"
            >
              <Eye size={13} />
              <span>Xem đề</span>
            </button>
            <button
              type="button"
              onClick={onTryWork}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold border border-emerald-200 dark:border-emerald-900 bg-emerald-50/70 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100 cursor-pointer"
            >
              <Play size={13} />
              <span>Làm thử</span>
            </button>
            <button
              type="button"
              onClick={onEditWork}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold border border-blue-200 dark:border-blue-900/60 bg-blue-50/70 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 hover:bg-blue-100 cursor-pointer"
            >
              <Edit3 size={13} />
              <span>Chỉnh sửa</span>
            </button>
            <button
              type="button"
              disabled={changingWork}
              onClick={onToggleVisibility}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-100 cursor-pointer disabled:opacity-50"
            >
              {workHidden ? <Eye size={13} /> : <EyeOff size={13} />}
              <span>{workHidden ? "Hiện bài tập" : "Ẩn bài tập"}</span>
            </button>
            <button
              type="button"
              disabled={changingWork}
              onClick={onDeleteWork}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold border border-rose-200 dark:border-rose-900/60 bg-rose-50/60 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 hover:bg-rose-100 cursor-pointer disabled:opacity-50"
            >
              <Trash2 size={13} />
              <span>Xóa bài tập</span>
            </button>
          </div>
        </div>

        {/* Sub-tab navigation */}
        <div className="flex items-center gap-1.5 flex-wrap">
          {(
            [
              ["gradebook", "Bảng điểm"],
              ["overview", "Tổng quan"],
              ["exam_content", "Đề bài"],
              ["stats", isExam ? "Thông số câu" : "Tiêu chí chấm"],
            ] as const
          ).map(([tabKey, label]) => (
            <button
              key={tabKey}
              type="button"
              onClick={() => onChangeSubTab(tabKey)}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer ${
                subTab === tabKey
                  ? "bg-blue-600 text-white shadow-xs"
                  : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {examError && isExam && (
        <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs font-semibold text-rose-700 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-300">
          {examError}
        </div>
      )}

      {subTab === "gradebook" && (
        <>
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="flex items-center gap-1.5 flex-wrap">
              {(
                [
                  ["ALL", "Tất cả"],
                  ["NOT_STARTED", "Chưa làm"],
                  ["IN_PROGRESS", "Đang làm"],
                  ["SUBMITTED", "Đã nộp"],
                ] as const
              ).map(([filterKey, label]) => (
                <button
                  key={filterKey}
                  type="button"
                  onClick={() => onChangeStatusFilter(filterKey)}
                  className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer ${
                    statusFilter === filterKey
                      ? "bg-blue-600 text-white shadow-xs"
                      : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-2">
              <div className="relative w-48 sm:w-60">
                <input
                  type="text"
                  placeholder="Nhập để tìm kiếm..."
                  value={studentSearch}
                  onChange={(event) => onChangeStudentSearch(event.target.value)}
                  className="w-full pl-3 pr-8 py-1.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-xs text-slate-800 dark:text-slate-200 placeholder:text-slate-400 focus:outline-hidden focus:ring-1 focus:ring-blue-500"
                />
                <Search size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
              </div>

              <button
                type="button"
                onClick={() => {
                  notify("Đang chuẩn bị bảng in điểm học sinh...", "info");
                  if (typeof window !== "undefined") window.print();
                }}
                className="p-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition cursor-pointer"
                title="In bảng điểm"
              >
                <Printer size={15} />
              </button>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 shadow-xs overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead className="bg-slate-50/80 dark:bg-slate-800/60 text-slate-600 dark:text-slate-300 font-bold border-b border-slate-200 dark:border-slate-800">
                <tr>
                  <th className="px-3 py-3 w-12 text-slate-500">#</th>
                  <th className="px-4 py-3 min-w-48">
                    <div className="flex items-center gap-1">
                      <span>Họ và tên</span>
                      <ChevronDown size={13} className="text-slate-400" />
                    </div>
                  </th>
                  <th className="px-4 py-3 text-center min-w-24">Đã làm</th>
                  <th className="px-4 py-3 text-center min-w-28">Trạng thái</th>
                  <th className="px-4 py-3 text-center min-w-24">Điểm</th>
                  <th className="px-4 py-3 text-center min-w-28">Thời lượng</th>
                  <th className="px-4 py-3 text-center min-w-36">Ngày nộp</th>
                  <th className="px-4 py-3 text-right min-w-28">Chi tiết</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {loadingExamData && isExam ? (
                  <tr>
                    <td colSpan={8} className="p-8 text-center text-slate-500">
                      <span className="inline-flex items-center gap-2">
                        <LoaderCircle size={16} className="animate-spin text-blue-600" />
                        <span>Đang tải bảng điểm...</span>
                      </span>
                    </td>
                  </tr>
                ) : filteredRows.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="p-8 text-center text-slate-400">
                      {learners.length === 0
                        ? "Chưa có học sinh nào tham gia lớp học này."
                        : "Không có học sinh nào khớp bộ lọc hiện tại."}
                    </td>
                  </tr>
                ) : (
                  filteredRows.map((row, index) => (
                    <tr key={row.learner.id} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition">
                      <td className="px-3 py-3.5 text-slate-400 font-medium">{index + 1}</td>
                      <td className="px-4 py-3.5 font-bold text-slate-900 dark:text-slate-100">
                        <div className="flex items-center gap-2.5">
                          <div className="size-7 rounded-full bg-slate-300 dark:bg-slate-700 text-slate-700 dark:text-slate-200 font-extrabold text-[11px] grid place-items-center shrink-0">
                            {row.initials}
                          </div>
                          <div className="min-w-0">
                            <span className="block truncate">{row.name}</span>
                            {row.learner.email && (
                              <span className="block text-[11px] font-normal text-slate-500 truncate">
                                {row.learner.email}
                              </span>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3.5 text-center text-slate-600 dark:text-slate-400 font-medium">
                        {row.doneLabel}
                      </td>
                      <td className="px-4 py-3.5 text-center">
                        <span
                          className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-bold ${
                            row.status === "SUBMITTED"
                              ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300"
                              : row.status === "IN_PROGRESS"
                                ? "bg-amber-50 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300"
                                : "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400"
                          }`}
                        >
                          {row.statusLabel}
                        </span>
                      </td>
                      <td className="px-4 py-3.5 text-center font-bold">
                        {typeof row.score === "number" ? (
                          <span className={`px-2 py-0.5 rounded-full text-xs font-bold border ${getScoreColorClass(row.score, maxScore)}`}>
                            {row.score} / {maxScore}
                          </span>
                        ) : (
                          <span className="text-slate-400">--</span>
                        )}
                      </td>
                      <td className="px-4 py-3.5 text-center text-slate-500">{row.durationLabel}</td>
                      <td className="px-4 py-3.5 text-center text-slate-500">
                        {row.submittedAt ? new Date(row.submittedAt).toLocaleString(locale) : "—"}
                      </td>
                      <td className="px-4 py-3.5 text-right">
                        {row.submission ? (
                          <button
                            type="button"
                            onClick={() => openAssignmentReviewPage(row.submission!.id)}
                            className="font-bold text-blue-600 hover:underline cursor-pointer"
                          >
                            Xem bài làm
                          </button>
                        ) : row.attempt && (row.attempt.status === "SUBMITTED" || row.attempt.status === "GRADED") ? (
                          <button
                            type="button"
                            disabled={reviewLoading}
                            onClick={() => void handleOpenAttemptReview(row.attempt!.id)}
                            className="font-bold text-blue-600 hover:underline cursor-pointer disabled:opacity-50"
                          >
                            Xem bài làm
                          </button>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {subTab === "overview" && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-4">
            <p className="text-xs text-slate-500">Đã nộp / Tổng học sinh</p>
            <p className="mt-1 text-2xl font-black text-slate-900 dark:text-slate-100">
              {summary.submittedCount} / {learners.length}
            </p>
          </div>
          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-4">
            <p className="text-xs text-slate-500">Chưa làm</p>
            <p className="mt-1 text-2xl font-black text-amber-600 dark:text-amber-400">
              {summary.notStartedCount}
            </p>
          </div>
          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-4">
            <p className="text-xs text-slate-500">Điểm trung bình</p>
            <p className="mt-1 text-2xl font-black text-blue-600 dark:text-blue-400">
              {summary.avg !== null ? `${summary.avg} / ${maxScore}` : "Chưa có"}
            </p>
          </div>
          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-4">
            <p className="text-xs text-slate-500">Thấp nhất / Cao nhất</p>
            <p className="mt-1 text-2xl font-black text-emerald-600 dark:text-emerald-400">
              {summary.minVal !== null && summary.maxVal !== null ? `${summary.minVal} – ${summary.maxVal}` : "—"}
            </p>
          </div>
        </div>
      )}

      {subTab === "exam_content" && (
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-5 space-y-4">
          {isExam ? (
            loadingExamData ? (
              <p className="text-xs text-slate-500">Đang tải nội dung đề...</p>
            ) : examQuestions.length === 0 ? (
              <p className="text-xs text-slate-500">Chưa có câu hỏi nào trong đề này.</p>
            ) : (
              <ol className="space-y-3">
                {examQuestions.map((question, idx) => (
                  <li key={question.id} className="rounded-xl border border-slate-200 dark:border-slate-800 p-4 space-y-2">
                    <p className="text-xs font-extrabold text-slate-900 dark:text-slate-100">
                      Câu {idx + 1}:
                    </p>
                    <RichText className="text-sm text-slate-800 dark:text-slate-200">{question.content}</RichText>
                    <QuestionImage imageUrl={question.imageUrl} />
                    {question.options.length > 0 && (
                      <ul className="grid gap-1.5 sm:grid-cols-2 text-xs pt-1">
                        {question.options.map((opt, optIdx) => {
                          const isCorrect = question.correctAnswers.includes(opt);
                          return (
                            <li
                              key={`${question.id}-${optIdx}`}
                              className={`rounded-lg border px-3 py-2 ${
                                isCorrect
                                  ? "border-emerald-400 bg-emerald-50/70 font-bold text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-200"
                                  : "border-slate-200 text-slate-700 dark:border-slate-800 dark:text-slate-300"
                              }`}
                            >
                              {opt}
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </li>
                ))}
              </ol>
            )
          ) : (
            <div className="space-y-4">
              <div>
                <h3 className="text-xs font-extrabold uppercase text-slate-500">Đề bài & Hướng dẫn</h3>
                <p className="mt-2 whitespace-pre-wrap text-sm text-slate-800 dark:text-slate-200">
                  {work.assignment.instructions}
                </p>
              </div>
              {work.assignment.sourceMaterial && (
                <div className="rounded-xl border border-sky-200 bg-sky-50 p-4 dark:border-sky-900 dark:bg-sky-950/30 space-y-2">
                  <p className="text-xs font-bold text-slate-800 dark:text-slate-200">
                    Tệp đề đính kèm: {work.assignment.sourceMaterial.name}
                  </p>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => onPreviewMaterial(work.assignment.sourceMaterial!.id)}
                      className="rounded-lg bg-sky-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-sky-700 cursor-pointer"
                    >
                      Xem tệp
                    </button>
                    <button
                      type="button"
                      onClick={() => onDownloadMaterial(work.assignment.sourceMaterial!.id)}
                      className="inline-flex items-center gap-1 rounded-lg border border-sky-300 px-3 py-1.5 text-xs font-bold text-sky-800 hover:bg-sky-100 dark:border-sky-700 dark:text-sky-200 cursor-pointer"
                    >
                      <Download size={13} />
                      <span>Tải tệp về</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {subTab === "stats" && (
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 overflow-x-auto">
          {isExam ? (
            <table className="w-full text-left text-xs border-collapse">
              <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-600 dark:text-slate-300 font-bold border-b border-slate-200 dark:border-slate-800">
                <tr>
                  <th className="px-4 py-3 w-16">Câu</th>
                  <th className="px-4 py-3">Nội dung</th>
                  <th className="px-4 py-3 text-center">Loại</th>
                  <th className="px-4 py-3 text-center">Điểm tối đa</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {examQuestions.map((question, idx) => (
                  <tr key={question.id}>
                    <td className="px-4 py-3 font-bold">#{idx + 1}</td>
                    <td className="px-4 py-3 max-w-lg">
                      <RichText className="line-clamp-2 text-xs [&>p]:my-0">{question.content}</RichText>
                    </td>
                    <td className="px-4 py-3 text-center">{question.type}</td>
                    <td className="px-4 py-3 text-center font-bold">
                      {work.exam.questionScores?.[question.id] ??
                        Math.round((work.exam.totalScore / Math.max(1, examQuestions.length)) * 100) / 100}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <table className="w-full text-left text-xs border-collapse">
              <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-600 dark:text-slate-300 font-bold border-b border-slate-200 dark:border-slate-800">
                <tr>
                  <th className="px-4 py-3">Tiêu chí</th>
                  <th className="px-4 py-3">Mô tả</th>
                  <th className="px-4 py-3 text-center">Điểm tối đa</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {work.assignment.rubric.map((criterion) => (
                  <tr key={criterion.id}>
                    <td className="px-4 py-3 font-bold">{criterion.title}</td>
                    <td className="px-4 py-3 text-slate-500">{criterion.description}</td>
                    <td className="px-4 py-3 text-center font-bold">{criterion.maxPoints}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Modal xem chi tiết lượt làm bài trắc nghiệm của học sinh */}
      {attemptReview && isExam && (
        <div className="fixed inset-0 z-[85] flex items-center justify-center bg-slate-950/65 p-4 backdrop-blur-xs" role="presentation">
          <section role="dialog" aria-modal="true" className="w-full max-w-3xl max-h-[85dvh] overflow-y-auto rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl dark:border-slate-700 dark:bg-slate-900 space-y-4">
            <div className="flex items-start justify-between gap-4 border-b border-slate-100 dark:border-slate-800 pb-3">
              <div>
                <h3 className="text-base font-extrabold text-slate-900 dark:text-slate-100">
                  Bài làm của {attemptReview.learner.name || attemptReview.learner.email || attemptReview.learner.id}
                </h3>
                <p className="text-xs text-slate-500">
                  Điểm: {attemptReview.attempt.score ?? "Chờ chấm"} / {attemptReview.exam.totalScore}
                </p>
              </div>
              <button
                type="button"
                aria-label="Đóng chi tiết lượt thi"
                onClick={() => setAttemptReview(null)}
                className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>
            <div className="space-y-3">
              {attemptReview.questions.map((item, idx) => (
                <div key={item.questionId} className="rounded-xl border border-slate-200 dark:border-slate-800 p-4 space-y-2 text-xs">
                  <div className="flex items-center justify-between font-bold">
                    <span>Câu {idx + 1}</span>
                    <span className="text-blue-600 dark:text-blue-400">
                      {item.awardedScore} / {item.maxScore} điểm
                    </span>
                  </div>
                  <RichText className="text-sm text-slate-800 dark:text-slate-200 [&>p]:my-0">{item.content}</RichText>
                  <div className="flex flex-wrap items-baseline gap-1.5 text-slate-600 dark:text-slate-300">
                    <span className="font-bold shrink-0">Câu trả lời: </span>
                    {item.submittedAnswers.length ? (
                      <RichText className="inline-block [&>p]:my-0">{item.submittedAnswers.join(", ")}</RichText>
                    ) : (
                      <span>Bỏ trống</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>
      )}
    </div>
  );
});
