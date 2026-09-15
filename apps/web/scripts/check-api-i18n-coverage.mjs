import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";
import ts from "typescript";

const apiRoot = resolve("../api/src");
const catalogPath = resolve("src/i18n/catalog.ts");
const generatedCatalogPath = resolve("src/i18n/generated-en.json");
const vietnamesePattern = /[ÀÁẠẢÃÂẦẤẬẨẪĂẰẮẶẲẴÈÉẸẺẼÊỀẾỆỂỄÌÍỊỈĨÒÓỌỎÕÔỒỐỘỔỖƠỜỚỢỞỠÙÚỤỦŨƯỪỨỰỬỮỲÝỴỶỸĐàáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/;

/** Thu thập toàn bộ tệp TypeScript trong API. */
function collectFiles(directory) {
  const files = [];
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) files.push(...collectFiles(path));
    else if (extname(path) === ".ts") files.push(path);
  }
  return files;
}

/** Chuẩn hóa thông điệp theo cách API gửi về client. */
function normalize(value) {
  return value.replace(/\s+/g, " ").trim();
}

/** Lấy chuỗi message từ constructor HttpException, gồm cả payload object. */
function extractExceptionMessages(path) {
  const source = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const values = [];
  /** Thu thập chuỗi tiếng Việt từ nút cú pháp để kiểm tra bản dịch thông báo API. */
  const addLiteral = (node) => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      const value = normalize(node.text);
      if (vietnamesePattern.test(value)) values.push(value);
    }
  };
  /** Duyệt lệnh tạo ngoại lệ để thu thập thông báo cần có bản dịch. */
  const visit = (node) => {
    if (ts.isNewExpression(node) && /Exception$/.test(node.expression.getText(source))) {
      const first = node.arguments?.[0];
      if (first) {
        addLiteral(first);
        if (ts.isObjectLiteralExpression(first)) {
          for (const property of first.properties) {
            if (ts.isPropertyAssignment(property) && property.name.getText(source).replace(/["']/g, "") === "message") addLiteral(property.initializer);
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return values;
}

/** Đọc khóa từ catalog sinh tự động và catalog biên tập. */
function catalogKeys() {
  const keys = new Set(existsSync(generatedCatalogPath) ? Object.keys(JSON.parse(readFileSync(generatedCatalogPath, "utf8"))) : []);
  const source = ts.createSourceFile(catalogPath, readFileSync(catalogPath, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  /** Duyệt cây cú pháp để thu thập khóa bản dịch đã khai báo. */
  const visit = (node) => {
    if (ts.isPropertyAssignment(node) && (ts.isStringLiteral(node.name) || ts.isNoSubstitutionTemplateLiteral(node.name))) keys.add(normalize(node.name.text));
    ts.forEachChild(node, visit);
  };
  visit(source);
  return keys;
}

const occurrences = new Map();
for (const path of collectFiles(apiRoot)) {
  for (const value of extractExceptionMessages(path)) {
    const paths = occurrences.get(value) ?? new Set();
    paths.add(relative(apiRoot, path).replaceAll("\\", "/"));
    occurrences.set(value, paths);
  }
}
const translated = catalogKeys();
const missing = [...occurrences]
  .filter(([value]) => !translated.has(value))
  .sort(([left], [right]) => left.localeCompare(right, "vi"))
  .map(([value, paths]) => ({ value, paths: [...paths].sort() }));

const checkOnly = process.argv.includes("--check");
const report = { total: occurrences.size, translated: occurrences.size - missing.length, missingCount: missing.length, values: [...occurrences.keys()].sort((left, right) => left.localeCompare(right, "vi")), missing };
process.stdout.write(`${JSON.stringify(checkOnly ? { total: report.total, translated: report.translated, missingCount: report.missingCount } : report, null, 2)}\n`);
if (checkOnly && missing.length) process.exitCode = 1;
