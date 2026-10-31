import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AccountSetupScreen } from "../../../../src/shared/auth/account-setup-screen";
import { clearAccountSetup, readAccountSetup, saveAccountSetup } from "@/lib/account-setup";

const { apiMock, replaceMock } = vi.hoisted(() => ({ apiMock: vi.fn(), replaceMock: vi.fn() }));

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: replaceMock }) }));
vi.mock("@/lib/api-client", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/api-client")>(),
  apiRequest: apiMock,
}));
vi.mock("@/shared/layout/language-switcher", () => ({ LanguageSwitcher: () => null }));

// Tạo phản hồi chờ để kiểm tra các trường hợp request hoàn tất sau khi rời trang.
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((success, failure) => { resolve = success; reject = failure; });
  return { promise, resolve, reject };
}

describe("AccountSetupScreen request lifecycle", () => {
  beforeEach(() => {
    apiMock.mockReset();
    replaceMock.mockReset();
    saveAccountSetup({ setupToken: "old-token", username: "learner" });
  });

  afterEach(() => { cleanup(); clearAccountSetup(); });

  it("không ghi đè phiên mới khi phản hồi OTP đến sau khi rời trang", async () => {
    const pending = deferred<{ challengeId: string; email: string; expiresInSeconds: number; resendAfterSeconds: number }>();
    apiMock.mockReturnValue(pending.promise);
    const view = render(<AccountSetupScreen />);
    const input = await screen.findByRole("textbox", { name: "Email" });
    fireEvent.change(input, { target: { value: "old@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: /Xác nhận/ }));
    expect(apiMock).toHaveBeenCalledTimes(1);

    view.unmount();
    const newSession = { setupToken: "new-token", username: "other" };
    saveAccountSetup(newSession);
    await act(async () => {
      pending.resolve({ challengeId: "stale-challenge", email: "old@example.com", expiresInSeconds: 300, resendAfterSeconds: 60 });
      await pending.promise;
    });
    expect(readAccountSetup()).toEqual(newSession);
  });

  it("không ghi đè phiên mới khi phản hồi OTP đến trong lúc trang vẫn mở", async () => {
    const pending = deferred<{ challengeId: string; email: string; expiresInSeconds: number; resendAfterSeconds: number }>();
    apiMock.mockReturnValue(pending.promise);
    render(<AccountSetupScreen />);
    const input = await screen.findByRole("textbox", { name: "Email" });
    fireEvent.change(input, { target: { value: "old@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: /Xác nhận/ }));
    const newSession = { setupToken: "new-token", username: "other" };
    saveAccountSetup(newSession);
    await act(async () => {
      pending.resolve({ challengeId: "stale-challenge", email: "old@example.com", expiresInSeconds: 300, resendAfterSeconds: 60 });
      await pending.promise;
    });
    expect(readAccountSetup()).toEqual(newSession);
  });

  it("bỏ qua lỗi OTP hết hạn từ trang cũ để bảo toàn phiên mới", async () => {
    const pending = deferred<never>();
    apiMock.mockReturnValue(pending.promise);
    const view = render(<AccountSetupScreen />);
    await screen.findByRole("textbox", { name: "Email" });
    fireEvent.click(screen.getByRole("button", { name: /Xác nhận/ }));
    view.unmount();
    const newSession = { setupToken: "new-token", username: "other" };
    saveAccountSetup(newSession);

    const { ApiError } = await import("@/lib/api-client");
    await act(async () => {
      pending.reject(new ApiError("expired", 403, { code: "ACCOUNT_SETUP_EXPIRED" }));
      await pending.promise.catch(() => undefined);
    });
    expect(readAccountSetup()).toEqual(newSession);
  });

  it("bảo toàn phiên mới khi OTP hết hạn dù trang cũ vẫn mở", async () => {
    const pending = deferred<never>();
    apiMock.mockReturnValue(pending.promise);
    render(<AccountSetupScreen />);
    await screen.findByRole("textbox", { name: "Email" });
    fireEvent.click(screen.getByRole("button", { name: /Xác nhận/ }));
    const newSession = { setupToken: "new-token", username: "other" };
    saveAccountSetup(newSession);
    const { ApiError } = await import("@/lib/api-client");
    await act(async () => {
      pending.reject(new ApiError("expired", 403, { code: "ACCOUNT_SETUP_EXPIRED" }));
      await pending.promise.catch(() => undefined);
    });
    expect(readAccountSetup()).toEqual(newSession);
  });

  it("không gửi lặp request hoàn tất và giữ phiên mới khi request cũ trả về", async () => {
    const pending = deferred<unknown>();
    apiMock.mockReturnValue(pending.promise);
    saveAccountSetup({ setupToken: "old-token", username: "learner", email: "old@example.com", challengeId: "old-challenge" });
    const view = render(<AccountSetupScreen />);
    const username = await screen.findByRole("textbox", { name: "Tài khoản" });
    expect(username).toHaveValue("learner");
    fireEvent.change(screen.getByLabelText("Mật khẩu mới"), { target: { value: "Password1!" } });
    fireEvent.change(screen.getByLabelText("Nhập lại mật khẩu mới"), { target: { value: "Password1!" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Mã OTP" }), { target: { value: "123456" } });
    const form = screen.getByRole("button", { name: /Hoàn tất xác thực/ }).closest("form")!;
    fireEvent.submit(form);
    fireEvent.submit(form);
    expect(apiMock).toHaveBeenCalledTimes(1);

    view.unmount();
    const newSession = { setupToken: "new-token", username: "other" };
    saveAccountSetup(newSession);
    await act(async () => { pending.resolve({}); await pending.promise; });
    expect(readAccountSetup()).toEqual(newSession);
    expect(replaceMock).not.toHaveBeenCalled();
  });

  it("không chuyển hướng hoặc xóa phiên mới khi hoàn tất request cũ lúc trang còn mở", async () => {
    const pending = deferred<unknown>();
    apiMock.mockReturnValue(pending.promise);
    saveAccountSetup({ setupToken: "old-token", username: "learner", email: "old@example.com", challengeId: "old-challenge" });
    render(<AccountSetupScreen />);
    await screen.findByRole("textbox", { name: "Tài khoản" });
    fireEvent.change(screen.getByLabelText("Mật khẩu mới"), { target: { value: "Password1!" } });
    fireEvent.change(screen.getByLabelText("Nhập lại mật khẩu mới"), { target: { value: "Password1!" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Mã OTP" }), { target: { value: "123456" } });
    fireEvent.submit(screen.getByRole("button", { name: /Hoàn tất xác thực/ }).closest("form")!);
    const newSession = { setupToken: "new-token", username: "other" };
    saveAccountSetup(newSession);
    await act(async () => { pending.resolve({}); await pending.promise; });
    expect(readAccountSetup()).toEqual(newSession);
    expect(replaceMock).not.toHaveBeenCalled();
  });
});
