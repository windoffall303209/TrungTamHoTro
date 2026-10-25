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
  Compass,
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
import { hasAnyPermission } from "@/lib/access-control";

interface DashboardMetric {
  value: string;
  label: string;
  color?: "sky" | "cyan" | "amber" | "indigo";
}

interface HealthOverview {
  status: "healthy" | "warning" | "degraded";
  database: string;
}

const roleContent: Record<RoleCode, { title: string; description: string }> = {
  SYSTEM_ADMIN: {
    title: "Trung tâm Điều hành & Vận hành",
    description: "Theo dõi tài khoản, phân quyền, cấu hình hệ thống và tình trạng hạ tầng.",
  },
  CENTER_MANAGER: {
    title: "Trung tâm Quản trị Đào tạo",
    description: "Điều phối khóa học, quản lý lớp, phân công giảng viên và kiểm soát tiến độ.",
  },
  INSTRUCTOR: {
    title: "Không gian Giảng dạy & Khảo thí",
    description: "Tổ chức học liệu, soạn đề thi thông minh, chấm điểm và theo dõi lớp học.",
  },
  LEARNER: {
    title: "Không gian Học tập Cá nhân",
    description: "Theo dõi tiến độ học tập, làm bài thi, tham gia lớp học trực tuyến và trao đổi.",
  },
};

const modules = [
  {
    href: "/courses",
    name: "Khóa học & Lớp",
    detail: "Quản lý chương trình đào tạo, lịch học và danh sách lớp học",
    icon: GraduationCap,
    permissions: ["course:view", "class:view"],
    roles: ["SYSTEM_ADMIN", "CENTER_MANAGER", "INSTRUCTOR", "LEARNER"],
  },
  {
    href: "/exams",
    name: "Đề thi & Khảo thí",
    detail: "Soạn đề bằng AI, ngân hàng câu hỏi, tổ chức thi và chấm điểm",
    icon: BookOpenCheck,
    permissions: ["exam:view"],
    roles: ["SYSTEM_ADMIN", "CENTER_MANAGER", "INSTRUCTOR", "LEARNER"],
  },
  {
    href: "/materials",
    name: "Kho Học liệu Số",
    detail: "Tài liệu giảng dạy, bài giảng đa phương tiện và tài nguyên môn học",
    icon: Database,
    permissions: ["material:view"],
    roles: ["SYSTEM_ADMIN", "CENTER_MANAGER", "INSTRUCTOR", "LEARNER"],
  },
  {
    href: "/live-classes",
    name: "Lớp học Online",
    detail: "Phòng học trực tuyến, điểm danh tự động và video bản ghi",
    icon: CalendarDays,
    permissions: ["session:view"],
    roles: ["SYSTEM_ADMIN", "CENTER_MANAGER", "INSTRUCTOR", "LEARNER"],
  },
  {
    href: "/forum",
    name: "Diễn đàn Trao đổi",
    detail: "Kênh thảo luận học tập, giải đáp thắc mắc và chia sẻ tri thức",
    icon: MessageSquareText,
    permissions: ["forum:view"],
    roles: ["SYSTEM_ADMIN", "CENTER_MANAGER", "INSTRUCTOR", "LEARNER"],
  },
  {
    href: "/academic",
    name: "Lịch & Bài tập",
    detail: "Theo dõi thời khóa biểu, hạn nộp bài tập và lịch thi sắp tới",
    icon: ListChecks,
    permissions: ["class:view", "exam:view"],
    roles: ["INSTRUCTOR", "LEARNER"],
  },
  {
    href: "/admin/users",
    name: "Quản trị Người dùng",
    detail: "Cấp phát tài khoản, phân quyền quản trị và quản lý học viên",
    icon: Users,
    permissions: ["user:view"],
    roles: ["SYSTEM_ADMIN", "CENTER_MANAGER"],
  },
  {
    href: "/admin/settings",
    name: "Cấu hình Hệ thống",
    detail: "Thiết lập nhà cung cấp AI, tích hợp lưu trữ và chính sách bảo mật",
    icon: Settings,
    permissions: ["system:configure"],
    roles: ["SYSTEM_ADMIN"],
  },
  {
    href: "/reports",
    name: "Báo cáo Vận hành",
    detail: "Phân tích số liệu học tập, tỷ lệ chuyên cần và đánh giá chất lượng",
    icon: ShieldEllipsis,
    permissions: ["report:view"],
    roles: ["SYSTEM_ADMIN", "CENTER_MANAGER"],
  },
] satisfies Array<{
  href: string;
  name: string;
  detail: string;
  icon: typeof Database;
  permissions: PermissionCode[];
  roles: RoleCode[];
}>;

