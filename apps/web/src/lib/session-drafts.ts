const PREFIX = "wind-edu:draft:v1:";
export const DRAFT_MAX_AGE = 24 * 60 * 60 * 1000;
const MAX_SIZE = 200_000;

/** Lưu bản nháp trong tab hiện tại, giới hạn kích thước và không làm hỏng form khi bộ nhớ bị chặn. */
export function writeSessionDraft(key: string, value: unknown): boolean {
  try {
    const serialized = JSON.stringify({
      version: 1,
      savedAt: Date.now(),
      value,
    });
    if (serialized.length > MAX_SIZE) return false;
    window.sessionStorage.setItem(PREFIX + key, serialized);
    return true;
  } catch {
    return false;
  }
}

/** Khôi phục bản nháp đúng cấu trúc, loại dữ liệu lỗi hoặc quá hạn thay vì tin dữ liệu trên thiết bị. */
export function readSessionDraft<T>(
  key: string,
  valid: (value: unknown) => value is T,
): T | null {
  try {
    const raw = window.sessionStorage.getItem(PREFIX + key);
    if (!raw) return null;
    if (raw.length > MAX_SIZE) {
      removeSessionDraft(key);
      return null;
    }
    const entry = JSON.parse(raw);
    if (
      entry?.version !== 1 ||
      typeof entry.savedAt !== "number" ||
      entry.savedAt > Date.now() ||
      Date.now() - entry.savedAt >= DRAFT_MAX_AGE ||
      !valid(entry.value)
    ) {
      removeSessionDraft(key);
      return null;
    }
    return entry.value;
  } catch {
    removeSessionDraft(key);
    return null;
  }
}

/** Xóa bản nháp đã lưu thành công hoặc đã được người dùng chủ động bỏ. */
export function removeSessionDraft(key: string): void {
  try {
    window.sessionStorage.removeItem(PREFIX + key);
  } catch {
    /* Bộ nhớ có thể bị chặn; không ngăn người dùng tiếp tục làm việc. */
  }
}

/** Xóa riêng dữ liệu nháp của ứng dụng khi đăng xuất, không đụng tới storage khác. */
export function clearSessionDrafts(): void {
  try {
    const storage = window.sessionStorage;
    const keys = Array.from({ length: storage.length }, (_, index) =>
      storage.key(index),
    );
    keys.forEach((key) => {
      if (key?.startsWith(PREFIX)) storage.removeItem(key);
    });
  } catch {
    /* Không có dữ liệu đọc được khi trình duyệt chặn storage. */
  }
}
