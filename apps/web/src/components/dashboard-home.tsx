"use client";

import { ArrowUpRight, CalendarDays, Database, FileQuestion, MessageSquareText, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { apiRequest } from "@/lib/api-client";
import type { IdentityRole, IdentityUser, PermissionCode, RoleCode } from "@/lib/app-types";
import type { ExamAttempt, LearnerExamSummary, LearnerResult, LearningClass, LiveSession, OperationalReport } from "@/lib/learning-types";
import { useApp } from "@/providers/app-provider";
import { PageHeader } from "./page-header";
import { hasAnyPermission } from "@/lib/access-control";

interface DashboardMetric { value: string; label: string }
interface HealthOverview { status: "healthy" | "warning" | "degraded"; database: string }

const roleContent: Record<RoleCode, { title: string; description: string }> = {
  SYSTEM_ADMIN: { title: "Tình trạng vận hành", description: "Theo dõi người dùng, cấu hình, tích hợp và sức khỏe toàn hệ thống." },
  CENTER_MANAGER: { title: "Vận hành trung tâm", description: "Điều phối khóa học, lớp, giảng viên và tiến độ học tập." },
  INSTRUCTOR: { title: "Không gian giảng dạy", description: "Quản lý học liệu, đánh giá, diễn đàn và các buổi học sắp tới." },
  LEARNER: { title: "Hôm nay của bạn", description: "Theo dõi lịch học, học liệu mới và các bài cần hoàn thành." },
};

const modules = [
  { href: "/materials", name: "Kho học liệu", detail: "Tệp, phiên bản và quyền truy cập", icon: Database, permissions: ["material:view"] },
  { href: "/questions", name: "Ngân hàng câu hỏi", detail: "Câu hỏi, đề thi và chấm điểm", icon: FileQuestion, permissions: ["question:view"] },
  { href: "/forum", name: "Diễn đàn", detail: "Chủ đề, bình luận và kiểm duyệt", icon: MessageSquareText, permissions: ["forum:view"] },
  { href: "/live-classes", name: "Lớp học online", detail: "Lịch, điểm danh và bản ghi", icon: CalendarDays, permissions: ["session:view"] },
] satisfies Array<{ href: string; name: string; detail: string; icon: typeof Database; permissions: PermissionCode[] }>;

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
  const visibleModules = useMemo(() => modules.filter((item) => hasAnyPermission(session, item.permissions)), [session]);
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
    <div className="workspace-enter mx-auto max-w-7xl px-5 py-8 md:px-8 md:py-10">
      <PageHeader eyebrow={session.user.roleName} title={content.title} description={content.description} actions={<button className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-[#a9bac1] bg-[#fffdfa] px-4 text-sm font-bold text-[#102a43] transition-[background-color,border-color,transform] duration-200 hover:-translate-y-px hover:border-[#102a43] active:translate-y-px active:scale-[0.98] disabled:opacity-50" disabled={loading} onClick={() => void refresh()} type="button"><RefreshCw className={loading ? "animate-spin" : ""} size={15} />Cập nhật dữ liệu</button>} />
      <section aria-label="Chỉ số tổng quan" className="grid min-h-28 divide-y divide-[#d5dfe2] border-b border-[#a9bac1] py-2 md:grid-cols-3 md:divide-x md:divide-y-0">
        {loading ? <div aria-label="Đang đồng bộ số liệu" className="col-span-full grid gap-5 py-6 md:grid-cols-3">{[0, 1, 2].map((item) => <div className="animate-pulse" key={item}><div className="h-8 w-20 rounded bg-[#d5dfe2]" /><div className="mt-3 h-4 w-40 rounded bg-[#eee8dc]" /></div>)}</div> : error ? <div className="col-span-full flex flex-col items-center justify-center gap-2 py-6 text-center"><p className="text-sm font-bold text-[#a84343]">{error}</p><button className="text-link text-xs" onClick={() => void refresh()} type="button">Thử tải lại</button></div> : metrics.map(({ value, label }) => <div className="py-6 md:px-7 md:first:pl-0" key={label}><p className="tabular font-heading text-3xl font-bold tracking-[-0.03em] text-[#102a43]">{value}</p><p className="mt-1 text-sm font-medium text-[#516274]">{label}</p></div>)}
      </section>
      <section className="py-10"><div className="mb-5 flex items-end justify-between gap-4"><div><h2 className="font-heading text-2xl font-bold tracking-[-0.025em] text-[#102a43]">Việc cần làm tiếp</h2><p className="mt-1 text-sm text-[#516274]">Đi tới đúng phân hệ để tiếp tục công việc đang mở.</p></div><span className="hidden text-xs font-bold text-[#516274] md:block">{visibleModules.length} phân hệ khả dụng</span></div><div className="overflow-hidden border-y border-[#a9bac1] bg-[#fffdfa]/55">
        {visibleModules.map(({ href, name, detail, icon: Icon }) => <Link className="group grid grid-cols-[auto_1fr_auto] items-center gap-4 border-b border-[#d5dfe2] px-3 py-5 transition-colors last:border-0 hover:bg-[#eee8dc]/65 active:bg-[#eee8dc] md:px-5" href={href} key={href}><div className="grid size-10 place-items-center rounded-xl bg-[#f8ece6] text-[#a8462d]"><Icon size={20} /></div><div><h3 className="font-bold text-[#102a43]">{name}</h3><p className="mt-1 text-sm text-[#516274]">{detail}</p></div><ArrowUpRight className="text-[#80909b] transition group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-[#c75b39]" size={18} /></Link>)}
      </div></section>
    </div>
  );
}
