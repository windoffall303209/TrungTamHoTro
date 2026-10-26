import { FileBlob, SpreadsheetFile } from "@oai/artifact-tool";
const wb = await SpreadsheetFile.importXlsx(await FileBlob.load("C:/Users/WIND-OF-FALL/Downloads/Checktask_He_Thong_Trung_Tam_v2.xlsx"));
const s = wb.worksheets.getItem("2.1");
console.log(JSON.stringify(s.getRange("A5:A17").values));
console.log(JSON.stringify(s.getRange("A5:A17").formulas));
console.log((await wb.inspect({kind:"table", range:"2.1!A5:A17",include:"values,formulas",tableMaxRows:20,tableMaxCols:3})).ndjson);
