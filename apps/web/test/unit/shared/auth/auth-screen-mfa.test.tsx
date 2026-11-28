import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthScreen } from "../../../../src/shared/auth/auth-screen";

const { loginMock, completeMfaMock, replaceMock } = vi.hoisted(() => ({
  loginMock: vi.fn(),
  completeMfaMock: vi.fn(),
  replaceMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: replaceMock }) }));
vi.mock("@/providers/app-provider", () => ({
  useApp: () => ({ authenticated: false, authLoading: false, login: loginMock, completeMfa: completeMfaMock }),
}));
vi.mock("@/shared/layout/language-switcher", () => ({ LanguageSwitcher: () => null }));
vi.mock("@/shared/layout/theme-toggle", () => ({ ThemeToggle: () => null }));

describe("AuthScreen xác thực hai bước", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  // Đăng nhập bằng mật khẩu để màn hình chuyển sang bước nhập mã xác thực hai bước.
  async function reachMfaStep(): Promise<void> {
    loginMock.mockResolvedValue({ requiresMfa: true, challengeToken: "challenge-token" });
    render(<AuthScreen />);
    fireEvent.change(screen.getByPlaceholderText("admin@wind.edu.vn"), { target: { value: "learner" } });
    fireEvent.change(screen.getByPlaceholderText("Tối thiểu 8 ký tự"), { target: { value: "Learner#2026" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Đăng nhập/ }));
    });
    expect(screen.getByText("Xác thực hai bước")).toBeInTheDocument();
  }

  it("không còn cho gửi OTP qua email thay cho TOTP mà chỉ cho dùng mã khôi phục", async () => {
    await reachMfaStep();
    expect(screen.queryByRole("button", { name: /email/i })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Dùng mã khôi phục" }));
    const input = screen.getByPlaceholderText("XXXXX-XXXXX");
    fireEvent.change(input, { target: { value: "abcde-fghjk" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Xác nhận mã/ }));
    });

    expect(completeMfaMock).toHaveBeenCalledWith("challenge-token", "ABCDE-FGHJK", false, "recovery");
  });

  it("gửi mã TOTP qua nhánh mặc định", async () => {
    await reachMfaStep();
    fireEvent.change(screen.getByPlaceholderText("000000"), { target: { value: "123456" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Xác nhận mã/ }));
    });

    expect(completeMfaMock).toHaveBeenCalledWith("challenge-token", "123456", false, "totp");
  });
});
