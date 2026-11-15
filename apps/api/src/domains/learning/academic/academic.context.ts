import type { AuthenticatedSession } from "../../../auth/auth.service.js";
import { PrismaService } from "../../../database/prisma.service.js";
import type { Prisma } from "../../../generated/prisma/client.js";
import { AntivirusService } from "../../../infrastructure/antivirus.service.js";
import { ObjectStorageService } from "../../../infrastructure/object-storage.service.js";
import type {
  AssignmentSubmissionView,
  AssignmentView,
  MappableSubmissionRow,
  RubricCriterion,
  UploadedAssignmentFile,
} from "./academic.shared.js";

/** Hợp đồng nội bộ của các nhóm nghiệp vụ; trạng thái vẫn thuộc một phiên bản service duy nhất. */
export interface AcademicServiceContext {
  prisma: PrismaService;
  objectStorage: ObjectStorageService;
  antivirus: AntivirusService;
  submitAssignment(
    assignmentId: string,
    content: string | undefined,
    session: AuthenticatedSession,
    files?: UploadedAssignmentFile[],
    expectedRevision?: number,
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
    }> & { sourceMaterial?: { id: string; name: string; mimeType: string; sizeBytes: bigint } | null },
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
