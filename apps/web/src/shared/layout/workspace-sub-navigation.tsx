"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { LucideIcon } from "lucide-react";
import { useI18n } from "@/providers/i18n-provider";

export interface WorkspaceSubNavItem {
  href: string;
  label: string;
  description: string;
  icon: LucideIcon;
  badge?: string;
  exact?: boolean;
}

interface WorkspaceSubNavigationProps {
  title: string;
  ariaLabel: string;
  items: readonly WorkspaceSubNavItem[];
  asideClassName: string;
  showBadges?: boolean;
}

// Hiển thị menu dùng chung và giữ nguyên quy tắc chọn trang cùng cấu trúc của từng khu vực.
export function WorkspaceSubNavigation({
  title,
  ariaLabel,
  items,
  asideClassName,
  showBadges = false,
}: WorkspaceSubNavigationProps) {
  const pathname = usePathname();
  const { t } = useI18n();

  return (
    <aside className={asideClassName}>
      <div className="rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-3 shadow-xs space-y-1">
        <div className="px-3 py-1.5 text-[11px] font-extrabold uppercase tracking-wider text-slate-600">
          {title}
        </div>

        <nav aria-label={ariaLabel} className="space-y-1">
          {items.map(({ href, label, description, icon: Icon, badge, exact }) => {
            const active = exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? "page" : undefined}
                className={`w-full min-h-14 flex items-center justify-between px-3.5 py-2.5 rounded-xl font-bold text-xs sm:text-sm transition-all cursor-pointer ${
                  active
                    ? "bg-sky-50 dark:bg-sky-950/60 text-sky-700 dark:text-sky-300 border border-sky-200/80 dark:border-sky-800/60 shadow-2xs"
                    : "text-slate-600 dark:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800/60 border border-transparent"
                }`}
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <Icon
                    size={18}
                    className={active ? "text-sky-600 dark:text-sky-400 shrink-0" : "text-slate-600 shrink-0"}
                  />
                  <div className="min-w-0 text-left">
                    {showBadges ? (
                      <div className="flex items-center gap-1.5">
                        <span className="block truncate font-bold text-xs sm:text-[13px]">{t(label)}</span>
                        {badge && (
                          <span className="inline-flex items-center rounded-md bg-amber-50 dark:bg-amber-950/50 px-1.5 py-0.5 text-[9px] font-extrabold text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800">
                            {badge}
                          </span>
                        )}
                      </div>
                    ) : (
                      <span className="block truncate font-bold text-xs sm:text-[13px]">{t(label)}</span>
                    )}
                    <span className="block truncate text-[10px] font-normal text-slate-600 dark:text-slate-500">
                      {description}
                    </span>
                  </div>
                </div>
              </Link>
            );
          })}
        </nav>
      </div>
    </aside>
  );
}
