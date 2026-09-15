"use client";

import { ArrowUpRight, BookOpenCheck, CalendarDays, Database, FileQuestion, GraduationCap, ListChecks, MessageSquareText, Presentation, RefreshCw, Settings, ShieldCheck, ShieldEllipsis, UserCheck, Users } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { apiRequest } from "@/lib/api-client";
import type { IdentityRole, PermissionCode, RoleCode } from "@/lib/app-types";
import type { Assignment, GradingQueueGroup, LearnerExamSummary, LearnerResult, LearningClass, LiveSession, OperationalReport } from "@/lib/learning-types";
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
  { href: "/admin/users", name: "Người dùng", detail: "Tài khoản, trạng thái và phạm vi truy cập", icon: Users, permissions: ["user:view"], roles: ["SYSTEM_ADMIN"] },
  { href: "/admin/roles", name: "Vai trò & quyền", detail: "Ma trận quyền và lịch sử thay đổi", icon: ShieldCheck, permissions: ["role:view"], roles: ["SYSTEM_ADMIN"] },
  { href: "/admin/settings", name: "Cấu hình hệ thống", detail: "Tích hợp, email và thiết lập dùng chung", icon: Settings, permissions: ["system:configure"], roles: ["SYSTEM_ADMIN"] },
  { href: "/admin/operations", name: "Vận hành & tuân thủ", detail: "Sao lưu, nhật ký và sức khỏe dịch vụ", icon: ShieldEllipsis, permissions: ["system:configure"], roles: ["SYSTEM_ADMIN"] },
  { href: "/courses", name: "Khóa học & lớp", detail: "Danh mục đào tạo và các lớp đang vận hành", icon: GraduationCap, permissions: ["course:view", "class:view"], roles: ["SYSTEM_ADMIN", "CENTER_MANAGER"] },
  { href: "/class-operations", name: "Điều hành lớp", detail: "Phân công giảng viên và ghi danh học viên", icon: ListChecks, permissions: ["class:manage"], roles: ["SYSTEM_ADMIN", "CENTER_MANAGER"] },
  { href: "/attendance", name: "Giám sát điểm danh", detail: "Đối soát buổi học và xử lý khiếu nại", icon: UserCheck, permissions: ["class:manage"], roles: ["SYSTEM_ADMIN", "CENTER_MANAGER"] },
  { href: "/reports", name: "Báo cáo vận hành", detail: "Tiến độ lớp và học viên cần hỗ trợ", icon: Database, permissions: ["report:view"], roles: ["SYSTEM_ADMIN", "CENTER_MANAGER"] },
  { href: "/materials", name: "Kho học liệu", detail: "Tệp, phiên bản và quyền truy cập", icon: Database, permissions: ["material:view"], roles: ["INSTRUCTOR", "LEARNER"] },
  { href: "/questions", name: "Ngân hàng câu hỏi", detail: "Câu hỏi, đề thi và chấm điểm", icon: FileQuestion, permissions: ["question:view"], roles: ["INSTRUCTOR"] },
  { href: "/teaching-operations", name: "Nghiệp vụ giảng dạy", detail: "Chấm bài, điểm danh và bản ghi buổi học", icon: Presentation, permissions: ["question:manage", "exam:manage", "session:manage"], roles: ["INSTRUCTOR"] },
  { href: "/reports", name: "Phân tích giảng dạy", detail: "Kết quả đánh giá theo lớp được phân công", icon: Database, permissions: ["report:view"], roles: ["INSTRUCTOR"] },
  { href: "/courses", name: "Lớp của tôi", detail: "Các lớp đang học và trạng thái ghi danh", icon: GraduationCap, permissions: ["class:view"], roles: ["LEARNER"] },
  { href: "/exams", name: "Đề & kết quả", detail: "Bài cần làm và kết quả đã công bố", icon: BookOpenCheck, permissions: ["exam:view"], roles: ["LEARNER"] },
  { href: "/forum", name: "Diễn đàn", detail: "Chủ đề và trao đổi trong lớp", icon: MessageSquareText, permissions: ["forum:view"], roles: ["LEARNER"] },
  { href: "/live-classes", name: "Lớp học online", detail: "Lịch học, phòng trực tuyến và bản ghi", icon: CalendarDays, permissions: ["session:view"], roles: ["LEARNER"] },
] satisfies Array<{ href: string; name: string; detail: string; icon: typeof Database; permissions: PermissionCode[]; roles: RoleCode[] }>;

