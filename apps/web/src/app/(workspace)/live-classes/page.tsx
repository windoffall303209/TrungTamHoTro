"use client";

import { CalendarPlus, ExternalLink, Radio, Video } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { PageHeader } from "@/components/page-header";
import { SectionState } from "@/components/section-state";
import { Button, Field, inputClass, Modal, StatusBadge } from "@/components/ui";
import { apiRequest } from "@/lib/api-client";
import type { LearningClass, LiveSession } from "@/lib/learning-types";
import { useApp } from "@/providers/app-provider";

export default function LiveClassesPage() {
  const { session, notify } = useApp();
  const instructor = session.roleCode === "INSTRUCTOR";
  const learner = session.roleCode === "LEARNER";
  const [items, setItems] = useState<LiveSession[]>([]);
  const [classes, setClasses] = useState<LearningClass[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [joinedSessionId, setJoinedSessionId] = useState<string | null>(null);
  const [form, setForm] = useState({
    classId: "",
    title: "",
    startsAt: "",
    endsAt: "",
    provider: "GOOGLE_MEET",
  });
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [sessions, classData] = await Promise.all([
        apiRequest<LiveSession[]>("/sessions", { roleCode: session.roleCode }),
        session.roleCode === "SYSTEM_ADMIN"
          ? Promise.resolve([])
          : apiRequest<LearningClass[]>("/classes", {
              roleCode: session.roleCode,
            }),
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
  }, [notify, session.roleCode]);
  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);
  const create = async (event: React.FormEvent) => {
    event.preventDefault();
    try {
      await apiRequest(`/instructor/classes/${form.classId}/sessions`, {
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
  return (
    <div className="mx-auto max-w-7xl px-5 py-8 md:px-8 md:py-10">
      <PageHeader
        eyebrow="Synchronous Learning"
        title="Lớp học online"
        description="Lập lịch, mở phòng, điểm danh và gắn bản ghi sau buổi học."
        actions={
          instructor ? (
            <Button onClick={() => setOpen(true)}>
              <CalendarPlus size={17} />
              Lên lịch
            </Button>
          ) : undefined
        }
      />
      <SectionState loading={loading} empty={items.length === 0}>
        <div className="space-y-4">
          {items.map((item) => (
            <article
              className="grid gap-5 rounded-2xl border border-slate-200 bg-white p-5 lg:grid-cols-[auto_1fr_auto] lg:items-center"
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
                  · {item.provider.replace("_", " ")}
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
                {learner && joinedSessionId === item.id ? (
                  <Button onClick={() => void leave(item)} variant="secondary">Rời phòng và chốt điểm danh</Button>
                ) : learner &&
                (item.status === "SCHEDULED" || item.status === "LIVE") ? (
                  <Button onClick={() => void join(item)}>
                    Vào lớp <ExternalLink size={15} />
                  </Button>
                ) : null}
              </div>
            </article>
          ))}
        </div>
      </SectionState>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Lên lịch lớp trực tuyến"
      >
        <form className="space-y-4" onSubmit={(e) => void create(e)}>
          <Field label="Lớp học">
            <select
              className={inputClass}
              required
              value={form.classId}
              onChange={(e) => setForm({ ...form, classId: e.target.value })}
            >
              <option value="">Chọn lớp</option>
              {classes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.code} — {c.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Tên buổi học">
            <input
              className={inputClass}
              required
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
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
          <Button type="submit">Xác nhận lịch</Button>
        </form>
      </Modal>
    </div>
  );
}
