const STORAGE_KEY = "wind-edu:account-setup";

/** Trạng thái xác thực tài khoản tạm của thẻ hiện tại; email chỉ có sau khi mã OTP đã được gửi. */
export interface AccountSetupState {
  setupToken: string;
  username: string;
  email?: string;
  challengeId?: string;
  resendAvailableAt?: number;
}

/** Đọc trạng thái đã lưu; dữ liệu hỏng hoặc trình duyệt chặn sessionStorage được coi như chưa có. */
export function readAccountSetup(): AccountSetupState | null {
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    const value = raw ? JSON.parse(raw) as Partial<AccountSetupState> : null;
    return value && typeof value.setupToken === "string" && typeof value.username === "string" ? value as AccountSetupState : null;
  } catch {
    return null;
  }
}

/** Lưu vào sessionStorage để đóng thẻ là mất, không giữ email ngoài phiên xác thực đang làm. */
export function saveAccountSetup(state: AccountSetupState): void {
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Trình duyệt chặn lưu trữ thì trạng thái chỉ còn trong bộ nhớ của trang hiện tại.
  }
}

/** Xóa trạng thái khi xác thực xong hoặc phiên xác thực hết hạn. */
export function clearAccountSetup(): void {
  try {
    window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Không có gì để dọn khi trình duyệt chặn lưu trữ.
  }
}
