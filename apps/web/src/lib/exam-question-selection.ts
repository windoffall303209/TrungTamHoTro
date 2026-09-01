import type { LearningClass, Question } from "@/lib/learning-types";

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
