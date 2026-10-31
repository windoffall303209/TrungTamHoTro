import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LectureSidebarNavigation } from "../../../../src/features/class-detail/lecture-sidebar-navigation";

afterEach(cleanup);

describe("LectureSidebarNavigation", () => {
  it("giữ đầy đủ sáu tab và chuyển đúng tab được chọn", () => {
    const onSelectTab = vi.fn();
    render(<LectureSidebarNavigation onSelectTab={onSelectTab} />);
    expect(screen.getAllByRole("button")).toHaveLength(6);
    expect(screen.getByRole("button", { name: "Bài giảng" })).toHaveClass("bg-blue-50");
    fireEvent.click(screen.getByRole("button", { name: "Tài liệu" }));
    fireEvent.click(screen.getByRole("button", { name: "Bảng tin" }));
    expect(onSelectTab.mock.calls).toEqual([["materials"], ["feed"]]);
  });
});
