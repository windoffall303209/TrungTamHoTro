import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { I18nProvider, useI18n } from "./i18n-provider";

/** Tạo nút đổi locale để kiểm tra provider bằng đúng API công khai. */
function LocaleFixture() {
  const { locale, setLocale } = useI18n();
  return <><p>Bài tập</p><p>Đã đóng 3 phiên khác.</p><button onClick={() => setLocale(locale === "vi-VN" ? "en-US" : "vi-VN")}>switch</button></>;
}

describe("I18nProvider", () => {
  afterEach(() => {
    cleanup();
    window.localStorage.clear();
  });

  it("dịch nội dung tĩnh và động rồi chuyển ngược về nguồn tiếng Việt", async () => {
    render(<I18nProvider><LocaleFixture /></I18nProvider>);
    fireEvent.click(screen.getByRole("button", { name: "switch" }));
    await waitFor(() => expect(screen.getByText("Assignments")).toBeInTheDocument());
    await waitFor(() => expect(screen.queryByText("Đã đóng 3 phiên khác.")).not.toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "switch" }));
    await waitFor(() => expect(screen.getByText("Bài tập")).toBeInTheDocument());
    expect(screen.getByText("Đã đóng 3 phiên khác.")).toBeInTheDocument();
  });
});
