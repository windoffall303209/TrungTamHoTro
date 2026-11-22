import JSZip from "jszip";

/** Các phần XML chứa chữ hiển thị mà mammoth đọc khi trích văn bản. */
const TEXT_PARTS = ["word/document.xml", "word/footnotes.xml", "word/endnotes.xml"];

/**
 * Xóa mọi run Word được định dạng ẩn (`w:r/w:rPr/w:vanish`) bằng một lượt quét thẻ tuyến tính có ngăn xếp,
 * xử lý đúng cả run lồng trong text box. Ký hiệu ẩn của dấu đoạn (`w:pPr/w:rPr/w:vanish`) không chứa chữ nên được giữ nguyên.
 */
export function removeHiddenRuns(xml: string): string {
  const ranges: Array<[number, number]> = [];
  const stack: Array<{ name: string; start: number; hidden: boolean }> = [];
  let position = 0;
  for (;;) {
    const open = xml.indexOf("<", position);
    if (open < 0) break;
    const close = xml.indexOf(">", open);
    if (close < 0) break;
    position = close + 1;
    const raw = xml.slice(open + 1, close);
    if (raw.startsWith("?") || raw.startsWith("!")) continue;
    if (raw.startsWith("/")) {
      const name = raw.slice(1).trim();
      // XML hợp lệ luôn đóng đúng thẻ trên đỉnh; vẫn rút tới thẻ cùng tên để không lệch ngăn xếp khi gặp XML lỗi.
      while (stack.length) {
        const element = stack.pop()!;
        if (element.name === "w:r" && element.hidden) ranges.push([element.start, position]);
        if (element.name === name) break;
      }
      continue;
    }
    const name = /^[^\s/>]+/.exec(raw)?.[0] ?? "";
    if (name === "w:vanish") {
      const parent = stack.at(-1);
      const run = stack.at(-2);
      const disabled = /\bw:val\s*=\s*["'](?:false|0|off)["']/i.test(raw);
      if (!disabled && parent?.name === "w:rPr" && run?.name === "w:r") run.hidden = true;
    }
    if (!raw.endsWith("/")) stack.push({ name, start: open, hidden: false });
  }
  if (!ranges.length) return xml;
  ranges.sort((left, right) => left[0] - right[0]);
  let output = "";
  let cursor = 0;
  for (const [start, end] of ranges) {
    // Run ẩn lồng trong run ẩn khác đã bị bỏ cùng run ngoài.
    if (start < cursor) continue;
    output += xml.slice(cursor, start);
    cursor = end;
  }
  return output + xml.slice(cursor);
}

/**
 * Trả bản DOCX đã bỏ chữ ẩn để văn bản vô hình (chỉ thị chèn cho AI) không đi vào prompt chấm bài.
 * Bên gọi phải chạy validateDocxArchive trước để chặn bom nén; tệp không có chữ ẩn được trả nguyên buffer.
 */
export async function stripHiddenDocxText(buffer: Buffer): Promise<Buffer> {
  const zip = await JSZip.loadAsync(buffer);
  let changed = false;
  for (const path of TEXT_PARTS) {
    const entry = zip.file(path);
    if (!entry) continue;
    const xml = await entry.async("string");
    if (!xml.includes("w:vanish")) continue;
    const cleaned = removeHiddenRuns(xml);
    if (cleaned === xml) continue;
    zip.file(path, cleaned);
    changed = true;
  }
  return changed ? zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }) : buffer;
}
