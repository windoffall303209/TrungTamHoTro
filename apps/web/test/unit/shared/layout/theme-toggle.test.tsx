import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ThemeToggle } from "../../../../src/shared/layout/theme-toggle";

describe("ThemeToggle storage restrictions", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    document.documentElement.dataset.theme = "light";
    document.documentElement.classList.remove("dark", "theme-changing");
  });

  it("đổi giao diện và lưu cookie ngay cả khi localStorage bị chặn", () => {
    document.documentElement.dataset.theme = "light";
    document.documentElement.classList.remove("dark");
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("Blocked", "SecurityError");
    });

    render(<ThemeToggle />);
    fireEvent.click(screen.getByRole("button", { name: "Chuyển sang giao diện tối" }));

    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(document.cookie).toContain("wind-edu-theme=dark");
    expect(screen.getByRole("button", { name: "Chuyển sang giao diện sáng" })).toBeInTheDocument();
  });
});
