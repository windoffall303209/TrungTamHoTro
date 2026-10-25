"use client";

export type OperationsView = "monitoring" | "data" | "content";

const sections: Array<{
  value: OperationsView;
  label: string;
  description: string;
}> = [
  {
    value: "monitoring",
    label: "Giám sát",
    description: "Cảnh báo và nhật ký hoạt động",
  },
  {
    value: "data",
    label: "Dữ liệu",
    description: "Sao lưu, khôi phục và lưu giữ",
  },
  {
    value: "content",
    label: "Nội dung",
    description: "Mẫu thông báo và kiểm duyệt",
  },
];

/** Chọn nhóm nghiệp vụ, giữ các biểu mẫu đã nhập khi chuyển vùng làm việc. */
export function OperationsNavigation({
  value,
  onChange,
}: {
  value: OperationsView;
  onChange: (value: OperationsView) => void;
}) {
  return (
    <nav
      aria-label="Nhóm công việc vận hành"
      className="mb-7 grid grid-cols-1 sm:grid-cols-3 gap-3"
    >
      {sections.map((section) => {
        const active = value === section.value;
        return (
          <button
            aria-pressed={active}
            className={`min-h-16 rounded-2xl p-4 text-left border transition-all ${
              active
                ? "border-sky-500 bg-sky-50/80 dark:bg-sky-950/40 text-sky-900 dark:text-sky-100 shadow-xs ring-2 ring-sky-500/20"
                : "border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 text-slate-700 dark:text-slate-300 hover:border-sky-300 dark:hover:border-sky-700 hover:shadow-xs"
            }`}
            key={section.value}
            onClick={() => onChange(section.value)}
            type="button"
          >
            <span className={`block text-sm font-extrabold ${active ? "text-sky-700 dark:text-sky-300" : "text-slate-900 dark:text-slate-100"}`}>
              {section.label}
            </span>
            <span
              className={`mt-1 block text-xs leading-5 ${active ? "text-sky-800/80 dark:text-sky-300/80" : "text-slate-500 dark:text-slate-400"}`}
            >
              {section.description}
            </span>
          </button>
        );
      })}
    </nav>
  );
}
