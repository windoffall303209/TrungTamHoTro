import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useServerPagination } from "../../../src/shared/hooks/use-server-pagination";

describe("useServerPagination", () => {
  it("khởi tạo kích thước trang hợp lệ và fallback khi truyền kích thước ngoài danh sách", () => {
    const valid = renderHook(() => useServerPagination(20));
    expect(valid.result.current.page).toBe(1);
    expect(valid.result.current.pageSize).toBe(20);
    expect(valid.result.current.totalItems).toBe(0);

    const invalid = renderHook(() => useServerPagination(99));
    expect(invalid.result.current.pageSize).toBe(10);
  });

  it("đồng bộ tổng số bản ghi từ server, kẹp trang hiển thị và reset về trang 1 khi đổi pageSize", () => {
    const { result } = renderHook(() => useServerPagination(10));

    act(() => {
      result.current.setPage(4);
    });
    expect(result.current.page).toBe(4);

    act(() => {
      result.current.syncResponse({ total: 15, page: 2, totalPages: 2 });
    });
    expect(result.current.totalItems).toBe(15);
    expect(result.current.totalPages).toBe(2);
    expect(result.current.displayPage).toBe(2);

    act(() => {
      result.current.setPageSize(30);
    });
    expect(result.current.pageSize).toBe(30);
    expect(result.current.page).toBe(1);

    act(() => {
      result.current.setPage(0);
    });
    expect(result.current.page).toBe(1);
  });
});
