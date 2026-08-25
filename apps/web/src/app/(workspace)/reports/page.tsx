"use client";

import { Activity, BookOpenCheck, FileStack, MessageSquareWarning, Radio, TicketCheck } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { AccessDenied } from "@/components/access-denied";
import { PageHeader } from "@/components/page-header";
import { apiRequest } from "@/lib/api-client";
import { useApp } from "@/providers/app-provider";

interface Report { courses: number; classes: number; materials: number; exams: number; openReports: number; liveSessions: number; openTickets: number; generatedAt: string }

export default function ReportsPage() {
  const { session, notify } = useApp();
  const [report, setReport] = useState<Report | null>(null);
  const allowed = session.roleCode === "CENTER_MANAGER" || session.roleCode === "INSTRUCTOR";
  const load = useCallback(async () => { if (!allowed) return; try { setReport(await apiRequest<Report>("/reports/operations", { roleCode: session.roleCode })); } catch (error) { notify(error instanceof Error ? error.message : "Không tải được báo cáo.", "error"); } }, [allowed, notify, session.roleCode]);
  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load]);
  if (!allowed) return <AccessDenied />;
  const metrics = report ? [
    { label: "Khóa học", value: report.courses, icon: BookOpenCheck }, { label: "Lớp học", value: report.classes, icon: Activity },
    { label: "Học liệu", value: report.materials, icon: FileStack }, { label: "Đề thi", value: report.exams, icon: BookOpenCheck },
    { label: "Báo cáo mở", value: report.openReports, icon: MessageSquareWarning }, { label: "Buổi trực tuyến", value: report.liveSessions, icon: Radio },
    { label: "Phiếu hỗ trợ mở", value: report.openTickets, icon: TicketCheck },
  ] : [];
  return <div className="mx-auto max-w-7xl px-5 py-8 md:px-8 md:py-10">
    <PageHeader eyebrow="Operational Intelligence" title="Báo cáo vận hành" description="Ảnh chụp tức thời về nội dung, hoạt động học tập và các điểm cần xử lý." />
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{metrics.map(({ label, value, icon: Icon }, index) => <article className={`rounded-2xl border p-5 ${index === 0 ? "border-slate-950 bg-slate-950 text-white" : "border-slate-200 bg-white"}`} key={label}><Icon className={index === 0 ? "text-sky-400" : "text-sky-700"} size={21} /><p className="mt-7 text-3xl font-extrabold">{value}</p><p className={`mt-1 text-xs font-bold ${index === 0 ? "text-slate-400" : "text-slate-500"}`}>{label}</p></article>)}</div>
    {report ? <section className="mt-7 grid gap-6 rounded-2xl border border-slate-200 bg-white p-6 lg:grid-cols-[1.2fr_.8fr]">
      <div><h2 className="font-heading text-xl font-extrabold">Tín hiệu điều hành</h2><div className="mt-5 space-y-4">
        <div><div className="flex justify-between text-sm font-bold"><span>Mức độ số hóa nội dung</span><span>{Math.min(100, report.materials * 12)}%</span></div><div className="mt-2 h-2 rounded-full bg-slate-100"><div className="h-full rounded-full bg-sky-500" style={{ width: `${Math.min(100, report.materials * 12)}%` }} /></div></div>
        <div><div className="flex justify-between text-sm font-bold"><span>Mức độ triển khai đánh giá</span><span>{Math.min(100, report.exams * 20)}%</span></div><div className="mt-2 h-2 rounded-full bg-slate-100"><div className="h-full rounded-full bg-violet-500" style={{ width: `${Math.min(100, report.exams * 20)}%` }} /></div></div>
      </div></div>
      <aside className="rounded-xl bg-amber-50 p-5"><p className="text-xs font-extrabold uppercase tracking-wider text-amber-700">Cần chú ý</p><p className="mt-3 text-3xl font-extrabold text-amber-950">{report.openReports + report.openTickets}</p><p className="mt-1 text-sm leading-6 text-amber-800">báo cáo nội dung và phiếu hỗ trợ đang chờ xử lý.</p></aside>
    </section> : <div className="mt-7 h-48 animate-pulse rounded-2xl bg-slate-200" />}
  </div>;
}
