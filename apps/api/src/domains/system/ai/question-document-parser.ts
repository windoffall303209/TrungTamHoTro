import mammoth from "mammoth";
import { BadRequestException } from "@nestjs/common";
import type { ScannedQuestionDraft } from "./ai-provider.service.js";
import { validateDocxArchive } from "../../../infrastructure/validate-docx-archive.js";

interface WordNode {
  type: string;
  value?: string;
  children?: WordNode[];
  isBold?: boolean;
  isUnderline?: boolean;
  highlight?: string;
}

interface Option { key: string; text: string; labelMarked: boolean; bodyMarked: boolean }
interface Question {
  number: string;
  section: string;
  content: string;
  options: Option[];
  answers: string[];
}

// Giữ nguyên ranh giới đoạn, cột bảng và định dạng nhấn mạnh trong từng run Word.
function wordText(node: WordNode): string {
  if (node.type === "text") return node.value ?? "";
  if (node.type === "break") return "\n";
  if (node.type === "tab") return "\t";
  const parts = (node.children ?? []).map(wordText);
  if (node.type === "tableRow") return parts.map((cell) => cell.trim()).join("\t") + "\n";
  const value = parts.join("");
  if (node.type === "paragraph") return value + "\n";
  if (node.type === "run" && value.trim() && (node.isBold || node.isUnderline || node.highlight)) return "**" + value + "**";
  return value;
}

// Trích xuất các dòng câu hỏi có định dạng mà không nạp ảnh nhúng hay tài nguyên ngoài.
export async function readQuestionDocx(buffer: Buffer): Promise<string> {
  await validateDocxArchive(buffer);
  let text = "";
  try {
    await mammoth.convertToHtml({ buffer }, {
      includeEmbeddedStyleMap: false,
      // Chuyển cây tài liệu Word sang văn bản giữ định dạng phục vụ bóc tách câu hỏi.
      transformDocument(document: WordNode) {
        text = wordText(document);
        return { ...document, children: [] };
      },
    });
  } catch {
    throw new BadRequestException("Không đọc được nội dung Word. Hãy kiểm tra tệp DOCX hoặc chuyển sang PDF.");
  }
  return text;
}

// So khớp văn bản phương án chính xác trước khi suy diễn ký tự đáp án A..F.
export function answerKey(value: string, options: { key: string; text: string }[]): string | undefined {
  const clean = value.trim().replace(/[.;]$/u, "").trim();
  const exact = options.filter((option) => option.text.toLocaleLowerCase() === value.trim().toLocaleLowerCase());
  if (exact.length === 1) return exact[0]!.key;
  const match = clean.match(/^(?:(?:chọn|choose|phương án|đáp án(?: đúng)?|answer)(?:\s+là)?[\s:.]*)*([A-F])(?:[.):]\s*.*)?$/iu);
  return options.find((option) => option.key === match?.[1]?.toUpperCase())?.key;
}

// Kết hợp nhiều nguồn đáp án; yêu cầu kiểm tra lại nếu định dạng hoặc khóa bị mâu thuẫn.
function finishQuestion(q: Question, table: string[], ambiguous: boolean): ScannedQuestionDraft {
  const options = q.options.map((o) => o.text);
  const marked = new Set<string>();
  for (const field of ["labelMarked", "bodyMarked"] as const) {
    const distinctive = q.options.filter((o) => o[field]);
    if (distinctive.length < options.length) distinctive.forEach((o) => marked.add(o.key));
  }
  const keys = new Set([...q.answers, ...table].map((value) => q.options.find((o) => o.key === value.toUpperCase())?.key ?? answerKey(value, q.options)));
  marked.forEach((key) => keys.add(key));
  const key = [...keys][0];
  const selected = q.options.find((o) => o.key === key);
  let correctAnswers: string[] = [];
  const warnings: string[] = [];
  if (!options.length) correctAnswers = q.answers;
  else if (ambiguous || keys.size > 1 || keys.has(undefined) || new Set(options).size !== options.length || new Set(q.options.map((o) => o.key)).size !== options.length)
    warnings.push(["Câu " + q.number + ": đáp án mâu thuẫn hoặc chưa ghép được với phương án.",
      table.length && "Bảng đáp án: " + table.join(", ") + ".",
      q.answers.length && "Dòng đáp án: " + q.answers.join(", ") + ".",
      marked.size && "Phương án đánh dấu: " + [...marked].join(", ") + "."].filter(Boolean).join(" "));
  else if (selected) correctAnswers = [selected.text];
  if (!correctAnswers.length && !warnings.length) warnings.push("Câu " + q.number + ": chưa xác định được đáp án.");
  const answerSource = table.length ? "Bảng đáp án" : q.answers.length ? "Dòng đáp án" : "Định dạng phương án";
  return { type: options.length >= 2 ? "SINGLE_CHOICE" : "SHORT_ANSWER", content: q.content, options,
    correctAnswers, ...(correctAnswers.length ? { answerSource } : {}), difficulty: 2, tags: ["Tài liệu bóc tách"],
    confidence: correctAnswers.length ? 0.95 : 0.5, warnings };
}

