import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkspaceShell } from "../../../../src/shared/layout/workspace-shell";

const apiRequest = vi.fn();
const notify = vi.fn();
const useApp = vi.fn();

vi.mock("@/lib/api-client", () => ({ apiRequest: (...args: unknown[]) => apiRequest(...args), publicApiUrl: (path: string) => `http://localhost:4000/api/v1${path}` }));
vi.mock("@/providers/app-provider", () => ({
  useApp: () => useApp(),
}));
vi.mock("@/providers/i18n-provider", () => ({
  useI18n: () => ({ locale: "vi-VN", setLocale: vi.fn(), t: (value: string) => value, formatDateTime: (value: string) => new Date(value).toLocaleString("vi-VN"), formatNumber: (value: number) => String(value) }),
}));
vi.mock("next/navigation", () => ({ usePathname: () => "/dashboard", useRouter: () => ({ replace: vi.fn() }) }));

describe("WorkspaceShell", () => {
  afterEach(() => {
    cleanup();
    document.documentElement.classList.remove("theme-changing");
    delete document.documentElement.dataset.theme;
    window.localStorage.clear();
  });

  beforeEach(() => {
    document.documentElement.dataset.theme = "light";
    apiRequest.mockReset();
    notify.mockReset();
    useApp.mockReset();
    useApp.mockReturnValue({
      session: { roleCode: "LEARNER", permissions: ["course:view", "class:view", "material:view", "exam:view", "forum:view", "forum:post", "session:view", "support:create"], availableRoles: [{ code: "LEARNER", name: "Học viên" }], user: { id: "usr-learner", name: "Lê Hoàng Nam", roleName: "Học viên" } },
      setRole: vi.fn(),
      logout: vi.fn(),
      notify,
    });
    apiRequest.mockImplementation((path: string) => Promise.resolve(path === "/notifications"
      ? [{ id: "notice-1", recipientId: "usr-learner", type: "GRADE_PUBLISHED", title: "Điểm đã được công bố", entityType: "ExamAttempt", entityId: "attempt-1", createdAt: "2026-08-27T07:00:00.000Z" }]
      : { id: "notice-1", recipientId: "usr-learner", type: "GRADE_PUBLISHED", title: "Điểm đã được công bố", entityType: "ExamAttempt", entityId: "attempt-1", readAt: "2026-08-27T08:00:00.000Z", createdAt: "2026-08-27T07:00:00.000Z" }));
  });

  it("đặt nút giao diện trước thông báo và lưu lựa chọn sáng tối", async () => {
    render(<WorkspaceShell><p>Nội dung</p></WorkspaceShell>);

    const themeToggle = await screen.findByRole("button", { name: "Chuyển sang giao diện tối" });
    const notification = await screen.findByRole("button", { name: "Thông báo, 1 chưa đọc" });
    expect(themeToggle.compareDocumentPosition(notification) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    fireEvent.click(themeToggle);
    expect(document.documentElement).toHaveAttribute("data-theme", "dark");
    expect(window.localStorage.getItem("wind-edu-theme")).toBe("dark");
    expect(screen.getByRole("button", { name: "Chuyển sang giao diện sáng" })).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(screen.getByRole("button", { name: "Chuyển sang giao diện sáng" }));
    expect(document.documentElement).toHaveAttribute("data-theme", "light");
    expect(window.localStorage.getItem("wind-edu-theme")).toBe("light");
  });

  it("hiển thị số chưa đọc và đánh dấu toàn bộ thông báo", async () => {
    render(<WorkspaceShell><p>Nội dung</p></WorkspaceShell>);
    const trigger = await screen.findByRole("button", { name: "Thông báo, 1 chưa đọc" });
    fireEvent.click(trigger);
    expect(screen.getByText("Điểm đã được công bố")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Đọc tất cả/i }));
    await waitFor(() => expect(apiRequest).toHaveBeenCalledWith("/notifications/notice-1/read", { method: "PATCH", roleCode: "LEARNER" }));
    await waitFor(() => expect(screen.getByText("Đã đọc tất cả")).toBeInTheDocument());
  });

  it("đóng bảng thông báo khi bấm ra ngoài", async () => {
    render(<WorkspaceShell><p>Nội dung bên ngoài</p></WorkspaceShell>);
    fireEvent.click(await screen.findByRole("button", { name: "Thông báo, 1 chưa đọc" }));
    expect(screen.getByRole("region", { name: "Trung tâm thông báo" })).toBeInTheDocument();
    fireEvent.pointerDown(screen.getByText("Nội dung bên ngoài"));
    expect(screen.queryByRole("region", { name: "Trung tâm thông báo" })).not.toBeInTheDocument();
  });

  it("đưa thông tin người dùng lên header và mở menu tài khoản khi rê chuột", async () => {
    render(<WorkspaceShell><p>Nội dung</p></WorkspaceShell>);
    await screen.findByRole("button", { name: "Thông báo, 1 chưa đọc" });

    const trigger = screen.getByRole("button", { name: "Mở menu tài khoản" });
    expect(screen.getByText("Lê Hoàng Nam")).toBeInTheDocument();
    fireEvent.mouseEnter(trigger.parentElement!);

    expect(screen.getByRole("menuitem", { name: "Thông tin" })).toHaveAttribute("href", "/account");
    expect(screen.getByRole("menuitem", { name: "Đăng xuất" })).toBeInTheDocument();
    fireEvent.mouseLeave(trigger.parentElement!);
    fireEvent.click(trigger);
    expect(screen.getByRole("menuitem", { name: "Thông tin" })).toBeInTheDocument();
  });

  it("giữ toàn bộ quyền giám sát chung cho quản trị hệ thống nhưng không trộn không gian cá nhân", async () => {
    useApp.mockReturnValue({
      session: {
        roleCode: "SYSTEM_ADMIN",
        permissions: ["user:view", "role:view", "course:view", "course:manage", "class:view", "class:manage", "material:view", "material:manage", "question:view", "question:manage", "exam:view", "exam:manage", "forum:view", "forum:moderate", "session:view", "session:manage", "report:view", "support:manage", "system:configure"],
        availableRoles: [{ code: "SYSTEM_ADMIN", name: "Quản trị hệ thống" }],
        user: { id: "usr-admin", name: "Quản trị viên", roleName: "Quản trị hệ thống" },
      },
      setRole: vi.fn(),
      logout: vi.fn(),
      notify,
    });

    render(<WorkspaceShell><p>Nội dung</p></WorkspaceShell>);

    expect(screen.getAllByRole("link", { name: /Người dùng/i })).not.toHaveLength(0);
    expect(screen.getAllByRole("link", { name: /Vai trò & quyền/i })).not.toHaveLength(0);
    expect(screen.getAllByRole("link", { name: /Khóa học & lớp/i })).not.toHaveLength(0);
    expect(screen.getAllByRole("link", { name: /Kho học liệu/i })).not.toHaveLength(0);
    expect(screen.getAllByRole("link", { name: /Ngân hàng câu hỏi/i })).not.toHaveLength(0);
    expect(screen.getAllByRole("link", { name: /Điều hành lớp/i })).not.toHaveLength(0);
    expect(screen.getAllByRole("link", { name: /Cấu hình/i })).not.toHaveLength(0);
    expect(screen.queryAllByRole("link", { name: /Nghiệp vụ giảng dạy/i })).toHaveLength(0);
    expect(screen.queryAllByRole("link", { name: /Lịch & bài tập/i })).toHaveLength(0);
    expect(screen.queryAllByRole("link", { name: /Lịch sử học tập/i })).toHaveLength(0);
  });

  it("không hiển thị nghiệp vụ giảng dạy cho quản lý trung tâm", () => {
    useApp.mockReturnValue({
      session: { roleCode: "CENTER_MANAGER", permissions: ["class:view", "class:manage", "question:view", "exam:manage", "session:manage"], availableRoles: [{ code: "CENTER_MANAGER", name: "Quản lý trung tâm" }], user: { id: "usr-manager", name: "Quản lý", roleName: "Quản lý trung tâm" } },
      setRole: vi.fn(), logout: vi.fn(), notify,
    });

    render(<WorkspaceShell><p>Nội dung</p></WorkspaceShell>);

    expect(screen.getAllByRole("link", { name: /Điều hành lớp/i })).not.toHaveLength(0);
    expect(screen.queryAllByRole("link", { name: /Nghiệp vụ giảng dạy/i })).toHaveLength(0);
    expect(screen.queryAllByRole("link", { name: /Ngân hàng câu hỏi/i })).toHaveLength(0);
  });

  it("hiển thị nghiệp vụ giảng dạy cho giảng viên đủ quyền", () => {
    useApp.mockReturnValue({
      session: { roleCode: "INSTRUCTOR", permissions: ["question:view", "question:manage", "exam:manage", "session:manage"], availableRoles: [{ code: "INSTRUCTOR", name: "Giảng viên" }], user: { id: "usr-instructor", name: "Giảng viên", roleName: "Giảng viên" } },
      setRole: vi.fn(), logout: vi.fn(), notify,
    });

    render(<WorkspaceShell><p>Nội dung</p></WorkspaceShell>);

    expect(screen.getAllByRole("link", { name: /Nghiệp vụ giảng dạy/i })).not.toHaveLength(0);
    expect(screen.getAllByRole("link", { name: /Ngân hàng câu hỏi/i })).not.toHaveLength(0);
  });
});
