import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ManagerFolderSidebar } from "../../../../src/roles/manager/manager-folder-sidebar";

afterEach(cleanup);

describe("ManagerFolderSidebar", () => {
  it("renders folder totals and preserves the selected folder callback", () => {
    const onSelectFolder = vi.fn();
    render(
      <ManagerFolderSidebar
        title="Thư mục"
        allLabel="Tất cả bài tập"
        totalCount={3}
        folders={["Chương 1", "Chương 2"]}
        counts={new Map([["Chương 1", 2], ["Chương 2", 1]])}
        selectedFolder="Chương 1"
        onSelectFolder={onSelectFolder}
        tone="blue"
      />,
    );

    expect(screen.getByRole("button", { name: "Tất cả bài tập 3" })).toBeInTheDocument();
    const selected = screen.getByRole("button", { name: "Chương 1 2" });
    expect(selected).toHaveClass("text-blue-600");
    fireEvent.click(screen.getByRole("button", { name: "Chương 2 1" }));
    fireEvent.click(screen.getByRole("button", { name: "Tất cả bài tập 3" }));
    expect(onSelectFolder).toHaveBeenNthCalledWith(1, "Chương 2");
    expect(onSelectFolder).toHaveBeenNthCalledWith(2, "__ALL__");
  });

  it("keeps the purple theme for lecture folders", () => {
    render(
      <ManagerFolderSidebar
        title="Chuyên đề"
        allLabel="Tất cả bài giảng"
        totalCount={0}
        folders={[]}
        counts={new Map()}
        selectedFolder="__ALL__"
        onSelectFolder={vi.fn()}
        tone="purple"
      />,
    );

    expect(screen.getByText("Chuyên đề")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Tất cả bài giảng 0" })).toHaveClass("text-purple-600");
  });
});
