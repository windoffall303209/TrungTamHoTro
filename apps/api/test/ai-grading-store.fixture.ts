import { AiGradingStoreService, type SavedGradingSuggestion } from "../src/learning/ai-grading-store.service.js";
import type { PrismaService } from "../src/database/prisma.service.js";

/** Simulate database constraints for unit tests without adding a production memory fallback. */
export function testGradingStore(): AiGradingStoreService {
  type Row = { id: string; fingerprint: string; state: string; result: SavedGradingSuggestion | null };
  const rows = new Map<string, Row>();
  const prisma = { isStartupConnectionEnabled: (): boolean => true, aiGradingSuggestion: {
    // Reserve a fingerprint exactly once across callers of this fixture.
    create: ({ data }: { data: Omit<Row, "state" | "result"> }): Promise<void> => {
      if (rows.has(data.fingerprint)) return Promise.reject(Object.assign(new Error("Duplicate"), { code: "P2002" }));
      rows.set(data.fingerprint, { ...data, state: "GENERATING", result: null });
      return Promise.resolve();
    },
    // Return isolated snapshots as a database driver would.
    findUnique: ({ where }: { where: { fingerprint: string } }): Promise<Row | null> => Promise.resolve(structuredClone(rows.get(where.fingerprint) ?? null)),
    // Apply only state-matched writes to preserve READY after ambiguous acknowledgements.
    updateMany: ({ where, data }: { where: { id: string; state: string }; data: { state: string; result?: SavedGradingSuggestion } }): Promise<{ count: number }> => {
      const row = [...rows.values()].find((item) => item.id === where.id && item.state === where.state);
      if (!row) return Promise.resolve({ count: 0 });
      rows.set(row.fingerprint, { ...row, ...structuredClone(data) });
      return Promise.resolve({ count: 1 });
    },
  } };
  return new AiGradingStoreService(prisma as unknown as PrismaService);
}
