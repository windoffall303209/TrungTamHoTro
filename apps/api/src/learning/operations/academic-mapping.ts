import type { Prisma } from "../../generated/prisma/client.js";
import {
  AssignmentSubmissionView,
  AssignmentView,
  MappableSubmissionRow,
} from "../academic.shared.js";
import type { AcademicServiceContext } from "../academic.context.js";

/** Ánh xạ assignment Prisma và submission tùy chọn sang view model học vụ. */
export function mapAssignment(
  serviceContext: AcademicServiceContext,
  row: Prisma.AssignmentGetPayload<{
    include: {
      class: { select: { code: true } };
      submissions: {
        include: {
          learner: { select: { displayName: true; email: true } };
          attachments: true;
        };
      };
    };
  }>,
  submission?: Prisma.AssignmentSubmissionGetPayload<{
    include: {
      learner: { select: { displayName: true; email: true } };
      attachments: true;
    };
  }>,
): AssignmentView {
  return {
    id: row.id,
    classId: row.classId,
    classCode: row.class.code,
    title: row.title,
    description: row.description,
    instructions: row.instructions,
    dueAt: row.dueAt.toISOString(),
    maxScore: Number(row.maxScore),
    rubric: serviceContext.rubric(row.rubric),
    status: row.status,
    version: row.version,
    closedAt: row.closedAt?.toISOString(),
    closeReason: row.closeReason ?? undefined,
    createdById: row.createdById,
    submission: submission
      ? serviceContext.mapSubmission(submission)
      : undefined,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Chuyển bài nộp và tệp đính kèm sang dữ liệu trả cho giao diện. */
export function mapSubmission(
  serviceContext: AcademicServiceContext,
  row: MappableSubmissionRow,
): AssignmentSubmissionView {
  return {
    id: row.id,
    assignmentId: row.assignmentId,
    learnerId: row.learnerId,
    learnerName: row.learner.displayName,
    learnerEmail: row.learner.email,
    content: row.content,
    attachments: row.attachments
      .filter((item) => !item.removedAt)
      .map((item) => ({
        id: item.id,
        originalName: item.originalName,
        mimeType: item.mimeType,
        sizeBytes: Number(item.sizeBytes),
        createdAt: item.createdAt.toISOString(),
        canPreview:
          item.mimeType === "application/pdf" ||
          item.mimeType.startsWith("image/"),
      })),
    status: row.status,
    revision: row.revision,
    submittedAt: row.submittedAt.toISOString(),
    score: row.score === null ? undefined : Number(row.score),
    rubricScores: serviceContext.rubricScores(row.rubricScores),
    feedback: row.feedback ?? undefined,
    gradedAt: row.gradedAt?.toISOString(),
    gradeHistory: row.gradeChanges?.map((change) => ({
      id: change.id,
      action: change.action,
      submissionRevision: change.submissionRevision,
      actorId: change.actorId,
      previousScore:
        change.previousScore === null
          ? undefined
          : Number(change.previousScore),
      nextScore: Number(change.nextScore),
      reason: change.reason ?? undefined,
      createdAt: change.createdAt.toISOString(),
    })),
  };
}

/** Chụp trạng thái bài tập trước thay đổi để lịch sử có thể đối soát độc lập. */
export function assignmentSnapshot(row: {
  title: string;
  description: string;
  instructions: string;
  dueAt: Date;
  maxScore: Prisma.Decimal;
  rubric: Prisma.JsonValue;
  status: string;
  version: number;
}): Prisma.InputJsonValue {
  return {
    title: row.title,
    description: row.description,
    instructions: row.instructions,
    dueAt: row.dueAt.toISOString(),
    maxScore: Number(row.maxScore),
    rubric: row.rubric as Prisma.InputJsonValue,
    status: row.status,
    version: row.version,
  };
}
