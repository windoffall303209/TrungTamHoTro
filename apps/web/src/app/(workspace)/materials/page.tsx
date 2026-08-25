"use client";

import { Download, Eye, FileText, FolderOpen, Plus, Search, UploadCloud } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { PageHeader } from "@/components/page-header";
import { SectionState } from "@/components/section-state";
import { Button, Field, inputClass, Modal, StatusBadge } from "@/components/ui";
import { apiRequest, downloadApiFile, previewApiFile } from "@/lib/api-client";
import type { LearningClass, Material } from "@/lib/learning-types";
import { useApp } from "@/providers/app-provider";

export default function MaterialsPage() {
  const { session, notify } = useApp();
  const instructor = session.roleCode === "INSTRUCTOR";
  const manager = session.roleCode === "CENTER_MANAGER";
  const learner = session.roleCode === "LEARNER";
  const [items, setItems] = useState<Material[]>([]);
  const [classes, setClasses] = useState<LearningClass[]>([]);
  const [query, setQuery] = useState("");
  const [classFilter, setClassFilter] = useState("");
  const [mimeFilter, setMimeFilter] = useState("");
  const [tagFilter, setTagFilter] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [reviewTarget, setReviewTarget] = useState<Material | null>(null);
  const [reviewAction, setReviewAction] = useState<"APPROVE" | "HIDE" | "REQUEST_CHANGES">("APPROVE");
  const [reviewReason, setReviewReason] = useState("");
  const [form, setForm] = useState({ classId: "", folder: "Tài liệu chung", tags: "" });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (query) params.set("query", query);
      if (classFilter) params.set("classId", classFilter);
      if (mimeFilter) params.set("mimeType", mimeFilter);
      if (tagFilter) params.set("tag", tagFilter);
      params.set("page", String(page));
      params.set("pageSize", "12");
      const [materialData, classData] = await Promise.all([
        learner
          ? apiRequest<{ items: Material[]; total: number; totalPages: number }>(`/learner/materials/search?${params}`, { roleCode: session.roleCode })
          : apiRequest<Material[]>(`/materials${query ? `?query=${encodeURIComponent(query)}` : ""}`, { roleCode: session.roleCode }),
        apiRequest<LearningClass[]>("/classes", { roleCode: session.roleCode }),
      ]);
      if (Array.isArray(materialData)) {
        setItems(materialData);
        setTotal(materialData.length);
        setTotalPages(1);
      } else {
        setItems(materialData.items);
        setTotal(materialData.total);
        setTotalPages(materialData.totalPages);
      }
      setClasses(classData);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Không tải được học liệu.", "error");
    } finally {
      setLoading(false);
    }
  }, [classFilter, learner, mimeFilter, notify, page, query, session.roleCode, tagFilter]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 180);
    return () => clearTimeout(timer);
  }, [load]);

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

  const download = async (item: Material) => {
    try {
      const access = await apiRequest<{ url: string; expiresAt: string }>(`/materials/${item.id}/access`, { roleCode: session.roleCode });
      await downloadApiFile(access.url, session.roleCode);
      notify(`Đã tải ${item.name}; liên kết vừa dùng có thời hạn năm phút.`);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Không tải được học liệu.", "error");
    }
  };

  const preview = async (item: Material) => {
    try {
      const access = await apiRequest<{ url: string; expiresAt: string }>(`/materials/${item.id}/access?action=PREVIEW`, { roleCode: session.roleCode });
      await previewApiFile(access.url, session.roleCode);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Không mở được bản xem trước.", "error");
    }
  };

  return (
    <div className="mx-auto max-w-7xl px-5 py-8 md:px-8 md:py-10">
      <PageHeader
        eyebrow="Content Repository"
        title="Kho học liệu"
        description="Tổ chức, tải lên và phân phối tài liệu bằng liên kết có chữ ký hết hạn."
        actions={instructor ? <Button onClick={() => setOpen(true)}><Plus size={17} />Thêm học liệu</Button> : undefined}
      />
      <div className="mb-6 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={17} />
          <input className={`${inputClass} pl-10`} placeholder="Tìm tên, thư mục…" value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} />
        </div>
        {learner ? <select aria-label="Lọc theo lớp" className={inputClass} value={classFilter} onChange={(event) => { setClassFilter(event.target.value); setPage(1); }}><option value="">Tất cả lớp đã ghi danh</option>{classes.map((item) => <option key={item.id} value={item.id}>{item.code}</option>)}</select> : null}
        {learner ? <select aria-label="Lọc theo loại tệp" className={inputClass} value={mimeFilter} onChange={(event) => { setMimeFilter(event.target.value); setPage(1); }}><option value="">Tất cả loại tệp</option><option value="application/pdf">PDF</option><option value="video/mp4">Video MP4</option><option value="image/png">Ảnh PNG</option><option value="image/jpeg">Ảnh JPEG</option></select> : null}
        {learner ? <input aria-label="Lọc theo thẻ" className={inputClass} placeholder="Thẻ chính xác, ví dụ api" value={tagFilter} onChange={(event) => { setTagFilter(event.target.value); setPage(1); }} /> : null}
      </div>
      <SectionState loading={loading} empty={items.length === 0}>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {items.map((item) => (
            <article className="rounded-2xl border border-slate-200 bg-white p-5" key={item.id}>
              <div className="flex items-start justify-between">
                <div className="grid size-10 place-items-center rounded-xl bg-sky-50 text-sky-700"><FileText size={20} /></div>
                <StatusBadge status={item.visibility} />
              </div>
              <h2 className="mt-4 font-heading text-lg font-extrabold">{item.name}</h2>
              {item.quarantinedAt ? <p className="mt-2 rounded-lg bg-rose-50 px-3 py-2 text-xs font-bold text-rose-700">Đã cách ly · {item.quarantineReason}</p> : null}
              <p className="mt-2 flex items-center gap-1.5 text-xs font-semibold text-slate-500"><FolderOpen size={14} />{item.folder}</p>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {item.tags.map((tag) => <span className="rounded-md bg-slate-100 px-2 py-1 text-[10px] font-bold text-slate-600" key={tag}>#{tag}</span>)}
              </div>
              <div className="mt-5 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-4 text-xs text-slate-500">
                <span>v{item.version} · {(item.sizeBytes / 1024).toFixed(1)} KB</span>
                <div className="flex items-center gap-1">
                  <Button disabled={Boolean(item.quarantinedAt)} onClick={() => void preview(item)} variant="ghost"><Eye size={14} />Xem</Button>
                  <Button disabled={Boolean(item.quarantinedAt)} onClick={() => void download(item)} variant="ghost"><Download size={14} />Tải</Button>
                  {instructor ? <Button disabled={Boolean(item.quarantinedAt)} onClick={() => void publish(item)} variant="ghost">{item.visibility === "PUBLISHED" ? "Ẩn" : "Công khai"}</Button> : null}
                  {manager ? <Button onClick={() => { setReviewTarget(item); setReviewAction(item.visibility === "PUBLISHED" ? "HIDE" : "APPROVE"); }} variant="ghost">Kiểm duyệt</Button> : null}
                </div>
              </div>
            </article>
          ))}
        </div>
      </SectionState>
      {learner && total > 0 ? <div className="mt-6 flex items-center justify-between rounded-xl border border-slate-200 bg-white px-4 py-3"><p className="text-sm text-slate-600">{total} học liệu · Trang {page}/{totalPages}</p><div className="flex gap-2"><Button disabled={page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))} variant="secondary">Trang trước</Button><Button disabled={page >= totalPages} onClick={() => setPage((value) => Math.min(totalPages, value + 1))} variant="secondary">Trang sau</Button></div></div> : null}
      <Modal open={open} onClose={() => setOpen(false)} title="Tải học liệu từ máy" description="Backend kiểm tra MIME, quota, kích thước và checksum trước khi lưu.">
        <form className="space-y-4" onSubmit={(event) => void create(event)}>
          <Field label="Lớp học">
            <select className={inputClass} required value={form.classId} onChange={(event) => setForm({ ...form, classId: event.target.value })}>
              <option value="">Chọn lớp</option>
              {classes.map((item) => <option key={item.id} value={item.id}>{item.code} — {item.name}</option>)}
            </select>
          </Field>
          <Field label="Tệp học liệu">
            <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-dashed border-sky-300 bg-sky-50 p-4 text-sm font-bold text-sky-800">
              <UploadCloud size={21} />
              <span className="min-w-0 flex-1 truncate">{file?.name ?? "Chọn tệp từ máy"}</span>
              <input className="sr-only" onChange={(event) => setFile(event.target.files?.[0] ?? null)} required type="file" />
            </label>
          </Field>
          <Field label="Thư mục"><input className={inputClass} required value={form.folder} onChange={(event) => setForm({ ...form, folder: event.target.value })} /></Field>
          <Field label="Thẻ — ngăn cách bằng dấu phẩy"><input className={inputClass} value={form.tags} onChange={(event) => setForm({ ...form, tags: event.target.value })} /></Field>
          {file ? <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">{file.type || "MIME không xác định"} · {(file.size / 1_000_000).toFixed(2)} MB</p> : null}
          <Button disabled={!file} loading={saving} type="submit">Tải lên và kiểm tra</Button>
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
    </div>
  );
}
