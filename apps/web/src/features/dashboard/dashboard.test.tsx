import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DashboardHome } from "@/features/dashboard/dashboard-home";

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
        : path === "/academic/assignments"
          ? [{ status: "PUBLISHED", dueAt: "2099-01-01T00:00:00.000Z" }, { status: "CLOSED", dueAt: "2099-01-01T00:00:00.000Z" }]
          : [{ attempt: { id: "attempt-1" } }]));

    render(<DashboardHome />);
    await waitFor(() => expect(screen.getByText("bài tập và bài thi cần làm")).toBeInTheDocument());
    expect(screen.getByText("Kho học liệu")).toBeInTheDocument();
    expect(screen.queryByText("Ngân hàng câu hỏi")).not.toBeInTheDocument();
    expect(screen.getAllByText("1", { selector: "p" })).toHaveLength(2);
    expect(screen.getByText("2", { selector: "p" })).toBeInTheDocument();
    expect(apiRequest).toHaveBeenCalledTimes(4);
  });

  it("hiển thị trạng thái suy giảm thay vì số liệu dựng sẵn cho quản trị", async () => {
    useApp.mockReturnValue({ session: { roleCode: "SYSTEM_ADMIN", permissions: ["user:view", "role:view", "system:configure", "course:view", "class:view", "class:manage", "material:view", "question:view", "forum:view", "session:view", "report:view"], user: { roleName: "Quản trị hệ thống" } } });
    apiRequest.mockImplementation((path: string) => Promise.resolve(path === "/admin/users?pageSize=1"
      ? { active: 1 }
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
    expect(screen.getByText("Khóa học & lớp")).toBeInTheDocument();
    expect(screen.getByText("Điều hành lớp")).toBeInTheDocument();
    expect(screen.getByText("Báo cáo vận hành")).toBeInTheDocument();
    expect(screen.queryByText("Nghiệp vụ giảng dạy")).not.toBeInTheDocument();
    expect(screen.queryByText("100%")).not.toBeInTheDocument();
  });
});
