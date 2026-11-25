import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isEnglishCatalogLoaded, LOCALE_STORAGE_KEY, resetEnglishCatalogForTests } from "@/i18n/catalog";
import { apiRequest } from "@/lib/api-client";
import { I18nProvider, useI18n } from "@/providers/i18n-provider";

/** Component thử nghiệm dùng hook useI18n và văn bản DOM trực tiếp để kiểm tra chuyển đổi locale. */
function LocaleProbe() {
  const { locale, setLocale, t } = useI18n();
  return (
    <div>
      <span data-testid="active-locale">{locale}</span>
      <span data-testid="hook-label">{t("Bài tập")}</span>
      <p data-testid="dom-label">Khóa học &amp; Lớp</p>
      <button type="button" onClick={() => setLocale("en-US")}>
        Switch EN
      </button>
      <button type="button" onClick={() => setLocale("vi-VN")}>
        Switch VI
      </button>
    </div>
  );
}

describe("I18nProvider async EN catalog and error translation (C03)", () => {
  beforeEach(() => {
    resetEnglishCatalogForTests();
    window.localStorage.removeItem(LOCALE_STORAGE_KEY);
    document.documentElement.lang = "vi-VN";
    document.documentElement.dataset.locale = "vi-VN";
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    window.localStorage.removeItem(LOCALE_STORAGE_KEY);
    document.documentElement.lang = "vi-VN";
    document.documentElement.dataset.locale = "vi-VN";
  });

  it("không nạp từ điển EN ở mặc định vi-VN, chỉ nạp khi đổi sang en-US và khôi phục sạch về vi-VN", async () => {
    render(
      <I18nProvider>
        <LocaleProbe />
      </I18nProvider>,
    );

    expect(screen.getByTestId("active-locale")).toHaveTextContent("vi-VN");
    expect(screen.getByTestId("hook-label")).toHaveTextContent("Bài tập");
    expect(screen.getByTestId("dom-label")).toHaveTextContent("Khóa học & Lớp");
    expect(isEnglishCatalogLoaded()).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "Switch EN" }));

    await waitFor(() => {
      expect(isEnglishCatalogLoaded()).toBe(true);
      expect(screen.getByTestId("hook-label")).toHaveTextContent("Assignments");
      expect(screen.getByTestId("dom-label")).toHaveTextContent("Courses & Classes");
    }, { timeout: 5000 });
    expect(document.documentElement.lang).toBe("en-US");

    fireEvent.click(screen.getByRole("button", { name: "Switch VI" }));

    await waitFor(() => {
      expect(screen.getByTestId("hook-label")).toHaveTextContent("Bài tập");
      expect(screen.getByTestId("dom-label")).toHaveTextContent("Khóa học & Lớp");
    });
    expect(document.documentElement.lang).toBe("vi-VN");
  });

  it("dịch chính xác thông báo lỗi API sang tiếng Anh ngay cả khi từ điển EN chưa nạp sẵn", async () => {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, "en-US");
    expect(isEnglishCatalogLoaded()).toBe(false);

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ error: { message: "Không tìm thấy đề cần duyệt hoặc đã công bố." } }), {
        status: 404,
        headers: { "content-type": "application/json" },
      }),
    );

    await expect(apiRequest("/exams/missing")).rejects.toThrow(
      "No exam pending review or published was found.",
    );
    expect(isEnglishCatalogLoaded()).toBe(true);
  });
});
