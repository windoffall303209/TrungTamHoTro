import { apiEnglishErrors } from "./generated-en-errors.js";

const GENERIC_API_ERROR = "The request could not be completed. Please review the information and try again.";

const aiOperationEnglish: Readonly<Record<string, string>> = Object.freeze({
  "hỏi đáp tài liệu": "running document Q&A",
  "trích xuất tài liệu": "extracting document content",
  "chuẩn bị ngữ cảnh cho Custom": "preparing context for the custom model",
  "tìm nguồn Internet": "searching web sources",
  "tạo đề": "generating the exam",
  "tải danh sách model": "loading the model list",
  "sinh đề Custom": "generating the custom exam",
  "tạo đề OpenAI": "generating the exam with OpenAI",
  "tải tài liệu OpenAI": "uploading the document to OpenAI",
  "kiểm tra kết nối": "testing the connection",
  "đọc ảnh đề thi": "reading the exam image",
});

// Chuyển tên thao tác AI tiếng Việt sang cụm động từ tiếng Anh thống nhất.
function localizeAiOperation(operation: string): string {
  const withGemini = operation.endsWith(" Gemini");
  const baseKey = withGemini ? operation.slice(0, -" Gemini".length) : operation;
  const translated = aiOperationEnglish[operation] ?? aiOperationEnglish[baseKey];
  if (translated) return withGemini && !aiOperationEnglish[operation] ? `${translated} on Gemini` : translated;
  return operation;
}

const apiErrorPatterns: ReadonlyArray<readonly [RegExp, (...groups: string[]) => string]> = [
  [/^Vai trò (.+?) không có quyền: (.+)$/, (role, permissions): string => `Role ${role} lacks required permission: ${permissions}`],
  [/^Tham số (.+?) không hợp lệ\.$/, (key): string => `Invalid parameter: ${key}.`],
  [/^Ảnh câu hỏi không an toàn: (.+)$/, (threat): string => `Question image failed security scan: ${threat}`],
  [/^Không thể kết nối Gemini để (.+)\.$/, (operation): string => `Unable to connect to Gemini while ${localizeAiOperation(operation)}.`],
  [/^Không thể tải tệp (.+?) lên OpenAI\.$/, (fileName): string => `Unable to upload file ${fileName} to OpenAI.`],
  [/^OpenAI không trả về mã tệp hợp lệ cho (.+)\.$/, (fileName): string => `OpenAI did not return a valid file ID for ${fileName}.`],
  [/^Provider từ chối dữ liệu khi (.+?) \(400\)\. Kiểm tra model và định dạng request\.$/, (operation): string => `Provider rejected the payload while ${localizeAiOperation(operation)} (400). Check the model and request format.`],
  [/^Provider từ chối API key hoặc quyền truy cập khi (.+?) \((\d+)\)\.$/, (operation, status): string => `Provider rejected the API key or permissions while ${localizeAiOperation(operation)} (${status}).`],
  [/^Không tìm thấy endpoint hoặc model khi (.+?) \(404\)\.$/, (operation): string => `Endpoint or model not found while ${localizeAiOperation(operation)} (404).`],
  [/^Provider đã hết hạn mức khi (.+?) \(429\)\. Hãy thử lại sau hoặc đổi model\.$/, (operation): string => `Provider quota exceeded while ${localizeAiOperation(operation)} (429). Try again later or switch models.`],
  [/^Provider tạm thời không phục vụ khi (.+?) \((\d+)\)\.$/, (operation, status): string => `Provider is temporarily unavailable while ${localizeAiOperation(operation)} (${status}).`],
  [/^Resend từ chối yêu cầu gửi email(?: \((.+)\))?\.$/, (code): string => `Resend rejected the email request${code ? ` (${code})` : ""}.`],
  [/^Cloudinary trả về lỗi tải tệp \((\d+)\)\.$/, (status): string => `Cloudinary returned a file upload error (${status}).`],
  [/^Cloudinary từ chối tệp tải lên(?: \((.+)\))?\.$/, (code): string => `Cloudinary rejected the uploaded file${code ? ` (${code})` : ""}.`],
];

// Tra cứu bản dịch cho một thông báo đơn lẻ qua từ điển tĩnh hoặc mẫu động cho phép.
function localizeSingleError(message: string): string | null {
  const exact = apiEnglishErrors[message];
  if (exact) return exact;
  for (const [pattern, render] of apiErrorPatterns) {
    const match = message.match(pattern);
    if (match) return render(...match.slice(1));
  }
  return null;
}

/** Chuẩn hóa Accept-Language thành locale được hệ thống hỗ trợ. */
export function resolveRequestLocale(header: string | string[] | undefined): "vi-VN" | "en-US" {
  const value = Array.isArray(header) ? header.join(",") : header ?? "";
  return /(^|,)\s*en(?:-|;|,|$)/i.test(value) ? "en-US" : "vi-VN";
}

/** Dịch thông điệp API đã chuẩn hóa sang tiếng Anh khi request yêu cầu. */
export function localizeErrorMessage(message: string, locale: "vi-VN" | "en-US"): string {
  if (locale === "vi-VN") return message;
  const direct = localizeSingleError(message);
  if (direct) return direct;
  if (message.includes("; ")) {
    const parts = message.split("; ").map((part) => part.trim()).filter(Boolean);
    if (parts.length > 1) {
      const translated = parts.map((part) => localizeSingleError(part));
      if (translated.every((item): item is string => item !== null)) return translated.join("; ");
    }
  }
  return GENERIC_API_ERROR;
}
