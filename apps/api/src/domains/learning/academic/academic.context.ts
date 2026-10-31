import type { AuthenticatedSession } from "../../../auth/auth.service.js";
import { PrismaService } from "../../../database/prisma.service.js";
import type { Prisma } from "../../../generated/prisma/client.js";
import { AntivirusService } from "../../../infrastructure/antivirus.service.js";
import { ObjectStorageService } from "../../../infrastructure/object-storage.service.js";
import {
  AcademicCalendarEvent,
  AssignmentChangeView,
  AssignmentSubmissionView,
  AssignmentView,
  ClassAnnouncementView,
  GradebookRow,
  GradingQueueGroup,
  MappableSubmissionRow,
  RubricCriterion,
  UploadedAssignmentFile,
} from "./academic.shared.js";
import {
  type GradingAnswerSource,
  type GradingDocumentReader,
} from "../ai/ai-grading-source.js";

/** Hợp đồng nội bộ của các nhóm nghiệp vụ; trạng thái vẫn thuộc một phiên bản service duy nhất. */
export interface AcademicServiceContext {
  prisma: PrismaService;
  objectStorage: ObjectStorageService;
  antivirus: AntivirusService;
  listAssignments(
    session: AuthenticatedSession,
    classId?: string,
  ): Promise<AssignmentView[]>;
  createAssignment(
    classId: string,
    input: {
      title: string;
      description: string;
      instructions: string;
      dueAt: string;
      maxScore: number;
      rubric: Array<{ title: string; description: string; maxPoints: number }>;
    },
    session: AuthenticatedSession,
  ): Promise<AssignmentView>;
  updateAssignment(
    assignmentId: string,
    input: {
      title: string;
      description: string;
      instructions: string;
      dueAt: string;
      maxScore: number;
      rubric: Array<{ title: string; description: string; maxPoints: number }>;
      expectedVersion: number;
    },
    session: AuthenticatedSession,
  ): Promise<AssignmentView>;
  extendAssignment(
    assignmentId: string,
    dueAtValue: string,
    reason: string,
    expectedVersion: number,
    session: AuthenticatedSession,
  ): Promise<AssignmentView>;
  closeAssignment(
    assignmentId: string,
    reason: string,
    expectedVersion: number,
    session: AuthenticatedSession,
  ): Promise<AssignmentView>;
  assignmentHistory(
    assignmentId: string,
    session: AuthenticatedSession,
  ): Promise<AssignmentChangeView[]>;
  publishAssignment(
    assignmentId: string,
    session: AuthenticatedSession,
  ): Promise<AssignmentView>;
  submitAssignment(
    assignmentId: string,
    content: string | undefined,
    session: AuthenticatedSession,
    files?: UploadedAssignmentFile[],
    expectedRevision?: number,
  ): Promise<AssignmentSubmissionView>;
  addSubmissionAttachments(
    submissionId: string,
    files: UploadedAssignmentFile[],
    session: AuthenticatedSession,
  ): Promise<AssignmentSubmissionView>;
  removeSubmissionAttachment(
    submissionId: string,
    attachmentId: string,
    expectedRevision: number,
    session: AuthenticatedSession,
  ): Promise<AssignmentSubmissionView>;
  readSubmissionAttachment(
    submissionId: string,
    attachmentId: string,
    session: AuthenticatedSession,
    expectedRevision?: number,
  ): Promise<{
    buffer: Buffer;
    fileName: string;
    mimeType: string;
    checksum: string;
    submissionRevision: number;
  }>;
  listSubmissions(
    assignmentId: string,
    session: AuthenticatedSession,
  ): Promise<AssignmentSubmissionView[]>;
  gradingAiContext(
    submissionId: string,
    expectedSubmissionRevision: number,
    session: AuthenticatedSession,
    readDocument?: GradingDocumentReader,
  ): Promise<{
    submissionId: string;
    submissionRevision: number;
    assignmentVersion: number;
    instructions: string;
    answer: string;
    rubric: RubricCriterion[];
    sources?: GradingAnswerSource[];
  }>;
  gradeSubmission(
    submissionId: string,
    rubricScores: Array<{ criterionId: string; score: number }>,
    feedback: string,
    expectedSubmissionRevision: number,
    correctionReason: string | undefined,
    session: AuthenticatedSession,
  ): Promise<AssignmentSubmissionView>;
  gradebook(
    classId: string,
    session: AuthenticatedSession,
  ): Promise<GradebookRow[]>;
  gradingQueue(
    session: AuthenticatedSession,
    classId?: string,
  ): Promise<GradingQueueGroup[]>;
  calendar(
    session: AuthenticatedSession,
    classId?: string,
  ): Promise<AcademicCalendarEvent[]>;
  listAnnouncements(
    session: AuthenticatedSession,
    classId?: string,
  ): Promise<ClassAnnouncementView[]>;
  createAnnouncement(
    classId: string,
    title: string,
    body: string,
    session: AuthenticatedSession,
  ): Promise<ClassAnnouncementView>;
  accessibleClassIds(session: AuthenticatedSession): Promise<string[]>;
  requireTeachingAccess(
    classId: string,
    session: AuthenticatedSession,
    requireWritable?: boolean,
  ): Promise<void>;
  mapAssignment(
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
  ): AssignmentView;
  mapSubmission(row: MappableSubmissionRow): AssignmentSubmissionView;
  assignmentSnapshot(row: {
    title: string;
    description: string;
    instructions: string;
    dueAt: Date;
    maxScore: Prisma.Decimal;
    rubric: Prisma.JsonValue;
    status: string;
    version: number;
  }): Prisma.InputJsonValue;
  validateAssignmentFiles(files: UploadedAssignmentFile[]): void;
  rubric(value: Prisma.JsonValue): RubricCriterion[];
  rubricScores(
    value: Prisma.JsonValue | null,
  ): Array<{ criterionId: string; score: number }>;
}
