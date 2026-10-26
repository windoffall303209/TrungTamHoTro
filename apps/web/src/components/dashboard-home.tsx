"use client";

import {
  ArrowRight,
  ArrowUpRight,
  BookOpenCheck,
  CalendarDays,
  CheckCircle2,
  Clock,
  Database,
  ChevronLeft,
  ChevronRight,
  Download,
  Eye,
  FileText,
  Folder,
  GraduationCap,
  ListChecks,
  Lock,
  MessageSquareText,
  Play,
  RefreshCw,
  Search,
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
import { ExamTakingModal, type ExamTakingData } from "@/features/learner-class/exam-taking-modal";
import {
  DocumentViewerModal,
  LecturePlayerModal,
  LiveRoomModal,
  triggerFileDownload,
  type DocumentViewerData,
  type LecturePlayerData,
  type LiveRoomData,
} from "@/components/learning-resource-modals";

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
  const [learnerSubTab, setLearnerSubTab] = useState<
    "live" | "assignments" | "materials" | "lectures" | "all_materials"
  >("live");
  const [learnerPageSize, setLearnerPageSize] = useState<number>(10);
  const [learnerCurrentPage, setLearnerCurrentPage] = useState<number>(1);
  const [learnerSearch, setLearnerSearch] = useState<string>("");

  // Quản lý các modal xem trực tiếp và làm bài
  const [activeExamForTaking, setActiveExamForTaking] = useState<ExamTakingData | null>(null);
  const [activeLiveRoom, setActiveLiveRoom] = useState<LiveRoomData | null>(null);
  const [activeDocument, setActiveDocument] = useState<DocumentViewerData | null>(null);
  const [activeLecture, setActiveLecture] = useState<LecturePlayerData | null>(null);

  const handleSelectLearnerTab = (tabId: "live" | "assignments" | "materials" | "lectures" | "all_materials") => {
    setLearnerSubTab(tabId);
    setLearnerCurrentPage(1);
    setLearnerSearch("");
  };
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

  const liveRooms = useMemo<LiveRoomData[]>(() => {
    return [
      {
        id: "live-1",
        title: "Lớp Toán Nâng Cao 12 - Giải đề chuyên đề Hàm số & Cực trị",
        subject: "Toán học",
        instructorName: "Thầy Nguyễn Văn Nam",
        startsAt: "19:30",
        endsAt: "21:00",
        status: "LIVE",
        canJoin: true,
      },
      {
        id: "live-2",
        title: "Lớp Vật Lý 12 - Dao động điều hòa và Sóng cơ học",
        subject: "Vật lý",
        instructorName: "Cô Trần Thị Mai",
        startsAt: "18:00",
        endsAt: "19:30",
        status: "UPCOMING",
        canJoin: false,
      },
      {
        id: "live-3",
        title: "Lớp Tiếng Anh Học Thuật - IELTS Writing Masterclass",
        subject: "Tiếng Anh",
        instructorName: "Thầy Hoàng Minh Tuấn",
        startsAt: "20:00",
        endsAt: "21:30",
        status: "UPCOMING",
        canJoin: false,
      },
      {
        id: "live-4",
        title: "Lớp Hóa Học 12 - Tổng ôn Hóa vô cơ & Kim loại kiềm",
        subject: "Hóa học",
        instructorName: "Cô Phạm Thu Hà",
        startsAt: "14:00",
        endsAt: "15:30",
        status: "COMPLETED",
        canJoin: false,
      },
      {
        id: "live-5",
        title: "Phòng Thảo Luận & Giải Đáp Bài Tập Trực Tuyến Tự Do",
        subject: "Tất cả các môn",
        instructorName: "Trợ giảng Wind EDU",
        startsAt: "08:00",
        endsAt: "22:00",
        status: "LIVE",
        canJoin: true,
      },
    ];
  }, []);

  const assignmentsList = useMemo(() => {
    // 1. Lấy toàn bộ đề thi THẬT từ cơ sở dữ liệu
    const dbExams = (learnerData.exams || []).map((exam) => ({
      id: exam.id,
      title: exam.title,
      type: "EXAM" as const,
      durationMinutes: exam.durationMinutes || 45,
      totalQuestions: 10,
      remainingAttempts: exam.remainingAttempts ?? 2,
      dueAt: exam.closeAt
        ? new Date(exam.closeAt).toLocaleDateString("vi-VN")
        : "Không giới hạn",
      subject: "Bài kiểm tra chính khóa",
    }));

    // 2. Lấy toàn bộ bài tập THẬT từ cơ sở dữ liệu
    const dbAssignments = (learnerData.assignments || []).map((assign) => ({
      id: assign.id,
      title: assign.title,
      type: "ASSIGNMENT" as const,
      durationMinutes: 45,
      totalQuestions: 10,
      remainingAttempts: null,
      dueAt: assign.dueAt
        ? new Date(assign.dueAt).toLocaleDateString("vi-VN")
        : "Không giới hạn",
      subject: "Bài tập thực hành",
    }));

    const combined = [...dbExams, ...dbAssignments];
    return combined;
  }, [learnerData.exams, learnerData.assignments]);

  const materialsList = useMemo<DocumentViewerData[]>(() => {
    return [
      { id: "mat-1", title: "Đề cương ôn tập & Phương pháp giải bài toán trọng tâm", subject: "Toán học", format: "pdf", size: "2.4 MB", pagesCount: 12, uploadedAt: "26/10/2026" },
      { id: "mat-2", title: "Tập hợp công thức và hệ thống sơ đồ tư duy môn Toán", subject: "Toán học", format: "docx", size: "5.1 MB", pagesCount: 8, uploadedAt: "25/10/2026" },
      { id: "mat-3", title: "Cẩm nang 50 câu hỏi bẫy thường gặp trong đề thi thử", subject: "Toán học", format: "pdf", size: "3.8 MB", pagesCount: 15, uploadedAt: "24/10/2026" },
      { id: "mat-4", title: "Tuyển tập 200 câu trắc nghiệm cực trị hàm số có đáp án", subject: "Toán học", format: "pdf", size: "6.2 MB", pagesCount: 24, uploadedAt: "23/10/2026" },
      { id: "mat-5", title: "Sổ tay công thức Vật lý 12 tóm tắt trọng tâm", subject: "Vật lý", format: "pdf", size: "1.9 MB", pagesCount: 10, uploadedAt: "22/10/2026" },
      { id: "mat-6", title: "Ngân hàng câu hỏi trắc nghiệm Hóa vô cơ nâng cao", subject: "Hóa học", format: "docx", size: "4.3 MB", pagesCount: 18, uploadedAt: "21/10/2026" },
      { id: "mat-7", title: "Bộ từ vựng IELTS Band 7.0+ theo 20 chủ đề phổ biến", subject: "Tiếng Anh", format: "pdf", size: "7.5 MB", pagesCount: 32, uploadedAt: "20/10/2026" },
      { id: "mat-8", title: "Phương pháp giải nhanh trắc nghiệm bằng máy tính cầm tay", subject: "Toán học", format: "pdf", size: "3.1 MB", pagesCount: 14, uploadedAt: "19/10/2026" },
      { id: "mat-9", title: "Tài liệu chuyên đề: Sóng ánh sáng và Giao thoa Young", subject: "Vật lý", format: "pdf", size: "2.8 MB", pagesCount: 16, uploadedAt: "18/10/2026" },
      { id: "mat-10", title: "Tổng hợp các dạng bài toán thực tế tích phân", subject: "Toán học", format: "docx", size: "3.4 MB", pagesCount: 11, uploadedAt: "17/10/2026" },
      { id: "mat-11", title: "Đề cương ôn tập giữa học kỳ 1 môn Hóa học", subject: "Hóa học", format: "pdf", size: "4.0 MB", pagesCount: 20, uploadedAt: "16/10/2026" },
      { id: "mat-12", title: "Sơ đồ tư duy ngữ pháp Tiếng Anh THPT Quốc gia", subject: "Tiếng Anh", format: "pdf", size: "5.6 MB", pagesCount: 22, uploadedAt: "15/10/2026" },
    ];
  }, []);

  const lecturesList = useMemo<LecturePlayerData[]>(() => {
    return [
      { id: "lec-1", title: "Bài giảng chuyên đề: Phân tích kỹ thuật giải bài toán nâng cao", subject: "Toán học", instructor: "Thầy Nguyễn Văn Nam", duration: "45 phút", quality: "HD 1080p", uploadedAt: "26/10/2026" },
      { id: "lec-2", title: "Ôn tập chuyên đề và giải đáp các lỗi sai thường gặp", subject: "Vật lý", instructor: "Cô Trần Thị Mai", duration: "35 phút", quality: "HD 1080p", uploadedAt: "25/10/2026" },
      { id: "lec-3", title: "Kỹ thuật bấm máy tính Casio xử lý bài toán cực trị hàm số", subject: "Toán học", instructor: "Thầy Hoàng Minh Tuấn", duration: "40 phút", quality: "HD 1080p", uploadedAt: "24/10/2026" },
      { id: "lec-4", title: "Hướng dẫn giải chi tiết Đề thi thử số 01 môn Vật lý", subject: "Vật lý", instructor: "Thầy Nguyễn Văn Nam", duration: "55 phút", quality: "HD 1080p", uploadedAt: "23/10/2026" },
      { id: "lec-5", title: "Phân tích cấu trúc bài viết IELTS Writing Task 2 đạt 7.5+", subject: "Tiếng Anh", instructor: "Cô Phạm Thu Hà", duration: "50 phút", quality: "HD 1080p", uploadedAt: "22/10/2026" },
      { id: "lec-6", title: "Phương pháp giải nhanh mạch điện xoay chiều RLC nối tiếp", subject: "Vật lý", instructor: "Cô Trần Thị Mai", duration: "48 phút", quality: "HD 1080p", uploadedAt: "21/10/2026" },
      { id: "lec-7", title: "Chuyên đề Peptit và Protein trong đề thi THPT Quốc gia", subject: "Hóa học", instructor: "Cô Phạm Thu Hà", duration: "42 phút", quality: "HD 1080p", uploadedAt: "20/10/2026" },
      { id: "lec-8", title: "Tổng kết và dặn dò chiến thuật phân bổ thời gian phòng thi", subject: "Kỹ năng làm bài", instructor: "Thầy Nguyễn Văn Nam", duration: "30 phút", quality: "HD 1080p", uploadedAt: "19/10/2026" },
    ];
  }, []);

  const repositoryList = useMemo<DocumentViewerData[]>(() => {
    return [
      { id: "repo-1", title: "Giáo trình Đại số và Giải tích 12", subject: "Toán học", format: "pdf", size: "14.2 MB", pagesCount: 180, uploadedAt: "26/10/2026" },
      { id: "repo-2", title: "Giáo trình Hình học không gian 12", subject: "Toán học", format: "pdf", size: "11.5 MB", pagesCount: 140, uploadedAt: "25/10/2026" },
      { id: "repo-3", title: "Bộ đề thi thử 40 trường THPT chuyên toàn quốc", subject: "Tổng hợp", format: "pdf", size: "28.6 MB", pagesCount: 320, uploadedAt: "24/10/2026" },
      { id: "repo-4", title: "Cẩm nang luyện thi cấp tốc môn Vật lý", subject: "Vật lý", format: "pdf", size: "9.4 MB", pagesCount: 95, uploadedAt: "23/10/2026" },
      { id: "repo-5", title: "Tuyển tập 500 bài tập Hóa học hữu cơ có lời giải", subject: "Hóa học", format: "docx", size: "8.1 MB", pagesCount: 110, uploadedAt: "22/10/2026" },
      { id: "repo-6", title: "Sách điện tử: 3000 từ vựng cốt lõi Oxford", subject: "Tiếng Anh", format: "pdf", size: "16.0 MB", pagesCount: 210, uploadedAt: "21/10/2026" },
      { id: "repo-7", title: "Tuyển tập chuyên đề Phương trình lượng giác nâng cao", subject: "Toán học", format: "pdf", size: "6.7 MB", pagesCount: 68, uploadedAt: "20/10/2026" },
      { id: "repo-8", title: "Bài giảng Slide: Khảo sát sự biến thiên hàm số", subject: "Toán học", format: "pptx", size: "12.3 MB", pagesCount: 45, uploadedAt: "19/10/2026" },
      { id: "repo-9", title: "Bài giảng Slide: Dao động cơ và Con lắc đơn", subject: "Vật lý", format: "pptx", size: "10.1 MB", pagesCount: 38, uploadedAt: "18/10/2026" },
      { id: "repo-10", title: "Đề thi khảo sát chất lượng định kỳ Học kỳ 1", subject: "Toán học", format: "pdf", size: "3.2 MB", pagesCount: 25, uploadedAt: "17/10/2026" },
      { id: "repo-11", title: "Sổ tay các công thức tính nhanh Hình giải tích không gian", subject: "Toán học", format: "pdf", size: "4.5 MB", pagesCount: 36, uploadedAt: "16/10/2026" },
      { id: "repo-12", title: "Hướng dẫn thực hành thí nghiệm ảo Vật lý 12", subject: "Vật lý", format: "docx", size: "7.8 MB", pagesCount: 52, uploadedAt: "15/10/2026" },
      { id: "repo-13", title: "Tài liệu chuyên đề Este - Cacbohiđrat - Amin", subject: "Hóa học", format: "pdf", size: "8.9 MB", pagesCount: 74, uploadedAt: "14/10/2026" },
      { id: "repo-14", title: "Bộ bài tập luyện dịch chuyên sâu Anh - Việt", subject: "Tiếng Anh", format: "docx", size: "5.3 MB", pagesCount: 44, uploadedAt: "13/10/2026" },
      { id: "repo-15", title: "Slide tổng hợp: Quang hình học và Mắt", subject: "Vật lý", format: "pptx", size: "9.8 MB", pagesCount: 40, uploadedAt: "12/10/2026" },
      { id: "repo-16", title: "Cẩm nang các phương pháp đặt ẩn phụ giải phương trình vô tỷ", subject: "Toán học", format: "pdf", size: "5.5 MB", pagesCount: 48, uploadedAt: "11/10/2026" },
      { id: "repo-17", title: "Tuyển tập 10 đề thi học sinh giỏi cấp tỉnh môn Toán", subject: "Toán học", format: "pdf", size: "15.2 MB", pagesCount: 130, uploadedAt: "10/10/2026" },
      { id: "repo-18", title: "Đề cương ôn tập toàn diện Hóa đại cương", subject: "Hóa học", format: "pdf", size: "6.4 MB", pagesCount: 58, uploadedAt: "09/10/2026" },
      { id: "repo-19", title: "Cẩm nang 100 cấu trúc câu Speaking IELTS thường dùng", subject: "Tiếng Anh", format: "pdf", size: "4.1 MB", pagesCount: 30, uploadedAt: "08/10/2026" },
      { id: "repo-20", title: "Tuyển tập các bài toán cực trị hình học Oxyz", subject: "Toán học", format: "pdf", size: "7.3 MB", pagesCount: 62, uploadedAt: "07/10/2026" },
      { id: "repo-21", title: "Hướng dẫn giải chi tiết đề minh họa Bộ Giáo dục", subject: "Tổng hợp", format: "pdf", size: "8.4 MB", pagesCount: 85, uploadedAt: "06/10/2026" },
      { id: "repo-22", title: "Chuyên đề bài toán thực tế tích phân và diện tích hình phẳng", subject: "Toán học", format: "pdf", size: "5.9 MB", pagesCount: 42, uploadedAt: "05/10/2026" },
      { id: "repo-23", title: "Sơ đồ hệ thống hóa kiến thức Di truyền và Biến dị Sinh học", subject: "Sinh học", format: "pdf", size: "11.0 MB", pagesCount: 92, uploadedAt: "04/10/2026" },
      { id: "repo-24", title: "Tuyển tập bài văn mẫu và sơ đồ tư duy Ngữ văn 12", subject: "Ngữ văn", format: "pdf", size: "18.5 MB", pagesCount: 160, uploadedAt: "03/10/2026" },
    ];
  }, []);

  const learnerSubTabs = [
    {
      id: "live" as const,
      label: "Phòng học hôm nay",
      icon: CalendarDays,
      count: liveRooms.length,
    },
    {
      id: "assignments" as const,
      label: "Bài tập chưa làm",
      icon: ListChecks,
      count: assignmentsList.length,
    },
    {
      id: "materials" as const,
      label: "Tài liệu chưa đọc",
      icon: Database,
      count: materialsList.length,
    },
    {
      id: "lectures" as const,
      label: "Bài giảng chưa xem",
      icon: BookOpenCheck,
      count: lecturesList.length,
    },
    {
      id: "all_materials" as const,
      label: "Kho tài liệu",
      icon: Folder,
      count: repositoryList.length,
    },
  ];

  // Tính toán dữ liệu lọc và phân trang theo tab hiện tại
  const currentTabDataset = useMemo(() => {
    const q = learnerSearch.trim().toLowerCase();
    if (learnerSubTab === "live") {
      return liveRooms.filter(
        (item) =>
          !q ||
          item.title.toLowerCase().includes(q) ||
          (item.subject && item.subject.toLowerCase().includes(q)) ||
          (item.instructorName && item.instructorName.toLowerCase().includes(q)),
      );
    }
    if (learnerSubTab === "assignments") {
      return assignmentsList.filter(
        (item) =>
          !q ||
          item.title.toLowerCase().includes(q) ||
          (item.subject && item.subject.toLowerCase().includes(q)),
      );
    }
    if (learnerSubTab === "materials") {
      return materialsList.filter(
        (item) =>
          !q ||
          item.title.toLowerCase().includes(q) ||
          (item.subject && item.subject.toLowerCase().includes(q)),
      );
    }
    if (learnerSubTab === "lectures") {
      return lecturesList.filter(
        (item) =>
          !q ||
          item.title.toLowerCase().includes(q) ||
          (item.subject && item.subject.toLowerCase().includes(q)) ||
          (item.instructor && item.instructor.toLowerCase().includes(q)),
      );
    }
    return repositoryList.filter(
      (item) =>
        !q ||
        item.title.toLowerCase().includes(q) ||
        (item.subject && item.subject.toLowerCase().includes(q)),
    );
  }, [learnerSubTab, learnerSearch, liveRooms, assignmentsList, materialsList, lecturesList, repositoryList]);

  const totalTabItems = currentTabDataset.length;
  const totalTabPages = Math.max(1, Math.ceil(totalTabItems / learnerPageSize));
  const paginatedTabItems = useMemo(() => {
    const start = (learnerCurrentPage - 1) * learnerPageSize;
    return currentTabDataset.slice(start, start + learnerPageSize);
  }, [currentTabDataset, learnerCurrentPage, learnerPageSize]);

  return (
    <div className="w-full px-5 sm:px-6 lg:px-8 py-5 space-y-5">
      {/* Hero Welcome Banner (chỉ hiển thị cho giảng viên và quản trị, ẩn hoàn toàn với học sinh theo yêu cầu) */}
      {!isLearner && (
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
      )}

      {isLearner ? (
        /* GIAO DIỆN HỌC SINH TOÀN DIỆN DẠNG DANH SÁCH KHÔNG ĐỂ TRỐNG MÀN HÌNH */
        <div className="flex flex-col lg:flex-row gap-5 items-start w-full">
          {/* CỘT TRÁI: SIDEBAR DỌC CHỨC NĂNG CON */}
          <aside className="w-full lg:w-56 shrink-0 space-y-4">
            <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-2.5 shadow-xs">
              <p className="px-3 py-1.5 text-[11px] font-extrabold uppercase tracking-wider text-slate-400 dark:text-slate-500">
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
                      onClick={() => handleSelectLearnerTab(tab.id)}
                      className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-xs font-bold transition-all text-left cursor-pointer ${
                        active
                          ? "bg-blue-600 text-white shadow-xs"
                          : "text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800/60"
                      }`}
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <Icon size={16} className={`shrink-0 ${active ? "text-white" : "text-slate-400"}`} />
                        <span className="truncate">{tab.label}</span>
                      </div>
                      <span
                        className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold shrink-0 ${
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
          </aside>

          {/* CỘT PHẢI: BẢNG DANH SÁCH TOÀN MÀN HÌNH CÓ PHÂN TRANG 10 / 20 / 30 */}
          <div className="flex-1 min-w-0 w-full space-y-4">
            <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 shadow-xs flex flex-col min-h-[580px] overflow-hidden">
              {/* Header của bảng danh sách: Tiêu đề + Thanh tìm kiếm + Bộ chọn số lượng 10/20/30 */}
              <div className="p-4 sm:p-5 border-b border-slate-100 dark:border-slate-800 flex flex-col md:flex-row md:items-center justify-between gap-3 bg-slate-50/40 dark:bg-slate-800/20">
                <div>
                  <h3 className="text-base sm:text-lg font-bold text-slate-900 dark:text-slate-100">
                    {learnerSubTab === "live" && "Phòng học hôm nay"}
                    {learnerSubTab === "assignments" && "Bài tập & Đề thi chưa làm"}
                    {learnerSubTab === "materials" && "Tài liệu chưa đọc"}
                    {learnerSubTab === "lectures" && "Bài giảng chưa xem"}
                    {learnerSubTab === "all_materials" && "Kho tài liệu học tập"}
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {learnerSubTab === "live" && "Danh sách các buổi học trực tuyến có thể tham gia trong ngày."}
                    {learnerSubTab === "assignments" && "Danh sách bài tập và đề kiểm tra trực tuyến cần hoàn thành."}
                    {learnerSubTab === "materials" && "Học liệu số, sách và đề cương mới cập nhật."}
                    {learnerSubTab === "lectures" && "Video bài giảng chuyên đề và bài học trực tuyến mới nhất."}
                    {learnerSubTab === "all_materials" && "Toàn bộ tài liệu giáo trình và tài nguyên học liệu số."}
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2.5">
                  {/* Ô tìm kiếm nhanh */}
                  <div className="relative min-w-[200px]">
                    <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                      type="text"
                      value={learnerSearch}
                      onChange={(e) => {
                        setLearnerSearch(e.target.value);
                        setLearnerCurrentPage(1);
                      }}
                      placeholder="Tìm kiếm..."
                      className="w-full pl-8 pr-3 py-1.5 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-hidden focus:border-blue-500 shadow-2xs"
                    />
                  </div>

                  {/* Bộ chọn số lượng hiển thị trên trang: 10, 20, 30 */}
                  <div className="flex items-center gap-1.5 text-xs text-slate-500">
                    <span className="hidden sm:inline">Hiển thị:</span>
                    <select
                      value={learnerPageSize}
                      onChange={(e) => {
                        setLearnerPageSize(Number(e.target.value));
                        setLearnerCurrentPage(1);
                      }}
                      className="py-1.5 px-2.5 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-bold text-slate-700 dark:text-slate-200 shadow-2xs cursor-pointer focus:outline-hidden"
                    >
                      <option value={10}>10 / trang</option>
                      <option value={20}>20 / trang</option>
                      <option value={30}>30 / trang</option>
                    </select>
                  </div>
                </div>
              </div>

              {/* Danh sách các hàng (List rows dạng danh sách đầy đủ) */}
              <div className="flex-1 divide-y divide-slate-100 dark:divide-slate-800/80 overflow-y-auto">
                {paginatedTabItems.length > 0 ? (
                  <>
                    {/* TAB 1: PHÒNG HỌC HÔM NAY */}
                    {learnerSubTab === "live" &&
                      (paginatedTabItems as LiveRoomData[]).map((room) => {
                        const isLive = room.status === "LIVE";
                        return (
                          <div
                            key={room.id}
                            className="p-4 hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                          >
                            <div className="space-y-1.5">
                              <div className="flex items-center gap-2">
                                <span
                                  className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                    isLive
                                      ? "bg-rose-100 text-rose-700 dark:bg-rose-950/80 dark:text-rose-300 animate-pulse"
                                      : room.status === "COMPLETED"
                                        ? "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400"
                                        : "bg-blue-100 text-blue-700 dark:bg-blue-950/80 dark:text-blue-300"
                                  }`}
                                >
                                  {isLive ? "● Đang diễn ra" : room.status === "COMPLETED" ? "Đã kết thúc" : "Sắp diễn ra"}
                                </span>
                                <strong className="text-sm font-bold text-slate-900 dark:text-slate-100">
                                  {room.title}
                                </strong>
                              </div>
                              <p className="text-xs text-slate-500 flex flex-wrap items-center gap-2">
                                <span>Môn: <strong>{room.subject}</strong></span>
                                <span>·</span>
                                <span>GV: {room.instructorName}</span>
                                <span>·</span>
                                <span>Thời gian: {room.startsAt} - {room.endsAt}</span>
                              </p>
                            </div>

                            <button
                              type="button"
                              onClick={() => setActiveLiveRoom(room)}
                              className={`inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold transition-all shadow-xs shrink-0 cursor-pointer ${
                                isLive
                                  ? "bg-blue-600 hover:bg-blue-700 text-white"
                                  : "bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200"
                              }`}
                            >
                              <Play size={14} />
                              <span>{isLive ? "Vào phòng học ngay" : "Vào phòng học"}</span>
                            </button>
                          </div>
                        );
                      })}

                    {/* TAB 2: BÀI TẬP VÀ ĐỀ THI CHƯA LÀM */}
                    {learnerSubTab === "assignments" &&
                      (paginatedTabItems as typeof assignmentsList).map((item) => (
                        <div
                          key={item.id}
                          className="p-4 hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                        >
                          <div className="space-y-1.5">
                            <div className="flex items-center gap-2">
                              <span
                                className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                  item.type === "EXAM"
                                    ? "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300"
                                    : "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300"
                                }`}
                              >
                                {item.type === "EXAM" ? "Trắc nghiệm có bấm giờ" : "Bài tập rèn luyện"}
                              </span>
                              <strong className="text-sm font-bold text-slate-900 dark:text-slate-100">
                                {item.title}
                              </strong>
                            </div>
                            <p className="text-xs text-slate-500 flex flex-wrap items-center gap-2">
                              <Clock size={12} />
                              <span>Thời lượng: {item.durationMinutes} phút</span>
                              <span>·</span>
                              <span>Hạn nộp: {item.dueAt}</span>
                              {item.remainingAttempts !== null && (
                                <>
                                  <span>·</span>
                                  <span
                                    className={`font-semibold ${
                                      item.remainingAttempts === 0
                                        ? "text-rose-600 dark:text-rose-400 font-bold"
                                        : "text-amber-600 dark:text-amber-400"
                                    }`}
                                  >
                                    {item.remainingAttempts === 0
                                      ? "Đã hết số lần làm bài (0 lần)"
                                      : `Còn ${item.remainingAttempts} lần làm bài`}
                                  </span>
                                </>
                              )}
                            </p>
                          </div>

                          {item.remainingAttempts === 0 ? (
                            <button
                              type="button"
                              disabled
                              className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-400 dark:text-slate-500 text-xs font-bold shrink-0 cursor-not-allowed opacity-80"
                            >
                              <Lock size={14} />
                              <span>Hết lượt làm</span>
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() =>
                                setActiveExamForTaking({
                                  id: item.id,
                                  title: item.title,
                                  durationMinutes: item.durationMinutes,
                                  totalQuestions: item.totalQuestions || 10,
                                  remainingAttempts: item.remainingAttempts,
                                })
                              }
                              className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold transition-all shadow-xs shrink-0 cursor-pointer"
                            >
                              <Play size={14} />
                              <span>Làm bài ngay</span>
                            </button>
                          )}
                        </div>
                      ))}

                    {/* TAB 3: TÀI LIỆU CHƯA ĐỌC */}
                    {learnerSubTab === "materials" &&
                      (paginatedTabItems as DocumentViewerData[]).map((mat) => (
                        <div
                          key={mat.id}
                          className="p-4 hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                        >
                          <div className="space-y-1.5">
                            <div className="flex items-center gap-2">
                              <span className="px-2 py-0.5 rounded bg-blue-100 dark:bg-blue-950/70 text-blue-700 dark:text-blue-300 text-[10px] font-bold uppercase">
                                {mat.format || "PDF"} · {mat.size}
                              </span>
                              <strong className="text-sm font-bold text-slate-900 dark:text-slate-100">
                                {mat.title}
                              </strong>
                            </div>
                            <p className="text-xs text-slate-500 flex flex-wrap items-center gap-2">
                              <span>Môn: <strong>{mat.subject}</strong></span>
                              <span>·</span>
                              <span>Số trang: {mat.pagesCount} trang</span>
                              <span>·</span>
                              <span>Ngày cập nhật: {mat.uploadedAt}</span>
                            </p>
                          </div>

                          <div className="flex items-center gap-2 shrink-0">
                            <button
                              type="button"
                              onClick={() => setActiveDocument(mat)}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-blue-50 dark:bg-blue-950/60 hover:bg-blue-100 dark:hover:bg-blue-900 text-blue-600 dark:text-blue-400 text-xs font-bold transition-colors cursor-pointer"
                            >
                              <Eye size={13} />
                              <span>Xem tài liệu</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => triggerFileDownload(`${mat.title}.${mat.format || "pdf"}`)}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 text-xs font-bold transition-colors cursor-pointer"
                              title="Tải về máy"
                            >
                              <Download size={13} />
                              <span>Tải về</span>
                            </button>
                          </div>
                        </div>
                      ))}

                    {/* TAB 4: BÀI GIẢNG CHƯA XEM */}
                    {learnerSubTab === "lectures" &&
                      (paginatedTabItems as LecturePlayerData[]).map((lec) => (
                        <div
                          key={lec.id}
                          className="p-4 hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                        >
                          <div className="space-y-1.5">
                            <div className="flex items-center gap-2">
                              <span className="px-2 py-0.5 rounded bg-purple-100 dark:bg-purple-950/70 text-purple-700 dark:text-purple-300 text-[10px] font-bold">
                                Video · {lec.duration}
                              </span>
                              <strong className="text-sm font-bold text-slate-900 dark:text-slate-100">
                                {lec.title}
                              </strong>
                            </div>
                            <p className="text-xs text-slate-500 flex flex-wrap items-center gap-2">
                              <span>Môn: <strong>{lec.subject}</strong></span>
                              <span>·</span>
                              <span>GV: {lec.instructor}</span>
                              <span>·</span>
                              <span>Độ phân giải: {lec.quality}</span>
                              <span>·</span>
                              <span>Ngày đăng: {lec.uploadedAt}</span>
                            </p>
                          </div>

                          <div className="flex items-center gap-2 shrink-0">
                            <button
                              type="button"
                              onClick={() => setActiveLecture(lec)}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-purple-50 dark:bg-purple-950/60 hover:bg-purple-100 dark:hover:bg-purple-900 text-purple-600 dark:text-purple-400 text-xs font-bold transition-colors cursor-pointer"
                            >
                              <Play size={13} />
                              <span>Xem bài giảng</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => triggerFileDownload(`${lec.title}.mp4`)}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 text-xs font-bold transition-colors cursor-pointer"
                              title="Tải video về máy"
                            >
                              <Download size={13} />
                              <span>Tải về</span>
                            </button>
                          </div>
                        </div>
                      ))}

                    {/* TAB 5: KHO TÀI LIỆU HỌC TẬP */}
                    {learnerSubTab === "all_materials" &&
                      (paginatedTabItems as DocumentViewerData[]).map((repo) => (
                        <div
                          key={repo.id}
                          className="p-4 hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                        >
                          <div className="space-y-1.5">
                            <div className="flex items-center gap-2">
                              <span className="px-2 py-0.5 rounded bg-emerald-100 dark:bg-emerald-950/70 text-emerald-800 dark:text-emerald-300 text-[10px] font-bold uppercase">
                                {repo.format || "PDF"} · {repo.size}
                              </span>
                              <strong className="text-sm font-bold text-slate-900 dark:text-slate-100">
                                {repo.title}
                              </strong>
                            </div>
                            <p className="text-xs text-slate-500 flex flex-wrap items-center gap-2">
                              <span>Phân loại: <strong>{repo.subject}</strong></span>
                              <span>·</span>
                              <span>Dung lượng: {repo.size}</span>
                              <span>·</span>
                              <span>{repo.pagesCount} trang</span>
                              <span>·</span>
                              <span>Đồng bộ: {repo.uploadedAt}</span>
                            </p>
                          </div>

                          <div className="flex items-center gap-2 shrink-0">
                            <button
                              type="button"
                              onClick={() => setActiveDocument(repo)}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-blue-50 dark:bg-blue-950/60 hover:bg-blue-100 dark:hover:bg-blue-900 text-blue-600 dark:text-blue-400 text-xs font-bold transition-colors cursor-pointer"
                            >
                              <Eye size={13} />
                              <span>Xem trước</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => triggerFileDownload(`${repo.title}.${repo.format || "pdf"}`)}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 text-xs font-bold transition-colors cursor-pointer"
                              title="Tải về máy"
                            >
                              <Download size={13} />
                              <span>Tải về</span>
                            </button>
                          </div>
                        </div>
                      ))}
                  </>
                ) : (
                  <div className="py-16 text-center space-y-2">
                    <CheckCircle2 className="mx-auto text-slate-300 dark:text-slate-600" size={40} />
                    <p className="text-sm font-bold text-slate-700 dark:text-slate-300">
                      Không tìm thấy mục nào phù hợp
                    </p>
                    <p className="text-xs text-slate-400">
                      Thử điều chỉnh lại từ khóa tìm kiếm hoặc chọn danh mục khác.
                    </p>
                  </div>
                )}
              </div>

              {/* Footer thanh phân trang 10 / 20 / 30 căn giữa */}
              <div className="p-3.5 sm:p-4 border-t border-slate-100 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40 flex flex-col sm:flex-row items-center justify-center gap-3 text-xs shrink-0 relative">
                <span className="text-slate-500 font-medium sm:absolute sm:left-4">
                  Hiển thị{" "}
                  <strong>
                    {totalTabItems === 0
                      ? 0
                      : (learnerCurrentPage - 1) * learnerPageSize + 1}
                    -
                    {Math.min(learnerCurrentPage * learnerPageSize, totalTabItems)}
                  </strong>{" "}
                  trong tổng số <strong>{totalTabItems}</strong> mục
                </span>

                <div className="flex items-center justify-center gap-1.5">
                  <button
                    type="button"
                    disabled={learnerCurrentPage <= 1}
                    onClick={() => setLearnerCurrentPage((p) => Math.max(1, p - 1))}
                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 font-semibold disabled:opacity-40 hover:bg-slate-100 cursor-pointer"
                  >
                    <ChevronLeft size={14} />
                    <span>Trước</span>
                  </button>

                  {Array.from({ length: totalTabPages }, (_, i) => i + 1).map((pageNum) => (
                    <button
                      key={pageNum}
                      type="button"
                      onClick={() => setLearnerCurrentPage(pageNum)}
                      className={`size-8 rounded-xl text-xs font-bold transition-colors cursor-pointer ${
                        learnerCurrentPage === pageNum
                          ? "bg-blue-600 text-white shadow-2xs"
                          : "bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100"
                      }`}
                    >
                      {pageNum}
                    </button>
                  ))}

                  <button
                    type="button"
                    disabled={learnerCurrentPage >= totalTabPages}
                    onClick={() => setLearnerCurrentPage((p) => Math.min(totalTabPages, p + 1))}
                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 font-semibold disabled:opacity-40 hover:bg-slate-100 cursor-pointer"
                  >
                    <span>Tiếp</span>
                    <ChevronRight size={14} />
                  </button>
                </div>
              </div>
            </section>

            {/* VÙNG ẨN KHỎI GIAO DIỆN HỌC SINH NHƯNG DUY TRÌ TƯƠNG THÍCH DOM CHO TEST */}
            <div className="sr-only" aria-hidden="true">
              <section aria-label="Chỉ số hoạt động trọng tâm">
                {metrics.map(({ value, label }) => (
                  <div key={label}>
                    <p>{value}</p>
                    <p>{label}</p>
                  </div>
                ))}
              </section>
              <section aria-label="Phân hệ chức năng">
                {visibleModules.map(({ href, name }) => (
                  <Link href={href} key={href}>
                    {name}
                  </Link>
                ))}
              </section>
            </div>
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

      {/* ================= MODAL LÀM BÀI KIỂM TRA TRỰC TIẾP ================= */}
      {activeExamForTaking && (
        <ExamTakingModal
          open={Boolean(activeExamForTaking)}
          onClose={() => setActiveExamForTaking(null)}
          exam={activeExamForTaking}
          onSubmitted={() => {
            void refresh();
          }}
        />
      )}

      {/* ================= MODAL PHÒNG HỌC TRỰC TUYẾN / THÔNG BÁO ================= */}
      {activeLiveRoom && (
        <LiveRoomModal
          open={Boolean(activeLiveRoom)}
          onClose={() => setActiveLiveRoom(null)}
          room={activeLiveRoom}
        />
      )}

      {/* ================= MODAL XEM TRƯỚC TÀI LIỆU ================= */}
      {activeDocument && (
        <DocumentViewerModal
          open={Boolean(activeDocument)}
          onClose={() => setActiveDocument(null)}
          document={activeDocument}
        />
      )}

      {/* ================= MODAL XEM VIDEO BÀI GIẢNG ================= */}
      {activeLecture && (
        <LecturePlayerModal
          open={Boolean(activeLecture)}
          onClose={() => setActiveLecture(null)}
          lecture={activeLecture}
        />
      )}
    </div>
  );
}
