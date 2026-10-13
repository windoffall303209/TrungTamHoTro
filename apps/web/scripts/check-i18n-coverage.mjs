import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";
import ts from "typescript";

const sourceRoot = resolve("src");
const catalogPath = resolve("src/i18n/catalog.ts");
const generatedCatalogPath = resolve("src/i18n/generated-en.json");
const vietnamesePattern = /[ÀÁẠẢÃÂẦẤẬẨẪĂẰẮẶẲẴÈÉẸẺẼÊỀẾỆỂỄÌÍỊỈĨÒÓỌỎÕÔỒỐỘỔỖƠỜỚỢỞỠÙÚỤỦŨƯỪỨỰỬỮỲÝỴỶỸĐàáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/;
const ignoredSegments = new Set([".test.ts", ".test.tsx", ".spec.ts", ".spec.tsx"]);

// Thu thập tệp TypeScript giao diện nhưng bỏ test và chính catalog.
function collectSourceFiles(directory) {
  const files = [];
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) files.push(...collectSourceFiles(path));
    else if ([".ts", ".tsx"].includes(extname(path)) && ![...ignoredSegments].some((suffix) => path.endsWith(suffix)) && path !== catalogPath) files.push(path);
  }
  return files;
}

// Chuẩn hóa khoảng trắng để khớp cách trình duyệt hiển thị JSX text.
function normalize(value) {
  return value.replace(/\s+/g, " ").trim();
}

// Trích chuỗi tiếng Việt từ literal/JSX text có khả năng hiển thị cho người dùng.
function extractVietnameseStrings(path, dynamicFragments, dynamicTemplates) {
  const sourceText = readFileSync(path, "utf8");
  const source = ts.createSourceFile(path, sourceText, ts.ScriptTarget.Latest, true, path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const values = [];
  /** Duyệt JSX và chuỗi mẫu để thu thập nội dung tiếng Việt cần dịch. */
  const visit = (node) => {
    if (ts.isJsxText(node) || ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      const value = normalize(node.text);
      if (value && vietnamesePattern.test(value)) values.push(value);
    }
    if (ts.isTemplateExpression(node)) {
      const fragments = [node.head.text, ...node.templateSpans.map((span) => span.literal.text)];
      const template = normalize(`${node.head.text}${node.templateSpans.map((span, index) => `{{${index}}}${span.literal.text}`).join("")}`);
      if (vietnamesePattern.test(template)) {
        values.push(template);
        dynamicTemplates.add(template);
      }
      for (const fragment of fragments) {
        const value = normalize(fragment);
        if (value.length >= 4 && vietnamesePattern.test(value)) {
          values.push(value);
          dynamicFragments.add(value);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return values;
}

// Đọc khóa tiếng Việt đã có trong catalog từ AST thay vì chạy module TypeScript.
function catalogKeys() {
  const source = ts.createSourceFile(catalogPath, readFileSync(catalogPath, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const keys = new Set();
  /** Duyệt cây cú pháp để thu thập khóa bản dịch đã khai báo. */
  const visit = (node) => {
    if (ts.isPropertyAssignment(node) && (ts.isStringLiteral(node.name) || ts.isNoSubstitutionTemplateLiteral(node.name))) keys.add(normalize(node.name.text));
    ts.forEachChild(node, visit);
  };
  visit(source);
  if (existsSync(generatedCatalogPath)) {
    for (const key of Object.keys(JSON.parse(readFileSync(generatedCatalogPath, "utf8")))) keys.add(normalize(key));
  }
  return keys;
}

const occurrences = new Map();
const dynamicFragments = new Set();
const dynamicTemplates = new Set();
for (const path of collectSourceFiles(sourceRoot)) {
  for (const value of extractVietnameseStrings(path, dynamicFragments, dynamicTemplates)) {
    const locations = occurrences.get(value) ?? new Set();
    locations.add(relative(sourceRoot, path).replaceAll("\\", "/"));
    occurrences.set(value, locations);
  }
}
const translated = catalogKeys();
const missing = [...occurrences]
  .filter(([value]) => !translated.has(value))
  .sort(([left], [right]) => left.localeCompare(right, "vi"))
  .map(([value, paths]) => ({ value, paths: [...paths].sort() }));

const checkOnly = process.argv.includes("--check");
const report = { total: occurrences.size, translated: occurrences.size - missing.length, missingCount: missing.length, dynamicFragments: [...dynamicFragments].sort((left, right) => left.localeCompare(right, "vi")), dynamicTemplates: [...dynamicTemplates].sort((left, right) => left.localeCompare(right, "vi")), missing };
process.stdout.write(`${JSON.stringify(checkOnly ? { total: report.total, translated: report.translated, missingCount: report.missingCount } : report, null, 2)}\n`);
if (checkOnly && missing.length) process.exitCode = 1;
