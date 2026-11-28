import JSZip from "jszip";
import { BadRequestException } from "@nestjs/common";
import type { ScannedQuestionDraft } from "./ai-provider.service.js";
import { removeHiddenRuns } from "../../../infrastructure/docx-hidden-text.js";
import { validateDocxArchive } from "../../../infrastructure/validate-docx-archive.js";

interface Option {
  key: string;
  text: string;
  labelMarked: boolean;
  bodyMarked: boolean;
}

interface Question {
  number: string;
  section: string;
  content: string;
  options: Option[];
  answers: string[];
}

interface NumberingLevel {
  numFmt: string;
  lvlText: string;
  start: number;
}

interface XmlElement {
  name: string;
  attrs: Record<string, string>;
  children: Array<XmlElement | string>;
}

const ANSWER_PAIR_SEPARATORS = new Set(["-", ".", ":", ")", "=", "–", "/"]);

// Giải mã các thực thể XML chuẩn trong văn bản OOXML của Word.
function decodeXmlEntities(raw: string): string {
  return raw
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number.parseInt(dec, 10)))
    .replace(/&amp;/g, "&");
}

// Tách danh sách thuộc tính trong thẻ mở XML thành bảng khóa - giá trị.
function parseXmlAttributes(rawAttrs: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const attrRegex = /([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  for (const match of rawAttrs.matchAll(attrRegex)) {
    const key = match[1];
    const val = match[2] ?? match[3] ?? "";
    if (key) attrs[key] = decodeXmlEntities(val);
  }
  return attrs;
}

// Phân tích chuỗi XML thành cây phần tử gọn nhẹ bằng một lượt quét tuyến tính không đệ quy sâu.
function parseXmlTree(xml: string): XmlElement {
  const root: XmlElement = { name: "root", attrs: {}, children: [] };
  const stack: XmlElement[] = [root];
  let cursor = 0;

  while (cursor < xml.length) {
    const open = xml.indexOf("<", cursor);
    if (open < 0) {
      const tail = xml.slice(cursor);
      if (tail) stack[stack.length - 1]!.children.push(decodeXmlEntities(tail));
      break;
    }
    if (open > cursor) {
      stack[stack.length - 1]!.children.push(decodeXmlEntities(xml.slice(cursor, open)));
    }
    if (xml.startsWith("<!--", open)) {
      const endComment = xml.indexOf("-->", open + 4);
      cursor = endComment < 0 ? xml.length : endComment + 3;
      continue;
    }
    if (xml.startsWith("<![CDATA[", open)) {
      const endCdata = xml.indexOf("]]>", open + 9);
      const content = endCdata < 0 ? xml.slice(open + 9) : xml.slice(open + 9, endCdata);
      stack[stack.length - 1]!.children.push(content);
      cursor = endCdata < 0 ? xml.length : endCdata + 3;
      continue;
    }
    const close = xml.indexOf(">", open + 1);
    if (close < 0) break;
    cursor = close + 1;

    const inside = xml.slice(open + 1, close).trim();
    if (!inside || inside.startsWith("?") || inside.startsWith("!")) continue;
    if (inside.startsWith("/")) {
      const closeName = inside.slice(1).trim();
      for (let idx = stack.length - 1; idx > 0; idx -= 1) {
        if (stack[idx]!.name === closeName) {
          stack.length = idx;
          break;
        }
      }
      continue;
    }

    const selfClosing = inside.endsWith("/");
    const tagBody = selfClosing ? inside.slice(0, -1).trim() : inside;
    const spaceIdx = tagBody.search(/\s/);
    const name = spaceIdx < 0 ? tagBody : tagBody.slice(0, spaceIdx);
    const rawAttrs = spaceIdx < 0 ? "" : tagBody.slice(spaceIdx + 1);
    const element: XmlElement = { name, attrs: parseXmlAttributes(rawAttrs), children: [] };
    stack[stack.length - 1]!.children.push(element);
    if (!selfClosing) stack.push(element);
  }

  return root;
}

// Tìm phần tử con đầu tiên khớp tên thẻ trong một nút XML.
function findChild(node: XmlElement, name: string): XmlElement | undefined {
  for (const child of node.children) {
    if (typeof child !== "string" && child.name === name) return child;
  }
  return undefined;
}

// Tìm toàn bộ phần tử con trực tiếp khớp tên thẻ trong một nút XML.
function findChildren(node: XmlElement, name: string): XmlElement[] {
  const list: XmlElement[] = [];
  for (const child of node.children) {
    if (typeof child !== "string" && child.name === name) list.push(child);
  }
  return list;
}

// Chuyển số nguyên dương sang chữ số La Mã phục vụ đánh số Phần/Mục tự động.
function toRoman(num: number): string {
  const table: ReadonlyArray<readonly [number, string]> = [
    [1000, "M"], [900, "CM"], [500, "D"], [400, "CD"],
    [100, "C"], [90, "XC"], [50, "L"], [40, "XL"],
    [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"],
  ];
  let remain = Math.max(1, Math.min(3999, num));
  let out = "";
  for (const [value, symbol] of table) {
    while (remain >= value) {
      out += symbol;
      remain -= value;
    }
  }
  return out;
}

// Định dạng giá trị bộ đếm danh sách tự động của Word theo kiểu số, chữ cái hoặc La Mã.
function formatListCounter(value: number, numFmt: string): string {
  if (numFmt === "upperLetter") {
    const code = ((Math.max(1, value) - 1) % 26) + 65;
    return String.fromCharCode(code);
  }
  if (numFmt === "lowerLetter") {
    const code = ((Math.max(1, value) - 1) % 26) + 97;
    return String.fromCharCode(code);
  }
  if (numFmt === "upperRoman") return toRoman(value);
  if (numFmt === "lowerRoman") return toRoman(value).toLowerCase();
  return String(value);
}

// Đọc bảng định nghĩa đánh số tự động từ word/numbering.xml để khôi phục nhãn Câu 1., A., B., C., D.
function parseDocxNumbering(numberingXml: string | undefined): Map<string, Map<number, NumberingLevel>> {
  const numMap = new Map<string, Map<number, NumberingLevel>>();
  if (!numberingXml) return numMap;
  const tree = parseXmlTree(numberingXml);
  const root = findChild(tree, "w:numbering") ?? tree;
  const abstractMap = new Map<string, Map<number, NumberingLevel>>();

  for (const abs of findChildren(root, "w:abstractNum")) {
    const absId = abs.attrs["w:abstractNumId"];
    if (!absId) continue;
    const levels = new Map<number, NumberingLevel>();
    for (const lvl of findChildren(abs, "w:lvl")) {
      const ilvl = Number.parseInt(lvl.attrs["w:ilvl"] ?? "0", 10);
      const numFmt = findChild(lvl, "w:numFmt")?.attrs["w:val"] ?? "decimal";
      const lvlText = findChild(lvl, "w:lvlText")?.attrs["w:val"] ?? "%1.";
      const start = Number.parseInt(findChild(lvl, "w:start")?.attrs["w:val"] ?? "1", 10);
      levels.set(Number.isFinite(ilvl) ? ilvl : 0, {
        numFmt,
        lvlText,
        start: Number.isFinite(start) ? start : 1,
      });
    }
    abstractMap.set(absId, levels);
  }

  for (const num of findChildren(root, "w:num")) {
    const numId = num.attrs["w:numId"];
    const absId = findChild(num, "w:abstractNumId")?.attrs["w:val"];
    if (!numId || !absId) continue;
    const base = abstractMap.get(absId);
    const cloned = new Map<number, NumberingLevel>();
    if (base) {
      for (const [k, v] of base.entries()) cloned.set(k, { ...v });
    }
    for (const override of findChildren(num, "w:lvlOverride")) {
      const ilvl = Number.parseInt(override.attrs["w:ilvl"] ?? "0", 10);
      const startOverride = findChild(override, "w:startOverride")?.attrs["w:val"];
      const lvlNode = findChild(override, "w:lvl");
      if (lvlNode) {
        const numFmt = findChild(lvlNode, "w:numFmt")?.attrs["w:val"] ?? cloned.get(ilvl)?.numFmt ?? "decimal";
        const lvlText = findChild(lvlNode, "w:lvlText")?.attrs["w:val"] ?? cloned.get(ilvl)?.lvlText ?? "%1.";
        const start = Number.parseInt(findChild(lvlNode, "w:start")?.attrs["w:val"] ?? "1", 10);
        cloned.set(ilvl, { numFmt, lvlText, start: Number.isFinite(start) ? start : 1 });
      } else if (startOverride && cloned.has(ilvl)) {
        const parsedStart = Number.parseInt(startOverride, 10);
        if (Number.isFinite(parsedStart)) cloned.get(ilvl)!.start = parsedStart;
      }
    }
    numMap.set(numId, cloned);
  }

  return numMap;
}

// Nhận diện màu chữ nổi bật (đỏ, cam đậm, lục đậm) thường được giáo viên dùng để đánh dấu đáp án đúng trong Word.
function isDistinctiveAnswerColor(hexRaw: string | undefined): boolean {
  if (!hexRaw) return false;
  const hex = hexRaw.trim().replace(/^#/, "").toUpperCase();
  if (!/^[0-9A-F]{6}$/.test(hex)) return false;
  const r = Number.parseInt(hex.slice(0, 2), 16);
  const g = Number.parseInt(hex.slice(2, 4), 16);
  const b = Number.parseInt(hex.slice(4, 6), 16);
  // Nhóm màu đỏ / đỏ sẫm / cam đỏ (ví dụ FF0000, C00000, EE0000, E3242B, DC2626)
  if (r >= 170 && g <= 95 && b <= 95 && r - Math.max(g, b) >= 90) return true;
  // Nhóm màu xanh lá đánh dấu đáp án (ví dụ 00B050, 008000, 16A34A)
  if (g >= 125 && r <= 70 && b <= 95 && g - r >= 65) return true;
  return false;
}

// Kiểm tra thuộc tính bật/tắt kiểu boolean trong OOXML (mặc định bật khi thẻ xuất hiện không kèm val="false"/"0"/"none").
function isEnabledWordToggle(el: XmlElement | undefined): boolean {
  if (!el) return false;
  const val = (el.attrs["w:val"] ?? "").trim().toLowerCase();
  return val !== "false" && val !== "0" && val !== "off" && val !== "none";
}

// Chuyển biểu thức toán học OMML (<m:oMath>) trong Word sang chuỗi LaTeX/văn bản để không mất phân số, số mũ hoặc căn thức.
function renderOmmlNode(node: XmlElement | string): string {
  if (typeof node === "string") return node;
  if (node.name === "m:t" || node.name === "w:t") {
    return node.children.map(renderOmmlNode).join("");
  }
  if (node.name === "m:f") {
    const num = findChild(node, "m:num");
    const den = findChild(node, "m:den");
    const numText = num ? num.children.map(renderOmmlNode).join("").trim() : "";
    const denText = den ? den.children.map(renderOmmlNode).join("").trim() : "";
    return `\\frac{${numText}}{${denText}}`;
  }
  if (node.name === "m:sSup") {
    const base = findChild(node, "m:e");
    const sup = findChild(node, "m:sup");
    return `${base ? base.children.map(renderOmmlNode).join("").trim() : ""}^{${sup ? sup.children.map(renderOmmlNode).join("").trim() : ""}}`;
  }
  if (node.name === "m:sSub") {
    const base = findChild(node, "m:e");
    const sub = findChild(node, "m:sub");
    return `${base ? base.children.map(renderOmmlNode).join("").trim() : ""}_{${sub ? sub.children.map(renderOmmlNode).join("").trim() : ""}}`;
  }
  if (node.name === "m:rad") {
    const deg = findChild(node, "m:deg");
    const base = findChild(node, "m:e");
    const degText = deg ? deg.children.map(renderOmmlNode).join("").trim() : "";
    const baseText = base ? base.children.map(renderOmmlNode).join("").trim() : "";
    return degText ? `\\sqrt[${degText}]{${baseText}}` : `\\sqrt{${baseText}}`;
  }
  if (node.name === "m:oMath") {
    const body = node.children.map(renderOmmlNode).join("").trim();
    if (!body) return "";
    return /\\frac|\\sqrt|\^\{|_\{/.test(body) ? `$${body}$` : body;
  }
  return node.children.map(renderOmmlNode).join("");
}

// Kết xuất văn bản của một run Word, bảo toàn đánh dấu đậm, gạch chân, tô sáng hoặc tô màu đỏ đáp án.
function renderWordRun(runNode: XmlElement): string {
  const rPr = findChild(runNode, "w:rPr");
  const isBold = isEnabledWordToggle(rPr ? findChild(rPr, "w:b") : undefined);
  const isUnderline = isEnabledWordToggle(rPr ? findChild(rPr, "w:u") : undefined);
  const isHighlight = isEnabledWordToggle(rPr ? findChild(rPr, "w:highlight") : undefined);
  const shdFill = rPr ? findChild(rPr, "w:shd")?.attrs["w:fill"]?.toUpperCase() : undefined;
  const hasShading = Boolean(shdFill && shdFill !== "AUTO" && shdFill !== "FFFFFF" && shdFill !== "000000");
  const colorVal = rPr ? findChild(rPr, "w:color")?.attrs["w:val"] : undefined;
  const hasAnswerColor = isDistinctiveAnswerColor(colorVal);

  let value = "";
  for (const child of runNode.children) {
    if (typeof child === "string") continue;
    if (child.name === "w:rPr") continue;
    if (child.name === "w:t") {
      value += child.children.map((c) => (typeof c === "string" ? c : "")).join("");
    } else if (child.name === "w:tab") {
      value += "\t";
    } else if (child.name === "w:br" || child.name === "w:cr") {
      value += "\n";
    } else if (child.name.startsWith("m:")) {
      value += renderOmmlNode(child);
    } else {
      value += renderWordBlockChildren(child);
    }
  }

  if (value.trim() && (isBold || isUnderline || isHighlight || hasShading || hasAnswerColor)) {
    return `**${value}**`;
  }
  return value;
}

// Duyệt đệ quy các phần tử nội dòng khác trong đoạn văn Word (như hyperlink, smartTag, oMath).
function renderWordBlockChildren(node: XmlElement): string {
  let out = "";
  for (const child of node.children) {
    if (typeof child === "string") continue;
    if (child.name === "w:pPr" || child.name === "w:tblPr" || child.name === "w:tblGrid" || child.name === "w:tcPr" || child.name === "w:trPr") {
      continue;
    }
    if (child.name === "w:r") {
      out += renderWordRun(child);
    } else if (child.name === "w:tab") {
      out += "\t";
    } else if (child.name === "w:br" || child.name === "w:cr") {
      out += "\n";
    } else if (child.name.startsWith("m:")) {
      out += renderOmmlNode(child);
    } else {
      out += renderWordBlockChildren(child);
    }
  }
  return out;
}

/** Trích xuất văn bản có cấu trúc từ DOCX, khôi phục danh sách đánh số tự động, bảng phương án 2x2, màu đáp án và công thức toán. */
export async function readQuestionDocx(buffer: Buffer): Promise<string> {
  await validateDocxArchive(buffer);
  try {
    const zip = await JSZip.loadAsync(buffer);
    const docEntry = zip.file("word/document.xml");
    if (!docEntry) {
      throw new Error("Missing word/document.xml");
    }
    const rawDocXml = await docEntry.async("string");
    const cleanDocXml = rawDocXml.includes("w:vanish") ? removeHiddenRuns(rawDocXml) : rawDocXml;
    const numberingXml = await zip.file("word/numbering.xml")?.async("string");
    const numberingMap = parseDocxNumbering(numberingXml);
    const counters = new Map<string, number>();

    // Sinh tiền tố đánh số tự động (ví dụ "1. ", "Câu 1. ", "A. ") cho đoạn văn có gắn w:numPr.
    const nextListPrefix = (pPr: XmlElement | undefined): string => {
      if (!pPr) return "";
      const numPr = findChild(pPr, "w:numPr");
      if (!numPr) return "";
      const numId = findChild(numPr, "w:numId")?.attrs["w:val"];
      if (!numId || numId === "0") return "";
      const ilvlRaw = Number.parseInt(findChild(numPr, "w:ilvl")?.attrs["w:val"] ?? "0", 10);
      const ilvl = Number.isFinite(ilvlRaw) ? ilvlRaw : 0;
      const levels = numberingMap.get(numId);
      const levelDef = levels?.get(ilvl) ?? {
        numFmt: ilvl === 0 ? "decimal" : "upperLetter",
        lvlText: "%1.",
        start: 1,
      };
      if (levelDef.numFmt === "bullet" || levelDef.numFmt === "none") return "";

      // Xóa các cấp con sâu hơn khi cấp cha tăng giá trị.
      for (const existingKey of [...counters.keys()]) {
        const [kNumId, kLvl] = existingKey.split(":");
        if (kNumId === numId && Number.parseInt(kLvl ?? "0", 10) > ilvl) {
          counters.delete(existingKey);
        }
      }
      const counterKey = `${numId}:${ilvl}`;
      const nextVal = counters.has(counterKey) ? counters.get(counterKey)! + 1 : levelDef.start;
      counters.set(counterKey, nextVal);

      let formatted = levelDef.lvlText || `%${ilvl + 1}.`;
      if (ilvl > 0 && !formatted.includes(`%${ilvl + 1}`)) {
        formatted = formatted.replace("%1", formatListCounter(nextVal, levelDef.numFmt));
      } else {
        for (let lvlIdx = 0; lvlIdx <= ilvl; lvlIdx += 1) {
          const subDef =
            levels?.get(lvlIdx) ??
            (lvlIdx === 0 ? { numFmt: "decimal", start: 1 } : { numFmt: "upperLetter", start: 1 });
          const subVal = counters.get(`${numId}:${lvlIdx}`) ?? subDef.start;
          formatted = formatted.replace(`%${lvlIdx + 1}`, formatListCounter(subVal, subDef.numFmt));
        }
      }
      if (!/[.:)\-\s]$/.test(formatted)) formatted += ".";
      return `${formatted.trim()} `;
    };

    // Kết xuất một đoạn văn <w:p> kèm tiền tố đánh số tự động nếu có.
    const renderParagraph = (pNode: XmlElement): string => {
      const pPr = findChild(pNode, "w:pPr");
      const prefix = nextListPrefix(pPr);
      const body = renderWordBlockChildren(pNode);
      if (!body.trim()) return "";
      const plainBody = body.replace(/\*\*/g, "").trimStart();
      if (prefix && !/^(?:(?:câu|bài|question)\s*\d+|[A-F][.):])/iu.test(plainBody)) {
        return `${prefix}${body.trimStart()}`;
      }
      return body;
    };

    // Kết xuất bảng <w:tbl>: giữ phân cách tab giữa các ô trên cùng một hàng để nhận diện cả bảng phương án 2x2 lẫn bảng đáp án.
    const renderTable = (tblNode: XmlElement): string => {
      const rows: string[] = [];
      for (const tr of findChildren(tblNode, "w:tr")) {
        const cellTexts: string[] = [];
        for (const tc of findChildren(tr, "w:tc")) {
          const cellLines: string[] = [];
          for (const child of tc.children) {
            if (typeof child === "string") continue;
            if (child.name === "w:p") {
              const pText = renderParagraph(child).trim();
              if (pText) cellLines.push(pText);
            } else if (child.name === "w:tbl") {
              const nested = renderTable(child).trim();
              if (nested) cellLines.push(nested);
            }
          }
          // Nếu một ô chứa nhiều đoạn văn độc lập (ví dụ mỗi đoạn là một phương án), nối bằng tab để tách riêng từng mục.
          cellTexts.push(cellLines.join("\t").trim());
        }
        if (cellTexts.some(Boolean)) {
          rows.push(cellTexts.join("\t"));
        }
      }
      return rows.length ? `${rows.join("\n")}\n` : "";
    };

    const docTree = parseXmlTree(cleanDocXml);
    const docNode = findChild(docTree, "w:document") ?? docTree;
    const bodyNode = findChild(docNode, "w:body") ?? docNode;
    let output = "";
    for (const child of bodyNode.children) {
      if (typeof child === "string") continue;
      if (child.name === "w:p") {
        const line = renderParagraph(child);
        if (line) output += `${line}\n`;
      } else if (child.name === "w:tbl") {
        output += renderTable(child);
      } else if (child.name === "w:sdt") {
        const sdtContent = findChild(child, "w:sdtContent");
        if (sdtContent) {
          for (const inner of sdtContent.children) {
            if (typeof inner === "string") continue;
            if (inner.name === "w:p") {
              const line = renderParagraph(inner);
              if (line) output += `${line}\n`;
            } else if (inner.name === "w:tbl") {
              output += renderTable(inner);
            }
          }
        }
      }
    }
    return output;
  } catch {
    throw new BadRequestException("Không đọc được nội dung Word. Hãy kiểm tra tệp DOCX hoặc chuyển sang PDF.");
  }
}

/** So khớp văn bản phương án chính xác trước khi suy diễn ký tự đáp án A..F. */
export function answerKey(value: string, options: { key: string; text: string }[]): string | undefined {
  const rawTrimmed = value.trim().replace(/\*\*/gu, "");
  const clean = rawTrimmed.replace(/[.;]+$/u, "").trim();
  const exact = options.filter((option) => option.text.toLocaleLowerCase() === clean.toLocaleLowerCase());
  if (exact.length === 1) return exact[0]!.key;
  const match = clean.match(/^(?:(?:chọn|choose|phương\s*án|đáp\s*án(?:\s*đúng)?|answer|kết\s*quả)(?:\s+là)?[\s:.-]*)*([A-F])(?:[.):\s-].*)?$/iu);
  return options.find((option) => option.key === match?.[1]?.toUpperCase())?.key;
}

/** Khoảng trắng theo định nghĩa \s của JavaScript cho một ký tự. */
function isSpace(char: string | undefined): boolean {
  return char !== undefined && /\s/u.test(char);
}

/** Ký tự phân cách giữa các cặp đáp án: dấu phẩy, chấm phẩy, gạch đứng hoặc khoảng trắng. */
function isPairBoundary(char: string | undefined): boolean {
  return char === "," || char === ";" || char === "|" || isSpace(char);
}

/**
 * Tách các cặp "số câu – ký tự đáp án" (vd. `1-A, 2.B; câu 3: C`, `4 D`, `1B` khi đang đọc bảng đáp án)
 * bằng một lượt duyệt tuyến tính không quay lui.
 */
export function answerKeyPairs(line: string, allowCompact = false): Array<{ number: string; key: string }> {
  const chars = [...line];
  const pairs: Array<{ number: string; key: string }> = [];
  let index = 0;
  while (index < chars.length) {
    if (isPairBoundary(chars[index]) || (index > 0 && !isPairBoundary(chars[index - 1]))) {
      index += 1;
      continue;
    }
    let cursor = index;
    const word3 = chars.slice(cursor, cursor + 3).join("").toLocaleLowerCase("vi");
    if (word3 === "câu" || (allowCompact && word3 === "bài")) {
      cursor += 3;
      while (isSpace(chars[cursor])) cursor += 1;
    }
    const numberStart = cursor;
    while (cursor < chars.length && chars[cursor]! >= "0" && chars[cursor]! <= "9") cursor += 1;
    const number = chars.slice(numberStart, cursor).join("");
    let spaced = false;
    while (isSpace(chars[cursor])) {
      cursor += 1;
      spaced = true;
    }
    let separated = spaced || allowCompact;
    const sepChar = chars[cursor] ?? "";
    if (ANSWER_PAIR_SEPARATORS.has(sepChar) && (allowCompact || sepChar !== "/")) {
      cursor += 1;
      separated = true;
      while (isSpace(chars[cursor])) cursor += 1;
    }
    const key = chars[cursor] ?? "";
    let endCursor = cursor + 1;
    if (allowCompact && chars[endCursor] === ".") endCursor += 1;
    if (number && separated && /^[A-F]$/iu.test(key) && (endCursor === chars.length || isPairBoundary(chars[endCursor]))) {
      pairs.push({ number, key });
      index = endCursor;
      continue;
    }
    index += 1;
  }
  return pairs;
}

// Tạo đối tượng phương án từ một đoạn văn bản có định dạng nhấn mạnh (**...**).
function buildOptionFromSegment(formattedSegment: string): Option | undefined {
  const trimmed = formattedSegment.trim();
  if (!trimmed) return undefined;
  const plain = trimmed.replace(/\*\*/gu, "").trim();
  const match = plain.match(/^([A-F])[.:)]\s*(.+)$/iu);
  if (!match) return undefined;
  const key = match[1]!.toUpperCase();
  const text = match[2]!.trim();
  if (!text) return undefined;
  const marked = [...trimmed.matchAll(/\*\*(.+?)\*\*/gu)]
    .map((m) => m[1]!.trim())
    .join("")
    .replace(/\s/gu, "");
  const bodyNoSpace = text.replace(/\s/gu, "");
  const fullNoSpace = plain.replace(/\s/gu, "");
  const labelMarked = /^\*\*\s*[A-F]\s*(?:[.):]|\*\*)/iu.test(trimmed);
  const bodyMarked = Boolean(marked) && (marked === bodyNoSpace || marked === fullNoSpace);
  return { key, text, labelMarked, bodyMarked };
}

// Tách một dòng hoặc hàng bảng chứa 1..6 phương án (A., B., C., D.) nằm cùng dòng hoặc nối sát sau chữ số.
function extractOptionsFromFormattedLine(formattedLine: string): Option[] {
  const tabCells = formattedLine.split("\t").map((cell) => cell.trim()).filter(Boolean);
  const subSegments: string[] = [];

  for (const cell of tabCells) {
    // Tìm các vị trí bắt đầu nhãn phương án A..F có dấu chấm/ngoặc/hai chấm trên cùng một ô.
    const PlainProbe = cell.replace(/\*\*/gu, "  ");
    const markerRegex = /(?:^|\s{2,}|\s+(?=(?:\s*)[B-F][.:)]\s)|(?<=[0-9a-zA-ZÀ-ỹ)\]}])(?=(?:\s*)[B-F][.:)]\s))/gu;
    const starts: Array<{ index: number; letterCode: number }> = [];

    const firstMatch = PlainProbe.match(/^\s*([A-F])[.:)]\s*/iu);
    if (!firstMatch) {
      return [];
    }
    starts.push({ index: 0, letterCode: firstMatch[1]!.toUpperCase().charCodeAt(0) });

    for (const match of PlainProbe.matchAll(markerRegex)) {
      const idx = (match.index ?? 0) + match[0].length;
      if (idx <= 0 || idx >= PlainProbe.length) continue;
      const after = PlainProbe.slice(idx);
      const letterMatch = after.match(/^\s*([B-F])[.:)]\s+\S/iu) ?? after.match(/^\s*([B-F])[.:)]\S/iu);
      if (!letterMatch) continue;
      const code = letterMatch[1]!.toUpperCase().charCodeAt(0);
      const prevCode = starts[starts.length - 1]!.letterCode;
      // Chỉ tách khi chữ cái phương án tăng dần hợp lệ (ví dụ A -> B, C -> D, A -> B -> C -> D).
      if (code > prevCode && code <= 70) {
        let cutIdx = idx;
        while (cutIdx > 0 && cell.slice(Math.max(0, cutIdx - 2), cutIdx) === "**") {
          cutIdx -= 2;
        }
        starts.push({ index: cutIdx, letterCode: code });
      }
    }

    for (let i = 0; i < starts.length; i += 1) {
      const start = starts[i]!.index;
      const end = i + 1 < starts.length ? starts[i + 1]!.index : cell.length;
      const piece = cell.slice(start, end).trim();
      if (piece) subSegments.push(piece);
    }
  }

  const parsed: Option[] = [];
  for (const seg of subSegments) {
    const opt = buildOptionFromSegment(seg);
    if (!opt) return [];
    parsed.push(opt);
  }
  return parsed;
}

