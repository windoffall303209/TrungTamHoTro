import { createHash } from "node:crypto";
import { once } from "node:events";
import { createWriteStream } from "node:fs";
import { csvSafeText, redactSensitiveValue } from "../../../../common/redaction.js";
import { PrismaService } from "../../../../database/prisma.service.js";
import { DataExport } from "../../core/system.shared.js";

const DEFAULT_EXPORT_BATCH_SIZE = 500;

export const EXPORT_CSV_COLUMNS: Record<string, readonly string[]> = {
  AUDIT: [
    "entity",
    "id",
    "actorId",
    "action",
    "entityType",
    "entityId",
    "requestId",
    "context",
    "createdAt",
  ],
  USERS: [
    "entity",
    "id",
    "username",
    "email",
    "displayName",
    "status",
    "createdAt",
    "updatedAt",
  ],
  LEARNING: [
    "entity",
    "id",
    "code",
    "name",
    "title",
    "status",
    "courseId",
    "classId",
    "examId",
    "assignmentId",
    "learnerId",
    "score",
    "maxScore",
    "totalScore",
    "attemptNo",
    "revision",
    "createdAt",
    "startedAt",
    "submittedAt",
    "gradedAt",
    "dueAt",
    "updatedAt",
  ],
};

export interface StreamedExportSummary {
  rowCount: number;
  sizeBytes: number;
  checksum: string;
}

/** Replacer JSON cho số nguyên lớn; Date đã tự chuyển ISO qua toJSON nên không cần sao chép trung gian. */
function exportJsonReplacer(_key: string, item: unknown): unknown {
  return typeof item === "bigint" ? item.toString() : item;
}

/** Chuyển mọi kiểu giá trị xuất dữ liệu về chuỗi xác định trước khi đưa vào ô CSV. */
function formatExportCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") {
    return JSON.stringify(value, exportJsonReplacer) ?? "";
  }
  if (typeof value === "string") return value;
  if (
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "bigint"
  ) {
    return value.toString();
  }
  if (typeof value === "symbol") return value.description ?? "";
  return "[function]";
}

/** Bao ô CSV bằng dấu ngoặc kép, thoát dấu ngoặc kép và vô hiệu hóa công thức bảng tính (=, +, -, @, tab, CR). */
export function escapeExportCsvCell(value: unknown): string {
  const formatted = formatExportCell(value);
  const normalized = typeof value === "string" ? csvSafeText(formatted) : formatted;
  return `"${normalized.replace(/"/g, '""')}"`;
}

/** Lặp tuần tự một bảng qua khóa chính theo cursor (O(batchSize) RAM, không dùng OFFSET). */
async function* paginateById<TId extends string | bigint, TRow extends { id: TId }>(
  fetchPage: (cursor?: TId) => Promise<TRow[]>,
  mapRow: (row: TRow) => Record<string, unknown>,
  batchSize: number,
): AsyncGenerator<Array<Record<string, unknown>>> {
  let cursor: TId | undefined;
  while (true) {
    const page = await fetchPage(cursor);
    if (!page.length) break;
    yield page.map(mapRow);
    if (page.length < batchSize) break;
    cursor = page[page.length - 1]!.id;
  }
}

/** Đọc từng lô bản ghi export từ PostgreSQL theo cursor khóa chính mà không giữ toàn bảng trong bộ nhớ. */
export async function* iterateExportBatches(
  prisma: PrismaService,
  category: string,
  batchSize = DEFAULT_EXPORT_BATCH_SIZE,
): AsyncGenerator<Array<Record<string, unknown>>> {
  const take = Math.max(1, Math.min(Math.trunc(batchSize), 2_000));

  if (category === "AUDIT") {
    yield* paginateById(
      (cursor?: bigint) =>
        prisma.auditLog.findMany({
          take,
          ...(cursor !== undefined ? { cursor: { id: cursor }, skip: 1 } : {}),
          orderBy: { id: "asc" },
        }),
      (row) => ({
        entity: "audit_log",
        ...row,
        context: redactSensitiveValue(row.context),
      }),
      take,
    );
    return;
  }

  if (category === "USERS") {
    yield* paginateById(
      (cursor?: string) =>
        prisma.user.findMany({
          select: {
            id: true,
            username: true,
            email: true,
            displayName: true,
            status: true,
            createdAt: true,
            updatedAt: true,
          },
          take,
          ...(cursor !== undefined ? { cursor: { id: cursor }, skip: 1 } : {}),
          orderBy: { id: "asc" },
        }),
      (row) => ({ entity: "user", ...row }),
      take,
    );
    return;
  }

  yield* paginateById(
    (cursor?: string) =>
      prisma.course.findMany({
        take,
        ...(cursor !== undefined ? { cursor: { id: cursor }, skip: 1 } : {}),
        orderBy: { id: "asc" },
      }),
    (row) => ({ entity: "course", ...row }),
    take,
  );
  yield* paginateById(
    (cursor?: string) =>
      prisma.learningClass.findMany({
        take,
        ...(cursor !== undefined ? { cursor: { id: cursor }, skip: 1 } : {}),
        orderBy: { id: "asc" },
      }),
    (row) => ({ entity: "learning_class", ...row }),
    take,
  );
  yield* paginateById(
    (cursor?: string) =>
      prisma.exam.findMany({
        take,
        ...(cursor !== undefined ? { cursor: { id: cursor }, skip: 1 } : {}),
        orderBy: { id: "asc" },
      }),
    (row) => ({ entity: "exam", ...row }),
    take,
  );
  yield* paginateById(
    (cursor?: string) =>
      prisma.examAttempt.findMany({
        take,
        ...(cursor !== undefined ? { cursor: { id: cursor }, skip: 1 } : {}),
        orderBy: { id: "asc" },
      }),
    (row) => ({ entity: "exam_attempt", ...row }),
    take,
  );
  yield* paginateById(
    (cursor?: string) =>
      prisma.assignment.findMany({
        take,
        ...(cursor !== undefined ? { cursor: { id: cursor }, skip: 1 } : {}),
        orderBy: { id: "asc" },
      }),
    (row) => ({ entity: "assignment", ...row }),
    take,
  );
  yield* paginateById(
    (cursor?: string) =>
      prisma.assignmentSubmission.findMany({
        take,
        ...(cursor !== undefined ? { cursor: { id: cursor }, skip: 1 } : {}),
        orderBy: { id: "asc" },
      }),
    (row) => ({ entity: "assignment_submission", ...row }),
    take,
  );
}

