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
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { apiRequest } from "@/lib/api-client";
import { useApp } from "@/providers/app-provider";
import type { PermissionCode, RoleCode } from "@/lib/app-types";
import { hasAnyPermission } from "@/lib/access-control";
import type { LearningNotification } from "@/lib/learning-types";
import { UserAvatar } from "@/components/user-avatar";
import { ThemeToggle } from "@/components/theme-toggle";
import { LanguageSwitcher } from "@/components/language-switcher";
import { MobileDrawer } from "@/components/mobile-drawer";
import { useI18n } from "@/providers/i18n-provider";

interface NavigationItem {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
  permissions?: readonly PermissionCode[];
  roles?: readonly RoleCode[];
}

const navItems: NavigationItem[] = [
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

/** Sidebar điều hướng tinh gọn, hỗ trợ đầy đủ Light/Dark theme. */
function Sidebar({ close }: { close?: () => void }) {
  const pathname = usePathname();
  const { session } = useApp();
  const { t } = useI18n();

  const available = navItems.filter((item) => {
    const roleAllowed = !item.roles || item.roles.includes(session.roleCode);
    const permissionAllowed =
      !item.permissions || hasAnyPermission(session, item.permissions);
    return roleAllowed && permissionAllowed;
  });

  const sections = [
    {
      title: "Học tập & Giảng dạy",
      items: available.filter((i) =>
        ["/dashboard", "/courses", "/academic", "/live-classes"].includes(i.href),
      ),
    },
    {
      title: "Khảo thí & Học liệu",
      items: available.filter((i) =>
        ["/materials", "/questions", "/exams"].includes(i.href),
      ),
    },
    {
      title: "Tương tác & Hỗ trợ",
      items: available.filter((i) =>
        ["/forum", "/messages", "/support", "/learning-history"].includes(i.href),
      ),
    },
    {
      title: "Quản trị & Vận hành",
      items: available.filter((i) =>
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

  return (
    <div className="flex h-full flex-col bg-white dark:bg-[#0b111c] border-r border-slate-200 dark:border-slate-800/80 transition-colors">
      <div className="flex h-15 items-center gap-3 border-b border-slate-200 dark:border-slate-800/80 px-5">
        <div className="grid size-9 place-items-center rounded-lg bg-emerald-600 text-white font-bold shadow-xs">
          <GraduationCap size={19} />
        </div>
        <div className="min-w-0">
          <p className="font-bold text-base tracking-tight text-slate-900 dark:text-slate-100">
            Wind EDU
          </p>
          <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400 truncate">
            Trung tâm đào tạo số
          </p>
        </div>
      </div>

      <nav aria-label="Điều hướng chính" className="flex-1 overflow-y-auto px-3 py-4 space-y-5">
        {sections.map((section) => (
          <div key={section.title} className="space-y-0.5">
            <p className="px-3 pb-1 text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
              {section.title}
            </p>
            {section.items.map(({ href, label, icon: Icon }) => {
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
                  className={`group flex min-h-9 items-center gap-3 rounded-lg px-3 py-2 text-sm font-semibold transition-all duration-150 ${
                    active
                      ? "bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 border-l-2 border-emerald-600 dark:border-emerald-500 pl-[10px]"
                      : "text-slate-600 dark:text-slate-400 hover:bg-slate-100/70 dark:hover:bg-slate-800/50 hover:text-slate-900 dark:hover:text-slate-200"
                  }`}
                  href={href}
                  key={href}
                  onClick={close}
                >
                  <Icon
                    className={`shrink-0 transition-colors ${
                      active
                        ? "text-emerald-600 dark:text-emerald-400"
                        : "text-slate-400 dark:text-slate-500 group-hover:text-slate-600 dark:group-hover:text-slate-300"
                    }`}
                    size={17}
                  />
                  <span className="truncate">{t(resolvedLabel)}</span>
                </Link>
              );
            })}
          </div>
        ))}
      </nav>
    </div>
  );
}

/** Khung workspace responsive chứa sidebar, header, theme toggle, thông báo và menu tài khoản. */
export function WorkspaceShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const [notificationOpen, setNotificationOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [notifications, setNotifications] = useState<LearningNotification[]>([]);
  const [notificationLoading, setNotificationLoading] = useState(true);
  const [notificationError, setNotificationError] = useState("");
  const notificationRef = useRef<HTMLDivElement>(null);
  const { session, setRole, logout, notify } = useApp();
  const { formatDateTime } = useI18n();
  const unreadCount = notifications.filter((item) => !item.readAt).length;

  /** Tải lại thông báo theo vai trò hiện tại và quản lý trạng thái lỗi/loading. */
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
      if (event.key !== "Escape") return;
      setNotificationOpen(false);
      setProfileOpen(false);
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

  /** Đánh dấu một thông báo chưa đọc rồi thay đúng item trong state. */
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
        error instanceof Error
          ? error.message
          : "Không thể cập nhật thông báo.",
        "error",
      );
    }
  }

  /** Đánh dấu song song toàn bộ thông báo chưa đọc và hợp nhất kết quả theo id. */
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
        error instanceof Error
          ? error.message
          : "Không thể đánh dấu toàn bộ thông báo.",
        "error",
      );
    }
  }

  /** Ánh xạ định danh nghiệp vụ chuẩn sang đúng đối tượng. */
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

  /** Thu hồi phiên rồi thay route hiện tại bằng màn hình đăng nhập. */
  async function signOut(): Promise<void> {
    await logout();
    router.replace("/login");
  }

  return (
    <div className="min-h-screen bg-[var(--canvas)] text-[var(--text-main)]">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 lg:block">
        <Sidebar />
      </aside>

      {menuOpen ? (
        <MobileDrawer onClose={() => setMenuOpen(false)}>
          <Sidebar close={() => setMenuOpen(false)} />
        </MobileDrawer>
      ) : null}

      <div className="lg:pl-64">
        <a
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-2 focus:z-[90] focus:rounded-lg focus:bg-white dark:focus:bg-slate-900 focus:p-3 focus:text-slate-900 dark:focus:text-slate-100 shadow-md"
          href="#workspace-main"
        >
          Đi tới nội dung chính
        </a>

        {/* Header tối giản chuẩn mực */}
        <header className="sticky top-0 z-20 flex min-h-15 flex-wrap items-center justify-between gap-y-2 border-b border-slate-200 dark:border-slate-800/80 bg-white/80 dark:bg-[#0b111c]/80 px-4 py-2.5 backdrop-blur-md md:px-7">
          <div className="flex min-w-0 items-center gap-3">
            <button
              aria-label="Mở menu"
              aria-expanded={menuOpen}
              aria-haspopup="dialog"
              className="grid size-9 shrink-0 place-items-center rounded-lg border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 lg:hidden transition-colors shadow-2xs"
              onClick={() => {
                setNotificationOpen(false);
                setProfileOpen(false);
                setMenuOpen(true);
              }}
              type="button"
            >
              <Menu size={17} />
            </button>
            <div className="min-w-0 max-[359px]:hidden flex items-center gap-2.5">
              <span className="font-bold text-sm sm:text-base text-slate-900 dark:text-slate-100 tracking-tight">
                Wind EDU
              </span>
              <span className="hidden sm:inline-block text-slate-300 dark:text-slate-700">|</span>
              <span className="hidden sm:inline-block text-xs font-medium text-slate-500 dark:text-slate-400 truncate">
                Nền tảng đào tạo & giảng dạy số
              </span>
            </div>
          </div>

          <div className="relative flex max-w-full flex-wrap items-center justify-end gap-2 md:gap-3">
            {/* Role indicator pill */}
            <div className="hidden lg:flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200/80 dark:border-emerald-800/60 text-emerald-800 dark:text-emerald-300 text-xs font-semibold shadow-2xs">
              <span className="size-1.5 rounded-full bg-emerald-500 animate-pulse" />
              {session.user.roleName}
            </div>

            {session.availableRoles.length > 1 ? (
              <>
                <label className="sr-only" htmlFor="role-switcher">
                  Vai trò đang sử dụng
                </label>
                <select
                  className="min-h-9 w-32 shrink-0 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-2.5 py-1 text-xs font-semibold text-slate-800 dark:text-slate-200 outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/15 md:w-auto shadow-2xs cursor-pointer"
                  id="role-switcher"
                  onChange={(event) =>
                    void setRole(event.target.value as RoleCode)
                  }
                  value={session.roleCode}
                >
                  {session.availableRoles.map((role) => (
                    <option key={role.code} value={role.code}>
                      {role.name}
                    </option>
                  ))}
                </select>
              </>
            ) : null}

            <ThemeToggle />
            <LanguageSwitcher compact />

            {/* Notification button & popover */}
            <div className="relative" ref={notificationRef}>
              <button
                aria-controls="notification-center"
                aria-expanded={notificationOpen}
                aria-label={
                  unreadCount
                    ? `Thông báo, ${unreadCount} chưa đọc`
                    : "Thông báo"
                }
                className="relative grid size-9.5 place-items-center rounded-lg border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:border-emerald-500 hover:text-emerald-600 dark:hover:text-emerald-400 bg-white dark:bg-slate-900/90 transition-colors shadow-2xs active:scale-95"
                onClick={() => {
                  setNotificationOpen((open) => !open);
                  setProfileOpen(false);
                }}
                type="button"
              >
                <Bell size={17} />
                {unreadCount ? (
                  <span className="absolute -right-1 -top-1 grid min-w-4 place-items-center rounded-full bg-emerald-600 px-1 text-[10px] font-bold leading-4 text-white ring-2 ring-white dark:ring-slate-900 shadow-xs">
                    {unreadCount > 9 ? "9+" : unreadCount}
                  </span>
                ) : null}
              </button>

              {notificationOpen ? (
                <section
                  aria-label="Trung tâm thông báo"
                  className="absolute right-0 top-11 z-30 w-[min(23rem,calc(100vw-2rem))] overflow-hidden rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xl dark:shadow-2xl"
                  id="notification-center"
                >
                  <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 px-4 py-3 bg-slate-50/50 dark:bg-slate-800/30">
                    <div>
                      <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                        Thông báo
                      </h2>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400">
                        {unreadCount
                          ? `${unreadCount} mục chưa đọc`
                          : "Đã đọc tất cả"}
                      </p>
                    </div>
                    <button
                      className="inline-flex min-h-8 items-center gap-1.5 rounded-md px-2 text-xs font-semibold text-emerald-600 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 disabled:text-slate-300 dark:disabled:text-slate-700 transition-colors"
                      disabled={!unreadCount}
                      onClick={() => void markAllRead()}
                      type="button"
                    >
                      <CheckCheck size={14} />
                      Đọc tất cả
                    </button>
                  </div>
                  <div className="max-h-[min(30rem,68dvh)] overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800/50">
                    {notificationLoading ? (
                      <div className="flex min-h-36 items-center justify-center gap-2 text-xs font-semibold text-slate-500">
                        <LoaderCircle
                          className="animate-spin text-emerald-600"
                          size={18}
                        />
                        Đang tải…
                      </div>
                    ) : notificationError ? (
                      <div className="grid min-h-36 place-items-center px-4 text-center">
                        <div>
                          <p className="text-xs font-semibold text-rose-600 dark:text-rose-400">
                            {notificationError}
                          </p>
                          <button
                            className="mt-2 text-xs font-semibold text-emerald-600 hover:underline"
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
                              : "bg-emerald-50/50 dark:bg-emerald-950/20"
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
                                item.readAt ? "bg-slate-300 dark:bg-slate-700" : "bg-emerald-500"
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
                          <Bell
                            className="mx-auto text-slate-300 dark:text-slate-700"
                            size={24}
                          />
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

            {/* Profile menu */}
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
                aria-controls="profile-menu"
                aria-expanded={profileOpen}
                aria-haspopup="menu"
                aria-label="Mở menu tài khoản"
                className="flex min-h-10 items-center gap-2 rounded-lg px-1.5 text-left transition hover:bg-slate-100 dark:hover:bg-slate-800 sm:pr-2"
                onClick={() => setProfileOpen((open) => !open)}
                type="button"
              >
                <div className="hidden min-w-0 text-right md:block">
                  <p className="max-w-36 truncate text-xs font-bold text-slate-900 dark:text-slate-100">
                    {session.user.name}
                  </p>
                  <p className="max-w-36 truncate text-[11px] text-slate-500 dark:text-slate-400">
                    {session.user.roleName}
                  </p>
                </div>
                <UserAvatar
                  avatarUrl={session.user.avatarUrl}
                  name={session.user.name}
                  priority
                />
                <ChevronDown
                  className={`hidden text-slate-400 dark:text-slate-500 transition-transform sm:block ${
                    profileOpen ? "rotate-180" : ""
                  }`}
                  size={14}
                />
              </button>

              {profileOpen ? (
                <div className="absolute right-0 top-full z-40 pt-1.5">
                  <section
                    aria-label="Menu tài khoản"
                    className="w-48 overflow-hidden rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-1.5 shadow-xl dark:shadow-2xl"
                    id="profile-menu"
                    role="menu"
                  >
                    <Link
                      className="flex min-h-9 items-center gap-2.5 rounded-lg px-2.5 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                      href="/account"
                      onClick={() => setProfileOpen(false)}
                      role="menuitem"
                    >
                      <UserRoundCog size={15} />
                      Thông tin tài khoản
                    </Link>
                    <button
                      className="flex min-h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-xs font-semibold text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors"
                      onClick={() => void signOut()}
                      role="menuitem"
                      type="button"
                    >
                      <LogOut size={15} />
                      Đăng xuất
                    </button>
                  </section>
                </div>
              ) : null}
            </div>
          </div>
        </header>

        <main id="workspace-main" tabIndex={-1} className="outline-none">
          {children}
        </main>
      </div>
    </div>
  );
}
