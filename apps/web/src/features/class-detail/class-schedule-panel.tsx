"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Clock,
  ExternalLink,
  LayoutGrid,
  List,
  Play,
  Plus,
  Video,
  X,
} from "lucide-react";
import { apiRequest } from "@/lib/api-client";
import type { RoleCode } from "@/lib/app-types";
import type { LearningClass, LiveSession } from "@/lib/learning-types";
import {
  ClassScheduleMonthList,
  type ClassScheduleMonthRow,
} from "./class-schedule-month-list";
import {
  addDaysToDate,
  buildDefaultSessionDraft,
  formatDayMonth,
  formatSessionStatusLabel,
  getWeekMonday,
  isSameCalendarDay,
  toLocalDateInputValue,
  toLocalTimeInputValue,
  validateSessionFormInput,
  type SessionFormValidationResult,
  type SessionFormValues,
} from "./live-session-utils";
import { detachOpener, safeExternalUrl } from "@/lib/safe-content";

export interface ClassSchedulePanelProps {
  classItem: LearningClass;
  roleCode: RoleCode;
  canManage: boolean;
  canTransitionStatus: boolean;
  addButtonLabel?: string;
  locale: string;
  notify: (message: string, tone?: "success" | "error" | "info") => void;
  t: (key: string) => string;
}

const WEEK_DAY_LABELS = [
  "Thứ 2",
  "Thứ 3",
  "Thứ 4",
  "Thứ 5",
  "Thứ 6",
  "Thứ 7",
  "Chủ nhật",
] as const;

// Trả về lớp màu trạng thái gọn trên thẻ tuần.
function weekCardStatusClassName(status: LiveSession["status"]): string {
  if (status === "LIVE") {
    return "bg-rose-100 text-rose-700 dark:bg-rose-950/70 dark:text-rose-300";
  }
  if (status === "COMPLETED") {
    return "bg-slate-200 text-slate-600 dark:bg-slate-800 dark:text-slate-300";
  }
  if (status === "CANCELLED") {
    return "bg-slate-200 text-slate-500 line-through dark:bg-slate-800 dark:text-slate-400";
  }
  return "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300";
}

