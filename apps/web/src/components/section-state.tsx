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
      <div className="grid min-h-48 place-items-center border-y border-dashed border-[var(--rule-strong)] bg-[var(--surface)]/65 px-5 py-8 text-center">
        <div>
          <Inbox aria-hidden="true" className="mx-auto text-[var(--rule-strong)]" size={36} />
          <p className="mt-3 text-sm font-bold text-[var(--ink)]">{t(emptyTitle)}</p>
          <p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-[var(--ink-soft)]">{t(emptyDescription)}</p>
          {emptyAction ? <div className="mt-4">{emptyAction}</div> : null}
        </div>
      </div>
    );
  }

  return <>{children}</>;
}

