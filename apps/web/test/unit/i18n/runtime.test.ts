import { afterEach, describe, expect, it, vi } from "vitest";
import { LOCALE_STORAGE_KEY } from "../../../src/i18n/catalog";
import { activeLocale } from "../../../src/i18n/runtime";

describe("activeLocale", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
    document.documentElement.lang = "vi-VN";
  });

  it("ưu tiên ngôn ngữ hợp lệ đã lưu", () => {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, "en-US");
    expect(activeLocale()).toBe("en-US");
  });

  it("dùng ngôn ngữ của trang khi localStorage bị chặn", () => {
    document.documentElement.lang = "en-US";
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new DOMException("Blocked", "SecurityError"); });
    expect(activeLocale()).toBe("en-US");
  });
});
