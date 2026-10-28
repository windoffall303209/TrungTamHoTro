"use client";
import { AccessDenied } from "@/components/access-denied";
import { PageHeader } from "@/components/page-header";
import { RequestError } from "@/components/request-error";
import { SearchableSelect } from "@/components/searchable-select";
import {
  Button,
  Field,
  inputClass,
  Modal,
  Pagination,
  StatusBadge,
} from "@/components/ui";
import { activeLocale } from "@/i18n/runtime";
import {
  BookOpenCheck,
  CalendarDays,
  CheckCircle2,
  ClipboardPenLine,
  History,
  Megaphone,
  MessageCircle,
  Paperclip,
  Pencil,
  Plus,
  Send,
  UsersRound,
} from "lucide-react";
import Link from "next/link";
import { emptyAssignment } from "./academic.shared";
import { AssignmentEditorDialog } from "./assignment-editor-dialog";
import { AssignmentGradingDialog } from "./assignment-grading-dialog";
import { AssignmentSubmissionDialog } from "./assignment-submission-dialog";
import { useAcademicModel } from "./use-academic-model";

/** Lắp ghép màn hình học vụ từ trạng thái, hành động và các thành phần nghiệp vụ. */
export default function AcademicScreen() {
  const model = useAcademicModel();
  const {
    dataReady,
    session,
    classes,
    announcements,
    gradebook,
    selectedClassId,
    setAssignmentForm,
    announcementForm,
    setAnnouncementForm,
    setCreatingAssignment,
    setEditingAssignment,
    lifecycleAssignment,
    setLifecycleAssignment,
    lifecycleMode,
    lifecycleDueAt,
    setLifecycleDueAt,
    lifecycleMinDueAt,
    lifecycleReason,
    setLifecycleReason,
    assignmentHistory,
    setAssignmentHistory,
    creatingAnnouncement,
    setCreatingAnnouncement,
    setSubmitting,
    setSubmissionContent,
    setSubmissionFiles,
    setSubmissionError,
    reviewing,
    setReviewing,
    grading,
    setGrading,
    setRubricScores,
    setFeedback,
    setCorrectionReason,
    allowed,
    canTeach,
    changeClass,
    editAssignment,
    openLifecycle,
    applyLifecycle,
    openAssignmentHistory,
    publish,
    openAttachment,
    openSubmissions,
    createAnnouncement,
    filteredAssignments,
    upcomingEvents,
    assignmentPagination,
    gradebookPagination,
    submissionPagination,
  } = model;

  if (!allowed) return <AccessDenied />;
  return (
    <div className="workspace-enter mx-auto max-w-7xl px-4 py-8 md:px-7 md:py-10">
      <RequestError message={model.loadError} retry={() => void model.reload()} />
      <PageHeader
        title="Bài tập & kết quả học tập"
        description={
          canTeach
            ? "Tạo bài tập, mở danh sách bài nộp theo từng bài và chấm bằng rubric trong cùng một luồng."
            : "Theo dõi bài tập, nộp bài và xem điểm đã được giảng viên công bố."
        }
        actions={
          canTeach ? (
            <div className="flex flex-wrap gap-2">
              <Button
                onClick={() => setCreatingAnnouncement(true)}
                variant="secondary"
              >
                <Megaphone size={16} />
                Thông báo lớp
              </Button>
              <Button
                onClick={() => {
                  setEditingAssignment(null);
                  setAssignmentForm({
                    ...emptyAssignment,
                    classId: selectedClassId || classes[0]?.id || "",
                  });
                  setCreatingAssignment(true);
                }}
              >
                <Plus size={16} />
                Tạo bài tập
              </Button>
            </div>
          ) : undefined
        }
      />
      <div className="mb-7 max-w-md">
        <Field label="Lớp đang xem">
          <SearchableSelect
            aria-label="Tìm và chọn lớp đang xem"
            onChange={(value) => void changeClass(value)}
            options={classes.map((item) => ({
              value: item.id,
              label: `${item.code} — ${item.name}`,
              description: item.term,
              keywords: item.id,
            }))}
            placeholder="Gõ mã hoặc tên lớp để lọc…"
            value={selectedClassId}
          />
        </Field>
      </div>

      <div className="grid gap-7 xl:grid-cols-[minmax(0,1.15fr)_minmax(20rem,.85fr)]">
        <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-6 shadow-xs">
          <div className="flex items-center gap-2.5 mb-5">
            <div className="grid size-9 place-items-center rounded-xl bg-sky-50 dark:bg-sky-950/60 text-sky-600 dark:text-sky-400 border border-sky-100 dark:border-sky-900/50">
              <ClipboardPenLine size={18} />
            </div>
            <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">Bài tập lớp học</h2>
          </div>
          <div className="space-y-3.5">
            {filteredAssignments.length ? (
              assignmentPagination.pageItems.map((item) => (
                <article
                  className="rounded-xl border border-slate-200/80 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30 p-5 hover:border-sky-300 dark:hover:border-sky-700 transition-all scroll-mt-24"
                  id={`academic-${item.id}`}
                  key={item.id}
                >
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="font-bold text-base text-slate-900 dark:text-slate-100">{item.title}</h3>
                        <StatusBadge status={item.status} />
                      </div>
                      <p className="mt-1 text-xs sm:text-sm leading-relaxed text-slate-500 dark:text-slate-400">
                        {item.description}
                      </p>
                      <div className="mt-2.5 flex flex-wrap items-center gap-3 text-xs text-slate-500 dark:text-slate-400">
                        <span className="font-semibold text-sky-700 dark:text-sky-300">
                          Hạn: {new Date(item.dueAt).toLocaleString(activeLocale())}
                        </span>
                        <span>·</span>
                        <span>{item.maxScore} điểm</span>
                        <span>·</span>
                        <span>{item.rubric.length} tiêu chí</span>
                      </div>
                      {item.submission ? (
                        <p className="mt-2 flex items-center gap-1.5 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                          <CheckCircle2 size={14} />
                          {item.submission.status === "GRADED"
                            ? `Đã chấm: ${item.submission.score}/${item.maxScore}`
                            : `Đã nộp · ${item.submission.attachments.length} tệp`}
                        </p>
                      ) : null}
                    </div>
                    <div className="flex shrink-0 flex-wrap gap-1.5 pt-2 sm:pt-0">
                      {canTeach ? (
                        <>
                          {item.status === "DRAFT" ? (
                            <>
                              <Button
                                onClick={() => editAssignment(item)}
                                variant="ghost"
                                className="h-8 text-xs px-2.5"
                              >
                                <Pencil size={13} />
                                Sửa
                              </Button>
                              <Button
                                onClick={() => void publish(item)}
                                variant="secondary"
                                className="h-8 text-xs px-2.5"
                              >
                                <Send size={13} />
                                Xuất bản
                              </Button>
                            </>
                          ) : null}
                          {item.status === "PUBLISHED" ? (
                            <>
                              <Button
                                onClick={() => openLifecycle(item, "EXTEND")}
                                variant="ghost"
                                className="h-8 text-xs px-2.5"
                              >
                                <CalendarDays size={13} />
                                Gia hạn
                              </Button>
                              <Button
                                onClick={() => openLifecycle(item, "CLOSE")}
                                variant="ghost"
                                className="h-8 text-xs px-2.5"
                              >
                                Đóng bài
                              </Button>
                            </>
                          ) : null}
                          <Button
                            onClick={() => void openAssignmentHistory(item)}
                            variant="ghost"
                            className="h-8 text-xs px-2.5"
                          >
                            <History size={13} />
                            Lịch sử
                          </Button>
                          <Button
                            onClick={() => void openSubmissions(item)}
                            variant="ghost"
                            className="h-8 text-xs px-2.5"
                          >
                            <UsersRound size={13} />
                            Bài nộp
                          </Button>
                        </>
                      ) : session.roleCode === "LEARNER" &&
                        item.status === "PUBLISHED" ? (
                        <Button
                          onClick={() => {
                            setSubmitting(item);
                            setSubmissionContent(
                              item.submission?.content ?? "",
                            );
                            setSubmissionFiles([]);
                            setSubmissionError("");
                          }}
                          variant="secondary"
                          className="h-8 text-xs px-3"
                        >
                          {item.submission ? "Sửa bài nộp" : "Nộp bài"}
                        </Button>
                      ) : null}
                    </div>
                  </div>
                </article>
              ))
            ) : (
              <p className="py-10 text-center text-xs sm:text-sm text-slate-400">
                Lớp này chưa có bài tập.
              </p>
            )}
          </div>
          <Pagination
            className="mt-4"
            itemLabel="bài tập"
            onPageChange={assignmentPagination.setPage}
            onPageSizeChange={assignmentPagination.setPageSize}
            page={assignmentPagination.page}
            pageSize={assignmentPagination.pageSize}
            totalItems={assignmentPagination.totalItems}
          />
        </section>
        <div className="space-y-7">
          <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-6 shadow-xs">
            <div className="flex items-center gap-2.5 mb-4">
              <div className="grid size-9 place-items-center rounded-xl bg-sky-50 dark:bg-sky-950/60 text-sky-600 dark:text-sky-400 border border-sky-100 dark:border-sky-900/50">
                <CalendarDays size={18} />
              </div>
              <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">Lịch sắp tới</h2>
            </div>
            {dataReady &&
            !upcomingEvents.some(
              (item) => !selectedClassId || item.classId === selectedClassId,
            ) ? (
              <p className="mt-2 text-xs text-slate-400">
                Không có lịch sắp tới trong phạm vi đã chọn.
              </p>
            ) : null}
            <div className="mt-3 space-y-2">
              {upcomingEvents
                .filter(
                  (item) =>
                    !selectedClassId || item.classId === selectedClassId,
                )
                .slice(0, 7)
                .map((item) => (
                  <Link
                    className="flex items-center gap-3 rounded-xl p-2.5 text-xs hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors"
                    href={item.href}
                    key={item.id}
                  >
                    <time className="w-20 shrink-0 font-semibold tabular-nums text-sky-700 dark:text-sky-300">
                      {new Date(item.startAt).toLocaleString(activeLocale(), {
                        day: "2-digit",
                        month: "2-digit",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </time>
                    <span className="min-w-0 flex-1">
                      <strong className="block truncate text-slate-900 dark:text-slate-100">{item.title}</strong>
                      <small className="text-slate-400">
                        {item.classCode}
                      </small>
                    </span>
                  </Link>
                ))}
            </div>
          </section>
          <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-6 shadow-xs">
            <div className="flex items-center gap-2.5 mb-4">
              <div className="grid size-9 place-items-center rounded-xl bg-sky-50 dark:bg-sky-950/60 text-sky-600 dark:text-sky-400 border border-sky-100 dark:border-sky-900/50">
                <Megaphone size={18} />
              </div>
              <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">Thông báo lớp</h2>
            </div>
            {dataReady &&
            !announcements.some(
              (item) => !selectedClassId || item.classId === selectedClassId,
            ) ? (
              <p className="mt-2 text-xs text-slate-400">
                Chưa có thông báo cho lớp đã chọn.
              </p>
            ) : null}
            <div className="mt-3 space-y-3">
              {announcements
                .filter(
                  (item) =>
                    !selectedClassId || item.classId === selectedClassId,
                )
                .slice(0, 5)
                .map((item) => (
                  <article
                    className="rounded-xl bg-slate-50/70 dark:bg-slate-800/40 border border-slate-100 dark:border-slate-800 p-3.5 scroll-mt-24"
                    id={`academic-${item.id}`}
                    key={item.id}
                  >
                    <h3 className="text-xs sm:text-sm font-bold text-slate-900 dark:text-slate-100">{item.title}</h3>
                    <p className="mt-1 whitespace-pre-wrap text-xs leading-relaxed text-slate-500 dark:text-slate-400">
                      {item.body}
                    </p>
                    <p className="mt-2 text-[10px] text-slate-400">
                      {item.authorName} ·{" "}
                      {new Date(item.publishedAt).toLocaleString(
                        activeLocale(),
                      )}
                    </p>
                  </article>
                ))}
            </div>
          </section>
        </div>
      </div>

      {canTeach ? (
        <section className="mt-7 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-6 shadow-xs">
          <div className="flex items-center gap-2.5 mb-5">
            <div className="grid size-9 place-items-center rounded-xl bg-sky-50 dark:bg-sky-950/60 text-sky-600 dark:text-sky-400 border border-sky-100 dark:border-sky-900/50">
              <BookOpenCheck size={18} />
            </div>
            <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">Sổ điểm tổng hợp</h2>
          </div>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[54rem] border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 text-xs font-semibold text-slate-400">
                  <th className="px-3.5 py-3">Học viên</th>
                  <th className="px-3.5 py-3">Đề thi</th>
                  <th className="px-3.5 py-3">Bài tập</th>
                  <th className="px-3.5 py-3">Trạng thái</th>
                  <th className="px-3.5 py-3">Tổng kết</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
                {gradebookPagination.pageItems.map((row) => (
                  <tr
                    className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors"
                    key={row.learnerId}
                  >
                    <td className="px-3.5 py-3.5">
                      <strong className="text-slate-900 dark:text-slate-100">{row.learnerName}</strong>
                      <small className="mt-0.5 block text-xs text-slate-400">
                        {row.learnerEmail}
                      </small>
                    </td>
                    <td className="px-3.5 py-3.5 tabular-nums text-slate-600 dark:text-slate-300">
                      {row.examEarned}/{row.examPossible}
                    </td>
                    <td className="px-3.5 py-3.5 tabular-nums text-slate-600 dark:text-slate-300">
                      {row.assignmentEarned}/{row.assignmentPossible}
                    </td>
                    <td className="px-3.5 py-3.5 text-xs">
                      <span className="block text-amber-600 dark:text-amber-400 font-medium">
                        {row.awaitingGrade} chờ chấm
                      </span>
                      <span className="block text-rose-600 dark:text-rose-400">
                        {row.notSubmitted} chưa nộp
                      </span>
                    </td>
                    <td className="px-3.5 py-3.5 font-bold tabular-nums text-sky-700 dark:text-sky-300">
                      {row.totalPercent}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!gradebook.length ? (
              <p className="py-10 text-center text-sm text-slate-400">
                Chưa có học viên hoặc dữ liệu điểm.
              </p>
            ) : null}
          </div>
          <Pagination
            className="mt-4"
            itemLabel="học viên"
            onPageChange={gradebookPagination.setPage}
            onPageSizeChange={gradebookPagination.setPageSize}
            page={gradebookPagination.page}
            pageSize={gradebookPagination.pageSize}
            totalItems={gradebookPagination.totalItems}
          />
        </section>
      ) : null}

      <AssignmentEditorDialog model={model} />
      <Modal
        open={creatingAnnouncement}
        onClose={() => setCreatingAnnouncement(false)}
        title="Phát thông báo lớp"
      >
        <form
          className="space-y-4"
          onSubmit={(event) => void createAnnouncement(event)}
        >
          <Field label="Lớp">
            <SearchableSelect
              aria-label="Tìm và chọn lớp nhận thông báo"
              onChange={(value) =>
                setAnnouncementForm({ ...announcementForm, classId: value })
              }
              options={classes.map((item) => ({
                value: item.id,
                label: `${item.code} — ${item.name}`,
                description: item.term,
                keywords: item.id,
              }))}
              placeholder="Gõ mã hoặc tên lớp để lọc…"
              value={announcementForm.classId}
            />
          </Field>
          <Field label="Tiêu đề">
            <input
              className={inputClass}
              minLength={3}
              required
              value={announcementForm.title}
              onChange={(event) =>
                setAnnouncementForm({
                  ...announcementForm,
                  title: event.target.value,
                })
              }
            />
          </Field>
          <Field label="Nội dung">
            <textarea
              className={inputClass}
              minLength={5}
              required
              rows={5}
              value={announcementForm.body}
              onChange={(event) =>
                setAnnouncementForm({
                  ...announcementForm,
                  body: event.target.value,
                })
              }
            />
          </Field>
          <Button disabled={!announcementForm.classId} type="submit">
            <Megaphone size={15} />
            Phát thông báo
          </Button>
        </form>
      </Modal>
      <AssignmentSubmissionDialog model={model} />
      <Modal
        open={Boolean(reviewing) && !grading}
        onClose={() => setReviewing(null)}
        title={`Bài nộp · ${reviewing?.title ?? ""}`}
      >
        <div className="divide-y divide-[var(--rule)] border-y border-[var(--rule)]">
          {submissionPagination.pageItems.map((item) => (
            <article
              className="flex flex-col gap-3 py-4 sm:flex-row sm:items-start sm:justify-between"
              key={item.id}
            >
              <div className="min-w-0">
                <p className="font-bold">{item.learnerName}</p>
                <p className="text-xs text-[var(--ink-muted)]">
                  {item.learnerEmail} ·{" "}
                  {new Date(item.submittedAt).toLocaleString(activeLocale())}
                </p>
                <p className="mt-2 line-clamp-2 text-sm text-[var(--ink-soft)]">
                  {item.content || "Bài nộp chỉ có tệp đính kèm."}
                </p>
                {item.attachments.length ? (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {item.attachments.map((file) => (
                      <button
                        className="inline-flex max-w-full items-center gap-1.5 rounded-lg border border-[var(--rule)] bg-[var(--surface)] px-2.5 py-1.5 text-xs font-semibold text-[var(--ink)] hover:border-[var(--rule-strong)]"
                        key={file.id}
                        onClick={() =>
                          void openAttachment(item.id, file.id, file.canPreview)
                        }
                        type="button"
                      >
                        <Paperclip size={13} />
                        <span className="max-w-48 truncate">
                          {file.originalName}
                        </span>
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
              <div className="flex shrink-0 flex-wrap gap-2">
                <Link
                  className="inline-flex min-h-10 items-center rounded-lg px-3 text-sm font-bold text-[var(--accent-deep)] hover:bg-[var(--accent-soft)]"
                  href={`/messages?userId=${encodeURIComponent(item.learnerId)}&contextType=ASSIGNMENT&contextId=${encodeURIComponent(item.assignmentId)}&contextTitle=${encodeURIComponent(reviewing?.title ?? "Bài tập")}`}
                >
                  <MessageCircle size={15} className="mr-1.5" />
                  Nhắn học viên
                </Link>
                <Button
                  onClick={() => {
                    setGrading(item);
                    setRubricScores(
                      Object.fromEntries(
                        item.rubricScores.map((score) => [
                          score.criterionId,
                          score.score,
                        ]),
                      ),
                    );
                    setFeedback(item.feedback ?? "");
                    setCorrectionReason("");
                  }}
                  variant="secondary"
                >
                  {item.status === "GRADED" ? "Sửa điểm" : "Chấm bài"}
                </Button>
              </div>
            </article>
          ))}
        </div>
        <Pagination
          itemLabel="bài nộp"
          onPageChange={submissionPagination.setPage}
          onPageSizeChange={submissionPagination.setPageSize}
          page={submissionPagination.page}
          pageSize={submissionPagination.pageSize}
          totalItems={submissionPagination.totalItems}
        />
      </Modal>
      <AssignmentGradingDialog model={model} />
      <Modal
        description={
          lifecycleAssignment
            ? `${lifecycleAssignment.title} · phiên bản ${lifecycleAssignment.version}`
            : undefined
        }
        onClose={() => setLifecycleAssignment(null)}
        open={Boolean(lifecycleAssignment)}
        title={lifecycleMode === "EXTEND" ? "Gia hạn bài tập" : "Đóng bài tập"}
      >
        <form
          className="space-y-4"
          onSubmit={(event) => void applyLifecycle(event)}
        >
          {lifecycleMode === "EXTEND" ? (
            <Field label="Hạn nộp mới">
              <input
                className={inputClass}
                min={lifecycleMinDueAt}
                onChange={(event) => setLifecycleDueAt(event.target.value)}
                required
                type="datetime-local"
                value={lifecycleDueAt}
              />
            </Field>
          ) : null}
          <Field
            label={
              lifecycleMode === "EXTEND" ? "Lý do gia hạn" : "Lý do đóng bài"
            }
          >
            <textarea
              className={inputClass}
              minLength={3}
              onChange={(event) => setLifecycleReason(event.target.value)}
              required
              rows={4}
              value={lifecycleReason}
            />
          </Field>
          <Button type="submit">
            {lifecycleMode === "EXTEND"
              ? "Xác nhận gia hạn"
              : "Xác nhận đóng bài"}
          </Button>
        </form>
      </Modal>
      <Modal
        description="Mỗi thay đổi giữ phiên bản trước, người thực hiện, thời điểm và lý do nghiệp vụ."
        onClose={() => setAssignmentHistory(null)}
        open={assignmentHistory !== null}
        title="Lịch sử bài tập"
      >
        {assignmentHistory?.length ? (
          <ol className="divide-y divide-[var(--rule)] border-y border-[var(--rule)]">
            {assignmentHistory.map((change) => (
              <li className="py-4" key={change.id}>
                <div className="flex items-center justify-between gap-3">
                  <strong className="text-sm">{change.action}</strong>
                  <span className="text-xs tabular-nums text-[var(--ink-muted)]">
                    v{change.fromVersion} → v{change.toVersion}
                  </span>
                </div>
                <p className="mt-1 text-xs text-[var(--ink-muted)]">
                  {new Date(change.createdAt).toLocaleString(activeLocale())} ·{" "}
                  {change.actorId}
                </p>
                {change.reason ? (
                  <p className="mt-2 text-sm text-[var(--ink-soft)]">
                    {change.reason}
                  </p>
                ) : null}
              </li>
            ))}
          </ol>
        ) : (
          <p className="py-8 text-center text-sm text-[var(--ink-muted)]">
            Bài tập chưa có thay đổi sau khi tạo.
          </p>
        )}
      </Modal>
    </div>
  );
}
