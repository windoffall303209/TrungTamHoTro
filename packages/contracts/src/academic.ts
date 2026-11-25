import type { ByteSizeNumber, DecimalNumber, IsoDateTimeString } from "./primitives.js";

export interface RubricCriterion {
  id: string;
  title: string;
  description: string;
  maxPoints: DecimalNumber;
}

export interface AssignmentAttachmentView {
  id: string;
  originalName: string;
  mimeType: string;
  sizeBytes: ByteSizeNumber;
  createdAt: IsoDateTimeString;
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
  submittedAt: IsoDateTimeString;
  score?: DecimalNumber;
  rubricScores: Array<{ criterionId: string; score: DecimalNumber }>;
  feedback?: string;
  gradedAt?: IsoDateTimeString;
}

export interface AssignmentView {
  hidden?: boolean;
  id: string;
  classId: string;
  classCode: string;
  title: string;
  description: string;
  instructions: string;
  sourceMaterial?: {
    id: string;
    name: string;
    mimeType: string;
    sizeBytes: ByteSizeNumber;
  };
  dueAt: IsoDateTimeString;
  maxScore: DecimalNumber;
  rubric: RubricCriterion[];
  status: "DRAFT" | "PUBLISHED" | "CLOSED";
  version: number;
  closedAt?: IsoDateTimeString;
  closeReason?: string;
  createdById: string;
  submission?: AssignmentSubmissionView;
  submissionCount?: number;
  createdAt: IsoDateTimeString;
}

export interface AcademicCalendarEvent {
  id: string;
  classId: string;
  classCode: string;
  type: "CLASS" | "LIVE_SESSION" | "EXAM" | "ASSIGNMENT";
  title: string;
  startAt: IsoDateTimeString;
  endAt?: IsoDateTimeString;
  href: string;
}

export interface ClassAnnouncementView {
  id: string;
  classId: string;
  classCode: string;
  title: string;
  body: string;
  authorName: string;
  publishedAt: IsoDateTimeString;
}

export interface GradebookAssessmentColumn {
  id: string;
  kind: "EXAM" | "ASSIGNMENT";
  title: string;
  maxScore: DecimalNumber;
  dueAt?: IsoDateTimeString;
}

export interface GradebookAssessmentCell {
  assessmentId: string;
  kind?: "EXAM" | "ASSIGNMENT";
  score?: DecimalNumber | null;
  maxScore?: DecimalNumber;
  status: "GRADED" | "AWAITING_GRADE" | "IN_PROGRESS" | "NOT_SUBMITTED";
  attemptCount?: number;
}

export interface GradebookRow {
  learnerId: string;
  learnerName: string;
  learnerEmail: string | null;
  examEarned: DecimalNumber;
  examPossible: DecimalNumber;
  assignmentEarned: DecimalNumber;
  assignmentPossible: DecimalNumber;
  totalPercent: number;
  averageScore?: DecimalNumber | null;
  awaitingGrade: number;
  notSubmitted: number;
  assessments?: GradebookAssessmentColumn[];
  cells?: GradebookAssessmentCell[];
}

export interface GradebookResponse {
  assessments: GradebookAssessmentColumn[];
  rows: GradebookRow[];
}

export interface GradingQueueGroup {
  id: string;
  type: "ASSIGNMENT" | "EXAM";
  classId: string;
  classCode: string;
  grade?: number | null;
  subject?: string | null;
  title: string;
  maxScore: DecimalNumber;
  submittedCount: number;
  pendingCount: number;
  items: Array<{
    id: string;
    learnerId: string;
    learnerName: string;
    learnerEmail: string | null;
    status: "SUBMITTED" | "GRADED";
    submittedAt: IsoDateTimeString;
    revision?: number;
  }>;
}
