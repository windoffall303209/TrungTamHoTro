import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WorkspaceShell } from "./workspace-shell";

const apiRequest = vi.fn();
const notify = vi.fn();

vi.mock("@/lib/api-client", () => ({ apiRequest: (...args: unknown[]) => apiRequest(...args) }));
vi.mock("@/providers/app-provider", () => ({
  useApp: () => ({
    session: { roleCode: "LEARNER", availableRoles: [{ code: "LEARNER", name: "Học viên" }], user: { id: "usr-learner", name: "Lê Hoàng Nam", roleName: "Học viên" } },
    setRole: vi.fn(),
    logout: vi.fn(),
    notify,
  }),
}));
vi.mock("next/navigation", () => ({ usePathname: () => "/dashboard", useRouter: () => ({ replace: vi.fn() }) }));

describe("WorkspaceShell", () => {
  beforeEach(() => {
    apiRequest.mockReset();
    notify.mockReset();
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
});
