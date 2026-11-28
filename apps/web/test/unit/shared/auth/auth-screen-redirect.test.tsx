import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthScreen } from "../../../../src/shared/auth/auth-screen";

const { loginMock, replaceMock } = vi.hoisted(() => ({ loginMock: vi.fn(), replaceMock: vi.fn() }));

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: replaceMock }) }));
vi.mock("@/providers/app-provider", () => ({
  useApp: () => ({ authenticated: false, authLoading: false, login: loginMock, completeMfa: vi.fn() }),
}));
vi.mock("@/shared/layout/language-switcher", () => ({ LanguageSwitcher: () => null }));
vi.mock("@/shared/layout/theme-toggle", () => ({ ThemeToggle: () => null }));

/** Đăng nhập thành công với tham số next cho trước và trả đường dẫn router được yêu cầu chuyển tới. */
async function loginWithNext(next: string): Promise<unknown> {
  window.history.pushState({}, "", `/login?next=${encodeURIComponent(next)}`);
  loginMock.mockResolvedValue({});
  render(<AuthScreen />);
  fireEvent.change(screen.getByPlaceholderText("admin@wind.edu.vn"), { target: { value: "learner" } });
  fireEvent.change(screen.getByPlaceholderText("Tối thiểu 8 ký tự"), { target: { value: "Learner#2026" } });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: /Đăng nhập/ }));
  });
  return replaceMock.mock.calls.at(-1)?.[0];
}

describe("AuthScreen chuyển hướng sau đăng nhập", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    window.history.pushState({}, "", "/");
  });

  it("chỉ quay về đường dẫn nội bộ", async () => {
    expect(await loginWithNext("/classes/class-1?tab=exams")).toBe("/classes/class-1?tab=exams");
  });

  it.each(["/\\evil.example", "//evil.example", "https://evil.example/phish", "/\\/evil.example"])("chặn open redirect %s", async (next) => {
    expect(await loginWithNext(next)).toBe("/dashboard");
  });
});
