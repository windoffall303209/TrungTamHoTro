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
      className="mb-7 grid divide-y divide-[var(--rule)] border-y border-[var(--rule-strong)] sm:grid-cols-3 sm:divide-x sm:divide-y-0"
    >
      {sections.map((section) => (
        <button
          aria-pressed={value === section.value}
          className={`min-h-16 px-4 py-3 text-left ${value === section.value ? "bg-[var(--action)] text-[var(--action-ink)]" : "text-[var(--ink)] hover:bg-[var(--surface-muted)]"}`}
          key={section.value}
          onClick={() => onChange(section.value)}
          type="button"
        >
          <span className="block text-sm font-bold">{section.label}</span>
          <span
            className={`mt-1 block text-xs leading-5 ${value === section.value ? "text-[var(--action-ink)]" : "text-[var(--ink-soft)]"}`}
          >
            {section.description}
          </span>
        </button>
      ))}
    </nav>
  );
}
