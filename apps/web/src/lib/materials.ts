import type { RoleCode } from "./app-types";
import { apiRequest } from "./api-client";
import type { Material } from "./learning-types";

const MATERIALS_PAGE_SIZE = 50;
const MAX_MATERIALS_PAGE = 1_000_000;

/** Chọn học liệu thuộc lớp hiện tại hoặc học liệu dùng chung của đúng môn học. */
export function isMaterialForClass(material: Material, classId: string, courseId: string): boolean {
  return material.classId === classId ||
    (material.classId == null && material.courseId === courseId && material.scope === "SHARED");
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
