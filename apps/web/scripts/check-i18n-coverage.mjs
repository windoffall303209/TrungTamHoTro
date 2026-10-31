import { readFileSync } from "node:fs";
import { extname, relative, resolve } from "node:path";
import ts from "typescript";
import { collectCoverageFiles, normalizeCoverageValue as normalize, readCoverageCatalogKeys, vietnamesePattern } from "./i18n-coverage-shared.mjs";

const sourceRoot = resolve("src");
const catalogPath = resolve("src/i18n/catalog.ts");
const generatedCatalogPath = resolve("src/i18n/generated-en.json");
const ignoredSegments = new Set([".test.ts", ".test.tsx", ".spec.ts", ".spec.tsx"]);

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

const occurrences = new Map();
const dynamicFragments = new Set();
const dynamicTemplates = new Set();
for (const path of collectCoverageFiles(sourceRoot, (path) => [".ts", ".tsx"].includes(extname(path)) && ![...ignoredSegments].some((suffix) => path.endsWith(suffix)) && path !== catalogPath)) {
  for (const value of extractVietnameseStrings(path, dynamicFragments, dynamicTemplates)) {
    const locations = occurrences.get(value) ?? new Set();
    locations.add(relative(sourceRoot, path).replaceAll("\\", "/"));
    occurrences.set(value, locations);
  }
}
const translated = readCoverageCatalogKeys(catalogPath, generatedCatalogPath, true);
const missing = [...occurrences]
  .filter(([value]) => !translated.has(value))
  .sort(([left], [right]) => left.localeCompare(right, "vi"))
  .map(([value, paths]) => ({ value, paths: [...paths].sort() }));

const checkOnly = process.argv.includes("--check");
const report = { total: occurrences.size, translated: occurrences.size - missing.length, missingCount: missing.length, dynamicFragments: [...dynamicFragments].sort((left, right) => left.localeCompare(right, "vi")), dynamicTemplates: [...dynamicTemplates].sort((left, right) => left.localeCompare(right, "vi")), missing };
process.stdout.write(`${JSON.stringify(checkOnly ? { total: report.total, translated: report.translated, missingCount: report.missingCount } : report, null, 2)}\n`);
if (checkOnly && missing.length) process.exitCode = 1;
