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
  Video,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AccessDenied } from "@/shared/auth/access-denied";
import { PageHeader } from "@/shared/ui/page-header";
import { SectionState } from "@/shared/ui/section-state";
import { SearchableSelect } from "@/shared/ui/searchable-select";
import {
  Button,
  Field,
  inputClass,
  Modal,
  StatusBadge,
} from "@/shared/ui/ui";
import type { PaginatedResponse } from "@/shared/hooks/use-server-pagination";
import { apiRequest } from "@/lib/api-client";
import { localDateTimeToIso, toLocalDateTimeInput } from "@/lib/date-time";
import type { LearningClass, LiveSession } from "@/lib/learning-types";
import { useApp } from "@/providers/app-provider";
import { useI18n } from "@/providers/i18n-provider";
import {
  GOOGLE_MEET_URL_ERROR,
  normalizeGoogleMeetUrlInput,
} from "@/features/class-detail/live-session-utils";
import { safeExternalUrl } from "@/lib/safe-content";

const WORKSPACE_ROLES = [
  "SYSTEM_ADMIN",
  "CENTER_MANAGER",
  "INSTRUCTOR",
  "LEARNER",
] as const;

const WEEK_DAY_NAMES = [
  "Thứ 2",
  "Thứ 3",
  "Thứ 4",
  "Thứ 5",
  "Thứ 6",
  "Thứ 7",
  "Chủ nhật",
] as const;

// Lấy mốc thời gian ngày thứ Hai đầu tuần từ một ngày bất kỳ.
function getMonday(d: Date): Date {
  const date = new Date(d);
  const day = date.getDay();
  const diff = (day === 0 ? -6 : 1) - day;
  date.setDate(date.getDate() + diff);
  date.setHours(0, 0, 0, 0);
  return date;
}

// Kiểm tra hai đối tượng thời gian có cùng ngày tháng năm hay không.
function isSameDay(d1: Date, d2: Date): boolean {
  return (
    d1.getFullYear() === d2.getFullYear() &&
    d1.getMonth() === d2.getMonth() &&
    d1.getDate() === d2.getDate()
  );
}

// Định dạng ngày và tháng dạng DD/MM từ đối tượng thời gian.
function formatDateDayMonth(d: Date): string {
  const day = d.getDate().toString().padStart(2, "0");
  const month = (d.getMonth() + 1).toString().padStart(2, "0");
  return `${day}/${month}`;
}

