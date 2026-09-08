import { AiStudyDraftService } from "../src/learning/ai-study-draft.service.js";
import type { PrismaService } from "../src/database/prisma.service.js";

type Row = Record<string, unknown>;
type Query = { where: Row; select?: Record<string, boolean>; take?: number };

/** Match the scalar, null and keyset predicates used by the study repository tests. */
function matches(row: Row, where: Row): boolean {
  return Object.entries(where).every(([key, value]) => {
    if (key === "OR") return (value as Row[]).some((item) => matches(row, item));
    const actual = row[key];
    if (value instanceof Date) return actual instanceof Date && actual.getTime() === value.getTime();
    if (value && typeof value === "object") {
      if ("not" in value) return actual !== value.not;
      if ("lt" in value) return actual instanceof Date && value.lt instanceof Date ? actual < value.lt : String(actual) < String(value.lt);
      throw new Error(`Unsupported fixture predicate: ${key}`);
    }
    return actual === value;
  });
}

/** Return detached projections so tests cannot mutate persisted fixtures through response objects. */
function project(row: Row, select?: Record<string, boolean>): Row {
  return structuredClone(select ? Object.fromEntries(Object.entries(row).filter(([key]) => select[key])) : row);
}

/** Simulate unique claims, conditional updates and projections only at the test database boundary. */
export function testStudyDraft(): AiStudyDraftService {
  const rows = new Map<string, Row>();
  // Apply supported repository filters and deterministic ordering before projection.
  const find = ({ where, select, take }: Query): Row[] => [...rows.values()].filter((row) => matches(row, where))
    .sort((a, b) => (b.createdAt as Date).getTime() - (a.createdAt as Date).getTime() || String(b.id).localeCompare(String(a.id)))
    .slice(0, take).map((row) => project(row, select));
  const prisma = { isStartupConnectionEnabled: (): boolean => true, aiStudyDraft: {
    // Emulate unique fingerprint reservation and database defaults.
    create: ({ data }: { data: Row }): Promise<void> => {
      if (rows.has(String(data.fingerprint))) return Promise.reject(Object.assign(new Error("Duplicate"), { code: "P2002" }));
      rows.set(String(data.fingerprint), structuredClone({ ...data, state: "GENERATING", result: null, editedResult: null, editRevision: 0, publishedResult: null, publishedAt: null, publicationRevision: 0, publishedEditRevision: null, createdAt: new Date(), updatedAt: new Date() }));
      return Promise.resolve();
    },
    // Emulate the two supported single-row lookups.
    findUnique: (query: Query): Promise<Row | null> => Promise.resolve(find(query)[0] ?? null),
    findFirst: (query: Query): Promise<Row | null> => Promise.resolve(find(query)[0] ?? null),
    findMany: (query: Query): Promise<Row[]> => Promise.resolve(find(query)),
    // Match revision predicates atomically before incrementing or publishing.
    updateMany: ({ where, data }: { where: Row; data: Row }): Promise<{ count: number }> => {
      let count = 0;
      for (const row of rows.values()) if (matches(row, where)) {
        for (const [key, value] of Object.entries(data)) row[key] = value && typeof value === "object" && "increment" in value ? Number(row[key]) + Number(value.increment) : structuredClone(value);
        row.updatedAt = new Date(); count++;
      }
      return Promise.resolve({ count });
    },
  } };
  return new AiStudyDraftService(prisma as unknown as PrismaService);
}