// Tách phần phương án A., B., C., D. nếu giáo viên gõ nối tiếp ngay trên cùng dòng với nội dung câu hỏi.
function splitTrailingOptionsFromStem(formattedStem: string): { stem: string; options: Option[] } {
  const plain = formattedStem.replace(/\*\*/gu, "  ");
  const idxMatch = plain.match(/\s+(?=A[.:)]\s+\S)/u);
  if (!idxMatch || idxMatch.index === undefined) {
    return { stem: formattedStem.replace(/\*\*/gu, "").trim(), options: [] };
  }
  let cut = idxMatch.index;
  while (cut > 0 && formattedStem.slice(Math.max(0, cut - 2), cut) === "**") {
    cut -= 2;
  }
  const candidateOptions = extractOptionsFromFormattedLine(formattedStem.slice(cut).trim());
  if (candidateOptions.length >= 2 && candidateOptions[0]?.key === "A") {
    return {
      stem: formattedStem.slice(0, idxMatch.index).replace(/\*\*/gu, "").trim(),
      options: candidateOptions,
    };
  }
  return { stem: formattedStem.replace(/\*\*/gu, "").trim(), options: [] };
}

// Nhận diện dòng tiêu đề mở đầu khu vực Bảng Đáp Án / Hướng Dẫn Chấm ở cuối đề thi.
function isAnswerSectionHeading(line: string): boolean {
  const clean = line.trim();
  if (/^(?:[IVXLCDM]+\s*[.:-]\s*)?(?:bảng\s+|phần\s+)?(?:đáp\s*án|hướng\s*dẫn\s*chấm|answer\s*key)(?:\s+(?:trắc\s*nghiệm|tự\s*luận|và\s+hướng\s*dẫn(?:\s*chấm|\s*giải)?|và\s+thang\s*điểm|-\s*thang\s*điểm|-\s*biểu\s*điểm|đề\s*thi|bài\s*kiểm\s*tra|chi\s*tiết))+\s*[:.]?$/iu.test(clean)) {
    return true;
  }
  if (/^(?:[IVXLCDM]+\s*[.:-]\s*)(?:bảng\s+)?đáp\s*án\s*[:.]?$/iu.test(clean)) {
    return true;
  }
  if (/^(?:bảng\s+đáp\s*án|hướng\s*dẫn\s*chấm|answer\s*key)\s*[:.]?$/iu.test(clean)) {
    return true;
  }
  return false;
}

