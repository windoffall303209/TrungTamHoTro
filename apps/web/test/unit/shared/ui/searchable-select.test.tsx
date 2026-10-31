import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SearchableSelect } from "../../../../src/shared/ui/searchable-select";

describe("SearchableSelect", () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("lọc không phân biệt dấu và trả về đúng mã lựa chọn", () => {
    const onChange = vi.fn();
    render(<SearchableSelect aria-label="Chọn lớp" onChange={onChange} options={[
      { value: "class-web", label: "WEB-K01 — Phát triển Web", description: "Học kỳ 1" },
      { value: "class-data", label: "DATA-K02 — Nền tảng dữ liệu", description: "Học kỳ 2" },
    ]} value="" />);

    fireEvent.change(screen.getByRole("combobox", { name: "Chọn lớp" }), { target: { value: "du lieu" } });
    expect(screen.queryByRole("option", { name: /Phát triển Web/i })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("option", { name: /Nền tảng dữ liệu/i }));
    expect(onChange).toHaveBeenLastCalledWith("class-data");
  });

  it("không đóng danh sách sau khi input được focus lại trước khi hết thời gian blur", () => {
    vi.useFakeTimers();
    render(<SearchableSelect aria-label="Chọn lớp" onChange={vi.fn()} options={[{ value: "a", label: "Lớp A" }]} value="" />);
    const input = screen.getByRole("combobox", { name: "Chọn lớp" });
    fireEvent.focus(input);
    fireEvent.blur(input);
    act(() => vi.advanceTimersByTime(50));
    fireEvent.focus(input);
    act(() => vi.advanceTimersByTime(120));
    expect(screen.getByRole("option", { name: "Lớp A" })).toBeInTheDocument();
    fireEvent.blur(input);
    expect(vi.getTimerCount()).toBe(1);
    cleanup();
    expect(vi.getTimerCount()).toBe(0);
  });
});
