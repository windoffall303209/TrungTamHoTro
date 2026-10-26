import fs from "node:fs/promises";
import { SpreadsheetFile, Workbook } from "@oai/artifact-tool";

const outputDir = "C:/Users/WIND-OF-FALL/Documents/Project/TestDoAn/outputs/checktask_he_thong_trung_tam_20261025";
const outputPath = `${outputDir}/Checktask_he_thong_trung_tam.xlsx`;
const previewDir = `${outputDir}/qa_previews`;
const fontName = "Times New Roman";
const headers = ["Done?", "Task ID", "Tên chức năng", "Mô tả chức năng", "Owner", "Priority", "Status", "Sprint", "Ngày cập nhật", "Phiên bản / Commit", "Đã sửa / thay đổi", "Lưu ý / Blocker"];

const sections = [
  ["2.1", "Xác thực và quản lý tài khoản", [
    ["Tạo tài khoản", "Quản trị tạo tài khoản mới; hệ thống kiểm tra dữ liệu và username chưa tồn tại, sau đó tạo tài khoản chưa xác minh."],
    ["Đăng nhập vào hệ thống", "Xác thực người dùng, hỗ trợ 2FA khi bật, tạo phiên làm việc an toàn và mở giao diện theo vai trò."],
    ["Khôi phục và đổi mật khẩu", "Gửi liên kết đặt lại mật khẩu có thời hạn; hỗ trợ đổi mật khẩu trực tiếp trong hồ sơ khi người dùng đang đăng nhập."],
    ["Quản lý phiên và hồ sơ cá nhân", "Xem và thu hồi phiên hoạt động; cập nhật hồ sơ và ảnh đại diện."],
  ]],
  ["2.2", "Quản trị người dùng và phân quyền", [
    ["Tra cứu và quản lý tài khoản người dùng", "Tìm kiếm, tạo mới, cập nhật, khóa hoặc mở khóa tài khoản; ghi nhận nhật ký danh tính."],
    ["Điều chỉnh vai trò và phân quyền", "Xem trước tác động, thay đổi vai trò hoặc ma trận quyền và ghi nhật ký thay đổi."],
  ]],
  ["2.3", "Khóa học, lớp và ghi danh", [
    ["Quản lý khóa học theo phiên bản", "Tạo, cập nhật, phát hành, lưu trữ khóa học và theo dõi lịch sử phiên bản."],
    ["Tạo lớp và quản lý vòng đời lớp", "Tạo, kích hoạt, đóng hoặc mở lại lớp; kiểm tra điều kiện trước khi đóng lớp."],
    ["Phân công giảng viên cho lớp", "Gán giảng viên chính/đồng giảng viên, kiểm tra trùng lịch và lưu lịch sử phân công."],
    ["Ghi danh học viên vào lớp", "Ghi danh thủ công hoặc hàng loạt, kiểm soát sĩ số và giữ an toàn dữ liệu khi gỡ/ghi danh lại."],
  ]],
  ["2.4", "Học liệu", [
    ["Tải lên và phiên bản hóa học liệu", "Giảng viên tải học liệu, hệ thống kiểm tra kiểu tệp, dung lượng, checksum và lưu lịch sử phiên bản."],
    ["Tìm kiếm, truy cập và tải xuống học liệu", "Tìm kiếm, lọc, phân trang và tải đúng phiên bản học liệu qua liên kết có thời hạn theo quyền."],
    ["Kiểm duyệt học liệu", "Quản lý duyệt, ẩn, cách ly hoặc thu hồi học liệu và lưu lịch sử kiểm duyệt."],
  ]],
  ["2.5", "Ngân hàng câu hỏi và đề thi", [
    ["Xây dựng ngân hàng câu hỏi", "Tạo, cập nhật, phát hành và phiên bản hóa câu hỏi; hỗ trợ nhập hàng loạt và quét ảnh bằng AI."],
    ["Soạn đề và sinh đề bằng AI", "Soạn đề thủ công hoặc nhờ AI sinh đề theo cấu trúc, sau đó chỉnh sửa trước khi gửi duyệt."],
    ["Duyệt và phát hành đề thi", "Gửi duyệt, duyệt/trả lại, phát hành đề và lưu lịch sử phê duyệt."],
    ["Học viên làm bài thi", "Làm bài có tự động lưu, tự động nộp theo đồng hồ máy chủ và không tạo bản nộp trùng."],
    ["Xem kết quả và yêu cầu phúc khảo", "Học viên xem kết quả, gửi phúc khảo; giảng viên xử lý, cập nhật điểm và lịch sử khi cần."],
  ]],
  ["2.6", "Bài tập, nộp bài và chấm điểm", [
    ["Tạo và quản lý bài tập", "Tạo, công bố, gia hạn, đóng bài tập kèm rubric và lưu lịch sử chỉnh sửa."],
    ["Học viên nộp bài", "Nộp nội dung và tối đa năm tệp đính kèm; hỗ trợ nộp lại trong thời hạn."],
    ["Chấm bài và sửa điểm", "Chấm theo rubric, công bố điểm, sửa điểm minh bạch và lưu lịch sử thay đổi."],
    ["Nhận gợi ý chấm bài bằng AI", "AI tạo gợi ý theo rubric; chỉ giảng viên được quyết định áp dụng và lưu điểm."],
  ]],
  ["2.7", "Chat, diễn đàn và thông báo", [
    ["Nhắn tin trực tiếp và trong lớp", "Chat riêng/chat lớp thời gian thực, hỗ trợ tệp, trạng thái đã đọc, tìm kiếm, chặn và báo cáo."],
    ["Trao đổi trên diễn đàn", "Tạo chủ đề, đăng/trả lời; hỗ trợ ghim, khóa, ẩn và kiểm duyệt nội dung."],
    ["Nhận và theo dõi thông báo", "Tạo thông báo theo sự kiện, liên kết sâu đến đối tượng liên quan và đồng bộ trạng thái đã đọc."],
  ]],
  ["2.8", "Hỗ trợ", [
    ["Gửi và xử lý phiếu hỗ trợ", "Tạo phiếu kèm tệp, gán SLA, trao đổi, cập nhật tiến độ và đóng phiếu sau khi xác nhận."],
  ]],
  ["2.9", "Công cụ AI có kiểm soát", [
    ["Cấu hình provider và tác vụ AI", "Quản lý API key, provider, model theo từng tác vụ; hỗ trợ kiểm tra kết nối trước khi lưu."],
    ["Hỏi đáp tài liệu và tạo bộ ôn tập", "Hỏi đáp có nguồn trích theo phiên bản tài liệu; tạo, sửa, phát hành hoặc thu hồi tóm tắt và flashcard."],
  ]],
  ["2.10", "Đa ngôn ngữ Việt - Anh", [
    ["Chọn và áp dụng ngôn ngữ hiển thị", "Lưu lựa chọn Việt/Anh và áp dụng nhất quán cho giao diện, định dạng, Accept-Language và thông báo API."],
  ]],
];