// Nhận diện dòng chân trang hoặc ghi chú trang trí cuối đề để không ghép nhầm vào nội dung câu hỏi.
function isDecorativeFooterLine(line: string): boolean {
  return /^(?:trang(?:\s+\d+(?:\s*\/\s*\d+)?)?|-+\s*hết\s*-+|hết\s*[.!]*|chúc\s+(?:các\s+)?(?:em|bạn|học\s*sinh)\s+làm\s+bài\s+tốt\s*[.!]*)$/iu.test(line.trim());
}

// Tách tiêu đề câu hỏi đánh số (hỗ trợ kèm điểm số hoặc mức độ nhận thức như "Câu 1 (0,5 điểm): ...").
function matchQuestionHeading(line: string, formattedLine: string, allowBareNumber: boolean): { number: string; formattedBody: string } | undefined {
  const explicitPrefix = line.match(
    /^(?:câu(?:\s*hỏi)?|bài|question)\s*0*(\d+)(?:\s*\([^)]{1,30}\)|\s*\[[^\]]{1,20}\])?\s*(?:[.:)/-]\s*|\t+)(.*)$/iu,
  );
  if (explicitPrefix) {
    const plainPrefixLen = line.length - explicitPrefix[2]!.length;
    const rawWithoutStars = formattedLine.replace(/\*\*/gu, "");
    const bodyPlain = rawWithoutStars.slice(plainPrefixLen);
    // Bảo toàn đánh dấu **...** nếu phía cuối dòng chứa các phương án A., B. nối liền.
    const idxInFormatted = bodyPlain ? formattedLine.lastIndexOf(bodyPlain.slice(0, Math.min(12, bodyPlain.length))) : -1;
    const formattedBody = idxInFormatted >= 0 ? formattedLine.slice(idxInFormatted) : explicitPrefix[2]!;
    return { number: String(Number.parseInt(explicitPrefix[1]!, 10)), formattedBody };
  }

  const standaloneExplicit = line.match(
    /^(?:câu(?:\s*hỏi)?|bài|question)\s*0*(\d+)(?:\s*\([^)]{1,30}\)|\s*\[[^\]]{1,20}\])?\s*[.:)?-]?$/iu,
  );
  if (standaloneExplicit) {
    return { number: String(Number.parseInt(standaloneExplicit[1]!, 10)), formattedBody: "" };
  }

  if (allowBareNumber) {
    const bare = line.match(/^0*(\d{1,3})\s*[.:)]\s+(.+)$/u);
    if (bare && !/^[A-F]$/iu.test(bare[2]!.trim())) {
      return { number: String(Number.parseInt(bare[1]!, 10)), formattedBody: bare[2]! };
    }
  }
  return undefined;
}

