"use client";

import {
  Archive,
  Bell,
  BookOpenCheck,
  CalendarDays,
  CheckCheck,
  ClipboardCheck,
  Database,
  FileQuestion,
  GraduationCap,
  Headphones,
  History,
  LayoutDashboard,
  ListChecks,
  LoaderCircle,
  Menu,
  MessageSquareText,
  Presentation,
  Settings,
  ShieldCheck,
  ShieldEllipsis,
  Users,
  LogOut,
  UserRound,
  ChevronDown,
  X,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useMemo } from "react";
import { apiRequest } from "@/lib/api-client";
import { useApp } from "@/providers/app-provider";
import type { PermissionCode, RoleCode } from "@/lib/app-types";
import { hasAnyPermission } from "@/lib/access-control";
import type { LearningNotification } from "@/lib/learning-types";
import { UserAvatar } from "@/shared/ui/user-avatar";
import { ThemeToggle } from "@/shared/layout/theme-toggle";
import { LanguageSwitcher } from "@/shared/layout/language-switcher";
import { useI18n } from "@/providers/i18n-provider";
import { MiniChatWidget } from "@/shared/layout/mini-chat-widget";
import { BrandLogo } from "@/shared/ui/brand-logo";

interface NavigationItem {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
  permissions?: readonly PermissionCode[];
  roles?: readonly RoleCode[];
}

interface NavSection {
  id: string;
  title: string;
  icon: typeof LayoutDashboard;
  items: NavigationItem[];
}

const allNavItems: NavigationItem[] = [
  {
    href: "/courses",
    label: "Khóa học & lớp",
    icon: GraduationCap,
    permissions: ["course:view", "class:view"],
    roles: ["SYSTEM_ADMIN", "CENTER_MANAGER", "INSTRUCTOR", "LEARNER"],
  },
  {
    href: "/materials",
    label: "Kho học liệu",
    icon: Database,
    permissions: ["material:view"],
    roles: ["SYSTEM_ADMIN", "CENTER_MANAGER", "INSTRUCTOR", "LEARNER"],
  },
  {
    href: "/questions",
    label: "Ngân hàng câu hỏi",
    icon: FileQuestion,
    permissions: ["question:view"],
    roles: ["SYSTEM_ADMIN", "INSTRUCTOR"],
  },
  {
    href: "/exams",
    label: "Đề & kết quả",
    icon: BookOpenCheck,
    permissions: ["exam:view"],
    roles: ["SYSTEM_ADMIN", "CENTER_MANAGER", "INSTRUCTOR", "LEARNER"],
  },
  {
    href: "/forum",
    label: "Diễn đàn",
    icon: MessageSquareText,
    permissions: ["forum:view"],
    roles: ["SYSTEM_ADMIN", "CENTER_MANAGER", "INSTRUCTOR", "LEARNER"],
  },
  {
    href: "/messages",
    label: "Tin nhắn",
    icon: MessageSquareText,
    roles: ["SYSTEM_ADMIN", "CENTER_MANAGER", "INSTRUCTOR", "LEARNER"],
  },
  {
    href: "/live-classes",
    label: "Lớp học online",
    icon: CalendarDays,
    permissions: ["session:view"],
    roles: ["SYSTEM_ADMIN", "CENTER_MANAGER", "INSTRUCTOR", "LEARNER"],
  },
  {
    href: "/academic",
    label: "Lịch & bài tập",
    icon: ClipboardCheck,
    permissions: ["class:view", "exam:view"],
    roles: ["INSTRUCTOR", "LEARNER"],
  },
  {
    href: "/class-operations",
    label: "Điều hành lớp",
    icon: ListChecks,
    permissions: ["class:manage"],
    roles: ["SYSTEM_ADMIN", "CENTER_MANAGER"],
  },
  {
    href: "/class-lifecycle",
    label: "Vòng đời lớp",
    icon: Archive,
    permissions: ["class:manage"],
    roles: ["SYSTEM_ADMIN", "CENTER_MANAGER"],
  },
  {
    href: "/teaching-operations",
    label: "Nghiệp vụ giảng dạy",
    icon: Presentation,
    permissions: ["question:manage", "exam:manage", "session:manage"],
    roles: ["INSTRUCTOR"],
  },
  {
    href: "/learning-history",
    label: "Lịch sử học tập",
    icon: History,
    roles: ["LEARNER"],
  },
  {
    href: "/support",
    label: "Hỗ trợ",
    icon: Headphones,
    permissions: ["support:create", "support:manage"],
  },
  {
    href: "/admin/users",
    label: "Người dùng",
    icon: Users,
    permissions: ["user:view"],
    roles: ["SYSTEM_ADMIN", "CENTER_MANAGER"],
  },
  {
    href: "/admin/roles",
    label: "Vai trò & quyền",
    icon: ShieldCheck,
    permissions: ["role:view"],
    roles: ["SYSTEM_ADMIN"],
  },
  {
    href: "/admin/settings",
    label: "Cấu hình",
    icon: Settings,
    permissions: ["system:configure"],
    roles: ["SYSTEM_ADMIN"],
  },
  {
    href: "/admin/operations",
    label: "Vận hành & tuân thủ",
    icon: ShieldEllipsis,
    permissions: ["system:configure"],
    roles: ["SYSTEM_ADMIN"],
  },
];

