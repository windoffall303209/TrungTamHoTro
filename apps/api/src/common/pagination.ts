import { BadRequestException } from "@nestjs/common";
import type { PageQuery, PaginatedResult } from "@wind-of-fall/contracts";

export type { PageQuery, PaginatedResult };

/** Chuẩn hóa tham số phân trang page và pageSize từ query string, từ chối giá trị vượt giới hạn. */
export function parsePageQuery(
  raw: Record<string, unknown>,
  defaults: { pageSize?: number; maxPageSize?: number } = {},
): PageQuery {
  const defaultSize = defaults.pageSize ?? 20;
  const maxPageSize = defaults.maxPageSize ?? 100;

  // Đọc tham số số nguyên trong khoảng hợp lệ từ query string.
  const parseNumeric = (key: string, fallback: number, max: number): number => {
    const value = raw[key];
    if (value === undefined || value === "") return fallback;
    if (typeof value !== "string" || !/^\d+$/.test(value)) {
      throw new BadRequestException(`Tham số ${key} không hợp lệ.`);
    }
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > max) {
      throw new BadRequestException(`Tham số ${key} không hợp lệ.`);
    }
    return parsed;
  };

  return {
    page: parseNumeric("page", 1, 100_000),
    pageSize: parseNumeric("pageSize", defaultSize, maxPageSize),
  };
}

/** Đọc chuỗi lọc tùy chọn từ query string, chặn mảng hoặc chuỗi quá dài. */
export function parseOptionalQueryString(
  value: unknown,
  key: string,
  maxLength = 191,
): string | undefined {
  if (value === undefined || value === "") return undefined;
  if (typeof value !== "string" || value.length > maxLength) {
    throw new BadRequestException(`Tham số ${key} không hợp lệ.`);
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/** Đọc số nguyên tùy chọn từ query string trong khoảng [min..max]. */
export function parseOptionalQueryInt(
  value: unknown,
  key: string,
  min: number,
  max: number,
): number | undefined {
  if (value === undefined || value === "") return undefined;
  if (typeof value !== "string" || !/^-?\d+$/.test(value)) {
    throw new BadRequestException(`Tham số ${key} không hợp lệ.`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    throw new BadRequestException(`Tham số ${key} không hợp lệ.`);
  }
  return parsed;
}

/** Cắt trang trên mảng dữ liệu in-memory với cùng metadata như truy vấn DB. */
export function paginateArray<T>(
  items: readonly T[],
  page: number,
  pageSize: number,
): PaginatedResult<T> {
  const total = items.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const offset = (safePage - 1) * pageSize;
  return {
    items: items.slice(offset, offset + pageSize),
    total,
    page: safePage,
    pageSize,
    totalPages,
  };
}
