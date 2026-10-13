import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const outputPath = resolve("src/i18n/generated-en.json");
const apiOutputPath = resolve("../api/src/common/generated-en-errors.ts");
const dynamicOutputPath = resolve("src/i18n/generated-dynamic-en.json");
const templateOutputPath = resolve("src/i18n/generated-template-en.json");
const markerPattern = /__WOF_(\d{4})__\s*([\s\S]*?)(?=\n__WOF_\d{4}__|$)/g;

/** Giải mã các entity HTML mà trang dịch trả về. */
function decodeHtml(value) {
  return value
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)));
}

/** Chờ giữa các lượt để không tạo tải dồn lên dịch vụ dịch. */
function wait(milliseconds) {
  return new Promise((resolveWait) => setTimeout(resolveWait, milliseconds));
}

/** Chia chuỗi theo giới hạn URL nhưng không tách một thông điệp đơn lẻ. */
function createBatches(values, maximumCharacters = 1800) {
  const batches = [];
  let batch = [];
  let size = 0;
  for (const value of values) {
    const projected = size + value.length + 22;
    if (batch.length && projected > maximumCharacters) {
      batches.push(batch);
      batch = [];
      size = 0;
    }
    batch.push(value);
    size += value.length + 22;
  }
  if (batch.length) batches.push(batch);
  return batches;
}

/** Gửi một nhóm chuỗi tới trang Google Translate mobile và khôi phục từng kết quả theo marker. */
async function translateBatch(values) {
  const input = values.map((value, index) => `__WOF_${String(index).padStart(4, "0")}__ ${value}`).join("\n");
  const url = `https://translate.google.com/m?sl=vi&tl=en&hl=en-US&q=${encodeURIComponent(input)}`;
  const response = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (compatible; WindEDU-I18n/1.0)" } });
  if (!response.ok) throw new Error(`Translation request failed with HTTP ${response.status}.`);
  const html = await response.text();
  const container = html.match(/<div class="result-container">([\s\S]*?)<\/div>/)?.[1];
  if (!container) throw new Error("Translation response did not contain a result container.");
  const translated = new Map();
  const decoded = decodeHtml(container).replaceAll("<br>", "\n");
  for (const match of decoded.matchAll(markerPattern)) translated.set(Number(match[1]), match[2].trim());
  if (translated.size !== values.length) throw new Error(`Expected ${values.length} translations but received ${translated.size}.`);
  return values.map((_, index) => translated.get(index));
}

/** Thử lại lỗi mạng tạm thời với khoảng chờ tăng dần. */
async function translateWithRetry(values) {
  let lastError;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      return await translateBatch(values);
    } catch (error) {
      lastError = error;
      await wait(attempt * 1000);
    }
  }
  throw lastError;
}

/** Sinh catalog tĩnh có thể kiểm tra vào mã nguồn và dùng hoàn toàn offline khi chạy ứng dụng. */
async function main() {
  const reports = ["check-i18n-coverage.mjs", "check-api-i18n-coverage.mjs"].map((script) => JSON.parse(execFileSync(process.execPath, [resolve(`scripts/${script}`)], { encoding: "utf8" })));
  const existing = existsSync(outputPath) ? JSON.parse(readFileSync(outputPath, "utf8")) : {};
  const pending = [...new Set(reports.flatMap((report) => report.missing.map(({ value }) => value)))].filter((value) => !existing[value]);
  const batches = createBatches(pending);
  for (let index = 0; index < batches.length; index += 1) {
    const batch = batches[index];
    const results = await translateWithRetry(batch);
    batch.forEach((source, resultIndex) => { existing[source] = results[resultIndex]; });
    writeFileSync(outputPath, `${JSON.stringify(Object.fromEntries(Object.entries(existing).sort(([left], [right]) => left.localeCompare(right, "vi"))), null, 2)}\n`);
    process.stdout.write(`Translated batch ${index + 1}/${batches.length} (${Object.keys(existing).length} strings)\n`);
    await wait(250);
  }
  const apiMessages = Object.fromEntries(reports[1].values.map((source) => [source, existing[source]]).filter(([, translation]) => typeof translation === "string" && translation));
  writeFileSync(apiOutputPath, `// Được sinh bởi apps/web/scripts/generate-i18n-catalog.mjs; chỉnh bản dịch chọn lọc trong danh mục của web.\nexport const apiEnglishErrors: Readonly<Record<string, string>> = Object.freeze(${JSON.stringify(apiMessages, null, 2)});\n`);
  const dynamicMessages = Object.fromEntries(reports[0].dynamicFragments.map((source) => [source, existing[source]]).filter(([, translation]) => typeof translation === "string" && translation));
  writeFileSync(dynamicOutputPath, `${JSON.stringify(dynamicMessages, null, 2)}\n`);
  const templateMessages = Object.fromEntries(reports[0].dynamicTemplates.map((source) => [source, existing[source]]).filter(([, translation]) => typeof translation === "string" && translation));
  writeFileSync(templateOutputPath, `${JSON.stringify(templateMessages, null, 2)}\n`);
}

await main();