// Đọc văn bản câu hỏi và lập chỉ mục bảng đáp án đánh số (kể cả trong bảng Word).
export function parseQuestionDocument(text: string): ScannedQuestionDraft[] {
  const questions: Question[] = [];
  const table = new Map<string, string[]>();
  const numberCounts = new Map<string, number>();
  const counts = new Map<string, number>();
  const sections = new Set<string>();
  let section = "";
  let current: Question | undefined;
  let columns: string[] = [];
  let readingKey = false;
  let answerSection: string | undefined;
  let awaitingInlineAnswer = false;
  for (const raw of text.normalize("NFC").split(/\r?\n/u)) {
    const formatted = raw.trim().replace(/<strong>/giu, "**").replace(/<\/strong>/giu, "**").replace(/__(.+?)__/gu, "**$1**");
    const line = formatted.replace(/\*\*/gu, "").trim();
    if (!line) continue;
    const sectionName = line.match(/^phần\s+([IVXLCDM]+|\d+)\b/iu);
    if (sectionName) {
      section = sectionName[1]!.toUpperCase();
      if (readingKey) answerSection = section;
      sections.add(section);
      current = undefined;
      columns = [];
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
    const cells = line.split("\t").map((cell) => cell.trim());
    if (/^câu$/iu.test(cells[0]!) && cells.length > 1 && cells.slice(1).every((cell) => /^\d+$/u.test(cell))) {
      columns = cells.slice(1); readingKey = true; continue;
    }
    if (/^câu$/iu.test(cells[0]!) && /^đáp án$/iu.test(cells[1] ?? "")) {
      current = undefined; readingKey = true; columns = []; continue;
    }
    let keyLine = line.replace(/^(?:bảng\s+)?đáp án\s*[:.]?\s*/iu, "");
    if (columns.length && /^đáp án$/iu.test(cells[0]!) && cells.length === columns.length + 1) {
      keyLine = columns.map((n, i) => n + "-" + cells[i + 1]).join(", ");
      columns = [];
    }
    if (/^(?:bảng\s+)?đáp án\s*[:.]?$/iu.test(line)) {
      awaitingInlineAnswer = !!current && !/^bảng/iu.test(line);
      readingKey = true;
      columns = [];
      answerSection = undefined;
      continue;
    }
    const pairs = Array.from(keyLine.matchAll(/(?:^|[,;\s]+)(?:câu\s*)?(\d+)\s*(?:[-.:)=–]|\s)\s*([A-F])(?=$|[,;\s])/giu));
    if (pairs.length && (readingKey || keyLine !== line || pairs.length > 1 || /^\d+\s*[-–]\s*[A-F]$/iu.test(line))) {
      for (const pair of pairs) {
        const keySection = answerSection ?? (sections.size > 1 ? "" : section);
        const id = keySection + "/" + pair[1];
        const answers = table.get(id) ?? [];
        answers.push(pair[2]!);
        table.set(id, answers);
      }
      continue;
    }
    const heading = line.match(/^(?:(?:Câu|Bài)\s*)?(\d+)\s*[.:)]\s*(.+)$/iu);
    if (heading) {
      current = { section, number: heading[1]!, content: heading[2]!, options: [], answers: [] };
      questions.push(current);
      numberCounts.set(current.number, (numberCounts.get(current.number) ?? 0) + 1);
      const id = section + "/" + current.number;
      counts.set(id, (counts.get(id) ?? 0) + 1);
      readingKey = false;
      answerSection = undefined;
      continue;
    }
    if (!current) continue;
    const option = line.match(/^([A-F])[.:)]\s*(.+)$/iu);
    if (option) {
      const marked = [...formatted.matchAll(/\*\*(.+?)\*\*/gu)].map((match) => match[1]!.trim()).join("").replace(/\s/gu, "");
      const body = option[2]!.replace(/\s/gu, "");
      current.options.push({ key: option[1]!.toUpperCase(), text: option[2]!,
        labelMarked: /^\*\*\s*[A-F](?:[.):]|\*\*)/iu.test(formatted),
        bodyMarked: marked === body || marked === line.replace(/\s/gu, "") });
      continue;
    }
    const answer = line.match(/^(?:(?:đáp án(?: đúng)?|ĐA|answer|lời giải|hướng dẫn giải)(?:\s+là)?\s*[:.]?\s*|(?=chọn\s+[A-F]\b))(.+)$/iu);
    if (answer) {
      const candidate = answer[1]!.trim();
      const explanation = /^(?:lời giải|hướng dẫn giải)/iu.test(line);
      if (!explanation || !current.options.length || answerKey(candidate, current.options)) current.answers.push(candidate);
    } else if (!current.options.length) current.content += " " + line;
  }
  return questions.map((question) => {
    const id = question.section + "/" + question.number;
    const tableAnswers = table.get(id) ?? table.get("/" + question.number) ?? [];
    const duplicates = table.has(id) ? counts.get(id) : numberCounts.get(question.number);
    return finishQuestion(question, tableAnswers, tableAnswers.length > 0 && (duplicates ?? 0) > 1);
  });
}
