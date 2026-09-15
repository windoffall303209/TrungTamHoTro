"use client";
import { usePagination } from "@/components/ui";
import { hasPermission } from "@/lib/access-control";
import { apiRequest, downloadApiFile, previewApiFile } from "@/lib/api-client";
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
import { useSearchParams } from "next/navigation";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { emptyAssignment } from "./academic.shared";

/** Quản lý trạng thái, tải dữ liệu và hành động của màn hình học vụ; giữ nguyên thứ tự hook. */
export function useAcademicModel() {
  const { session, notify } = useApp();

  const searchParams = useSearchParams();
  const [dataReady, setDataReady] = useState(false);
  const [loadError, setLoadError] = useState("");

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
    setDataReady(false);
    setLoadError("");
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
      setDataReady(true);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Không tải được dữ liệu học vụ.");
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
  return {
    dataReady,
    loadError,
    reload: load,
    session,
    classes,
    announcements,
    gradebook,
    selectedClassId,
    assignmentForm,
    setAssignmentForm,
    announcementForm,
    setAnnouncementForm,
    creatingAssignment,
    setCreatingAssignment,
    editingAssignment,
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
    submitting,
    setSubmitting,
    submissionContent,
    setSubmissionContent,
    submissionFiles,
    setSubmissionFiles,
    submissionError,
    setSubmissionError,
    submissionBusy,
    reviewing,
    setReviewing,
    grading,
    setGrading,
    rubricScores,
    setRubricScores,
    feedback,
    setFeedback,
    correctionReason,
    setCorrectionReason,
    allowed,
    canTeach,
    changeClass,
    createAssignment,
    editAssignment,
    openLifecycle,
    applyLifecycle,
    openAssignmentHistory,
    publish,
    submitAssignment,
    chooseSubmissionFiles,
    removeStoredAttachment,
    openAttachment,
    openSubmissions,
    grade,
    createAnnouncement,
    filteredAssignments,
    upcomingEvents,
    assignmentPagination,
    gradebookPagination,
    submissionPagination,
  };
}
