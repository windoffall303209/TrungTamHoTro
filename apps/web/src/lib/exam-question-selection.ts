import type { LearningClass, Question } from "@/lib/learning-types";

/** Chỉ cho đề chọn câu hỏi đã xuất bản và thuộc cùng khóa học với lớp. */
export function eligibleExamQuestions(
  questions: readonly Question[],
  classes: readonly LearningClass[],
  classId: string,
): Question[] {
  const courseId = classes.find((item) => item.id === classId)?.courseId;
  if (!courseId) return [];
  return questions.filter(
    (question) => question.status === "PUBLISHED" && question.courseId === courseId,
  );
}

/** Chọn hoặc bỏ chọn các câu đang hiển thị, giữ nguyên lựa chọn thuộc bộ lọc khác. */
export function toggleVisibleExamQuestions(
  selectedIds: readonly string[],
  visibleIds: readonly string[],
): string[] {
  const visible = new Set(visibleIds);
  if (visible.size === 0) return [...selectedIds];
  const selected = new Set(selectedIds);
  if ([...visible].every((id) => selected.has(id))) {
    return selectedIds.filter((id) => !visible.has(id));
  }
  return [...new Set([...selectedIds, ...visibleIds])];
}

/** Kiểm tra câu hỏi xem trước còn được xuất bản và giữ nguyên nội dung, phương án, đáp án. */
export function isExamQuestionPreviewCurrent<T extends {
  id: string;
  status: string;
  content: string;
  type: string;
  difficulty: string | number;
  options?: readonly string[];
  correctAnswers?: readonly number[];
  solution?: string;
}>(preview: readonly T[], current: readonly T[]): boolean {
  if (preview.length === 0) return false;
  const available = new Map(current.filter((question) => question.status === "PUBLISHED")
    .map((question) => [question.id, question]));
  return preview.every((question) => {
    const latest = available.get(question.id);
    return latest !== undefined && latest.content === question.content &&
      latest.type === question.type && latest.difficulty === question.difficulty &&
      latest.solution === question.solution &&
      JSON.stringify(latest.options ?? []) === JSON.stringify(question.options ?? []) &&
      JSON.stringify(latest.correctAnswers ?? []) === JSON.stringify(question.correctAnswers ?? []);
  });
}
