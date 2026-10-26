"use client";

import { activeLocale } from "@/i18n/runtime";
import {
  CalendarPlus,
  Clock,
  ExternalLink,
  LayoutGrid,
  List,
  Pencil,
  Play,
  Radio,
  Trash2,
  Video,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { AccessDenied } from "@/components/access-denied";
import { PageHeader } from "@/components/page-header";
import { SectionState } from "@/components/section-state";
import { SearchableSelect } from "@/components/searchable-select";
import {
  Button,
  Field,
  inputClass,
  Modal,
  Pagination,
  StatusBadge,
  usePagination,
} from "@/components/ui";
import { apiRequest } from "@/lib/api-client";
import type { LearningClass, LiveSession } from "@/lib/learning-types";
import { useApp } from "@/providers/app-provider";
import { hasPermission } from "@/lib/access-control";

/** Quản lý lịch, trạng thái tham gia và vòng đời của các buổi học trực tuyến. */
export default function LiveClassesPage() {
  const { session, notify } = useApp();
  const searchParams = useSearchParams();
  const allowed = [
    "SYSTEM_ADMIN",
    "CENTER_MANAGER",
    "INSTRUCTOR",
    "LEARNER",
  ].includes(session.roleCode);
  const instructor = session.roleCode === "INSTRUCTOR";
  const learner = session.roleCode === "LEARNER";
  const manager =
    ["SYSTEM_ADMIN", "CENTER_MANAGER"].includes(session.roleCode) &&
    hasPermission(session, "class:manage");
  const [items, setItems] = useState<LiveSession[]>([]);
  const pagination = usePagination(items);
  const [classes, setClasses] = useState<LearningClass[]>([]);
  const [loading, setLoading] = useState(true);
  const [scheduleView, setScheduleView] = useState<"week" | "month">("week");
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
  /** Nạp lớp và buổi trực tuyến theo phạm vi vai trò, đồng thời giữ bộ lọc hiện tại. */
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
  /** Đưa buổi học được mở từ lịch hoặc thông báo vào giữa vùng nhìn. */
  useEffect(() => {
    const sessionId = searchParams.get("sessionId");
    if (!sessionId || loading) return;
    const timer = window.setTimeout(() => {
      const node = document.getElementById(`session-${sessionId}`);
      if (node) node.scrollIntoView({ behavior: "smooth", block: "center" });
      else
        notify(
          "Buổi học không còn khả dụng hoặc bạn không có quyền xem.",
          "error",
        );
    }, 100);
    return () => window.clearTimeout(timer);
  }, [items, loading, notify, searchParams]);
  useEffect(() => {
    /** Cập nhật mốc thời gian dùng để tính trạng thái sắp diễn ra/đang học trên giao diện. */
    const updateClock = () => setClock(Date.now());
    updateClock();
    const timer = window.setInterval(updateClock, 30_000);
    return () => window.clearInterval(timer);
  }, []);
  /** Tạo buổi học trực tuyến mới sau khi chuẩn hóa mốc thời gian sang ISO. */
  const create = async (event: React.FormEvent) => {
    event.preventDefault();
    try {
      await apiRequest(
        manager
          ? `/manager/classes/${form.classId}/sessions`
          : `/instructor/classes/${form.classId}/sessions`,
        {
          method: "POST",
          roleCode: session.roleCode,
          body: JSON.stringify({
            title: form.title,
            startsAt: new Date(form.startsAt).toISOString(),
            endsAt: new Date(form.endsAt).toISOString(),
            provider: form.provider,
          }),
        },
      );
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
  /** Chuẩn hóa dữ liệu buổi học vào input datetime-local và mở editor đổi lịch. */
  const openEdit = (item: LiveSession) => {
    setEditing(item);
    setForm({
      classId: item.classId,
      title: item.title,
      startsAt: new Date(item.startsAt).toISOString().slice(0, 16),
      endsAt: new Date(item.endsAt).toISOString().slice(0, 16),
      provider: item.provider,
      reason: "",
    });
    setOpen(true);
  };
  /** Đổi lịch buổi học, ghi nhận lý do và để máy chủ phát thông báo cho lớp. */
  const update = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!editing) return;
    try {
      await apiRequest(`/manager/sessions/${editing.id}`, {
        method: "PATCH",
        roleCode: session.roleCode,
        body: JSON.stringify({
          title: form.title,
          startsAt: new Date(form.startsAt).toISOString(),
          endsAt: new Date(form.endsAt).toISOString(),
          provider: form.provider,
          reason: form.reason,
        }),
      });
      notify("Đã đổi lịch và gửi thông báo cho lớp.");
      setOpen(false);
      setEditing(null);
      await load();
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "Không đổi được lịch.",
        "error",
      );
    }
  };
  /** Hủy buổi học với lý do bắt buộc và làm mới lịch sau khi API gửi thông báo. */
  const cancel = async (item: LiveSession) => {
    const reason = window.prompt("Lý do hủy buổi học");
    if (!reason) return;
    try {
      await apiRequest(`/manager/sessions/${item.id}/cancel`, {
        method: "POST",
        roleCode: session.roleCode,
        body: JSON.stringify({ reason }),
      });
      notify("Đã hủy buổi học và gửi thông báo.");
      await load();
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "Không hủy được buổi học.",
        "error",
      );
    }
  };
  /** Chuyển trạng thái vận hành của buổi học qua endpoint hành động tương ứng. */
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
  /** Ghi nhận tham gia và mở liên kết phòng học được máy chủ cấp. */
  const join = async (item: LiveSession) => {
    try {
      const result = await apiRequest<{
        attendeeUrl: string;
        joinedAt: string;
      }>(`/learner/sessions/${item.id}/join`, {
        method: "POST",
        roleCode: session.roleCode,
      });
      setJoinedSessionId(item.id);
      window.open(result.attendeeUrl, "_blank", "noopener,noreferrer");
      notify(
        `Đã ghi nhận tham gia lúc ${new Date(result.joinedAt).toLocaleTimeString(activeLocale())}.`,
      );
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "Chưa thể vào lớp.",
        "error",
      );
    }
  };
  /** Ghi nhận thời điểm rời phòng để phục vụ đối soát điểm danh. */
  const leave = async (item: LiveSession) => {
    try {
      const result = await apiRequest<{ attendedMinutes: number }>(
        `/learner/sessions/${item.id}/leave`,
        { method: "POST", roleCode: session.roleCode },
      );
      setJoinedSessionId(null);
      notify(
        `Đã kết thúc phiên tham gia và ghi nhận ${result.attendedMinutes} phút.`,
      );
    } catch (error) {
      notify(
        error instanceof Error
          ? error.message
          : "Không kết thúc được phiên tham gia.",
        "error",
      );
    }
  };
  if (!allowed) return <AccessDenied />;
  return (
    <div className="w-full px-5 sm:px-6 lg:px-8 py-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-4">
        <PageHeader
          eyebrow="Synchronous Learning"
          title={learner ? "Lịch học trực tuyến" : "Lớp học online"}
          description={
            learner
              ? "Thời khóa biểu các ca học theo tuần và theo tháng, hỗ trợ điểm danh và vào phòng trực tuyến."
              : "Lập lịch, mở phòng, điểm danh và gắn bản ghi sau buổi học."
          }
          actions={
            instructor || manager ? (
              <Button
                onClick={() => {
                  setEditing(null);
                  setForm({
                    classId: classes[0]?.id ?? "",
                    title: "",
                    startsAt: "",
                    endsAt: "",
                    provider: "GOOGLE_MEET",
                    reason: "",
                  });
                  setOpen(true);
                }}
              >
                <CalendarPlus size={17} />
                Lên lịch
              </Button>
            ) : undefined
          }
        />

        {/* Nút chuyển đổi chế độ Lịch học Tuần / Tháng cho học sinh */}
        {learner && (
          <div className="inline-flex p-1 rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 self-start sm:self-auto shrink-0">
            <button
              type="button"
              onClick={() => setScheduleView("week")}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                scheduleView === "week"
                  ? "bg-white dark:bg-slate-900 text-blue-600 shadow-xs"
                  : "text-slate-600 dark:text-slate-400 hover:text-slate-900"
              }`}
            >
              <LayoutGrid size={14} />
              <span>Dạng tuần (Lưới)</span>
            </button>
            <button
              type="button"
              onClick={() => setScheduleView("month")}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                scheduleView === "month"
                  ? "bg-white dark:bg-slate-900 text-blue-600 shadow-xs"
                  : "text-slate-600 dark:text-slate-400 hover:text-slate-900"
              }`}
            >
              <List size={14} />
              <span>Dạng tháng (Danh sách)</span>
            </button>
          </div>
        )}
      </div>

      <SectionState loading={loading} empty={items.length === 0}>
        {learner && scheduleView === "week" ? (
          /* CHẾ ĐỘ DẠNG TUẦN (LƯỚI 7 NGÀY THỜI KHÓA BIỂU) CHO HỌC SINH */
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
            {[
              { day: "Thứ 2", offset: 1 },
              { day: "Thứ 3", offset: 2 },
              { day: "Thứ 4", offset: 3 },
              { day: "Thứ 5", offset: 4 },
              { day: "Thứ 6", offset: 5 },
              { day: "Thứ 7", offset: 6 },
              { day: "Chủ nhật", offset: 0 },
            ].map(({ day, offset }, idx) => {
              const daySessions = items.filter((session) => {
                const sDate = new Date(session.startsAt);
                return sDate.getDay() === offset;
              });

              return (
                <div
                  key={idx}
                  className={`p-3.5 rounded-2xl border flex flex-col justify-between min-h-48 transition-all ${
                    daySessions.length > 0
                      ? "bg-blue-50/40 dark:bg-blue-950/20 border-blue-200 dark:border-blue-900/60 shadow-2xs"
                      : "bg-white dark:bg-slate-900/60 border-slate-200 dark:border-slate-800"
                  }`}
                >
                  <div>
                    <div className="flex items-center justify-between border-b border-slate-200/60 dark:border-slate-800 pb-2 mb-2.5">
                      <span className="text-xs font-bold text-slate-900 dark:text-slate-100">{day}</span>
                      <span className="text-[10px] font-semibold text-slate-400">
                        {daySessions.length ? `${daySessions.length} ca` : "Trống"}
                      </span>
                    </div>

                    {daySessions.length > 0 ? (
                      <div className="space-y-2.5">
                        {daySessions.map((session) => {
                          const isLive = session.status === "LIVE";
                          const canJoin =
                            clock >= new Date(session.startsAt).getTime() - 15 * 60_000 &&
                            clock <= new Date(session.endsAt).getTime() + 30 * 60_000;

                          return (
                            <div
                              key={session.id}
                              className="p-2.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 space-y-1.5 shadow-2xs"
                            >
                              <div className="flex items-center justify-between gap-1">
                                <span
                                  className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${
                                    isLive
                                      ? "bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300 animate-pulse"
                                      : "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
                                  }`}
                                >
                                  {isLive ? "Đang học" : "Trực tuyến"}
                                </span>
                                <span className="text-[10px] text-slate-400 truncate">
                                  {session.provider.replace("_", " ")}
                                </span>
                              </div>

                              <p className="text-xs font-bold text-slate-900 dark:text-slate-100 line-clamp-2 leading-snug">
                                {session.title}
                              </p>

                              <p className="text-[10px] text-slate-500 flex items-center gap-1">
                                <Clock size={11} className="text-slate-400 shrink-0" />
                                <span>
                                  {new Date(session.startsAt).toLocaleTimeString(activeLocale(), {
                                    hour: "2-digit",
                                    minute: "2-digit",
                                  })}
                                  {" - "}
                                  {new Date(session.endsAt).toLocaleTimeString(activeLocale(), {
                                    hour: "2-digit",
                                    minute: "2-digit",
                                  })}
                                </span>
                              </p>

                              {joinedSessionId === session.id ? (
                                <button
                                  type="button"
                                  onClick={() => void leave(session)}
                                  className="w-full mt-1.5 py-1 px-2 rounded-lg bg-slate-200 hover:bg-slate-300 dark:bg-slate-800 text-slate-800 dark:text-slate-200 text-[10px] font-bold transition-colors"
                                >
                                  Rời & Điểm danh
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  disabled={!canJoin}
                                  onClick={() => void join(session)}
                                  className={`w-full mt-1.5 py-1 px-2 rounded-lg text-[10px] font-bold transition-colors ${
                                    canJoin
                                      ? "bg-blue-600 hover:bg-blue-700 text-white shadow-2xs"
                                      : "bg-slate-100 dark:bg-slate-800 text-slate-400 cursor-not-allowed"
                                  }`}
                                >
                                  {isLive ? "Vào lớp ngay" : canJoin ? "Vào phòng" : "Chưa đến giờ"}
                                </button>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="py-6 text-center text-[11px] text-slate-400 italic">
                        Không có ca học
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          /* CHẾ ĐỘ DẠNG THÁNG (DANH SÁCH CHI TIẾT) HOẶC VIEW CHO QUẢN TRỊ / GIẢNG VIÊN */
          <div className="space-y-4">
            {pagination.pageItems.map((item) => (
              <article
                className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-5 sm:p-6 shadow-xs hover:border-sky-300 dark:hover:border-sky-700 transition-all grid gap-5 lg:grid-cols-[auto_1fr_auto] lg:items-center"
                id={`session-${item.id}`}
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
                    {new Date(item.startsAt).toLocaleString(activeLocale())} —{" "}
                    {new Date(item.endsAt).toLocaleTimeString(activeLocale(), {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}{" "}
                    · {item.provider.replace("_", " ")}
                    {item.fallbackUsed
                      ? ` · fallback từ ${item.requestedProvider?.replace("_", " ")} sau ${item.provisioningAttempts} lần thử`
                      : item.provisioningAttempts && item.provisioningAttempts > 1
                        ? ` · ${item.provisioningAttempts} lần thử`
                        : ""}
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
                  {manager &&
                  item.status === "SCHEDULED" &&
                  new Date(item.startsAt) > new Date() ? (
                    <>
                      <Button onClick={() => openEdit(item)} variant="secondary">
                        <Pencil size={15} />
                        Đổi lịch
                      </Button>
                      <Button onClick={() => void cancel(item)} variant="ghost">
                        <Trash2 size={15} />
                        Hủy
                      </Button>
                    </>
                  ) : null}
                  {learner && joinedSessionId === item.id ? (
                    <Button onClick={() => void leave(item)} variant="secondary">
                      Rời phòng và chốt điểm danh
                    </Button>
                  ) : learner &&
                    (item.status === "SCHEDULED" || item.status === "LIVE") ? (
                    <Button
                      disabled={
                        clock < new Date(item.startsAt).getTime() - 15 * 60_000 ||
                        clock > new Date(item.endsAt).getTime() + 30 * 60_000
                      }
                      onClick={() => void join(item)}
                    >
                      {clock < new Date(item.startsAt).getTime() - 15 * 60_000
                        ? "Mở trước giờ học 15 phút"
                        : clock > new Date(item.endsAt).getTime() + 30 * 60_000
                          ? "Đã hết giờ tham gia"
                          : "Vào lớp"}{" "}
                      <ExternalLink size={15} />
                    </Button>
                  ) : null}
                </div>
              </article>
            ))}
          </div>
        )}
      </SectionState>
      <Pagination
        itemLabel="buổi học trực tuyến"
        onPageChange={pagination.setPage}
        onPageSizeChange={pagination.setPageSize}
        page={pagination.page}
        pageSize={pagination.pageSize}
        totalItems={pagination.totalItems}
      />
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={editing ? "Đổi lịch lớp trực tuyến" : "Lên lịch lớp trực tuyến"}
      >
        <form
          className="space-y-4"
          onSubmit={(e) => void (editing ? update(e) : create(e))}
        >
          <Field label="Lớp học">
            <SearchableSelect
              aria-label="Tìm và chọn lớp học"
              disabled={Boolean(editing)}
              onChange={(value) => setForm({ ...form, classId: value })}
              options={classes.map((item) => ({
                value: item.id,
                label: `${item.code} — ${item.name}`,
                description: item.term,
                keywords: item.id,
              }))}
              placeholder="Gõ mã hoặc tên lớp để lọc…"
              value={form.classId}
            />
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
          {editing ? (
            <Field label="Lý do đổi lịch">
              <textarea
                className={inputClass}
                minLength={5}
                required
                rows={3}
                value={form.reason}
                onChange={(e) => setForm({ ...form, reason: e.target.value })}
              />
            </Field>
          ) : null}
          <Button disabled={!editing && !form.classId} type="submit">
            Xác nhận lịch
          </Button>
        </form>
      </Modal>
    </div>
  );
}
