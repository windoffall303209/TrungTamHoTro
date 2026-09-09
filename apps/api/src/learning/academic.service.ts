import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import type { AuthenticatedSession } from "../auth/auth.service.js";
import type { Prisma } from "../generated/prisma/client.js";
import { PrismaService } from "../database/prisma.service.js";
import { AntivirusService } from "../infrastructure/antivirus.service.js";
import { ObjectStorageService } from "../infrastructure/object-storage.service.js";
import { combineGradingSources, decodeGradingText, GRADING_TEXT_BYTE_LIMIT, isGradingDocument, type GradingAnswerSource, type GradingDocumentReader } from "./ai-grading-source.js";
import { validateGradingDefinition } from "../system/ai-grading-suggestion.js";

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
export interface AssignmentAttachmentView {
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
  learnerEmail: string;
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
  learnerEmail: string;
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
  title: string;
  maxScore: number;
  submittedCount: number;
  pendingCount: number;
  items: Array<{
    id: string;
    learnerId: string;
    learnerName: string;
    learnerEmail: string;
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
type MappableSubmissionRow = AssignmentSubmissionRow &
  Partial<Pick<AssignmentSubmissionWithHistoryRow, "gradeChanges">>;

@Injectable()
/** Thực thi nghiệp vụ bài tập, tệp bài nộp, sổ điểm, lịch và thông báo trên Prisma. */
export class AcademicService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly objectStorage: ObjectStorageService,
    private readonly antivirus: AntivirusService,
  ) {}

  /** Lọc bài tập theo lớp truy cập được và chỉ gắn bài nộp của chính học viên. */
  async listAssignments(
    session: AuthenticatedSession,
    classId?: string,
  ): Promise<AssignmentView[]> {
    const classIds = await this.accessibleClassIds(session);
    if (classId && !classIds.includes(classId))
      throw new NotFoundException(
        "Không tìm thấy lớp học trong phạm vi truy cập.",
      );
    const rows = await this.prisma.assignment.findMany({
      where: {
        classId: classId ?? { in: classIds },
        ...(session.roleCode === "LEARNER"
          ? { status: { in: ["PUBLISHED", "CLOSED"] } }
          : {}),
      },
      include: {
        class: { select: { code: true } },
        submissions: {
          where: { learnerId: session.user.id },
          include: {
            learner: { select: { displayName: true, email: true } },
            attachments: { orderBy: { createdAt: "asc" } },
          },
        },
      },
      orderBy: { dueAt: "asc" },
    });
    return rows.map((row) => this.mapAssignment(row, row.submissions[0]));
  }

  /** Kiểm tra quyền dạy, đối chiếu tổng rubric và tạo bài tập ở trạng thái nháp. */
  async createAssignment(
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
  ): Promise<AssignmentView> {
    await this.requireTeachingAccess(classId, session, true);
    const dueAt = new Date(input.dueAt);
    if (dueAt <= new Date())
      throw new BadRequestException("Hạn nộp phải nằm trong tương lai.");
    const classWindow = await this.prisma.learningClass.findUnique({
      where: { id: classId },
      select: { endAt: true },
    });
    if (!classWindow || dueAt > classWindow.endAt)
      throw new BadRequestException(
        "Hạn nộp phải nằm trong thời gian của lớp.",
      );
    const total = input.rubric.reduce((sum, item) => sum + item.maxPoints, 0);
    if (Math.abs(total - input.maxScore) > 0.001)
      throw new BadRequestException(
        "Tổng điểm rubric phải bằng điểm tối đa của bài tập.",
      );
    const rubric: RubricCriterion[] = input.rubric.map((item) => ({
      id: `criterion-${randomUUID()}`,
      title: item.title.trim(),
      description: item.description.trim(),
      maxPoints: item.maxPoints,
    }));
    const row = await this.prisma.assignment.create({
      data: {
        id: `assignment-${randomUUID()}`,
        classId,
        createdById: session.user.id,
        title: input.title.trim(),
        description: input.description.trim(),
        instructions: input.instructions.trim(),
        dueAt,
        maxScore: input.maxScore,
        rubric: rubric as unknown as Prisma.InputJsonValue,
      },
      include: {
        class: { select: { code: true } },
        submissions: {
          include: {
            learner: { select: { displayName: true, email: true } },
            attachments: true,
          },
        },
      },
    });
    return this.mapAssignment(row);
  }

  /** Sửa nội dung bài nháp bằng khóa phiên bản để không ghi đè thay đổi của người khác. */
  async updateAssignment(
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
  ): Promise<AssignmentView> {
    const current = await this.prisma.assignment.findUnique({
      where: { id: assignmentId },
      include: { class: { select: { code: true, endAt: true } } },
    });
    if (!current) throw new NotFoundException("Không tìm thấy bài tập.");
    await this.requireTeachingAccess(current.classId, session, true);
    if (current.status !== "DRAFT")
      throw new ConflictException(
        "Chỉ bài tập nháp mới được sửa nội dung và rubric.",
      );
    const dueAt = new Date(input.dueAt);
    if (dueAt <= new Date() || dueAt > current.class.endAt)
      throw new BadRequestException(
        "Hạn nộp phải ở tương lai và nằm trong thời gian lớp.",
      );
    const total = input.rubric.reduce((sum, item) => sum + item.maxPoints, 0);
    if (Math.abs(total - input.maxScore) > 0.001)
      throw new BadRequestException(
        "Tổng điểm rubric phải bằng điểm tối đa của bài tập.",
      );
    const previousRubric = this.rubric(current.rubric);
    const rubric: RubricCriterion[] = input.rubric.map((item, index) => ({
      id: previousRubric[index]?.id ?? `criterion-${randomUUID()}`,
      title: item.title.trim(),
      description: item.description.trim(),
      maxPoints: item.maxPoints,
    }));
    return this.prisma.$transaction(async (transaction) => {
      const result = await transaction.assignment.updateMany({
        where: {
          id: assignmentId,
          status: "DRAFT",
          version: input.expectedVersion,
        },
        data: {
          title: input.title.trim(),
          description: input.description.trim(),
          instructions: input.instructions.trim(),
          dueAt,
          maxScore: input.maxScore,
          rubric: rubric as unknown as Prisma.InputJsonValue,
          version: { increment: 1 },
        },
      });
      if (result.count !== 1)
        throw new ConflictException(
          "Bài tập đã thay đổi ở nơi khác. Hãy tải lại trước khi lưu.",
        );
      const updated = await transaction.assignment.findUniqueOrThrow({
        where: { id: assignmentId },
        include: {
          class: { select: { code: true } },
          submissions: {
            include: {
              learner: { select: { displayName: true, email: true } },
              attachments: true,
            },
          },
        },
      });
      await transaction.assignmentChange.create({
        data: {
          id: `assignment-change-${randomUUID()}`,
          assignmentId,
          actorId: session.user.id,
          action: "DRAFT_UPDATED",
          fromVersion: current.version,
          toVersion: updated.version,
          snapshot: this.assignmentSnapshot(current),
        },
      });
      return this.mapAssignment(updated);
    });
  }