/** Tải song song bộ KPI phù hợp với từng vai trò người dùng. */
async function loadMetrics(roleCode: RoleCode): Promise<DashboardMetric[]> {
  if (roleCode === "SYSTEM_ADMIN") {
    const [users, roles, health] = await Promise.all([
      apiRequest<{ active: number }>("/admin/users?pageSize=1", { roleCode }),
      apiRequest<IdentityRole[]>("/admin/roles", { roleCode }),
      apiRequest<HealthOverview>("/system/health-overview", { roleCode }),
    ]);
    const healthLabel =
      health.status === "healthy"
        ? "Ổn định"
        : health.status === "warning"
          ? "Cần chú ý"
          : "Suy giảm";
    return [
      { value: String(users.active), label: "Tài khoản đang hoạt động", color: "sky" },
      { value: String(roles.length), label: "Vai trò trong hệ thống", color: "cyan" },
      { value: healthLabel, label: `Trạng thái máy chủ · DB ${health.database}`, color: "indigo" },
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
        label: "Lớp học đang mở",
        color: "sky",
      },
      { value: String(report.learners), label: "Tổng số học viên", color: "cyan" },
      {
        value: String(report.openTickets + report.openReports),
        label: "Yêu cầu cần xử lý",
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
      { value: String(classes.length), label: "Lớp phụ trách giảng dạy", color: "sky" },
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
        label: "Buổi dạy online sắp diễn ra",
        color: "cyan",
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
      label: "Lớp học tham gia",
      color: "sky",
    },
    {
      value: String(actionableAssignments + actionableExams),
      label: "Nhiệm vụ & đề thi cần làm",
      color: "amber",
    },
    {
      value: String(
        results.length +
          assignments.filter((item) => item.submission?.status === "GRADED")
            .length,
      ),
      label: "Kết quả đã công bố",
      color: "cyan",
    },
  ];
}