/** Tải song song bộ KPI phù hợp với từng vai trò và chuẩn hóa thành ba chỉ số tổng quan. */
async function loadMetrics(roleCode: RoleCode): Promise<DashboardMetric[]> {
  if (roleCode === "SYSTEM_ADMIN") {
    const [users, roles, health] = await Promise.all([
      apiRequest<{ active: number }>("/admin/users?pageSize=1", { roleCode }),
      apiRequest<IdentityRole[]>("/admin/roles", { roleCode }),
      apiRequest<HealthOverview>("/system/health-overview", { roleCode }),
    ]);
    const healthLabel = health.status === "healthy" ? "Sẵn sàng" : health.status === "warning" ? "Cần theo dõi" : "Suy giảm";
    return [
      { value: String(users.active), label: "tài khoản đang hoạt động" },
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
    const [classes, gradingQueue, sessions] = await Promise.all([
      apiRequest<LearningClass[]>("/instructor/classes", { roleCode }),
      apiRequest<GradingQueueGroup[]>("/instructor/grading-queue", { roleCode }),
      apiRequest<LiveSession[]>("/sessions", { roleCode }),
    ]);
    const now = Date.now();
    return [
      { value: String(classes.length), label: "lớp được phân công" },
      { value: String(gradingQueue.reduce((sum, item) => sum + item.pendingCount, 0)), label: "bài tập và bài thi chờ chấm" },
      { value: String(sessions.filter((item) => item.status !== "CANCELLED" && new Date(item.startsAt).getTime() > now).length), label: "buổi học sắp tới" },
    ];
  }

  const [classes, exams, assignments, results] = await Promise.all([
    apiRequest<LearningClass[]>("/learner/classes", { roleCode }),
    apiRequest<LearnerExamSummary[]>("/learner/exams", { roleCode }),
    apiRequest<Assignment[]>("/academic/assignments", { roleCode }),
    apiRequest<LearnerResult[]>("/learner/results", { roleCode }),
  ]);
  const actionableAssignments = assignments.filter((item) => item.status === "PUBLISHED" && !item.submission && new Date(item.dueAt).getTime() >= Date.now()).length;
  const actionableExams = exams.filter((item) => item.availabilityStatus === "AVAILABLE" || item.availabilityStatus === "IN_PROGRESS").length;
  return [
    { value: String(classes.filter((item) => item.status === "ACTIVE").length), label: "lớp đang theo học" },
    { value: String(actionableAssignments + actionableExams), label: "bài tập và bài thi cần làm" },
    { value: String(results.length + assignments.filter((item) => item.submission?.status === "GRADED").length), label: "kết quả đã công bố" },
  ];
}

/** Hiển thị dashboard theo role, lọc phân hệ theo RBAC và cho phép tải lại KPI. */
export function DashboardHome() {
  const { session } = useApp();
  const content = roleContent[session.roleCode];
  const visibleModules = useMemo(() => modules.filter((item) => (item.roles as RoleCode[]).includes(session.roleCode) && hasAnyPermission(session, item.permissions)), [session]);
  const [metrics, setMetrics] = useState<DashboardMetric[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  /** Đồng bộ KPI khi đổi vai trò hoặc người dùng yêu cầu tải lại. */
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
      <PageHeader eyebrow={session.user.roleName} title={content.title} description={content.description} actions={<button className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-[var(--rule-strong)] bg-[var(--surface)] px-4 text-sm font-bold text-[var(--ink)] transition-[background-color,border-color,transform] duration-200 hover:-translate-y-px hover:border-[var(--action)] active:translate-y-px active:scale-[0.98] disabled:opacity-50" disabled={loading} onClick={() => void refresh()} type="button"><RefreshCw className={loading ? "animate-spin" : ""} size={15} />Cập nhật dữ liệu</button>} />
      <section aria-label="Chỉ số tổng quan" className="grid min-h-28 divide-y divide-[var(--rule)] border-b border-[var(--rule-strong)] py-2 md:grid-cols-3 md:divide-x md:divide-y-0">
        {loading ? <div aria-label="Đang đồng bộ số liệu" aria-live="polite" className="col-span-full grid gap-5 py-6 md:grid-cols-3" role="status">{[0, 1, 2].map((item) => <div className="animate-pulse" key={item}><div className="h-8 w-20 rounded bg-[var(--rule)]" /><div className="mt-3 h-4 w-40 rounded bg-[var(--surface-muted)]" /></div>)}</div> : error ? <div className="col-span-full flex flex-col items-center justify-center gap-2 py-6 text-center"><p className="text-sm font-bold text-[var(--danger)]">{error}</p><button className="text-link text-xs" onClick={() => void refresh()} type="button">Thử tải lại</button></div> : metrics.map(({ value, label }) => <div className="py-6 md:px-7 md:first:pl-0" key={label}><p className="tabular font-heading text-3xl font-bold tracking-[-0.03em] text-[var(--ink)]">{value}</p><p className="mt-1 text-sm font-medium text-[var(--ink-soft)]">{label}</p></div>)}
      </section>
      <section className="py-10"><div className="mb-5 flex items-end justify-between gap-4"><div><h2 className="font-heading text-2xl font-bold tracking-[-0.025em] text-[var(--ink)]">Việc cần làm tiếp</h2><p className="mt-1 text-sm text-[var(--ink-soft)]">Đi tới đúng phân hệ để tiếp tục công việc đang mở.</p></div><span className="hidden text-xs font-bold text-[var(--ink-soft)] md:block">{visibleModules.length} phân hệ khả dụng</span></div><div className="overflow-hidden border-y border-[var(--rule-strong)] bg-[var(--surface)]/55">
        {visibleModules.map(({ href, name, detail, icon: Icon }) => <Link className="group grid grid-cols-[auto_1fr_auto] items-center gap-4 border-b border-[var(--rule)] px-3 py-5 transition-colors last:border-0 hover:bg-[var(--surface-muted)]/65 active:bg-[var(--surface-muted)] md:px-5" href={href} key={href}><div className="grid size-10 place-items-center rounded-xl bg-[var(--accent-soft)] text-[var(--accent-deep)]"><Icon size={20} /></div><div><h3 className="font-bold text-[var(--ink)]">{name}</h3><p className="mt-1 text-sm text-[var(--ink-soft)]">{detail}</p></div><ArrowUpRight className="text-[var(--ink-subtle)] transition group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-[var(--accent)]" size={18} /></Link>)}
      </div></section>
    </div>
  );
}
