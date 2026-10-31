import { AiGradingStoreService, type SavedGradingSuggestion } from "../../src/domains/learning/ai/ai-grading-store.service.js";
import type { PrismaService } from "../../src/database/prisma.service.js";

/** Mô phỏng ràng buộc cơ sở dữ liệu cho kiểm thử đơn vị, không thêm đường dự phòng RAM vào sản phẩm. */
export function testGradingStore(): AiGradingStoreService {
  type Row = { id: string; fingerprint: string; state: string; result: SavedGradingSuggestion | null };
  const rows = new Map<string, Row>();
  const prisma = { isStartupConnectionEnabled: (): boolean => true, aiGradingSuggestion: {
    // Chỉ cho phép một bên gọi giữ quyền xử lý mỗi dấu vân tay trong bộ dữ liệu kiểm thử.
    create: ({ data }: { data: Omit<Row, "state" | "result"> }): Promise<void> => {
      if (rows.has(data.fingerprint)) return Promise.reject(Object.assign(new Error("Duplicate"), { code: "P2002" }));
      rows.set(data.fingerprint, { ...data, state: "GENERATING", result: null });
      return Promise.resolve();
    },
    // Trả bản sao độc lập như trình điều khiển cơ sở dữ liệu.
    findUnique: ({ where }: { where: { fingerprint: string } }): Promise<Row | null> => Promise.resolve(structuredClone(rows.get(where.fingerprint) ?? null)),
    // Chỉ ghi khi trạng thái khớp để giữ READY sau phản hồi xác nhận không rõ ràng.
    updateMany: ({ where, data }: { where: { id: string; state: string }; data: { state: string; result?: SavedGradingSuggestion } }): Promise<{ count: number }> => {
      const row = [...rows.values()].find((item) => item.id === where.id && item.state === where.state);
      if (!row) return Promise.resolve({ count: 0 });
      rows.set(row.fingerprint, { ...row, ...structuredClone(data) });
      return Promise.resolve({ count: 1 });
    },
  } };
  return new AiGradingStoreService(prisma as unknown as PrismaService);
}