  /** Gia hạn bài đã công bố, ghi lịch sử và thông báo lại cho toàn bộ học viên đang học. */
  async extendAssignment(
    assignmentId: string,
    dueAtValue: string,
    reason: string,
    expectedVersion: number,
    session: AuthenticatedSession,
  ): Promise<AssignmentView> {
    const current = await this.prisma.assignment.findUnique({
      where: { id: assignmentId },
      include: { class: { select: { code: true, endAt: true } } },
    });
    if (!current) throw new NotFoundException("Không tìm thấy bài tập.");
    await this.requireTeachingAccess(current.classId, session, true);
    if (current.status !== "PUBLISHED")
      throw new ConflictException("Chỉ bài tập đang mở mới được gia hạn.");
    const dueAt = new Date(dueAtValue);
    if (dueAt <= current.dueAt || dueAt > current.class.endAt)
      throw new BadRequestException(
        "Hạn mới phải muộn hơn hạn hiện tại và không vượt ngày kết thúc lớp.",
      );
    return this.prisma.$transaction(async (transaction) => {
      const result = await transaction.assignment.updateMany({
        where: {
          id: assignmentId,
          status: "PUBLISHED",
          version: expectedVersion,
        },
        data: { dueAt, version: { increment: 1 } },
      });
      if (result.count !== 1)
        throw new ConflictException(
          "Bài tập đã thay đổi ở nơi khác. Hãy tải lại trước khi gia hạn.",
        );
      const updated = await transaction.assignment.findUniqueOrThrow({
        where: { id: assignmentId },
        include: {
          class: { select: { code: true } },
          submissions: {
            include: {
              learner: { select: { displayName: true, email: true } },
              attachments: true,
            },
          },
        },
      });
      await transaction.assignmentChange.create({
        data: {
          id: `assignment-change-${randomUUID()}`,
          assignmentId,
          actorId: session.user.id,
          action: "DUE_DATE_EXTENDED",
          reason: reason.trim(),
          fromVersion: current.version,
          toVersion: updated.version,
          snapshot: this.assignmentSnapshot(current),
        },
      });
      const learners = await transaction.classEnrollment.findMany({
        where: { classId: current.classId, status: "ACTIVE" },
        select: { learnerId: true },
      });
      if (learners.length)
        await transaction.notification.createMany({
          data: learners.map(({ learnerId }) => ({
            id: `notification-${randomUUID()}`,
            recipientId: learnerId,
            type: "ASSIGNMENT_EXTENDED",
            title: `Gia hạn bài ${current.title} đến ${dueAt.toLocaleString("vi-VN")}`,
            entityType: "ASSIGNMENT",
            entityId: assignmentId,
            dedupKey: `assignment-extended:${assignmentId}:${updated.version}:${learnerId}`,
          })),
        });
      return this.mapAssignment(updated);
    });
  }

  /** Đóng bài sớm bằng cập nhật có điều kiện và bảo toàn lý do trong lịch sử. */
  async closeAssignment(
    assignmentId: string,
    reason: string,
    expectedVersion: number,
    session: AuthenticatedSession,
  ): Promise<AssignmentView> {
    const current = await this.prisma.assignment.findUnique({
      where: { id: assignmentId },
    });
    if (!current) throw new NotFoundException("Không tìm thấy bài tập.");
    await this.requireTeachingAccess(current.classId, session, true);
    if (current.status !== "PUBLISHED")
      throw new ConflictException("Chỉ bài tập đang mở mới được đóng.");
    return this.prisma.$transaction(async (transaction) => {
      const closedAt = new Date();
      const result = await transaction.assignment.updateMany({
        where: {
          id: assignmentId,
          status: "PUBLISHED",
          version: expectedVersion,
        },
        data: {
          status: "CLOSED",
          closedAt,
          closedById: session.user.id,
          closeReason: reason.trim(),
          version: { increment: 1 },
        },
      });
      if (result.count !== 1)
        throw new ConflictException(
          "Bài tập đã thay đổi ở nơi khác. Hãy tải lại trước khi đóng.",
        );
      const updated = await transaction.assignment.findUniqueOrThrow({
        where: { id: assignmentId },
        include: {
          class: { select: { code: true } },
          submissions: {
            include: {
              learner: { select: { displayName: true, email: true } },
              attachments: true,
            },
          },
        },
      });
      await transaction.assignmentChange.create({
        data: {
          id: `assignment-change-${randomUUID()}`,
          assignmentId,
          actorId: session.user.id,
          action: "CLOSED",
          reason: reason.trim(),
          fromVersion: current.version,
          toVersion: updated.version,
          snapshot: this.assignmentSnapshot(current),
        },
      });
      return this.mapAssignment(updated);
    });
  }

  /** Trả lịch sử thay đổi bài tập cho người dạy có quyền trên lớp. */
  async assignmentHistory(
    assignmentId: string,
    session: AuthenticatedSession,
  ): Promise<AssignmentChangeView[]> {
    const assignment = await this.prisma.assignment.findUnique({
      where: { id: assignmentId },
    });
    if (!assignment) throw new NotFoundException("Không tìm thấy bài tập.");
    await this.requireTeachingAccess(assignment.classId, session);
    const rows = await this.prisma.assignmentChange.findMany({
      where: { assignmentId },
      orderBy: { createdAt: "desc" },
    });
    return rows.map((row) => ({
      id: row.id,
      action: row.action,
      actorId: row.actorId,
      reason: row.reason ?? undefined,
      fromVersion: row.fromVersion,
      toVersion: row.toVersion,
      createdAt: row.createdAt.toISOString(),
    }));
  }

  /** Chuyển bài tập sang PUBLISHED sau khi xác nhận quyền phụ trách lớp. */
  async publishAssignment(
    assignmentId: string,
    session: AuthenticatedSession,
  ): Promise<AssignmentView> {
    const current = await this.prisma.assignment.findUnique({
      where: { id: assignmentId },
    });
    if (!current) throw new NotFoundException("Không tìm thấy bài tập.");
    await this.requireTeachingAccess(current.classId, session, true);
    if (current.status !== "DRAFT")
      throw new ConflictException("Chỉ bài tập nháp mới có thể xuất bản.");
    const classWindow = await this.prisma.learningClass.findUnique({
      where: { id: current.classId },
      select: { startAt: true, endAt: true },
    });
    if (
      !classWindow ||
      current.dueAt <= new Date() ||
      current.dueAt > classWindow.endAt
    )
      throw new ConflictException(
        "Hạn nộp không còn hợp lệ để xuất bản bài tập.",
      );
    const row = await this.prisma.$transaction(async (transaction) => {
      const changed = await transaction.assignment.updateMany({
        where: { id: assignmentId, status: "DRAFT", version: current.version },
        data: { status: "PUBLISHED", version: { increment: 1 } },
      });
      if (changed.count !== 1)
        throw new ConflictException(
          "Bài tập đã thay đổi ở nơi khác. Hãy tải lại trước khi công bố.",
        );
      const updated = await transaction.assignment.findUniqueOrThrow({
        where: { id: assignmentId },
        include: {
          class: { select: { code: true } },
          submissions: {
            include: {
              learner: { select: { displayName: true, email: true } },
              attachments: true,
            },
          },
        },
      });
      await transaction.assignmentChange.create({
        data: {
          id: `assignment-change-${randomUUID()}`,
          assignmentId,
          actorId: session.user.id,
          action: "PUBLISHED",
          fromVersion: current.version,
          toVersion: updated.version,
          snapshot: this.assignmentSnapshot(current),
        },
      });
      const learners = await transaction.classEnrollment.findMany({
        where: { classId: current.classId, status: "ACTIVE" },
        select: { learnerId: true },
      });
      if (learners.length)
        await transaction.notification.createMany({
          data: learners.map(({ learnerId }) => ({
            id: `notification-${randomUUID()}`,
            recipientId: learnerId,
            type: "ASSIGNMENT_PUBLISHED",
            title: `Bài tập mới: ${current.title}`,
            entityType: "ASSIGNMENT",
            entityId: assignmentId,
            dedupKey: `assignment-published:${assignmentId}:${learnerId}`,
          })),
        });
      return updated;
    });
    return this.mapAssignment(row);
  }

