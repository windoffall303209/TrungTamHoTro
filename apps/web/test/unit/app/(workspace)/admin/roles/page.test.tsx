import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { IdentityRole } from "@/lib/app-types";
import RolesPage from "../../../../../../src/app/(workspace)/admin/roles/page";

const { apiMock, notifyMock, nextNotifyMock, activeNotify } = vi.hoisted(() => {
  const notifyMock = vi.fn();
  return { apiMock: vi.fn(), notifyMock, nextNotifyMock: vi.fn(), activeNotify: { current: notifyMock } };
});

vi.mock("@/lib/api-client", () => ({ apiRequest: apiMock }));
vi.mock("@/lib/access-control", () => ({ hasPermission: () => true }));
vi.mock("@/providers/app-provider", () => ({
  useApp: () => ({ session: { roleCode: "SYSTEM_ADMIN" }, notify: activeNotify.current }),
}));

// Trì hoãn phản hồi để kiểm tra thay đổi vai trò trước khi request kết thúc.
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((success, failure) => { resolve = success; reject = failure; });
  return { promise, resolve, reject };
}

// Tạo bản ghi vai trò đủ trường để xác định bản cập nhật đang hiển thị.
function makeRole(name: string): IdentityRole {
  return { code: "CENTER_MANAGER", name, description: "Quản lý", permissions: ["role:view"], version: 1 };
}

describe("RolesPage request lifecycle", () => {
  beforeEach(() => {
    activeNotify.current = notifyMock;
    apiMock.mockReset();
    notifyMock.mockReset();
    nextNotifyMock.mockReset();
  });

  afterEach(() => cleanup());

  it("ignores permissions from an obsolete role request", async () => {
    const first = deferred<IdentityRole[]>();
    const second = deferred<IdentityRole[]>();
    apiMock.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const view = render(<RolesPage />);
    await waitFor(() => expect(apiMock).toHaveBeenCalledTimes(1));
    activeNotify.current = nextNotifyMock;
    view.rerender(<RolesPage />);
    await waitFor(() => expect(apiMock).toHaveBeenCalledTimes(2));
    await act(async () => second.resolve([makeRole("Newest role")]));
    expect(screen.getByRole("heading", { name: "Newest role" })).toBeInTheDocument();
    await act(async () => first.resolve([makeRole("Outdated role")]));
    expect(screen.getByRole("heading", { name: "Newest role" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Outdated role" })).not.toBeInTheDocument();
  });

  it("does not notify about a request that fails after unmount", async () => {
    const pending = deferred<IdentityRole[]>();
    apiMock.mockReturnValueOnce(pending.promise);
    const view = render(<RolesPage />);
    await waitFor(() => expect(apiMock).toHaveBeenCalledTimes(1));
    view.unmount();
    await act(async () => pending.reject(new Error("Stale permissions failure")));
    expect(notifyMock).not.toHaveBeenCalled();
  });
});
