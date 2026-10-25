"use client";

import { activeLocale } from "@/i18n/runtime";

import { Archive, ArrowUpRight, CheckCircle2, RotateCcw, ShieldAlert } from "lucide-react";
import { type FormEvent, useCallback, useEffect, useState } from "react";
import { AccessDenied } from "@/components/access-denied";
import { PageHeader } from "@/components/page-header";
import { SearchableSelect } from "@/components/searchable-select";
import { Button, Field, inputClass, StatusBadge } from "@/components/ui";
import { apiRequest } from "@/lib/api-client";
import { hasPermission } from "@/lib/access-control";
import type { ClassClosureReadiness, LearningClass } from "@/lib/learning-types";
import { useApp } from "@/providers/app-provider";

/** Quản lý điều kiện sẵn sàng, đóng lớp và mở lại lớp theo vòng đời vận hành. */
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

  /** Kiểm tra các điều kiện nghiệp vụ còn thiếu trước khi lớp được phép đóng. */
  const loadReadiness = useCallback(async (classId: string) => {
    if (!classId) return;
    try {
      setReadiness(await apiRequest<ClassClosureReadiness>(`/manager/classes/${classId}/closure-readiness`, { roleCode: session.roleCode }));
    } catch (error) {
      notify(error instanceof Error ? error.message : "Không kiểm tra được điều kiện đóng lớp.", "error");
    }
  }, [notify, session.roleCode]);

  /** Nạp danh sách lớp quản lý và báo cáo sẵn sàng của lớp đang chọn. */
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

  /** Đóng lớp với lý do nghiệp vụ sau khi máy chủ xác nhận đủ điều kiện. */
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

  /** Mở lại một lớp đã đóng và ghi nhận lý do vào lịch sử vòng đời. */
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
    { label: "Kỳ thi đang mở", value: readiness.openExams, href: `/exams?classId=${selectedId}` },
    { label: "Lượt thi đang làm", value: readiness.inProgressAttempts, href: `/exams?classId=${selectedId}` },
    { label: "Bài thi chờ chấm", value: readiness.pendingGrades, href: `/academic?classId=${selectedId}` },
    { label: "Bài tập còn mở", value: readiness.openAssignments, href: `/academic?classId=${selectedId}` },
    { label: "Bài tập chờ chấm", value: readiness.pendingAssignmentGrades, href: `/academic?classId=${selectedId}` },
    { label: "Phúc khảo đang mở", value: readiness.openRegrades, href: `/exams?classId=${selectedId}` },
    { label: "Buổi chưa kết thúc", value: readiness.activeSessions, href: `/live-classes?classId=${selectedId}` },
    { label: "Điểm danh chưa khóa", value: readiness.unlockedAttendanceSessions, href: `/attendance?classId=${selectedId}` },
    { label: "Khiếu nại đang mở", value: readiness.openAppeals, href: `/attendance?classId=${selectedId}` },
  ] : [];

  return (
    <div className="mx-auto max-w-6xl px-4 py-4 sm:px-6 sm:py-5 lg:px-8 space-y-4">
      <PageHeader eyebrow="Quản lý vòng đời" title="Vòng đời và lưu trữ lớp" description="Kiểm tra điều kiện, đóng lớp không mất dữ liệu và mở lại có lý do được kiểm toán minh bạch." />

      <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-3.5 sm:p-4 shadow-xs">
        <Field label="Lớp cần quản lý">
          <SearchableSelect aria-label="Tìm và chọn lớp cần quản lý" onChange={(value) => { setSelectedId(value); void loadReadiness(value); }} options={classes.map((item) => ({ value: item.id, label: `${item.code} — ${item.name}`, description: `${item.term} · ${item.status}`, keywords: item.id }))} placeholder="Gõ mã hoặc tên lớp để lọc…" value={selectedId} />
        </Field>
        {selected ? (
          <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 dark:border-slate-800 pt-5">
            <div>
              <p className="font-extrabold text-slate-900 dark:text-slate-100">{selected.name}</p>
              <p className="mt-1 text-xs text-slate-500">Kết thúc {new Date(selected.endAt).toLocaleString(activeLocale())} · {selected.learnerIds.length} học viên</p>
            </div>
            <StatusBadge status={selected.status} />
          </div>
        ) : null}
      </section>

      {readiness ? (
        <section aria-label="Chỉ số điều kiện đóng lớp" className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          {metrics.map((metric) => (
            <a key={metric.label} className="group rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-4 shadow-xs transition-all hover:border-sky-300 dark:hover:border-sky-700 hover:shadow-sm" href={metric.href}>
              <div className="flex items-center justify-between">
                <span className={`tabular text-2xl font-extrabold ${metric.value ? "text-rose-600 dark:text-rose-400" : "text-emerald-600 dark:text-emerald-400"}`}>{metric.value}</span>
                <ArrowUpRight className="text-slate-400 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" size={16} />
              </div>
              <span className="mt-1.5 block text-xs font-semibold text-slate-500 dark:text-slate-400">{metric.label}</span>
            </a>
          ))}
        </section>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[1.1fr_.9fr]">
        <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-5 sm:p-6 shadow-xs flex flex-col justify-between">
          <div>
            <div className="flex items-center gap-3">
              {readiness?.eligible ? <CheckCircle2 className="text-emerald-600 dark:text-emerald-400" /> : <ShieldAlert className="text-amber-500" />}
              <h2 className="font-heading text-lg font-bold text-slate-900 dark:text-slate-100">Kiểm tra điều kiện lưu trữ</h2>
            </div>
            {readiness?.eligible ? (
              <div className="mt-4 rounded-xl border border-emerald-200 dark:border-emerald-900/50 bg-emerald-50/80 dark:bg-emerald-950/40 p-4 text-sm font-bold text-emerald-800 dark:text-emerald-300">
                Lớp đã đủ điều kiện an toàn để đóng và chuyển sang trạng thái lưu trữ.
              </div>
            ) : (
              <div className="mt-4 rounded-xl border border-amber-200 dark:border-amber-900/50 bg-amber-50/80 dark:bg-amber-950/40 p-4">
                <p className="text-sm font-extrabold text-amber-900 dark:text-amber-200">Cần xử lý dứt điểm trước khi đóng:</p>
                <ul className="mt-2 space-y-1.5 text-xs text-amber-800 dark:text-amber-300">
                  {readiness?.blockers.map((item) => <li key={item}>• {item}</li>)}
                </ul>
              </div>
            )}
          </div>
          <p className="mt-5 text-xs leading-5 text-slate-400">
            * Lưu trữ chỉ khóa quyền ghi và chỉnh sửa. Học liệu, điểm số, bài nộp, dữ liệu điểm danh và thảo luận diễn đàn luôn được giữ nguyên vẹn để tra cứu lâu dài.
          </p>
        </section>

        <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-5 sm:p-6 shadow-xs">
          {selected?.status === "CLOSED" ? (
            <>
              <div className="flex items-center gap-3">
                <RotateCcw className="text-sky-600" />
                <h2 className="font-heading text-lg font-bold text-slate-900 dark:text-slate-100">Mở lại lớp học</h2>
              </div>
              <p className="mt-2 text-xs text-slate-500">Lý do mở lại sẽ được ghi vào nhật ký kiểm toán hệ thống. Dữ liệu đã lưu trữ được bảo toàn.</p>
              <form className="mt-4 space-y-4" onSubmit={(event) => void reopenClass(event)}>
                <Field label="Lý do mở lại">
                  <textarea className={inputClass} minLength={5} required rows={4} value={reopenReason} onChange={(event) => setReopenReason(event.target.value)} placeholder="Nhập lý do chi tiết để kiểm toán…" />
                </Field>
                <Button loading={saving} type="submit"><RotateCcw size={16} />Mở lại lớp học</Button>
              </form>
            </>
          ) : (
            <>
              <div className="flex items-center gap-3">
                <Archive className="text-sky-600" />
                <h2 className="font-heading text-lg font-bold text-slate-900 dark:text-slate-100">Đóng và lưu trữ lớp</h2>
              </div>
              <form className="mt-4 space-y-4" onSubmit={(event) => void closeClass(event)}>
                <Field label="Lý do đóng lớp">
                  <textarea className={inputClass} minLength={5} required rows={3} value={closeForm.closeReason} onChange={(event) => setCloseForm({ ...closeForm, closeReason: event.target.value })} placeholder="Ghi chú lý do đóng khóa học…" />
                </Field>
                <Field label="Chính sách lưu trữ">
                  <select className={inputClass} value={closeForm.archivePolicy} onChange={(event) => setCloseForm({ ...closeForm, archivePolicy: event.target.value })}>
                    <option value="STANDARD_RETENTION">Tiêu chuẩn theo quy chế (1 năm)</option>
                    <option value="LONG_TERM_RETENTION">Lưu trữ dài hạn (Vĩnh viễn)</option>
                  </select>
                </Field>
                <Button disabled={!readiness?.eligible} loading={saving} type="submit" variant="danger"><Archive size={16} />Đóng và lưu trữ</Button>
              </form>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
