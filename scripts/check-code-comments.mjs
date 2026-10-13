import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const sourceRoots = [
  "apps/api/src",
  "apps/api/test",
  "apps/api/scripts",
  "apps/api/prisma",
  "apps/web/src",
  "apps/web/e2e",
  "apps/web/scripts",
  "packages/contracts/src",
  "scripts",
];
const vietnamese =
  /[ăâđêôơưàáảãạèéẻẽẹìíỉĩịòóỏõọùúủũụỳýỷỹỵĂÂĐÊÔƠƯ\u1ea0-\u1ef9]/u;

/** Duyệt các thư mục mã nguồn, bỏ qua mã sinh tự động và liên kết thư mục. */
function sourceFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (
      entry.isSymbolicLink() ||
      ["generated", "node_modules", ".next", "dist"].includes(entry.name)
    )
      return [];
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(file);
    return /\.[cm]?[jt]sx?$/.test(entry.name) ? [file] : [];
  });
}

/** Xác định hàm có tên, phương thức có thân và callback được đặt tên bằng useCallback. */
function declarationTarget(ts, node, source) {
  if (
    (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)) &&
    node.body &&
    node.name
  )
    return node;
  if (!ts.isVariableDeclaration(node) || !node.initializer) return undefined;
  const initializer = node.initializer;
  if (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer))
    return node.parent.parent;
  if (
    ts.isCallExpression(initializer) &&
    /^(React\.)?useCallback$/.test(initializer.expression.getText(source))
  )
    return node.parent.parent;
  return undefined;
}

/** Kiểm tra chú thích trước khai báo; không đánh đồng có chú thích với chất lượng giải thích. */
function inspectFile(ts, file) {
  const text = fs.readFileSync(file, "utf8");
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const issues = [];
  let functions = 0;
  /** Duyệt cả hàm lồng nhau, nhưng không yêu cầu mô tả riêng cho callback nội tuyến đơn giản. */
  function visit(node) {
    const target = declarationTarget(ts, node, source);
    if (target) {
      functions += 1;
      const end =
        node.body?.getStart(source) ?? node.initializer.getStart(source);
      const prefix = text.slice(target.getFullStart(), end);
      const comments = prefix.match(/\/\*[\s\S]*?\*\/|\/\/[^\r\n]*/g) ?? [];
      if (!comments.some((comment) => vietnamese.test(comment))) {
        issues.push({
          file: path.relative(projectRoot, file).replaceAll("\\", "/"),
          line:
            source.getLineAndCharacterOfPosition(node.getStart(source)).line +
            1,
          name: node.name.getText(source),
        });
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return { functions, issues };
}

/** Chạy kiểm tra chỉ đọc và trả mã lỗi để tích hợp vào quy trình kiểm tra project. */
function main() {
  const { values } = parseArgs({
    options: {
      json: { type: "boolean", default: false },
      help: { type: "boolean", default: false },
    },
    strict: true,
  });
  if (values.help) {
    console.log(
      "Dùng: node scripts/check-code-comments.mjs [--json] [--help]\nKiểm tra chú thích tiếng Việt cho hàm có tên, phương thức và useCallback trong mã nguồn, script và kiểm thử. Không đọc docs/ hoặc mã sinh tự động.",
    );
    return;
  }
  const ts = createRequire(path.join(projectRoot, "apps/api/package.json"))(
    "typescript",
  );
  const files = sourceRoots.flatMap((root) =>
    sourceFiles(path.join(projectRoot, root)),
  );
  const results = files.map((file) => inspectFile(ts, file));
  const report = {
    files: files.length,
    functions: results.reduce((sum, result) => sum + result.functions, 0),
    issues: results.flatMap((result) => result.issues),
  };
  if (values.json) console.log(JSON.stringify(report, null, 2));
  else {
    console.log(
      `Chú thích tiếng Việt: ${report.functions - report.issues.length}/${report.functions} hàm có tên và phương thức trong ${report.files} tệp.`,
    );
    for (const issue of report.issues)
      console.error(
        `${issue.file}:${issue.line} — Thiếu chú thích tiếng Việt cho ${issue.name}.`,
      );
  }
  if (report.issues.length) process.exitCode = 1;
}

try {
  main();
} catch (error) {
  console.error(
    `Không thể kiểm tra chú thích: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 1;
}
