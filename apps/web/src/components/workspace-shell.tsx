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
    roles: ["SYSTEM_ADMIN"],
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

/** Lọc mục điều hướng theo vai trò/quyền và đánh dấu route đang hoạt động. */
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

  return (
    <div className="flex h-full flex-col bg-[var(--nav)] text-[var(--nav-text)]">
      <div className="flex h-16 items-center gap-3 border-b border-white/15 px-5">
        <div className="grid size-10 place-items-center rounded-xl border border-white/25 bg-[var(--accent)] text-[var(--action-ink)]">
          <GraduationCap size={20} />
        </div>
        <div>
          <p className="font-heading text-lg font-bold tracking-[-0.025em]">
            Wind EDU
          </p>
          <p className="text-xs font-bold text-[var(--nav-muted)]">
            Sổ giáo vụ số
          </p>
        </div>
      </div>
      <nav
        aria-label="Điều hướng chính"
        className="flex-1 overflow-y-auto px-3 py-5"
      >
        <p className="mb-3 px-3 text-xs font-bold text-[var(--nav-subtle)]">
          Không gian chung
        </p>
        <div className="space-y-1">
          {available.map(({ href, label, icon: Icon }) => {
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
                className={`group flex min-h-11 items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-semibold transition ${active ? "bg-[var(--surface)] text-[var(--ink)]" : "text-[var(--nav-muted)] hover:bg-[var(--surface)]/8 hover:text-[var(--nav-text)]"}`}
                href={href}
                key={href}
                onClick={close}
              >
                <Icon
                  className={
                    active
                      ? "text-[var(--accent)]"
                      : "text-[var(--nav-subtle)] group-hover:text-[var(--nav-text)]"
                  }
                  size={18}
                />
                {t(resolvedLabel)}
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}

/** Khung workspace responsive chứa sidebar, header, theme, thông báo và menu tài khoản. */
export function WorkspaceShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const [notificationOpen, setNotificationOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [notifications, setNotifications] = useState<LearningNotification[]>(
    [],
  );
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

  // Đóng mọi overlay bằng Escape và khóa cuộn nền khi menu mobile mở.
  useEffect(() => {
    window.queueMicrotask(() => {
      void loadNotifications();
    });
  }, [loadNotifications]);

  useEffect(() => {
    if (!notificationOpen && !profileOpen) return;
    /** Đóng các lớp nổi trên cùng bằng Escape để bảo đảm thao tác bàn phím nhất quán. */
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

  // Đóng trung tâm thông báo khi người dùng bấm ra ngoài cả nút mở và bảng nội dung.
  useEffect(() => {
    if (!notificationOpen) return;
    /** Đóng danh sách thông báo khi người dùng nhấn bên ngoài vùng thông báo. */
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!notificationRef.current?.contains(event.target as Node))
        setNotificationOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    return () =>
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
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

  /** Ánh xạ định danh nghiệp vụ chuẩn sang đúng đối tượng và giữ liên kết sâu. */
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
    <div className="min-h-screen bg-[var(--canvas)] text-[var(--ink)]">
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
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-2 focus:z-[90] focus:rounded-lg focus:bg-[var(--surface)] focus:p-3 focus:text-[var(--ink)]"
          href="#workspace-main"
        >
          Đi tới nội dung chính
        </a>
        <header className="sticky top-0 z-20 flex min-h-16 flex-wrap items-center justify-between gap-y-2 border-b border-[var(--rule-strong)] bg-[var(--canvas)]/92 px-4 py-2 backdrop-blur md:px-7">
          <div className="flex min-w-0 items-center gap-3">
            <button
              aria-label="Mở menu"
              aria-expanded={menuOpen}
              aria-haspopup="dialog"
              className="grid size-11 shrink-0 place-items-center rounded-lg border border-[var(--rule-strong)] text-[var(--ink)] lg:hidden"
              onClick={() => {
                setNotificationOpen(false);
                setProfileOpen(false);
                setMenuOpen(true);
              }}
              type="button"
            >
              <Menu size={20} />
            </button>
            <div className="min-w-0 max-[359px]:hidden">
              <p className="text-sm font-bold leading-5 text-[var(--ink)] sm:text-[1.05rem]">
                <span className="sm:hidden">Wind EDU</span>
                <span className="hidden sm:inline">
                  Trung tâm hỗ trợ giảng dạy
                </span>
              </p>
              <p className="mt-0.5 hidden text-[0.9rem] leading-[1.125rem] text-[var(--ink-soft)] sm:block">
                Một không gian vận hành theo vai trò
              </p>
            </div>
          </div>
          <div className="relative flex max-w-full flex-wrap items-center justify-end gap-2 md:gap-3">
            {session.availableRoles.length > 1 ? (
              <>
                <label className="sr-only" htmlFor="role-switcher">
                  Vai trò đang sử dụng
                </label>
                <select
                  className="min-h-11 w-36 shrink-0 rounded-xl border border-[var(--rule-strong)] bg-[var(--surface)] px-3 py-2 text-xs font-bold text-[var(--ink)] outline-none transition focus:border-[var(--accent)] focus:ring-3 focus:ring-[var(--accent)]/15 md:w-auto md:text-sm"
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
            <div className="relative" ref={notificationRef}>
              <button
                aria-controls="notification-center"
                aria-expanded={notificationOpen}
                aria-label={
                  unreadCount
                    ? `Thông báo, ${unreadCount} chưa đọc`
                    : "Thông báo"
                }
                className="relative grid size-11 place-items-center rounded-full border border-[var(--rule-strong)] text-[var(--ink-soft)] hover:border-[var(--accent)] hover:text-[var(--accent)]"
                onClick={() => {
                  setNotificationOpen((open) => !open);
                  setProfileOpen(false);
                }}
                type="button"
              >
                <Bell size={17} />
                {unreadCount ? (
                  <span className="absolute -right-1 -top-1 grid min-w-4 place-items-center rounded-full bg-[var(--accent-deep)] px-1 text-[10px] font-extrabold leading-4 text-[var(--action-ink)] ring-2 ring-[var(--canvas)]">
                    {unreadCount > 9 ? "9+" : unreadCount}
                  </span>
                ) : null}
              </button>
              {notificationOpen ? (
                <section
                  aria-label="Trung tâm thông báo"
                  className="absolute right-0 top-12 z-30 w-[min(24rem,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-[var(--rule)] bg-[var(--surface)] shadow-[var(--popover-shadow)]"
                  id="notification-center"
                >
                  <div className="flex items-center justify-between border-b border-[var(--rule)] px-5 py-4">
                    <div>
                      <h2 className="font-heading text-base font-extrabold">
                        Thông báo
                      </h2>
                      <p className="mt-0.5 text-xs text-[var(--ink-soft)]">
                        {unreadCount
                          ? `${unreadCount} mục chưa đọc`
                          : "Đã đọc tất cả"}
                      </p>
                    </div>
                    <button
                      className="inline-flex min-h-11 items-center gap-1.5 rounded-lg px-2 text-xs font-extrabold text-[var(--accent-ink)] hover:bg-[var(--surface-muted)] disabled:text-[var(--rule-strong)]"
                      disabled={!unreadCount}
                      onClick={() => void markAllRead()}
                      type="button"
                    >
                      <CheckCheck size={15} />
                      Đọc tất cả
                    </button>
                  </div>
                  <div className="max-h-[min(32rem,70dvh)] overflow-y-auto">
                    {notificationLoading ? (
                      <div className="flex min-h-40 items-center justify-center gap-2 text-sm font-semibold text-[var(--ink-soft)]">
                        <LoaderCircle
                          className="animate-spin text-[var(--accent)]"
                          size={19}
                        />
                        Đang tải…
                      </div>
                    ) : notificationError ? (
                      <div className="grid min-h-40 place-items-center px-5 text-center">
                        <div>
                          <p className="text-sm font-bold text-[var(--danger)]">
                            {notificationError}
                          </p>
                          <button
                            className="action-link mt-2"
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
                          className={`block min-h-16 border-b border-[var(--rule)] px-5 py-4 transition last:border-0 hover:bg-[var(--surface-muted)]/65 ${item.readAt ? "bg-[var(--surface)]" : "bg-[var(--accent-soft)]/60"}`}
                          href={notificationHref(item)}
                          key={item.id}
                          onClick={() => {
                            void markRead(item);
                            setNotificationOpen(false);
                          }}
                        >
                          <div className="flex items-start gap-3">
                            <span
                              className={`mt-1.5 size-2 shrink-0 rounded-full ${item.readAt ? "bg-[var(--rule-strong)]" : "bg-[var(--accent)]"}`}
                            />
                            <div>
                              <p className="text-sm font-bold text-[var(--ink)]">
                                {item.title}
                              </p>
                              <p className="mt-1 text-xs text-[var(--ink-soft)]">
                                {formatDateTime(item.createdAt)}
                              </p>
                            </div>
                          </div>
                        </Link>
                      ))
                    ) : (
                      <div className="grid min-h-40 place-items-center px-5 text-center">
                        <div>
                          <Bell
                            className="mx-auto text-[var(--rule-strong)]"
                            size={28}
                          />
                          <p className="mt-2 text-sm font-bold text-[var(--ink-soft)]">
                            Chưa có thông báo
                          </p>
                        </div>
                      </div>
                    )}
                  </div>
                </section>
              ) : null}
            </div>
            <div
              className="relative"
              onBlur={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget))
                  setProfileOpen(false);
              }}
              onMouseEnter={() => setProfileOpen(true)}
              onMouseLeave={() => setProfileOpen(false)}
            >
              <button
                aria-controls="profile-menu"
                aria-expanded={profileOpen}
                aria-haspopup="menu"
                aria-label="Mở menu tài khoản"
                className="flex min-h-12 items-center gap-2 rounded-xl px-1.5 text-left transition hover:bg-[var(--surface-muted)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] sm:pr-2"
                onClick={() => setProfileOpen((open) => !open)}
                type="button"
              >
                <div className="hidden min-w-0 text-right md:block">
                  <p className="max-w-40 truncate text-sm font-extrabold text-[var(--ink)]">
                    {session.user.name}
                  </p>
                  <p className="mt-0.5 max-w-40 truncate text-xs text-[var(--ink-soft)]">
                    {session.user.roleName}
                  </p>
                </div>
                <UserAvatar
                  avatarUrl={session.user.avatarUrl}
                  name={session.user.name}
                  priority
                />
                <ChevronDown
                  className={`hidden text-[var(--ink-muted)] transition-transform sm:block ${profileOpen ? "rotate-180" : ""}`}
                  size={15}
                />
              </button>
              {profileOpen ? (
                <div className="absolute right-0 top-full z-40 pt-2">
                  <section
                    aria-label="Menu tài khoản"
                    className="w-[min(14rem,calc(100vw-2rem))] overflow-hidden rounded-xl border border-[var(--rule)] bg-[var(--surface)] p-2 shadow-[var(--popover-shadow)]"
                    id="profile-menu"
                    role="menu"
                  >
                    <Link
                      className="flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm font-bold text-[var(--ink)] hover:bg-[var(--surface-muted)]"
                      href="/account"
                      onClick={() => setProfileOpen(false)}
                      role="menuitem"
                    >
                      <UserRoundCog size={17} />
                      Thông tin
                    </Link>
                    <button
                      className="flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-sm font-bold text-[var(--danger)] hover:bg-[var(--accent-soft)]"
                      onClick={() => void signOut()}
                      role="menuitem"
                      type="button"
                    >
                      <LogOut size={17} />
                      Đăng xuất
                    </button>
                  </section>
                </div>
              ) : null}
            </div>
          </div>
        </header>
        <main id="workspace-main" tabIndex={-1}>
          {children}
        </main>
      </div>
    </div>
  );
}
