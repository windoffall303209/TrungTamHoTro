import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DashboardHome } from "./dashboard-home";

const apiRequest = vi.fn();
const useApp = vi.fn();

vi.mock("@/lib/api-client", () => ({ apiRequest: (...args: unknown[]) => apiRequest(...args) }));
vi.mock("@/providers/app-provider", () => ({ useApp: () => useApp() }));

describe("DashboardHome", () => {
  beforeEach(() => { apiRequest.mockReset(); useApp.mockReset(); });
  afterEach(cleanup);

  it("chỉ hiển thị phân hệ thuộc quyền học viên và lấy số liệu thật", async () => {
    useApp.mockReturnValue({ session: { roleCode: "LEARNER", permissions: ["course:view", "class:view", "material:view", "exam:view", "forum:view", "forum:post", "session:view", "support:create"], user: { roleName: "Học viên" } } });
    apiRequest.mockImplementation((path: string) => Promise.resolve(path === "/learner/classes"
      ? [{ status: "ACTIVE" }, { status: "CLOSED" }]
      : path === "/learner/exams"
        ? [{ availabilityStatus: "AVAILABLE" }, { availabilityStatus: "CLOSED" }]
        : [{ attempt: { id: "attempt-1" } }]));

    render(<DashboardHome />);
    await waitFor(() => expect(screen.getByText("bài có thể thực hiện")).toBeInTheDocument());
    expect(screen.getByText("Kho học liệu")).toBeInTheDocument();
    expect(screen.queryByText("Ngân hàng câu hỏi")).not.toBeInTheDocument();
    expect(screen.getAllByText("1", { selector: "p" })).toHaveLength(3);
    expect(apiRequest).toHaveBeenCalledTimes(3);
  });

  it("hiển thị trạng thái suy giảm thay vì số liệu dựng sẵn cho quản trị", async () => {
    useApp.mockReturnValue({ session: { roleCode: "SYSTEM_ADMIN", permissions: ["user:view", "role:view", "system:configure", "material:view", "question:view", "forum:view", "session:view"], user: { roleName: "Quản trị hệ thống" } } });
    apiRequest.mockImplementation((path: string) => Promise.resolve(path === "/admin/users"
      ? [{ status: "ACTIVE" }, { status: "LOCKED" }]
      : path === "/admin/roles"
        ? [{ code: "SYSTEM_ADMIN" }, { code: "LEARNER" }]
        : path === "/system/health-overview"
          ? { status: "degraded", database: "disabled" }
          : []));

    render(<DashboardHome />);
    expect(await screen.findByText("Suy giảm")).toBeInTheDocument();
    expect(screen.getByText("dịch vụ · CSDL disabled")).toBeInTheDocument();
    expect(screen.getByText("Người dùng")).toBeInTheDocument();
    expect(screen.getByText("Vai trò & quyền")).toBeInTheDocument();
    expect(screen.queryByText("Nghiệp vụ giảng dạy")).not.toBeInTheDocument();
    expect(screen.queryByText("100%")).not.toBeInTheDocument();
  });
});
