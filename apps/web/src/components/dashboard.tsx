"use client";

import {
  Archive,
  BookOpenCheck,
  CalendarClock,
  ChevronRight,
  CircleHelp,
  Database,
  GraduationCap,
  LayoutDashboard,
  Menu,
  MessageSquareText,
  Settings,
  ShieldCheck,
  X,
} from "lucide-react";
import { useState } from "react";

const modules = [
  {
    name: "Kho dữ liệu",
    description: "Tài liệu, học liệu và quyền truy cập tập trung.",
    icon: Database,
    status: "Khung sẵn sàng",
    accent: "bg-sky-500",
  },
  {
    name: "Ngân hàng câu hỏi",
    description: "Soạn câu hỏi, duyệt nội dung và sinh đề có kiểm soát.",
    icon: BookOpenCheck,
    status: "Đã lên kế hoạch",
    accent: "bg-violet-500",
  },
  {
    name: "Diễn đàn trao đổi",
    description: "Thảo luận theo lớp, chủ đề và luồng kiểm duyệt.",
    icon: MessageSquareText,
    status: "Đã lên kế hoạch",
    accent: "bg-amber-500",
  },
  {
    name: "Lớp học online",
    description: "Lịch học, tham gia buổi học và theo dõi điểm danh.",
    icon: GraduationCap,
    status: "Đã lên kế hoạch",
    accent: "bg-emerald-500",
  },
] as const;

const navigation = [
  { label: "Tổng quan", icon: LayoutDashboard, active: true },
  { label: "Kho dữ liệu", icon: Archive, active: false },
  { label: "Ngân hàng câu hỏi", icon: BookOpenCheck, active: false },
  { label: "Diễn đàn", icon: MessageSquareText, active: false },
  { label: "Lớp học", icon: CalendarClock, active: false },
] as const;

function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <div className="flex h-full flex-col">
      <div className="flex h-20 items-center gap-3 border-b border-white/10 px-6">
        <div className="grid size-10 place-items-center rounded-xl bg-sky-400 text-slate-950">
          <GraduationCap aria-hidden="true" size={22} strokeWidth={2.2} />
        </div>
        <div>
          <p className="font-heading text-lg font-extrabold tracking-tight text-white">Wind EDU</p>
          <p className="text-xs text-slate-400">Teaching Operations</p>
        </div>
      </div>

      <nav aria-label="Điều hướng chính" className="flex-1 space-y-1 px-3 py-6">
        <p className="mb-3 px-3 text-[11px] font-bold uppercase tracking-[0.18em] text-slate-500">Không gian làm việc</p>
        {navigation.map(({ label, icon: Icon, active }) => (
          <button
            className={`group flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-semibold transition ${
              active ? "bg-white/10 text-white" : "text-slate-400 hover:bg-white/5 hover:text-white"
            }`}
            key={label}
            onClick={onNavigate}
            type="button"
          >
            <Icon aria-hidden="true" className={active ? "text-sky-400" : "group-hover:text-sky-400"} size={18} />
            {label}
          </button>
        ))}
      </nav>

      <div className="border-t border-white/10 p-3">
        <button className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-semibold text-slate-400 hover:bg-white/5 hover:text-white" type="button">
          <Settings aria-hidden="true" size={18} /> Cài đặt hệ thống
        </button>
        <div className="mt-3 flex items-center gap-3 rounded-xl bg-slate-800/70 p-3">
          <div className="grid size-9 place-items-center rounded-full bg-sky-400 font-bold text-slate-950">WF</div>
          <div className="min-w-0">
            <p className="truncate text-sm font-bold text-white">Wind Of Fall</p>
            <p className="truncate text-xs text-slate-400">Quản trị hệ thống</p>
          </div>
        </div>
      </div>
    </div>
  );
}

