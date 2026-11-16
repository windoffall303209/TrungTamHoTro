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
});
