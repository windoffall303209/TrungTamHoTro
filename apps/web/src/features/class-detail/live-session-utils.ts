import type { LearningClass, LiveSession } from "@/lib/learning-types";

export const GOOGLE_MEET_URL_ERROR =
  "Link phòng học phải là URL Google Meet hợp lệ (https://meet.google.com/...).";

export interface SessionFormValues {
  title: string;
  date: string;
  startTime: string;
  endTime: string;
  meetingUrl: string;
  reason?: string;
}

export interface SessionFormValidationResult {
  valid: boolean;
  errors: Partial<Record<"title" | "time" | "meetingUrl" | "reason", string>>;
  firstError: string;
  startsAtIso?: string;
  endsAtIso?: string;
  normalizedMeetingUrl?: string;
}

// Chuẩn hóa và xác thực link Google Meet theo đúng chuẩn HTTPS meet.google.com.
export function normalizeGoogleMeetUrlInput(rawUrl: string): string | null {
  const trimmed = rawUrl.trim();
  if (!trimmed || /\s/.test(trimmed) || trimmed.length > 1000) return null;
  const candidate =
    !/^[a-z]+:\/\//i.test(trimmed) &&
    trimmed.toLowerCase().startsWith("meet.google.com/")
      ? `https://${trimmed}`
      : trimmed;
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    return null;
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.hostname.toLowerCase() !== "meet.google.com" ||
    Boolean(parsed.username) ||
    Boolean(parsed.password) ||
    parsed.pathname.replaceAll("/", "").length === 0
  ) {
    return null;
  }
  return parsed.toString();
}

// Trả về mốc thứ Hai đầu tuần ở múi giờ cục bộ.
export function getWeekMonday(date: Date): Date {
  const next = new Date(date);
  const day = next.getDay();
  const offset = (day === 0 ? -6 : 1) - day;
  next.setDate(next.getDate() + offset);
  next.setHours(0, 0, 0, 0);
  return next;
}

// Cộng thêm số ngày theo lịch cục bộ mà không làm biến đổi đối tượng gốc.
export function addDaysToDate(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

// Kiểm tra hai mốc thời gian có rơi vào cùng ngày dương lịch cục bộ hay không.
export function isSameCalendarDay(left: Date, right: Date): boolean {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  );
}

// Định dạng ngày tháng ngắn dạng DD/MM để hiển thị trên cột tuần.
export function formatDayMonth(date: Date): string {
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${day}/${month}`;
}

// Chuyển Date sang chuỗi YYYY-MM-DD cho input type="date".
export function toLocalDateInputValue(date: Date): string {
  const year = String(date.getFullYear());
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

// Chuyển Date sang chuỗi HH:mm cho input type="time".
export function toLocalTimeInputValue(date: Date): string {
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${hours}:${minutes}`;
}

// Kết hợp chuỗi YYYY-MM-DD và HH:mm thành Date hợp lệ hoặc null nếu sai ngày giờ.
export function combineLocalDateAndTime(dateStr: string, timeStr: string): Date | null {
  const dateParts = dateStr.trim().split("-");
  const timeParts = timeStr.trim().split(":");
  if (dateParts.length !== 3 || timeParts.length < 2) return null;
  const year = Number(dateParts[0]);
  const month = Number(dateParts[1]);
  const day = Number(dateParts[2]);
  const hours = Number(timeParts[0]);
  const minutes = Number(timeParts[1]);
  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    !Number.isInteger(day) ||
    !Number.isInteger(hours) ||
    !Number.isInteger(minutes)
  ) {
    return null;
  }
  const combined = new Date(year, month - 1, day, hours, minutes, 0, 0);
  if (
    Number.isNaN(combined.getTime()) ||
    combined.getFullYear() !== year ||
    combined.getMonth() !== month - 1 ||
    combined.getDate() !== day ||
    combined.getHours() !== hours ||
    combined.getMinutes() !== minutes
  ) {
    return null;
  }
  return combined;
}