  /** Quét/lưu tệp trước khi upsert bài nộp và dọn object mới nếu transaction thất bại. */
  async submitAssignment(
    assignmentId: string,
    content: string | undefined,
    session: AuthenticatedSession,
    files: UploadedAssignmentFile[] = [],
    expectedRevision?: number,
  ): Promise<AssignmentSubmissionView> {
    if (session.roleCode !== "LEARNER")
      throw new ForbiddenException("Chỉ học viên được nộp bài.");
    this.validateAssignmentFiles(files);
    const assignment = await this.prisma.assignment.findUnique({
      where: { id: assignmentId },
      include: {
        class: {
          include: {
            enrollments: {
              where: { learnerId: session.user.id, status: "ACTIVE" },
            },
          },
        },
      },
    });
    if (
      !assignment ||
      !assignment.class.enrollments.length ||
      assignment.class.status === "CLOSED" ||
      assignment.status !== "PUBLISHED"
    )
      throw new NotFoundException(
        "Không tìm thấy bài tập đang mở trong lớp của bạn.",
      );
    if (assignment.dueAt < new Date())
      throw new ConflictException("Bài tập đã hết hạn nộp.");
    const existing = await this.prisma.assignmentSubmission.findUnique({
      where: {
        assignmentId_learnerId: { assignmentId, learnerId: session.user.id },
      },
      include: { attachments: { where: { removedAt: null } } },
    });
    if (existing?.status === "GRADED")
      throw new ConflictException("Bài đã chấm không thể nộp lại.");
    if (existing && expectedRevision !== existing.revision)
      throw new ConflictException(
        "Bài nộp đã thay đổi ở nơi khác. Hãy tải lại trước khi nộp.",
      );
    if (!existing && expectedRevision !== undefined && expectedRevision !== 0)
      throw new ConflictException(
        "Bài nộp chưa tồn tại nhưng phiên bản gửi lên không hợp lệ.",
      );
    if ((existing?.attachments.length ?? 0) + files.length > 5)
      throw new BadRequestException("Mỗi bài nộp được đính kèm tối đa 5 tệp.");
    const normalizedContent = (content ?? existing?.content ?? "").trim();
    if (
      !normalizedContent &&
      !(existing?.attachments.length ?? 0) &&
      !files.length
    )
      throw new BadRequestException(
        "Cần nhập nội dung hoặc đính kèm ít nhất một tệp.",
      );

    const stored: Array<
      UploadedAssignmentFile & { objectKey: string; checksum: string }
    > = [];
    try {
      for (const file of files) {
        const scan = await this.antivirus.scan(file.buffer);
        if (!scan.clean)
          throw new BadRequestException(
            `Tệp ${file.originalName} không an toàn và đã bị từ chối.`,
          );
        const saved = await this.objectStorage.put(
          `assignment-submissions/${session.user.id}/${randomUUID()}`,
          file.buffer,
        );
        stored.push({ ...file, ...saved });
      }
      const row = await this.prisma.$transaction(async (transaction) => {
        const submittedAt = new Date();
        let submission;
        if (existing) {
          const updated = await transaction.assignmentSubmission.updateMany({
            where: {
              id: existing.id,
              revision: existing.revision,
              status: "SUBMITTED",
            },
            data: {
              content: normalizedContent,
              submittedAt,
              revision: { increment: 1 },
            },
          });
          if (updated.count !== 1)
            throw new ConflictException(
              "Bài nộp vừa thay đổi hoặc đã được chấm. Hãy tải lại.",
            );
          submission = await transaction.assignmentSubmission.findUniqueOrThrow(
            { where: { id: existing.id } },
          );
        } else {
          submission = await transaction.assignmentSubmission.create({
            data: {
              id: `submission-${randomUUID()}`,
              assignmentId,
              learnerId: session.user.id,
              content: normalizedContent,
              submittedAt,
              revision: 1,
            },
          });
        }
        if (stored.length)
          await transaction.assignmentSubmissionAttachment.createMany({
            data: stored.map((file) => ({
              id: `submission-file-${randomUUID()}`,
              submissionId: submission.id,
              objectKey: file.objectKey,
              originalName: file.originalName,
              mimeType: file.mimeType,
              sizeBytes: file.size,
              checksum: file.checksum,
            })),
          });
        const complete =
          await transaction.assignmentSubmission.findUniqueOrThrow({
            where: { id: submission.id },
            include: {
              learner: { select: { displayName: true, email: true } },
              attachments: {
                where: { removedAt: null },
                orderBy: { createdAt: "asc" },
              },
            },
          });
        await transaction.assignmentSubmissionRevision.create({
          data: {
            id: `submission-revision-${randomUUID()}`,
            submissionId: complete.id,
            revision: complete.revision,
            content: complete.content,
            attachments: complete.attachments.map((file) => ({
              id: file.id,
              objectKey: file.objectKey,
              originalName: file.originalName,
              mimeType: file.mimeType,
              sizeBytes: file.sizeBytes.toString(),
              checksum: file.checksum,
            })) as unknown as Prisma.InputJsonValue,
            submittedAt: complete.submittedAt,
          },
        });
        return complete;
      });
      return this.mapSubmission(row);
    } catch (error) {
      await Promise.allSettled(
        stored.map((file) => this.objectStorage.remove(file.objectKey)),
      );
      throw error;
    }
  }

  /** Bổ sung tệp bằng cách dùng lại luồng submit và giữ nội dung hiện có. */
  async addSubmissionAttachments(
    submissionId: string,
    files: UploadedAssignmentFile[],
    session: AuthenticatedSession,
  ): Promise<AssignmentSubmissionView> {
    if (!files.length)
      throw new BadRequestException("Cần chọn ít nhất một tệp.");
    const submission = await this.prisma.assignmentSubmission.findUnique({
      where: { id: submissionId },
    });
    if (!submission || submission.learnerId !== session.user.id)
      throw new NotFoundException("Không tìm thấy bài nộp của bạn.");
    return this.submitAssignment(
      submission.assignmentId,
      undefined,
      session,
      files,
      submission.revision,
    );
  }

