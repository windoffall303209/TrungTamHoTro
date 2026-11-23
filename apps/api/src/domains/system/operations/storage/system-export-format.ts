import { csvSafeText, redactSensitiveValue } from "../../../../common/redaction.js";
import { PrismaService } from "../../../../database/prisma.service.js";
import { DataExport } from "../../core/system.shared.js";

/** Thu thập từng dòng export với nhãn thực thể để CSV và JSON cùng một phạm vi. */
export async function collectExportRows(
  prisma: PrismaService,
  category: string,
): Promise<Array<Record<string, unknown>>> {
  if (category === "AUDIT")
    return (
      await prisma.auditLog.findMany({ orderBy: { createdAt: "asc" } })
    ).map((row) => ({ entity: "audit_log", ...row, context: redactSensitiveValue(row.context) }));
  if (category === "USERS")
    return (
      await prisma.user.findMany({
        select: {
          id: true,
          username: true,
          email: true,
          displayName: true,
          status: true,
          createdAt: true,
          updatedAt: true,
        },
        orderBy: { createdAt: "asc" },
      })
    ).map((row) => ({ entity: "user", ...row }));
  const [courses, classes, exams, attempts, assignments, submissions] =
    await prisma.$transaction([
      prisma.course.findMany({ orderBy: { createdAt: "asc" } }),
      prisma.learningClass.findMany({ orderBy: { createdAt: "asc" } }),
      prisma.exam.findMany({ orderBy: { createdAt: "asc" } }),
      prisma.examAttempt.findMany({ orderBy: { startedAt: "asc" } }),
      prisma.assignment.findMany({ orderBy: { createdAt: "asc" } }),
      prisma.assignmentSubmission.findMany({ orderBy: { submittedAt: "asc" } }),
    ]);
  return [
    ...courses.map((row) => ({ entity: "course", ...row })),
    ...classes.map((row) => ({ entity: "learning_class", ...row })),
    ...exams.map((row) => ({ entity: "exam", ...row })),
    ...attempts.map((row) => ({ entity: "exam_attempt", ...row })),
    ...assignments.map((row) => ({ entity: "assignment", ...row })),
    ...submissions.map((row) => ({ entity: "assignment_submission", ...row })),
  ];
}

/** Tuần tự hóa export thành JSON hoặc CSV có BOM và escape đúng chuẩn bảng tính. */
export function serializeExport(
  rows: Array<Record<string, unknown>>,
  format: DataExport["format"],
): Buffer {
  /** Replacer JSON cho số nguyên lớn; Date đã tự chuyển ISO qua toJSON nên không cần sao chép dữ liệu trung gian. */
  const replacer = (_key: string, item: unknown): unknown => (typeof item === "bigint" ? item.toString() : item);
  // Tuần tự hóa một lượt duy nhất: bỏ vòng JSON.parse(JSON.stringify()) từng nhân bản toàn bộ bảng trên V8 heap.
  if (format === "JSON")
    return Buffer.from(
      JSON.stringify(
        {
          format: "wind-edu-data-export",
          version: 1,
          createdAt: new Date().toISOString(),
          rows,
        },
        replacer,
        2,
      ),
      "utf8",
    );
  const keys = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  /** Chuyển mọi kiểu giá trị xuất dữ liệu về chuỗi CSV xác định. */
  const formatCell = (value: unknown): string => {
    if (value === null || value === undefined) return "";
    if (value instanceof Date) return value.toISOString();
    if (typeof value === "object")
      return JSON.stringify(value, replacer) ?? "";
    if (typeof value === "string") return value;
    if (
      typeof value === "number" ||
      typeof value === "boolean" ||
      typeof value === "bigint"
    )
      return value.toString();
    if (typeof value === "symbol") return value.description ?? "";
    return "[function]";
  };
  /** Bao ô CSV bằng dấu ngoặc kép, thoát dấu ngoặc kép và vô hiệu hóa công thức trong ô văn bản. */
  const escape = (value: unknown): string => {
    const normalized = typeof value === "string" ? csvSafeText(formatCell(value)) : formatCell(value);
    return `"${normalized.replace(/"/g, '""')}"`;
  };
  const lines = [
    keys.map(escape).join(","),
    ...rows.map((row) => keys.map((key) => escape(row[key])).join(",")),
  ];
  return Buffer.from(`\uFEFF${lines.join("\r\n")}`, "utf8");
}
