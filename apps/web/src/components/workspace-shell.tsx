"use client";

import {
  Bell, BookOpenCheck, CalendarDays, ChartNoAxesCombined, Database, FileQuestion,
  GraduationCap, Headphones, LayoutDashboard, Menu, MessageSquareText, Settings,
  ShieldCheck, Users, X,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { useApp } from "@/providers/app-provider";
import type { RoleCode } from "@/lib/app-types";

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
  { href: "/support", label: "Hỗ trợ", icon: Headphones, roles: roleOptions.map((role) => role.code) },
  { href: "/admin/users", label: "Người dùng", icon: Users, roles: ["SYSTEM_ADMIN"] },
  { href: "/admin/roles", label: "Vai trò & quyền", icon: ShieldCheck, roles: ["SYSTEM_ADMIN"] },
  { href: "/admin/settings", label: "Cấu hình", icon: Settings, roles: ["SYSTEM_ADMIN"] },
] as const;

function Sidebar({ close }: { close?: () => void }) {
  const pathname = usePathname();
  const { session } = useApp();
  const available = navItems.filter((item) => (item.roles as readonly RoleCode[]).includes(session.roleCode));

  return (
    <div className="flex h-full flex-col bg-slate-950 text-white">
      <div className="flex h-18 items-center gap-3 border-b border-white/10 px-5">
        <div className="grid size-9 place-items-center rounded-xl bg-sky-400 text-slate-950"><GraduationCap size={20} /></div>
        <div><p className="font-heading font-extrabold">Wind EDU</p><p className="text-[11px] text-slate-400">Teaching Operations</p></div>
      </div>
      <nav aria-label="Điều hướng chính" className="flex-1 overflow-y-auto px-3 py-5">
        <p className="mb-3 px-3 text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">Không gian làm việc</p>
        <div className="space-y-1">
          {available.map(({ href, label, icon: Icon }) => {
            const active = pathname === href || pathname.startsWith(`${href}/`);
            return (
              <Link className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-semibold transition ${active ? "bg-white/10 text-white" : "text-slate-400 hover:bg-white/5 hover:text-white"}`} href={href} key={href} onClick={close}>
                <Icon className={active ? "text-sky-400" : ""} size={18} />{label}
              </Link>
            );
          })}
        </div>
      </nav>
      <div className="border-t border-white/10 p-4">
        <div className="flex items-center gap-3">
          <div className="grid size-9 place-items-center rounded-full bg-sky-400 text-sm font-extrabold text-slate-950">{session.user.name.split(" ").slice(-2).map((part) => part[0]).join("")}</div>
          <div className="min-w-0"><p className="truncate text-sm font-bold">{session.user.name}</p><p className="truncate text-xs text-slate-400">{session.user.roleName}</p></div>
        </div>
      </div>
    </div>
  );
}

export function WorkspaceShell({ children }: { children: React.ReactNode }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const { session, setRole } = useApp();

  return (
    <div className="min-h-screen bg-[#f5f7fa] text-slate-900">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 lg:block"><Sidebar /></aside>
      {menuOpen ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button aria-label="Đóng menu" className="absolute inset-0 bg-slate-950/55 backdrop-blur-sm" onClick={() => setMenuOpen(false)} type="button" />
          <aside className="relative h-full w-72 animate-slide-in shadow-2xl"><button aria-label="Đóng menu" className="absolute right-3 top-4 z-10 rounded-lg p-2 text-slate-400 hover:bg-white/10" onClick={() => setMenuOpen(false)} type="button"><X size={19} /></button><Sidebar close={() => setMenuOpen(false)} /></aside>
        </div>
      ) : null}
      <div className="lg:pl-64">
        <header className="sticky top-0 z-20 flex h-18 items-center justify-between border-b border-slate-200 bg-white/90 px-4 backdrop-blur md:px-7">
          <div className="flex items-center gap-3"><button aria-label="Mở menu" className="rounded-lg border border-slate-200 p-2 text-slate-600 lg:hidden" onClick={() => setMenuOpen(true)} type="button"><Menu size={20} /></button><div><p className="text-[10px] font-extrabold uppercase tracking-[0.18em] text-sky-700">Wind EDU</p><p className="text-sm font-bold text-slate-700">Trung tâm hỗ trợ giảng dạy</p></div></div>
          <div className="flex items-center gap-2 md:gap-3">
            <label className="sr-only" htmlFor="role-switcher">Vai trò đang sử dụng</label>
            <select className="max-w-38 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 outline-none transition focus:border-sky-400 focus:ring-2 focus:ring-sky-100 md:max-w-none md:text-sm" id="role-switcher" onChange={(event) => setRole(event.target.value as RoleCode)} value={session.roleCode}>
              {roleOptions.map((role) => <option key={role.code} value={role.code}>{role.label}</option>)}
            </select>
            <button aria-label="Thông báo" className="relative grid size-9 place-items-center rounded-full border border-slate-200 text-slate-500 hover:border-sky-300 hover:text-sky-700" type="button"><Bell size={17} /><span className="absolute right-1.5 top-1.5 size-2 rounded-full bg-rose-500 ring-2 ring-white" /></button>
          </div>
        </header>
        <main>{children}</main>
      </div>
    </div>
  );
}

