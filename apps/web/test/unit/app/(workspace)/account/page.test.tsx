import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { loadEnglishCatalog, translateText } from "@/i18n/catalog";
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
    emailVerifiedAt: "2026-10-01T00:00:00Z", mfaEnabled: false, mfaRecoveryCodesRemaining: 0, hasPassword: true, createdAt: "2026-10-01T00:00:00Z",
  };
}

describe("AccountPage request lifecycle", () => {
  beforeAll(async () => {
    await loadEnglishCatalog();
  });
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

    await waitFor(() => {
      expect(screen.getByRole("dialog", { name: "Kết nối ứng dụng xác thực" })).toBeInTheDocument();
      expect(screen.getByAltText("Mã QR TOTP")).toHaveAttribute("src", expect.stringMatching(/^data:image\/png;base64,/));
    });
    expect(notifyMock).not.toHaveBeenCalled();
  });

  it("chuyển đổi giữa mã QR và khóa thủ công, sao chép code và đóng modal 2FA bằng nút Huỷ", async () => {
    const originalImplementation = apiMock.getMockImplementation()!;
    apiMock.mockImplementation((path: string) => path === "/account/mfa/setup"
      ? Promise.resolve({ secret: "BJTKCGHKTOJGG3YA5RK27PWKLJQZX5MT", otpauthUri: "otpauth://totp/WindEDU:test?secret=BJTKCGHKTOJGG3YA5RK27PWKLJQZX5MT" })
      : originalImplementation(path));

    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });

    render(<AccountPage />);
    await waitFor(() => expect(profiles).toHaveLength(1));
    await finishLoad(0, "Initial");
    fireEvent.click(screen.getByRole("button", { name: "Bảo mật" }));
    fireEvent.click(screen.getByRole("button", { name: /Kích hoạt xác thực 2 bước ngay/ }));

    await waitFor(() => expect(screen.getByRole("dialog", { name: "Kết nối ứng dụng xác thực" })).toBeInTheDocument());
    expect(screen.getByText("Dùng ứng dụng xác thực để quét mã QR, rồi nhập mã gồm 6 chữ số từ ứng dụng")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Không thể quét? Hãy nhập mã theo cách thủ công" }));
    expect(screen.getByText("BJTKCGHKTOJGG3YA5RK27PWKLJQZX5MT")).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Sao chép code" }));
    });
    expect(writeText).toHaveBeenCalledWith("BJTKCGHKTOJGG3YA5RK27PWKLJQZX5MT");
    expect(screen.getByRole("button", { name: "Đã sao chép code" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Hiện mã QR" }));
    await waitFor(() => expect(screen.getByAltText("Mã QR TOTP")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Huỷ" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("xác thực mã 6 chữ số trong modal 2FA và giữ modal mở nếu mã sai", async () => {
    let confirmAttempts = 0;
    const originalImplementation = apiMock.getMockImplementation()!;
    apiMock.mockImplementation((path: string) => {
      if (path === "/account/mfa/setup") {
        return Promise.resolve({ secret: "JBSWY3DPEHPK3PXP", otpauthUri: "otpauth://totp/WindEDU:test?secret=JBSWY3DPEHPK3PXP" });
      }
      if (path === "/account/mfa/confirm") {
        confirmAttempts += 1;
        if (confirmAttempts === 1) return Promise.reject(new Error("Mã OTP không chính xác."));
        return Promise.resolve({ enabled: true, recoveryCodes: ["AAAAA-BBBBB", "CCCCC-DDDDD"] });
      }
      return originalImplementation(path);
    });

    render(<AccountPage />);
    await waitFor(() => expect(profiles).toHaveLength(1));
    await finishLoad(0, "Initial");
    fireEvent.click(screen.getByRole("button", { name: "Bảo mật" }));
    fireEvent.click(screen.getByRole("button", { name: /Kích hoạt xác thực 2 bước ngay/ }));

    await waitFor(() => expect(screen.getByRole("dialog")).toBeInTheDocument());

    const verifyButton = screen.getByRole("button", { name: "Xác minh" });
    const codeInput = screen.getByLabelText("Mã gồm 6 chữ số");
    expect(verifyButton).toBeDisabled();

    fireEvent.change(codeInput, { target: { value: "12ab3456" } });
    expect(codeInput).toHaveValue("123456");
    expect(verifyButton).not.toBeDisabled();

    await act(async () => {
      fireEvent.click(verifyButton);
    });
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Mã OTP không chính xác.");

    await act(async () => {
      fireEvent.click(verifyButton);
    });
    await waitFor(() => expect(profiles).toHaveLength(2));
    await finishLoad(1, "Initial");

    // Sau khi bật MFA, bộ mã khôi phục chỉ hiển thị một lần trong hộp thoại riêng.
    const recoveryDialog = await screen.findByRole("dialog", { name: "Mã khôi phục xác thực hai bước" });
    expect(recoveryDialog).toHaveTextContent("AAAAA-BBBBB");
    expect(recoveryDialog).toHaveTextContent("CCCCC-DDDDD");
    fireEvent.click(screen.getByRole("button", { name: "Tôi đã lưu mã" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("có đầy đủ bản dịch tiếng Anh cho toàn bộ chuỗi giao diện modal 2FA", () => {
    const keys = [
      "Kết nối ứng dụng xác thực",
      "Dùng ứng dụng xác thực để quét mã QR, rồi nhập mã gồm 6 chữ số từ ứng dụng",
      "Không thể quét? Hãy nhập mã theo cách thủ công",
      "Sao chép code",
      "Đã sao chép code",
      "Hiện mã QR",
      "Mã gồm 6 chữ số",
      "Huỷ",
      "Xác minh",
      "Mã QR TOTP",
    ];
    for (const key of keys) {
      expect(translateText(key, "en-US")).not.toBe(key);
    }
  });

  it("mặc định khóa ô email, mở hộp thoại khi bấm Sửa, gửi mã xác minh và cập nhật email mới", async () => {
    const originalImplementation = apiMock.getMockImplementation()!;
    const updatedProfile = { ...makeProfile("Initial"), email: "newemail@wind.edu.vn" };
    apiMock.mockImplementation((path: string, init?: RequestInit) => {
      if (path === "/account/email/otp" && init?.method === "POST") {
        return Promise.resolve({
          challengeId: "challenge-email-0001",
          email: "newemail@wind.edu.vn",
          expiresInSeconds: 300,
          resendAfterSeconds: 60,
        });
      }
      if (path === "/account/email" && init?.method === "PATCH") {
        const body = JSON.parse(String(init.body ?? "{}")) as { challengeId: string; email: string; code: string };
        if (body.code === "000000") {
          return Promise.reject(new Error("Mã OTP không chính xác."));
        }
        return Promise.resolve(updatedProfile);
      }
      return originalImplementation(path);
    });

    render(<AccountPage />);
    await waitFor(() => expect(profiles).toHaveLength(1));
    await finishLoad(0, "Initial");

    const usernameInput = screen.getByDisplayValue("user");
    expect(usernameInput).toBeDisabled();
    expect(usernameInput).toHaveAttribute("readonly");

    const emailInput = screen.getByLabelText("Email");
    expect(emailInput).toBeDisabled();
    expect(emailInput).toHaveAttribute("readonly");
    expect(emailInput).toHaveValue("user@example.com");

    fireEvent.click(screen.getByRole("button", { name: "Sửa" }));
    expect(await screen.findByRole("dialog", { name: "Thay đổi địa chỉ email" })).toBeInTheDocument();
    expect(screen.queryByText(/Bước \d \/ 2/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Mã gồm 6 chữ số")).not.toBeInTheDocument();

    const newEmailInput = screen.getByLabelText("Email mới");
    fireEvent.change(newEmailInput, { target: { value: "  NewEmail@Wind.edu.vn  " } });
    // Chưa nhập mật khẩu hiện tại thì không cho gửi mã đổi email.
    expect(screen.getByRole("button", { name: "Gửi mã xác minh" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Mật khẩu hiện tại"), { target: { value: "Current#Pass2026" } });
    fireEvent.click(screen.getByRole("button", { name: "Gửi mã xác minh" }));

    await waitFor(() => {
      expect(apiMock).toHaveBeenCalledWith(
        "/account/email/otp",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ email: "newemail@wind.edu.vn", currentPassword: "Current#Pass2026" }),
        }),
      );
    });
    expect(await screen.findByRole("dialog", { name: "Xác minh địa chỉ email mới" })).toBeInTheDocument();
    expect(screen.queryByText(/Bước \d \/ 2/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Email mới")).not.toBeInTheDocument();
    expect(screen.getByText(/Mã xác minh 6 chữ số đã được gửi tới:/)).toBeInTheDocument();

    const otpInput = screen.getByLabelText("Mã gồm 6 chữ số");
    fireEvent.change(otpInput, { target: { value: "000000" } });
    fireEvent.click(screen.getByRole("button", { name: "Xác minh" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Mã OTP không chính xác.");
    expect(screen.getByRole("dialog", { name: "Xác minh địa chỉ email mới" })).toBeInTheDocument();

    fireEvent.change(otpInput, { target: { value: "654321" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Xác minh" }));
    });

    expect(apiMock).toHaveBeenCalledWith(
      "/account/email",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({
          challengeId: "challenge-email-0001",
          email: "newemail@wind.edu.vn",
          code: "654321",
          currentPassword: "Current#Pass2026",
        }),
      }),
    );

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Xác minh địa chỉ email mới" })).not.toBeInTheDocument();
    });
    expect(emailInput).toBeDisabled();
    expect(emailInput).toHaveValue("newemail@wind.edu.vn");
    expect(screen.getByRole("button", { name: "Sửa" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Bảo mật" }));
    expect(screen.getByLabelText("Email xác thực để nhận mã OTP")).toHaveValue("newemail@wind.edu.vn");
  });

  it("cho phép quay lại bước nhập email từ bước xác minh OTP", async () => {
    const originalImplementation = apiMock.getMockImplementation()!;
    apiMock.mockImplementation((path: string, init?: RequestInit) => {
      if (path === "/account/email/otp" && init?.method === "POST") {
        return Promise.resolve({
          challengeId: "challenge-email-back",
          email: "typo@wind.edu.vn",
          expiresInSeconds: 300,
          resendAfterSeconds: 60,
        });
      }
      return originalImplementation(path);
    });

    render(<AccountPage />);
    await waitFor(() => expect(profiles).toHaveLength(1));
    await finishLoad(0, "Initial");

    fireEvent.click(screen.getByRole("button", { name: "Sửa" }));
    fireEvent.change(screen.getByLabelText("Email mới"), { target: { value: "typo@wind.edu.vn" } });
    fireEvent.change(screen.getByLabelText("Mật khẩu hiện tại"), { target: { value: "Current#Pass2026" } });
    fireEvent.click(screen.getByRole("button", { name: "Gửi mã xác minh" }));

    expect(await screen.findByRole("dialog", { name: "Xác minh địa chỉ email mới" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Quay lại đổi email" }));

    expect(await screen.findByRole("dialog", { name: "Thay đổi địa chỉ email" })).toBeInTheDocument();
    expect(screen.getByLabelText("Email mới")).toHaveValue("typo@wind.edu.vn");
    expect(screen.queryByLabelText("Mã gồm 6 chữ số")).not.toBeInTheDocument();
  });

  it("yêu cầu mã TOTP khi đổi mật khẩu trên tài khoản đã bật xác thực hai bước", async () => {
    const originalImplementation = apiMock.getMockImplementation()!;
    apiMock.mockImplementation((path: string, init?: RequestInit) => {
      if (path === "/account/password/otp" && init?.method === "POST") {
        return Promise.resolve({ challengeId: "chg-mfa", email: "user@example.com", expiresInSeconds: 300, resendAfterSeconds: 60 });
      }
      if (path === "/account/password" && init?.method === "PATCH") return Promise.resolve({ revokedSessions: 0 });
      return originalImplementation(path);
    });

    render(<AccountPage />);
    await waitFor(() => expect(profiles).toHaveLength(1));
    await act(async () => {
      profiles[0]!.resolve({ ...makeProfile("Initial"), mfaEnabled: true, mfaRecoveryCodesRemaining: 7 });
      sessions[0]!.resolve([]);
    });

    fireEvent.click(screen.getByRole("button", { name: "Bảo mật" }));
    expect(screen.getByText("7/10")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Mật khẩu hiện tại"), { target: { value: "Current#Pass2026" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Gửi mã OTP xác nhận/ }));
    });
    await waitFor(() => expect(screen.getByLabelText(/^Mật khẩu mới/)).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText(/^Mật khẩu mới/), { target: { value: "StrongPass#2026" } });
    fireEvent.change(screen.getByLabelText("Nhập lại mật khẩu mới"), { target: { value: "StrongPass#2026" } });
    fireEvent.change(screen.getByLabelText("Mã OTP 6 số"), { target: { value: "654321" } });
    const submit = screen.getByRole("button", { name: /Xác nhận đổi mật khẩu/ });
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Mã xác thực 6 số"), { target: { value: "112233" } });
    expect(submit).not.toBeDisabled();
    await act(async () => {
      fireEvent.click(submit);
    });

    expect(apiMock).toHaveBeenCalledWith(
      "/account/password",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({
          challengeId: "chg-mfa",
          code: "654321",
          newPassword: "StrongPass#2026",
          currentPassword: "Current#Pass2026",
          mfaCode: "112233",
        }),
      }),
    );
  });

  it("có đầy đủ bản dịch tiếng Anh cho chuỗi xác thực lại và mã khôi phục", () => {
    const keys = [
      "Vui lòng nhập mật khẩu hiện tại.",
      "Mã khôi phục xác thực hai bước",
      "Mỗi mã chỉ dùng được một lần để đăng nhập khi bạn mất thiết bị xác thực. Hãy lưu ở nơi an toàn vì mã sẽ không hiển thị lại.",
      "Tôi đã lưu mã",
      "Mã khôi phục còn lại:",
      "Tạo lại mã khôi phục",
      "Tạo mã mới",
      "Dùng mã khôi phục",
      "Mã khôi phục",
    ];
    for (const key of keys) {
      expect(translateText(key, "en-US")).not.toBe(key);
    }
  });

  it("có đầy đủ bản dịch tiếng Anh cho toàn bộ chuỗi giao diện modal đổi email", () => {
    const requiredKeys = [
      "Thay đổi địa chỉ email",
      "Xác minh địa chỉ email mới",
      "Nhập địa chỉ email mới để nhận mã xác minh gồm 6 chữ số",
      "Nhập mã xác minh gồm 6 chữ số đã được gửi tới email mới",
      "Quay lại đổi email",
      "Email hiện tại:",
      "Gửi mã xác minh",
      "Gửi lại mã",
      "Mã xác minh 6 chữ số đã được gửi tới:",
      "Email mới không đúng định dạng.",
      "Email mới phải khác email hiện tại của tài khoản.",
      "Mã xác minh OTP đã được gửi đến email mới của bạn.",
      "Không thể gửi mã xác minh.",
      "Vui lòng nhập đủ 6 chữ số xác minh.",
      "Đã xác minh và cập nhật địa chỉ email mới.",
      "Không thể xác minh địa chỉ email mới.",
      "Huỷ",
      "Xác minh",
    ];
    for (const key of requiredKeys) {
      expect(translateText(key, "en-US")).not.toBe(key);
    }
  });

  it("gọi đúng endpoint OTP đổi mật khẩu, PATCH mật khẩu và đăng xuất các phiên khác", async () => {
    const originalImplementation = apiMock.getMockImplementation()!;
    apiMock.mockImplementation((path: string, init?: RequestInit) => {
      if (path === "/account/sessions" && !init?.method) {
        const request = deferred<AccountSession[]>();
        sessions.push(request);
        return request.promise;
      }
      if (path === "/account/password/otp" && init?.method === "POST") {
        return Promise.resolve({
          challengeId: "chg-123",
          email: "user@example.com",
          expiresInSeconds: 300,
          resendAfterSeconds: 60,
        });
      }
      if (path === "/account/password" && init?.method === "PATCH") {
        return Promise.resolve({ revokedSessions: 1 });
      }
      if (path === "/account/sessions/revoke-others" && init?.method === "POST") {
        return Promise.resolve({ revokedSessions: 1 });
      }
      return originalImplementation(path);
    });

    render(<AccountPage />);
    await waitFor(() => expect(profiles).toHaveLength(1));
    await act(async () => {
      profiles[0]!.resolve(makeProfile("Initial"));
      sessions[0]!.resolve([
        {
          id: "sess-1",
          current: true,
          currentRoleCode: "SYSTEM_ADMIN",
          ipAddress: "127.0.0.1",
          userAgent: "Chrome",
          createdAt: "2026-10-01T00:00:00Z",
          lastSeenAt: "2026-10-01T00:00:00Z",
          expiresAt: "2026-11-01T00:00:00Z",
        },
        {
          id: "sess-2",
          current: false,
          currentRoleCode: "SYSTEM_ADMIN",
          ipAddress: "10.0.0.2",
          userAgent: "Firefox",
          createdAt: "2026-10-01T00:00:00Z",
          lastSeenAt: "2026-10-01T00:00:00Z",
          expiresAt: "2026-11-01T00:00:00Z",
        },
      ]);
    });

    fireEvent.click(screen.getByRole("button", { name: "Bảo mật" }));
    fireEvent.change(screen.getByLabelText("Mật khẩu hiện tại"), { target: { value: "Current#Pass2026" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Gửi mã OTP xác nhận/ }));
    });

    expect(apiMock).toHaveBeenCalledWith(
      "/account/password/otp",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ email: "user@example.com", currentPassword: "Current#Pass2026" }),
      }),
    );

    await waitFor(() => expect(screen.getByLabelText(/^Mật khẩu mới/)).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText(/^Mật khẩu mới/), { target: { value: "StrongPass#2026" } });
    fireEvent.change(screen.getByLabelText("Nhập lại mật khẩu mới"), { target: { value: "StrongPass#2026" } });
    fireEvent.change(screen.getByLabelText("Mã OTP 6 số"), { target: { value: "654321" } });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Xác nhận đổi mật khẩu/ }));
    });

    expect(apiMock).toHaveBeenCalledWith(
      "/account/password",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({
          challengeId: "chg-123",
          code: "654321",
          newPassword: "StrongPass#2026",
          currentPassword: "Current#Pass2026",
        }),
      }),
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Đóng mọi phiên khác/ }));
    });
    expect(apiMock).toHaveBeenCalledWith(
      "/account/sessions/revoke-others",
      expect.objectContaining({ method: "POST" }),
    );
  });
});
