import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearSessionDrafts,
  clearSessionDraftsExceptUser,
  clearUserLocalData,
  readSessionDraft,
  removeSessionDraft,
  writeSessionDraft,
} from "../../../src/lib/session-drafts";
import { isExamEditorDraft } from "@/features/exams/exam-draft";
import { blank, blankAiConfig } from "@/features/exams/exams.shared";

/** Nhận bản nháp chuỗi đơn giản dùng để kiểm tra cơ chế lưu trữ độc lập. */
function isText(value: unknown): value is string {
  return typeof value === "string";
}

describe("Bộ nhớ nháp của tab", () => {
  beforeEach(() => sessionStorage.clear());
  afterEach(() => vi.restoreAllMocks());
  it("tách tài khoản và phiên bản, chỉ xóa đúng khóa được yêu cầu", () => {
    writeSessionDraft("user-a:exam:1", "Bản A");
    writeSessionDraft("user-b:exam:1", "Bản B");
    expect(readSessionDraft("user-a:exam:2", isText)).toBeNull();
    removeSessionDraft("user-a:exam:1");
    expect(readSessionDraft("user-b:exam:1", isText)).toBe("Bản B");
  });
  it("không nhận bản nháp quá 24 giờ, JSON hỏng hay sai cấu trúc", () => {
    writeSessionDraft("old", "Bản cũ");
    const now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now + 25 * 60 * 60 * 1000);
    expect(readSessionDraft("old", isText)).toBeNull();
    sessionStorage.setItem("wind-edu:draft:v1:bad", "{");
    expect(readSessionDraft("bad", isText)).toBeNull();
    writeSessionDraft("shape", { form: null });
    expect(readSessionDraft("shape", isExamEditorDraft)).toBeNull();
    writeSessionDraft("valid", { form: blank, aiConfig: blankAiConfig });
    expect(readSessionDraft("valid", isExamEditorDraft)?.form.title).toBe("");
  });
  it("từ chối giá trị quá lớn và không ném lỗi khi storage đầy", () => {
    expect(writeSessionDraft("large", "a".repeat(200_001))).toBe(false);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("Quota", "QuotaExceededError");
    });
    expect(writeSessionDraft("quota", "Bản nháp")).toBe(false);
  });
  it("đăng xuất chỉ xóa bản nháp của ứng dụng", () => {
    sessionStorage.setItem("unrelated", "Giữ nguyên");
    writeSessionDraft("draft", "Xóa");
    clearSessionDrafts();
    expect(readSessionDraft("draft", isText)).toBeNull();
    expect(sessionStorage.getItem("unrelated")).toBe("Giữ nguyên");
  });
  it("đăng nhập tài khoản khác trong cùng tab chỉ xóa nháp của tài khoản cũ và giữ nháp của tài khoản mới", () => {
    writeSessionDraft("usr-old:INSTRUCTOR:MANUAL", "Nháp cũ");
    writeSessionDraft("usr-new:INSTRUCTOR:MANUAL", "Nháp mới");
    clearSessionDraftsExceptUser("usr-new");
    expect(readSessionDraft("usr-old:INSTRUCTOR:MANUAL", isText)).toBeNull();
    expect(readSessionDraft("usr-new:INSTRUCTOR:MANUAL", isText)).toBe("Nháp mới");
  });
  it("đăng xuất xóa dữ liệu localStorage theo tài khoản nhưng giữ ngôn ngữ và giao diện", () => {
    localStorage.setItem("wind-chat-drafts:usr-1", "{}");
    localStorage.setItem("class_feed_posts_class-1", "[]");
    localStorage.setItem("wind_edu_mini_chat_open_windows_usr-1", "[]");
    localStorage.setItem("wind-ai-request:usr-1:abc", "id");
    localStorage.setItem("wind-edu-locale", "en-US");
    localStorage.setItem("wind-edu-theme", "dark");
    clearUserLocalData();
    expect(localStorage.getItem("wind-chat-drafts:usr-1")).toBeNull();
    expect(localStorage.getItem("class_feed_posts_class-1")).toBeNull();
    expect(localStorage.getItem("wind_edu_mini_chat_open_windows_usr-1")).toBeNull();
    expect(localStorage.getItem("wind-ai-request:usr-1:abc")).toBeNull();
    expect(localStorage.getItem("wind-edu-locale")).toBe("en-US");
    expect(localStorage.getItem("wind-edu-theme")).toBe("dark");
  });
});
