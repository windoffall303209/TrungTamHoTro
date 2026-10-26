import { FileBlob, SpreadsheetFile } from "@oai/artifact-tool";
const wb = await SpreadsheetFile.importXlsx(await FileBlob.load("C:/Users/WIND-OF-FALL/Downloads/Checktask_He_Thong_Trung_Tam_v2.xlsx"));
const s=wb.worksheets.getItem("2.1");
s.getRange("J2:N2").formulas=[["=COUNTIF(A5:A17,TRUE)","=COUNTIF(A5:A17,1)","=SUMPRODUCT(--(A5:A17=TRUE))","=SUMPRODUCT(--A5:A17)","=COUNTIF(H5:H17,\"Done\")"]];
wb.recalculate();
console.log(JSON.stringify(s.getRange("J2:N2").values));
console.log(JSON.stringify(s.getRange("J2:N2").formulas));
