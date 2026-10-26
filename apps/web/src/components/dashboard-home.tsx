"use client";

import {
  ArrowRight,
  ArrowUpRight,
  BookOpenCheck,
  CalendarDays,
  CheckCircle2,
  Clock,
  Database,
  FileText,
  GraduationCap,
  ListChecks,
  MessageSquareText,
  Play,
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

interface MetricsResult {
  metrics: DashboardMetric[];
  learnerData?: {
    classes: LearningClass[];
    exams: LearnerExamSummary[];
    assignments: Assignment[];
    results: LearnerResult[];
  };
}

// Tải song song bộ KPI phù hợp với từng vai trò người dùng kèm nhãn song ngữ.
async function loadMetrics(roleCode: RoleCode, isEn: boolean): Promise<MetricsResult> {
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
    return {
      metrics: [
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
      ],
    };
  }

  if (roleCode === "CENTER_MANAGER") {
    const [classes, report] = await Promise.all([
      apiRequest<LearningClass[]>("/classes", { roleCode }),
      apiRequest<OperationalReport>("/reports/operations", { roleCode }),
    ]);
    return {
      metrics: [
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
      ],
    };
  }

  if (roleCode === "INSTRUCTOR") {
    const [classes, gradingQueue, sessions] = await Promise.all([
      apiRequest<LearningClass[]>("/instructor/classes", { roleCode }),
      apiRequest<GradingQueueGroup[]>("/instructor/grading-queue", { roleCode }),
      apiRequest<LiveSession[]>("/sessions", { roleCode }),
    ]);
    const now = Date.now();
    return {
      metrics: [
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
      ],
    };
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
  return {
    metrics: [
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
    ],
    learnerData: { classes, exams, assignments, results },
  };
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
  const isLearner = session.roleCode === "LEARNER";
  const [metrics, setMetrics] = useState<DashboardMetric[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [learnerSubTab, setLearnerSubTab] = useState<"live" | "assignments" | "materials" | "lectures">("live");
  const [learnerData, setLearnerData] = useState<{
    classes: LearningClass[];
    exams: LearnerExamSummary[];
    assignments: Assignment[];
    results: LearnerResult[];
  }>({ classes: [], exams: [], assignments: [], results: [] });

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await loadMetrics(session.roleCode, isEn);
      setMetrics(res.metrics);
      if (res.learnerData) {
        setLearnerData(res.learnerData);
      }
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

  const activeClasses = useMemo(
    () => learnerData.classes.filter((item) => item.status === "ACTIVE"),
    [learnerData.classes],
  );
  const pendingAssignments = useMemo(
    () =>
      learnerData.assignments.filter(
        (item) =>
          item.status === "PUBLISHED" &&
          !item.submission &&
          new Date(item.dueAt).getTime() >= Date.now(),
      ),
    [learnerData.assignments],
  );
  const pendingExams = useMemo(
    () =>
      learnerData.exams.filter(
        (item) =>
          item.availabilityStatus === "AVAILABLE" ||
          item.availabilityStatus === "IN_PROGRESS",
      ),
    [learnerData.exams],
  );

  const learnerSubTabs = [
    {
      id: "live" as const,
      label: "Phòng học hôm nay",
      icon: CalendarDays,
      count: activeClasses.length,
    },
    {
      id: "assignments" as const,
      label: "Bài tập chưa làm",
      icon: ListChecks,
      count: pendingAssignments.length + pendingExams.length,
    },
    {
      id: "materials" as const,
      label: "Tài liệu chưa đọc",
      icon: Database,
      count: 12,
    },
    {
      id: "lectures" as const,
      label: "Bài giảng chưa xem",
      icon: BookOpenCheck,
      count: 8,
    },
  ];

  return (
    <div className="w-full px-5 sm:px-6 lg:px-8 py-5 space-y-5">
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

      {isLearner ? (
        /* GIAO DIỆN HỌC SINH 2 CỘT VỚI SIDEBAR CON BÊN TRÁI */
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* CỘT TRÁI: SIDEBAR DỌC 4 CHỨC NĂNG CON */}
          <aside className="lg:col-span-4 xl:col-span-3 space-y-4">
            <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-3 shadow-xs">
              <p className="px-3 py-2 text-[11px] font-extrabold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                Chức năng tổng quan
              </p>
              <div className="space-y-1">
                {learnerSubTabs.map((tab) => {
                  const active = learnerSubTab === tab.id;
                  const Icon = tab.icon;
                  return (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => setLearnerSubTab(tab.id)}
                      className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl text-xs font-bold transition-all text-left ${
                        active
                          ? "bg-blue-600 text-white shadow-xs"
                          : "text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800/60"
                      }`}
                    >
                      <div className="flex items-center gap-2.5">
                        <Icon size={16} className={active ? "text-white" : "text-slate-400"} />
                        <span>{tab.label}</span>
                      </div>
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                          active
                            ? "bg-white/20 text-white"
                            : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400"
                        }`}
                      >
                        {tab.count}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Khung nhắc nhở học tập */}
            <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-gradient-to-br from-sky-50 to-blue-50/50 dark:from-sky-950/20 dark:to-slate-900 p-4 shadow-xs">
              <div className="flex items-center gap-2 text-sky-800 dark:text-sky-300">
                <CheckCircle2 size={16} />
                <p className="text-xs font-bold">Trạng thái học tập</p>
              </div>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 leading-relaxed">
                Đồng bộ tự động theo thời gian thực với các lớp học đã ghi danh.
              </p>
            </div>
          </aside>

          {/* CỘT PHẢI: NỘI DUNG CHI TIẾT THEO TAB CON + KPIS */}
          <div className="lg:col-span-8 xl:col-span-9 space-y-5">
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

            {/* VÙNG NỘI DUNG CON CỦA HỌC SINH THEO SUB-TAB */}
            {learnerSubTab === "live" && (
              <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-5 shadow-xs space-y-4">
                <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
                  <div>
                    <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
                      Phòng học hôm nay
                    </h3>
                    <p className="text-xs text-slate-500">
                      Các buổi học trực tuyến và phòng học đang diễn ra trong ngày.
                    </p>
                  </div>
                  <Link
                    href="/live-classes"
                    className="inline-flex items-center gap-1 text-xs font-bold text-sky-600 dark:text-sky-400 hover:underline"
                  >
                    Xem lịch học online <ArrowRight size={13} />
                  </Link>
                </div>

                {activeClasses.length > 0 ? (
                  <div className="space-y-3">
                    {activeClasses.map((item, index) => (
                      <div
                        key={item.id ?? `class-${index}`}
                        className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 rounded-xl border border-slate-100 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40 hover:border-sky-300 transition-colors"
                      >
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <span className="px-2 py-0.5 rounded bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 text-[10px] font-bold">
                              Lớp trực tuyến
                            </span>
                            <strong className="text-sm font-bold text-slate-900 dark:text-slate-100">
                              {item.name || item.code || "Lớp học trực tuyến"}
                            </strong>
                          </div>
                          <p className="text-xs text-slate-500">
                            Học kỳ: {item.term ?? "Hiện tại"} · Sĩ số: {item.learnerIds?.length ?? 0}/{item.capacity ?? 40} học viên
                          </p>
                        </div>
                        <Link
                          href={`/live-classes`}
                          className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold shadow-xs transition-colors shrink-0"
                        >
                          <Play size={14} />
                          <span>Vào phòng học</span>
                        </Link>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="py-10 text-center space-y-2">
                    <CalendarDays className="mx-auto text-slate-300 dark:text-slate-600" size={36} />
                    <p className="text-sm font-bold text-slate-700 dark:text-slate-300">
                      Hôm nay không có ca học trực tuyến nào
                    </p>
                    <p className="text-xs text-slate-400 max-w-sm mx-auto">
                      Bạn có thể kiểm tra lịch học chi tiết các tuần tiếp theo tại chuyên mục Lịch học.
                    </p>
                    <Link
                      href="/live-classes"
                      className="inline-flex items-center gap-1.5 mt-2 text-xs font-bold text-sky-600 hover:underline"
                    >
                      Mở lịch học trực tuyến <ArrowRight size={13} />
                    </Link>
                  </div>
                )}
              </section>
            )}

            {learnerSubTab === "assignments" && (
              <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-5 shadow-xs space-y-4">
                <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
                  <div>
                    <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
                      Bài tập & Đề thi chưa làm
                    </h3>
                    <p className="text-xs text-slate-500">
                      Danh sách bài tập và đề kiểm tra cần hoàn thành trước thời hạn.
                    </p>
                  </div>
                  <Link
                    href="/exams"
                    className="inline-flex items-center gap-1 text-xs font-bold text-sky-600 dark:text-sky-400 hover:underline"
                  >
                    Xem tất cả đề thi <ArrowRight size={13} />
                  </Link>
                </div>

                {pendingAssignments.length > 0 || pendingExams.length > 0 ? (
                  <div className="space-y-3">
                    {pendingExams.map((exam, index) => (
                      <div
                        key={exam.id ?? `exam-${index}`}
                        className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 rounded-xl border border-slate-100 dark:border-slate-800 bg-amber-50/30 dark:bg-amber-950/20 hover:border-amber-300 transition-colors"
                      >
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <span className="px-2 py-0.5 rounded bg-amber-100 dark:bg-amber-900/50 text-amber-800 dark:text-amber-300 text-[10px] font-bold">
                              Đề thi trắc nghiệm
                            </span>
                            <strong className="text-sm font-bold text-slate-900 dark:text-slate-100">
                              {exam.title}
                            </strong>
                          </div>
                          <p className="text-xs text-slate-500 flex items-center gap-1.5">
                            <Clock size={12} />
                            <span>Thời lượng: {exam.durationMinutes} phút</span>
                            <span>·</span>
                            <span>Hạn chót: {new Date(exam.closeAt).toLocaleDateString()}</span>
                          </p>
                        </div>
                        <Link
                          href="/exams"
                          className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold shadow-xs transition-colors shrink-0"
                        >
                          <Play size={14} />
                          <span>Làm bài ngay</span>
                        </Link>
                      </div>
                    ))}

                    {pendingAssignments.map((assignment, index) => (
                      <div
                        key={assignment.id ?? `assign-${index}`}
                        className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 rounded-xl border border-slate-100 dark:border-slate-800 bg-sky-50/30 dark:bg-sky-950/20 hover:border-sky-300 transition-colors"
                      >
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <span className="px-2 py-0.5 rounded bg-sky-100 dark:bg-sky-900/50 text-sky-800 dark:text-sky-300 text-[10px] font-bold">
                              Bài tập rèn luyện
                            </span>
                            <strong className="text-sm font-bold text-slate-900 dark:text-slate-100">
                              {assignment.title}
                            </strong>
                          </div>
                          <p className="text-xs text-slate-500 flex items-center gap-1.5">
                            <Clock size={12} />
                            <span>Hạn nộp: {new Date(assignment.dueAt).toLocaleDateString()}</span>
                          </p>
                        </div>
                        <Link
                          href="/academic"
                          className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl bg-sky-600 hover:bg-sky-700 text-white text-xs font-bold shadow-xs transition-colors shrink-0"
                        >
                          <FileText size={14} />
                          <span>Xem bài tập</span>
                        </Link>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="py-10 text-center space-y-2">
                    <CheckCircle2 className="mx-auto text-emerald-500" size={36} />
                    <p className="text-sm font-bold text-slate-700 dark:text-slate-300">
                      Tuyệt vời! Bạn đã hoàn thành tất cả bài tập
                    </p>
                    <p className="text-xs text-slate-400">
                      Không còn bài tập hoặc bài kiểm tra nào đang quá hạn.
                    </p>
                  </div>
                )}
              </section>
            )}

            {learnerSubTab === "materials" && (
              <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-5 shadow-xs space-y-4">
                <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
                  <div>
                    <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
                      Tài liệu chưa đọc
                    </h3>
                    <p className="text-xs text-slate-500">
                      Học liệu số, sách điện tử và đề cương được cập nhật mới nhất.
                    </p>
                  </div>
                  <Link
                    href="/materials"
                    className="inline-flex items-center gap-1 text-xs font-bold text-sky-600 dark:text-sky-400 hover:underline"
                  >
                    Xem kho tài liệu <ArrowRight size={13} />
                  </Link>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="p-4 rounded-xl border border-slate-100 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40 hover:border-sky-300 transition-colors space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="px-2 py-0.5 rounded bg-blue-100 dark:bg-blue-950/60 text-blue-800 dark:text-blue-300 text-[10px] font-bold">
                        PDF · Giáo trình
                      </span>
                      <span className="text-[10px] text-slate-400">2.4 MB</span>
                    </div>
                    <strong className="text-xs font-bold text-slate-900 dark:text-slate-100 block">
                      Đề cương ôn tập & Phương pháp giải bài tập trọng tâm
                    </strong>
                    <Link
                      href="/materials"
                      className="inline-flex items-center gap-1 text-xs font-bold text-blue-600 hover:underline pt-1"
                    >
                      Đọc tài liệu <ArrowRight size={12} />
                    </Link>
                  </div>

                  <div className="p-4 rounded-xl border border-slate-100 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40 hover:border-sky-300 transition-colors space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="px-2 py-0.5 rounded bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 text-[10px] font-bold">
                        Slide · Bài giảng
                      </span>
                      <span className="text-[10px] text-slate-400">5.1 MB</span>
                    </div>
                    <strong className="text-xs font-bold text-slate-900 dark:text-slate-100 block">
                      Tập hợp công thức và hệ thống sơ đồ tư duy môn học
                    </strong>
                    <Link
                      href="/materials"
                      className="inline-flex items-center gap-1 text-xs font-bold text-blue-600 hover:underline pt-1"
                    >
                      Đọc tài liệu <ArrowRight size={12} />
                    </Link>
                  </div>
                </div>
              </section>
            )}

            {learnerSubTab === "lectures" && (
              <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-5 shadow-xs space-y-4">
                <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
                  <div>
                    <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
                      Bài giảng chưa xem
                    </h3>
                    <p className="text-xs text-slate-500">
                      Video bài giảng chuyên đề và bài học trực tuyến mới cập nhật.
                    </p>
                  </div>
                  <Link
                    href="/materials"
                    className="inline-flex items-center gap-1 text-xs font-bold text-sky-600 dark:text-sky-400 hover:underline"
                  >
                    Kho bài giảng <ArrowRight size={13} />
                  </Link>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="p-4 rounded-xl border border-slate-100 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40 hover:border-sky-300 transition-colors space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="px-2 py-0.5 rounded bg-purple-100 dark:bg-purple-950/60 text-purple-800 dark:text-purple-300 text-[10px] font-bold">
                        Video · 45 phút
                      </span>
                      <span className="text-[10px] text-slate-400">HD 1080p</span>
                    </div>
                    <strong className="text-xs font-bold text-slate-900 dark:text-slate-100 block">
                      Bài giảng chuyên đề: Phân tích kỹ thuật giải bài toán nâng cao
                    </strong>
                    <Link
                      href="/materials"
                      className="inline-flex items-center gap-1.5 text-xs font-bold text-purple-600 hover:underline pt-1"
                    >
                      <Play size={12} />
                      <span>Xem bài giảng</span>
                    </Link>
                  </div>

                  <div className="p-4 rounded-xl border border-slate-100 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40 hover:border-sky-300 transition-colors space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="px-2 py-0.5 rounded bg-purple-100 dark:bg-purple-950/60 text-purple-800 dark:text-purple-300 text-[10px] font-bold">
                        Video · 35 phút
                      </span>
                      <span className="text-[10px] text-slate-400">HD 1080p</span>
                    </div>
                    <strong className="text-xs font-bold text-slate-900 dark:text-slate-100 block">
                      Ôn tập chuyên đề và giải đáp các lỗi sai thường gặp
                    </strong>
                    <Link
                      href="/materials"
                      className="inline-flex items-center gap-1.5 text-xs font-bold text-purple-600 hover:underline pt-1"
                    >
                      <Play size={12} />
                      <span>Xem bài giảng</span>
                    </Link>
                  </div>
                </div>
              </section>
            )}

            {/* Feature Modules Grid */}
            <section className="space-y-4 pt-2">
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
        </div>
      ) : (
        /* GIAO DIỆN CHUNG CHO CÁC VAI TRÒ KHÁC */
        <>
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
        </>
      )}
    </div>
  );
}
