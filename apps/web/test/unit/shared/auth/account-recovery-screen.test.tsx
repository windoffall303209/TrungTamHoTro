import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AccountRecoveryScreen } from "../../../../src/shared/auth/account-recovery-screen";
import { apiRequest } from "@/lib/api-client";

vi.mock("@/lib/api-client", () => ({ apiRequest: vi.fn() }));
vi.mock("@/shared/layout/language-switcher", () => ({ LanguageSwitcher: () => null }));

describe("AccountRecoveryScreen polling", () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.clearAllMocks();
    window.history.replaceState({}, "", "/");
  });

  it("dừng kiểm tra trạng thái sau khi server đã xác nhận email", async () => {
    window.history.replaceState({}, "", "/verify-email?verificationId=challenge-1");
    vi.useFakeTimers();
    vi.mocked(apiRequest).mockResolvedValue({ verified: true, expired: false });

    render(<AccountRecoveryScreen mode="verify" />);
    await act(async () => { await Promise.resolve(); });

    expect(screen.getByText("Email đã được xác minh")).toBeInTheDocument();
    expect(apiRequest).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(9_000); });
    expect(apiRequest).toHaveBeenCalledTimes(1);
  });

  it("không chồng request polling và bỏ qua phản hồi sau khi rời trang", async () => {
    window.history.replaceState({}, "", "/verify-email?verificationId=challenge-2");
    vi.useFakeTimers();
    let resolveStatus!: (value: { verified: boolean; expired: boolean }) => void;
    const pending = new Promise<{ verified: boolean; expired: boolean }>((resolve) => { resolveStatus = resolve; });
    vi.mocked(apiRequest).mockImplementation(() => pending as never);
    const writeStorage = vi.spyOn(Storage.prototype, "setItem");

    const view = render(<AccountRecoveryScreen mode="verify" />);
    await act(async () => { await Promise.resolve(); });
    expect(apiRequest).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(9_000); });
    expect(apiRequest).toHaveBeenCalledTimes(1);

    view.unmount();
    await act(async () => { resolveStatus({ verified: true, expired: false }); await pending; });
    expect(writeStorage).not.toHaveBeenCalled();
    writeStorage.mockRestore();
  });

  it("không phát thông báo xác minh khi token hoàn tất sau lúc rời trang", async () => {
    window.history.replaceState({}, "", "/verify-email?token=late-token");
    let resolveVerify!: (value: { verified: true; verificationId: string }) => void;
    const pending = new Promise<{ verified: true; verificationId: string }>((resolve) => { resolveVerify = resolve; });
    vi.mocked(apiRequest).mockReturnValue(pending as never);
    const writeStorage = vi.spyOn(Storage.prototype, "setItem");
    try {
      const view = render(<AccountRecoveryScreen mode="verify" />);
      expect(apiRequest).toHaveBeenCalledWith("/auth/verify-email", expect.objectContaining({ method: "POST" }));
      view.unmount();
      await act(async () => { resolveVerify({ verified: true, verificationId: "late-verification" }); await pending; });
      expect(writeStorage).not.toHaveBeenCalled();
    } finally {
      writeStorage.mockRestore();
    }
  });

  it("bỏ qua thông báo sai dạng và nhận thông báo hợp lệ từ tab khác", async () => {
    window.history.replaceState({}, "", "/verify-email?verificationId=challenge-3");
    vi.mocked(apiRequest).mockReturnValue(new Promise(() => {}) as never);
    render(<AccountRecoveryScreen mode="verify" />);
    await act(async () => { await Promise.resolve(); });

    for (const payload of ["null", "[]", "{}", '{"verificationId":"other"}']) {
      await act(async () => {
        window.dispatchEvent(new StorageEvent("storage", { key: "wind-edu:email-verified", newValue: payload }));
      });
    }
    expect(screen.queryByText("Email đã được xác minh")).not.toBeInTheDocument();

    await act(async () => {
      window.dispatchEvent(new StorageEvent("storage", { key: "wind-edu:email-verified", newValue: '{"verificationId":"challenge-3"}' }));
    });
    expect(screen.getByText("Email đã được xác minh")).toBeInTheDocument();
  });

  it("hoàn tất xác minh ngay cả khi trình duyệt từ chối localStorage", async () => {
    window.history.replaceState({}, "", "/verify-email?verificationId=challenge-4");
    vi.mocked(apiRequest).mockResolvedValue({ verified: true, expired: false });
    const writeStorage = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("storage blocked"); });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      render(<AccountRecoveryScreen mode="verify" />);
      await act(async () => { await Promise.resolve(); });
      expect(screen.getByText("Email đã được xác minh")).toBeInTheDocument();
      expect(warn).toHaveBeenCalledWith("Không thể thông báo xác minh email qua localStorage.", expect.any(Error));
    } finally {
      writeStorage.mockRestore();
      warn.mockRestore();
    }
  });
});
