"use client";

import { ArrowUpRight, CalendarDays, Database, FileQuestion, LoaderCircle, MessageSquareText, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { apiRequest } from "@/lib/api-client";
import type { IdentityRole, IdentityUser, RoleCode } from "@/lib/app-types";
import type { ExamAttempt, LearnerExamSummary, LearnerResult, LearningClass, LiveSession, OperationalReport } from "@/lib/learning-types";
import { useApp } from "@/providers/app-provider";
import { PageHeader } from "./page-header";

interface DashboardMetric { value: string; label: string }
interface HealthOverview { status: "healthy" | "warning" | "degraded"; database: string }

const roleContent: Record<RoleCode, { title: string; description: string }> = {
  SYSTEM_ADMIN: { title: "Tình trạng vận hành", description: "Theo dõi người dùng, cấu hình, tích hợp và sức khỏe toàn hệ thống." },
  CENTER_MANAGER: { title: "Vận hành trung tâm", description: "Điều phối khóa học, lớp, giảng viên và tiến độ học tập." },
  INSTRUCTOR: { title: "Không gian giảng dạy", description: "Quản lý học liệu, đánh giá, diễn đàn và các buổi học sắp tới." },
  LEARNER: { title: "Hôm nay của bạn", description: "Theo dõi lịch học, học liệu mới và các bài cần hoàn thành." },
};

const modules = [
  { href: "/materials", name: "Kho học liệu", detail: "Tệp, phiên bản và quyền truy cập", icon: Database, roles: ["CENTER_MANAGER", "INSTRUCTOR", "LEARNER"] },
  { href: "/questions", name: "Ngân hàng câu hỏi", detail: "Câu hỏi, đề thi và chấm điểm", icon: FileQuestion, roles: ["INSTRUCTOR"] },
  { href: "/forum", name: "Diễn đàn", detail: "Chủ đề, bình luận và kiểm duyệt", icon: MessageSquareText, roles: ["CENTER_MANAGER", "INSTRUCTOR", "LEARNER"] },
  { href: "/live-classes", name: "Lớp học online", detail: "Lịch, điểm danh và bản ghi", icon: CalendarDays, roles: ["SYSTEM_ADMIN", "CENTER_MANAGER", "INSTRUCTOR", "LEARNER"] },
] satisfies Array<{ href: string; name: string; detail: string; icon: typeof Database; roles: RoleCode[] }>;

async function loadMetrics(roleCode: RoleCode): Promise<DashboardMetric[]> {
  if (roleCode === "SYSTEM_ADMIN") {
    const [users, roles, health] = await Promise.all([
      apiRequest<IdentityUser[]>("/admin/users", { roleCode }),
      apiRequest<IdentityRole[]>("/admin/roles", { roleCode }),
      apiRequest<HealthOverview>("/system/health-overview", { roleCode }),
    ]);
    const healthLabel = health.status === "healthy" ? "Sẵn sàng" : health.status === "warning" ? "Cần theo dõi" : "Suy giảm";
    return [
      { value: String(users.filter((user) => user.status === "ACTIVE").length), label: "tài khoản đang hoạt động" },
      { value: String(roles.length), label: "vai trò được cấu hình" },
      { value: healthLabel, label: `dịch vụ · CSDL ${health.database}` },
    ];
  }

  if (roleCode === "CENTER_MANAGER") {
    const [classes, report] = await Promise.all([
      apiRequest<LearningClass[]>("/classes", { roleCode }),
      apiRequest<OperationalReport>("/reports/operations", { roleCode }),
    ]);
    return [
      { value: String(classes.filter((item) => item.status === "ACTIVE").length), label: "lớp đang hoạt động" },
      { value: String(report.learners), label: "học viên trong phạm vi" },
      { value: String(report.openTickets + report.openReports), label: "việc vận hành đang mở" },
    ];
  }

  if (roleCode === "INSTRUCTOR") {
    const [classes, attempts, sessions] = await Promise.all([
      apiRequest<LearningClass[]>("/instructor/classes", { roleCode }),
      apiRequest<ExamAttempt[]>("/instructor/exam-attempts", { roleCode }),
      apiRequest<LiveSession[]>("/sessions", { roleCode }),
    ]);
    const now = Date.now();
    return [
      { value: String(classes.length), label: "lớp được phân công" },
      { value: String(attempts.filter((item) => item.status === "SUBMITTED").length), label: "bài đang chờ chấm" },
      { value: String(sessions.filter((item) => item.status !== "CANCELLED" && new Date(item.startsAt).getTime() > now).length), label: "buổi học sắp tới" },
    ];
  }

  const [classes, exams, results] = await Promise.all([
    apiRequest<LearningClass[]>("/learner/classes", { roleCode }),
    apiRequest<LearnerExamSummary[]>("/learner/exams", { roleCode }),
    apiRequest<LearnerResult[]>("/learner/results", { roleCode }),
  ]);
  return [
    { value: String(classes.filter((item) => item.status === "ACTIVE").length), label: "lớp đang theo học" },
    { value: String(exams.filter((item) => item.availabilityStatus === "AVAILABLE" || item.availabilityStatus === "IN_PROGRESS").length), label: "bài có thể thực hiện" },
    { value: String(results.length), label: "kết quả đã công bố" },
  ];
}

export function DashboardHome() {
  const { session } = useApp();
  const content = roleContent[session.roleCode];
  const visibleModules = useMemo(() => modules.filter((item) => item.roles.includes(session.roleCode)), [session.roleCode]);
  const [metrics, setMetrics] = useState<DashboardMetric[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setMetrics(await loadMetrics(session.roleCode));
    } catch (requestError) {
      setMetrics([]);
      setError(requestError instanceof Error ? requestError.message : "Không thể tải số liệu tổng quan.");
    } finally {
      setLoading(false);
    }
  }, [session.roleCode]);

  useEffect(() => {
    window.queueMicrotask(() => { void refresh(); });
  }, [refresh]);

  return (
    <div className="mx-auto max-w-7xl px-5 py-8 md:px-8 md:py-10">
      <PageHeader eyebrow={session.user.roleName} title={content.title} description={content.description} actions={<button className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 text-sm font-bold text-slate-700 transition hover:border-sky-300 hover:text-sky-700 disabled:opacity-50" disabled={loading} onClick={() => void refresh()} type="button"><RefreshCw className={loading ? "animate-spin" : ""} size={15} />Làm mới</button>} />
      <section aria-label="Chỉ số tổng quan" className="grid min-h-28 divide-y divide-slate-200 border-b border-slate-200 py-2 md:grid-cols-3 md:divide-x md:divide-y-0">
        {loading ? <div className="col-span-full flex items-center justify-center gap-2 py-8 text-sm font-semibold text-slate-500"><LoaderCircle className="animate-spin text-sky-600" size={20} />Đang đồng bộ số liệu thực…</div> : error ? <div className="col-span-full flex flex-col items-center justify-center gap-2 py-6 text-center"><p className="text-sm font-bold text-rose-700">{error}</p><button className="text-xs font-extrabold text-sky-700 hover:underline" onClick={() => void refresh()} type="button">Thử tải lại</button></div> : metrics.map(({ value, label }) => <div className="py-6 md:px-7 md:first:pl-0" key={label}><p className="font-heading text-3xl font-extrabold tracking-tight text-slate-950">{value}</p><p className="mt-1 text-sm font-medium text-slate-500">{label}</p></div>)}
      </section>
      <section className="py-8"><div className="mb-5"><p className="text-[11px] font-extrabold uppercase tracking-[0.18em] text-slate-500">Phân hệ theo quyền</p><h2 className="mt-1 font-heading text-2xl font-extrabold">Truy cập nhanh</h2></div><div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
        {visibleModules.map(({ href, name, detail, icon: Icon }) => <Link className="group grid grid-cols-[auto_1fr_auto] items-center gap-4 border-b border-slate-100 px-5 py-5 last:border-0 hover:bg-slate-50 md:px-7" href={href} key={href}><div className="grid size-10 place-items-center rounded-xl bg-sky-50 text-sky-700"><Icon size={20} /></div><div><h3 className="font-bold">{name}</h3><p className="mt-1 text-sm text-slate-500">{detail}</p></div><ArrowUpRight className="text-slate-300 transition group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-sky-600" size={18} /></Link>)}
      </div></section>
    </div>
  );
}
