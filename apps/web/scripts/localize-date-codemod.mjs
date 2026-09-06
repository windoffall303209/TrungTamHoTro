import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { extname, join, resolve } from "node:path";

const sourceRoot = resolve("src");
const localeCallPattern = /\.toLocale(String|DateString|TimeString)\("vi-VN"/g;

/** Thu thập tệp TypeScript cần kiểm tra. */
function collectFiles(directory) {
  const files = [];
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) files.push(...collectFiles(path));
    else if ([".ts", ".tsx"].includes(extname(path)) && !path.includes(`${join("src", "i18n")}`)) files.push(path);
  }
  return files;
}

/** Thay locale cố định và thêm import helper đúng một lần. */
function updateFile(path) {
  const original = readFileSync(path, "utf8");
  if (!localeCallPattern.test(original)) return false;
  localeCallPattern.lastIndex = 0;
  let updated = original.replace(localeCallPattern, ".toLocale$1(activeLocale()");
  if (!updated.includes('from "@/i18n/runtime"')) {
    const directive = updated.startsWith('"use client";') ? '"use client";\n\n' : "";
    updated = `${directive}import { activeLocale } from "@/i18n/runtime";\n${updated.slice(directive.length)}`;
  }
  writeFileSync(path, updated);
  return true;
}

const changed = collectFiles(sourceRoot).filter(updateFile);
process.stdout.write(`Localized date formatting in ${changed.length} files.\n`);
