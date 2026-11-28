import type { PrismaService } from "./prisma.service.js";

/**
 * Chạy các truy vấn đọc danh sách (đếm + trang) trực tiếp trên pool thay vì interactive transaction RepeatableRead:
 * không giữ một kết nối và snapshot suốt nhiều round-trip, bỏ hai lệnh BEGIN/COMMIT cho mỗi request đọc.
 * Trang lệch nhẹ khi có ghi đồng thời đã được các hàm gọi chặn bằng cách kẹp số trang theo tổng mới nhất.
 */
export function readWithoutTransaction<T>(prisma: PrismaService, work: (client: PrismaService) => Promise<T>): Promise<T> {
  return work(prisma);
}
