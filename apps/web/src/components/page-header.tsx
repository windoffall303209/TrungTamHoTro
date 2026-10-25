/** Tiêu đề trang dùng chung, giữ phần mô tả và thao tác căn chỉnh nhất quán. */
export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: string;
  description: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-4 border-b border-slate-200/90 dark:border-slate-800 pb-5 md:flex-row md:items-end md:justify-between">
      <div className="max-w-3xl">
        {eyebrow ? (
          <span className="mb-1.5 inline-flex items-center gap-1.5 rounded-full bg-emerald-50 dark:bg-emerald-950/60 px-2.5 py-0.5 text-[11px] font-bold text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
            {eyebrow}
          </span>
        ) : null}
        <h1 className="font-heading text-xl sm:text-2xl font-black leading-tight tracking-tight text-[var(--ink)]">
          {title}
        </h1>
        <p className="mt-1 max-w-2xl text-xs sm:text-sm leading-relaxed text-[var(--ink-soft)]">
          {description}
        </p>
      </div>
      {actions ? (
        <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>
      ) : null}
    </div>
  );
}
