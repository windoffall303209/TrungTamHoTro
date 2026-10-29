"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Settings, ShieldCheck, ShieldEllipsis, Users } from "lucide-react";
import { useApp } from "@/providers/app-provider";
import { useI18n } from "@/providers/i18n-provider";
import { hasAnyPermission } from "@/lib/access-control";

interface AdminSubNavItem {
  href: string;
  label: string;
  description: string;
  icon: typeof Users;
  permissions?: string[];
}

const adminSubNavItems: AdminSubNavItem[] = [
  {
    href: "/admin/users",
    label: "Người dùng",
    description: "Tài khoản & phân quyền",
    icon: Users,
    permissions: ["user:view"],
  },
  {
    href: "/admin/roles",
    label: "Vai trò & quyền",
    description: "Ma trận quyền hạn",
    icon: ShieldCheck,
    permissions: ["role:view"],
  },
  {
    href: "/admin/settings",
    label: "Cấu hình hệ thống",
    description: "Tham số & tích hợp AI",
    icon: Settings,
    permissions: ["system:configure"],
  },
  {
    href: "/admin/operations",
    label: "Vận hành & tuân thủ",
    description: "Nhật ký, sao lưu & audit",
    icon: ShieldEllipsis,
    permissions: ["system:configure"],
  },
];

// Khung bố cục chuẩn Quản trị hệ thống: Tích hợp Header dọc bên trái và khu vực tác nghiệp chính.
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { session } = useApp();
  const { t } = useI18n();

  // Lọc các chức năng con theo quyền của phiên người dùng
  const filteredNavItems = adminSubNavItems.filter((item) => {
    if (!item.permissions) return true;
    if (session.roleCode === "SYSTEM_ADMIN") return true;
    return hasAnyPermission(session, item.permissions as any);
  });

  return (
    <div className="w-full px-4 sm:px-6 lg:px-8 py-5">
      {/* BỐ CỤC 2 CỘT: HEADER DỌC CHỨC NĂNG CON (TRÁI) + TÁC NGHIỆP CHÍNH (PHẢI) */}
      <div className="flex flex-col lg:flex-row items-start gap-5">
        {/* HEADER DỌC QUẢN TRỊ HỆ THỐNG */}
        <aside className="w-full lg:w-64 shrink-0 space-y-3.5 sticky top-[85px]">
          <div className="rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-3 shadow-xs space-y-1">
            <div className="px-3 py-1.5 text-[11px] font-extrabold uppercase tracking-wider text-slate-400">
              Chức năng quản trị
            </div>

            <nav aria-label="Menu chức năng quản trị" className="space-y-1">
              {filteredNavItems.map(({ href, label, description, icon: Icon }) => {
                const active = pathname === href || pathname.startsWith(`${href}/`);
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
                        <span className="block truncate font-bold text-xs sm:text-[13px]">{t(label)}</span>
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

        {/* KHU VỰC TÁC NGHIỆP CHÍNH */}
        <main className="flex-1 min-w-0 w-full space-y-4">
          {children}
        </main>
      </div>
    </div>
  );
}
