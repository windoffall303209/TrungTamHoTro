import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { IdentityUser } from "@/lib/app-types";
import UsersPage from "../../../../../../src/app/(workspace)/admin/users/page";

const mocks = vi.hoisted(() => ({ request: vi.fn(), notify: vi.fn() }));

vi.mock("@/lib/api-client", () => ({ apiRequest: mocks.request, ApiError: class ApiError extends Error {} }));
vi.mock("@/lib/access-control", () => ({ hasPermission: () => true, hasEveryPermission: () => true }));
vi.mock("@/providers/app-provider", () => ({
  useApp: () => ({ session: { roleCode: "SYSTEM_ADMIN" }, notify: mocks.notify }),
}));
vi.mock("@/providers/i18n-provider", () => ({
  useI18n: () => ({ t: (value: string) => value, locale: "vi-VN" }),
}));

// Tạo phản hồi API có thể hoàn tất sau khi bộ lọc đã thay đổi.
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((success, failure) => {
    resolve = success;
    reject = failure;
  });
  return { promise, resolve, reject };
}

// Tạo người dùng đủ thông tin để hiển thị danh sách và form bàn giao.
function makeUser(id: string): IdentityUser {
  return {
    id, username: id, displayName: id, email: `${id}@example.com`,
    roleCode: "INSTRUCTOR", roleCodes: ["INSTRUCTOR"], status: "ACTIVE",
  } as IdentityUser;
}

const originalUser = makeUser("owner");

describe("UsersPage request lifecycle", () => {
  beforeEach(() => {
    mocks.request.mockReset();
    mocks.notify.mockReset();
  });

  afterEach(() => cleanup());

  it("không hiển thị người nhận bàn giao từ kết quả tìm kiếm đã hủy", async () => {
    const oldSearch = deferred<{ items: IdentityUser[] }>();
    const newSearch = deferred<{ items: IdentityUser[] }>();
    mocks.request.mockImplementation((path: string) => {
      if (path.startsWith("/admin/users/owner/change-impact")) {
        return Promise.resolve({
          userId: "owner", token: "preview", requiresHandoff: true,
          activeSessions: 1, classes: [],
          openWork: { regrades: 0, interventions: 0, supportTickets: 0, moderationReports: 0, upcomingSessions: 0 },
        });
      }
      if (path === "/admin/users?pageSize=50&query=old") return oldSearch.promise;
      if (path === "/admin/users?pageSize=50&query=new") return newSearch.promise;
      if (path.startsWith("/admin/users?")) return Promise.resolve({ items: [originalUser], total: 1, active: 1, locked: 0 });
      throw new Error(`Unexpected request: ${path}`);
    });

    render(<UsersPage />);
    // Chờ tải danh sách sau debounce khi toàn bộ test suite chạy song song.
    fireEvent.click(await screen.findByRole("button", { name: "Sửa owner" }, { timeout: 5_000 }));
    fireEvent.change(screen.getByLabelText("Trạng thái"), { target: { value: "LOCKED" } });
    fireEvent.click(screen.getByRole("button", { name: "Xem ảnh hưởng" }));
    const search = await screen.findByRole("textbox", { name: "Tìm người nhận bàn giao" });

    fireEvent.change(search, { target: { value: "old" } });
    await waitFor(() => expect(mocks.request).toHaveBeenCalledWith("/admin/users?pageSize=50&query=old", expect.anything()));
    fireEvent.change(search, { target: { value: "new" } });
    await waitFor(() => expect(mocks.request).toHaveBeenCalledWith("/admin/users?pageSize=50&query=new", expect.anything()));

    await act(async () => newSearch.resolve({ items: [makeUser("new")] }));
    expect(screen.getByRole("option", { name: /new ·/ })).toBeInTheDocument();
    await act(async () => oldSearch.resolve({ items: [makeUser("old")] }));
    expect(screen.getByRole("option", { name: /new ·/ })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /old ·/ })).not.toBeInTheDocument();
  });

  it("không thông báo lỗi tìm kiếm danh sách từ yêu cầu cũ", async () => {
    const oldSearch = deferred<{ items: IdentityUser[]; total: number; active: number; locked: number }>();
    mocks.request.mockImplementation((path: string) => {
      if (path.includes("query=old")) return oldSearch.promise;
      if (path.includes("query=new")) return Promise.resolve({ items: [makeUser("new")], total: 1, active: 1, locked: 0 });
      if (path.startsWith("/admin/users?")) return Promise.resolve({ items: [], total: 0, active: 0, locked: 0 });
      throw new Error(`Unexpected request: ${path}`);
    });

    render(<UsersPage />);
    const search = screen.getByRole("textbox", { name: "Tìm kiếm người dùng" });
    fireEvent.change(search, { target: { value: "old" } });
    await waitFor(() => expect(mocks.request).toHaveBeenCalledWith(expect.stringContaining("query=old"), expect.anything()));
    fireEvent.change(search, { target: { value: "new" } });
    await screen.findByText("new");
    await act(async () => oldSearch.reject(new Error("Stale list request")));
    expect(mocks.notify).not.toHaveBeenCalled();
    expect(screen.getByText("new")).toBeInTheDocument();
  });
});
