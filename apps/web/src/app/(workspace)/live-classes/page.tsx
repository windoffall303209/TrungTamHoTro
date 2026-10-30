"use client";

import { activeLocale } from "@/i18n/runtime";
import {
  CalendarPlus,
  ChevronLeft,
  ChevronRight,
  Clock,
  ExternalLink,
  Pencil,
  Play,
  Radio,
  Trash2,
  UserCheck,
  Video,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { AccessDenied } from "@/shared/auth/access-denied";
import { PageHeader } from "@/shared/ui/page-header";
import { SectionState } from "@/shared/ui/section-state";
import { SearchableSelect } from "@/shared/ui/searchable-select";
import {
  Button,
  Field,
  inputClass,
  Modal,
  Pagination,
  StatusBadge,
  usePagination,
} from "@/shared/ui/ui";
import { apiRequest } from "@/lib/api-client";
import type { LearningClass, LiveSession } from "@/lib/learning-types";
import { useApp } from "@/providers/app-provider";
import { useI18n } from "@/providers/i18n-provider";
import { hasPermission } from "@/lib/access-control";

// Lấy mốc thời gian ngày thứ Hai đầu tuần từ một ngày bất kỳ
function getMonday(d: Date): Date {
  const date = new Date(d);
  const day = date.getDay();
  const diff = (day === 0 ? -6 : 1) - day;
  date.setDate(date.getDate() + diff);
  date.setHours(0, 0, 0, 0);
  return date;
}

// Kiểm tra hai đối tượng thời gian có cùng ngày tháng năm hay không
function isSameDay(d1: Date, d2: Date): boolean {
  return (
    d1.getFullYear() === d2.getFullYear() &&
    d1.getMonth() === d2.getMonth() &&
    d1.getDate() === d2.getDate()
  );
}

// Định dạng ngày và tháng dạng DD/MM từ đối tượng thời gian
function formatDateDayMonth(d: Date): string {
  const day = d.getDate().toString().padStart(2, "0");
  const month = (d.getMonth() + 1).toString().padStart(2, "0");
  return `${day}/${month}`;
}

/** Quản lý lịch, trạng thái tham gia và vòng đời của các buổi học trực tuyến. */
export default function LiveClassesPage() {
  const { session, notify } = useApp();
  const { t } = useI18n();
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

  // Trạng thái ngày được chọn để duyệt tuần hoặc tháng
  const [currentDate, setCurrentDate] = useState(() => new Date());

  // Lấy mốc ngày thứ Hai đầu tuần hiện tại
  const currentMonday = useMemo(() => getMonday(currentDate), [currentDate]);

  // Lấy danh sách 7 ngày trong tuần từ thứ Hai đến Chủ nhật
  const weekDays = useMemo(() => {
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(currentMonday);
      d.setDate(currentMonday.getDate() + i);
      return d;
    });
  }, [currentMonday]);

  // Tính nhãn hiển thị khoảng thời gian theo tuần hoặc theo tháng
  const periodLabel = useMemo(() => {
    if (scheduleView === "week") {
      const sunday = weekDays[6] ?? currentMonday;
      const mDay = currentMonday.getDate();
      const mMonth = currentMonday.getMonth() + 1;
      const sDay = sunday.getDate();
      const sMonth = sunday.getMonth() + 1;
      const year = sunday.getFullYear();
      return `${t("Tuần")} ${mDay}/${mMonth} - ${sDay}/${sMonth}, ${year}`;
    }
    const month = currentDate.getMonth() + 1;
    const year = currentDate.getFullYear();
    return `${t("Tháng")} ${month}, ${year}`;
  }, [scheduleView, currentMonday, weekDays, currentDate, t]);

  // Chuyển sang tuần hoặc tháng trước đó
  const handlePrevPeriod = () => {
    setCurrentDate((prev) => {
      const next = new Date(prev);
      if (scheduleView === "week") {
        next.setDate(next.getDate() - 7);
      } else {
        next.setMonth(next.getMonth() - 1);
      }
      return next;
    });
  };

  // Chuyển sang tuần hoặc tháng tiếp theo
  const handleNextPeriod = () => {
    setCurrentDate((prev) => {
      const next = new Date(prev);
      if (scheduleView === "week") {
        next.setDate(next.getDate() + 7);
      } else {
        next.setMonth(next.getMonth() + 1);
      }
      return next;
    });
  };

  // Quay về mốc tuần hoặc tháng hiện tại
  const handleToday = () => {
    setCurrentDate(new Date());
  };
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
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-3">
        <PageHeader
          title={learner ? t("Lịch học trực tuyến") : t("Lớp học online")}
          description={
            learner
              ? t("Thời khóa biểu các ca học theo tuần và theo tháng, hỗ trợ điểm danh và vào phòng trực tuyến.")
              : t("Lập lịch, mở phòng, điểm danh và gắn bản ghi sau buổi học.")
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
                {t("Lên lịch")}
              </Button>
            ) : undefined
          }
        />
      </div>

      {/* Thanh công cụ lịch học: Chuyển Tuần/Tháng và Điều hướng thời gian */}
      {(learner || instructor) && (
        <div className="flex flex-wrap items-center justify-between gap-3 p-2 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xs mb-4">
          {/* Nút chuyển đổi chế độ Tuần / Tháng */}
          <div className="inline-flex p-1 rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200/80 dark:border-slate-700">
            <button
              type="button"
              onClick={() => setScheduleView("week")}
              className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                scheduleView === "week"
                  ? "bg-[#0b57d0] text-white shadow-xs"
                  : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200"
              }`}
            >
              {t("Tuần")}
            </button>
            <button
              type="button"
              onClick={() => setScheduleView("month")}
              className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                scheduleView === "month"
                  ? "bg-[#0b57d0] text-white shadow-xs"
                  : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200"
              }`}
            >
              {t("Tháng")}
            </button>
          </div>

          {/* Bộ điều hướng thời gian có nút chuyển lùi/tiến và mốc thời gian */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handlePrevPeriod}
              className="size-8 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 flex items-center justify-center text-slate-700 dark:text-slate-200 transition-colors cursor-pointer"
              title={t("Thời gian trước")}
            >
              <ChevronLeft size={16} />
            </button>

            <span className="text-xs sm:text-sm font-bold text-slate-900 dark:text-slate-100 px-2 min-w-36 sm:min-w-44 text-center">
              {periodLabel}
            </span>

            <button
              type="button"
              onClick={handleNextPeriod}
              className="size-8 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 flex items-center justify-center text-slate-700 dark:text-slate-200 transition-colors cursor-pointer"
              title={t("Thời gian sau")}
            >
              <ChevronRight size={16} />
            </button>

            <button
              type="button"
              onClick={handleToday}
              className="px-2.5 py-1 text-xs font-bold rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors cursor-pointer"
            >
              {t("Hôm nay")}
            </button>
          </div>
        </div>
      )}

      <SectionState loading={loading} empty={items.length === 0}>
        {(learner || instructor) && scheduleView === "week" ? (
          /* CHẾ ĐỘ DẠNG TUẦN (LƯỚI 7 NGÀY THỜI KHÓA BIỂU) CHO HỌC SINH VÀ GIẢNG VIÊN */
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
            {weekDays.map((colDate, idx) => {
              const daySessions = items.filter((session) => {
                const sDate = new Date(session.startsAt);
                return isSameDay(sDate, colDate);
              });
              const isColToday = isSameDay(colDate, new Date());
              const dayNames = [
                "Thứ 2",
                "Thứ 3",
                "Thứ 4",
                "Thứ 5",
                "Thứ 6",
                "Thứ 7",
                "Chủ nhật",
              ];
              const dayName = dayNames[idx];

              return (
                <div
                  key={idx}
                  className={`p-3 rounded-2xl border flex flex-col justify-between min-h-60 transition-all ${
                    isColToday
                      ? "bg-sky-50/50 dark:bg-sky-950/20 border-sky-300 dark:border-sky-800 shadow-xs"
                      : "bg-white dark:bg-slate-900/60 border-slate-200 dark:border-slate-800"
                  }`}
                >
                  <div className="flex-1 flex flex-col">
                    {/* Header cột thứ và ngày DD/MM */}
                    <div className="border-b border-slate-200/60 dark:border-slate-800 pb-2 mb-2.5">
                      <p className="text-xs font-semibold text-slate-600 dark:text-slate-400">
                        {t(dayName || "Thứ 2")}
                        {isColToday ? ` - ${t("Hôm nay")}` : ""}
                      </p>
                      <p className="text-base sm:text-lg font-extrabold text-slate-900 dark:text-slate-100 tracking-tight">
                        {formatDateDayMonth(colDate)}
                      </p>
                    </div>

                    {/* Danh sách ca học trong ngày */}
                    {daySessions.length > 0 ? (
                      <div className="space-y-2.5 flex-1">
                        {daySessions.map((session) => {
                          const isLive = session.status === "LIVE";
                          const isUpcoming = clock < new Date(session.startsAt).getTime();
                          const canJoin =
                            clock >= new Date(session.startsAt).getTime() - 15 * 60_000 &&
                            clock <= new Date(session.endsAt).getTime() + 30 * 60_000;
                          const isAttended = joinedSessionId === session.id;

                          return (
                            <div
                              key={session.id}
                              className="p-3 rounded-xl bg-[#0070ba] dark:bg-[#0b57d0] text-white shadow-md space-y-2 hover:shadow-lg transition-shadow"
                            >
                              <div className="flex items-center justify-between gap-1">
                                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-white/20 text-white backdrop-blur-xs">
                                  <Radio size={11} className={isLive ? "animate-pulse" : ""} />
                                  <span>
                                    {isLive
                                      ? t("Đang diễn ra")
                                      : isUpcoming
                                        ? t("Sắp diễn ra")
                                        : t("Đã kết thúc")}
                                  </span>
                                </span>
                                <span className="text-[10px] text-white/80 font-medium">
                                  {session.provider.replace("_", " ")}
                                </span>
                              </div>

                              <div>
                                <h3 className="text-xs font-extrabold text-white line-clamp-2 leading-snug">
                                  {session.title}
                                </h3>
                                <p className="text-[10px] text-white/80 mt-0.5 flex items-center gap-1 font-medium">
                                  <Clock size={11} className="shrink-0" />
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
                              </div>

                              <div className="pt-2 border-t border-white/20 flex flex-col gap-1.5">
                                {instructor ? (
                                  <div className="flex flex-col gap-1.5">
                                    {session.status === "SCHEDULED" && (
                                      <button
                                        type="button"
                                        onClick={() => void transition(session, "LIVE")}
                                        className="w-full py-1.5 px-2 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white text-[11px] font-bold transition-colors cursor-pointer flex items-center justify-center gap-1"
                                      >
                                        <Play size={12} /> {t("Bắt đầu ca dạy")}
                                      </button>
                                    )}
                                    {session.status === "LIVE" && (
                                      <button
                                        type="button"
                                        onClick={() => void transition(session, "COMPLETED")}
                                        className="w-full py-1.5 px-2 rounded-lg bg-rose-500 hover:bg-rose-600 text-white text-[11px] font-bold transition-colors cursor-pointer"
                                      >
                                        {t("Kết thúc ca dạy")}
                                      </button>
                                    )}
                                    <button
                                      type="button"
                                      onClick={() => void join(session)}
                                      className="w-full py-1 px-2 rounded-lg bg-white/20 hover:bg-white/30 text-white text-[10px] font-semibold transition-colors cursor-pointer flex items-center justify-center gap-1"
                                    >
                                      {t("Vào phòng")} <ExternalLink size={11} />
                                    </button>
                                  </div>
                                ) : (
                                  <>
                                    <div className="flex items-center justify-between text-[10px] text-white/90">
                                      <span className="flex items-center gap-1 font-semibold">
                                        <UserCheck size={12} />
                                        {isAttended ? t("Đã điểm danh") : t("Chưa điểm danh")}
                                      </span>
                                    </div>

                                    {isAttended ? (
                                      <button
                                        type="button"
                                        onClick={() => void leave(session)}
                                        className="w-full py-1.5 px-2 rounded-lg bg-white/20 hover:bg-white/30 text-white text-[11px] font-bold transition-colors cursor-pointer"
                                      >
                                        {t("Rời phòng")}
                                      </button>
                                    ) : (
                                      <button
                                        type="button"
                                        disabled={!canJoin && !isLive}
                                        onClick={() => void join(session)}
                                        className={`w-full py-1.5 px-2 rounded-lg text-[11px] font-bold transition-colors cursor-pointer ${
                                          canJoin || isLive
                                            ? "bg-white text-[#0070ba] hover:bg-white/95 shadow-xs"
                                            : "bg-white/10 text-white/50 cursor-not-allowed"
                                        }`}
                                      >
                                        {isLive ? t("Vào lớp ngay") : canJoin ? t("Vào phòng") : t("Chưa đến giờ")}
                                      </button>
                                    )}
                                  </>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="flex-1 flex items-center justify-center py-12 text-center text-xs text-slate-400 dark:text-slate-500 font-medium">
                        {t("Không có lịch học")}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (learner || instructor) && scheduleView === "month" ? (
          /* CHẾ ĐỘ DẠNG THÁNG CHO HỌC SINH VÀ GIẢNG VIÊN */
          <div className="space-y-4">
            {(() => {
              const monthSessions = items.filter((session) => {
                const d = new Date(session.startsAt);
                return (
                  d.getMonth() === currentDate.getMonth() &&
                  d.getFullYear() === currentDate.getFullYear()
                );
              });

              if (monthSessions.length === 0) {
                return (
                  <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/60 p-12 text-center text-xs font-semibold text-slate-400 dark:text-slate-500">
                    {t("Không có lịch học trong tháng này")}
                  </div>
                );
              }

              return monthSessions.map((item) => (
                <article
                  className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-5 sm:p-6 shadow-xs hover:border-sky-300 dark:hover:border-sky-700 transition-all grid gap-5 lg:grid-cols-[auto_1fr_auto] lg:items-center"
                  id={`session-${item.id}`}
                  key={item.id}
                >
                  <div
                    className={`grid size-12 place-items-center rounded-2xl ${
                      item.status === "LIVE" ? "bg-rose-100 text-rose-600" : "bg-sky-50 text-sky-700"
                    }`}
                  >
                    {item.status === "LIVE" ? <Radio className="animate-pulse" /> : <Video />}
                  </div>
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="font-heading text-lg font-extrabold">{item.title}</h2>
                      <StatusBadge status={item.status} />
                    </div>
                    <p className="mt-2 text-xs sm:text-sm text-slate-500">
                      {new Date(item.startsAt).toLocaleString(activeLocale())} —{" "}
                      {new Date(item.endsAt).toLocaleTimeString(activeLocale(), {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}{" "}
                      · {item.provider.replace("_", " ")}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {instructor && item.status === "SCHEDULED" ? (
                      <Button onClick={() => void transition(item, "LIVE")}>
                        <Play size={15} />
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
                    {instructor ? (
                      <Button onClick={() => void join(item)} variant="secondary">
                        Vào phòng <ExternalLink size={15} />
                      </Button>
                    ) : joinedSessionId === item.id ? (
                      <Button onClick={() => void leave(item)} variant="secondary">
                        {t("Rời phòng và chốt điểm danh")}
                      </Button>
                    ) : (
                      <Button
                        disabled={
                          clock < new Date(item.startsAt).getTime() - 15 * 60_000 ||
                          clock > new Date(item.endsAt).getTime() + 30 * 60_000
                        }
                        onClick={() => void join(item)}
                      >
                        {clock < new Date(item.startsAt).getTime() - 15 * 60_000
                          ? t("Chưa đến giờ")
                          : clock > new Date(item.endsAt).getTime() + 30 * 60_000
                            ? t("Đã kết thúc")
                            : t("Vào lớp")}{" "}
                        <ExternalLink size={15} />
                      </Button>
                    )}
                  </div>
                </article>
              ));
            })()}
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
