import type { Exam, Question } from "@/lib/learning-types";

export const blank = {
  classId: "",
  title: "",
  questionIds: [] as string[],
  durationMinutes: 45,
  totalScore: 10,
  openAt: "",
  closeAt: "",
  attemptLimit: 1,
  shuffleQuestions: false,
  randomSeed: "wind-exam-2026",
  scoreAllocations: {} as Record<string, number>,
};

export const questionTypeOptions: Array<{
  type: Question["type"];
  label: string;
  description: string;
}> = [
  {
    type: "SINGLE_CHOICE",
    label: "Chọn một đáp án",
    description: "Một đáp án đúng trong 4 lựa chọn",
  },
  {
    type: "MULTIPLE_CHOICE",
    label: "Chọn nhiều đáp án",
    description: "Từ hai đáp án đúng trở lên",
  },
  {
    type: "TRUE_FALSE",
    label: "Đúng / Sai",
    description: "Nhận định hai lựa chọn",
  },
  {
    type: "SHORT_ANSWER",
    label: "Điền từ / trả lời ngắn",
    description: "Đáp án ngắn có thể chấm tự động",
  },
  { type: "ESSAY", label: "Tự luận", description: "Kèm dàn ý chấm tham khảo" },
];

export const blankAiConfig = {
  language: "VI" as "VI" | "EN" | "BILINGUAL",
  focus: "",
  difficulty: 2 as 1 | 2 | 3,
  contextMode: "AUTO" as "AUTO" | "COURSE_MATERIALS" | "WEB_SEARCH",
  providerId: "",
  model: "",
  materialIds: [] as string[],
  distribution: {
    SINGLE_CHOICE: 2,
    MULTIPLE_CHOICE: 1,
    TRUE_FALSE: 0,
    SHORT_ANSWER: 2,
    ESSAY: 0,
  } as Record<Question["type"], number>,
};

/** Chia tổng điểm theo hai chữ số thập phân và dồn phần dư vào câu cuối. */
export function distributeScores(
  questionIds: string[],
  totalScore: number,
): Record<string, number> {
  if (!questionIds.length) return {};
  const base = Math.floor((totalScore / questionIds.length) * 100) / 100;
  const result = Object.fromEntries(
    questionIds.map((questionId) => [questionId, base]),
  );
  result[questionIds[questionIds.length - 1]!] =
    Math.round((totalScore - base * (questionIds.length - 1)) * 100) / 100;
  return result;
}

/** Chuyển ISO từ máy chủ sang giá trị datetime-local theo múi giờ trình duyệt. */
export function toLocalDateTimeInput(value: string): string {
  const date = new Date(value);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

export interface LearnerExam extends Exam {
  questionCount?: number;
  availabilityStatus?:
    | "UPCOMING"
    | "AVAILABLE"
    | "IN_PROGRESS"
    | "ATTEMPT_LIMIT_REACHED"
    | "CLOSED";
  remainingAttempts?: number;
  serverTime?: string;
}