// Kết hợp nhiều nguồn đáp án; sắp xếp phương án chuẩn A..F và cảnh báo nếu mâu thuẫn.
function finishQuestion(q: Question, table: string[], ambiguous: boolean): ScannedQuestionDraft {
  const distinctLetterKeys =
    q.options.length >= 2 &&
    new Set(q.options.map((o) => o.key)).size === q.options.length &&
    q.options.every((o) => /^[A-F]$/.test(o.key));
  const orderedOptions = distinctLetterKeys
    ? [...q.options].sort((left, right) => left.key.localeCompare(right.key))
    : q.options;

  const options = orderedOptions.map((o) => o.text);
  const marked = new Set<string>();
  for (const field of ["labelMarked", "bodyMarked"] as const) {
    const distinctive = orderedOptions.filter((o) => o[field]);
    if (distinctive.length > 0 && distinctive.length < options.length) {
      distinctive.forEach((o) => marked.add(o.key));
    }
  }
  const keys = new Set(
    [...q.answers, ...table].map(
      (value) => orderedOptions.find((o) => o.key === value.trim().toUpperCase())?.key ?? answerKey(value, orderedOptions),
    ),
  );
  marked.forEach((key) => keys.add(key));
  const key = [...keys][0];
  const selected = orderedOptions.find((o) => o.key === key);
  let correctAnswers: string[] = [];
  const warnings: string[] = [];
  if (!options.length) correctAnswers = q.answers;
  else if (
    ambiguous ||
    keys.size > 1 ||
    keys.has(undefined) ||
    new Set(options.map((item) => item.toLocaleLowerCase())).size !== options.length ||
    new Set(orderedOptions.map((o) => o.key)).size !== options.length
  ) {
    warnings.push(
      [
        "Câu " + q.number + ": đáp án mâu thuẫn hoặc chưa ghép được với phương án.",
        table.length && "Bảng đáp án: " + table.join(", ") + ".",
        q.answers.length && "Dòng đáp án: " + q.answers.join(", ") + ".",
        marked.size && "Phương án đánh dấu: " + [...marked].join(", ") + ".",
      ]
        .filter(Boolean)
        .join(" "),
    );
  } else if (selected) {
    correctAnswers = [selected.text];
  }
  if (!correctAnswers.length && !warnings.length) {
    warnings.push("Câu " + q.number + ": chưa xác định được đáp án.");
  }
  const answerSource = table.length ? "Bảng đáp án" : q.answers.length ? "Dòng đáp án" : "Định dạng phương án";
  return {
    type: options.length >= 2 ? "SINGLE_CHOICE" : "SHORT_ANSWER",
    content: q.content.trim(),
    options,
    correctAnswers,
    ...(correctAnswers.length ? { answerSource } : {}),
    difficulty: 2,
    tags: ["Tài liệu bóc tách"],
    confidence: correctAnswers.length ? 0.95 : 0.5,
    warnings,
  };
}

