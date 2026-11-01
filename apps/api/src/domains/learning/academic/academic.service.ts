import { Injectable } from "@nestjs/common";
import type { AuthenticatedSession } from "../../../auth/auth.service.js";
import { PrismaService } from "../../../database/prisma.service.js";
import type { Prisma } from "../../../generated/prisma/client.js";
import { AntivirusService } from "../../../infrastructure/antivirus.service.js";
import { ObjectStorageService } from "../../../infrastructure/object-storage.service.js";
import type { AcademicServiceContext } from "./academic.context.js";
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
import * as access_ops from "../operations/academic/academic-access.js";
import * as announcements_ops from "../operations/academic/academic-announcements.js";
import * as assignments_ops from "../operations/academic/academic-assignments.js";
import * as calendar_ops from "../operations/academic/academic-calendar.js";
import * as files_ops from "../operations/academic/academic-files.js";
import * as grading_ops from "../operations/academic/academic-grading.js";
import * as mapping_ops from "../operations/academic/academic-mapping.js";
import * as submissions_ops from "../operations/academic/academic-submissions.js";
export * from "./academic.shared.js";

@Injectable()
/** Thực thi nghiệp vụ bài tập, tệp bài nộp, sổ điểm, lịch và thông báo trên Prisma. */
export class AcademicService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly objectStorage: ObjectStorageService,
    private readonly antivirus: AntivirusService,
  ) {}

  private readonly operationContext: AcademicServiceContext =
    AcademicService.createOperationContext(this);

  /** Cấp quyền truy cập có kiểu cho thao tác nội bộ, giữ nguyên trạng thái và điểm chặn kiểm thử của service. */
  private static createOperationContext(
    owner: AcademicService,
  ): AcademicServiceContext {
    return {
      get prisma(): AcademicServiceContext["prisma"] {
        return owner.prisma;
      },
      get objectStorage(): AcademicServiceContext["objectStorage"] {
        return owner.objectStorage;
      },
      get antivirus(): AcademicServiceContext["antivirus"] {
        return owner.antivirus;
      },
      listAssignments: (...args) => owner.listAssignments(...args),
      createAssignment: (...args) => owner.createAssignment(...args),
      updateAssignment: (...args) => owner.updateAssignment(...args),
      extendAssignment: (...args) => owner.extendAssignment(...args),
      closeAssignment: (...args) => owner.closeAssignment(...args),
      assignmentHistory: (...args) => owner.assignmentHistory(...args),
      publishAssignment: (...args) => owner.publishAssignment(...args),
      submitAssignment: (...args) => owner.submitAssignment(...args),
      addSubmissionAttachments: (...args) =>
        owner.addSubmissionAttachments(...args),
      removeSubmissionAttachment: (...args) =>
        owner.removeSubmissionAttachment(...args),
      readSubmissionAttachment: (...args) =>
        owner.readSubmissionAttachment(...args),
      listSubmissions: (...args) => owner.listSubmissions(...args),
      gradingAiContext: (...args) => owner.gradingAiContext(...args),
      gradeSubmission: (...args) => owner.gradeSubmission(...args),
      gradebook: (...args) => owner.gradebook(...args),
      gradingQueue: (...args) => owner.gradingQueue(...args),
      calendar: (...args) => owner.calendar(...args),
      listAnnouncements: (...args) => owner.listAnnouncements(...args),
      createAnnouncement: (...args) => owner.createAnnouncement(...args),
      accessibleClassIds: (...args) => owner.accessibleClassIds(...args),
      requireTeachingAccess: (...args) => owner.requireTeachingAccess(...args),
      mapAssignment: (...args) => owner.mapAssignment(...args),
      mapSubmission: (...args) => owner.mapSubmission(...args),
      assignmentSnapshot: (...args) => owner.assignmentSnapshot(...args),
      validateAssignmentFiles: (...args) =>
        owner.validateAssignmentFiles(...args),
      rubric: (...args) => owner.rubric(...args),
      rubricScores: (...args) => owner.rubricScores(...args),
    };
  }

  /** Lọc bài tập theo lớp truy cập được và chỉ gắn bài nộp của chính học viên. */
  async listAssignments(
    session: AuthenticatedSession,
    classId?: string,
  ): Promise<AssignmentView[]> {
    return await assignments_ops.listAssignments(
      this.operationContext,
      session,
      classId,
    );
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
      sourceMaterialId?: string;
    },
    session: AuthenticatedSession,
  ): Promise<AssignmentView> {
    return await assignments_ops.createAssignment(
      this.operationContext,
      classId,
      input,
      session,
    );
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
      sourceMaterialId?: string;
    },
    session: AuthenticatedSession,
  ): Promise<AssignmentView> {
    return await assignments_ops.updateAssignment(
      this.operationContext,
      assignmentId,
      input,
      session,
    );
  }

  /** Gia hạn bài đã công bố, ghi lịch sử và thông báo lại cho toàn bộ học viên đang học. */
  async extendAssignment(
    assignmentId: string,
    dueAtValue: string,
    reason: string,
    expectedVersion: number,
    session: AuthenticatedSession,
  ): Promise<AssignmentView> {
    return await assignments_ops.extendAssignment(
      this.operationContext,
      assignmentId,
      dueAtValue,
      reason,
      expectedVersion,
      session,
    );
  }

  /** Đóng bài sớm bằng cập nhật có điều kiện và bảo toàn lý do trong lịch sử. */
  async closeAssignment(
    assignmentId: string,
    reason: string,
    expectedVersion: number,
    session: AuthenticatedSession,
  ): Promise<AssignmentView> {
    return await assignments_ops.closeAssignment(
      this.operationContext,
      assignmentId,
      reason,
      expectedVersion,
      session,
    );
  }

  /** Trả lịch sử thay đổi bài tập cho người dạy có quyền trên lớp. */
  async assignmentHistory(
    assignmentId: string,
    session: AuthenticatedSession,
  ): Promise<AssignmentChangeView[]> {
    return await assignments_ops.assignmentHistory(
      this.operationContext,
      assignmentId,
      session,
    );
  }

  /** Chuyển bài tập sang PUBLISHED sau khi xác nhận quyền phụ trách lớp. */
  async publishAssignment(
    assignmentId: string,
    session: AuthenticatedSession,
  ): Promise<AssignmentView> {
    return await assignments_ops.publishAssignment(
      this.operationContext,
      assignmentId,
      session,
    );
  }

  /** Quét/lưu tệp trước khi upsert bài nộp và dọn object mới nếu transaction thất bại. */
  async submitAssignment(
    assignmentId: string,
    content: string | undefined,
    session: AuthenticatedSession,
    files: UploadedAssignmentFile[] = [],
    expectedRevision?: number,
  ): Promise<AssignmentSubmissionView> {
    return await submissions_ops.submitAssignment(
      this.operationContext,
      assignmentId,
      content,
      session,
      files,
      expectedRevision,
    );
  }

  /** Bổ sung tệp bằng cách dùng lại luồng submit và giữ nội dung hiện có. */
  async addSubmissionAttachments(
    submissionId: string,
    files: UploadedAssignmentFile[],
    session: AuthenticatedSession,
  ): Promise<AssignmentSubmissionView> {
    return await submissions_ops.addSubmissionAttachments(
      this.operationContext,
      submissionId,
      files,
      session,
    );
  }

  /** Kiểm tra chủ sở hữu, xóa bản ghi tệp rồi dọn object khỏi storage. */
  async removeSubmissionAttachment(
    submissionId: string,
    attachmentId: string,
    expectedRevision: number,
    session: AuthenticatedSession,
  ): Promise<AssignmentSubmissionView> {
    return await submissions_ops.removeSubmissionAttachment(
      this.operationContext,
      submissionId,
      attachmentId,
      expectedRevision,
      session,
    );
  }

  /** Đọc bytes bất biến có checksum; tái kiểm tra nguồn và quyền sau khi tải từ kho. */
  async readSubmissionAttachment(
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
  }> {
    return await submissions_ops.readSubmissionAttachment(
      this.operationContext,
      submissionId,
      attachmentId,
      session,
      expectedRevision,
    );
  }

  /** Liệt kê mọi bài nộp sau khi kiểm tra quyền giảng dạy. */
  async listSubmissions(
    assignmentId: string,
    session: AuthenticatedSession,
  ): Promise<AssignmentSubmissionView[]> {
    return await submissions_ops.listSubmissions(
      this.operationContext,
      assignmentId,
      session,
    );
  }

  /** Lấy đúng bài nộp và rubric cho AI, không đưa tên/email hoặc điểm cũ vào ngữ cảnh chấm. */
  async gradingAiContext(
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
  }> {
    return await submissions_ops.gradingAiContext(
      this.operationContext,
      submissionId,
      expectedSubmissionRevision,
      session,
      readDocument,
    );
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
    return await grading_ops.gradeSubmission(
      this.operationContext,
      submissionId,
      rubricScores,
      feedback,
      expectedSubmissionRevision,
      correctionReason,
      session,
    );
  }

  /** Tổng hợp điểm thi và bài tập đã chấm thành tỷ lệ chung cho từng học viên. */
  async gradebook(
    classId: string,
    session: AuthenticatedSession,
  ): Promise<GradebookRow[]> {
    return await grading_ops.gradebook(this.operationContext, classId, session);
  }

  /** Gom bài tập và bài thi theo lớp → bài → bài nộp cho một hàng đợi chấm duy nhất. */
  async gradingQueue(
    session: AuthenticatedSession,
    classId?: string,
  ): Promise<GradingQueueGroup[]> {
    return await grading_ops.gradingQueue(
      this.operationContext,
      session,
      classId,
    );
  }

  /** Hợp nhất các mốc lớp, buổi học, đề thi và bài tập rồi sắp xếp theo thời gian. */
  async calendar(
    session: AuthenticatedSession,
    classId?: string,
  ): Promise<AcademicCalendarEvent[]> {
    return await calendar_ops.calendar(this.operationContext, session, classId);
  }

  /** Trả thông báo mới nhất trong phạm vi lớp của người dùng. */
  async listAnnouncements(
    session: AuthenticatedSession,
    classId?: string,
  ): Promise<ClassAnnouncementView[]> {
    return await announcements_ops.listAnnouncements(
      this.operationContext,
      session,
      classId,
    );
  }

  /** Kiểm tra quyền dạy rồi tạo thông báo gắn với tác giả hiện tại. */
  async createAnnouncement(
    classId: string,
    title: string,
    body: string,
    session: AuthenticatedSession,
  ): Promise<ClassAnnouncementView> {
    return await announcements_ops.createAnnouncement(
      this.operationContext,
      classId,
      title,
      body,
      session,
    );
  }

  /** Tính lớp truy cập được theo vai trò quản trị, phân công giảng viên hoặc ghi danh học viên. */
  private async accessibleClassIds(
    session: AuthenticatedSession,
  ): Promise<string[]> {
    return await access_ops.accessibleClassIds(this.operationContext, session);
  }

  /** Cho quản trị hoặc giảng viên được phân công tiếp tục và từ chối các phiên còn lại. */
  private async requireTeachingAccess(
    classId: string,
    session: AuthenticatedSession,
    requireWritable = false,
  ): Promise<void> {
    return await access_ops.requireTeachingAccess(
      this.operationContext,
      classId,
      session,
      requireWritable,
    );
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
    }> & { sourceMaterial?: { id: string; name: string; mimeType: string; sizeBytes: bigint } | null },
    submission?: Prisma.AssignmentSubmissionGetPayload<{
      include: {
        learner: { select: { displayName: true; email: true } };
        attachments: true;
      };
    }>,
  ): AssignmentView {
    return mapping_ops.mapAssignment(this.operationContext, row, submission);
  }

  /** Chuyển bài nộp và tệp đính kèm sang dữ liệu trả cho giao diện. */
  private mapSubmission(row: MappableSubmissionRow): AssignmentSubmissionView {
    return mapping_ops.mapSubmission(this.operationContext, row);
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
    return mapping_ops.assignmentSnapshot(row);
  }

  /** Giới hạn số lượng, kích thước, MIME và magic bytes của tệp bài nộp. */
  private validateAssignmentFiles(files: UploadedAssignmentFile[]): void {
    return files_ops.validateAssignmentFiles(files);
  }

  /** Thu hẹp JSON rubric đã lưu về cấu trúc tiêu chí ứng dụng sử dụng. */
  private rubric(value: Prisma.JsonValue): RubricCriterion[] {
    return files_ops.rubric(value);
  }

  /** Thu hẹp JSON điểm rubric, trả mảng rỗng khi dữ liệu không phải danh sách. */
  private rubricScores(
    value: Prisma.JsonValue | null,
  ): Array<{ criterionId: string; score: number }> {
    return files_ops.rubricScores(value);
  }
}
