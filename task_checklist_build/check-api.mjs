import { Workbook } from "@oai/artifact-tool";
const wb = Workbook.create();
console.log(wb.help("checkbox|check box|cell control|form control", {include:"index,examples,notes",maxChars:10000}).ndjson);
