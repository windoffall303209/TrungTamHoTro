import { vi } from "vitest";
import type { PrismaService } from "../src/database/prisma.service.js";

/** Model unique insert and version CAS at the database boundary for extraction unit tests. */
export function extractionDatabase(): {
  prisma: PrismaService;
  rows: Map<string, { key: string; value: unknown; version: number }>;
  systemSetting: {
    create: ReturnType<typeof vi.fn<(args: { data: { key: string; value: unknown } }) => Promise<object>>>;
    findUnique: ReturnType<typeof vi.fn<(args: { where: { key: string } }) => Promise<{ key: string; value: unknown; version: number } | null>>>;
    updateMany: ReturnType<typeof vi.fn<(args: { where: { key: string; version: number }; data: { value: unknown } }) => Promise<{ count: number }>>>;
  };
} {
  const rows = new Map<string, { key: string; value: unknown; version: number }>();
  const systemSetting = {
    create: vi.fn(({ data }: { data: { key: string; value: unknown } }) => {
      if (rows.has(data.key)) return Promise.reject(Object.assign(new Error("Unique claim"), { code: "P2002" }));
      rows.set(data.key, { ...structuredClone(data), version: 1 });
      return Promise.resolve({});
    }),
    findUnique: vi.fn(({ where }: { where: { key: string } }) => Promise.resolve(structuredClone(rows.get(where.key) ?? null))),
    updateMany: vi.fn(({ where, data }: { where: { key: string; version: number }; data: { value: unknown } }) => {
      const row = rows.get(where.key);
      if (!row || row.version !== where.version) return Promise.resolve({ count: 0 });
      rows.set(where.key, { ...row, value: structuredClone(data.value), version: row.version + 1 });
      return Promise.resolve({ count: 1 });
    }),
  };
  const prisma = { isStartupConnectionEnabled: () => true, systemSetting } as unknown as PrismaService;
  return { prisma, rows, systemSetting };
}
