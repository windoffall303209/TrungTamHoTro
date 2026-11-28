/** Nhận diện lỗi vi phạm ràng buộc duy nhất do Prisma trả về. */
export function isPrismaUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "P2002"
  );
}
