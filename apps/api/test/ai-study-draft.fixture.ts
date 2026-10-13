import { AiStudyDraftService } from "../src/learning/ai-study-draft.service.js";
import type { PrismaService } from "../src/database/prisma.service.js";

type Row = Record<string, unknown>;
type Query = { where: Row; select?: Record<string, boolean>; take?: number };

/** Đối chiếu điều kiện giá trị, null và phân trang theo khóa dùng trong kiểm thử kho bộ ôn tập. */
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

/** Trả bản sao dữ liệu để ca kiểm thử không sửa dữ liệu đã lưu qua đối tượng phản hồi. */
function project(row: Row, select?: Record<string, boolean>): Row {
  return structuredClone(select ? Object.fromEntries(Object.entries(row).filter(([key]) => select[key])) : row);
}

/** Chỉ mô phỏng khóa duy nhất, cập nhật có điều kiện và lựa chọn trường tại ranh giới cơ sở dữ liệu kiểm thử. */
export function testStudyDraft(): AiStudyDraftService {
  const rows = new Map<string, Row>();
  // Áp dụng bộ lọc được hỗ trợ và thứ tự ổn định trước khi chọn trường trả về.
  const find = ({ where, select, take }: Query): Row[] => [...rows.values()].filter((row) => matches(row, where))
    .sort((a, b) => (b.createdAt as Date).getTime() - (a.createdAt as Date).getTime() || String(b.id).localeCompare(String(a.id)))
    .slice(0, take).map((row) => project(row, select));
  const prisma = { isStartupConnectionEnabled: (): boolean => true, aiStudyDraft: {
    // Mô phỏng việc giữ dấu vân tay duy nhất và giá trị mặc định của cơ sở dữ liệu.
    create: ({ data }: { data: Row }): Promise<void> => {
      if (rows.has(String(data.fingerprint))) return Promise.reject(Object.assign(new Error("Duplicate"), { code: "P2002" }));
      rows.set(String(data.fingerprint), structuredClone({ ...data, state: "GENERATING", result: null, editedResult: null, editRevision: 0, publishedResult: null, publishedAt: null, publicationRevision: 0, publishedEditRevision: null, createdAt: new Date(), updatedAt: new Date() }));
      return Promise.resolve();
    },
    // Mô phỏng hai kiểu tra cứu một bản ghi được hỗ trợ.
    findUnique: (query: Query): Promise<Row | null> => Promise.resolve(find(query)[0] ?? null),
    findFirst: (query: Query): Promise<Row | null> => Promise.resolve(find(query)[0] ?? null),
    findMany: (query: Query): Promise<Row[]> => Promise.resolve(find(query)),
    // Đối chiếu phiên bản nguyên tử trước khi tăng phiên bản hoặc phát hành.
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