/** Đọc văn bản câu hỏi và lập chỉ mục bảng đáp án đánh số (hỗ trợ bảng phương án 2x2, bảng đáp án dọc/ngang/ô lưới). */
export function parseQuestionDocument(text: string): ScannedQuestionDraft[] {
  const questions: Question[] = [];
  const table = new Map<string, string[]>();
  const numberCounts = new Map<string, number>();
  const counts = new Map<string, number>();
  const sections = new Set<string>();
  let section = "";
  let current: Question | undefined;
  let horizontalColumns: string[] = [];
  let horizontalHasLabelCol = false;
  let verticalCols: { qCol: number; ansCol: number } | undefined;
  let readingKey = false;
  let answerSection: string | undefined;
  let awaitingInlineAnswer = false;

  // Lưu một cặp (số câu -> ký tự đáp án) vào bảng đối chiếu theo đúng phân mục hiện hành.
  const recordTableAnswer = (questionNumber: string, rawKey: string): void => {
    const normalizedNum = String(Number.parseInt(questionNumber, 10));
    const cleanKey = rawKey.trim().toUpperCase();
    if (!normalizedNum || normalizedNum === "NaN" || !/^[A-F]$/.test(cleanKey)) return;
    const keySection = answerSection ?? (sections.size > 1 ? "" : section);
    const id = `${keySection}/${normalizedNum}`;
    const existing = table.get(id) ?? [];
    if (!existing.includes(cleanKey)) existing.push(cleanKey);
    table.set(id, existing);
  };

  for (const raw of text.normalize("NFC").split(/\r?\n/u)) {
    const formatted = raw
      .trim()
      .replace(/<strong>/giu, "**")
      .replace(/<\/strong>/giu, "**")
      .replace(/__(.+?)__/gu, "**$1**");
    const line = formatted.replace(/\*\*/gu, "").trim();
    if (!line || isDecorativeFooterLine(line)) continue;

    const sectionName = line.match(/^phần\s+([IVXLCDM]+|\d+)\b(.*)$/iu);
    if (sectionName) {
      const restOfSection = (sectionName[2] ?? "").trim();
      if (/đáp\s*án|hướng\s*dẫn\s*chấm/iu.test(restOfSection) && !readingKey) {
        current = undefined;
        readingKey = true;
        horizontalColumns = [];
        verticalCols = undefined;
        awaitingInlineAnswer = false;
        continue;
      }
      section = sectionName[1]!.toUpperCase();
      if (readingKey) answerSection = section;
      sections.add(section);
      current = undefined;
      horizontalColumns = [];
      verticalCols = undefined;
      awaitingInlineAnswer = false;
      continue;
    }

    if (awaitingInlineAnswer) {
      awaitingInlineAnswer = false;
      if (current && answerKey(line, current.options)) {
        current.answers.push(line);
        readingKey = false;
        continue;
      }
    }

    if (isAnswerSectionHeading(line)) {
      current = undefined;
      readingKey = true;
      horizontalColumns = [];
      verticalCols = undefined;
      answerSection = undefined;
      awaitingInlineAnswer = false;
      continue;
    }

    if (/^(?:bảng\s+)?đáp\s*án\s*[:.]?$/iu.test(line)) {
      awaitingInlineAnswer = Boolean(current) && !/^bảng/iu.test(line);
      readingKey = true;
      horizontalColumns = [];
      verticalCols = undefined;
      answerSection = undefined;
      continue;
    }

    const cells = line.split("\t").map((cell) => cell.trim());

    // Nhận diện tiêu đề bảng đáp án ngang: "Câu | 1 | 2 | 3" hoặc "Câu 1 | Câu 2 | Câu 3".
    if (
      cells.length >= 2 &&
      /^(?:câu(?:\s*hỏi)?|bài)$/iu.test(cells[0]!) &&
      cells.slice(1).every((cell) => /^(?:câu\s*|bài\s*)?\d+[.:)]?$/iu.test(cell))
    ) {
      horizontalColumns = cells.slice(1).map((c) => c.replace(/\D+/g, ""));
      horizontalHasLabelCol = true;
      verticalCols = undefined;
      current = undefined;
      readingKey = true;
      continue;
    }
    if (cells.length >= 2 && cells.every((cell) => /^(?:câu|bài)\s*\d+[.:)]?$/iu.test(cell))) {
      horizontalColumns = cells.map((c) => c.replace(/\D+/g, ""));
      horizontalHasLabelCol = false;
      verticalCols = undefined;
      current = undefined;
      readingKey = true;
      continue;
    }

    // Đọc dòng giá trị đáp án ngay bên dưới tiêu đề bảng ngang.
    if (horizontalColumns.length > 0) {
      if (
        horizontalHasLabelCol &&
        /^(?:đáp\s*án(?:\s*đúng)?|phương\s*án|chọn|answer)$/iu.test(cells[0] ?? "") &&
        cells.length >= horizontalColumns.length + 1
      ) {
        horizontalColumns.forEach((qNum, idx) => {
          const val = cells[idx + 1]?.match(/^([A-F])(?:[.):\s-].*)?$/iu)?.[1];
          if (val) recordTableAnswer(qNum, val);
        });
        horizontalColumns = [];
        continue;
      }
      if (!horizontalHasLabelCol && cells.length === horizontalColumns.length && cells.every((c) => /^[A-F][.:)]?$/iu.test(c))) {
        horizontalColumns.forEach((qNum, idx) => {
          recordTableAnswer(qNum, cells[idx]![0]!);
        });
        horizontalColumns = [];
        continue;
      }
    }

    // Nhận diện tiêu đề bảng đáp án dọc nhiều cột (ví dụ: "Câu hỏi | Đáp án đúng | Kết quả" hoặc "STT | Câu | Đáp án").
    if (cells.length >= 2) {
      const qCol = cells.findIndex((c) => /^(?:câu(?:\s*hỏi)?|bài|question)$/iu.test(c));
      const ansCol = cells.findIndex((c) => /^(?:đáp\s*án(?:\s*đúng)?|phương\s*án(?:\s*đúng)?|chọn|answer(?:\s*key)?)$/iu.test(c));
      if (qCol >= 0 && ansCol >= 0 && qCol !== ansCol) {
        verticalCols = { qCol, ansCol };
        horizontalColumns = [];
        current = undefined;
        readingKey = true;
        continue;
      }
    }

    // Đọc từng dòng dữ liệu của bảng đáp án dọc (kể cả khi bảng có thêm cột Kết quả / Điểm / Giải thích).
    if (verticalCols && cells.length > Math.max(verticalCols.qCol, verticalCols.ansCol)) {
      const qMatch = cells[verticalCols.qCol]?.match(/^(?:câu\s*|bài\s*)?0*(\d+)[.:)]?$/iu);
      const ansMatch = cells[verticalCols.ansCol]?.match(/^([A-F])(?:[.):\s-].*)?$/iu);
      if (qMatch && ansMatch) {
        recordTableAnswer(qMatch[1]!, ansMatch[1]!);
        continue;
      }
    }

    // Hỗ trợ bảng đáp án dọc không có hàng tiêu đề khi đang ở trong phần ĐÁP ÁN (ví dụ "1 \t B \t 20").
    if (readingKey && cells.length >= 2) {
      const qMatch = cells[0]?.match(/^(?:câu\s*|bài\s*)?0*(\d+)[.:)]?$/iu);
      const ansMatch = cells[1]?.match(/^([A-F])(?:[.):\s-].*)?$/iu);
      if (qMatch && ansMatch) {
        recordTableAnswer(qMatch[1]!, ansMatch[1]!);
        continue;
      }
    }

    const strippedKeyHeader = line.replace(/^(?:bảng\s+)?đáp\s*án(?:\s+trắc\s*nghiệm)?\s*[:.-]?\s*/iu, "");
    const pairs = answerKeyPairs(strippedKeyHeader, readingKey);
    if (
      pairs.length &&
      (readingKey ||
        strippedKeyHeader !== line ||
        pairs.length > 1 ||
        /^\d+\s*[-–]\s*[A-F]$/iu.test(line))
    ) {
      for (const pair of pairs) {
        recordTableAnswer(pair.number, pair.key);
      }
      if (strippedKeyHeader !== line) {
        current = undefined;
        readingKey = true;
      }
      continue;
    }

    // Trong vùng ĐÁP ÁN / HƯỚNG DẪN GIẢI cuối đề, nếu gặp dòng "Câu 1: Chọn B. Vì..." thì trích đáp án thay vì tạo câu hỏi trùng.
    if (readingKey) {
      const solutionLine = line.match(/^(?:câu|bài)\s*0*(\d+)\s*[.:)-]\s*(?:(?:đáp\s*án(?:\s*đúng)?(?:\s*là)?|chọn(?:\s*phương\s*án)?)\s*[:.]?\s*)?([A-F])\b/iu);
      if (solutionLine && questions.some((q) => q.number === String(Number.parseInt(solutionLine[1]!, 10)))) {
        recordTableAnswer(solutionLine[1]!, solutionLine[2]!);
        continue;
      }
      // Bỏ qua các dòng chú thích thang điểm hoặc lời giải chi tiết nằm dưới phần ĐÁP ÁN.
      if (/^(?:mỗi\s+câu|giải\s+thích|hướng\s+dẫn|lời\s+giải|ghi\s+chú|tổng\s+điểm)/iu.test(line)) {
        continue;
      }
    }

    // Kiểm tra dòng chứa một hoặc nhiều phương án A., B., C., D. (kể cả bảng 2x2 của Word) trước khi xét tiêu đề số trần.
    if (current) {
      const extractedOptions = extractOptionsFromFormattedLine(formatted);
      if (extractedOptions.length > 0) {
        current.options.push(...extractedOptions);
        continue;
      }
    }

    const heading = matchQuestionHeading(line, formatted, !readingKey);
    if (heading && (!readingKey || !questions.some((q) => q.section === section && q.number === heading.number))) {
      const { stem, options: inlineOpts } = splitTrailingOptionsFromStem(heading.formattedBody);
      current = {
        section,
        number: heading.number,
        content: stem,
        options: inlineOpts,
        answers: [],
      };
      questions.push(current);
      numberCounts.set(current.number, (numberCounts.get(current.number) ?? 0) + 1);
      const id = `${section}/${current.number}`;
      counts.set(id, (counts.get(id) ?? 0) + 1);
      readingKey = false;
      verticalCols = undefined;
      horizontalColumns = [];
      answerSection = undefined;
      continue;
    }

    if (!current) continue;

    const inlineAnswer = line.match(
      /^(?:(?:đáp\s*án(?:\s+đúng)?|ĐA|answer|lời\s*giải|hướng\s*dẫn\s*giải)(?:\s+là)?\s*[:.]\s*|(?:đáp\s*án(?:\s+đúng)?\s+là\s+)|(?=chọn\s+[A-F]\b))(.+)$/iu,
    );
    if (inlineAnswer) {
      const candidate = inlineAnswer[1]!.trim();
      const isExplanation = /^(?:lời\s*giải|hướng\s*dẫn\s*giải)/iu.test(line);
      if (!isExplanation || !current.options.length || answerKey(candidate, current.options)) {
        current.answers.push(candidate);
      }
    } else if (!current.options.length) {
      const { stem: extraStem, options: trailingOpts } = splitTrailingOptionsFromStem(formatted);
      current.content = current.content ? `${current.content} ${extraStem}` : extraStem;
      if (trailingOpts.length) current.options.push(...trailingOpts);
    }
  }

  return questions
    .filter((q) => q.content.trim().length > 0 || q.options.length > 0)
    .map((question) => {
      const id = `${question.section}/${question.number}`;
      const tableAnswers = table.get(id) ?? table.get(`/${question.number}`) ?? [];
      const duplicates = table.has(id) ? counts.get(id) : numberCounts.get(question.number);
      return finishQuestion(question, tableAnswers, tableAnswers.length > 0 && (duplicates ?? 0) > 1);
    });
}
