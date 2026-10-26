"use client";

import { activeLocale } from "@/i18n/runtime";

import { BookOpen, Download, Eye, FileText, FolderOpen, History, Layers3, Library, Plus, Search, Trash2, UploadCloud, UserCog } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { AccessDenied } from "@/components/access-denied";
import { MaterialAiDialog } from "@/components/material-ai-dialog";
import { LearnerStudyDialog } from "@/components/learner-study-dialog";
import { PageHeader } from "@/components/page-header";
import { SectionState } from "@/components/section-state";
import { SearchableSelect } from "@/components/searchable-select";
import { Button, Field, inputClass, Modal, Pagination, StatusBadge } from "@/components/ui";
import { apiRequest, downloadApiFile, previewApiFile } from "@/lib/api-client";
import type { Course, LearningClass, Material, MaterialReview, MaterialVersionSnapshot } from "@/lib/learning-types";
import { useApp } from "@/providers/app-provider";
import { hasPermission } from "@/lib/access-control";

// Mục thư viện chung ở thanh bên: học liệu dùng chung của mọi môn, không lọc theo môn hay lớp.
const SHARED_LIBRARY = "__shared__";
const REVIEW_LABELS: Record<MaterialReview["action"], string> = { APPROVE: "Duyệt và phát hành", REVOKE: "Thu hồi", HIDE: "Ẩn học liệu", REQUEST_CHANGES: "Yêu cầu chỉnh sửa" };

/** Học liệu nháp luôn nằm trong hàng chờ quản lý duyệt nên hiển thị là chờ phê duyệt. */
function materialStatus(visibility: Material["visibility"]): string {
  return visibility === "DRAFT" ? "PENDING_REVIEW" : visibility;
}

