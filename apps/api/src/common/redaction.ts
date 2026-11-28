/** Tên khóa JSON mang giá trị bí mật; giá trị chuỗi dưới các khóa này luôn bị che khi ghi audit hoặc xuất dữ liệu. */
const SENSITIVE_KEY = /pass(?:word|wd)?|token|secret|credential|authorization|api[-_]?key|access[-_]?key|cookie|session[-_]?id|otp|signature|private[-_]?key/i;

/**
 * Mẫu token trong chuỗi tự do. Header Authorization được che cả phần sau scheme (Bearer/Basic…),
 * nên `Authorization: Bearer <jwt>` không còn lộ JWT như bộ lọc cũ dừng ở khoảng trắng đầu tiên.
 */
const SENSITIVE_PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\b(authorization|proxy-authorization)\s*[:=]\s*(?:(?:bearer|basic|token|digest)\s+)?[^\s,;"']+/gi, "$1=[REDACTED]"],
  [/\b(bearer|basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi, "$1 [REDACTED]"],
  [/(["']?)(password|passwd|token|secret|credential|api[-_]?key|access[-_]?key|refresh[-_]?token|client[-_]?secret|cookie)\1\s*[:=]\s*(["']?)[^\s,;"'&]+\3/gi, "$2=[REDACTED]"],
  [/\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}/g, "[REDACTED_JWT]"],
  [/\b(?:sk|pk|rk)-[A-Za-z0-9_-]{16,}/g, "[REDACTED_KEY]"],
  [/\bAIza[0-9A-Za-z_-]{30,}/g, "[REDACTED_KEY]"],
  [/([?&](?:token|signature|key|code|access_token|refresh_token)=)[^&\s"']+/gi, "$1[REDACTED]"],
];

/** Che password/token/secret/JWT/API key trong chuỗi tự do (chi tiết audit, thông báo lỗi) trước khi lưu hoặc trả ra. */
export function redactSensitive(value: string): string {
  return SENSITIVE_PATTERNS.reduce((text, [pattern, replacement]) => text.replace(pattern, replacement), value);
}

/**
 * Che đệ quy giá trị JSON: chuỗi dưới khóa nhạy cảm bị thay bằng [REDACTED], mọi chuỗi khác đi qua bộ lọc mẫu token.
 * Giữ nguyên boolean/số (vd. cờ apiKeyChanged) để audit vẫn có ý nghĩa; giới hạn độ sâu chống đệ quy vô hạn.
 */
export function redactSensitiveValue(value: unknown, depth = 0): unknown {
  if (typeof value === "string") return redactSensitive(value);
  if (value === null || typeof value !== "object" || value instanceof Date || depth > 8) return value;
  if (Array.isArray(value)) return value.map((item) => redactSensitiveValue(item, depth + 1));
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [
    key,
    SENSITIVE_KEY.test(key) && typeof item === "string" && item ? "[REDACTED]" : redactSensitiveValue(item, depth + 1),
  ]));
}

/**
 * Vô hiệu hóa CSV/Formula Injection: ô văn bản bắt đầu bằng = + - @ (kể cả sau khoảng trắng) hoặc tab/CR
 * được thêm tiền tố nháy đơn để Excel/Sheets hiển thị như chữ thay vì thực thi công thức.
 */
export function csvSafeText(value: string): string {
  return /^(?:\s*[=+\-@]|[\t\r])/.test(value) ? `'${value}` : value;
}
