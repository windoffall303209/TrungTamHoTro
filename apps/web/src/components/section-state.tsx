"use client";

import { Inbox } from "lucide-react";
import { useI18n } from "@/providers/i18n-provider";

// Chuẩn hóa ba trạng thái loading, empty và nội dung của các danh sách kèm hỗ trợ song ngữ.
export function SectionState({
  loading,
  empty,
  children,
  emptyTitle = "Chưa có dữ liệu phù hợp",
  emptyDescription = "Dữ liệu sẽ xuất hiện tại đây khi có nội dung phù hợp.",
  emptyAction,
}: {
  loading: boolean;
  empty: boolean;
  children: React.ReactNode;
  emptyTitle?: string;
  emptyDescription?: string;
  emptyAction?: React.ReactNode;
}) {
  const { t } = useI18n();

  if (loading) {
    return (
      <div aria-label={t("Đang đồng bộ dữ liệu")} className="border-y border-[var(--rule)] bg-[var(--surface)]/65 px-5 py-6" role="status">
        <div aria-hidden="true" className="animate-pulse space-y-4">
          <div className="h-4 w-44 rounded bg-[var(--rule)]" />
          <div className="h-16 rounded-xl bg-[var(--surface-muted)]" />
          <div className="h-16 rounded-xl bg-[var(--surface-muted)]" />
          <div className="h-16 rounded-xl bg-[var(--surface-muted)]" />
        </div>
        <span className="sr-only">{t("Đang đồng bộ dữ liệu…")}</span>
      </div>
    );
  }

  if (empty) {
    return (
      <div className="grid min-h-36 place-items-center rounded-2xl border border-dashed border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50 px-4 py-6 text-center">
        <div>
          <Inbox aria-hidden="true" className="mx-auto text-slate-300 dark:text-slate-600" size={30} />
          <p className="mt-2 text-xs sm:text-sm font-bold text-slate-800 dark:text-slate-200">{t(emptyTitle)}</p>
          <p className="mx-auto mt-1 max-w-md text-xs leading-relaxed text-slate-500 dark:text-slate-400">{t(emptyDescription)}</p>
          {emptyAction ? <div className="mt-3">{emptyAction}</div> : null}
        </div>
      </div>
    );
  }

  return <>{children}</>;
}

