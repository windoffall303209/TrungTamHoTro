"use client";

import { useCallback, useState } from "react";

const ALLOWED_PAGE_SIZES = [10, 20, 30, 40, 50] as const;

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

/** Chuẩn hóa kích thước trang về danh sách lựa chọn hợp lệ của component Pagination. */
function normalizePageSize(size: number): number {
  return ALLOWED_PAGE_SIZES.includes(size as (typeof ALLOWED_PAGE_SIZES)[number])
    ? size
    : 10;
}

/** Quản lý trạng thái phân trang phía máy chủ (requestedPage, pageSize, totalItems, totalPages). */
export function useServerPagination(initialPageSize = 10) {
  const [page, setPageState] = useState(1);
  const [pageSize, setPageSizeState] = useState(() => normalizePageSize(initialPageSize));
  const [serverMeta, setServerMeta] = useState({ total: 0, page: 1, totalPages: 1 });

  // Chuyển đến trang được chọn sau khi chuẩn hóa về số nguyên dương.
  const setPage = useCallback((nextPage: number) => {
    const safePage = Number.isFinite(nextPage) && nextPage >= 1 ? Math.floor(nextPage) : 1;
    setPageState(safePage);
  }, []);

  // Cập nhật kích thước trang hợp lệ và đưa vị trí hiện tại về trang đầu.
  const setPageSize = useCallback((nextSize: number) => {
    setPageSizeState(normalizePageSize(nextSize));
    setPageState(1);
  }, []);

  // Đặt lại trạng thái phân trang về trang 1 khi thay đổi bộ lọc.
  const resetPage = useCallback(() => {
    setPageState(1);
    setServerMeta((prev) => (prev.page === 1 ? prev : { ...prev, page: 1 }));
  }, []);

  // Đồng bộ metadata tổng số dòng và tổng số trang trả về từ API.
  const syncResponse = useCallback(
    (response: Pick<PaginatedResponse<unknown>, "total" | "page" | "totalPages">) => {
      setServerMeta({
        total: Math.max(0, response.total),
        page: Math.max(1, response.page),
        totalPages: Math.max(1, response.totalPages),
      });
    },
    [],
  );

  return {
    page,
    displayPage: Math.min(Math.max(1, serverMeta.page), serverMeta.totalPages),
    pageSize,
    totalItems: serverMeta.total,
    totalPages: serverMeta.totalPages,
    setPage,
    setPageSize,
    resetPage,
    syncResponse,
  };
}
