import { vi } from "vitest";
import type { PrismaService } from "../../src/database/prisma.service.js";

export interface MockExtractionRow {
  id: string;
  ownerId: string;
  state: string;
  version: number;
  pages: unknown;
  leaseToken: string | null;
  leaseExpiresAt: Date | null;
}

export interface MockAnswerRow {
  id: string;
  ownerId: string;
  materialId: string | null;
  sourceVersion: number | null;
  question: string | null;
  language: string | null;
  state: string;
  version: number;
  result: unknown;
  leaseToken: string | null;
  leaseExpiresAt: Date | null;
  createdAt: Date;
}

/** Mô phỏng ràng buộc khóa chính và CAS version cho hai bảng ai_document_extractions và ai_document_answers. */
export function extractionDatabase(): {
  prisma: PrismaService;
  rows: Map<string, MockExtractionRow>;
  answerRows: Map<string, MockAnswerRow>;
  aiDocumentExtraction: {
    create: ReturnType<typeof vi.fn<(args: { data: Partial<MockExtractionRow> & { id: string; ownerId: string } }) => Promise<object>>>;
    findUnique: ReturnType<typeof vi.fn<(args: { where: { id: string } }) => Promise<MockExtractionRow | null>>>;
    updateMany: ReturnType<typeof vi.fn<(args: { where: { id: string; version?: number; ownerId?: string; state?: string; leaseToken?: string | null }; data: Record<string, unknown> }) => Promise<{ count: number }>>>;
  };
  aiDocumentAnswer: {
    create: ReturnType<typeof vi.fn<(args: { data: Partial<MockAnswerRow> & { id: string; ownerId: string } }) => Promise<object>>>;
    findUnique: ReturnType<typeof vi.fn<(args: { where: { id: string } }) => Promise<MockAnswerRow | null>>>;
    updateMany: ReturnType<typeof vi.fn<(args: { where: { id: string; version?: number; ownerId?: string; state?: string; leaseToken?: string | null }; data: Record<string, unknown> }) => Promise<{ count: number }>>>;
  };
} {
  const rows = new Map<string, MockExtractionRow>();
  const answerRows = new Map<string, MockAnswerRow>();

  const aiDocumentExtraction = {
    create: vi.fn(({ data }: { data: Partial<MockExtractionRow> & { id: string; ownerId: string } }) => {
      if (rows.has(data.id)) return Promise.reject(Object.assign(new Error("Unique claim"), { code: "P2002" }));
      rows.set(data.id, {
        id: data.id,
        ownerId: data.ownerId,
        state: data.state ?? "GENERATING",
        version: 1,
        pages: data.pages === undefined ? null : structuredClone(data.pages),
        leaseToken: data.leaseToken ?? null,
        leaseExpiresAt: data.leaseExpiresAt ?? null,
      });
      return Promise.resolve({});
    }),
    findUnique: vi.fn(({ where }: { where: { id: string } }) => Promise.resolve(structuredClone(rows.get(where.id) ?? null))),
    updateMany: vi.fn(({ where, data }: { where: { id: string; version?: number; ownerId?: string; state?: string; leaseToken?: string | null }; data: Record<string, unknown> }) => {
      const row = rows.get(where.id);
      if (!row) return Promise.resolve({ count: 0 });
      if (where.version !== undefined && row.version !== where.version) return Promise.resolve({ count: 0 });
      if (where.ownerId !== undefined && row.ownerId !== where.ownerId) return Promise.resolve({ count: 0 });
      if (where.state !== undefined && row.state !== where.state) return Promise.resolve({ count: 0 });
      if (where.leaseToken !== undefined && row.leaseToken !== where.leaseToken) return Promise.resolve({ count: 0 });
      const next: MockExtractionRow = {
        ...row,
        state: typeof data.state === "string" ? data.state : row.state,
        pages: "pages" in data ? (typeof data.pages === "symbol" ? null : structuredClone(data.pages)) : row.pages,
        leaseToken: "leaseToken" in data ? (data.leaseToken as string | null) : row.leaseToken,
        leaseExpiresAt: "leaseExpiresAt" in data ? (data.leaseExpiresAt as Date | null) : row.leaseExpiresAt,
        version: row.version + 1,
      };
      rows.set(where.id, next);
      return Promise.resolve({ count: 1 });
    }),
  };

  const aiDocumentAnswer = {
    create: vi.fn(({ data }: { data: Partial<MockAnswerRow> & { id: string; ownerId: string } }) => {
      if (answerRows.has(data.id)) return Promise.reject(Object.assign(new Error("Unique claim"), { code: "P2002" }));
      answerRows.set(data.id, {
        id: data.id,
        ownerId: data.ownerId,
        materialId: data.materialId ?? null,
        sourceVersion: data.sourceVersion ?? null,
        question: data.question ?? null,
        language: data.language ?? null,
        state: data.state ?? "GENERATING",
        version: 1,
        result: data.result === undefined ? null : structuredClone(data.result),
        leaseToken: data.leaseToken ?? null,
        leaseExpiresAt: data.leaseExpiresAt ?? null,
        createdAt: new Date(),
      });
      return Promise.resolve({});
    }),
    findUnique: vi.fn(({ where }: { where: { id: string } }) => Promise.resolve(structuredClone(answerRows.get(where.id) ?? null))),
    updateMany: vi.fn(({ where, data }: { where: { id: string; version?: number; ownerId?: string; state?: string; leaseToken?: string | null }; data: Record<string, unknown> }) => {
      const row = answerRows.get(where.id);
      if (!row) return Promise.resolve({ count: 0 });
      if (where.version !== undefined && row.version !== where.version) return Promise.resolve({ count: 0 });
      if (where.ownerId !== undefined && row.ownerId !== where.ownerId) return Promise.resolve({ count: 0 });
      if (where.state !== undefined && row.state !== where.state) return Promise.resolve({ count: 0 });
      if (where.leaseToken !== undefined && row.leaseToken !== where.leaseToken) return Promise.resolve({ count: 0 });
      const next: MockAnswerRow = {
        ...row,
        state: typeof data.state === "string" ? data.state : row.state,
        result: "result" in data ? (typeof data.result === "symbol" ? null : structuredClone(data.result)) : row.result,
        leaseToken: "leaseToken" in data ? (data.leaseToken as string | null) : row.leaseToken,
        leaseExpiresAt: "leaseExpiresAt" in data ? (data.leaseExpiresAt as Date | null) : row.leaseExpiresAt,
        version: row.version + 1,
      };
      answerRows.set(where.id, next);
      return Promise.resolve({ count: 1 });
    }),
  };

  const prisma = {
    isStartupConnectionEnabled: () => true,
    aiDocumentExtraction,
    aiDocumentAnswer,
  } as unknown as PrismaService;
  return { prisma, rows, answerRows, aiDocumentExtraction, aiDocumentAnswer };
}
