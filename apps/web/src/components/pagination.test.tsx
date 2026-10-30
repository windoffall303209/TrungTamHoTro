import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useState } from "react";
import { Pagination, Tabs, usePagination } from "@/shared/ui/ui";

/** Dựng màn hình nhỏ để kiểm tra danh sách và thao tác phân trang. */
function Harness() {
  const pagination = usePagination(Array.from({ length: 23 }, (_, index) => index + 1));
  return (
    <div>
      <output>{pagination.pageItems.join(",")}</output>
      <Pagination
        itemLabel="câu hỏi"
        onPageChange={pagination.setPage}
        onPageSizeChange={pagination.setPageSize}
        page={pagination.page}
        pageSize={pagination.pageSize}
        totalItems={pagination.totalItems}
      />
    </div>
  );
}

describe("Pagination", () => {
  it("chuyển trang và đặt lại trang khi đổi số dòng", () => {
    render(<Harness />);

    expect(screen.getByText("1,2,3,4,5,6,7,8,9,10")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Trang 2" }));
    expect(screen.getByText("11,12,13,14,15,16,17,18,19,20")).toBeInTheDocument();

    const pageSize = screen.getByRole("combobox", { name: "Số câu hỏi mỗi trang" });
    expect(pageSize).toHaveTextContent("10");
    expect(pageSize).toHaveTextContent("20");
    expect(pageSize).toHaveTextContent("30");
    expect(pageSize).toHaveTextContent("40");
    expect(pageSize).toHaveTextContent("50");
    fireEvent.change(pageSize, { target: { value: "20" } });

    expect(screen.getByText("1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20")).toBeInTheDocument();
    expect(screen.getByText(/Hiển thị/)).toHaveTextContent("Hiển thị 1–20 trong 23 câu hỏi");
  });
});

/** Dựng trạng thái tab để kiểm tra lựa chọn và chuyển tab bằng bàn phím. */
function TabsHarness() {
  const [tab, setTab] = useState<"courses" | "classes">("classes");
  return (
    <div>
      <Tabs
        items={[{ value: "courses", label: "Khóa học", count: 8 }, { value: "classes", label: "Lớp học", count: 12 }]}
        label="Chọn loại danh mục"
        onChange={setTab}
        value={tab}
      />
      <output>{tab}</output>
    </div>
  );
}

describe("Tabs", () => {
  it("chỉ chọn một nội dung và hỗ trợ phím mũi tên", () => {
    render(<TabsHarness />);

    const classesTab = screen.getByRole("tab", { name: /Lớp học/ });
    expect(classesTab).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(classesTab, { key: "ArrowLeft" });

    expect(screen.getByText("courses")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Khóa học/ })).toHaveAttribute("aria-selected", "true");
  });
});
