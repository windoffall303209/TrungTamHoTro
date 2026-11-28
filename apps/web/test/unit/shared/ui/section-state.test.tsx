import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { SectionState } from "../../../../src/shared/ui/section-state";

describe("Trạng thái danh sách theo ngữ cảnh", () => {
  afterEach(cleanup);
  it("không yêu cầu tạo dữ liệu khi chưa biết quyền người dùng", () => {
    render(
      <SectionState loading={false} empty>
        Nội dung
      </SectionState>,
    );
    expect(screen.queryByText(/Tạo bản ghi đầu tiên/)).not.toBeInTheDocument();
    expect(
      screen.getByText("Dữ liệu sẽ xuất hiện tại đây khi có nội dung phù hợp."),
    ).toBeInTheDocument();
  });
  it("ưu tiên loading, sau đó hiển thị lời hướng dẫn và thao tác riêng", () => {
    const { rerender } = render(
      <SectionState loading empty>
        Nội dung
      </SectionState>,
    );
    expect(screen.getByRole("status")).toBeInTheDocument();
    rerender(
      <SectionState
        loading={false}
        empty
        emptyTitle="Chưa có đề được công bố"
        emptyDescription="Chờ giảng viên công bố."
        emptyAction={<a href="/courses">Về lớp</a>}
      >
        Nội dung
      </SectionState>,
    );
    expect(screen.getByText("Chưa có đề được công bố")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Về lớp" })).toHaveAttribute(
      "href",
      "/courses",
    );
    expect(screen.queryByText("Nội dung")).not.toBeInTheDocument();
  });
});
