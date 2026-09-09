"use client";

import { activeLocale } from "@/i18n/runtime";
import {
  CheckCircle2,
  ChevronRight,
  ClipboardCheck,
  Link2,
  MessageCircle,
  RotateCcw,
  Save,
  Scale,
  UserCheck,
  XCircle,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AccessDenied } from "@/components/access-denied";
import { PageHeader } from "@/components/page-header";
import { SearchableSelect } from "@/components/searchable-select";
import {
  Button,
  Field,
  inputClass,
  Modal,
  Pagination,
  RichText,
  StatusBadge,
  usePagination,
} from "@/components/ui";
import { apiRequest } from "@/lib/api-client";
import { hasEveryPermission } from "@/lib/access-control";
import type {
  DirectoryUser,
  Exam,
  ExamAttempt,
  ExamAttemptReview,
  GradingQueueGroup,
  LiveSession,
  RegradeRequest,
} from "@/lib/learning-types";
import { useApp } from "@/providers/app-provider";

/** Gom các thao tác giảng dạy thường ngày: điểm, điểm danh và bản ghi buổi học. */
export default function TeachingOperationsPage() {
  const { session, notify } = useApp();
  const canManageTeaching =
    session.roleCode === "INSTRUCTOR" &&
    hasEveryPermission(session, [
      "question:manage",
      "exam:manage",
      "session:manage",
    ]);
  const [attempts, setAttempts] = useState<ExamAttempt[]>([]);
  const [gradingQueue, setGradingQueue] = useState<GradingQueueGroup[]>([]);
  const [regrades, setRegrades] = useState<RegradeRequest[]>([]);
  const [exams, setExams] = useState<Exam[]>([]);
  const [selectedExamId, setSelectedExamId] = useState("");
  const gradingExams = useMemo(
    () =>
      exams.filter((exam) =>
        attempts.some((attempt) => attempt.examId === exam.id),
      ),
    [attempts, exams],
  );
  const selectedAttempts = useMemo(
    () => attempts.filter((item) => item.examId === selectedExamId),
    [attempts, selectedExamId],
  );
  const queueByClass = useMemo(
    () =>
      gradingQueue.reduce<Record<string, GradingQueueGroup[]>>(
        (groups, item) => {
          (groups[item.classCode] ??= []).push(item);
          return groups;
        },
        {},
      ),
    [gradingQueue],
  );
  const attemptPagination = usePagination(selectedAttempts);
  const [sessions, setSessions] = useState<LiveSession[]>([]);
  const [learners, setLearners] = useState<DirectoryUser[]>([]);
  const [learnersSessionId, setLearnersSessionId] = useState("");
  const [grading, setGrading] = useState<ExamAttempt | null>(null);
  const [activeRegrade, setActiveRegrade] = useState<RegradeRequest | null>(
    null,
  );
  const [regradeResolution, setRegradeResolution] = useState("");
  const [review, setReview] = useState<ExamAttemptReview | null>(null);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [gradeSaving, setGradeSaving] = useState(false);
  const [questionScores, setQuestionScores] = useState<Record<string, number>>(
    {},
  );
  const [grade, setGrade] = useState({
    score: 0,
    feedback: "",
    correctionReason: "",
  });
  const [attendance, setAttendance] = useState({
    sessionId: "",
    learnerId: "",
    status: "PRESENT",
    attendedMinutes: 60,
    adjustmentReason: "Xác nhận theo nhật ký phòng học",
  });
  const [recording, setRecording] = useState({
    sessionId: "",
    recordingUrl: "",
  });
  /** Nạp lớp, bài nộp và buổi học thuộc phạm vi giảng viên hiện tại. */
  const load = useCallback(async () => {
    if (!canManageTeaching) return;
    try {
      const [attemptData, examData, sessionData, regradeData, queueData] =
        await Promise.all([
          apiRequest<ExamAttempt[]>("/instructor/exam-attempts", {
            roleCode: session.roleCode,
          }),
          apiRequest<Exam[]>("/exams", { roleCode: session.roleCode }),
          apiRequest<LiveSession[]>("/sessions", {
            roleCode: session.roleCode,
          }),
          apiRequest<RegradeRequest[]>("/instructor/regrade-requests", {
            roleCode: session.roleCode,
          }),
          apiRequest<GradingQueueGroup[]>("/instructor/grading-queue", {
            roleCode: session.roleCode,
          }),
        ]);
      setAttempts(attemptData);
      setRegrades(
        regradeData.filter(
          (item) => item.status === "OPEN" || item.status === "IN_REVIEW",
        ),
      );
      setExams(examData);
      setGradingQueue(queueData);
      setSelectedExamId(
        (current) => current || attemptData[0]?.examId || examData[0]?.id || "",
      );
      setSessions(sessionData);
      setAttendance((current) => ({
        ...current,
        sessionId: current.sessionId || sessionData[0]?.id || "",
      }));
      setRecording((current) => ({
        ...current,
        sessionId:
          current.sessionId ||
          sessionData.find((item) => item.status === "COMPLETED")?.id ||
          "",
      }));
    } catch (error) {
      notify(
        error instanceof Error
          ? error.message
          : "Không tải được nghiệp vụ giảng dạy.",
        "error",
      );
    }
  }, [canManageTeaching, notify, session.roleCode]);

  /** Chọn buổi học và nạp bảng điểm danh chi tiết để chỉnh sửa. */
  const selectAttendanceSession = useCallback(
    async (sessionId: string) => {
      setAttendance((current) => ({ ...current, sessionId, learnerId: "" }));
      const classId = sessions.find((item) => item.id === sessionId)?.classId;
      if (!classId) {
        setLearners([]);
        setLearnersSessionId(sessionId);
        return;
      }
      try {
        setLearners(
          await apiRequest<DirectoryUser[]>(
            `/instructor/classes/${classId}/learners`,
            { roleCode: session.roleCode },
          ),
        );
        setLearnersSessionId(sessionId);
      } catch (error) {
        setLearners([]);
        setLearnersSessionId(sessionId);
        notify(
          error instanceof Error
            ? error.message
            : "Không tải được học viên của lớp.",
          "error",
        );
      }
    },
    [notify, session.roleCode, sessions],
  );
  useEffect(() => {
    if (
      !attendance.sessionId ||
      !sessions.length ||
      learnersSessionId === attendance.sessionId
    )
      return;
    const timer = window.setTimeout(
      () => void selectAttendanceSession(attendance.sessionId),
      0,
    );
    return () => window.clearTimeout(timer);
  }, [
    attendance.sessionId,
    learnersSessionId,
    selectAttendanceSession,
    sessions.length,
  ]);
  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);
  /** Mở toàn bộ đề và đáp án của một lượt thi trước khi cho điểm. */
  const openGrade = async (
    item: ExamAttempt,
    regrade: RegradeRequest | null = null,
  ) => {
    setGrading(item);
    setActiveRegrade(regrade);
    setRegradeResolution("");
    setReview(null);
    setReviewLoading(true);
    try {
      const detail = await apiRequest<ExamAttemptReview>(
        `/instructor/exam-attempts/${item.id}/review`,
        { roleCode: session.roleCode },
      );
      setReview(detail);
      setQuestionScores(
        Object.fromEntries(
          detail.questions
            .filter((question) => question.requiresManualGrade)
            .map((question) => [question.questionId, question.awardedScore]),
        ),
      );
      setGrade({
        score: detail.attempt.score ?? 0,
        feedback: detail.attempt.feedback ?? "",
        correctionReason: "",
      });
    } catch (error) {
      setGrading(null);
      notify(
        error instanceof Error ? error.message : "Không mở được bài làm.",
        "error",
      );
    } finally {
      setReviewLoading(false);
    }
  };
  /** Nhận yêu cầu phúc khảo rồi mở đúng bài làm để người chấm ra quyết định. */
  const openRegrade = async (request: RegradeRequest) => {
    try {
      const claimed =
        request.status === "OPEN"
          ? await apiRequest<RegradeRequest>(
              `/instructor/regrade-requests/${request.id}/claim`,
              { method: "POST", roleCode: session.roleCode },
            )
          : request;
      if (claimed.assignedToId && claimed.assignedToId !== session.user.id) {
        notify("Yêu cầu này đang được giảng viên khác xử lý.", "error");
        await load();
        return;
      }
      const item = attempts.find((attempt) => attempt.id === request.attemptId);
      if (!item) {
        notify("Không tìm thấy bài làm thuộc yêu cầu phúc khảo.", "error");
        return;
      }
      await openGrade(item, claimed);
      await load();
    } catch (error) {
      notify(
        error instanceof Error
          ? error.message
          : "Không nhận được yêu cầu phúc khảo.",
        "error",
      );
    }
  };
  /** Lưu điểm từng câu tự luận, tổng điểm và phản hồi cho bài làm đang mở. */
  const saveGrade = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!grading || !review) return;
    const manualScores = review.questions
      .filter((question) => question.requiresManualGrade)
      .map((question) => ({
        questionId: question.questionId,
        score: questionScores[question.questionId] ?? 0,
      }));
    const objectiveScore = review.questions
      .filter((question) => !question.requiresManualGrade)
      .reduce((total, question) => total + question.awardedScore, 0);
    const totalScore =
      objectiveScore +
      manualScores.reduce((total, item) => total + item.score, 0);
    setGradeSaving(true);
    try {
      if (activeRegrade) {
        await apiRequest(
          `/instructor/regrade-requests/${activeRegrade.id}/resolve`,
          {
            method: "PATCH",
            roleCode: session.roleCode,
            body: JSON.stringify({
              decision: "APPROVE",
              resolution: regradeResolution,
              score: totalScore,
              feedback: grade.feedback,
              questionScores: manualScores,
            }),
          },
        );
        notify(
          "Đã chấp nhận phúc khảo, công bố điểm mới và thông báo học viên.",
        );
      } else {
        await apiRequest(`/instructor/exam-attempts/${grading.id}/grade`, {
          method: "PATCH",
          roleCode: session.roleCode,
          body: JSON.stringify({
            ...grade,
            score: totalScore,
            questionScores: manualScores,
          }),
        });
        notify("Đã lưu điểm và phản hồi.");
      }
      setGrading(null);
      setActiveRegrade(null);
      setReview(null);
      setQuestionScores({});
      setRegradeResolution("");
      await load();
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "Không lưu được điểm.",
        "error",
      );
    } finally {
      setGradeSaving(false);
    }
  };
  /** Từ chối phúc khảo, giữ nguyên điểm hiện tại và gửi lý do cho học viên. */
  const rejectRegrade = async () => {
    if (!activeRegrade || regradeResolution.trim().length < 5) return;
    setGradeSaving(true);
    try {
      await apiRequest(
        `/instructor/regrade-requests/${activeRegrade.id}/resolve`,
        {
          method: "PATCH",
          roleCode: session.roleCode,
          body: JSON.stringify({
            decision: "REJECT",
            resolution: regradeResolution,
          }),
        },
      );
      notify("Đã từ chối phúc khảo và thông báo lý do cho học viên.");
      setGrading(null);
      setActiveRegrade(null);
      setReview(null);
      setRegradeResolution("");
      await load();
    } catch (error) {
      notify(
        error instanceof Error
          ? error.message
          : "Không kết thúc được yêu cầu phúc khảo.",
        "error",
      );
    } finally {
      setGradeSaving(false);
    }
  };
  /** Gửi các thay đổi điểm danh thủ công cùng lý do điều chỉnh. */
  const saveAttendance = async (event: React.FormEvent) => {
    event.preventDefault();
    try {
      await apiRequest(
        `/instructor/sessions/${attendance.sessionId}/attendance`,
        {
          method: "PATCH",
          roleCode: session.roleCode,
          body: JSON.stringify({
            learnerId: attendance.learnerId,
            status: attendance.status,
            attendedMinutes: attendance.attendedMinutes,
            adjustmentReason: attendance.adjustmentReason,
          }),
        },
      );
      notify("Đã cập nhật điểm danh và lý do điều chỉnh.");
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "Không lưu được điểm danh.",
        "error",
      );
    }
  };
  /** Gắn đường dẫn bản ghi với buổi học đã kết thúc để đưa vào xử lý. */
  const attachRecording = async (event: React.FormEvent) => {
    event.preventDefault();
    try {
      await apiRequest(
        `/instructor/sessions/${recording.sessionId}/recordings`,
        {
          method: "POST",
          roleCode: session.roleCode,
          body: JSON.stringify({ recordingUrl: recording.recordingUrl }),
        },
      );
      notify("Đã tiếp nhận bản ghi và chuyển sang trạng thái đang xử lý.");
      setRecording({ ...recording, recordingUrl: "" });
      await load();
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "Không gắn được bản ghi.",
        "error",
      );
    }
  };
  /** Xác nhận bản ghi đã sẵn sàng cho người có quyền xem. */
  const markRecordingReady = async () => {
    if (!recording.sessionId) return;
    try {
      await apiRequest(
        `/instructor/sessions/${recording.sessionId}/recordings/status`,
        {
          method: "PATCH",
          roleCode: session.roleCode,
          body: JSON.stringify({ status: "READY", retentionDays: 90 }),
        },
      );
      notify("Bản ghi đã sẵn sàng và được phát hành trong 90 ngày.");
      await load();
    } catch (error) {
      notify(
        error instanceof Error
          ? error.message
          : "Không phát hành được bản ghi.",
        "error",
      );
    }
  };
  const objectiveScore =
    review?.questions
      .filter((question) => !question.requiresManualGrade)
      .reduce((total, question) => total + question.awardedScore, 0) ?? 0;
  const manualScore =
    review?.questions
      .filter((question) => question.requiresManualGrade)
      .reduce(
        (total, question) => total + (questionScores[question.questionId] ?? 0),
        0,
      ) ?? 0;
  if (!canManageTeaching) return <AccessDenied />;
  return (
    <div className="mx-auto max-w-7xl px-5 py-8 md:px-8 md:py-10">
      <PageHeader
        eyebrow="Instructor Workspace"
        title="Chấm bài & buổi học"
        description="Một hàng đợi theo lớp cho cả bài tập và bài thi; mở bài làm cùng rubric hoặc đáp án trước khi cho điểm."
      />
      <section className="mb-7 border-y border-[var(--rule-strong)] bg-[var(--surface)]/65 p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="font-heading text-xl font-extrabold">
              Hàng đợi chấm chung
            </h2>
            <p className="mt-1 text-sm text-[var(--ink-soft)]">
              Lớp → bài → bài nộp; số chờ chấm được tính cho cả hai loại.
            </p>
          </div>
          <span className="text-sm font-extrabold tabular-nums text-[var(--accent-ink)]">
            {gradingQueue.reduce((sum, item) => sum + item.pendingCount, 0)} chờ
            chấm
          </span>
        </div>
        {Object.keys(queueByClass).length ? (
          <div className="mt-5 grid gap-5 lg:grid-cols-2">
            {Object.entries(queueByClass).map(([classCode, groups]) => (
              <div className="border-y border-[var(--rule)]" key={classCode}>
                <h3 className="py-3 text-xs font-extrabold uppercase tracking-[.12em] text-[var(--ink-muted)]">
                  {classCode}
                </h3>
                <div className="divide-y divide-[var(--rule)]">
                  {groups.map((group) =>
                    group.type === "ASSIGNMENT" ? (
                      <Link
                        className="flex min-h-16 items-center justify-between gap-4 py-3 hover:text-[var(--accent-ink)]"
                        href={`/academic?classId=${encodeURIComponent(group.classId)}&assignmentId=${encodeURIComponent(group.id)}`}
                        key={`${group.type}-${group.id}`}
                      >
                        <span>
                          <strong className="block text-sm">
                            {group.title}
                          </strong>
                          <small className="mt-1 block text-[var(--ink-muted)]">
                            Bài tập · {group.submittedCount} bài nộp
                          </small>
                        </span>
                        <span className="shrink-0 text-xs font-bold">
                          {group.pendingCount} chờ{" "}
                          <ChevronRight className="ml-1 inline" size={14} />
                        </span>
                      </Link>
                    ) : (
                      <button
                        className="flex min-h-16 w-full items-center justify-between gap-4 py-3 text-left hover:text-[var(--accent-ink)]"
                        key={`${group.type}-${group.id}`}
                        onClick={() => {
                          setSelectedExamId(group.id);
                          document
                            .getElementById("exam-grading-detail")
                            ?.scrollIntoView({
                              behavior: "smooth",
                              block: "start",
                            });
                        }}
                        type="button"
                      >
                        <span>
                          <strong className="block text-sm">
                            {group.title}
                          </strong>
                          <small className="mt-1 block text-[var(--ink-muted)]">
                            Bài thi · {group.submittedCount} bài nộp
                          </small>
                        </span>
                        <span className="shrink-0 text-xs font-bold">
                          {group.pendingCount} chờ{" "}
                          <ChevronRight className="ml-1 inline" size={14} />
                        </span>
                      </button>
                    ),
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="py-8 text-center text-sm text-[var(--ink-muted)]">
            Chưa có bài nộp trong phạm vi giảng dạy.
          </p>
        )}
      </section>
      <div className="grid gap-7 xl:grid-cols-[1.1fr_.9fr]">
        <section
          className="scroll-mt-24 border-y border-[var(--rule-strong)] bg-[var(--surface)]/65 p-6"
          id="exam-grading-detail"
        >
          <div className="flex items-start gap-3">
            <ClipboardCheck className="mt-0.5 text-[var(--accent)]" />
            <div>
              <h2 className="font-heading text-xl font-extrabold">
                Bài thi đã nộp
              </h2>
              <p className="mt-1 text-sm text-[var(--ink-soft)]">
                Bài làm được nhóm theo đề thi, không trộn học viên của nhiều đề.
              </p>
            </div>
          </div>
          {gradingExams.length ? (
            <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(12rem,.72fr)_minmax(0,1.28fr)]">
              <nav
                aria-label="Chọn đề thi để chấm"
                className="divide-y divide-[var(--rule)] border-y border-[var(--rule)]"
              >
                {gradingExams.map((exam) => {
                  const examAttempts = attempts.filter(
                    (item) => item.examId === exam.id,
                  );
                  const pending = examAttempts.filter(
                    (item) => item.status === "SUBMITTED",
                  ).length;
                  return (
                    <button
                      aria-pressed={selectedExamId === exam.id}
                      className={`flex w-full items-center justify-between gap-3 px-3 py-4 text-left ${selectedExamId === exam.id ? "bg-[var(--accent-soft)] text-[var(--accent-ink)]" : "hover:bg-[var(--surface-muted)]"}`}
                      key={exam.id}
                      onClick={() => {
                        setSelectedExamId(exam.id);
                        attemptPagination.resetPage();
                      }}
                      type="button"
                    >
                      <span>
                        <strong className="block text-sm">{exam.title}</strong>
                        <small className="mt-1 block text-[var(--ink-soft)]">
                          {examAttempts.length} bài nộp · {pending} chờ chấm
                        </small>
                      </span>
                      <ChevronRight size={16} />
                    </button>
                  );
                })}
              </nav>
              <div>
                <div className="divide-y divide-[var(--rule)] border-y border-[var(--rule)]">
                  {attemptPagination.pageItems.map((item) => (
                    <article
                      className="flex flex-wrap items-center justify-between gap-4 py-4"
                      key={item.id}
                    >
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-sm font-extrabold">
                            {item.learnerId}
                          </p>
                          <StatusBadge status={item.status} />
                        </div>
                        <p className="mt-1 text-xs text-[var(--ink-soft)]">
                          Nộp{" "}
                          {item.submittedAt
                            ? new Date(item.submittedAt).toLocaleString(activeLocale())
                            : "chưa hoàn tất"}{" "}
                          · {Object.keys(item.answers).length} câu trả lời ·{" "}
                          {item.score === undefined
                            ? "Chưa có điểm"
                            : item.status === "GRADED"
                              ? `${item.score} điểm`
                              : `${item.score} điểm tự động tạm tính`}
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Link
                          className="inline-flex min-h-10 items-center rounded-lg px-3 text-sm font-bold text-[var(--accent-deep)] hover:bg-[var(--accent-soft)]"
                          href={`/messages?userId=${encodeURIComponent(item.learnerId)}&contextType=EXAM&contextId=${encodeURIComponent(item.examId)}&contextTitle=${encodeURIComponent(exams.find((exam) => exam.id === item.examId)?.title ?? "Đề thi")}`}
                        >
                          <MessageCircle className="mr-1.5" size={15} />
                          Nhắn học viên
                        </Link>
                        <Button
                          disabled={
                            item.status === "IN_PROGRESS" || reviewLoading
                          }
                          onClick={() => void openGrade(item)}
                          variant="secondary"
                        >
                          {item.status === "GRADED"
                            ? "Xem & sửa điểm"
                            : "Xem bài & chấm"}
                        </Button>
                      </div>
                    </article>
                  ))}
                  {!selectedAttempts.length ? (
                    <p className="py-10 text-center text-sm text-[var(--ink-muted)]">
                      Đề thi này chưa có bài nộp.
                    </p>
                  ) : null}
                </div>
                <Pagination
                  itemLabel="bài thi"
                  onPageChange={attemptPagination.setPage}
                  onPageSizeChange={attemptPagination.setPageSize}
                  page={attemptPagination.page}
                  pageSize={attemptPagination.pageSize}
                  totalItems={attemptPagination.totalItems}
                />
              </div>
            </div>
          ) : (
            <p className="py-12 text-center text-sm text-[var(--ink-muted)]">
              Chưa có bài thi nào được học viên nộp.
            </p>
          )}
          <div className="mt-8 border-t border-[var(--rule-strong)] pt-6">
            <div className="flex items-start gap-3">
              <Scale className="mt-0.5 text-[var(--accent)]" />
              <div>
                <h2 className="font-heading text-xl font-extrabold">
                  Phúc khảo cần xử lý
                </h2>
                <p className="mt-1 text-sm text-[var(--ink-soft)]">
                  Nhận yêu cầu, mở lại đúng bài làm và trả kết quả cho học viên
                  trong cùng luồng chấm.
                </p>
              </div>
            </div>
            {regrades.length ? (
              <div className="mt-4 divide-y divide-[var(--rule)] border-y border-[var(--rule)]">
                {regrades.map((request) => {
                  const item = attempts.find(
                    (attempt) => attempt.id === request.attemptId,
                  );
                  const exam = exams.find(
                    (candidate) => candidate.id === item?.examId,
                  );
                  return (
                    <article
                      className="flex flex-wrap items-center justify-between gap-4 py-4"
                      key={request.id}
                    >
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <strong className="truncate text-sm">
                            {exam?.title ?? request.attemptId}
                          </strong>
                          <StatusBadge status={request.status} />
                        </div>
                        <p className="mt-1 line-clamp-2 text-xs leading-5 text-[var(--ink-soft)]">
                          {request.reason}
                        </p>
                        <p className="mt-1 text-xs text-[var(--ink-muted)]">
                          Học viên {request.learnerId} ·{" "}
                          {new Date(request.createdAt).toLocaleString(activeLocale())}
                        </p>
                      </div>
                      {["OPEN", "IN_REVIEW"].includes(request.status) ? (
                        <Button
                          disabled={Boolean(
                            request.assignedToId &&
                              request.assignedToId !== session.user.id,
                          )}
                          onClick={() => void openRegrade(request)}
                          variant="secondary"
                        >
                          <RotateCcw size={15} />
                          {request.status === "OPEN"
                            ? "Nhận & xem bài"
                            : "Tiếp tục xử lý"}
                        </Button>
                      ) : null}
                    </article>
                  );
                })}
              </div>
            ) : (
              <p className="mt-4 border-y border-[var(--rule)] py-8 text-center text-sm text-[var(--ink-muted)]">
                Không có yêu cầu phúc khảo đang mở.
              </p>
            )}
          </div>
        </section>
        <div className="space-y-7">
          <section className="border-y border-[var(--rule-strong)] bg-[var(--surface)]/65 p-6">
            <div className="flex items-center gap-3">
              <UserCheck className="text-sky-700" />
              <h2 className="font-heading text-xl font-extrabold">
                Điều chỉnh điểm danh
              </h2>
            </div>
            <form
              className="mt-5 space-y-4"
              onSubmit={(e) => void saveAttendance(e)}
            >
              <Field label="Buổi học">
                <SearchableSelect
                  aria-label="Tìm và chọn buổi học"
                  onChange={(value) => void selectAttendanceSession(value)}
                  options={sessions.map((item) => ({
                    value: item.id,
                    label: item.title,
                    description: new Date(item.startsAt).toLocaleString(
                      "vi-VN",
                    ),
                  }))}
                  placeholder="Gõ tên buổi học để lọc…"
                  value={attendance.sessionId}
                />
              </Field>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Học viên">
                  <SearchableSelect
                    aria-label="Tìm và chọn học viên"
                    disabled={!attendance.sessionId}
                    emptyMessage="Lớp chưa có học viên đang ghi danh."
                    onChange={(value) =>
                      setAttendance({ ...attendance, learnerId: value })
                    }
                    options={learners.map((item) => ({
                      value: item.id,
                      label: item.displayName,
                      description: item.email,
                      keywords: item.id,
                    }))}
                    placeholder={
                      attendance.sessionId
                        ? "Gõ tên hoặc email học viên…"
                        : "Chọn buổi học trước"
                    }
                    value={attendance.learnerId}
                  />
                </Field>
                <Field label="Trạng thái">
                  <select
                    className={inputClass}
                    value={attendance.status}
                    onChange={(e) =>
                      setAttendance({ ...attendance, status: e.target.value })
                    }
                  >
                    <option value="PRESENT">Có mặt</option>
                    <option value="LATE">Đi muộn</option>
                    <option value="ABSENT">Vắng</option>
                    <option value="EXCUSED">Có phép</option>
                  </select>
                </Field>
              </div>
              <Field label="Số phút tham dự">
                <input
                  className={inputClass}
                  min={0}
                  type="number"
                  value={attendance.attendedMinutes}
                  onChange={(e) =>
                    setAttendance({
                      ...attendance,
                      attendedMinutes: Number(e.target.value),
                    })
                  }
                />
              </Field>
              <Field label="Lý do điều chỉnh">
                <input
                  className={inputClass}
                  minLength={3}
                  required
                  value={attendance.adjustmentReason}
                  onChange={(e) =>
                    setAttendance({
                      ...attendance,
                      adjustmentReason: e.target.value,
                    })
                  }
                />
              </Field>
              <Button
                disabled={!attendance.sessionId || !attendance.learnerId}
                type="submit"
              >
                <Save size={16} />
                Lưu điểm danh
              </Button>
            </form>
          </section>
          <section className="border-y border-[var(--rule-strong)] bg-[var(--surface)]/65 p-6">
            <div className="flex items-center gap-3">
              <Link2 className="text-sky-700" />
              <h2 className="font-heading text-xl font-extrabold">
                Bản ghi buổi học
              </h2>
            </div>
            <form
              className="mt-5 space-y-4"
              onSubmit={(e) => void attachRecording(e)}
            >
              <Field label="Buổi đã kết thúc">
                <SearchableSelect
                  aria-label="Tìm và chọn buổi học đã kết thúc"
                  onChange={(value) =>
                    setRecording({ ...recording, sessionId: value })
                  }
                  options={sessions
                    .filter((item) => item.status === "COMPLETED")
                    .map((item) => ({
                      value: item.id,
                      label: item.title,
                      description: new Date(item.startsAt).toLocaleString(
                        "vi-VN",
                      ),
                    }))}
                  placeholder="Gõ tên buổi học để lọc…"
                  value={recording.sessionId}
                />
              </Field>
              <Field label="URL bản ghi">
                <input
                  className={inputClass}
                  required
                  type="url"
                  value={recording.recordingUrl}
                  onChange={(e) =>
                    setRecording({ ...recording, recordingUrl: e.target.value })
                  }
                />
              </Field>
              <Button type="submit">Gắn bản ghi</Button>
            </form>
            {sessions.find((item) => item.id === recording.sessionId)
              ?.recordingStatus === "PROCESSING" ? (
              <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4">
                <p className="text-sm font-bold text-amber-900">
                  Bản ghi đang xử lý và chưa hiển thị cho học viên.
                </p>
                <Button
                  className="mt-3"
                  onClick={() => void markRecordingReady()}
                  variant="secondary"
                >
                  <CheckCircle2 size={16} /> Xác nhận sẵn sàng
                </Button>
              </div>
            ) : null}
            {sessions.find((item) => item.id === recording.sessionId)
              ?.recordingStatus === "READY" ? (
              <p className="mt-4 text-sm font-bold text-emerald-700">
                Bản ghi sẵn sàng đến{" "}
                {new Date(
                  sessions.find((item) => item.id === recording.sessionId)
                    ?.recordingExpiresAt ?? "",
                ).toLocaleDateString(activeLocale())}
                .
              </p>
            ) : null}
          </section>
        </div>
      </div>
      <Modal
        open={Boolean(grading)}
        onClose={() => {
          if (!gradeSaving) {
            setGrading(null);
            setActiveRegrade(null);
            setReview(null);
            setRegradeResolution("");
          }
        }}
        title={
          review
            ? `${activeRegrade ? "Phúc khảo" : "Chấm bài"} · ${review.exam.title}`
            : "Đang mở bài làm"
        }
        description={
          review
            ? `${review.learner.name ?? review.learner.id}${review.learner.email ? ` · ${review.learner.email}` : ""}${activeRegrade ? ` · Yêu cầu: ${activeRegrade.reason}` : ""}`
            : "Đang tải đề thi và câu trả lời của học viên."
        }
        size="xl"
      >
        {reviewLoading || !review ? (
          <p className="py-12 text-center text-sm font-semibold text-[var(--ink-soft)]">
            Đang tải bài làm…
          </p>
        ) : (
          <form
            className="grid gap-6 lg:grid-cols-[minmax(0,1.35fr)_minmax(18rem,.65fr)]"
            onSubmit={(e) => void saveGrade(e)}
          >
            <div className="divide-y divide-[var(--rule)] border-y border-[var(--rule-strong)]">
              {review.questions.map((question, index) => (
                <section className="py-5" key={question.questionId}>
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-xs font-bold text-[var(--ink-muted)]">
                        Câu {index + 1} ·{" "}
                        {question.requiresManualGrade
                          ? "Chấm thủ công"
                          : "Đã chấm tự động"}
                      </p>
                      <RichText className="mt-2 font-semibold">
                        {question.content}
                      </RichText>
                    </div>
                    <span className="shrink-0 text-sm font-bold tabular-nums">
                      /{question.maxScore}
                    </span>
                  </div>
                  <div className="mt-3 bg-[var(--surface-muted)] px-4 py-3">
                    <p className="text-xs font-bold text-[var(--ink-muted)]">
                      Bài làm của học viên
                    </p>
                    {question.submittedAnswers.length ? (
                      question.submittedAnswers.map((answer, answerIndex) => (
                        <RichText
                          className="mt-1 whitespace-pre-wrap text-sm"
                          key={`${question.questionId}-${answerIndex}`}
                        >
                          {answer}
                        </RichText>
                      ))
                    ) : (
                      <p className="mt-1 text-sm italic text-[var(--ink-soft)]">
                        Không có câu trả lời.
                      </p>
                    )}
                  </div>
                  {question.requiresManualGrade ? (
                    <Field label={`Điểm câu ${index + 1}`}>
                      <input
                        className={`${inputClass} mt-3`}
                        max={question.maxScore}
                        min={0}
                        onChange={(event) =>
                          setQuestionScores({
                            ...questionScores,
                            [question.questionId]: Number(event.target.value),
                          })
                        }
                        required
                        step="0.25"
                        type="number"
                        value={questionScores[question.questionId] ?? 0}
                      />
                    </Field>
                  ) : (
                    <p className="mt-3 text-sm font-bold text-[var(--success-deep)]">
                      Điểm tự động: {question.awardedScore}/{question.maxScore}
                    </p>
                  )}
                </section>
              ))}
            </div>
            <aside className="space-y-4 lg:sticky lg:top-0 lg:self-start">
              <div className="border-y border-[var(--rule-strong)] py-4">
                <p className="text-sm text-[var(--ink-soft)]">
                  Tổng điểm hiện tại
                </p>
                <p className="mt-1 text-3xl font-extrabold tabular-nums text-[var(--ink)]">
                  {objectiveScore + manualScore}
                  <span className="text-base font-semibold text-[var(--ink-soft)]">
                    /{review.exam.totalScore}
                  </span>
                </p>
                <p className="mt-2 text-xs text-[var(--ink-muted)]">
                  Tự động {objectiveScore} · Tự luận {manualScore}
                </p>
              </div>
              <Field label="Phản hồi">
                <textarea
                  className={inputClass}
                  minLength={3}
                  required
                  rows={4}
                  value={grade.feedback}
                  onChange={(e) =>
                    setGrade({ ...grade, feedback: e.target.value })
                  }
                />
              </Field>
              {activeRegrade ? (
                <Field label="Kết luận phúc khảo">
                  <textarea
                    className={inputClass}
                    maxLength={1000}
                    minLength={5}
                    required
                    rows={4}
                    value={regradeResolution}
                    onChange={(event) =>
                      setRegradeResolution(event.target.value)
                    }
                  />
                </Field>
              ) : null}
              {!activeRegrade && grading?.status === "GRADED" ? (
                <Field label="Lý do sửa điểm">
                  <textarea
                    className={inputClass}
                    minLength={5}
                    required
                    rows={3}
                    value={grade.correctionReason}
                    onChange={(event) =>
                      setGrade({
                        ...grade,
                        correctionReason: event.target.value,
                      })
                    }
                  />
                </Field>
              ) : null}
              <Button className="w-full" loading={gradeSaving} type="submit">
                <CheckCircle2 size={16} />
                {activeRegrade ? "Chấp nhận & công bố điểm" : "Công bố kết quả"}
              </Button>
              {activeRegrade ? (
                <Button
                  className="w-full"
                  disabled={gradeSaving || regradeResolution.trim().length < 5}
                  onClick={() => void rejectRegrade()}
                  type="button"
                  variant="secondary"
                >
                  <XCircle size={16} />
                  Từ chối, giữ nguyên điểm
                </Button>
              ) : null}
            </aside>
          </form>
        )}
      </Modal>
    </div>
  );
}