  /** Kiểm tra chủ sở hữu, xóa bản ghi tệp rồi dọn object khỏi storage. */
  async removeSubmissionAttachment(
    submissionId: string,
    attachmentId: string,
    expectedRevision: number,
    session: AuthenticatedSession,
  ): Promise<AssignmentSubmissionView> {
    if (session.roleCode !== "LEARNER")
      throw new ForbiddenException("Chỉ học viên được sửa tệp bài nộp.");
    const submission = await this.prisma.assignmentSubmission.findUnique({
      where: { id: submissionId },
      include: {
        assignment: { include: { class: true } },
        attachments: { where: { removedAt: null } },
      },
    });
    if (!submission || submission.learnerId !== session.user.id)
      throw new NotFoundException("Không tìm thấy bài nộp của bạn.");
    if (submission.assignment.class.status === "CLOSED")
      throw new ConflictException("Lớp đã lưu trữ và chỉ cho phép đọc.");
    if (submission.status === "GRADED")
      throw new ConflictException("Bài đã chấm không thể sửa tệp.");
    if (submission.assignment.dueAt < new Date())
      throw new ConflictException("Bài tập đã hết hạn chỉnh sửa.");
    const attachment = submission.attachments.find(
      (item) => item.id === attachmentId,
    );
    if (!attachment)
      throw new NotFoundException("Không tìm thấy tệp đính kèm.");
    if (!submission.content.trim() && submission.attachments.length === 1)
      throw new BadRequestException(
        "Bài nộp phải còn nội dung hoặc ít nhất một tệp.",
      );
    if (submission.revision !== expectedRevision)
      throw new ConflictException(
        "Bài nộp đã thay đổi ở nơi khác. Hãy tải lại trước khi xóa tệp.",
      );
    const row = await this.prisma.$transaction(async (transaction) => {
      const changed = await transaction.assignmentSubmission.updateMany({
        where: {
          id: submissionId,
          revision: expectedRevision,
          status: "SUBMITTED",
        },
        data: { revision: { increment: 1 }, submittedAt: new Date() },
      });
      if (changed.count !== 1)
        throw new ConflictException(
          "Bài nộp vừa thay đổi hoặc đã được chấm. Hãy tải lại.",
        );
      await transaction.assignmentSubmissionAttachment.update({
        where: { id: attachmentId },
        data: {
          removedAt: new Date(),
          removedById: session.user.id,
          removalError: null,
        },
      });
      const complete = await transaction.assignmentSubmission.findUniqueOrThrow(
        {
          where: { id: submissionId },
          include: {
            learner: { select: { displayName: true, email: true } },
            attachments: {
              where: { removedAt: null },
              orderBy: { createdAt: "asc" },
            },
          },
        },
      );
      await transaction.assignmentSubmissionRevision.create({
        data: {
          id: `submission-revision-${randomUUID()}`,
          submissionId,
          revision: complete.revision,
          content: complete.content,
          attachments: complete.attachments.map((file) => ({
            id: file.id,
            objectKey: file.objectKey,
            originalName: file.originalName,
            mimeType: file.mimeType,
            sizeBytes: file.sizeBytes.toString(),
            checksum: file.checksum,
          })) as unknown as Prisma.InputJsonValue,
          submittedAt: complete.submittedAt,
        },
      });
      return complete;
    });
    try {
      await this.objectStorage.remove(attachment.objectKey);
    } catch (error) {
      await this.prisma.assignmentSubmissionAttachment.update({
        where: { id: attachmentId },
        data: {
          removalError:
            error instanceof Error
              ? error.message.slice(0, 2000)
              : "Không xóa được object; cần retry.",
        },
      });
    }
    return this.mapSubmission(row);
  }

  /** Đọc bytes bất biến có checksum; tái kiểm tra nguồn và quyền sau khi tải từ kho. */
  async readSubmissionAttachment(
    submissionId: string,
    attachmentId: string,
    session: AuthenticatedSession,
    expectedRevision?: number,
  ): Promise<{ buffer: Buffer; fileName: string; mimeType: string; checksum: string; submissionRevision: number }> {
    if (expectedRevision !== undefined && (!Number.isInteger(expectedRevision) || expectedRevision < 1)) throw new BadRequestException("Phiên bản bài nộp không hợp lệ.");
    const attachment =
      await this.prisma.assignmentSubmissionAttachment.findFirst({
        where: { id: attachmentId, submissionId, removedAt: null },
        include: { submission: { include: { assignment: true } } },
      });
    if (!attachment)
      throw new NotFoundException("Không tìm thấy tệp đính kèm.");
    if (session.roleCode === "LEARNER") {
      if (attachment.submission.learnerId !== session.user.id)
        throw new NotFoundException("Không tìm thấy tệp đính kèm.");
    } else {
      await this.requireTeachingAccess(
        attachment.submission.assignment.classId,
        session,
      );
    }
    if (expectedRevision !== undefined && attachment.submission.revision !== expectedRevision) throw new ConflictException("Học viên đã nộp phiên bản mới. Hãy tải lại bài trước khi chấm.");
    const buffer = await this.objectStorage.get(attachment.objectKey);
    const checksum = `sha256:${createHash("sha256").update(buffer).digest("hex")}`;
    if (BigInt(buffer.length) !== attachment.sizeBytes || checksum !== attachment.checksum) throw new ConflictException("Tệp bài nộp không khớp bản đã lưu. Không thể sử dụng nội dung; hãy liên hệ quản trị viên.");
    const current = await this.prisma.assignmentSubmissionAttachment.findFirst({
      where: { id: attachmentId, submissionId, removedAt: null },
      include: { submission: { include: { assignment: true } } },
    });
    if (!current) throw new NotFoundException("Không tìm thấy tệp đính kèm.");
    if (session.roleCode === "LEARNER") {
      if (current.submission.learnerId !== session.user.id) throw new NotFoundException("Không tìm thấy tệp đính kèm.");
    } else await this.requireTeachingAccess(current.submission.assignment.classId, session);
    if (current.objectKey !== attachment.objectKey || current.checksum !== checksum || current.sizeBytes !== attachment.sizeBytes || current.originalName !== attachment.originalName || current.mimeType !== attachment.mimeType || current.submission.revision !== attachment.submission.revision || current.submission.learnerId !== attachment.submission.learnerId || current.submission.assignment.classId !== attachment.submission.assignment.classId || current.submission.assignment.version !== attachment.submission.assignment.version) throw new ConflictException("Bài nộp hoặc tệp đã thay đổi trong lúc tải. Hãy mở lại bài nộp.");
    return {
      buffer,
      fileName: attachment.originalName,
      mimeType: attachment.mimeType,
      checksum,
      submissionRevision: attachment.submission.revision,
    };
  }

