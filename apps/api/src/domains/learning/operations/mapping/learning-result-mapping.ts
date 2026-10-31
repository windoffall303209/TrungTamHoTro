import { createHash } from "node:crypto";
import { Prisma } from "../../../../generated/prisma/client.js";
import {
  AttemptWithAnswers,
  ExamWithQuestions,
  now,
} from "../../core/learning.shared.js";
import type {
  ExamAttempt,
  LearningExam,
  RegradeRequest,
} from "../../core/learning.types.js";
import type { LearningServiceContext } from "../../core/learning.context.js";

/** Ánh xạ đề và giữ thứ tự câu hỏi theo trường order trong bảng nối. */
export function mapExam(row: ExamWithQuestions): LearningExam {
  return {
    id: row.id,
    classId: row.classId,
    title: row.title,
    questionIds: row.questions.map(({ questionId }) => questionId),
    durationMinutes: row.durationMinutes,
    totalScore: Number(row.totalScore),
    openAt: row.openAt.toISOString(),
    closeAt: row.closeAt.toISOString(),
    attemptLimit: row.attemptLimit,
    shuffleQuestions: row.shuffleQuestions,
    randomSeed: row.randomSeed ?? undefined,
    questionScores: Object.fromEntries(
      row.questions.map(({ questionId, score }) => [questionId, Number(score)]),
    ),
    aiContext:
      row.aiContext &&
      typeof row.aiContext === "object" &&
      !Array.isArray(row.aiContext)
        ? (row.aiContext as unknown as LearningExam["aiContext"])
        : undefined,
    status: row.status,
    version: row.version,
  };
}

/** Ánh xạ lượt thi cùng câu trả lời và receipt sang hợp đồng API. */
export function mapAttempt(
  serviceContext: LearningServiceContext,
  row: AttemptWithAnswers,
): ExamAttempt {
  return {
    id: row.id,
    examId: row.examId,
    learnerId: row.learnerId,
    answers: Object.fromEntries(
      row.answers.map((answer) => [
        answer.questionId,
        serviceContext.toStringArray(answer.answerData),
      ]),
    ),
    status: row.status,
    startedAt: row.startedAt.toISOString(),
    submittedAt: row.submittedAt?.toISOString(),
    score: row.score === null ? undefined : Number(row.score),
    feedback: row.feedback ?? undefined,
    gradePublishedAt: row.gradePublishedAt?.toISOString(),
    serverTime: now(),
    lastSavedAt: row.answers.length
      ? new Date(
          row.answers.reduce(
            (maximum, answer) => Math.max(maximum, answer.updatedAt.getTime()),
            -Infinity,
          ),
        ).toISOString()
      : undefined,
    submissionReceipt: row.submittedAt
      ? serviceContext.submissionReceipt(row.id, row.submittedAt.toISOString())
      : undefined,
  };
}

/** Tạo mã biên nhận ngắn có HMAC từ lượt thi và thời điểm nộp. */
export function submissionReceipt(
  attemptId: string,
  submittedAt: string,
): string {
  return `SUB-${createHash("sha256").update(`${attemptId}.${submittedAt}`).digest("hex").slice(0, 16).toUpperCase()}`;
}

/** Ánh xạ yêu cầu phúc khảo và các mốc xử lý. */
export function mapRegradeRequest(
  row: Prisma.RegradeRequestGetPayload<Record<string, never>>,
): RegradeRequest {
  return {
    id: row.id,
    attemptId: row.attemptId,
    learnerId: row.learnerId,
    reason: row.reason,
    status: row.status,
    resolution: row.resolution ?? undefined,
    assignedToId: row.assignedToId ?? undefined,
    resolvedById: row.resolvedById ?? undefined,
    resolvedAt: row.resolvedAt?.toISOString(),
    createdAt: row.createdAt.toISOString(),
  };
}
