import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";

export const vietnamesePattern = /[ÀÁẠẢÃÂẦẤẬẨẪĂẰẮẶẲẴÈÉẸẺẼÊỀẾỆỂỄÌÍỊỈĨÒÓỌỎÕÔỒỐỘỔỖƠỜỚỢỞỠÙÚỤỦŨƯỪỨỰỬỮỲÝỴỶỸĐàáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/;

// Chuẩn hóa khoảng trắng trước khi so khớp khóa bản dịch.
export function normalizeCoverageValue(value) {
  return value.replace(/\s+/g, " ").trim();
}

// Duyệt đệ quy các tệp nguồn và để mỗi bộ kiểm tra tự chọn loại tệp phù hợp.
export function collectCoverageFiles(directory, includeFile) {
  const files = [];
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) files.push(...collectCoverageFiles(path, includeFile));
    else if (includeFile(path)) files.push(path);
  }
  return files;
}

// Thu thập khóa biên tập từ AST và khóa tự sinh, giữ đúng quy tắc chuẩn hóa của từng báo cáo.
export function readCoverageCatalogKeys(catalogPath, generatedCatalogPath, normalizeGenerated = false) {
  const source = ts.createSourceFile(catalogPath, readFileSync(catalogPath, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const keys = new Set();
  // Duyệt các thuộc tính chuỗi để lấy toàn bộ khóa trong catalog biên tập.
  const visit = (node) => {
    if (ts.isPropertyAssignment(node) && (ts.isStringLiteral(node.name) || ts.isNoSubstitutionTemplateLiteral(node.name))) {
      keys.add(normalizeCoverageValue(node.name.text));
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  if (existsSync(generatedCatalogPath)) {
    for (const key of Object.keys(JSON.parse(readFileSync(generatedCatalogPath, "utf8")))) {
      keys.add(normalizeGenerated ? normalizeCoverageValue(key) : key);
    }
  }
  return keys;
}
