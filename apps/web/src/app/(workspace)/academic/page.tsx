"use client";

import { activeLocale } from "@/i18n/runtime";
import {
  BookOpenCheck,
  CalendarDays,
  CheckCircle2,
  ClipboardPenLine,
  Download,
  Eye,
  FileText,
  History,
  MessageCircle,
  Megaphone,
  Paperclip,
  Pencil,
  Plus,
  Send,
  Trash2,
  UsersRound,
  X,
} from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { AccessDenied } from "@/components/access-denied";
import { AssignmentAiGrading } from "@/components/assignment-ai-grading";
import { PageHeader } from "@/components/page-header";
import { SearchableSelect } from "@/components/searchable-select";
import {
  Button,
  Field,
  inputClass,
  Modal,
  Pagination,
  StatusBadge,
  usePagination,
} from "@/components/ui";
import { apiRequest, downloadApiFile, previewApiFile } from "@/lib/api-client";
import { hasPermission } from "@/lib/access-control";
import type {
  AcademicCalendarEvent,
  Assignment,
  AssignmentChange,
  AssignmentSubmission,
  ClassAnnouncement,
  GradebookRow,
  LearningClass,
} from "@/lib/learning-types";
import { useApp } from "@/providers/app-provider";

const emptyAssignment = {
  classId: "",
  title: "",
  description: "",
  instructions: "",
  dueAt: "",
  maxScore: 10,
  rubric: [
    {
      title: "Nội dung",
      description: "Đáp ứng yêu cầu của bài tập",
      maxPoints: 10,
    },
  ],
};