  /** Liệt kê mọi bài nộp sau khi kiểm tra quyền giảng dạy. */
  async listSubmissions(
    assignmentId: string,
    session: AuthenticatedSession,
  ): Promise<AssignmentSubmissionView[]> {
    const assignment = await this.prisma.assignment.findUnique({
      where: { id: assignmentId },
    });
    if (!assignment) throw new NotFoundException("Không tìm thấy bài tập.");
    await this.requireTeachingAccess(assignment.classId, session);
    const rows = await this.prisma.assignmentSubmission.findMany({
      where: { assignmentId },
      include: {
        learner: { select: { displayName: true, email: true } },
        attachments: {
          where: { removedAt: null },
          orderBy: { createdAt: "asc" },
        },
        gradeChanges: { orderBy: { createdAt: "desc" } },
      },
      orderBy: { submittedAt: "asc" },
    });
    return rows.map((row) => this.mapSubmission(row));
  }

  /** Lấy đúng bài nộp và rubric cho AI, không đưa tên/email hoặc điểm cũ vào ngữ cảnh chấm. */
  async gradingAiContext(submissionId: string, expectedSubmissionRevision: number, session: AuthenticatedSession, readDocument?: GradingDocumentReader): Promise<{ submissionId: string; submissionRevision: number; assignmentVersion: number; instructions: string; answer: string; rubric: RubricCriterion[]; sources?: GradingAnswerSource[] }> {
    if (!Number.isInteger(expectedSubmissionRevision) || expectedSubmissionRevision < 1) throw new BadRequestException("Phiên bản bài nộp không hợp lệ.");
    const submission = await this.prisma.assignmentSubmission.findUnique({ where: { id: submissionId }, include: { assignment: true, attachments: { where: { removedAt: null }, orderBy: { id: "asc" }, select: { id: true, originalName: true, mimeType: true, checksum: true, sizeBytes: true } } } });
    if (!submission) throw new NotFoundException("Không tìm thấy bài nộp.");
    await this.requireTeachingAccess(submission.assignment.classId, session, true);
    if (submission.revision !== expectedSubmissionRevision) throw new ConflictException("Học viên đã nộp phiên bản mới. Hãy tải lại bài trước khi chấm.");
    const base = { submissionId: submission.id, submissionRevision: submission.revision, assignmentVersion: submission.assignment.version, instructions: [submission.assignment.title, submission.assignment.description, submission.assignment.instructions].join("\n\n"), answer: submission.content, rubric: this.rubric(submission.assignment.rubric) };
    validateGradingDefinition({ instructions: base.instructions, rubric: submission.assignment.rubric });
    if (!submission.attachments.length) {
      if (!submission.content.trim()) throw new BadRequestException("Bài nộp chưa có nội dung văn bản để gợi ý chấm.");
      return base;
    }
    if (submission.attachments.length > 5 || submission.attachments.some((file) => !(file.mimeType === "text/plain" && /\.txt$/i.test(file.originalName)) && !(readDocument && isGradingDocument(file.mimeType, file.originalName)))) throw new BadRequestException("Chấm AI hiện hỗ trợ văn bản và tệp TXT UTF-8. Hãy chấm thủ công các định dạng khác để không bỏ sót nội dung tệp.");
    if (submission.attachments.some((file) => file.mimeType === "text/plain" && (file.sizeBytes <= 0n || file.sizeBytes > BigInt(GRADING_TEXT_BYTE_LIMIT)))) throw new BadRequestException("Tệp TXT cho chấm AI phải có nội dung và không vượt quá 80.000 byte.");
    if (submission.attachments.some((file) => file.sizeBytes <= 0n || file.sizeBytes > 12n * 1024n * 1024n) || submission.attachments.reduce((sum, file) => sum + file.sizeBytes, 0n) > 24n * 1024n * 1024n) throw new BadRequestException("Tệp trích xuất cho chấm AI phải từ 1 byte đến 12 MB, tổng không quá 24 MB.");
    const sources: GradingAnswerSource[] = submission.content.trim() ? [{ attachmentId: null, name: "Nội dung bài làm", checksum: null, text: submission.content }] : [];
    for (const file of submission.attachments) {
      const verified = await this.readSubmissionAttachment(submissionId, file.id, session, expectedSubmissionRevision);
      if (verified.checksum !== file.checksum || verified.fileName !== file.originalName || verified.mimeType !== file.mimeType) throw new ConflictException("Bài nộp hoặc tệp đã thay đổi trong lúc tải. Hãy mở lại bài nộp.");
      const text = verified.mimeType === "text/plain" ? decodeGradingText(verified.buffer) : decodeGradingText(Buffer.from(await readDocument!({ ...verified, attachmentId: file.id }), "utf8"));
      sources.push({ attachmentId: file.id, name: verified.fileName, checksum: verified.checksum, text });
    }
    const answer = combineGradingSources(sources);
    const current = await this.prisma.assignmentSubmission.findUnique({ where: { id: submissionId }, include: { assignment: true, attachments: { where: { removedAt: null }, orderBy: { id: "asc" }, select: { id: true, originalName: true, mimeType: true, checksum: true, sizeBytes: true } } } });
    if (!current) throw new NotFoundException("Không tìm thấy bài nộp.");
    await this.requireTeachingAccess(current.assignment.classId, session, true);
    const sameFiles = JSON.stringify(current.attachments.map((file) => [file.id, file.originalName, file.mimeType, file.checksum, String(file.sizeBytes)])) === JSON.stringify(submission.attachments.map((file) => [file.id, file.originalName, file.mimeType, file.checksum, String(file.sizeBytes)]));
    const sameAssignment = current.assignment.version === submission.assignment.version && current.assignment.classId === submission.assignment.classId && [current.assignment.title, current.assignment.description, current.assignment.instructions].join("\n\n") === base.instructions && JSON.stringify(this.rubric(current.assignment.rubric)) === JSON.stringify(base.rubric);
    if (current.revision !== submission.revision || current.content !== submission.content || !sameAssignment || !sameFiles) throw new ConflictException("Bài nộp hoặc tệp đã thay đổi trong lúc tải. Hãy mở lại bài nộp.");
    return { ...base, answer, sources };
  }

