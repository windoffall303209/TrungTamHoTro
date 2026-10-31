import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ClassFolderEntry } from "../../../../src/features/class-detail/class-folder-entry";

afterEach(cleanup);

describe("ClassFolderEntry", () => {
  it("keeps expand and select independent and reflects the current folder state", () => {
    const onSelect = vi.fn();
    const onToggle = vi.fn();
    const { rerender } = render(
      <ClassFolderEntry
        name="Chương 1"
        selected
        expanded
        onSelect={onSelect}
        onToggle={onToggle}
      />,
    );

    const toggle = screen.getByRole("button");
    expect(toggle.querySelector("svg")).toHaveClass("rotate-90");
    expect(screen.getByText("Chương 1").parentElement?.parentElement).toHaveClass("text-blue-600");
    fireEvent.click(toggle);
    expect(onToggle).toHaveBeenCalledOnce();
    expect(onSelect).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText("Chương 1"));
    expect(onSelect).toHaveBeenCalledOnce();

    rerender(
      <ClassFolderEntry
        name="Chương 1"
        selected={false}
        expanded={false}
        onSelect={onSelect}
        onToggle={onToggle}
        toggleCursor
      />,
    );
    expect(toggle).toHaveClass("cursor-pointer");
    expect(toggle.querySelector("svg")).not.toHaveClass("rotate-90");
  });
});
