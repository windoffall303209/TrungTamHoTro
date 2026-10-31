import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider, useI18n } from "../../../src/providers/i18n-provider";

/** Tạo nút đổi locale để kiểm tra provider bằng đúng API công khai. */
function LocaleFixture() {
  const { locale, setLocale } = useI18n();
  return <><p>Bài tập</p><p>Đã đóng 3 phiên khác.</p><button onClick={() => setLocale(locale === "vi-VN" ? "en-US" : "vi-VN")}>switch</button></>;
}

describe("I18nProvider", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
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

  it("vẫn chuyển đổi ngôn ngữ khi trình duyệt chặn localStorage", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new DOMException("Blocked", "SecurityError"); });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new DOMException("Blocked", "SecurityError"); });
    render(<I18nProvider><LocaleFixture /></I18nProvider>);
    fireEvent.click(screen.getByRole("button", { name: "switch" }));
    await waitFor(() => expect(screen.getByText("Assignments")).toBeInTheDocument());
    expect(document.cookie).toContain("wind-edu-locale=en-US");
  });

  it("bỏ qua toàn bộ cây DOM đánh dấu không dịch khi nội dung được thêm động", async () => {
    render(<I18nProvider><LocaleFixture /></I18nProvider>);
    fireEvent.click(screen.getByRole("button", { name: "switch" }));
    await waitFor(() => expect(screen.getByText("Assignments")).toBeInTheDocument());

    const skipped = document.createElement("section");
    skipped.setAttribute("data-i18n-skip", "");
    skipped.innerHTML = "<div><p>Bài tập</p></div>";
    await act(async () => {
      document.body.appendChild(skipped);
    });

    try {
      expect(skipped.querySelector("p")?.textContent).toBe("Bài tập");
      fireEvent.click(screen.getByRole("button", { name: "switch" }));
      await waitFor(() => expect(document.documentElement.lang).toBe("vi-VN"));
      fireEvent.click(screen.getByRole("button", { name: "switch" }));
      await waitFor(() => expect(screen.getByText("Assignments")).toBeInTheDocument());
      expect(skipped.querySelector("p")?.textContent).toBe("Bài tập");
    } finally {
      skipped.remove();
    }
  });
});