  /** Kiểm tra điểm từng rubric không vượt trần rồi lưu kết quả và thời điểm chấm. */
  async gradeSubmission(
    submissionId: string,
    rubricScores: Array<{ criterionId: string; score: number }>,
    feedback: string,
    expectedSubmissionRevision: number,
    correctionReason: string | undefined,
    session: AuthenticatedSession,
  ): Promise<AssignmentSubmissionView> {
    const submission = await this.prisma.assignmentSubmission.findUnique({
      where: { id: submissionId },
      include: { assignment: true },
    });
    if (!submission) throw new NotFoundException("Không tìm thấy bài nộp.");
    await this.requireTeachingAccess(
      submission.assignment.classId,
      session,
      true,
    );
    if (submission.revision !== expectedSubmissionRevision)
      throw new ConflictException(
        "Học viên đã nộp phiên bản mới. Hãy tải lại bài trước khi chấm.",
      );
    const correction = submission.status === "GRADED";
    if (correction && !correctionReason?.trim())
      throw new BadRequestException("Sửa điểm đã công bố phải ghi rõ lý do.");
    const rubric = this.rubric(submission.assignment.rubric);
    if (
      rubricScores.length !== rubric.length ||
      new Set(rubricScores.map((item) => item.criterionId)).size !==
        rubric.length
    )
      throw new BadRequestException(
        "Điểm rubric phải có đúng một giá trị cho từng tiêu chí.",
      );
    let total = 0;
    for (const criterion of rubric) {
      const score = rubricScores.find(
        (item) => item.criterionId === criterion.id,
      )?.score;
      if (score === undefined || score > criterion.maxPoints)
        throw new BadRequestException(
          `Điểm tiêu chí ${criterion.title} vượt giới hạn.`,
        );
      total += score;
    }
    const row = await this.prisma.$transaction(async (transaction) => {
      const changed = await transaction.assignmentSubmission.updateMany({
        where: {
          id: submissionId,
          revision: expectedSubmissionRevision,
          updatedAt: submission.updatedAt,
        },
        data: {
          status: "GRADED",
          score: total,
          rubricScores,
          feedback: feedback.trim(),
          gradedBy: session.user.id,
          gradedAt: new Date(),
        },
      });
      if (changed.count !== 1)
        throw new ConflictException(
          "Bài nộp hoặc điểm vừa thay đổi ở nơi khác. Hãy tải lại trước khi lưu.",
        );
      const gradeChangeId = `assignment-grade-${randomUUID()}`;
      await transaction.assignmentGradeChange.create({
        data: {
          id: gradeChangeId,
          submissionId,
          submissionRevision: submission.revision,
          actorId: session.user.id,
          action: correction ? "CORRECTED" : "GRADED",
          previousScore: submission.score,
          nextScore: total,
          previousRubric: submission.rubricScores ?? undefined,
          nextRubric: rubricScores,
          previousFeedback: submission.feedback,
          nextFeedback: feedback.trim(),
          reason: correctionReason?.trim(),
        },
      });
      const updated = await transaction.assignmentSubmission.findUniqueOrThrow({
        where: { id: submissionId },
        include: {
          learner: { select: { displayName: true, email: true } },
          attachments: {
            where: { removedAt: null },
            orderBy: { createdAt: "asc" },
          },
          gradeChanges: { orderBy: { createdAt: "desc" } },
        },
      });
      await transaction.notification.create({
        data: {
          id: `notification-${randomUUID()}`,
          recipientId: submission.learnerId,
          type: correction ? "ASSIGNMENT_GRADE_CORRECTED" : "ASSIGNMENT_GRADED",
          title: correction
            ? `Điểm bài ${submission.assignment.title} đã được cập nhật`
            : `Đã chấm bài: ${submission.assignment.title}`,
          entityType: "ASSIGNMENT",
          entityId: submission.assignmentId,
          dedupKey: `assignment-grade:${gradeChangeId}:${submission.learnerId}`,
        },
      });
      return updated;
    });
    return this.mapSubmission(row);
  }

  /** Tổng hợp điểm thi và bài tập đã chấm thành tỷ lệ chung cho từng học viên. */
  async gradebook(
    classId: string,
    session: AuthenticatedSession,
  ): Promise<GradebookRow[]> {
    await this.requireTeachingAccess(classId, session);
    const classItem = await this.prisma.learningClass.findUnique({
      where: { id: classId },
      include: {
        enrollments: {
          where: { status: "ACTIVE" },
          include: { learner: { select: { displayName: true, email: true } } },
        },
        exams: {
          where: { status: { in: ["PUBLISHED", "CLOSED"] } },
          include: { attempts: true },
        },
        assignments: {
          where: { status: { in: ["PUBLISHED", "CLOSED"] } },
          include: { submissions: true },
        },
      },
    });
    if (!classItem) throw new NotFoundException("Không tìm thấy lớp học.");
    return classItem.enrollments.map(({ learnerId, learner }) => {
      let examEarned = 0;
      let examPossible = 0;
      let assignmentEarned = 0;
      let assignmentPossible = 0;
      let awaitingGrade = 0;
      let notSubmitted = 0;
      for (const exam of classItem.exams) {
        const attempts = exam.attempts.filter(
          (attempt) => attempt.learnerId === learnerId,
        );
        const graded = attempts.filter(
          (attempt) => attempt.status === "GRADED",
        );
        if (graded.length) {
          examPossible += Number(exam.totalScore);
          examEarned += Math.max(
            ...graded.map((attempt) => Number(attempt.score ?? 0)),
          );
        } else if (
          attempts.some(
            (attempt) =>
              attempt.status === "SUBMITTED" ||
              attempt.status === "IN_PROGRESS",
          )
        )
          awaitingGrade += 1;
        else if (exam.status === "CLOSED" || exam.closeAt <= new Date()) {
          examPossible += Number(exam.totalScore);
          notSubmitted += 1;
        }
      }
      for (const assignment of classItem.assignments) {
        const submission = assignment.submissions.find(
          (item) => item.learnerId === learnerId,
        );
        if (submission?.status === "GRADED") {
          assignmentPossible += Number(assignment.maxScore);
          assignmentEarned += Number(submission.score ?? 0);
        } else if (submission) awaitingGrade += 1;
        else if (
          assignment.status === "CLOSED" ||
          assignment.dueAt <= new Date()
        ) {
          assignmentPossible += Number(assignment.maxScore);
          notSubmitted += 1;
        }
      }
      const possible = examPossible + assignmentPossible;
      return {
        learnerId,
        learnerName: learner.displayName,
        learnerEmail: learner.email,
        examEarned,
        examPossible,
        assignmentEarned,
        assignmentPossible,
        totalPercent: possible
          ? Math.round(((examEarned + assignmentEarned) / possible) * 10_000) /
            100
          : 0,
        awaitingGrade,
        notSubmitted,
      };
    });
  }

