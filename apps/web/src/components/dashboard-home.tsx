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

/** Tải song song bộ KPI phù hợp với từng vai trò. */
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

/** Dashboard tối giản, tinh gọn và phân cấp trực quan cho từng vai trò người dùng. */
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
    <div className="mx-auto max-w-7xl px-4 py-6 md:px-8 md:py-8 space-y-8">
      {/* Welcome Banner */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-6 shadow-xs">
        <div className="space-y-1">
          <div className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200/80 dark:border-emerald-800/60 px-2.5 py-0.5 text-xs font-semibold text-emerald-700 dark:text-emerald-400">
            <Sparkles size={13} className="text-emerald-600 dark:text-emerald-400" />
            <span>{session.user.roleName}</span>
          </div>
          <h1 className="text-xl md:text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
            Xin chào, {session.user.name} 👋
          </h1>
          <p className="text-xs md:text-sm text-slate-500 dark:text-slate-400 leading-relaxed max-w-2xl">
            {content.description}
          </p>
        </div>

        <button
          className="inline-flex min-h-9 shrink-0 items-center justify-center gap-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-3.5 text-xs font-semibold text-slate-700 dark:text-slate-300 shadow-2xs transition-all hover:bg-slate-50 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-slate-100 disabled:opacity-40"
          disabled={loading}
          onClick={() => void refresh()}
          type="button"
        >
          <RefreshCw className={loading ? "animate-spin" : ""} size={14} />
          Đồng bộ số liệu
        </button>
      </div>

      {/* KPI Stats */}
      <section aria-label="Chỉ số hoạt động" className="space-y-3">
        <h2 className="text-xs font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
          Chỉ số hoạt động trọng tâm
        </h2>
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
                className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 hover:underline"
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
                  : color === "sky"
                    ? "text-sky-600 dark:text-sky-400"
                    : color === "indigo"
                      ? "text-indigo-600 dark:text-indigo-400"
                      : "text-emerald-600 dark:text-emerald-400";

              return (
                <div
                  className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-5 shadow-xs transition-all hover:border-slate-300 dark:hover:border-slate-700"
                  key={label}
                >
                  <p className={`text-2xl md:text-3xl font-bold tracking-tight tabular-nums ${textAccent}`}>
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
            <h2 className="text-lg md:text-xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
              Phân hệ chức năng
            </h2>
            <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400">
              Truy cập nhanh vào các công cụ nghiệp vụ thường dùng.
            </p>
          </div>
          <span className="hidden sm:inline-flex rounded-full bg-slate-100 dark:bg-slate-800 px-2.5 py-0.5 text-xs font-medium text-slate-600 dark:text-slate-400">
            {visibleModules.length} phân hệ khả dụng
          </span>
        </div>

        <div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
          {visibleModules.map(({ href, name, detail, icon: Icon }) => (
            <Link
              className="group flex flex-col justify-between rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-4.5 shadow-xs transition-all duration-150 hover:border-emerald-500/60 dark:hover:border-emerald-500/40 hover:shadow-sm"
              href={href}
              key={href}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="grid size-9.5 place-items-center rounded-lg bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 border border-emerald-100 dark:border-emerald-900/40 group-hover:bg-emerald-600 group-hover:text-white transition-colors duration-150">
                  <Icon size={18} />
                </div>
                <div className="rounded-md p-1 text-slate-400 group-hover:text-emerald-600 dark:group-hover:text-emerald-400 transition-colors">
                  <ArrowUpRight size={16} />
                </div>
              </div>
              <div className="mt-3.5">
                <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 group-hover:text-emerald-600 dark:group-hover:text-emerald-400 transition-colors">
                  {name}
                </h3>
                <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400 leading-relaxed line-clamp-2">
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
