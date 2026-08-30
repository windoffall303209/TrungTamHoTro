"use client";

import { CheckCircle2, FileJson, LockKeyhole, RefreshCw, UserCheck } from "lucide-react";
import { type FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { AccessDenied } from "@/components/access-denied";
import { PageHeader } from "@/components/page-header";
import { SearchableSelect } from "@/components/searchable-select";
import { Button, Field, inputClass, Modal, StatusBadge } from "@/components/ui";
import { apiRequest } from "@/lib/api-client";
import { hasPermission } from "@/lib/access-control";
import type { AttendanceAppeal, AttendanceSessionReview, LiveSession } from "@/lib/learning-types";
import { useApp } from "@/providers/app-provider";

type AppealDecision = "APPROVE" | "REJECT";

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

  const statistics = useMemo(() => {
    const records = review?.records ?? [];
    return {
      enrolled: review?.enrolledLearnerIds.length ?? 0,
      present: records.filter((item) => item.status === "PRESENT" || item.status === "LATE").length,
      absent: records.filter((item) => item.status === "ABSENT").length,
      openAppeals: review?.appeals.filter((item) => item.status === "OPEN" || item.status === "IN_REVIEW").length ?? 0,
    };
  }, [review]);

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

  const openAppeal = (appeal: AttendanceAppeal) => {
    const current = review?.records.find((item) => item.learnerId === appeal.learnerId);
    setResolving(appeal);
    setAppealForm({ decision: "APPROVE", resolution: "", status: current?.status ?? "PRESENT", attendedMinutes: current?.attendedMinutes ?? 0 });
  };

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
    <div className="mx-auto max-w-7xl px-5 py-8 md:px-8 md:py-10">
      <PageHeader eyebrow="Attendance Governance" title="Giám sát điểm danh" description="Đối chiếu dữ liệu nhà cung cấp với danh sách lớp, xử lý điều chỉnh và khóa kết quả." />

      <section className="border-y border-[#a9bac1] bg-[#fffdfa]/65 p-6">
        <div className="grid items-end gap-4 md:grid-cols-[1fr_auto_auto]">
          <Field label="Buổi học đã kết thúc">
            <SearchableSelect aria-label="Tìm và chọn buổi học đã kết thúc" onChange={(value) => { setSelectedId(value); void loadReview(value); }} options={sessions.map((item) => ({ value: item.id, label: item.title, description: new Date(item.startsAt).toLocaleString("vi-VN") }))} placeholder="Gõ tên buổi học để lọc…" value={selectedId} />
          </Field>
          <Button disabled={!selectedId} onClick={() => void loadReview(selectedId)} variant="secondary"><RefreshCw size={16} />Làm mới</Button>
          <Button disabled={!review || Boolean(review.session.attendanceLockedAt) || statistics.openAppeals > 0} onClick={() => void lockAttendance()} variant="danger"><LockKeyhole size={16} />Khóa điểm danh</Button>
        </div>
        {review?.session.attendanceLockedAt ? <p className="mt-4 rounded-xl bg-rose-50 px-4 py-3 text-sm font-bold text-rose-800">Đã khóa lúc {new Date(review.session.attendanceLockedAt).toLocaleString("vi-VN")} bởi {review.session.attendanceLockedById}.</p> : null}
      </section>

      <div className="metric-ledger mt-6">
        {[{ label: "Học viên", value: statistics.enrolled }, { label: "Có mặt / muộn", value: statistics.present }, { label: "Vắng", value: statistics.absent }, { label: "Yêu cầu chờ xử lý", value: statistics.openAppeals }].map((item) => (
          <div key={item.label}><p className="tabular text-2xl font-extrabold text-sky-700">{item.value}</p><p className="mt-1 text-xs font-bold text-slate-500">{item.label}</p></div>
        ))}
      </div>

      <div className="mt-7 grid gap-7 xl:grid-cols-[.85fr_1.15fr]">
        <section className="border-y border-[#a9bac1] bg-[#fffdfa]/65 p-6">
          <div className="flex items-center gap-3"><FileJson className="text-sky-700" /><h2 className="font-heading text-xl font-extrabold">Nhập dữ liệu nhà cung cấp</h2></div>
          <p className="mt-2 text-xs leading-5 text-slate-500">JSON là mảng gồm `providerParticipantId`, `learnerId`, `joinedAt`, `leftAt`. Hệ thống tự loại người ngoài lớp, chặn bản ghi trùng và tính phút thực tế.</p>
          <form className="mt-5 space-y-4" onSubmit={(event) => void syncProvider(event)}>
            <Field label="Dữ liệu JSON">
              <textarea className={`${inputClass} font-mono text-xs`} disabled={Boolean(review?.session.attendanceLockedAt)} placeholder={'[{"providerParticipantId":"p-01","learnerId":"usr-learner","joinedAt":"2026-08-26T02:00:00.000Z","leftAt":"2026-08-26T03:00:00.000Z"}]'} required rows={9} value={providerJson} onChange={(event) => setProviderJson(event.target.value)} />
            </Field>
            <Button disabled={!selectedId || Boolean(review?.session.attendanceLockedAt)} loading={syncing} type="submit"><RefreshCw size={16} />Đồng bộ và đối chiếu</Button>
          </form>
        </section>

        <section className="overflow-hidden border-y border-[#a9bac1] bg-[#fffdfa]/65">
          <div className="flex items-center gap-3 border-b border-slate-100 p-5"><UserCheck className="text-sky-700" /><h2 className="font-heading text-xl font-extrabold">Kết quả điểm danh</h2></div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[620px] text-left text-sm">
              <thead className="bg-slate-50 text-[11px] uppercase tracking-wider text-slate-500"><tr><th className="px-5 py-3">Học viên</th><th className="px-5 py-3">Tham dự</th><th className="px-5 py-3">Trạng thái</th><th className="px-5 py-3">Nguồn</th></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {review?.records.map((item) => <tr key={item.learnerId}><td className="px-5 py-4 font-bold">{item.learnerId}</td><td className="px-5 py-4">{item.attendedMinutes} phút</td><td className="px-5 py-4"><StatusBadge status={item.status} /></td><td className="px-5 py-4 text-xs text-slate-500">{item.providerParticipantId ?? "Điều chỉnh thủ công"}</td></tr>)}
              </tbody>
            </table>
            {!loading && !review?.records.length ? <p className="p-10 text-center text-sm text-slate-400">Chưa có dữ liệu điểm danh.</p> : null}
            {loading ? <p className="p-10 text-center text-sm text-slate-400">Đang tải dữ liệu…</p> : null}
          </div>
        </section>
      </div>

      <section className="mt-7 border-y border-[#a9bac1] bg-[#fffdfa]/65 p-6">
        <div className="flex items-center gap-3"><CheckCircle2 className="text-sky-700" /><h2 className="font-heading text-xl font-extrabold">Yêu cầu điều chỉnh</h2></div>
        <div className="mt-5 divide-y divide-[#d5dfe2] border-y border-[#d5dfe2]">
          {review?.appeals.length ? review.appeals.map((appeal) => (
            <article className="px-1 py-5 md:px-4" key={appeal.id}>
              <div className="flex items-start justify-between gap-3"><div><p className="text-sm font-extrabold">{appeal.learnerId}</p><p className="mt-1 text-sm leading-6 text-slate-600">{appeal.reason}</p></div><StatusBadge status={appeal.status} /></div>
              {appeal.resolution ? <p className="mt-3 border-t border-slate-200 pt-3 text-xs text-slate-500">Kết luận: {appeal.resolution}</p> : null}
              {["OPEN", "IN_REVIEW"].includes(appeal.status) && !review.session.attendanceLockedAt ? <Button className="mt-4" onClick={() => openAppeal(appeal)} variant="secondary">Xử lý</Button> : null}
            </article>
          )) : <p className="empty-copy">Không có yêu cầu điều chỉnh.</p>}
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
