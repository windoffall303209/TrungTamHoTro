import fs from "node:fs/promises";
import { FileBlob, SpreadsheetFile } from "@oai/artifact-tool";

const inputPath = "C:/Users/WIND-OF-FALL/Downloads/Checktask_He_Thong_Trung_Tam_v2.xlsx";
const outputDir = "C:/Users/WIND-OF-FALL/Documents/Project/TestDoAn/outputs/checktask_v2_optimized/inspection";

// Inspects the provided workbook's structure, formulas, and visible sheet areas before editing.
await fs.mkdir(outputDir, { recursive: true });
const input = await FileBlob.load(inputPath);
const workbook = await SpreadsheetFile.importXlsx(input);
const summary = await workbook.inspect({ kind: "workbook,sheet,table", maxChars: 30000, tableMaxRows: 15, tableMaxCols: 15 });
const formulas = await workbook.inspect({ kind: "formula", maxChars: 30000, options: { maxResults: 1000 } });
await fs.writeFile(`${outputDir}/summary.ndjson`, summary.ndjson, "utf8");
await fs.writeFile(`${outputDir}/formulas.ndjson`, formulas.ndjson, "utf8");
console.log(summary.ndjson);
console.log(formulas.ndjson);
for (const worksheet of workbook.worksheets.items) {
  const used = worksheet.getUsedRange();
  const preview = await workbook.render({ sheetName: worksheet.name, range: used.address, scale: 1, format: "png" });
  await fs.writeFile(`${outputDir}/${worksheet.name.replace(/[^a-z0-9]/gi, "_")}.png`, new Uint8Array(await preview.arrayBuffer()));
}
const checkboxHelp = workbook.help("checkbox", { include: "index,examples,notes", maxChars: 5000 });
console.log(checkboxHelp.ndjson);