  /** Gom bài tập và bài thi theo lớp → bài → bài nộp cho một hàng đợi chấm duy nhất. */
  async gradingQueue(
    session: AuthenticatedSession,
    classId?: string,
  ): Promise<GradingQueueGroup[]> {
    const classIds = await this.accessibleClassIds(session);
    if (
      session.roleCode !== "INSTRUCTOR" ||
      !session.permissions.includes("exam:manage")
    )
      throw new ForbiddenException("Hàng đợi chấm chỉ dành cho giảng viên.");
    if (classId && !classIds.includes(classId))
      throw new NotFoundException(
        "Không tìm thấy lớp học trong phạm vi giảng dạy.",
      );
    const scopedIds = classId ? [classId] : classIds;
    const [assignments, exams] = await Promise.all([
      this.prisma.assignment.findMany({
        where: {
          classId: { in: scopedIds },
          status: { in: ["PUBLISHED", "CLOSED"] },
        },
        include: {
          class: { select: { code: true } },
          submissions: {
            include: {
              learner: { select: { displayName: true, email: true } },
            },
            orderBy: { submittedAt: "asc" },
          },
        },
        orderBy: [{ class: { code: "asc" } }, { dueAt: "asc" }],
      }),
      this.prisma.exam.findMany({
        where: {
          classId: { in: scopedIds },
          status: { in: ["PUBLISHED", "CLOSED"] },
        },
        include: {
          class: { select: { code: true } },
          attempts: {
            where: { status: { in: ["SUBMITTED", "GRADED"] } },
            include: {
              learner: { select: { displayName: true, email: true } },
            },
            orderBy: { submittedAt: "asc" },
          },
        },
        orderBy: [{ class: { code: "asc" } }, { closeAt: "asc" }],
      }),
    ]);
    const assignmentGroups: GradingQueueGroup[] = assignments.map(
      (assignment) => ({
        id: assignment.id,
        type: "ASSIGNMENT",
        classId: assignment.classId,
        classCode: assignment.class.code,
        title: assignment.title,
        maxScore: Number(assignment.maxScore),
        submittedCount: assignment.submissions.length,
        pendingCount: assignment.submissions.filter(
          (item) => item.status === "SUBMITTED",
        ).length,
        items: assignment.submissions.map((item) => ({
          id: item.id,
          learnerId: item.learnerId,
          learnerName: item.learner.displayName,
          learnerEmail: item.learner.email,
          status: item.status,
          submittedAt: item.submittedAt.toISOString(),
          revision: item.revision,
        })),
      }),
    );
    const examGroups: GradingQueueGroup[] = exams.map((exam) => ({
      id: exam.id,
      type: "EXAM",
      classId: exam.classId,
      classCode: exam.class.code,
      title: exam.title,
      maxScore: Number(exam.totalScore),
      submittedCount: exam.attempts.length,
      pendingCount: exam.attempts.filter((item) => item.status === "SUBMITTED")
        .length,
      items: exam.attempts.map((item) => ({
        id: item.id,
        learnerId: item.learnerId,
        learnerName: item.learner.displayName,
        learnerEmail: item.learner.email,
        status: item.status as "SUBMITTED" | "GRADED",
        submittedAt: (item.submittedAt ?? item.startedAt).toISOString(),
      })),
    }));
    return [...assignmentGroups, ...examGroups].sort(
      (left, right) =>
        left.classCode.localeCompare(right.classCode, "vi") ||
        right.pendingCount - left.pendingCount ||
        left.title.localeCompare(right.title, "vi"),
    );
  }

  /** Hợp nhất các mốc lớp, buổi học, đề thi và bài tập rồi sắp xếp theo thời gian. */
  async calendar(
    session: AuthenticatedSession,
    classId?: string,
  ): Promise<AcademicCalendarEvent[]> {
    const classIds = await this.accessibleClassIds(session);
    if (classId && !classIds.includes(classId))
      throw new NotFoundException(
        "Không tìm thấy lớp học trong phạm vi truy cập.",
      );
    const classes = await this.prisma.learningClass.findMany({
      where: { id: classId ?? { in: classIds } },
      include: {
        sessions: { where: { status: { not: "CANCELLED" } } },
        exams: { where: { status: { in: ["PUBLISHED", "CLOSED"] } } },
        assignments: { where: { status: { in: ["PUBLISHED", "CLOSED"] } } },
      },
    });
    const events: AcademicCalendarEvent[] = [];
    for (const item of classes) {
      events.push({
        id: `class-${item.id}`,
        classId: item.id,
        classCode: item.code,
        type: "CLASS",
        title: `Thời gian lớp ${item.name}`,
        startAt: item.startAt.toISOString(),
        endAt: item.endAt.toISOString(),
        href: `/courses/classes/${encodeURIComponent(item.id)}`,
      });
      events.push(
        ...item.sessions.map((sessionItem) => ({
          id: `session-${sessionItem.id}`,
          classId: item.id,
          classCode: item.code,
          type: "LIVE_SESSION" as const,
          title: sessionItem.title,
          startAt: sessionItem.startsAt.toISOString(),
          endAt: sessionItem.endsAt.toISOString(),
          href: `/live-classes?classId=${encodeURIComponent(item.id)}&sessionId=${encodeURIComponent(sessionItem.id)}`,
        })),
      );
      events.push(
        ...item.exams.flatMap((exam) => [
          {
            id: `exam-open-${exam.id}`,
            classId: item.id,
            classCode: item.code,
            type: "EXAM" as const,
            title: `Mở đề: ${exam.title}`,
            startAt: exam.openAt.toISOString(),
            href: `/exams?classId=${encodeURIComponent(item.id)}&examId=${encodeURIComponent(exam.id)}`,
          },
          {
            id: `exam-close-${exam.id}`,
            classId: item.id,
            classCode: item.code,
            type: "EXAM" as const,
            title: `Đóng đề: ${exam.title}`,
            startAt: exam.closeAt.toISOString(),
            href: `/exams?classId=${encodeURIComponent(item.id)}&examId=${encodeURIComponent(exam.id)}`,
          },
        ]),
      );
      events.push(
        ...item.assignments.map((assignment) => ({
          id: `assignment-${assignment.id}`,
          classId: item.id,
          classCode: item.code,
          type: "ASSIGNMENT" as const,
          title: `Hạn bài: ${assignment.title}`,
          startAt: assignment.dueAt.toISOString(),
          href: `/academic?classId=${encodeURIComponent(item.id)}&assignmentId=${encodeURIComponent(assignment.id)}`,
        })),
      );
    }
    return events.sort((a, b) => a.startAt.localeCompare(b.startAt));
  }

  /** Trả thông báo mới nhất trong phạm vi lớp của người dùng. */
  async listAnnouncements(
    session: AuthenticatedSession,
    classId?: string,
  ): Promise<ClassAnnouncementView[]> {
    const classIds = await this.accessibleClassIds(session);
    if (classId && !classIds.includes(classId))
      throw new NotFoundException(
        "Không tìm thấy lớp học trong phạm vi truy cập.",
      );
    const rows = await this.prisma.classAnnouncement.findMany({
      where: { classId: classId ?? { in: classIds } },
      include: {
        class: { select: { code: true } },
        author: { select: { displayName: true } },
      },
      orderBy: { publishedAt: "desc" },
      take: 100,
    });
    return rows.map((row) => ({
      id: row.id,
      classId: row.classId,
      classCode: row.class.code,
      title: row.title,
      body: row.body,
      authorName: row.author.displayName,
      publishedAt: row.publishedAt.toISOString(),
    }));
  }

  /** Kiểm tra quyền dạy rồi tạo thông báo gắn với tác giả hiện tại. */
  async createAnnouncement(
    classId: string,
    title: string,
    body: string,
    session: AuthenticatedSession,
  ): Promise<ClassAnnouncementView> {
    await this.requireTeachingAccess(classId, session, true);
    return this.prisma.$transaction(async (transaction) => {
      const row = await transaction.classAnnouncement.create({
        data: {
          id: `announcement-${randomUUID()}`,
          classId,
          authorId: session.user.id,
          title: title.trim(),
          body: body.trim(),
        },
        include: {
          class: { select: { code: true } },
          author: { select: { displayName: true } },
        },
      });
      const members = await transaction.learningClass.findUnique({
        where: { id: classId },
        include: {
          instructors: { select: { instructorId: true } },
          enrollments: {
            where: { status: "ACTIVE" },
            select: { learnerId: true },
          },
        },
      });
      const recipients = new Set([
        ...(members?.instructors.map((item) => item.instructorId) ?? []),
        ...(members?.enrollments.map((item) => item.learnerId) ?? []),
      ]);
      recipients.delete(session.user.id);
      if (recipients.size)
        await transaction.notification.createMany({
          data: [...recipients].map((recipientId) => ({
            id: `notification-${randomUUID()}`,
            recipientId,
            type: "CLASS_ANNOUNCEMENT",
            title: `Thông báo lớp: ${title.trim()}`,
            entityType: "CLASS_ANNOUNCEMENT",
            entityId: row.id,
            dedupKey: `announcement:${row.id}:${recipientId}`,
          })),
        });
      return {
        id: row.id,
        classId: row.classId,
        classCode: row.class.code,
        title: row.title,
        body: row.body,
        authorName: row.author.displayName,
        publishedAt: row.publishedAt.toISOString(),
      };
    });
  }

