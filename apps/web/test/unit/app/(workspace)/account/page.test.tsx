import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AccountProfile, AccountSession } from "@/lib/app-types";
import AccountPage from "../../../../../src/app/(workspace)/account/page";

const { apiMock, notifyMock } = vi.hoisted(() => ({ apiMock: vi.fn(), notifyMock: vi.fn() }));

vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams() }));
vi.mock("@/lib/api-client", () => ({ apiRequest: apiMock }));
vi.mock("@/providers/app-provider", () => ({
  useApp: () => ({ notify: notifyMock, refreshSession: vi.fn() }),
}));
vi.mock("@/providers/i18n-provider", () => ({
  useI18n: () => ({ t: (value: string) => value, locale: "vi-VN", setLocale: vi.fn(), formatDateTime: (value: string) => value }),
}));
vi.mock("@/shared/ui/user-avatar", () => ({ UserAvatar: () => <span data-testid="user-avatar" /> }));

// Tạo một Promise có thể hoàn thành thủ công để kiểm soát thứ tự phản hồi API.
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((success, failure) => { resolve = success; reject = failure; });
  return { promise, resolve, reject };
}

// Tạo hồ sơ hợp lệ có tên riêng để nhận biết dữ liệu của từng lần tải.
function makeProfile(displayName: string): AccountProfile {
  return {
    id: "user-1", username: "user", displayName, email: "user@example.com", phone: "",
    timezone: "Asia/Bangkok", locale: "vi-VN", avatarUrl: null, status: "ACTIVE",
    emailVerifiedAt: null, mfaEnabled: false, hasPassword: true, createdAt: "2026-10-01T00:00:00Z",
  };
}

describe("AccountPage request lifecycle", () => {
  const profiles: Array<ReturnType<typeof deferred<AccountProfile>>> = [];
  const sessions: Array<ReturnType<typeof deferred<AccountSession[]>>> = [];

  beforeEach(() => {
    profiles.length = 0;
    sessions.length = 0;
    apiMock.mockReset();
    notifyMock.mockReset();
    apiMock.mockImplementation((path: string) => {
      if (path === "/account/profile") {
        const request = deferred<AccountProfile>();
        profiles.push(request);
        return request.promise;
      }
      if (path === "/account/sessions") {
        const request = deferred<AccountSession[]>();
        sessions.push(request);
        return request.promise;
      }
      throw new Error(`Unexpected request: ${path}`);
    });
  });

  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  // Hoàn tất cả hai endpoint vì màn hình chờ chúng qua Promise.all.
  async function finishLoad(index: number, displayName: string) {
    await act(async () => {
      profiles[index]!.resolve(makeProfile(displayName));
      sessions[index]!.resolve([]);
    });
  }

  it("giữ dữ liệu lần tải mới khi hai lần làm mới được kích hoạt liên tiếp", async () => {
    render(<AccountPage />);
    await waitFor(() => expect(profiles).toHaveLength(1));
    await finishLoad(0, "Initial");
    expect(screen.getByDisplayValue("Initial")).toBeInTheDocument();

    const refresh = screen.getByRole("button", { name: /Làm mới dữ liệu/ });
    act(() => {
      fireEvent.click(refresh);
      fireEvent.click(refresh);
    });
    await waitFor(() => expect(profiles).toHaveLength(3));
    await finishLoad(2, "Latest");
    expect(screen.getByDisplayValue("Latest")).toBeInTheDocument();

    await finishLoad(1, "Stale");
    expect(screen.getByDisplayValue("Latest")).toBeInTheDocument();
    expect(screen.queryByDisplayValue("Stale")).not.toBeInTheDocument();
    expect(notifyMock).not.toHaveBeenCalled();
  });

  it("không phát thông báo khi request thất bại sau khi đã rời trang", async () => {
    const page = render(<AccountPage />);
    await waitFor(() => expect(profiles).toHaveLength(1));
    page.unmount();
    await act(async () => { profiles[0]!.reject(new Error("request expired")); });
    expect(notifyMock).not.toHaveBeenCalled();
  });

  it("bỏ qua lỗi của request cũ sau khi lần tải mới thành công", async () => {
    render(<AccountPage />);
    await waitFor(() => expect(profiles).toHaveLength(1));
    await finishLoad(0, "Initial");
    const refresh = screen.getByRole("button", { name: /Làm mới dữ liệu/ });
    act(() => { fireEvent.click(refresh); fireEvent.click(refresh); });
    await waitFor(() => expect(profiles).toHaveLength(3));

    await finishLoad(2, "Latest");
    await act(async () => { profiles[1]!.reject(new Error("stale failure")); });
    expect(screen.getByDisplayValue("Latest")).toBeInTheDocument();
    expect(notifyMock).not.toHaveBeenCalled();
  });

  it("tạo được mã QR thiết lập 2FA từ URI OTP hợp lệ", async () => {
    const originalImplementation = apiMock.getMockImplementation()!;
    apiMock.mockImplementation((path: string) => path === "/account/mfa/setup"
      ? Promise.resolve({ secret: "JBSWY3DPEHPK3PXP", otpauthUri: "otpauth://totp/WindEDU:test?secret=JBSWY3DPEHPK3PXP" })
      : originalImplementation(path));

    render(<AccountPage />);
    await waitFor(() => expect(profiles).toHaveLength(1));
    await finishLoad(0, "Initial");
    fireEvent.click(screen.getByRole("button", { name: "Bảo mật" }));
    fireEvent.click(screen.getByRole("button", { name: /Kích hoạt xác thực 2 bước ngay/ }));

    await waitFor(() => expect(screen.getByAltText("Mã QR TOTP")).toHaveAttribute("src", expect.stringMatching(/^data:image\/png;base64,/)));
    expect(notifyMock).not.toHaveBeenCalled();
  });
});
