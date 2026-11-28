export interface ParsedEssayQuestion {
  index: number;
  label: string;
  prompt: string;
  isGeneral?: boolean;
}

const QUESTION_HEADING_REGEX = /^(?:Câu|Bài|Question|Phần)\s+(\d+)(?:\s*[:.\-)]|\s+|$)(.*)$/i;
const NUMBERED_ITEM_REGEX = /^(\d+)[.)]\s+(.*)$/;

/** Tách nội dung hướng dẫn bài tự luận thành danh sách câu hỏi đánh số rõ ràng để giáo viên đối chiếu khi chấm. */
export function parseEssayQuestions(instructions: string, description?: string): ParsedEssayQuestion[] {
  const normalized = instructions.replace(/\r\n/g, "\n").trim();
  if (!normalized) {
    const fallback = (description ?? "").replace(/\r\n/g, "\n").trim();
    return fallback ? [{ index: 1, label: "Yêu cầu đề bài", prompt: fallback, isGeneral: true }] : [];
  }

  const lines = normalized.split("\n");
  const blocks: ParsedEssayQuestion[] = [];
  let introLines: string[] = [];
  let current: { index: number; label: string; lines: string[] } | null = null;

  for (const line of lines) {
    const match = line.trim().match(QUESTION_HEADING_REGEX);
    if (match) {
      if (current) {
        blocks.push({
          index: current.index,
          label: current.label,
          prompt: current.lines.join("\n").trim(),
        });
      } else if (introLines.some((item) => item.trim())) {
        blocks.push({
          index: 0,
          label: "Hướng dẫn chung",
          prompt: introLines.join("\n").trim(),
          isGeneral: true,
        });
        introLines = [];
      }
      const num = Number(match[1]);
      const rest = (match[2] ?? "").trim();
      current = {
        index: num,
        label: `Câu ${num}`,
        lines: rest ? [rest] : [],
      };
    } else if (current) {
      current.lines.push(line);
    } else {
      introLines.push(line);
    }
  }

  if (current) {
    blocks.push({
      index: current.index,
      label: current.label,
      prompt: current.lines.join("\n").trim(),
    });
  }

  const structuredQuestions = blocks.filter((item) => !item.isGeneral);
  if (structuredQuestions.length > 0) {
    return blocks;
  }

  // Kiểm tra mẫu liệt kê số thứ tự đầu dòng (1. ..., 2. ...) nếu không ghi chữ "Câu".
  const numberedMatches = lines.filter((line) => NUMBERED_ITEM_REGEX.test(line.trim())).length;
  if (numberedMatches >= 2) {
    const numBlocks: ParsedEssayQuestion[] = [];
    let numIntro: string[] = [];
    let activeNum: { index: number; label: string; lines: string[] } | null = null;
    for (const line of lines) {
      const m = line.trim().match(NUMBERED_ITEM_REGEX);
      if (m) {
        if (activeNum) {
          numBlocks.push({
            index: activeNum.index,
            label: activeNum.label,
            prompt: activeNum.lines.join("\n").trim(),
          });
        } else if (numIntro.some((item) => item.trim())) {
          numBlocks.push({
            index: 0,
            label: "Hướng dẫn chung",
            prompt: numIntro.join("\n").trim(),
            isGeneral: true,
          });
          numIntro = [];
        }
        const num = Number(m[1]);
        activeNum = { index: num, label: `Câu ${num}`, lines: [m[2]!.trim()] };
      } else if (activeNum) {
        activeNum.lines.push(line);
      } else {
        numIntro.push(line);
      }
    }
    if (activeNum) {
      numBlocks.push({
        index: activeNum.index,
        label: activeNum.label,
        prompt: activeNum.lines.join("\n").trim(),
      });
    }
    if (numBlocks.some((item) => !item.isGeneral)) return numBlocks;
  }

  return [{ index: 1, label: "Câu hỏi / Đề bài", prompt: normalized }];
}
