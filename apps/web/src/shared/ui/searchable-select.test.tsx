import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SearchableSelect } from "./searchable-select";

describe("SearchableSelect", () => {
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
});
