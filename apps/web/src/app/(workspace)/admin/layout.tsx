"use client";

import { Settings, ShieldCheck, ShieldEllipsis, Users } from "lucide-react";
import { useApp } from "@/providers/app-provider";
import { hasAnyPermission } from "@/lib/access-control";
import type { PermissionCode } from "@/lib/app-types";
import { WorkspaceSubNavigation, type WorkspaceSubNavItem } from "@/shared/layout/workspace-sub-navigation";

interface AdminSubNavItem extends WorkspaceSubNavItem {
  permissions?: PermissionCode[];
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
  const { session } = useApp();

  // Lọc các chức năng con theo quyền của phiên người dùng
  const filteredNavItems = adminSubNavItems.filter((item) => {
    if (!item.permissions) return true;
    if (session.roleCode === "SYSTEM_ADMIN") return true;
    return hasAnyPermission(session, item.permissions);
  });

  return (
    <div className="w-full px-4 sm:px-6 lg:px-8 py-5">
      {/* BỐ CỤC 2 CỘT: HEADER DỌC CHỨC NĂNG CON (TRÁI) + TÁC NGHIỆP CHÍNH (PHẢI) */}
      <div className="flex flex-col lg:flex-row items-start gap-5">
        {/* HEADER DỌC QUẢN TRỊ HỆ THỐNG */}
        <WorkspaceSubNavigation
          title="Chức năng quản trị"
          ariaLabel="Menu chức năng quản trị"
          items={filteredNavItems}
          asideClassName="w-full lg:w-64 shrink-0 space-y-3.5 sticky top-[85px]"
        />

        {/* KHU VỰC TÁC NGHIỆP CHÍNH */}
        <main className="flex-1 min-w-0 w-full space-y-4">
          {children}
        </main>
      </div>
    </div>
  );
}