// Đề xuất giá trị mặc định hợp lệ khi mở modal thêm buổi học mới của lớp.
export function buildDefaultSessionDraft(
  classItem: Pick<LearningClass, "startAt" | "endAt">,
  now: Date = new Date(),
): SessionFormValues {
  const tomorrow = addDaysToDate(now, 1);
  tomorrow.setHours(19, 30, 0, 0);
  const classStart = new Date(classItem.startAt);
  const classEnd = new Date(classItem.endAt);
  let targetDate = tomorrow;
  if (!Number.isNaN(classStart.getTime()) && tomorrow < classStart) {
    targetDate = classStart;
  }
  if (!Number.isNaN(classEnd.getTime()) && targetDate > classEnd) {
    const candidate = new Date(now.getTime() + 60 * 60_000);
    candidate.setMinutes(0, 0, 0);
    targetDate = candidate <= classEnd ? candidate : classEnd;
  }
  return {
    title: "",
    date: toLocalDateInputValue(targetDate),
    startTime: "19:30",
    endTime: "21:00",
    meetingUrl: "",
    reason: "",
  };
}

// Kiểm tra dữ liệu form thêm/sửa buổi học thống nhất với quy tắc trên server.
export function validateSessionFormInput(
  input: SessionFormValues & {
    classItem: Pick<LearningClass, "startAt" | "endAt">;
    requireReason?: boolean;
    now?: Date;
  },
): SessionFormValidationResult {
  const errors: SessionFormValidationResult["errors"] = {};
  const trimmedTitle = input.title.trim();
  if (trimmedTitle.length < 3) {
    errors.title = "Tên buổi học cần ít nhất 3 ký tự.";
  }

  const startsAt = combineLocalDateAndTime(input.date, input.startTime);
  const endsAt = combineLocalDateAndTime(input.date, input.endTime);
  const now = input.now ?? new Date();
  const classStart = new Date(input.classItem.startAt);
  const classEnd = new Date(input.classItem.endAt);

  if (!startsAt || !endsAt) {
    errors.time = "Vui lòng chọn ngày học, giờ bắt đầu và giờ kết thúc hợp lệ.";
  } else if (endsAt <= startsAt) {
    errors.time = "Thời gian kết thúc phải sau thời gian bắt đầu.";
  } else if (startsAt <= now) {
    errors.time = "Không thể lên lịch buổi học trong quá khứ.";
  } else if (
    !Number.isNaN(classStart.getTime()) &&
    !Number.isNaN(classEnd.getTime()) &&
    (startsAt < classStart || endsAt > classEnd)
  ) {
    errors.time = "Buổi học phải nằm trong thời gian của lớp.";
  }

  const normalizedMeetingUrl = normalizeGoogleMeetUrlInput(input.meetingUrl);
  if (!normalizedMeetingUrl) {
    errors.meetingUrl = GOOGLE_MEET_URL_ERROR;
  }

  const firstError =
    errors.title ?? errors.time ?? errors.meetingUrl ?? errors.reason ?? "";
  return {
    valid: Object.keys(errors).length === 0,
    errors,
    firstError,
    startsAtIso: startsAt?.toISOString(),
    endsAtIso: endsAt?.toISOString(),
    normalizedMeetingUrl: normalizedMeetingUrl ?? undefined,
  };
}

// Chuyển trạng thái buổi học sang nhãn tiếng Việt để hiển thị trên lịch lớp.
export function formatSessionStatusLabel(
  session: Pick<LiveSession, "status" | "startsAt">,
  now: Date = new Date(),
): string {
  if (session.status === "CANCELLED") return "Đã hủy";
  if (session.status === "COMPLETED") return "Đã kết thúc";
  if (session.status === "LIVE") return "Đang diễn ra";
  const startsAt = new Date(session.startsAt);
  if (isSameCalendarDay(startsAt, now)) return "Hôm nay";
  return startsAt < now ? "Đã diễn ra" : "Sắp diễn ra";
}

// Kiểm tra học viên có được vào phòng học ở thời điểm hiện tại hay không.
export function canLearnerJoinSession(
  session: Pick<LiveSession, "status" | "startsAt" | "endsAt">,
  nowMs: number,
): boolean {
  if (session.status === "CANCELLED" || session.status === "COMPLETED") {
    return false;
  }
  if (session.status === "LIVE") return true;
  const startsMs = new Date(session.startsAt).getTime();
  const endsMs = new Date(session.endsAt).getTime();
  return nowMs >= startsMs - 15 * 60_000 && nowMs <= endsMs + 30 * 60_000;
}