export function Dashboard() {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className="min-h-screen bg-[#f5f7fa] text-slate-900">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 bg-slate-950 lg:block">
        <Sidebar />
      </aside>

      {menuOpen ? (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button aria-label="Đóng menu" className="absolute inset-0 bg-slate-950/60 backdrop-blur-sm" onClick={() => setMenuOpen(false)} type="button" />
          <aside className="relative h-full w-72 animate-slide-in bg-slate-950 shadow-2xl">
            <button aria-label="Đóng menu" className="absolute right-4 top-5 rounded-md p-2 text-slate-400 hover:bg-white/10 hover:text-white" onClick={() => setMenuOpen(false)} type="button">
              <X size={20} />
            </button>
            <Sidebar onNavigate={() => setMenuOpen(false)} />
          </aside>
        </div>
      ) : null}

      <main className="lg:pl-64">
        <header className="sticky top-0 z-20 flex h-20 items-center justify-between border-b border-slate-200/80 bg-white/90 px-5 backdrop-blur md:px-8">
          <div className="flex items-center gap-3">
            <button aria-label="Mở menu" className="rounded-lg border border-slate-200 p-2 text-slate-600 lg:hidden" onClick={() => setMenuOpen(true)} type="button">
              <Menu size={20} />
            </button>
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-sky-700">Trung tâm điều hành</p>
              <h1 className="font-heading text-lg font-extrabold tracking-tight md:text-xl">Tổng quan hệ thống</h1>
            </div>
          </div>
          <button className="grid size-10 place-items-center rounded-full border border-slate-200 text-slate-500 transition hover:border-sky-300 hover:bg-sky-50 hover:text-sky-700" aria-label="Trung tâm trợ giúp" type="button">
            <CircleHelp size={19} />
          </button>
        </header>

        <div className="mx-auto max-w-7xl px-5 py-8 md:px-8 md:py-10">
          <section className="animate-rise border-b border-slate-200 pb-8">
            <div className="max-w-3xl">
              <p className="mb-3 inline-flex items-center gap-2 text-sm font-bold text-emerald-700">
                <span className="relative flex size-2.5"><span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-50" /><span className="relative inline-flex size-2.5 rounded-full bg-emerald-500" /></span>
                Nền tảng đang được khởi tạo
              </p>
              <h2 className="font-heading text-3xl font-extrabold leading-tight tracking-[-0.04em] text-slate-950 md:text-5xl">
                Một không gian thống nhất cho toàn bộ hoạt động giảng dạy.
              </h2>
              <p className="mt-4 max-w-2xl text-base leading-7 text-slate-600 md:text-lg">
                Codebase nền đã sẵn sàng để phát triển tuần tự bốn phân hệ, với ranh giới nghiệp vụ và tiêu chuẩn vận hành rõ ràng ngay từ đầu.
              </p>
            </div>
          </section>

          <section aria-labelledby="modules-title" className="py-8 md:py-10">
            <div className="mb-6 flex items-end justify-between gap-4">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-500">Phạm vi sản phẩm</p>
                <h2 className="mt-1 font-heading text-2xl font-extrabold tracking-tight" id="modules-title">Bốn phân hệ cốt lõi</h2>
              </div>
              <p className="hidden text-sm font-semibold text-slate-500 md:block">Sprint 0 · Nền tảng kỹ thuật</p>
            </div>

            <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_18px_45px_-32px_rgba(15,23,42,0.35)]">
              {modules.map(({ name, description, icon: Icon, status, accent }, index) => (
                <button className="group grid w-full grid-cols-[auto_1fr_auto] items-center gap-4 border-b border-slate-100 px-5 py-5 text-left transition last:border-b-0 hover:bg-slate-50 md:px-7" key={name} type="button">
                  <div className={`grid size-11 place-items-center rounded-xl ${accent} text-white shadow-sm`}><Icon aria-hidden="true" size={21} /></div>
                  <div>
                    <div className="flex flex-wrap items-center gap-3">
                      <h3 className="font-heading font-extrabold text-slate-900">{name}</h3>
                      <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${index === 0 ? "bg-sky-100 text-sky-800" : "bg-slate-100 text-slate-600"}`}>{status}</span>
                    </div>
                    <p className="mt-1 text-sm leading-6 text-slate-500">{description}</p>
                  </div>
                  <ChevronRight aria-hidden="true" className="text-slate-300 transition group-hover:translate-x-1 group-hover:text-sky-600" size={20} />
                </button>
              ))}
            </div>
          </section>

          <section className="grid gap-8 border-t border-slate-200 pt-8 md:grid-cols-[1fr_0.8fr] md:pt-10">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-500">Tiêu chuẩn nền</p>
              <h2 className="mt-1 font-heading text-2xl font-extrabold tracking-tight">Sẵn sàng để phát triển có kiểm soát</h2>
              <div className="mt-6 space-y-5">
                {[
                  ["Kiến trúc tách lớp", "Frontend, API, hợp đồng dữ liệu và persistence có ranh giới độc lập."],
                  ["Bảo mật mặc định", "Validation, CORS, HTTP headers, rate limit và cấu hình bí mật được kiểm soát."],
                  ["Kiểm chứng liên tục", "Lint, typecheck, unit test và build dùng chung một lệnh kiểm tra."],
                ].map(([title, detail]) => (
                  <div className="flex gap-4" key={title}>
                    <ShieldCheck aria-hidden="true" className="mt-0.5 shrink-0 text-emerald-600" size={20} />
                    <div><h3 className="font-bold text-slate-900">{title}</h3><p className="mt-1 text-sm leading-6 text-slate-500">{detail}</p></div>
                  </div>
                ))}
              </div>
            </div>
            <div className="rounded-2xl bg-slate-950 p-6 text-white md:p-7">
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-sky-400">Bước tiếp theo</p>
              <h2 className="mt-2 font-heading text-2xl font-extrabold tracking-tight">Hoàn thiện nền, rồi đi sâu theo luồng nghiệp vụ.</h2>
              <p className="mt-3 text-sm leading-6 text-slate-400">Mỗi chức năng sẽ được triển khai theo thứ tự: hợp đồng dữ liệu, quyền truy cập, API, giao diện, kiểm thử và quan sát vận hành.</p>
              <div className="mt-6 flex items-center gap-3 border-t border-white/10 pt-5 text-sm font-semibold text-slate-300"><CalendarClock className="text-sky-400" size={18} /> Sprint 0 đang thực hiện</div>
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
