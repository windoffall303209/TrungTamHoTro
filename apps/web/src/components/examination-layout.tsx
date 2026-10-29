"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BookOpenCheck, Database, FileQuestion, Sparkles } from "lucide-react";
import { useApp } from "@/providers/app-provider";
import { useI18n } from "@/providers/i18n-provider";

export interface ExamSubNavItem {
  href: string;
  label: string;
  description: string;
  icon: typeof BookOpenCheck;
  badge?: string;
  exact?: boolean;
}

export const examSubNavItems: ExamSubNavItem[] = [
  {
    href: "/exams",
    label: "Đề thi & Kết quả",
    description: "Tạo đề, giao bài & bảng điểm",
    icon: BookOpenCheck,
    exact: true,
  },
  {
    href: "/questions",
    label: "Ngân hàng câu hỏi",
    description: "Kho câu hỏi & ma trận đề",
    icon: FileQuestion,
    exact: true,
  },
  {
    href: "/questions/scan",
    label: "Quét đề bằng AI",
    description: "Số hóa câu hỏi từ ảnh & PDF",
    icon: Sparkles,
    badge: "AI",
    exact: true,
  },
  {
    href: "/materials",
    label: "Kho học liệu",
    description: "Tài liệu & bài giảng số",
    icon: Database,
  },
];

/** Khung bố cục chuẩn Khảo thí: Tích hợp Header dọc bên trái cho các chức năng con và khu vực tác nghiệp chính. */
export function ExaminationLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { session } = useApp();
  const { t } = useI18n();

  // Học viên làm bài toàn màn hình, không hiển thị Header dọc quản trị khảo thí
  if (session.roleCode === "LEARNER") {
    return <>{children}</>;
  }

  return (
    <div className="w-full px-4 sm:px-6 lg:px-8 py-5">
      {/* BỐ CỤC 2 CỘT: HEADER DỌC CHỨC NĂNG CON (TRÁI) + TÁC NGHIỆP CHÍNH (PHẢI) */}
      <div className="flex flex-col lg:flex-row items-start gap-5">
        {/* HEADER DỌC KHẢO THÍ */}
        <aside className="w-full lg:w-64 shrink-0 space-y-3.5 sticky top-[85px]">
          <div className="rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-3 shadow-xs space-y-1">
            <div className="px-3 py-1.5 text-[11px] font-extrabold uppercase tracking-wider text-slate-400">
              Chức năng khảo thí
            </div>

            <nav aria-label="Menu chức năng khảo thí" className="space-y-1">
              {examSubNavItems.map(({ href, label, description, icon: Icon, badge, exact }) => {
                const active = exact
                  ? pathname === href
                  : pathname === href || pathname.startsWith(`${href}/`);
                return (
                  <Link
                    key={href}
                    href={href}
                    className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl font-bold text-xs sm:text-sm transition-all cursor-pointer ${
                      active
                        ? "bg-sky-50 dark:bg-sky-950/60 text-sky-700 dark:text-sky-300 border border-sky-200/80 dark:border-sky-800/60 shadow-2xs"
                        : "text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800/60 border border-transparent"
                    }`}
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <Icon
                        size={18}
                        className={active ? "text-sky-600 dark:text-sky-400 shrink-0" : "text-slate-400 shrink-0"}
                      />
                      <div className="min-w-0 text-left">
                        <div className="flex items-center gap-1.5">
                          <span className="block truncate font-bold text-xs sm:text-[13px]">{t(label)}</span>
                          {badge && (
                            <span className="inline-flex items-center rounded-md bg-amber-50 dark:bg-amber-950/50 px-1.5 py-0.5 text-[9px] font-extrabold text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800">
                              {badge}
                            </span>
                          )}
                        </div>
                        <span className="block truncate text-[10px] font-normal text-slate-400 dark:text-slate-500">
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

        {/* VÙNG NỘI DUNG TÁC NGHIỆP CHÍNH */}
        <main className="flex-1 min-w-0 w-full">
          {children}
        </main>
      </div>
    </div>
  );
}
