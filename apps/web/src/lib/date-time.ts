const LOCAL_DATETIME_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;

/** Đệm số nguyên thành 2 chữ số cho định dạng lịch nội bộ. */
function padTwo(value: number): string {
  return String(value).padStart(2, "0");
}

/** Chuyển Date/ISO/timestamp sang chuỗi YYYY-MM-DDTHH:mm theo đúng giờ địa phương (không cắt lát UTC). */
export function toLocalDateTimeInput(value: Date | string | number): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}-${padTwo(date.getMonth() + 1)}-${padTwo(date.getDate())}T${padTwo(date.getHours())}:${padTwo(date.getMinutes())}`;
}

/** Phân tích chuỗi datetime-local (hoặc ISO có múi giờ) về đối tượng Date hợp lệ, từ chối ngày tràn lịch. */
export function parseLocalDateTimeInput(value: string): Date | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const match = LOCAL_DATETIME_PATTERN.exec(trimmed);
  if (match) {
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const hours = Number(match[4]);
    const minutes = Number(match[5]);
    const seconds = match[6] ? Number(match[6]) : 0;
    const parsed = new Date(year, month - 1, day, hours, minutes, seconds, 0);
    if (
      Number.isNaN(parsed.getTime()) ||
      parsed.getFullYear() !== year ||
      parsed.getMonth() !== month - 1 ||
      parsed.getDate() !== day ||
      parsed.getHours() !== hours ||
      parsed.getMinutes() !== minutes ||
      parsed.getSeconds() !== seconds
    ) {
      return null;
    }
    return parsed;
  }
  const fallback = new Date(trimmed);
  return Number.isNaN(fallback.getTime()) ? null : fallback;
}

/** Chuyển giá trị từ input datetime-local sang chuẩn ISO-8601 UTC để gửi lên API mà không lệch múi giờ. */
export function localDateTimeToIso(value: string): string {
  const parsed = parseLocalDateTimeInput(value);
  if (!parsed) throw new Error("Thời gian nhập vào không hợp lệ.");
  return parsed.toISOString();
}

/** Chuẩn hóa tên tệp sang Unicode NFC để hiển thị và đối chiếu đồng nhất giữa macOS, Windows và Linux. */
export function normalizeDisplayFileName(value: string): string {
  return value.normalize("NFC");
}