/** Giữ nguyên cách xác định mục đang mở, kể cả nhóm tuyến đặc biệt của quản trị viên. */
function isMobileRoleNavActive(roleCode: RoleCode, href: string, pathname: string): boolean {
  if (href === "/dashboard") return pathname === "/dashboard";
  if (roleCode === "SYSTEM_ADMIN") {
    if (href === "/admin/users") return pathname.startsWith("/admin");
    if (href === "/exams") return pathname === "/exams" || pathname.startsWith("/exams/") || pathname === "/questions" || pathname === "/materials";
    if (href === "/class-operations") return pathname === "/class-operations" || pathname === "/class-lifecycle";
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}
// Bố cục ứng dụng hoàn toàn mới: Thanh điều hướng Top-Nav đa tầng tối ưu không gian chiều ngang và đồng bộ song ngữ.
export function WorkspaceShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { session, setRole, logout, notify } = useApp();
  const { t, formatDateTime, locale } = useI18n();

  const [menuOpen, setMenuOpen] = useState(false);
  const [notificationOpen, setNotificationOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [notifications, setNotifications] = useState<LearningNotification[]>([]);
  const [notificationLoading, setNotificationLoading] = useState(true);
  const [notificationError, setNotificationError] = useState("");
  const notificationRef = useRef<HTMLDivElement>(null);

  const unreadCount = notifications.filter((item) => !item.readAt).length;

  // Lọc quyền người dùng
  const availableItems = useMemo(() => {
    return allNavItems.filter((item) => {
      const roleAllowed = !item.roles || item.roles.includes(session.roleCode);
      const permissionAllowed =
        !item.permissions || hasAnyPermission(session, item.permissions);
      return roleAllowed && permissionAllowed;
    });
  }, [session]);

  // Phân chia theo 4 nhóm chuyên mục chính
  const sections: NavSection[] = useMemo(() => {
    return [
      {
        id: "learning",
        title: "Học tập & Giảng dạy",
        icon: GraduationCap,
        items: availableItems.filter((i) =>
          ["/dashboard", "/courses", "/academic", "/live-classes"].includes(i.href),
        ),
      },
      {
        id: "exams",
        title: "Khảo thí & Học liệu",
        icon: BookOpenCheck,
        items: availableItems.filter((i) =>
          ["/exams", "/questions", "/materials"].includes(i.href),
        ),
      },
      {
        id: "community",
        title: "Cộng đồng & Hỗ trợ",
        icon: MessageSquareText,
        items: availableItems.filter((i) =>
          ["/forum", "/messages", "/support", "/learning-history"].includes(i.href),
        ),
      },
      {
        id: "admin",
        title: "Quản trị & Vận hành",
        icon: ShieldCheck,
        items: availableItems.filter((i) =>
          [
            "/class-operations",
            "/class-lifecycle",
            "/teaching-operations",
            "/admin/users",
            "/admin/roles",
            "/admin/settings",
            "/admin/operations",
          ].includes(i.href),
        ),
      },
    ].filter((s) => s.items.length > 0);
  }, [availableItems]);

  // Danh sách điều hướng trung tâm dành riêng cho Học sinh: Lớp học, Lịch học, Tin nhắn
  const learnerNavItems = useMemo(
    () => [
      { href: "/courses", label: "Lớp học", icon: GraduationCap },
      { href: "/live-classes", label: "Lịch học", icon: CalendarDays },
      { href: "/messages", label: "Tin nhắn", icon: MessageSquareText },
    ],
    [],
  );

  // Danh sách điều hướng trung tâm dành riêng cho Giáo viên: Lớp học, Học Liệu, Ngân hàng câu hỏi, Lịch Học, Tin nhắn
  const instructorNavItems = useMemo(
    () => [
      { href: "/courses", label: "Lớp học", icon: GraduationCap },
      { href: "/materials", label: "Học Liệu", icon: Database },
      { href: "/questions", label: "Ngân hàng câu hỏi", icon: FileQuestion },
      { href: "/live-classes", label: "Lịch Học", icon: CalendarDays },
      { href: "/messages", label: "Tin nhắn", icon: MessageSquareText },
    ],
    [],
  );

  // Danh sách điều hướng trung tâm dành riêng cho Quản trị viên hệ thống (Chức năng cha trên Header ngang)
  const adminNavItems = useMemo(
    () => [
      { href: "/courses", label: "Lớp học", icon: GraduationCap },
      { href: "/exams", label: "Khảo thí", icon: BookOpenCheck },
      { href: "/class-operations", label: "Điều hành lớp", icon: ListChecks },
      { href: "/admin/settings", label: "Cấu hình", icon: Settings },
      { href: "/messages", label: "Tin nhắn", icon: MessageSquareText },
    ],
    [],
  );

  // Danh sách điều hướng trung tâm dành riêng cho Quản lý trung tâm (Chức năng cha trên Header ngang)
  const centerManagerNavItems = useMemo(
    () => [
      { href: "/courses", label: "Lớp học", icon: GraduationCap },
      { href: "/class-operations", label: "Điều hành lớp", icon: ListChecks },
      { href: "/admin/users", label: "Người dùng", icon: Users },
      { href: "/messages", label: "Tin nhắn", icon: MessageSquareText },
    ],
    [],
  );


  const mobileRoleNavigation =
    session.roleCode === "CENTER_MANAGER"
      ? { title: "Menu quản lý trung tâm", items: centerManagerNavItems }
      : session.roleCode === "INSTRUCTOR"
        ? { title: "Menu giáo viên", items: instructorNavItems }
        : session.roleCode === "LEARNER"
          ? { title: "Menu học sinh", items: learnerNavItems }
          : session.roleCode === "SYSTEM_ADMIN"
            ? { title: "Menu quản trị hệ thống", items: adminNavItems }
            : null;
  // Tải danh sách thông báo
  const loadNotifications = useCallback(async () => {
    setNotificationLoading(true);
    setNotificationError("");
    try {
      setNotifications(
        await apiRequest<LearningNotification[]>("/notifications", {
          roleCode: session.roleCode,
        }),
      );
    } catch (error) {
      setNotifications([]);
      setNotificationError(
        error instanceof Error ? error.message : "Không thể tải thông báo.",
      );
    } finally {
      setNotificationLoading(false);
    }
  }, [session.roleCode]);

  useEffect(() => {
    window.queueMicrotask(() => {
      void loadNotifications();
    });
  }, [loadNotifications]);

  useEffect(() => {
    if (!notificationOpen && !profileOpen && !menuOpen) return;
    /** Đóng các lớp phủ của shell khi người dùng nhấn Escape. */
    const closeOverlay = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setNotificationOpen(false);
        setProfileOpen(false);
        setMenuOpen(false);
      }
    };
    document.addEventListener("keydown", closeOverlay);
    return () => {
      document.removeEventListener("keydown", closeOverlay);
    };
  }, [menuOpen, notificationOpen, profileOpen]);

  useEffect(() => {
    if (!notificationOpen) return;
/** Đảm nhiệm closeOnOutsidePointer trong phạm vi module hiện tại. */
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!notificationRef.current?.contains(event.target as Node)) {
        setNotificationOpen(false);
      }
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
    };
  }, [notificationOpen]);

