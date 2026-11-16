import type { Prisma } from "../../../generated/prisma/client.js";

export interface RubricCriterion {
  id: string;
  title: string;
  description: string;
  maxPoints: number;
}

export interface UploadedAssignmentFile {
  originalName: string;
  mimeType: string;
  size: number;
  buffer: Buffer;
}

interface AssignmentAttachmentView {
  id: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
  canPreview: boolean;
}

export interface AttachmentDocumentPreview {
  kind: "html" | "text" | "unsupported";
  fileName: string;
  mimeType: string;
  html?: string;
  text?: string;
  warnings: string[];
}


export interface AssignmentView {
  hidden?: boolean;
  id: string;
  classId: string;
  classCode: string;
  title: string;
  description: string;
  instructions: string;
  sourceMaterial?: { id: string; name: string; mimeType: string; sizeBytes: number };
  dueAt: string;
  maxScore: number;
  rubric: RubricCriterion[];
  status: "DRAFT" | "PUBLISHED" | "CLOSED";
  version: number;
  closedAt?: string;
  closeReason?: string;
  createdById: string;
  submission?: AssignmentSubmissionView;
  createdAt: string;
}

export interface AssignmentSubmissionView {
  id: string;
  assignmentId: string;
  learnerId: string;
  learnerName: string;
  learnerEmail: string | null;
  content: string;
  attachments: AssignmentAttachmentView[];
  status: "SUBMITTED" | "GRADED";
  revision: number;
  submittedAt: string;
  score?: number;
  rubricScores: Array<{ criterionId: string; score: number }>;
  feedback?: string;
  gradedAt?: string;
}

export interface AcademicCalendarEvent {
  id: string;
  classId: string;
  classCode: string;
  type: "CLASS" | "LIVE_SESSION" | "EXAM" | "ASSIGNMENT";
  title: string;
  startAt: string;
  endAt?: string;
  href: string;
}

export interface ClassAnnouncementView {
  id: string;
  classId: string;
  classCode: string;
  title: string;
  body: string;
  authorName: string;
  publishedAt: string;
}

export interface GradebookAssessmentColumn {
  id: string;
  kind: "EXAM" | "ASSIGNMENT";
  title: string;
  maxScore: number;
  dueAt?: string;
}

export interface GradebookAssessmentCell {
  assessmentId: string;
  kind: "EXAM" | "ASSIGNMENT";
  score: number | null;
  maxScore: number;
  status: "GRADED" | "AWAITING_GRADE" | "IN_PROGRESS" | "NOT_SUBMITTED";
  attemptCount?: number;
}

export interface GradebookRow {
  learnerId: string;
  learnerName: string;
  learnerEmail: string | null;
  examEarned: number;
  examPossible: number;
  assignmentEarned: number;
  assignmentPossible: number;
  totalPercent: number;
  averageScore?: number | null;
  awaitingGrade: number;
  notSubmitted: number;
  assessments?: GradebookAssessmentColumn[];
  cells?: GradebookAssessmentCell[];
}

export interface GradingQueueGroup {
  id: string;
  type: "ASSIGNMENT" | "EXAM";
  classId: string;
  classCode: string;
  grade?: number | null;
  subject?: string | null;
  title: string;
  maxScore: number;
  submittedCount: number;
  pendingCount: number;
  items: Array<{
    id: string;
    learnerId: string;
    learnerName: string;
    learnerEmail: string | null;
    status: "SUBMITTED" | "GRADED";
    submittedAt: string;
    revision?: number;
  }>;
}

export type MappableSubmissionRow = Prisma.AssignmentSubmissionGetPayload<{
  include: {
    learner: { select: { displayName: true; email: true } };
    attachments: true;
  };
}>;