  /** Tính lớp truy cập được theo vai trò quản trị, phân công giảng viên hoặc ghi danh học viên. */
  private async accessibleClassIds(
    session: AuthenticatedSession,
  ): Promise<string[]> {
    if (
      session.roleCode === "CENTER_MANAGER" ||
      session.roleCode === "SYSTEM_ADMIN"
    )
      return (
        await this.prisma.learningClass.findMany({ select: { id: true } })
      ).map((item) => item.id);
    if (session.roleCode === "INSTRUCTOR")
      return (
        await this.prisma.classInstructor.findMany({
          where: { instructorId: session.user.id },
          select: { classId: true },
        })
      ).map((item) => item.classId);
    return (
      await this.prisma.classEnrollment.findMany({
        where: { learnerId: session.user.id, status: "ACTIVE" },
        select: { classId: true },
      })
    ).map((item) => item.classId);
  }

  /** Cho quản trị hoặc giảng viên được phân công tiếp tục và từ chối các phiên còn lại. */
  private async requireTeachingAccess(
    classId: string,
    session: AuthenticatedSession,
    requireWritable = false,
  ): Promise<void> {
    if (session.roleCode !== "INSTRUCTOR")
      throw new ForbiddenException(
        "Nghiệp vụ học thuật chỉ dành cho giảng viên được phân công.",
      );
    if (
      !session.permissions.includes("exam:manage") ||
      !(await this.accessibleClassIds(session)).includes(classId)
    )
      throw new NotFoundException(
        "Không tìm thấy lớp học trong phạm vi quản lý.",
      );
    if (requireWritable) {
      const classItem = await this.prisma.learningClass.findUnique({
        where: { id: classId },
        select: { status: true },
      });
      if (!classItem)
        throw new NotFoundException(
          "Không tìm thấy lớp học trong phạm vi quản lý.",
        );
      if (classItem.status === "CLOSED")
        throw new ConflictException("Lớp đã lưu trữ và chỉ cho phép đọc.");
    }
  }

  /** Ánh xạ assignment Prisma và submission tùy chọn sang view model học vụ. */
  private mapAssignment(
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
      rubric: this.rubric(row.rubric),
      status: row.status,
      version: row.version,
      closedAt: row.closedAt?.toISOString(),
      closeReason: row.closeReason ?? undefined,
      createdById: row.createdById,
      submission: submission ? this.mapSubmission(submission) : undefined,
      createdAt: row.createdAt.toISOString(),
    };
  }

  /** Chuyển bài nộp và tệp đính kèm sang dữ liệu trả cho giao diện. */
  private mapSubmission(row: MappableSubmissionRow): AssignmentSubmissionView {
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
      rubricScores: this.rubricScores(row.rubricScores),
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
  private assignmentSnapshot(row: {
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

  /** Giới hạn số lượng, kích thước, MIME và magic bytes của tệp bài nộp. */
  private validateAssignmentFiles(files: UploadedAssignmentFile[]): void {
    if (files.length > 5)
      throw new BadRequestException("Mỗi lần chỉ được chọn tối đa 5 tệp.");
    const mimeByExtension: Record<string, string> = {
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      png: "image/png",
      webp: "image/webp",
      pdf: "application/pdf",
      doc: "application/msword",
      docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      txt: "text/plain",
    };
    for (const file of files) {
      if (!file.originalName || file.originalName.length > 255)
        throw new BadRequestException("Tên tệp phải có từ 1 đến 255 ký tự.");
      if (
        file.size <= 0 ||
        file.size > 20 * 1024 * 1024 ||
        file.buffer.length !== file.size
      )
        throw new BadRequestException(
          `Tệp ${file.originalName} phải có dung lượng từ 1 byte đến 20 MB.`,
        );
      const extension = file.originalName.split(".").pop()?.toLowerCase() ?? "";
      const expectedMime = mimeByExtension[extension];
      if (
        !expectedMime ||
        (file.mimeType &&
          file.mimeType !== "application/octet-stream" &&
          file.mimeType !== expectedMime)
      )
        throw new BadRequestException(
          `Tệp ${file.originalName} không đúng định dạng JPG, PNG, WebP, PDF, DOC, DOCX hoặc TXT.`,
        );
      const validSignature =
        extension === "txt"
          ? !file.buffer.includes(0) &&
            !file.buffer.toString("utf8").includes("\uFFFD")
          : extension === "jpg" || extension === "jpeg"
            ? file.buffer.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))
            : extension === "png"
              ? file.buffer
                  .subarray(0, 8)
                  .equals(
                    Buffer.from([
                      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
                    ]),
                  )
              : extension === "webp"
                ? file.buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
                  file.buffer.subarray(8, 12).toString("ascii") === "WEBP"
                : extension === "pdf"
                  ? file.buffer.subarray(0, 4).toString("ascii") === "%PDF"
                  : extension === "doc"
                    ? file.buffer
                        .subarray(0, 8)
                        .equals(
                          Buffer.from([
                            0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1,
                          ]),
                        )
                    : file.buffer.subarray(0, 2).toString("ascii") === "PK";
      if (!validSignature)
        throw new BadRequestException(
          `Nội dung tệp ${file.originalName} không khớp với phần mở rộng.`,
        );
      file.mimeType = expectedMime;
    }
  }

  /** Thu hẹp JSON rubric đã lưu về cấu trúc tiêu chí ứng dụng sử dụng. */
  private rubric(value: Prisma.JsonValue): RubricCriterion[] {
    if (!Array.isArray(value))
      throw new BadRequestException("Rubric lưu trữ không hợp lệ.");
    const usedIds = new Set<string>();
    return value.map((item, index) => {
      const row = item as Record<string, unknown>;
      const storedId = typeof row.id === "string" ? row.id.trim() : "";
      let id =
        storedId && !usedIds.has(storedId)
          ? storedId
          : `criterion-legacy-${index}`;
      while (usedIds.has(id)) id = `${id}-${index}`;
      usedIds.add(id);
      return {
        id,
        title: String(row.title),
        description: String(row.description),
        maxPoints: Number(row.maxPoints),
      };
    });
  }

  /** Thu hẹp JSON điểm rubric, trả mảng rỗng khi dữ liệu không phải danh sách. */
  private rubricScores(
    value: Prisma.JsonValue | null,
  ): Array<{ criterionId: string; score: number }> {
    if (!Array.isArray(value)) return [];
    return value.map((item) => {
      const row = item as Record<string, unknown>;
      return { criterionId: String(row.criterionId), score: Number(row.score) };
    });
  }
}