/** Đảm nhiệm markRead trong phạm vi module hiện tại. */
  async function markRead(item: LearningNotification): Promise<void> {
    if (item.readAt) return;
    try {
      const updated = await apiRequest<LearningNotification>(
        `/notifications/${item.id}/read`,
        { method: "PATCH", roleCode: session.roleCode },
      );
      setNotifications((current) =>
        current.map((notification) =>
          notification.id === updated.id ? updated : notification,
        ),
      );
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "Không thể cập nhật thông báo.",
        "error",
      );
    }
  }

/** Đảm nhiệm markAllRead trong phạm vi module hiện tại. */
  async function markAllRead(): Promise<void> {
    const unread = notifications.filter((item) => !item.readAt);
    if (!unread.length) return;
    try {
      const updated = await Promise.all(
        unread.map((item) =>
          apiRequest<LearningNotification>(`/notifications/${item.id}/read`, {
            method: "PATCH",
            roleCode: session.roleCode,
          }),
        ),
      );
      const byId = new Map(updated.map((item) => [item.id, item]));
      setNotifications((current) =>
        current.map((item) => byId.get(item.id) ?? item),
      );
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "Không thể đánh dấu toàn bộ thông báo.",
        "error",
      );
    }
  }

/** Đảm nhiệm notificationHref trong phạm vi module hiện tại. */
  function notificationHref(item: LearningNotification): string {
    const entityType = item.entityType.trim().toUpperCase();
    const entityId = encodeURIComponent(item.entityId);
    const destinations: Record<string, string> = {
      CLASS: `/courses/classes/${entityId}`,
      MATERIAL: `/materials?materialId=${entityId}`,
      QUESTION: `/questions?questionId=${entityId}`,
      EXAM: `/exams?examId=${entityId}`,
      EXAM_ATTEMPT: `/exams?attemptId=${entityId}`,
      ASSIGNMENT: `/academic?assignmentId=${entityId}`,
      CLASS_ANNOUNCEMENT: `/academic?announcementId=${entityId}`,
      LIVE_SESSION: `/live-classes?sessionId=${entityId}`,
      ATTENDANCE_APPEAL: `/live-classes?appealId=${entityId}`,
      CONTENT_REPORT: `/forum?reportId=${entityId}`,
      SUPPORT_TICKET: `/support?ticketId=${entityId}`,
      CHAT_CONVERSATION: `/messages?conversationId=${entityId}`,
    };
    if (destinations[entityType]) return destinations[entityType];
    if (item.type.includes("SUPPORT")) return `/support?ticketId=${entityId}`;
    if (
      item.type.includes("FORUM") ||
      item.type.includes("MENTION") ||
      item.type.includes("REPORT")
    )
      return `/forum?reportId=${entityId}`;
    if (
      item.type.includes("SESSION") ||
      item.type.includes("ATTENDANCE") ||
      item.type.includes("RECORDING")
    )
      return `/live-classes?sessionId=${entityId}`;
    if (item.type.includes("EXAM") || item.type.includes("GRADE"))
      return `/exams?examId=${entityId}`;
    if (item.type.includes("ASSIGNMENT"))
      return `/academic?assignmentId=${entityId}`;
    if (item.type.includes("MATERIAL"))
      return `/materials?materialId=${entityId}`;
    return "/dashboard";
  }

