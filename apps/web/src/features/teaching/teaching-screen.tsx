"use client";
import { AccessDenied } from "@/components/access-denied";
import { PageHeader } from "@/components/page-header";
import { SearchableSelect } from "@/components/searchable-select";
import {
  Button,
  Field,
  inputClass,
  Pagination,
  StatusBadge,
} from "@/components/ui";
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
} from "lucide-react";
import Link from "next/link";

import { ExamGradingDialog } from "./exam-grading-dialog";
import { useTeachingModel } from "./use-teaching-model";

/** Lắp ghép màn hình chấm thi từ trạng thái, hành động và các thành phần nghiệp vụ. */
export default function TeachingScreen() {
  const model = useTeachingModel();
  const {
    session,
    canManageTeaching,
    attempts,
    gradingQueue,
    regrades,
    exams,
    selectedExamId,
    setSelectedExamId,
    gradingExams,
    selectedAttempts,
    queueByClass,
    attemptPagination,
    sessions,
    learners,
    reviewLoading,
    attendance,
    setAttendance,
    recording,
    setRecording,
    selectAttendanceSession,
    openGrade,
    openRegrade,
    saveAttendance,
    attachRecording,
    markRecordingReady,
  } = model;

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
                            ? new Date(item.submittedAt).toLocaleString(
                                activeLocale(),
                              )
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
                          {new Date(request.createdAt).toLocaleString(
                            activeLocale(),
                          )}
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
      <ExamGradingDialog model={model} />
    </div>
  );
}
