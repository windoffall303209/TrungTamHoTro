import { blank, blankAiConfig } from "./exams.shared";

export interface ExamEditorDraft {
  form: typeof blank;
  aiConfig: typeof blankAiConfig;
}

/** Kiểm tra cấu trúc dữ liệu nháp; không thay thế ràng buộc nghiệp vụ khi gửi đề lên API. */
export function isExamEditorDraft(value: unknown): value is ExamEditorDraft {
  if (!value || typeof value !== "object") return false;
  const draft = value as Record<string, unknown>;
  const form = draft.form as Record<string, unknown> | null;
  const ai = draft.aiConfig as Record<string, unknown> | null;
  if (!form || typeof form !== "object" || !ai || typeof ai !== "object")
    return false;
  return (
    ["classId", "title", "openAt", "closeAt", "randomSeed"].every(
      (key) => typeof form[key] === "string",
    ) &&
    ["durationMinutes", "totalScore", "attemptLimit"].every(
      (key) => typeof form[key] === "number" && Number.isFinite(form[key]),
    ) &&
    typeof form.shuffleQuestions === "boolean" &&
    stringArray(form.questionIds) &&
    numberMap(form.scoreAllocations) &&
    ["focus", "providerId", "model"].every(
      (key) => typeof ai[key] === "string",
    ) &&
    ["VI", "EN", "BILINGUAL"].includes(String(ai.language)) &&
    [1, 2, 3].includes(Number(ai.difficulty)) &&
    typeof ai.difficulty === "number" &&
    ["AUTO", "COURSE_MATERIALS", "WEB_SEARCH"].includes(
      String(ai.contextMode),
    ) &&
    stringArray(ai.materialIds) &&
    numberMap(ai.distribution) &&
    Object.keys(blankAiConfig.distribution).every((key) =>
      Object.hasOwn(ai.distribution as object, key),
    )
  );
}

/** Chỉ nhận danh sách chuỗi có giới hạn để không phục hồi cấu trúc tùy ý. */
function stringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length <= 1000 &&
    value.every((item) => typeof item === "string")
  );
}

/** Chỉ nhận bảng số hữu hạn, loại các khóa đặc biệt khỏi cấu hình điểm và ma trận. */
function numberMap(value: unknown): value is Record<string, number> {
  return (
    !!value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.entries(value).every(
      ([key, number]) =>
        !["__proto__", "constructor", "prototype"].includes(key) &&
        typeof number === "number" &&
        Number.isFinite(number),
    )
  );
}
