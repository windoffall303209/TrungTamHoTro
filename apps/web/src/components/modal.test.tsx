import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Modal } from "./ui";

describe("Modal keyboard containment", () => {
  afterEach(cleanup);
  it("wraps around the last collapsed summary, not its hidden child button", () => {
    render(<Modal open title="Sources" onClose={vi.fn()}><details><summary>Last source</summary><button>Hidden source action</button></details></Modal>);
    const close = screen.getByRole("button", { name: "Đóng" });
    const summary = screen.getByText("Last source");
    close.focus();
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(summary).toHaveFocus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(close).toHaveFocus();
  });
  it("skips hidden ancestors and negative tabindex while retaining open source actions", () => {
    render(<Modal open title="Sources" onClose={vi.fn()}><details open><summary>Source</summary><button>Visible source action</button></details><div hidden><button>Hidden action</button></div><button tabIndex={-1}>Not tabbable</button></Modal>);
    screen.getByRole("button", { name: "Đóng" }).focus();
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(screen.getByText("Visible source action")).toHaveFocus();
  });
});
