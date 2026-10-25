"use client";

import {
  Archive,
  Bell,
  BookOpenCheck,
  CalendarDays,
  ChartNoAxesCombined,
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
  UserCheck,
  Users,
  LogOut,
  UserRoundCog,
  ChevronDown,
  Compass,
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
import { UserAvatar } from "@/components/user-avatar";
import { ThemeToggle } from "@/components/theme-toggle";
import { LanguageSwitcher } from "@/components/language-switcher";
import { useI18n } from "@/providers/i18n-provider";

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
  { href: "/dashboard", label: "Tổng quan", icon: LayoutDashboard },
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
    href: "/reports",
    label: "Báo cáo",
    icon: ChartNoAxesCombined,
    permissions: ["report:view"],
    roles: ["SYSTEM_ADMIN", "CENTER_MANAGER", "INSTRUCTOR"],
  },
  {
    href: "/class-operations",
    label: "Điều hành lớp",
    icon: ListChecks,
    permissions: ["class:manage"],
    roles: ["SYSTEM_ADMIN", "CENTER_MANAGER"],
  },
  {
    href: "/attendance",
    label: "Giám sát điểm danh",
    icon: UserCheck,
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

/** Bố cục ứng dụng hoàn toàn mới: Thanh điều hướng Top-Nav đa tầng tối ưu không gian chiều ngang. */
export function WorkspaceShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { session, setRole, logout, notify } = useApp();
  const { t, formatDateTime } = useI18n();

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
            "/reports",
            "/class-operations",
            "/attendance",
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

  // Xác định chuyên mục hiện tại theo route
  const currentSection = useMemo(() => {
    const found = sections.find((s) =>
      s.items.some((item) => pathname === item.href || pathname.startsWith(`${item.href}/`)),
    );
    return found ?? sections[0];
  }, [sections, pathname]);

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
    if (!notificationOpen && !profileOpen) return;
    const closeOverlay = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setNotificationOpen(false);
        setProfileOpen(false);
      }
    };
    document.addEventListener("keydown", closeOverlay);
    return () => {
      document.removeEventListener("keydown", closeOverlay);
    };
  }, [notificationOpen, profileOpen]);

  useEffect(() => {
    if (!notificationOpen) return;
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
      PROGRESS_INTERVENTION: `/reports?interventionId=${entityId}`,
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

  async function signOut(): Promise<void> {
    await logout();
    router.replace("/login");
  }

  return (
    <div className="min-h-screen bg-[var(--canvas)] text-[var(--text-main)] flex flex-col">
      {/* TẦNG 1: MASTER HEADER ĐIỀU HƯỚNG NGANG (Top Command Bar) */}
      <header className="sticky top-0 z-40 border-b border-slate-200 dark:border-slate-800/80 bg-white/90 dark:bg-[#070b14]/90 backdrop-blur-md shadow-2xs">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8 gap-4">
          {/* Logo & Category Navigation */}
          <div className="flex items-center gap-6 lg:gap-8 min-w-0">
            <Link className="flex items-center gap-2.5 shrink-0" href="/dashboard">
              <span className="grid size-9.5 place-items-center rounded-xl bg-gradient-to-tr from-sky-600 to-cyan-500 text-white shadow-sm shadow-sky-600/25">
                <GraduationCap size={20} />
              </span>
              <div className="hidden sm:block">
                <span className="font-extrabold text-base tracking-tight text-slate-900 dark:text-white">
                  Wind EDU
                </span>
                <span className="block text-[10px] font-semibold text-sky-600 dark:text-sky-400 -mt-0.5">
                  EduTech Cloud
                </span>
              </div>
            </Link>

            {/* Desktop Category Navigation */}
            <nav className="hidden lg:flex items-center gap-1">
              {sections.map((section) => {
                const isSelected = currentSection?.id === section.id;
                const targetHref = section.items[0]?.href ?? "/dashboard";
                const Icon = section.icon;

                return (
                  <Link
                    className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all duration-150 ${
                      isSelected
                        ? "bg-sky-50 dark:bg-sky-950/60 text-sky-700 dark:text-sky-300 font-bold border border-sky-200/80 dark:border-sky-800/60 shadow-2xs"
                        : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 hover:bg-slate-100/70 dark:hover:bg-slate-800/50"
                    }`}
                    href={targetHref}
                    key={section.id}
                  >
                    <Icon
                      className={`shrink-0 ${
                        isSelected
                          ? "text-sky-600 dark:text-sky-400"
                          : "text-slate-400 dark:text-slate-500"
                      }`}
                      size={15}
                    />
                    <span>{section.title}</span>
                  </Link>
                );
              })}
            </nav>
          </div>

          {/* Right Action Bar */}
          <div className="flex items-center gap-2 sm:gap-3 shrink-0">
            {/* Role indicator pill */}
            <div className="hidden md:flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-sky-50 dark:bg-sky-950/50 border border-sky-200/80 dark:border-sky-800/60 text-sky-800 dark:text-sky-300 text-xs font-semibold shadow-2xs">
              <span className="size-1.5 rounded-full bg-sky-500 animate-pulse" />
              {session.user.roleName}
            </div>

            {session.availableRoles.length > 1 ? (
              <select
                aria-label="Chọn vai trò sử dụng"
                className="min-h-8.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-2 py-1 text-xs font-semibold text-slate-800 dark:text-slate-200 outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-500/15 shadow-2xs cursor-pointer"
                onChange={(event) => void setRole(event.target.value as RoleCode)}
                value={session.roleCode}
              >
                {session.availableRoles.map((role) => (
                  <option key={role.code} value={role.code}>
                    {role.name}
                  </option>
                ))}
              </select>
            ) : null}

            <ThemeToggle />
            <LanguageSwitcher compact />

            {/* Notification Bell */}
            <div className="relative" ref={notificationRef}>
              <button
                aria-label={unreadCount ? `Thông báo, ${unreadCount} chưa đọc` : "Thông báo"}
                className="relative grid size-9 place-items-center rounded-lg border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:border-sky-500 hover:text-sky-600 dark:hover:text-sky-400 bg-white dark:bg-slate-900/90 transition-colors shadow-2xs active:scale-95"
                onClick={() => {
                  setNotificationOpen((open) => !open);
                  setProfileOpen(false);
                }}
                type="button"
              >
                <Bell size={16} />
                {unreadCount ? (
                  <span className="absolute -right-1 -top-1 grid min-w-4 place-items-center rounded-full bg-sky-600 px-1 text-[10px] font-bold leading-4 text-white ring-2 ring-white dark:ring-slate-900 shadow-xs">
                    {unreadCount > 9 ? "9+" : unreadCount}
                  </span>
                ) : null}
              </button>

              {notificationOpen ? (
                <section
                  aria-label="Trung tâm thông báo"
                  className="absolute right-0 top-11 z-50 w-[min(23rem,calc(100vw-2rem))] overflow-hidden rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xl dark:shadow-2xl"
                >
                  <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 px-4 py-3 bg-slate-50/50 dark:bg-slate-800/30">
                    <div>
                      <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                        Thông báo
                      </h2>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400">
                        {unreadCount ? `${unreadCount} mục chưa đọc` : "Đã đọc tất cả"}
                      </p>
                    </div>
                    <button
                      className="inline-flex min-h-8 items-center gap-1.5 rounded-md px-2 text-xs font-semibold text-sky-600 dark:text-sky-400 hover:bg-sky-50 dark:hover:bg-sky-950/40 disabled:text-slate-300 dark:disabled:text-slate-700 transition-colors"
                      disabled={!unreadCount}
                      onClick={() => void markAllRead()}
                      type="button"
                    >
                      <CheckCheck size={14} />
                      Đọc tất cả
                    </button>
                  </div>
                  <div className="max-h-[min(28rem,65dvh)] overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800/50">
                    {notificationLoading ? (
                      <div className="flex min-h-36 items-center justify-center gap-2 text-xs font-semibold text-slate-500">
                        <LoaderCircle className="animate-spin text-sky-600" size={18} />
                        Đang tải…
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
                            Thử lại
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
                              <p className="mt-0.5 text-[11px] text-slate-400 dark:text-slate-500">
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
                            Chưa có thông báo
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
              <button
                aria-expanded={profileOpen}
                aria-label="Mở menu tài khoản"
                className="flex min-h-9 items-center gap-2 rounded-lg px-1.5 text-left transition hover:bg-slate-100 dark:hover:bg-slate-800 sm:pr-2"
                onClick={() => setProfileOpen((open) => !open)}
                type="button"
              >
                <UserAvatar avatarUrl={session.user.avatarUrl} name={session.user.name} priority />
                <ChevronDown
                  className={`hidden text-slate-400 dark:text-slate-500 transition-transform sm:block ${
                    profileOpen ? "rotate-180" : ""
                  }`}
                  size={13}
                />
              </button>

              {profileOpen ? (
                <div className="absolute right-0 top-full z-50 pt-1.5">
                  <section
                    className="w-48 overflow-hidden rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-1.5 shadow-xl dark:shadow-2xl"
                    role="menu"
                  >
                    <div className="px-2.5 py-2 border-b border-slate-100 dark:border-slate-800 mb-1">
                      <p className="text-xs font-bold text-slate-900 dark:text-slate-100 truncate">
                        {session.user.name}
                      </p>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                        {session.user.roleName}
                      </p>
                    </div>
                    <Link
                      className="flex min-h-8.5 items-center gap-2 rounded-lg px-2.5 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                      href="/account"
                      onClick={() => setProfileOpen(false)}
                      role="menuitem"
                    >
                      <UserRoundCog size={14} />
                      Thông tin cá nhân
                    </Link>
                    <button
                      className="flex min-h-8.5 w-full items-center gap-2 rounded-lg px-2.5 text-xs font-semibold text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors"
                      onClick={() => void signOut()}
                      role="menuitem"
                      type="button"
                    >
                      <LogOut size={14} />
                      Đăng xuất
                    </button>
                  </section>
                </div>
              ) : null}
            </div>

            {/* Mobile Menu Trigger */}
            <button
              aria-label="Mở menu điều hướng"
              className="grid size-9 shrink-0 place-items-center rounded-lg border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 lg:hidden shadow-2xs"
              onClick={() => setMenuOpen((open) => !open)}
              type="button"
            >
              <Menu size={16} />
            </button>
          </div>
        </div>

        {/* TẦNG 2: THANH ĐIỀU HƯỚNG TÍCH HỢP SUB-NAV (Contextual App Bar) */}
        {currentSection ? (
          <div className="border-t border-slate-100 dark:border-slate-800/60 bg-slate-50/70 dark:bg-[#090e1a]/80 backdrop-blur-sm overflow-x-auto">
            <div className="mx-auto flex h-11 max-w-7xl items-center px-4 sm:px-6 lg:px-8 gap-1.5 scrollbar-none">
              <span className="hidden sm:inline-flex items-center gap-1.5 text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider mr-2 shrink-0">
                <Compass size={13} className="text-sky-500" />
                {currentSection.title}:
              </span>
              {currentSection.items.map(({ href, label, icon: Icon }) => {
                const active = pathname === href || pathname.startsWith(`${href}/`);
                const resolvedLabel =
                  href === "/courses"
                    ? session.roleCode === "LEARNER"
                      ? "Lớp của tôi"
                      : session.roleCode === "INSTRUCTOR"
                        ? "Lớp giảng dạy"
                        : label
                    : label;

                return (
                  <Link
                    aria-current={active ? "page" : undefined}
                    className={`inline-flex shrink-0 items-center gap-1.5 px-3 py-1 rounded-md text-xs font-semibold transition-all duration-150 ${
                      active
                        ? "bg-white dark:bg-slate-800 text-sky-600 dark:text-sky-400 font-bold border border-slate-200 dark:border-slate-700 shadow-2xs"
                        : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 hover:bg-white/60 dark:hover:bg-slate-800/40"
                    }`}
                    href={href}
                    key={href}
                  >
                    <Icon size={13} className={active ? "text-sky-600 dark:text-sky-400" : "text-slate-400"} />
                    <span>{t(resolvedLabel)}</span>
                  </Link>
                );
              })}
            </div>
          </div>
        ) : null}
      </header>

      {/* MOBILE DRAWER: Menu trượt trên màn hình di động */}
      {menuOpen ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div
            className="fixed inset-0 bg-slate-900/60 dark:bg-black/80 backdrop-blur-xs transition-opacity"
            onClick={() => setMenuOpen(false)}
          />
          <div className="fixed inset-y-0 left-0 w-72 max-w-[85vw] bg-white dark:bg-[#0c1220] p-5 shadow-2xl flex flex-col z-10 border-r border-slate-200 dark:border-slate-800">
            <div className="flex items-center justify-between pb-4 border-b border-slate-100 dark:border-slate-800">
              <div className="flex items-center gap-2.5">
                <span className="grid size-8 place-items-center rounded-lg bg-sky-600 text-white">
                  <GraduationCap size={18} />
                </span>
                <span className="font-bold text-base text-slate-900 dark:text-white">Wind EDU</span>
              </div>
              <button
                aria-label="Đóng menu"
                className="grid size-8 place-items-center rounded-lg text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
                onClick={() => setMenuOpen(false)}
                type="button"
              >
                <X size={18} />
              </button>
            </div>

            <nav className="flex-1 overflow-y-auto py-4 space-y-4">
              {sections.map((section) => (
                <div key={section.id} className="space-y-1">
                  <p className="px-2 text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                    {section.title}
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
              ))}
            </nav>
          </div>
        </div>
      ) : null}

      {/* VÙNG NỘI DUNG CHÍNH (Full Width Canvas) */}
      <main id="workspace-main" tabIndex={-1} className="flex-1 outline-none">
        {children}
      </main>
    </div>
  );
}
