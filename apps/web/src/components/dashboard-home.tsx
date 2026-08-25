"use client";

import { ArrowUpRight, CalendarDays, Database, FileQuestion, MessageSquareText } from "lucide-react";
import Link from "next/link";
import { PageHeader } from "./page-header";
import { useApp } from "@/providers/app-provider";

const roleContent = {
  SYSTEM_ADMIN: { title: "Tình trạng vận hành", description: "Theo dõi người dùng, cấu hình, tích hợp và sức khỏe toàn hệ thống.", stats: [["4", "vai trò đang hoạt động"], ["24", "quyền trong ma trận"], ["100%", "dịch vụ nền sẵn sàng"]] },
  CENTER_MANAGER: { title: "Vận hành trung tâm", description: "Điều phối khóa học, lớp, giảng viên và tiến độ học tập.", stats: [["6", "lớp đang mở"], ["184", "học viên hoạt động"], ["92%", "tỷ lệ đúng tiến độ"]] },
  INSTRUCTOR: { title: "Không gian giảng dạy", description: "Quản lý học liệu, đánh giá, diễn đàn và các buổi học sắp tới.", stats: [["3", "lớp được phân công"], ["8", "bài cần chấm"], ["2", "buổi học tuần này"]] },
  LEARNER: { title: "Hôm nay của bạn", description: "Theo dõi lịch học, học liệu mới và các bài cần hoàn thành.", stats: [["2", "lịch sắp tới"], ["3", "việc cần hoàn thành"], ["86%", "tiến độ học tập"]] },
} as const;

const modules = [
  { href: "/materials", name: "Kho học liệu", detail: "Tệp, phiên bản và quyền truy cập", icon: Database },
  { href: "/questions", name: "Ngân hàng câu hỏi", detail: "Câu hỏi, đề thi và chấm điểm", icon: FileQuestion },
  { href: "/forum", name: "Diễn đàn", detail: "Chủ đề, bình luận và kiểm duyệt", icon: MessageSquareText },
  { href: "/live-classes", name: "Lớp học online", detail: "Lịch, điểm danh và bản ghi", icon: CalendarDays },
];

export function DashboardHome() {
  const { session } = useApp();
  const content = roleContent[session.roleCode];
  return <div className="mx-auto max-w-7xl px-5 py-8 md:px-8 md:py-10"><PageHeader eyebrow={session.user.roleName} title={content.title} description={content.description} />
    <section className="grid divide-y divide-slate-200 border-b border-slate-200 py-2 md:grid-cols-3 md:divide-x md:divide-y-0">
      {content.stats.map(([value, label]) => <div className="py-6 md:px-7 md:first:pl-0" key={label}><p className="font-heading text-3xl font-extrabold tracking-tight text-slate-950">{value}</p><p className="mt-1 text-sm font-medium text-slate-500">{label}</p></div>)}
    </section>
    <section className="py-8"><div className="mb-5"><p className="text-[11px] font-extrabold uppercase tracking-[0.18em] text-slate-500">Phân hệ</p><h2 className="mt-1 font-heading text-2xl font-extrabold">Truy cập nhanh</h2></div><div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
      {modules.map(({ href, name, detail, icon: Icon }) => <Link className="group grid grid-cols-[auto_1fr_auto] items-center gap-4 border-b border-slate-100 px-5 py-5 last:border-0 hover:bg-slate-50 md:px-7" href={href} key={href}><div className="grid size-10 place-items-center rounded-xl bg-sky-50 text-sky-700"><Icon size={20} /></div><div><h3 className="font-bold">{name}</h3><p className="mt-1 text-sm text-slate-500">{detail}</p></div><ArrowUpRight className="text-slate-300 transition group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-sky-600" size={18} /></Link>)}
    </div></section>
  </div>;
}

