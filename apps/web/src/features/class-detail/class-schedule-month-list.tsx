import { Play } from "lucide-react";

export interface ClassScheduleMonthRow {
  date: string;
  time: string;
  title: string;
  status: string;
}

/** Hiển thị các buổi học ở chế độ tháng cho màn hình giảng viên và quản lý. */
export function ClassScheduleMonthList({
  rows,
  onJoin,
}: {
  rows: ClassScheduleMonthRow[];
  onJoin: () => void;
}) {
  return (
    <div className="space-y-3 pt-2">
      {rows.map((row, i) => (
        <div
          key={i}
          className="flex flex-col sm:flex-row sm:items-center justify-between p-3.5 rounded-xl border border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/40 hover:border-blue-300 transition-colors gap-3"
        >
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className={"px-2 py-0.5 rounded text-[10px] font-bold " + (
                row.status === "Hôm nay"
                  ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
                  : row.status === "Đã diễn ra"
                    ? "bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300"
                    : "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300"
              )}>
                {row.status}
              </span>
              <strong className="text-xs sm:text-sm font-bold text-slate-900 dark:text-slate-100">
                {row.title}
              </strong>
            </div>
            <p className="text-xs text-slate-500 flex items-center gap-2">
              <span>Ngày: {row.date}</span>
              <span>·</span>
              <span>Thời gian: {row.time}</span>
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={onJoin}
              className="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold transition-colors cursor-pointer"
            >
              <Play size={13} />
              <span>Vào phòng</span>
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
