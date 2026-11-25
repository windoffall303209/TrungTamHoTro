import type { Prisma } from "../../../generated/prisma/client.js";

export type {
  AcademicCalendarEvent,
  AssignmentAttachmentView,
  AssignmentSubmissionView,
  AssignmentView,
  AttachmentDocumentPreview,
  ClassAnnouncementView,
  GradebookAssessmentCell,
  GradebookAssessmentColumn,
  GradebookResponse,
  GradebookRow,
  GradingQueueGroup,
  RubricCriterion,
} from "@wind-of-fall/contracts";

export interface UploadedAssignmentFile {
  originalName: string;
  mimeType: string;
  size: number;
  buffer: Buffer;
  path?: string;
}

export type MappableSubmissionRow = Prisma.AssignmentSubmissionGetPayload<{
  include: {
    learner: { select: { displayName: true; email: true } };
    attachments: true;
  };
}>;
