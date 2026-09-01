"use client";

import { Archive, CheckCircle2, RotateCcw, ShieldAlert } from "lucide-react";
import { type FormEvent, useCallback, useEffect, useState } from "react";
import { AccessDenied } from "@/components/access-denied";
import { PageHeader } from "@/components/page-header";
import { SearchableSelect } from "@/components/searchable-select";
import { Button, Field, inputClass, StatusBadge } from "@/components/ui";
import { apiRequest } from "@/lib/api-client";
import { hasPermission } from "@/lib/access-control";
import type { ClassClosureReadiness, LearningClass } from "@/lib/learning-types";
import { useApp } from "@/providers/app-provider";

export default function ClassLifecyclePage() {
  const [requestedClassId] = useState(() => typeof window === "undefined" ? "" : new URLSearchParams(window.location.search).get("classId") ?? "");
  const { session, notify } = useApp();
  const canManage = ["SYSTEM_ADMIN", "CENTER_MANAGER"].includes(session.roleCode) && hasPermission(session, "class:manage");
  const [classes, setClasses] = useState<LearningClass[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [readiness, setReadiness] = useState<ClassClosureReadiness | null>(null);
  const [closeForm, setCloseForm] = useState({ closeReason: "", archivePolicy: "STANDARD_RETENTION" });
  const [reopenReason, setReopenReason] = useState("");
  const [saving, setSaving] = useState(false);

  const selected = classes.find((item) => item.id === selectedId);

  const loadReadiness = useCallback(async (classId: string) => {
    if (!classId) return;
    try {
      setReadiness(await apiRequest<ClassClosureReadiness>(`/manager/classes/${classId}/closure-readiness`, { roleCode: session.roleCode }));
    } catch (error) {
      notify(error instanceof Error ? error.message : "Không kiểm tra được điều kiện đóng lớp.", "error");
    }
  }, [notify, session.roleCode]);

  const load = useCallback(async () => {
    if (!canManage) return;
    try {
      const data = await apiRequest<LearningClass[]>("/classes", { roleCode: session.roleCode });
      setClasses(data);
      const nextId = selectedId || data.find((item) => item.id === requestedClassId)?.id || data[0]?.id || "";
      setSelectedId(nextId);
      if (nextId) await loadReadiness(nextId);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Không tải được danh sách lớp.", "error");
    }
  }, [canManage, loadReadiness, notify, requestedClassId, selectedId, session.roleCode]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const closeClass = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selected) return;
    setSaving(true);
    try {
      await apiRequest(`/manager/classes/${selected.id}/close`, {
        method: "POST",
        roleCode: session.roleCode,
        body: JSON.stringify(closeForm),
      });
      notify("Đã đóng, lưu trữ và chuyển lớp sang chỉ đọc.");
      setCloseForm({ closeReason: "", archivePolicy: "STANDARD_RETENTION" });
      await load();
    } catch (error) {
      notify(error instanceof Error ? error.message : "Không đóng được lớp.", "error");
    } finally {
      setSaving(false);
    }
  };

  const reopenClass = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selected) return;
    setSaving(true);
    try {
      await apiRequest(`/manager/classes/${selected.id}/reopen`, {
        method: "POST",
        roleCode: session.roleCode,
        body: JSON.stringify({ reason: reopenReason }),
      });
      notify("Đã mở lại lớp và ghi lịch sử kiểm toán.");
      setReopenReason("");
      await load();
    } catch (error) {
      notify(error instanceof Error ? error.message : "Không mở lại được lớp.", "error");
    } finally {
      setSaving(false);
    }
  };

  if (!canManage) return <AccessDenied />;

  const metrics = readiness ? [
    ["Kỳ thi mở", readiness.openExams],
    ["Bài chưa chấm", readiness.pendingGrades],
    ["Buổi chưa kết thúc", readiness.activeSessions],
    ["Điểm danh chưa khóa", readiness.unlockedAttendanceSessions],
    ["Yêu cầu đang mở", readiness.openAppeals],
  ] : [];

  return (
    <div className="mx-auto max-w-6xl px-5 py-8 md:px-8 md:py-10">
      <PageHeader eyebrow="Class Governance" title="Vòng đời và lưu trữ lớp" description="Kiểm tra điều kiện, đóng lớp không mất dữ liệu và mở lại có lý do được audit." />

      <section className="border-y border-[var(--rule-strong)] bg-[var(--surface)]/65 p-6">
        <Field label="Lớp cần quản lý">
          <SearchableSelect aria-label="Tìm và chọn lớp cần quản lý" onChange={(value) => { setSelectedId(value); void loadReadiness(value); }} options={classes.map((item) => ({ value: item.id, label: `${item.code} — ${item.name}`, description: `${item.term} · ${item.status}`, keywords: item.id }))} placeholder="Gõ mã hoặc tên lớp để lọc…" value={selectedId} />
        </Field>
        {selected ? <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-[var(--rule)] pt-5"><div><p className="font-extrabold">{selected.name}</p><p className="mt-1 text-xs text-slate-500">Kết thúc {new Date(selected.endAt).toLocaleString("vi-VN")} · {selected.learnerIds.length} học viên</p></div><StatusBadge status={selected.status} /></div> : null}
      </section>

      {readiness ? <div className="metric-ledger mt-6 [--metric-columns:5]">{metrics.map(([label, value]) => <div key={label}><p className={`tabular text-2xl font-extrabold ${value ? "text-rose-700" : "text-emerald-700"}`}>{value}</p><p className="mt-1 text-xs font-bold text-slate-500">{label}</p></div>)}</div> : null}

      <div className="mt-7 grid gap-7 lg:grid-cols-[1fr_.9fr]">
        <section className="border-y border-[var(--rule-strong)] bg-[var(--surface)]/65 p-6">
          <div className="flex items-center gap-3">{readiness?.eligible ? <CheckCircle2 className="text-emerald-700" /> : <ShieldAlert className="text-amber-600" />}<h2 className="font-heading text-xl font-extrabold">Kiểm tra trước khi đóng</h2></div>
          {readiness?.eligible ? <p className="mt-5 rounded-xl bg-emerald-50 p-4 text-sm font-bold text-emerald-800">Lớp đã đủ điều kiện đóng và lưu trữ.</p> : <div className="mt-5 rounded-xl bg-amber-50 p-4"><p className="text-sm font-extrabold text-amber-900">Cần xử lý trước:</p><ul className="mt-3 space-y-2 text-sm text-amber-900">{readiness?.blockers.map((item) => <li key={item}>• {item}</li>)}</ul></div>}
          <p className="mt-5 text-sm leading-6 text-slate-500">Lưu trữ chỉ thay đổi trạng thái và quyền ghi. Học liệu, điểm, điểm danh, bài thi và diễn đàn vẫn được giữ nguyên để tra cứu.</p>
        </section>

        <section className="border-y border-[var(--rule-strong)] bg-[var(--surface)]/65 p-6">
          {selected?.status === "CLOSED" ? <><div className="flex items-center gap-3"><RotateCcw className="text-sky-700" /><h2 className="font-heading text-xl font-extrabold">Mở lại lớp</h2></div><p className="mt-2 text-xs text-slate-500">Lý do được ghi vào audit log. Dữ liệu lưu trữ không bị tạo lại hoặc ghi đè.</p><form className="mt-5 space-y-4" onSubmit={(event) => void reopenClass(event)}><Field label="Lý do mở lại"><textarea className={inputClass} minLength={5} required rows={4} value={reopenReason} onChange={(event) => setReopenReason(event.target.value)} /></Field><Button loading={saving} type="submit"><RotateCcw size={16} />Mở lại lớp</Button></form></> : <><div className="flex items-center gap-3"><Archive className="text-sky-700" /><h2 className="font-heading text-xl font-extrabold">Đóng và lưu trữ</h2></div><form className="mt-5 space-y-4" onSubmit={(event) => void closeClass(event)}><Field label="Lý do đóng lớp"><textarea className={inputClass} minLength={5} required rows={4} value={closeForm.closeReason} onChange={(event) => setCloseForm({ ...closeForm, closeReason: event.target.value })} /></Field><Field label="Chính sách lưu trữ"><select className={inputClass} value={closeForm.archivePolicy} onChange={(event) => setCloseForm({ ...closeForm, archivePolicy: event.target.value })}><option value="STANDARD_RETENTION">Tiêu chuẩn theo quy định chung</option><option value="LONG_TERM_RETENTION">Lưu trữ dài hạn</option></select></Field><Button disabled={!readiness?.eligible} loading={saving} type="submit" variant="danger"><Archive size={16} />Đóng và lưu trữ</Button></form></>}
        </section>
      </div>
    </div>
  );
}