/** Quản lý lịch học, tạo/sửa/hủy buổi học gắn link Google Meet và mở phòng học trực tuyến của lớp. */
export function ClassSchedulePanel({
  classItem,
  roleCode,
  canManage,
  canTransitionStatus,
  addButtonLabel = "Thêm buổi học mới",
  locale,
  notify,
  t,
}: ClassSchedulePanelProps) {
  const [scheduleView, setScheduleView] = useState<"week" | "month">("week");
  const [currentDate, setCurrentDate] = useState(() => new Date());
  const [sessions, setSessions] = useState<LiveSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [formOpen, setFormOpen] = useState(false);
  const [editingSession, setEditingSession] = useState<LiveSession | null>(null);
  const [formValues, setFormValues] = useState<SessionFormValues>(() =>
    buildDefaultSessionDraft(classItem),
  );
  const [fieldErrors, setFieldErrors] = useState<SessionFormValidationResult["errors"]>({});
  const [submitError, setSubmitError] = useState("");

  const [cancellingSession, setCancellingSession] = useState<LiveSession | null>(null);
  const [cancelError, setCancelError] = useState("");

  const requestCounterRef = useRef(0);
  const abortControllerRef = useRef<AbortController | null>(null);

  const isManagerRole = roleCode === "CENTER_MANAGER" || roleCode === "SYSTEM_ADMIN";

  // Nạp danh sách buổi học trực tuyến của riêng lớp hiện tại.
  const loadClassSessions = useCallback(async () => {
    const requestId = ++requestCounterRef.current;
    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;
    setLoading(true);
    try {
      const rows = await apiRequest<LiveSession[]>("/sessions", {
        roleCode,
        signal: controller.signal,
      });
      if (requestId !== requestCounterRef.current || controller.signal.aborted) {
        return;
      }
      const matched = Array.isArray(rows)
        ? rows
            .filter((entry) => entry.classId === classItem.id)
            .sort(
              (left, right) =>
                new Date(left.startsAt).getTime() - new Date(right.startsAt).getTime(),
            )
        : [];
      setSessions(matched);
    } catch (error) {
      if (!controller.signal.aborted && requestId === requestCounterRef.current) {
        setSessions([]);
        notify(
          error instanceof Error
            ? error.message
            : "Không tải được lịch học của lớp.",
          "error",
        );
      }
    } finally {
      if (!controller.signal.aborted && requestId === requestCounterRef.current) {
        setLoading(false);
      }
    }
  }, [classItem.id, notify, roleCode]);

  useEffect(() => {
    void loadClassSessions();
    return () => {
      requestCounterRef.current += 1;
      abortControllerRef.current?.abort();
    };
  }, [loadClassSessions]);

  const currentMonday = useMemo(() => getWeekMonday(currentDate), [currentDate]);
  const weekDays = useMemo(
    () => Array.from({ length: 7 }, (_, index) => addDaysToDate(currentMonday, index)),
    [currentMonday],
  );

  const periodLabel = useMemo(() => {
    if (scheduleView === "week") {
      const sunday = weekDays[6] ?? currentMonday;
      return `${t("Tuần")} ${formatDayMonth(currentMonday)} - ${formatDayMonth(sunday)}, ${currentMonday.getFullYear()}`;
    }
    return `${t("Tháng")} ${currentDate.getMonth() + 1}, ${currentDate.getFullYear()}`;
  }, [currentDate, currentMonday, scheduleView, t, weekDays]);

  const monthRows = useMemo<ClassScheduleMonthRow[]>(() => {
    const month = currentDate.getMonth();
    const year = currentDate.getFullYear();
    const now = new Date();
    return sessions
      .filter((entry) => {
        const startsAt = new Date(entry.startsAt);
        return startsAt.getMonth() === month && startsAt.getFullYear() === year;
      })
      .map((entry) => {
        const startsAt = new Date(entry.startsAt);
        const endsAt = new Date(entry.endsAt);
        const canEditOrCancel =
          canManage && entry.status === "SCHEDULED" && startsAt > now;
        const meetingUrl = entry.hostUrl || entry.attendeeUrl;
        return {
          id: entry.id,
          date: startsAt.toLocaleDateString(locale),
          time: `${startsAt.toLocaleTimeString(locale, {
            hour: "2-digit",
            minute: "2-digit",
          })} - ${endsAt.toLocaleTimeString(locale, {
            hour: "2-digit",
            minute: "2-digit",
          })}`,
          title: entry.title,
          status: formatSessionStatusLabel(entry, now),
          meetingUrl: meetingUrl || undefined,
          sessionStatus: entry.status,
          isActionable: entry.status !== "CANCELLED" && entry.status !== "COMPLETED",
          canEditOrCancel,
          canTransition: canManage && canTransitionStatus,
        };
      });
  }, [canManage, canTransitionStatus, currentDate, locale, sessions]);

  // Chuyển lùi hoặc tiến một tuần/tháng theo chế độ xem hiện tại.
  const shiftPeriod = (direction: -1 | 1) => {
    setCurrentDate((previous) => {
      const next = new Date(previous);
      if (scheduleView === "week") {
        next.setDate(next.getDate() + direction * 7);
      } else {
        next.setMonth(next.getMonth() + direction);
      }
      return next;
    });
  };

  // Mở modal tạo buổi học mới với khung giờ mặc định nằm trong lịch lớp.
  const openCreateModal = () => {
    setEditingSession(null);
    setFormValues(buildDefaultSessionDraft(classItem));
    setFieldErrors({});
    setSubmitError("");
    setFormOpen(true);
  };

  // Mở modal cập nhật thời gian hoặc link Google Meet cho buổi học sắp diễn ra.
  const openEditModal = (sessionItem: LiveSession) => {
    const startsAt = new Date(sessionItem.startsAt);
    const endsAt = new Date(sessionItem.endsAt);
    setEditingSession(sessionItem);
    setFormValues({
      title: sessionItem.title,
      date: toLocalDateInputValue(startsAt),
      startTime: toLocalTimeInputValue(startsAt),
      endTime: toLocalTimeInputValue(endsAt),
      meetingUrl: sessionItem.hostUrl || sessionItem.attendeeUrl || "",
    });
    setFieldErrors({});
    setSubmitError("");
    setFormOpen(true);
  };

  // Gửi yêu cầu tạo hoặc cập nhật buổi học sau khi kiểm tra hợp lệ phía client.
  const handleSubmitForm = async (event: React.FormEvent) => {
    event.preventDefault();
    if (saving) return;
    const validation = validateSessionFormInput({
      ...formValues,
      classItem,
    });
    setFieldErrors(validation.errors);
    if (
      !validation.valid ||
      !validation.startsAtIso ||
      !validation.endsAtIso ||
      !validation.normalizedMeetingUrl
    ) {
      setSubmitError(validation.firstError);
      return;
    }

    setSaving(true);
    setSubmitError("");
    try {
      if (editingSession) {
        const endpoint = isManagerRole
          ? `/manager/sessions/${encodeURIComponent(editingSession.id)}`
          : `/instructor/sessions/${encodeURIComponent(editingSession.id)}`;
        await apiRequest<LiveSession>(endpoint, {
          method: "PATCH",
          roleCode,
          body: JSON.stringify({
            title: formValues.title.trim(),
            startsAt: validation.startsAtIso,
            endsAt: validation.endsAtIso,
            provider: "GOOGLE_MEET",
            meetingUrl: validation.normalizedMeetingUrl,
          }),
        });
        notify("Đã cập nhật lịch học và link Google Meet.", "success");
      } else {
        const endpoint = isManagerRole
          ? `/manager/classes/${encodeURIComponent(classItem.id)}/sessions`
          : `/instructor/classes/${encodeURIComponent(classItem.id)}/sessions`;
        await apiRequest<LiveSession>(endpoint, {
          method: "POST",
          roleCode,
          body: JSON.stringify({
            title: formValues.title.trim(),
            startsAt: validation.startsAtIso,
            endsAt: validation.endsAtIso,
            provider: "GOOGLE_MEET",
            meetingUrl: validation.normalizedMeetingUrl,
          }),
        });
        notify("Đã thêm buổi học mới thành công.", "success");
      }
      setCurrentDate(new Date(validation.startsAtIso));
      setFormOpen(false);
      setEditingSession(null);
      await loadClassSessions();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Không thể lưu buổi học.";
      setSubmitError(message);
      notify(message, "error");
    } finally {
      setSaving(false);
    }
  };

  // Mở tab mới ngay khi nhấn rồi lấy liên kết Google Meet xác thực từ máy chủ.
  const handleJoinSession = async (sessionItem: LiveSession) => {
    const meetingWindow = detachOpener(window.open("", "_blank"));
    if (!meetingWindow) {
      notify("Trình duyệt đã chặn cửa sổ phòng học.", "error");
      return;
    }
    meetingWindow.opener = null;
    try {
      const result = await apiRequest<{ attendeeUrl: string; joinedAt: string }>(
        `/sessions/${encodeURIComponent(sessionItem.id)}/join`,
        {
          method: "POST",
          roleCode,
        },
      );
      if (!result?.attendeeUrl) {
        throw new Error("Buổi học chưa có liên kết phòng học.");
      }
      const meetingUrl = safeExternalUrl(result.attendeeUrl);
      if (!meetingUrl) throw new Error("Liên kết phòng học không hợp lệ.");
      meetingWindow.location.replace(meetingUrl);
    } catch (error) {
      meetingWindow.close();
      notify(
        error instanceof Error
          ? error.message
          : "Không thể tham gia phòng học.",
        "error",
      );
    }
  };

  // Chuyển trạng thái vận hành buổi học (LIVE hoặc COMPLETED) ngay trên lịch lớp.
  const handleTransitionSession = async (
    sessionItem: LiveSession,
    status: "LIVE" | "COMPLETED",
  ) => {
    try {
      await apiRequest<LiveSession>(
        `/instructor/sessions/${encodeURIComponent(sessionItem.id)}/status`,
        {
          method: "PATCH",
          roleCode,
          body: JSON.stringify({ status }),
        },
      );
      notify(
        status === "LIVE" ? "Đã bắt đầu buổi học." : "Đã kết thúc buổi học.",
        "success",
      );
      await loadClassSessions();
    } catch (error) {
      notify(
        error instanceof Error
          ? error.message
          : "Không thể cập nhật trạng thái buổi học.",
        "error",
      );
    }
  };

  // Xác nhận hủy buổi học và gửi thông báo cho lớp.
  const handleConfirmCancel = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!cancellingSession || saving) return;
    setSaving(true);
    setCancelError("");
    try {
      const endpoint = isManagerRole
        ? `/manager/sessions/${encodeURIComponent(cancellingSession.id)}/cancel`
        : `/instructor/sessions/${encodeURIComponent(cancellingSession.id)}/cancel`;
      await apiRequest<LiveSession>(endpoint, {
        method: "POST",
        roleCode,
        body: JSON.stringify({}),
      });
      notify("Đã hủy buổi học và gửi thông báo.", "success");
      setCancellingSession(null);
      await loadClassSessions();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Không hủy được buổi học.";
      setCancelError(message);
      notify(message, "error");
    } finally {
      setSaving(false);
    }
  };

  // Tìm buổi học gốc theo id khi nhận thao tác từ bảng dạng tháng.
  const findSessionById = (rowId?: string): LiveSession | undefined =>
    sessions.find((entry) => entry.id === rowId);

  const classWindowText = `${new Date(classItem.startAt).toLocaleDateString(locale)} - ${new Date(classItem.endAt).toLocaleDateString(locale)}`;
  const now = new Date();

  return (
    <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-5 shadow-xs space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 dark:border-slate-800 pb-3">
        <div>
          <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
            Lịch học của {classItem.name || classItem.code}
          </h3>
          <p className="text-xs text-slate-500">
            Theo dõi và quản lý các ca học, phòng học trực tuyến của lớp này.
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <div className="inline-flex p-1 rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
            <button
              type="button"
              onClick={() => setScheduleView("week")}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
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
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                scheduleView === "month"
                  ? "bg-white dark:bg-slate-900 text-blue-600 shadow-xs"
                  : "text-slate-600 dark:text-slate-400 hover:text-slate-900"
              }`}
            >
              <List size={14} />
              <span>Dạng tháng (Danh sách)</span>
            </button>
          </div>

          {canManage ? (
            <button
              type="button"
              onClick={openCreateModal}
              className="px-3.5 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold transition inline-flex items-center gap-1.5 cursor-pointer shadow-xs"
            >
              <Plus size={14} />
              <span>{addButtonLabel}</span>
            </button>
          ) : null}
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
        <span className="text-xs text-slate-500">
          Thời gian lớp: {classWindowText}
        </span>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => shiftPeriod(-1)}
            aria-label={t("Thời gian trước")}
            className="size-7 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 flex items-center justify-center text-slate-700 dark:text-slate-200 cursor-pointer"
          >
            <ChevronLeft size={14} />
          </button>
          <span className="text-xs font-bold text-slate-800 dark:text-slate-200 px-2 min-w-36 text-center">
            {periodLabel}
          </span>
          <button
            type="button"
            onClick={() => shiftPeriod(1)}
            aria-label={t("Thời gian sau")}
            className="size-7 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 flex items-center justify-center text-slate-700 dark:text-slate-200 cursor-pointer"
          >
            <ChevronRight size={14} />
          </button>
          <button
            type="button"
            onClick={() => setCurrentDate(new Date())}
            className="px-2.5 py-1 text-xs font-bold rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 cursor-pointer"
          >
            {t("Hôm nay")}
          </button>
        </div>
      </div>

      {loading ? (
        <div className="py-10 text-center text-xs text-slate-500">
          Đang tải lịch học của lớp...
        </div>
      ) : scheduleView === "week" ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-2.5 pt-1">
          {weekDays.map((colDate, index) => {
            const daySessions = sessions.filter((entry) =>
              isSameCalendarDay(new Date(entry.startsAt), colDate),
            );
            const isTodayColumn = isSameCalendarDay(colDate, now);

            return (
              <div
                key={colDate.toISOString()}
                className={`p-3 rounded-xl border flex flex-col justify-between min-h-44 ${
                  daySessions.length > 0
                    ? "bg-blue-50/50 dark:bg-blue-950/20 border-blue-200 dark:border-blue-900/60"
                    : isTodayColumn
                      ? "bg-emerald-50/40 dark:bg-emerald-950/10 border-emerald-200 dark:border-emerald-900/50"
                      : "bg-slate-50/60 dark:bg-slate-800/40 border-slate-100 dark:border-slate-800"
                }`}
              >
                <div className="space-y-2.5">
                  <div className="flex items-center justify-between border-b border-slate-200/60 dark:border-slate-800 pb-1.5">
                    <span className="text-xs font-bold text-slate-800 dark:text-slate-200">
                      {WEEK_DAY_LABELS[index]}
                    </span>
                    <span className="text-[10px] text-slate-400">
                      {formatDayMonth(colDate)}
                    </span>
                  </div>

                  {daySessions.length === 0 ? (
                    <p className="text-[11px] text-slate-400 italic pt-6 text-center">
                      Không có lịch học
                    </p>
                  ) : (
                    <div className="space-y-2.5">
                      {daySessions.map((entry) => {
                        const startsAt = new Date(entry.startsAt);
                        const endsAt = new Date(entry.endsAt);
                        const canEdit =
                          canManage &&
                          entry.status === "SCHEDULED" &&
                          startsAt > now;
                        const canJoin =
                          entry.status !== "CANCELLED" &&
                          entry.status !== "COMPLETED";
                        const hasMeet =
                          (entry.hostUrl || entry.attendeeUrl).includes(
                            "meet.google.com",
                          ) || entry.provider === "GOOGLE_MEET";

                        return (
                          <div
                            key={entry.id}
                            className="p-2.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-700/80 space-y-1.5 shadow-2xs"
                          >
                            <div className="flex items-center justify-between gap-1 flex-wrap">
                              <span
                                className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${weekCardStatusClassName(entry.status)}`}
                              >
                                {formatSessionStatusLabel(entry, now)}
                              </span>
                              {hasMeet ? (
                                <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-emerald-700 dark:text-emerald-300">
                                  <Video size={10} />
                                  Meet
                                </span>
                              ) : null}
                            </div>

                            <p className="text-xs font-bold text-slate-900 dark:text-slate-100 leading-snug line-clamp-2">
                              {entry.title}
                            </p>
                            <p className="text-[10px] text-slate-500 flex items-center gap-1">
                              <Clock size={11} />
                              <span>
                                {startsAt.toLocaleTimeString(locale, {
                                  hour: "2-digit",
                                  minute: "2-digit",
                                })}
                                {" - "}
                                {endsAt.toLocaleTimeString(locale, {
                                  hour: "2-digit",
                                  minute: "2-digit",
                                })}
                              </span>
                            </p>

                            <div className="space-y-1 pt-1">
                              {canJoin ? (
                                <button
                                  type="button"
                                  onClick={() => void handleJoinSession(entry)}
                                  className="w-full py-1.5 px-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-[11px] font-bold transition-colors cursor-pointer inline-flex items-center justify-center gap-1"
                                >
                                  <Play size={11} />
                                  <span>Vào phòng</span>
                                  <ExternalLink size={10} />
                                </button>
                              ) : null}

                              {canManage &&
                              canTransitionStatus &&
                              entry.status === "SCHEDULED" ? (
                                <button
                                  type="button"
                                  onClick={() =>
                                    void handleTransitionSession(entry, "LIVE")
                                  }
                                  className="w-full py-1 px-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-[10px] font-bold transition-colors cursor-pointer"
                                >
                                  Bắt đầu
                                </button>
                              ) : null}

                              {canManage &&
                              canTransitionStatus &&
                              entry.status === "LIVE" ? (
                                <button
                                  type="button"
                                  onClick={() =>
                                    void handleTransitionSession(
                                      entry,
                                      "COMPLETED",
                                    )
                                  }
                                  className="w-full py-1 px-2 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-[10px] font-bold transition-colors cursor-pointer"
                                >
                                  Kết thúc
                                </button>
                              ) : null}

                              {canEdit ? (
                                <div className="grid grid-cols-2 gap-1">
                                  <button
                                    type="button"
                                    onClick={() => openEditModal(entry)}
                                    className="py-1 px-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-[10px] font-semibold text-slate-700 dark:text-slate-200 hover:border-blue-400 cursor-pointer"
                                  >
                                    Sửa
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setCancellingSession(entry);
                                      setCancelError("");
                                    }}
                                    className="py-1 px-1.5 rounded-lg border border-rose-200 dark:border-rose-900/60 text-[10px] font-semibold text-rose-600 dark:text-rose-300 hover:bg-rose-50 dark:hover:bg-rose-950/30 cursor-pointer"
                                  >
                                    Hủy
                                  </button>
                                </div>
                              ) : null}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <ClassScheduleMonthList
          rows={monthRows}
          onJoin={(row) => {
            const target = findSessionById(row.id);
            if (target) void handleJoinSession(target);
          }}
          onEdit={(row) => {
            const target = findSessionById(row.id);
            if (target) openEditModal(target);
          }}
          onCancel={(row) => {
            const target = findSessionById(row.id);
            if (target) {
              setCancellingSession(target);
              setCancelError("");
            }
          }}
          onStart={(row) => {
            const target = findSessionById(row.id);
            if (target) void handleTransitionSession(target, "LIVE");
          }}
          onComplete={(row) => {
            const target = findSessionById(row.id);
            if (target) void handleTransitionSession(target, "COMPLETED");
          }}
        />
      )}

      {formOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 dark:bg-black/80 backdrop-blur-xs">
          <form
            onSubmit={(event) => void handleSubmitForm(event)}
            className="w-full max-w-lg rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl p-6 space-y-4"
          >
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
              <h3 className="text-base font-extrabold text-slate-900 dark:text-slate-100">
                {editingSession
                  ? "Chỉnh sửa buổi học"
                  : "Thêm buổi học mới"}
              </h3>
              <button
                type="button"
                disabled={saving}
                onClick={() => {
                  setFormOpen(false);
                  setEditingSession(null);
                }}
                aria-label="Đóng hộp thoại buổi học"
                className="text-slate-400 hover:text-slate-600 p-1 rounded-lg cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>

            {submitError ? (
              <div className="rounded-xl border border-rose-200 dark:border-rose-900/60 bg-rose-50 dark:bg-rose-950/30 px-3 py-2 text-xs text-rose-700 dark:text-rose-300 font-medium">
                {submitError}
              </div>
            ) : null}

            <div className="space-y-3 text-xs">
              <div>
                <label
                  htmlFor="class-session-title"
                  className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1"
                >
                  Tên buổi học <span className="text-rose-500">*</span>
                </label>
                <input
                  id="class-session-title"
                  type="text"
                  required
                  value={formValues.title}
                  onChange={(event) => {
                    setFormValues((prev) => ({
                      ...prev,
                      title: event.target.value,
                    }));
                    setFieldErrors((prev) => ({ ...prev, title: undefined }));
                  }}
                  placeholder="VD: Buổi 01: Hướng dẫn chuyên đề"
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs text-slate-900 dark:text-slate-100 font-medium"
                />
                {fieldErrors.title ? (
                  <p className="mt-1 text-[11px] text-rose-600 dark:text-rose-400">
                    {fieldErrors.title}
                  </p>
                ) : null}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label
                    htmlFor="class-session-date"
                    className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1"
                  >
                    Ngày học <span className="text-rose-500">*</span>
                  </label>
                  <input
                    id="class-session-date"
                    type="date"
                    required
                    value={formValues.date}
                    onChange={(event) => {
                      setFormValues((prev) => ({
                        ...prev,
                        date: event.target.value,
                      }));
                      setFieldErrors((prev) => ({ ...prev, time: undefined }));
                    }}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs text-slate-900 dark:text-slate-100"
                  />
                </div>
                <div>
                  <label
                    htmlFor="class-session-start"
                    className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1"
                  >
                    Giờ bắt đầu <span className="text-rose-500">*</span>
                  </label>
                  <input
                    id="class-session-start"
                    type="time"
                    required
                    value={formValues.startTime}
                    onChange={(event) => {
                      setFormValues((prev) => ({
                        ...prev,
                        startTime: event.target.value,
                      }));
                      setFieldErrors((prev) => ({ ...prev, time: undefined }));
                    }}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs text-slate-900 dark:text-slate-100"
                  />
                </div>
                <div>
                  <label
                    htmlFor="class-session-end"
                    className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1"
                  >
                    Giờ kết thúc <span className="text-rose-500">*</span>
                  </label>
                  <input
                    id="class-session-end"
                    type="time"
                    required
                    value={formValues.endTime}
                    onChange={(event) => {
                      setFormValues((prev) => ({
                        ...prev,
                        endTime: event.target.value,
                      }));
                      setFieldErrors((prev) => ({ ...prev, time: undefined }));
                    }}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs text-slate-900 dark:text-slate-100"
                  />
                </div>
              </div>
              {fieldErrors.time ? (
                <p className="text-[11px] text-rose-600 dark:text-rose-400">
                  {fieldErrors.time}
                </p>
              ) : (
                <p className="text-[11px] text-slate-400">
                  Buổi học phải nằm trong khoảng thời gian của lớp ({classWindowText}).
                </p>
              )}

              <div>
                <label
                  htmlFor="class-session-meet-url"
                  className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1"
                >
                  Link Google Meet <span className="text-rose-500">*</span>
                </label>
                <input
                  id="class-session-meet-url"
                  type="url"
                  required
                  value={formValues.meetingUrl}
                  onChange={(event) => {
                    setFormValues((prev) => ({
                      ...prev,
                      meetingUrl: event.target.value,
                    }));
                    setFieldErrors((prev) => ({
                      ...prev,
                      meetingUrl: undefined,
                    }));
                  }}
                  placeholder="https://meet.google.com/abc-defg-hij"
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs text-slate-900 dark:text-slate-100"
                />
                {fieldErrors.meetingUrl ? (
                  <p className="mt-1 text-[11px] text-rose-600 dark:text-rose-400">
                    {fieldErrors.meetingUrl}
                  </p>
                ) : (
                  <p className="mt-1 text-[11px] text-slate-400">
                    Dán liên kết phòng họp Google Meet thực tế để giảng viên và học viên mở trực tiếp.
                  </p>
                )}
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
              <button
                type="button"
                disabled={saving}
                onClick={() => {
                  setFormOpen(false);
                  setEditingSession(null);
                }}
                className="px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
              >
                Hủy bỏ
              </button>
              <button
                type="submit"
                disabled={saving}
                className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-xs font-bold cursor-pointer"
              >
                {saving
                  ? "Đang lưu..."
                  : editingSession
                    ? "Lưu thay đổi"
                    : "Tạo buổi học"}
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {cancellingSession ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 dark:bg-black/80 backdrop-blur-xs">
          <form
            onSubmit={(event) => void handleConfirmCancel(event)}
            className="w-full max-w-md rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl p-6 space-y-4"
          >
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
              <h3 className="text-base font-extrabold text-slate-900 dark:text-slate-100">
                Hủy buổi học
              </h3>
              <button
                type="button"
                disabled={saving}
                onClick={() => setCancellingSession(null)}
                aria-label="Đóng hộp thoại hủy buổi học"
                className="text-slate-400 hover:text-slate-600 p-1 rounded-lg cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>

            <p className="text-xs text-slate-600 dark:text-slate-300">
              Buổi học: <strong>{cancellingSession.title}</strong>
            </p>

            {cancelError ? (
              <p className="text-[11px] text-rose-600 dark:text-rose-400">
                {cancelError}
              </p>
            ) : null}

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
              <button
                type="button"
                disabled={saving}
                onClick={() => setCancellingSession(null)}
                className="px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
              >
                Giữ lại buổi học
              </button>
              <button
                type="submit"
                disabled={saving}
                className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 disabled:opacity-60 text-white text-xs font-bold cursor-pointer"
              >
                {saving ? "Đang hủy..." : "Xác nhận hủy"}
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </div>
  );
}
