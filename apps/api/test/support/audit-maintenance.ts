import type { PrismaService } from "../../src/database/prisma.service.js";
import type { Prisma } from "../../src/generated/prisma/client.js";

/**
 * Dọn nhật ký kiểm toán do kiểm thử tạo: trigger append-only của audit_logs chỉ cho xóa khi transaction bật cờ
 * wind_edu.audit_maintenance, giống cách một job lưu trữ có kiểm soát phải làm.
 */
export async function deleteTestAuditLogs(prisma: PrismaService, where: Prisma.AuditLogWhereInput): Promise<void> {
  await prisma.$transaction(async (transaction) => {
    await transaction.$queryRaw`SELECT set_config('wind_edu.audit_maintenance', 'on', true)`;
    await transaction.auditLog.deleteMany({ where });
  });
}
