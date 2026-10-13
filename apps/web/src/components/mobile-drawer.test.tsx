import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MobileDrawer } from "./mobile-drawer";

describe("Menu mobile dùng dialog gốc", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    );
    // JSDOM chưa mô phỏng top layer; hành vi Tab/inert được kiểm tra thêm trong trình duyệt thật.
    Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
      configurable: true,
      value: function (this: HTMLDialogElement) {
        this.open = true;
      },
    });
    Object.defineProperty(HTMLDialogElement.prototype, "close", {
      configurable: true,
      value: function (this: HTMLDialogElement) {
        this.open = false;
      },
    });
  });
  afterEach(() => {
    cleanup();
    Reflect.deleteProperty(HTMLDialogElement.prototype, "showModal");
    Reflect.deleteProperty(HTMLDialogElement.prototype, "close");
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("mở modal gốc, khóa cuộn và trả focus khi tháo menu", () => {
    const trigger = document.createElement("button");
    document.body.append(trigger);
    trigger.focus();
    const { unmount } = render(
      <MobileDrawer onClose={vi.fn()}>
        <a href="/academic">Học vụ</a>
      </MobileDrawer>,
    );
    expect(screen.getByRole("dialog")).toHaveAttribute("open");
    expect(document.body.style.overflow).toBe("hidden");
    unmount();
    expect(trigger).toHaveFocus();
    expect(document.body.style.overflow).toBe("");
    trigger.remove();
  });

  it("ủy quyền Escape và nút đóng cho chủ sở hữu state", () => {
    const onClose = vi.fn();
    render(<MobileDrawer onClose={onClose}>Nội dung</MobileDrawer>);
    fireEvent(
      screen.getByRole("dialog"),
      new Event("cancel", { cancelable: true }),
    );
    expect(onClose).toHaveBeenCalledOnce();
    fireEvent.click(screen.getAllByRole("button", { name: "Đóng menu" })[1]!);
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("đóng ngay nếu đang ở bố cục desktop", () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({
        matches: true,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    );
    const onClose = vi.fn();
    render(<MobileDrawer onClose={onClose}>Nội dung</MobileDrawer>);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("quay vòng Tab trong menu thay vì đưa focus ra thanh địa chỉ", () => {
    render(
      <MobileDrawer onClose={vi.fn()}>
        <a href="/academic">Học vụ</a>
      </MobileDrawer>,
    );
    const close = screen.getAllByRole("button", { name: "Đóng menu" })[1]!;
    const link = screen.getByRole("link", { name: "Học vụ" });
    expect(close).toHaveFocus();
    fireEvent.keyDown(close, { key: "Tab", shiftKey: true });
    expect(link).toHaveFocus();
    fireEvent.keyDown(link, { key: "Tab" });
    expect(close).toHaveFocus();
  });
});