/** Ghi từng lô dòng xuất dữ liệu trực tiếp ra tệp đĩa theo cơ chế backpressure và tính SHA-256 tăng dần. */
export async function writeExportBatchesToFile(
  batches: AsyncIterable<Array<Record<string, unknown>>>,
  format: DataExport["format"],
  targetPath: string,
  csvColumns: readonly string[],
  onBatchWritten?: (rowCount: number) => Promise<void> | void,
): Promise<StreamedExportSummary> {
  const hash = createHash("sha256");
  let sizeBytes = 0;
  let rowCount = 0;
  const output = createWriteStream(targetPath, { flags: "wx", mode: 0o600 });

  /** Ghi một khối UTF-8 ra đĩa, cập nhật hash/kích thước và chờ drain khi bộ đệm ghi đầy. */
  const writeChunk = async (text: string): Promise<void> => {
    const buffer = Buffer.from(text, "utf8");
    sizeBytes += buffer.length;
    hash.update(buffer);
    if (!output.write(buffer)) {
      await once(output, "drain");
    }
  };

  try {
    if (format === "JSON") {
      await writeChunk(
        `{"format":"wind-edu-data-export","version":1,"createdAt":${JSON.stringify(new Date().toISOString())},"rows":[`,
      );
      let firstRow = true;
      for await (const batch of batches) {
        if (!batch.length) continue;
        const parts: string[] = [];
        for (const row of batch) {
          const serialized = JSON.stringify(row, exportJsonReplacer);
          parts.push(firstRow ? serialized : `,${serialized}`);
          firstRow = false;
          rowCount += 1;
        }
        await writeChunk(parts.join(""));
        if (onBatchWritten) await onBatchWritten(rowCount);
      }
      await writeChunk("]}\n");
    } else {
      let columns: readonly string[] = csvColumns;
      let headerWritten = false;
      if (columns.length > 0) {
        await writeChunk(`\uFEFF${columns.map(escapeExportCsvCell).join(",")}`);
        headerWritten = true;
      }
      for await (const batch of batches) {
        if (!batch.length) continue;
        if (!headerWritten) {
          columns = Object.keys(batch[0]!);
          await writeChunk(`\uFEFF${columns.map(escapeExportCsvCell).join(",")}`);
          headerWritten = true;
        }
        const lines: string[] = [];
        for (const row of batch) {
          lines.push(columns.map((key) => escapeExportCsvCell(row[key])).join(","));
          rowCount += 1;
        }
        await writeChunk(`\r\n${lines.join("\r\n")}`);
        if (onBatchWritten) await onBatchWritten(rowCount);
      }
      if (!headerWritten) {
        await writeChunk("\uFEFF");
      }
    }

    output.end();
    await once(output, "finish");
    return {
      rowCount,
      sizeBytes,
      checksum: `sha256:${hash.digest("hex")}`,
    };
  } catch (error) {
    output.destroy();
    throw error;
  }
}

/** Kết hợp cursor DB và luồng ghi đĩa để xuất hàng trăm nghìn dòng với bộ nhớ tăng cố định. */
export async function streamExportToFile(
  prisma: PrismaService,
  category: string,
  format: DataExport["format"],
  targetPath: string,
  onBatchWritten?: (rowCount: number) => Promise<void> | void,
  batchSize = DEFAULT_EXPORT_BATCH_SIZE,
): Promise<StreamedExportSummary> {
  const columns = EXPORT_CSV_COLUMNS[category] ?? [];
  return writeExportBatchesToFile(
    iterateExportBatches(prisma, category, batchSize),
    format,
    targetPath,
    columns,
    onBatchWritten,
  );
}

/** Thu thập từng dòng export với nhãn thực thể (giữ tương thích cho luồng bộ nhớ nhỏ và kiểm thử đơn vị). */
export async function collectExportRows(
  prisma: PrismaService,
  category: string,
): Promise<Array<Record<string, unknown>>> {
  const rows: Array<Record<string, unknown>> = [];
  for await (const batch of iterateExportBatches(prisma, category)) {
    rows.push(...batch);
  }
  return rows;
}

/** Tuần tự hóa export thành JSON hoặc CSV có BOM và escape đúng chuẩn bảng tính cho chế độ in-memory. */
export function serializeExport(
  rows: Array<Record<string, unknown>>,
  format: DataExport["format"],
): Buffer {
  if (format === "JSON") {
    return Buffer.from(
      JSON.stringify(
        {
          format: "wind-edu-data-export",
          version: 1,
          createdAt: new Date().toISOString(),
          rows,
        },
        exportJsonReplacer,
        2,
      ),
      "utf8",
    );
  }
  const keys = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  const lines = [
    keys.map(escapeExportCsvCell).join(","),
    ...rows.map((row) => keys.map((key) => escapeExportCsvCell(row[key])).join(",")),
  ];
  return Buffer.from(`\uFEFF${lines.join("\r\n")}`, "utf8");
}
