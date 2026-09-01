"use client";

import { CalendarPlus, ExternalLink, Pencil, Radio, Trash2, Video } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { AccessDenied } from "@/components/access-denied";
import { PageHeader } from "@/components/page-header";
import { SectionState } from "@/components/section-state";
import { SearchableSelect } from "@/components/searchable-select";
import { Button, Field, inputClass, Modal, Pagination, StatusBadge, usePagination } from "@/components/ui";
import { apiRequest } from "@/lib/api-client";
import type { LearningClass, LiveSession } from "@/lib/learning-types";
import { useApp } from "@/providers/app-provider";
import { hasPermission } from "@/lib/access-control";

export default function LiveClassesPage() {
  const { session, notify } = useApp();
  const allowed = ["SYSTEM_ADMIN", "CENTER_MANAGER", "INSTRUCTOR", "LEARNER"].includes(session.roleCode);
  const instructor = session.roleCode === "INSTRUCTOR";
  const learner = session.roleCode === "LEARNER";
  const manager = ["SYSTEM_ADMIN", "CENTER_MANAGER"].includes(session.roleCode) && hasPermission(session, "class:manage");
  const [items, setItems] = useState<LiveSession[]>([]);
  const pagination = usePagination(items);
  const [classes, setClasses] = useState<LearningClass[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<LiveSession | null>(null);
  const [joinedSessionId, setJoinedSessionId] = useState<string | null>(null);
  const [clock, setClock] = useState(0);
  const [form, setForm] = useState({
    classId: "",
    title: "",
    startsAt: "",
    endsAt: "",
    provider: "GOOGLE_MEET",
    reason: "",
  });
  const load = useCallback(async () => {
    if (!allowed) return;
    setLoading(true);
    try {
      const [sessions, classData] = await Promise.all([
        apiRequest<LiveSession[]>("/sessions", { roleCode: session.roleCode }),
        apiRequest<LearningClass[]>("/classes", { roleCode: session.roleCode }),
      ]);
      setItems(sessions);
      setClasses(classData);
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "Không tải được lịch học.",
        "error",
      );
    } finally {
      setLoading(false);
    }
  }, [allowed, notify, session.roleCode]);
  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);
  useEffect(() => {
    const updateClock = () => setClock(Date.now());
    updateClock();
    const timer = window.setInterval(updateClock, 30_000);
    return () => window.clearInterval(timer);
  }, []);
  const create = async (event: React.FormEvent) => {
    event.preventDefault();
    try {
      await apiRequest(manager ? `/manager/classes/${form.classId}/sessions` : `/instructor/classes/${form.classId}/sessions`, {
        method: "POST",
        roleCode: session.roleCode,
        body: JSON.stringify({
          title: form.title,
          startsAt: new Date(form.startsAt).toISOString(),
          endsAt: new Date(form.endsAt).toISOString(),
          provider: form.provider,
        }),
      });
      notify("Đã lên lịch lớp trực tuyến.");
      setOpen(false);
      await load();
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "Không lên lịch được.",
        "error",
      );
    }
  };
  const openEdit = (item: LiveSession) => { setEditing(item); setForm({ classId: item.classId, title: item.title, startsAt: new Date(item.startsAt).toISOString().slice(0, 16), endsAt: new Date(item.endsAt).toISOString().slice(0, 16), provider: item.provider, reason: "" }); setOpen(true); };
  const update = async (event: React.FormEvent) => { event.preventDefault(); if (!editing) return; try { await apiRequest(`/manager/sessions/${editing.id}`, { method: "PATCH", roleCode: session.roleCode, body: JSON.stringify({ title: form.title, startsAt: new Date(form.startsAt).toISOString(), endsAt: new Date(form.endsAt).toISOString(), provider: form.provider, reason: form.reason }) }); notify("Đã đổi lịch và gửi thông báo cho lớp."); setOpen(false); setEditing(null); await load(); } catch (error) { notify(error instanceof Error ? error.message : "Không đổi được lịch.", "error"); } };
  const cancel = async (item: LiveSession) => { const reason = window.prompt("Lý do hủy buổi học"); if (!reason) return; try { await apiRequest(`/manager/sessions/${item.id}/cancel`, { method: "POST", roleCode: session.roleCode, body: JSON.stringify({ reason }) }); notify("Đã hủy buổi học và gửi thông báo."); await load(); } catch (error) { notify(error instanceof Error ? error.message : "Không hủy được buổi học.", "error"); } };
  const transition = async (
    item: LiveSession,
    status: "LIVE" | "COMPLETED" | "CANCELLED",
  ) => {
    try {
      await apiRequest(`/instructor/sessions/${item.id}/status`, {
        method: "PATCH",
        roleCode: session.roleCode,
        body: JSON.stringify({ status }),
      });
      notify(`Đã chuyển buổi học sang ${status}.`);
      await load();
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "Không đổi được trạng thái.",
        "error",
      );
    }
  };
  const join = async (item: LiveSession) => {
    try {
      const result = await apiRequest<{ attendeeUrl: string; joinedAt: string }>(
        `/learner/sessions/${item.id}/join`,
        { method: "POST", roleCode: session.roleCode },
      );
      setJoinedSessionId(item.id);
      window.open(result.attendeeUrl, "_blank", "noopener,noreferrer");
      notify(`Đã ghi nhận tham gia lúc ${new Date(result.joinedAt).toLocaleTimeString("vi-VN")}.`);
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "Chưa thể vào lớp.",
        "error",
      );
    }
  };
  const leave = async (item: LiveSession) => {
    try {
      const result = await apiRequest<{ attendedMinutes: number }>(`/learner/sessions/${item.id}/leave`, { method: "POST", roleCode: session.roleCode });
      setJoinedSessionId(null);
      notify(`Đã kết thúc phiên tham gia và ghi nhận ${result.attendedMinutes} phút.`);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Không kết thúc được phiên tham gia.", "error");
    }
  };
  if (!allowed) return <AccessDenied />;
  return (
    <div className="mx-auto max-w-7xl px-5 py-8 md:px-8 md:py-10">
      <PageHeader
        eyebrow="Synchronous Learning"
        title="Lớp học online"
        description="Lập lịch, mở phòng, điểm danh và gắn bản ghi sau buổi học."
        actions={
          instructor || manager ? (
            <Button onClick={() => { setEditing(null); setForm({ classId: classes[0]?.id ?? "", title: "", startsAt: "", endsAt: "", provider: "GOOGLE_MEET", reason: "" }); setOpen(true); }}>
              <CalendarPlus size={17} />
              Lên lịch
            </Button>
          ) : undefined
        }
      />
      <SectionState loading={loading} empty={items.length === 0}>
        <div className="space-y-4">
          {pagination.pageItems.map((item) => (
            <article
              className="grid gap-5 border-y border-[var(--rule-strong)] bg-[var(--surface)]/65 p-5 lg:grid-cols-[auto_1fr_auto] lg:items-center"
              key={item.id}
            >
              <div
                className={`grid size-12 place-items-center rounded-2xl ${item.status === "LIVE" ? "bg-rose-100 text-rose-600" : "bg-sky-50 text-sky-700"}`}
              >
                {item.status === "LIVE" ? (
                  <Radio className="animate-pulse" />
                ) : (
                  <Video />
                )}
              </div>
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="font-heading text-xl font-extrabold">
                    {item.title}
                  </h2>
                  <StatusBadge status={item.status} />
                </div>
                <p className="mt-2 text-sm text-slate-500">
                  {new Date(item.startsAt).toLocaleString("vi-VN")} —{" "}
                  {new Date(item.endsAt).toLocaleTimeString("vi-VN", {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}{" "}
                  · {item.provider.replace("_", " ")}{item.fallbackUsed ? ` · fallback từ ${item.requestedProvider?.replace("_", " ")} sau ${item.provisioningAttempts} lần thử` : item.provisioningAttempts && item.provisioningAttempts > 1 ? ` · ${item.provisioningAttempts} lần thử` : ""}
                  {item.timezone ? ` · ${item.timezone}` : ""}
                </p>
                {item.recordingUrl ? (
                  <a
                    className="mt-2 inline-flex items-center gap-1 text-xs font-bold text-sky-700"
                    href={item.recordingUrl}
                    rel="noreferrer"
                    target="_blank"
                  >
                    Xem bản ghi <ExternalLink size={12} />
                  </a>
                ) : null}
              </div>
              <div className="flex flex-wrap gap-2">
                {instructor && item.status === "SCHEDULED" ? (
                  <Button onClick={() => void transition(item, "LIVE")}>
                    <Radio size={15} />
                    Bắt đầu
                  </Button>
                ) : null}
                {instructor && item.status === "LIVE" ? (
                  <Button
                    onClick={() => void transition(item, "COMPLETED")}
                    variant="secondary"
                  >
                    Kết thúc
                  </Button>
                ) : null}
                {manager && item.status === "SCHEDULED" && new Date(item.startsAt) > new Date() ? <><Button onClick={() => openEdit(item)} variant="secondary"><Pencil size={15} />Đổi lịch</Button><Button onClick={() => void cancel(item)} variant="ghost"><Trash2 size={15} />Hủy</Button></> : null}
                {learner && joinedSessionId === item.id ? (
                  <Button onClick={() => void leave(item)} variant="secondary">Rời phòng và chốt điểm danh</Button>
                ) : learner && (item.status === "SCHEDULED" || item.status === "LIVE") ? (
                  <Button
                    disabled={clock < new Date(item.startsAt).getTime() - 15 * 60_000 || clock > new Date(item.endsAt).getTime() + 30 * 60_000}
                    onClick={() => void join(item)}
                  >
                    {clock < new Date(item.startsAt).getTime() - 15 * 60_000 ? "Mở trước giờ học 15 phút" : clock > new Date(item.endsAt).getTime() + 30 * 60_000 ? "Đã hết giờ tham gia" : "Vào lớp"} <ExternalLink size={15} />
                  </Button>
                ) : null}
              </div>
            </article>
          ))}
        </div>
      </SectionState>
      <Pagination itemLabel="buổi học trực tuyến" onPageChange={pagination.setPage} onPageSizeChange={pagination.setPageSize} page={pagination.page} pageSize={pagination.pageSize} totalItems={pagination.totalItems} />
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={editing ? "Đổi lịch lớp trực tuyến" : "Lên lịch lớp trực tuyến"}
      >
        <form className="space-y-4" onSubmit={(e) => void (editing ? update(e) : create(e))}>
          <Field label="Lớp học">
            <SearchableSelect aria-label="Tìm và chọn lớp học" disabled={Boolean(editing)} onChange={(value) => setForm({ ...form, classId: value })} options={classes.map((item) => ({ value: item.id, label: `${item.code} — ${item.name}`, description: item.term, keywords: item.id }))} placeholder="Gõ mã hoặc tên lớp để lọc…" value={form.classId} />
          </Field>
          <Field label="Tên buổi học">
            <input
              className={inputClass}
              required
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
            />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Bắt đầu">
              <input
                className={inputClass}
                required
                type="datetime-local"
                value={form.startsAt}
                onChange={(e) => setForm({ ...form, startsAt: e.target.value })}
              />
            </Field>
            <Field label="Kết thúc">
              <input
                className={inputClass}
                required
                type="datetime-local"
                value={form.endsAt}
                onChange={(e) => setForm({ ...form, endsAt: e.target.value })}
              />
            </Field>
          </div>
          <Field label="Nền tảng">
            <select
              className={inputClass}
              value={form.provider}
              onChange={(e) => setForm({ ...form, provider: e.target.value })}
            >
              <option value="GOOGLE_MEET">Google Meet</option>
              <option value="ZOOM">Zoom</option>
              <option value="JITSI">Jitsi</option>
            </select>
          </Field>
          {editing ? <Field label="Lý do đổi lịch"><textarea className={inputClass} minLength={5} required rows={3} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} /></Field> : null}
          <Button disabled={!editing && !form.classId} type="submit">Xác nhận lịch</Button>
        </form>
      </Modal>
    </div>
  );
}
