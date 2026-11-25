import type { Prisma } from "../../../../generated/prisma/client.js";
import { normalizeMultipartFileName } from "../../../../infrastructure/file-transfer.js";
import {
  AssignmentSubmissionView,
  AssignmentView,
  MappableSubmissionRow,
} from "../../academic/academic.shared.js";
import type { AcademicServiceContext } from "../../academic/academic.context.js";

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
  }> & {
    sourceMaterial?: { id: string; name: string; mimeType: string; sizeBytes: bigint } | null;
    _count?: { submissions: number };
  },
  submission?: Prisma.AssignmentSubmissionGetPayload<{
    include: {
      learner: { select: { displayName: true; email: true } };
      attachments: true;
    };
  }>,
): AssignmentView {
  return {
    hidden: row.hidden,
    id: row.id,
    classId: row.classId,
    classCode: row.class.code,
    title: row.title,
    sourceMaterial: row.sourceMaterial ? {
      id: row.sourceMaterial.id,
      name: row.sourceMaterial.name,
      mimeType: row.sourceMaterial.mimeType,
      sizeBytes: Number(row.sourceMaterial.sizeBytes),
    } : undefined,
    description: row.description,
    instructions: row.instructions,
    dueAt: row.dueAt.toISOString(),
    maxScore: Number(row.maxScore),
    rubric: serviceContext.rubric(row.rubric, Number(row.maxScore)),
    status: row.status,
    version: row.version,
    closedAt: row.closedAt?.toISOString(),
    closeReason: row.closeReason ?? undefined,
    createdById: row.createdById,
    submission: submission
      ? serviceContext.mapSubmission(submission)
      : undefined,
    submissionCount: row._count?.submissions,
    createdAt: row.createdAt.toISOString(),
  };
}

const PREVIEWABLE_ATTACHMENT_MIMES = new Set([
  "application/pdf",
  "text/plain",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);

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
        originalName: normalizeMultipartFileName(item.originalName),
        mimeType: item.mimeType,
        sizeBytes: Number(item.sizeBytes),
        createdAt: item.createdAt.toISOString(),
        canPreview:
          PREVIEWABLE_ATTACHMENT_MIMES.has(item.mimeType) ||
          item.mimeType.startsWith("image/"),
      })),
    status: row.status,
    revision: row.revision,
    submittedAt: row.submittedAt.toISOString(),
    score: row.score === null ? undefined : Number(row.score),
    rubricScores: serviceContext.rubricScores(row.rubricScores),
    feedback: row.feedback ?? undefined,
    gradedAt: row.gradedAt?.toISOString(),
  };
}
