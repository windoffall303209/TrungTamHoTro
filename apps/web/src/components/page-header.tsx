"use client";

import { useI18n } from "@/providers/i18n-provider";

// Hiển thị tiêu đề trang dùng chung tối giản, phân cấp rõ ràng và hỗ trợ song ngữ tự động.
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
  const { t } = useI18n();

  return (
    <div className="flex flex-col gap-2 border-b border-slate-200/90 dark:border-slate-800/80 pb-3 mb-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="max-w-3xl">
        {eyebrow ? (
          <span className="mb-1 inline-flex items-center gap-1.5 rounded-full bg-sky-50 dark:bg-sky-950/40 px-2.5 py-0.5 text-[11px] font-semibold text-sky-700 dark:text-sky-300 border border-sky-200/80 dark:border-sky-800/60 shadow-2xs">
            {t(eyebrow)}
          </span>
        ) : null}
        <h1 className="text-lg sm:text-xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
          {t(title)}
        </h1>
        <p className="mt-0.5 text-xs sm:text-[13px] leading-normal text-slate-500 dark:text-slate-400">
          {t(description)}
        </p>
      </div>
      {actions ? (
        <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>
      ) : null}
    </div>
  );
}

