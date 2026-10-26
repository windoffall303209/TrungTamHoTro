import fs from "node:fs/promises";
import { FileBlob, SpreadsheetFile } from "@oai/artifact-tool";

const inputPath = "C:/Users/WIND-OF-FALL/Downloads/Checktask_He_Thong_Trung_Tam_v2.xlsx";
const outputDir = "C:/Users/WIND-OF-FALL/Documents/Project/TestDoAn/outputs/checktask_v2_optimized";
const outputPath = `${outputDir}/Checktask_He_Thong_Trung_Tam_v2_optimized.xlsx`;
const previewDir = `${outputDir}/qa_previews`;
const moduleSheets = ["2.1", "2.2", "2.3", "2.4", "2.5", "2.6", "2.7", "2.8", "2.9", "2.10"];

// Extracts the last used row number from a worksheet's used-range address.
function getLastRow(sheet) {
  const address = sheet.getUsedRange().address;
  const matches = address.match(/\d+/g);
  if (!matches || matches.length === 0) {
    throw new Error(`Cannot determine the used row range for sheet ${sheet.name}.`);
  }
  return Number(matches.at(-1));
}

// Reapplies native Excel checkbox cells and aligns all interactive cells in a module sheet.
function optimizeModuleSheet(sheet) {
  const lastRow = getLastRow(sheet);
  const taskRange = `A5:I${lastRow}`;
  const checkboxRange = sheet.getRange(`A5:A${lastRow}`);
  const checkboxValues = checkboxRange.values.map(([value]) => [value === true || value === 1 || value === "TRUE" || value === "1"]);

  // Assigning booleans explicitly serializes these cells as Excel checkbox controls.
  checkboxRange.values = checkboxValues;
  checkboxRange.format.horizontalAlignment = "center";
  checkboxRange.format.verticalAlignment = "center";

  // Dropdown fields remain editable but are centered to match the supplied checklist style.
  sheet.getRange(`G5:H${lastRow}`).format.horizontalAlignment = "center";
  sheet.getRange(`G5:H${lastRow}`).format.verticalAlignment = "center";
  sheet.getRange(`A5:I${lastRow}`).format.verticalAlignment = "center";

  // The checkbox is the authoritative completion source for all local progress metrics.
  sheet.getRange("E2").formulas = [[`=COUNTA(C5:C${lastRow})`]];
  sheet.getRange("G2").formulas = [[`=COUNTIF(A5:A${lastRow},1)`]];
  sheet.getRange("I2").formulas = [["=IF(E2=0,0,G2/E2)"]];
  sheet.getRange("I2").format.numberFormat = "0.0%";
  sheet.getRange("A2").values = [["Tích trực tiếp vào ô Checkbox (Cột A); chọn dropdown tại Cột G và H. Checkbox là nguồn tính tiến độ."]];
  sheet.getRange("A2").format.wrapText = true;
}

// Rebuilds overview formulas from module checkboxes so all summary counts reconcile.
function optimizeOverviewSheet(sheet, workbook) {
  const overviewStartRow = 5;
  const overviewEndRow = overviewStartRow + moduleSheets.length - 1;

  moduleSheets.forEach((moduleName, index) => {
    const row = overviewStartRow + index;
    const moduleSheet = workbook.worksheets.getItem(moduleName);
    const moduleEndRow = getLastRow(moduleSheet);
    sheet.getRange(`D${row}`).formulas = [[`=COUNTA('${moduleName}'!C5:C${moduleEndRow})`]];
    sheet.getRange(`E${row}`).formulas = [[`=COUNTIF('${moduleName}'!A5:A${moduleEndRow},1)`]];
    sheet.getRange(`F${row}`).formulas = [[`=COUNTIFS('${moduleName}'!A5:A${moduleEndRow},0,'${moduleName}'!H5:H${moduleEndRow},\"In Progress\")`]];
    sheet.getRange(`G${row}`).formulas = [[`=COUNTIFS('${moduleName}'!A5:A${moduleEndRow},0,'${moduleName}'!H5:H${moduleEndRow},\"Testing\")`]];
    sheet.getRange(`H${row}`).formulas = [[`=D${row}-E${row}-F${row}-G${row}`]];
    sheet.getRange(`I${row}`).formulas = [[`=IF(D${row}=0,0,E${row}/D${row})`]];
  });

  sheet.getRange(`D15`).formulas = [[`=SUM(D${overviewStartRow}:D${overviewEndRow})`]];
  sheet.getRange(`E15`).formulas = [[`=SUM(E${overviewStartRow}:E${overviewEndRow})`]];
  sheet.getRange(`F15`).formulas = [[`=SUM(F${overviewStartRow}:F${overviewEndRow})`]];
  sheet.getRange(`G15`).formulas = [[`=SUM(G${overviewStartRow}:G${overviewEndRow})`]];
  sheet.getRange(`H15`).formulas = [[`=SUM(H${overviewStartRow}:H${overviewEndRow})`]];
  sheet.getRange("I15").formulas = [["=IF(D15=0,0,E15/D15)"]];
  sheet.getRange("I5:I15").format.numberFormat = "0.0%";
  sheet.getRange("A14").formulas = [["=\"2.10\""]];
  sheet.getRange("A5:I15").format.verticalAlignment = "center";
  sheet.getRange("D5:I15").format.horizontalAlignment = "center";
}

// Saves the optimized workbook and writes compact verification artifacts.
async function optimizeWorkbook() {
  await fs.mkdir(outputDir, { recursive: true });
  await fs.mkdir(previewDir, { recursive: true });
  const source = await FileBlob.load(inputPath);
  const workbook = await SpreadsheetFile.importXlsx(source);

  for (const moduleName of moduleSheets) {
    optimizeModuleSheet(workbook.worksheets.getItem(moduleName));
  }
  optimizeOverviewSheet(workbook.worksheets.getItem("Tổng quan"), workbook);
  workbook.recalculate();

  const summaryCheck = await workbook.inspect({ kind: "table", range: "Tổng quan!A1:I15", include: "values,formulas", tableMaxRows: 15, tableMaxCols: 9 });
  const moduleCheck = await workbook.inspect({ kind: "table", range: "2.1!A1:I17", include: "values,formulas", tableMaxRows: 17, tableMaxCols: 9 });
  const formulaErrors = await workbook.inspect({ kind: "match", searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A|#NUM!|#NULL!|#SPILL!|#CALC!", options: { useRegex: true, maxResults: 300 }, summary: "final formula error scan" });
  await fs.writeFile(`${outputDir}/qa_summary.ndjson`, summaryCheck.ndjson, "utf8");
  await fs.writeFile(`${outputDir}/qa_module_2_1.ndjson`, moduleCheck.ndjson, "utf8");
  await fs.writeFile(`${outputDir}/qa_formula_errors.ndjson`, formulaErrors.ndjson, "utf8");

  const overviewPreview = await workbook.render({ sheetName: "Tổng quan", range: "A1:I15", scale: 1, format: "png" });
  const modulePreview = await workbook.render({ sheetName: "2.1", range: "A1:I17", scale: 1, format: "png" });
  await fs.writeFile(`${previewDir}/overview.png`, new Uint8Array(await overviewPreview.arrayBuffer()));
  await fs.writeFile(`${previewDir}/module-2.1.png`, new Uint8Array(await modulePreview.arrayBuffer()));

  const output = await SpreadsheetFile.exportXlsx(workbook);
  await output.save(outputPath);
  console.log(JSON.stringify({ outputPath, summaryCheck: summaryCheck.ndjson, formulaErrors: formulaErrors.ndjson }, null, 2));
}

await optimizeWorkbook();
