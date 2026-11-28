/** Loại bỏ liên kết nội dung khỏi danh sách tag trả về khi học liệu hoặc phiên bản đang bị ẩn. */
export function visibleMaterialTags(tags: string[], role: string, ...states: string[]): string[] {
  if (states.includes("HIDDEN") && ["SYSTEM_ADMIN", "CENTER_MANAGER"].includes(role))
    return tags.filter((tag) => ["LECTURE", "MATERIAL", "ASSIGNMENT"].includes(tag));
  return [...tags];
}
