import { Ban, Pencil, Play, Radio, Square, Video } from "lucide-react";
import type { LiveSession } from "@/lib/learning-types";

export interface ClassScheduleMonthRow {
  id?: string;
  date: string;
  time: string;
  title: string;
  status: string;
  meetingUrl?: string;
  sessionStatus?: LiveSession["status"];
  isActionable?: boolean;
  waitingBeforeStart?: boolean;
  canEditOrCancel?: boolean;
  canTransition?: boolean;
}

// Xác định màu nhãn theo trạng thái diễn ra của buổi học.
function statusBadgeClassName(status: string): string {
  if (status === "Đang diễn ra") {
    return "bg-rose-100 text-rose-700 dark:bg-rose-950/70 dark:text-rose-300";
  }
  if (status === "Hôm nay") {
    return "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300";
  }
  if (status === "Đã diễn ra" || status === "Đã kết thúc") {
    return "bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300";
  }
  if (status === "Đã hủy") {
    return "bg-slate-200 text-slate-500 line-through dark:bg-slate-800 dark:text-slate-400";
  }
  return "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300";
}

/** Hiển thị các buổi học ở chế độ tháng cho màn hình giảng viên và quản lý. */
export function ClassScheduleMonthList({
  rows,
  onJoin,
  onEdit,
  onCancel,
  onStart,
  onComplete,
}: {
  rows: ClassScheduleMonthRow[];
  onJoin: (row: ClassScheduleMonthRow) => void;
  onEdit?: (row: ClassScheduleMonthRow) => void;
  onCancel?: (row: ClassScheduleMonthRow) => void;
  onStart?: (row: ClassScheduleMonthRow) => void;
  onComplete?: (row: ClassScheduleMonthRow) => void;
}) {
  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-slate-200 dark:border-slate-700 p-8 text-center text-xs text-slate-500 dark:text-slate-400">
        Không có lịch học trong tháng này.
      </div>
    );
  }

  return (
    <div className="space-y-3 pt-2">
      {rows.map((row, index) => {
        const showJoin =
          row.isActionable !== false &&
          row.sessionStatus !== "CANCELLED" &&
          row.sessionStatus !== "COMPLETED";

        return (
          <div
            key={row.id ?? `${row.date}-${row.title}-${index}`}
            className="flex flex-col sm:flex-row sm:items-center justify-between p-3.5 rounded-xl border border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/40 hover:border-blue-300 transition-colors gap-3"
          >
            <div className="space-y-1 min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={
                    "px-2 py-0.5 rounded text-[10px] font-bold " +
                    statusBadgeClassName(row.status)
                  }
                >
                  {row.status}
                </span>
                <strong className="text-xs sm:text-sm font-bold text-slate-900 dark:text-slate-100 truncate">
                  {row.title}
                </strong>
                {row.meetingUrl ? (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 text-[10px] font-semibold">
                    <Video size={11} />
                    Google Meet
                  </span>
                ) : null}
              </div>
              <p className="text-xs text-slate-500 flex flex-wrap items-center gap-2">
                <span>Ngày: {row.date}</span>
                <span>·</span>
                <span>Thời gian: {row.time}</span>
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2 shrink-0">
              {row.canTransition && row.sessionStatus === "SCHEDULED" && onStart ? (
                <button
                  type="button"
                  onClick={() => onStart(row)}
                  className="inline-flex items-center justify-center gap-1 px-2.5 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold transition-colors cursor-pointer"
                >
                  <Radio size={12} />
                  <span>Bắt đầu</span>
                </button>
              ) : null}
              {row.canTransition && row.sessionStatus === "LIVE" && onComplete ? (
                <button
                  type="button"
                  onClick={() => onComplete(row)}
                  className="inline-flex items-center justify-center gap-1 px-2.5 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold transition-colors cursor-pointer"
                >
                  <Square size={12} />
                  <span>Kết thúc</span>
                </button>
              ) : null}
              {row.canEditOrCancel && onEdit ? (
                <button
                  type="button"
                  onClick={() => onEdit(row)}
                  className="inline-flex items-center justify-center gap-1 px-2.5 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 hover:border-blue-400 text-xs font-semibold transition-colors cursor-pointer"
                >
                  <Pencil size={12} />
                  <span>Sửa</span>
                </button>
              ) : null}
              {row.canEditOrCancel && onCancel ? (
                <button
                  type="button"
                  onClick={() => onCancel(row)}
                  className="inline-flex items-center justify-center gap-1 px-2.5 py-1.5 rounded-xl border border-rose-200 dark:border-rose-900/60 bg-white dark:bg-slate-900 text-rose-600 dark:text-rose-300 hover:bg-rose-50 dark:hover:bg-rose-950/30 text-xs font-semibold transition-colors cursor-pointer"
                >
                  <Ban size={12} />
                  <span>Hủy</span>
                </button>
              ) : null}
              {showJoin ? (
                <button
                  type="button"
                  onClick={() => onJoin(row)}
                  className="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold transition-colors cursor-pointer"
                >
                  <Play size={13} />
                  <span>Vào phòng</span>
                </button>
              ) : row.waitingBeforeStart ? (
                <button
                  type="button"
                  disabled
                  className="inline-flex items-center justify-center px-3 py-1.5 rounded-xl bg-slate-200 dark:bg-slate-800 text-slate-500 dark:text-slate-400 text-xs font-semibold cursor-not-allowed"
                >
                  <span>Chưa tới giờ</span>
                </button>
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}
