"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Settings, ShieldCheck, ShieldEllipsis, Users, Activity, Database, Server } from "lucide-react";
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

          {/* WIDGET TÓM TẮT HẠ TẦNG AN NINH & VẬN HÀNH */}
          <div className="rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white/70 dark:bg-slate-900/70 p-4 shadow-xs text-xs space-y-2.5 hidden lg:block">
            <div className="flex items-center justify-between text-[11px] font-bold uppercase tracking-wider text-slate-400">
              <span>Hạ tầng hệ thống</span>
              <span className="inline-flex items-center gap-1 text-[10px] text-emerald-600 dark:text-emerald-400 font-semibold">
                <span className="size-1.5 rounded-full bg-emerald-500 animate-pulse" />
                Ổn định
              </span>
            </div>
            <div className="flex items-center justify-between text-slate-600 dark:text-slate-400">
              <span className="flex items-center gap-1.5">
                <Server size={13} className="text-slate-400" />
                Máy chủ:
              </span>
              <span className="font-bold text-slate-900 dark:text-slate-100 tabular-nums">Trực tuyến (99.9%)</span>
            </div>
            <div className="flex items-center justify-between text-slate-600 dark:text-slate-400">
              <span className="flex items-center gap-1.5">
                <Database size={13} className="text-slate-400" />
                Cơ sở dữ liệu:
              </span>
              <span className="font-bold text-emerald-600 dark:text-emerald-400">Kết nối tốt</span>
            </div>
            <div className="flex items-center justify-between text-slate-600 dark:text-slate-400">
              <span className="flex items-center gap-1.5">
                <Activity size={13} className="text-slate-400" />
                Bảo mật & Audit:
              </span>
              <span className="font-bold text-sky-600 dark:text-sky-400">Tuân thủ v2.4</span>
            </div>
            <div className="pt-2 border-t border-slate-100 dark:border-slate-800 text-[11px] text-slate-400 flex items-center justify-between">
              <span>Nền tảng:</span>
              <span className="font-semibold text-slate-700 dark:text-slate-300">EduTech Cloud</span>
            </div>
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
