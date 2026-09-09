import { apiEnglishErrors } from "./generated-en-errors.js";

/** Chuẩn hóa Accept-Language thành locale được hệ thống hỗ trợ. */
export function resolveRequestLocale(header: string | string[] | undefined): "vi-VN" | "en-US" {
  const value = Array.isArray(header) ? header.join(",") : header ?? "";
  return /(^|,)\s*en(?:-|;|,|$)/i.test(value) ? "en-US" : "vi-VN";
}

/** Dịch thông điệp API đã chuẩn hóa sang tiếng Anh khi request yêu cầu. */
export function localizeErrorMessage(message: string, locale: "vi-VN" | "en-US"): string {
  if (locale === "vi-VN") return message;
  return apiEnglishErrors[message] ?? "The request could not be completed. Please review the information and try again.";
}