// Builds a single compact checklist row for one function in the specification.
function makeTaskRow(sectionCode, index, name, description) {
  return [false, `TASK-${sectionCode.replace(".", "")}-${String(index).padStart(2, "0")}`, name, description, "Chưa phân công", "P1", "Chưa bắt đầu", "Backlog", null, "", "", ""];
}

// Styles and configures a worksheet with the same controls and visual cues as the reference tracker.
function createTaskSheet(sheet, sectionCode, title, tasks) {
  sheet.showGridLines = false;
  sheet.mergeCells("A1:L1");
  sheet.getRange("A1").values = [[`${sectionCode}. ${title.toUpperCase()}`]];
  sheet.getRange("A1:L1").format = { font: { name: fontName, size: 15, bold: true, color: "#1F2937" }, verticalAlignment: "center" };
  sheet.getRange("A1:L1").format.rowHeight = 28;
  sheet.mergeCells("A2:L2");
  sheet.getRange("A2").values = [["Mỗi dòng là một chức năng. Cập nhật trạng thái, phiên bản/commit, thay đổi và lưu ý khi sửa project."]];
  sheet.getRange("A2:L2").format = { font: { name: fontName, size: 9, italic: true, color: "#4B5563" }, verticalAlignment: "center" };

  sheet.getRange("A4:F4").values = [["Tổng task", "", "Hoàn thành", "", "% hoàn thành", ""]];
  sheet.getRange("A4:F4").format = { fill: "#F3F4F6", font: { name: fontName, size: 9, bold: true, color: "#374151" }, horizontalAlignment: "center", verticalAlignment: "center" };
  sheet.getRange("A5:F5").formulas = [[`=COUNTA(B7:B${tasks.length + 6})`, "", `=COUNTIF(G7:G${tasks.length + 6},\"Hoàn thành\")`, "", "=IF(A5=0,0,C5/A5)", ""]];
  sheet.getRange("A5:F5").format = { font: { name: fontName, size: 10, bold: true, color: "#111827" }, horizontalAlignment: "center", verticalAlignment: "center" };
  sheet.getRange("E5").format.numberFormat = "0%";
  sheet.getRange("A4:F5").format.borders = { preset: "all", style: "thin", color: "#D1D5DB" };
  sheet.mergeCells("H4:L5");
  sheet.getRange("H4").values = [["Khi hoàn tất: tích Done?, chọn Hoàn thành, ghi ngày, commit/phiên bản, nội dung sửa và lưu ý còn lại."]];
  sheet.getRange("H4:L5").format = { fill: "#FFF7E6", font: { name: fontName, size: 9, italic: true, color: "#7C4A03" }, wrapText: true, verticalAlignment: "center" };
  sheet.getRange("H4:L5").format.borders = { preset: "outside", style: "thin", color: "#E5C07B" };

  sheet.getRange("A6:L6").values = [headers];
  sheet.getRange(`A7:L${tasks.length + 6}`).values = tasks;
  sheet.getRange("A6:L6").format = { fill: "#333333", font: { name: fontName, size: 9, bold: true, color: "#FFFFFF" }, horizontalAlignment: "center", verticalAlignment: "center", wrapText: true };
  sheet.getRange("A6:L6").format.rowHeight = 31;
  sheet.getRange(`A7:L${tasks.length + 6}`).format = { font: { name: fontName, size: 9, color: "#1E1E1E" }, verticalAlignment: "center", wrapText: true };
  sheet.getRange(`A7:A${tasks.length + 6}`).format = { fill: "#F2F2F4", horizontalAlignment: "center", verticalAlignment: "center" };
  sheet.getRange(`E7:H${tasks.length + 6}`).format = { horizontalAlignment: "center", verticalAlignment: "center" };
  sheet.getRange(`I7:J${tasks.length + 6}`).format = { horizontalAlignment: "center", verticalAlignment: "center" };
  sheet.getRange(`E7:E${tasks.length + 6}`).format.fill = "#F2F2F4";
  sheet.getRange(`F7:F${tasks.length + 6}`).format.fill = "#FFF4D6";
  sheet.getRange(`G7:G${tasks.length + 6}`).format.fill = "#E5F2FF";
  sheet.getRange(`H7:H${tasks.length + 6}`).format.fill = "#F2EAFF";
  sheet.getRange(`I7:I${tasks.length + 6}`).format.fill = "#F2EAFF";
  sheet.getRange(`J7:J${tasks.length + 6}`).format.fill = "#E8F2FF";
  sheet.getRange(`K7:L${tasks.length + 6}`).format.fill = "#FFFDF2";

  sheet.getRange(`E7:E${tasks.length + 6}`).dataValidation = { rule: { type: "list", values: ["Chưa phân công", "Wind Of Fall", "Quản trị hệ thống", "Quản lý trung tâm", "Giảng viên", "Học viên"] } };
  sheet.getRange(`F7:F${tasks.length + 6}`).dataValidation = { rule: { type: "list", values: ["P1", "P2", "P3"] } };
  sheet.getRange(`G7:G${tasks.length + 6}`).dataValidation = { rule: { type: "list", values: ["Chưa bắt đầu", "Đang thực hiện", "Chờ kiểm tra", "Hoàn thành", "Blocked", "Không áp dụng"] } };
  sheet.getRange(`H7:H${tasks.length + 6}`).dataValidation = { rule: { type: "list", values: ["Backlog", "Sprint 1", "Sprint 2", "Sprint 3", "Sprint 4", "Nghiệm thu"] } };
  sheet.getRange(`I7:I${tasks.length + 6}`).format.numberFormat = "dd/mm/yyyy";
  sheet.getRange(`I7:I${tasks.length + 6}`).dataValidation = { rule: { type: "date", operator: "between", formula1: "2020-01-01", formula2: "2100-12-31" } };

  const statuses = sheet.getRange(`G7:G${tasks.length + 6}`);
  statuses.conditionalFormats.add("containsText", { text: "Hoàn thành", format: { fill: "#BCE8C6", font: { color: "#07561E", bold: true } } });
  statuses.conditionalFormats.add("containsText", { text: "Đang thực hiện", format: { fill: "#D9EAF7", font: { color: "#1F4E78", bold: true } } });
  statuses.conditionalFormats.add("containsText", { text: "Chờ kiểm tra", format: { fill: "#FFF2CC", font: { color: "#7F6000", bold: true } } });
  statuses.conditionalFormats.add("containsText", { text: "Blocked", format: { fill: "#F4CCCC", font: { color: "#9C0006", bold: true } } });
  sheet.getRange(`F7:F${tasks.length + 6}`).conditionalFormats.add("containsText", { text: "P1", format: { fill: "#FCE4D6", font: { color: "#C00000", bold: true } } });

  const table = sheet.tables.add(`A6:L${tasks.length + 6}`, true, `Tasks${sectionCode.replace(".", "")}`);
  table.style = "TableStyleMedium2";
  table.showFilterButton = true;
  sheet.freezePanes.freezeRows(6);
  sheet.freezePanes.freezeColumns(3);
  const widths = [9, 17, 34, 57, 19, 10, 18, 14, 15, 19, 36, 37];
  widths.forEach((width, index) => { sheet.getRangeByIndexes(0, index, 1, 1).format.columnWidth = width; });
  sheet.getRange(`A7:L${tasks.length + 6}`).format.rowHeight = 48;
}

