"use client";

import { activeLocale } from "@/i18n/runtime";

import { CheckCircle2, FileJson, LockKeyhole, RefreshCw, UserCheck } from "lucide-react";
import { type FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { AccessDenied } from "@/components/access-denied";
import { PageHeader } from "@/components/page-header";
import { SearchableSelect } from "@/components/searchable-select";
import { Button, Field, inputClass, Modal, Pagination, StatusBadge, usePagination } from "@/components/ui";
import { apiRequest } from "@/lib/api-client";
import { hasPermission } from "@/lib/access-control";
import type { AttendanceAppeal, AttendanceSessionReview, LiveSession } from "@/lib/learning-types";
import { useApp } from "@/providers/app-provider";

type AppealDecision = "APPROVE" | "REJECT";

/** Cung cấp màn hình đối soát điểm danh, khóa dữ liệu và xử lý khiếu nại. */
export default function AttendancePage() {
  const { session, notify } = useApp();
  const canManage = ["SYSTEM_ADMIN", "CENTER_MANAGER"].includes(session.roleCode) && hasPermission(session, "class:manage");
  const [sessions, setSessions] = useState<LiveSession[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [review, setReview] = useState<AttendanceSessionReview | null>(null);
  const [providerJson, setProviderJson] = useState("");
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [resolving, setResolving] = useState<AttendanceAppeal | null>(null);
  const [appealForm, setAppealForm] = useState({ decision: "APPROVE" as AppealDecision, resolution: "", status: "PRESENT", attendedMinutes: 0 });
  const recordPagination = usePagination(review?.records ?? []);

  /** Nạp bản đối soát chi tiết của một buổi học cùng các sai lệch cần xử lý. */
  const loadReview = useCallback(async (sessionId: string) => {
    if (!sessionId) return;
    setLoading(true);
    try {
      setReview(await apiRequest<AttendanceSessionReview>(`/manager/sessions/${sessionId}/attendance`, { roleCode: session.roleCode }));
    } catch (error) {
      notify(error instanceof Error ? error.message : "Không tải được dữ liệu điểm danh.", "error");
    } finally {
      setLoading(false);
    }
  }, [notify, session.roleCode]);

  /** Nạp danh sách buổi có quyền quản lý và giữ lựa chọn hiện tại nếu còn hợp lệ. */
  const loadSessions = useCallback(async () => {
    if (!canManage) return;
    try {
      const data = (await apiRequest<LiveSession[]>("/sessions", { roleCode: session.roleCode })).filter((item) => item.status === "COMPLETED");
      setSessions(data);
      const nextId = selectedId || data[0]?.id || "";
      setSelectedId(nextId);
      if (nextId) await loadReview(nextId);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Không tải được danh sách buổi học.", "error");
    }
  }, [canManage, loadReview, notify, selectedId, session.roleCode]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadSessions(), 0);
    return () => window.clearTimeout(timer);
  }, [loadSessions]);

  /** Tổng hợp nhanh trạng thái điểm danh để trình bày KPI của buổi đang xem. */
  const statistics = useMemo(() => {
    const records = review?.records ?? [];
    return {
      enrolled: review?.enrolledLearnerIds.length ?? 0,
      present: records.filter((item) => item.status === "PRESENT" || item.status === "LATE").length,
      absent: records.filter((item) => item.status === "ABSENT").length,
      openAppeals: review?.appeals.filter((item) => item.status === "OPEN" || item.status === "IN_REVIEW").length ?? 0,
    };
  }, [review]);

  /** Đồng bộ dữ liệu tham dự từ nhà cung cấp họp trực tuyến vào bản điểm danh. */
  const syncProvider = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedId) return;
    let records: unknown;
    try {
      records = JSON.parse(providerJson);
      if (!Array.isArray(records) || records.length === 0) throw new Error("Dữ liệu phải là một mảng có ít nhất một bản ghi.");
    } catch (error) {
      notify(error instanceof Error ? error.message : "JSON không hợp lệ.", "error");
      return;
    }
    setSyncing(true);
    try {
      const result = await apiRequest<{ review: AttendanceSessionReview; skippedLearnerIds: string[] }>(`/manager/sessions/${selectedId}/attendance/sync`, {
        method: "POST",
        roleCode: session.roleCode,
        body: JSON.stringify({ records }),
      });
      setReview(result.review);
      setProviderJson("");
      notify(result.skippedLearnerIds.length ? `Đã đồng bộ; bỏ qua ${result.skippedLearnerIds.length} người ngoài lớp.` : "Đã đồng bộ và đối chiếu điểm danh.");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Không đồng bộ được điểm danh.", "error");
    } finally {
      setSyncing(false);
    }
  };

  /** Khóa bảng điểm danh sau đối soát để ngăn chỉnh sửa ngoài quy trình khiếu nại. */
  const lockAttendance = async () => {
    if (!selectedId || !window.confirm("Khóa kỳ điểm danh? Sau khi khóa, mọi đồng bộ và điều chỉnh sẽ bị từ chối.")) return;
    try {
      await apiRequest(`/manager/sessions/${selectedId}/attendance/lock`, { method: "POST", roleCode: session.roleCode });
      notify("Đã khóa kỳ điểm danh.");
      await loadReview(selectedId);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Không khóa được kỳ điểm danh.", "error");
    }
  };

  /** Mở biểu mẫu xử lý khiếu nại với trạng thái hiện tại của bản ghi tương ứng. */
  const openAppeal = (appeal: AttendanceAppeal) => {
    const current = review?.records.find((item) => item.learnerId === appeal.learnerId);
    setResolving(appeal);
    setAppealForm({ decision: "APPROVE", resolution: "", status: current?.status ?? "PRESENT", attendedMinutes: current?.attendedMinutes ?? 0 });
  };

  /** Chấp nhận hoặc từ chối khiếu nại và cập nhật bản ghi điểm danh liên quan. */
  const resolveAppeal = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!resolving) return;
    try {
      await apiRequest(`/manager/attendance-appeals/${resolving.id}/resolve`, {
        method: "POST",
        roleCode: session.roleCode,
        body: JSON.stringify({
          decision: appealForm.decision,
          resolution: appealForm.resolution,
          status: appealForm.decision === "APPROVE" ? appealForm.status : undefined,
          attendedMinutes: appealForm.decision === "APPROVE" ? appealForm.attendedMinutes : undefined,
        }),
      });
      notify(appealForm.decision === "APPROVE" ? "Đã chấp thuận và cập nhật điểm danh." : "Đã từ chối yêu cầu điều chỉnh.");
      setResolving(null);
      await loadReview(selectedId);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Không xử lý được yêu cầu.", "error");
    }
  };

  if (!canManage) return <AccessDenied />;

  return (
    <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      <PageHeader eyebrow="Quản lý điểm danh" title="Giám sát điểm danh" description="Đối chiếu dữ liệu nhà cung cấp với danh sách lớp, xử lý điều chỉnh và khóa kết quả." />

      <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-5 sm:p-6 shadow-xs">
        <div className="grid items-end gap-4 md:grid-cols-[1fr_auto_auto]">
          <Field label="Buổi học đã kết thúc">
            <SearchableSelect aria-label="Tìm và chọn buổi học đã kết thúc" onChange={(value) => { setSelectedId(value); void loadReview(value); }} options={sessions.map((item) => ({ value: item.id, label: item.title, description: new Date(item.startsAt).toLocaleString(activeLocale()) }))} placeholder="Gõ tên buổi học để lọc…" value={selectedId} />
          </Field>
          <Button disabled={!selectedId} onClick={() => void loadReview(selectedId)} variant="secondary"><RefreshCw size={16} />Làm mới</Button>
          <Button disabled={!review || Boolean(review.session.attendanceLockedAt) || statistics.openAppeals > 0} onClick={() => void lockAttendance()} variant="danger"><LockKeyhole size={16} />Khóa điểm danh</Button>
        </div>
        {review?.session.attendanceLockedAt ? <p className="mt-4 rounded-xl bg-rose-50 dark:bg-rose-950/40 px-4 py-3 text-sm font-bold text-rose-700 dark:text-rose-300">Đã khóa lúc {new Date(review.session.attendanceLockedAt).toLocaleString(activeLocale())} bởi {review.session.attendanceLockedById}.</p> : null}
      </section>

      <section aria-label="Chỉ số điểm danh" className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[{ label: "Học viên trong lớp", value: statistics.enrolled, color: "text-slate-900 dark:text-slate-100" }, { label: "Có mặt / muộn", value: statistics.present, color: "text-emerald-600 dark:text-emerald-400" }, { label: "Vắng mặt", value: statistics.absent, color: "text-rose-600 dark:text-rose-400" }, { label: "Yêu cầu chờ xử lý", value: statistics.openAppeals, color: "text-amber-600 dark:text-amber-400" }].map((item) => (
          <div key={item.label} className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-4 shadow-xs text-center hover:border-sky-300 dark:hover:border-sky-700 transition-colors">
            <p className={`tabular text-2xl sm:text-3xl font-extrabold ${item.color}`}>{item.value}</p>
            <p className="mt-1 text-xs font-semibold text-slate-500 dark:text-slate-400">{item.label}</p>
          </div>
        ))}
      </section>

      <div className="grid gap-6 xl:grid-cols-[.9fr_1.1fr]">
        <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-5 sm:p-6 shadow-xs flex flex-col justify-between">
          <div>
            <div className="flex items-center gap-3"><FileJson className="text-sky-600" /><h2 className="font-heading text-lg font-bold text-slate-900 dark:text-slate-100">Nhập dữ liệu tham dự</h2></div>
            <p className="mt-2 text-xs leading-5 text-slate-500 dark:text-slate-400">Đồng bộ từ nhà cung cấp họp trực tuyến. Hệ thống tự loại bỏ người ngoài lớp và tính phút thực tế.</p>
            <form className="mt-4 space-y-4" onSubmit={(event) => void syncProvider(event)}>
              <Field label="Dữ liệu JSON">
                <textarea className={`${inputClass} font-mono text-xs`} disabled={Boolean(review?.session.attendanceLockedAt)} placeholder={'[{"providerParticipantId":"p-01","learnerId":"usr-learner","joinedAt":"2026-08-26T02:00:00.000Z","leftAt":"2026-08-26T03:00:00.000Z"}]'} required rows={8} value={providerJson} onChange={(event) => setProviderJson(event.target.value)} />
              </Field>
              <Button disabled={!selectedId || Boolean(review?.session.attendanceLockedAt)} loading={syncing} type="submit"><RefreshCw size={16} />Đồng bộ và đối chiếu</Button>
            </form>
          </div>
        </section>

        <section className="overflow-hidden rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 shadow-xs">
          <div className="flex items-center gap-3 border-b border-slate-100 dark:border-slate-800 p-5"><UserCheck className="text-sky-600" /><h2 className="font-heading text-lg font-bold text-slate-900 dark:text-slate-100">Kết quả đối soát</h2></div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[540px] text-left text-sm">
              <thead className="bg-slate-50/80 dark:bg-slate-800/40 text-[11px] uppercase tracking-wider text-slate-500">
                <tr><th className="px-5 py-3">Học viên</th><th className="px-5 py-3">Tham dự</th><th className="px-5 py-3">Trạng thái</th><th className="px-5 py-3">Nguồn</th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {recordPagination.pageItems.map((item) => (
                  <tr key={item.learnerId} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30">
                    <td className="px-5 py-4 font-bold text-slate-900 dark:text-slate-100">{item.learnerId}</td>
                    <td className="px-5 py-4 text-slate-600 dark:text-slate-300 font-semibold">{item.attendedMinutes} phút</td>
                    <td className="px-5 py-4"><StatusBadge status={item.status} /></td>
                    <td className="px-5 py-4 text-xs text-slate-500">{item.providerParticipantId ?? "Thủ công"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!loading && !review?.records.length ? <p className="p-8 text-center text-sm text-slate-400">Chưa có dữ liệu điểm danh cho buổi học này.</p> : null}
            {loading ? <p className="p-8 text-center text-sm text-slate-400">Đang nạp dữ liệu…</p> : null}
          </div>
          <Pagination className="mx-5 mb-4" itemLabel="bản ghi" onPageChange={recordPagination.setPage} onPageSizeChange={recordPagination.setPageSize} page={recordPagination.page} pageSize={recordPagination.pageSize} totalItems={recordPagination.totalItems} />
        </section>
      </div>

      <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-5 sm:p-6 shadow-xs">
        <div className="flex items-center gap-3 mb-4"><CheckCircle2 className="text-sky-600" /><h2 className="font-heading text-lg font-bold text-slate-900 dark:text-slate-100">Yêu cầu điều chỉnh & khiếu nại</h2></div>
        <div className="space-y-3">
          {review?.appeals.length ? review.appeals.map((appeal) => (
            <article className="rounded-xl border border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30 p-4" key={appeal.id}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-extrabold text-slate-900 dark:text-slate-100">{appeal.learnerId}</p>
                  <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">{appeal.reason}</p>
                </div>
                <StatusBadge status={appeal.status} />
              </div>
              {appeal.resolution ? <p className="mt-3 border-t border-slate-200 dark:border-slate-800 pt-2 text-xs text-slate-500">Kết luận: {appeal.resolution}</p> : null}
              {["OPEN", "IN_REVIEW"].includes(appeal.status) && !review.session.attendanceLockedAt ? <Button className="mt-3 h-8 text-xs" onClick={() => openAppeal(appeal)} variant="secondary">Xử lý khiếu nại</Button> : null}
            </article>
          )) : <p className="text-xs text-slate-400 py-4 text-center">Không có yêu cầu điều chỉnh nào đang mở.</p>}
        </div>
      </section>

      <Modal open={Boolean(resolving)} onClose={() => setResolving(null)} title="Xử lý yêu cầu điểm danh" description={resolving?.reason}>
        <form className="space-y-4" onSubmit={(event) => void resolveAppeal(event)}>
          <Field label="Quyết định"><select className={inputClass} value={appealForm.decision} onChange={(event) => setAppealForm({ ...appealForm, decision: event.target.value as AppealDecision })}><option value="APPROVE">Chấp thuận</option><option value="REJECT">Từ chối</option></select></Field>
          {appealForm.decision === "APPROVE" ? <div className="grid gap-3 sm:grid-cols-2"><Field label="Trạng thái mới"><select className={inputClass} value={appealForm.status} onChange={(event) => setAppealForm({ ...appealForm, status: event.target.value })}><option value="PRESENT">Có mặt</option><option value="LATE">Đi muộn</option><option value="ABSENT">Vắng</option><option value="EXCUSED">Có phép</option></select></Field><Field label="Số phút"><input className={inputClass} min={0} required type="number" value={appealForm.attendedMinutes} onChange={(event) => setAppealForm({ ...appealForm, attendedMinutes: Number(event.target.value) })} /></Field></div> : null}
          <Field label="Kết luận xử lý"><textarea className={inputClass} minLength={5} required rows={4} value={appealForm.resolution} onChange={(event) => setAppealForm({ ...appealForm, resolution: event.target.value })} /></Field>
          <Button type="submit" variant={appealForm.decision === "REJECT" ? "danger" : "primary"}>{appealForm.decision === "APPROVE" ? "Chấp thuận điều chỉnh" : "Từ chối yêu cầu"}</Button>
        </form>
      </Modal>
    </div>
  );
}
