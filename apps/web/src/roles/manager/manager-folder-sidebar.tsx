import { Folder, SlidersHorizontal } from "lucide-react";

interface ManagerFolderSidebarProps {
  title: string;
  allLabel: string;
  totalCount: number;
  folders: string[];
  counts: Map<string, number>;
  selectedFolder: string;
  onSelectFolder: (folder: string) => void;
  tone: "blue" | "purple";
}

const selectedClasses = {
  blue: {
    button: "text-blue-600 dark:text-blue-400 font-bold bg-blue-50/80 dark:bg-blue-950/50",
    icon: "text-blue-600 fill-blue-500/20",
  },
  purple: {
    button: "text-purple-600 dark:text-purple-400 font-bold bg-purple-50/80 dark:bg-purple-950/50",
    icon: "text-purple-600 fill-purple-500/20",
  },
} as const;

const unselectedButtonClass = "text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800/60";

/** Hiển thị danh sách thư mục dùng chung, giữ nguyên nhãn, số lượng và màu của từng tab quản lý. */
export function ManagerFolderSidebar({
  title,
  allLabel,
  totalCount,
  folders,
  counts,
  selectedFolder,
  onSelectFolder,
  tone,
}: ManagerFolderSidebarProps) {
  const selectedStyle = selectedClasses[tone];

  return (
    <div className="w-full lg:w-56 shrink-0 border-b lg:border-b-0 lg:border-r border-slate-200/80 dark:border-slate-800 p-3.5 space-y-3 bg-slate-50/50 dark:bg-slate-900/40">
      <div className="flex items-center justify-between text-xs font-bold text-slate-700 dark:text-slate-200 pb-2 border-b border-slate-200/60 dark:border-slate-800/60">
        <span>{title}</span>
        <SlidersHorizontal size={14} className="text-slate-400" />
      </div>

      <div className="space-y-1">
        <button
          type="button"
          onClick={() => onSelectFolder("__ALL__")}
          className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors text-left cursor-pointer ${
            selectedFolder === "__ALL__" ? selectedStyle.button : unselectedButtonClass
          }`}
        >
          <div className="flex items-center gap-2 min-w-0">
            <Folder
              size={16}
              className={selectedFolder === "__ALL__" ? selectedStyle.icon : "text-slate-400"}
            />
            <span className="truncate">{allLabel}</span>
          </div>
          <span className="text-[10px] text-slate-400 tabular-nums">{totalCount}</span>
        </button>

        {folders.map((folderName) => {
          const isSelected = selectedFolder === folderName;
          return (
            <button
              key={folderName}
              type="button"
              onClick={() => onSelectFolder(folderName)}
              className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors text-left cursor-pointer ${
                isSelected ? selectedStyle.button : unselectedButtonClass
              }`}
            >
              <div className="flex items-center gap-2 min-w-0">
                <Folder
                  size={15}
                  className={isSelected ? selectedStyle.icon : "text-slate-400"}
                />
                <span className="truncate">{folderName}</span>
              </div>
              <span className="text-[10px] text-slate-400 tabular-nums">{counts.get(folderName) ?? 0}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