// Creates the concise cross-module progress view for the simple function tracker.
function createOverview(workbook, sheetInfo) {
  const sheet = workbook.worksheets.add("Tổng quan");
  sheet.showGridLines = false;
  sheet.mergeCells("A1:H1");
  sheet.getRange("A1").values = [["CHECKTASK - HỆ THỐNG TRUNG TÂM"]];
  sheet.getRange("A1:H1").format = { font: { name: fontName, size: 16, bold: true, color: "#1F2937" }, verticalAlignment: "center" };
  sheet.getRange("A1:H1").format.rowHeight = 30;
  sheet.mergeCells("A2:H2");
  sheet.getRange("A2").values = [["Theo dõi thay đổi project theo từng mục chức năng của tài liệu đặc tả."]];
  sheet.getRange("A2:H2").format = { font: { name: fontName, size: 10, italic: true, color: "#4B5563" }, verticalAlignment: "center" };
  sheet.getRange("A4:F4").values = [["Tổng chức năng", "Hoàn thành", "Đang thực hiện", "Chờ kiểm tra", "Blocked", "% hoàn thành"]];
  sheet.getRange("A4:F4").format = { fill: "#333333", font: { name: fontName, size: 9, bold: true, color: "#FFFFFF" }, horizontalAlignment: "center", verticalAlignment: "center" };
  const endRow = sheetInfo.length + 8;
  sheet.getRange("A5:F5").formulas = [[`=SUM(C9:C${endRow})`, `=SUM(D9:D${endRow})`, `=SUM(E9:E${endRow})`, `=SUM(F9:F${endRow})`, `=SUM(G9:G${endRow})`, "=IF(A5=0,0,B5/A5)"]];
  sheet.getRange("A5:F5").format = { font: { name: fontName, size: 10, bold: true, color: "#111827" }, horizontalAlignment: "center", verticalAlignment: "center" };
  sheet.getRange("F5").format.numberFormat = "0%";
  sheet.getRange("A4:F5").format.borders = { preset: "all", style: "thin", color: "#D1D5DB" };
  sheet.getRange("A7:H7").values = [["STT", "Mục", "Tổng task", "Hoàn thành", "Đang thực hiện", "Chờ kiểm tra", "Blocked", "% hoàn thành"]];
  sheet.getRange("A7:H7").format = { fill: "#4B5563", font: { name: fontName, size: 9, bold: true, color: "#FFFFFF" }, horizontalAlignment: "center", verticalAlignment: "center" };
  const labels = sheetInfo.map((info, index) => [index + 1, info.section]);
  const formulas = sheetInfo.map((info, index) => {
    const end = info.count + 6;
    const row = index + 9;
    return [`=COUNTA('${info.section}'!B7:B${end})`, `=COUNTIF('${info.section}'!G7:G${end},\"Hoàn thành\")`, `=COUNTIF('${info.section}'!G7:G${end},\"Đang thực hiện\")`, `=COUNTIF('${info.section}'!G7:G${end},\"Chờ kiểm tra\")`, `=COUNTIF('${info.section}'!G7:G${end},\"Blocked\")`, `=IF(C${row}=0,0,D${row}/C${row})`];
  });
  sheet.getRange(`A9:B${endRow}`).values = labels;
  // Keeps 2.10 as text instead of Excel coercing it to 2.1.
  sheet.getRange(`B${endRow}`).formulas = [["=\"2.10\""]];
  sheet.getRange(`C9:H${endRow}`).formulas = formulas;
  sheet.getRange(`A9:H${endRow}`).format = { font: { name: fontName, size: 10, color: "#1F2937" }, verticalAlignment: "center" };
  sheet.getRange(`A9:H${endRow}`).format.borders = { preset: "all", style: "thin", color: "#D1D5DB" };
  sheet.getRange(`A9:A${endRow}`).format.horizontalAlignment = "center";
  sheet.getRange(`C9:H${endRow}`).format.horizontalAlignment = "center";
  sheet.getRange(`H9:H${endRow}`).format.numberFormat = "0%";
  sheet.getRange(`H9:H${endRow}`).conditionalFormats.add("colorScale", { colors: ["#F8696B", "#FFEB84", "#63BE7B"], thresholds: ["min", { type: "percentile", value: 50 }, "max"] });
  sheet.getRange(`G9:G${endRow}`).conditionalFormats.add("cellIs", { operator: "greaterThan", formula: 0, format: { fill: "#F4CCCC", font: { color: "#9C0006", bold: true } } });
  sheet.mergeCells(`A${endRow + 3}:H${endRow + 3}`);
  sheet.getRange(`A${endRow + 3}`).values = [["Cách dùng: mở sheet 2.1, 2.2... tương ứng, cập nhật một dòng chức năng sau mỗi lần sửa project. Các chỉ số ở đây tự cộng dồn."]];
  sheet.getRange(`A${endRow + 3}:H${endRow + 3}`).format = { fill: "#FFF7E6", font: { name: fontName, size: 10, italic: true, color: "#7C4A03" }, verticalAlignment: "center" };
  sheet.getRange(`A${endRow + 3}:H${endRow + 3}`).format.rowHeight = 28;
  [7, 38, 15, 15, 18, 17, 12, 17].forEach((width, index) => { sheet.getRangeByIndexes(0, index, 1, 1).format.columnWidth = width; });
  sheet.freezePanes.freezeRows(7);
  return sheet;
}