/** Đảm nhiệm signOut trong phạm vi module hiện tại. */
  async function signOut(): Promise<void> {
    await logout();
    router.replace("/login");
  }

  // Khối Action Bar bên phải: Điều khiển vai trò, theme, ngôn ngữ, thông báo và menu người dùng
  const renderRightActionBar = (includeMobileTrigger = true) => (
    <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
      {/* Role indicator pill chỉ cho Quản trị viên hệ thống */}
      {session.roleCode === "SYSTEM_ADMIN" && (
        <div className="hidden md:flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-sky-50 dark:bg-sky-950/50 border border-sky-200/80 dark:border-sky-800/60 text-sky-800 dark:text-sky-300 text-[13px] font-semibold shadow-2xs">
          <span className="size-1.5 rounded-full bg-sky-500 animate-pulse" />
          {t(session.user.roleName)}
        </div>
      )}

      {session.availableRoles.length > 1 ? (
        <select
          aria-label={t("Chọn vai trò sử dụng")}
          className="min-h-9.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-2.5 py-1 text-[13px] font-semibold text-slate-800 dark:text-slate-200 outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-500/15 shadow-2xs cursor-pointer"
          onChange={(event) => void setRole(event.target.value as RoleCode)}
          value={session.roleCode}
        >
          {session.availableRoles.map((role) => (
            <option key={role.code} value={role.code}>
              {t(role.name)}
            </option>
          ))}
        </select>
      ) : null}

      <ThemeToggle />
      <LanguageSwitcher compact />

      {/* Notification Bell */}
      <div className="relative" ref={notificationRef}>
        <button
          aria-label={
            unreadCount
              ? locale === "en-US"
                ? `Notifications, ${unreadCount} unread`
                : `Thông báo, ${unreadCount} chưa đọc`
              : t("Thông báo")
          }
          className="relative grid size-[40px] place-items-center rounded-xl border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:border-sky-500 hover:text-sky-600 dark:hover:text-sky-400 bg-white dark:bg-slate-900/90 transition-colors shadow-2xs active:scale-95"
          onClick={() => {
            setNotificationOpen((open) => !open);
            setProfileOpen(false);
          }}
          type="button"
        >
          <Bell size={18} />
          {unreadCount ? (
            <span className="absolute -right-1 -top-1 grid min-w-4.5 place-items-center rounded-full bg-sky-700 px-1 text-[11px] font-bold leading-4.5 text-white ring-2 ring-white dark:ring-slate-900 shadow-xs">
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          ) : null}
        </button>

        {notificationOpen ? (
          <section
            aria-label={t("Trung tâm thông báo")}
            className="absolute right-0 top-12 z-50 w-[min(23rem,calc(100vw-2rem))] overflow-hidden rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xl dark:shadow-2xl"
          >
            <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 px-4 py-3 bg-slate-50/50 dark:bg-slate-800/30">
              <div>
                <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                  {t("Thông báo")}
                </h2>
                <p className="text-[11px] text-slate-600 dark:text-slate-400">
                  {unreadCount
                    ? locale === "en-US"
                      ? `${unreadCount} unread items`
                      : `${unreadCount} mục chưa đọc`
                    : t("Đã đọc tất cả")}
                </p>
              </div>
              <button
                className="inline-flex min-h-8 items-center gap-1.5 rounded-md px-2 text-xs font-semibold text-sky-800 dark:text-sky-300 hover:bg-sky-50 dark:hover:bg-sky-950/40 disabled:text-slate-300 dark:disabled:text-slate-700 transition-colors"
                disabled={!unreadCount}
                onClick={() => void markAllRead()}
                type="button"
              >
                <CheckCheck size={14} />
                {t("Đọc tất cả")}
              </button>
            </div>
            <div className="max-h-[min(28rem,65dvh)] overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800/50">
              {notificationLoading ? (
                <div className="flex min-h-36 items-center justify-center gap-2 text-xs font-semibold text-slate-500">
                  <LoaderCircle className="animate-spin text-sky-600" size={18} />
                  {t("Đang tải…")}
                </div>
              ) : notificationError ? (
                <div className="grid min-h-36 place-items-center px-4 text-center">
                  <div>
                    <p className="text-xs font-semibold text-rose-600 dark:text-rose-400">
                      {notificationError}
                    </p>
                    <button
                      className="mt-2 text-xs font-semibold text-sky-600 hover:underline"
                      onClick={() => void loadNotifications()}
                      type="button"
                    >
                      {t("Thử lại")}
                    </button>
                  </div>
                </div>
              ) : notifications.length ? (
                notifications.map((item) => (
                  <Link
                    className={`block px-4 py-3 transition hover:bg-slate-50 dark:hover:bg-slate-800/50 ${
                      item.readAt
                        ? "bg-white dark:bg-slate-900"
                        : "bg-sky-50/50 dark:bg-sky-950/20"
                    }`}
                    href={notificationHref(item)}
                    key={item.id}
                    onClick={() => {
                      void markRead(item);
                      setNotificationOpen(false);
                    }}
                  >
                    <div className="flex items-start gap-2.5">
                      <span
                        className={`mt-1.5 size-2 shrink-0 rounded-full ${
                          item.readAt ? "bg-slate-300 dark:bg-slate-700" : "bg-sky-500"
                        }`}
                      />
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-semibold text-slate-900 dark:text-slate-100 line-clamp-2">
                          {item.title}
                        </p>
                        <p className="mt-0.5 text-[11px] text-slate-600 dark:text-slate-400">
                          {formatDateTime(item.createdAt)}
                        </p>
                      </div>
                    </div>
                  </Link>
                ))
              ) : (
                <div className="grid min-h-36 place-items-center px-4 text-center">
                  <div>
                    <Bell className="mx-auto text-slate-300 dark:text-slate-700" size={24} />
                    <p className="mt-2 text-xs font-semibold text-slate-500">
                      {t("Chưa có thông báo")}
                    </p>
                  </div>
                </div>
              )}
            </div>
          </section>
        ) : null}
      </div>

      {/* Profile Menu Dropdown */}
      <div
        className="relative"
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) {
            setProfileOpen(false);
          }
        }}
        onMouseEnter={() => setProfileOpen(true)}
        onMouseLeave={() => setProfileOpen(false)}
      >
        {session.roleCode === "LEARNER" || session.roleCode === "INSTRUCTOR" || session.roleCode === "CENTER_MANAGER" || session.roleCode === "SYSTEM_ADMIN" ? (
          <button
            aria-expanded={profileOpen}
            aria-label={t("Mở menu tài khoản")}
            className="flex min-h-[38px] items-center gap-2 rounded-full pl-1.5 pr-3 py-1 bg-slate-100 dark:bg-slate-800/80 hover:bg-slate-200 dark:hover:bg-slate-700/80 transition-colors cursor-pointer"
            onClick={() => setProfileOpen((open) => !open)}
            type="button"
          >
            <UserAvatar
              avatarUrl={session.user.avatarUrl}
              name={session.user.name}
              priority
              className="size-8 rounded-full text-[13px]"
            />
            <span className="hidden sm:block text-[13px] font-bold text-slate-800 dark:text-slate-200 truncate max-w-[110px] sm:max-w-[140px]">
              {session.user.name}
            </span>
            <ChevronDown
              className={`hidden sm:block text-slate-500 transition-transform ${
                profileOpen ? "rotate-180" : ""
              }`}
              size={14}
            />
          </button>
        ) : (
          <button
            aria-expanded={profileOpen}
            aria-label={t("Mở menu tài khoản")}
            className="flex min-h-[40px] items-center gap-2.5 rounded-xl px-2 text-left transition hover:bg-slate-100 dark:hover:bg-slate-800 sm:pr-2.5"
            onClick={() => setProfileOpen((open) => !open)}
            type="button"
          >
            <UserAvatar avatarUrl={session.user.avatarUrl} name={session.user.name} priority className="size-8 rounded-full text-[13px]" />
            <span className="hidden sm:inline-block text-[13px] font-semibold text-slate-700 dark:text-slate-200 truncate max-w-28">
              {session.user.name}
            </span>
            <ChevronDown
              className={`hidden text-slate-600 dark:text-slate-400 transition-transform sm:block ${
                profileOpen ? "rotate-180" : ""
              }`}
              size={15}
            />
          </button>
        )}

        {profileOpen ? (
          <div className="absolute right-0 top-full z-50 pt-1.5">
            {session.roleCode === "LEARNER" || session.roleCode === "INSTRUCTOR" || session.roleCode === "CENTER_MANAGER" || session.roleCode === "SYSTEM_ADMIN" ? (
              <section
                className="w-80 overflow-hidden rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-2 shadow-2xl"
                role="menu"
              >
                <div className="flex items-center gap-3 p-3 bg-slate-50 dark:bg-slate-800/50 rounded-xl mb-1.5">
                  <UserAvatar
                    avatarUrl={session.user.avatarUrl}
                    name={session.user.name}
                    className="size-11 rounded-full ring-2 ring-indigo-500/20"
                    priority
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className={`px-1.5 py-0.5 rounded text-white text-[10px] font-bold shrink-0 ${
                        session.roleCode === "SYSTEM_ADMIN" ? "bg-rose-600" : session.roleCode === "CENTER_MANAGER" ? "bg-indigo-600" : session.roleCode === "INSTRUCTOR" ? "bg-blue-600" : "bg-emerald-600"
                      }`}>
                        {session.roleCode === "SYSTEM_ADMIN" ? "Quản trị viên" : session.roleCode === "CENTER_MANAGER" ? "Quản lý trung tâm" : session.roleCode === "INSTRUCTOR" ? "Giáo viên" : "Học sinh"}
                      </span>
                      <strong className="text-xs font-bold text-slate-900 dark:text-slate-100 truncate">
                        {session.user.name || "Quản trị viên"}
                      </strong>
                    </div>
                    <p className="text-[11px] text-slate-600 dark:text-slate-400 truncate mt-0.5">
                      {session.user.email || "manager@wind.edu.vn"}
                    </p>
                  </div>
                </div>

                <div className="space-y-0.5">
                  <Link
                    aria-label={t("Thông tin")}
                    className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-left hover:bg-slate-50 dark:hover:bg-slate-800/60 transition-colors"
                    href="/account"
                    onClick={() => setProfileOpen(false)}
                    role="menuitem"
                  >
                    <div className="size-7 rounded-lg bg-blue-50 dark:bg-blue-950/50 text-blue-600 dark:text-blue-400 grid place-items-center shrink-0">
                      <UserRound size={15} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-bold text-slate-800 dark:text-slate-200">
                        {t("Thông tin cá nhân")}
                      </p>
                      <p className="text-[10px] text-slate-400 truncate">
                        Hồ sơ, ảnh đại diện và liên hệ
                      </p>
                    </div>
                  </Link>

                  <Link
                    className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-left hover:bg-slate-50 dark:hover:bg-slate-800/60 transition-colors"
                    href="/account?tab=security"
                    onClick={() => setProfileOpen(false)}
                    role="menuitem"
                  >
                    <div className="size-7 rounded-lg bg-emerald-50 dark:bg-emerald-950/50 text-emerald-600 dark:text-emerald-400 grid place-items-center shrink-0">
                      <ShieldCheck size={15} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-bold text-slate-800 dark:text-slate-200">
                        Bảo mật
                      </p>
                      <p className="text-[10px] text-slate-400 truncate">
                        Mật khẩu, xác thực 2 bước & phiên
                      </p>
                    </div>
                  </Link>
                  {session.roleCode === "SYSTEM_ADMIN" && (
                    <Link
                      className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-left hover:bg-slate-50 dark:hover:bg-slate-800/60 transition-colors"
                      href="/admin/users"
                      onClick={() => setProfileOpen(false)}
                      role="menuitem"
                    >
                      <div className="size-7 rounded-lg bg-rose-50 dark:bg-rose-950/50 text-rose-600 dark:text-rose-400 grid place-items-center shrink-0">
                        <Settings size={15} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-bold text-slate-800 dark:text-slate-200">
                          Quản trị & Cấu hình
                        </p>
                        <p className="text-[10px] text-slate-400 truncate">
                          Người dùng, vai trò & hệ thống
                        </p>
                      </div>
                    </Link>
                  )}
                </div>

                <div className="my-1 border-t border-slate-100 dark:border-slate-800" />

                <div className="space-y-0.5">
                  <button
                    className="flex min-h-8.5 w-full items-center gap-2.5 rounded-lg px-3 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                    onClick={() => {
                      notify("Đang mở tài liệu hướng dẫn sử dụng...", "info");
                      setProfileOpen(false);
                    }}
                    role="menuitem"
                    type="button"
                  >
                    <BookOpenCheck size={15} className="text-slate-500" />
                    <span>Hướng dẫn sử dụng</span>
                  </button>

                  <Link
                    className="flex min-h-8.5 items-center gap-2.5 rounded-lg px-3 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                    href="/support"
                    onClick={() => setProfileOpen(false)}
                    role="menuitem"
                  >
                    <Headphones size={15} className="text-slate-500" />
                    <span>Hỗ trợ</span>
                  </Link>
                </div>

                <div className="my-1 border-t border-slate-100 dark:border-slate-800" />

                <button
                  className="flex min-h-8.5 w-full items-center gap-2.5 rounded-lg px-3 text-xs font-semibold text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors"
                  onClick={() => void signOut()}
                  role="menuitem"
                  type="button"
                >
                  <LogOut size={15} />
                  <span>{t("Đăng xuất")}</span>
                </button>
              </section>
            ) : (
              <section
                className="w-56 overflow-hidden rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-1.5 shadow-xl dark:shadow-2xl"
                role="menu"
              >
                <div className="px-2.5 py-2 border-b border-slate-100 dark:border-slate-800 mb-1">
                  <p className="text-xs font-bold text-slate-900 dark:text-slate-100 truncate">
                    {session.user.name}
                  </p>
                  <p className="text-[11px] text-slate-600 dark:text-slate-400 truncate">
                    {t(session.user.roleName)}
                  </p>
                </div>
                <Link
                  aria-label={t("Thông tin")}
                  className="flex min-h-8.5 items-center gap-2 rounded-lg px-2.5 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                  href="/account"
                  onClick={() => setProfileOpen(false)}
                  role="menuitem"
                >
                  <UserRound size={14} className="text-slate-500" />
                  <span>{t("Thông tin")}</span>
                </Link>
                <Link
                  className="flex min-h-8.5 items-center gap-2 rounded-lg px-2.5 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                  href="/account?tab=security"
                  onClick={() => setProfileOpen(false)}
                  role="menuitem"
                >
                  <ShieldCheck size={14} className="text-slate-500" />
                  <span>{t("Bảo mật")}</span>
                </Link>
                <div className="my-1 border-t border-slate-100 dark:border-slate-800" />
                <button
                  className="flex min-h-8.5 w-full items-center gap-2 rounded-lg px-2.5 text-xs font-semibold text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors"
                  onClick={() => void signOut()}
                  role="menuitem"
                  type="button"
                >
                  <LogOut size={14} />
                  <span>{t("Đăng xuất")}</span>
                </button>
              </section>
            )}
          </div>
        ) : null}
      </div>

      {/* Mobile Menu Trigger */}
      {includeMobileTrigger && (
        <button
          aria-label={t("Mở menu điều hướng")}
          className="grid size-[40px] shrink-0 place-items-center rounded-xl border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 lg:hidden shadow-2xs"
          onClick={() => setMenuOpen((open) => !open)}
          type="button"
        >
          <Menu size={18} />
        </button>
      )}
    </div>
  );

  return (
    <div className="min-h-screen bg-[var(--canvas)] text-[var(--text-main)] flex flex-col">
      {/* TẦNG 1: MASTER HEADER ĐIỀU HƯỚNG NGANG (Top Command Bar) */}
      <header className="sticky top-0 z-40 border-b border-slate-200 dark:border-slate-800/80 bg-white/90 dark:bg-[#070b14]/90 backdrop-blur-md shadow-2xs">
        <div className="flex h-[70px] w-full items-center justify-between px-3 sm:px-5 lg:px-6 gap-2 sm:gap-4">
          {/* Logo & Category Navigation */}
          <div className="flex items-center gap-6 lg:gap-8 shrink-0">
            <Link aria-label="Wind EDU — về trang lớp học" className="flex items-center gap-2.5 shrink-0" href="/courses">
              <BrandLogo className="shadow-sm shadow-sky-600/25" priority size={42} />
              <div className="hidden sm:block">
                <span className="font-extrabold text-[17.5px] tracking-tight text-slate-900 dark:text-white">
                  Wind EDU
                </span>
                <span className="block text-[11px] font-semibold text-sky-800 dark:text-sky-300 -mt-0.5">
                  EduTech Cloud
                </span>
              </div>
            </Link>

            
          </div>

          {/* Điều hướng trung tâm dành cho Học sinh, Giáo viên & Quản lý trung tâm (Chức năng cha trên Header ngang) */}
          {(session.roleCode === "LEARNER" || session.roleCode === "INSTRUCTOR" || session.roleCode === "CENTER_MANAGER" || session.roleCode === "SYSTEM_ADMIN") && (
            <div className="hidden md:flex flex-1 items-center justify-center min-w-0 px-1 sm:px-3">
              <nav
                aria-label={
                  session.roleCode === "INSTRUCTOR"
                    ? "Điều hướng giáo viên"
                    : session.roleCode === "CENTER_MANAGER"
                      ? "Điều hướng quản lý trung tâm"
                      : session.roleCode === "SYSTEM_ADMIN"
                        ? "Điều hướng quản trị hệ thống"
                        : "Điều hướng chính học sinh"
                }
                className="flex items-center gap-1 sm:gap-1.5 p-1 rounded-2xl bg-slate-100/80 dark:bg-slate-900/80 border border-slate-200/80 dark:border-slate-800/80 shadow-2xs backdrop-blur-xs"
              >
                {(session.roleCode === "INSTRUCTOR"
                  ? instructorNavItems
                  : session.roleCode === "CENTER_MANAGER"
                    ? centerManagerNavItems
                    : session.roleCode === "SYSTEM_ADMIN"
                      ? adminNavItems
                      : learnerNavItems
                ).map(
                  ({ href, label, icon: Icon }) => {
                    const isSelected =
                      href === "/dashboard"
                        ? pathname === "/dashboard"
                        : href === "/admin/users"
                          ? pathname.startsWith("/admin")
                          : href === "/exams"
                            ? pathname === "/exams" || pathname.startsWith("/exams/") || pathname === "/questions" || pathname === "/materials"
                            : href === "/class-operations"
                              ? pathname === "/class-operations" || pathname === "/class-lifecycle"
                              : pathname === href || pathname.startsWith(`${href}/`);
                    return (
                      <Link
                        className={`flex items-center gap-1.5 sm:gap-2 px-2.5 sm:px-3.5 py-1.5 rounded-xl text-xs sm:text-[13px] font-bold tracking-tight whitespace-nowrap transition-all duration-150 ${
                          isSelected
                            ? "bg-white dark:bg-sky-950 text-sky-700 dark:text-sky-300 border border-slate-200/90 dark:border-sky-800/80 shadow-xs"
                            : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 hover:bg-white/60 dark:hover:bg-slate-800/50"
                        }`}
                        href={href}
                        key={href}
                      >
                        <Icon
                          className={`shrink-0 ${
                            isSelected
                              ? "text-sky-800 dark:text-sky-300"
                              : "text-slate-600 dark:text-slate-400"
                          }`}
                          size={15}
                        />
                        <span>{t(label)}</span>
                      </Link>
                    );
                  },
                )}
              </nav>
            </div>
          )}

          {/* Right Action Bar */}
          {renderRightActionBar(true)}
        </div>

        

        {/* Điều hướng đầy đủ phục vụ trợ năng (Screen Readers & Quick Links) */}
        <nav aria-label={t("Điều hướng chức năng")} className="sr-only">
          {availableItems.map((item) => (
            <Link href={item.href} key={item.href}>
              {t(item.label)}
            </Link>
          ))}
        </nav>
      </header>

      {/* MOBILE DRAWER: Menu trượt trên màn hình di động cho Học sinh, Giáo viên & Quản trị hệ thống */}
      {menuOpen ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div
            className="fixed inset-0 bg-slate-900/60 dark:bg-black/80 backdrop-blur-xs transition-opacity"
            onClick={() => setMenuOpen(false)}
          />
          <div className="fixed inset-y-0 left-0 w-72 max-w-[85vw] bg-white dark:bg-[#0c1220] p-5 shadow-2xl flex flex-col z-10 border-r border-slate-200 dark:border-slate-800">
            <div className="flex items-center justify-between pb-4 border-b border-slate-100 dark:border-slate-800">
              <div className="flex items-center gap-2.5">
                <BrandLogo className="rounded-lg" size={32} />
                <span className="font-bold text-base text-slate-900 dark:text-white">Wind EDU</span>
              </div>
              <button
                aria-label={t("Đóng menu")}
                className="grid size-8 place-items-center rounded-lg text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
                onClick={() => setMenuOpen(false)}
                type="button"
              >
                <X size={18} />
              </button>
            </div>

            <nav className="flex-1 overflow-y-auto py-4 space-y-4">
              {mobileRoleNavigation ? (
                <div className="space-y-1">
                  <p className="px-2 text-[11px] font-bold uppercase tracking-wider text-slate-600 dark:text-slate-400">
                    {mobileRoleNavigation.title}
                  </p>
                  {mobileRoleNavigation.items.map(({ href, label, icon: Icon }) => {
                    const active = isMobileRoleNavActive(session.roleCode, href, pathname);
                    return (
                      <Link
                        className={`flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-bold transition-colors ${
                          active
                            ? "bg-sky-50 dark:bg-sky-950/60 text-sky-700 dark:text-sky-300 font-extrabold border border-sky-200/80 dark:border-sky-800/60"
                            : "text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
                        }`}
                        href={href}
                        key={href}
                        onClick={() => setMenuOpen(false)}
                      >
                        <Icon size={16} />
                        <span>{t(label)}</span>
                      </Link>
                    );
                  })}
                </div>
              ) : (
                sections.map((section) => (
                  <div key={section.id} className="space-y-1">
                    <p className="px-2 text-[11px] font-bold uppercase tracking-wider text-slate-600 dark:text-slate-400">
                      {t(section.title)}
                    </p>
                    {section.items.map(({ href, label, icon: Icon }) => {
                      const active = pathname === href || pathname.startsWith(`${href}/`);
                      return (
                        <Link
                          className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-semibold transition-colors ${
                            active
                              ? "bg-sky-50 dark:bg-sky-950/60 text-sky-700 dark:text-sky-300 font-bold border border-sky-200/80 dark:border-sky-800/60"
                              : "text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
                          }`}
                          href={href}
                          key={href}
                          onClick={() => setMenuOpen(false)}
                        >
                          <Icon size={15} />
                          <span>{t(label)}</span>
                        </Link>
                      );
                    })}
                  </div>
                ))
              )}
            </nav>
          </div>
        </div>
      ) : null}

      {/* VÙNG NỘI DUNG CHÍNH (Full Width Canvas) */}
      <main id="workspace-main" tabIndex={-1} className="flex-1 outline-none">
        {children}
      </main>

      {/* Widget Chat Mini nổi góc dưới phải màn hình (ẩn khi vào trang /messages) */}
      {!pathname.startsWith("/messages") && <MiniChatWidget />}
    </div>
  );
}
