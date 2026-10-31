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
    const value: unknown = raw ? JSON.parse(raw) : null;
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const state = value as Record<string, unknown>;
    if (typeof state.setupToken !== "string" || typeof state.username !== "string") return null;
    if (state.email !== undefined && typeof state.email !== "string") return null;
    if (state.challengeId !== undefined && typeof state.challengeId !== "string") return null;
    if (state.resendAvailableAt !== undefined && (typeof state.resendAvailableAt !== "number" || !Number.isFinite(state.resendAvailableAt))) return null;
    return { ...state, setupToken: state.setupToken, username: state.username };
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
