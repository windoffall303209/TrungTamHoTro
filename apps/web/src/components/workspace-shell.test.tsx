import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkspaceShell } from "./workspace-shell";

const apiRequest = vi.fn();
const notify = vi.fn();
const useApp = vi.fn();

vi.mock("@/lib/api-client", () => ({ apiRequest: (...args: unknown[]) => apiRequest(...args) }));
vi.mock("@/providers/app-provider", () => ({
  useApp: () => useApp(),
}));
vi.mock("next/navigation", () => ({ usePathname: () => "/dashboard", useRouter: () => ({ replace: vi.fn() }) }));

describe("WorkspaceShell", () => {
  afterEach(() => cleanup());

  beforeEach(() => {
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

  it("hiển thị số chưa đọc và đánh dấu toàn bộ thông báo", async () => {
    render(<WorkspaceShell><p>Nội dung</p></WorkspaceShell>);
    const trigger = await screen.findByRole("button", { name: "Thông báo, 1 chưa đọc" });
    fireEvent.click(trigger);
    expect(screen.getByText("Điểm đã được công bố")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Đọc tất cả/i }));
    await waitFor(() => expect(apiRequest).toHaveBeenCalledWith("/notifications/notice-1/read", { method: "PATCH", roleCode: "LEARNER" }));
    await waitFor(() => expect(screen.getByText("Đã đọc tất cả")).toBeInTheDocument());
  });

  it("mở đầy đủ phân hệ quản trị theo ma trận quyền nhưng không lộ thao tác cá nhân của học viên", async () => {
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

    expect(screen.getAllByRole("link", { name: /Khóa học & lớp/i })).not.toHaveLength(0);
    expect(screen.getAllByRole("link", { name: /Ngân hàng câu hỏi/i })).not.toHaveLength(0);
    expect(screen.getAllByRole("link", { name: /Điều hành lớp/i })).not.toHaveLength(0);
    expect(screen.getAllByRole("link", { name: /Nghiệp vụ giảng dạy/i })).not.toHaveLength(0);
    expect(screen.queryAllByRole("link", { name: /Lịch sử học tập/i })).toHaveLength(0);
  });
});
