"use client";

import { Activity, BookOpenCheck, FileStack, MessageSquareWarning, Radio, TicketCheck } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { AccessDenied } from "@/components/access-denied";
import { PageHeader } from "@/components/page-header";
import { apiRequest } from "@/lib/api-client";
import { useApp } from "@/providers/app-provider";

interface Report { courses: number; classes: number; materials: number; exams: number; openReports: number; liveSessions: number; openTickets: number; generatedAt: string }
interface ClassReport { classId: string; classCode: string; className: string; learners: number; instructors: number; publishedMaterials: number; exams: number; submittedAttempts: number; averageScore: number; sessions: number; attendanceRate: number; status: string }

export default function ReportsPage() {
  const { session, notify } = useApp();
  const [report, setReport] = useState<Report | null>(null);
  const [classReports, setClassReports] = useState<ClassReport[]>([]);
  const allowed = session.roleCode === "CENTER_MANAGER" || session.roleCode === "INSTRUCTOR";
  const load = useCallback(async () => { if (!allowed) return; try { const [overview, classes] = await Promise.all([apiRequest<Report>("/reports/operations", { roleCode: session.roleCode }), apiRequest<ClassReport[]>("/reports/classes", { roleCode: session.roleCode })]); setReport(overview); setClassReports(classes); } catch (error) { notify(error instanceof Error ? error.message : "Không tải được báo cáo.", "error"); } }, [allowed, notify, session.roleCode]);
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
    <section className="mt-7 overflow-hidden rounded-2xl border border-slate-200 bg-white"><div className="border-b border-slate-100 p-5"><h2 className="font-heading text-xl font-extrabold">Hiệu quả theo lớp</h2><p className="mt-1 text-sm text-slate-500">Tiến độ nội dung, đánh giá và tỷ lệ tham dự được tổng hợp theo lớp.</p></div><div className="overflow-x-auto"><table className="w-full min-w-[820px] text-left text-sm"><thead className="bg-slate-50 text-[11px] uppercase tracking-wider text-slate-500"><tr><th className="px-5 py-3">Lớp</th><th className="px-5 py-3">Học viên</th><th className="px-5 py-3">Học liệu</th><th className="px-5 py-3">Đề / lượt nộp</th><th className="px-5 py-3">Điểm TB</th><th className="px-5 py-3">Điểm danh</th><th className="px-5 py-3">Trạng thái</th></tr></thead><tbody className="divide-y divide-slate-100">{classReports.map((item) => <tr key={item.classId}><td className="px-5 py-4"><p className="font-extrabold">{item.classCode}</p><p className="text-xs text-slate-500">{item.className}</p></td><td className="px-5 py-4">{item.learners}</td><td className="px-5 py-4">{item.publishedMaterials}</td><td className="px-5 py-4">{item.exams} / {item.submittedAttempts}</td><td className="px-5 py-4 font-extrabold">{item.averageScore}</td><td className="px-5 py-4">{item.attendanceRate}%</td><td className="px-5 py-4"><span className="rounded-full bg-slate-100 px-2 py-1 text-[11px] font-bold">{item.status}</span></td></tr>)}</tbody></table></div></section>
  </div>;
}
