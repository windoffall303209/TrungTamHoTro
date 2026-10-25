"use client";

import {
  ArrowUpRight,
  BookOpenCheck,
  CalendarDays,
  Database,
  GraduationCap,
  ListChecks,
  MessageSquareText,
  RefreshCw,
  Settings,
  ShieldCheck,
  ShieldEllipsis,
  Sparkles,
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
import { useI18n } from "@/providers/i18n-provider";
import { hasAnyPermission } from "@/lib/access-control";

interface DashboardMetric {
  value: string;
  label: string;
  labelEn?: string;
  color?: "sky" | "cyan" | "amber" | "indigo";
}

interface HealthOverview {
  status: "healthy" | "warning" | "degraded";
  database: string;
}

const roleContent: Record<
  RoleCode,
  {
    title: { "vi-VN": string; "en-US": string };
    description: { "vi-VN": string; "en-US": string };
  }
> = {
  SYSTEM_ADMIN: {
    title: {
      "vi-VN": "Trung tâm Điều hành & Vận hành",
      "en-US": "System Operations & Control Center",
    },
    description: {
      "vi-VN": "Theo dõi tài khoản, phân quyền, cấu hình hệ thống và tình trạng hạ tầng.",
      "en-US": "Monitor accounts, permissions, system configurations, and infrastructure status.",
    },
  },
  CENTER_MANAGER: {
    title: {
      "vi-VN": "Trung tâm Quản trị Đào tạo",
      "en-US": "Training Management Center",
    },
    description: {
      "vi-VN": "Điều phối khóa học, quản lý lớp, phân công giảng viên và kiểm soát tiến độ.",
      "en-US": "Coordinate courses, manage classes, assign instructors, and control academic progress.",
    },
  },
  INSTRUCTOR: {
    title: {
      "vi-VN": "Không gian Giảng dạy & Khảo thí",
      "en-US": "Teaching & Assessment Workspace",
    },
    description: {
      "vi-VN": "Tổ chức học liệu, soạn đề thi thông minh, chấm điểm và theo dõi lớp học.",
      "en-US": "Organize learning materials, author smart exams, grade submissions, and track classes.",
    },
  },
  LEARNER: {
    title: {
      "vi-VN": "Không gian Học tập Cá nhân",
      "en-US": "Personal Learning Workspace",
    },
    description: {
      "vi-VN": "Theo dõi tiến độ học tập, làm bài thi, tham gia lớp học trực tuyến và trao đổi.",
      "en-US": "Track study progress, take exams, join live classes, and engage in discussions.",
    },
  },
};

const modules = [
  {
    href: "/courses",
    name: "Khóa học & lớp",
    nameEn: "Courses & Classes",
    detail: "Quản lý chương trình đào tạo, lịch học và danh sách lớp học",
    detailEn: "Manage training curriculum, schedules, and class rosters",
    icon: GraduationCap,
    permissions: ["course:view", "class:view"],
    roles: ["SYSTEM_ADMIN", "CENTER_MANAGER", "INSTRUCTOR", "LEARNER"],
  },
  {
    href: "/exams",
    name: "Đề thi & khảo thí",
    nameEn: "Exams & Assessments",
    detail: "Soạn đề bằng AI, ngân hàng câu hỏi, tổ chức thi và chấm điểm",
    detailEn: "AI exam authoring, question bank, exam delivery, and grading",
    icon: BookOpenCheck,
    permissions: ["exam:view"],
    roles: ["SYSTEM_ADMIN", "CENTER_MANAGER", "INSTRUCTOR", "LEARNER"],
  },
  {
    href: "/materials",
    name: "Kho học liệu",
    nameEn: "Digital Learning Materials",
    detail: "Tài liệu giảng dạy, bài giảng đa phương tiện và tài nguyên môn học",
    detailEn: "Teaching materials, multimedia lectures, and course resources",
    icon: Database,
    permissions: ["material:view"],
    roles: ["SYSTEM_ADMIN", "CENTER_MANAGER", "INSTRUCTOR", "LEARNER"],
  },
  {
    href: "/live-classes",
    name: "Lớp học online",
    nameEn: "Online Live Classes",
    detail: "Phòng học trực tuyến, điểm danh tự động và video bản ghi",
    detailEn: "Virtual classrooms, automatic attendance, and session recordings",
    icon: CalendarDays,
    permissions: ["session:view"],
    roles: ["SYSTEM_ADMIN", "CENTER_MANAGER", "INSTRUCTOR", "LEARNER"],
  },
  {
    href: "/forum",
    name: "Diễn đàn trao đổi",
    nameEn: "Discussion Forum",
    detail: "Kênh thảo luận học tập, giải đáp thắc mắc và chia sẻ tri thức",
    detailEn: "Community discussions, Q&A support, and knowledge sharing",
    icon: MessageSquareText,
    permissions: ["forum:view"],
    roles: ["SYSTEM_ADMIN", "CENTER_MANAGER", "INSTRUCTOR", "LEARNER"],
  },
  {
    href: "/academic",
    name: "Lịch & bài tập",
    nameEn: "Schedule & Assignments",
    detail: "Theo dõi thời khóa biểu, hạn nộp bài tập và lịch thi sắp tới",
    detailEn: "Track timetable, assignment due dates, and upcoming exams",
    icon: ListChecks,
    permissions: ["class:view", "exam:view"],
    roles: ["INSTRUCTOR", "LEARNER"],
  },
  {
    href: "/admin/users",
    name: "Người dùng",
    nameEn: "User Management",
    detail: "Cấp phát tài khoản, phân quyền quản trị và quản lý học viên",
    detailEn: "Account provisioning, role assignment, and learner management",
    icon: Users,
    permissions: ["user:view"],
    roles: ["SYSTEM_ADMIN", "CENTER_MANAGER"],
  },
  {
    href: "/admin/roles",
    name: "Vai trò & quyền",
    nameEn: "Roles & Permissions",
    detail: "Cấu hình vai trò và ma trận quyền hạn quản trị",
    detailEn: "Configure roles and permission matrices",
    icon: ShieldCheck,
    permissions: ["role:view"],
    roles: ["SYSTEM_ADMIN"],
  },
  {
    href: "/class-operations",
    name: "Điều hành lớp",
    nameEn: "Class Operations",
    detail: "Quản lý tiến độ giảng dạy, sĩ số và trạng thái vận hành",
    detailEn: "Manage teaching progress, rosters, and operational states",
    icon: ListChecks,
    permissions: ["class:manage"],
    roles: ["SYSTEM_ADMIN", "CENTER_MANAGER"],
  },
  {
    href: "/admin/settings",
    name: "Cấu hình",
    nameEn: "System Settings",
    detail: "Thiết lập nhà cung cấp AI, tích hợp lưu trữ và chính sách bảo mật",
    detailEn: "Configure AI providers, storage integrations, and security policies",
    icon: Settings,
    permissions: ["system:configure"],
    roles: ["SYSTEM_ADMIN"],
  },
  {
    href: "/reports",
    name: "Báo cáo vận hành",
    nameEn: "Operational Reports",
    detail: "Phân tích số liệu học tập, tỷ lệ chuyên cần và đánh giá chất lượng",
    detailEn: "Analyze learning metrics, attendance rates, and quality evaluation",
    icon: ShieldEllipsis,
    permissions: ["report:view"],
    roles: ["SYSTEM_ADMIN", "CENTER_MANAGER"],
  },
] satisfies Array<{
  href: string;
  name: string;
  nameEn: string;
  detail: string;
  detailEn: string;
  icon: typeof Database;
  permissions: PermissionCode[];
  roles: RoleCode[];
}>;

// Tải song song bộ KPI phù hợp với từng vai trò người dùng kèm nhãn song ngữ.
async function loadMetrics(roleCode: RoleCode, isEn: boolean): Promise<DashboardMetric[]> {
  if (roleCode === "SYSTEM_ADMIN") {
    const [users, roles, health] = await Promise.all([
      apiRequest<{ active: number }>("/admin/users?pageSize=1", { roleCode }),
      apiRequest<IdentityRole[]>("/admin/roles", { roleCode }),
      apiRequest<HealthOverview>("/system/health-overview", { roleCode }),
    ]);
    const healthLabel =
      health.status === "healthy"
        ? isEn ? "Healthy" : "Ổn định"
        : health.status === "warning"
          ? isEn ? "Attention" : "Cần chú ý"
          : isEn ? "Degraded" : "Suy giảm";
    return [
      {
        value: String(users.active),
        label: "Tài khoản đang hoạt động",
        labelEn: "Active accounts",
        color: "sky",
      },
      {
        value: String(roles.length),
        label: "Vai trò trong hệ thống",
        labelEn: "System roles",
        color: "cyan",
      },
      {
        value: healthLabel,
        label: `dịch vụ · CSDL ${health.database}`,
        labelEn: `Services · DB ${health.database}`,
        color: "indigo",
      },
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
        labelEn: "Active classes",
        color: "sky",
      },
      {
        value: String(report.learners),
        label: "Tổng số học viên",
        labelEn: "Total learners",
        color: "cyan",
      },
      {
        value: String(report.openTickets + report.openReports),
        label: "Yêu cầu cần xử lý",
        labelEn: "Pending requests",
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
      {
        value: String(classes.length),
        label: "Lớp phụ trách giảng dạy",
        labelEn: "Assigned teaching classes",
        color: "sky",
      },
      {
        value: String(
          gradingQueue.reduce((sum, item) => sum + item.pendingCount, 0),
        ),
        label: "Bài thi & bài tập chờ chấm",
        labelEn: "Exams & assignments awaiting grading",
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
        labelEn: "Upcoming online classes",
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
      labelEn: "Enrolled classes",
      color: "sky",
    },
    {
      value: String(actionableAssignments + actionableExams),
      label: "bài tập và bài thi cần làm",
      labelEn: "Pending tasks & exams",
      color: "amber",
    },
    {
      value: String(
        results.length +
          assignments.filter((item) => item.submission?.status === "GRADED")
            .length,
      ),
      label: "Kết quả đã công bố",
      labelEn: "Published results",
      color: "cyan",
    },
  ];
}

// Render Dashboard dạng Command Center hiện đại, tối giản và đồng bộ song ngữ hoàn hảo.
export function DashboardHome() {
  const { session } = useApp();
  const { t, locale } = useI18n();
  const isEn = locale === "en-US";
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
      setMetrics(await loadMetrics(session.roleCode, isEn));
    } catch (requestError) {
      setMetrics([]);
      setError(
        requestError instanceof Error
          ? requestError.message
          : isEn
            ? "Unable to load dashboard metrics."
            : "Không thể tải số liệu tổng quan.",
      );
    } finally {
      setLoading(false);
    }
  }, [session.roleCode, isEn]);

  useEffect(() => {
    window.queueMicrotask(() => {
      void refresh();
    });
  }, [refresh]);

  return (
    <div className="mx-auto max-w-7xl px-4 py-4 sm:px-6 lg:px-8 space-y-5">
      {/* Hero Welcome Banner Sky Blue */}
      <div className="relative overflow-hidden rounded-2xl border border-sky-200/80 dark:border-sky-800/60 bg-gradient-to-r from-sky-500/10 via-cyan-500/5 to-blue-500/10 dark:from-sky-950/40 dark:via-cyan-950/20 dark:to-blue-950/30 p-4.5 sm:p-5 md:p-6 backdrop-blur-sm shadow-xs">
        <div className="absolute right-0 top-0 -mr-10 -mt-10 size-60 rounded-full bg-sky-400/15 blur-3xl pointer-events-none" />
        <div className="relative flex flex-col md:flex-row md:items-center md:justify-between gap-5">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-1.5 rounded-full bg-sky-100/80 dark:bg-sky-900/40 border border-sky-200 dark:border-sky-800 px-3 py-0.5 text-xs font-bold text-sky-800 dark:text-sky-300">
              <Sparkles size={13} className="text-sky-600 dark:text-sky-400" />
              <span>{t(session.user.roleName)}</span>
            </div>
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
              {isEn ? `Welcome, ${session.user.name} 👋` : `Xin chào, ${session.user.name} 👋`}
            </h1>
            <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-400 leading-relaxed max-w-2xl">
              {content.description[locale] ?? content.description["vi-VN"]}
            </p>
          </div>

          <button
            className="inline-flex min-h-10 shrink-0 whitespace-nowrap items-center justify-center gap-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-4 text-xs sm:text-sm font-semibold text-slate-700 dark:text-slate-300 shadow-2xs transition-all hover:border-sky-400 hover:text-sky-600 dark:hover:text-sky-300 active:scale-95 disabled:opacity-40"
            disabled={loading}
            onClick={() => void refresh()}
            type="button"
          >
            <RefreshCw className={loading ? "animate-spin" : ""} size={14} />
            {isEn ? "Refresh metrics" : "Làm mới số liệu"}
          </button>
        </div>
      </div>

      {/* KPI Stats Grid */}
      <section aria-label={isEn ? "Operational metrics" : "Chỉ số hoạt động"} className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
            {isEn ? "Key Operational Metrics" : "Chỉ số hoạt động trọng tâm"}
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
                {isEn ? "Try again" : "Thử tải lại"}
              </button>
            </div>
          ) : (
            metrics.map(({ value, label, labelEn, color }) => {
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
                    {isEn && labelEn ? labelEn : label}
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
              {isEn ? "Functional Modules" : "Phân hệ chức năng"}
            </h2>
            <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400">
              {isEn
                ? "Quick access to learning and administration tools."
                : "Truy cập nhanh vào các công cụ học tập và quản trị."}
            </p>
          </div>
          <span className="hidden sm:inline-flex rounded-full bg-sky-50 dark:bg-sky-950/60 border border-sky-200/80 dark:border-sky-800/60 px-2.5 py-0.5 text-xs font-semibold text-sky-700 dark:text-sky-300">
            {visibleModules.length}{" "}
            {isEn
              ? visibleModules.length === 1
                ? "module available"
                : "modules available"
              : "phân hệ khả dụng"}
          </span>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {visibleModules.map(({ href, name, nameEn, detail, detailEn, icon: Icon }) => (
            <Link
              className="group flex flex-col justify-between rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-4 sm:p-4.5 shadow-xs transition-all duration-150 hover:border-sky-400/80 dark:hover:border-sky-500/50 hover:shadow-sm hover:translate-y-[-1px]"
              href={href}
              key={href}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="grid size-9.5 place-items-center rounded-lg bg-sky-50 dark:bg-sky-950/50 text-sky-600 dark:text-sky-400 border border-sky-100 dark:border-sky-900/40 group-hover:bg-sky-600 group-hover:text-white transition-colors duration-150">
                  <Icon size={18} />
                </div>
                <div className="rounded-md p-1 text-slate-400 group-hover:text-sky-600 dark:group-hover:text-sky-400 transition-colors">
                  <ArrowUpRight size={16} />
                </div>
              </div>
              <div className="mt-3">
                <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 group-hover:text-sky-600 dark:group-hover:text-sky-400 transition-colors">
                  {isEn ? nameEn : name}
                </h3>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400 leading-relaxed line-clamp-2">
                  {isEn ? detailEn : detail}
                </p>
              </div>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