/** Dashboard tối giản hiện đại với giao diện Sky Blue dạng Command Center. */
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
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8 space-y-8">
      {/* Hero Welcome Banner Sky Blue */}
      <div className="relative overflow-hidden rounded-2xl border border-sky-200/80 dark:border-sky-800/60 bg-gradient-to-r from-sky-500/10 via-cyan-500/5 to-blue-500/10 dark:from-sky-950/40 dark:via-cyan-950/20 dark:to-blue-950/30 p-6 md:p-8 backdrop-blur-sm shadow-xs">
        <div className="absolute right-0 top-0 -mr-10 -mt-10 size-60 rounded-full bg-sky-400/15 blur-3xl pointer-events-none" />
        <div className="relative flex flex-col md:flex-row md:items-center md:justify-between gap-5">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-1.5 rounded-full bg-sky-100/80 dark:bg-sky-900/40 border border-sky-200 dark:border-sky-800 px-3 py-0.5 text-xs font-bold text-sky-800 dark:text-sky-300">
              <Sparkles size={13} className="text-sky-600 dark:text-sky-400" />
              <span>{session.user.roleName}</span>
            </div>
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
              Xin chào, {session.user.name} 👋
            </h1>
            <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-400 leading-relaxed max-w-2xl">
              {content.description}
            </p>
          </div>

          <button
            className="inline-flex min-h-10 shrink-0 whitespace-nowrap items-center justify-center gap-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-4 text-xs sm:text-sm font-semibold text-slate-700 dark:text-slate-300 shadow-2xs transition-all hover:border-sky-400 hover:text-sky-600 dark:hover:text-sky-300 active:scale-95 disabled:opacity-40"
            disabled={loading}
            onClick={() => void refresh()}
            type="button"
          >
            <RefreshCw className={loading ? "animate-spin" : ""} size={14} />
            Làm mới số liệu
          </button>
        </div>
      </div>

      {/* KPI Stats Grid */}
      <section aria-label="Chỉ số hoạt động" className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
            Chỉ số hoạt động trọng tâm
          </h2>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3">
          {loading ? (
            [0, 1, 2].map((item) => (
              <div
                className="animate-pulse rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-5 shadow-xs"
                key={item}
              >
                <div className="h-8 w-20 rounded bg-slate-100 dark:bg-slate-800" />
                <div className="mt-3 h-3.5 w-36 rounded bg-slate-100 dark:bg-slate-800/60" />
              </div>
            ))
          ) : error ? (
            <div className="col-span-full flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-rose-200 dark:border-rose-900/60 bg-rose-50/50 dark:bg-rose-950/20 py-8 text-center">
              <p className="text-xs font-semibold text-rose-600 dark:text-rose-400">{error}</p>
              <button
                className="text-xs font-semibold text-sky-600 dark:text-sky-400 hover:underline"
                onClick={() => void refresh()}
                type="button"
              >
                Thử tải lại
              </button>
            </div>
          ) : (
            metrics.map(({ value, label, color }) => {
              const textAccent =
                color === "amber"
                  ? "text-amber-600 dark:text-amber-400"
                  : color === "cyan"
                    ? "text-cyan-600 dark:text-cyan-400"
                    : color === "indigo"
                      ? "text-indigo-600 dark:text-indigo-400"
                      : "text-sky-600 dark:text-sky-400";

              return (
                <div
                  className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-5 shadow-xs transition-all hover:border-sky-300 dark:hover:border-sky-700/60"
                  key={label}
                >
                  <p className={`text-2xl font-bold tracking-tight tabular-nums ${textAccent}`}>
                    {value}
                  </p>
                  <p className="mt-1.5 text-xs sm:text-sm font-medium text-slate-500 dark:text-slate-400">
                    {label}
                  </p>
                </div>
              );
            })
          )}
        </div>
      </section>

      {/* Feature Modules Grid */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base sm:text-lg font-bold tracking-tight text-slate-900 dark:text-slate-100">
              Phân hệ chức năng
            </h2>
            <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400">
              Truy cập nhanh vào các công cụ học tập và quản trị.
            </p>
          </div>
          <span className="hidden sm:inline-flex rounded-full bg-sky-50 dark:bg-sky-950/60 border border-sky-200/80 dark:border-sky-800/60 px-2.5 py-0.5 text-xs font-semibold text-sky-700 dark:text-sky-300">
            {visibleModules.length} phân hệ khả dụng
          </span>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {visibleModules.map(({ href, name, detail, icon: Icon }) => (
            <Link
              className="group flex flex-col justify-between rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-5 shadow-xs transition-all duration-150 hover:border-sky-400/80 dark:hover:border-sky-500/50 hover:shadow-sm hover:translate-y-[-1px]"
              href={href}
              key={href}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="grid size-10 place-items-center rounded-lg bg-sky-50 dark:bg-sky-950/50 text-sky-600 dark:text-sky-400 border border-sky-100 dark:border-sky-900/40 group-hover:bg-sky-600 group-hover:text-white transition-colors duration-150">
                  <Icon size={19} />
                </div>
                <div className="rounded-md p-1 text-slate-400 group-hover:text-sky-600 dark:group-hover:text-sky-400 transition-colors">
                  <ArrowUpRight size={17} />
                </div>
              </div>
              <div className="mt-4">
                <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 group-hover:text-sky-600 dark:group-hover:text-sky-400 transition-colors">
                  {name}
                </h3>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400 leading-relaxed line-clamp-2">
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
