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

export interface AssignmentChangeView {
  id: string;
  action: string;
  actorId: string;
  reason?: string;
  fromVersion: number;
  toVersion: number;
  createdAt: string;
}

export interface AssignmentView {
  id: string;
  classId: string;
  classCode: string;
  title: string;
  description: string;
  instructions: string;
  dueAt: string;
  maxScore: number;
  rubric: RubricCriterion[];
  status: "DRAFT" | "PUBLISHED" | "CLOSED";
  version: number;
  closedAt?: string;
  closeReason?: string;
  createdById: string;
  submission?: AssignmentSubmissionView;
  changes?: AssignmentChangeView[];
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
  gradeHistory?: Array<{
    id: string;
    action: string;
    submissionRevision: number;
    actorId: string;
    previousScore?: number;
    nextScore: number;
    reason?: string;
    createdAt: string;
  }>;
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

export interface GradebookRow {
  learnerId: string;
  learnerName: string;
  learnerEmail: string | null;
  examEarned: number;
  examPossible: number;
  assignmentEarned: number;
  assignmentPossible: number;
  totalPercent: number;
  awaitingGrade: number;
  notSubmitted: number;
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

type AssignmentSubmissionRow = Prisma.AssignmentSubmissionGetPayload<{
  include: {
    learner: { select: { displayName: true; email: true } };
    attachments: true;
  };
}>;

type AssignmentSubmissionWithHistoryRow =
  Prisma.AssignmentSubmissionGetPayload<{
    include: {
      learner: { select: { displayName: true; email: true } };
      attachments: true;
      gradeChanges: true;
    };
  }>;

export type MappableSubmissionRow = AssignmentSubmissionRow &
  Partial<Pick<AssignmentSubmissionWithHistoryRow, "gradeChanges">>;
