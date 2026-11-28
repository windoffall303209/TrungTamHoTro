import { ChevronRight, Folder } from "lucide-react";

interface ClassFolderEntryProps {
  name: string;
  selected: boolean;
  expanded: boolean;
  onSelect: () => void;
  onToggle: () => void;
  toggleCursor?: boolean;
}

/** Hiển thị thư mục lớp với thao tác chọn và mở rộng độc lập. */
export function ClassFolderEntry({
  name,
  selected,
  expanded,
  onSelect,
  onToggle,
  toggleCursor = false,
}: ClassFolderEntryProps) {
  return (
    <div className="space-y-0.5">
      <div
        className={`flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs transition-colors cursor-pointer ${
          selected
            ? "text-blue-600 dark:text-blue-400 font-bold bg-blue-50/80 dark:bg-blue-950/50"
            : "text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800/60"
        }`}
        onClick={onSelect}
      >
        <div className="flex items-center gap-1.5 min-w-0">
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onToggle();
            }}
            className={`p-0.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200${toggleCursor ? " cursor-pointer" : ""}`}
          >
            <ChevronRight
              size={13}
              className={`transition-transform duration-150 ${expanded ? "rotate-90" : ""}`}
            />
          </button>
          <Folder size={15} className={selected ? "text-blue-600 fill-blue-500/20" : "text-slate-500"} />
          <span className="truncate">{name}</span>
        </div>
      </div>
    </div>
  );
}
