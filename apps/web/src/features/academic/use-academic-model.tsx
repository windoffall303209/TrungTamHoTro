"use client";
import { usePagination } from "@/shared/ui/ui";
import { useServerPagination, type PaginatedResponse } from "@/shared/hooks/use-server-pagination";
import { hasPermission } from "@/lib/access-control";
import { apiRequest } from "@/lib/api-client";
import { localDateTimeToIso, toLocalDateTimeInput } from "@/lib/date-time";
import type { AcademicCalendarEvent, Assignment, AssignmentSubmission, ClassAnnouncement, GradebookAssessmentColumn, GradebookResponse, GradebookRow, LearningClass } from "@/lib/learning-types";
import { useApp } from "@/providers/app-provider";
import { useSearchParams } from "next/navigation";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { emptyAssignment } from "./academic.shared";
import { normalizeGradebookResponse } from "./class-gradebook-table";

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
  const [gradebookAssessments, setGradebookAssessments] = useState<GradebookAssessmentColumn[]>([]);
  const loadRequestId = useRef(0);
  const gradebookRequestId = useRef(0);
  const gradebookControllerRef = useRef<AbortController | null>(null);
  const assignmentRequestId = useRef(0);
  const assignmentControllerRef = useRef<AbortController | null>(null);
  const [classesResolved, setClassesResolved] = useState(false);

  const [selectedClassId, setSelectedClassId] = useState("");
  const selectedClassIdRef = useRef("");

  useEffect(() => {
    selectedClassIdRef.current = selectedClassId;
  }, [selectedClassId]);

  const serverAssignmentPagination = useServerPagination(10);
  const {
    page: assignmentPage,
    displayPage: assignmentDisplayPage,
    pageSize: assignmentPageSize,
    totalItems: assignmentTotalItems,
    totalPages: assignmentTotalPages,
    setPage: setAssignmentPage,
    setPageSize: setAssignmentPageSize,
    resetPage: resetAssignmentPage,
    syncResponse: syncAssignmentPage,
  } = serverAssignmentPagination;

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

  const [creatingAnnouncement, setCreatingAnnouncement] = useState(false);

  const [submitting, setSubmitting] = useState<Assignment | null>(null);

  const [submissionContent, setSubmissionContent] = useState("");

  const [submissionFiles, setSubmissionFiles] = useState<File[]>([]);

  const [removedStoredIds, setRemovedStoredIds] = useState<string[]>([]);

  const [submissionError, setSubmissionError] = useState("");

  const [submissionBusy, setSubmissionBusy] = useState(false);

  const [reviewing, setReviewing] = useState<Assignment | null>(null);

  const [submissions, setSubmissions] = useState<AssignmentSubmission[]>([]);

  const [grading, setGrading] = useState<AssignmentSubmission | null>(null);

  const [rubricScores, setRubricScores] = useState<Record<string, number>>({});

  const [feedback, setFeedback] = useState("");

  const allowed =
    session.roleCode === "INSTRUCTOR" || session.roleCode === "LEARNER";

  const canTeach =
    session.roleCode === "INSTRUCTOR" && hasPermission(session, "exam:manage");

  /** Nạp các lớp và dữ liệu học vụ tương ứng với vai trò, sau đó chọn lớp khả dụng đầu tiên. */
  const load = useCallback(async () => {
    const requestId = ++loadRequestId.current;
    if (!allowed) return;
    setDataReady(false);
    setLoadError("");
    try {
      const [classData, calendarData, announcementData] =
        await Promise.all([
          apiRequest<LearningClass[]>("/classes", {
            roleCode: session.roleCode,
          }),
          apiRequest<AcademicCalendarEvent[]>("/academic/calendar", {
            roleCode: session.roleCode,
          }),
          apiRequest<ClassAnnouncement[]>("/academic/announcements", {
            roleCode: session.roleCode,
          }),
        ]);
      if (requestId !== loadRequestId.current) return;
      setClasses(classData);
      setEvents(calendarData);
      setAnnouncements(announcementData);
      const linkedAnnouncement = announcementData.find(
        (item) => item.id === searchParams.get("announcementId"),
      );
      const requestedClassId = searchParams.get("classId");
      const linkedAssignmentId = searchParams.get("assignmentId");
      let linkedAssignmentClassId = "";
      if (linkedAssignmentId && !requestedClassId && !linkedAnnouncement?.classId) {
        const assignmentLookup = await apiRequest<PaginatedResponse<Assignment> | Assignment[]>(
          "/academic/assignments/page?page=1&pageSize=100",
          { roleCode: session.roleCode },
        );
        if (requestId !== loadRequestId.current) return;
        const lookupItems = Array.isArray(assignmentLookup) ? assignmentLookup : assignmentLookup.items;
        linkedAssignmentClassId = lookupItems.find((item) => item.id === linkedAssignmentId)?.classId ?? "";
      }
      const first =
        linkedAssignmentClassId ||
        linkedAnnouncement?.classId ||
        (classData.some((item) => item.id === requestedClassId)
          ? requestedClassId!
          : "") ||
        selectedClassIdRef.current ||
        classData[0]?.id ||
        "";
      setSelectedClassId(first);
      setClassesResolved(true);
      setAssignmentForm((value) => ({
        ...value,
        classId: value.classId || first,
      }));
      setAnnouncementForm((value) => ({
        ...value,
        classId: value.classId || first,
      }));
      if (canTeach && first) {
        const gradebookId = ++gradebookRequestId.current;
        gradebookControllerRef.current?.abort();
        const controller = new AbortController();
        gradebookControllerRef.current = controller;
        try {
          const payload = await apiRequest<GradebookResponse | GradebookRow[]>(
            `/academic/classes/${first}/gradebook`,
            { roleCode: session.roleCode, signal: controller.signal },
          );
          if (
            controller.signal.aborted ||
            requestId !== loadRequestId.current ||
            gradebookId !== gradebookRequestId.current
          ) return;
          const normalized = normalizeGradebookResponse(payload);
          setGradebookAssessments(normalized.assessments);
          setGradebook(normalized.rows);
        } catch (gradebookError) {
          if (
            !controller.signal.aborted &&
            requestId === loadRequestId.current &&
            gradebookId === gradebookRequestId.current
          ) {
            throw gradebookError;
          }
          return;
        }
      }
      if (requestId === loadRequestId.current) setDataReady(true);
    } catch (error) {
      if (requestId === loadRequestId.current) {
        setLoadError(error instanceof Error ? error.message : "Không tải được dữ liệu học vụ.");
        notify(
          error instanceof Error
            ? error.message
            : "Không tải được dữ liệu học vụ.",
          "error",
        );
      }
    }
  }, [
    allowed,
    canTeach,
    notify,
    searchParams,
    session.roleCode,
  ]);

  /** Nạp danh sách bài tập theo trang trực tiếp từ DB cho lớp đang chọn. */
  const loadAssignments = useCallback(async () => {
    const requestId = ++assignmentRequestId.current;
    if (!allowed || !classesResolved) return;
    assignmentControllerRef.current?.abort();
    const controller = new AbortController();
    assignmentControllerRef.current = controller;
    try {
      const params = new URLSearchParams({
        page: String(assignmentPage),
        pageSize: String(assignmentPageSize),
      });
      if (selectedClassId) params.set("classId", selectedClassId);
      const pageResult = await apiRequest<PaginatedResponse<Assignment> | Assignment[]>(
        `/academic/assignments/page?${params.toString()}`,
        { roleCode: session.roleCode, signal: controller.signal },
      );
      if (controller.signal.aborted || requestId !== assignmentRequestId.current) return;
      if (Array.isArray(pageResult)) {
        setAssignments(pageResult);
        syncAssignmentPage({ total: pageResult.length, page: 1, totalPages: 1 });
      } else {
        setAssignments(Array.isArray(pageResult.items) ? pageResult.items : []);
        syncAssignmentPage(pageResult);
      }
    } catch (error) {
      if (!controller.signal.aborted && requestId === assignmentRequestId.current) {
        notify(
          error instanceof Error ? error.message : "Không tải được danh sách bài tập.",
          "error",
        );
      }
    }
  }, [
    allowed,
    assignmentPage,
    assignmentPageSize,
    classesResolved,
    notify,
    selectedClassId,
    session.roleCode,
    syncAssignmentPage,
  ]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => {
      window.clearTimeout(timer);
      loadRequestId.current += 1;
      gradebookRequestId.current += 1;
      gradebookControllerRef.current?.abort();
    };
  }, [load]);

  useEffect(() => {
    if (!allowed || !classesResolved) return;
    void loadAssignments();
    return () => {
      assignmentRequestId.current += 1;
      assignmentControllerRef.current?.abort();
    };
  }, [allowed, classesResolved, loadAssignments]);

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
    const requestId = ++gradebookRequestId.current;
    gradebookControllerRef.current?.abort();
    selectedClassIdRef.current = classId;
    setSelectedClassId(classId);
    resetAssignmentPage();
    gradebookPagination.resetPage();
    if (canTeach && classId) {
      const controller = new AbortController();
      gradebookControllerRef.current = controller;
      try {
        const payload = await apiRequest<GradebookResponse | GradebookRow[]>(
          `/academic/classes/${classId}/gradebook`,
          { roleCode: session.roleCode, signal: controller.signal },
        );
        if (!controller.signal.aborted && requestId === gradebookRequestId.current) {
          const normalized = normalizeGradebookResponse(payload);
          setGradebookAssessments(normalized.assessments);
          setGradebook(normalized.rows);
        }
      } catch (error) {
        if (!controller.signal.aborted && requestId === gradebookRequestId.current) {
          notify(
            error instanceof Error ? error.message : "Không tải được sổ điểm.",
            "error",
          );
        }
      }
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
            dueAt: localDateTimeToIso(assignmentForm.dueAt),
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
      await Promise.all([load(), loadAssignments()]);
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
      dueAt: toLocalDateTimeInput(item.dueAt),
      maxScore: item.maxScore,
      rubric: item.rubric.map(({ title, description, maxPoints }) => ({
        title,
        description,
        maxPoints,
      })),
    });
    setCreatingAssignment(true);
  }

  /** Mở thao tác gia hạn hoặc đóng bài tập. */
  function openLifecycle(item: Assignment, mode: "EXTEND" | "CLOSE"): void {
    setLifecycleAssignment(item);
    setLifecycleMode(mode);
    const minimumDueAt = toLocalDateTimeInput(Date.now() + 60_000);
    setLifecycleMinDueAt(minimumDueAt);
    setLifecycleDueAt(
      toLocalDateTimeInput(
        Math.max(Date.now() + 60_000, new Date(item.dueAt).getTime() + 60_000),
      ),
    );
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
            expectedVersion: lifecycleAssignment.version,
            ...(lifecycleMode === "EXTEND"
              ? { dueAt: localDateTimeToIso(lifecycleDueAt) }
              : {}),
          }),
        },
      );
      setLifecycleAssignment(null);
      await Promise.all([load(), loadAssignments()]);
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

  /** Xuất bản bài tập để học viên trong lớp có thể xem và nộp bài. */
  async function publish(item: Assignment): Promise<void> {
    try {
      await apiRequest(`/instructor/assignments/${item.id}/publish`, {
        method: "POST",
        roleCode: session.roleCode,
      });
      notify("Đã xuất bản bài tập và thông báo cho học viên.");
      await Promise.all([load(), loadAssignments()]);
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "Không xuất bản được bài tập.",
        "error",
      );
    }
  }

  /** Mở hộp thoại nộp bài và khởi tạo lại danh sách tệp tạm chưa lưu. */
  function openSubmissionDialog(item: Assignment): void {
    setSubmitting(item);
    setSubmissionContent(item.submission?.content ?? "");
    setSubmissionFiles([]);
    setRemovedStoredIds([]);
    setSubmissionError("");
  }

  /** Đóng hộp thoại nộp bài mà không làm thay đổi bài đã lưu trên máy chủ. */
  function closeSubmissionDialog(): void {
    setSubmitting(null);
    setSubmissionFiles([]);
    setRemovedStoredIds([]);
    setSubmissionError("");
  }

  /** Tải các tệp đã chọn rồi tạo/cập nhật bài nộp với danh sách tệp hiện hành. */
  async function submitAssignment(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (!submitting) return;
    const activeStoredIds = (submitting.submission?.attachments ?? [])
      .filter((file) => !removedStoredIds.includes(file.id))
      .map((file) => file.id);
    if (
      !submissionContent.trim() &&
      !activeStoredIds.length &&
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
    if (submitting.submission) {
      body.set("keepAttachmentIds", JSON.stringify(activeStoredIds));
    }
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
      setRemovedStoredIds([]);
      notify("Đã lưu bài nộp và tệp đính kèm.");
      await Promise.all([load(), loadAssignments()]);
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
    const existingCount = (submitting.submission?.attachments ?? []).filter(
      (file) => !removedStoredIds.includes(file.id),
    ).length;
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

  /** Đánh dấu bỏ tệp đã lưu khi nộp lại; bài nộp hiện tại vẫn nguyên vẹn nếu lưu thất bại. */
  function removeStoredAttachment(attachmentId: string): void {
    setRemovedStoredIds((current) =>
      current.includes(attachmentId) ? current : [...current, attachmentId],
    );
    setSubmissionError("");
  }

  /** Hủy đánh dấu bỏ để giữ lại tệp đã lưu trước khi gửi bài nộp. */
  function restoreStoredAttachment(attachmentId: string): void {
    if (!submitting) return;
    const activeStoredCount = (submitting.submission?.attachments ?? []).filter(
      (file) => !removedStoredIds.includes(file.id),
    ).length;
    if (activeStoredCount + 1 + submissionFiles.length > 5) {
      setSubmissionError("Mỗi bài nộp được đính kèm tối đa 5 tệp.");
      return;
    }
    setRemovedStoredIds((current) =>
      current.filter((id) => id !== attachmentId),
    );
    setSubmissionError("");
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
          }),
        },
      );
      setGrading(null);
      setFeedback("");
      await openSubmissions(reviewing);
      await Promise.all([load(), loadAssignments()]);
      notify("Đã lưu điểm.");
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

  const filteredAssignments = assignments;

  const upcomingEvents = useMemo(() => events.slice(0, 12), [events]);

  const assignmentPagination = {
    page: assignmentDisplayPage,
    displayPage: assignmentDisplayPage,
    pageSize: assignmentPageSize,
    totalItems: assignmentTotalItems,
    totalPages: assignmentTotalPages,
    setPage: setAssignmentPage,
    setPageSize: setAssignmentPageSize,
    resetPage: resetAssignmentPage,
    pageItems: assignments,
  };

  const gradebookPagination = usePagination(gradebook);

  const submissionPagination = usePagination(submissions);
  return {
    dataReady,
    loadError,
    reload: async () => {
      await Promise.all([load(), loadAssignments()]);
    },
    session,
    classes,
    announcements,
    gradebook,
    gradebookAssessments,
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
    creatingAnnouncement,
    setCreatingAnnouncement,
    submitting,
    setSubmitting,
    openSubmissionDialog,
    closeSubmissionDialog,
    submissionContent,
    setSubmissionContent,
    submissionFiles,
    setSubmissionFiles,
    removedStoredIds,
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
    allowed,
    canTeach,
    changeClass,
    createAssignment,
    editAssignment,
    openLifecycle,
    applyLifecycle,
    publish,
    submitAssignment,
    chooseSubmissionFiles,
    removeStoredAttachment,
    restoreStoredAttachment,
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
