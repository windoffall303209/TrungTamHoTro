"use client";

import { activeLocale } from "@/i18n/runtime";

import { BookOpen, Download, Eye, FileText, FolderOpen, History, Layers3, Plus, Search, UploadCloud } from "lucide-react";
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
import type { Course, LearningClass, Material, MaterialVersionSnapshot } from "@/lib/learning-types";
import { useApp } from "@/providers/app-provider";
import { hasPermission } from "@/lib/access-control";

/** Điều phối tạo, phiên bản hóa, duyệt, xem trước và tải xuống học liệu. */
export default function MaterialsPage() {
  const { session, notify } = useApp();
  const searchParams = useSearchParams();
  const allowed = ["SYSTEM_ADMIN", "CENTER_MANAGER", "INSTRUCTOR", "LEARNER"].includes(session.roleCode);
  const manager = ["SYSTEM_ADMIN", "CENTER_MANAGER"].includes(session.roleCode) && hasPermission(session, "class:manage");
  const instructor = session.roleCode === "INSTRUCTOR" && hasPermission(session, "material:manage");
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
  const [historyTarget, setHistoryTarget] = useState<Material | null>(null);
  const [reviewTarget, setReviewTarget] = useState<Material | null>(null);
  const [aiTarget, setAiTarget] = useState<Material | null>(null);
  const [studyTarget, setStudyTarget] = useState<Material | null>(null);
  const [reviewAction, setReviewAction] = useState<"APPROVE" | "HIDE" | "REQUEST_CHANGES">("APPROVE");
  const [reviewReason, setReviewReason] = useState("");
  const [form, setForm] = useState({ classId: "", folder: "Tài liệu chung", tags: "" });

  /** Tổng hợp môn học từ danh mục chính, có fallback từ lớp khi vai trò không được đọc toàn bộ catalog. */
  const courseOptions = useMemo(() => {
    const byId = new Map(courses.map((course) => [course.id, course]));
    return [...new Set(classes.map((item) => item.courseId))].map((courseId) => {
      const course = byId.get(courseId);
      const firstClass = classes.find((item) => item.courseId === courseId);
      return course ?? { id: courseId, code: firstClass?.code.split("-")[0] ?? courseId, name: firstClass?.name ?? "Môn học", description: "Tài liệu của các lớp thuộc cùng môn học.", outcomes: [], status: "PUBLISHED" as const, version: firstClass?.courseVersion ?? 1, createdAt: "", updatedAt: "" };
    });
  }, [classes, courses]);
  const selectedCourse = courseOptions.find((course) => course.id === selectedCourseId);
  const selectedClasses = useMemo(() => classes.filter((item) => item.courseId === selectedCourseId), [classes, selectedCourseId]);
  const visibleItems = items;
  const pagination = { page, pageSize, totalItems, pageItems: items, setPage, setPageSize: (size: number) => { setPageSize(size); setPage(1); } };

  /** Fetch only the visible page; cancel stale searches so slow responses cannot replace newer filters. */
  useEffect(() => {
    if (!allowed || !selectedCourseId) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setMaterialsLoading(true);
      try {
        const params = new URLSearchParams({ courseId: selectedCourseId, classId: classFilter, query, mimeType: mimeFilter, tag: tagFilter, page: String(page), pageSize: String(pageSize) });
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
      setSelectedCourseId((current) => requestedClass?.courseId ?? (current && classData.some((item) => item.courseId === current) ? current : classData[0]?.courseId ?? ""));
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
    setForm((current) => ({ ...current, classId: selectedClasses.some((item) => item.id === current.classId) ? current.classId : selectedClasses[0]?.id ?? "" }));
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
      await apiRequest(`/instructor/classes/${form.classId}/material-uploads`, {
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

  /** Gửi học liệu vào quy trình duyệt hoặc xuất bản ngay theo cấu hình hệ thống. */
  const publish = async (item: Material) => {
    try {
      await apiRequest(`/instructor/materials/${item.id}`, {
        method: "PATCH",
        roleCode: session.roleCode,
        body: JSON.stringify({ visibility: item.visibility === "PUBLISHED" ? "HIDDEN" : "PUBLISHED" }),
      });
      notify(item.visibility === "PUBLISHED" ? "Đã ẩn học liệu." : "Đã công khai học liệu.");
      await load();
    } catch (error) {
      notify(error instanceof Error ? error.message : "Không cập nhật được.", "error");
    }
  };

  /** Nạp lịch sử phiên bản của học liệu và mở bảng chi tiết. */
  const showHistory = async (item: Material) => {
    try { setHistoryTarget(item); setVersions(await apiRequest<MaterialVersionSnapshot[]>(`/materials/${item.id}/versions`, { roleCode: session.roleCode })); }
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
      notify("Đã tạo phiên bản học liệu mới; bản cũ vẫn được giữ nguyên."); setVersionTarget(null); setVersionFile(null); await load();
    } catch (error) { notify(error instanceof Error ? error.message : "Không tải được phiên bản mới.", "error"); }
    finally { setSaving(false); }
  };

  /** Gửi quyết định duyệt/từ chối cùng ghi chú cho học liệu đang chờ. */
  const review = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!reviewTarget) return;
    try {
      await apiRequest(`/manager/materials/${reviewTarget.id}/review`, {
        method: "PATCH",
        roleCode: session.roleCode,
        body: JSON.stringify({ action: reviewAction, reason: reviewReason || undefined }),
      });
      notify(reviewAction === "APPROVE" ? "Đã duyệt học liệu." : reviewAction === "HIDE" ? "Đã ẩn học liệu và thông báo người đăng." : "Đã yêu cầu giảng viên chỉnh sửa.");
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
    <div className="mx-auto max-w-7xl px-5 py-8 md:px-8 md:py-10">
      <PageHeader
        eyebrow="Content Repository"
        title="Kho học liệu"
        description="Tài liệu được quản lý theo môn học, sau đó theo từng lớp triển khai — không còn một danh sách trộn lẫn."
        actions={instructor ? <Button disabled={!selectedClasses.length} onClick={openUpload}><Plus size={17} />Thêm vào môn này</Button> : undefined}
      />
      <SectionState loading={loading} empty={courseOptions.length === 0}>
        <div className="grid gap-8 lg:grid-cols-[17rem_minmax(0,1fr)]">
          <aside aria-label="Danh sách môn học" className="self-start border-y border-[var(--rule-strong)] lg:sticky lg:top-6">
            <div className="flex items-center gap-2 border-b border-[var(--rule)] px-4 py-3 text-sm font-extrabold text-[var(--ink)]"><BookOpen size={17} />Môn học của bạn</div>
            {courseOptions.map((course) => {
              const active = selectedCourseId === course.id;
              return <button aria-current={active ? "page" : undefined} className={`group flex w-full items-start justify-between gap-3 border-b border-[var(--rule)] px-4 py-4 text-left last:border-b-0 ${active ? "bg-[var(--ink)] text-white" : "bg-[var(--surface)]/65 hover:bg-[var(--surface-muted)]"}`} key={course.id} onClick={() => { setSelectedCourseId(course.id); setClassFilter(""); pagination.setPage(1); }} type="button">
                <span className="min-w-0"><span className={`block text-xs font-extrabold ${active ? "text-white/65" : "text-[var(--accent-ink)]"}`}>{course.code}</span><span className="mt-1 block font-heading text-base font-extrabold leading-snug">{course.name}</span></span>              </button>;
            })}
          </aside>
          <section aria-busy={materialsLoading} aria-labelledby="selected-course-title" className="min-w-0">
            <div className="flex flex-col gap-4 border-b border-[var(--rule-strong)] pb-5 sm:flex-row sm:items-end sm:justify-between">
              <div className="max-w-2xl"><div className="flex items-center gap-2 text-xs font-extrabold text-[var(--accent-ink)]"><Layers3 size={15} />{selectedClasses.length} lớp triển khai</div><h2 className="mt-2 font-heading text-2xl font-extrabold tracking-tight" id="selected-course-title">{selectedCourse?.name ?? "Chọn môn học"}</h2><p className="mt-2 text-sm leading-6 text-[var(--ink-soft)]">{selectedCourse?.description}</p></div>
              <p className="text-sm font-bold tabular-nums text-[var(--ink-muted)]">{totalItems} tài liệu</p>
            </div>
            <div className="my-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <div className="relative md:col-span-2 xl:col-span-1"><Search className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--ink-muted)]" size={17} /><input className={`${inputClass} pl-10`} placeholder="Tìm trong môn này…" value={query} onChange={(event) => { setQuery(event.target.value); pagination.setPage(1); }} /></div>
              <select aria-label="Lọc theo lớp" className={inputClass} value={classFilter} onChange={(event) => { setClassFilter(event.target.value); pagination.setPage(1); }}><option value="">Tất cả lớp của môn</option>{selectedClasses.map((item) => <option key={item.id} value={item.id}>{item.code} — {item.name}</option>)}</select>
              <select aria-label="Lọc theo loại tệp" className={inputClass} value={mimeFilter} onChange={(event) => { setMimeFilter(event.target.value); pagination.setPage(1); }}><option value="">Tất cả loại tệp</option><option value="application/pdf">PDF</option><option value="application/msword">Word DOC</option><option value="application/vnd.openxmlformats-officedocument.wordprocessingml.document">Word DOCX</option><option value="video/mp4">Video MP4</option><option value="image/png">Ảnh PNG</option><option value="image/jpeg">Ảnh JPEG</option></select>
              <input aria-label="Lọc theo thẻ" className={inputClass} placeholder="Thẻ chính xác, ví dụ api" value={tagFilter} onChange={(event) => { setTagFilter(event.target.value); pagination.setPage(1); }} />
            </div>
            {materialsLoading ? <p role="status">Đang tải dữ liệu…</p> : visibleItems.length ? <div className="border-y border-[var(--rule-strong)] bg-[var(--surface)]/65">
          {pagination.pageItems.map((item) => (
            <article className="grid gap-4 border-b border-[var(--rule)] px-5 py-5 last:border-b-0 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center" key={item.id}>
              <div className="flex min-w-0 gap-4">
                <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-sky-50 text-sky-700"><FileText size={20} /></div>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="font-heading text-lg font-extrabold">{item.name}</h2>
                    <StatusBadge status={item.visibility} />
                  </div>
                  {item.quarantinedAt ? <p className="mt-2 rounded-lg bg-rose-50 px-3 py-2 text-xs font-bold text-rose-700">Đã cách ly · {item.quarantineReason}</p> : null}
                  <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs font-semibold text-slate-500">
                    <span>{classes.find((classItem) => classItem.id === item.classId)?.code ?? item.classId}</span>
                    <span className="flex items-center gap-1.5"><FolderOpen size={14} />{item.folder}</span>
                    <span>Phiên bản {item.version} · {(item.sizeBytes / 1024).toFixed(1)} KB</span>
                    {item.tags.map((tag) => <span className="rounded-md bg-slate-100 px-2 py-1 text-[10px] font-bold text-slate-600" key={tag}>#{tag}</span>)}
                  </div>
                </div>
              </div>
              <div className="flex flex-wrap gap-1 lg:justify-end">
                  <Button disabled={Boolean(item.quarantinedAt)} onClick={() => void preview(item)} variant="ghost"><Eye size={14} />Xem</Button>
                  {instructor && ["application/pdf", "image/png", "image/jpeg", "image/webp"].includes(item.mimeType) && item.sizeBytes <= 12 * 1024 * 1024 ? <Button disabled={Boolean(item.quarantinedAt)} onClick={() => setAiTarget(item)} variant="ghost">Hỏi AI</Button> : null}
                  {session.roleCode === "LEARNER" && item.visibility === "PUBLISHED" ? <Button disabled={Boolean(item.quarantinedAt)} onClick={() => setStudyTarget(item)} variant="ghost">Bộ ôn tập</Button> : null}
                  <Button disabled={Boolean(item.quarantinedAt)} onClick={() => void download(item)} variant="ghost"><Download size={14} />Tải</Button>
                  <Button onClick={() => void showHistory(item)} variant="ghost"><History size={14} />Lịch sử</Button>
                  {instructor ? <Button onClick={() => { setVersionTarget(item); setVersionFile(null); }} variant="ghost"><UploadCloud size={14} />Bản mới</Button> : null}
                  {instructor ? <Button disabled={Boolean(item.quarantinedAt)} onClick={() => void publish(item)} variant="ghost">{item.visibility === "PUBLISHED" ? "Ẩn" : "Công khai"}</Button> : null}
                  {manager ? <Button onClick={() => { setReviewTarget(item); setReviewAction(item.visibility === "PUBLISHED" ? "HIDE" : "APPROVE"); }} variant="ghost">Kiểm duyệt</Button> : null}
              </div>
            </article>
          ))}
            </div> : <div className="border-y border-[var(--rule-strong)] py-12 text-center"><FileText className="mx-auto text-[var(--ink-muted)]" size={28} /><p className="mt-3 font-bold text-[var(--ink)]">Chưa có tài liệu phù hợp trong môn này</p><p className="mt-1 text-sm text-[var(--ink-soft)]">Đổi bộ lọc hoặc tải tài liệu vào một lớp thuộc môn học.</p>{instructor && selectedClasses.length ? <Button className="mt-4" onClick={openUpload} variant="secondary"><Plus size={16} />Thêm học liệu</Button> : null}</div>}
            <Pagination itemLabel="học liệu" onPageChange={pagination.setPage} onPageSizeChange={pagination.setPageSize} page={pagination.page} pageSize={pagination.pageSize} totalItems={pagination.totalItems} />
          </section>
        </div>
      </SectionState>
      {aiTarget ? <MaterialAiDialog key={`${aiTarget.id}:${aiTarget.version}`} material={aiTarget} onClose={() => setAiTarget(null)} /> : null}
      {studyTarget ? <LearnerStudyDialog key={studyTarget.id} material={studyTarget} onClose={() => setStudyTarget(null)} /> : null}
      <Modal open={open} onClose={() => setOpen(false)} title="Tải học liệu từ máy" description="Backend kiểm tra MIME, quota, kích thước và checksum trước khi lưu.">
        <form className="space-y-4" onSubmit={(event) => void create(event)}>
          <Field label="Môn học"><div className="rounded-xl bg-[var(--surface-muted)] px-4 py-3 text-sm font-bold text-[var(--ink)]">{selectedCourse ? `${selectedCourse.code} — ${selectedCourse.name}` : "Chưa chọn môn học"}</div></Field>
          <Field label="Lớp học">
            <SearchableSelect aria-label="Tìm và chọn lớp học" onChange={(value) => setForm({ ...form, classId: value })} options={selectedClasses.map((item) => ({ value: item.id, label: `${item.code} — ${item.name}`, description: item.term, keywords: item.id }))} placeholder="Gõ mã hoặc tên lớp trong môn…" value={form.classId} />
          </Field>
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
          <Button disabled={!file || !form.classId} loading={saving} type="submit">Tải lên và kiểm tra</Button>
        </form>
      </Modal>
      <Modal open={Boolean(reviewTarget)} onClose={() => setReviewTarget(null)} title="Kiểm duyệt học liệu" description={reviewTarget?.name}>
        <form className="space-y-4" onSubmit={(event) => void review(event)}>
          <Field label="Hành động">
            <select className={inputClass} value={reviewAction} onChange={(event) => setReviewAction(event.target.value as typeof reviewAction)}>
              <option value="APPROVE">Duyệt và phát hành</option>
              <option value="HIDE">Ẩn học liệu</option>
              <option value="REQUEST_CHANGES">Yêu cầu chỉnh sửa</option>
            </select>
          </Field>
          {reviewAction !== "APPROVE" ? <Field label="Lý do"><textarea className={inputClass} minLength={5} required rows={4} value={reviewReason} onChange={(event) => setReviewReason(event.target.value)} /></Field> : null}
          {reviewTarget?.quarantinedAt ? <p className="rounded-lg bg-rose-50 p-3 text-xs font-bold text-rose-700">Tệp đang cách ly và không thể được duyệt: {reviewTarget.quarantineReason}</p> : null}
          <Button disabled={Boolean(reviewTarget?.quarantinedAt && reviewAction === "APPROVE")} type="submit">Xác nhận kiểm duyệt</Button>
        </form>
      </Modal>
      <Modal open={Boolean(versionTarget)} onClose={() => setVersionTarget(null)} title="Tải phiên bản mới" description="Tệp đang dùng không bị ghi đè; phiên bản mới bắt đầu ở trạng thái nháp sau khi quét.">
        <form className="space-y-4" onSubmit={(event) => void uploadVersion(event)}><Field label="Tệp thay thế"><label className="flex cursor-pointer items-center gap-3 rounded-xl border border-dashed border-[var(--accent)] bg-[var(--accent-soft)] p-4 text-sm font-bold text-[var(--accent-ink)]"><UploadCloud size={21} /><span className="min-w-0 flex-1 truncate">{versionFile?.name ?? "Chọn tệp phiên bản mới"}</span><input accept=".pdf,.doc,.docx,.mp4,.png,.jpg,.jpeg,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,video/mp4,image/png,image/jpeg" className="sr-only" onChange={(event) => setVersionFile(event.target.files?.[0] ?? null)} required type="file" /></label></Field><p className="text-xs text-[var(--ink-soft)]">Thư mục và thẻ được kế thừa từ phiên bản hiện tại. Hỗ trợ PDF, Word, MP4, PNG và JPEG; tệp vẫn phải qua quota, MIME, checksum và cách ly.</p><Button disabled={!versionFile} loading={saving} type="submit">Tạo phiên bản {versionTarget ? versionTarget.version + 1 : "mới"}</Button></form>
      </Modal>
      <Modal open={Boolean(historyTarget)} onClose={() => setHistoryTarget(null)} title="Lịch sử phiên bản" description={historyTarget?.name}>
        <div className="divide-y divide-[var(--rule)] border-y border-[var(--rule)]">{versions.map((version) => <article className="py-4" key={version.id}><div className="flex items-center justify-between"><strong>Phiên bản {version.version}</strong><StatusBadge status={version.visibility} /></div><p className="mt-2 text-sm font-bold">{version.name}</p><div className="mt-1 flex flex-wrap items-center justify-between gap-2"><p className="text-xs text-slate-500">{version.folder} · {(version.sizeBytes / 1024).toFixed(1)} KB · {new Date(version.createdAt).toLocaleString(activeLocale())}</p><Button className="px-3 text-xs" onClick={() => void downloadVersion(version)} variant="ghost"><Download size={13} />Tải bản này</Button></div></article>)}</div>
      </Modal>
    </div>
  );
}
