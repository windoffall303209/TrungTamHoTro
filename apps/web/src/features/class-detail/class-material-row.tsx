import type { ReactNode } from "react";

interface ClassMaterialRowProps {
  fileType: string;
  title: string;
  size?: string;
  uploadedAt: string;
  selected: boolean;
  onSelect: () => void;
  titleBadge?: ReactNode;
  trailing?: ReactNode;
}

/** Chọn màu nền nhãn định dạng tệp theo đuôi tài liệu học tập. */
function resolveFileTypeBadgeClass(fileType: string): string {
  if (fileType === "pdf") return "bg-rose-600";
  if (fileType === "xlsx") return "bg-emerald-600";
  if (fileType === "pptx") return "bg-amber-600";
  return "bg-blue-600";
}

/** Hiển thị một hàng chọn học liệu dùng chung giữa giảng viên, học viên và quản lý. */
export function ClassMaterialRow({
  fileType,
  title,
  size,
  uploadedAt,
  selected,
  onSelect,
  titleBadge,
  trailing,
}: ClassMaterialRowProps) {
  return (
    <div
      onClick={onSelect}
      className={`flex items-center justify-between p-3 rounded-xl border transition-all cursor-pointer ${
        selected
          ? "bg-emerald-50/70 dark:bg-emerald-950/30 border-emerald-400 dark:border-emerald-500 shadow-2xs"
          : "bg-white dark:bg-slate-900/60 border-slate-200/80 dark:border-slate-800 hover:border-emerald-300 dark:hover:border-emerald-800"
      }`}
    >
      <div className="flex items-center gap-3 min-w-0 flex-1 pr-3">
        <div
          className={`size-8 rounded-lg text-white font-bold text-xs uppercase flex items-center justify-center shrink-0 shadow-xs ${resolveFileTypeBadgeClass(
            fileType,
          )}`}
        >
          {fileType}
        </div>
        <div className="min-w-0 flex-1 space-y-1">
          {titleBadge ? (
            <div className="flex items-center gap-2">
              <strong className="text-xs sm:text-sm font-bold text-slate-900 dark:text-slate-100 block truncate">
                {title}
              </strong>
              {titleBadge}
            </div>
          ) : (
            <strong className="text-xs sm:text-sm font-bold text-slate-900 dark:text-slate-100 block truncate">
              {title}
            </strong>
          )}
          <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
            {size ? `${size} · ` : ""}Tải lên {uploadedAt}
          </p>
        </div>
      </div>
      {trailing ? <div className="shrink-0 text-right">{trailing}</div> : null}
    </div>
  );
}