/** Điều phối bài tập, bài nộp, chấm điểm và thông báo theo lớp của người dùng hiện tại. */
export default function AcademicPage() {
  const { session, notify } = useApp();
  const searchParams = useSearchParams();
  const [classes, setClasses] = useState<LearningClass[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [events, setEvents] = useState<AcademicCalendarEvent[]>([]);
  const [announcements, setAnnouncements] = useState<ClassAnnouncement[]>([]);
  const [gradebook, setGradebook] = useState<GradebookRow[]>([]);
  const [selectedClassId, setSelectedClassId] = useState("");
  const [assignmentForm, setAssignmentForm] = useState(emptyAssignment);
  const [announcementForm, setAnnouncementForm] = useState({
    classId: "",
    title: "",
    body: "",
  });
  const [creatingAssignment, setCreatingAssignment] = useState(false);
  const [editingAssignment, setEditingAssignment] = useState<Assignment | null>(
    null,
  );
  const [lifecycleAssignment, setLifecycleAssignment] =
    useState<Assignment | null>(null);
  const [lifecycleMode, setLifecycleMode] = useState<"EXTEND" | "CLOSE">(
    "EXTEND",
  );
  const [lifecycleDueAt, setLifecycleDueAt] = useState("");
  const [lifecycleMinDueAt, setLifecycleMinDueAt] = useState("");
  const [lifecycleReason, setLifecycleReason] = useState("");
  const [assignmentHistory, setAssignmentHistory] = useState<
    AssignmentChange[] | null
  >(null);
  const [creatingAnnouncement, setCreatingAnnouncement] = useState(false);
  const [submitting, setSubmitting] = useState<Assignment | null>(null);
  const [submissionContent, setSubmissionContent] = useState("");
  const [submissionFiles, setSubmissionFiles] = useState<File[]>([]);
  const [submissionError, setSubmissionError] = useState("");
  const [submissionBusy, setSubmissionBusy] = useState(false);
  const [reviewing, setReviewing] = useState<Assignment | null>(null);
  const [submissions, setSubmissions] = useState<AssignmentSubmission[]>([]);
  const [grading, setGrading] = useState<AssignmentSubmission | null>(null);
  const [rubricScores, setRubricScores] = useState<Record<string, number>>({});
  const [feedback, setFeedback] = useState("");
  const [correctionReason, setCorrectionReason] = useState("");
  const allowed =
    session.roleCode === "INSTRUCTOR" || session.roleCode === "LEARNER";
  const canTeach =
    session.roleCode === "INSTRUCTOR" && hasPermission(session, "exam:manage");

  /** Nạp các lớp và dữ liệu học vụ tương ứng với vai trò, sau đó chọn lớp khả dụng đầu tiên. */
  const load = useCallback(async () => {
    if (!allowed) return;
    try {
      const [classData, assignmentData, calendarData, announcementData] =
        await Promise.all([
          apiRequest<LearningClass[]>("/classes", {
            roleCode: session.roleCode,
          }),
          apiRequest<Assignment[]>("/academic/assignments", {
            roleCode: session.roleCode,
          }),
          apiRequest<AcademicCalendarEvent[]>("/academic/calendar", {
            roleCode: session.roleCode,
          }),
          apiRequest<ClassAnnouncement[]>("/academic/announcements", {
            roleCode: session.roleCode,
          }),
        ]);
      setClasses(classData);
      setAssignments(assignmentData);
      setEvents(calendarData);
      setAnnouncements(announcementData);
      const linkedAssignment = assignmentData.find(
        (item) => item.id === searchParams.get("assignmentId"),
      );
      const linkedAnnouncement = announcementData.find(
        (item) => item.id === searchParams.get("announcementId"),
      );
      const requestedClassId = searchParams.get("classId");
      const first =
        linkedAssignment?.classId ||
        linkedAnnouncement?.classId ||
        (classData.some((item) => item.id === requestedClassId)
          ? requestedClassId!
          : "") ||
        selectedClassId ||
        classData[0]?.id ||
        "";
      setSelectedClassId(first);
      setAssignmentForm((value) => ({
        ...value,
        classId: value.classId || first,
      }));
      setAnnouncementForm((value) => ({
        ...value,
        classId: value.classId || first,
      }));
      if (canTeach && first)
        setGradebook(
          await apiRequest<GradebookRow[]>(
            `/academic/classes/${first}/gradebook`,
            { roleCode: session.roleCode },
          ),
        );
    } catch (error) {
      notify(
        error instanceof Error
          ? error.message
          : "Không tải được dữ liệu học vụ.",
        "error",
      );
    }
  }, [
    allowed,
    canTeach,
    notify,
    searchParams,
    selectedClassId,
    session.roleCode,
  ]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  /** Đưa đối tượng từ lịch hoặc thông báo vào vùng nhìn sau khi dữ liệu đã sẵn sàng. */
  useEffect(() => {
    const entityId =
      searchParams.get("assignmentId") ?? searchParams.get("announcementId");
    if (!entityId) return;
    const timer = window.setTimeout(() => {
      document
        .getElementById(`academic-${entityId}`)
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 120);
    return () => window.clearTimeout(timer);
  }, [assignments, announcements, searchParams]);

  /** Chuyển ngữ cảnh lớp và tải lại bài tập/thông báo gắn với lớp đó. */
  async function changeClass(classId: string): Promise<void> {
    setSelectedClassId(classId);
    assignmentPagination.resetPage();
    gradebookPagination.resetPage();
    if (canTeach && classId)
      try {
        setGradebook(
          await apiRequest<GradebookRow[]>(
            `/academic/classes/${classId}/gradebook`,
            { roleCode: session.roleCode },
          ),
        );
      } catch (error) {
        notify(
          error instanceof Error ? error.message : "Không tải được sổ điểm.",
          "error",
        );
      }
  }

  /** Tạo hoặc cập nhật bài nháp cùng rubric và khóa phiên bản hiện tại. */
  async function createAssignment(event: FormEvent): Promise<void> {
    event.preventDefault();
    try {
      await apiRequest(
        editingAssignment
          ? `/instructor/assignments/${editingAssignment.id}`
          : `/instructor/classes/${assignmentForm.classId}/assignments`,
        {
          method: editingAssignment ? "PATCH" : "POST",
          roleCode: session.roleCode,
          body: JSON.stringify({
            ...assignmentForm,
            dueAt: new Date(assignmentForm.dueAt).toISOString(),
            ...(editingAssignment
              ? { expectedVersion: editingAssignment.version }
              : {}),
          }),
        },
      );
      setCreatingAssignment(false);
      setEditingAssignment(null);
      setAssignmentForm({
        ...emptyAssignment,
        classId: assignmentForm.classId,
      });
      notify(
        editingAssignment
          ? "Đã lưu phiên bản bài tập mới."
          : "Đã tạo bài tập nháp.",
      );
      await load();
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "Không tạo được bài tập.",
        "error",
      );
    }
  }

  /** Mở biểu mẫu sửa bài nháp từ phiên bản hiện tại trên máy chủ. */
  function editAssignment(item: Assignment): void {
    setEditingAssignment(item);
    setAssignmentForm({
      classId: item.classId,
      title: item.title,
      description: item.description,
      instructions: item.instructions,
      dueAt: new Date(item.dueAt).toISOString().slice(0, 16),
      maxScore: item.maxScore,
      rubric: item.rubric.map(({ title, description, maxPoints }) => ({
        title,
        description,
        maxPoints,
      })),
    });
    setCreatingAssignment(true);
  }

  /** Mở thao tác gia hạn hoặc đóng bài với lý do bắt buộc. */
  function openLifecycle(item: Assignment, mode: "EXTEND" | "CLOSE"): void {
    setLifecycleAssignment(item);
    setLifecycleMode(mode);
    const minimumDueAt = new Date(Date.now() + 60_000)
      .toISOString()
      .slice(0, 16);
    setLifecycleMinDueAt(minimumDueAt);
    setLifecycleDueAt(
      new Date(
        Math.max(Date.now() + 60_000, new Date(item.dueAt).getTime() + 60_000),
      )
        .toISOString()
        .slice(0, 16),
    );
    setLifecycleReason("");
  }

  /** Gửi lệnh gia hạn hoặc đóng bài bằng expectedVersion rồi làm mới màn hình. */
  async function applyLifecycle(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (!lifecycleAssignment) return;
    try {
      await apiRequest(
        `/instructor/assignments/${lifecycleAssignment.id}/${lifecycleMode === "EXTEND" ? "extend" : "close"}`,
        {
          method: lifecycleMode === "EXTEND" ? "PATCH" : "POST",
          roleCode: session.roleCode,
          body: JSON.stringify({
            reason: lifecycleReason,
            expectedVersion: lifecycleAssignment.version,
            ...(lifecycleMode === "EXTEND"
              ? { dueAt: new Date(lifecycleDueAt).toISOString() }
              : {}),
          }),
        },
      );
      setLifecycleAssignment(null);
      await load();
      notify(
        lifecycleMode === "EXTEND"
          ? "Đã gia hạn và thông báo cho lớp."
          : "Đã đóng bài tập.",
      );
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "Không cập nhật được bài tập.",
        "error",
      );
    }
  }

  /** Tải lịch sử thay đổi để đối soát phiên bản bài tập. */
  async function openAssignmentHistory(item: Assignment): Promise<void> {
    try {
      setAssignmentHistory(
        await apiRequest<AssignmentChange[]>(
          `/instructor/assignments/${item.id}/history`,
          { roleCode: session.roleCode },
        ),
      );
    } catch (error) {
      notify(
        error instanceof Error
          ? error.message
          : "Không tải được lịch sử bài tập.",
        "error",
      );
    }
  }

  /** Xuất bản bài tập để học viên trong lớp có thể xem và nộp bài. */
  async function publish(item: Assignment): Promise<void> {
    try {
      await apiRequest(`/instructor/assignments/${item.id}/publish`, {
        method: "POST",
        roleCode: session.roleCode,
      });
      notify("Đã xuất bản bài tập và thông báo cho học viên.");
      await load();
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "Không xuất bản được bài tập.",
        "error",
      );
    }
  }

  /** Tải các tệp đã chọn rồi tạo/cập nhật bài nộp với danh sách tệp đính kèm. */
  async function submitAssignment(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (!submitting) return;
    const existingCount = submitting.submission?.attachments.length ?? 0;
    if (
      !submissionContent.trim() &&
      !existingCount &&
      !submissionFiles.length
    ) {
      setSubmissionError("Cần nhập nội dung hoặc đính kèm ít nhất một tệp.");
      return;
    }
    setSubmissionBusy(true);
    setSubmissionError("");
    const body = new FormData();
    body.set("content", submissionContent.trim());
    body.set("expectedRevision", String(submitting.submission?.revision ?? 0));
    submissionFiles.forEach((file) => body.append("files", file));
    try {
      await apiRequest(`/learner/assignments/${submitting.id}/submissions`, {
        method: "POST",
        roleCode: session.roleCode,
        body,
      });
      setSubmitting(null);
      setSubmissionContent("");
      setSubmissionFiles([]);
      notify("Đã lưu bài nộp và tệp đính kèm.");
      await load();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Không nộp được bài.";
      setSubmissionError(message);
      notify(message, "error");
    } finally {
      setSubmissionBusy(false);
    }
  }

  /** Kiểm tra và đưa tệp người học chọn vào hàng chờ trước khi tải lên. */
  function chooseSubmissionFiles(files: FileList | null): void {
    if (!files || !submitting) return;
    const next = [...submissionFiles, ...Array.from(files)];
    const existingCount = submitting.submission?.attachments.length ?? 0;
    if (existingCount + next.length > 5) {
      setSubmissionError("Mỗi bài nộp được đính kèm tối đa 5 tệp.");
      return;
    }
    const allowed = /\.(jpe?g|png|webp|pdf|docx?|txt)$/i;
    const invalid = next.find(
      (file) =>
        file.size <= 0 ||
        file.size > 20 * 1024 * 1024 ||
        !allowed.test(file.name),
    );
    if (invalid) {
      setSubmissionError(
        `Tệp ${invalid.name} phải đúng định dạng cho phép và không vượt quá 20 MB.`,
      );
      return;
    }
    setSubmissionFiles(next);
    setSubmissionError("");
  }

  /** Gỡ một tệp đã lưu khỏi bài nộp hiện tại rồi đồng bộ lại chi tiết bài. */
  async function removeStoredAttachment(attachmentId: string): Promise<void> {
    const submission = submitting?.submission;
    if (!submission) return;
    setSubmissionBusy(true);
    setSubmissionError("");
    try {
      const updated = await apiRequest<AssignmentSubmission>(
        `/learner/assignment-submissions/${submission.id}/attachments/${attachmentId}?expectedRevision=${submission.revision}`,
        { method: "DELETE", roleCode: session.roleCode },
      );
      setSubmitting((current) =>
        current ? { ...current, submission: updated } : current,
      );
      notify("Đã xóa tệp khỏi bài nộp.");
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Không xóa được tệp.";
      setSubmissionError(message);
      notify(message, "error");
    } finally {
      setSubmissionBusy(false);
    }
  }

  /** Lấy URL có kiểm soát để xem trước hoặc tải tệp bài nộp mà không điều hướng khỏi ứng dụng. */
  async function openAttachment(
    submissionId: string,
    attachmentId: string,
    preview: boolean,
  ): Promise<void> {
    try {
      const path = `/assignment-submissions/${submissionId}/attachments/${attachmentId}${preview ? "?action=preview" : ""}`;
      if (preview) await previewApiFile(path, session.roleCode);
      else await downloadApiFile(path, session.roleCode);
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "Không mở được tệp bài nộp.",
        "error",
      );
    }
  }

  /** Nạp danh sách bài nộp của một bài tập để giảng viên chấm. */
  async function openSubmissions(item: Assignment): Promise<void> {
    try {
      setSubmissions(
        await apiRequest<AssignmentSubmission[]>(
          `/instructor/assignments/${item.id}/submissions`,
          { roleCode: session.roleCode },
        ),
      );
      setReviewing(item);
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "Không tải được bài nộp.",
        "error",
      );
    }
  }

  /** Gửi điểm và phản hồi cho bài nộp đang chọn rồi làm mới danh sách chấm. */
  async function grade(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (!grading || !reviewing) return;
    try {
      await apiRequest(
        `/instructor/assignment-submissions/${grading.id}/grade`,
        {
          method: "PATCH",
          roleCode: session.roleCode,
          body: JSON.stringify({
            rubricScores: reviewing.rubric.map((criterion) => ({
              criterionId: criterion.id,
              score: rubricScores[criterion.id] ?? 0,
            })),
            feedback,
            expectedSubmissionRevision: grading.revision,
            correctionReason:
              grading.status === "GRADED" ? correctionReason : undefined,
          }),
        },
      );
      setGrading(null);
      setFeedback("");
      setCorrectionReason("");
      await openSubmissions(reviewing);
      await load();
      notify("Đã lưu điểm rubric và phản hồi.");
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "Không lưu được điểm.",
        "error",
      );
    }
  }

  /** Đăng thông báo mới vào lớp đang chọn và làm mới luồng thông báo. */
  async function createAnnouncement(event: FormEvent): Promise<void> {
    event.preventDefault();
    try {
      await apiRequest(
        `/academic/classes/${announcementForm.classId}/announcements`,
        {
          method: "POST",
          roleCode: session.roleCode,
          body: JSON.stringify({
            title: announcementForm.title,
            body: announcementForm.body,
          }),
        },
      );
      setCreatingAnnouncement(false);
      setAnnouncementForm({
        classId: announcementForm.classId,
        title: "",
        body: "",
      });
      await load();
      notify("Đã phát thông báo đến thành viên lớp.");
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "Không phát được thông báo.",
        "error",
      );
    }
  }

  const filteredAssignments = useMemo(
    () =>
      selectedClassId
        ? assignments.filter((item) => item.classId === selectedClassId)
        : assignments,
    [assignments, selectedClassId],
  );
  const upcomingEvents = useMemo(() => events.slice(0, 12), [events]);
  const assignmentPagination = usePagination(filteredAssignments);
  const gradebookPagination = usePagination(gradebook);
  const submissionPagination = usePagination(submissions);

  if (!allowed) return <AccessDenied />;
  return (
    <div className="workspace-enter mx-auto max-w-7xl px-4 py-8 md:px-7 md:py-10">
      <PageHeader
        eyebrow="Học vụ"
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
        <section className="border-y border-[var(--rule-strong)] bg-[var(--surface)]/65 px-5 py-6">
          <div className="flex items-center gap-3">
            <ClipboardPenLine className="text-[var(--accent)]" size={21} />
            <h2 className="section-title">Bài tập</h2>
          </div>
          <div className="mt-5 divide-y divide-[var(--rule)] border-y border-[var(--rule)]">
            {filteredAssignments.length ? (
              assignmentPagination.pageItems.map((item) => (
                <article
                  className="scroll-mt-24 py-5"
                  id={`academic-${item.id}`}
                  key={item.id}
                >
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="font-bold">{item.title}</h3>
                        <StatusBadge status={item.status} />
                      </div>
                      <p className="mt-1 text-sm leading-6 text-[var(--ink-soft)]">
                        {item.description}
                      </p>
                      <p className="mt-2 text-xs font-semibold text-[var(--ink-muted)]">
                        Hạn {new Date(item.dueAt).toLocaleString(activeLocale())} ·{" "}
                        {item.maxScore} điểm · {item.rubric.length} tiêu chí
                      </p>
                      {item.submission ? (
                        <p className="mt-2 flex items-center gap-1.5 text-xs font-bold text-[var(--success)]">
                          <CheckCircle2 size={14} />
                          {item.submission.status === "GRADED"
                            ? `Đã chấm: ${item.submission.score}/${item.maxScore}`
                            : `Đã nộp · ${item.submission.attachments.length} tệp`}
                        </p>
                      ) : null}
                    </div>
                    <div className="flex shrink-0 flex-wrap gap-2">
                      {canTeach ? (
                        <>
                          {item.status === "DRAFT" ? (
                            <>
                              <Button
                                onClick={() => editAssignment(item)}
                                variant="ghost"
                              >
                                <Pencil size={15} />
                                Sửa
                              </Button>
                              <Button
                                onClick={() => void publish(item)}
                                variant="secondary"
                              >
                                <Send size={15} />
                                Xuất bản
                              </Button>
                            </>
                          ) : null}
                          {item.status === "PUBLISHED" ? (
                            <>
                              <Button
                                onClick={() => openLifecycle(item, "EXTEND")}
                                variant="ghost"
                              >
                                <CalendarDays size={15} />
                                Gia hạn
                              </Button>
                              <Button
                                onClick={() => openLifecycle(item, "CLOSE")}
                                variant="ghost"
                              >
                                Đóng bài
                              </Button>
                            </>
                          ) : null}
                          <Button
                            onClick={() => void openAssignmentHistory(item)}
                            variant="ghost"
                          >
                            <History size={15} />
                            Lịch sử
                          </Button>
                          <Button
                            onClick={() => void openSubmissions(item)}
                            variant="ghost"
                          >
                            <UsersRound size={15} />
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
                        >
                          {item.submission ? "Sửa bài nộp" : "Nộp bài"}
                        </Button>
                      ) : null}
                    </div>
                  </div>
                </article>
              ))
            ) : (
              <p className="py-10 text-center text-sm text-[var(--ink-muted)]">
                Lớp này chưa có bài tập.
              </p>
            )}
          </div>
          <Pagination
            itemLabel="bài tập"
            onPageChange={assignmentPagination.setPage}
            onPageSizeChange={assignmentPagination.setPageSize}
            page={assignmentPagination.page}
            pageSize={assignmentPagination.pageSize}
            totalItems={assignmentPagination.totalItems}
          />
        </section>
        <div className="space-y-7">
          <section className="border-y border-[var(--rule-strong)] bg-[var(--surface)]/65 px-5 py-6">
            <div className="flex items-center gap-3">
              <CalendarDays className="text-[var(--accent)]" size={21} />
              <h2 className="section-title">Lịch sắp tới</h2>
            </div>
            <div className="mt-5 divide-y divide-[var(--rule)] border-y border-[var(--rule)]">
              {upcomingEvents
                .filter(
                  (item) =>
                    !selectedClassId || item.classId === selectedClassId,
                )
                .slice(0, 7)
                .map((item) => (
                  <Link
                    className="flex items-start gap-3 py-3 hover:text-[var(--accent-ink)]"
                    href={item.href}
                    key={item.id}
                  >
                    <time className="w-24 shrink-0 text-xs font-bold tabular-nums text-[var(--ink-muted)]">
                      {new Date(item.startAt).toLocaleString(activeLocale(), {
                        day: "2-digit",
                        month: "2-digit",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </time>
                    <span className="min-w-0">
                      <strong className="block text-sm">{item.title}</strong>
                      <small className="text-[var(--ink-muted)]">
                        {item.classCode}
                      </small>
                    </span>
                  </Link>
                ))}
            </div>
          </section>
          <section className="border-y border-[var(--rule-strong)] bg-[var(--surface)]/65 px-5 py-6">
            <div className="flex items-center gap-3">
              <Megaphone className="text-[var(--accent)]" size={21} />
              <h2 className="section-title">Thông báo lớp</h2>
            </div>
            <div className="mt-5 divide-y divide-[var(--rule)] border-y border-[var(--rule)]">
              {announcements
                .filter(
                  (item) =>
                    !selectedClassId || item.classId === selectedClassId,
                )
                .slice(0, 5)
                .map((item) => (
                  <article
                    className="scroll-mt-24 py-4"
                    id={`academic-${item.id}`}
                    key={item.id}
                  >
                    <h3 className="text-sm font-bold">{item.title}</h3>
                    <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-[var(--ink-soft)]">
                      {item.body}
                    </p>
                    <p className="mt-2 text-xs text-[var(--ink-muted)]">
                      {item.authorName} ·{" "}
                      {new Date(item.publishedAt).toLocaleString(activeLocale())}
                    </p>
                  </article>
                ))}
            </div>
          </section>
        </div>
      </div>

      {canTeach ? (
        <section className="mt-7 border-y border-[var(--rule-strong)] bg-[var(--surface)]/65 px-5 py-6">
          <div className="flex items-center gap-3">
            <BookOpenCheck className="text-[var(--accent)]" size={21} />
            <h2 className="section-title">Sổ điểm tổng hợp</h2>
          </div>
          <div className="mt-5 overflow-x-auto">
            <table className="w-full min-w-[54rem] border-collapse text-left text-sm">
              <thead>
                <tr className="border-y border-[var(--rule-strong)] text-xs text-[var(--ink-soft)]">
                  <th className="px-3 py-3">Học viên</th>
                  <th className="px-3 py-3">Đề thi</th>
                  <th className="px-3 py-3">Bài tập</th>
                  <th className="px-3 py-3">Trạng thái</th>
                  <th className="px-3 py-3">Tổng kết</th>
                </tr>
              </thead>
              <tbody>
                {gradebookPagination.pageItems.map((row) => (
                  <tr
                    className="border-b border-[var(--rule)]"
                    key={row.learnerId}
                  >
                    <td className="px-3 py-4">
                      <strong>{row.learnerName}</strong>
                      <small className="mt-0.5 block text-[var(--ink-muted)]">
                        {row.learnerEmail}
                      </small>
                    </td>
                    <td className="px-3 py-4 tabular-nums">
                      {row.examEarned}/{row.examPossible}
                    </td>
                    <td className="px-3 py-4 tabular-nums">
                      {row.assignmentEarned}/{row.assignmentPossible}
                    </td>
                    <td className="px-3 py-4 text-xs">
                      <span className="block text-amber-700">
                        {row.awaitingGrade} chờ chấm
                      </span>
                      <span className="block text-rose-700">
                        {row.notSubmitted} chưa nộp
                      </span>
                    </td>
                    <td className="px-3 py-4 font-bold tabular-nums">
                      {row.totalPercent}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!gradebook.length ? (
              <p className="py-10 text-center text-sm text-[var(--ink-muted)]">
                Chưa có học viên hoặc dữ liệu điểm.
              </p>
            ) : null}
          </div>
          <Pagination
            itemLabel="học viên"
            onPageChange={gradebookPagination.setPage}
            onPageSizeChange={gradebookPagination.setPageSize}
            page={gradebookPagination.page}
            pageSize={gradebookPagination.pageSize}
            totalItems={gradebookPagination.totalItems}
          />
        </section>
      ) : null}

      <Modal
        open={creatingAssignment}
        onClose={() => {
          setCreatingAssignment(false);
          setEditingAssignment(null);
        }}
        title={editingAssignment ? "Sửa bài tập nháp" : "Tạo bài tập"}
        description="Rubric là nguồn điểm chính thức; tổng điểm các tiêu chí phải bằng điểm tối đa."
      >
        <form
          className="space-y-4"
          onSubmit={(event) => void createAssignment(event)}
        >
          <Field label="Lớp">
            <SearchableSelect
              aria-label="Tìm và chọn lớp nhận bài tập"
              onChange={(value) =>
                setAssignmentForm({ ...assignmentForm, classId: value })
              }
              options={classes.map((item) => ({
                value: item.id,
                label: `${item.code} — ${item.name}`,
                description: item.term,
                keywords: item.id,
              }))}
              placeholder="Gõ mã hoặc tên lớp để lọc…"
              value={assignmentForm.classId}
            />
          </Field>
          <Field label="Tên bài tập">
            <input
              className={inputClass}
              minLength={3}
              required
              value={assignmentForm.title}
              onChange={(event) =>
                setAssignmentForm({
                  ...assignmentForm,
                  title: event.target.value,
                })
              }
            />
          </Field>
          <Field label="Mô tả">
            <textarea
              className={inputClass}
              minLength={10}
              required
              rows={3}
              value={assignmentForm.description}
              onChange={(event) =>
                setAssignmentForm({
                  ...assignmentForm,
                  description: event.target.value,
                })
              }
            />
          </Field>
          <Field label="Hướng dẫn nộp">
            <textarea
              className={inputClass}
              minLength={5}
              required
              rows={3}
              value={assignmentForm.instructions}
              onChange={(event) =>
                setAssignmentForm({
                  ...assignmentForm,
                  instructions: event.target.value,
                })
              }
            />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Hạn nộp">
              <input
                className={inputClass}
                required
                type="datetime-local"
                value={assignmentForm.dueAt}
                onChange={(event) =>
                  setAssignmentForm({
                    ...assignmentForm,
                    dueAt: event.target.value,
                  })
                }
              />
            </Field>
            <Field label="Điểm tối đa">
              <input
                className={inputClass}
                min={0.25}
                required
                step="0.25"
                type="number"
                value={assignmentForm.maxScore}
                onChange={(event) =>
                  setAssignmentForm({
                    ...assignmentForm,
                    maxScore: Number(event.target.value),
                  })
                }
              />
            </Field>
          </div>
          <div>
            <div className="flex items-center justify-between">
              <p className="text-sm font-bold">Tiêu chí rubric</p>
              <Button
                onClick={() =>
                  setAssignmentForm({
                    ...assignmentForm,
                    rubric: [
                      ...assignmentForm.rubric,
                      { title: "", description: "", maxPoints: 0 },
                    ],
                  })
                }
                variant="ghost"
              >
                <Plus size={14} />
                Thêm tiêu chí
              </Button>
            </div>
            <div className="mt-2 space-y-3">
              {assignmentForm.rubric.map((criterion, index) => (
                <div
                  className="grid gap-2 border-y border-[var(--rule)] py-3 sm:grid-cols-[1fr_100px]"
                  key={index}
                >
                  <input
                    aria-label={`Tên tiêu chí ${index + 1}`}
                    className={inputClass}
                    placeholder="Tên tiêu chí"
                    required
                    value={criterion.title}
                    onChange={(event) => {
                      const rubric = [...assignmentForm.rubric];
                      rubric[index] = {
                        ...criterion,
                        title: event.target.value,
                      };
                      setAssignmentForm({ ...assignmentForm, rubric });
                    }}
                  />
                  <input
                    aria-label={`Điểm tiêu chí ${index + 1}`}
                    className={inputClass}
                    min={0.25}
                    step="0.25"
                    type="number"
                    value={criterion.maxPoints}
                    onChange={(event) => {
                      const rubric = [...assignmentForm.rubric];
                      rubric[index] = {
                        ...criterion,
                        maxPoints: Number(event.target.value),
                      };
                      setAssignmentForm({ ...assignmentForm, rubric });
                    }}
                  />
                  <textarea
                    aria-label={`Mô tả tiêu chí ${index + 1}`}
                    className={`${inputClass} sm:col-span-2`}
                    placeholder="Mô tả mức đạt yêu cầu"
                    required
                    rows={2}
                    value={criterion.description}
                    onChange={(event) => {
                      const rubric = [...assignmentForm.rubric];
                      rubric[index] = {
                        ...criterion,
                        description: event.target.value,
                      };
                      setAssignmentForm({ ...assignmentForm, rubric });
                    }}
                  />
                </div>
              ))}
            </div>
          </div>
          <Button disabled={!assignmentForm.classId} type="submit">
            Lưu bản nháp
          </Button>
        </form>
      </Modal>
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
                  <FileText
                    className="shrink-0 text-[var(--accent)]"
                    size={18}
                  />
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
      <Modal
        open={Boolean(grading)}
        onClose={() => setGrading(null)}
        title={`Chấm bài · ${grading?.learnerName ?? ""}`}
      >
        <form className="space-y-4" onSubmit={(event) => void grade(event)}>
          <div className="max-h-40 overflow-auto border-y border-[var(--rule)] p-3 text-sm leading-6 whitespace-pre-wrap">
            {grading?.content || "Bài nộp chỉ có tệp đính kèm."}
          </div>
          {grading?.attachments.length ? (
            <div>
              <p className="mb-2 text-sm font-bold">Tệp bài làm</p>
              <div className="flex flex-wrap gap-2">
                {grading.attachments.map((file) => (
                  <Button
                    key={file.id}
                    onClick={() =>
                      void openAttachment(grading.id, file.id, file.canPreview)
                    }
                    variant="ghost"
                  >
                    {file.canPreview ? (
                      <Eye size={15} />
                    ) : (
                      <Download size={15} />
                    )}
                    {file.originalName}
                  </Button>
                ))}
              </div>
            </div>
          ) : null}
          {grading?.gradeHistory?.length ? (
            <details className="border-y border-[var(--rule)] py-3">
              <summary className="cursor-pointer text-sm font-bold">
                Lịch sử chấm · {grading.gradeHistory.length} lần
              </summary>
              <ol className="mt-3 space-y-2 text-xs text-[var(--ink-soft)]">
                {grading.gradeHistory.map((change) => (
                  <li key={change.id}>
                    {new Date(change.createdAt).toLocaleString(activeLocale())} ·{" "}
                    {change.action === "CORRECTED"
                      ? `Sửa ${change.previousScore ?? 0} → ${change.nextScore}`
                      : `Chấm ${change.nextScore}`}{" "}
                    {change.reason ? `· ${change.reason}` : ""}
                  </li>
                ))}
              </ol>
            </details>
          ) : null}
          {canTeach && grading && reviewing ? <AssignmentAiGrading assignment={reviewing} submission={grading} onUse={(scores, nextFeedback) => { setRubricScores(scores); setFeedback(nextFeedback); }} /> : null}
          {reviewing?.rubric.map((criterion) => (
            <Field
              key={criterion.id}
              label={`${criterion.title} — tối đa ${criterion.maxPoints}`}
            >
              <input
                className={inputClass}
                max={criterion.maxPoints}
                min={0}
                required
                step="0.01"
                type="number"
                value={rubricScores[criterion.id] ?? 0}
                onChange={(event) =>
                  setRubricScores({
                    ...rubricScores,
                    [criterion.id]: Number(event.target.value),
                  })
                }
              />
              <span className="mt-1 block text-xs font-normal text-[var(--ink-muted)]">
                {criterion.description}
              </span>
            </Field>
          ))}
          <Field label="Phản hồi">
            <textarea
              className={inputClass}
              minLength={3}
              required
              rows={4}
              value={feedback}
              onChange={(event) => setFeedback(event.target.value)}
            />
          </Field>
          {grading?.status === "GRADED" ? (
            <Field label="Lý do sửa điểm đã công bố">
              <textarea
                className={inputClass}
                minLength={3}
                required
                rows={3}
                value={correctionReason}
                onChange={(event) => setCorrectionReason(event.target.value)}
              />
            </Field>
          ) : null}
          <Button type="submit">Lưu điểm rubric</Button>
        </form>
      </Modal>
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
