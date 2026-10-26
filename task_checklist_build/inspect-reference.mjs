import fs from "node:fs/promises";
import { FileBlob, SpreadsheetFile } from "@oai/artifact-tool";

// Inspects the supplied checklist workbook before reproducing its practical layout.
const inputPath = "C:/Users/WIND-OF-FALL/Documents/Project/TestDoAn/reference_checktask.xlsx";
const outputPath = "C:/Users/WIND-OF-FALL/Documents/Project/TestDoAn/task_checklist_build/reference-inspection.txt";
const input = await FileBlob.load(inputPath);
const workbook = await SpreadsheetFile.importXlsx(input);
const summary = await workbook.inspect({
  kind: "workbook,sheet,table,computedStyle",
  maxChars: 18000,
  tableMaxRows: 20,
  tableMaxCols: 20,
});
await fs.writeFile(outputPath, summary.ndjson, "utf8");
console.log(summary.ndjson);
