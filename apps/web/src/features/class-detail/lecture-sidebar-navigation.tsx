import { CalendarDays, FileText, Folder, MessageSquare, Users, Video } from "lucide-react";

export type LectureSidebarTab = "feed" | "schedule" | "members" | "assignments" | "lectures" | "materials";

/** Hiển thị điều hướng chung khi đang xem chi tiết bài giảng của học viên hoặc giảng viên. */
export function LectureSidebarNavigation({ onSelectTab }: { onSelectTab: (tab: LectureSidebarTab) => void }) {
  return (
    <nav className="space-y-1 pt-2 border-t border-slate-100 dark:border-slate-800">
      <p className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400 px-2 py-1">
        Danh mục
      </p>
      {[
        { id: "feed" as const, label: "Bảng tin", icon: MessageSquare },
        { id: "schedule" as const, label: "Lịch học", icon: CalendarDays },
        { id: "members" as const, label: "Thành viên", icon: Users },
        { id: "assignments" as const, label: "Bài tập", icon: FileText },
        { id: "lectures" as const, label: "Bài giảng", icon: Video, active: true },
        { id: "materials" as const, label: "Tài liệu", icon: Folder },
      ].map(({ id, label, icon: Icon, active }) => (
        <button
          key={id}
          type="button"
          onClick={() => onSelectTab(id)}
          className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-xl text-xs font-bold transition-all text-left cursor-pointer ${
            active
              ? "bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 border border-blue-200/80 dark:border-blue-800/60 shadow-2xs"
              : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800/50"
          }`}
        >
          <Icon size={15} className={active ? "text-blue-600 dark:text-blue-400" : "text-slate-400"} />
          <span className="truncate">{label}</span>
        </button>
      ))}
    </nav>
  );
}
