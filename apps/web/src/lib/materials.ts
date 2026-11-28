import type { RoleCode } from "./app-types";
import { apiRequest } from "./api-client";
import type { Material } from "./learning-types";
import type { PaginatedResponse } from "@/shared/hooks/use-server-pagination";

const MATERIALS_PAGE_SIZE = 50;
const MAX_MATERIALS_PAGE = 1_000_000;

export interface MaterialSummaryBucket {
  classId: string;
  folder: string;
  kind: "materials" | "lectures";
  count: number;
}

export interface MaterialSearchParams {
  query?: string;
  classId?: string;
  courseId?: string;
  folder?: string;
  folderExact?: boolean;
  kind?: "materials" | "lectures";
  visibility?: string;
  page?: number;
  pageSize?: number;
}

/** Chỉ giữ học liệu thuộc đúng lớp học hiện tại. */
export function isMaterialForClass(material: Pick<Material, "classId">, classId: string): boolean {
  return material.classId === classId;
}

/** Tải thống kê tổng hợp số lượng học liệu theo lớp, thư mục và loại nội dung từ DB. */
export async function loadMaterialSummary(
  options: RequestInit & { classId?: string; roleCode?: RoleCode } = {},
): Promise<MaterialSummaryBucket[]> {
  const { classId, ...requestOptions } = options;
  const search = new URLSearchParams();
  if (classId) search.set("classId", classId);
  const queryString = search.toString();
  const data = await apiRequest<MaterialSummaryBucket[]>(
    `/materials/summary${queryString ? `?${queryString}` : ""}`,
    requestOptions,
  );
  if (!Array.isArray(data)) throw new Error("Phản hồi thống kê học liệu không hợp lệ.");
  return data;
}

/** Truy vấn một trang học liệu theo bộ lọc lớp, thư mục chính xác và loại nội dung. */
export async function searchMaterialsPage<T extends Material = Material>(
  params: MaterialSearchParams,
  options: RequestInit & { roleCode?: RoleCode } = {},
): Promise<PaginatedResponse<T>> {
  const search = new URLSearchParams();
  if (params.query?.trim()) search.set("query", params.query.trim());
  if (params.classId) search.set("classId", params.classId);
  if (params.courseId) search.set("courseId", params.courseId);
  if (params.folder) search.set("folder", params.folder);
  if (params.folderExact) search.set("folderExact", "true");
  if (params.kind) search.set("kind", params.kind);
  if (params.visibility) search.set("visibility", params.visibility);
  if (params.page) search.set("page", String(params.page));
  if (params.pageSize) search.set("pageSize", String(Math.min(params.pageSize, MATERIALS_PAGE_SIZE)));
  const data = await apiRequest<PaginatedResponse<T>>(`/materials/search?${search.toString()}`, options);
  if (!data || !Array.isArray(data.items)) {
    throw new Error("Phản hồi tìm kiếm học liệu không hợp lệ.");
  }
  return data;
}

/** Tải danh sách học liệu thuộc riêng một lớp học bằng /materials/search theo classId. */
export async function loadClassMaterials<T extends Material = Material>(
  classId: string,
  options: RequestInit & { roleCode?: RoleCode } = {},
): Promise<T[]> {
  const materials: T[] = [];
  for (let page = 1; page <= MAX_MATERIALS_PAGE; page += 1) {
    options.signal?.throwIfAborted();
    const result = await searchMaterialsPage<T>(
      { classId, page, pageSize: MATERIALS_PAGE_SIZE },
      options,
    );
    materials.push(...result.items);
    if (page >= result.totalPages || result.items.length < MATERIALS_PAGE_SIZE) {
      return materials;
    }
  }
  throw new Error("Danh sách học liệu của lớp vượt giới hạn phân trang của API.");
}

/** Nạp đủ các trang của API danh sách học liệu, giữ nguyên bộ lọc và định dạng mảng cũ. */
export async function loadAllMaterials<T extends Material = Material>(
  path = "/materials",
  options: RequestInit & { roleCode?: RoleCode } = {},
): Promise<T[]> {
  const materials: T[] = [];
  for (let page = 1; page <= MAX_MATERIALS_PAGE; page += 1) {
    options.signal?.throwIfAborted();
    const pagePath = page === 1 ? path : `${path}${path.includes("?") ? "&" : "?"}page=${page}`;
    const batch = await apiRequest<T[]>(pagePath, options);
    if (!Array.isArray(batch)) throw new Error("Phản hồi danh sách học liệu không hợp lệ.");
    materials.push(...batch);
    if (batch.length < MATERIALS_PAGE_SIZE) return materials;
  }
  throw new Error("Danh sách học liệu vượt giới hạn phân trang của API.");
}