/** Điều phối tạo, phiên bản hóa, duyệt, xem trước và tải xuống học liệu. */
export default function MaterialsPage() {
  const { session, notify } = useApp();
  const searchParams = useSearchParams();
  const allowed = ["SYSTEM_ADMIN", "CENTER_MANAGER", "INSTRUCTOR", "LEARNER"].includes(session.roleCode);
  const manager = ["SYSTEM_ADMIN", "CENTER_MANAGER"].includes(session.roleCode) && hasPermission(session, "class:manage");
  const instructor = session.roleCode === "INSTRUCTOR" && hasPermission(session, "material:manage");
  const learner = session.roleCode === "LEARNER";
  const canViewCourses = hasPermission(session, "course:view");
  const [items, setItems] = useState<Material[]>([]);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [totalItems, setTotalItems] = useState(0);
  const [materialsLoading, setMaterialsLoading] = useState(false);
  const [revision, setRevision] = useState(0);
  const [classes, setClasses] = useState<LearningClass[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [selectedCourseId, setSelectedCourseId] = useState("");
  const [query, setQuery] = useState("");
  const [classFilter, setClassFilter] = useState("");
  const [mimeFilter, setMimeFilter] = useState("");
  const [tagFilter, setTagFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [versionFile, setVersionFile] = useState<File | null>(null);
  const [versionTarget, setVersionTarget] = useState<Material | null>(null);
  const [versions, setVersions] = useState<MaterialVersionSnapshot[]>([]);
  const [reviews, setReviews] = useState<MaterialReview[]>([]);
  const [historyTarget, setHistoryTarget] = useState<Material | null>(null);
  const [reviewTarget, setReviewTarget] = useState<Material | null>(null);
  const [aiTarget, setAiTarget] = useState<Material | null>(null);
  const [studyTarget, setStudyTarget] = useState<Material | null>(null);
  const [reviewAction, setReviewAction] = useState<"APPROVE" | "REVOKE">("APPROVE");
  const [reviewReason, setReviewReason] = useState("");
  const [editorsTarget, setEditorsTarget] = useState<Material | null>(null);
  const [editorCandidates, setEditorCandidates] = useState<Array<{ id: string; displayName: string; username: string }>>([]);
  const [editorIds, setEditorIds] = useState<string[]>([]);
  const [editorFilter, setEditorFilter] = useState("");
  const [form, setForm] = useState<{ classId: string; folder: string; tags: string; scope: Material["scope"] }>({ classId: "", folder: "Tài liệu chung", tags: "", scope: "SHARED" });
  const sharedLibrary = selectedCourseId === SHARED_LIBRARY;

  /** Tổng hợp môn học từ danh mục chính, có fallback từ lớp khi vai trò không được đọc toàn bộ catalog. */
  const courseOptions = useMemo(() => {
    const byId = new Map(courses.map((course) => [course.id, course]));
    // Giảng viên được tải học liệu dùng chung cho mọi môn, kể cả môn mình không dạy lớp nào.
    const courseIds = instructor
      ? [...courses.filter((course) => course.status !== "ARCHIVED").map((course) => course.id), ...classes.map((item) => item.courseId)]
      : classes.map((item) => item.courseId);
    return [...new Set(courseIds)].map((courseId) => {
      const course = byId.get(courseId);
      const firstClass = classes.find((item) => item.courseId === courseId);
      return course ?? { id: courseId, code: firstClass?.code.split("-")[0] ?? courseId, name: firstClass?.name ?? "Môn học", description: "Tài liệu của các lớp thuộc cùng môn học.", outcomes: [], status: "PUBLISHED" as const, version: firstClass?.courseVersion ?? 1, createdAt: "", updatedAt: "" };
    });
  }, [classes, courses, instructor]);
  const selectedCourse = courseOptions.find((course) => course.id === selectedCourseId);
  const selectedClasses = useMemo(() => classes.filter((item) => item.courseId === selectedCourseId), [classes, selectedCourseId]);
  const visibleItems = items;
  const pagination = { page, pageSize, totalItems, pageItems: items, setPage, setPageSize: (size: number) => { setPageSize(size); setPage(1); } };

  /** Chỉ tải trang đang hiển thị; hủy tìm kiếm cũ để phản hồi chậm không ghi đè bộ lọc mới. */
  useEffect(() => {
    if (!allowed || !selectedCourseId) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setMaterialsLoading(true);
      try {
        const params = new URLSearchParams(selectedCourseId === SHARED_LIBRARY
          ? { scope: "SHARED", query, mimeType: mimeFilter, tag: tagFilter, page: String(page), pageSize: String(pageSize) }
          : { courseId: selectedCourseId, classId: classFilter, query, mimeType: mimeFilter, tag: tagFilter, page: String(page), pageSize: String(pageSize) });
        const result = await apiRequest<{ items: Material[]; total: number; totalPages: number }>(`/materials/search?${params}`, { roleCode: session.roleCode, signal: controller.signal });
        if (controller.signal.aborted) return;
        if (page > result.totalPages) { setPage(result.totalPages); return; }
        setItems(result.items);
        setTotalItems(result.total);
      } catch (error) {
        if (!controller.signal.aborted) {
          setItems([]);
          setTotalItems(0);
          notify(error instanceof Error ? error.message : "Không tải được học liệu.", "error");
        }
      } finally { if (!controller.signal.aborted) setMaterialsLoading(false); }
    }, 250);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [allowed, classFilter, mimeFilter, notify, page, pageSize, query, revision, selectedCourseId, session.roleCode, tagFilter]);

  /** Nạp danh mục lớp/môn; học liệu được tải riêng theo trang và bộ lọc. */
  const load = useCallback(async () => {
    if (!allowed) return;
    setLoading(true);
    try {
      const [classData, courseData] = await Promise.all([
        apiRequest<LearningClass[]>("/classes", { roleCode: session.roleCode }),
        canViewCourses ? apiRequest<Course[]>("/manager/courses", { roleCode: session.roleCode }) : Promise.resolve([]),
      ]);
      setRevision((current) => current + 1);
      setClasses(classData);
      setCourses(courseData);
      const requestedClass = classData.find((item) => item.id === searchParams.get("classId"));
      setClassFilter(requestedClass?.id ?? "");
      setSelectedCourseId((current) => requestedClass?.courseId ?? (current && (current === SHARED_LIBRARY || classData.some((item) => item.courseId === current)) ? current : classData[0]?.courseId ?? (session.roleCode === "LEARNER" ? SHARED_LIBRARY : "")));
    } catch (error) {
      notify(error instanceof Error ? error.message : "Không tải được học liệu.", "error");
    } finally {
      setLoading(false);
    }
  }, [allowed, canViewCourses, notify, searchParams, session.roleCode]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  /** Mở upload trong đúng môn đang xem và chọn sẵn lớp đầu tiên của môn đó. */
  const openUpload = () => {
    setForm((current) => ({ ...current, scope: selectedClasses.length ? current.scope : "SHARED", classId: selectedClasses.some((item) => item.id === current.classId) ? current.classId : selectedClasses[0]?.id ?? "" }));
    setOpen(true);
  };

  /** Tải tệp nguồn nếu có rồi tạo bản ghi học liệu ở trạng thái phù hợp. */
  const create = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!file) {
      notify("Cần chọn tệp học liệu từ máy.", "error");
      return;
    }
    setSaving(true);
    try {
      const body = new FormData();
      body.append("file", file);
      body.append("folder", form.folder);
      body.append("tags", form.tags);
      body.append("scope", form.scope);
      // Học liệu dùng chung gắn theo môn; học liệu riêng lớp gắn vào lớp giảng viên đang dạy.
      const uploadPath = form.scope === "SHARED" ? `/instructor/courses/${selectedCourseId}/material-uploads` : `/instructor/classes/${form.classId}/material-uploads`;
      await apiRequest(uploadPath, {
        method: "POST",
        roleCode: session.roleCode,
        body,
      });
      notify("Đã tải tệp, quét chữ ký nguy hiểm, kiểm tra checksum và áp dụng trạng thái phù hợp.");
      setFile(null);
      setOpen(false);
      await load();
    } catch (error) {
      notify(error instanceof Error ? error.message : "Không tải được học liệu.", "error");
    } finally {
      setSaving(false);
    }
  };

  /** Giảng viên ẩn học liệu đang phát hành hoặc gửi học liệu đang ẩn cho quản lý duyệt lại. */
  const toggleVisibility = async (item: Material) => {
    const hide = item.visibility === "PUBLISHED";
    try {
      await apiRequest(`/instructor/materials/${item.id}`, {
        method: "PATCH",
        roleCode: session.roleCode,
        body: JSON.stringify({ visibility: hide ? "HIDDEN" : "DRAFT" }),
      });
      notify(hide ? "Đã ẩn học liệu." : "Đã gửi học liệu cho quản lý duyệt.");
      await load();
    } catch (error) {
      notify(error instanceof Error ? error.message : "Không cập nhật được.", "error");
    }
  };

  /** Người tải lên xóa hẳn học liệu cùng mọi phiên bản sau khi xác nhận. */
  const remove = async (item: Material) => {
    if (!window.confirm(`Xóa hẳn học liệu "${item.name}" cùng mọi phiên bản? Không thể hoàn tác.`)) return;
    try {
      await apiRequest(`/instructor/materials/${item.id}`, { method: "DELETE", roleCode: session.roleCode });
      notify("Đã xóa học liệu.");
      await load();
    } catch (error) {
      notify(error instanceof Error ? error.message : "Không xóa được học liệu.", "error");
    }
  };

  /** Chỉ người tải lên và người được cấp quyền mới sửa được học liệu. */
  const canEdit = (item: Material) => instructor && (item.ownerId === session.user.id || Boolean(item.editorIds?.includes(session.user.id)));

  /** Nạp danh sách giảng viên và người đang có quyền sửa rồi mở hộp thoại phân quyền. */
  const openEditors = async (item: Material) => {
    try {
      const [candidates, current] = await Promise.all([
        apiRequest<Array<{ id: string; displayName: string; username: string }>>("/instructor/material-editor-candidates", { roleCode: session.roleCode }),
        apiRequest<{ editors: Array<{ userId: string }> }>(`/instructor/materials/${item.id}/editors`, { roleCode: session.roleCode }),
      ]);
      setEditorCandidates(candidates);
      setEditorIds(current.editors.map((editor) => editor.userId));
      setEditorFilter("");
      setEditorsTarget(item);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Không tải được quyền sửa học liệu.", "error");
    }
  };

  /** Lưu danh sách giảng viên được cấp quyền sửa học liệu. */
  const saveEditors = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!editorsTarget) return;
    setSaving(true);
    try {
      await apiRequest(`/instructor/materials/${editorsTarget.id}/editors`, { method: "PUT", roleCode: session.roleCode, body: JSON.stringify({ userIds: editorIds }) });
      notify("Đã cập nhật quyền sửa học liệu.");
      setEditorsTarget(null);
      await load();
    } catch (error) {
      notify(error instanceof Error ? error.message : "Không cập nhật được quyền sửa học liệu.", "error");
    } finally {
      setSaving(false);
    }
  };

  /** Chuyển học liệu giữa dùng chung cho mọi học viên và riêng cho học viên của lớp. */
  const toggleScope = async (item: Material) => {
    const scope = item.scope === "SHARED" ? "CLASS" : "SHARED";
    try {
      await apiRequest(`/instructor/materials/${item.id}`, { method: "PATCH", roleCode: session.roleCode, body: JSON.stringify({ scope }) });
      notify(scope === "SHARED" ? "Học liệu đã chuyển sang dùng chung cho mọi học viên." : "Học liệu đã chuyển sang riêng cho học viên của lớp.");
      await load();
    } catch (error) {
      notify(error instanceof Error ? error.message : "Không cập nhật được.", "error");
    }
  };

  /** Nạp lịch sử phiên bản, kèm lịch sử kiểm duyệt cho quản lý và người có quyền sửa. */
  const showHistory = async (item: Material) => {
    const reviewPath = manager ? `/manager/materials/${item.id}/reviews` : canEdit(item) ? `/instructor/materials/${item.id}/reviews` : null;
    try {
      setHistoryTarget(item);
      const [versionData, reviewData] = await Promise.all([
        apiRequest<MaterialVersionSnapshot[]>(`/materials/${item.id}/versions`, { roleCode: session.roleCode }),
        reviewPath ? apiRequest<MaterialReview[]>(reviewPath, { roleCode: session.roleCode }) : Promise.resolve([]),
      ]);
      setVersions(versionData);
      setReviews(reviewData);
    }
    catch (error) { setHistoryTarget(null); notify(error instanceof Error ? error.message : "Không tải được lịch sử phiên bản.", "error"); }
  };
  /** Xin URL tải có thời hạn cho đúng phiên bản học liệu đã chọn. */
  const downloadVersion = async (version: MaterialVersionSnapshot) => {
    try { const access = await apiRequest<{ url: string }>(`/materials/${version.materialId}/versions/${version.version}/access`, { roleCode: session.roleCode }); await downloadApiFile(access.url, session.roleCode); notify(`Đã tải phiên bản ${version.version}.`); }
    catch (error) { notify(error instanceof Error ? error.message : "Không tải được phiên bản này.", "error"); }
  };

  /** Tải tệp thay thế và tạo phiên bản học liệu mới mà không ghi đè lịch sử. */
  const uploadVersion = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!versionTarget || !versionFile) return;
    setSaving(true);
    try {
      const body = new FormData(); body.append("file", versionFile); body.append("folder", versionTarget.folder); body.append("tags", versionTarget.tags.join(","));
      await apiRequest(`/instructor/materials/${versionTarget.id}/versions`, { method: "POST", roleCode: session.roleCode, body });
      notify("Đã tạo phiên bản học liệu mới; hệ thống giữ 3 tệp gần nhất."); setVersionTarget(null); setVersionFile(null); await load();
    } catch (error) { notify(error instanceof Error ? error.message : "Không tải được phiên bản mới.", "error"); }
    finally { setSaving(false); }
  };

  /** Gửi quyết định duyệt hoặc thu hồi cùng lý do cho học liệu. */
  const review = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!reviewTarget) return;
    try {
      await apiRequest(`/manager/materials/${reviewTarget.id}/review`, {
        method: "PATCH",
        roleCode: session.roleCode,
        body: JSON.stringify({ action: reviewAction, reason: reviewReason || undefined }),
      });
      notify(reviewAction === "APPROVE" ? "Đã duyệt học liệu." : "Đã thu hồi học liệu và thông báo người đăng.");
      setReviewTarget(null);
      setReviewReason("");
      await load();
    } catch (error) {
      notify(error instanceof Error ? error.message : "Không kiểm duyệt được học liệu.", "error");
    }
  };

  /** Lấy URL tải xuống an toàn và kích hoạt tải tệp với tên máy chủ cung cấp. */
  const download = async (item: Material) => {
    try {
      const access = await apiRequest<{ url: string; expiresAt: string }>(`/materials/${item.id}/access`, { roleCode: session.roleCode });
      await downloadApiFile(access.url, session.roleCode);
      notify(`Đã tải ${item.name}; liên kết vừa dùng có thời hạn năm phút.`);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Không tải được học liệu.", "error");
    }
  };

  /** Lấy URL xem trước và mở viewer nội bộ để người dùng có nút đóng/quay lại rõ ràng. */
  const preview = async (item: Material) => {
    try {
      const access = await apiRequest<{ url: string; expiresAt: string }>(`/materials/${item.id}/access?action=PREVIEW`, { roleCode: session.roleCode });
      await previewApiFile(access.url, session.roleCode, item.name);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Không mở được bản xem trước.", "error");
    }
  };

  if (!allowed) return <AccessDenied />;
  return (
    <div className="mx-auto max-w-7xl px-4 py-4 sm:px-6 sm:py-5 lg:px-8">
      <PageHeader
        title="Kho học liệu"
        description="Tài liệu được quản lý theo môn học, sau đó theo từng lớp triển khai — không còn một danh sách trộn lẫn."
        actions={instructor ? <Button disabled={!selectedCourse || sharedLibrary} onClick={openUpload}><Plus size={17} />Thêm vào môn này</Button> : undefined}
      />
      <SectionState loading={loading} empty={courseOptions.length === 0 && !learner}>
        <div className="grid gap-5 lg:grid-cols-[16rem_minmax(0,1fr)]">
          <aside aria-label="Danh sách môn học" className="self-start rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-3 shadow-xs space-y-1.5 lg:sticky lg:top-6">
            <div className="flex items-center gap-2 px-3 py-2 text-xs font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
              <BookOpen size={15} className="text-sky-600 dark:text-sky-400" />
              <span>Môn học của bạn</span>
            </div>
            {learner ? (
              <button
                aria-current={sharedLibrary ? "page" : undefined}
                className={`flex w-full items-center gap-2.5 px-3 py-2.5 rounded-xl text-left text-sm font-semibold transition-all ${
                  sharedLibrary
                    ? "bg-sky-50 dark:bg-sky-950/60 text-sky-700 dark:text-sky-300 border border-sky-200/80 dark:border-sky-800/60 shadow-2xs"
                    : "text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800/50 hover:text-slate-900 dark:hover:text-slate-100"
                }`}
                onClick={() => { setSelectedCourseId(SHARED_LIBRARY); setClassFilter(""); pagination.setPage(1); }}
                type="button"
              >
                <Library size={16} />
                Thư viện chung
              </button>
            ) : null}
            {courseOptions.map((course) => {
              const active = selectedCourseId === course.id;
              return (
                <button
                  key={course.id}
                  aria-current={active ? "page" : undefined}
                  className={`group flex w-full flex-col items-start gap-1 rounded-xl px-3.5 py-3 text-left transition-all ${
                    active
                      ? "bg-sky-50 dark:bg-sky-950/60 text-sky-900 dark:text-sky-100 border border-sky-200/80 dark:border-sky-800/60 shadow-2xs"
                      : "text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800/50 hover:text-slate-900 dark:hover:text-slate-100"
                  }`}
                  onClick={() => { setSelectedCourseId(course.id); setClassFilter(""); pagination.setPage(1); }}
                  type="button"
                >
                  <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-bold tracking-wide uppercase transition-colors ${
                    active
                      ? "bg-sky-200/70 dark:bg-sky-900/60 text-sky-800 dark:text-sky-200"
                      : "bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 group-hover:text-slate-700 dark:group-hover:text-slate-200"
                  }`}>
                    {course.code}
                  </span>
                  <span className="font-semibold text-sm leading-snug line-clamp-2">
                    {course.name}
                  </span>
                </button>
              );
            })}
          </aside>
          <section aria-busy={materialsLoading} aria-labelledby="selected-course-title" className="min-w-0">
            <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-6 shadow-xs flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              {sharedLibrary ? (
                <div className="max-w-2xl">
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-sky-50 dark:bg-sky-950/40 px-2.5 py-0.5 text-xs font-semibold text-sky-700 dark:text-sky-300 border border-sky-200/80 dark:border-sky-800/60">
                    Toàn bộ học viên
                  </span>
                  <h2 className="mt-2 text-xl sm:text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100" id="selected-course-title">
                    Thư viện chung
                  </h2>
                  <p className="mt-1 text-xs sm:text-sm leading-relaxed text-slate-500 dark:text-slate-400">
                    Học liệu dùng chung cho mọi học viên, thuộc mọi môn học.
                  </p>
                </div>
              ) : (
                <div className="max-w-2xl">
                  <div className="inline-flex items-center gap-1.5 rounded-full bg-sky-50 dark:bg-sky-950/40 px-2.5 py-0.5 text-xs font-semibold text-sky-700 dark:text-sky-300 border border-sky-200/80 dark:border-sky-800/60">
                    <Layers3 size={13} />
                    {selectedClasses.length} lớp triển khai
                  </div>
                  <h2 className="mt-2 text-xl sm:text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100" id="selected-course-title">
                    {selectedCourse?.name ?? "Chọn môn học"}
                  </h2>
                  <p className="mt-1 text-xs sm:text-sm leading-relaxed text-slate-500 dark:text-slate-400">
                    {selectedCourse?.description}
                  </p>
                </div>
              )}
              <div className="flex shrink-0 items-center gap-2 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-800 px-3.5 py-2">
                <span className="text-xs text-slate-400 dark:text-slate-500">Tổng cộng:</span>
                <span className="text-sm font-bold text-sky-600 dark:text-sky-400 tabular-nums">
                  {totalItems} tài liệu
                </span>
              </div>
            </div>
            <div className="my-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-3.5 shadow-xs grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <div className="relative sm:col-span-2 xl:col-span-1">
                <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                <input
                  aria-label="Tìm học liệu"
                  maxLength={255}
                  className={`${inputClass} pl-10 h-10 text-sm`}
                  placeholder="Tìm trong môn này…"
                  value={query}
                  onChange={(event) => { setQuery(event.target.value); pagination.setPage(1); }}
                />
              </div>
              {sharedLibrary ? null : (
                <select
                  aria-label="Lọc theo lớp"
                  className={`${inputClass} h-10 text-sm`}
                  value={classFilter}
                  onChange={(event) => { setClassFilter(event.target.value); pagination.setPage(1); }}
                >
                  <option value="">Tất cả lớp của môn</option>
                  {selectedClasses.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.code} — {item.name}
                    </option>
                  ))}
                </select>
              )}
              <select
                aria-label="Lọc theo loại tệp"
                className={`${inputClass} h-10 text-sm`}
                value={mimeFilter}
                onChange={(event) => { setMimeFilter(event.target.value); pagination.setPage(1); }}
              >
                <option value="">Tất cả loại tệp</option>
                <option value="application/pdf">PDF</option>
                <option value="application/msword">Word DOC</option>
                <option value="application/vnd.openxmlformats-officedocument.wordprocessingml.document">Word DOCX</option>
                <option value="video/mp4">Video MP4</option>
                <option value="image/png">Ảnh PNG</option>
                <option value="image/jpeg">Ảnh JPEG</option>
              </select>
              <input
                maxLength={255}
                aria-label="Lọc theo thẻ"
                className={`${inputClass} h-10 text-sm`}
                placeholder="Thẻ chính xác, ví dụ api"
                value={tagFilter}
                onChange={(event) => { setTagFilter(event.target.value); pagination.setPage(1); }}
              />
            </div>
            {materialsLoading ? (
              <div className="py-16 text-center text-sm font-semibold text-slate-500">Đang tải dữ liệu…</div>
            ) : visibleItems.length ? (
              <div className="space-y-3.5">
                {pagination.pageItems.map((item) => (
                  <article
                    key={item.id}
                    className="group rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-5 shadow-xs hover:border-sky-300 dark:hover:border-sky-700 hover:shadow-md transition-all flex flex-col gap-4 2xl:flex-row 2xl:items-center 2xl:justify-between"
                  >
                    <div className="flex min-w-0 items-start gap-4">
                      <div className="grid size-11 shrink-0 place-items-center rounded-xl bg-sky-50 dark:bg-sky-950/60 border border-sky-100 dark:border-sky-900/50 text-sky-600 dark:text-sky-400 transition-colors group-hover:scale-105">
                        <FileText size={22} />
                      </div>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="font-bold text-base text-slate-900 dark:text-slate-100 leading-snug">
                            {item.name}
                          </h3>
                          <StatusBadge status={materialStatus(item.visibility)} />
                          <span className="inline-flex items-center rounded-md bg-slate-100 dark:bg-slate-800 px-2 py-0.5 text-[11px] font-semibold text-slate-600 dark:text-slate-300">
                            {item.scope === "SHARED" ? "Dùng chung" : "Riêng lớp"}
                          </span>
                        </div>
                        {item.quarantinedAt ? (
                          <p className="mt-2 rounded-lg bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/50 px-3 py-1.5 text-xs font-semibold text-rose-700 dark:text-rose-300">
                            Đã cách ly · {item.quarantineReason}
                          </p>
                        ) : null}
                        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-slate-500 dark:text-slate-400">
                          {classes.some((classItem) => classItem.id === item.classId) ? (
                            <span className="font-semibold text-sky-600 dark:text-sky-400">
                              {classes.find((classItem) => classItem.id === item.classId)?.code}
                            </span>
                          ) : null}
                          <span className="flex items-center gap-1">
                            <FolderOpen size={13} className="text-slate-400" />
                            {item.folder}
                          </span>
                          <span>
                            Phiên bản {item.version} · {(item.sizeBytes / 1024).toFixed(1)} KB
                          </span>
                          {item.tags.map((tag) => (
                            <span
                              key={tag}
                              className="rounded-md bg-slate-50 dark:bg-slate-800/60 border border-slate-200/60 dark:border-slate-800 px-2 py-0.5 text-[10px] font-medium text-slate-500 dark:text-slate-400"
                            >
                              #{tag}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5 2xl:justify-end border-t 2xl:border-t-0 border-slate-100 dark:border-slate-800/60 pt-3 2xl:pt-0">
                      <Button disabled={Boolean(item.quarantinedAt)} onClick={() => void preview(item)} variant="secondary" className="h-8 text-xs px-2.5">
                        <Eye size={13} />
                        Xem
                      </Button>
                      {instructor && ["application/pdf", "image/png", "image/jpeg", "image/webp"].includes(item.mimeType) && item.sizeBytes <= 12 * 1024 * 1024 ? (
                        <Button disabled={Boolean(item.quarantinedAt)} onClick={() => setAiTarget(item)} variant="ghost" className="h-8 text-xs px-2.5">
                          Hỏi AI
                        </Button>
                      ) : null}
                      {session.roleCode === "LEARNER" && item.visibility === "PUBLISHED" ? (
                        <Button disabled={Boolean(item.quarantinedAt)} onClick={() => setStudyTarget(item)} variant="ghost" className="h-8 text-xs px-2.5">
                          Bộ ôn tập
                        </Button>
                      ) : null}
                      <Button disabled={Boolean(item.quarantinedAt)} onClick={() => void download(item)} variant="ghost" className="h-8 text-xs px-2.5">
                        <Download size={13} />
                        Tải
                      </Button>
                      <Button onClick={() => void showHistory(item)} variant="ghost" className="h-8 text-xs px-2.5">
                        <History size={13} />
                        Lịch sử
                      </Button>
                      {canEdit(item) ? (
                        <Button onClick={() => { setVersionTarget(item); setVersionFile(null); }} variant="ghost" className="h-8 text-xs px-2.5">
                          <UploadCloud size={13} />
                          Bản mới
                        </Button>
                      ) : null}
                      {canEdit(item) && item.visibility !== "DRAFT" ? (
                        <Button disabled={Boolean(item.quarantinedAt)} onClick={() => void toggleVisibility(item)} variant="ghost" className="h-8 text-xs px-2.5">
                          {item.visibility === "PUBLISHED" ? "Ẩn" : "Gửi duyệt"}
                        </Button>
                      ) : null}
                      {canEdit(item) && item.classId ? (
                        <Button onClick={() => void toggleScope(item)} variant="ghost" className="h-8 text-xs px-2.5">
                          {item.scope === "SHARED" ? "Đặt riêng lớp" : "Dùng chung"}
                        </Button>
                      ) : null}
                      {instructor && item.ownerId === session.user.id ? (
                        <Button onClick={() => void openEditors(item)} variant="ghost" className="h-8 text-xs px-2.5">
                          <UserCog size={13} />
                          Quyền sửa
                        </Button>
                      ) : null}
                      {instructor && item.ownerId === session.user.id ? (
                        <Button onClick={() => void remove(item)} variant="ghost" className="h-8 text-xs px-2.5 text-rose-600 hover:text-rose-700 dark:text-rose-400">
                          <Trash2 size={13} />
                          Xóa
                        </Button>
                      ) : null}
                      {manager ? (
                        <Button onClick={() => { setReviewTarget(item); setReviewAction(item.visibility === "PUBLISHED" ? "REVOKE" : "APPROVE"); }} variant="ghost" className="h-8 text-xs px-2.5">
                          Kiểm duyệt
                        </Button>
                      ) : null}
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <div className="rounded-2xl border border-dashed border-slate-200 dark:border-slate-800 bg-white/50 dark:bg-slate-900/50 py-14 text-center">
                <FileText className="mx-auto text-slate-300 dark:text-slate-600" size={32} />
                <p className="mt-3 font-semibold text-slate-800 dark:text-slate-200">
                  Chưa có tài liệu phù hợp trong môn này
                </p>
                <p className="mt-1 text-xs text-slate-400">
                  Đổi bộ lọc hoặc tải tài liệu vào một lớp thuộc môn học.
                </p>
                {instructor && selectedCourse ? (
                  <Button className="mt-4" onClick={openUpload} variant="secondary">
                    <Plus size={15} />
                    Thêm học liệu
                  </Button>
                ) : null}
              </div>
            )}
            <Pagination itemLabel="học liệu" onPageChange={pagination.setPage} onPageSizeChange={pagination.setPageSize} page={pagination.page} pageSize={pagination.pageSize} totalItems={pagination.totalItems} />
          </section>
        </div>
      </SectionState>
      {aiTarget ? <MaterialAiDialog key={`${aiTarget.id}:${aiTarget.version}`} material={aiTarget} onClose={() => setAiTarget(null)} /> : null}
      {studyTarget ? <LearnerStudyDialog key={studyTarget.id} material={studyTarget} onClose={() => setStudyTarget(null)} /> : null}
      <Modal open={open} onClose={() => setOpen(false)} title="Tải học liệu từ máy" description="Backend kiểm tra MIME, quota, kích thước và checksum trước khi lưu.">
        <form className="space-y-4" onSubmit={(event) => void create(event)}>
          <Field label="Môn học"><div className="rounded-xl bg-[var(--surface-muted)] px-4 py-3 text-sm font-bold text-[var(--ink)]">{selectedCourse ? `${selectedCourse.code} — ${selectedCourse.name}` : "Chưa chọn môn học"}</div></Field>
          <Field label="Phạm vi"><select className={inputClass} value={form.scope} onChange={(event) => setForm({ ...form, scope: event.target.value === "CLASS" ? "CLASS" : "SHARED" })}><option value="SHARED">Dùng chung — mọi học viên xem được</option><option disabled={!selectedClasses.length} value="CLASS">Riêng lớp — chỉ học viên của lớp</option></select></Field>
          {form.scope === "CLASS" ? <Field label="Lớp học">
            <SearchableSelect aria-label="Tìm và chọn lớp học" onChange={(value) => setForm({ ...form, classId: value })} options={selectedClasses.map((item) => ({ value: item.id, label: `${item.code} — ${item.name}`, description: item.term, keywords: item.id }))} placeholder="Gõ mã hoặc tên lớp trong môn…" value={form.classId} />
          </Field> : null}
          <Field label="Tệp học liệu">
            <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-dashed border-sky-300 bg-sky-50 p-4 text-sm font-bold text-sky-800">
              <UploadCloud size={21} />
              <span className="min-w-0 flex-1 truncate">{file?.name ?? "Chọn tệp từ máy"}</span>
              <input accept=".pdf,.doc,.docx,.mp4,.png,.jpg,.jpeg,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,video/mp4,image/png,image/jpeg" className="sr-only" onChange={(event) => setFile(event.target.files?.[0] ?? null)} required type="file" />
            </label>
            <span className="mt-1.5 block text-xs leading-5 text-[var(--ink-soft)]">Hỗ trợ PDF, Word (.doc, .docx), MP4, PNG và JPEG. Word được tải xuống để mở bằng ứng dụng tương thích.</span>
          </Field>
          <Field label="Thư mục"><input className={inputClass} required value={form.folder} onChange={(event) => setForm({ ...form, folder: event.target.value })} /></Field>
          <Field label="Thẻ — ngăn cách bằng dấu phẩy"><input className={inputClass} value={form.tags} onChange={(event) => setForm({ ...form, tags: event.target.value })} /></Field>
          {file ? <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">{file.type || "MIME không xác định"} · {(file.size / 1_000_000).toFixed(2)} MB</p> : null}
          <Button disabled={!file || (form.scope === "CLASS" && !form.classId)} loading={saving} type="submit">Tải lên và kiểm tra</Button>
        </form>
      </Modal>
      <Modal open={Boolean(editorsTarget)} onClose={() => setEditorsTarget(null)} title="Quyền sửa học liệu" description={editorsTarget?.name}>
        <form className="space-y-4" onSubmit={(event) => void saveEditors(event)}>
          <input aria-label="Tìm giảng viên" className={inputClass} placeholder="Tìm theo tên hoặc tài khoản…" value={editorFilter} onChange={(event) => setEditorFilter(event.target.value)} />
          <div className="max-h-72 divide-y divide-[var(--rule)] overflow-y-auto border-y border-[var(--rule)]">
            {editorCandidates.filter((candidate) => `${candidate.displayName} ${candidate.username}`.toLowerCase().includes(editorFilter.trim().toLowerCase())).map((candidate) => <label className="flex min-h-11 cursor-pointer items-center gap-3 px-1 text-sm" key={candidate.id}><input checked={editorIds.includes(candidate.id)} className="size-4 accent-[var(--accent)]" onChange={(event) => setEditorIds((current) => event.target.checked ? [...current, candidate.id] : current.filter((value) => value !== candidate.id))} type="checkbox" /><span className="font-semibold">{candidate.displayName}</span><span className="text-xs text-[var(--ink-muted)]">@{candidate.username}</span></label>)}
            {!editorCandidates.length ? <p className="py-4 text-sm text-[var(--ink-muted)]">Chưa có giảng viên nào khác.</p> : null}
          </div>
          <Button loading={saving} type="submit">Lưu quyền sửa</Button>
        </form>
      </Modal>
      <Modal open={Boolean(reviewTarget)} onClose={() => setReviewTarget(null)} title="Kiểm duyệt học liệu" description={reviewTarget?.name}>
        <form className="space-y-4" onSubmit={(event) => void review(event)}>
          <Field label="Hành động">
            <select className={inputClass} value={reviewAction} onChange={(event) => setReviewAction(event.target.value as typeof reviewAction)}>
              <option value="APPROVE">Duyệt và phát hành</option>
              <option value="REVOKE">Thu hồi</option>
            </select>
          </Field>
          {reviewAction !== "APPROVE" ? (
            <Field label="Lý do thu hồi">
              <div className="mb-2 flex flex-wrap gap-1.5">
                {[
                  "Nội dung cần cập nhật phiên bản mới",
                  "Học liệu chứa thông tin không chính xác",
                  "Vi phạm chính sách học liệu trung tâm",
                  "Tạm thời thu hồi theo yêu cầu bộ môn",
                ].map((reason) => (
                  <button
                    key={reason}
                    type="button"
                    onClick={() => setReviewReason(reason)}
                    className="rounded-full border border-[var(--rule)] bg-[var(--surface-muted)] px-2.5 py-1 text-xs font-medium text-[var(--ink)] hover:border-[var(--accent)] hover:text-[var(--accent)] transition-colors"
                  >
                    {reason}
                  </button>
                ))}
              </div>
              <textarea
                className={inputClass}
                minLength={5}
                placeholder="Chọn gợi ý nhanh ở trên hoặc tự nhập lý do thu hồi..."
                required
                rows={4}
                value={reviewReason}
                onChange={(event) => setReviewReason(event.target.value)}
              />
            </Field>
          ) : null}
          {reviewTarget?.quarantinedAt ? <p className="rounded-lg bg-rose-50 p-3 text-xs font-bold text-rose-700">Tệp đang cách ly và không thể được duyệt: {reviewTarget.quarantineReason}</p> : null}
          <Button disabled={Boolean(reviewTarget?.quarantinedAt && reviewAction === "APPROVE")} type="submit">Xác nhận kiểm duyệt</Button>
        </form>
      </Modal>
      <Modal open={Boolean(versionTarget)} onClose={() => setVersionTarget(null)} title="Tải phiên bản mới" description="Tệp đang dùng không bị ghi đè; phiên bản mới chờ quản lý duyệt sau khi quét.">
        <form className="space-y-4" onSubmit={(event) => void uploadVersion(event)}><Field label="Tệp thay thế"><label className="flex cursor-pointer items-center gap-3 rounded-xl border border-dashed border-[var(--accent)] bg-[var(--accent-soft)] p-4 text-sm font-bold text-[var(--accent-ink)]"><UploadCloud size={21} /><span className="min-w-0 flex-1 truncate">{versionFile?.name ?? "Chọn tệp phiên bản mới"}</span><input accept=".pdf,.doc,.docx,.mp4,.png,.jpg,.jpeg,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,video/mp4,image/png,image/jpeg" className="sr-only" onChange={(event) => setVersionFile(event.target.files?.[0] ?? null)} required type="file" /></label></Field><p className="text-xs text-[var(--ink-soft)]">Thư mục và thẻ được kế thừa từ phiên bản hiện tại. Hỗ trợ PDF, Word, MP4, PNG và JPEG; tệp vẫn phải qua quota, MIME, checksum và cách ly.</p><Button disabled={!versionFile} loading={saving} type="submit">Tạo phiên bản {versionTarget ? versionTarget.version + 1 : "mới"}</Button></form>
      </Modal>
      <Modal open={Boolean(historyTarget)} onClose={() => setHistoryTarget(null)} title="Lịch sử phiên bản" description={historyTarget?.name}>
        <div className="divide-y divide-[var(--rule)] border-y border-[var(--rule)]">{versions.map((version) => <article className="py-4" key={version.id}><div className="flex items-center justify-between"><strong>Phiên bản {version.version}</strong><StatusBadge status={materialStatus(version.visibility)} /></div><p className="mt-2 text-sm font-bold">{version.name}</p><div className="mt-1 flex flex-wrap items-center justify-between gap-2"><p className="text-xs text-slate-500">{version.folder} · {(version.sizeBytes / 1024).toFixed(1)} KB · {new Date(version.createdAt).toLocaleString(activeLocale())}</p><Button className="px-3 text-xs" onClick={() => void downloadVersion(version)} variant="ghost"><Download size={13} />Tải bản này</Button></div></article>)}</div>
        {historyTarget && (manager || canEdit(historyTarget)) ? <section className="mt-6"><h3 className="text-sm font-extrabold">Lịch sử kiểm duyệt</h3>{reviews.length ? <div className="mt-2 divide-y divide-[var(--rule)] border-y border-[var(--rule)]">{reviews.map((item) => <article className="py-3" key={item.id}><div className="flex items-center justify-between gap-2"><strong className="text-sm">{REVIEW_LABELS[item.action]}</strong><span className="text-xs text-slate-500">{new Date(item.createdAt).toLocaleString(activeLocale())}</span></div>{item.reason ? <p className="mt-1 text-sm text-[var(--ink-soft)]">{item.reason}</p> : null}</article>)}</div> : <p className="mt-2 text-sm text-[var(--ink-muted)]">Chưa có quyết định kiểm duyệt.</p>}</section> : null}
      </Modal>
    </div>
  );
}
