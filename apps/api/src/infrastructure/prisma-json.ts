/** Thu hẹp giá trị JSON thành object để đọc các trường có kiểu không xác định. */
export function asPrismaJsonRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
