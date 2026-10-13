import { BadRequestException } from "@nestjs/common";
import { createHash } from "node:crypto";
import { Prisma } from "../../generated/prisma/client.js";
import { normalizeMultipartFileName } from "../../infrastructure/file-transfer.js";
import type {
  LearningQuestion,
  MaterialVersionSnapshot,
} from "../learning.types.js";
import type { LearningServiceContext } from "../learning.context.js";

/** Ánh xạ snapshot tệp học liệu sang thông tin version hiển thị. */
export function mapMaterialVersion(
  serviceContext: LearningServiceContext,
  row: Prisma.MaterialVersionGetPayload<Record<string, never>>,
): MaterialVersionSnapshot {
  const sizeBytes = Number(row.sizeBytes);
  if (!Number.isSafeInteger(sizeBytes))
    throw new BadRequestException(
      "Kích thước phiên bản học liệu vượt giới hạn số an toàn.",
    );
  return {
    id: row.id,
    materialId: row.materialId,
    version: row.version,
    name: normalizeMultipartFileName(row.name),
    mimeType: row.mimeType,
    sizeBytes,
    folder: row.folder,
    tags: serviceContext.toStringArray(row.tags),
    visibility: row.visibility,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Sao chép sâu các mảng câu hỏi in-memory để caller không sửa state nội bộ. */
export function cloneQuestion(item: LearningQuestion): LearningQuestion {
  return {
    ...item,
    options: [...item.options],
    correctAnswers: [...item.correctAnswers],
    tags: [...item.tags],
  };
}

/** Chọn version cao nhất trong mỗi family câu hỏi. */
export function latestQuestionVersions(
  items: LearningQuestion[],
): LearningQuestion[] {
  const latest = new Map<string, LearningQuestion>();
  for (const item of items) {
    const familyId = item.familyId ?? item.id;
    const current = latest.get(familyId);
    if (!current || item.version > current.version) latest.set(familyId, item);
  }
  return [...latest.values()].sort((a, b) => b.version - a.version);
}

/** Chỉ tái dùng câu ngân hàng khi nội dung, loại, lựa chọn, đáp án và độ khó khớp hoàn toàn. */
export function sameGeneratedQuestion(
  existing: {
    content: string;
    type: string;
    difficulty: number;
    options: unknown;
    correctAnswers: unknown;
  },
  generated: {
    content: string;
    type: string;
    difficulty: number;
    options: string[];
    correctAnswers: string[];
  },
): boolean {
  return (
    existing.content === generated.content &&
    existing.type === generated.type &&
    existing.difficulty === generated.difficulty &&
    JSON.stringify(existing.options) === JSON.stringify(generated.options) &&
    JSON.stringify(existing.correctAnswers) ===
      JSON.stringify(generated.correctAnswers)
  );
}

/** Chuẩn hóa nội dung rồi băm để phát hiện câu hỏi trùng. */
export function questionContentHash(content: string): string {
  return createHash("sha256")
    .update(content.trim().replace(/\s+/g, " ").toLowerCase())
    .digest("hex");
}

/** Chuẩn hóa rich text/đáp án/tag và kiểm tra quy tắc riêng cho từng loại câu hỏi. */
export function validateQuestionInput(
  input: Omit<LearningQuestion, "id" | "status" | "version">,
): Omit<
  LearningQuestion,
  "id" | "status" | "version" | "familyId" | "supersedesId"
> {
  const content = input.content
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim();
  const options = [
    ...new Set(input.options.map((item) => item.trim()).filter(Boolean)),
  ];
  const correctAnswers = [
    ...new Set(input.correctAnswers.map((item) => item.trim()).filter(Boolean)),
  ];
  const tags = [
    ...new Set(
      input.tags.map((item) => item.trim().toLowerCase()).filter(Boolean),
    ),
  ];
  if (content.length < 5)
    throw new BadRequestException("Nội dung câu hỏi cần ít nhất 5 ký tự.");
  if (
    !Number.isInteger(input.difficulty) ||
    input.difficulty < 1 ||
    input.difficulty > 3
  )
    throw new BadRequestException("Độ khó phải từ 1 đến 3.");
  const objective = ["SINGLE_CHOICE", "MULTIPLE_CHOICE", "TRUE_FALSE"].includes(
    input.type,
  );
  if (objective && options.length < 2)
    throw new BadRequestException(
      "Câu hỏi trắc nghiệm cần ít nhất hai lựa chọn khác nhau.",
    );
  if (correctAnswers.some((answer) => !options.includes(answer)) && objective)
    throw new BadRequestException(
      "Đáp án đúng phải nằm trong danh sách lựa chọn.",
    );
  if (
    (input.type === "SINGLE_CHOICE" || input.type === "TRUE_FALSE") &&
    correctAnswers.length !== 1
  )
    throw new BadRequestException(
      "Câu hỏi một đáp án cần đúng một đáp án đúng.",
    );
  if (input.type === "MULTIPLE_CHOICE" && correctAnswers.length < 1)
    throw new BadRequestException(
      "Câu hỏi nhiều đáp án cần ít nhất một đáp án đúng.",
    );
  if (
    input.type === "TRUE_FALSE" &&
    (options.length !== 2 ||
      ![
        ["Đúng", "Sai"],
        ["True", "False"],
        ["Đúng (True)", "Sai (False)"],
      ].some((pair) => pair.every((option) => options.includes(option))))
  )
    throw new BadRequestException(
      "Câu hỏi đúng/sai phải có hai lựa chọn Đúng và Sai.",
    );
  return {
    courseId: input.courseId.trim(),
    type: input.type,
    content,
    options,
    correctAnswers,
    difficulty: input.difficulty,
    tags,
  };
}

/** Chuẩn hóa đáp án nộp và chặn lựa chọn không thuộc options của câu hỏi. */
export function validateSubmittedAnswers(
  question: LearningQuestion,
  answers: string[],
): string[] {
  const normalized = answers.map((answer) => answer.trim()).filter(Boolean);
  if (new Set(normalized).size !== normalized.length)
    throw new BadRequestException("Câu trả lời không được chứa giá trị trùng.");
  if (
    ["SINGLE_CHOICE", "TRUE_FALSE"].includes(question.type) &&
    normalized.length > 1
  )
    throw new BadRequestException("Câu hỏi này chỉ chấp nhận một lựa chọn.");
  if (
    ["SHORT_ANSWER", "ESSAY"].includes(question.type) &&
    normalized.length > 1
  )
    throw new BadRequestException(
      "Câu hỏi này chỉ chấp nhận một nội dung trả lời.",
    );
  if (
    ["SINGLE_CHOICE", "MULTIPLE_CHOICE", "TRUE_FALSE"].includes(
      question.type,
    ) &&
    normalized.some((answer) => !question.options.includes(answer))
  )
    throw new BadRequestException("Lựa chọn trả lời không thuộc câu hỏi.");
  return normalized;
}

/** So sánh đáp án khách quan không phụ thuộc thứ tự lựa chọn. */
export function isQuestionAnswerCorrect(
  question: LearningQuestion,
  submitted: string[],
): boolean {
  if (question.type === "SHORT_ANSWER") {
    const value = submitted[0]?.trim().toLocaleLowerCase("vi");
    return (
      Boolean(value) &&
      question.correctAnswers.some(
        (answer) => answer.trim().toLocaleLowerCase("vi") === value,
      )
    );
  }
  return (
    JSON.stringify([...submitted].sort()) ===
    JSON.stringify([...question.correctAnswers].sort())
  );
}
