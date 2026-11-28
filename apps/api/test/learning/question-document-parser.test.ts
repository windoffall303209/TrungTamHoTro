import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { AiProviderService, type QuestionScanResult } from "../../src/domains/system/ai/ai-provider.service.js";
import { parseQuestionDocument } from "../../src/domains/system/ai/question-document-parser.js";

const first = "Câu 1. Hai cộng hai bằng mấy?\nA. Ba\nB. Bốn";
const second = "Câu 2. Ba cộng hai bằng mấy?\nA. Năm\nB. Sáu";

// Tạo tài liệu Word thực trong bộ nhớ có định dạng run và bảng dữ liệu.
async function docx(body: string): Promise<Buffer> {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  zip.file("_rels/.rels", '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  zip.file("word/document.xml", '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' + body + '</w:body></w:document>');
  return zip.generateAsync({ type: "nodebuffer" });
}

// Tạo một đoạn văn bản run kèm thuộc tính định dạng Word tùy chọn.
function run(text: string, style = ""): string {
  return "<w:r><w:rPr>" + style + '</w:rPr><w:t xml:space="preserve">' + text + "</w:t></w:r>";
}

// Bọc các run thành một đoạn văn bản Word.
function para(runs: string): string { return "<w:p>" + runs + "</w:p>"; }

// Quét tài liệu Word cục bộ qua AiProviderService mà không cần cấu hình provider ngoài.
async function scan(body: string): Promise<QuestionScanResult> {
  return new AiProviderService().scanImage({ buffer: await docx(body), mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", fileName: "de.docx" });
}

describe("nhận diện đáp án từ tài liệu", () => {
  it.each(["Đáp án: B", "Đáp án: Chọn B", "Đáp án:\nB", "Đáp án đúng là B", "Chọn B", "Đáp án: Bốn"])("ghép %s đúng phương án", (line) => {
    expect(parseQuestionDocument(first + "\n" + line)[0]?.correctAnswers).toEqual(["Bốn"]);
  });
  it.each(["<w:b/>", '<w:highlight w:val="yellow"/>', '<w:u w:val="single"/>'])("đọc định dạng Word trên nhãn %s", async (style) => {
    const body = para(run("Câu 1. Hai cộng hai bằng mấy?", "<w:b/>")) + para(run("A. Ba")) + para(run("B.", style) + run(" Bốn"));
    expect((await scan(body)).questions[0]).toMatchObject({ options: ["Ba", "Bốn"], correctAnswers: ["Bốn"], answerSource: "Định dạng phương án" });
  });
  it("ghép bảng Word theo số câu kể cả khi thứ tự bị đảo", async () => {
    const body = (first + "\n" + second).split("\n").map((line) => para(run(line))).join("");
    const table = [["Câu", "2", "1"], ["Đáp án", "A", "B"]].map((row) =>
      "<w:tr>" + row.map((cell) => "<w:tc>" + para(run(cell)) + "</w:tc>").join("") + "</w:tr>").join("");
    expect((await scan(body + "<w:tbl>" + table + "</w:tbl>")).questions.map((q) => q.correctAnswers)).toEqual([["Bốn"], ["Năm"]]);
  });
  it("ghép bảng cuối đề và phát hiện mâu thuẫn", () => {
    const rows = parseQuestionDocument(first.replace("A. Ba", "**A. Ba**") + "\n" + second + "\nĐÁP ÁN: 1-B, 2-A");
    expect(rows[0]).toMatchObject({ correctAnswers: [], warnings: [expect.stringContaining("mâu thuẫn")] });
    expect(rows[1]?.correctAnswers).toEqual(["Năm"]);
  });
  it("phân biệt hai phần cùng đánh số câu và từ chối bảng thiếu tên phần", () => {
    const sectioned = "Phần I\n" + first + "\nPhần II\n" + first + "\nBẢNG ĐÁP ÁN\n";
    const scoped = parseQuestionDocument(sectioned + "Phần I\n1-B\nPhần II\n1-A");
    expect(scoped.map((q) => q.correctAnswers)).toEqual([["Bốn"], ["Ba"]]);
    expect(parseQuestionDocument(sectioned + "1-B").map((q) => q.correctAnswers)).toEqual([[], []]);
  });
  it("không đoán khi mọi nhãn đều đậm hoặc mã đáp án không hợp lệ", () => {
    for (const source of [first.replace("A.", "**A.**").replace("B.", "**B.**"), first + "\nĐáp án: D", first]) {
      expect(parseQuestionDocument(source)[0]).toMatchObject({ correctAnswers: [], confidence: 0.5, warnings: [expect.any(String)] });
    }
  });

  it("đọc chuẩn đề Toán có tiêu đề ĐÁP ÁN TRẮC NGHIỆM và bảng đáp án dọc 3 cột (Câu hỏi | Đáp án đúng | Kết quả)", async () => {
    const body = [
      para(run("Câu 1. ", "<w:b/>") + run("12 + 8 = ?")),
      para(run("A. 18")),
      para(run("B. 20")),
      para(run("C. 22")),
      para(run("D. 19")),
      para(run("Câu 2. ", "<w:b/>") + run("35 - 9 = ?")),
      para(run("A. 24")),
      para(run("B. 25")),
      para(run("C. 26")),
      para(run("D. 27")),
      para(run("Câu 3. ", "<w:b/>") + run("6 x 7 = ?")),
      para(run("A. 42")),
      para(run("B. 36")),
      para(run("C. 48")),
      para(run("D. 40")),
      para(run("Câu 4. ", "<w:b/>") + run("Một hình chữ nhật có chiều dài 8 cm và chiều rộng 5 cm. Chu vi là bao nhiêu?")),
      para(run("A. 20 cm")),
      para(run("B. 24 cm")),
      para(run("C. 28 cm")),
      para(run("D. 26 cm")),
      para(run("Trang")),
      para(run("ĐÁP ÁN TRẮC NGHIỆM", "<w:b/>")),
      para(run("Mỗi câu trả lời đúng được 2,5 điểm. Tổng điểm: 10 điểm.")),
      "<w:tbl>" +
        [
          ["Câu hỏi", "Đáp án đúng", "Kết quả"],
          ["1", "B", "20"],
          ["2", "C", "26"],
          ["3", "A", "42"],
          ["4", "D", "26 cm"],
        ]
          .map((row) => "<w:tr>" + row.map((cell) => "<w:tc>" + para(run(cell)) + "</w:tc>").join("") + "</w:tr>")
          .join("") +
        "</w:tbl>",
      para(run("Giải thích câu 4: (8 + 5) x 2 = 26 cm.")),
    ].join("");

    const result = await scan(body);
    expect(result.questions).toHaveLength(4);
    expect(result.questions.map((q) => q.correctAnswers)).toEqual([["20"], ["26"], ["42"], ["26 cm"]]);
    expect(result.questions.every((q) => q.warnings.length === 0)).toBe(true);
  });

  it("tách đúng phương án nằm trong bảng 2x2 hoặc sát nhau trên cùng dòng và ghép bảng ĐÁP ÁN ngang cuối đề", async () => {
    /** Tạo bảng Word 2x2 chứa 4 phương án A, B, C, D giống mẫu đề tiểu học/THCS. */
    const optionGrid = (a: string, b: string, c: string, d: string): string =>
      "<w:tbl>" +
      [
        [a, b],
        [c, d],
      ]
        .map((row) => "<w:tr>" + row.map((cell) => "<w:tc>" + para(run(cell)) + "</w:tc>").join("") + "</w:tr>")
        .join("") +
      "</w:tbl>";

    const body = [
      para(run("Khoanh tròn vào chữ cái trước đáp án đúng.", "<w:b/>")),
      para(run("Câu 1. Kết quả của phép tính 3 475 + 2 618 là:", "<w:b/>")),
      optionGrid("A. 6 083", "B. 6 093", "C. 6 193", "D. 5 093"),
      para(run("Câu 2. Kết quả của phép chia 864 : 8 là:", "<w:b/>")),
      para(run("A. 108   B. 118")),
      para(run("C. 106D. 98")),
      para(run("ĐÁP ÁN", "<w:b/>")),
      "<w:tbl><w:tr>" +
        ["1. B", "2. A"].map((cell) => "<w:tc>" + para(run(cell, "<w:b/>")) + "</w:tc>").join("") +
        "</w:tr></w:tbl>",
      para(run("Chúc em làm bài tốt!")),
    ].join("");

    const result = await scan(body);
    expect(result.questions).toHaveLength(2);
    expect(result.questions[0]).toMatchObject({
      options: ["6 083", "6 093", "6 193", "5 093"],
      correctAnswers: ["6 093"],
      warnings: [],
    });
    expect(result.questions[1]).toMatchObject({
      options: ["108", "118", "106", "98"],
      correctAnswers: ["108"],
      warnings: [],
    });
  });

  it("khôi phục danh sách đánh số tự động (w:numPr) và nhận diện đáp án tô màu đỏ trong Word", async () => {
    const zip = new JSZip();
    zip.file(
      "[Content_Types].xml",
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/></Types>',
    );
    zip.file(
      "_rels/.rels",
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    );
    zip.file(
      "word/numbering.xml",
      '<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
        '<w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="Câu %1."/></w:lvl><w:lvl w:ilvl="1"><w:start w:val="1"/><w:numFmt w:val="upperLetter"/><w:lvlText w:val="%1."/></w:lvl></w:abstractNum>' +
        '<w:num w:numId="1"><w:abstractNumId w:val="1"/></w:num></w:numbering>',
    );
    const docBody =
      '<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr>' + run("Thủ đô của Việt Nam là gì?") + "</w:p>" +
      '<w:p><w:pPr><w:numPr><w:ilvl w:val="1"/><w:numId w:val="1"/></w:numPr></w:pPr>' + run("Đà Nẵng") + "</w:p>" +
      '<w:p><w:pPr><w:numPr><w:ilvl w:val="1"/><w:numId w:val="1"/></w:numPr></w:pPr>' + run("Hà Nội", '<w:color w:val="FF0000"/>') + "</w:p>";
    zip.file(
      "word/document.xml",
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' + docBody + "</w:body></w:document>",
    );

    const buffer = await zip.generateAsync({ type: "nodebuffer" });
    const scanned = await new AiProviderService().scanImage({
      buffer,
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      fileName: "auto-list.docx",
    });
    expect(scanned.questions).toHaveLength(1);
    expect(scanned.questions[0]).toMatchObject({
      content: "Thủ đô của Việt Nam là gì?",
      options: ["Đà Nẵng", "Hà Nội"],
      correctAnswers: ["Hà Nội"],
      warnings: [],
    });
  });
});
