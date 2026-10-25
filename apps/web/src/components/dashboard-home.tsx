"use client";

import {
  ArrowUpRight,
  BookOpenCheck,
  CalendarDays,
  Database,
  FileQuestion,
  GraduationCap,
  ListChecks,
  MessageSquareText,
  Presentation,
  RefreshCw,
  Settings,
  ShieldCheck,
  ShieldEllipsis,
  Sparkles,
  UserCheck,
  Users,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { apiRequest } from "@/lib/api-client";
import type { IdentityRole, PermissionCode, RoleCode } from "@/lib/app-types";
import type {
  Assignment,
  GradingQueueGroup,
  LearnerExamSummary,
  LearnerResult,
  LearningClass,
  LiveSession,
  OperationalReport,
} from "@/lib/learning-types";
import { useApp } from "@/providers/app-provider";
import { PageHeader } from "./page-header";
import { hasAnyPermission } from "@/lib/access-control";

interface DashboardMetric {
  value: string;
  label: string;
  color?: "emerald" | "sky" | "amber" | "indigo";
}
interface HealthOverview {
  status: "healthy" | "warning" | "degraded";
  database: string;
}

const roleContent: Record<RoleCode, { title: string; description: string }> = {
  SYSTEM_ADMIN: {
    title: "Tình trạng vận hành",
    description: "Theo dõi người dùng, cấu hình, tích hợp và sức khỏe toàn hệ thống.",
  },
  CENTER_MANAGER: {
    title: "Vận hành trung tâm",
    description: "Điều phối khóa học, lớp, giảng viên và tiến độ học tập.",
  },
  INSTRUCTOR: {
    title: "Không gian giảng dạy",
    description: "Quản lý học liệu, đánh giá, diễn đàn và các buổi học sắp tới.",
  },
  LEARNER: {
    title: "Hôm nay của bạn",
    description: "Theo dõi lịch học, học liệu mới và các bài cần hoàn thành.",
  },
};

const modules = [
  {
    href: "/admin/users",
    name: "Người dùng",
    detail: "Tài khoản, trạng thái và phạm vi truy cập",
    icon: Users,
    permissions: ["user:view"],
    roles: ["SYSTEM_ADMIN", "CENTER_MANAGER"],
  },
  {
    href: "/admin/roles",
    name: "Vai trò & quyền",
    detail: "Ma trận quyền và lịch sử thay đổi",
    icon: ShieldCheck,
    permissions: ["role:view"],
    roles: ["SYSTEM_ADMIN"],
  },
  {
    href: "/admin/settings",
    name: "Cấu hình hệ thống",
    detail: "Tích hợp, email và thiết lập dùng chung",
    icon: Settings,
    permissions: ["system:configure"],
    roles: ["SYSTEM_ADMIN"],
  },
  {
    href: "/admin/operations",
    name: "Vận hành & tuân thủ",
    detail: "Sao lưu, nhật ký và sức khỏe dịch vụ",
    icon: ShieldEllipsis,
    permissions: ["system:configure"],
    roles: ["SYSTEM_ADMIN"],
  },
  {
    href: "/courses",
    name: "Khóa học & lớp",
    detail: "Danh mục đào tạo và các lớp đang vận hành",
    icon: GraduationCap,
    permissions: ["course:view", "class:view"],
    roles: ["SYSTEM_ADMIN", "CENTER_MANAGER"],
  },
  {
    href: "/class-operations",
    name: "Điều hành lớp",
    detail: "Phân công giảng viên và ghi danh học viên",
    icon: ListChecks,
    permissions: ["class:manage"],
    roles: ["SYSTEM_ADMIN", "CENTER_MANAGER"],
  },
  {
    href: "/attendance",
    name: "Giám sát điểm danh",
    detail: "Đối soát buổi học và xử lý khiếu nại",
    icon: UserCheck,
    permissions: ["class:manage"],
    roles: ["SYSTEM_ADMIN", "CENTER_MANAGER"],
  },
  {
    href: "/reports",
    name: "Báo cáo vận hành",
    detail: "Tiến độ lớp và học viên cần hỗ trợ",
    icon: Database,
    permissions: ["report:view"],
    roles: ["SYSTEM_ADMIN", "CENTER_MANAGER"],
  },
  {
    href: "/materials",
    name: "Kho học liệu",
    detail: "Tệp, phiên bản và quyền truy cập",
    icon: Database,
    permissions: ["material:view"],
    roles: ["INSTRUCTOR", "LEARNER"],
  },
  {
    href: "/questions",
    name: "Ngân hàng câu hỏi",
    detail: "Câu hỏi, ma trận đề thi và duyệt chất lượng",
    icon: FileQuestion,
    permissions: ["question:view"],
    roles: ["INSTRUCTOR"],
  },
  {
    href: "/exams",
    name: "Đề thi & Khảo thí",
    detail: "Tạo đề AI, tổ chức thi và chấm điểm",
    icon: BookOpenCheck,
    permissions: ["exam:view"],
    roles: ["INSTRUCTOR"],
  },
  {
    href: "/teaching-operations",
    name: "Nghiệp vụ giảng dạy",
    detail: "Chấm bài, điểm danh và bản ghi buổi học",
    icon: Presentation,
    permissions: ["question:manage", "exam:manage", "session:manage"],
    roles: ["INSTRUCTOR"],
  },
  {
    href: "/courses",
    name: "Lớp của tôi",
    detail: "Các lớp đang học và trạng thái ghi danh",
    icon: GraduationCap,
    permissions: ["class:view"],
    roles: ["LEARNER"],
  },
  {
    href: "/exams",
    name: "Đề & kết quả",
    detail: "Bài thi cần làm và kết quả đã công bố",
    icon: BookOpenCheck,
    permissions: ["exam:view"],
    roles: ["LEARNER"],
  },
  {
    href: "/forum",
    name: "Diễn đàn",
    detail: "Chủ đề thảo luận và giải đáp thắc mắc",
    icon: MessageSquareText,
    permissions: ["forum:view"],
    roles: ["LEARNER", "INSTRUCTOR"],
  },
  {
    href: "/live-classes",
    name: "Lớp học online",
    detail: "Lịch học trực tuyến, phòng học và bản ghi",
    icon: CalendarDays,
    permissions: ["session:view"],
    roles: ["LEARNER", "INSTRUCTOR"],
  },
] satisfies Array<{
  href: string;
  name: string;
  detail: string;
  icon: typeof Database;
  permissions: PermissionCode[];
  roles: RoleCode[];
}>;

/** Tải song song bộ KPI phù hợp với từng vai trò và chuẩn hóa thành ba chỉ số tổng quan. */
async function loadMetrics(roleCode: RoleCode): Promise<DashboardMetric[]> {
  if (roleCode === "SYSTEM_ADMIN") {
    const [users, roles, health] = await Promise.all([
      apiRequest<{ active: number }>("/admin/users?pageSize=1", { roleCode }),
      apiRequest<IdentityRole[]>("/admin/roles", { roleCode }),
      apiRequest<HealthOverview>("/system/health-overview", { roleCode }),
    ]);
    const healthLabel =
      health.status === "healthy"
        ? "Sẵn sàng"
        : health.status === "warning"
          ? "Cần theo dõi"
          : "Suy giảm";
    return [
      { value: String(users.active), label: "Tài khoản đang hoạt động", color: "emerald" },
      { value: String(roles.length), label: "Vai trò được cấu hình", color: "sky" },
      { value: healthLabel, label: `Dịch vụ hệ thống · DB ${health.database}`, color: "indigo" },
    ];
  }

  if (roleCode === "CENTER_MANAGER") {
    const [classes, report] = await Promise.all([
      apiRequest<LearningClass[]>("/classes", { roleCode }),
      apiRequest<OperationalReport>("/reports/operations", { roleCode }),
    ]);
    return [
      {
        value: String(classes.filter((item) => item.status === "ACTIVE").length),
        label: "Lớp đang hoạt động",
        color: "emerald",
      },
      { value: String(report.learners), label: "Học viên trong phạm vi", color: "sky" },
      {
        value: String(report.openTickets + report.openReports),
        label: "Yêu cầu vận hành đang mở",
        color: "amber",
      },
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
      { value: String(classes.length), label: "Lớp được phân công", color: "emerald" },
      {
        value: String(
          gradingQueue.reduce((sum, item) => sum + item.pendingCount, 0),
        ),
        label: "Bài thi & bài tập chờ chấm",
        color: "amber",
      },
      {
        value: String(
          sessions.filter(
            (item) =>
              item.status !== "CANCELLED" &&
              new Date(item.startsAt).getTime() > now,
          ).length,
        ),
        label: "Buổi học online sắp tới",
        color: "sky",
      },
    ];
  }

  const [classes, exams, assignments, results] = await Promise.all([
    apiRequest<LearningClass[]>("/learner/classes", { roleCode }),
    apiRequest<LearnerExamSummary[]>("/learner/exams", { roleCode }),
    apiRequest<Assignment[]>("/academic/assignments", { roleCode }),
    apiRequest<LearnerResult[]>("/learner/results", { roleCode }),
  ]);
  const actionableAssignments = assignments.filter(
    (item) =>
      item.status === "PUBLISHED" &&
      !item.submission &&
      new Date(item.dueAt).getTime() >= Date.now(),
  ).length;
  const actionableExams = exams.filter(
    (item) =>
      item.availabilityStatus === "AVAILABLE" ||
      item.availabilityStatus === "IN_PROGRESS",
  ).length;
  return [
    {
      value: String(classes.filter((item) => item.status === "ACTIVE").length),
      label: "Lớp đang theo học",
      color: "emerald",
    },
    {
      value: String(actionableAssignments + actionableExams),
      label: "Bài tập & đề thi cần làm",
      color: "amber",
    },
    {
      value: String(
        results.length +
          assignments.filter((item) => item.submission?.status === "GRADED")
            .length,
      ),
      label: "Kết quả đã công bố",
      color: "sky",
    },
  ];
}

/** Hiển thị dashboard theo role, lọc phân hệ theo RBAC và cho phép tải lại KPI. */
export function DashboardHome() {
  const { session } = useApp();
  const content = roleContent[session.roleCode];
  const visibleModules = useMemo(
    () =>
      modules.filter(
        (item) =>
          (item.roles as RoleCode[]).includes(session.roleCode) &&
          hasAnyPermission(session, item.permissions),
      ),
    [session],
  );
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
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Không thể tải số liệu tổng quan.",
      );
    } finally {
      setLoading(false);
    }
  }, [session.roleCode]);

  useEffect(() => {
    window.queueMicrotask(() => {
      void refresh();
    });
  }, [refresh]);

  return (
    <div className="workspace-enter mx-auto max-w-7xl px-4 py-6 md:px-8 md:py-8 space-y-8">
      {/* Top Banner with Fresh Gradient */}
      <div className="relative overflow-hidden rounded-3xl border border-emerald-500/20 bg-gradient-to-r from-emerald-500/10 via-teal-500/5 to-sky-500/10 p-6 md:p-8 backdrop-blur-sm shadow-xs">
        <div className="absolute right-0 top-0 -mt-6 -mr-6 size-48 rounded-full bg-emerald-400/10 blur-3xl pointer-events-none" />
        <div className="relative flex flex-col md:flex-row md:items-center md:justify-between gap-5">
          <div className="space-y-1.5">
            <div className="inline-flex items-center gap-2 rounded-full bg-emerald-500/15 border border-emerald-500/30 px-3 py-1 text-xs font-bold text-emerald-800 dark:text-emerald-300">
              <Sparkles size={14} className="text-emerald-500" />
              <span>{session.user.roleName}</span>
            </div>
            <h1 className="font-heading text-2xl md:text-3xl font-black tracking-tight text-[var(--ink)]">
              Xin chào, {session.user.name} 👋
            </h1>
            <p className="max-w-2xl text-xs md:text-sm text-[var(--ink-soft)] leading-relaxed">
              {content.description}
            </p>
          </div>
          <button
            className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-[var(--surface)] px-4 text-xs md:text-sm font-bold text-[var(--ink)] shadow-2xs transition-all hover:border-emerald-500 hover:text-emerald-600 dark:hover:text-emerald-400 hover:shadow-xs active:scale-[0.98] disabled:opacity-50"
            disabled={loading}
            onClick={() => void refresh()}
            type="button"
          >
            <RefreshCw className={loading ? "animate-spin" : ""} size={15} />
            Đồng bộ số liệu
          </button>
        </div>
      </div>

      {/* KPI Stat Cards Grid */}
      <section aria-label="Chỉ số tổng quan" className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
            Chỉ số hoạt động trọng tâm
          </h2>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3">
          {loading ? (
            [0, 1, 2].map((item) => (
              <div
                className="animate-pulse rounded-2xl border border-slate-200 dark:border-slate-800 bg-[var(--surface)] p-6 shadow-xs"
                key={item}
              >
                <div className="h-9 w-24 rounded-lg bg-slate-200 dark:bg-slate-800" />
                <div className="mt-3 h-4 w-44 rounded bg-slate-100 dark:bg-slate-800/60" />
              </div>
            ))
          ) : error ? (
            <div className="col-span-full flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-rose-300 dark:border-rose-900 bg-rose-50/50 dark:bg-rose-950/20 py-8 text-center">
              <p className="text-sm font-bold text-[var(--danger)]">{error}</p>
              <button
                className="text-link text-xs font-bold"
                onClick={() => void refresh()}
                type="button"
              >
                Thử tải lại
              </button>
            </div>
          ) : (
            metrics.map(({ value, label, color }) => {
              const borderAccent =
                color === "amber"
                  ? "hover:border-amber-400/60"
                  : color === "sky"
                    ? "hover:border-sky-400/60"
                    : color === "indigo"
                      ? "hover:border-indigo-400/60"
                      : "hover:border-emerald-400/60";

              const textAccent =
                color === "amber"
                  ? "text-amber-600 dark:text-amber-400"
                  : color === "sky"
                    ? "text-sky-600 dark:text-sky-400"
                    : color === "indigo"
                      ? "text-indigo-600 dark:text-indigo-400"
                      : "text-emerald-600 dark:text-emerald-400";

              return (
                <div
                  className={`group relative overflow-hidden rounded-2xl border border-slate-200/90 dark:border-slate-800 bg-[var(--surface)] p-6 shadow-xs transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md ${borderAccent}`}
                  key={label}
                >
                  <p
                    className={`tabular font-heading text-3xl md:text-4xl font-black tracking-tight ${textAccent}`}
                  >
                    {value}
                  </p>
                  <p className="mt-2 text-xs md:text-sm font-semibold text-[var(--ink-soft)]">
                    {label}
                  </p>
                </div>
              );
            })
          )}
        </div>
      </section>

      {/* Actionable Modules Grid */}
      <section className="space-y-4">
        <div className="flex items-end justify-between gap-4">
          <div>
            <h2 className="font-heading text-xl md:text-2xl font-black tracking-tight text-[var(--ink)]">
              Phân hệ chức năng
            </h2>
            <p className="mt-1 text-xs md:text-sm text-[var(--ink-soft)]">
              Truy cập nhanh vào các công cụ và nghiệp vụ thường dùng.
            </p>
          </div>
          <span className="hidden sm:inline-flex rounded-full bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200/80 dark:border-emerald-800/80 px-3 py-1 text-xs font-bold text-emerald-700 dark:text-emerald-300">
            {visibleModules.length} phân hệ khả dụng
          </span>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {visibleModules.map(({ href, name, detail, icon: Icon }) => (
            <Link
              className="group relative flex flex-col justify-between overflow-hidden rounded-2xl border border-slate-200/90 dark:border-slate-800 bg-[var(--surface)] p-5 shadow-xs transition-all duration-200 hover:-translate-y-0.5 hover:border-emerald-500/50 hover:shadow-md hover:bg-emerald-50/20 dark:hover:bg-emerald-950/20"
              href={href}
              key={href}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="grid size-11 place-items-center rounded-xl bg-gradient-to-tr from-emerald-500/15 to-teal-500/10 text-emerald-600 dark:text-emerald-400 group-hover:from-emerald-500 group-hover:to-teal-500 group-hover:text-white transition-all duration-200">
                  <Icon size={20} />
                </div>
                <div className="rounded-full bg-slate-100 dark:bg-slate-800 p-1.5 text-slate-400 group-hover:text-emerald-600 dark:group-hover:text-emerald-400 group-hover:bg-emerald-50 dark:group-hover:bg-emerald-950 transition-colors">
                  <ArrowUpRight size={16} />
                </div>
              </div>
              <div className="mt-4">
                <h3 className="font-heading text-base font-bold text-[var(--ink)] group-hover:text-emerald-700 dark:group-hover:text-emerald-400 transition-colors">
                  {name}
                </h3>
                <p className="mt-1 text-xs text-[var(--ink-soft)] leading-relaxed">
                  {detail}
                </p>
              </div>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
