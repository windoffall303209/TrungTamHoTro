"use client";

import {
  Archive, Bell, BookOpenCheck, CalendarDays, ChartNoAxesCombined, CheckCheck, Database, FileQuestion,
  GraduationCap, Headphones, History, LayoutDashboard, ListChecks, LoaderCircle, Menu, MessageSquareText, Presentation, Settings,
  ShieldCheck, ShieldEllipsis, UserCheck, Users, X,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { apiRequest } from "@/lib/api-client";
import { useApp } from "@/providers/app-provider";
import type { RoleCode } from "@/lib/app-types";
import type { LearningNotification } from "@/lib/learning-types";

const roleOptions: Array<{ code: RoleCode; label: string }> = [
  { code: "SYSTEM_ADMIN", label: "Quản trị hệ thống" },
  { code: "CENTER_MANAGER", label: "Quản lý trung tâm" },
  { code: "INSTRUCTOR", label: "Giảng viên" },
  { code: "LEARNER", label: "Học viên" },
];

const navItems = [
  { href: "/dashboard", label: "Tổng quan", icon: LayoutDashboard, roles: roleOptions.map((role) => role.code) },
  { href: "/courses", label: "Khóa học & lớp", icon: GraduationCap, roles: ["CENTER_MANAGER", "INSTRUCTOR", "LEARNER"] },
  { href: "/materials", label: "Kho học liệu", icon: Database, roles: ["CENTER_MANAGER", "INSTRUCTOR", "LEARNER"] },
  { href: "/questions", label: "Ngân hàng câu hỏi", icon: FileQuestion, roles: ["INSTRUCTOR"] },
  { href: "/exams", label: "Đề & kết quả", icon: BookOpenCheck, roles: ["CENTER_MANAGER", "INSTRUCTOR", "LEARNER"] },
  { href: "/forum", label: "Diễn đàn", icon: MessageSquareText, roles: ["CENTER_MANAGER", "INSTRUCTOR", "LEARNER"] },
  { href: "/live-classes", label: "Lớp học online", icon: CalendarDays, roles: ["SYSTEM_ADMIN", "CENTER_MANAGER", "INSTRUCTOR", "LEARNER"] },
  { href: "/reports", label: "Báo cáo", icon: ChartNoAxesCombined, roles: ["CENTER_MANAGER", "INSTRUCTOR"] },
  { href: "/class-operations", label: "Điều hành lớp", icon: ListChecks, roles: ["CENTER_MANAGER"] },
  { href: "/attendance", label: "Giám sát điểm danh", icon: UserCheck, roles: ["CENTER_MANAGER"] },
  { href: "/class-lifecycle", label: "Vòng đời lớp", icon: Archive, roles: ["CENTER_MANAGER"] },
  { href: "/teaching-operations", label: "Nghiệp vụ giảng dạy", icon: Presentation, roles: ["INSTRUCTOR"] },
  { href: "/learning-history", label: "Lịch sử học tập", icon: History, roles: ["LEARNER"] },
  { href: "/support", label: "Hỗ trợ", icon: Headphones, roles: roleOptions.map((role) => role.code) },
  { href: "/admin/users", label: "Người dùng", icon: Users, roles: ["SYSTEM_ADMIN"] },
  { href: "/admin/roles", label: "Vai trò & quyền", icon: ShieldCheck, roles: ["SYSTEM_ADMIN"] },
  { href: "/admin/settings", label: "Cấu hình", icon: Settings, roles: ["SYSTEM_ADMIN"] },
  { href: "/admin/operations", label: "Vận hành & tuân thủ", icon: ShieldEllipsis, roles: ["SYSTEM_ADMIN"] },
] as const;

function Sidebar({ close }: { close?: () => void }) {
  const pathname = usePathname();
  const { session } = useApp();
  const available = navItems.filter((item) => (item.roles as readonly RoleCode[]).includes(session.roleCode));

  return (
    <div className="flex h-full flex-col bg-[#102a43] text-[#fffdfa]">
      <div className="flex h-20 items-center gap-3 border-b border-white/15 px-5">
        <div className="grid size-10 place-items-center rounded-xl border border-white/25 bg-[#c75b39] text-[#fffdfa]"><GraduationCap size={20} /></div>
        <div><p className="font-heading text-lg font-bold tracking-[-0.025em]">Wind EDU</p><p className="text-[10px] font-bold tracking-[0.14em] text-[#d8e3e8] uppercase">Sổ giáo vụ số</p></div>
      </div>
      <nav aria-label="Điều hướng chính" className="flex-1 overflow-y-auto px-3 py-5">
        <p className="mb-3 px-3 text-[10px] font-bold uppercase tracking-[0.2em] text-[#9fb5c2]">Không gian chung</p>
        <div className="space-y-1">
          {available.map(({ href, label, icon: Icon }) => {
            const active = pathname === href || pathname.startsWith(`${href}/`);
            return (
              <Link aria-current={active ? "page" : undefined} className={`group flex min-h-11 items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-semibold transition ${active ? "bg-[#fffdfa] text-[#102a43]" : "text-[#bfd0d8] hover:bg-white/8 hover:text-[#fffdfa]"}`} href={href} key={href} onClick={close}>
                <Icon className={active ? "text-[#c75b39]" : "text-[#9fb5c2] group-hover:text-[#fffdfa]"} size={18} />{label}
              </Link>
            );
          })}
        </div>
      </nav>
      <div className="border-t border-white/15 p-4">
        <div className="flex items-center gap-3">
          <div className="grid size-9 place-items-center rounded-full bg-[#d8e3e8] text-sm font-extrabold text-[#102a43]">{session.user.name.split(" ").slice(-2).map((part) => part[0]).join("")}</div>
          <div className="min-w-0"><p className="truncate text-sm font-bold">{session.user.name}</p><p className="truncate text-xs text-[#bfd0d8]">{session.user.roleName}</p></div>
        </div>
      </div>
    </div>
  );
}

export function WorkspaceShell({ children }: { children: React.ReactNode }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [notificationOpen, setNotificationOpen] = useState(false);
  const [notifications, setNotifications] = useState<LearningNotification[]>([]);
  const [notificationLoading, setNotificationLoading] = useState(true);
  const [notificationError, setNotificationError] = useState("");
  const { session, setRole, notify } = useApp();
  const unreadCount = notifications.filter((item) => !item.readAt).length;

  const loadNotifications = useCallback(async () => {
    setNotificationLoading(true);
    setNotificationError("");
    try {
      setNotifications(await apiRequest<LearningNotification[]>("/notifications", { roleCode: session.roleCode }));
    } catch (error) {
      setNotifications([]);
      setNotificationError(error instanceof Error ? error.message : "Không thể tải thông báo.");
    } finally {
      setNotificationLoading(false);
    }
  }, [session.roleCode]);

  useEffect(() => {
    window.queueMicrotask(() => { void loadNotifications(); });
  }, [loadNotifications]);

  useEffect(() => {
    if (!menuOpen && !notificationOpen) return;
    const previousOverflow = document.body.style.overflow;
    if (menuOpen) document.body.style.overflow = "hidden";
    const closeOverlay = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setMenuOpen(false);
      setNotificationOpen(false);
    };
    document.addEventListener("keydown", closeOverlay);
    return () => {
      document.removeEventListener("keydown", closeOverlay);
      document.body.style.overflow = previousOverflow;
    };
  }, [menuOpen, notificationOpen]);

  async function markRead(item: LearningNotification): Promise<void> {
    if (item.readAt) return;
    try {
      const updated = await apiRequest<LearningNotification>(`/notifications/${item.id}/read`, { method: "PATCH", roleCode: session.roleCode });
      setNotifications((current) => current.map((notification) => notification.id === updated.id ? updated : notification));
    } catch (error) {
      notify(error instanceof Error ? error.message : "Không thể cập nhật thông báo.", "error");
    }
  }

  async function markAllRead(): Promise<void> {
    const unread = notifications.filter((item) => !item.readAt);
    if (!unread.length) return;
    try {
      const updated = await Promise.all(unread.map((item) => apiRequest<LearningNotification>(`/notifications/${item.id}/read`, { method: "PATCH", roleCode: session.roleCode })));
      const byId = new Map(updated.map((item) => [item.id, item]));
      setNotifications((current) => current.map((item) => byId.get(item.id) ?? item));
    } catch (error) {
      notify(error instanceof Error ? error.message : "Không thể đánh dấu toàn bộ thông báo.", "error");
    }
  }

  function notificationHref(item: LearningNotification): string {
    if (item.type.includes("SUPPORT")) return "/support";
    if (item.type.includes("FORUM") || item.type.includes("MENTION") || item.type.includes("REPORT")) return "/forum";
    if (item.type.includes("SESSION") || item.type.includes("ATTENDANCE") || item.type.includes("RECORDING")) return "/live-classes";
    if (item.type.includes("EXAM") || item.type.includes("GRADE")) return "/exams";
    if (item.type.includes("MATERIAL")) return "/materials";
    return "/dashboard";
  }

  return (
    <div className="min-h-screen bg-[#f7f4ed] text-[#102a43]">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 lg:block"><Sidebar /></aside>
      {menuOpen ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button aria-label="Đóng menu" className="absolute inset-0 bg-[#102a43]/65 backdrop-blur-sm" onClick={() => setMenuOpen(false)} type="button" />
          <aside aria-label="Điều hướng trên thiết bị di động" className="relative h-full w-72 animate-slide-in shadow-2xl"><button aria-label="Đóng menu" className="absolute right-3 top-3 z-10 grid size-11 place-items-center rounded-xl text-[#bfd0d8] hover:bg-white/10" onClick={() => setMenuOpen(false)} type="button"><X size={19} /></button><Sidebar close={() => setMenuOpen(false)} /></aside>
        </div>
      ) : null}
      <div className="lg:pl-64">
        <header className="sticky top-0 z-20 flex h-20 items-center justify-between border-b border-[#a9bac1] bg-[#f7f4ed]/92 px-4 backdrop-blur md:px-7">
          <div className="flex min-w-0 items-center gap-3"><button aria-label="Mở menu" className="grid size-11 shrink-0 place-items-center rounded-lg border border-[#a9bac1] text-[#102a43] lg:hidden" onClick={() => setMenuOpen(true)} type="button"><Menu size={20} /></button><div className="min-w-0"><p className="max-w-22 text-xs font-bold leading-4 text-[#102a43] sm:max-w-none sm:text-sm">Trung tâm hỗ trợ giảng dạy</p><p className="mt-0.5 hidden text-xs text-[#516274] sm:block">Một không gian vận hành theo vai trò</p></div></div>
          <div className="relative flex items-center gap-2 md:gap-3">
            <label className="sr-only" htmlFor="role-switcher">Vai trò đang sử dụng</label>
            <select className="min-h-11 w-36 shrink-0 rounded-xl border border-[#a9bac1] bg-[#fffdfa] px-3 py-2 text-xs font-bold text-[#102a43] outline-none transition focus:border-[#c75b39] focus:ring-3 focus:ring-[#c75b39]/15 md:w-auto md:text-sm" id="role-switcher" onChange={(event) => setRole(event.target.value as RoleCode)} value={session.roleCode}>
              {roleOptions.map((role) => <option key={role.code} value={role.code}>{role.label}</option>)}
            </select>
            <button aria-controls="notification-center" aria-expanded={notificationOpen} aria-label={unreadCount ? `Thông báo, ${unreadCount} chưa đọc` : "Thông báo"} className="relative grid size-11 place-items-center rounded-full border border-[#a9bac1] text-[#516274] hover:border-[#c75b39] hover:text-[#c75b39]" onClick={() => setNotificationOpen((open) => !open)} type="button"><Bell size={17} />{unreadCount ? <span className="absolute -right-1 -top-1 grid min-w-4 place-items-center rounded-full bg-[#c75b39] px-1 text-[10px] font-extrabold leading-4 text-white ring-2 ring-[#f7f4ed]">{unreadCount > 9 ? "9+" : unreadCount}</span> : null}</button>
            {notificationOpen ? <><button aria-label="Đóng trung tâm thông báo" className="fixed inset-0 z-20 cursor-default bg-transparent" onClick={() => setNotificationOpen(false)} type="button" /><section aria-label="Trung tâm thông báo" className="absolute right-0 top-12 z-30 w-[min(24rem,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-[#d5dfe2] bg-[#fffdfa] shadow-[0_18px_50px_rgb(16_42_67/0.2)]" id="notification-center"><div className="flex items-center justify-between border-b border-[#d5dfe2] px-5 py-4"><div><h2 className="font-heading text-base font-extrabold">Thông báo</h2><p className="mt-0.5 text-xs text-[#516274]">{unreadCount ? `${unreadCount} mục chưa đọc` : "Đã đọc tất cả"}</p></div><button className="inline-flex min-h-11 items-center gap-1.5 rounded-lg px-2 text-xs font-extrabold text-[#963f2a] hover:bg-[#eee8dc] disabled:text-[#a9bac1]" disabled={!unreadCount} onClick={() => void markAllRead()} type="button"><CheckCheck size={15} />Đọc tất cả</button></div><div className="max-h-[min(32rem,70dvh)] overflow-y-auto">{notificationLoading ? <div className="flex min-h-40 items-center justify-center gap-2 text-sm font-semibold text-[#516274]"><LoaderCircle className="animate-spin text-[#c75b39]" size={19} />Đang tải…</div> : notificationError ? <div className="grid min-h-40 place-items-center px-5 text-center"><div><p className="text-sm font-bold text-[#a84343]">{notificationError}</p><button className="action-link mt-2" onClick={() => void loadNotifications()} type="button">Thử lại</button></div></div> : notifications.length ? notifications.map((item) => <Link className={`block min-h-16 border-b border-[#d5dfe2] px-5 py-4 transition last:border-0 hover:bg-[#eee8dc]/65 ${item.readAt ? "bg-[#fffdfa]" : "bg-[#f8ece6]/60"}`} href={notificationHref(item)} key={item.id} onClick={() => { void markRead(item); setNotificationOpen(false); }}><div className="flex items-start gap-3"><span className={`mt-1.5 size-2 shrink-0 rounded-full ${item.readAt ? "bg-[#a9bac1]" : "bg-[#c75b39]"}`} /><div><p className="text-sm font-bold text-[#102a43]">{item.title}</p><p className="mt-1 text-xs text-[#516274]">{new Date(item.createdAt).toLocaleString("vi-VN")}</p></div></div></Link>) : <div className="grid min-h-40 place-items-center px-5 text-center"><div><Bell className="mx-auto text-[#a9bac1]" size={28} /><p className="mt-2 text-sm font-bold text-[#516274]">Chưa có thông báo</p></div></div>}</div></section></> : null}
          </div>
        </header>
        <main>{children}</main>
      </div>
    </div>
  );
}
