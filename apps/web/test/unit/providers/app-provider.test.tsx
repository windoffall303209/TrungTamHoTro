import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppProvider, useApp } from "../../../src/providers/app-provider";

const { request, setLocale } = vi.hoisted(() => ({ request: vi.fn(), setLocale: vi.fn() }));
const realtimeSession = vi.hoisted(() => vi.fn());
vi.mock("@/lib/realtime-client", () => ({ realtimeClient: { setSession: realtimeSession } }));
vi.mock("@/lib/api-client", () => ({
  ApiError: class ApiError extends Error { status = 0; },
  apiRequest: request,
  resetCsrfToken: vi.fn(),
}));
vi.mock("@/providers/i18n-provider", () => ({ useI18n: () => ({ setLocale }) }));

/** Hiển thị nút kích hoạt toast thông qua API công khai của provider. */
function ToastFixture() {
  const { notify } = useApp();
  return <button type="button" onClick={() => notify("Thông báo mới")}>Notify</button>;
}

/** Hiển thị mã phiên sau khi AppProvider xác thực với server. */
function SessionFixture() {
  const { authLoading, session } = useApp();
  return <span>{authLoading ? "loading" : session.sessionId}</span>;
}

/** Cho phép kiểm tra chuyển vai trò và đăng xuất qua API công khai. */
function AuthFixture() {
  const { setRole, logout } = useApp();
  return <><button onClick={() => void setRole("INSTRUCTOR")}>Role</button><button onClick={() => void logout()}>Logout</button></>;
}

describe("AppProvider realtime lifecycle", () => {
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });
  it("switches scope on role changes and disconnects immediately while logout is pending", async () => {
    realtimeSession.mockClear();
    request.mockReset().mockResolvedValue({ sessionId: "s1", user: { id: "u1" }, roleCode: "LEARNER", permissions: [], availableRoles: [] });
    const view = render(<AppProvider><AuthFixture /></AppProvider>);
    await waitFor(() => expect(realtimeSession).toHaveBeenLastCalledWith({ sessionId: "s1", userId: "u1", roleCode: "LEARNER" }));
    request.mockResolvedValueOnce({ sessionId: "s1", user: { id: "u1" }, roleCode: "INSTRUCTOR", permissions: [], availableRoles: [] });
    fireEvent.click(screen.getByText("Role"));
    await waitFor(() => expect(realtimeSession).toHaveBeenLastCalledWith({ sessionId: "s1", userId: "u1", roleCode: "INSTRUCTOR" }));
    let finish!: () => void;
    request.mockReturnValueOnce(new Promise<void>((resolve) => { finish = resolve; }));
    fireEvent.click(screen.getByText("Logout"));
    expect(realtimeSession).toHaveBeenLastCalledWith();
    await act(async () => finish());
    realtimeSession.mockClear();
    view.unmount();
    expect(realtimeSession).toHaveBeenCalledWith();
  });
  it("disconnects when another request announces an expired session without wiping same-user session drafts", async () => {
    sessionStorage.clear();
    sessionStorage.setItem(
      "wind-edu:draft:v1:u2:LEARNER:MANUAL",
      JSON.stringify({ version: 1, savedAt: Date.now(), value: "draft" }),
    );
    request.mockReset().mockResolvedValue({ sessionId: "s2", user: { id: "u2" }, roleCode: "LEARNER", permissions: [], availableRoles: [] });
    render(<AppProvider><SessionFixture /></AppProvider>);
    await waitFor(() => expect(screen.getByText("s2")).toBeInTheDocument());
    realtimeSession.mockClear();
    act(() => window.dispatchEvent(new Event("wind-edu:unauthorized")));
    expect(realtimeSession).toHaveBeenCalledWith();
    expect(screen.queryByText("s2")).not.toBeInTheDocument();
    expect(sessionStorage.getItem("wind-edu:draft:v1:u2:LEARNER:MANUAL")).not.toBeNull();
    sessionStorage.clear();
  });
});

describe("AppProvider notification lifecycle", () => {
  beforeEach(() => {
    request.mockReset().mockResolvedValue({
      sessionId: "",
      user: { id: "", locale: "vi-VN" },
      roleCode: "LEARNER",
      permissions: [],
      availableRoles: [],
    });
    vi.useFakeTimers();
    vi.spyOn(Date, "now").mockReturnValue(123456);
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("thông báo mới giữ đủ thời gian hiển thị dù hai lần gọi có cùng timestamp", () => {
    render(<AppProvider><ToastFixture /></AppProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Notify" }));
    act(() => vi.advanceTimersByTime(1800));
    fireEvent.click(screen.getByRole("button", { name: "Notify" }));

    act(() => vi.advanceTimersByTime(1800));
    expect(screen.getByText("Thông báo mới")).toBeInTheDocument();

    act(() => vi.advanceTimersByTime(1799));
    expect(screen.getByText("Thông báo mới")).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.queryByText("Thông báo mới")).not.toBeInTheDocument();
  });

  it("thu hồi timer thông báo khi provider unmount", () => {
    const view = render(<AppProvider><ToastFixture /></AppProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Notify" }));
    expect(vi.getTimerCount()).toBe(1);
    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("AppProvider session storage restrictions", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("tiếp nhận phiên và dùng locale hồ sơ nếu localStorage bị chặn", async () => {
    request.mockReset().mockResolvedValue({
      sessionId: "valid-session",
      user: { id: "user-1", locale: "en-US" },
      roleCode: "LEARNER",
      permissions: [],
      availableRoles: [],
    });
    setLocale.mockReset();
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("Blocked", "SecurityError");
    });

    render(<AppProvider><SessionFixture /></AppProvider>);
    await waitFor(() => expect(screen.getByText("valid-session")).toBeInTheDocument());
    expect(setLocale).toHaveBeenCalledWith("en-US");
  });
});
