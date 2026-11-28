/** Tham số phân trang chuẩn gửi từ client lên API. */
export interface PageQuery {
  page: number;
  pageSize: number;
}

/** Kết quả phân trang chuẩn do API trả về cho mọi danh sách có phân trang phía máy chủ. */
export interface PaginatedResult<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

/** Tên bí danh tương thích phía giao diện cho kết quả phân trang chuẩn. */
export type PaginatedResponse<T> = PaginatedResult<T>;