// Writes, verifies, renders, and exports the revised tracker workbook.
async function buildWorkbook() {
  await fs.mkdir(outputDir, { recursive: true });
  await fs.mkdir(previewDir, { recursive: true });
  const workbook = Workbook.create();
  const overview = workbook.worksheets.add("Tổng quan");
  const sheetInfo = [];
  sections.forEach(([sectionCode, title, functions]) => {
    const sheet = workbook.worksheets.add(sectionCode);
    const tasks = functions.map(([name, description], index) => makeTaskRow(sectionCode, index + 1, name, description));
    createTaskSheet(sheet, sectionCode, title, tasks);
    sheetInfo.push({ section: sectionCode, count: tasks.length });
  });
  createOverview(workbook, sheetInfo).name = "Tổng quan";
  workbook.recalculate();
  const inspection = await workbook.inspect({ kind: "table", range: "Tổng quan!A1:H22", include: "values,formulas", tableMaxRows: 22, tableMaxCols: 8 });
  await fs.writeFile(`${outputDir}/qa_summary_inspection.ndjson`, inspection.ndjson, "utf8");
  const errors = await workbook.inspect({ kind: "match", searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A|#NUM!|#NULL!|#SPILL!|#CALC!", options: { useRegex: true, maxResults: 300 }, summary: "final formula error scan" });
  await fs.writeFile(`${outputDir}/qa_formula_errors.ndjson`, errors.ndjson, "utf8");
  const overviewPreview = await workbook.render({ sheetName: "Tổng quan", range: "A1:H22", scale: 2, format: "png" });
  await fs.writeFile(`${previewDir}/overview.png`, new Uint8Array(await overviewPreview.arrayBuffer()));
  const taskPreview = await workbook.render({ sheetName: "2.5", range: "A1:L12", scale: 1, format: "png" });
  await fs.writeFile(`${previewDir}/module-2-5.png`, new Uint8Array(await taskPreview.arrayBuffer()));
  const output = await SpreadsheetFile.exportXlsx(workbook);
  await output.save(outputPath);
  console.log(JSON.stringify({ outputPath, inspection: inspection.ndjson, errors: errors.ndjson }, null, 2));
}

await buildWorkbook();
