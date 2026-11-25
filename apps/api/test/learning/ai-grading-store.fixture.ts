import { AiGradingStoreService, type SavedGradingSuggestion } from "../../src/domains/learning/ai/ai-grading-store.service.js";
import type { PrismaService } from "../../src/database/prisma.service.js";
import type { AiClaimLeaseOptions } from "../../src/domains/system/ai/ai-claim-policy.js";

/** Mô phỏng ràng buộc cơ sở dữ liệu cho kiểm thử đơn vị, không thêm đường dự phòng RAM vào sản phẩm. */
export function testGradingStore(leaseOptions: AiClaimLeaseOptions = {}): AiGradingStoreService {
  type Row = { id: string; fingerprint: string; ownerId: string; submissionId: string; contextHash: string; language: string; state: string; leaseToken?: string | null; leaseExpiresAt?: Date | null; result: SavedGradingSuggestion | null; createdAt: Date };
  const rows = new Map<string, Row>();
  let sequence = 0;
  const prisma = { isStartupConnectionEnabled: (): boolean => true, aiGradingSuggestion: {
    // Chỉ cho phép một bên gọi giữ quyền xử lý mỗi dấu vân tay trong bộ dữ liệu kiểm thử.
    create: ({ data }: { data: Omit<Row, "state" | "result" | "createdAt"> }): Promise<void> => {
      if (rows.has(data.fingerprint)) return Promise.reject(Object.assign(new Error("Duplicate"), { code: "P2002" }));
      rows.set(data.fingerprint, { ...structuredClone(data), state: "GENERATING", result: null, createdAt: new Date(1_700_000_000_000 + (++sequence) * 1000) });
      return Promise.resolve();
    },
    // Trả bản sao độc lập như trình điều khiển cơ sở dữ liệu.
    findUnique: ({ where }: { where: { fingerprint: string } }): Promise<Row | null> => Promise.resolve(structuredClone(rows.get(where.fingerprint) ?? null)),
    // Lọc các bản ghi của cùng giảng viên, bài nộp và ngôn ngữ theo thứ tự mới nhất trước.
    findMany: ({ where }: { where: { ownerId: string; submissionId: string; language: string } }): Promise<Row[]> =>
      Promise.resolve(
        structuredClone(
          [...rows.values()]
            .filter((item) => item.ownerId === where.ownerId && item.submissionId === where.submissionId && item.language === where.language)
            .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime()),
        ),
      ),
    // Chỉ ghi khi trạng thái, fencing token và hạn lease khớp để chặn worker zombie và giữ READY.
    updateMany: ({ where, data }: { where: { id: string; state: string; leaseToken?: string | null; leaseExpiresAt?: { lte: Date } }; data: { state: string; leaseToken?: string | null; leaseExpiresAt?: Date | null; result?: SavedGradingSuggestion } }): Promise<{ count: number }> => {
      const row = [...rows.values()].find((item) => {
        if (item.id !== where.id || item.state !== where.state) return false;
        if ("leaseToken" in where && (item.leaseToken ?? null) !== (where.leaseToken ?? null)) return false;
        if (where.leaseExpiresAt && (!(item.leaseExpiresAt instanceof Date) || item.leaseExpiresAt > where.leaseExpiresAt.lte)) return false;
        return true;
      });
      if (!row) return Promise.resolve({ count: 0 });
      rows.set(row.fingerprint, { ...row, ...structuredClone(data) });
      return Promise.resolve({ count: 1 });
    },
  } };
  return new AiGradingStoreService(prisma as unknown as PrismaService, leaseOptions);
}
