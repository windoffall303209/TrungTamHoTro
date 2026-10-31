import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ClassScheduleMonthList } from "../../../../src/features/class-detail/class-schedule-month-list";

afterEach(cleanup);

describe("ClassScheduleMonthList", () => {
  it("hiển thị nguyên trạng lịch tháng, trạng thái và thao tác vào phòng", () => {
    const onJoin = vi.fn();
    render(<ClassScheduleMonthList rows={[
      { date: "26/10/2026", time: "19:30 - 21:00", title: "Buổi đầu", status: "Đã diễn ra" },
      { date: "28/10/2026", time: "19:30 - 21:00", title: "Buổi hôm nay", status: "Hôm nay" },
      { date: "30/10/2026", time: "19:30 - 21:00", title: "Buổi kế tiếp", status: "Sắp diễn ra" },
    ]} onJoin={onJoin} />);

    expect(screen.getByText("Buổi đầu")).toBeVisible();
    expect(screen.getAllByText("Thời gian: 19:30 - 21:00")).toHaveLength(3);
    expect(screen.getByText("Hôm nay")).toHaveClass("text-emerald-800");
    expect(screen.getByText("Đã diễn ra")).toHaveClass("text-slate-600");
    expect(screen.getByText("Sắp diễn ra")).toHaveClass("text-blue-800");
    fireEvent.click(screen.getAllByRole("button", { name: "Vào phòng" })[1]!);
    expect(onJoin).toHaveBeenCalledOnce();
  });
});