/** Hiển thị lịch học tổng hợp theo tuần và tháng của các lớp đối với giáo viên và học sinh. */
export default function LiveClassesPage() {
  const { session, notify } = useApp();
  const { t } = useI18n();
  const router = useRouter();
  const searchParams = useSearchParams();

  const knownWorkspaceRole = (WORKSPACE_ROLES as readonly string[]).includes(
    session.roleCode,
  );
  const instructor = session.roleCode === "INSTRUCTOR";
  const learner = session.roleCode === "LEARNER";
  const hasAggregatedSchedule = instructor || learner;
  const classIdParam = searchParams.get("classId")?.trim() ?? "";
  const sessionIdParam = searchParams.get("sessionId")?.trim() ?? "";
  const redirectHref = classIdParam
    ? `/courses/classes/${encodeURIComponent(classIdParam)}?tab=schedule${sessionIdParam ? `&sessionId=${encodeURIComponent(sessionIdParam)}` : ""}`
    : "/courses";

  const [items, setItems] = useState<LiveSession[]>([]);
  const [classes, setClasses] = useState<LearningClass[]>([]);
  const [loading, setLoading] = useState(true);
  const mountedRef = useRef(false);
  const loadRequestVersion = useRef(0);
  const [scheduleView, setScheduleView] = useState<"week" | "month">("week");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<LiveSession | null>(null);
  const [clock, setClock] = useState(0);
  const [form, setForm] = useState({
    classId: "",
    title: "",
    startsAt: "",
    endsAt: "",
    provider: "GOOGLE_MEET",
    meetingUrl: "",
  });

  const [currentDate, setCurrentDate] = useState(() => new Date());
  const currentMonday = useMemo(() => getMonday(currentDate), [currentDate]);

  const weekDays = useMemo(() => {
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(currentMonday);
      d.setDate(currentMonday.getDate() + i);
      return d;
    });
  }, [currentMonday]);

  const classById = useMemo(
    () => new Map(classes.map((entry) => [entry.id, entry])),
    [classes],
  );

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

  // Chuyển sang tuần hoặc tháng trước đó.
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

  // Chuyển sang tuần hoặc tháng tiếp theo.
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

  // Quay về mốc tuần hoặc tháng hiện tại.
  const handleToday = () => {
    setCurrentDate(new Date());
  };

  useEffect(() => {
    if (!knownWorkspaceRole || hasAggregatedSchedule) return;
    if (classIdParam || !sessionIdParam) {
      router.replace(redirectHref);
      return;
    }
    const controller = new AbortController();
    void apiRequest<LiveSession[]>("/sessions", {
      roleCode: session.roleCode,
      signal: controller.signal,
    })
      .then((rows) => {
        if (controller.signal.aborted) return;
        const matched = Array.isArray(rows)
          ? rows.find((entry) => entry.id === sessionIdParam)
          : undefined;
        router.replace(
          matched
            ? `/courses/classes/${encodeURIComponent(matched.classId)}?tab=schedule&sessionId=${encodeURIComponent(sessionIdParam)}`
            : "/courses",
        );
      })
      .catch(() => {
        if (!controller.signal.aborted) router.replace("/courses");
      });
    return () => controller.abort();
  }, [
    classIdParam,
    hasAggregatedSchedule,
    knownWorkspaceRole,
    redirectHref,
    router,
    session.roleCode,
    sessionIdParam,
  ]);

  /** Nạp danh sách lớp và buổi học trong cửa sổ tuần hoặc tháng cho giáo viên và học sinh. */
  const load = useCallback(async (signal?: AbortSignal) => {
    if (!hasAggregatedSchedule || !mountedRef.current) return;
    const requestVersion = ++loadRequestVersion.current;
    setLoading(true);
    try {
      let rangeStart: Date;
      let rangeEnd: Date;
      if (scheduleView === "week") {
        rangeStart = new Date(currentMonday);
        rangeStart.setHours(0, 0, 0, 0);
        rangeEnd = new Date(weekDays[6] ?? currentMonday);
        rangeEnd.setHours(23, 59, 59, 999);
      } else {
        rangeStart = new Date(
          currentDate.getFullYear(),
          currentDate.getMonth(),
          1,
          0,
          0,
          0,
          0,
        );
        rangeEnd = new Date(
          currentDate.getFullYear(),
          currentDate.getMonth() + 1,
          0,
          23,
          59,
          59,
          999,
        );
      }
      const params = new URLSearchParams({
        page: "1",
        pageSize: "100",
        from: rangeStart.toISOString(),
        to: rangeEnd.toISOString(),
      });
      const [sessionsResult, classData] = await Promise.all([
        apiRequest<PaginatedResponse<LiveSession> | LiveSession[]>(
          `/sessions/page?${params.toString()}`,
          { roleCode: session.roleCode, signal },
        ),
        apiRequest<LearningClass[]>("/classes", {
          roleCode: session.roleCode,
          signal,
        }),
      ]);
      if (
        signal?.aborted ||
        !mountedRef.current ||
        requestVersion !== loadRequestVersion.current
      ) {
        return;
      }
      if (Array.isArray(sessionsResult)) {
        setItems(sessionsResult);
      } else {
        setItems(Array.isArray(sessionsResult.items) ? sessionsResult.items : []);
      }
      setClasses(Array.isArray(classData) ? classData : []);
    } catch (error) {
      if (
        !signal?.aborted &&
        mountedRef.current &&
        requestVersion === loadRequestVersion.current
      ) {
        notify(
          error instanceof Error ? error.message : "Không tải được lịch học.",
          "error",
        );
      }
    } finally {
      if (
        !signal?.aborted &&
        mountedRef.current &&
        requestVersion === loadRequestVersion.current
      ) {
        setLoading(false);
      }
    }
  }, [
    currentDate,
    currentMonday,
    hasAggregatedSchedule,
    notify,
    scheduleView,
    session.roleCode,
    weekDays,
  ]);

  useEffect(() => {
    mountedRef.current = true;
    if (!hasAggregatedSchedule) {
      return () => {
        mountedRef.current = false;
      };
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => void load(controller.signal), 0);
    return () => {
      mountedRef.current = false;
      loadRequestVersion.current += 1;
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [hasAggregatedSchedule, load]);

  /** Đưa buổi học được mở từ lịch hoặc thông báo vào giữa vùng nhìn. */
  useEffect(() => {
    if (!hasAggregatedSchedule) return;
    const sessionId = searchParams.get("sessionId");
    if (!sessionId || loading) return;
    const timer = window.setTimeout(() => {
      const node = document.getElementById(`session-${sessionId}`);
      if (node) node.scrollIntoView({ behavior: "smooth", block: "center" });
      else {
        notify(
          "Buổi học không còn khả dụng hoặc bạn không có quyền xem.",
          "error",
        );
      }
    }, 100);
    return () => window.clearTimeout(timer);
  }, [hasAggregatedSchedule, items, loading, notify, searchParams]);

  useEffect(() => {
    if (!hasAggregatedSchedule) return;
    // Cập nhật mốc thời gian dùng để tính trạng thái sắp diễn ra/đang học trên giao diện.
    const updateClock = () => setClock(Date.now());
    updateClock();
    const timer = window.setInterval(updateClock, 30_000);
    return () => window.clearInterval(timer);
  }, [hasAggregatedSchedule]);

  /** Tạo buổi học mới gắn link Google Meet và chuẩn hóa mốc thời gian sang ISO. */
  const create = async (event: React.FormEvent) => {
    event.preventDefault();
    const normalizedMeetUrl = normalizeGoogleMeetUrlInput(form.meetingUrl);
    if (form.provider === "GOOGLE_MEET" && !normalizedMeetUrl) {
      notify(GOOGLE_MEET_URL_ERROR, "error");
      return;
    }
    try {
      await apiRequest(`/instructor/classes/${form.classId}/sessions`, {
        method: "POST",
        roleCode: session.roleCode,
        body: JSON.stringify({
          title: form.title,
          startsAt: localDateTimeToIso(form.startsAt),
          endsAt: localDateTimeToIso(form.endsAt),
          provider: form.provider,
          ...(normalizedMeetUrl ? { meetingUrl: normalizedMeetUrl } : {}),
        }),
      });
      notify("Đã thêm buổi học mới thành công.");
      setOpen(false);
      await load();
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "Không lên lịch được.",
        "error",
      );
    }
  };

  /** Chuẩn hóa dữ liệu buổi học vào input datetime-local theo giờ địa phương và mở hộp thoại đổi lịch. */
  const openEdit = (item: LiveSession) => {
    setEditing(item);
    setForm({
      classId: item.classId,
      title: item.title,
      startsAt: toLocalDateTimeInput(item.startsAt),
      endsAt: toLocalDateTimeInput(item.endsAt),
      provider: item.provider,
      meetingUrl: item.hostUrl || item.attendeeUrl || "",
    });
    setOpen(true);
  };

  /** Đổi lịch buổi học và để máy chủ phát thông báo cho lớp. */
  const update = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!editing) return;
    const normalizedMeetUrl = normalizeGoogleMeetUrlInput(form.meetingUrl);
    if (form.provider === "GOOGLE_MEET" && !normalizedMeetUrl) {
      notify(GOOGLE_MEET_URL_ERROR, "error");
      return;
    }
    try {
      await apiRequest(`/instructor/sessions/${editing.id}`, {
        method: "PATCH",
        roleCode: session.roleCode,
        body: JSON.stringify({
          title: form.title,
          startsAt: localDateTimeToIso(form.startsAt),
          endsAt: localDateTimeToIso(form.endsAt),
          provider: form.provider,
          ...(normalizedMeetUrl ? { meetingUrl: normalizedMeetUrl } : {}),
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

  /** Hủy buổi học chưa diễn ra và làm mới lịch sau khi API gửi thông báo. */
  const cancel = async (item: LiveSession) => {
    if (!window.confirm(`${t("Hủy buổi học")}?`)) return;
    try {
      await apiRequest(`/instructor/sessions/${item.id}/cancel`, {
        method: "POST",
        roleCode: session.roleCode,
        body: JSON.stringify({}),
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

  /** Chuyển trạng thái vận hành của buổi học qua endpoint giảng viên. */
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

  /** Mở liên kết phòng học trực tuyến được máy chủ xác thực theo vai trò giáo viên hoặc học sinh. */
  const join = async (item: LiveSession) => {
    const meetingWindow = window.open("", "_blank");
    if (!meetingWindow) {
      notify("Trình duyệt đã chặn cửa sổ phòng học.", "error");
      return;
    }
    meetingWindow.opener = null;
    try {
      const endpoint = learner
        ? `/learner/sessions/${item.id}/join`
        : `/sessions/${item.id}/join`;
      const result = await apiRequest<{
        attendeeUrl: string;
        joinedAt: string;
      }>(endpoint, {
        method: "POST",
        roleCode: session.roleCode,
      });
      const meetingUrl = safeExternalUrl(result.attendeeUrl);
      if (!meetingUrl) throw new Error("Liên kết phòng học không hợp lệ.");
      meetingWindow.location.replace(meetingUrl);
      notify(
        `Đã mở liên kết phòng học lúc ${new Date(result.joinedAt).toLocaleTimeString(activeLocale())}.`,
      );
    } catch (error) {
      meetingWindow.close();
      notify(
        error instanceof Error ? error.message : "Chưa thể vào lớp.",
        "error",
      );
    }
  };

  if (!knownWorkspaceRole) return <AccessDenied />;
  if (!hasAggregatedSchedule) return null;

  const monthSessions = items
    .filter((entry) => {
      const d = new Date(entry.startsAt);
      return (
        d.getMonth() === currentDate.getMonth() &&
        d.getFullYear() === currentDate.getFullYear()
      );
    })
    .sort(
      (left, right) =>
        new Date(left.startsAt).getTime() - new Date(right.startsAt).getTime(),
    );

  return (
    <div className="w-full px-5 sm:px-6 lg:px-8 py-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-3">
        <PageHeader
          title={t("Lịch học")}
          description={
            learner
              ? t(
                  "Lịch học tổng hợp theo tuần và tháng của tất cả các lớp đang theo học.",
                )
              : t(
                  "Lịch giảng dạy tổng hợp theo tuần và tháng của tất cả các lớp phụ trách.",
                )
          }
          actions={
            instructor ? (
              <Button
                onClick={() => {
                  setEditing(null);
                  const preselectedClassId =
                    classIdParam &&
                    classes.some((entry) => entry.id === classIdParam)
                      ? classIdParam
                      : (classes[0]?.id ?? "");
                  setForm({
                    classId: preselectedClassId,
                    title: "",
                    startsAt: "",
                    endsAt: "",
                    provider: "GOOGLE_MEET",
                    meetingUrl: "",
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
      <div className="flex flex-wrap items-center justify-between gap-3 p-2 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xs mb-4">
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

      <SectionState loading={loading} empty={false}>
        {scheduleView === "week" ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
            {weekDays.map((colDate, idx) => {
              const daySessions = items
                .filter((entry) => isSameDay(new Date(entry.startsAt), colDate))
                .sort(
                  (left, right) =>
                    new Date(left.startsAt).getTime() -
                    new Date(right.startsAt).getTime(),
                );
              const isColToday = isSameDay(colDate, new Date());
              const dayName = WEEK_DAY_NAMES[idx] ?? "Thứ 2";

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
                    <div className="border-b border-slate-200/60 dark:border-slate-800 pb-2 mb-2.5">
                      <p className="text-xs font-semibold text-slate-600 dark:text-slate-400">
                        {t(dayName)}
                        {isColToday ? ` - ${t("Hôm nay")}` : ""}
                      </p>
                      <p className="text-base sm:text-lg font-extrabold text-slate-900 dark:text-slate-100 tracking-tight">
                        {formatDateDayMonth(colDate)}
                      </p>
                    </div>

                    {daySessions.length > 0 ? (
                      <div className="space-y-2.5 flex-1">
                        {daySessions.map((sessionItem) => {
                          const isLive = sessionItem.status === "LIVE";
                          const isUpcoming =
                            clock < new Date(sessionItem.startsAt).getTime();
                          const joinable =
                            sessionItem.status === "SCHEDULED" ||
                            sessionItem.status === "LIVE";
                          const canJoin =
                            joinable &&
                            clock >=
                              new Date(sessionItem.startsAt).getTime() -
                                15 * 60_000 &&
                            clock <=
                              new Date(sessionItem.endsAt).getTime() +
                                30 * 60_000;
                          const classInfo = classById.get(sessionItem.classId);

                          return (
                            <div
                              key={sessionItem.id}
                              id={`session-${sessionItem.id}`}
                              className="p-3 rounded-xl bg-[#0070ba] dark:bg-[#0b57d0] text-white shadow-md space-y-2 hover:shadow-lg transition-shadow"
                            >
                              <div className="flex items-center justify-between gap-1">
                                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-white/20 text-white backdrop-blur-xs">
                                  <Radio
                                    size={11}
                                    className={isLive ? "animate-pulse" : ""}
                                  />
                                  <span>
                                    {isLive
                                      ? t("Đang diễn ra")
                                      : isUpcoming
                                        ? t("Sắp diễn ra")
                                        : t("Đã kết thúc")}
                                  </span>
                                </span>
                                <span className="text-[10px] text-white/80 font-medium">
                                  {sessionItem.provider.replace("_", " ")}
                                </span>
                              </div>

                              <div>
                                {classInfo ? (
                                  <p className="text-[10px] font-bold uppercase tracking-wide text-sky-100/90 truncate">
                                    {classInfo.code} · {classInfo.name}
                                  </p>
                                ) : null}
                                <h3 className="text-xs font-extrabold text-white line-clamp-2 leading-snug">
                                  {sessionItem.title}
                                </h3>
                                <p className="text-[10px] text-white/80 mt-0.5 flex items-center gap-1 font-medium">
                                  <Clock size={11} className="shrink-0" />
                                  <span>
                                    {new Date(
                                      sessionItem.startsAt,
                                    ).toLocaleTimeString(activeLocale(), {
                                      hour: "2-digit",
                                      minute: "2-digit",
                                    })}
                                    {" - "}
                                    {new Date(
                                      sessionItem.endsAt,
                                    ).toLocaleTimeString(activeLocale(), {
                                      hour: "2-digit",
                                      minute: "2-digit",
                                    })}
                                  </span>
                                </p>
                              </div>

                              <div className="pt-2 border-t border-white/20 flex flex-col gap-1.5">
                                {instructor ? (
                                  <>
                                    {sessionItem.status === "SCHEDULED" && (
                                      <button
                                        type="button"
                                        onClick={() =>
                                          void transition(sessionItem, "LIVE")
                                        }
                                        className="w-full py-1.5 px-2 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white text-[11px] font-bold transition-colors cursor-pointer flex items-center justify-center gap-1"
                                      >
                                        <Play size={12} /> {t("Bắt đầu ca dạy")}
                                      </button>
                                    )}
                                    {sessionItem.status === "LIVE" && (
                                      <button
                                        type="button"
                                        onClick={() =>
                                          void transition(
                                            sessionItem,
                                            "COMPLETED",
                                          )
                                        }
                                        className="w-full py-1.5 px-2 rounded-lg bg-rose-500 hover:bg-rose-600 text-white text-[11px] font-bold transition-colors cursor-pointer"
                                      >
                                        {t("Kết thúc ca dạy")}
                                      </button>
                                    )}
                                    {joinable && (
                                      <button
                                        type="button"
                                        onClick={() => void join(sessionItem)}
                                        className="w-full py-1 px-2 rounded-lg bg-white/20 hover:bg-white/30 text-white text-[10px] font-semibold transition-colors cursor-pointer flex items-center justify-center gap-1"
                                      >
                                        {t("Vào phòng")} <ExternalLink size={11} />
                                      </button>
                                    )}
                                  </>
                                ) : (
                                  joinable && (
                                    <button
                                      type="button"
                                      disabled={!canJoin && !isLive}
                                      onClick={() => void join(sessionItem)}
                                      className={`w-full py-1.5 px-2 rounded-lg text-[11px] font-bold transition-colors ${
                                        canJoin || isLive
                                          ? "bg-white text-[#0070ba] hover:bg-white/95 shadow-xs cursor-pointer"
                                          : "bg-white/15 text-white/60 cursor-not-allowed"
                                      }`}
                                    >
                                      {isLive
                                        ? t("Vào lớp ngay")
                                        : canJoin
                                          ? t("Vào phòng")
                                          : t("Chưa đến giờ")}
                                    </button>
                                  )
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
        ) : (
          <div className="space-y-4">
            {monthSessions.length === 0 ? (
              <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/60 p-12 text-center text-xs font-semibold text-slate-400 dark:text-slate-500">
                {t("Không có lịch học trong tháng này")}
              </div>
            ) : (
              monthSessions.map((item) => {
                const classInfo = classById.get(item.classId);
                const startsMs = new Date(item.startsAt).getTime();
                const endsMs = new Date(item.endsAt).getTime();
                const isLive = item.status === "LIVE";
                const canLearnerJoin =
                  isLive ||
                  (clock >= startsMs - 15 * 60_000 &&
                    clock <= endsMs + 30 * 60_000);

                return (
                  <article
                    className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-5 sm:p-6 shadow-xs hover:border-sky-300 dark:hover:border-sky-700 transition-all grid gap-5 lg:grid-cols-[auto_1fr_auto] lg:items-center"
                    id={`session-${item.id}`}
                    key={item.id}
                  >
                    <div
                      className={`grid size-12 place-items-center rounded-2xl ${
                        item.status === "LIVE"
                          ? "bg-rose-100 text-rose-600"
                          : "bg-sky-50 text-sky-700"
                      }`}
                    >
                      {item.status === "LIVE" ? (
                        <Radio className="animate-pulse" />
                      ) : (
                        <Video />
                      )}
                    </div>
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        {classInfo ? (
                          <span className="px-2 py-0.5 rounded-md bg-sky-50 dark:bg-sky-950/60 border border-sky-200/80 dark:border-sky-800/60 text-sky-700 dark:text-sky-300 text-xs font-mono font-bold">
                            {classInfo.code}
                          </span>
                        ) : null}
                        <h2 className="font-heading text-lg font-extrabold">
                          {item.title}
                        </h2>
                        <StatusBadge status={item.status} />
                      </div>
                      <p className="mt-2 text-xs sm:text-sm text-slate-500">
                        {classInfo ? `${classInfo.name} · ` : ""}
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
                          {t("Bắt đầu")}
                        </Button>
                      ) : null}
                      {instructor && item.status === "LIVE" ? (
                        <Button
                          onClick={() => void transition(item, "COMPLETED")}
                          variant="secondary"
                        >
                          {t("Kết thúc")}
                        </Button>
                      ) : null}
                      {instructor &&
                      item.status === "SCHEDULED" &&
                      new Date(item.startsAt) > new Date() ? (
                        <>
                          <Button
                            onClick={() => openEdit(item)}
                            variant="secondary"
                          >
                            <Pencil size={15} />
                            {t("Đổi lịch")}
                          </Button>
                          <Button
                            onClick={() => void cancel(item)}
                            variant="ghost"
                          >
                            <Trash2 size={15} />
                            {t("Hủy")}
                          </Button>
                        </>
                      ) : null}
                      {item.status !== "SCHEDULED" &&
                      item.status !== "LIVE" ? null : instructor ? (
                        <Button
                          onClick={() => void join(item)}
                          variant="secondary"
                        >
                          {t("Vào phòng")} <ExternalLink size={15} />
                        </Button>
                      ) : (
                        <Button
                          disabled={!canLearnerJoin}
                          onClick={() => void join(item)}
                        >
                          {clock < startsMs - 15 * 60_000 && !isLive
                            ? t("Chưa đến giờ")
                            : clock > endsMs + 30 * 60_000 && !isLive
                              ? t("Đã kết thúc")
                              : t("Vào lớp")}{" "}
                          <ExternalLink size={15} />
                        </Button>
                      )}
                    </div>
                  </article>
                );
              })
            )}
          </div>
        )}
      </SectionState>

      {instructor ? (
        <Modal
          open={open}
          onClose={() => setOpen(false)}
          title={editing ? t("Đổi lịch buổi học") : t("Thêm buổi học mới")}
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
            <Field label="Link Google Meet">
              <input
                className={inputClass}
                placeholder="https://meet.google.com/abc-defg-hij"
                required={form.provider === "GOOGLE_MEET"}
                type="url"
                value={form.meetingUrl}
                onChange={(e) => setForm({ ...form, meetingUrl: e.target.value })}
              />
            </Field>
            <Button disabled={!editing && !form.classId} type="submit">
              {t("Xác nhận lịch")}
            </Button>
          </form>
        </Modal>
      ) : null}
    </div>
  );
}
