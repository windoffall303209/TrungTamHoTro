import { prepareVerifiedDownload } from "../infrastructure/verified-download.js";
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  createHash,
  createHmac,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import { mkdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { streamToFile } from "../infrastructure/file-streams.js";
import { dirname, extname, resolve, sep } from "node:path";
import { Prisma } from "../generated/prisma/client.js";
import type { Environment } from "../config/environment.js";
import type { AuthenticatedSession } from "../auth/auth.service.js";
import { PrismaService } from "../database/prisma.service.js";
import {
  ObjectStorageService,
  type StoredObject,
} from "../infrastructure/object-storage.service.js";
import { AntivirusService } from "../infrastructure/antivirus.service.js";
import {
  DEFAULT_MATERIAL_MIME_TYPES,
  includeSupportedDocumentMimeTypes,
  normalizeMultipartFileName,
} from "../infrastructure/file-transfer.js";
import {
  SystemService,
  type ExamApprovalMode,
} from "../system/system.service.js";
import type {
  ExamSourceFile,
  ScannedQuestionDraft,
} from "../system/ai-provider.service.js";
import type {
  AttendanceAppeal,
  AttendanceRecord,
  AttendanceSessionReview,
  ClassClosureReadiness,
  ClassCapabilities,
  ClassMemberHistory,
  ClassProgressReport,
  ClassRoster,
  ContentReport,
  CourseVersionSnapshot,
  DirectoryUser,
  EnrollmentImportResult,
  ExamAnalytics,
  ExamApprovalRecord,
  ExamAttempt,
  ExamAttemptReview,
  FileReviewRecord,
  ForumPost,
  ForumTopic,
  GradeHistoryRecord,
  InstructorRole,
  LearnerProgress,
  LearningClass,
  LearningNotification,
  ModerationActionRecord,
  ModerationContext,
  OperationalReport,
  ProgressIntervention,
  ReportExport,
  ReportRun,
  RiskThresholds,
  LearnerExamSummary,
  LearnerResult,
  LearningCourse,
  LearningExam,
  LearningMaterial,
  LearningQuestion,
  LiveSession,
  MaterialVersionSnapshot,
  QuestionImportResult,
  ProviderAttendanceInput,
  RegradeRequest,
  SupportAttachment,
  SupportTicket,
  TicketComment,
} from "./learning.types.js";

const now = (): string => new Date().toISOString();
const id = (prefix: string): string => `${prefix}-${randomUUID()}`;
const isUniqueConstraintError = (error: unknown): boolean =>
  typeof error === "object" &&
  error !== null &&
  "code" in error &&
  error.code === "P2002";

type ClassWithMembers = Prisma.LearningClassGetPayload<{
  include: { instructors: true; enrollments: true };
}>;
type ExamWithQuestions = Prisma.ExamGetPayload<{
  include: { questions: true };
}>;
type AttemptWithAnswers = Prisma.ExamAttemptGetPayload<{
  include: { answers: true };
}>;
type ForumPostWithRelations = Prisma.ForumPostGetPayload<{
  include: { attachments: true; mentions: true };
}>;
type ContentReportWithActions = Prisma.ContentReportGetPayload<{
  include: { actions: true };
}>;
type SupportTicketWithAttachments = Prisma.SupportTicketGetPayload<{
  include: { attachments: true };
}>;
export interface UploadedMaterialFile {
  originalName: string;
  mimeType: string;
  size: number;
  buffer: Buffer;
  /** Internal scratch path for large material uploads; buffer then contains only the signature prefix. */
  path?: string;
}
export interface MaterialDownload {
  fileName: string;
  mimeType: string;
  buffer: Buffer;
}
export type MaterialAccessAction = "PREVIEW" | "DOWNLOAD";
export interface MaterialSearchResult {
  items: LearningMaterial[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}
export interface ExamGenerationContext {
  courseId: string;
  courseName: string;
  courseDescription: string;
  sourceFiles: ExamSourceFile[];
}
type MemoryMaterialVersion = MaterialVersionSnapshot & {
  objectKey?: string;
  checksum?: string;
};
type MemoryQuestionImage = {
  objectKey: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  checksum: string;
  buffer: Buffer;
};
type MemoryAttendanceInterval = {
  sessionId: string;
  learnerId: string;
  joinedAt: string;
  leftAt?: string;
  source: "APP" | "PROVIDER";
};

@Injectable()
/** Điều phối toàn bộ nghiệp vụ đào tạo, có đường chạy Prisma và fallback in-memory cho môi trường demo. */
export class LearningService {
  private readonly courses: LearningCourse[] = [
    {
      id: "course-web",
      code: "WEB-FULLSTACK",
      name: "Phát triển Web Full-stack",
      description: "Xây dựng ứng dụng web hiện đại từ giao diện đến API.",
      outcomes: [
        "Thiết kế giao diện responsive",
        "Xây dựng REST API",
        "Thiết kế cơ sở dữ liệu",
      ],
      status: "PUBLISHED",
      version: 1,
      createdAt: now(),
      updatedAt: now(),
    },
    {
      id: "course-data",
      code: "DATA-FOUNDATION",
      name: "Nền tảng dữ liệu",
      description: "Tổ chức, phân tích và trực quan hóa dữ liệu.",
      outcomes: ["Làm sạch dữ liệu", "Mô hình hóa dữ liệu"],
      status: "DRAFT",
      version: 1,
      createdAt: now(),
      updatedAt: now(),
    },
  ];

  private readonly courseVersions: CourseVersionSnapshot[] = [
    {
      id: "course-version-web-1",
      courseId: "course-web",
      version: 1,
      name: "Phát triển Web Full-stack",
      description: "Xây dựng ứng dụng web hiện đại từ giao diện đến API.",
      outcomes: [
        "Thiết kế giao diện responsive",
        "Xây dựng REST API",
        "Thiết kế cơ sở dữ liệu",
      ],
      publishedBy: "usr-manager",
      publishedAt: now(),
    },
  ];

  private readonly classes: LearningClass[] = [
    {
      id: "class-web-01",
      courseId: "course-web",
      courseVersion: 1,
      code: "WEB-K01",
      name: "Web Full-stack K01",
      term: "2026-HK1",
      startAt: "2026-08-18T01:00:00.000Z",
      endAt: "2026-12-20T10:00:00.000Z",
      capacity: 40,
      timezone: "Asia/Bangkok",
      allowLateEnrollment: true,
      status: "ACTIVE",
      instructorIds: ["usr-instructor"],
      learnerIds: ["usr-learner"],
    },
  ];

  private readonly materials: LearningMaterial[] = [
    {
      id: "mat-web-intro",
      classId: "class-web-01",
      ownerId: "usr-instructor",
      name: "01 — Tổng quan kiến trúc Web.pdf",
      mimeType: "application/pdf",
      sizeBytes: 2_420_000,
      folder: "Tuần 1",
      tags: ["kiến trúc", "bắt đầu"],
      version: 1,
      visibility: "PUBLISHED",
      createdAt: now(),
    },
    {
      id: "mat-api-guide",
      classId: "class-web-01",
      ownerId: "usr-instructor",
      name: "02 — Thiết kế REST API.pdf",
      mimeType: "application/pdf",
      sizeBytes: 3_180_000,
      folder: "Tuần 2",
      tags: ["api", "backend"],
      version: 2,
      visibility: "PUBLISHED",
      createdAt: now(),
    },
  ];
  private readonly materialVersions: MemoryMaterialVersion[] =
    this.materials.map((item) => ({
      ...item,
      id: `material-version-${item.id}-${item.version}`,
      materialId: item.id,
      createdBy: "usr-instructor",
      objectKey: undefined,
      checksum: undefined,
    }));

  private readonly questions: LearningQuestion[] = [
    {
      id: "q-rest-01",
      familyId: "q-rest-01",
      courseId: "course-web",
      type: "SINGLE_CHOICE",
      content: "HTTP method nào phù hợp để cập nhật một phần tài nguyên?",
      options: ["GET", "POST", "PATCH", "DELETE"],
      correctAnswers: ["PATCH"],
      difficulty: 1,
      tags: ["http", "api"],
      status: "PUBLISHED",
      version: 1,
    },
    {
      id: "q-db-01",
      familyId: "q-db-01",
      courseId: "course-web",
      type: "TRUE_FALSE",
      content: "Khóa ngoại giúp duy trì tính toàn vẹn tham chiếu.",
      options: ["Đúng", "Sai"],
      correctAnswers: ["Đúng"],
      difficulty: 1,
      tags: ["database"],
      status: "PUBLISHED",
      version: 1,
    },
  ];
  private readonly questionImages = new Map<string, MemoryQuestionImage>();

  private readonly exams: LearningExam[] = [
    {
      id: "exam-mid-web",
      classId: "class-web-01",
      title: "Kiểm tra giữa kỳ Web Full-stack",
      questionIds: ["q-rest-01", "q-db-01"],
      durationMinutes: 45,
      totalScore: 10,
      openAt: "2026-08-20T00:00:00.000Z",
      closeAt: "2026-12-30T23:59:00.000Z",
      attemptLimit: 2,
      status: "PUBLISHED",
      version: 1,
    },
  ];

  private readonly attempts: ExamAttempt[] = [];
  private readonly gradeHistory: GradeHistoryRecord[] = [];
  private readonly examApprovals: ExamApprovalRecord[] = [];
  private readonly regradeRequests: RegradeRequest[] = [];
  private readonly topics: ForumTopic[] = [
    {
      id: "topic-rest",
      classId: "class-web-01",
      title: "Thảo luận: REST hay GraphQL?",
      body: "Chia sẻ trường hợp bạn sẽ chọn REST hoặc GraphQL và lý do.",
      authorId: "usr-instructor",
      tags: ["api", "thảo luận"],
      isPinned: true,
      isLocked: false,
      status: "VISIBLE",
      createdAt: now(),
    },
  ];
  private readonly posts: ForumPost[] = [
    {
      id: "post-rest-01",
      topicId: "topic-rest",
      authorId: "usr-learner",
      body: "Em chọn REST cho hệ thống CRUD vì dễ cache và theo dõi.",
      status: "VISIBLE",
      attachmentIds: [],
      mentionedUserIds: [],
      createdAt: now(),
    },
  ];
  private readonly notifications: LearningNotification[] = [];
  private readonly reports: ContentReport[] = [];
  private readonly moderationActions: ModerationActionRecord[] = [];
  private readonly sessions: LiveSession[] = [
    {
      id: "session-web-01",
      classId: "class-web-01",
      hostId: "usr-instructor",
      title: "Thiết kế API có version",
      startsAt: "2026-08-26T02:00:00.000Z",
      endsAt: "2026-08-26T03:30:00.000Z",
      provider: "JITSI",
      requestedProvider: "JITSI",
      fallbackUsed: false,
      provisioningAttempts: 1,
      status: "SCHEDULED",
      timezone: "Asia/Bangkok",
      hostUrl: "https://meet.jit.si/wind-web-01-host",
      attendeeUrl: "https://meet.jit.si/wind-web-01",
    },
  ];
  private readonly attendance: AttendanceRecord[] = [];
  private readonly attendanceIntervals: MemoryAttendanceInterval[] = [];
  private readonly attendanceAppeals: AttendanceAppeal[] = [];
  private readonly tickets: SupportTicket[] = [];
  private readonly ticketComments: TicketComment[] = [];
  private readonly supportAttachmentFiles = new Map<string, string>();
  private readonly materialFiles = new Map<
    string,
    { objectKey: string; checksum: string }
  >();
  private readonly materialAccessLogs: Array<{
    materialId: string;
    userId: string;
    action: MaterialAccessAction;
    createdAt: string;
  }> = [];
  private readonly materialReviews: FileReviewRecord[] = [];
  private readonly progressInterventions: ProgressIntervention[] = [];
  private readonly reportRuns: ReportRun[] = [];
  private readonly reportExports: Array<
    ReportExport & { filePath?: string; requestedById: string }
  > = [];
  private readonly instructorRoles = new Map<string, InstructorRole>([
    ["class-web-01:usr-instructor", "PRIMARY"],
  ]);
  private readonly classMemberHistory: ClassMemberHistory[] = [];

  constructor(
    @Optional() private readonly prisma?: PrismaService,
    @Optional() private readonly config?: ConfigService<Environment, true>,
    @Optional() private readonly objectStorage?: ObjectStorageService,
    @Optional() private readonly antivirus?: AntivirusService,
    @Optional() private readonly system?: SystemService,
  ) {}

  /** Liệt kê khóa học từ DB hoặc trả bản sao dữ liệu nhớ để tránh mutation ngoài service. */
  async listCourses(): Promise<LearningCourse[]> {
    const prisma = this.database();
    if (prisma) {
      const rows = await prisma.course.findMany({
        orderBy: { createdAt: "desc" },
      });
      return rows.map((row) => this.mapCourse(row));
    }
    return this.courses.map((item) => ({
      ...item,
      outcomes: [...item.outcomes],
    }));
  }

  /** Tạo khóa học nháp sau khi chuẩn hóa mã và chống trùng, đồng thời ghi audit. */
  async createCourse(
    input: Pick<LearningCourse, "code" | "name" | "description" | "outcomes">,
    actorId = "usr-manager",
  ): Promise<LearningCourse> {
    const code = input.code.trim().toUpperCase();
    const prisma = this.database();
    if (prisma) {
      try {
        const row = await prisma.course.create({
          data: {
            id: id("course"),
            code,
            name: input.name.trim(),
            description: input.description.trim(),
            outcomes: input.outcomes.filter(Boolean),
            ownerId: actorId,
          },
        });
        return this.mapCourse(row);
      } catch (error) {
        if (isUniqueConstraintError(error))
          throw new ConflictException("Mã khóa học đã tồn tại.");
        throw error;
      }
    }
    if (this.courses.some((course) => course.code === code))
      throw new ConflictException("Mã khóa học đã tồn tại.");
    const timestamp = now();
    const course: LearningCourse = {
      id: id("course"),
      code,
      name: input.name.trim(),
      description: input.description.trim(),
      outcomes: input.outcomes.filter(Boolean),
      status: "DRAFT",
      version: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    this.courses.unshift(course);
    return { ...course, outcomes: [...course.outcomes] };
  }

  /** Cập nhật nội dung khóa học; khóa học đã xuất bản sẽ tăng version theo quy tắc lưu lịch sử. */
  async updateCourse(
    courseId: string,
    input: Pick<LearningCourse, "name" | "description" | "outcomes">,
    actorId = "usr-manager",
  ): Promise<LearningCourse> {
    const name = input.name.trim();
    const description = input.description.trim();
    const outcomes = input.outcomes.map((item) => item.trim()).filter(Boolean);
    if (!outcomes.length)
      throw new BadRequestException(
        "Khóa học cần ít nhất một mục tiêu học tập.",
      );
    const prisma = this.database();
    if (prisma) {
      const current = await prisma.course.findUnique({
        where: { id: courseId },
      });
      if (!current) throw new NotFoundException("Không tìm thấy khóa học.");
      if (current.status === "ARCHIVED")
        throw new ConflictException(
          "Khóa học đã ngừng sử dụng và không thể sửa.",
        );
      return prisma.$transaction(async (transaction) => {
        const row = await transaction.course.update({
          where: { id: courseId },
          data: { name, description, outcomes, status: "DRAFT" },
        });
        await transaction.auditLog.create({
          data: {
            actorId,
            action: "COURSE_DRAFT_UPDATED",
            entityType: "course",
            entityId: courseId,
            context: {
              publishedVersion: current.version,
              previousStatus: current.status,
              nextStatus: "DRAFT",
            },
          },
        });
        return this.mapCourse(row);
      });
    }
    const current = this.findCourse(courseId);
    if (current.status === "ARCHIVED")
      throw new ConflictException(
        "Khóa học đã ngừng sử dụng và không thể sửa.",
      );
    Object.assign(current, {
      name,
      description,
      outcomes,
      status: "DRAFT",
      updatedAt: now(),
    });
    return { ...current, outcomes: [...current.outcomes] };
  }

  /** Liệt kê snapshot xuất bản của khóa học theo thứ tự phiên bản. */
  async listCourseVersions(courseId: string): Promise<CourseVersionSnapshot[]> {
    const prisma = this.database();
    if (prisma) {
      if (
        !(await prisma.course.findUnique({
          where: { id: courseId },
          select: { id: true },
        }))
      )
        throw new NotFoundException("Không tìm thấy khóa học.");
      const rows = await prisma.courseVersion.findMany({
        where: { courseId },
        orderBy: { version: "desc" },
      });
      return rows.map((row) => ({
        id: row.id,
        courseId: row.courseId,
        version: row.version,
        name: row.name,
        description: row.description,
        outcomes: this.toStringArray(row.outcomes),
        publishedBy: row.publishedBy,
        publishedAt: row.publishedAt.toISOString(),
      }));
    }
    this.findCourse(courseId);
    return this.courseVersions
      .filter((item) => item.courseId === courseId)
      .sort((a, b) => b.version - a.version)
      .map((item) => ({ ...item, outcomes: [...item.outcomes] }));
  }

  /** Xuất bản khóa học và chụp snapshot bất biến của phiên bản hiện tại trong transaction. */
  async publishCourse(
    courseId: string,
    actorId = "usr-manager",
  ): Promise<LearningCourse> {
    const prisma = this.database();
    if (prisma) {
      return prisma.$transaction(async (transaction) => {
        const course = await transaction.course.findUnique({
          where: { id: courseId },
          include: { versions: { orderBy: { version: "desc" }, take: 1 } },
        });
        if (!course) throw new NotFoundException("Không tìm thấy khóa học.");
        if (course.status === "ARCHIVED")
          throw new ConflictException("Khóa học đã ngừng sử dụng.");
        if (course.status === "PUBLISHED") return this.mapCourse(course);
        const outcomes = this.toStringArray(course.outcomes);
        if (!outcomes.length)
          throw new BadRequestException(
            "Khóa học cần ít nhất một mục tiêu học tập.",
          );
        const nextVersion = course.versions.length
          ? course.versions[0]!.version + 1
          : Math.max(1, course.version);
        await transaction.courseVersion.create({
          data: {
            id: id("course-version"),
            courseId,
            version: nextVersion,
            name: course.name,
            description: course.description,
            outcomes,
            publishedBy: actorId,
          },
        });
        const updated = await transaction.course.update({
          where: { id: courseId },
          data: { status: "PUBLISHED", version: nextVersion },
        });
        await transaction.auditLog.create({
          data: {
            actorId,
            action: "COURSE_VERSION_PUBLISHED",
            entityType: "course",
            entityId: courseId,
            context: { version: nextVersion },
          },
        });
        return this.mapCourse(updated);
      });
    }
    const course = this.findCourse(courseId);
    if (course.status === "ARCHIVED")
      throw new ConflictException("Khóa học đã ngừng sử dụng.");
    if (course.status === "PUBLISHED")
      return { ...course, outcomes: [...course.outcomes] };
    if (!course.outcomes.length)
      throw new BadRequestException(
        "Khóa học cần ít nhất một mục tiêu học tập.",
      );
    const lastVersion = Math.max(
      0,
      ...this.courseVersions
        .filter((item) => item.courseId === courseId)
        .map((item) => item.version),
    );
    course.version = lastVersion
      ? lastVersion + 1
      : Math.max(1, course.version);
    course.status = "PUBLISHED";
    course.updatedAt = now();
    this.courseVersions.unshift({
      id: id("course-version"),
      courseId,
      version: course.version,
      name: course.name,
      description: course.description,
      outcomes: [...course.outcomes],
      publishedBy: actorId,
      publishedAt: now(),
    });
    return { ...course, outcomes: [...course.outcomes] };
  }

  /** Chuyển khóa học sang ARCHIVED sau khi kiểm tra ràng buộc sử dụng và lưu lý do audit. */
  async archiveCourse(
    courseId: string,
    reason: string,
    actorId = "usr-manager",
  ): Promise<LearningCourse> {
    const normalizedReason = reason.trim();
    if (normalizedReason.length < 5)
      throw new BadRequestException("Lý do ngừng sử dụng cần ít nhất 5 ký tự.");
    const prisma = this.database();
    if (prisma) {
      const current = await prisma.course.findUnique({
        where: { id: courseId },
      });
      if (!current) throw new NotFoundException("Không tìm thấy khóa học.");
      if (current.status === "ARCHIVED")
        throw new ConflictException("Khóa học đã ngừng sử dụng.");
      return prisma.$transaction(async (transaction) => {
        const activeClassCount = await transaction.learningClass.count({
          where: { courseId, status: "ACTIVE" },
        });
        if (activeClassCount > 0)
          throw new ConflictException(
            `Khóa học còn ${activeClassCount} lớp đang hoạt động; hãy đóng hoặc chuyển đổi các lớp trước khi lưu trữ.`,
          );
        const row = await transaction.course.update({
          where: { id: courseId },
          data: { status: "ARCHIVED" },
        });
        await transaction.auditLog.create({
          data: {
            actorId,
            action: "COURSE_ARCHIVED",
            entityType: "course",
            entityId: courseId,
            context: { reason: normalizedReason, version: current.version },
          },
        });
        return this.mapCourse(row);
      });
    }
    const current = this.findCourse(courseId);
    if (current.status === "ARCHIVED")
      throw new ConflictException("Khóa học đã ngừng sử dụng.");
    const activeClassCount = this.classes.filter(
      (item) => item.courseId === courseId && item.status === "ACTIVE",
    ).length;
    if (activeClassCount > 0)
      throw new ConflictException(
        `Khóa học còn ${activeClassCount} lớp đang hoạt động; hãy đóng hoặc chuyển đổi các lớp trước khi lưu trữ.`,
      );
    current.status = "ARCHIVED";
    current.updatedAt = now();
    return { ...current, outcomes: [...current.outcomes] };
  }

  /** Lọc lớp theo vai trò: quản trị xem tất cả, giảng viên/học viên theo quan hệ thành viên. */
  async listClasses(
    role: string,
    actorId = this.userIdForRole(role),
  ): Promise<LearningClass[]> {
    const prisma = this.database();
    if (prisma) {
      const rows = await prisma.learningClass.findMany({
        where:
          role === "LEARNER"
            ? {
                enrollments: { some: { learnerId: actorId, status: "ACTIVE" } },
              }
            : role === "INSTRUCTOR"
              ? { instructors: { some: { instructorId: actorId } } }
              : undefined,
        include: {
          instructors: true,
          enrollments: { where: { status: "ACTIVE" } },
        },
        orderBy: { startAt: "desc" },
      });
      return rows.map((row) => this.mapClass(row));
    }
    return this.classes
      .filter((item) =>
        role === "LEARNER"
          ? item.learnerIds.includes(actorId)
          : role === "INSTRUCTOR"
            ? item.instructorIds.includes(actorId)
            : true,
      )
      .map((item) => ({
        ...item,
        instructorIds: [...item.instructorIds],
        learnerIds: [...item.learnerIds],
      }));
  }

  /** Tính capability tại máy chủ từ quyền phiên, quan hệ lớp và trạng thái thay vì tên vai trò đơn lẻ. */
  async getClassCapabilities(classId: string, session: AuthenticatedSession): Promise<ClassCapabilities> {
    const prisma = this.database();
    let status: LearningClass["status"];
    let relationship: ClassCapabilities["relationship"] = "NONE";
    if (prisma) {
      const item = await prisma.learningClass.findUnique({ where: { id: classId }, include: { instructors: true, enrollments: true } });
      if (!item) throw new NotFoundException("Không tìm thấy lớp học.");
      status = item.status;
      if (session.roleCode === "SYSTEM_ADMIN") relationship = "ADMIN";
      else if (session.roleCode === "CENTER_MANAGER") relationship = "MANAGER";
      else if (item.instructors.some((entry) => entry.instructorId === session.user.id)) relationship = "INSTRUCTOR";
      else if (item.enrollments.some((entry) => entry.learnerId === session.user.id && entry.status === "ACTIVE")) relationship = "LEARNER";
    } else {
      const item = this.findClass(classId);
      status = item.status;
      if (session.roleCode === "SYSTEM_ADMIN") relationship = "ADMIN";
      else if (session.roleCode === "CENTER_MANAGER") relationship = "MANAGER";
      else if (item.instructorIds.includes(session.user.id)) relationship = "INSTRUCTOR";
      else if (item.learnerIds.includes(session.user.id)) relationship = "LEARNER";
    }
    const permissions = new Set(session.permissions);
    const related = relationship !== "NONE";
    if (!related) throw new NotFoundException("Không tìm thấy lớp học trong phạm vi truy cập.");
    const writable = status !== "CLOSED";
    const decide = (allowed: boolean, deniedReason: string): { allowed: boolean; reason?: string } => allowed ? { allowed: true } : { allowed: false, reason: !writable ? "Lớp đã đóng và chỉ cho phép đọc." : deniedReason };
    return {
      classId,
      relationship,
      classStatus: status,
      actions: {
        view: decide(permissions.has("class:view") && related, "Bạn không có quyền xem lớp này."),
        manageRoster: decide(writable && ["ADMIN", "MANAGER"].includes(relationship) && permissions.has("class:manage"), "Chỉ quản trị hoặc quản lý có quyền điều phối thành viên."),
        manageContent: decide(writable && relationship === "INSTRUCTOR" && permissions.has("material:manage"), "Chỉ giảng viên được phân công có quyền quản lý học liệu."),
        submitWork: decide(writable && relationship === "LEARNER" && permissions.has("exam:view"), "Chỉ học viên đang ghi danh có quyền nộp bài."),
        grade: decide(writable && relationship === "INSTRUCTOR" && permissions.has("exam:manage"), "Chỉ giảng viên được phân công có quyền chấm bài."),
        postForum: decide(writable && ["INSTRUCTOR", "LEARNER"].includes(relationship) && permissions.has("forum:post"), "Bạn không có quyền đăng trong lớp này."),
        joinLive: decide(writable && ["INSTRUCTOR", "LEARNER"].includes(relationship) && permissions.has("session:view"), "Bạn không thuộc lớp hoặc thiếu quyền tham gia buổi học."),
        chat: decide(writable && ["INSTRUCTOR", "LEARNER"].includes(relationship), "Bạn không phải thành viên đang hoạt động của lớp."),
      },
    };
  }

  /** Tạo lớp nháp từ phiên bản khóa học hợp lệ và kiểm tra lịch, sức chứa, múi giờ. */
  async createClass(
    input: Pick<
      LearningClass,
      "courseId" | "code" | "name" | "term" | "startAt" | "endAt" | "capacity"
    > &
      Partial<Pick<LearningClass, "timezone" | "allowLateEnrollment">>,
    actorId = "usr-manager",
  ): Promise<LearningClass> {
    const code = input.code.trim().toUpperCase();
    const term = input.term.trim();
    const timezone = input.timezone?.trim() || "Asia/Bangkok";
    this.validateTimezone(timezone);
    const prisma = this.database();
    if (prisma) {
      const course = await prisma.course.findUnique({
        where: { id: input.courseId },
      });
      if (!course || course.status !== "PUBLISHED")
        throw new BadRequestException(
          "Khóa học phải được phát hành trước khi mở lớp.",
        );
      if (new Date(input.endAt) <= new Date(input.startAt))
        throw new BadRequestException("Ngày kết thúc phải sau ngày bắt đầu.");
      try {
        const row = await prisma.learningClass.create({
          data: {
            id: id("class"),
            courseId: input.courseId,
            courseVersion: course.version,
            code,
            name: input.name.trim(),
            term,
            startAt: new Date(input.startAt),
            endAt: new Date(input.endAt),
            capacity: input.capacity,
            timezone,
            allowLateEnrollment: input.allowLateEnrollment ?? false,
          },
          include: { instructors: true, enrollments: true },
        });
        await prisma.auditLog.create({
          data: {
            actorId,
            action: "CLASS_DRAFT_CREATED",
            entityType: "learning_class",
            entityId: row.id,
            context: {
              courseId: input.courseId,
              courseVersion: course.version,
              code,
              term,
              timezone,
            },
          },
        });
        return this.mapClass(row);
      } catch (error) {
        if (isUniqueConstraintError(error))
          throw new ConflictException("Mã lớp đã tồn tại.");
        throw error;
      }
    }
    if (
      !this.courses.some(
        (course) =>
          course.id === input.courseId && course.status === "PUBLISHED",
      )
    )
      throw new BadRequestException(
        "Khóa học phải được phát hành trước khi mở lớp.",
      );
    if (new Date(input.endAt) <= new Date(input.startAt))
      throw new BadRequestException("Ngày kết thúc phải sau ngày bắt đầu.");
    if (this.classes.some((item) => item.code === code && item.term === term))
      throw new ConflictException("Mã lớp đã tồn tại trong học kỳ.");
    const course = this.findCourse(input.courseId);
    const item: LearningClass = {
      ...input,
      courseVersion: course.version,
      code,
      term,
      timezone,
      allowLateEnrollment: input.allowLateEnrollment ?? false,
      id: id("class"),
      status: "DRAFT",
      instructorIds: [],
      learnerIds: [],
    };
    this.classes.unshift(item);
    return { ...item, instructorIds: [], learnerIds: [] };
  }
  /** Gán giảng viên đúng role, bảo đảm người dùng có vai trò INSTRUCTOR và ghi lịch sử thành viên. */
  async assignInstructor(
    classId: string,
    instructorId: string,
    requestedRole?: InstructorRole,
    actorId = "usr-manager",
  ): Promise<LearningClass> {
    const prisma = this.database();
    if (prisma) {
      await this.requireUserRole(
        prisma,
        instructorId,
        "INSTRUCTOR",
        "Người dùng được chọn không phải giảng viên.",
      );
      const classItem = await prisma.learningClass.findUnique({
        where: { id: classId },
        include: { instructors: true },
      });
      if (!classItem) throw new NotFoundException("Không tìm thấy lớp học.");
      if (classItem.status === "CLOSED")
        throw new ConflictException("Lớp đã lưu trữ và chỉ cho phép đọc.");
      const role =
        requestedRole ??
        (classItem.instructors.length ? "CO_INSTRUCTOR" : "PRIMARY");
      const currentPrimary = classItem.instructors.find(
        (row) => row.role === "PRIMARY",
      );
      if (
        role === "PRIMARY" &&
        currentPrimary &&
        currentPrimary.instructorId !== instructorId
      )
        throw new ConflictException(
          "Lớp đã có giảng viên chính; hãy dùng luồng bàn giao để thay đổi.",
        );
      const load = await prisma.classInstructor.count({
        where: { instructorId, class: { status: { in: ["DRAFT", "ACTIVE"] } } },
      });
      if (
        !classItem.instructors.some(
          (row) => row.instructorId === instructorId,
        ) &&
        load >= 5
      )
        throw new ConflictException(
          "Giảng viên đã đạt giới hạn 5 lớp đang phụ trách.",
        );
      const targetSessions = await prisma.liveSession.findMany({
        where: { classId, status: { not: "CANCELLED" } },
        select: { startsAt: true, endsAt: true },
      });
      let overlap: { class: { code: string } } | null = null;
      for (const session of targetSessions) {
        overlap = await prisma.liveSession.findFirst({
          where: {
            classId: { not: classId },
            status: { not: "CANCELLED" },
            startsAt: { lt: session.endsAt },
            endsAt: { gt: session.startsAt },
            class: {
              status: "ACTIVE",
              instructors: { some: { instructorId } },
            },
          },
          select: { class: { select: { code: true } } },
        });
        if (overlap) break;
      }
      if (overlap)
        throw new ConflictException(
          `Giảng viên có buổi học xung đột với lớp ${overlap.class.code}.`,
        );
      await prisma.$transaction(async (transaction) => {
        if (role === "PRIMARY")
          await transaction.classInstructor.updateMany({
            where: {
              classId,
              role: "PRIMARY",
              instructorId: { not: instructorId },
            },
            data: { role: "CO_INSTRUCTOR" },
          });
        await transaction.classInstructor.upsert({
          where: { classId_instructorId: { classId, instructorId } },
          update: { role, assignedBy: actorId },
          create: { classId, instructorId, role, assignedBy: actorId },
        });
        await transaction.classInstructorHistory.create({
          data: {
            id: id("instructor-history"),
            classId,
            instructorId,
            role,
            action: "ASSIGNED",
            actorId,
          },
        });
        await transaction.notification.upsert({
          where: {
            dedupKey: `instructor-assigned:${classId}:${instructorId}:${role}`,
          },
          update: {
            title: `Bạn được phân công ${role === "PRIMARY" ? "giảng viên chính" : "đồng giảng viên"} cho lớp ${classItem.code}`,
            readAt: null,
            createdAt: new Date(),
          },
          create: {
            id: id("notification"),
            recipientId: instructorId,
            type: "CLASS_INSTRUCTOR_ASSIGNED",
            title: `Bạn được phân công ${role === "PRIMARY" ? "giảng viên chính" : "đồng giảng viên"} cho lớp ${classItem.code}`,
            entityType: "CLASS",
            entityId: classId,
            dedupKey: `instructor-assigned:${classId}:${instructorId}:${role}`,
          },
        });
      });
      return this.getDatabaseClass(prisma, classId);
    }
    const item = this.findClass(classId);
    if (item.status === "CLOSED")
      throw new ConflictException("Lớp đã lưu trữ và chỉ cho phép đọc.");
    const role =
      requestedRole ??
      (item.instructorIds.length ? "CO_INSTRUCTOR" : "PRIMARY");
    const currentPrimaryId = item.instructorIds.find(
      (currentId) =>
        this.instructorRoles.get(`${classId}:${currentId}`) === "PRIMARY",
    );
    if (
      role === "PRIMARY" &&
      currentPrimaryId &&
      currentPrimaryId !== instructorId
    )
      throw new ConflictException(
        "Lớp đã có giảng viên chính; hãy dùng luồng bàn giao để thay đổi.",
      );
    const targetSessions = this.sessions.filter(
      (session) => session.classId === classId && session.status !== "CANCELLED",
    );
    const conflictSession = targetSessions
      .map((targetSession) =>
        this.sessions.find((session) => {
          if (session.classId === classId || session.status === "CANCELLED")
            return false;
          const candidate = this.classes.find(
            (classItem) => classItem.id === session.classId,
          );
          return Boolean(
            candidate?.status === "ACTIVE" &&
              candidate.instructorIds.includes(instructorId) &&
              new Date(session.startsAt) < new Date(targetSession.endsAt) &&
              new Date(session.endsAt) > new Date(targetSession.startsAt),
          );
        }),
      )
      .find(Boolean);
    const conflict = conflictSession
      ? this.classes.find((candidate) => candidate.id === conflictSession.classId)
      : undefined;
    if (conflict)
      throw new ConflictException(
        `Giảng viên có buổi học xung đột với lớp ${conflict.code}.`,
      );
    if (role === "PRIMARY")
      for (const currentId of item.instructorIds)
        this.instructorRoles.set(`${classId}:${currentId}`, "CO_INSTRUCTOR");
    if (!item.instructorIds.includes(instructorId))
      item.instructorIds.push(instructorId);
    this.instructorRoles.set(`${classId}:${instructorId}`, role);
    this.recordMemberHistory(
      classId,
      instructorId,
      "INSTRUCTOR",
      "ASSIGNED",
      actorId,
      { role },
    );
    this.notifications.unshift({
      id: id("notification"),
      recipientId: instructorId,
      type: "CLASS_INSTRUCTOR_ASSIGNED",
      title: `Bạn được phân công vào lớp ${item.code}`,
      entityType: "CLASS",
      entityId: classId,
      createdAt: now(),
    });
    return {
      ...item,
      instructorIds: [...item.instructorIds],
      learnerIds: [...item.learnerIds],
    };
  }

  /** Bàn giao PRIMARY nguyên tử, chống hai yêu cầu đồng thời bằng người nguồn kỳ vọng. */
  async transferPrimaryInstructor(
    classId: string,
    expectedPrimaryId: string,
    newPrimaryId: string,
    rawReason: string,
    actorId = "usr-manager",
  ): Promise<LearningClass> {
    const reason = rawReason.trim();
    if (reason.length < 5)
      throw new BadRequestException("Lý do bàn giao cần ít nhất 5 ký tự.");
    if (expectedPrimaryId === newPrimaryId)
      throw new BadRequestException(
        "Giảng viên nhận bàn giao phải khác người hiện tại.",
      );
    const prisma = this.database();
    if (prisma) {
      await this.requireUserRole(
        prisma,
        newPrimaryId,
        "INSTRUCTOR",
        "Người nhận bàn giao không phải giảng viên.",
      );
      return prisma.$transaction(async (transaction) => {
        await transaction.$queryRaw`SELECT id FROM learning_classes WHERE id = ${classId} FOR UPDATE`;
        const classItem = await transaction.learningClass.findUnique({
          where: { id: classId },
          include: { instructors: true },
        });
        if (!classItem) throw new NotFoundException("Không tìm thấy lớp học.");
        if (classItem.status === "CLOSED")
          throw new ConflictException("Lớp đã lưu trữ và chỉ cho phép đọc.");
        const currentPrimary = classItem.instructors.find(
          (row) => row.role === "PRIMARY",
        );
        if (currentPrimary?.instructorId !== expectedPrimaryId)
          throw new ConflictException(
            "Giảng viên chính đã thay đổi; hãy tải lại trước khi bàn giao.",
          );
        const claimed = await transaction.classInstructor.updateMany({
          where: { classId, instructorId: expectedPrimaryId, role: "PRIMARY" },
          data: { role: "CO_INSTRUCTOR" },
        });
        if (claimed.count !== 1)
          throw new ConflictException(
            "Giảng viên chính đã thay đổi; hãy tải lại trước khi bàn giao.",
          );
        await transaction.classInstructor.upsert({
          where: {
            classId_instructorId: { classId, instructorId: newPrimaryId },
          },
          update: { role: "PRIMARY", assignedBy: actorId },
          create: {
            classId,
            instructorId: newPrimaryId,
            role: "PRIMARY",
            assignedBy: actorId,
          },
        });
        await transaction.classInstructorHistory.createMany({
          data: [
            {
              id: id("instructor-history"),
              classId,
              instructorId: expectedPrimaryId,
              role: "CO_INSTRUCTOR",
              action: "PRIMARY_TRANSFERRED_OUT",
              reason,
              actorId,
            },
            {
              id: id("instructor-history"),
              classId,
              instructorId: newPrimaryId,
              role: "PRIMARY",
              action: "PRIMARY_TRANSFERRED_IN",
              reason,
              actorId,
            },
          ],
        });
        for (const recipientId of new Set([expectedPrimaryId, newPrimaryId]))
          await transaction.notification.upsert({
            where: {
              dedupKey: `primary-transfer:${classId}:${expectedPrimaryId}:${newPrimaryId}:${recipientId}`,
            },
            update: { readAt: null, createdAt: new Date() },
            create: {
              id: id("notification"),
              recipientId,
              type: "CLASS_PRIMARY_TRANSFERRED",
              title: `Lớp ${classItem.code} đã bàn giao giảng viên chính`,
              entityType: "CLASS",
              entityId: classId,
              dedupKey: `primary-transfer:${classId}:${expectedPrimaryId}:${newPrimaryId}:${recipientId}`,
            },
          });
        await transaction.auditLog.create({
          data: {
            actorId,
            action: "CLASS_PRIMARY_TRANSFERRED",
            entityType: "learning_class",
            entityId: classId,
            context: { expectedPrimaryId, newPrimaryId, reason },
          },
        });
        return this.getDatabaseClass(transaction, classId);
      });
    }
    const item = this.findClass(classId);
    if (item.status === "CLOSED")
      throw new ConflictException("Lớp đã lưu trữ và chỉ cho phép đọc.");
    const currentPrimaryId = item.instructorIds.find(
      (instructorId) =>
        this.instructorRoles.get(`${classId}:${instructorId}`) === "PRIMARY",
    );
    if (currentPrimaryId !== expectedPrimaryId)
      throw new ConflictException(
        "Giảng viên chính đã thay đổi; hãy tải lại trước khi bàn giao.",
      );
    this.instructorRoles.set(
      `${classId}:${expectedPrimaryId}`,
      "CO_INSTRUCTOR",
    );
    if (!item.instructorIds.includes(newPrimaryId))
      item.instructorIds.push(newPrimaryId);
    this.instructorRoles.set(`${classId}:${newPrimaryId}`, "PRIMARY");
    this.recordMemberHistory(
      classId,
      expectedPrimaryId,
      "INSTRUCTOR",
      "PRIMARY_TRANSFERRED_OUT",
      actorId,
      { role: "CO_INSTRUCTOR", reason },
    );
    this.recordMemberHistory(
      classId,
      newPrimaryId,
      "INSTRUCTOR",
      "PRIMARY_TRANSFERRED_IN",
      actorId,
      { role: "PRIMARY", reason },
    );
    return {
      ...item,
      instructorIds: [...item.instructorIds],
      learnerIds: [...item.learnerIds],
    };
  }

  /** Gỡ phân công giảng viên, bảo vệ điều kiện giảng viên chính và lưu lý do lịch sử. */
  async removeInstructor(
    classId: string,
    instructorId: string,
    reason: string,
    actorId = "usr-manager",
  ): Promise<LearningClass> {
    const normalizedReason = reason.trim();
    if (normalizedReason.length < 5)
      throw new BadRequestException("Lý do gỡ phân công cần ít nhất 5 ký tự.");
    const prisma = this.database();
    if (prisma) {
      const current = await prisma.classInstructor.findUnique({
        where: { classId_instructorId: { classId, instructorId } },
      });
      if (!current) throw new NotFoundException("Giảng viên không thuộc lớp.");
      const primaryCount = await prisma.classInstructor.count({
        where: { classId, role: "PRIMARY" },
      });
      if (current.role === "PRIMARY" && primaryCount <= 1)
        throw new ConflictException(
          "Không thể gỡ giảng viên chính cuối cùng; hãy phân công người thay thế trước.",
        );
      await prisma.$transaction([
        prisma.classInstructor.delete({
          where: { classId_instructorId: { classId, instructorId } },
        }),
        prisma.classInstructorHistory.create({
          data: {
            id: id("instructor-history"),
            classId,
            instructorId,
            role: current.role,
            action: "REMOVED",
            reason: normalizedReason,
            actorId,
          },
        }),
        prisma.notification.upsert({
          where: { dedupKey: `instructor-removed:${classId}:${instructorId}` },
          update: { readAt: null, createdAt: new Date() },
          create: {
            id: id("notification"),
            recipientId: instructorId,
            type: "CLASS_INSTRUCTOR_REMOVED",
            title: "Phân công giảng dạy đã được cập nhật",
            entityType: "CLASS",
            entityId: classId,
            dedupKey: `instructor-removed:${classId}:${instructorId}`,
          },
        }),
      ]);
      return this.getDatabaseClass(prisma, classId);
    }
    const item = this.findClass(classId);
    const role = this.instructorRoles.get(`${classId}:${instructorId}`);
    if (!role) throw new NotFoundException("Giảng viên không thuộc lớp.");
    if (
      role === "PRIMARY" &&
      item.instructorIds.filter(
        (value) =>
          this.instructorRoles.get(`${classId}:${value}`) === "PRIMARY",
      ).length <= 1
    )
      throw new ConflictException(
        "Không thể gỡ giảng viên chính cuối cùng; hãy phân công người thay thế trước.",
      );
    item.instructorIds = item.instructorIds.filter(
      (value) => value !== instructorId,
    );
    this.instructorRoles.delete(`${classId}:${instructorId}`);
    this.recordMemberHistory(
      classId,
      instructorId,
      "INSTRUCTOR",
      "REMOVED",
      actorId,
      { role, reason: normalizedReason },
    );
    return {
      ...item,
      instructorIds: [...item.instructorIds],
      learnerIds: [...item.learnerIds],
    };
  }

  /** Ghi danh học viên sau khi kiểm tra vai trò, trạng thái lớp, thời hạn và sức chứa. */
  async enrollLearner(
    classId: string,
    learnerId: string,
    actorId = "usr-manager",
  ): Promise<LearningClass> {
    const prisma = this.database();
    if (prisma) {
      await this.requireUserRole(
        prisma,
        learnerId,
        "LEARNER",
        "Người dùng được chọn không phải học viên.",
      );
      return prisma.$transaction(async (transaction) => {
        await transaction.$queryRaw`SELECT id FROM learning_classes WHERE id = ${classId} FOR UPDATE`;
        const classItem = await transaction.learningClass.findUnique({
          where: { id: classId },
          include: { enrollments: { where: { status: "ACTIVE" } } },
        });
        if (!classItem) throw new NotFoundException("Không tìm thấy lớp học.");
        if (classItem.status === "CLOSED")
          throw new ConflictException("Lớp đã lưu trữ và chỉ cho phép đọc.");
        if (new Date() > classItem.endAt)
          throw new ConflictException(
            "Lớp đã kết thúc, không thể ghi danh thêm học viên.",
          );
        if (
          classItem.status === "ACTIVE" &&
          new Date() > classItem.startAt &&
          !classItem.allowLateEnrollment
        )
          throw new ConflictException(
            "Lớp đã bắt đầu và không cho phép ghi danh muộn.",
          );
        if (classItem.enrollments.some((row) => row.learnerId === learnerId))
          throw new ConflictException("Học viên đã có trong lớp.");
        if (classItem.enrollments.length >= classItem.capacity)
          throw new BadRequestException("Lớp đã đủ sĩ số.");
        await transaction.classEnrollment.upsert({
          where: { classId_learnerId: { classId, learnerId } },
          update: {
            status: "ACTIVE",
            joinedAt: new Date(),
            source: "MANUAL",
            removalReason: null,
            removedAt: null,
          },
          create: { classId, learnerId, status: "ACTIVE", source: "MANUAL" },
        });
        await transaction.classEnrollmentHistory.create({
          data: {
            id: id("enrollment-history"),
            classId,
            learnerId,
            action: "ENROLLED",
            source: "MANUAL",
            actorId,
          },
        });
        await transaction.notification.upsert({
          where: { dedupKey: `class-enrolled:${classId}:${learnerId}` },
          update: {
            title: `Bạn đã được ghi danh vào lớp ${classItem.code}`,
            readAt: null,
            createdAt: new Date(),
          },
          create: {
            id: id("notification"),
            recipientId: learnerId,
            type: "CLASS_ENROLLED",
            title: `Bạn đã được ghi danh vào lớp ${classItem.code}`,
            entityType: "CLASS",
            entityId: classId,
            dedupKey: `class-enrolled:${classId}:${learnerId}`,
          },
        });
        return this.getDatabaseClass(transaction, classId);
      }, { isolationLevel: "ReadCommitted" });
    }
    const item = this.findClass(classId);
    if (item.status === "CLOSED")
      throw new ConflictException("Lớp đã lưu trữ và chỉ cho phép đọc.");
    if (new Date() > new Date(item.endAt))
      throw new ConflictException(
        "Lớp đã kết thúc, không thể ghi danh thêm học viên.",
      );
    if (
      item.status === "ACTIVE" &&
      new Date() > new Date(item.startAt) &&
      !item.allowLateEnrollment
    )
      throw new ConflictException(
        "Lớp đã bắt đầu và không cho phép ghi danh muộn.",
      );
    if (item.learnerIds.includes(learnerId))
      throw new ConflictException("Học viên đã có trong lớp.");
    if (item.learnerIds.length >= item.capacity)
      throw new BadRequestException("Lớp đã đủ sĩ số.");
    item.learnerIds.push(learnerId);
    this.recordMemberHistory(
      classId,
      learnerId,
      "LEARNER",
      "ENROLLED",
      actorId,
      { source: "MANUAL" },
    );
    this.notifications.unshift({
      id: id("notification"),
      recipientId: learnerId,
      type: "CLASS_ENROLLED",
      title: `Bạn đã được ghi danh vào lớp ${item.code}`,
      entityType: "CLASS",
      entityId: classId,
      createdAt: now(),
    });
    return {
      ...item,
      instructorIds: [...item.instructorIds],
      learnerIds: [...item.learnerIds],
    };
  }

  /** Ghi danh lần lượt danh sách userId và cô lập lỗi để trả kết quả trên từng học viên. */
  async importEnrollments(
    classId: string,
    userIds: string[],
    actorId = "usr-manager",
  ): Promise<EnrollmentImportResult[]> {
    const normalized = userIds.map((value) => value.trim()).filter(Boolean);
    const seen = new Set<string>();
    const results: EnrollmentImportResult[] = [];
    for (const identifier of normalized) {
      const key = identifier.toLowerCase();
      if (seen.has(key)) {
        results.push({
          userId: identifier,
          status: "SKIPPED",
          message: "Trùng trong danh sách nhập.",
        });
        continue;
      }
      seen.add(key);
      try {
        const prisma = this.database();
        const user = prisma
          ? await prisma.user.findFirst({
              where: {
                status: "ACTIVE",
                OR: [{ id: identifier }, { email: key }],
                roles: { some: { role: { code: "LEARNER" } } },
              },
              select: { id: true },
            })
          : null;
        const userId = user?.id ?? identifier;
        await this.enrollLearner(classId, userId, actorId);
        results.push({
          userId,
          status: "ENROLLED",
          message: "Ghi danh thành công.",
        });
      } catch (error) {
        results.push({
          userId: identifier,
          status: error instanceof ConflictException ? "SKIPPED" : "FAILED",
          message:
            error instanceof Error ? error.message : "Không thể ghi danh.",
        });
      }
    }
    return results;
  }

  /** Hủy ghi danh theo kiểu lưu lịch sử, thay vì xóa mất dấu vết thành viên. */
  async removeEnrollment(
    classId: string,
    learnerId: string,
    reason: string,
    actorId = "usr-manager",
  ): Promise<LearningClass> {
    const normalizedReason = reason.trim();
    if (normalizedReason.length < 5)
      throw new BadRequestException("Lý do gỡ học viên cần ít nhất 5 ký tự.");
    const prisma = this.database();
    if (prisma) {
      const enrollment = await prisma.classEnrollment.findUnique({
        where: { classId_learnerId: { classId, learnerId } },
      });
      if (!enrollment || enrollment.status !== "ACTIVE")
        throw new NotFoundException(
          "Học viên không có ghi danh đang hoạt động.",
        );
      await prisma.$transaction([
        prisma.classEnrollment.update({
          where: { classId_learnerId: { classId, learnerId } },
          data: {
            status: "CANCELLED",
            removalReason: normalizedReason,
            removedAt: new Date(),
          },
        }),
        prisma.classEnrollmentHistory.create({
          data: {
            id: id("enrollment-history"),
            classId,
            learnerId,
            action: "REMOVED",
            source: enrollment.source,
            reason: normalizedReason,
            actorId,
          },
        }),
        prisma.notification.upsert({
          where: { dedupKey: `enrollment-removed:${classId}:${learnerId}` },
          update: { readAt: null, createdAt: new Date() },
          create: {
            id: id("notification"),
            recipientId: learnerId,
            type: "CLASS_ENROLLMENT_REMOVED",
            title: "Trạng thái ghi danh lớp học đã thay đổi",
            entityType: "CLASS",
            entityId: classId,
            dedupKey: `enrollment-removed:${classId}:${learnerId}`,
          },
        }),
      ]);
      return this.getDatabaseClass(prisma, classId);
    }
    const item = this.findClass(classId);
    if (!item.learnerIds.includes(learnerId))
      throw new NotFoundException("Học viên không có ghi danh đang hoạt động.");
    item.learnerIds = item.learnerIds.filter((value) => value !== learnerId);
    this.recordMemberHistory(
      classId,
      learnerId,
      "LEARNER",
      "REMOVED",
      actorId,
      { source: "MANUAL", reason: normalizedReason },
    );
    return {
      ...item,
      instructorIds: [...item.instructorIds],
      learnerIds: [...item.learnerIds],
    };
  }

  /** Tổng hợp giảng viên, ghi danh đang/cũ và lịch sử thao tác thành roster chi tiết. */
  async getClassRoster(classId: string): Promise<ClassRoster> {
    const prisma = this.database();
    if (prisma) {
      const item = await prisma.learningClass.findUnique({
        where: { id: classId },
        include: {
          instructors: {
            orderBy: { assignedAt: "asc" },
            include: {
              instructor: { select: { displayName: true, email: true } },
            },
          },
          enrollments: {
            orderBy: { joinedAt: "asc" },
            include: {
              learner: { select: { displayName: true, email: true } },
            },
          },
          instructorHistory: { orderBy: { createdAt: "desc" } },
          enrollmentHistory: { orderBy: { createdAt: "desc" } },
        },
      });
      if (!item) throw new NotFoundException("Không tìm thấy lớp học.");
      return {
        classId,
        instructors: item.instructors.map((row) => ({
          instructorId: row.instructorId,
          displayName: row.instructor.displayName,
          email: row.instructor.email,
          role: row.role,
          assignedAt: row.assignedAt.toISOString(),
        })),
        enrollments: item.enrollments.map((row) => ({
          learnerId: row.learnerId,
          displayName: row.learner.displayName,
          email: row.learner.email,
          status: row.status === "ACTIVE" ? "ACTIVE" : "CANCELLED",
          source: row.source,
          joinedAt: row.joinedAt.toISOString(),
          removalReason: row.removalReason ?? undefined,
          removedAt: row.removedAt?.toISOString(),
        })),
        history: [
          ...item.instructorHistory.map((row) => ({
            id: row.id,
            memberId: row.instructorId,
            memberType: "INSTRUCTOR" as const,
            action: row.action,
            role: row.role,
            reason: row.reason ?? undefined,
            actorId: row.actorId,
            createdAt: row.createdAt.toISOString(),
          })),
          ...item.enrollmentHistory.map((row) => ({
            id: row.id,
            memberId: row.learnerId,
            memberType: "LEARNER" as const,
            action: row.action,
            source: row.source,
            reason: row.reason ?? undefined,
            actorId: row.actorId,
            createdAt: row.createdAt.toISOString(),
          })),
        ].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
      };
    }
    const item = this.findClass(classId);
    return {
      classId,
      instructors: item.instructorIds.map((instructorId) => ({
        instructorId,
        role:
          this.instructorRoles.get(`${classId}:${instructorId}`) ??
          "CO_INSTRUCTOR",
        assignedAt: now(),
      })),
      enrollments: item.learnerIds.map((learnerId) => ({
        learnerId,
        status: "ACTIVE",
        source: "MANUAL",
        joinedAt: now(),
      })),
      history: this.classMemberHistory
        .filter((row) => row.id.startsWith(`${classId}:`))
        .map((row) => ({ ...row })),
    };
  }

  /** Kích hoạt lớp khi khóa học đã xuất bản, lịch hợp lệ và có giảng viên chính. */
  async activateClass(
    classId: string,
    actorId = "usr-manager",
  ): Promise<LearningClass> {
    const prisma = this.database();
    if (prisma) {
      const item = await this.getDatabaseClass(prisma, classId);
      if (item.status === "ACTIVE") return item;
      if (item.status === "CLOSED")
        throw new ConflictException(
          "Lớp đã đóng và không thể kích hoạt trực tiếp.",
        );
      if (!item.instructorIds.length)
        throw new BadRequestException(
          "Cần phân công ít nhất một giảng viên trước khi kích hoạt.",
        );
      if (
        (await prisma.classInstructor.count({
          where: { classId, role: "PRIMARY" },
        })) !== 1
      )
        throw new BadRequestException(
          "Lớp cần đúng một giảng viên chính trước khi kích hoạt.",
        );
      if (new Date(item.endAt) <= new Date(item.startAt))
        throw new BadRequestException("Lịch lớp không hợp lệ.");
      if (item.learnerIds.length > item.capacity)
        throw new BadRequestException("Sĩ số hiện tại vượt quá sức chứa lớp.");
      await prisma.$transaction([
        prisma.learningClass.update({
          where: { id: classId },
          data: { status: "ACTIVE" },
        }),
        prisma.auditLog.create({
          data: {
            actorId,
            action: "CLASS_ACTIVATED",
            entityType: "learning_class",
            entityId: classId,
            context: {
              courseId: item.courseId,
              courseVersion: item.courseVersion,
              instructorCount: item.instructorIds.length,
              learnerCount: item.learnerIds.length,
            },
          },
        }),
      ]);
      return this.getDatabaseClass(prisma, classId);
    }
    const item = this.findClass(classId);
    if (item.status === "ACTIVE")
      return {
        ...item,
        instructorIds: [...item.instructorIds],
        learnerIds: [...item.learnerIds],
      };
    if (item.status === "CLOSED")
      throw new ConflictException(
        "Lớp đã đóng và không thể kích hoạt trực tiếp.",
      );
    if (!item.instructorIds.length)
      throw new BadRequestException(
        "Cần phân công ít nhất một giảng viên trước khi kích hoạt.",
      );
    if (
      item.instructorIds.filter(
        (instructorId) =>
          this.instructorRoles.get(`${classId}:${instructorId}`) === "PRIMARY",
      ).length !== 1
    )
      throw new BadRequestException(
        "Lớp cần đúng một giảng viên chính trước khi kích hoạt.",
      );
    if (new Date(item.endAt) <= new Date(item.startAt))
      throw new BadRequestException("Lịch lớp không hợp lệ.");
    if (item.learnerIds.length > item.capacity)
      throw new BadRequestException("Sĩ số hiện tại vượt quá sức chứa lớp.");
    item.status = "ACTIVE";
    return {
      ...item,
      instructorIds: [...item.instructorIds],
      learnerIds: [...item.learnerIds],
    };
  }

  /** Đếm các nghiệp vụ còn mở để xác định lớp có thể đóng hay chưa. */
  async getClassClosureReadiness(
    classId: string,
  ): Promise<ClassClosureReadiness> {
    const prisma = this.database();
    if (prisma) {
      const current = await prisma.learningClass.findUnique({
        where: { id: classId },
      });
      if (!current) throw new NotFoundException("Không tìm thấy lớp học.");
      const [
        openExams,
        inProgressAttempts,
        pendingGrades,
        openAssignments,
        pendingAssignmentGrades,
        openRegrades,
        activeSessions,
        unlockedAttendanceSessions,
        openAppeals,
      ] = await prisma.$transaction([
        prisma.exam.count({
          where: {
            classId,
            OR: [
              { status: "PENDING_REVIEW" },
              { status: "PUBLISHED", closeAt: { gt: new Date() } },
            ],
          },
        }),
        prisma.examAttempt.count({
          where: { exam: { classId }, status: "IN_PROGRESS" },
        }),
        prisma.examAttempt.count({
          where: { exam: { classId }, status: "SUBMITTED" },
        }),
        prisma.assignment.count({
          where: { classId, status: "PUBLISHED", dueAt: { gt: new Date() } },
        }),
        prisma.assignmentSubmission.count({
          where: { assignment: { classId }, status: "SUBMITTED" },
        }),
        prisma.regradeRequest.count({
          where: {
            attempt: { exam: { classId } },
            status: { in: ["OPEN", "IN_REVIEW"] },
          },
        }),
        prisma.liveSession.count({
          where: { classId, status: { in: ["SCHEDULED", "LIVE"] } },
        }),
        prisma.liveSession.count({
          where: { classId, status: "COMPLETED", attendanceLockedAt: null },
        }),
        prisma.attendanceAppeal.count({
          where: {
            session: { classId },
            status: { in: ["OPEN", "IN_REVIEW"] },
          },
        }),
      ]);
      return this.buildClassClosureReadiness(current.status, current.endAt, {
        openExams,
        inProgressAttempts,
        pendingGrades,
        openAssignments,
        pendingAssignmentGrades,
        openRegrades,
        activeSessions,
        unlockedAttendanceSessions,
        openAppeals,
      });
    }
    const item = this.findClass(classId);
    const classExams = this.exams.filter((exam) => exam.classId === classId);
    const classSessions = this.sessions.filter(
      (session) => session.classId === classId,
    );
    return this.buildClassClosureReadiness(item.status, new Date(item.endAt), {
      openExams: classExams.filter(
        (exam) =>
          exam.status === "PENDING_REVIEW" ||
          (exam.status === "PUBLISHED" && new Date(exam.closeAt) > new Date()),
      ).length,
      inProgressAttempts: this.attempts.filter(
        (attempt) =>
          classExams.some((exam) => exam.id === attempt.examId) &&
          attempt.status === "IN_PROGRESS",
      ).length,
      pendingGrades: this.attempts.filter(
        (attempt) =>
          classExams.some((exam) => exam.id === attempt.examId) &&
          attempt.status === "SUBMITTED",
      ).length,
      openAssignments: 0,
      pendingAssignmentGrades: 0,
      openRegrades: this.regradeRequests.filter(
        (request) =>
          classExams.some((exam) =>
            this.attempts.some(
              (attempt) =>
                attempt.id === request.attemptId && attempt.examId === exam.id,
            ),
          ) && ["OPEN", "IN_REVIEW"].includes(request.status),
      ).length,
      activeSessions: classSessions.filter(
        (session) =>
          session.status === "SCHEDULED" || session.status === "LIVE",
      ).length,
      unlockedAttendanceSessions: classSessions.filter(
        (session) =>
          session.status === "COMPLETED" && !session.attendanceLockedAt,
      ).length,
      openAppeals: this.attendanceAppeals.filter(
        (appeal) =>
          classSessions.some((session) => session.id === appeal.sessionId) &&
          ["OPEN", "IN_REVIEW"].includes(appeal.status),
      ).length,
    });
  }

  /** Tính lại mọi blocker trong chính transaction đóng lớp để loại cửa sổ cạnh tranh với lệnh tạo/nộp. */
  private async databaseClassClosureReadiness(database: Prisma.TransactionClient, classId: string): Promise<ClassClosureReadiness> {
    const current = await database.learningClass.findUnique({ where: { id: classId } });
    if (!current) throw new NotFoundException("Không tìm thấy lớp học.");
    const [openExams, inProgressAttempts, pendingGrades, openAssignments, pendingAssignmentGrades, openRegrades, activeSessions, unlockedAttendanceSessions, openAppeals] = await Promise.all([
      database.exam.count({ where: { classId, OR: [{ status: "PENDING_REVIEW" }, { status: "PUBLISHED", closeAt: { gt: new Date() } }] } }),
      database.examAttempt.count({ where: { exam: { classId }, status: "IN_PROGRESS" } }),
      database.examAttempt.count({ where: { exam: { classId }, status: "SUBMITTED" } }),
      database.assignment.count({ where: { classId, status: "PUBLISHED", dueAt: { gt: new Date() } } }),
      database.assignmentSubmission.count({ where: { assignment: { classId }, status: "SUBMITTED" } }),
      database.regradeRequest.count({ where: { attempt: { exam: { classId } }, status: { in: ["OPEN", "IN_REVIEW"] } } }),
      database.liveSession.count({ where: { classId, status: { in: ["SCHEDULED", "LIVE"] } } }),
      database.liveSession.count({ where: { classId, status: "COMPLETED", attendanceLockedAt: null } }),
      database.attendanceAppeal.count({ where: { session: { classId }, status: { in: ["OPEN", "IN_REVIEW"] } } }),
    ]);
    return this.buildClassClosureReadiness(current.status, current.endAt, { openExams, inProgressAttempts, pendingGrades, openAssignments, pendingAssignmentGrades, openRegrades, activeSessions, unlockedAttendanceSessions, openAppeals });
  }

  /** Đóng lớp chỉ khi readiness không còn blocker và lưu chính sách lưu trữ. */
  async closeClass(
    classId: string,
    closeReason: string,
    archivePolicy: "STANDARD_RETENTION" | "LONG_TERM_RETENTION",
    actorId = "usr-manager",
  ): Promise<LearningClass> {
    const reason = closeReason.trim();
    if (reason.length < 5)
      throw new BadRequestException("Lý do đóng lớp cần ít nhất 5 ký tự.");
    const prisma = this.database();
    if (prisma) {
      await prisma.$transaction(async (transaction) => {
        await transaction.$queryRaw`SELECT id FROM learning_classes WHERE id = ${classId} FOR UPDATE`;
        const readiness = await this.databaseClassClosureReadiness(transaction, classId);
        if (!readiness.eligible)
          throw new ConflictException(`Chưa thể đóng lớp: ${readiness.blockers.join("; ")}.`);
        const updated = await transaction.learningClass.updateMany({
          where: { id: classId, status: "ACTIVE" },
          data: {
            status: "CLOSED",
            closeReason: reason,
            archivePolicy,
            closedAt: new Date(),
            archivedAt: new Date(),
          },
        });
        if (updated.count !== 1)
          throw new ConflictException(
            "Trạng thái lớp đã thay đổi; hãy kiểm tra lại trước khi đóng.",
          );
        await transaction.auditLog.create({
          data: {
            actorId,
            action: "CLASS_CLOSE_ARCHIVE",
            entityType: "learning_class",
            entityId: classId,
            context: {
              closeReason: reason,
              archivePolicy,
              eligible: readiness.eligible,
              blockers: readiness.blockers,
              openExams: readiness.openExams,
              pendingGrades: readiness.pendingGrades,
              activeSessions: readiness.activeSessions,
              unlockedAttendanceSessions: readiness.unlockedAttendanceSessions,
              openAppeals: readiness.openAppeals,
            },
          },
        });
        const recipients = await transaction.classEnrollment.findMany({
          where: { classId, status: "ACTIVE" },
          select: { learnerId: true },
        });
        for (const recipient of recipients)
          await transaction.notification.upsert({
            where: {
              dedupKey: `class-archived:${classId}:${recipient.learnerId}`,
            },
            update: { readAt: null, createdAt: new Date() },
            create: {
              id: id("notification"),
              recipientId: recipient.learnerId,
              type: "CLASS_ARCHIVED",
              title: "Lớp học đã kết thúc và chuyển sang chỉ đọc",
              entityType: "CLASS",
              entityId: classId,
              dedupKey: `class-archived:${classId}:${recipient.learnerId}`,
            },
          });
      }, { isolationLevel: "Serializable" });
      return this.getDatabaseClass(prisma, classId);
    }
    const readiness = await this.getClassClosureReadiness(classId);
    if (!readiness.eligible)
      throw new ConflictException(`Chưa thể đóng lớp: ${readiness.blockers.join("; ")}.`);
    const item = this.findClass(classId);
    item.status = "CLOSED";
    item.closeReason = reason;
    item.archivePolicy = archivePolicy;
    item.closedAt = now();
    item.archivedAt = item.closedAt;
    for (const learnerId of item.learnerIds)
      this.notifications.unshift({
        id: id("notification"),
        recipientId: learnerId,
        type: "CLASS_ARCHIVED",
        title: "Lớp học đã kết thúc và chuyển sang chỉ đọc",
        entityType: "CLASS",
        entityId: classId,
        createdAt: now(),
      });
    return {
      ...item,
      instructorIds: [...item.instructorIds],
      learnerIds: [...item.learnerIds],
    };
  }

  /** Mở lại lớp đã đóng, xóa thông tin đóng và ghi lý do vào audit. */
  async reopenClass(
    classId: string,
    rawReason: string,
    actorId = "usr-manager",
  ): Promise<LearningClass> {
    const reason = rawReason.trim();
    if (reason.length < 5)
      throw new BadRequestException("Lý do mở lại lớp cần ít nhất 5 ký tự.");
    const prisma = this.database();
    if (prisma) {
      await prisma.$transaction(async (transaction) => {
        const current = await transaction.learningClass.findUnique({
          where: { id: classId },
        });
        if (!current) throw new NotFoundException("Không tìm thấy lớp học.");
        if (current.status !== "CLOSED")
          throw new ConflictException("Chỉ lớp đã đóng mới có thể mở lại.");
        await transaction.learningClass.update({
          where: { id: classId },
          data: {
            status: "ACTIVE",
            closeReason: null,
            archivePolicy: null,
            closedAt: null,
            archivedAt: null,
          },
        });
        await transaction.auditLog.create({
          data: {
            actorId,
            action: "CLASS_REOPEN",
            entityType: "learning_class",
            entityId: classId,
            context: {
              reason,
              previousClosedAt: current.closedAt?.toISOString(),
              previousArchivePolicy: current.archivePolicy,
            },
          },
        });
      });
      return this.getDatabaseClass(prisma, classId);
    }
    const item = this.findClass(classId);
    if (item.status !== "CLOSED")
      throw new ConflictException("Chỉ lớp đã đóng mới có thể mở lại.");
    item.status = "ACTIVE";
    item.closeReason = undefined;
    item.archivePolicy = undefined;
    item.closedAt = undefined;
    item.archivedAt = undefined;
    return {
      ...item,
      instructorIds: [...item.instructorIds],
      learnerIds: [...item.learnerIds],
    };
  }

  /** Return one bounded page for legacy array clients; the search endpoint also exposes totals. */
  async listMaterials(role: string, query?: string, actorId = this.userIdForRole(role), page = 1): Promise<LearningMaterial[]> {
    return (await this.searchAccessibleMaterials({ query, page, pageSize: 50 }, actorId, role)).items;
  }

  /** Tìm học liệu đã công bố của học viên bằng bộ lọc và phân trang có giới hạn. */
  async searchAccessibleMaterials(
    input: {
      query?: string;
      classId?: string;
      courseId?: string;
      visibility?: string;
      aiOnly?: boolean;
      folder?: string;
      mimeType?: string;
      tag?: string;
      page?: number;
      pageSize?: number;
    },
    learnerId = "usr-learner",
    role = "LEARNER",
  ): Promise<MaterialSearchResult> {
    const page =
      Number.isSafeInteger(input.page) && (input.page ?? 0) > 0 && (input.page ?? 0) <= 1_000_000
        ? (input.page as number)
        : 1;
    const pageSize =
      Number.isInteger(input.pageSize) && (input.pageSize ?? 0) > 0
        ? Math.min(input.pageSize as number, 50)
        : 12;
    const query = input.query?.trim();
    if ([query, input.tag, input.folder, input.classId, input.courseId, input.mimeType].some((value) => value && value.length > 255)) throw new BadRequestException("Search filters must not exceed 255 characters.");
    const prisma = this.database();
    if (prisma) {
      const conditions: Prisma.Sql[] = [];
      if (role === "LEARNER") conditions.push(Prisma.sql`m.visibility = 'PUBLISHED' AND m.quarantined_at IS NULL AND EXISTS (SELECT 1 FROM class_enrollments e WHERE e.class_id = m.class_id AND e.learner_id = ${learnerId} AND e.status = 'ACTIVE')`);
      else if (role === "INSTRUCTOR") conditions.push(Prisma.sql`EXISTS (SELECT 1 FROM class_instructors i WHERE i.class_id = m.class_id AND i.instructor_id = ${learnerId})`);
      else if (!["SYSTEM_ADMIN", "CENTER_MANAGER"].includes(role)) conditions.push(Prisma.sql`FALSE`);
      if (input.classId) conditions.push(Prisma.sql`m.class_id = ${input.classId}`);
      if (input.courseId) conditions.push(Prisma.sql`m.course_id = ${input.courseId}`);
      if (input.mimeType) conditions.push(Prisma.sql`m.mime_type = ${input.mimeType}`);
      if (input.visibility) conditions.push(Prisma.sql`m.visibility::text = ${input.visibility}`);
      if (input.aiOnly) conditions.push(Prisma.sql`m.mime_type IN ('application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'image/png', 'image/jpeg')`);
      // Escape LIKE metacharacters: user searches are literal substrings, never SQL patterns.
      const contains = (value: string): string => `%${value.replace(/[\\%_]/g, "\\$&")}%`;
      if (input.folder) conditions.push(Prisma.sql`m.folder ILIKE ${contains(input.folder)}`);
      const tags = Prisma.sql`jsonb_array_elements_text(CASE WHEN jsonb_typeof(m.tags) = 'array' THEN m.tags ELSE '[]'::jsonb END)`;
      if (input.tag?.trim()) conditions.push(Prisma.sql`EXISTS (SELECT 1 FROM ${tags} AS t(value) WHERE lower(t.value) = lower(${input.tag.trim()}))`);
      if (query) conditions.push(Prisma.sql`(m.name ILIKE ${contains(query)} OR m.folder ILIKE ${contains(query)} OR EXISTS (SELECT 1 FROM ${tags} AS t(value) WHERE t.value ILIKE ${contains(query)}))`);
      const where = conditions.length ? Prisma.join(conditions, " AND ") : Prisma.sql`TRUE`;
      const { rows, total } = await prisma.$transaction(async (transaction) => {
        const ids = await transaction.$queryRaw<{ id: string }[]>(Prisma.sql`SELECT m.id FROM materials m WHERE ${where} ORDER BY m.created_at DESC, m.id ASC LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`);
        const counts = await transaction.$queryRaw<{ count: bigint }[]>(Prisma.sql`SELECT COUNT(*) AS count FROM materials m WHERE ${where}`);
        const rows = await transaction.material.findMany({ where: { id: { in: ids.map((item) => item.id) } }, orderBy: [{ createdAt: "desc" }, { id: "asc" }] });
        return { rows, total: Number(counts[0]?.count ?? 0n) };
      }, { isolationLevel: "RepeatableRead" });
      const items = rows.map((row) => this.mapMaterial(row));
      return {
        items,
        total,
        page,
        pageSize,
        totalPages: Math.max(1, Math.ceil(total / pageSize)),
      };
    }
    const normalized = query?.toLowerCase() ?? "";
    const tag = input.tag?.trim().toLowerCase() ?? "";
    const filtered = this.materials
      .filter((item) =>
        this.canAccessMemoryMaterial(item, role, learnerId),
      )
      .filter((item) => !input.classId || item.classId === input.classId)
      .filter((item) => !input.courseId || item.courseId === input.courseId)
      .filter((item) => !input.visibility || item.visibility === input.visibility)
      .filter((item) => !input.aiOnly || ["application/pdf", "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "image/png", "image/jpeg"].includes(item.mimeType))
      .filter(
        (item) =>
          !input.folder ||
          item.folder.toLowerCase().includes(input.folder.toLowerCase()),
      )
      .filter((item) => !input.mimeType || item.mimeType === input.mimeType)
      .filter(
        (item) =>
          !tag || item.tags.some((value) => value.toLowerCase() === tag),
      )
      .filter(
        (item) =>
          !normalized ||
          `${item.name} ${item.folder} ${item.tags.join(" ")}`
            .toLowerCase()
            .includes(normalized),
      );
    const items = filtered
      .slice((page - 1) * pageSize, page * pageSize)
      .map((item) => ({ ...item, tags: [...item.tags] }));
    return {
      items,
      total: filtered.length,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(filtered.length / pageSize)),
    };
  }

  /** Kiểm tra quyền lớp/chính sách tệp, quét virus, lưu object và tạo version đầu tiên. */
  async createMaterial(
    classId: string,
    input: Pick<
      LearningMaterial,
      "name" | "mimeType" | "sizeBytes" | "folder" | "tags"
    >,
    upload?: UploadedMaterialFile,
    actorId = "usr-instructor",
  ): Promise<LearningMaterial> {
    const prisma = this.database();
    const policy = prisma
      ? await this.getStoragePolicy(prisma)
      : {
          maxFileSizeMb: 50,
          storageQuotaMb: 10_240,
          allowedMimeTypes: [...DEFAULT_MATERIAL_MIME_TYPES],
        };
    if (input.sizeBytes > policy.maxFileSizeMb * 1_000_000)
      throw new BadRequestException(
        `Tệp vượt giới hạn ${policy.maxFileSizeMb} MB.`,
      );
    if (!policy.allowedMimeTypes.includes(input.mimeType))
      throw new BadRequestException(
        "Loại MIME không được chính sách lưu trữ cho phép.",
      );
    const quarantineReason = upload ? await this.scanUpload(upload) : undefined;
    if (prisma) {
      const classItem = await prisma.learningClass.findUnique({
        where: { id: classId },
        include: { instructors: true },
      });
      if (!classItem) throw new NotFoundException("Không tìm thấy lớp học.");
      if (!classItem.instructors.some((item) => item.instructorId === actorId))
        throw new NotFoundException(
          "Giảng viên không được phân công vào lớp học này.",
        );
      if (classItem.status === "CLOSED")
        throw new ConflictException("Lớp đã lưu trữ và chỉ cho phép đọc.");
      const usage = await prisma.material.aggregate({
        _sum: { sizeBytes: true },
      });
      if (
        (usage._sum.sizeBytes ?? 0n) + BigInt(input.sizeBytes) >
        BigInt(policy.storageQuotaMb) * 1_000_000n
      )
        throw new BadRequestException("Kho lưu trữ đã vượt quota hệ thống.");
      const materialId = id("material");
      const stored = upload
        ? await this.storeUpload(
            classId,
            materialId,
            upload,
            Boolean(quarantineReason),
          )
        : {
            objectKey: `metadata/${classId}/${materialId}`,
            checksum: undefined,
          };
      try {
        return prisma.$transaction(async (transaction) => {
          const material = await transaction.material.create({
            data: {
              id: materialId,
              classId,
              courseId: classItem.courseId,
              ownerId: actorId,
              name: input.name.trim(),
              objectKey: stored.objectKey,
              checksum: stored.checksum,
              mimeType: input.mimeType,
              sizeBytes: BigInt(input.sizeBytes),
              folder: input.folder.trim(),
              tags: input.tags,
              visibility: quarantineReason ? "HIDDEN" : "DRAFT",
              quarantinedAt: quarantineReason ? new Date() : null,
              quarantineReason,
            },
          });
          await transaction.materialVersion.create({
            data: {
              id: id("material-version"),
              materialId,
              version: 1,
              name: material.name,
              objectKey: material.objectKey,
              mimeType: material.mimeType,
              sizeBytes: material.sizeBytes,
              checksum: material.checksum,
              folder: material.folder,
              tags: this.toStringArray(material.tags),
              visibility: material.visibility,
              createdBy: actorId,
            },
          });
          if (quarantineReason) {
            await transaction.notification.create({
              data: {
                id: id("notification"),
                recipientId: actorId,
                type: "MATERIAL_QUARANTINED",
                title: `Tệp ${input.name.trim()} đã bị cách ly`,
                entityType: "MATERIAL",
                entityId: materialId,
                dedupKey: `material-quarantine:${materialId}:${actorId}`,
              },
            });
          }
          return this.mapMaterial(material);
        });
      } catch (error) {
        if (upload) await this.removeStoredFile(stored.objectKey);
        throw error;
      }
    }
    const classItem = this.findClass(classId);
    if (!classItem.instructorIds.includes(actorId))
      throw new NotFoundException(
        "Giảng viên không được phân công vào lớp học này.",
      );
    if (classItem.status === "CLOSED")
      throw new ConflictException("Lớp đã lưu trữ và chỉ cho phép đọc.");
    const item: LearningMaterial = {
      ...input,
      id: id("material"),
      classId,
      courseId: classItem.courseId,
      ownerId: actorId,
      version: 1,
      visibility: quarantineReason ? "HIDDEN" : "DRAFT",
      quarantinedAt: quarantineReason ? now() : undefined,
      quarantineReason,
      createdAt: now(),
    };
    if (upload) {
      const stored = await this.storeUpload(
        classId,
        item.id,
        upload,
        Boolean(quarantineReason),
      );
      this.materialFiles.set(item.id, {
        objectKey: stored.objectKey,
        checksum: stored.checksum,
      });
    }
    this.materials.unshift(item);
    const storedFile = this.materialFiles.get(item.id);
    this.materialVersions.unshift({
      ...item,
      id: id("material-version"),
      materialId: item.id,
      createdBy: actorId,
      objectKey: storedFile?.objectKey,
      checksum: storedFile?.checksum,
    });
    if (quarantineReason)
      this.notifications.unshift({
        id: id("notification"),
        recipientId: actorId,
        type: "MATERIAL_QUARANTINED",
        title: `Tệp ${input.name.trim()} đã bị cách ly`,
        entityType: "MATERIAL",
        entityId: item.id,
        createdAt: now(),
      });
    return { ...item, tags: [...item.tags] };
  }

  /** Phát URL truy cập học liệu ký HMAC có thời hạn sau khi kiểm tra quyền. */
  async createMaterialAccess(
    materialId: string,
    role: string,
    action: MaterialAccessAction = "DOWNLOAD",
    actorId = this.userIdForRole(role),
  ): Promise<{ url: string; expiresAt: string }> {
    const prisma = this.database();
    if (prisma) {
      const material = await prisma.material.findUnique({
        where: { id: materialId },
        include: { class: { include: { enrollments: true } } },
      });
      if (!material) throw new NotFoundException("Không tìm thấy học liệu.");
      if (material.quarantinedAt)
        throw new BadRequestException(
          "Tệp đang bị cách ly và không thể truy cập.",
        );
      if (role === "LEARNER" && material.visibility !== "PUBLISHED")
        throw new NotFoundException("Không tìm thấy học liệu đã phát hành.");
      if (
        role === "LEARNER" &&
        !material.class.enrollments.some(
          (item) => item.learnerId === actorId && item.status === "ACTIVE",
        )
      ) {
        throw new NotFoundException(
          "Học viên không thuộc lớp chứa học liệu này.",
        );
      }
      if (role === "INSTRUCTOR") {
        const assigned = await prisma.classInstructor.findUnique({
          where: {
            classId_instructorId: {
              classId: material.classId,
              instructorId: actorId,
            },
          },
        });
        if (!assigned)
          throw new NotFoundException(
            "Giảng viên không được phân công vào lớp chứa học liệu này.",
          );
      }
      if (!this.isMaterialObjectKey(material.objectKey))
        throw new NotFoundException("Học liệu này chưa có tệp bytes để tải.");
    } else {
      const material = this.materials.find((item) => item.id === materialId);
      if (material?.quarantinedAt)
        throw new BadRequestException(
          "Tệp đang bị cách ly và không thể truy cập.",
        );
      if (
        !material ||
        (role === "LEARNER" && material.visibility !== "PUBLISHED")
      )
        throw new NotFoundException("Không tìm thấy học liệu.");
      const classItem = this.findClass(material.classId);
      if (role === "LEARNER" && !classItem.learnerIds.includes(actorId))
        throw new NotFoundException(
          "Học viên không thuộc lớp chứa học liệu này.",
        );
      if (role === "INSTRUCTOR" && !classItem.instructorIds.includes(actorId))
        throw new NotFoundException(
          "Giảng viên không được phân công vào lớp chứa học liệu này.",
        );
      if (!this.materialFiles.has(materialId))
        throw new NotFoundException("Học liệu này chưa có tệp bytes để tải.");
    }
    const expires = Math.floor(Date.now() / 1000) + 300;
    const signature = this.signMaterialAccess(materialId, expires, action);
    return {
      url: `/materials/${materialId}/download?expires=${expires}&action=${action}&signature=${encodeURIComponent(signature)}`,
      expiresAt: new Date(expires * 1000).toISOString(),
    };
  }

  /** Giữ API đọc bộ đệm cho tác vụ nội bộ và kiểm thử với xác minh checksum. */
  async readMaterialDownload(...args: Parameters<LearningService["resolveMaterialDownload"]>): Promise<MaterialDownload> {
    const file = await this.resolveMaterialDownload(...args);
    const buffer = await this.readStoredFile(file.objectKey);
    if (file.checksum && `sha256:${createHash("sha256").update(buffer).digest("hex")}` !== file.checksum) throw new BadRequestException("Checksum học liệu không hợp lệ.");
    return { fileName: file.fileName, mimeType: file.mimeType, buffer };
  }

  /** Chuẩn bị luồng đã kiểm chứng với bộ nhớ giới hạn cho HTTP download. */
  async readMaterialDownloadStream(...args: Parameters<LearningService["resolveMaterialDownload"]>): Promise<{ stream: ReturnType<typeof createReadStream>; size: number; fileName: string; mimeType: string }> {
    const file = await this.resolveMaterialDownload(...args);
    const content = await prepareVerifiedDownload(async () => this.objectStorage ? this.objectStorage.openReadStream(file.objectKey) : createReadStream(this.resolveObjectPath(file.objectKey)), file.checksum);
    return { ...content, fileName: file.fileName, mimeType: file.mimeType };
  }

  /** Xác minh chữ ký/quyền và lấy vị trí object, không nạp toàn bộ nội dung vào RAM. */
  private async resolveMaterialDownload(
    materialId: string,
    expires: number,
    signature: string,
    role: string,
    action: MaterialAccessAction = "DOWNLOAD",
    context: { ipAddress?: string; userAgent?: string } = {},
    actorId = this.userIdForRole(role),
  ): Promise<{ fileName: string; mimeType: string; objectKey: string; checksum?: string }> {
    this.verifyMaterialAccess(materialId, expires, signature, action);
    const prisma = this.database();
    let fileName: string;
    let mimeType: string;
    let objectKey: string | undefined;
    let expectedChecksum: string | undefined;
    if (prisma) {
      const material = await prisma.material.findUnique({
        where: { id: materialId },
        include: {
          class: { include: { enrollments: true, instructors: true } },
        },
      });
      if (
        !material ||
        (role === "LEARNER" && material.visibility !== "PUBLISHED")
      )
        throw new NotFoundException("Không tìm thấy học liệu.");
      if (material.quarantinedAt)
        throw new BadRequestException(
          "Tệp đang bị cách ly và không thể truy cập.",
        );
      if (
        role === "LEARNER" &&
        !material.class.enrollments.some(
          (item) => item.learnerId === actorId && item.status === "ACTIVE",
        )
      ) {
        throw new NotFoundException(
          "Học viên không thuộc lớp chứa học liệu này.",
        );
      }
      if (
        role === "INSTRUCTOR" &&
        !material.class.instructors.some(
          (item) => item.instructorId === actorId,
        )
      ) {
        throw new NotFoundException(
          "Giảng viên không được phân công vào lớp chứa học liệu này.",
        );
      }
      fileName = material.name;
      mimeType = material.mimeType;
      objectKey = material.objectKey;
      expectedChecksum = material.checksum ?? undefined;
    } else {
      const material = this.materials.find((item) => item.id === materialId);
      const stored = this.materialFiles.get(materialId);
      if (
        !material ||
        !stored ||
        (role === "LEARNER" && material.visibility !== "PUBLISHED")
      )
        throw new NotFoundException("Không tìm thấy học liệu.");
      if (material.quarantinedAt)
        throw new BadRequestException(
          "Tệp đang bị cách ly và không thể truy cập.",
        );
      const classItem = this.findClass(material.classId);
      if (role === "LEARNER" && !classItem.learnerIds.includes(actorId))
        throw new NotFoundException(
          "Học viên không thuộc lớp chứa học liệu này.",
        );
      if (role === "INSTRUCTOR" && !classItem.instructorIds.includes(actorId))
        throw new NotFoundException(
          "Giảng viên không được phân công vào lớp chứa học liệu này.",
        );
      fileName = material.name;
      mimeType = material.mimeType;
      objectKey = stored.objectKey;
      expectedChecksum = stored.checksum;
    }
    if (!objectKey || !this.isMaterialObjectKey(objectKey))
      throw new NotFoundException(
        "Tệp học liệu không tồn tại trong kho bytes.",
      );
    const userId = actorId;
    if (prisma) {
      await prisma.materialAccessLog.create({
        data: {
          id: id("material-access"),
          materialId,
          userId,
          action,
          ipAddress: context.ipAddress?.slice(0, 45),
          userAgent: context.userAgent?.slice(0, 500),
        },
      });
    } else {
      this.materialAccessLogs.unshift({
        materialId,
        userId,
        action,
        createdAt: now(),
      });
    }
    return { fileName, mimeType, objectKey, checksum: expectedChecksum };
  }

  /** Cập nhật metadata/visibility của học liệu và ghi audit thay đổi. */
  async updateMaterial(
    materialId: string,
    input: Partial<Pick<LearningMaterial, "folder" | "tags" | "visibility">>,
    actorId = "usr-instructor",
  ): Promise<LearningMaterial> {
    const prisma = this.database();
    if (prisma) {
      const current = await prisma.material.findUnique({
        where: { id: materialId },
        include: { class: { include: { instructors: true } } },
      });
      if (
        !current ||
        !current.class.instructors.some((item) => item.instructorId === actorId)
      )
        throw new NotFoundException(
          "Không tìm thấy học liệu được phép cập nhật.",
        );
      if (current.class.status === "CLOSED")
        throw new ConflictException("Lớp đã lưu trữ và chỉ cho phép đọc.");
      if (current.quarantinedAt && input.visibility === "PUBLISHED")
        throw new BadRequestException(
          "Không thể phát hành tệp đang bị cách ly.",
        );
      return prisma.$transaction(async (transaction) => {
        const updated = await transaction.material.update({
          where: { id: materialId },
          data: {
            folder: input.folder?.trim(),
            tags: input.tags,
            visibility: input.visibility,
            version: { increment: 1 },
          },
        });
        await transaction.materialVersion.create({
          data: {
            id: id("material-version"),
            materialId,
            version: updated.version,
            name: updated.name,
            objectKey: updated.objectKey,
            mimeType: updated.mimeType,
            sizeBytes: updated.sizeBytes,
            checksum: updated.checksum,
            folder: updated.folder,
            tags: this.toStringArray(updated.tags),
            visibility: updated.visibility,
            createdBy: actorId,
          },
        });
        return this.mapMaterial(updated);
      });
    }
    const item = this.materials.find((material) => material.id === materialId);
    if (!item || !this.findClass(item.classId).instructorIds.includes(actorId))
      throw new NotFoundException(
        "Không tìm thấy học liệu được phép cập nhật.",
      );
    if (this.findClass(item.classId).status === "CLOSED")
      throw new ConflictException("Lớp đã lưu trữ và chỉ cho phép đọc.");
    if (item.quarantinedAt && input.visibility === "PUBLISHED")
      throw new BadRequestException("Không thể phát hành tệp đang bị cách ly.");
    Object.assign(item, input);
    item.version += 1;
    const stored = this.materialFiles.get(materialId);
    this.materialVersions.unshift({
      ...item,
      id: id("material-version"),
      materialId,
      createdBy: actorId,
      objectKey: stored?.objectKey,
      checksum: stored?.checksum,
      tags: [...item.tags],
    });
    return { ...item, tags: [...item.tags] };
  }

  /** Xác minh giảng viên phụ trách rồi trả học viên đang ghi danh trong lớp. */
  async listInstructorClassLearners(
    classId: string,
    instructorId: string,
  ): Promise<DirectoryUser[]> {
    const prisma = this.database();
    if (prisma) {
      const classItem = await prisma.learningClass.findFirst({
        where: { id: classId, instructors: { some: { instructorId } } },
        include: {
          enrollments: {
            where: { status: "ACTIVE" },
            include: {
              learner: { select: { id: true, displayName: true, email: true } },
            },
            orderBy: { learner: { displayName: "asc" } },
          },
        },
      });
      if (!classItem)
        throw new NotFoundException("Không tìm thấy lớp được phân công.");
      return classItem.enrollments.map(({ learner }) => ({
        id: learner.id,
        displayName: learner.displayName,
        email: learner.email,
        roleCode: "LEARNER",
      }));
    }
    const classItem = this.findClass(classId);
    if (!classItem.instructorIds.includes(instructorId))
      throw new NotFoundException("Không tìm thấy lớp được phân công.");
    return classItem.learnerIds.map((learnerId) => ({
      id: learnerId,
      displayName: learnerId,
      email: "",
      roleCode: "LEARNER",
    }));
  }

  /** Tìm người dùng theo vai trò và tùy chọn loại các thành viên đã thuộc lớp. */
  async searchDirectory(
    roleCode: "INSTRUCTOR" | "LEARNER",
    query = "",
    classId?: string,
  ): Promise<DirectoryUser[]> {
    const prisma = this.database();
    if (!prisma) return [];
    const text = query.trim();
    const assignedIds = classId
      ? roleCode === "INSTRUCTOR"
        ? (
            await prisma.classInstructor.findMany({
              where: { classId },
              select: { instructorId: true },
            })
          ).map((row) => row.instructorId)
        : (
            await prisma.classEnrollment.findMany({
              where: { classId, status: "ACTIVE" },
              select: { learnerId: true },
            })
          ).map((row) => row.learnerId)
      : [];
    const users = await prisma.user.findMany({
      where: {
        status: "ACTIVE",
        id: assignedIds.length ? { notIn: assignedIds } : undefined,
        roles: { some: { role: { code: roleCode } } },
        ...(text
          ? {
              OR: [
                { displayName: { contains: text, mode: "insensitive" } },
                { email: { contains: text, mode: "insensitive" } },
              ],
            }
          : {}),
      },
      select: { id: true, displayName: true, email: true },
      orderBy: { displayName: "asc" },
      take: 20,
    });
    return users.map((user) => ({ ...user, roleCode }));
  }

  /** Liệt kê lịch sử phiên bản sau khi kiểm tra quyền truy cập học liệu cha. */
  async listMaterialVersions(
    materialId: string,
    role: string,
    actorId = this.userIdForRole(role),
  ): Promise<MaterialVersionSnapshot[]> {
    const prisma = this.database();
    if (prisma) {
      const material = await prisma.material.findUnique({
        where: { id: materialId },
        include: {
          class: { include: { enrollments: true, instructors: true } },
        },
      });
      if (!material) throw new NotFoundException("Không tìm thấy học liệu.");
      this.assertMaterialClassAccess(material.class, role, actorId);
      const rows = await prisma.materialVersion.findMany({
        where: {
          materialId,
          ...(role === "LEARNER" ? { visibility: "PUBLISHED" } : {}),
        },
        orderBy: { version: "desc" },
      });
      return rows.map((row) => this.mapMaterialVersion(row));
    }
    const material = this.materials.find((item) => item.id === materialId);
    if (!material) throw new NotFoundException("Không tìm thấy học liệu.");
    this.assertMemoryMaterialClassAccess(material.classId, role, actorId);
    return this.materialVersions
      .filter(
        (item) =>
          item.materialId === materialId &&
          (role !== "LEARNER" || item.visibility === "PUBLISHED"),
      )
      .sort((a, b) => b.version - a.version)
      .map((item) => ({
        id: item.id,
        materialId: item.materialId,
        version: item.version,
        name: normalizeMultipartFileName(item.name),
        mimeType: item.mimeType,
        sizeBytes: item.sizeBytes,
        folder: item.folder,
        tags: [...item.tags],
        visibility: item.visibility,
        createdBy: item.createdBy,
        createdAt: item.createdAt,
      }));
  }

  /** Phát URL ký cho một version cụ thể và ràng buộc chữ ký với hành động xem/tải. */
  async createMaterialVersionAccess(
    materialId: string,
    version: number,
    role: string,
    action: MaterialAccessAction = "DOWNLOAD",
    actorId = this.userIdForRole(role),
  ): Promise<{ url: string; expiresAt: string }> {
    const prisma = this.database();
    if (prisma) {
      const row = await prisma.materialVersion.findUnique({
        where: { materialId_version: { materialId, version } },
        include: {
          material: {
            include: {
              class: { include: { enrollments: true, instructors: true } },
            },
          },
        },
      });
      if (
        !row ||
        row.material.quarantinedAt ||
        (role === "LEARNER" &&
          (row.visibility !== "PUBLISHED" ||
            row.material.visibility === "HIDDEN"))
      )
        throw new NotFoundException("Không tìm thấy phiên bản học liệu.");
      this.assertMaterialClassAccess(row.material.class, role, actorId);
      if (!this.isMaterialObjectKey(row.objectKey))
        throw new NotFoundException("Phiên bản này chưa có tệp bytes để tải.");
    } else {
      const material = this.materials.find((item) => item.id === materialId);
      const row = this.materialVersions.find(
        (item) => item.materialId === materialId && item.version === version,
      );
      if (
        !material ||
        !row ||
        material.quarantinedAt ||
        (role === "LEARNER" &&
          (row.visibility !== "PUBLISHED" || material.visibility === "HIDDEN"))
      )
        throw new NotFoundException("Không tìm thấy phiên bản học liệu.");
      this.assertMemoryMaterialClassAccess(material.classId, role, actorId);
      if (!row.objectKey || !this.isMaterialObjectKey(row.objectKey))
        throw new NotFoundException("Phiên bản này chưa có tệp bytes để tải.");
    }
    const expires = Math.floor(Date.now() / 1000) + 300;
    const signature = this.signMaterialAccess(
      `${materialId}:${version}`,
      expires,
      action,
    );
    return {
      url: `/materials/${materialId}/versions/${version}/download?expires=${expires}&action=${action}&signature=${encodeURIComponent(signature)}`,
      expiresAt: new Date(expires * 1000).toISOString(),
    };
  }

  /** Giữ API đọc bộ đệm cho tác vụ nội bộ và kiểm thử với xác minh checksum. */
  async readMaterialVersionDownload(...args: Parameters<LearningService["resolveMaterialVersionDownload"]>): Promise<MaterialDownload> {
    const file = await this.resolveMaterialVersionDownload(...args);
    const buffer = await this.readStoredFile(file.objectKey);
    if (file.checksum && `sha256:${createHash("sha256").update(buffer).digest("hex")}` !== file.checksum) throw new BadRequestException("Checksum học liệu không hợp lệ.");
    return { fileName: file.fileName, mimeType: file.mimeType, buffer };
  }

  /** Chuẩn bị luồng đã kiểm chứng với bộ nhớ giới hạn cho HTTP download. */
  async readMaterialVersionDownloadStream(...args: Parameters<LearningService["resolveMaterialVersionDownload"]>): Promise<{ stream: ReturnType<typeof createReadStream>; size: number; fileName: string; mimeType: string }> {
    const file = await this.resolveMaterialVersionDownload(...args);
    const content = await prepareVerifiedDownload(async () => this.objectStorage ? this.objectStorage.openReadStream(file.objectKey) : createReadStream(this.resolveObjectPath(file.objectKey)), file.checksum);
    return { ...content, fileName: file.fileName, mimeType: file.mimeType };
  }

  /** Xác minh quyền/chữ ký phiên bản và lấy metadata của object được phép truy cập. */
  private async resolveMaterialVersionDownload(
    materialId: string,
    version: number,
    expires: number,
    signature: string,
    role: string,
    action: MaterialAccessAction = "DOWNLOAD",
    actorId = this.userIdForRole(role),
  ): Promise<{ fileName: string; mimeType: string; objectKey: string; checksum?: string }> {
    this.verifyMaterialAccess(
      `${materialId}:${version}`,
      expires,
      signature,
      action,
    );
    const prisma = this.database();
    let fileName: string;
    let mimeType: string;
    let objectKey: string | undefined;
    let checksum: string | undefined;
    if (prisma) {
      const row = await prisma.materialVersion.findUnique({
        where: { materialId_version: { materialId, version } },
        include: {
          material: {
            include: {
              class: { include: { enrollments: true, instructors: true } },
            },
          },
        },
      });
      if (
        !row ||
        row.material.quarantinedAt ||
        (role === "LEARNER" &&
          (row.visibility !== "PUBLISHED" ||
            row.material.visibility === "HIDDEN"))
      )
        throw new NotFoundException("Không tìm thấy phiên bản học liệu.");
      this.assertMaterialClassAccess(row.material.class, role, actorId);
      ({ name: fileName, mimeType, objectKey } = row);
      checksum = row.checksum ?? undefined;
    } else {
      const material = this.materials.find((item) => item.id === materialId);
      const row = this.materialVersions.find(
        (item) => item.materialId === materialId && item.version === version,
      );
      if (
        !material ||
        !row ||
        material.quarantinedAt ||
        (role === "LEARNER" &&
          (row.visibility !== "PUBLISHED" || material.visibility === "HIDDEN"))
      )
        throw new NotFoundException("Không tìm thấy phiên bản học liệu.");
      this.assertMemoryMaterialClassAccess(material.classId, role, actorId);
      fileName = row.name;
      mimeType = row.mimeType;
      objectKey = row.objectKey;
      checksum = row.checksum;
    }
    if (!objectKey || !this.isMaterialObjectKey(objectKey))
      throw new NotFoundException(
        "Tệp phiên bản không tồn tại trong kho bytes.",
      );
    if (prisma)
      await prisma.materialAccessLog.create({
        data: {
          id: id("material-access"),
          materialId,
          userId: actorId,
          action: `${action}_V${version}`,
        },
      });
    else
      this.materialAccessLogs.unshift({
        materialId,
        userId: actorId,
        action,
        createdAt: now(),
      });
    return { fileName, mimeType, objectKey, checksum: checksum };
  }

  /** Quét và lưu tệp mới, tăng version nguyên tử, giữ snapshot cũ và dọn object khi lỗi. */
  async replaceMaterialVersion(
    materialId: string,
    input: Pick<LearningMaterial, "folder" | "tags">,
    upload: UploadedMaterialFile,
    actorId = "usr-instructor",
  ): Promise<LearningMaterial> {
    const prisma = this.database();
    const policy = prisma
      ? await this.getStoragePolicy(prisma)
      : {
          maxFileSizeMb: 50,
          storageQuotaMb: 10_240,
          allowedMimeTypes: [...DEFAULT_MATERIAL_MIME_TYPES],
        };
    if (upload.size > policy.maxFileSizeMb * 1_000_000)
      throw new BadRequestException(
        `Tệp vượt giới hạn ${policy.maxFileSizeMb} MB.`,
      );
    if (!policy.allowedMimeTypes.includes(upload.mimeType))
      throw new BadRequestException(
        "Loại MIME không được chính sách lưu trữ cho phép.",
      );
    const quarantineReason = await this.scanUpload(upload);
    if (prisma) {
      const storedVersions = await prisma.materialVersion.findMany({
        distinct: ["objectKey"],
        select: { sizeBytes: true },
      });
      if (
        storedVersions.reduce((sum, item) => sum + item.sizeBytes, 0n) +
          BigInt(upload.size) >
        BigInt(policy.storageQuotaMb) * 1_000_000n
      )
        throw new BadRequestException("Kho lưu trữ đã vượt quota hệ thống.");
      const current = await prisma.material.findUnique({
        where: { id: materialId },
        include: { class: { include: { instructors: true } } },
      });
      if (
        !current ||
        !current.class.instructors.some((item) => item.instructorId === actorId)
      )
        throw new NotFoundException(
          "Không tìm thấy học liệu được phép cập nhật.",
        );
      if (current.class.status === "CLOSED")
        throw new ConflictException("Lớp đã lưu trữ và chỉ cho phép đọc.");
      const nextVersion = current.version + 1;
      const stored = await this.storeUpload(
        current.classId,
        `${materialId}-v${nextVersion}-${randomUUID()}`,
        upload,
        Boolean(quarantineReason),
      );
      try {
        return await prisma.$transaction(async (transaction) => {
          const updated = await transaction.material.update({
            where: { id: materialId },
            data: {
              name: upload.originalName.trim(),
              objectKey: stored.objectKey,
              checksum: stored.checksum,
              mimeType: upload.mimeType,
              sizeBytes: BigInt(upload.size),
              folder: input.folder.trim(),
              tags: input.tags,
              version: nextVersion,
              visibility: quarantineReason ? "HIDDEN" : "DRAFT",
              quarantinedAt: quarantineReason ? new Date() : null,
              quarantineReason,
            },
          });
          await transaction.materialVersion.create({
            data: {
              id: id("material-version"),
              materialId,
              version: nextVersion,
              name: updated.name,
              objectKey: updated.objectKey,
              mimeType: updated.mimeType,
              sizeBytes: updated.sizeBytes,
              checksum: updated.checksum,
              folder: updated.folder,
              tags: this.toStringArray(updated.tags),
              visibility: updated.visibility,
              createdBy: actorId,
            },
          });
          return this.mapMaterial(updated);
        });
      } catch (error) {
        await this.removeStoredFile(stored.objectKey);
        throw error;
      }
    }
    const current = this.materials.find((item) => item.id === materialId);
    if (
      !current ||
      !this.findClass(current.classId).instructorIds.includes(actorId)
    )
      throw new NotFoundException(
        "Không tìm thấy học liệu được phép cập nhật.",
      );
    if (this.findClass(current.classId).status === "CLOSED")
      throw new ConflictException("Lớp đã lưu trữ và chỉ cho phép đọc.");
    const distinctStoredBytes = [
      ...new Map(
        this.materialVersions
          .filter((item) => item.objectKey)
          .map((item) => [item.objectKey, item.sizeBytes]),
      ).values(),
    ].reduce((sum, size) => sum + size, 0);
    if (distinctStoredBytes + upload.size > policy.storageQuotaMb * 1_000_000)
      throw new BadRequestException("Kho lưu trữ đã vượt quota hệ thống.");
    const nextVersion = current.version + 1;
    const stored = await this.storeUpload(
      current.classId,
      `${materialId}-v${nextVersion}-${randomUUID()}`,
      upload,
      Boolean(quarantineReason),
    );
    Object.assign(current, {
      name: upload.originalName.trim(),
      mimeType: upload.mimeType,
      sizeBytes: upload.size,
      folder: input.folder.trim(),
      tags: [...input.tags],
      version: nextVersion,
      visibility: quarantineReason ? "HIDDEN" : "DRAFT",
      quarantinedAt: quarantineReason ? now() : undefined,
      quarantineReason,
    });
    this.materialFiles.set(materialId, stored);
    this.materialVersions.unshift({
      ...current,
      id: id("material-version"),
      materialId,
      createdBy: actorId,
      objectKey: stored.objectKey,
      checksum: stored.checksum,
      tags: [...current.tags],
    });
    return { ...current, tags: [...current.tags] };
  }

  /** Áp dụng quyết định kiểm duyệt học liệu, cập nhật cách ly/visibility và ghi lịch sử. */
  async reviewClassMaterial(
    materialId: string,
    action: FileReviewRecord["action"],
    rawReason?: string,
    reviewerId = "usr-manager",
  ): Promise<LearningMaterial> {
    const reason = rawReason?.trim();
    if (
      (action === "HIDE" || action === "REQUEST_CHANGES") &&
      (!reason || reason.length < 5)
    ) {
      throw new BadRequestException(
        "Cần lý do ít nhất 5 ký tự khi ẩn hoặc yêu cầu sửa học liệu.",
      );
    }
    const visibility: LearningMaterial["visibility"] =
      action === "APPROVE"
        ? "PUBLISHED"
        : action === "HIDE"
          ? "HIDDEN"
          : "DRAFT";
    const prisma = this.database();
    if (prisma) {
      return prisma.$transaction(async (transaction) => {
        const current = await transaction.material.findUnique({
          where: { id: materialId },
          include: { class: true },
        });
        if (!current) throw new NotFoundException("Không tìm thấy học liệu.");
        if (current.class.status === "CLOSED")
          throw new ConflictException("Lớp đã lưu trữ và chỉ cho phép đọc.");
        if (current.quarantinedAt && action === "APPROVE")
          throw new BadRequestException("Không thể duyệt tệp đang bị cách ly.");
        const material = await transaction.material.update({
          where: { id: materialId },
          data: { visibility, version: { increment: 1 } },
        });
        await transaction.materialVersion.create({
          data: {
            id: id("material-version"),
            materialId,
            version: material.version,
            name: material.name,
            objectKey: material.objectKey,
            mimeType: material.mimeType,
            sizeBytes: material.sizeBytes,
            checksum: material.checksum,
            folder: material.folder,
            tags: this.toStringArray(material.tags),
            visibility: material.visibility,
            createdBy: reviewerId,
          },
        });
        const reviewId = id("file-review");
        await transaction.fileReview.create({
          data: { id: reviewId, materialId, reviewerId, action, reason },
        });
        await transaction.auditLog.create({
          data: {
            actorId: reviewerId,
            action: `MATERIAL_${action}`,
            entityType: "material",
            entityId: materialId,
            context: {
              reason: reason ?? "Duyệt phát hành",
              before: current.visibility,
              after: visibility,
            },
          },
        });
        await transaction.notification.create({
          data: {
            id: id("notification"),
            recipientId: current.ownerId,
            type: "MATERIAL_REVIEWED",
            title: `Học liệu ${current.name}: ${action}`,
            entityType: "MATERIAL",
            entityId: materialId,
            dedupKey: `material-review:${reviewId}:${current.ownerId}`,
          },
        });
        return this.mapMaterial(material);
      });
    }
    const item = this.materials.find((material) => material.id === materialId);
    if (!item) throw new NotFoundException("Không tìm thấy học liệu.");
    if (this.findClass(item.classId).status === "CLOSED")
      throw new ConflictException("Lớp đã lưu trữ và chỉ cho phép đọc.");
    if (item.quarantinedAt && action === "APPROVE")
      throw new BadRequestException("Không thể duyệt tệp đang bị cách ly.");
    const review: FileReviewRecord = {
      id: id("file-review"),
      materialId,
      reviewerId,
      action,
      reason,
      createdAt: now(),
    };
    this.materialReviews.unshift(review);
    item.visibility = visibility;
    item.version += 1;
    const stored = this.materialFiles.get(materialId);
    this.materialVersions.unshift({
      ...item,
      id: id("material-version"),
      materialId,
      createdBy: reviewerId,
      objectKey: stored?.objectKey,
      checksum: stored?.checksum,
      tags: [...item.tags],
    });
    this.notifications.unshift({
      id: id("notification"),
      recipientId: item.ownerId,
      type: "MATERIAL_REVIEWED",
      title: `Học liệu ${item.name}: ${action}`,
      entityType: "MATERIAL",
      entityId: materialId,
      createdAt: now(),
    });
    return { ...item, tags: [...item.tags] };
  }

  /** Liệt kê các quyết định kiểm duyệt học liệu mới nhất trước. */
  async listMaterialReviews(materialId: string): Promise<FileReviewRecord[]> {
    const prisma = this.database();
    if (prisma) {
      const exists = await prisma.material.findUnique({
        where: { id: materialId },
        select: { id: true },
      });
      if (!exists) throw new NotFoundException("Không tìm thấy học liệu.");
      const rows = await prisma.fileReview.findMany({
        where: { materialId },
        orderBy: { createdAt: "desc" },
      });
      return rows.map((row) => ({
        id: row.id,
        materialId: row.materialId,
        reviewerId: row.reviewerId,
        action: this.fileReviewAction(row.action),
        reason: row.reason ?? undefined,
        createdAt: row.createdAt.toISOString(),
      }));
    }
    return this.materialReviews
      .filter((review) => review.materialId === materialId)
      .map((review) => ({ ...review }));
  }

  /** Lọc phiên bản câu hỏi mới nhất theo từ khóa, khóa học, loại, độ khó, tag và trạng thái. */
  async listQuestions(
    filters:
      | string
      | {
          query?: string;
          courseId?: string;
          type?: string;
          difficulty?: number;
          tag?: string;
          status?: LearningQuestion["status"];
        } = {},
  ): Promise<LearningQuestion[]> {
    const input = typeof filters === "string" ? { query: filters } : filters;
    const normalized = input.query?.trim().toLowerCase() ?? "";
    const matches = (item: LearningQuestion): boolean =>
      (!normalized ||
        `${item.content} ${item.tags.join(" ")}`
          .toLowerCase()
          .includes(normalized)) &&
      (!input.courseId || item.courseId === input.courseId) &&
      (!input.type || item.type === input.type) &&
      (!input.difficulty || item.difficulty === input.difficulty) &&
      (!input.tag ||
        item.tags.some(
          (tag) => tag.toLowerCase() === input.tag!.trim().toLowerCase(),
        )) &&
      (!input.status || item.status === input.status);
    const prisma = this.database();
    if (prisma) {
      const rows = await prisma.question.findMany({
        where: input.status ? { status: input.status } : undefined,
        orderBy: { createdAt: "desc" },
      });
      return this.latestQuestionVersions(
        rows.map((row) => this.mapQuestion(row)),
      ).filter(matches);
    }
    const candidates = input.status
      ? this.questions.filter((item) => item.status === input.status)
      : this.questions;
    return this.latestQuestionVersions(candidates)
      .filter(matches)
      .map((item) => this.cloneQuestion(item));
  }

  /** Validate nội dung/đáp án, tạo family câu hỏi và chọn trạng thái theo chế độ duyệt cấu hình. */
  async createQuestion(
    input: Omit<LearningQuestion, "id" | "status" | "version">,
    authorId = "usr-instructor",
  ): Promise<LearningQuestion> {
    const normalized = this.validateQuestionInput(input);
    const contentHash = this.questionContentHash(normalized.content);
    const prisma = this.database();
    if (prisma) {
      const course = await prisma.course.findUnique({
        where: { id: normalized.courseId },
      });
      if (!course) throw new NotFoundException("Không tìm thấy khóa học.");
      const duplicate = await prisma.question.findFirst({
        where: { courseId: normalized.courseId, contentHash },
      });
      if (duplicate)
        throw new ConflictException(
          "Nội dung câu hỏi đã tồn tại trong khóa học.",
        );
      const questionId = id("question");
      return this.mapQuestion(
        await prisma.question.create({
          data: {
            id: questionId,
            familyId: questionId,
            contentHash,
            courseId: normalized.courseId,
            authorId,
            type: normalized.type,
            content: normalized.content,
            options: normalized.options,
            correctAnswers: normalized.correctAnswers,
            difficulty: normalized.difficulty,
            tags: normalized.tags,
          },
        }),
      );
    }
    if (
      this.questions.some(
        (item) =>
          item.courseId === normalized.courseId &&
          this.questionContentHash(item.content) === contentHash,
      )
    )
      throw new ConflictException(
        "Nội dung câu hỏi đã tồn tại trong khóa học.",
      );
    const questionId = id("question");
    const item: LearningQuestion = {
      ...normalized,
      id: questionId,
      familyId: questionId,
      status: "DRAFT",
      version: 1,
    };
    this.questions.unshift(item);
    return this.cloneQuestion(item);
  }

  /** Tạo version kế tiếp của câu hỏi thay vì sửa bản đã dùng, đồng thời chống nội dung trùng. */
  async updateQuestion(
    questionId: string,
    input: Omit<LearningQuestion, "id" | "status" | "version">,
    authorId = "usr-instructor",
  ): Promise<LearningQuestion> {
    const normalized = this.validateQuestionInput(input);
    const contentHash = this.questionContentHash(normalized.content);
    const prisma = this.database();
    if (prisma) {
      const current = await prisma.question.findUnique({
        where: { id: questionId },
      });
      if (!current) throw new NotFoundException("Không tìm thấy câu hỏi.");
      const familyId = current.familyId || current.id;
      const duplicate = await prisma.question.findFirst({
        where: {
          courseId: normalized.courseId,
          contentHash,
          familyId: { not: familyId },
        },
      });
      if (duplicate)
        throw new ConflictException(
          "Nội dung câu hỏi đã tồn tại trong khóa học.",
        );
      const latest = await prisma.question.findFirst({
        where: { familyId },
        orderBy: { version: "desc" },
      });
      if (latest?.id !== current.id)
        throw new ConflictException(
          "Chỉ có thể sửa phiên bản mới nhất của câu hỏi.",
        );
      return this.mapQuestion(
        await prisma.question.create({
          data: {
            id: id("question"),
            familyId,
            supersedesId: current.id,
            contentHash,
            courseId: normalized.courseId,
            authorId,
            type: normalized.type,
            content: normalized.content,
            options: normalized.options,
            correctAnswers: normalized.correctAnswers,
            difficulty: normalized.difficulty,
            tags: normalized.tags,
            imageObjectKey: current.imageObjectKey,
            imageName: current.imageName,
            imageMimeType: current.imageMimeType,
            imageSizeBytes: current.imageSizeBytes,
            imageChecksum: current.imageChecksum,
            status: "DRAFT",
            version: current.version + 1,
          },
        }),
      );
    }
    const current = this.questions.find((item) => item.id === questionId);
    if (!current) throw new NotFoundException("Không tìm thấy câu hỏi.");
    const familyId = current.familyId ?? current.id;
    const latest = this.questions
      .filter((item) => (item.familyId ?? item.id) === familyId)
      .sort((a, b) => b.version - a.version)[0];
    if (latest?.id !== current.id)
      throw new ConflictException(
        "Chỉ có thể sửa phiên bản mới nhất của câu hỏi.",
      );
    if (
      this.questions.some(
        (item) =>
          item.courseId === normalized.courseId &&
          (item.familyId ?? item.id) !== familyId &&
          this.questionContentHash(item.content) === contentHash,
      )
    )
      throw new ConflictException(
        "Nội dung câu hỏi đã tồn tại trong khóa học.",
      );
    const next: LearningQuestion = {
      ...normalized,
      id: id("question"),
      familyId,
      supersedesId: current.id,
      status: "DRAFT",
      version: current.version + 1,
      imageUrl: current.imageUrl,
      imageName: current.imageName,
      imageMimeType: current.imageMimeType,
      imageSizeBytes: current.imageSizeBytes,
    };
    this.questions.unshift(next);
    const currentImage = this.questionImages.get(current.id);
    if (currentImage) {
      this.questionImages.set(next.id, currentImage);
      next.imageUrl = `/question-bank/questions/${next.id}/image?v=${encodeURIComponent(currentImage.checksum)}`;
    }
    return this.cloneQuestion(next);
  }

  /** Kiểm tra ảnh thật, lưu object mới và dọn ảnh cũ khi không còn version nào tham chiếu. */
  async uploadQuestionImage(
    questionId: string,
    upload: UploadedMaterialFile,
  ): Promise<LearningQuestion> {
    await this.validateQuestionImage(upload);
    const fileName = normalizeMultipartFileName(upload.originalName);
    const extension =
      upload.mimeType === "image/png"
        ? ".png"
        : upload.mimeType === "image/webp"
          ? ".webp"
          : ".jpg";
    const checksum = `sha256:${createHash("sha256").update(upload.buffer).digest("hex")}`;
    const prisma = this.database();
    if (prisma) {
      const current = await prisma.question.findUnique({
        where: { id: questionId },
      });
      if (!current) throw new NotFoundException("Không tìm thấy câu hỏi.");
      const latest = await prisma.question.findFirst({
        where: { familyId: current.familyId },
        orderBy: { version: "desc" },
      });
      if (latest?.id !== current.id)
        throw new ConflictException(
          "Chỉ có thể đổi ảnh trên phiên bản mới nhất của câu hỏi.",
        );
      const targetId = current.status === "DRAFT" ? current.id : id("question");
      const objectKey = `question-images/${targetId}/${randomUUID()}${extension}`;
      const stored = await this.writeStoredFile(objectKey, upload.buffer);
      try {
        const updated =
          current.status === "DRAFT"
            ? await prisma.question.update({
                where: { id: questionId },
                data: {
                  imageObjectKey: stored.objectKey,
                  imageName: fileName,
                  imageMimeType: upload.mimeType,
                  imageSizeBytes: BigInt(upload.size),
                  imageChecksum: stored.checksum,
                },
              })
            : await prisma.question.create({
                data: {
                  id: targetId,
                  courseId: current.courseId,
                  authorId: current.authorId,
                  type: current.type,
                  content: current.content,
                  options: current.options as Prisma.InputJsonValue,
                  correctAnswers:
                    current.correctAnswers as Prisma.InputJsonValue,
                  difficulty: current.difficulty,
                  tags: current.tags as Prisma.InputJsonValue,
                  status: "DRAFT",
                  version: current.version + 1,
                  familyId: current.familyId,
                  supersedesId: current.id,
                  contentHash: current.contentHash,
                  imageObjectKey: stored.objectKey,
                  imageName: fileName,
                  imageMimeType: upload.mimeType,
                  imageSizeBytes: BigInt(upload.size),
                  imageChecksum: stored.checksum,
                },
              });
        if (
          current.status === "DRAFT" &&
          current.imageObjectKey &&
          current.imageObjectKey !== stored.objectKey
        )
          await this.removeQuestionObjectIfUnreferenced(current.imageObjectKey);
        return this.mapQuestion(updated);
      } catch (error) {
        await this.removeStoredFile(stored.objectKey);
        throw error;
      }
    }
    const current = this.questions.find((item) => item.id === questionId);
    if (!current) throw new NotFoundException("Không tìm thấy câu hỏi.");
    const familyId = current.familyId ?? current.id;
    const latest = this.questions
      .filter((item) => (item.familyId ?? item.id) === familyId)
      .sort((left, right) => right.version - left.version)[0];
    if (latest?.id !== current.id)
      throw new ConflictException(
        "Chỉ có thể đổi ảnh trên phiên bản mới nhất của câu hỏi.",
      );
    const target =
      current.status === "DRAFT"
        ? current
        : {
            ...this.cloneQuestion(current),
            id: id("question"),
            familyId,
            supersedesId: current.id,
            status: "DRAFT" as const,
            version: current.version + 1,
          };
    if (target !== current) this.questions.unshift(target);
    const objectKey = `question-images/${target.id}/${randomUUID()}${extension}`;
    this.questionImages.set(target.id, {
      objectKey,
      fileName,
      mimeType: upload.mimeType,
      sizeBytes: upload.size,
      checksum,
      buffer: Buffer.from(upload.buffer),
    });
    target.imageUrl = `/question-bank/questions/${target.id}/image?v=${encodeURIComponent(checksum)}`;
    target.imageName = fileName;
    target.imageMimeType = upload.mimeType;
    target.imageSizeBytes = upload.size;
    return this.cloneQuestion(target);
  }

  /** Xóa liên kết ảnh của câu hỏi rồi dọn object nếu không còn tham chiếu. */
  async removeQuestionImage(questionId: string): Promise<LearningQuestion> {
    const prisma = this.database();
    if (prisma) {
      const current = await prisma.question.findUnique({
        where: { id: questionId },
      });
      if (!current) throw new NotFoundException("Không tìm thấy câu hỏi.");
      const latest = await prisma.question.findFirst({
        where: { familyId: current.familyId },
        orderBy: { version: "desc" },
      });
      if (latest?.id !== current.id)
        throw new ConflictException(
          "Chỉ có thể gỡ ảnh trên phiên bản mới nhất của câu hỏi.",
        );
      const updated =
        current.status === "DRAFT"
          ? await prisma.question.update({
              where: { id: questionId },
              data: {
                imageObjectKey: null,
                imageName: null,
                imageMimeType: null,
                imageSizeBytes: null,
                imageChecksum: null,
              },
            })
          : await prisma.question.create({
              data: {
                id: id("question"),
                courseId: current.courseId,
                authorId: current.authorId,
                type: current.type,
                content: current.content,
                options: current.options as Prisma.InputJsonValue,
                correctAnswers: current.correctAnswers as Prisma.InputJsonValue,
                difficulty: current.difficulty,
                tags: current.tags as Prisma.InputJsonValue,
                status: "DRAFT",
                version: current.version + 1,
                familyId: current.familyId,
                supersedesId: current.id,
                contentHash: current.contentHash,
              },
            });
      if (current.status === "DRAFT" && current.imageObjectKey)
        await this.removeQuestionObjectIfUnreferenced(current.imageObjectKey);
      return this.mapQuestion(updated);
    }
    const current = this.questions.find((item) => item.id === questionId);
    if (!current) throw new NotFoundException("Không tìm thấy câu hỏi.");
    const familyId = current.familyId ?? current.id;
    const latest = this.questions
      .filter((item) => (item.familyId ?? item.id) === familyId)
      .sort((left, right) => right.version - left.version)[0];
    if (latest?.id !== current.id)
      throw new ConflictException(
        "Chỉ có thể gỡ ảnh trên phiên bản mới nhất của câu hỏi.",
      );
    const target =
      current.status === "DRAFT"
        ? current
        : {
            ...this.cloneQuestion(current),
            id: id("question"),
            familyId,
            supersedesId: current.id,
            status: "DRAFT" as const,
            version: current.version + 1,
          };
    if (target !== current) this.questions.unshift(target);
    this.questionImages.delete(target.id);
    delete target.imageUrl;
    delete target.imageName;
    delete target.imageMimeType;
    delete target.imageSizeBytes;
    return this.cloneQuestion(target);
  }

  /** Cho người quản lý hoặc thành viên đề/lớp hợp lệ đọc ảnh câu hỏi mà không lộ object key. */
  async readQuestionImage(
    questionId: string,
    role: string,
    actorId: string,
  ): Promise<MaterialDownload> {
    const prisma = this.database();
    if (prisma) {
      if (role === "LEARNER") {
        const exam = await prisma.exam.findFirst({
          where: {
            status: "PUBLISHED",
            questions: { some: { questionId } },
            class: {
              enrollments: { some: { learnerId: actorId, status: "ACTIVE" } },
            },
            attempts: { some: { learnerId: actorId, status: "IN_PROGRESS" } },
          },
          include: {
            attempts: { where: { learnerId: actorId, status: "IN_PROGRESS" } },
          },
        });
        if (
          !exam ||
          !exam.attempts.some(
            (attempt) =>
              this.attemptDeadline(
                attempt.startedAt,
                exam.durationMinutes,
                exam.closeAt,
              ) > new Date(),
          )
        )
          throw new NotFoundException(
            "Không tìm thấy ảnh câu hỏi được phép xem.",
          );
      }
      const question = await prisma.question.findUnique({
        where: { id: questionId },
      });
      if (
        !question?.imageObjectKey ||
        !question.imageName ||
        !question.imageMimeType
      )
        throw new NotFoundException(
          "Không tìm thấy ảnh câu hỏi được phép xem.",
        );
      return {
        fileName: normalizeMultipartFileName(question.imageName),
        mimeType: question.imageMimeType,
        buffer: await this.readStoredFile(question.imageObjectKey),
      };
    }
    const question = this.questions.find((item) => item.id === questionId);
    const canRead =
      role !== "LEARNER" ||
      this.exams.some(
        (exam) =>
          exam.status === "PUBLISHED" &&
          exam.questionIds.includes(questionId) &&
          this.findClass(exam.classId).learnerIds.includes(actorId) &&
          this.attempts.some(
            (attempt) =>
              attempt.examId === exam.id &&
              attempt.learnerId === actorId &&
              attempt.status === "IN_PROGRESS" &&
              this.attemptDeadline(
                new Date(attempt.startedAt),
                exam.durationMinutes,
                new Date(exam.closeAt),
              ) > new Date(),
          ),
      );
    const image = this.questionImages.get(questionId);
    if (!question || !canRead || !image)
      throw new NotFoundException("Không tìm thấy ảnh câu hỏi được phép xem.");
    return {
      fileName: image.fileName,
      mimeType: image.mimeType,
      buffer: Buffer.from(image.buffer),
    };
  }

  /** Xuất bản ngay hoặc chuyển PENDING_REVIEW tùy chế độ phê duyệt câu hỏi. */
  async publishQuestion(
    questionId: string,
    actorId = "usr-instructor",
  ): Promise<LearningQuestion> {
    const approvalMode = await this.getQuestionApprovalMode();
    const nextStatus: LearningQuestion["status"] =
      approvalMode === "AUTO" ? "PUBLISHED" : "PENDING_REVIEW";
    const prisma = this.database();
    if (prisma) {
      const current = await prisma.question.findUnique({
        where: { id: questionId },
      });
      if (!current) throw new NotFoundException("Không tìm thấy câu hỏi.");
      if (current.status === "PUBLISHED") return this.mapQuestion(current);
      if (current.status === "PENDING_REVIEW") return this.mapQuestion(current);
      const latest = await prisma.question.findFirst({
        where: { familyId: current.familyId },
        orderBy: { version: "desc" },
      });
      if (latest?.id !== current.id)
        throw new ConflictException(
          "Chỉ có thể xuất bản phiên bản mới nhất của câu hỏi.",
        );
      return prisma.$transaction(async (transaction) => {
        const updated = await transaction.question.update({
          where: { id: questionId },
          data: { status: nextStatus },
        });
        await transaction.auditLog.create({
          data: {
            actorId,
            action:
              approvalMode === "AUTO"
                ? "QUESTION_AUTO_APPROVED"
                : "QUESTION_SUBMITTED_FOR_REVIEW",
            entityType: "question",
            entityId: questionId,
            context: { version: current.version, approvalMode },
          },
        });
        if (approvalMode === "AUTO")
          await transaction.notification.create({
            data: {
              id: id("notification"),
              recipientId: current.authorId,
              type: "QUESTION_REVIEWED",
              title: "Câu hỏi đã được tự động phê duyệt",
              entityType: "QUESTION",
              entityId: questionId,
              dedupKey: `question-auto-approval:${questionId}:${current.version}:${current.authorId}`,
            },
          });
        return this.mapQuestion(updated);
      });
    }
    const current = this.questions.find((item) => item.id === questionId);
    if (!current) throw new NotFoundException("Không tìm thấy câu hỏi.");
    if (current.status === "PUBLISHED") return this.cloneQuestion(current);
    if (current.status === "PENDING_REVIEW") return this.cloneQuestion(current);
    const familyId = current.familyId ?? current.id;
    const latest = this.questions
      .filter((item) => (item.familyId ?? item.id) === familyId)
      .sort((a, b) => b.version - a.version)[0];
    if (latest?.id !== current.id)
      throw new ConflictException(
        "Chỉ có thể xuất bản phiên bản mới nhất của câu hỏi.",
      );
    current.status = nextStatus;
    if (approvalMode === "AUTO")
      this.notifications.unshift({
        id: id("notification"),
        recipientId: actorId,
        type: "QUESTION_REVIEWED",
        title: "Câu hỏi đã được tự động phê duyệt",
        entityType: "QUESTION",
        entityId: questionId,
        createdAt: now(),
      });
    return this.cloneQuestion(current);
  }

  /** Áp dụng quyết định duyệt tay, bắt buộc ghi chú khi trả lại và lưu audit. */
  async reviewQuestion(
    questionId: string,
    decision: "APPROVE" | "RETURN",
    rawNote?: string,
    reviewerId = "usr-admin",
  ): Promise<LearningQuestion> {
    const reviewNote = rawNote?.trim();
    if (decision === "RETURN" && (!reviewNote || reviewNote.length < 5))
      throw new BadRequestException(
        "Cần lý do ít nhất 5 ký tự khi trả lại câu hỏi.",
      );
    const nextStatus: LearningQuestion["status"] =
      decision === "APPROVE" ? "PUBLISHED" : "DRAFT";
    const prisma = this.database();
    if (prisma) {
      return prisma.$transaction(async (transaction) => {
        const current = await transaction.question.findUnique({
          where: { id: questionId },
        });
        if (!current) throw new NotFoundException("Không tìm thấy câu hỏi.");
        if (current.status !== "PENDING_REVIEW")
          throw new ConflictException(
            "Câu hỏi không ở trạng thái chờ phê duyệt.",
          );
        const reviewId = id("question-review");
        const updated = await transaction.question.update({
          where: { id: questionId },
          data: { status: nextStatus },
        });
        await transaction.auditLog.create({
          data: {
            actorId: reviewerId,
            action: `QUESTION_${decision}`,
            entityType: "question",
            entityId: questionId,
            context: {
              version: current.version,
              reviewNote: reviewNote ?? "Đạt yêu cầu",
            },
          },
        });
        await transaction.notification.create({
          data: {
            id: id("notification"),
            recipientId: current.authorId,
            type: "QUESTION_REVIEWED",
            title:
              decision === "APPROVE"
                ? "Câu hỏi đã được phê duyệt"
                : `Câu hỏi đã được trả lại: ${reviewNote}`,
            entityType: "QUESTION",
            entityId: questionId,
            dedupKey: `${reviewId}:${current.authorId}`,
          },
        });
        return this.mapQuestion(updated);
      });
    }
    const current = this.questions.find((item) => item.id === questionId);
    if (!current) throw new NotFoundException("Không tìm thấy câu hỏi.");
    if (current.status !== "PENDING_REVIEW")
      throw new ConflictException("Câu hỏi không ở trạng thái chờ phê duyệt.");
    current.status = nextStatus;
    return this.cloneQuestion(current);
  }

  /** Nhập từng câu độc lập để lỗi một mục không hủy toàn bộ lô. */
  async importQuestions(
    inputs: Array<Omit<LearningQuestion, "id" | "status" | "version">>,
    authorId = "usr-instructor",
  ): Promise<QuestionImportResult[]> {
    const results: QuestionImportResult[] = [];
    for (const [index, input] of inputs.entries()) {
      try {
        const question = await this.createQuestion(input, authorId);
        results.push({
          row: index + 1,
          status: "IMPORTED",
          questionId: question.id,
          message: "Đã nhập câu hỏi.",
        });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Không thể nhập câu hỏi.";
        results.push({ row: index + 1, status: "FAILED", message });
      }
    }
    return results;
  }

  /** Liệt kê đề theo vai trò và quan hệ lớp, không trả đề ngoài phạm vi giảng dạy/ghi danh. */
  async listExams(
    role: string,
    actorId = this.userIdForRole(role),
  ): Promise<LearningExam[]> {
    const prisma = this.database();
    if (prisma) {
      const rows = await prisma.exam.findMany({
        where:
          role === "LEARNER"
            ? {
                status: "PUBLISHED",
                class: {
                  enrollments: {
                    some: { learnerId: actorId, status: "ACTIVE" },
                  },
                },
              }
            : role === "INSTRUCTOR"
              ? { class: { instructors: { some: { instructorId: actorId } } } }
              : undefined,
        include: { questions: { orderBy: { position: "asc" } } },
        orderBy: { openAt: "desc" },
      });
      return rows.map((row) => this.mapExam(row));
    }
    return this.exams
      .filter((item) => {
        const classItem = this.classes.find(
          (candidate) => candidate.id === item.classId,
        );
        if (role === "LEARNER")
          return (
            item.status === "PUBLISHED" &&
            classItem?.learnerIds.includes(actorId)
          );
        if (role === "INSTRUCTOR")
          return classItem?.instructorIds.includes(actorId);
        return true;
      })
      .map((item) => ({ ...item, questionIds: [...item.questionIds] }));
  }

  /** Ghép đề đã công bố với số lượt và thời gian để tính trạng thái khả dụng cho học viên. */
  async listLearnerExamSummaries(
    classId?: string,
    learnerId = "usr-learner",
  ): Promise<LearnerExamSummary[]> {
    const timestamp = new Date();
    const prisma = this.database();
    if (prisma) {
      const rows = await prisma.exam.findMany({
        where: {
          status: "PUBLISHED",
          classId: classId || undefined,
          class: { enrollments: { some: { learnerId, status: "ACTIVE" } } },
        },
        include: {
          questions: { orderBy: { position: "asc" } },
          attempts: { where: { learnerId }, orderBy: { attemptNo: "asc" } },
        },
        orderBy: { openAt: "desc" },
      });
      return rows.map((row) => {
        const exam = this.mapExam(row);
        const active = row.attempts.some(
          (attempt) => attempt.status === "IN_PROGRESS",
        );
        return {
          ...exam,
          questionIds: [],
          questionCount: row.questions.length,
          availabilityStatus: this.examAvailability(
            exam,
            row.attempts.length,
            active,
            timestamp,
          ),
          remainingAttempts: Math.max(
            0,
            exam.attemptLimit - row.attempts.length,
          ),
          serverTime: timestamp.toISOString(),
        };
      });
    }
    return this.exams
      .filter((exam) => exam.status === "PUBLISHED")
      .filter((exam) => !classId || exam.classId === classId)
      .filter((exam) =>
        this.classes.some(
          (classItem) =>
            classItem.id === exam.classId &&
            classItem.learnerIds.includes(learnerId),
        ),
      )
      .map((exam) => {
        const attempts = this.attempts.filter(
          (attempt) =>
            attempt.examId === exam.id && attempt.learnerId === learnerId,
        );
        return {
          ...exam,
          questionIds: [],
          questionCount: exam.questionIds.length,
          availabilityStatus: this.examAvailability(
            exam,
            attempts.length,
            attempts.some((attempt) => attempt.status === "IN_PROGRESS"),
            timestamp,
          ),
          remainingAttempts: Math.max(0, exam.attemptLimit - attempts.length),
          serverTime: timestamp.toISOString(),
        };
      });
  }

  /** Trả câu hỏi cho học viên theo thứ tự seed nếu xáo trộn và loại dữ liệu đáp án đúng. */
  async getExamQuestions(
    examId: string,
    learnerId = "usr-learner",
  ): Promise<LearningQuestion[]> {
    const prisma = this.database();
    if (prisma) {
      const exam = await prisma.exam.findFirst({
        where: {
          id: examId,
          status: "PUBLISHED",
          class: { enrollments: { some: { learnerId, status: "ACTIVE" } } },
          attempts: { some: { learnerId, status: "IN_PROGRESS" } },
        },
        include: {
          questions: {
            include: { question: true },
            orderBy: { position: "asc" },
          },
          attempts: { where: { learnerId, status: "IN_PROGRESS" }, take: 1 },
        },
      });
      if (!exam)
        throw new NotFoundException(
          "Không tìm thấy lượt làm bài đang mở cho đề này.",
        );
      const activeAttempt = exam.attempts[0];
      if (
        !activeAttempt ||
        this.attemptDeadline(
          activeAttempt.startedAt,
          exam.durationMinutes,
          exam.closeAt,
        ) <= new Date()
      ) {
        throw new BadRequestException("Lượt làm bài đã hết thời gian.");
      }
      const original = exam.questions.map(({ question }) =>
        this.mapQuestion(question),
      );
      const questionIds = exam.shuffleQuestions
        ? this.seededOrder(
            original.map((question) => question.id),
            `${exam.randomSeed ?? "wind-exam-default"}:${learnerId}`,
          )
        : original.map((question) => question.id);
      const byId = new Map(original.map((question) => [question.id, question]));
      return questionIds.map((questionId) => ({
        ...byId.get(questionId)!,
        correctAnswers: [],
      }));
    }
    const exam = this.findExam(examId);
    if (exam.status !== "PUBLISHED")
      throw new BadRequestException("Đề chưa được phát hành.");
    const classItem = this.findClass(exam.classId);
    if (!classItem.learnerIds.includes(learnerId))
      throw new NotFoundException("Học viên không thuộc lớp được giao đề.");
    if (
      !this.attempts.some(
        (attempt) =>
          attempt.examId === examId &&
          attempt.learnerId === learnerId &&
          attempt.status === "IN_PROGRESS",
      )
    ) {
      throw new NotFoundException(
        "Không tìm thấy lượt làm bài đang mở cho đề này.",
      );
    }
    const activeAttempt = this.attempts.find(
      (attempt) =>
        attempt.examId === examId &&
        attempt.learnerId === learnerId &&
        attempt.status === "IN_PROGRESS",
    );
    if (
      !activeAttempt ||
      this.attemptDeadline(
        new Date(activeAttempt.startedAt),
        exam.durationMinutes,
        new Date(exam.closeAt),
      ) <= new Date()
    ) {
      throw new BadRequestException("Lượt làm bài đã hết thời gian.");
    }
    const questionIds = exam.shuffleQuestions
      ? this.seededOrder(
          exam.questionIds,
          `${exam.randomSeed ?? "wind-exam-default"}:${learnerId}`,
        )
      : exam.questionIds;
    return questionIds.map((questionId) => {
      const question = this.questions.find((item) => item.id === questionId);
      if (!question)
        throw new NotFoundException("Đề chứa câu hỏi không tồn tại.");
      return {
        ...question,
        options: [...question.options],
        correctAnswers: [],
        tags: [...question.tags],
      };
    });
  }

  /** Xác minh giảng viên phụ trách rồi trả câu hỏi theo đúng thứ tự gốc của đề. */
  async getInstructorExamPreview(
    examId: string,
    instructorId = "usr-instructor",
  ): Promise<LearningQuestion[]> {
    const prisma = this.database();
    if (prisma) {
      const exam = await prisma.exam.findFirst({
        where: {
          id: examId,
          class: { instructors: { some: { instructorId } } },
        },
        include: {
          questions: {
            include: { question: true },
            orderBy: { position: "asc" },
          },
        },
      });
      if (!exam)
        throw new NotFoundException("Không tìm thấy đề thi được phép xem.");
      return exam.questions.map(({ question }) => this.mapQuestion(question));
    }
    const exam = this.findExam(examId);
    if (!this.findClass(exam.classId).instructorIds.includes(instructorId))
      throw new NotFoundException("Không tìm thấy đề thi được phép xem.");
    return exam.questionIds.map((questionId) => {
      const question = this.questions.find((item) => item.id === questionId);
      if (!question)
        throw new NotFoundException("Đề chứa câu hỏi không tồn tại.");
      return {
        ...question,
        options: [...question.options],
        correctAnswers: [...question.correctAnswers],
        tags: [...question.tags],
      };
    });
  }

  /** Trả nội dung đề cho quản lý duyệt, chỉ khi đề đang ở hàng chờ phê duyệt. */
  async getReviewerExamPreview(examId: string): Promise<LearningQuestion[]> {
    const prisma = this.database();
    if (prisma) {
      const exam = await prisma.exam.findFirst({
        where: { id: examId, status: "PENDING_REVIEW" },
        include: {
          questions: {
            include: { question: true },
            orderBy: { position: "asc" },
          },
        },
      });
      if (!exam)
        throw new NotFoundException("Không tìm thấy đề đang chờ phê duyệt.");
      return exam.questions.map(({ question }) => this.mapQuestion(question));
    }
    const exam = this.findExam(examId);
    if (exam.status !== "PENDING_REVIEW")
      throw new NotFoundException("Không tìm thấy đề đang chờ phê duyệt.");
    return exam.questionIds.map((questionId) =>
      this.cloneQuestion(
        this.questions.find((question) => question.id === questionId)!,
      ),
    );
  }

  /** Validate lịch/thang điểm/câu hỏi, giữ thứ tự chọn và tạo đề nháp cho lớp phụ trách. */
  async createExam(
    input: Omit<
      LearningExam,
      "id" | "status" | "version" | "questionScores" | "aiContext"
    > & { scoreAllocations?: Array<{ questionId: string; score: number }> },
    actorId = "usr-instructor",
  ): Promise<LearningExam> {
    if (new Date(input.closeAt) <= new Date(input.openAt))
      throw new BadRequestException("Thời gian đóng đề phải sau thời gian mở.");
    if (!input.questionIds.length)
      throw new BadRequestException("Đề cần ít nhất một câu hỏi.");
    const originalQuestionIds = [...input.questionIds];
    const questionScores = this.resolveExamScoreAllocations(
      originalQuestionIds,
      input.totalScore,
      input.scoreAllocations,
    );
    const prisma = this.database();
    if (prisma) {
      return prisma.$transaction(async (transaction) => {
        const classItem = await transaction.learningClass.findFirst({
          where: {
            id: input.classId,
            instructors: { some: { instructorId: actorId } },
          },
        });
        if (!classItem)
          throw new NotFoundException(
            "Không tìm thấy lớp học được phép tạo đề.",
          );
        if (classItem.status === "CLOSED")
          throw new ConflictException("Lớp đã lưu trữ và chỉ cho phép đọc.");
        if (new Set(input.questionIds).size !== input.questionIds.length)
          throw new BadRequestException(
            "Danh sách đề không được chứa câu hỏi trùng.",
          );
        const questionCount = await transaction.question.count({
          where: {
            id: { in: input.questionIds },
            status: "PUBLISHED",
            courseId: classItem.courseId,
          },
        });
        if (questionCount !== input.questionIds.length)
          throw new BadRequestException(
            "Đề chỉ được dùng câu hỏi đã xuất bản thuộc khóa học của lớp.",
          );
        const exam = await transaction.exam.create({
          data: {
            id: id("exam"),
            classId: input.classId,
            title: input.title.trim(),
            durationMinutes: input.durationMinutes,
            totalScore: input.totalScore,
            openAt: new Date(input.openAt),
            closeAt: new Date(input.closeAt),
            attemptLimit: input.attemptLimit,
            shuffleQuestions: input.shuffleQuestions ?? false,
            randomSeed: input.randomSeed?.trim(),
          },
        });
        await transaction.examQuestion.createMany({
          data: originalQuestionIds.map((questionId, position) => ({
            examId: exam.id,
            questionId,
            position: position + 1,
            score: questionScores[questionId]!,
          })),
        });
        return this.getDatabaseExam(transaction, exam.id);
      });
    }
    const classItem = this.findClass(input.classId);
    if (!classItem.instructorIds.includes(actorId))
      throw new NotFoundException("Không tìm thấy lớp học được phép tạo đề.");
    if (classItem.status === "CLOSED")
      throw new ConflictException("Lớp đã lưu trữ và chỉ cho phép đọc.");
    if (new Set(input.questionIds).size !== input.questionIds.length)
      throw new BadRequestException(
        "Danh sách đề không được chứa câu hỏi trùng.",
      );
    if (
      input.questionIds.some(
        (questionId) =>
          !this.questions.some(
            (question) =>
              question.id === questionId &&
              question.status === "PUBLISHED" &&
              question.courseId === classItem.courseId,
          ),
      )
    )
      throw new BadRequestException(
        "Đề chỉ được dùng câu hỏi đã xuất bản thuộc khóa học của lớp.",
      );
    const item: LearningExam = {
      id: id("exam"),
      classId: input.classId,
      title: input.title.trim(),
      questionIds: originalQuestionIds,
      durationMinutes: input.durationMinutes,
      totalScore: input.totalScore,
      openAt: input.openAt,
      closeAt: input.closeAt,
      attemptLimit: input.attemptLimit,
      shuffleQuestions: input.shuffleQuestions,
      randomSeed: input.randomSeed,
      questionScores,
      status: "DRAFT",
      version: 1,
    };
    this.exams.unshift(item);
    return { ...item, questionIds: [...item.questionIds] };
  }

  /** Thay nội dung đề DRAFT nguyên tử, tăng version và từ chối bản chỉnh sửa đã cũ. */
  async updateExam(
    examId: string,
    input: Omit<
      LearningExam,
      "id" | "status" | "version" | "questionScores" | "aiContext"
    > & {
      scoreAllocations?: Array<{ questionId: string; score: number }>;
      expectedVersion: number;
    },
    actorId = "usr-instructor",
  ): Promise<LearningExam> {
    if (new Date(input.closeAt) <= new Date(input.openAt))
      throw new BadRequestException("Thời gian đóng đề phải sau thời gian mở.");
    if (
      !input.questionIds.length ||
      new Set(input.questionIds).size !== input.questionIds.length
    )
      throw new BadRequestException(
        "Đề cần câu hỏi hợp lệ và không được trùng.",
      );
    const questionScores = this.resolveExamScoreAllocations(
      input.questionIds,
      input.totalScore,
      input.scoreAllocations,
    );
    const prisma = this.database();
    if (prisma) {
      return prisma.$transaction(async (transaction) => {
        const current = await transaction.exam.findFirst({
          where: {
            id: examId,
            class: { instructors: { some: { instructorId: actorId } } },
          },
          include: { class: true },
        });
        if (!current)
          throw new NotFoundException("Không tìm thấy đề được phép chỉnh sửa.");
        if (current.class.status === "CLOSED")
          throw new ConflictException("Lớp đã lưu trữ và chỉ cho phép đọc.");
        if (current.status !== "DRAFT")
          throw new ConflictException("Chỉ đề nháp mới được chỉnh sửa.");
        if (current.version !== input.expectedVersion)
          throw new ConflictException(
            "Đề đã được cập nhật ở nơi khác; hãy tải lại trước khi sửa.",
          );
        const questionCount = await transaction.question.count({
          where: {
            id: { in: input.questionIds },
            status: "PUBLISHED",
            courseId: current.class.courseId,
          },
        });
        if (questionCount !== input.questionIds.length)
          throw new BadRequestException(
            "Đề chỉ được dùng câu hỏi đã xuất bản thuộc khóa học của lớp.",
          );
        const claimed = await transaction.exam.updateMany({
          where: {
            id: examId,
            status: "DRAFT",
            version: input.expectedVersion,
          },
          data: {
            title: input.title.trim(),
            durationMinutes: input.durationMinutes,
            totalScore: input.totalScore,
            openAt: new Date(input.openAt),
            closeAt: new Date(input.closeAt),
            attemptLimit: input.attemptLimit,
            shuffleQuestions: input.shuffleQuestions ?? false,
            randomSeed: input.randomSeed?.trim(),
            version: { increment: 1 },
          },
        });
        if (claimed.count !== 1)
          throw new ConflictException(
            "Đề đã thay đổi; hãy tải lại trước khi sửa.",
          );
        await transaction.examQuestion.deleteMany({ where: { examId } });
        await transaction.examQuestion.createMany({
          data: input.questionIds.map((questionId, position) => ({
            examId,
            questionId,
            position: position + 1,
            score: questionScores[questionId]!,
          })),
        });
        await transaction.auditLog.create({
          data: {
            actorId,
            action: "EXAM_DRAFT_UPDATED",
            entityType: "exam",
            entityId: examId,
            context: {
              previousVersion: input.expectedVersion,
              nextVersion: input.expectedVersion + 1,
              questionIds: input.questionIds,
              questionScores,
            },
          },
        });
        return this.getDatabaseExam(transaction, examId);
      });
    }
    const current = this.findExam(examId);
    const classItem = this.findClass(current.classId);
    if (!classItem.instructorIds.includes(actorId))
      throw new NotFoundException("Không tìm thấy đề được phép chỉnh sửa.");
    if (classItem.status === "CLOSED")
      throw new ConflictException("Lớp đã lưu trữ và chỉ cho phép đọc.");
    if (current.status !== "DRAFT")
      throw new ConflictException("Chỉ đề nháp mới được chỉnh sửa.");
    if (current.version !== input.expectedVersion)
      throw new ConflictException(
        "Đề đã được cập nhật ở nơi khác; hãy tải lại trước khi sửa.",
      );
    if (
      input.questionIds.some(
        (questionId) =>
          !this.questions.some(
            (question) =>
              question.id === questionId &&
              question.status === "PUBLISHED" &&
              question.courseId === classItem.courseId,
          ),
      )
    )
      throw new BadRequestException(
        "Đề chỉ được dùng câu hỏi đã xuất bản thuộc khóa học của lớp.",
      );
    Object.assign(current, {
      title: input.title.trim(),
      questionIds: [...input.questionIds],
      durationMinutes: input.durationMinutes,
      totalScore: input.totalScore,
      openAt: input.openAt,
      closeAt: input.closeAt,
      attemptLimit: input.attemptLimit,
      shuffleQuestions: input.shuffleQuestions,
      randomSeed: input.randomSeed,
      questionScores,
      version: current.version + 1,
    });
    return {
      ...current,
      questionIds: [...current.questionIds],
      questionScores: { ...current.questionScores },
    };
  }

  /** Sửa câu trong đề nháp bằng bản sao riêng; giữ nguyên các đề đang dùng câu gốc. */
  async editExamQuestion(examId: string, questionId: string, input: { content: string; options: string[]; correctAnswers: string[]; expectedVersion: number }, actorId: string): Promise<LearningQuestion> {
    const prisma = this.database();
    if (prisma) return prisma.$transaction(async (tx) => {
      const exam = await tx.exam.findFirst({ where: { id: examId, class: { instructors: { some: { instructorId: actorId } } } }, include: { class: true, questions: { include: { question: true } } } });
      if (!exam) throw new NotFoundException("Không tìm thấy đề được phép sửa.");
      if (exam.status !== "DRAFT" || exam.class.status === "CLOSED") throw new ConflictException("Chỉ sửa câu hỏi trong đề nháp của lớp đang hoạt động.");
      const link = exam.questions.find((item) => item.questionId === questionId);
      if (!link) throw new NotFoundException("Câu hỏi không còn thuộc đề. Hãy tải lại.");
      if (exam.version !== input.expectedVersion) throw new ConflictException("Đề đã thay đổi. Hãy tải lại trước khi sửa.");
      const normalized = this.validateQuestionInput({ ...this.mapQuestion(link.question), content: input.content, options: input.options, correctAnswers: input.correctAnswers });
      const changed = await tx.exam.updateMany({ where: { id: examId, status: "DRAFT", version: input.expectedVersion }, data: { version: { increment: 1 } } });
      if (changed.count !== 1) throw new ConflictException("Đề đã thay đổi. Hãy tải lại.");
      const questionIdNew = id("question");
      const question = await tx.question.create({ data: { id: questionIdNew, familyId: questionIdNew, courseId: link.question.courseId, authorId: actorId, type: normalized.type, content: normalized.content, contentHash: this.questionContentHash(normalized.content), options: normalized.options, correctAnswers: normalized.correctAnswers, difficulty: normalized.difficulty, tags: normalized.tags, status: "DRAFT", version: 1, imageObjectKey: link.question.imageObjectKey, imageName: link.question.imageName, imageMimeType: link.question.imageMimeType, imageSizeBytes: link.question.imageSizeBytes, imageChecksum: link.question.imageChecksum } });
      await tx.examQuestion.update({ where: { examId_questionId: { examId, questionId } }, data: { questionId: question.id } });
      await tx.auditLog.create({ data: { actorId, action: "EXAM_QUESTION_EDITED", entityType: "exam", entityId: examId, context: { oldQuestionId: questionId, questionId: question.id } } });
      return this.mapQuestion(question);
    });
    const exam = this.findExam(examId);
    const classItem = this.findClass(exam.classId);
    if (!classItem.instructorIds.includes(actorId)) throw new NotFoundException("Không tìm thấy đề được phép sửa.");
    if (exam.status !== "DRAFT" || classItem.status === "CLOSED" || exam.version !== input.expectedVersion) throw new ConflictException("Đề không còn được sửa hoặc đã thay đổi. Hãy tải lại.");
    const original = this.questions.find((item) => item.id === questionId && exam.questionIds.includes(questionId));
    if (!original) throw new NotFoundException("Câu hỏi không còn thuộc đề.");
    const normalized = this.validateQuestionInput({ ...original, content: input.content, options: input.options, correctAnswers: input.correctAnswers });
    const nextId = id("question");
    const next: LearningQuestion = { ...original, ...normalized, id: nextId, familyId: nextId, status: "DRAFT", version: 1 };
    this.questions.push(next);
    exam.questionIds = exam.questionIds.map((value) => value === questionId ? next.id : value);
    if (exam.questionScores) { exam.questionScores[next.id] = exam.questionScores[questionId]!; delete exam.questionScores[questionId]; }
    exam.version += 1;
    return this.cloneQuestion(next);
  }

  /** Kiểm tra đề hoàn chỉnh rồi tự công bố hoặc đưa vào hàng đợi duyệt theo cấu hình. */
  async submitExamForReview(
    examId: string,
    actorId = "usr-instructor",
    confirmQuestions = false,
    expectedVersion?: number,
  ): Promise<LearningExam> {
    const approvalMode = await this.getExamApprovalMode();
    const nextStatus: LearningExam["status"] =
      approvalMode === "AUTO" ? "PUBLISHED" : "PENDING_REVIEW";
    const prisma = this.database();
    if (prisma) {
      const assignment = await prisma.exam.findFirst({
        where: {
          id: examId,
          class: { instructors: { some: { instructorId: actorId } } },
        },
        include: { class: { include: { instructors: true } } },
      });
      if (!assignment)
        throw new NotFoundException("Không tìm thấy đề được phép gửi duyệt.");
      const exam = await this.getDatabaseExam(prisma, examId);
      if (!exam.questionIds.length)
        throw new BadRequestException("Đề cần ít nhất một câu hỏi.");
      const publishedQuestionCount = await prisma.examQuestion.count({
        where: { examId, question: { status: "PUBLISHED" } },
      });
      if (!confirmQuestions && publishedQuestionCount !== exam.questionIds.length)
        throw new ConflictException(
          "Mọi câu hỏi trong đề phải được phê duyệt trước khi gửi duyệt đề.",
        );
      if (exam.status !== "DRAFT")
        throw new ConflictException("Chỉ đề nháp mới được gửi duyệt.");
      if (assignment.class.status === "CLOSED")
        throw new ConflictException("Lớp đã lưu trữ và chỉ cho phép đọc.");
      if (
        assignment.closeAt <= new Date() ||
        assignment.openAt < assignment.class.startAt ||
        assignment.closeAt > assignment.class.endAt
      )
        throw new ConflictException(
          "Lịch đề không còn hợp lệ trong thời gian của lớp.",
        );
      return prisma.$transaction(async (transaction) => {
        const changed = await transaction.exam.updateMany({ where: { id: examId, status: "DRAFT", version: expectedVersion ?? exam.version }, data: { status: nextStatus } });
        if (changed.count !== 1) throw new ConflictException("Đề đã thay đổi. Hãy tải lại trước khi xác nhận.");
        if (confirmQuestions) {
          const linked = await transaction.examQuestion.findMany({ where: { examId }, include: { question: true } });
          for (const { question } of linked) {
            this.validateQuestionInput(this.mapQuestion(question));
            if (question.status !== "PUBLISHED") {
              if (question.authorId !== actorId) throw new ConflictException("Không thể xác nhận câu chưa duyệt của người khác. Hãy sửa thành bản riêng trong đề.");
              await transaction.question.update({ where: { id: question.id }, data: { status: "PUBLISHED" } });
              await transaction.auditLog.create({ data: { actorId, action: "QUESTION_CONFIRMED_WITH_EXAM", entityType: "question", entityId: question.id, context: { examId, version: question.version } } });
            }
          }
        }
        if (approvalMode === "AUTO") {
          await transaction.auditLog.create({
            data: {
              actorId,
              action: "EXAM_AUTO_APPROVED",
              entityType: "exam",
              entityId: examId,
              context: { version: exam.version, approvalMode },
            },
          });
          for (const { instructorId } of assignment.class.instructors)
            await transaction.notification.create({
              data: {
                id: id("notification"),
                recipientId: instructorId,
                type: "EXAM_REVIEWED",
                title: `Đề ${assignment.title} đã được tự động phê duyệt`,
                entityType: "EXAM",
                entityId: examId,
                dedupKey: `exam-auto-approval:${examId}:${exam.version}:${instructorId}`,
              },
            });
        }
        return this.getDatabaseExam(transaction, examId);
      });
    }
    const item = this.findExam(examId);
    if (!this.findClass(item.classId).instructorIds.includes(actorId))
      throw new NotFoundException("Không tìm thấy đề được phép gửi duyệt.");
    if (!item.questionIds.length)
      throw new BadRequestException("Đề cần ít nhất một câu hỏi.");
    if (
      !confirmQuestions && item.questionIds.some(
        (questionId) =>
          this.questions.find((question) => question.id === questionId)
            ?.status !== "PUBLISHED",
      )
    )
      throw new ConflictException(
        "Mọi câu hỏi trong đề phải được phê duyệt trước khi gửi duyệt đề.",
      );
    if (item.status !== "DRAFT")
      throw new ConflictException("Chỉ đề nháp mới được gửi duyệt.");
    const classWindow = this.findClass(item.classId);
    if (classWindow.status === "CLOSED")
      throw new ConflictException("Lớp đã lưu trữ và chỉ cho phép đọc.");
    if (
      new Date(item.closeAt) <= new Date() ||
      new Date(item.openAt) < new Date(classWindow.startAt) ||
      new Date(item.closeAt) > new Date(classWindow.endAt)
    )
      throw new ConflictException(
        "Lịch đề không còn hợp lệ trong thời gian của lớp.",
      );
    if (expectedVersion !== undefined && item.version !== expectedVersion) throw new ConflictException("Đề đã thay đổi. Hãy tải lại.");
    if (confirmQuestions) {
      const linked = item.questionIds.map((questionId) => this.questions.find((question) => question.id === questionId));
      for (const question of linked) { if (!question) throw new NotFoundException("Không tìm thấy câu hỏi."); this.validateQuestionInput(question); }
      for (const question of linked) question!.status = "PUBLISHED";
    }
    item.status = nextStatus;
    if (approvalMode === "AUTO")
      for (const recipientId of this.findClass(item.classId).instructorIds)
        this.notifications.unshift({
          id: id("notification"),
          recipientId,
          type: "EXAM_REVIEWED",
          title: `Đề ${item.title} đã được tự động phê duyệt`,
          entityType: "EXAM",
          entityId: examId,
          createdAt: now(),
        });
    return { ...item, questionIds: [...item.questionIds] };
  }

  /** Chốt duyệt/từ chối đề, lưu approval record và thông báo cho người tạo. */
  async reviewExam(
    examId: string,
    decision: ExamApprovalRecord["decision"],
    rawNote?: string,
    reviewerId = "usr-manager",
  ): Promise<LearningExam> {
    const reviewNote = rawNote?.trim();
    if (decision === "RETURN" && (!reviewNote || reviewNote.length < 5))
      throw new BadRequestException(
        "Cần lý do ít nhất 5 ký tự khi trả lại đề.",
      );
    const nextStatus: LearningExam["status"] =
      decision === "APPROVE" ? "PUBLISHED" : "DRAFT";
    const prisma = this.database();
    if (prisma) {
      return prisma.$transaction(async (transaction) => {
        const current = await transaction.exam.findUnique({
          where: { id: examId },
          include: { class: { include: { instructors: true } } },
        });
        if (!current) throw new NotFoundException("Không tìm thấy đề.");
        if (current.status !== "PENDING_REVIEW")
          throw new ConflictException("Đề không ở trạng thái chờ phê duyệt.");
        if (current.class.status === "CLOSED")
          throw new ConflictException("Lớp đã lưu trữ và chỉ cho phép đọc.");
        if (
          decision === "APPROVE" &&
          (current.closeAt <= new Date() ||
            current.openAt < current.class.startAt ||
            current.closeAt > current.class.endAt)
        )
          throw new ConflictException(
            "Lịch đề không còn hợp lệ trong thời gian của lớp.",
          );
        const approvalId = id("exam-approval");
        await transaction.examApproval.create({
          data: {
            id: approvalId,
            examId,
            reviewerId,
            examVersion: current.version,
            decision,
            reviewNote,
          },
        });
        await transaction.auditLog.create({
          data: {
            actorId: reviewerId,
            action: `EXAM_${decision}`,
            entityType: "exam",
            entityId: examId,
            context: {
              version: current.version,
              reviewNote: reviewNote ?? "Đạt yêu cầu",
            },
          },
        });
        for (const { instructorId } of current.class.instructors)
          await transaction.notification.create({
            data: {
              id: id("notification"),
              recipientId: instructorId,
              type: "EXAM_REVIEWED",
              title: `Đề ${current.title}: ${decision}`,
              entityType: "EXAM",
              entityId: examId,
              dedupKey: `exam-review:${approvalId}:${instructorId}`,
            },
          });
        await transaction.exam.update({
          where: { id: examId },
          data: { status: nextStatus },
        });
        return this.getDatabaseExam(transaction, examId);
      });
    }
    const item = this.findExam(examId);
    if (item.status !== "PENDING_REVIEW")
      throw new ConflictException("Đề không ở trạng thái chờ phê duyệt.");
    const classWindow = this.findClass(item.classId);
    if (classWindow.status === "CLOSED")
      throw new ConflictException("Lớp đã lưu trữ và chỉ cho phép đọc.");
    if (
      decision === "APPROVE" &&
      (new Date(item.closeAt) <= new Date() ||
        new Date(item.openAt) < new Date(classWindow.startAt) ||
        new Date(item.closeAt) > new Date(classWindow.endAt))
    )
      throw new ConflictException(
        "Lịch đề không còn hợp lệ trong thời gian của lớp.",
      );
    const approval: ExamApprovalRecord = {
      id: id("exam-approval"),
      examId,
      reviewerId,
      examVersion: item.version,
      decision,
      reviewNote,
      createdAt: now(),
    };
    this.examApprovals.unshift(approval);
    item.status = nextStatus;
    for (const recipientId of this.findClass(item.classId).instructorIds)
      this.notifications.unshift({
        id: id("notification"),
        recipientId,
        type: "EXAM_REVIEWED",
        title: `Đề ${item.title}: ${decision}`,
        entityType: "EXAM",
        entityId: examId,
        createdAt: now(),
      });
    return { ...item, questionIds: [...item.questionIds] };
  }

  /** Liệt kê lịch sử phê duyệt của một đề thi. */
  async listExamApprovals(examId: string): Promise<ExamApprovalRecord[]> {
    const prisma = this.database();
    if (prisma) {
      const rows = await prisma.examApproval.findMany({
        where: { examId },
        orderBy: { createdAt: "desc" },
      });
      return rows.map((row) => ({
        id: row.id,
        examId: row.examId,
        reviewerId: row.reviewerId,
        examVersion: row.examVersion,
        decision: row.decision === "APPROVE" ? "APPROVE" : "RETURN",
        reviewNote: row.reviewNote ?? undefined,
        createdAt: row.createdAt.toISOString(),
      }));
    }
    return this.examApprovals
      .filter((item) => item.examId === examId)
      .map((item) => ({ ...item }));
  }

  /** Kiểm tra ghi danh, cửa sổ thi, giới hạn lượt rồi tạo hoặc tiếp tục lượt đang làm. */
  async startAttempt(
    examId: string,
    learnerId = "usr-learner",
  ): Promise<ExamAttempt> {
    const prisma = this.database();
    if (prisma) {
      const active = await prisma.examAttempt.findFirst({
        where: { examId, learnerId, status: "IN_PROGRESS" },
        include: { exam: true },
      });
      if (
        active &&
        this.attemptDeadline(
          active.startedAt,
          active.exam.durationMinutes,
          active.exam.closeAt,
        ) <= new Date()
      )
        await this.submitAttempt(active.id, learnerId);
      return prisma.$transaction(async (transaction) => {
        const exam = await transaction.exam.findUnique({
          where: { id: examId },
          include: {
            class: {
              include: {
                enrollments: { where: { learnerId, status: "ACTIVE" } },
              },
            },
          },
        });
        if (!exam) throw new NotFoundException("Không tìm thấy đề.");
        if (exam.status !== "PUBLISHED")
          throw new BadRequestException("Đề chưa được phát hành.");
        if (!exam.class.enrollments.length)
          throw new NotFoundException("Học viên không thuộc lớp được giao đề.");
        const timestamp = new Date();
        if (timestamp < exam.openAt || timestamp > exam.closeAt)
          throw new BadRequestException("Đề chưa mở hoặc đã đóng.");
        const attempts = await transaction.examAttempt.findMany({
          where: { examId, learnerId },
          include: { answers: true },
          orderBy: { attemptNo: "asc" },
        });
        const existing = attempts.find((item) => item.status === "IN_PROGRESS");
        if (existing) {
          return this.mapAttempt(existing);
        }
        if (attempts.length >= exam.attemptLimit)
          throw new BadRequestException("Đã hết số lần làm bài.");
        const created = await transaction.examAttempt.create({
          data: {
            id: id("attempt"),
            examId,
            learnerId,
            attemptNo: attempts.length + 1,
          },
          include: { answers: true },
        });
        return this.mapAttempt(created);
      });
    }
    const exam = this.findExam(examId);
    if (exam.status !== "PUBLISHED")
      throw new BadRequestException("Đề chưa được phát hành.");
    const timestamp = new Date();
    if (timestamp < new Date(exam.openAt) || timestamp > new Date(exam.closeAt))
      throw new BadRequestException("Đề chưa mở hoặc đã đóng.");
    const classItem = this.findClass(exam.classId);
    if (!classItem.learnerIds.includes(learnerId))
      throw new NotFoundException("Học viên không thuộc lớp được giao đề.");
    const attempts = this.attempts.filter(
      (item) => item.examId === examId && item.learnerId === learnerId,
    );
    const existing = attempts.find((item) => item.status === "IN_PROGRESS");
    if (existing) {
      if (
        this.attemptDeadline(
          new Date(existing.startedAt),
          exam.durationMinutes,
          new Date(exam.closeAt),
        ) <= timestamp
      )
        await this.submitAttempt(existing.id, learnerId);
      else return { ...existing, answers: { ...existing.answers } };
    }
    if (attempts.length >= exam.attemptLimit)
      throw new BadRequestException("Đã hết số lần làm bài.");
    const item: ExamAttempt = {
      id: id("attempt"),
      examId,
      learnerId,
      answers: {},
      status: "IN_PROGRESS",
      startedAt: now(),
    };
    this.attempts.push(item);
    return { ...item, answers: {} };
  }

  /** Validate đáp án thuộc đề và upsert câu trả lời khi lượt thi còn trong hạn. */
  async saveAnswer(
    attemptId: string,
    questionId: string,
    answers: string[],
    learnerId = "usr-learner",
  ): Promise<ExamAttempt> {
    const prisma = this.database();
    if (prisma) {
      return prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`SELECT id FROM exam_attempts WHERE id = ${attemptId} FOR UPDATE`;
      const attempt = await transaction.examAttempt.findFirst({
        where: { id: attemptId, learnerId },
        include: { exam: true },
      });
      if (!attempt) throw new NotFoundException("Không tìm thấy lượt làm bài.");
      if (attempt.status !== "IN_PROGRESS")
        throw new BadRequestException("Bài làm đã khóa.");
      if (
        this.attemptDeadline(
          attempt.startedAt,
          attempt.exam.durationMinutes,
          attempt.exam.closeAt,
        ) <= new Date()
      )
        throw new BadRequestException("Đã hết thời gian lưu câu trả lời.");
      const examQuestion = await transaction.examQuestion.findUnique({
        where: { examId_questionId: { examId: attempt.examId, questionId } },
        include: { question: true },
      });
      if (!examQuestion)
        throw new BadRequestException("Câu hỏi không thuộc đề.");
      const normalizedAnswers = this.validateSubmittedAnswers(
        this.mapQuestion(examQuestion.question),
        answers,
      );
      await transaction.attemptAnswer.upsert({
        where: { attemptId_questionId: { attemptId, questionId } },
        update: { answerData: normalizedAnswers },
        create: { attemptId, questionId, answerData: normalizedAnswers },
      });
      return this.getDatabaseAttempt(transaction, attemptId);
      });
    }
    const item = this.attempts.find(
      (attempt) => attempt.id === attemptId && attempt.learnerId === learnerId,
    );
    if (!item) throw new NotFoundException("Không tìm thấy lượt làm bài.");
    if (item.status !== "IN_PROGRESS")
      throw new BadRequestException("Bài làm đã khóa.");
    const exam = this.findExam(item.examId);
    if (
      this.attemptDeadline(
        new Date(item.startedAt),
        exam.durationMinutes,
        new Date(exam.closeAt),
      ) <= new Date()
    )
      throw new BadRequestException("Đã hết thời gian lưu câu trả lời.");
    if (!exam.questionIds.includes(questionId))
      throw new BadRequestException("Câu hỏi không thuộc đề.");
    const question = this.questions.find(
      (candidate) => candidate.id === questionId,
    );
    if (!question) throw new BadRequestException("Câu hỏi không tồn tại.");
    item.answers[questionId] = this.validateSubmittedAnswers(question, answers);
    item.lastSavedAt = now();
    return { ...item, answers: { ...item.answers }, serverTime: now() };
  }

  /** Chốt lượt thi nguyên tử, tự chấm câu khách quan và phát receipt chống nhầm lẫn. */
  async submitAttempt(
    attemptId: string,
    learnerId = "usr-learner",
  ): Promise<ExamAttempt> {
    const prisma = this.database();
    if (prisma) {
      return prisma.$transaction(async (transaction) => {
        await transaction.$queryRaw`SELECT id FROM exam_attempts WHERE id = ${attemptId} FOR UPDATE`;
        const attempt = await transaction.examAttempt.findFirst({
          where: { id: attemptId, learnerId },
          include: {
            answers: true,
            exam: { include: { questions: { include: { question: true } } } },
          },
        });
        if (!attempt)
          throw new NotFoundException("Không tìm thấy lượt làm bài.");
        if (attempt.status !== "IN_PROGRESS") return this.mapAttempt(attempt);
        const submittedAt = new Date();
        const claimed = await transaction.examAttempt.updateMany({
          where: { id: attemptId, learnerId, status: "IN_PROGRESS" },
          data: { status: "SUBMITTED", submittedAt },
        });
        if (!claimed.count)
          return this.getDatabaseAttempt(transaction, attemptId);
        let score = 0;
        let requiresManualGrade = false;
        for (const examQuestion of attempt.exam.questions) {
          const requiresManualAnswer = ["SHORT_ANSWER", "ESSAY"].includes(
            examQuestion.question.type,
          );
          if (requiresManualAnswer) {
            requiresManualGrade = true;
            continue;
          }
          const answer = attempt.answers.find(
            (item) => item.questionId === examQuestion.questionId,
          );
          const submitted = this.toStringArray(answer?.answerData ?? []);
          const isCorrect = this.isQuestionAnswerCorrect(
            this.mapQuestion(examQuestion.question),
            submitted,
          );
          const awarded = isCorrect ? Number(examQuestion.score) : 0;
          score += awarded;
          if (answer)
            await transaction.attemptAnswer.update({
              where: {
                attemptId_questionId: {
                  attemptId,
                  questionId: examQuestion.questionId,
                },
              },
              data: { score: awarded },
            });
        }
        const updated = await transaction.examAttempt.update({
          where: { id: attemptId },
          data: {
            score,
            submittedAt,
            status: requiresManualGrade ? "SUBMITTED" : "GRADED",
            gradePublishedAt: requiresManualGrade ? null : submittedAt,
            feedback: requiresManualGrade
              ? "Bài đang chờ giảng viên chấm câu tự luận hoặc câu trả lời ngắn."
              : "Bài đã được chấm tự động. Giảng viên có thể bổ sung nhận xét.",
          },
          include: { answers: true },
        });
        return this.mapAttempt(updated);
      });
    }
    const item = this.attempts.find(
      (attempt) => attempt.id === attemptId && attempt.learnerId === learnerId,
    );
    if (!item) throw new NotFoundException("Không tìm thấy lượt làm bài.");
    if (item.status !== "IN_PROGRESS")
      return { ...item, answers: { ...item.answers } };
    const exam = this.findExam(item.examId);
    let objectiveScore = 0;
    let requiresManualGrade = false;
    exam.questionIds.forEach((questionId) => {
      const question = this.questions.find(
        (candidate) => candidate.id === questionId,
      );
      if (!question) return;
      if (["SHORT_ANSWER", "ESSAY"].includes(question.type)) {
        requiresManualGrade = true;
        return;
      }
      if (
        this.isQuestionAnswerCorrect(question, item.answers[questionId] ?? [])
      )
        objectiveScore += this.examQuestionScore(exam, questionId);
    });
    item.score = Math.round(objectiveScore * 100) / 100;
    item.status = requiresManualGrade ? "SUBMITTED" : "GRADED";
    item.submittedAt = now();
    item.submissionReceipt = this.submissionReceipt(item.id, item.submittedAt);
    item.gradePublishedAt = requiresManualGrade ? undefined : now();
    item.feedback = requiresManualGrade
      ? "Bài đang chờ giảng viên chấm câu tự luận hoặc câu trả lời ngắn."
      : "Bài đã được chấm tự động. Giảng viên có thể bổ sung nhận xét.";
    return { ...item, answers: { ...item.answers } };
  }

  /** Tìm lượt IN_PROGRESS quá hạn theo lô và nộp tự động bằng cùng logic submit. */
  async reconcileExpiredAttempts(limit = 100): Promise<number> {
    const boundedLimit = Math.max(1, Math.min(limit, 500));
    const prisma = this.database();
    if (prisma) {
      const candidates = await prisma.examAttempt.findMany({
        where: { status: "IN_PROGRESS" },
        include: { exam: true },
        orderBy: { startedAt: "asc" },
        take: 500,
      });
      const timestamp = new Date();
      const expired = candidates
        .filter(
          (attempt) =>
            this.attemptDeadline(
              attempt.startedAt,
              attempt.exam.durationMinutes,
              attempt.exam.closeAt,
            ) <= timestamp,
        )
        .slice(0, boundedLimit);
      const results = await Promise.allSettled(
        expired.map((attempt) =>
          this.submitAttempt(attempt.id, attempt.learnerId),
        ),
      );
      return results.filter((result) => result.status === "fulfilled").length;
    }
    const timestamp = new Date();
    const expired = this.attempts
      .filter((attempt) => {
        const exam = this.findExam(attempt.examId);
        return (
          attempt.status === "IN_PROGRESS" &&
          this.attemptDeadline(
            new Date(attempt.startedAt),
            exam.durationMinutes,
            new Date(exam.closeAt),
          ) <= timestamp
        );
      })
      .slice(0, boundedLimit);
    for (const attempt of expired)
      await this.submitAttempt(attempt.id, attempt.learnerId);
    return expired.length;
  }

  /** Đọc một lượt thi và ánh xạ đáp án từ Prisma hoặc kho nhớ. */
  async getAttempt(attemptId: string): Promise<ExamAttempt> {
    const prisma = this.database();
    if (prisma) return this.getDatabaseAttempt(prisma, attemptId);
    const item = this.findAttempt(attemptId);
    return { ...item, answers: { ...item.answers } };
  }

  /** Liệt kê kết quả đã nộp/chấm của học viên cùng trạng thái phúc khảo. */
  async listLearnerResults(
    learnerId = "usr-learner",
  ): Promise<LearnerResult[]> {
    const prisma = this.database();
    if (prisma) {
      const rows = await prisma.examAttempt.findMany({
        where: { learnerId, status: "GRADED", gradePublishedAt: { not: null } },
        include: {
          answers: true,
          exam: {
            include: {
              questions: {
                include: { question: true },
                orderBy: { position: "asc" },
              },
            },
          },
          regradeRequests: {
            where: { learnerId },
            orderBy: { createdAt: "desc" },
            take: 1,
          },
        },
        orderBy: { gradePublishedAt: "desc" },
      });
      return rows.map((row) => ({
        attempt: this.mapAttempt(row),
        exam: {
          id: row.exam.id,
          title: row.exam.title,
          totalScore: Number(row.exam.totalScore),
          closeAt: row.exam.closeAt.toISOString(),
        },
        answerBreakdown: row.exam.questions.map((examQuestion) => {
          const answer = row.answers.find(
            (item) => item.questionId === examQuestion.questionId,
          );
          return {
            questionId: examQuestion.questionId,
            content: examQuestion.question.content,
            submittedAnswers: this.toStringArray(answer?.answerData ?? []),
            awardedScore: Number(answer?.score ?? 0),
            maxScore: Number(examQuestion.score),
          };
        }),
        regradeRequest: row.regradeRequests[0]
          ? this.mapRegradeRequest(row.regradeRequests[0])
          : undefined,
      }));
    }
    return this.attempts
      .filter(
        (attempt) =>
          attempt.learnerId === learnerId &&
          attempt.status === "GRADED" &&
          attempt.gradePublishedAt,
      )
      .sort((left, right) =>
        (right.gradePublishedAt ?? "").localeCompare(
          left.gradePublishedAt ?? "",
        ),
      )
      .map((attempt) => {
        const exam = this.findExam(attempt.examId);
        return {
          attempt: { ...attempt, answers: structuredClone(attempt.answers) },
          exam: {
            id: exam.id,
            title: exam.title,
            totalScore: exam.totalScore,
            closeAt: exam.closeAt,
          },
          answerBreakdown: exam.questionIds.map((questionId) => ({
            questionId,
            content:
              this.questions.find((question) => question.id === questionId)
                ?.content ?? "Câu hỏi không còn tồn tại",
            submittedAnswers: [...(attempt.answers[questionId] ?? [])],
            awardedScore: this.isMemoryAnswerCorrect(
              questionId,
              attempt.answers[questionId] ?? [],
            )
              ? this.examQuestionScore(exam, questionId)
              : 0,
            maxScore: this.examQuestionScore(exam, questionId),
          })),
          regradeRequest: this.regradeRequests.find(
            (request) =>
              request.attemptId === attempt.id &&
              request.learnerId === learnerId,
          ),
        };
      });
  }

  /** Trả đúng kết quả thuộc học viên, từ chối truy cập chéo lượt thi. */
  async getLearnerResult(
    attemptId: string,
    learnerId = "usr-learner",
  ): Promise<LearnerResult> {
    const result = (await this.listLearnerResults(learnerId)).find(
      (item) => item.attempt.id === attemptId,
    );
    if (!result)
      throw new NotFoundException(
        "Kết quả chưa được công bố hoặc không thuộc học viên hiện tại.",
      );
    return result;
  }

  /** Mở yêu cầu phúc khảo duy nhất cho lượt đã chấm và thông báo giảng viên. */
  async requestRegrade(
    attemptId: string,
    reason: string,
    learnerId = "usr-learner",
  ): Promise<RegradeRequest> {
    const normalizedReason = reason.trim();
    if (normalizedReason.length < 10)
      throw new BadRequestException("Lý do phúc khảo cần ít nhất 10 ký tự.");
    const prisma = this.database();
    if (prisma) {
      const attempt = await prisma.examAttempt.findFirst({
        where: {
          id: attemptId,
          learnerId,
          status: "GRADED",
          gradePublishedAt: { not: null },
        },
        include: {
          regradeRequests: {
            where: { learnerId, status: { in: ["OPEN", "IN_REVIEW"] } },
          },
        },
      });
      if (!attempt?.gradePublishedAt)
        throw new NotFoundException(
          "Không tìm thấy kết quả được phép phúc khảo.",
        );
      if (Date.now() > attempt.gradePublishedAt.getTime() + 7 * 86_400_000)
        throw new BadRequestException("Đã hết hạn phúc khảo 7 ngày.");
      if (attempt.regradeRequests.length)
        throw new ConflictException("Đã có yêu cầu phúc khảo đang được xử lý.");
      return this.mapRegradeRequest(
        await prisma.regradeRequest.create({
          data: {
            id: id("regrade"),
            attemptId,
            learnerId,
            reason: normalizedReason,
          },
        }),
      );
    }
    const attempt = this.attempts.find(
      (item) =>
        item.id === attemptId &&
        item.learnerId === learnerId &&
        item.status === "GRADED" &&
        item.gradePublishedAt,
    );
    if (!attempt?.gradePublishedAt)
      throw new NotFoundException(
        "Không tìm thấy kết quả được phép phúc khảo.",
      );
    if (
      Date.now() >
      new Date(attempt.gradePublishedAt).getTime() + 7 * 86_400_000
    )
      throw new BadRequestException("Đã hết hạn phúc khảo 7 ngày.");
    if (
      this.regradeRequests.some(
        (item) =>
          item.attemptId === attemptId &&
          ["OPEN", "IN_REVIEW"].includes(item.status),
      )
    )
      throw new ConflictException("Đã có yêu cầu phúc khảo đang được xử lý.");
    const request: RegradeRequest = {
      id: id("regrade"),
      attemptId,
      learnerId,
      reason: normalizedReason,
      status: "OPEN",
      createdAt: now(),
    };
    this.regradeRequests.unshift(request);
    return { ...request };
  }

  /** Liệt kê hàng đợi phúc khảo trong đúng phạm vi lớp của giảng viên. */
  async listRegradeRequests(
    actorId = "usr-instructor",
    status?: RegradeRequest["status"],
  ): Promise<RegradeRequest[]> {
    const allowed = ["OPEN", "IN_REVIEW", "RESOLVED", "REJECTED"] as const;
    if (status && !allowed.includes(status))
      throw new BadRequestException("Trạng thái phúc khảo không hợp lệ.");
    const prisma = this.database();
    if (prisma) {
      const rows = await prisma.regradeRequest.findMany({
        where: {
          status,
          attempt: {
            exam: {
              class: { instructors: { some: { instructorId: actorId } } },
            },
          },
        },
        orderBy: { createdAt: "asc" },
      });
      return rows.map((row) => this.mapRegradeRequest(row));
    }
    const allowedAttemptIds = new Set(
      this.attempts
        .filter((attempt) =>
          this.findClass(
            this.findExam(attempt.examId).classId,
          ).instructorIds.includes(actorId),
        )
        .map((attempt) => attempt.id),
    );
    return this.regradeRequests
      .filter(
        (request) =>
          allowedAttemptIds.has(request.attemptId) &&
          (!status || request.status === status),
      )
      .map((request) => ({ ...request }));
  }

  /** Nhận xử lý một yêu cầu OPEN bằng cập nhật có điều kiện để chống hai người cùng nhận. */
  async claimRegrade(
    requestId: string,
    actorId = "usr-instructor",
  ): Promise<RegradeRequest> {
    const prisma = this.database();
    if (prisma) {
      const request = await prisma.regradeRequest.findFirst({
        where: {
          id: requestId,
          attempt: {
            exam: {
              class: { instructors: { some: { instructorId: actorId } } },
            },
          },
        },
      });
      if (!request)
        throw new NotFoundException(
          "Không tìm thấy yêu cầu phúc khảo được phép xử lý.",
        );
      const claimed = await prisma.regradeRequest.updateMany({
        where: { id: requestId, status: "OPEN" },
        data: { status: "IN_REVIEW", assignedToId: actorId },
      });
      if (claimed.count !== 1)
        throw new ConflictException(
          "Yêu cầu phúc khảo đã được người khác nhận hoặc đã kết thúc.",
        );
      const updated = await prisma.regradeRequest.findUniqueOrThrow({
        where: { id: requestId },
      });
      return this.mapRegradeRequest(updated);
    }
    const request = this.regradeRequests.find((item) => item.id === requestId);
    if (
      !request ||
      !this.findClass(
        this.findExam(this.findAttempt(request.attemptId).examId).classId,
      ).instructorIds.includes(actorId)
    )
      throw new NotFoundException(
        "Không tìm thấy yêu cầu phúc khảo được phép xử lý.",
      );
    if (request.status !== "OPEN")
      throw new ConflictException(
        "Yêu cầu phúc khảo đã được người khác nhận hoặc đã kết thúc.",
      );
    request.status = "IN_REVIEW";
    request.assignedToId = actorId;
    return { ...request };
  }

  /** Kết thúc yêu cầu đã nhận; nếu chấp thuận thì sửa điểm qua cùng cơ chế lịch sử chấm. */
  async resolveRegrade(
    requestId: string,
    input: {
      decision: "APPROVE" | "REJECT";
      resolution: string;
      score?: number;
      feedback?: string;
      questionScores?: Array<{ questionId: string; score: number }>;
    },
    actorId = "usr-instructor",
  ): Promise<RegradeRequest> {
    const resolution = input.resolution.trim();
    if (resolution.length < 5)
      throw new BadRequestException("Kết luận phúc khảo cần ít nhất 5 ký tự.");
    const prisma = this.database();
    if (prisma) {
      const request = await prisma.regradeRequest.findFirst({
        where: {
          id: requestId,
          assignedToId: actorId,
          status: "IN_REVIEW",
          attempt: {
            exam: {
              class: { instructors: { some: { instructorId: actorId } } },
            },
          },
        },
      });
      if (!request)
        throw new NotFoundException(
          "Không tìm thấy yêu cầu phúc khảo đang được bạn xử lý.",
        );
      if (input.decision === "APPROVE") {
        if (input.score === undefined)
          throw new BadRequestException("Cần nhập điểm sau phúc khảo.");
        await this.gradeAttempt(
          request.attemptId,
          input.score,
          input.feedback ?? resolution,
          `Phúc khảo: ${resolution}`,
          actorId,
          input.questionScores,
        );
      }
      const nextStatus = input.decision === "APPROVE" ? "RESOLVED" : "REJECTED";
      const updated = await prisma.$transaction(async (transaction) => {
        const changed = await transaction.regradeRequest.updateMany({
          where: { id: requestId, status: "IN_REVIEW", assignedToId: actorId },
          data: {
            status: nextStatus,
            resolution,
            resolvedById: actorId,
            resolvedAt: new Date(),
          },
        });
        if (changed.count !== 1)
          throw new ConflictException(
            "Trạng thái phúc khảo đã thay đổi; hãy tải lại hàng đợi.",
          );
        await transaction.notification.upsert({
          where: { dedupKey: `regrade-resolved:${requestId}` },
          update: {
            title:
              input.decision === "APPROVE"
                ? "Phúc khảo đã hoàn tất và điểm đã được cập nhật"
                : "Yêu cầu phúc khảo không được chấp thuận",
            readAt: null,
            createdAt: new Date(),
          },
          create: {
            id: id("notification"),
            recipientId: request.learnerId,
            type: "REGRADE_RESOLVED",
            title:
              input.decision === "APPROVE"
                ? "Phúc khảo đã hoàn tất và điểm đã được cập nhật"
                : "Yêu cầu phúc khảo không được chấp thuận",
            entityType: "EXAM_ATTEMPT",
            entityId: request.attemptId,
            dedupKey: `regrade-resolved:${requestId}`,
          },
        });
        return transaction.regradeRequest.findUniqueOrThrow({
          where: { id: requestId },
        });
      });
      return this.mapRegradeRequest(updated);
    }
    const request = this.regradeRequests.find(
      (item) =>
        item.id === requestId &&
        item.assignedToId === actorId &&
        item.status === "IN_REVIEW",
    );
    if (!request)
      throw new NotFoundException(
        "Không tìm thấy yêu cầu phúc khảo đang được bạn xử lý.",
      );
    if (input.decision === "APPROVE") {
      if (input.score === undefined)
        throw new BadRequestException("Cần nhập điểm sau phúc khảo.");
      await this.gradeAttempt(
        request.attemptId,
        input.score,
        input.feedback ?? resolution,
        `Phúc khảo: ${resolution}`,
        actorId,
        input.questionScores,
      );
    }
    request.status = input.decision === "APPROVE" ? "RESOLVED" : "REJECTED";
    request.resolution = resolution;
    request.resolvedById = actorId;
    request.resolvedAt = now();
    this.notifications.unshift({
      id: id("notification"),
      recipientId: request.learnerId,
      type: "REGRADE_RESOLVED",
      title:
        input.decision === "APPROVE"
          ? "Phúc khảo đã hoàn tất và điểm đã được cập nhật"
          : "Yêu cầu phúc khảo không được chấp thuận",
      entityType: "EXAM_ATTEMPT",
      entityId: request.attemptId,
      createdAt: now(),
    });
    return { ...request };
  }

  /** Liệt kê lượt thi trong phạm vi lớp giảng viên phụ trách. */
  async listAttempts(
    examId?: string,
    actorId = "usr-instructor",
  ): Promise<ExamAttempt[]> {
    const prisma = this.database();
    if (prisma) {
      const rows = await prisma.examAttempt.findMany({
        where: {
          examId: examId || undefined,
          exam: { class: { instructors: { some: { instructorId: actorId } } } },
        },
        include: { answers: true },
        orderBy: { startedAt: "desc" },
      });
      return rows.map((row) => this.mapAttempt(row));
    }
    return this.attempts
      .filter(
        (item) =>
          (!examId || item.examId === examId) &&
          this.findClass(
            this.findExam(item.examId).classId,
          ).instructorIds.includes(actorId),
      )
      .map((item) => ({ ...item, answers: { ...item.answers } }));
  }

  /** Thu thập tối đa sáu tệp đã công khai trong các lớp cùng môn mà giảng viên được phân công. */
  async getExamGenerationContext(
    classId: string,
    actorId = "usr-instructor",
    rawMaterialIds: string[] = [],
    skipMaterials = false,
  ): Promise<ExamGenerationContext> {
    const supportedMimeTypes = [
      "application/pdf",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "image/png",
      "image/jpeg",
    ];
    const materialIds = [...new Set(rawMaterialIds)];
    if (materialIds.length !== rawMaterialIds.length)
      throw new BadRequestException(
        "Danh sách tài liệu ngữ cảnh không được trùng.",
      );
    const maxTotalBytes = 24 * 1024 * 1024;
    const prisma = this.database();
    if (prisma) {
      const classItem = await prisma.learningClass.findFirst({
        where: {
          id: classId,
          instructors: { some: { instructorId: actorId } },
        },
        include: { course: true },
      });
      if (!classItem)
        throw new NotFoundException("Không tìm thấy lớp học được phép tạo đề.");
      if (classItem.status === "CLOSED")
        throw new ConflictException("Lớp đã lưu trữ và chỉ cho phép đọc.");
      const courseSnapshot = await prisma.courseVersion.findUnique({
        where: {
          courseId_version: {
            courseId: classItem.courseId,
            version: classItem.courseVersion,
          },
        },
      });
      if (!courseSnapshot)
        throw new ConflictException(
          "Không tìm thấy phiên bản khóa học đã ghim cho lớp.",
        );
      if (skipMaterials) return { courseId: classItem.courseId, courseName: courseSnapshot.name, courseDescription: courseSnapshot.description, sourceFiles: [] };
      const materials = await prisma.material.findMany({
        where: {
          id: materialIds.length ? { in: materialIds } : undefined,
          visibility: "PUBLISHED",
          quarantinedAt: null,
          mimeType: { in: supportedMimeTypes },
          sizeBytes: { lte: BigInt(12 * 1024 * 1024) },
          class: {
            courseId: classItem.courseId,
            instructors: { some: { instructorId: actorId } },
          },
        },
        orderBy: { updatedAt: "desc" },
        take: 12,
        select: {
          id: true,
          name: true,
          mimeType: true,
          sizeBytes: true,
          objectKey: true,
        },
      });
      if (materialIds.length && materials.length !== materialIds.length)
        throw new BadRequestException(
          "Một hoặc nhiều tài liệu đã chọn không hợp lệ, chưa phát hành hoặc ngoài phạm vi giảng dạy.",
        );
      const sourceFiles: ExamSourceFile[] = [];
      let totalBytes = 0;
      for (const material of materials) {
        const size = Number(material.sizeBytes);
        if (sourceFiles.length >= 6 || totalBytes + size > maxTotalBytes) {
          if (materialIds.length) throw new BadRequestException("Tài liệu đã chọn vượt giới hạn 6 tệp hoặc tổng 24 MB. Hãy giảm số tệp.");
          continue;
        }
        try {
          const buffer = await this.readStoredFile(material.objectKey);
          sourceFiles.push({
            id: material.id,
            name: normalizeMultipartFileName(material.name),
            mimeType: material.mimeType,
            buffer,
          });
          totalBytes += buffer.length;
        } catch {
          throw new ServiceUnavailableException(
            `Không đọc được tài liệu ngữ cảnh: ${material.name}. Hãy kiểm tra tệp trước khi tạo đề.`,
          );
        }
      }
      return {
        courseId: classItem.courseId,
        courseName: courseSnapshot.name,
        courseDescription: courseSnapshot.description,
        sourceFiles,
      };
    }
    const classItem = this.findClass(classId);
    if (!classItem.instructorIds.includes(actorId))
      throw new NotFoundException("Không tìm thấy lớp học được phép tạo đề.");
    if (classItem.status === "CLOSED")
      throw new ConflictException("Lớp đã lưu trữ và chỉ cho phép đọc.");
    const course = this.courseVersions.find(
      (item) =>
        item.courseId === classItem.courseId &&
        item.version === classItem.courseVersion,
    );
    if (!course)
      throw new ConflictException(
        "Không tìm thấy phiên bản khóa học đã ghim cho lớp.",
      );
    if (skipMaterials) return { courseId: classItem.courseId, courseName: course.name, courseDescription: course.description, sourceFiles: [] };
    const sourceFiles: ExamSourceFile[] = [];
    let totalBytes = 0;
    const eligibleMaterials = this.materials.filter(
      (item) =>
        (!materialIds.length || materialIds.includes(item.id)) &&
        item.visibility === "PUBLISHED" &&
        !item.quarantinedAt &&
        supportedMimeTypes.includes(item.mimeType),
    );
    if (materialIds.length && eligibleMaterials.length !== materialIds.length)
      throw new BadRequestException(
        "Một hoặc nhiều tài liệu đã chọn không hợp lệ, chưa phát hành hoặc ngoài phạm vi giảng dạy.",
      );
    for (const material of eligibleMaterials) {
      const relatedClass = this.classes.find(
        (item) => item.id === material.classId,
      );
      const stored = this.materialFiles.get(material.id);
      if (
        !relatedClass ||
        relatedClass.courseId !== course.id ||
        !relatedClass.instructorIds.includes(actorId) ||
        !stored
      )
        continue;
      try {
        const buffer = await this.readStoredFile(stored.objectKey);
        if (
          sourceFiles.length >= 6 ||
          totalBytes + buffer.length > maxTotalBytes
        )
          continue;
        sourceFiles.push({
          id: material.id,
          name: material.name,
          mimeType: material.mimeType,
          buffer,
        });
        totalBytes += buffer.length;
      } catch {
        throw new ServiceUnavailableException(
          `Không đọc được tài liệu ngữ cảnh: ${material.name}. Hãy kiểm tra tệp trước khi tạo đề.`,
        );
      }
    }
    if (materialIds.length && sourceFiles.length !== materialIds.length)
      throw new BadRequestException(
        "Một hoặc nhiều tài liệu đã chọn không thuộc môn học, ngoài phạm vi giảng dạy hoặc không còn tệp lưu trữ.",
      );
    return {
      courseId: classItem.courseId,
      courseName: course.name,
      courseDescription: course.description,
      sourceFiles,
    };
  }

  /** Tìm đề đã hoàn tất theo khóa idempotency trước khi gọi lại provider AI. */
  async getGeneratedExamByRequest(clientRequestId: string, classId: string, actorId = "usr-instructor"): Promise<LearningExam | undefined> {
    const prisma = this.database();
    if (!prisma) return undefined;
    const row = await prisma.exam.findFirst({ where: { generationRequestId: clientRequestId, classId, class: { instructors: { some: { instructorId: actorId } } } }, include: { questions: { orderBy: { position: "asc" } } } });
    return row ? this.mapExam(row) : undefined;
  }

  /** Lưu câu hỏi AI đã chuẩn hóa và đề nháp trong một giao dịch, tái dùng câu trùng đã xuất bản. */
  async createGeneratedExam(
    input: Omit<LearningExam, "id" | "status" | "version" | "questionIds">,
    questions: ScannedQuestionDraft[],
    courseId: string,
    generationContext: {
      mode: "COURSE_MATERIALS" | "WEB_SEARCH";
      materialIds: string[];
      sources: Array<{ title: string; url: string }>;
      providerId?: string;
      provider?: string;
      model?: string;
      warnings?: string[];
    },
    clientRequestId: string = randomUUID(),
    actorId = "usr-instructor",
  ): Promise<LearningExam> {
    if (new Date(input.closeAt) <= new Date(input.openAt))
      throw new BadRequestException("Thời gian đóng đề phải sau thời gian mở.");
    if (!questions.length || questions.length > 50)
      throw new BadRequestException("Đề AI cần từ 1 đến 50 câu hỏi.");
    const sourceTag =
      generationContext.mode === "COURSE_MATERIALS"
        ? "nguồn-tài-liệu"
        : "nguồn-web";
    const normalizedQuestions = questions.map((question) =>
      this.validateQuestionInput({
        courseId,
        type: question.type,
        content: question.content,
        options: question.options,
        correctAnswers: question.correctAnswers,
        difficulty: question.difficulty,
        tags: [...new Set([...question.tags, "ai-generated", sourceTag])],
      }),
    );
    const generatedContentHashes = normalizedQuestions.map((question) =>
      this.questionContentHash(question.content),
    );
    if (
      new Set(generatedContentHashes).size !== generatedContentHashes.length
    ) {
      throw new ConflictException(
        "AI tạo câu hỏi trùng nhau; hãy tạo lại với trọng tâm cụ thể hơn.",
      );
    }
    const prisma = this.database();
    if (prisma) {
      return prisma.$transaction(async (transaction) => {
        const classItem = await transaction.learningClass.findFirst({
          where: {
            id: input.classId,
            courseId,
            instructors: { some: { instructorId: actorId } },
          },
        });
        if (!classItem)
          throw new NotFoundException(
            "Không tìm thấy lớp học được phép tạo đề.",
          );
        // Idempotency replays still require current access to the same class and course.
        const existingExam = await transaction.exam.findUnique({ where: { generationRequestId: clientRequestId }, include: { questions: { orderBy: { position: "asc" } } } });
        if (existingExam) {
          if (existingExam.classId !== input.classId) throw new ConflictException("Mã yêu cầu AI đã được dùng cho lớp khác.");
          return this.mapExam(existingExam);
        }
        if (classItem.status === "CLOSED")
          throw new ConflictException("Lớp đã lưu trữ và chỉ cho phép đọc.");
        const questionIds: string[] = [];
        for (const question of normalizedQuestions) {
          const contentHash = this.questionContentHash(question.content);
          const candidates = await transaction.question.findMany({
            where: { courseId, contentHash, status: "PUBLISHED", type: question.type, difficulty: question.difficulty, imageObjectKey: null },
            orderBy: { version: "desc" },
          });
          const existing = candidates.find((candidate) => this.sameGeneratedQuestion(candidate, question));
          if (existing) {
            questionIds.push(existing.id);
            continue;
          }
          const questionId = id("question");
          await transaction.question.create({
            data: {
              id: questionId,
              familyId: questionId,
              contentHash,
              courseId,
              authorId: actorId,
              type: question.type,
              content: question.content,
              options: question.options,
              correctAnswers: question.correctAnswers,
              difficulty: question.difficulty,
              tags: question.tags,
              status: "DRAFT",
            },
          });
          questionIds.push(questionId);
        }
        const exam = await transaction.exam.create({
          data: {
            id: id("exam"),
            classId: input.classId,
            title: input.title.trim(),
            durationMinutes: input.durationMinutes,
            totalScore: input.totalScore,
            openAt: new Date(input.openAt),
            closeAt: new Date(input.closeAt),
            attemptLimit: input.attemptLimit,
            shuffleQuestions: input.shuffleQuestions ?? false,
            randomSeed: input.randomSeed?.trim(),
            aiContext: generationContext,
            generationRequestId: clientRequestId,
          },
        });
        const questionScores = this.resolveExamScoreAllocations(
          questionIds,
          input.totalScore,
        );
        await transaction.examQuestion.createMany({
          data: questionIds.map((questionId, position) => ({
            examId: exam.id,
            questionId,
            position: position + 1,
            score: questionScores[questionId]!,
          })),
        });
        await transaction.auditLog.create({
          data: {
            actorId,
            action: "AI_EXAM_DRAFT_CREATED",
            entityType: "exam",
            entityId: exam.id,
            context: {
              courseId,
              questionCount: questionIds.length,
              contextMode: generationContext.mode,
              materialIds: generationContext.materialIds,
              sources: generationContext.sources,
            },
          },
        });
        return this.getDatabaseExam(transaction, exam.id);
      });
    }
    const classItem = this.findClass(input.classId);
    if (
      !classItem.instructorIds.includes(actorId) ||
      classItem.courseId !== courseId
    )
      throw new NotFoundException("Không tìm thấy lớp học được phép tạo đề.");
    if (classItem.status === "CLOSED")
      throw new ConflictException("Lớp đã lưu trữ và chỉ cho phép đọc.");
    const questionIds = normalizedQuestions.map((question) => {
      const contentHash = this.questionContentHash(question.content);
      const existing = this.questions.find(
        (item) =>
          item.courseId === courseId &&
          item.status === "PUBLISHED" &&
          this.questionContentHash(item.content) === contentHash &&
          !item.imageUrl && !item.imageName && this.sameGeneratedQuestion(item, question),
      );
      if (existing) return existing.id;
      const questionId = id("question");
      this.questions.unshift({
        ...question,
        id: questionId,
        familyId: questionId,
        status: "DRAFT",
        version: 1,
      });
      return questionId;
    });
    const questionScores = this.resolveExamScoreAllocations(
      questionIds,
      input.totalScore,
    );
    const exam: LearningExam = {
      ...input,
      questionIds,
      questionScores,
      aiContext: structuredClone(generationContext),
      id: id("exam"),
      status: "DRAFT",
      version: 1,
    };
    this.exams.unshift(exam);
    return { ...exam, questionIds: [...exam.questionIds] };
  }

  /** Trả đầy đủ đề, bài làm và điểm từng câu sau khi xác minh phạm vi giảng viên. */
  async getAttemptReview(
    attemptId: string,
    actorId = "usr-instructor",
  ): Promise<ExamAttemptReview> {
    const prisma = this.database();
    if (prisma) {
      const row = await prisma.examAttempt.findFirst({
        where: {
          id: attemptId,
          exam: { class: { instructors: { some: { instructorId: actorId } } } },
        },
        include: {
          learner: { select: { displayName: true, email: true } },
          answers: true,
          exam: {
            include: {
              questions: {
                include: { question: true },
                orderBy: { position: "asc" },
              },
            },
          },
        },
      });
      if (!row)
        throw new NotFoundException("Không tìm thấy bài làm được phép xem.");
      return {
        attempt: this.mapAttempt(row),
        exam: {
          id: row.exam.id,
          classId: row.exam.classId,
          title: row.exam.title,
          totalScore: Number(row.exam.totalScore),
        },
        learner: {
          id: row.learnerId,
          name: row.learner.displayName,
          email: row.learner.email,
        },
        questions: row.exam.questions.map((examQuestion) => {
          const answer = row.answers.find(
            (item) => item.questionId === examQuestion.questionId,
          );
          const question = this.mapQuestion(examQuestion.question);
          return {
            questionId: examQuestion.questionId,
            type: question.type,
            content: question.content,
            imageUrl: question.imageUrl,
            submittedAnswers: this.toStringArray(answer?.answerData ?? []),
            awardedScore: Number(answer?.score ?? 0),
            maxScore: Number(examQuestion.score),
            requiresManualGrade: ["SHORT_ANSWER", "ESSAY"].includes(
              question.type,
            ),
          };
        }),
      };
    }
    const attempt = this.findAttempt(attemptId);
    const exam = this.findExam(attempt.examId);
    if (!this.findClass(exam.classId).instructorIds.includes(actorId))
      throw new NotFoundException("Không tìm thấy bài làm được phép xem.");
    return {
      attempt: { ...attempt, answers: structuredClone(attempt.answers) },
      exam: {
        id: exam.id,
        classId: exam.classId,
        title: exam.title,
        totalScore: exam.totalScore,
      },
      learner: { id: attempt.learnerId },
      questions: exam.questionIds.map((questionId) => {
        const question = this.questions.find((item) => item.id === questionId)!;
        return {
          questionId,
          type: question.type,
          content: question.content,
          imageUrl: question.imageUrl,
          submittedAnswers: [...(attempt.answers[questionId] ?? [])],
          awardedScore: 0,
          maxScore: this.examQuestionScore(exam, questionId),
          requiresManualGrade: ["SHORT_ANSWER", "ESSAY"].includes(
            question.type,
          ),
        };
      }),
    };
  }

  /** Ghi điểm thủ công/hiệu chỉnh, bắt buộc lý do khi đổi điểm và lưu grade history. */
  async gradeAttempt(
    attemptId: string,
    score: number,
    feedback: string,
    correctionReason?: string,
    graderId = "usr-instructor",
    questionScores?: Array<{ questionId: string; score: number }>,
  ): Promise<ExamAttempt> {
    const prisma = this.database();
    if (prisma) {
      const attempt = await prisma.examAttempt.findFirst({
        where: {
          id: attemptId,
          exam: {
            class: { instructors: { some: { instructorId: graderId } } },
          },
        },
        include: {
          answers: true,
          exam: { include: { questions: { include: { question: true } } } },
        },
      });
      if (!attempt)
        throw new NotFoundException(
          "Không tìm thấy lượt làm bài được phép chấm.",
        );
      let nextScore = score;
      if (questionScores) {
        const manualQuestions = attempt.exam.questions.filter((item) =>
          ["SHORT_ANSWER", "ESSAY"].includes(item.question.type),
        );
        if (
          questionScores.length !== manualQuestions.length ||
          new Set(questionScores.map((item) => item.questionId)).size !==
            manualQuestions.length
        )
          throw new BadRequestException(
            "Cần nhập đúng một điểm cho từng câu tự luận hoặc trả lời ngắn.",
          );
        for (const item of questionScores) {
          const question = manualQuestions.find(
            (candidate) => candidate.questionId === item.questionId,
          );
          if (!question || item.score > Number(question.score))
            throw new BadRequestException(
              "Điểm từng câu phải nằm trong thang điểm của câu hỏi.",
            );
        }
        const objectiveQuestionIds = new Set(
          attempt.exam.questions
            .filter(
              (item) => !["SHORT_ANSWER", "ESSAY"].includes(item.question.type),
            )
            .map((item) => item.questionId),
        );
        const objectiveScore = attempt.answers
          .filter((item) => objectiveQuestionIds.has(item.questionId))
          .reduce((total, item) => total + Number(item.score ?? 0), 0);
        nextScore =
          objectiveScore +
          questionScores.reduce((total, item) => total + item.score, 0);
      }
      if (nextScore > Number(attempt.exam.totalScore))
        throw new BadRequestException("Điểm không được vượt tổng điểm của đề.");
      const isFirstPublishedGrade =
        attempt.status === "SUBMITTED" && attempt.gradePublishedAt === null;
      const reason = isFirstPublishedGrade
        ? "Chấm lần đầu"
        : correctionReason?.trim();
      if (!isFirstPublishedGrade && (!reason || reason.length < 5))
        throw new BadRequestException("Sửa điểm cần lý do ít nhất 5 ký tự.");
      return prisma.$transaction(async (transaction) => {
        if (questionScores)
          await Promise.all(
            questionScores.map((item) =>
              transaction.attemptAnswer.upsert({
                where: {
                  attemptId_questionId: {
                    attemptId,
                    questionId: item.questionId,
                  },
                },
                update: { score: item.score },
                create: {
                  attemptId,
                  questionId: item.questionId,
                  answerData: [],
                  score: item.score,
                },
              }),
            ),
          );
        await transaction.gradeHistory.create({
          data: {
            id: id("grade-history"),
            attemptId,
            graderId,
            previousScore: attempt.score,
            nextScore,
            reason: reason!,
          },
        });
        return this.mapAttempt(
          await transaction.examAttempt.update({
            where: { id: attemptId },
            data: {
              score: nextScore,
              feedback: feedback.trim(),
              status: "GRADED",
              gradePublishedAt: new Date(),
            },
            include: { answers: true },
          }),
        );
      });
    }
    const item = this.findAttempt(attemptId);
    const exam = this.findExam(item.examId);
    if (!this.findClass(exam.classId).instructorIds.includes(graderId))
      throw new NotFoundException(
        "Không tìm thấy lượt làm bài được phép chấm.",
      );
    if (questionScores) {
      const manualQuestions = exam.questionIds
        .map(
          (questionId) =>
            this.questions.find((question) => question.id === questionId)!,
        )
        .filter((question) =>
          ["SHORT_ANSWER", "ESSAY"].includes(question.type),
        );
      if (
        questionScores.length !== manualQuestions.length ||
        new Set(questionScores.map((entry) => entry.questionId)).size !==
          manualQuestions.length
      )
        throw new BadRequestException(
          "Cần nhập đúng một điểm cho từng câu tự luận hoặc trả lời ngắn.",
        );
      for (const entry of questionScores)
        if (
          !manualQuestions.some(
            (question) => question.id === entry.questionId,
          ) ||
          entry.score > this.examQuestionScore(exam, entry.questionId)
        )
          throw new BadRequestException(
            "Điểm từng câu phải nằm trong thang điểm của câu hỏi.",
          );
      const objectiveScore = exam.questionIds
        .filter(
          (questionId) =>
            !manualQuestions.some((question) => question.id === questionId) &&
            this.isMemoryAnswerCorrect(
              questionId,
              item.answers[questionId] ?? [],
            ),
        )
        .reduce(
          (total, questionId) =>
            total + this.examQuestionScore(exam, questionId),
          0,
        );
      score =
        objectiveScore +
        questionScores.reduce((total, entry) => total + entry.score, 0);
    }
    if (score > exam.totalScore)
      throw new BadRequestException("Điểm không được vượt tổng điểm của đề.");
    const isFirstPublishedGrade =
      item.status === "SUBMITTED" && !item.gradePublishedAt;
    const reason = isFirstPublishedGrade
      ? "Chấm lần đầu"
      : correctionReason?.trim();
    if (!isFirstPublishedGrade && (!reason || reason.length < 5))
      throw new BadRequestException("Sửa điểm cần lý do ít nhất 5 ký tự.");
    this.gradeHistory.unshift({
      id: id("grade-history"),
      attemptId,
      graderId,
      previousScore: item.score,
      nextScore: score,
      reason: reason!,
      createdAt: now(),
    });
    item.score = score;
    item.feedback = feedback.trim();
    item.status = "GRADED";
    item.gradePublishedAt = now();
    return { ...item, answers: { ...item.answers } };
  }

  /** Kiểm tra phạm vi giảng dạy rồi trả lịch sử các lần thay đổi điểm. */
  async listGradeHistory(
    attemptId: string,
    actorId = "usr-instructor",
  ): Promise<GradeHistoryRecord[]> {
    const prisma = this.database();
    if (prisma) {
      const allowed = await prisma.examAttempt.findFirst({
        where: {
          id: attemptId,
          exam: { class: { instructors: { some: { instructorId: actorId } } } },
        },
        select: { id: true },
      });
      if (!allowed)
        throw new NotFoundException(
          "Không tìm thấy lịch sử chấm được phép xem.",
        );
      const rows = await prisma.gradeHistory.findMany({
        where: { attemptId },
        orderBy: { createdAt: "desc" },
      });
      return rows.map((row) => ({
        id: row.id,
        attemptId: row.attemptId,
        graderId: row.graderId,
        previousScore:
          row.previousScore === null ? undefined : Number(row.previousScore),
        nextScore: Number(row.nextScore),
        reason: row.reason,
        createdAt: row.createdAt.toISOString(),
      }));
    }
    const attempt = this.findAttempt(attemptId);
    if (
      !this.findClass(
        this.findExam(attempt.examId).classId,
      ).instructorIds.includes(actorId)
    )
      throw new NotFoundException("Không tìm thấy lịch sử chấm được phép xem.");
    return this.gradeHistory
      .filter((item) => item.attemptId === attemptId)
      .map((item) => ({ ...item }));
  }

  /** Liệt kê chủ đề theo lớp truy cập được, ưu tiên chủ đề ghim rồi mới theo cập nhật. */
  async listTopics(
    role = "LEARNER",
    actorId = this.userIdForRole(role),
  ): Promise<ForumTopic[]> {
    const prisma = this.database();
    if (prisma) {
      const rows = await prisma.forumTopic.findMany({
        where:
          role === "LEARNER"
            ? {
                status: "PUBLISHED",
                class: {
                  enrollments: {
                    some: { learnerId: actorId, status: "ACTIVE" },
                  },
                },
              }
            : role === "INSTRUCTOR"
              ? { class: { instructors: { some: { instructorId: actorId } } } }
              : undefined,
        orderBy: [{ isPinned: "desc" }, { createdAt: "desc" }],
      });
      return rows.map((row) => this.mapTopic(row));
    }
    return this.topics
      .filter((item) => {
        const classItem = this.classes.find(
          (candidate) => candidate.id === item.classId,
        );
        if (role === "LEARNER")
          return (
            item.status === "VISIBLE" && classItem?.learnerIds.includes(actorId)
          );
        if (role === "INSTRUCTOR")
          return classItem?.instructorIds.includes(actorId);
        return true;
      })
      .map((item) => ({ ...item, tags: [...item.tags] }));
  }

  /** Kiểm tra thành viên/chính sách nội dung rồi tạo chủ đề và thông báo thành viên lớp. */
  async createTopic(
    classId: string,
    input: Pick<ForumTopic, "title" | "body" | "tags" | "isPinned">,
    authorId = "usr-instructor",
    authorRole = authorId === "usr-learner" ? "LEARNER" : "INSTRUCTOR",
  ): Promise<ForumTopic> {
    const safeTitle = this.validateForumContent(input.title, "Tiêu đề");
    const safeBody = this.validateForumContent(input.body, "Nội dung");
    const prisma = this.database();
    if (prisma) {
      const classItem = await prisma.learningClass.findUnique({
        where: { id: classId },
        include: { enrollments: true, instructors: true },
      });
      if (!classItem) throw new NotFoundException("Không tìm thấy lớp học.");
      if (classItem.status === "CLOSED")
        throw new ConflictException("Lớp đã lưu trữ và chỉ cho phép đọc.");
      if (
        authorRole === "LEARNER" &&
        !classItem.enrollments.some(
          (item) => item.learnerId === authorId && item.status === "ACTIVE",
        )
      )
        throw new NotFoundException("Học viên không thuộc lớp này.");
      if (
        authorRole === "INSTRUCTOR" &&
        !classItem.instructors.some((item) => item.instructorId === authorId)
      )
        throw new NotFoundException(
          "Giảng viên chưa được phân công vào lớp này.",
        );
      const moderationStatus = await this.enforceForumPolicy(
        prisma,
        authorId,
        `${safeTitle} ${safeBody}`,
      );
      const created = await prisma.$transaction(async (transaction) => {
        const topic = await transaction.forumTopic.create({
          data: {
            id: id("topic"),
            classId,
            authorId,
            title: safeTitle,
            body: safeBody,
            tags: input.tags,
            isPinned: input.isPinned,
            status:
              moderationStatus === "HIDE_PENDING_REVIEW"
                ? "PENDING_REVIEW"
                : "PUBLISHED",
          },
        });
        if (moderationStatus)
          await transaction.contentReport.create({
            data: {
              id: id("report"),
              targetType: "TOPIC",
              targetId: topic.id,
              reporterId: authorId,
              reason: "AUTO_MODERATION",
              details: "Nội dung khớp chính sách kiểm duyệt đang hiệu lực.",
            },
          });
        return topic;
      });
      if (created.status === "PUBLISHED")
        await this.notifyClassMembers(
          prisma,
          classId,
          "FORUM_TOPIC_CREATED",
          `Chủ đề mới: ${created.title}`,
          created.id,
        );
      return this.mapTopic(created);
    }
    const classItem = this.findClass(classId);
    if (classItem.status === "CLOSED")
      throw new ConflictException("Lớp đã lưu trữ và chỉ cho phép đọc.");
    if (authorRole === "LEARNER" && !classItem.learnerIds.includes(authorId))
      throw new NotFoundException("Học viên không thuộc lớp này.");
    if (
      authorRole === "INSTRUCTOR" &&
      !classItem.instructorIds.includes(authorId)
    )
      throw new NotFoundException(
        "Giảng viên chưa được phân công vào lớp này.",
      );
    const moderationStatus = await this.enforceMemoryForumPolicy(
      authorId,
      `${safeTitle} ${safeBody}`,
    );
    const item: ForumTopic = {
      ...input,
      title: safeTitle,
      body: safeBody,
      id: id("topic"),
      classId,
      authorId,
      isLocked: false,
      status: moderationStatus === "HIDE_PENDING_REVIEW" ? "HIDDEN" : "VISIBLE",
      createdAt: now(),
    };
    this.topics.unshift(item);
    if (moderationStatus)
      this.reports.unshift({
        id: id("report"),
        targetType: "TOPIC",
        targetId: item.id,
        reporterId: authorId,
        reason: "AUTO_MODERATION",
        details: "Nội dung khớp chính sách kiểm duyệt đang hiệu lực.",
        status: "OPEN",
        escalationLevel: 0,
        createdAt: now(),
        updatedAt: now(),
        actions: [],
      });
    for (const recipientId of new Set([
      ...classItem.learnerIds,
      ...classItem.instructorIds,
    ]))
      if (recipientId !== authorId)
        this.notifications.unshift({
          id: id("notification"),
          recipientId,
          type: "FORUM_TOPIC_CREATED",
          title: `Chủ đề mới: ${item.title}`,
          entityType: "FORUM_TOPIC",
          entityId: item.id,
          createdAt: now(),
        });
    return { ...item, tags: [...item.tags] };
  }

  /** Ghim hoặc khóa chủ đề với lý do bắt buộc và ghi audit người điều phối. */
  async moderateTopic(
    topicId: string,
    input: { isLocked?: boolean; isPinned?: boolean; reason: string },
    actorId = "usr-instructor",
  ): Promise<ForumTopic> {
    const reason = input.reason.trim();
    if (reason.length < 5)
      throw new BadRequestException("Lý do điều phối cần ít nhất 5 ký tự.");
    if (input.isLocked === undefined && input.isPinned === undefined)
      throw new BadRequestException(
        "Cần chọn trạng thái khóa hoặc ghim cần thay đổi.",
      );
    const prisma = this.database();
    if (prisma) {
      return prisma.$transaction(async (transaction) => {
        const current = await transaction.forumTopic.findFirst({
          where: {
            id: topicId,
            class: { instructors: { some: { instructorId: actorId } } },
          },
          include: { class: true },
        });
        if (!current)
          throw new NotFoundException(
            "Không tìm thấy chủ đề được phép điều phối.",
          );
        if (current.class.status === "CLOSED")
          throw new ConflictException("Lớp đã lưu trữ và chỉ cho phép đọc.");
        const updated = await transaction.forumTopic.update({
          where: { id: topicId },
          data: { isLocked: input.isLocked, isPinned: input.isPinned },
        });
        await transaction.auditLog.create({
          data: {
            actorId,
            action: "FORUM_TOPIC_MODERATED",
            entityType: "forum_topic",
            entityId: topicId,
            context: {
              reason,
              before: {
                isLocked: current.isLocked,
                isPinned: current.isPinned,
              },
              after: { isLocked: updated.isLocked, isPinned: updated.isPinned },
            },
          },
        });
        return this.mapTopic(updated);
      });
    }
    const current = this.findTopic(topicId);
    const classItem = this.findClass(current.classId);
    if (!classItem.instructorIds.includes(actorId))
      throw new NotFoundException("Không tìm thấy chủ đề được phép điều phối.");
    if (classItem.status === "CLOSED")
      throw new ConflictException("Lớp đã lưu trữ và chỉ cho phép đọc.");
    if (input.isLocked !== undefined) current.isLocked = input.isLocked;
    if (input.isPinned !== undefined) current.isPinned = input.isPinned;
    return { ...current, tags: [...current.tags] };
  }

  /** Kiểm tra quyền lớp rồi trả cây bài viết, ẩn nội dung đã xóa/kiểm duyệt phù hợp. */
  async listPosts(
    topicId: string,
    role = "LEARNER",
    actorId = this.userIdForRole(role),
  ): Promise<ForumPost[]> {
    const prisma = this.database();
    if (prisma) {
      const topic = await prisma.forumTopic.findUnique({
        where: { id: topicId },
        include: {
          class: { include: { enrollments: true, instructors: true } },
        },
      });
      if (!topic) throw new NotFoundException("Không tìm thấy chủ đề.");
      if (role === "LEARNER" && topic.status !== "PUBLISHED")
        throw new NotFoundException(
          "Không tìm thấy chủ đề trong lớp đã ghi danh.",
        );
      this.assertForumClassAccess(topic.class, role, actorId);
      const rows = await prisma.forumPost.findMany({
        where: { topicId },
        include: { attachments: true, mentions: true },
        orderBy: { createdAt: "asc" },
      });
      return rows.map((row) => this.mapPost(row));
    }
    const topic = this.findTopic(topicId);
    if (role === "LEARNER" && topic.status !== "VISIBLE")
      throw new NotFoundException(
        "Không tìm thấy chủ đề trong lớp đã ghi danh.",
      );
    this.assertMemoryForumClassAccess(topic.classId, role, actorId);
    return this.posts
      .filter((item) => item.topicId === topicId)
      .map((item) => ({
        ...item,
        body: item.status === "HIDDEN" ? "[Nội dung đã bị ẩn]" : item.body,
        attachmentIds: item.status === "HIDDEN" ? [] : [...item.attachmentIds],
        mentionedUserIds:
          item.status === "HIDDEN" ? [] : [...item.mentionedUserIds],
      }));
  }

  /** Validate nội dung, chủ đề chưa khóa, parent/tệp/mention hợp lệ rồi tạo post và thông báo. */
  async createPost(
    topicId: string,
    body: string,
    authorId = "usr-learner",
    parentId?: string,
    rawAttachmentIds: string[] = [],
    rawMentionedUserIds: string[] = [],
  ): Promise<ForumPost> {
    const safeBody = this.validateForumContent(body, "Nội dung phản hồi");
    const attachmentIds = [...new Set(rawAttachmentIds)];
    const mentionedUserIds = [...new Set(rawMentionedUserIds)].filter(
      (userId) => userId !== authorId,
    );
    if (attachmentIds.length > 5)
      throw new BadRequestException(
        "Mỗi phản hồi chỉ được đính kèm tối đa 5 tệp.",
      );
    if (mentionedUserIds.length > 10)
      throw new BadRequestException(
        "Mỗi phản hồi chỉ được nhắc tối đa 10 thành viên.",
      );
    const prisma = this.database();
    if (prisma) {
      const topic = await prisma.forumTopic.findUnique({
        where: { id: topicId },
        include: {
          class: { include: { enrollments: true, instructors: true } },
        },
      });
      if (!topic) throw new NotFoundException("Không tìm thấy chủ đề.");
      if (topic.isLocked) throw new BadRequestException("Chủ đề đã khóa.");
      if (topic.class.status === "CLOSED")
        throw new ConflictException("Lớp đã lưu trữ và chỉ cho phép đọc.");
      if (
        !topic.class.enrollments.some(
          (item) => item.learnerId === authorId && item.status === "ACTIVE",
        )
      )
        throw new NotFoundException("Học viên không thuộc lớp của chủ đề.");
      const moderationStatus = await this.enforceForumPolicy(
        prisma,
        authorId,
        safeBody,
      );
      if (parentId) {
        const parent = await prisma.forumPost.findFirst({
          where: { id: parentId, topicId },
          include: { parent: { include: { parent: true } } },
        });
        if (!parent) throw new BadRequestException("Bài cha không hợp lệ.");
        if (parent.parent?.parentId)
          throw new BadRequestException("Phản hồi chỉ được lồng tối đa 2 cấp.");
      }
      const validAttachments = attachmentIds.length
        ? await prisma.material.findMany({
            where: {
              id: { in: attachmentIds },
              classId: topic.classId,
              visibility: "PUBLISHED",
            },
            select: { id: true },
          })
        : [];
      if (validAttachments.length !== attachmentIds.length)
        throw new BadRequestException(
          "Tệp đính kèm phải thuộc lớp và đã được phát hành.",
        );
      const validMentions = mentionedUserIds.length
        ? await prisma.user.findMany({
            where: {
              id: { in: mentionedUserIds },
              OR: [
                {
                  enrollments: {
                    some: { classId: topic.classId, status: "ACTIVE" },
                  },
                },
                { instructedClasses: { some: { classId: topic.classId } } },
              ],
            },
            select: { id: true },
          })
        : [];
      if (validMentions.length !== mentionedUserIds.length)
        throw new BadRequestException(
          "Chỉ được nhắc thành viên đang thuộc lớp.",
        );
      return prisma.$transaction(async (transaction) => {
        const postId = id("post");
        const post = await transaction.forumPost.create({
          data: {
            id: postId,
            topicId,
            authorId,
            body: safeBody,
            parentId,
            status:
              moderationStatus === "HIDE_PENDING_REVIEW"
                ? "PENDING_REVIEW"
                : "PUBLISHED",
            attachments: {
              create: attachmentIds.map((materialId) => ({ materialId })),
            },
            mentions: {
              create: mentionedUserIds.map((mentionedUserId) => ({
                mentionedUserId,
              })),
            },
          },
          include: { attachments: true, mentions: true },
        });
        if (moderationStatus)
          await transaction.contentReport.create({
            data: {
              id: id("report"),
              targetType: "POST",
              targetId: postId,
              reporterId: authorId,
              reason: "AUTO_MODERATION",
              details: "Nội dung khớp chính sách kiểm duyệt đang hiệu lực.",
            },
          });
        if (mentionedUserIds.length && post.status === "PUBLISHED") {
          await transaction.notification.createMany({
            data: mentionedUserIds.map((recipientId) => ({
              id: id("notification"),
              recipientId,
              type: "FORUM_MENTION",
              title: `Bạn được nhắc trong chủ đề ${topic.title}`,
              entityType: "FORUM_POST",
              entityId: postId,
              dedupKey: `forum-mention:${postId}:${recipientId}`,
            })),
            skipDuplicates: true,
          });
        }
        return this.mapPost(post);
      });
    }
    const topic = this.findTopic(topicId);
    if (topic.isLocked) throw new BadRequestException("Chủ đề đã khóa.");
    if (this.findClass(topic.classId).status === "CLOSED")
      throw new ConflictException("Lớp đã lưu trữ và chỉ cho phép đọc.");
    const classItem = this.findClass(topic.classId);
    if (!classItem.learnerIds.includes(authorId))
      throw new NotFoundException("Học viên không thuộc lớp của chủ đề.");
    const moderationStatus = await this.enforceMemoryForumPolicy(
      authorId,
      safeBody,
    );
    const parent = parentId
      ? this.posts.find(
          (item) => item.id === parentId && item.topicId === topicId,
        )
      : undefined;
    if (parentId && !parent)
      throw new BadRequestException("Bài cha không hợp lệ.");
    if (
      parent?.parentId &&
      this.posts.find((item) => item.id === parent.parentId)?.parentId
    )
      throw new BadRequestException("Phản hồi chỉ được lồng tối đa 2 cấp.");
    if (
      attachmentIds.some(
        (materialId) =>
          !this.materials.some(
            (item) =>
              item.id === materialId &&
              item.classId === topic.classId &&
              item.visibility === "PUBLISHED",
          ),
      )
    ) {
      throw new BadRequestException(
        "Tệp đính kèm phải thuộc lớp và đã được phát hành.",
      );
    }
    const classMembers = new Set([
      ...classItem.learnerIds,
      ...classItem.instructorIds,
    ]);
    if (mentionedUserIds.some((userId) => !classMembers.has(userId)))
      throw new BadRequestException("Chỉ được nhắc thành viên đang thuộc lớp.");
    const item: ForumPost = {
      id: id("post"),
      topicId,
      authorId,
      body: safeBody,
      parentId,
      status: moderationStatus === "HIDE_PENDING_REVIEW" ? "HIDDEN" : "VISIBLE",
      attachmentIds,
      mentionedUserIds,
      createdAt: now(),
    };
    this.posts.push(item);
    if (moderationStatus)
      this.reports.unshift({
        id: id("report"),
        targetType: "POST",
        targetId: item.id,
        reporterId: authorId,
        reason: "AUTO_MODERATION",
        details: "Nội dung khớp chính sách kiểm duyệt đang hiệu lực.",
        status: "OPEN",
        escalationLevel: 0,
        createdAt: now(),
        updatedAt: now(),
        actions: [],
      });
    for (const recipientId of mentionedUserIds) {
      if (
        !this.notifications.some(
          (notification) =>
            notification.entityId === item.id &&
            notification.recipientId === recipientId,
        )
      ) {
        this.notifications.unshift({
          id: id("notification"),
          recipientId,
          type: "FORUM_MENTION",
          title: `Bạn được nhắc trong chủ đề ${topic.title}`,
          entityType: "FORUM_POST",
          entityId: item.id,
          createdAt: now(),
        });
      }
    }
    return {
      ...item,
      attachmentIds: [...item.attachmentIds],
      mentionedUserIds: [...item.mentionedUserIds],
    };
  }

  /** Cho đúng tác giả sửa bài chưa bị xóa/ẩn và chạy lại chính sách nội dung. */
  async updatePost(
    postId: string,
    body: string,
    authorId = "usr-learner",
  ): Promise<ForumPost> {
    const safeBody = this.validateForumContent(body, "Nội dung phản hồi");
    const prisma = this.database();
    if (prisma) {
      const current = await prisma.forumPost.findFirst({
        where: { id: postId, authorId },
        include: {
          topic: { include: { class: true } },
          attachments: true,
          mentions: true,
        },
      });
      if (!current)
        throw new NotFoundException("Không tìm thấy phản hồi được phép sửa.");
      if (current.topic.class.status === "CLOSED")
        throw new ConflictException("Lớp đã lưu trữ và chỉ cho phép đọc.");
      const activeMembership = await prisma.classEnrollment.findFirst({ where: { classId: current.topic.classId, learnerId: authorId, status: "ACTIVE" }, select: { id: true } });
      if (!activeMembership) throw new ConflictException("Bạn đã rời lớp và không còn quyền sửa bài viết cũ.");
      if (current.deletedAt || current.status !== "PUBLISHED")
        throw new ConflictException("Phản hồi đã bị xóa hoặc ẩn.");
      if (current.topic.isLocked)
        throw new ConflictException("Chủ đề đã khóa.");
      const history = Array.isArray(current.editHistory)
        ? current.editHistory
        : [];
      return this.mapPost(
        await prisma.forumPost.update({
          where: { id: postId },
          data: {
            body: safeBody,
            editedAt: new Date(),
            editHistory: [
              ...history,
              { body: current.body, editedAt: new Date().toISOString() },
            ],
          },
          include: { attachments: true, mentions: true },
        }),
      );
    }
    const current = this.posts.find(
      (item) => item.id === postId && item.authorId === authorId,
    );
    if (!current)
      throw new NotFoundException("Không tìm thấy phản hồi được phép sửa.");
    if (current.deletedAt || current.status !== "VISIBLE")
      throw new ConflictException("Phản hồi đã bị xóa hoặc ẩn.");
    const topic = this.findTopic(current.topicId);
    if (this.findClass(topic.classId).status === "CLOSED")
      throw new ConflictException("Lớp đã lưu trữ và chỉ cho phép đọc.");
    if (!this.findClass(topic.classId).learnerIds.includes(authorId))
      throw new ConflictException("Bạn đã rời lớp và không còn quyền sửa bài viết cũ.");
    if (topic.isLocked) throw new ConflictException("Chủ đề đã khóa.");
    current.body = safeBody;
    current.editedAt = now();
    current.editCount = (current.editCount ?? 0) + 1;
    return {
      ...current,
      attachmentIds: [...current.attachmentIds],
      mentionedUserIds: [...current.mentionedUserIds],
    };
  }

  /** Xóa mềm bài viết của tác giả để giữ tính toàn vẹn chuỗi thảo luận. */
  async deletePost(
    postId: string,
    authorId = "usr-learner",
  ): Promise<ForumPost> {
    const prisma = this.database();
    if (prisma) {
      const current = await prisma.forumPost.findFirst({
        where: { id: postId, authorId },
        include: {
          topic: { include: { class: true } },
          attachments: true,
          mentions: true,
        },
      });
      if (!current)
        throw new NotFoundException("Không tìm thấy phản hồi được phép xóa.");
      if (current.topic.class.status === "CLOSED")
        throw new ConflictException("Lớp đã lưu trữ và chỉ cho phép đọc.");
      const activeMembership = await prisma.classEnrollment.findFirst({ where: { classId: current.topic.classId, learnerId: authorId, status: "ACTIVE" }, select: { id: true } });
      if (!activeMembership) throw new ConflictException("Bạn đã rời lớp và không còn quyền xóa bài viết cũ.");
      if (current.topic.isLocked)
        throw new ConflictException("Chủ đề đã khóa.");
      if (current.deletedAt) return this.mapPost(current);
      return this.mapPost(
        await prisma.forumPost.update({
          where: { id: postId },
          data: { status: "ARCHIVED", deletedAt: new Date() },
          include: { attachments: true, mentions: true },
        }),
      );
    }
    const current = this.posts.find(
      (item) => item.id === postId && item.authorId === authorId,
    );
    if (!current)
      throw new NotFoundException("Không tìm thấy phản hồi được phép xóa.");
    const topic = this.findTopic(current.topicId);
    if (this.findClass(topic.classId).status === "CLOSED")
      throw new ConflictException("Lớp đã lưu trữ và chỉ cho phép đọc.");
    if (!this.findClass(topic.classId).learnerIds.includes(authorId))
      throw new ConflictException("Bạn đã rời lớp và không còn quyền xóa bài viết cũ.");
    if (topic.isLocked) throw new ConflictException("Chủ đề đã khóa.");
    current.status = "HIDDEN";
    current.deletedAt ??= now();
    return {
      ...current,
      body: "[Nội dung đã bị xóa]",
      attachmentIds: [],
      mentionedUserIds: [],
    };
  }

  /** Ẩn bài vi phạm, lưu lý do kiểm duyệt và thông báo tác giả. */
  async hidePost(
    postId: string,
    rawReason: string,
    actorId = "usr-instructor",
  ): Promise<ForumPost> {
    const reason = rawReason.trim();
    if (reason.length < 5)
      throw new BadRequestException("Lý do ẩn cần ít nhất 5 ký tự.");
    const prisma = this.database();
    if (prisma) {
      return prisma.$transaction(async (transaction) => {
        const current = await transaction.forumPost.findFirst({
          where: {
            id: postId,
            topic: {
              class: { instructors: { some: { instructorId: actorId } } },
            },
          },
          include: {
            topic: { include: { class: true } },
            attachments: true,
            mentions: true,
          },
        });
        if (!current)
          throw new NotFoundException(
            "Không tìm thấy phản hồi được phép kiểm duyệt.",
          );
        if (current.topic.class.status === "CLOSED")
          throw new ConflictException("Lớp đã lưu trữ và chỉ cho phép đọc.");
        const updated = await transaction.forumPost.update({
          where: { id: postId },
          data: { status: "ARCHIVED" },
          include: { attachments: true, mentions: true },
        });
        await transaction.auditLog.create({
          data: {
            actorId,
            action: "FORUM_POST_HIDDEN",
            entityType: "forum_post",
            entityId: postId,
            context: { reason, authorId: current.authorId },
          },
        });
        return this.mapPost(updated);
      });
    }
    const current = this.findPost(postId);
    const classItem = this.findClass(this.findTopic(current.topicId).classId);
    if (!classItem.instructorIds.includes(actorId))
      throw new NotFoundException(
        "Không tìm thấy phản hồi được phép kiểm duyệt.",
      );
    if (classItem.status === "CLOSED")
      throw new ConflictException("Lớp đã lưu trữ và chỉ cho phép đọc.");
    current.status = "HIDDEN";
    return {
      ...current,
      body: "[Nội dung đã bị ẩn]",
      attachmentIds: [],
      mentionedUserIds: [],
    };
  }

  /** Liệt kê thông báo của đúng người nhận theo thời gian mới nhất. */
  async listNotifications(
    recipientId = "usr-learner",
  ): Promise<LearningNotification[]> {
    const prisma = this.database();
    if (prisma) {
      const rows = await prisma.notification.findMany({
        where: { recipientId },
        orderBy: { createdAt: "desc" },
        take: 50,
      });
      return rows.map((row) => ({
        id: row.id,
        recipientId: row.recipientId,
        type: row.type,
        title: row.title,
        entityType: row.entityType,
        entityId: row.entityId,
        readAt: row.readAt?.toISOString(),
        createdAt: row.createdAt.toISOString(),
      }));
    }
    return this.notifications
      .filter((item) => item.recipientId === recipientId)
      .map((item) => ({ ...item }));
  }

  /** Đánh dấu đã đọc bằng điều kiện recipientId để ngăn sửa thông báo người khác. */
  async markNotificationRead(
    notificationId: string,
    recipientId = "usr-learner",
  ): Promise<LearningNotification> {
    const prisma = this.database();
    if (prisma) {
      const existing = await prisma.notification.findFirst({
        where: { id: notificationId, recipientId },
      });
      if (!existing) throw new NotFoundException("Không tìm thấy thông báo.");
      const row = await prisma.notification.update({
        where: { id: notificationId },
        data: { readAt: existing.readAt ?? new Date() },
      });
      return {
        id: row.id,
        recipientId: row.recipientId,
        type: row.type,
        title: row.title,
        entityType: row.entityType,
        entityId: row.entityId,
        readAt: row.readAt?.toISOString(),
        createdAt: row.createdAt.toISOString(),
      };
    }
    const item = this.notifications.find(
      (notification) =>
        notification.id === notificationId &&
        notification.recipientId === recipientId,
    );
    if (!item) throw new NotFoundException("Không tìm thấy thông báo.");
    item.readAt ??= now();
    return { ...item };
  }

  /** Kiểm tra đối tượng tồn tại và tạo báo cáo tránh trùng đang mở từ cùng người gửi. */
  async reportContent(
    input: Pick<
      ContentReport,
      "targetType" | "targetId" | "reporterId" | "reason" | "details"
    >,
  ): Promise<ContentReport> {
    const prisma = this.database();
    if (prisma) {
      const targetClass =
        input.targetType === "POST"
          ? (
              await prisma.forumPost.findFirst({
                where: {
                  id: input.targetId,
                  topic: {
                    class: {
                      enrollments: {
                        some: { learnerId: input.reporterId, status: "ACTIVE" },
                      },
                    },
                  },
                },
                select: {
                  topic: { select: { class: { select: { status: true } } } },
                },
              })
            )?.topic.class
          : (
              await prisma.forumTopic.findFirst({
                where: {
                  id: input.targetId,
                  class: {
                    enrollments: {
                      some: { learnerId: input.reporterId, status: "ACTIVE" },
                    },
                  },
                },
                select: { class: { select: { status: true } } },
              })
            )?.class;
      if (!targetClass)
        throw new NotFoundException("Không tìm thấy nội dung cần báo cáo.");
      if (targetClass.status === "CLOSED")
        throw new ConflictException("Lớp đã lưu trữ và chỉ cho phép đọc.");
      try {
        return this.mapReport(
          await prisma.contentReport.create({
            data: { id: id("report"), ...input },
            include: { actions: true },
          }),
        );
      } catch (error) {
        if (isUniqueConstraintError(error))
          throw new ConflictException("Bạn đã báo cáo nội dung này.");
        throw error;
      }
    }
    const targetClassId =
      input.targetType === "TOPIC"
        ? this.topics.find((item) => item.id === input.targetId)?.classId
        : this.topics.find(
            (topic) =>
              topic.id ===
              this.posts.find((post) => post.id === input.targetId)?.topicId,
          )?.classId;
    if (
      !targetClassId ||
      !this.findClass(targetClassId).learnerIds.includes(input.reporterId)
    )
      throw new NotFoundException(
        "Không tìm thấy nội dung trong lớp đã ghi danh.",
      );
    if (this.findClass(targetClassId).status === "CLOSED")
      throw new ConflictException("Lớp đã lưu trữ và chỉ cho phép đọc.");
    if (
      this.reports.some(
        (item) =>
          item.targetId === input.targetId &&
          item.reporterId === input.reporterId &&
          item.status === "OPEN",
      )
    )
      throw new ConflictException("Bạn đã báo cáo nội dung này.");
    const timestamp = now();
    const item: ContentReport = {
      ...input,
      id: id("report"),
      status: "OPEN",
      escalationLevel: 0,
      createdAt: timestamp,
      updatedAt: timestamp,
      actions: [],
    };
    this.reports.unshift(item);
    return { ...item };
  }

  /** Liệt kê hàng đợi kiểm duyệt cùng lịch sử hành động. */
  async listReports(): Promise<ContentReport[]> {
    const prisma = this.database();
    if (prisma) {
      const rows = await prisma.contentReport.findMany({
        include: { actions: { orderBy: { createdAt: "asc" } } },
        orderBy: { createdAt: "desc" },
      });
      return rows.map((row) => this.mapReport(row));
    }
    return this.reports.map((item) => ({ ...item }));
  }

  /** Liệt kê báo cáo và kết quả xử lý thuộc người học. */
  async listLearnerReports(
    learnerId = "usr-learner",
  ): Promise<ContentReport[]> {
    const prisma = this.database();
    if (prisma) {
      const rows = await prisma.contentReport.findMany({
        where: { reporterId: learnerId },
        include: { actions: { orderBy: { createdAt: "asc" } } },
        orderBy: { createdAt: "desc" },
      });
      return rows.map((row) => this.mapReport(row));
    }
    return this.reports
      .filter((item) => item.reporterId === learnerId)
      .map((item) => ({ ...item }));
  }

  /** Ghép báo cáo với nội dung đích và ngữ cảnh lân cận để ra quyết định. */
  async getReportContext(reportId: string): Promise<ModerationContext> {
    const prisma = this.database();
    if (prisma) {
      const report = await prisma.contentReport.findUnique({
        where: { id: reportId },
        include: { actions: { orderBy: { createdAt: "asc" } } },
      });
      if (!report) throw new NotFoundException("Không tìm thấy báo cáo.");
      if (report.targetType === "TOPIC") {
        const topic = await prisma.forumTopic.findUnique({
          where: { id: report.targetId },
          include: { posts: { orderBy: { createdAt: "asc" }, take: 20 } },
        });
        if (!topic)
          throw new NotFoundException("Nội dung báo cáo không còn tồn tại.");
        return {
          report: this.mapReport(report),
          classId: topic.classId,
          topicTitle: topic.title,
          targetAuthorId: topic.authorId,
          targetBody: topic.body,
          surroundingPosts: topic.posts.map((post) => ({
            id: post.id,
            authorId: post.authorId,
            body: post.body,
            createdAt: post.createdAt.toISOString(),
          })),
        };
      }
      const post = await prisma.forumPost.findUnique({
        where: { id: report.targetId },
        include: {
          topic: {
            include: { posts: { orderBy: { createdAt: "asc" }, take: 20 } },
          },
        },
      });
      if (!post)
        throw new NotFoundException("Nội dung báo cáo không còn tồn tại.");
      return {
        report: this.mapReport(report),
        classId: post.topic.classId,
        topicTitle: post.topic.title,
        targetAuthorId: post.authorId,
        targetBody: post.body,
        surroundingPosts: post.topic.posts.map((item) => ({
          id: item.id,
          authorId: item.authorId,
          body: item.body,
          createdAt: item.createdAt.toISOString(),
        })),
      };
    }
    const report = this.findReport(reportId);
    const topic =
      report.targetType === "TOPIC"
        ? this.findTopic(report.targetId)
        : this.findTopic(this.findPost(report.targetId).topicId);
    const target =
      report.targetType === "TOPIC"
        ? { authorId: topic.authorId, body: topic.body }
        : this.findPost(report.targetId);
    return {
      report: {
        ...report,
        actions: report.actions.map((action) => ({ ...action })),
      },
      classId: topic.classId,
      topicTitle: topic.title,
      targetAuthorId: target.authorId,
      targetBody: target.body,
      surroundingPosts: this.posts
        .filter((post) => post.topicId === topic.id)
        .map((post) => ({
          id: post.id,
          authorId: post.authorId,
          body: post.body,
          createdAt: post.createdAt,
        })),
    };
  }

  /** Nhận quyền xử lý báo cáo bằng cập nhật có điều kiện để tránh claim đồng thời. */
  async claimReport(
    reportId: string,
    moderatorId = "usr-manager",
    moderatorRole = "CENTER_MANAGER",
  ): Promise<ContentReport> {
    const prisma = this.database();
    if (prisma) {
      return prisma.$transaction(async (transaction) => {
        const current = await transaction.contentReport.findUnique({
          where: { id: reportId },
        });
        if (!current) throw new NotFoundException("Không tìm thấy báo cáo.");
        if (
          current.status === "IN_REVIEW" &&
          current.assignedToId === moderatorId
        )
          return this.mapReport(
            await transaction.contentReport.findUniqueOrThrow({
              where: { id: reportId },
              include: { actions: { orderBy: { createdAt: "asc" } } },
            }),
          );
        if (current.status === "ESCALATED" && moderatorRole !== "SYSTEM_ADMIN")
          throw new ConflictException(
            "Báo cáo đã chuyển cấp và chỉ quản trị hệ thống được nhận xử lý.",
          );
        if (!["OPEN", "ESCALATED"].includes(current.status))
          throw new ConflictException(
            "Chỉ báo cáo đang mở hoặc đã chuyển cấp mới có thể nhận xử lý.",
          );
        await transaction.moderationAction.create({
          data: {
            id: id("mod-action"),
            reportId,
            actorId: moderatorId,
            action: "CLAIM",
            reason: "Nhận xử lý báo cáo",
            previousStatus: current.status,
            nextStatus: "IN_REVIEW",
          },
        });
        await transaction.auditLog.create({
          data: {
            actorId: moderatorId,
            action: "FORUM_REPORT_CLAIM",
            entityType: "content_report",
            entityId: reportId,
            context: {
              previousStatus: current.status,
              nextStatus: "IN_REVIEW",
            },
          },
        });
        return this.mapReport(
          await transaction.contentReport.update({
            where: { id: reportId },
            data: { status: "IN_REVIEW", assignedToId: moderatorId },
            include: { actions: { orderBy: { createdAt: "asc" } } },
          }),
        );
      });
    }
    const current = this.findReport(reportId);
    if (current.status === "IN_REVIEW" && current.assignedToId === moderatorId)
      return {
        ...current,
        actions: current.actions.map((action) => ({ ...action })),
      };
    if (current.status === "ESCALATED" && moderatorRole !== "SYSTEM_ADMIN")
      throw new ConflictException(
        "Báo cáo đã chuyển cấp và chỉ quản trị hệ thống được nhận xử lý.",
      );
    if (!["OPEN", "ESCALATED"].includes(current.status))
      throw new ConflictException(
        "Chỉ báo cáo đang mở hoặc đã chuyển cấp mới có thể nhận xử lý.",
      );
    this.recordMemoryModeration(
      current,
      moderatorId,
      "CLAIM",
      "Nhận xử lý báo cáo",
      "IN_REVIEW",
    );
    current.assignedToId = moderatorId;
    return {
      ...current,
      actions: current.actions.map((action) => ({ ...action })),
    };
  }

  /** Áp dụng hành động kiểm duyệt, ghi action history và thông báo các bên liên quan. */
  async resolveReport(
    reportId: string,
    action: "HIDE_CONTENT" | "KEEP_CONTENT" | "ESCALATE_ADMIN",
    resolution: string,
    moderatorId = "usr-manager",
    moderatorRole = "CENTER_MANAGER",
  ): Promise<ContentReport> {
    const normalizedResolution = resolution.trim();
    if (normalizedResolution.length < 3)
      throw new BadRequestException("Lý do xử lý phải có ít nhất 3 ký tự.");
    const nextStatus =
      action === "HIDE_CONTENT"
        ? "RESOLVED"
        : action === "KEEP_CONTENT"
          ? "REJECTED"
          : "ESCALATED";
    const prisma = this.database();
    if (prisma) {
      return prisma.$transaction(async (transaction) => {
        const item = await transaction.contentReport.findUnique({
          where: { id: reportId },
        });
        if (!item) throw new NotFoundException("Không tìm thấy báo cáo.");
        if (item.escalationLevel > 0 && moderatorRole !== "SYSTEM_ADMIN")
          throw new ConflictException(
            "Báo cáo đã chuyển cấp và chỉ quản trị hệ thống được kết luận.",
          );
        if (!["OPEN", "IN_REVIEW", "ESCALATED"].includes(item.status))
          throw new ConflictException("Báo cáo đã được xử lý.");
        if (action === "ESCALATE_ADMIN" && moderatorRole === "SYSTEM_ADMIN")
          throw new ConflictException(
            "Quản trị hệ thống phải đưa ra kết luận cuối cùng.",
          );
        if (item.assignedToId && item.assignedToId !== moderatorId)
          throw new ConflictException("Báo cáo đang do quản lý khác xử lý.");
        let targetAuthorId: string | undefined;
        if (item.targetType === "POST") {
          targetAuthorId = (
            await transaction.forumPost.findUnique({
              where: { id: item.targetId },
              select: { authorId: true },
            })
          )?.authorId;
        } else {
          targetAuthorId = (
            await transaction.forumTopic.findUnique({
              where: { id: item.targetId },
              select: { authorId: true },
            })
          )?.authorId;
        }
        if (!targetAuthorId)
          throw new NotFoundException("Nội dung báo cáo không còn tồn tại.");
        if (action === "HIDE_CONTENT" && item.targetType === "POST") {
          await transaction.forumPost.updateMany({
            where: { id: item.targetId },
            data: { status: "ARCHIVED" },
          });
        }
        if (action === "HIDE_CONTENT" && item.targetType === "TOPIC")
          await transaction.forumTopic.updateMany({
            where: { id: item.targetId },
            data: { status: "ARCHIVED", isLocked: true },
          });
        if (action === "KEEP_CONTENT" && item.targetType === "POST")
          await transaction.forumPost.updateMany({
            where: { id: item.targetId },
            data: { status: "PUBLISHED" },
          });
        if (action === "KEEP_CONTENT" && item.targetType === "TOPIC")
          await transaction.forumTopic.updateMany({
            where: { id: item.targetId },
            data: { status: "PUBLISHED", isLocked: false },
          });
        await transaction.moderationAction.create({
          data: {
            id: id("mod-action"),
            reportId,
            actorId: moderatorId,
            action,
            reason: normalizedResolution,
            previousStatus: item.status,
            nextStatus,
          },
        });
        await transaction.auditLog.create({
          data: {
            actorId: moderatorId,
            action: `FORUM_REPORT_${action}`,
            entityType: "content_report",
            entityId: reportId,
            context: {
              targetType: item.targetType,
              targetId: item.targetId,
              previousStatus: item.status,
              nextStatus,
              resolution: normalizedResolution,
            },
          },
        });
        const adminIds =
          action === "ESCALATE_ADMIN"
            ? await this.userIdsForRole(transaction, "SYSTEM_ADMIN")
            : [];
        const recipients = [
          ...new Set([item.reporterId, targetAuthorId, ...adminIds]),
        ];
        await transaction.notification.createMany({
          data: recipients.map((recipientId) => ({
            id: id("notification"),
            recipientId,
            type: "FORUM_MODERATION",
            title:
              action === "ESCALATE_ADMIN"
                ? "Báo cáo diễn đàn đã được chuyển cấp"
                : "Báo cáo diễn đàn đã có kết quả",
            entityType: "CONTENT_REPORT",
            entityId: reportId,
            dedupKey: `forum-report:${reportId}:${action}:${recipientId}`,
          })),
          skipDuplicates: true,
        });
        return this.mapReport(
          await transaction.contentReport.update({
            where: { id: reportId },
            data: {
              status: nextStatus,
              assignedToId: moderatorId,
              escalationLevel:
                action === "ESCALATE_ADMIN"
                  ? { increment: 1 }
                  : item.escalationLevel,
              resolution: normalizedResolution,
              resolvedAt: action === "ESCALATE_ADMIN" ? null : new Date(),
            },
            include: { actions: { orderBy: { createdAt: "asc" } } },
          }),
        );
      });
    }
    const item = this.findReport(reportId);
    if (item.escalationLevel > 0 && moderatorRole !== "SYSTEM_ADMIN")
      throw new ConflictException(
        "Báo cáo đã chuyển cấp và chỉ quản trị hệ thống được kết luận.",
      );
    if (!["OPEN", "IN_REVIEW", "ESCALATED"].includes(item.status))
      throw new ConflictException("Báo cáo đã được xử lý.");
    if (action === "ESCALATE_ADMIN" && moderatorRole === "SYSTEM_ADMIN")
      throw new ConflictException(
        "Quản trị hệ thống phải đưa ra kết luận cuối cùng.",
      );
    if (item.assignedToId && item.assignedToId !== moderatorId)
      throw new ConflictException("Báo cáo đang do quản lý khác xử lý.");
    const topic =
      item.targetType === "TOPIC"
        ? this.findTopic(item.targetId)
        : this.findTopic(this.findPost(item.targetId).topicId);
    const targetAuthorId =
      item.targetType === "TOPIC"
        ? topic.authorId
        : this.findPost(item.targetId).authorId;
    if (action === "HIDE_CONTENT" && item.targetType === "POST")
      this.findPost(item.targetId).status = "HIDDEN";
    if (action === "HIDE_CONTENT" && item.targetType === "TOPIC") {
      topic.status = "HIDDEN";
      topic.isLocked = true;
    }
    if (action === "KEEP_CONTENT" && item.targetType === "POST")
      this.findPost(item.targetId).status = "VISIBLE";
    if (action === "KEEP_CONTENT" && item.targetType === "TOPIC") {
      topic.status = "VISIBLE";
      topic.isLocked = false;
    }
    this.recordMemoryModeration(
      item,
      moderatorId,
      action,
      normalizedResolution,
      nextStatus,
    );
    item.assignedToId = moderatorId;
    item.resolution = normalizedResolution;
    item.escalationLevel += action === "ESCALATE_ADMIN" ? 1 : 0;
    if (action !== "ESCALATE_ADMIN") item.resolvedAt = now();
    for (const recipientId of new Set([
      item.reporterId,
      targetAuthorId,
      ...(action === "ESCALATE_ADMIN"
        ? [this.userIdForRole("SYSTEM_ADMIN")]
        : []),
    ]))
      this.notifications.unshift({
        id: id("notification"),
        recipientId,
        type: "FORUM_MODERATION",
        title:
          action === "ESCALATE_ADMIN"
            ? "Báo cáo diễn đàn đã được chuyển cấp"
            : "Báo cáo diễn đàn đã có kết quả",
        entityType: "CONTENT_REPORT",
        entityId: reportId,
        createdAt: now(),
      });
    return { ...item, actions: item.actions.map((record) => ({ ...record })) };
  }

  /** Mở khiếu nại một lần cho báo cáo đã xử lý thuộc người gửi và đưa lại vào hàng đợi. */
  async appealReport(
    reportId: string,
    reason: string,
    learnerId = "usr-learner",
  ): Promise<ContentReport> {
    const normalizedReason = reason.trim();
    if (normalizedReason.length < 10)
      throw new BadRequestException(
        "Lý do kháng nghị phải có ít nhất 10 ký tự.",
      );
    const prisma = this.database();
    if (prisma) {
      return prisma.$transaction(async (transaction) => {
        const item = await transaction.contentReport.findFirst({
          where: { id: reportId, reporterId: learnerId },
        });
        if (!item)
          throw new NotFoundException(
            "Không tìm thấy báo cáo được phép kháng nghị.",
          );
        if (!["RESOLVED", "REJECTED"].includes(item.status))
          throw new ConflictException(
            "Chỉ kết quả đã xử lý mới có thể kháng nghị.",
          );
        if (item.appealedAt)
          throw new ConflictException(
            "Báo cáo này đã được kháng nghị trước đó.",
          );
        await transaction.moderationAction.create({
          data: {
            id: id("mod-action"),
            reportId,
            actorId: learnerId,
            action: "APPEAL",
            reason: normalizedReason,
            previousStatus: item.status,
            nextStatus: "IN_REVIEW",
          },
        });
        await transaction.auditLog.create({
          data: {
            actorId: learnerId,
            action: "FORUM_REPORT_APPEAL",
            entityType: "content_report",
            entityId: reportId,
            context: { reason: normalizedReason, previousStatus: item.status },
          },
        });
        const managerIds = await this.userIdsForRole(
          transaction,
          "CENTER_MANAGER",
        );
        await transaction.notification.createMany({
          data: managerIds.map((recipientId) => ({
            id: id("notification"),
            recipientId,
            type: "FORUM_MODERATION_APPEAL",
            title: "Có kháng nghị kiểm duyệt mới",
            entityType: "CONTENT_REPORT",
            entityId: reportId,
            dedupKey: `forum-report:${reportId}:appeal:${recipientId}`,
          })),
          skipDuplicates: true,
        });
        return this.mapReport(
          await transaction.contentReport.update({
            where: { id: reportId },
            data: {
              status: "IN_REVIEW",
              assignedToId: null,
              appealReason: normalizedReason,
              appealedAt: new Date(),
              resolvedAt: null,
            },
            include: { actions: { orderBy: { createdAt: "asc" } } },
          }),
        );
      });
    }
    const item = this.reports.find(
      (report) => report.id === reportId && report.reporterId === learnerId,
    );
    if (!item)
      throw new NotFoundException(
        "Không tìm thấy báo cáo được phép kháng nghị.",
      );
    if (!["RESOLVED", "REJECTED"].includes(item.status))
      throw new ConflictException(
        "Chỉ kết quả đã xử lý mới có thể kháng nghị.",
      );
    if (item.appealedAt)
      throw new ConflictException("Báo cáo này đã được kháng nghị trước đó.");
    this.recordMemoryModeration(
      item,
      learnerId,
      "APPEAL",
      normalizedReason,
      "IN_REVIEW",
    );
    item.assignedToId = undefined;
    item.appealReason = normalizedReason;
    item.appealedAt = now();
    item.resolvedAt = undefined;
    this.notifications.unshift({
      id: id("notification"),
      recipientId: this.userIdForRole("CENTER_MANAGER"),
      type: "FORUM_MODERATION_APPEAL",
      title: "Có kháng nghị kiểm duyệt mới",
      entityType: "CONTENT_REPORT",
      entityId: reportId,
      createdAt: now(),
    });
    return { ...item, actions: item.actions.map((record) => ({ ...record })) };
  }

  /** Liệt kê buổi trực tuyến theo quan hệ lớp và trạng thái truy cập của vai trò. */
  async listSessions(
    role = "LEARNER",
    actorId = this.userIdForRole(role),
  ): Promise<LiveSession[]> {
    const prisma = this.database();
    if (prisma) {
      const rows = await prisma.liveSession.findMany({
        where:
          role === "LEARNER"
            ? {
                class: {
                  enrollments: {
                    some: { learnerId: actorId, status: "ACTIVE" },
                  },
                },
              }
            : role === "INSTRUCTOR"
              ? { class: { instructors: { some: { instructorId: actorId } } } }
              : undefined,
        orderBy: { startsAt: "desc" },
      });
      return rows.map((row) =>
        role === "LEARNER"
          ? { ...this.mapSession(row), hostUrl: "", recordingUrl: undefined }
          : this.mapSession(row),
      );
    }
    return this.sessions
      .filter((item) => {
        const classItem = this.classes.find(
          (candidate) => candidate.id === item.classId,
        );
        if (role === "LEARNER") return classItem?.learnerIds.includes(actorId);
        if (role === "INSTRUCTOR")
          return classItem?.instructorIds.includes(actorId);
        return true;
      })
      .map((item) =>
        role === "LEARNER"
          ? { ...item, hostUrl: "", recordingUrl: undefined }
          : { ...item },
      );
  }

  /** Validate lịch/quyền lớp, cấp phòng từ provider có fallback rồi thông báo thành viên. */
  async createSession(
    classId: string,
    input: Pick<LiveSession, "title" | "startsAt" | "endsAt" | "provider">,
    actorId = "usr-instructor",
    actorRole = "INSTRUCTOR",
  ): Promise<LiveSession> {
    if (new Date(input.endsAt) <= new Date(input.startsAt))
      throw new BadRequestException(
        "Thời gian kết thúc phải sau thời gian bắt đầu.",
      );
    const prisma = this.database();
    if (prisma) {
      const classItem = await prisma.learningClass.findUnique({
        where: { id: classId },
        include: { instructors: true },
      });
      if (!classItem) throw new NotFoundException("Không tìm thấy lớp học.");
      if (classItem.status === "CLOSED")
        throw new ConflictException("Lớp đã lưu trữ và chỉ cho phép đọc.");
      const hostId =
        actorRole === "CENTER_MANAGER"
          ? (classItem.instructors.find((row) => row.role === "PRIMARY")
              ?.instructorId ?? classItem.instructors[0]?.instructorId)
          : actorId;
      if (
        !hostId ||
        !classItem.instructors.some((item) => item.instructorId === hostId)
      )
        throw new NotFoundException(
          "Lớp chưa có giảng viên phù hợp để chủ trì.",
        );
      if (new Date(input.startsAt) < new Date())
        throw new BadRequestException(
          "Không thể lên lịch buổi học trong quá khứ.",
        );
      if (
        new Date(input.startsAt) < classItem.startAt ||
        new Date(input.endsAt) > classItem.endAt
      )
        throw new BadRequestException(
          "Buổi học phải nằm trong thời gian của lớp.",
        );
      const overlaps = await prisma.liveSession.count({
        where: {
          OR: [{ classId }, { hostId }],
          status: { not: "CANCELLED" },
          startsAt: { lt: new Date(input.endsAt) },
          endsAt: { gt: new Date(input.startsAt) },
        },
      });
      if (overlaps) throw new ConflictException("Lịch học bị trùng.");
      const provisioned = await this.provisionProviderMeeting(input.provider);
      const created = await prisma.liveSession.create({
        data: {
          id: id("session"),
          classId,
          hostId,
          title: input.title.trim(),
          startsAt: new Date(input.startsAt),
          endsAt: new Date(input.endsAt),
          provider: provisioned.provider,
          requestedProvider: input.provider,
          fallbackUsed: provisioned.fallbackUsed,
          provisioningAttempts: provisioned.attempts,
          timezone: classItem.timezone,
          hostUrl: provisioned.hostUrl,
          attendeeUrl: provisioned.attendeeUrl,
        },
      });
      await this.notifyClassMembers(
        prisma,
        classId,
        "LIVE_SESSION_SCHEDULED",
        `Đã lên lịch: ${created.title}`,
        created.id,
        "CLASS_REMINDER",
        {
          className: classItem.code,
          sessionTitle: created.title,
          startsAt: created.startsAt.toISOString(),
        },
      );
      await prisma.auditLog.create({
        data: {
          actorId,
          action: "LIVE_SESSION_SCHEDULED",
          entityType: "live_session",
          entityId: created.id,
          context: {
            classId,
            startsAt: input.startsAt,
            endsAt: input.endsAt,
            timezone: classItem.timezone,
            requestedProvider: input.provider,
            provider: provisioned.provider,
            fallbackUsed: provisioned.fallbackUsed,
            provisioningAttempts: provisioned.attempts,
          },
        },
      });
      return this.mapSession(created);
    }
    const classItem = this.findClass(classId);
    if (classItem.status === "CLOSED")
      throw new ConflictException("Lớp đã lưu trữ và chỉ cho phép đọc.");
    const hostId =
      actorRole === "CENTER_MANAGER" ? classItem.instructorIds[0] : actorId;
    if (!hostId || !classItem.instructorIds.includes(hostId))
      throw new NotFoundException("Lớp chưa có giảng viên phù hợp để chủ trì.");
    if (new Date(input.startsAt) < new Date())
      throw new BadRequestException(
        "Không thể lên lịch buổi học trong quá khứ.",
      );
    if (
      new Date(input.startsAt) < new Date(classItem.startAt) ||
      new Date(input.endsAt) > new Date(classItem.endAt)
    )
      throw new BadRequestException(
        "Buổi học phải nằm trong thời gian của lớp.",
      );
    const overlaps = this.sessions.some(
      (item) =>
        item.classId === classId &&
        item.status !== "CANCELLED" &&
        new Date(input.startsAt) < new Date(item.endsAt) &&
        new Date(input.endsAt) > new Date(item.startsAt),
    );
    if (overlaps) throw new ConflictException("Lịch học bị trùng.");
    const provisioned = await this.provisionProviderMeeting(input.provider);
    const item: LiveSession = {
      ...input,
      provider: provisioned.provider,
      requestedProvider: input.provider,
      fallbackUsed: provisioned.fallbackUsed,
      provisioningAttempts: provisioned.attempts,
      id: id("session"),
      classId,
      hostId,
      status: "SCHEDULED",
      timezone: classItem.timezone,
      hostUrl: provisioned.hostUrl,
      attendeeUrl: provisioned.attendeeUrl,
    };
    this.sessions.unshift(item);
    return { ...item };
  }

  /** Cập nhật lịch/provider trước khi buổi học diễn ra và lưu lý do audit. */
  async updateSession(
    sessionId: string,
    input: Pick<LiveSession, "title" | "startsAt" | "endsAt" | "provider"> & {
      reason: string;
    },
    actorId = "usr-manager",
  ): Promise<LiveSession> {
    const reason = input.reason.trim();
    if (reason.length < 5)
      throw new BadRequestException("Lý do đổi lịch cần ít nhất 5 ký tự.");
    const startsAt = new Date(input.startsAt);
    const endsAt = new Date(input.endsAt);
    if (endsAt <= startsAt)
      throw new BadRequestException(
        "Thời gian kết thúc phải sau thời gian bắt đầu.",
      );
    if (startsAt < new Date())
      throw new BadRequestException("Không thể chuyển buổi học vào quá khứ.");
    const prisma = this.database();
    if (prisma) {
      const current = await prisma.liveSession.findUnique({
        where: { id: sessionId },
      });
      if (!current) throw new NotFoundException("Không tìm thấy buổi học.");
      if (current.status !== "SCHEDULED" || current.startsAt <= new Date())
        throw new ConflictException("Chỉ được sửa buổi học sắp diễn ra.");
      const overlap = await prisma.liveSession.count({
        where: {
          id: { not: sessionId },
          OR: [{ classId: current.classId }, { hostId: current.hostId }],
          status: { not: "CANCELLED" },
          startsAt: { lt: endsAt },
          endsAt: { gt: startsAt },
        },
      });
      if (overlap)
        throw new ConflictException(
          "Lịch mới bị trùng lớp hoặc trùng lịch giảng viên.",
        );
      const provisioned = await this.provisionProviderMeeting(input.provider);
      const updated = await prisma.liveSession.update({
        where: { id: sessionId },
        data: {
          title: input.title.trim(),
          startsAt,
          endsAt,
          provider: provisioned.provider,
          requestedProvider: input.provider,
          fallbackUsed: provisioned.fallbackUsed,
          provisioningAttempts: provisioned.attempts,
          changeReason: reason,
          hostUrl: provisioned.hostUrl,
          attendeeUrl: provisioned.attendeeUrl,
        },
      });
      await this.notifyClassMembers(
        prisma,
        current.classId,
        "LIVE_SESSION_CHANGED",
        `Lịch học đã thay đổi: ${updated.title}`,
        sessionId,
      );
      await prisma.auditLog.create({
        data: {
          actorId,
          action: "LIVE_SESSION_CHANGED",
          entityType: "live_session",
          entityId: sessionId,
          context: {
            reason,
            previousStartsAt: current.startsAt,
            startsAt,
            endsAt,
            provider: input.provider,
          },
        },
      });
      return this.mapSession(updated);
    }
    const item = this.findSession(sessionId);
    if (item.status !== "SCHEDULED" || new Date(item.startsAt) <= new Date())
      throw new ConflictException("Chỉ được sửa buổi học sắp diễn ra.");
    const overlap = this.sessions.some(
      (row) =>
        row.id !== sessionId &&
        row.classId === item.classId &&
        row.status !== "CANCELLED" &&
        startsAt < new Date(row.endsAt) &&
        endsAt > new Date(row.startsAt),
    );
    if (overlap)
      throw new ConflictException(
        "Lịch mới bị trùng lớp hoặc trùng lịch giảng viên.",
      );
    const provisioned = await this.provisionProviderMeeting(input.provider);
    Object.assign(item, input, {
      provider: provisioned.provider,
      requestedProvider: input.provider,
      fallbackUsed: provisioned.fallbackUsed,
      provisioningAttempts: provisioned.attempts,
      changeReason: reason,
      hostUrl: provisioned.hostUrl,
      attendeeUrl: provisioned.attendeeUrl,
    });
    return { ...item };
  }

  /** Hủy buổi chưa hoàn tất, ghi lý do và gửi thông báo tới lớp. */
  async cancelSession(
    sessionId: string,
    reason: string,
    actorId = "usr-manager",
  ): Promise<LiveSession> {
    const normalized = reason.trim();
    if (normalized.length < 5)
      throw new BadRequestException("Lý do hủy cần ít nhất 5 ký tự.");
    const prisma = this.database();
    if (prisma) {
      const current = await prisma.liveSession.findUnique({
        where: { id: sessionId },
      });
      if (!current) throw new NotFoundException("Không tìm thấy buổi học.");
      if (current.status !== "SCHEDULED" || current.startsAt <= new Date())
        throw new ConflictException("Chỉ được hủy buổi học chưa diễn ra.");
      const updated = await prisma.liveSession.update({
        where: { id: sessionId },
        data: { status: "CANCELLED", cancellationReason: normalized },
      });
      await this.notifyClassMembers(
        prisma,
        current.classId,
        "LIVE_SESSION_CANCELLED",
        `Buổi học đã hủy: ${current.title}`,
        sessionId,
      );
      await prisma.auditLog.create({
        data: {
          actorId,
          action: "LIVE_SESSION_CANCELLED",
          entityType: "live_session",
          entityId: sessionId,
          context: { reason: normalized, startsAt: current.startsAt },
        },
      });
      return this.mapSession(updated);
    }
    const item = this.findSession(sessionId);
    if (item.status !== "SCHEDULED" || new Date(item.startsAt) <= new Date())
      throw new ConflictException("Chỉ được hủy buổi học chưa diễn ra.");
    item.status = "CANCELLED";
    item.cancellationReason = normalized;
    return { ...item };
  }

  /** Kiểm soát chuyển trạng thái buổi học và cập nhật mốc vận hành liên quan. */
  async transitionSession(
    sessionId: string,
    status: LiveSession["status"],
    actorId = "usr-instructor",
  ): Promise<LiveSession> {
    const allowed: Record<LiveSession["status"], LiveSession["status"][]> = {
      SCHEDULED: ["LIVE"],
      LIVE: ["COMPLETED"],
      COMPLETED: [],
      CANCELLED: [],
    };
    const prisma = this.database();
    if (prisma) {
      const item = await prisma.liveSession.findUnique({
        where: { id: sessionId },
      });
      if (!item || item.hostId !== actorId)
        throw new NotFoundException(
          "Không tìm thấy buổi học được phép điều khiển.",
        );
      if (!allowed[item.status].includes(status))
        throw new BadRequestException(
          `Không thể chuyển ${item.status} → ${status}.`,
        );
      return this.mapSession(
        await prisma.liveSession.update({
          where: { id: sessionId },
          data: { status },
        }),
      );
    }
    const item = this.findSession(sessionId);
    if (item.hostId !== actorId)
      throw new NotFoundException(
        "Không tìm thấy buổi học được phép điều khiển.",
      );
    if (!allowed[item.status].includes(status))
      throw new BadRequestException(
        `Không thể chuyển ${item.status} → ${status}.`,
      );
    item.status = status;
    return { ...item };
  }

  /** Xác minh ghi danh/cửa sổ tham dự, mở bản ghi attendance và trả URL người học. */
  async joinSession(
    sessionId: string,
    learnerId = "usr-learner",
  ): Promise<{ attendeeUrl: string; joinedAt: string }> {
    const prisma = this.database();
    if (prisma) {
      const session = await prisma.liveSession.findUnique({
        where: { id: sessionId },
      });
      if (!session) throw new NotFoundException("Không tìm thấy buổi học.");
      const enrollment = await prisma.classEnrollment.findFirst({
        where: { classId: session.classId, learnerId, status: "ACTIVE" },
      });
      if (!enrollment)
        throw new BadRequestException("Học viên không thuộc lớp.");
      if (["CANCELLED", "COMPLETED"].includes(session.status))
        throw new BadRequestException("Buổi học không còn cho phép tham gia.");
      const joinedAt = new Date();
      if (joinedAt < new Date(session.startsAt.getTime() - 15 * 60_000))
        throw new BadRequestException("Chỉ có thể vào lớp sớm tối đa 15 phút.");
      if (joinedAt > new Date(session.endsAt.getTime() + 30 * 60_000))
        throw new BadRequestException("Đã hết thời gian tham gia buổi học.");
      await prisma.$transaction(async (transaction) => {
        const existingAttendance =
          await transaction.attendanceRecord.findUnique({
            where: { sessionId_learnerId: { sessionId, learnerId } },
            select: { joinedAt: true },
          });
        await transaction.attendanceRecord.upsert({
          where: { sessionId_learnerId: { sessionId, learnerId } },
          update: {
            joinedAt: existingAttendance?.joinedAt ?? joinedAt,
            status: "PRESENT",
          },
          create: { sessionId, learnerId, joinedAt, status: "PRESENT" },
        });
        const openInterval = await transaction.attendanceInterval.findFirst({
          where: { sessionId, learnerId, source: "APP", leftAt: null },
        });
        if (!openInterval)
          await transaction.attendanceInterval.create({
            data: {
              id: id("attendance-interval"),
              sessionId,
              learnerId,
              joinedAt,
              source: "APP",
            },
          });
      });
      return {
        attendeeUrl: session.attendeeUrl,
        joinedAt: joinedAt.toISOString(),
      };
    }
    const item = this.findSession(sessionId);
    const classItem = this.findClass(item.classId);
    if (!classItem.learnerIds.includes(learnerId))
      throw new BadRequestException("Học viên không thuộc lớp.");
    if (item.status === "CANCELLED" || item.status === "COMPLETED")
      throw new BadRequestException("Buổi học không còn cho phép tham gia.");
    const timestamp = new Date();
    if (timestamp < new Date(new Date(item.startsAt).getTime() - 15 * 60_000))
      throw new BadRequestException("Chỉ có thể vào lớp sớm tối đa 15 phút.");
    if (timestamp > new Date(new Date(item.endsAt).getTime() + 30 * 60_000))
      throw new BadRequestException("Đã hết thời gian tham gia buổi học.");
    const joinedAt = now();
    const existing = this.attendance.find(
      (record) =>
        record.sessionId === sessionId && record.learnerId === learnerId,
    );
    if (existing) existing.joinedAt = existing.joinedAt ?? joinedAt;
    else
      this.attendance.push({
        sessionId,
        learnerId,
        joinedAt,
        attendedMinutes: 0,
        status: "PRESENT",
      });
    if (
      !this.attendanceIntervals.some(
        (interval) =>
          interval.sessionId === sessionId &&
          interval.learnerId === learnerId &&
          interval.source === "APP" &&
          !interval.leftAt,
      )
    )
      this.attendanceIntervals.push({
        sessionId,
        learnerId,
        joinedAt,
        source: "APP",
      });
    return { attendeeUrl: item.attendeeUrl, joinedAt };
  }

  /** Đóng lần tham dự và tính phút có mặt trong giới hạn thời gian buổi học. */
  async leaveSession(
    sessionId: string,
    learnerId = "usr-learner",
  ): Promise<AttendanceRecord> {
    const prisma = this.database();
    if (prisma) {
      return prisma.$transaction(async (transaction) => {
        const session = await transaction.liveSession.findUnique({
          where: { id: sessionId },
        });
        if (!session) throw new NotFoundException("Không tìm thấy buổi học.");
        const openInterval = await transaction.attendanceInterval.findFirst({
          where: { sessionId, learnerId, source: "APP", leftAt: null },
          orderBy: { joinedAt: "desc" },
        });
        if (!openInterval)
          throw new BadRequestException(
            "Chưa có lượt tham gia đang mở để kết thúc.",
          );
        const leftAt = new Date();
        await transaction.attendanceInterval.update({
          where: { id: openInterval.id },
          data: { leftAt },
        });
        const intervals = await transaction.attendanceInterval.findMany({
          where: { sessionId, learnerId, leftAt: { not: null } },
          orderBy: { joinedAt: "asc" },
        });
        const attendedMinutes = this.mergedAttendanceMinutes(
          intervals.map((item) => ({
            joinedAt: item.joinedAt,
            leftAt: item.leftAt!,
          })),
          session.startsAt,
          session.endsAt,
        );
        const firstJoinedAt = intervals.reduce<Date | undefined>(
          (earliest, item) =>
            !earliest || item.joinedAt < earliest ? item.joinedAt : earliest,
          undefined,
        );
        return this.mapAttendance(
          await transaction.attendanceRecord.update({
            where: { sessionId_learnerId: { sessionId, learnerId } },
            data: {
              joinedAt: firstJoinedAt,
              leftAt,
              attendedMinutes,
              status: this.deriveProviderAttendanceStatus(
                firstJoinedAt ?? openInterval.joinedAt,
                attendedMinutes,
                session.startsAt,
              ),
            },
          }),
        );
      });
    }
    const attendance = this.attendance.find(
      (item) => item.sessionId === sessionId && item.learnerId === learnerId,
    );
    const openInterval = this.attendanceIntervals.findLast(
      (item) =>
        item.sessionId === sessionId &&
        item.learnerId === learnerId &&
        item.source === "APP" &&
        !item.leftAt,
    );
    if (!attendance?.joinedAt || !openInterval)
      throw new BadRequestException(
        "Chưa có lượt tham gia đang mở để kết thúc.",
      );
    openInterval.leftAt = now();
    attendance.leftAt = openInterval.leftAt;
    const session = this.findSession(sessionId);
    attendance.attendedMinutes = this.mergedAttendanceMinutes(
      this.attendanceIntervals
        .filter(
          (item) =>
            item.sessionId === sessionId &&
            item.learnerId === learnerId &&
            item.leftAt,
        )
        .map((item) => ({
          joinedAt: new Date(item.joinedAt),
          leftAt: new Date(item.leftAt!),
        })),
      new Date(session.startsAt),
      new Date(session.endsAt),
    );
    return { ...attendance };
  }

  /** Điều chỉnh điểm danh thủ công sau validation và ghi lịch sử trước/sau. */
  async updateAttendance(
    sessionId: string,
    learnerId: string,
    status: AttendanceRecord["status"],
    attendedMinutes: number,
    adjustmentReason: string,
    actorId = "usr-instructor",
  ): Promise<AttendanceRecord> {
    const normalizedReason = adjustmentReason.trim();
    if (normalizedReason.length < 3)
      throw new BadRequestException("Lý do điều chỉnh cần ít nhất 3 ký tự.");
    const prisma = this.database();
    if (prisma) {
      const session = await prisma.liveSession.findUnique({
        where: { id: sessionId },
      });
      if (!session || session.hostId !== actorId)
        throw new NotFoundException(
          "Không tìm thấy buổi học được phép điểm danh.",
        );
      if (session.status !== "COMPLETED")
        throw new ConflictException(
          "Chỉ điều chỉnh điểm danh sau khi buổi học kết thúc.",
        );
      if (session.attendanceLockedAt)
        throw new ConflictException("Kỳ điểm danh đã khóa.");
      this.validateAttendanceMinutes(
        attendedMinutes,
        session.startsAt,
        session.endsAt,
      );
      const enrollment = await prisma.classEnrollment.findFirst({
        where: { classId: session.classId, learnerId, status: "ACTIVE" },
      });
      if (!enrollment)
        throw new BadRequestException("Học viên không thuộc lớp.");
      const row = await prisma.attendanceRecord.upsert({
        where: { sessionId_learnerId: { sessionId, learnerId } },
        update: { status, attendedMinutes, adjustmentReason: normalizedReason },
        create: {
          sessionId,
          learnerId,
          status,
          attendedMinutes,
          adjustmentReason: normalizedReason,
        },
      });
      return this.mapAttendance(row);
    }
    const session = this.findSession(sessionId);
    if (session.hostId !== actorId)
      throw new NotFoundException(
        "Không tìm thấy buổi học được phép điểm danh.",
      );
    if (session.status !== "COMPLETED")
      throw new ConflictException(
        "Chỉ điều chỉnh điểm danh sau khi buổi học kết thúc.",
      );
    if (session.attendanceLockedAt)
      throw new ConflictException("Kỳ điểm danh đã khóa.");
    this.validateAttendanceMinutes(
      attendedMinutes,
      new Date(session.startsAt),
      new Date(session.endsAt),
    );
    if (!this.findClass(session.classId).learnerIds.includes(learnerId))
      throw new BadRequestException("Học viên không thuộc lớp.");
    let record = this.attendance.find(
      (item) => item.sessionId === sessionId && item.learnerId === learnerId,
    );
    if (!record) {
      record = {
        sessionId,
        learnerId,
        attendedMinutes,
        status,
        adjustmentReason: normalizedReason,
      };
      this.attendance.push(record);
    } else
      Object.assign(record, {
        status,
        attendedMinutes,
        adjustmentReason: normalizedReason,
      });
    return { ...record };
  }

  /** Tổng hợp bản ghi điểm danh, lần đồng bộ và khiếu nại của buổi học. */
  async getAttendanceReview(
    sessionId: string,
  ): Promise<AttendanceSessionReview> {
    const prisma = this.database();
    if (prisma) {
      const session = await prisma.liveSession.findUnique({
        where: { id: sessionId },
        include: {
          class: { include: { enrollments: { where: { status: "ACTIVE" } } } },
          attendance: { orderBy: { learnerId: "asc" } },
          appeals: { orderBy: { createdAt: "desc" } },
        },
      });
      if (!session) throw new NotFoundException("Không tìm thấy buổi học.");
      return {
        session: this.mapSession(session),
        enrolledLearnerIds: session.class.enrollments.map(
          (item) => item.learnerId,
        ),
        records: session.attendance.map((item) => this.mapAttendance(item)),
        appeals: session.appeals.map((item) => this.mapAttendanceAppeal(item)),
      };
    }
    const session = this.findSession(sessionId);
    return {
      session: { ...session },
      enrolledLearnerIds: [...this.findClass(session.classId).learnerIds],
      records: this.attendance
        .filter((item) => item.sessionId === sessionId)
        .map((item) => ({
          ...item,
          providerSnapshot: item.providerSnapshot
            ? { ...item.providerSnapshot }
            : undefined,
        })),
      appeals: this.attendanceAppeals
        .filter((item) => item.sessionId === sessionId)
        .map((item) => ({ ...item })),
    };
  }

  /** Chuẩn hóa dữ liệu provider, bỏ user ngoài lớp và upsert attendance trong transaction. */
  async syncAttendance(
    sessionId: string,
    inputRecords: ProviderAttendanceInput[],
    actorId = "usr-manager",
  ): Promise<{ review: AttendanceSessionReview; skippedLearnerIds: string[] }> {
    this.validateProviderAttendanceInput(inputRecords);
    const prisma = this.database();
    if (prisma) {
      const skippedLearnerIds = await prisma.$transaction(
        async (transaction) => {
          const session = await transaction.liveSession.findUnique({
            where: { id: sessionId },
            include: {
              class: {
                include: { enrollments: { where: { status: "ACTIVE" } } },
              },
            },
          });
          if (!session) throw new NotFoundException("Không tìm thấy buổi học.");
          if (session.status !== "COMPLETED")
            throw new ConflictException(
              "Chỉ đồng bộ điểm danh sau khi buổi học kết thúc.",
            );
          if (session.attendanceLockedAt)
            throw new ConflictException("Kỳ điểm danh đã khóa.");
          const enrolledIds = new Set(
            session.class.enrollments.map((item) => item.learnerId),
          );
          const validRecords = inputRecords.filter((item) =>
            enrolledIds.has(item.learnerId),
          );
          const skipped = inputRecords
            .filter((item) => !enrolledIds.has(item.learnerId))
            .map((item) => item.learnerId);
          await transaction.attendanceInterval.deleteMany({
            where: { sessionId, source: "PROVIDER" },
          });
          const byLearner = new Map<string, ProviderAttendanceInput[]>();
          for (const item of validRecords)
            byLearner.set(item.learnerId, [
              ...(byLearner.get(item.learnerId) ?? []),
              item,
            ]);
          for (const [learnerId, records] of byLearner) {
            const intervals = records.map((item) => ({
              joinedAt: new Date(item.joinedAt),
              leftAt: new Date(item.leftAt),
            }));
            for (const interval of intervals)
              this.calculateProviderAttendanceMinutes(
                interval.joinedAt,
                interval.leftAt,
                session.startsAt,
                session.endsAt,
              );
            const attendedMinutes = this.mergedAttendanceMinutes(
              intervals,
              session.startsAt,
              session.endsAt,
            );
            const joinedAt = intervals.reduce(
              (earliest, item) =>
                item.joinedAt < earliest ? item.joinedAt : earliest,
              intervals[0]!.joinedAt,
            );
            const leftAt = intervals.reduce(
              (latest, item) => (item.leftAt > latest ? item.leftAt : latest),
              intervals[0]!.leftAt,
            );
            const status = this.deriveProviderAttendanceStatus(
              joinedAt,
              attendedMinutes,
              session.startsAt,
            );
            const providerSnapshot = {
              intervals: records.map((item) => ({ ...item })),
            } as unknown as Prisma.InputJsonValue;
            await transaction.attendanceRecord.upsert({
              where: { sessionId_learnerId: { sessionId, learnerId } },
              update: {
                joinedAt,
                leftAt,
                attendedMinutes,
                status,
                providerParticipantId: records[0]!.providerParticipantId,
                providerSnapshot,
              },
              create: {
                sessionId,
                learnerId,
                joinedAt,
                leftAt,
                attendedMinutes,
                status,
                providerParticipantId: records[0]!.providerParticipantId,
                providerSnapshot,
              },
            });
            await transaction.attendanceInterval.createMany({
              data: records.map((item) => ({
                id: id("attendance-interval"),
                sessionId,
                learnerId,
                joinedAt: new Date(item.joinedAt),
                leftAt: new Date(item.leftAt),
                source: "PROVIDER",
                providerParticipantId: item.providerParticipantId,
              })),
            });
          }
          const seenLearners = new Set(
            validRecords.map((item) => item.learnerId),
          );
          for (const learnerId of enrolledIds) {
            if (seenLearners.has(learnerId)) continue;
            await transaction.attendanceRecord.upsert({
              where: { sessionId_learnerId: { sessionId, learnerId } },
              update: {},
              create: {
                sessionId,
                learnerId,
                status: "ABSENT",
                attendedMinutes: 0,
                providerSnapshot: { absentFromProviderExport: true },
              },
            });
          }
          await transaction.auditLog.create({
            data: {
              actorId,
              action: "ATTENDANCE_SYNC",
              entityType: "live_session",
              entityId: sessionId,
              context: {
                received: inputRecords.length,
                accepted: validRecords.length,
                skippedLearnerIds: skipped,
              },
            },
          });
          return skipped;
        },
      );
      return {
        review: await this.getAttendanceReview(sessionId),
        skippedLearnerIds,
      };
    }

    const session = this.findSession(sessionId);
    if (session.status !== "COMPLETED")
      throw new ConflictException(
        "Chỉ đồng bộ điểm danh sau khi buổi học kết thúc.",
      );
    if (session.attendanceLockedAt)
      throw new ConflictException("Kỳ điểm danh đã khóa.");
    const enrolledIds = new Set(this.findClass(session.classId).learnerIds);
    const skippedLearnerIds = inputRecords
      .filter((item) => !enrolledIds.has(item.learnerId))
      .map((item) => item.learnerId);
    const seenLearners = new Set<string>();
    const validRecords = inputRecords.filter((record) =>
      enrolledIds.has(record.learnerId),
    );
    const byLearner = new Map<string, ProviderAttendanceInput[]>();
    for (const item of validRecords)
      byLearner.set(item.learnerId, [
        ...(byLearner.get(item.learnerId) ?? []),
        item,
      ]);
    this.attendanceIntervals.splice(
      0,
      this.attendanceIntervals.length,
      ...this.attendanceIntervals.filter(
        (item) => item.sessionId !== sessionId || item.source !== "PROVIDER",
      ),
    );
    for (const [learnerId, records] of byLearner) {
      const intervals = records.map((item) => ({
        joinedAt: new Date(item.joinedAt),
        leftAt: new Date(item.leftAt),
      }));
      for (const interval of intervals)
        this.calculateProviderAttendanceMinutes(
          interval.joinedAt,
          interval.leftAt,
          new Date(session.startsAt),
          new Date(session.endsAt),
        );
      const attendedMinutes = this.mergedAttendanceMinutes(
        intervals,
        new Date(session.startsAt),
        new Date(session.endsAt),
      );
      const joinedAt = intervals.reduce(
        (earliest, item) =>
          item.joinedAt < earliest ? item.joinedAt : earliest,
        intervals[0]!.joinedAt,
      );
      const leftAt = intervals.reduce(
        (latest, item) => (item.leftAt > latest ? item.leftAt : latest),
        intervals[0]!.leftAt,
      );
      const status = this.deriveProviderAttendanceStatus(
        joinedAt,
        attendedMinutes,
        new Date(session.startsAt),
      );
      const providerSnapshot = { intervals: records };
      const existing = this.attendance.find(
        (record) =>
          record.sessionId === sessionId && record.learnerId === learnerId,
      );
      if (existing)
        Object.assign(existing, {
          joinedAt: joinedAt.toISOString(),
          leftAt: leftAt.toISOString(),
          attendedMinutes,
          status,
          providerParticipantId: records[0]!.providerParticipantId,
          providerSnapshot,
        });
      else
        this.attendance.push({
          sessionId,
          learnerId,
          joinedAt: joinedAt.toISOString(),
          leftAt: leftAt.toISOString(),
          attendedMinutes,
          status,
          providerParticipantId: records[0]!.providerParticipantId,
          providerSnapshot,
        });
      this.attendanceIntervals.push(
        ...records.map((item) => ({
          sessionId,
          learnerId,
          joinedAt: item.joinedAt,
          leftAt: item.leftAt,
          source: "PROVIDER" as const,
        })),
      );
      seenLearners.add(learnerId);
    }
    for (const learnerId of enrolledIds) {
      if (
        !seenLearners.has(learnerId) &&
        !this.attendance.some(
          (item) =>
            item.sessionId === sessionId && item.learnerId === learnerId,
        )
      )
        this.attendance.push({
          sessionId,
          learnerId,
          attendedMinutes: 0,
          status: "ABSENT",
          providerSnapshot: { absentFromProviderExport: true },
        });
    }
    return {
      review: await this.getAttendanceReview(sessionId),
      skippedLearnerIds,
    };
  }

  /** Khóa điểm danh sau khi buổi kết thúc và không còn dữ liệu cần đối soát. */
  async lockAttendance(
    sessionId: string,
    actorId = "usr-manager",
  ): Promise<LiveSession> {
    const prisma = this.database();
    if (prisma) {
      return prisma.$transaction(async (transaction) => {
        const session = await transaction.liveSession.findUnique({
          where: { id: sessionId },
          include: {
            appeals: { where: { status: { in: ["OPEN", "IN_REVIEW"] } } },
          },
        });
        if (!session) throw new NotFoundException("Không tìm thấy buổi học.");
        if (session.status !== "COMPLETED")
          throw new ConflictException(
            "Chỉ khóa điểm danh của buổi học đã kết thúc.",
          );
        if (session.attendanceLockedAt)
          throw new ConflictException("Kỳ điểm danh đã được khóa trước đó.");
        if (session.appeals.length)
          throw new ConflictException(
            "Cần xử lý hết yêu cầu điều chỉnh trước khi khóa.",
          );
        const updated = await transaction.liveSession.update({
          where: { id: sessionId },
          data: {
            attendanceLockedAt: new Date(),
            attendanceLockedById: actorId,
          },
        });
        await transaction.auditLog.create({
          data: {
            actorId,
            action: "ATTENDANCE_LOCK",
            entityType: "live_session",
            entityId: sessionId,
            context: { lockedAt: updated.attendanceLockedAt?.toISOString() },
          },
        });
        return this.mapSession(updated);
      });
    }
    const session = this.findSession(sessionId);
    if (session.status !== "COMPLETED")
      throw new ConflictException(
        "Chỉ khóa điểm danh của buổi học đã kết thúc.",
      );
    if (session.attendanceLockedAt)
      throw new ConflictException("Kỳ điểm danh đã được khóa trước đó.");
    if (
      this.attendanceAppeals.some(
        (item) =>
          item.sessionId === sessionId &&
          ["OPEN", "IN_REVIEW"].includes(item.status),
      )
    )
      throw new ConflictException(
        "Cần xử lý hết yêu cầu điều chỉnh trước khi khóa.",
      );
    session.attendanceLockedAt = now();
    session.attendanceLockedById = actorId;
    return { ...session };
  }

  /** Giải quyết khiếu nại và nếu duyệt thì cập nhật điểm danh cùng audit nguyên tử. */
  async resolveAttendanceAppeal(
    appealId: string,
    decision: "APPROVE" | "REJECT",
    resolution: string,
    status?: AttendanceRecord["status"],
    attendedMinutes?: number,
    actorId = "usr-manager",
  ): Promise<AttendanceAppeal> {
    const normalizedResolution = resolution.trim();
    if (normalizedResolution.length < 5)
      throw new BadRequestException("Kết luận xử lý cần ít nhất 5 ký tự.");
    if (
      decision === "APPROVE" &&
      (status === undefined || attendedMinutes === undefined)
    )
      throw new BadRequestException(
        "Cần trạng thái và số phút mới khi phê duyệt điều chỉnh.",
      );
    const prisma = this.database();
    if (prisma) {
      return prisma.$transaction(async (transaction) => {
        const appeal = await transaction.attendanceAppeal.findUnique({
          where: { id: appealId },
          include: { session: true },
        });
        if (!appeal)
          throw new NotFoundException("Không tìm thấy yêu cầu điều chỉnh.");
        if (!["OPEN", "IN_REVIEW"].includes(appeal.status))
          throw new ConflictException("Yêu cầu đã được xử lý.");
        if (appeal.session.attendanceLockedAt)
          throw new ConflictException("Kỳ điểm danh đã khóa.");
        if (decision === "APPROVE") {
          this.validateAttendanceMinutes(
            attendedMinutes!,
            appeal.session.startsAt,
            appeal.session.endsAt,
          );
          await transaction.attendanceRecord.update({
            where: {
              sessionId_learnerId: {
                sessionId: appeal.sessionId,
                learnerId: appeal.learnerId,
              },
            },
            data: {
              status,
              attendedMinutes,
              adjustmentReason: normalizedResolution,
            },
          });
        }
        const updated = await transaction.attendanceAppeal.update({
          where: { id: appealId },
          data: {
            status: decision === "APPROVE" ? "RESOLVED" : "REJECTED",
            resolution: normalizedResolution,
          },
        });
        await transaction.auditLog.create({
          data: {
            actorId,
            action: `ATTENDANCE_APPEAL_${decision}`,
            entityType: "attendance_appeal",
            entityId: appealId,
            context: {
              sessionId: appeal.sessionId,
              learnerId: appeal.learnerId,
              status,
              attendedMinutes,
              resolution: normalizedResolution,
            },
          },
        });
        await transaction.notification.create({
          data: {
            id: id("notification"),
            recipientId: appeal.learnerId,
            type: "ATTENDANCE_APPEAL_RESOLVED",
            title:
              decision === "APPROVE"
                ? "Yêu cầu điểm danh đã được chấp thuận"
                : "Yêu cầu điểm danh không được chấp thuận",
            entityType: "ATTENDANCE_APPEAL",
            entityId: appealId,
            dedupKey: `attendance-appeal:${appealId}:${decision}`,
          },
        });
        return this.mapAttendanceAppeal(updated);
      });
    }
    const appeal = this.attendanceAppeals.find((item) => item.id === appealId);
    if (!appeal)
      throw new NotFoundException("Không tìm thấy yêu cầu điều chỉnh.");
    if (!["OPEN", "IN_REVIEW"].includes(appeal.status))
      throw new ConflictException("Yêu cầu đã được xử lý.");
    const session = this.findSession(appeal.sessionId);
    if (session.attendanceLockedAt)
      throw new ConflictException("Kỳ điểm danh đã khóa.");
    if (decision === "APPROVE") {
      this.validateAttendanceMinutes(
        attendedMinutes!,
        new Date(session.startsAt),
        new Date(session.endsAt),
      );
      const record = this.attendance.find(
        (item) =>
          item.sessionId === appeal.sessionId &&
          item.learnerId === appeal.learnerId,
      );
      if (!record)
        throw new NotFoundException(
          "Không tìm thấy dữ liệu điểm danh cần điều chỉnh.",
        );
      Object.assign(record, {
        status,
        attendedMinutes,
        adjustmentReason: normalizedResolution,
      });
    }
    appeal.status = decision === "APPROVE" ? "RESOLVED" : "REJECTED";
    appeal.resolution = normalizedResolution;
    this.notifications.unshift({
      id: id("notification"),
      recipientId: appeal.learnerId,
      type: "ATTENDANCE_APPEAL_RESOLVED",
      title:
        decision === "APPROVE"
          ? "Yêu cầu điểm danh đã được chấp thuận"
          : "Yêu cầu điểm danh không được chấp thuận",
      entityType: "ATTENDANCE_APPEAL",
      entityId: appealId,
      createdAt: now(),
    });
    return { ...appeal };
  }

  /** Gắn nguồn bản ghi cho buổi đã hoàn tất và chuyển sang trạng thái xử lý. */
  async attachRecording(
    sessionId: string,
    recordingUrl: string,
    actorId = "usr-instructor",
  ): Promise<LiveSession> {
    const prisma = this.database();
    if (prisma) {
      const item = await prisma.liveSession.findUnique({
        where: { id: sessionId },
      });
      if (!item || item.hostId !== actorId)
        throw new NotFoundException(
          "Không tìm thấy buổi học được phép cập nhật bản ghi.",
        );
      if (item.status !== "COMPLETED")
        throw new BadRequestException(
          "Chỉ gắn bản ghi sau khi buổi học kết thúc.",
        );
      return this.mapSession(
        await prisma.liveSession.update({
          where: { id: sessionId },
          data: {
            recordingUrl,
            recordingStatus: "PROCESSING",
            recordingReadyAt: null,
            recordingExpiresAt: null,
            recordingError: null,
          },
        }),
      );
    }
    const item = this.findSession(sessionId);
    if (item.hostId !== actorId)
      throw new NotFoundException(
        "Không tìm thấy buổi học được phép cập nhật bản ghi.",
      );
    if (item.status !== "COMPLETED")
      throw new BadRequestException(
        "Chỉ gắn bản ghi sau khi buổi học kết thúc.",
      );
    item.recordingUrl = recordingUrl;
    item.recordingStatus = "PROCESSING";
    item.recordingReadyAt = undefined;
    item.recordingExpiresAt = undefined;
    item.recordingError = undefined;
    return { ...item };
  }

  /** Chốt xử lý bản ghi, tính ngày hết hạn hoặc lưu lỗi và thông báo học viên khi sẵn sàng. */
  async completeRecording(
    sessionId: string,
    status: "READY" | "FAILED",
    retentionDays = 90,
    errorMessage?: string,
    actorId = "usr-instructor",
  ): Promise<LiveSession> {
    const normalizedError = errorMessage?.trim();
    if (status === "FAILED" && (!normalizedError || normalizedError.length < 5))
      throw new BadRequestException(
        "Cần mô tả lỗi xử lý bản ghi ít nhất 5 ký tự.",
      );
    const readyAt = status === "READY" ? new Date() : null;
    const expiresAt = readyAt
      ? new Date(readyAt.getTime() + retentionDays * 86_400_000)
      : null;
    const prisma = this.database();
    if (prisma) {
      return prisma.$transaction(async (transaction) => {
        const current = await transaction.liveSession.findUnique({
          where: { id: sessionId },
        });
        if (!current || current.hostId !== actorId)
          throw new NotFoundException(
            "Không tìm thấy buổi học được phép cập nhật bản ghi.",
          );
        if (current.status !== "COMPLETED" || !current.recordingUrl)
          throw new ConflictException("Buổi học chưa có bản ghi để cập nhật.");
        if (current.recordingStatus !== "PROCESSING")
          throw new ConflictException("Bản ghi không ở trạng thái đang xử lý.");
        const updated = await transaction.liveSession.update({
          where: { id: sessionId },
          data: {
            recordingStatus: status,
            recordingReadyAt: readyAt,
            recordingExpiresAt: expiresAt,
            recordingError: status === "FAILED" ? normalizedError : null,
          },
        });
        await transaction.auditLog.create({
          data: {
            actorId,
            action: `RECORDING_${status}`,
            entityType: "live_session",
            entityId: sessionId,
            context: {
              retentionDays,
              expiresAt,
              errorMessage: normalizedError,
            },
          },
        });
        if (status === "READY")
          await this.notifyClassMembers(
            transaction,
            current.classId,
            "RECORDING_READY",
            `Bản ghi đã sẵn sàng: ${current.title}`,
            sessionId,
          );
        return this.mapSession(updated);
      });
    }
    const item = this.findSession(sessionId);
    if (item.hostId !== actorId)
      throw new NotFoundException(
        "Không tìm thấy buổi học được phép cập nhật bản ghi.",
      );
    if (item.status !== "COMPLETED" || !item.recordingUrl)
      throw new ConflictException("Buổi học chưa có bản ghi để cập nhật.");
    if (item.recordingStatus !== "PROCESSING")
      throw new ConflictException("Bản ghi không ở trạng thái đang xử lý.");
    item.recordingStatus = status;
    item.recordingReadyAt = readyAt?.toISOString();
    item.recordingExpiresAt = expiresAt?.toISOString();
    item.recordingError = status === "FAILED" ? normalizedError : undefined;
    return { ...item };
  }

  /** Kiểm tra bản ghi READY, có URL và chưa vượt thời hạn lưu giữ. */
  private isRecordingAvailable(
    session: Pick<
      LiveSession,
      "recordingUrl" | "recordingStatus" | "recordingExpiresAt"
    >,
  ): boolean {
    return Boolean(
      session.recordingUrl &&
        session.recordingStatus === "READY" &&
        session.recordingExpiresAt &&
        new Date(session.recordingExpiresAt) > new Date(),
    );
  }

  /** Trả tóm tắt buổi học, trạng thái điểm danh và khả năng xem bản ghi của học viên. */
  async getSessionSummary(
    sessionId: string,
    learnerId = "usr-learner",
  ): Promise<object> {
    const prisma = this.database();
    if (prisma) {
      const session = await prisma.liveSession.findUnique({
        where: { id: sessionId },
      });
      if (!session) throw new NotFoundException("Không tìm thấy buổi học.");
      const enrollment = await prisma.classEnrollment.findFirst({
        where: { classId: session.classId, learnerId, status: "ACTIVE" },
      });
      if (!enrollment)
        throw new NotFoundException("Học viên không thuộc lớp của buổi học.");
      const attendance = await prisma.attendanceRecord.findUnique({
        where: { sessionId_learnerId: { sessionId, learnerId } },
      });
      const appeal = await prisma.attendanceAppeal.findFirst({
        where: { sessionId, learnerId },
        orderBy: { createdAt: "desc" },
      });
      const mapped = this.mapSession(session);
      return {
        session: {
          ...mapped,
          hostUrl: "",
          attendeeUrl: "",
          recordingUrl: undefined,
        },
        recordingAvailable: this.isRecordingAvailable(mapped),
        attendance: attendance
          ? this.mapAttendance(attendance)
          : { sessionId, learnerId, attendedMinutes: 0, status: "ABSENT" },
        appeal: appeal ? this.mapAttendanceAppeal(appeal) : undefined,
      };
    }
    const session = this.findSession(sessionId);
    if (!this.findClass(session.classId).learnerIds.includes(learnerId))
      throw new NotFoundException("Học viên không thuộc lớp của buổi học.");
    return {
      session: {
        ...session,
        hostUrl: "",
        attendeeUrl: "",
        recordingUrl: undefined,
      },
      recordingAvailable: this.isRecordingAvailable(session),
      attendance: this.attendance.find(
        (item) => item.sessionId === sessionId && item.learnerId === learnerId,
      ) ?? { sessionId, learnerId, attendedMinutes: 0, status: "ABSENT" },
      appeal: this.attendanceAppeals.find(
        (item) => item.sessionId === sessionId && item.learnerId === learnerId,
      ),
    };
  }

  /** Phát URL nội bộ ký theo session, learner và hạn để bảo vệ bản ghi. */
  async createRecordingAccess(
    sessionId: string,
    learnerId = "usr-learner",
  ): Promise<{ url: string; expiresAt: string }> {
    const prisma = this.database();
    if (prisma) {
      const session = await prisma.liveSession.findFirst({
        where: {
          id: sessionId,
          status: "COMPLETED",
          recordingStatus: "READY",
          recordingUrl: { not: null },
          recordingExpiresAt: { gt: new Date() },
          class: { enrollments: { some: { learnerId, status: "ACTIVE" } } },
        },
      });
      if (!session)
        throw new NotFoundException(
          "Bản ghi chưa sẵn sàng hoặc học viên không có quyền xem.",
        );
    } else {
      const session = this.findSession(sessionId);
      if (
        session.status !== "COMPLETED" ||
        !this.isRecordingAvailable(session) ||
        !this.findClass(session.classId).learnerIds.includes(learnerId)
      )
        throw new NotFoundException(
          "Bản ghi chưa sẵn sàng, đã hết hạn hoặc học viên không có quyền xem.",
        );
    }
    const expires = Math.floor(Date.now() / 1000) + 300;
    const signature = this.signRecordingAccess(sessionId, expires, learnerId);
    return {
      url: `/learner/sessions/${sessionId}/recording?expires=${expires}&signature=${encodeURIComponent(signature)}`,
      expiresAt: new Date(expires * 1000).toISOString(),
    };
  }

  /** Xác minh chữ ký/hạn/quyền học viên rồi mới trả URL provider thực. */
  async resolveRecordingAccess(
    sessionId: string,
    expires: number,
    signature: string,
    learnerId = "usr-learner",
  ): Promise<{ recordingUrl: string }> {
    this.verifyExpiringSignature(
      this.signRecordingAccess(sessionId, expires, learnerId),
      expires,
      signature,
      "Chữ ký bản ghi không hợp lệ.",
    );
    const prisma = this.database();
    if (prisma) {
      const session = await prisma.liveSession.findFirst({
        where: {
          id: sessionId,
          status: "COMPLETED",
          recordingStatus: "READY",
          recordingUrl: { not: null },
          recordingExpiresAt: { gt: new Date() },
          class: { enrollments: { some: { learnerId, status: "ACTIVE" } } },
        },
      });
      if (!session?.recordingUrl)
        throw new NotFoundException(
          "Bản ghi chưa sẵn sàng hoặc học viên không có quyền xem.",
        );
      return { recordingUrl: session.recordingUrl };
    }
    const session = this.findSession(sessionId);
    if (
      session.status !== "COMPLETED" ||
      !this.isRecordingAvailable(session) ||
      !this.findClass(session.classId).learnerIds.includes(learnerId)
    )
      throw new NotFoundException(
        "Bản ghi chưa sẵn sàng, đã hết hạn hoặc học viên không có quyền xem.",
      );
    return { recordingUrl: session.recordingUrl! };
  }

  /** Tạo khiếu nại điểm danh duy nhất cho học viên đã tham dự buổi học. */
  async requestAttendanceAppeal(
    sessionId: string,
    reason: string,
    learnerId = "usr-learner",
  ): Promise<AttendanceAppeal> {
    const normalized = reason.trim();
    if (normalized.length < 10)
      throw new BadRequestException("Lý do điều chỉnh cần ít nhất 10 ký tự.");
    const prisma = this.database();
    if (prisma) {
      const session = await prisma.liveSession.findFirst({
        where: {
          id: sessionId,
          status: "COMPLETED",
          class: { enrollments: { some: { learnerId, status: "ACTIVE" } } },
        },
        include: {
          attendance: { where: { learnerId } },
          appeals: {
            where: { learnerId, status: { in: ["OPEN", "IN_REVIEW"] } },
          },
        },
      });
      if (!session)
        throw new NotFoundException(
          "Không tìm thấy buổi học được phép yêu cầu điều chỉnh.",
        );
      if (!session.attendance.length)
        throw new BadRequestException(
          "Chưa có dữ liệu điểm danh để yêu cầu điều chỉnh.",
        );
      if (session.appeals.length)
        throw new ConflictException(
          "Đã có yêu cầu điều chỉnh đang được xử lý.",
        );
      return this.mapAttendanceAppeal(
        await prisma.attendanceAppeal.create({
          data: {
            id: id("attendance-appeal"),
            sessionId,
            learnerId,
            reason: normalized,
          },
        }),
      );
    }
    const session = this.findSession(sessionId);
    if (
      session.status !== "COMPLETED" ||
      !this.findClass(session.classId).learnerIds.includes(learnerId)
    )
      throw new NotFoundException(
        "Không tìm thấy buổi học được phép yêu cầu điều chỉnh.",
      );
    if (
      !this.attendance.some(
        (item) => item.sessionId === sessionId && item.learnerId === learnerId,
      )
    )
      throw new BadRequestException(
        "Chưa có dữ liệu điểm danh để yêu cầu điều chỉnh.",
      );
    if (
      this.attendanceAppeals.some(
        (item) =>
          item.sessionId === sessionId &&
          item.learnerId === learnerId &&
          ["OPEN", "IN_REVIEW"].includes(item.status),
      )
    )
      throw new ConflictException("Đã có yêu cầu điều chỉnh đang được xử lý.");
    const appeal: AttendanceAppeal = {
      id: id("attendance-appeal"),
      sessionId,
      learnerId,
      reason: normalized,
      status: "OPEN",
      createdAt: now(),
    };
    this.attendanceAppeals.unshift(appeal);
    return { ...appeal };
  }

  /** Liệt kê tất cả phiếu cho nhân sự hỗ trợ hoặc chỉ phiếu của người gửi. */
  async listTickets(
    role: string,
    actorId = this.userIdForRole(role),
  ): Promise<SupportTicket[]> {
    const canManage = this.canManageSupport(role);
    const prisma = this.database();
    if (prisma) {
      const rows = await prisma.supportTicket.findMany({
        where: canManage ? undefined : { reporterId: actorId },
        include: { attachments: true },
        orderBy: [{ status: "asc" }, { createdAt: "desc" }],
      });
      return rows.map((row) => this.mapTicket(row));
    }
    return this.tickets
      .filter((item) => canManage || item.reporterId === actorId)
      .map((item) => ({
        ...item,
        attachments: item.attachments.map((attachment) => ({ ...attachment })),
      }));
  }

  /** Validate nội dung, chống phiếu trùng đang mở và tạo SLA theo mức độ nghiêm trọng. */
  async createTicket(
    input: Pick<
      SupportTicket,
      "category" | "severity" | "description" | "contextId"
    > & { clientRequestId?: string },
    reporterId = "usr-learner",
  ): Promise<SupportTicket> {
    const slaHours: Record<SupportTicket["severity"], number> = {
      P0: 4,
      P1: 24,
      P2: 72,
      P3: 120,
    };
    const description = this.validateSupportText(
      input.description,
      "Mô tả yêu cầu",
    );
    const category = input.category.trim();
    const contextId = input.contextId?.trim() || undefined;
    const clientRequestId = input.clientRequestId?.trim() || undefined;
    const prisma = this.database();
    if (prisma) {
      try {
        return await prisma.$transaction(async (transaction) => {
        const duplicate = await transaction.supportTicket.findFirst({
          where: {
            reporterId,
            category,
            status: { in: ["OPEN", "IN_PROGRESS"] },
            createdAt: { gte: new Date(Date.now() - 24 * 3_600_000) },
            ...(contextId ? { contextId } : { description }),
          },
          orderBy: { createdAt: "desc" },
        });
        const ticketId = id("ticket");
        const ticketData = {
            id: ticketId,
            clientRequestId: clientRequestId ?? null,
            reporterId,
            category,
            severity: input.severity,
            description,
            contextId: contextId ?? null,
            duplicateOfId: duplicate?.id,
            dueAt: new Date(Date.now() + slaHours[input.severity] * 3_600_000),
          };
        const created = clientRequestId
          ? await transaction.supportTicket.upsert({
              where: { reporterId_clientRequestId: { reporterId, clientRequestId } },
              update: {},
              create: ticketData,
              include: { attachments: true },
            })
          : await transaction.supportTicket.create({ data: ticketData, include: { attachments: true } });
        if (created.id !== ticketId) return this.mapTicket(created);
        if (input.severity === "P0") {
          const adminIds = await this.userIdsForRole(
            transaction,
            "SYSTEM_ADMIN",
          );
          await transaction.notification.createMany({
            data: adminIds.map((recipientId) => ({
              id: id("notification"),
              recipientId,
              type: "SUPPORT_P0",
              title: `P0 mới: ${category}${contextId ? ` · ${contextId}` : ""}`,
              entityType: "SUPPORT_TICKET",
              entityId: ticketId,
              dedupKey: `support-p0:${ticketId}:${recipientId}`,
            })),
            skipDuplicates: true,
          });
        }
          return this.mapTicket(created);
        });
      } catch (error) {
        const uniqueRace =
          clientRequestId &&
          typeof error === "object" &&
          error !== null &&
          "code" in error &&
          error.code === "P2002";
        if (uniqueRace) {
          const existing = await prisma.supportTicket.findUnique({
            where: {
              reporterId_clientRequestId: { reporterId, clientRequestId },
            },
            include: { attachments: true },
          });
          if (existing) return this.mapTicket(existing);
        }
        throw error;
      }
    }
    if (clientRequestId) {
      const existing = this.tickets.find(
        (ticket) => ticket.reporterId === reporterId && ticket.clientRequestId === clientRequestId,
      );
      if (existing) return { ...existing, attachments: [...existing.attachments] };
    }
    const duplicate = this.tickets.find(
      (ticket) =>
        ticket.reporterId === reporterId &&
        ticket.category === category &&
        ["OPEN", "IN_PROGRESS"].includes(ticket.status) &&
        Date.now() - new Date(ticket.createdAt).getTime() <= 24 * 3_600_000 &&
        (contextId
          ? ticket.contextId === contextId
          : ticket.description === description),
    );
    const item: SupportTicket = {
      ...input,
      category,
      description,
      contextId,
      duplicateOfId: duplicate?.id,
      clientRequestId,
      id: id("ticket"),
      reporterId,
      status: "OPEN",
      dueAt: new Date(
        Date.now() + slaHours[input.severity] * 3_600_000,
      ).toISOString(),
      attachments: [],
      createdAt: now(),
      updatedAt: now(),
    };
    this.tickets.unshift(item);
    if (input.severity === "P0")
      this.notifications.unshift({
        id: id("notification"),
        recipientId: this.userIdForRole("SYSTEM_ADMIN"),
        type: "SUPPORT_P0",
        title: `P0 mới: ${category}${contextId ? ` · ${contextId}` : ""}`,
        entityType: "SUPPORT_TICKET",
        entityId: item.id,
        createdAt: now(),
      });
    return { ...item, attachments: [] };
  }

  /** Adapter tương thích cũ ánh xạ vai trò demo sang userId để đọc thông báo. */
  listRoleNotifications(role: string): Promise<LearningNotification[]> {
    return this.listNotifications(this.userIdForRole(role));
  }

  /** Adapter tương thích cũ đánh dấu thông báo theo userId mặc định của vai trò. */
  markRoleNotificationRead(
    notificationId: string,
    role: string,
  ): Promise<LearningNotification> {
    return this.markNotificationRead(notificationId, this.userIdForRole(role));
  }

  /** Kiểm tra quyền phiếu, magic bytes/virus rồi lưu tệp bằng chứng và metadata. */
  async addSupportAttachment(
    ticketId: string,
    upload: UploadedMaterialFile,
    role: string,
    uploaderId = this.userIdForRole(role),
  ): Promise<SupportAttachment> {
    const canManage = this.canManageSupport(role);
    this.validateSupportUpload(upload);
    const quarantineReason = await this.scanUpload(upload);
    if (quarantineReason)
      throw new BadRequestException(
        `Tệp bằng chứng bị từ chối: ${quarantineReason}`,
      );
    const attachmentId = id("support-attachment");
    const safeExtension = extname(upload.originalName)
      .toLowerCase()
      .replace(/[^.a-z0-9]/g, "");
    const objectKey = `support/${ticketId}/${attachmentId}${safeExtension}`;
    const checksum = `sha256:${createHash("sha256").update(upload.buffer).digest("hex")}`;
    const prisma = this.database();
    if (prisma) {
      const ticket = await prisma.supportTicket.findUnique({
        where: { id: ticketId },
      });
      if (!ticket || (!canManage && ticket.reporterId !== uploaderId))
        throw new NotFoundException(
          "Không tìm thấy ticket được phép đính kèm.",
        );
      if (["RESOLVED", "CLOSED"].includes(ticket.status))
        throw new BadRequestException(
          "Ticket đã hoàn tất, không thể thêm bằng chứng.",
        );
      const stored = await this.writeStoredFile(objectKey, upload.buffer);
      try {
        const row = await prisma.supportAttachment.create({
          data: {
            id: attachmentId,
            ticketId,
            uploaderId,
            name: upload.originalName,
            objectKey: stored.objectKey,
            mimeType: upload.mimeType,
            sizeBytes: upload.size,
            checksum: stored.checksum,
          },
        });
        return {
          id: row.id,
          ticketId: row.ticketId,
          name: row.name,
          mimeType: row.mimeType,
          sizeBytes: Number(row.sizeBytes),
          checksum: row.checksum,
          createdAt: row.createdAt.toISOString(),
        };
      } catch (error) {
        await this.removeStoredFile(stored.objectKey);
        throw error;
      }
    }
    const ticket = this.tickets.find((item) => item.id === ticketId);
    if (!ticket || (!canManage && ticket.reporterId !== uploaderId))
      throw new NotFoundException("Không tìm thấy ticket được phép đính kèm.");
    if (["RESOLVED", "CLOSED"].includes(ticket.status))
      throw new BadRequestException(
        "Ticket đã hoàn tất, không thể thêm bằng chứng.",
      );
    await this.writeStoredFile(objectKey, upload.buffer);
    const attachment: SupportAttachment = {
      id: attachmentId,
      ticketId,
      name: upload.originalName,
      mimeType: upload.mimeType,
      sizeBytes: upload.size,
      checksum,
      createdAt: now(),
    };
    this.supportAttachmentFiles.set(attachmentId, objectKey);
    ticket.attachments.push(attachment);
    return { ...attachment };
  }

  /** Trả bytes bằng chứng cho đúng người gửi hoặc vai trò quản lý hỗ trợ. */
  async readSupportAttachment(
    ticketId: string,
    attachmentId: string,
    role: string,
    actorId = this.userIdForRole(role),
  ): Promise<MaterialDownload> {
    const canManage = this.canManageSupport(role);
    const prisma = this.database();
    if (prisma) {
      const attachment = await prisma.supportAttachment.findFirst({
        where: { id: attachmentId, ticketId },
        include: { ticket: true },
      });
      if (
        !attachment ||
        (!canManage && attachment.ticket.reporterId !== actorId)
      )
        throw new NotFoundException(
          "Không tìm thấy bằng chứng hỗ trợ được phép xem.",
        );
      const buffer = await this.readStoredFile(attachment.objectKey);
      if (
        `sha256:${createHash("sha256").update(buffer).digest("hex")}` !==
        attachment.checksum
      )
        throw new BadRequestException(
          "Checksum bằng chứng hỗ trợ không hợp lệ.",
        );
      return {
        fileName: normalizeMultipartFileName(attachment.name),
        mimeType: attachment.mimeType,
        buffer,
      };
    }
    const ticket = this.tickets.find((item) => item.id === ticketId);
    const attachment = ticket?.attachments.find(
      (item) => item.id === attachmentId,
    );
    const objectKey = this.supportAttachmentFiles.get(attachmentId);
    if (
      !ticket ||
      !attachment ||
      !objectKey ||
      (!canManage && ticket.reporterId !== actorId)
    )
      throw new NotFoundException(
        "Không tìm thấy bằng chứng hỗ trợ được phép xem.",
      );
    const buffer = await this.readStoredFile(objectKey);
    if (
      `sha256:${createHash("sha256").update(buffer).digest("hex")}` !==
      attachment.checksum
    )
      throw new BadRequestException("Checksum bằng chứng hỗ trợ không hợp lệ.");
    return {
      fileName: normalizeMultipartFileName(attachment.name),
      mimeType: attachment.mimeType,
      buffer,
    };
  }

  /** Cập nhật người phụ trách/trạng thái/kết quả và ghi audit chuyển trạng thái. */
  async updateTicket(
    ticketId: string,
    input: Partial<
      Pick<SupportTicket, "status" | "assigneeId" | "resolution">
    > & { expectedUpdatedAt?: string },
    actorId = "usr-admin",
  ): Promise<SupportTicket> {
    if (input.status === "CLOSED")
      throw new BadRequestException(
        "Người gửi phải là người xác nhận đóng phiếu sau khi nhận kết quả.",
      );
    if (input.status === "RESOLVED" && !input.resolution?.trim())
      throw new BadRequestException(
        "Cần ghi nội dung xử lý trước khi hoàn tất.",
      );
    const prisma = this.database();
    if (prisma) {
      return prisma.$transaction(async (transaction) => {
        const item = await transaction.supportTicket.findUnique({
          where: { id: ticketId },
        });
        if (!item) throw new NotFoundException("Không tìm thấy ticket.");
        const expectedUpdatedAt = input.expectedUpdatedAt
          ? new Date(input.expectedUpdatedAt)
          : item.updatedAt;
        if (Number.isNaN(expectedUpdatedAt.getTime()))
          throw new BadRequestException("Phiên bản phiếu hỗ trợ không hợp lệ.");
        if (item.status === "CLOSED")
          throw new ConflictException("Phiếu đã đóng và không thể thay đổi.");
        const nextStatus =
          input.status ??
          (item.status === "OPEN" && input.assigneeId
            ? "IN_PROGRESS"
            : item.status);
        const allowedTransitions: Record<
          SupportTicket["status"],
          SupportTicket["status"][]
        > = {
          OPEN: ["OPEN", "IN_PROGRESS"],
          IN_PROGRESS: ["IN_PROGRESS", "RESOLVED"],
          RESOLVED: ["RESOLVED"],
          CLOSED: [],
        };
        if (!allowedTransitions[item.status].includes(nextStatus))
          throw new ConflictException(
            `Không thể chuyển phiếu từ ${item.status} sang ${nextStatus}.`,
          );
        const assigneeId = input.assigneeId ?? item.assigneeId;
        if (["IN_PROGRESS", "RESOLVED"].includes(nextStatus) && !assigneeId)
          throw new BadRequestException(
            "Cần phân công người xử lý trước khi tiếp nhận hoặc hoàn tất phiếu.",
          );
        if (assigneeId) {
          const assignee = await transaction.user.findFirst({
            where: {
              id: assigneeId,
              status: "ACTIVE",
              roles: {
                some: {
                  role: {
                    permissions: {
                      some: { permission: { code: "support:manage" } },
                    },
                  },
                },
              },
            },
            select: { id: true },
          });
          if (!assignee)
            throw new BadRequestException(
              "Người xử lý phải là tài khoản hoạt động có quyền support:manage.",
            );
        }
        const changed = await transaction.supportTicket.updateMany({
          where: { id: ticketId, updatedAt: expectedUpdatedAt },
          data: {
            status: nextStatus,
            assigneeId,
            resolution:
              nextStatus === "RESOLVED"
                ? input.resolution!.trim()
                : item.resolution,
          },
        });
        if (changed.count !== 1)
          throw new ConflictException(
            "Phiếu vừa thay đổi ở nơi khác. Hãy tải lại trước khi xử lý.",
          );
        const updated = await transaction.supportTicket.findUniqueOrThrow({
          where: { id: ticketId },
          include: { attachments: true },
        });
        await transaction.auditLog.create({
          data: {
            actorId,
            action: "SUPPORT_TICKET_UPDATED",
            entityType: "support_ticket",
            entityId: ticketId,
            context: {
              previousStatus: item.status,
              nextStatus,
              assigneeId,
            },
          },
        });
        const recipients = new Set([
          item.reporterId,
          ...(assigneeId && assigneeId !== actorId ? [assigneeId] : []),
        ]);
        await transaction.notification.createMany({
          data: [...recipients].map((recipientId) => ({
            id: id("notification"),
            recipientId,
            type:
              nextStatus === "RESOLVED"
                ? "SUPPORT_RESOLVED"
                : "SUPPORT_UPDATED",
            title:
              nextStatus === "RESOLVED"
                ? "Phiếu hỗ trợ đã có kết quả"
                : "Phiếu hỗ trợ đã được tiếp nhận",
            entityType: "SUPPORT_TICKET",
            entityId: ticketId,
            dedupKey: `support-update:${ticketId}:${updated.updatedAt.getTime()}:${recipientId}`,
          })),
        });
        return this.mapTicket(updated);
      });
    }
    const item = this.tickets.find((ticket) => ticket.id === ticketId);
    if (!item) throw new NotFoundException("Không tìm thấy ticket.");
    if (item.status === "CLOSED")
      throw new ConflictException("Phiếu đã đóng và không thể thay đổi.");
    const nextStatus =
      input.status ??
      (item.status === "OPEN" && input.assigneeId
        ? "IN_PROGRESS"
        : item.status);
    const allowedTransitions: Record<
      SupportTicket["status"],
      SupportTicket["status"][]
    > = {
      OPEN: ["OPEN", "IN_PROGRESS"],
      IN_PROGRESS: ["IN_PROGRESS", "RESOLVED"],
      RESOLVED: ["RESOLVED"],
      CLOSED: [],
    };
    if (!allowedTransitions[item.status].includes(nextStatus))
      throw new ConflictException(
        `Không thể chuyển phiếu từ ${item.status} sang ${nextStatus}.`,
      );
    const assigneeId = input.assigneeId ?? item.assigneeId;
    if (["IN_PROGRESS", "RESOLVED"].includes(nextStatus) && !assigneeId)
      throw new BadRequestException(
        "Cần phân công người xử lý trước khi tiếp nhận hoặc hoàn tất phiếu.",
      );
    Object.assign(item, {
      status: nextStatus,
      assigneeId,
      resolution:
        nextStatus === "RESOLVED" ? input.resolution?.trim() : item.resolution,
      updatedAt: now(),
    });
    return {
      ...item,
      attachments: item.attachments.map((attachment) => ({ ...attachment })),
    };
  }

  /** Cho đúng người gửi đóng phiếu chưa hoàn tất và ghi mốc đóng. */
  async closeTicketByReporter(
    ticketId: string,
    reporterId = "usr-learner",
  ): Promise<SupportTicket> {
    const prisma = this.database();
    if (prisma) {
      return prisma.$transaction(async (transaction) => {
        const item = await transaction.supportTicket.findFirst({
          where: { id: ticketId, reporterId },
          include: { attachments: true },
        });
        if (!item)
          throw new NotFoundException("Không tìm thấy ticket được phép đóng.");
        if (item.status !== "RESOLVED" || !item.resolution?.trim())
          throw new ConflictException(
            "Chỉ được đóng ticket đã có kết quả xử lý.",
          );
        const updated = await transaction.supportTicket.update({
          where: { id: ticketId },
          data: { status: "CLOSED" },
          include: { attachments: true },
        });
        await transaction.auditLog.create({
          data: {
            actorId: reporterId,
            action: "SUPPORT_TICKET_CLOSED_BY_REPORTER",
            entityType: "support_ticket",
            entityId: ticketId,
            context: { resolution: item.resolution },
          },
        });
        return this.mapTicket(updated);
      });
    }
    const item = this.tickets.find(
      (ticket) => ticket.id === ticketId && ticket.reporterId === reporterId,
    );
    if (!item)
      throw new NotFoundException("Không tìm thấy ticket được phép đóng.");
    if (item.status !== "RESOLVED" || !item.resolution?.trim())
      throw new ConflictException("Chỉ được đóng ticket đã có kết quả xử lý.");
    item.status = "CLOSED";
    item.updatedAt = now();
    return {
      ...item,
      attachments: item.attachments.map((attachment) => ({ ...attachment })),
    };
  }

  /** Kiểm tra người gửi hoặc quyền hỗ trợ trước khi trả trao đổi của phiếu. */
  async listTicketComments(
    ticketId: string,
    role: string,
    actorId = this.userIdForRole(role),
  ): Promise<TicketComment[]> {
    const canManage = this.canManageSupport(role);
    const prisma = this.database();
    if (prisma) {
      const ticket = await prisma.supportTicket.findUnique({
        where: { id: ticketId },
      });
      if (!ticket || (!canManage && ticket.reporterId !== actorId))
        throw new NotFoundException("Không tìm thấy ticket được phép xem.");
      const rows = await prisma.ticketComment.findMany({
        where: { ticketId },
        orderBy: { createdAt: "asc" },
      });
      return rows.map((row) => ({
        id: row.id,
        ticketId: row.ticketId,
        authorId: row.authorId,
        body: row.body,
        createdAt: row.createdAt.toISOString(),
      }));
    }
    const ticket = this.tickets.find((item) => item.id === ticketId);
    if (!ticket || (!canManage && ticket.reporterId !== actorId))
      throw new NotFoundException("Không tìm thấy ticket được phép xem.");
    return this.ticketComments
      .filter((item) => item.ticketId === ticketId)
      .map((item) => ({ ...item }));
  }

  /** Thêm trao đổi hợp lệ vào phiếu truy cập được và cập nhật thời gian hoạt động. */
  async addTicketComment(
    ticketId: string,
    body: string,
    role: string,
    authorId = this.userIdForRole(role),
  ): Promise<TicketComment> {
    const normalized = this.validateSupportText(body, "Nội dung trao đổi");
    const canManage = this.canManageSupport(role);
    const prisma = this.database();
    if (prisma) {
      const ticket = await prisma.supportTicket.findUnique({
        where: { id: ticketId },
      });
      if (!ticket || (!canManage && ticket.reporterId !== authorId))
        throw new NotFoundException(
          "Không tìm thấy ticket được phép phản hồi.",
        );
      if (ticket.status === "CLOSED")
        throw new BadRequestException(
          "Ticket đã đóng, không thể thêm trao đổi.",
        );
      return prisma.$transaction(async (transaction) => {
        const row = await transaction.ticketComment.create({
          data: {
            id: id("ticket-comment"),
            ticketId,
            authorId,
            body: normalized,
          },
        });
        const nextAssigneeId =
          canManage && ticket.status === "OPEN" ? authorId : ticket.assigneeId;
        if (canManage && ticket.status === "OPEN")
          await transaction.supportTicket.update({
            where: { id: ticketId },
            data: { status: "IN_PROGRESS", assigneeId: authorId },
          });
        const recipientIds = canManage
          ? [ticket.reporterId]
          : nextAssigneeId
            ? [nextAssigneeId]
            : await this.userIdsForRole(transaction, "SYSTEM_ADMIN");
        const recipients = [
          ...new Set(
            recipientIds.filter((recipientId) => recipientId !== authorId),
          ),
        ];
        if (recipients.length)
          await transaction.notification.createMany({
            data: recipients.map((recipientId) => ({
              id: id("notification"),
              recipientId,
              type: "SUPPORT_COMMENT",
              title: "Phiếu hỗ trợ có phản hồi mới",
              entityType: "SUPPORT_TICKET",
              entityId: ticketId,
              dedupKey: `support-comment:${row.id}:${recipientId}`,
            })),
          });
        return {
          id: row.id,
          ticketId: row.ticketId,
          authorId: row.authorId,
          body: row.body,
          createdAt: row.createdAt.toISOString(),
        };
      });
    }
    const ticket = this.tickets.find((item) => item.id === ticketId);
    if (!ticket || (!canManage && ticket.reporterId !== authorId))
      throw new NotFoundException("Không tìm thấy ticket được phép phản hồi.");
    if (ticket.status === "CLOSED")
      throw new BadRequestException("Ticket đã đóng, không thể thêm trao đổi.");
    if (canManage && ticket.status === "OPEN")
      Object.assign(ticket, { status: "IN_PROGRESS", assigneeId: authorId });
    const comment: TicketComment = {
      id: id("ticket-comment"),
      ticketId,
      authorId,
      body: normalized,
      createdAt: now(),
    };
    this.ticketComments.push(comment);
    return { ...comment };
  }

  /** Tổng hợp điểm danh, điểm số, hoàn thành học liệu và sinh phân loại rủi ro từng học viên. */
  async getClassProgress(
    classId: string,
    input: { from?: string; to?: string } & Partial<RiskThresholds>,
  ): Promise<ClassProgressReport> {
    const { from, to } = this.reportingPeriod(input.from, input.to);
    const thresholds: RiskThresholds = {
      attendanceBelow: input.attendanceBelow ?? 70,
      scoreBelow: input.scoreBelow ?? 50,
      completionBelow: input.completionBelow ?? 60,
    };
    this.validateRiskThresholds(thresholds);
    const prisma = this.database();
    if (prisma) {
      const classItem = await prisma.learningClass.findUnique({
        where: { id: classId },
        include: {
          enrollments: { where: { status: "ACTIVE" } },
          materials: {
            where: { visibility: "PUBLISHED" },
            include: {
              accessLogs: { where: { createdAt: { gte: from, lte: to } } },
            },
          },
          exams: {
            where: { openAt: { lte: to }, closeAt: { gte: from } },
            include: {
              attempts: { where: { submittedAt: { gte: from, lte: to } } },
            },
          },
          assignments: {
            where: {
              status: { in: ["PUBLISHED", "CLOSED"] },
              dueAt: { gte: from, lte: to },
            },
            include: { submissions: { where: { submittedAt: { lte: to } } } },
          },
          sessions: {
            where: {
              startsAt: { gte: from, lte: to },
              status: { in: ["COMPLETED", "LIVE"] },
            },
            include: { attendance: true },
          },
        },
      });
      if (!classItem) throw new NotFoundException("Không tìm thấy lớp học.");
      const interventions = await prisma.progressIntervention.findMany({
        where: { classId },
        orderBy: { createdAt: "desc" },
      });
      const learners = classItem.enrollments.map(({ learnerId }) => {
        const accessedMaterialIds = new Set(
          classItem.materials
            .filter((material) =>
              material.accessLogs.some((log) => log.userId === learnerId),
            )
            .map((material) => material.id),
        );
        const attempts = classItem.exams.flatMap((exam) =>
          exam.attempts
            .filter((attempt) => attempt.learnerId === learnerId)
            .map((attempt) => ({
              ...attempt,
              totalScore: Number(exam.totalScore),
            })),
        );
        const assignmentSubmissions = classItem.assignments.flatMap(
          (assignment) =>
            assignment.submissions
              .filter((submission) => submission.learnerId === learnerId)
              .map((submission) => ({
                ...submission,
                assignmentMaxScore: Number(assignment.maxScore),
              })),
        );
        const completedExamIds = new Set(
          attempts
            .filter((attempt) => attempt.status !== "IN_PROGRESS")
            .map((attempt) => attempt.examId),
        );
        let earned = 0;
        let possible = 0;
        for (const exam of classItem.exams) {
          const learnerAttempts = exam.attempts.filter(
            (attempt) => attempt.learnerId === learnerId,
          );
          const graded = learnerAttempts.filter(
            (attempt) => attempt.status === "GRADED",
          );
          if (graded.length) {
            earned += Math.max(
              ...graded.map((attempt) => Number(attempt.score ?? 0)),
            );
            possible += Number(exam.totalScore);
          } else if (exam.status === "CLOSED" || exam.closeAt <= to)
            possible += Number(exam.totalScore);
        }
        for (const assignment of classItem.assignments) {
          const submission = assignment.submissions.find(
            (candidate) => candidate.learnerId === learnerId,
          );
          if (submission?.status === "GRADED") {
            earned += Number(submission.score ?? 0);
            possible += Number(assignment.maxScore);
          } else if (assignment.status === "CLOSED" || assignment.dueAt <= to)
            possible += Number(assignment.maxScore);
        }
        const attendance = classItem.sessions.flatMap((session) =>
          session.attendance.filter((record) => record.learnerId === learnerId),
        );
        const activityDates = [
          ...classItem.materials.flatMap((material) =>
            material.accessLogs
              .filter((log) => log.userId === learnerId)
              .map((log) => log.createdAt),
          ),
          ...attempts.flatMap((attempt) =>
            attempt.submittedAt ? [attempt.submittedAt] : [],
          ),
          ...assignmentSubmissions.map((submission) => submission.submittedAt),
          ...attendance.flatMap((record) =>
            record.joinedAt ? [record.joinedAt] : [],
          ),
        ];
        const completedAssessments =
          completedExamIds.size +
          new Set(
            assignmentSubmissions.map((submission) => submission.assignmentId),
          ).size;
        const totalAssessments =
          classItem.exams.length + classItem.assignments.length;
        return this.buildLearnerProgress({
          learnerId,
          materialCompletionRate: this.percentage(
            accessedMaterialIds.size,
            classItem.materials.length,
          ),
          assessmentCompletionRate: this.percentage(
            completedAssessments,
            totalAssessments,
          ),
          attendanceRate: this.percentage(
            attendance.filter(
              (record) =>
                record.status === "PRESENT" || record.status === "LATE",
            ).length,
            classItem.sessions.length,
          ),
          averageScore: possible
            ? Math.round((earned / possible) * 10_000) / 100
            : 0,
          lastActivityAt: this.latestDate(activityDates),
          thresholds,
          interventions: interventions
            .filter((item) => item.learnerId === learnerId)
            .map((item) => this.mapProgressIntervention(item)),
        });
      });
      return {
        classId,
        classCode: classItem.code,
        from: from.toISOString(),
        to: to.toISOString(),
        thresholds,
        learners,
        generatedAt: now(),
      };
    }
    const classItem = this.findClass(classId);
    const materials = this.materials.filter(
      (material) =>
        material.classId === classId && material.visibility === "PUBLISHED",
    );
    const exams = this.exams.filter(
      (exam) =>
        exam.classId === classId &&
        new Date(exam.openAt) <= to &&
        new Date(exam.closeAt) >= from,
    );
    const sessions = this.sessions.filter(
      (session) =>
        session.classId === classId &&
        new Date(session.startsAt) >= from &&
        new Date(session.startsAt) <= to &&
        ["COMPLETED", "LIVE"].includes(session.status),
    );
    const learners = classItem.learnerIds.map((learnerId) => {
      const accessLogs = this.materialAccessLogs.filter(
        (log) =>
          log.userId === learnerId &&
          materials.some((material) => material.id === log.materialId) &&
          new Date(log.createdAt) >= from &&
          new Date(log.createdAt) <= to,
      );
      const attempts = this.attempts.filter(
        (attempt) =>
          attempt.learnerId === learnerId &&
          exams.some((exam) => exam.id === attempt.examId) &&
          attempt.submittedAt &&
          new Date(attempt.submittedAt) >= from &&
          new Date(attempt.submittedAt) <= to,
      );
      const attendance = this.attendance.filter(
        (record) =>
          record.learnerId === learnerId &&
          sessions.some((session) => session.id === record.sessionId),
      );
      const activityDates = [
        ...accessLogs.map((log) => new Date(log.createdAt)),
        ...attempts.flatMap((attempt) =>
          attempt.submittedAt ? [new Date(attempt.submittedAt)] : [],
        ),
        ...attendance.flatMap((record) =>
          record.joinedAt ? [new Date(record.joinedAt)] : [],
        ),
      ];
      return this.buildLearnerProgress({
        learnerId,
        materialCompletionRate: this.percentage(
          new Set(accessLogs.map((log) => log.materialId)).size,
          materials.length,
        ),
        assessmentCompletionRate: this.percentage(
          new Set(attempts.map((attempt) => attempt.examId)).size,
          exams.length,
        ),
        attendanceRate: this.percentage(
          attendance.filter(
            (record) => record.status === "PRESENT" || record.status === "LATE",
          ).length,
          sessions.length,
        ),
        averageScore: attempts.length
          ? Math.round(
              (attempts.reduce((sum, attempt) => {
                const exam = exams.find(
                  (candidate) => candidate.id === attempt.examId,
                );
                return (
                  sum +
                  (exam ? ((attempt.score ?? 0) / exam.totalScore) * 100 : 0)
                );
              }, 0) /
                attempts.length) *
                100,
            ) / 100
          : 0,
        lastActivityAt: this.latestDate(activityDates),
        thresholds,
        interventions: this.progressInterventions
          .filter(
            (item) => item.classId === classId && item.learnerId === learnerId,
          )
          .map((item) => ({ ...item })),
      });
    });
    return {
      classId,
      classCode: classItem.code,
      from: from.toISOString(),
      to: to.toISOString(),
      thresholds,
      learners,
      generatedAt: now(),
    };
  }

  /** Tạo kế hoạch can thiệp, giao đúng giảng viên của lớp và lưu riêng người tạo. */
  async createProgressIntervention(
    classId: string,
    input: Pick<
      ProgressIntervention,
      "learnerId" | "title" | "notes" | "dueAt"
    > & { assigneeId: string },
    createdById = "usr-manager",
  ): Promise<ProgressIntervention> {
    const dueAt = new Date(input.dueAt);
    if (Number.isNaN(dueAt.getTime()) || dueAt <= new Date())
      throw new BadRequestException("Hạn hành động hỗ trợ phải ở tương lai.");
    const title = input.title.trim();
    const prisma = this.database();
    if (prisma) {
      const [classItem, enrollment, assignee] = await Promise.all([
        prisma.learningClass.findUnique({
          where: { id: classId },
          select: { status: true, code: true },
        }),
        prisma.classEnrollment.findFirst({
          where: { classId, learnerId: input.learnerId, status: "ACTIVE" },
        }),
        prisma.classInstructor.findUnique({
          where: {
            classId_instructorId: { classId, instructorId: input.assigneeId },
          },
        }),
      ]);
      if (!classItem) throw new NotFoundException("Không tìm thấy lớp học.");
      if (classItem.status === "CLOSED")
        throw new ConflictException("Lớp đã lưu trữ và chỉ cho phép đọc.");
      if (!enrollment)
        throw new NotFoundException("Học viên không thuộc lớp đang hoạt động.");
      if (!assignee)
        throw new BadRequestException(
          "Người phụ trách phải là giảng viên đang được phân công cho lớp.",
        );
      const row = await prisma.$transaction(async (transaction) => {
        const created = await transaction.progressIntervention.create({
          data: {
            id: id("intervention"),
            classId,
            learnerId: input.learnerId,
            ownerId: input.assigneeId,
            createdById,
            title,
            notes: input.notes?.trim(),
            dueAt,
            handoffHistory: [],
          },
        });
        await transaction.notification.upsert({
          where: {
            dedupKey: `progress-assigned:${created.id}:${input.assigneeId}`,
          },
          update: { readAt: null, createdAt: new Date() },
          create: {
            id: id("notification"),
            recipientId: input.assigneeId,
            type: "PROGRESS_INTERVENTION_ASSIGNED",
            title: `Bạn được giao hỗ trợ một học viên của lớp ${classItem.code}`,
            entityType: "PROGRESS_INTERVENTION",
            entityId: created.id,
            dedupKey: `progress-assigned:${created.id}:${input.assigneeId}`,
          },
        });
        await transaction.auditLog.create({
          data: {
            actorId: createdById,
            action: "PROGRESS_INTERVENTION_CREATED",
            entityType: "progress_intervention",
            entityId: created.id,
            context: {
              classId,
              learnerId: input.learnerId,
              assigneeId: input.assigneeId,
              dueAt: dueAt.toISOString(),
            },
          },
        });
        return created;
      });
      return this.mapProgressIntervention(row);
    }
    const classItem = this.findClass(classId);
    if (classItem.status === "CLOSED")
      throw new ConflictException("Lớp đã lưu trữ và chỉ cho phép đọc.");
    if (!classItem.learnerIds.includes(input.learnerId))
      throw new NotFoundException("Học viên không thuộc lớp đang hoạt động.");
    if (!classItem.instructorIds.includes(input.assigneeId))
      throw new BadRequestException(
        "Người phụ trách phải là giảng viên đang được phân công cho lớp.",
      );
    const item: ProgressIntervention = {
      id: id("intervention"),
      classId,
      learnerId: input.learnerId,
      ownerId: input.assigneeId,
      createdById,
      title,
      notes: input.notes?.trim(),
      dueAt: dueAt.toISOString(),
      status: "OPEN",
      history: [],
      createdAt: now(),
    };
    this.progressInterventions.unshift(item);
    this.notifications.unshift({
      id: id("notification"),
      recipientId: input.assigneeId,
      type: "PROGRESS_INTERVENTION_ASSIGNED",
      title: `Bạn được giao hỗ trợ một học viên của lớp ${classItem.code}`,
      entityType: "PROGRESS_INTERVENTION",
      entityId: item.id,
      createdAt: now(),
    });
    return { ...item };
  }

  /** Liệt kê hành động hỗ trợ đang thuộc trách nhiệm của người dùng hiện tại. */
  async listMyProgressInterventions(
    ownerId: string,
  ): Promise<ProgressIntervention[]> {
    const prisma = this.database();
    if (prisma) {
      const rows = await prisma.progressIntervention.findMany({
        where: { ownerId },
        orderBy: [{ status: "asc" }, { dueAt: "asc" }],
      });
      return rows.map((row) => this.mapProgressIntervention(row));
    }
    return this.progressInterventions
      .filter((item) => item.ownerId === ownerId)
      .map((item) => structuredClone(item));
  }

  /** Nhận, hoàn tất hoặc hủy hành động hỗ trợ theo quyền sở hữu và điều kiện kết quả. */
  async updateProgressIntervention(
    interventionId: string,
    input: {
      status: "IN_PROGRESS" | "DONE" | "CANCELLED";
      outcome?: string;
      cancellationReason?: string;
    },
    actorId = "usr-manager",
    actorRole = "CENTER_MANAGER",
  ): Promise<ProgressIntervention> {
    const outcome = input.outcome?.trim();
    const cancellationReason = input.cancellationReason?.trim();
    if (input.status === "DONE" && (!outcome || outcome.length < 5))
      throw new BadRequestException("Kết quả hỗ trợ cần ít nhất 5 ký tự.");
    if (
      input.status === "CANCELLED" &&
      (!cancellationReason || cancellationReason.length < 5)
    )
      throw new BadRequestException("Lý do hủy cần ít nhất 5 ký tự.");
    const prisma = this.database();
    if (prisma) {
      const current = await prisma.progressIntervention.findUnique({
        where: { id: interventionId },
      });
      if (!current)
        throw new NotFoundException("Không tìm thấy hành động hỗ trợ.");
      if (!["OPEN", "IN_PROGRESS"].includes(current.status))
        throw new ConflictException("Hành động hỗ trợ đã kết thúc.");
      if (
        current.ownerId !== actorId &&
        !["CENTER_MANAGER", "SYSTEM_ADMIN"].includes(actorRole)
      )
        throw new ConflictException(
          "Chỉ người được giao hoặc quản lý mới được cập nhật hành động này.",
        );
      if (current.status === "IN_PROGRESS" && input.status === "IN_PROGRESS")
        throw new ConflictException("Hành động hỗ trợ đã được nhận xử lý.");
      const terminal = ["DONE", "CANCELLED"].includes(input.status);
      const row = await prisma.$transaction(async (transaction) => {
        const claimed = await transaction.progressIntervention.updateMany({
          where: { id: interventionId, status: current.status },
          data: {
            status: input.status,
            acceptedAt:
              input.status === "IN_PROGRESS" ? new Date() : current.acceptedAt,
            completedAt: terminal ? new Date() : null,
            outcome: input.status === "DONE" ? outcome : null,
            cancellationReason:
              input.status === "CANCELLED" ? cancellationReason : null,
          },
        });
        if (claimed.count !== 1)
          throw new ConflictException(
            "Hành động đã được người khác cập nhật; hãy tải lại.",
          );
        if (terminal) {
          const recipients = new Set([current.createdById, current.ownerId]);
          for (const recipientId of recipients)
            await transaction.notification.upsert({
              where: {
                dedupKey: `progress-${input.status.toLowerCase()}:${interventionId}:${recipientId}`,
              },
              update: { readAt: null, createdAt: new Date() },
              create: {
                id: id("notification"),
                recipientId,
                type: `PROGRESS_INTERVENTION_${input.status}`,
                title:
                  input.status === "DONE"
                    ? "Hành động hỗ trợ học viên đã hoàn tất"
                    : "Hành động hỗ trợ học viên đã bị hủy",
                entityType: "PROGRESS_INTERVENTION",
                entityId: interventionId,
                dedupKey: `progress-${input.status.toLowerCase()}:${interventionId}:${recipientId}`,
              },
            });
        }
        await transaction.auditLog.create({
          data: {
            actorId,
            action: `PROGRESS_INTERVENTION_${input.status}`,
            entityType: "progress_intervention",
            entityId: interventionId,
            context: {
              previousStatus: current.status,
              nextStatus: input.status,
              outcome,
              cancellationReason,
            },
          },
        });
        return transaction.progressIntervention.findUniqueOrThrow({
          where: { id: interventionId },
        });
      });
      return this.mapProgressIntervention(row);
    }
    const item = this.progressInterventions.find(
      (candidate) => candidate.id === interventionId,
    );
    if (!item) throw new NotFoundException("Không tìm thấy hành động hỗ trợ.");
    if (!["OPEN", "IN_PROGRESS"].includes(item.status))
      throw new ConflictException("Hành động hỗ trợ đã kết thúc.");
    if (
      item.ownerId !== actorId &&
      !["CENTER_MANAGER", "SYSTEM_ADMIN"].includes(actorRole)
    )
      throw new ConflictException(
        "Chỉ người được giao hoặc quản lý mới được cập nhật hành động này.",
      );
    if (item.status === "IN_PROGRESS" && input.status === "IN_PROGRESS")
      throw new ConflictException("Hành động hỗ trợ đã được nhận xử lý.");
    item.status = input.status;
    item.acceptedAt = input.status === "IN_PROGRESS" ? now() : item.acceptedAt;
    item.completedAt = ["DONE", "CANCELLED"].includes(input.status)
      ? now()
      : undefined;
    item.outcome = input.status === "DONE" ? outcome : undefined;
    item.cancellationReason =
      input.status === "CANCELLED" ? cancellationReason : undefined;
    return { ...item };
  }

  /** Bàn giao hành động đang mở cho giảng viên khác và lưu toàn bộ dấu vết chuyển giao. */
  async transferProgressIntervention(
    interventionId: string,
    assigneeId: string,
    rawReason: string,
    actorId = "usr-manager",
  ): Promise<ProgressIntervention> {
    const reason = rawReason.trim();
    if (reason.length < 5)
      throw new BadRequestException("Lý do bàn giao cần ít nhất 5 ký tự.");
    const prisma = this.database();
    if (prisma) {
      const current = await prisma.progressIntervention.findUnique({
        where: { id: interventionId },
      });
      if (!current)
        throw new NotFoundException("Không tìm thấy hành động hỗ trợ.");
      if (!["OPEN", "IN_PROGRESS"].includes(current.status))
        throw new ConflictException(
          "Chỉ có thể bàn giao hành động chưa kết thúc.",
        );
      if (current.ownerId === assigneeId)
        throw new BadRequestException(
          "Người nhận bàn giao phải khác người hiện tại.",
        );
      const assignment = await prisma.classInstructor.findUnique({
        where: {
          classId_instructorId: {
            classId: current.classId,
            instructorId: assigneeId,
          },
        },
      });
      if (!assignment)
        throw new BadRequestException(
          "Người nhận phải là giảng viên đang được phân công cho lớp.",
        );
      const history = this.progressInterventionHistory(current.handoffHistory);
      history.push({
        fromOwnerId: current.ownerId,
        toOwnerId: assigneeId,
        reason,
        actorId,
        createdAt: now(),
      });
      const row = await prisma.$transaction(async (transaction) => {
        const claimed = await transaction.progressIntervention.updateMany({
          where: {
            id: interventionId,
            ownerId: current.ownerId,
            status: current.status,
          },
          data: {
            ownerId: assigneeId,
            status: "OPEN",
            acceptedAt: null,
            handoffHistory: history,
          },
        });
        if (claimed.count !== 1)
          throw new ConflictException(
            "Hành động đã được cập nhật; hãy tải lại trước khi bàn giao.",
          );
        await transaction.notification.upsert({
          where: {
            dedupKey: `progress-transferred:${interventionId}:${assigneeId}:${history.length}`,
          },
          update: { readAt: null, createdAt: new Date() },
          create: {
            id: id("notification"),
            recipientId: assigneeId,
            type: "PROGRESS_INTERVENTION_ASSIGNED",
            title: "Bạn vừa nhận bàn giao một hành động hỗ trợ học viên",
            entityType: "PROGRESS_INTERVENTION",
            entityId: interventionId,
            dedupKey: `progress-transferred:${interventionId}:${assigneeId}:${history.length}`,
          },
        });
        await transaction.auditLog.create({
          data: {
            actorId,
            action: "PROGRESS_INTERVENTION_TRANSFERRED",
            entityType: "progress_intervention",
            entityId: interventionId,
            context: {
              fromOwnerId: current.ownerId,
              toOwnerId: assigneeId,
              reason,
            },
          },
        });
        return transaction.progressIntervention.findUniqueOrThrow({
          where: { id: interventionId },
        });
      });
      return this.mapProgressIntervention(row);
    }
    const item = this.progressInterventions.find(
      (candidate) => candidate.id === interventionId,
    );
    if (!item) throw new NotFoundException("Không tìm thấy hành động hỗ trợ.");
    if (!["OPEN", "IN_PROGRESS"].includes(item.status))
      throw new ConflictException(
        "Chỉ có thể bàn giao hành động chưa kết thúc.",
      );
    if (item.ownerId === assigneeId)
      throw new BadRequestException(
        "Người nhận bàn giao phải khác người hiện tại.",
      );
    if (!this.findClass(item.classId).instructorIds.includes(assigneeId))
      throw new BadRequestException(
        "Người nhận phải là giảng viên đang được phân công cho lớp.",
      );
    item.history.push({
      fromOwnerId: item.ownerId,
      toOwnerId: assigneeId,
      reason,
      actorId,
      createdAt: now(),
    });
    item.ownerId = assigneeId;
    item.status = "OPEN";
    item.acceptedAt = undefined;
    return structuredClone(item);
  }

  /** Tạo snapshot báo cáo vận hành có checksum để các bản xuất dùng dữ liệu bất biến. */
  async runOperationalReport(
    fromInput: string,
    toInput: string,
    requestedById = "usr-manager",
  ): Promise<ReportRun> {
    const { from, to } = this.reportingPeriod(fromInput, toInput);
    const result = await this.getOperationalReport(
      from.toISOString(),
      to.toISOString(),
    );
    const run: ReportRun = {
      id: id("report-run"),
      reportType: "OPERATIONS",
      definitionVersion: result.definitionVersion,
      timezone: result.timezone,
      filters: { from: from.toISOString(), to: to.toISOString() },
      result,
      requestedById,
      createdAt: now(),
    };
    const prisma = this.database();
    if (prisma) {
      const row = await prisma.reportRun.create({
        data: {
          id: run.id,
          reportType: run.reportType,
          definitionVersion: run.definitionVersion,
          timezone: run.timezone,
          filters: run.filters,
          result: run.result as unknown as Prisma.InputJsonValue,
          requestedById,
        },
      });
      await prisma.auditLog.create({
        data: {
          actorId: requestedById,
          action: "OPERATIONAL_REPORT_RUN",
          entityType: "report_run",
          entityId: row.id,
          context: run.filters,
        },
      });
      return { ...run, createdAt: row.createdAt.toISOString() };
    }
    this.reportRuns.unshift(run);
    return structuredClone(run);
  }

  /** Kết xuất snapshot báo cáo thành CSV, lưu object và bản ghi trạng thái READY/FAILED. */
  async createReportExport(
    reportRunId: string,
    format: "CSV",
    requestedById = "usr-manager",
  ): Promise<ReportExport> {
    const prisma = this.database();
    const run = prisma
      ? await prisma.reportRun.findFirst({
          where: { id: reportRunId, requestedById },
        })
      : this.reportRuns.find(
          (item) =>
            item.id === reportRunId && item.requestedById === requestedById,
        );
    if (!run)
      throw new NotFoundException(
        "Không tìm thấy lần chạy báo cáo được phép xuất.",
      );
    const exportId = id("report-export");
    const fileName = `bao-cao-van-hanh-${new Date().toISOString().slice(0, 10)}-${exportId.slice(-8)}.csv`;
    const objectKey = `report-exports/${exportId}.csv`;
    const expiresAt = new Date(Date.now() + 24 * 3_600_000);
    const result = ("result" in run
      ? run.result
      : {}) as unknown as OperationalReport;
    const csv = this.operationalReportCsv(result);
    if (prisma)
      await prisma.reportExport.create({
        data: {
          id: exportId,
          reportRunId,
          format,
          fileName,
          expiresAt,
          requestedById,
        },
      });
    try {
      const exportBuffer = Buffer.from(`\uFEFF${csv}`, "utf8");
      const stored = await this.writeStoredFile(objectKey, exportBuffer);
      const sizeBytes = exportBuffer.length;
      if (prisma) {
        const row = await prisma.reportExport.update({
          where: { id: exportId },
          data: { status: "COMPLETED", filePath: stored.objectKey, sizeBytes },
        });
        await prisma.auditLog.create({
          data: {
            actorId: requestedById,
            action: "OPERATIONAL_REPORT_EXPORTED",
            entityType: "report_export",
            entityId: exportId,
            context: {
              reportRunId,
              format,
              sizeBytes,
              expiresAt: expiresAt.toISOString(),
            },
          },
        });
        return this.mapReportExport(row);
      }
      const item: ReportExport & { filePath: string; requestedById: string } = {
        id: exportId,
        reportRunId,
        format,
        status: "COMPLETED",
        fileName,
        filePath: stored.objectKey,
        requestedById,
        sizeBytes,
        expiresAt: expiresAt.toISOString(),
        createdAt: now(),
      };
      this.reportExports.unshift(item);
      return { ...item, filePath: undefined } as ReportExport;
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Không thể tạo tệp xuất báo cáo.";
      if (prisma)
        await prisma.reportExport.update({
          where: { id: exportId },
          data: { status: "FAILED", errorMessage: message },
        });
      throw new BadRequestException("Không thể tạo tệp xuất báo cáo.");
    }
  }

  /** Liệt kê bản xuất do người dùng yêu cầu theo thời gian mới nhất. */
  async listReportExports(
    requestedById = "usr-manager",
  ): Promise<ReportExport[]> {
    const prisma = this.database();
    if (prisma) {
      const rows = await prisma.reportExport.findMany({
        where: { requestedById },
        orderBy: { createdAt: "desc" },
        take: 50,
      });
      return rows.map((row) => this.mapReportExport(row));
    }
    return this.reportExports
      .filter(
        (item) =>
          item.requestedById === requestedById && item.status !== "EXPIRED",
      )
      .map((item) => ({
        id: item.id,
        reportRunId: item.reportRunId,
        format: item.format,
        status: item.status,
        fileName: item.fileName,
        sizeBytes: item.sizeBytes,
        errorMessage: item.errorMessage,
        expiresAt: item.expiresAt,
        createdAt: item.createdAt,
      }));
  }

  /** Kiểm tra chủ sở hữu/trạng thái rồi đọc tệp báo cáo từ storage. */
  async downloadReportExport(
    exportId: string,
    requestedById = "usr-manager",
  ): Promise<MaterialDownload> {
    const prisma = this.database();
    if (prisma) {
      const row = await prisma.reportExport.findFirst({
        where: { id: exportId, requestedById },
      });
      if (!row) throw new NotFoundException("Không tìm thấy tệp xuất báo cáo.");
      if (row.expiresAt <= new Date()) {
        await prisma.reportExport.update({
          where: { id: exportId },
          data: { status: "EXPIRED" },
        });
        throw new BadRequestException("Tệp xuất báo cáo đã hết hạn.");
      }
      if (row.status !== "COMPLETED" || !row.filePath)
        throw new ConflictException("Tệp xuất báo cáo chưa sẵn sàng.");
      return {
        fileName: row.fileName,
        mimeType: "text/csv; charset=utf-8",
        buffer: await this.readStoredFile(row.filePath),
      };
    }
    const item = this.reportExports.find(
      (candidate) =>
        candidate.id === exportId && candidate.requestedById === requestedById,
    );
    if (!item) throw new NotFoundException("Không tìm thấy tệp xuất báo cáo.");
    if (new Date(item.expiresAt) <= new Date()) {
      item.status = "EXPIRED";
      throw new BadRequestException("Tệp xuất báo cáo đã hết hạn.");
    }
    if (item.status !== "COMPLETED" || !item.filePath)
      throw new ConflictException("Tệp xuất báo cáo chưa sẵn sàng.");
    return {
      fileName: item.fileName,
      mimeType: "text/csv; charset=utf-8",
      buffer: await this.readStoredFile(item.filePath),
    };
  }

  /** Đối soát số liệu khóa/lớp/học liệu/thi/phiếu trong kỳ và gắn cảnh báo vận hành. */
  async getOperationalReport(
    fromInput?: string,
    toInput?: string,
  ): Promise<OperationalReport> {
    const { from, to } = this.reportingPeriod(fromInput, toInput);
    const createdAt = { gte: from, lte: to };
    const metadata = {
      definitionVersion: "1.0.0",
      timezone: "Asia/Bangkok",
      metricDefinitions: {
        courses: "Số khóa học được tạo trong kỳ báo cáo.",
        classes: "Số lớp học được tạo trong kỳ báo cáo.",
        activeClasses: "Số lớp đang hoạt động và được tạo trong kỳ báo cáo.",
        learners: "Số học viên duy nhất đang có ghi danh hoạt động.",
        materials: "Số học liệu được tạo trong kỳ báo cáo.",
        exams: "Số đề kiểm tra được tạo trong kỳ báo cáo.",
        liveSessions: "Số buổi học trực tuyến bắt đầu trong kỳ báo cáo.",
        openReports:
          "Báo cáo diễn đàn chưa kết thúc được tạo trong kỳ báo cáo.",
        openTickets: "Phiếu hỗ trợ chưa kết thúc được tạo trong kỳ báo cáo.",
      },
    };
    const prisma = this.database();
    if (prisma) {
      const [
        courses,
        classes,
        activeClasses,
        learnerRows,
        materials,
        publishedMaterials,
        questions,
        exams,
        liveSessions,
        openReports,
        openTickets,
      ] = await prisma.$transaction([
        prisma.course.count({ where: { createdAt } }),
        prisma.learningClass.count({ where: { createdAt } }),
        prisma.learningClass.count({ where: { status: "ACTIVE", createdAt } }),
        prisma.classEnrollment.findMany({
          where: { status: "ACTIVE" },
          distinct: ["learnerId"],
          select: { learnerId: true },
        }),
        prisma.material.count({ where: { createdAt } }),
        prisma.material.count({
          where: { visibility: "PUBLISHED", createdAt },
        }),
        prisma.question.count({ where: { createdAt } }),
        prisma.exam.count({ where: { createdAt } }),
        prisma.liveSession.count({ where: { startsAt: createdAt } }),
        prisma.contentReport.count({
          where: {
            status: { in: ["OPEN", "IN_REVIEW", "ESCALATED"] },
            createdAt,
          },
        }),
        prisma.supportTicket.count({
          where: { status: { in: ["OPEN", "IN_PROGRESS"] }, createdAt },
        }),
      ]);
      return {
        courses,
        classes,
        activeClasses,
        learners: learnerRows.length,
        materials,
        publishedMaterials,
        questions,
        exams,
        liveSessions,
        openReports,
        openTickets,
        generatedAt: now(),
        ...metadata,
      };
    }
    const classes = this.classes.filter(
      (item) => item.status === "ACTIVE",
    ).length;
    const materials = this.materials.filter(
      (item) => item.visibility === "PUBLISHED",
    ).length;
    return {
      courses: this.courses.length,
      classes,
      activeClasses: classes,
      learners: new Set(this.classes.flatMap((item) => item.learnerIds)).size,
      materials,
      publishedMaterials: materials,
      questions: this.questions.length,
      exams: this.exams.length,
      liveSessions: this.sessions.filter(
        (item) =>
          new Date(item.startsAt) >= from && new Date(item.startsAt) <= to,
      ).length,
      openReports: this.reports.filter(
        (item) =>
          ["OPEN", "IN_REVIEW", "ESCALATED"].includes(item.status) &&
          new Date(item.createdAt) >= from &&
          new Date(item.createdAt) <= to,
      ).length,
      openTickets: this.tickets.filter(
        (item) =>
          !["RESOLVED", "CLOSED"].includes(item.status) &&
          new Date(item.createdAt) >= from &&
          new Date(item.createdAt) <= to,
      ).length,
      generatedAt: now(),
      ...metadata,
    };
  }

  /** Tổng hợp quy mô, lịch, học liệu và điểm trung bình cho từng lớp. */
  async getClassReports(): Promise<object[]> {
    const prisma = this.database();
    if (prisma) {
      const classes = await prisma.learningClass.findMany({
        include: {
          instructors: true,
          enrollments: { where: { status: "ACTIVE" } },
          materials: {
            where: { visibility: "PUBLISHED" },
            select: { id: true },
          },
          exams: { include: { attempts: true } },
          sessions: { include: { attendance: true } },
        },
        orderBy: { startAt: "desc" },
      });
      return classes.map((classItem) => {
        const attempts = classItem.exams.flatMap((exam) => exam.attempts);
        const graded = attempts.filter((attempt) => attempt.score !== null);
        const attendance = classItem.sessions.flatMap(
          (session) => session.attendance,
        );
        const attendanceDenominator =
          classItem.enrollments.length * classItem.sessions.length;
        return {
          classId: classItem.id,
          classCode: classItem.code,
          className: classItem.name,
          learners: classItem.enrollments.length,
          instructors: classItem.instructors.length,
          publishedMaterials: classItem.materials.length,
          exams: classItem.exams.length,
          submittedAttempts: attempts.filter(
            (attempt) => attempt.status !== "IN_PROGRESS",
          ).length,
          averageScore: graded.length
            ? Math.round(
                (graded.reduce(
                  (sum, attempt) => sum + Number(attempt.score),
                  0,
                ) /
                  graded.length) *
                  100,
              ) / 100
            : 0,
          sessions: classItem.sessions.length,
          attendanceRate: attendanceDenominator
            ? Math.round(
                (attendance.filter(
                  (row) => row.status === "PRESENT" || row.status === "LATE",
                ).length /
                  attendanceDenominator) *
                  100,
              )
            : 0,
          status: classItem.status,
        };
      });
    }
    return this.classes.map((classItem) => {
      const classExams = this.exams.filter(
        (exam) => exam.classId === classItem.id,
      );
      const classAttempts = this.attempts.filter((attempt) =>
        classExams.some((exam) => exam.id === attempt.examId),
      );
      const classSessions = this.sessions.filter(
        (session) => session.classId === classItem.id,
      );
      const attendanceRows = this.attendance.filter((record) =>
        classSessions.some((session) => session.id === record.sessionId),
      );
      const graded = classAttempts.filter(
        (attempt) => attempt.score !== undefined,
      );
      return {
        classId: classItem.id,
        classCode: classItem.code,
        className: classItem.name,
        learners: classItem.learnerIds.length,
        instructors: classItem.instructorIds.length,
        publishedMaterials: this.materials.filter(
          (material) =>
            material.classId === classItem.id &&
            material.visibility === "PUBLISHED",
        ).length,
        exams: classExams.length,
        submittedAttempts: classAttempts.filter(
          (attempt) => attempt.status !== "IN_PROGRESS",
        ).length,
        averageScore: graded.length
          ? Math.round(
              (graded.reduce((sum, attempt) => sum + (attempt.score ?? 0), 0) /
                graded.length) *
                100,
            ) / 100
          : 0,
        sessions: classSessions.length,
        attendanceRate:
          classItem.learnerIds.length && classSessions.length
            ? Math.round(
                (attendanceRows.filter(
                  (row) => row.status === "PRESENT" || row.status === "LATE",
                ).length /
                  (classItem.learnerIds.length * classSessions.length)) *
                  100,
              )
            : 0,
        status: classItem.status,
      };
    });
  }

  /** Chọn Prisma khi DB được bật; nếu không các public method dùng dữ liệu nhớ demo. */
  private database(): PrismaService | undefined {
    return this.prisma?.isStartupConnectionEnabled() ? this.prisma : undefined;
  }

  /** Đọc chế độ duyệt đề từ cấu hình DB và mặc định AUTO khi chưa có cấu hình. */
  private async getExamApprovalMode(): Promise<ExamApprovalMode> {
    // Các unit test khởi tạo service độc lập vẫn giữ quy trình thủ công cũ;
    // trong ứng dụng thực tế SystemService luôn được inject và mặc định là AUTO.
    if (!this.system) return "MANUAL";
    return (await this.system.getSettings()).examApprovalMode;
  }

  /** Đọc chế độ duyệt câu hỏi dùng chung kiểu AUTO/MANUAL với đề thi. */
  private async getQuestionApprovalMode(): Promise<ExamApprovalMode> {
    if (!this.system) return "AUTO";
    return (await this.system.getSettings()).questionApprovalMode;
  }

  /** Ánh xạ Course Prisma, bao gồm JSON outcomes, sang hợp đồng API. */
  private mapCourse(
    row: Prisma.CourseGetPayload<Record<string, never>>,
  ): LearningCourse {
    return {
      id: row.id,
      code: row.code,
      name: row.name,
      description: row.description,
      outcomes: this.toStringArray(row.outcomes),
      status: row.status,
      version: row.version,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  /** Ánh xạ lớp cùng thành viên hoạt động và metadata vòng đời. */
  private mapClass(row: ClassWithMembers): LearningClass {
    return {
      id: row.id,
      courseId: row.courseId,
      courseVersion: row.courseVersion,
      code: row.code,
      name: row.name,
      term: row.term,
      startAt: row.startAt.toISOString(),
      endAt: row.endAt.toISOString(),
      capacity: row.capacity,
      timezone: row.timezone,
      allowLateEnrollment: row.allowLateEnrollment,
      status: row.status,
      instructorIds: row.instructors.map(({ instructorId }) => instructorId),
      learnerIds: row.enrollments.map(({ learnerId }) => learnerId),
      closeReason: row.closeReason ?? undefined,
      archivePolicy: row.archivePolicy ?? undefined,
      closedAt: row.closedAt?.toISOString(),
      archivedAt: row.archivedAt?.toISOString(),
    };
  }

  /** Ánh xạ học liệu và chỉ công bố metadata cần thiết, không lộ object key. */
  private mapMaterial(
    row: Prisma.MaterialGetPayload<Record<string, never>>,
  ): LearningMaterial {
    const sizeBytes = Number(row.sizeBytes);
    if (!Number.isSafeInteger(sizeBytes))
      throw new BadRequestException(
        "Kích thước học liệu vượt giới hạn số an toàn.",
      );
    return {
      id: row.id,
      classId: row.classId,
      courseId: row.courseId,
      ownerId: row.ownerId,
      name: normalizeMultipartFileName(row.name),
      mimeType: row.mimeType,
      sizeBytes,
      folder: row.folder,
      tags: this.toStringArray(row.tags),
      version: row.version,
      visibility: row.visibility,
      quarantinedAt: row.quarantinedAt?.toISOString(),
      quarantineReason: row.quarantineReason ?? undefined,
      createdAt: row.createdAt.toISOString(),
    };
  }

  /** Thu hẹp JSON options/answers/tags và ánh xạ version family của câu hỏi. */
  private mapQuestion(
    row: Prisma.QuestionGetPayload<Record<string, never>>,
  ): LearningQuestion {
    const imageSizeBytes =
      row.imageSizeBytes === null ? undefined : Number(row.imageSizeBytes);
    if (imageSizeBytes !== undefined && !Number.isSafeInteger(imageSizeBytes))
      throw new BadRequestException(
        "Kích thước ảnh câu hỏi vượt giới hạn số an toàn.",
      );
    return {
      id: row.id,
      courseId: row.courseId,
      type: row.type,
      content: row.content,
      options: this.toStringArray(row.options),
      correctAnswers: this.toStringArray(row.correctAnswers),
      difficulty: Math.min(3, Math.max(1, row.difficulty)) as 1 | 2 | 3,
      tags: this.toStringArray(row.tags),
      status:
        row.status === "PUBLISHED"
          ? "PUBLISHED"
          : row.status === "PENDING_REVIEW"
            ? "PENDING_REVIEW"
            : "DRAFT",
      version: row.version,
      familyId: row.familyId,
      supersedesId: row.supersedesId ?? undefined,
      imageUrl: row.imageObjectKey
        ? `/question-bank/questions/${row.id}/image?v=${encodeURIComponent(row.imageChecksum ?? row.updatedAt.getTime().toString())}`
        : undefined,
      imageName: row.imageName ?? undefined,
      imageMimeType: row.imageMimeType ?? undefined,
      imageSizeBytes,
    };
  }

  /** Phân tích phân bố điểm, tỷ lệ hoàn thành và hiệu suất câu hỏi trong phạm vi giảng viên. */
  async getExamAnalytics(
    input: { classId?: string; examId?: string; from?: string; to?: string },
    actorId = "usr-instructor",
  ): Promise<ExamAnalytics> {
    const { from, to } = this.reportingPeriod(input.from, input.to);
    const metricDefinitions = {
      averagePercentage:
        "Trung bình điểm đã chấm chia tổng điểm đề, quy đổi phần trăm.",
      passRate: "Tỷ lệ bài đạt từ 50% tổng điểm trong các bài đã chấm.",
      correctRate:
        "Tỷ lệ lượt trả lời khớp toàn bộ đáp án chuẩn của câu hỏi sau khi đề đóng.",
    };
    const prisma = this.database();
    if (prisma) {
      const rows = await prisma.exam.findMany({
        where: {
          id: input.examId || undefined,
          classId: input.classId || undefined,
          openAt: { lte: to },
          closeAt: { gte: from },
          class: { instructors: { some: { instructorId: actorId } } },
        },
        include: {
          questions: {
            include: { question: true },
            orderBy: { position: "asc" },
          },
          attempts: {
            where: {
              submittedAt: { gte: from, lte: to },
              status: { in: ["SUBMITTED", "GRADED"] },
            },
            include: { answers: true },
          },
        },
        orderBy: { openAt: "desc" },
      });
      return {
        generatedAt: now(),
        filters: input,
        metricDefinitions,
        exams: rows.map((exam) => {
          const graded = exam.attempts.filter(
            (attempt) => attempt.score !== null,
          );
          const percentages = graded.map(
            (attempt) =>
              (Number(attempt.score) / Number(exam.totalScore)) * 100,
          );
          const questionStatsAvailable = new Date() > exam.closeAt;
          const questionStats = questionStatsAvailable
            ? exam.questions.map(({ question }) => {
                const answers = exam.attempts
                  .map((attempt) =>
                    attempt.answers.find(
                      (answer) => answer.questionId === question.id,
                    ),
                  )
                  .filter((answer) => Boolean(answer));
                const correct = this.toStringArray(question.correctAnswers)
                  .sort()
                  .join("\u0000");
                const correctCount = answers.filter(
                  (answer) =>
                    this.toStringArray(answer!.answerData)
                      .sort()
                      .join("\u0000") === correct,
                ).length;
                return {
                  questionId: question.id,
                  difficulty: question.difficulty,
                  responseCount: answers.length,
                  correctRate: answers.length
                    ? Math.round((correctCount / answers.length) * 10_000) / 100
                    : 0,
                };
              })
            : [];
          return {
            examId: exam.id,
            classId: exam.classId,
            title: exam.title,
            sampleSize: graded.length,
            smallSampleWarning: graded.length < 5,
            averagePercentage: percentages.length
              ? Math.round(
                  (percentages.reduce((sum, value) => sum + value, 0) /
                    percentages.length) *
                    100,
                ) / 100
              : 0,
            passRate: percentages.length
              ? Math.round(
                  (percentages.filter((value) => value >= 50).length /
                    percentages.length) *
                    10_000,
                ) / 100
              : 0,
            questionStatsAvailable,
            questionStats,
          };
        }),
      };
    }
    const exams = this.exams
      .filter(
        (exam) =>
          (!input.examId || exam.id === input.examId) &&
          (!input.classId || exam.classId === input.classId) &&
          this.findClass(exam.classId).instructorIds.includes(actorId) &&
          new Date(exam.openAt) <= to &&
          new Date(exam.closeAt) >= from,
      )
      .map((exam) => {
        const attempts = this.attempts.filter(
          (attempt) =>
            attempt.examId === exam.id &&
            attempt.submittedAt &&
            new Date(attempt.submittedAt) >= from &&
            new Date(attempt.submittedAt) <= to &&
            ["SUBMITTED", "GRADED"].includes(attempt.status),
        );
        const graded = attempts.filter(
          (attempt) => attempt.score !== undefined,
        );
        const percentages = graded.map(
          (attempt) => ((attempt.score ?? 0) / exam.totalScore) * 100,
        );
        const questionStatsAvailable = new Date() > new Date(exam.closeAt);
        const questionStats = questionStatsAvailable
          ? exam.questionIds.map((questionId) => {
              const question = this.questions.find(
                (item) => item.id === questionId,
              );
              if (!question)
                throw new NotFoundException("Đề chứa câu hỏi không tồn tại.");
              const answers = attempts
                .map((attempt) => attempt.answers[questionId])
                .filter((answer): answer is string[] => Boolean(answer));
              const correct = [...question.correctAnswers]
                .sort()
                .join("\u0000");
              return {
                questionId,
                difficulty: question.difficulty,
                responseCount: answers.length,
                correctRate: answers.length
                  ? Math.round(
                      (answers.filter(
                        (answer) =>
                          [...answer].sort().join("\u0000") === correct,
                      ).length /
                        answers.length) *
                        10_000,
                    ) / 100
                  : 0,
              };
            })
          : [];
        return {
          examId: exam.id,
          classId: exam.classId,
          title: exam.title,
          sampleSize: graded.length,
          smallSampleWarning: graded.length < 5,
          averagePercentage: percentages.length
            ? Math.round(
                (percentages.reduce((sum, value) => sum + value, 0) /
                  percentages.length) *
                  100,
              ) / 100
            : 0,
          passRate: percentages.length
            ? Math.round(
                (percentages.filter((value) => value >= 50).length /
                  percentages.length) *
                  10_000,
              ) / 100
            : 0,
          questionStatsAvailable,
          questionStats,
        };
      });
    return { generatedAt: now(), filters: input, metricDefinitions, exams };
  }

  /** Chuyển dữ liệu phân tích đề thi sang CSV có BOM để Excel đọc Unicode đúng. */
  async exportExamAnalytics(
    input: { classId?: string; examId?: string; from?: string; to?: string },
    actorId = "usr-instructor",
  ): Promise<Buffer> {
    const report = await this.getExamAnalytics(input, actorId);
    const escape = (value: string | number | boolean): string =>
      `"${String(value).replaceAll('"', '""')}"`;
    const rows = [
      [
        "examId",
        "classId",
        "title",
        "sampleSize",
        "smallSampleWarning",
        "averagePercentage",
        "passRate",
      ],
      ...report.exams.map((exam) => [
        exam.examId,
        exam.classId,
        exam.title,
        exam.sampleSize,
        exam.smallSampleWarning,
        exam.averagePercentage,
        exam.passRate,
      ]),
    ];
    return Buffer.from(
      `\uFEFF${rows.map((row) => row.map(escape).join(",")).join("\r\n")}`,
      "utf8",
    );
  }

  /** Ánh xạ snapshot tệp học liệu sang thông tin version hiển thị. */
  private mapMaterialVersion(
    row: Prisma.MaterialVersionGetPayload<Record<string, never>>,
  ): MaterialVersionSnapshot {
    const sizeBytes = Number(row.sizeBytes);
    if (!Number.isSafeInteger(sizeBytes))
      throw new BadRequestException(
        "Kích thước phiên bản học liệu vượt giới hạn số an toàn.",
      );
    return {
      id: row.id,
      materialId: row.materialId,
      version: row.version,
      name: normalizeMultipartFileName(row.name),
      mimeType: row.mimeType,
      sizeBytes,
      folder: row.folder,
      tags: this.toStringArray(row.tags),
      visibility: row.visibility,
      createdBy: row.createdBy,
      createdAt: row.createdAt.toISOString(),
    };
  }

  /** Sao chép sâu các mảng câu hỏi in-memory để caller không sửa state nội bộ. */
  private cloneQuestion(item: LearningQuestion): LearningQuestion {
    return {
      ...item,
      options: [...item.options],
      correctAnswers: [...item.correctAnswers],
      tags: [...item.tags],
    };
  }

  /** Chọn version cao nhất trong mỗi family câu hỏi. */
  private latestQuestionVersions(
    items: LearningQuestion[],
  ): LearningQuestion[] {
    const latest = new Map<string, LearningQuestion>();
    for (const item of items) {
      const familyId = item.familyId ?? item.id;
      const current = latest.get(familyId);
      if (!current || item.version > current.version)
        latest.set(familyId, item);
    }
    return [...latest.values()].sort((a, b) => b.version - a.version);
  }

  /** Chỉ tái dùng câu ngân hàng khi nội dung, loại, lựa chọn, đáp án và độ khó khớp hoàn toàn. */
  private sameGeneratedQuestion(existing: { content: string; type: string; difficulty: number; options: unknown; correctAnswers: unknown }, generated: { content: string; type: string; difficulty: number; options: string[]; correctAnswers: string[] }): boolean {
    return existing.content === generated.content && existing.type === generated.type && existing.difficulty === generated.difficulty && JSON.stringify(existing.options) === JSON.stringify(generated.options) && JSON.stringify(existing.correctAnswers) === JSON.stringify(generated.correctAnswers);
  }

  /** Chuẩn hóa nội dung rồi băm để phát hiện câu hỏi trùng. */
  private questionContentHash(content: string): string {
    return createHash("sha256")
      .update(content.trim().replace(/\s+/g, " ").toLowerCase())
      .digest("hex");
  }

  /** Chuẩn hóa rich text/đáp án/tag và kiểm tra quy tắc riêng cho từng loại câu hỏi. */
  private validateQuestionInput(
    input: Omit<LearningQuestion, "id" | "status" | "version">,
  ): Omit<
    LearningQuestion,
    "id" | "status" | "version" | "familyId" | "supersedesId"
  > {
    const content = input.content
      .replace(/\r\n?/g, "\n")
      .split("\n")
      .map((line) => line.trimEnd())
      .join("\n")
      .replace(/\n{4,}/g, "\n\n\n")
      .trim();
    const options = [
      ...new Set(input.options.map((item) => item.trim()).filter(Boolean)),
    ];
    const correctAnswers = [
      ...new Set(
        input.correctAnswers.map((item) => item.trim()).filter(Boolean),
      ),
    ];
    const tags = [
      ...new Set(
        input.tags.map((item) => item.trim().toLowerCase()).filter(Boolean),
      ),
    ];
    if (content.length < 5)
      throw new BadRequestException("Nội dung câu hỏi cần ít nhất 5 ký tự.");
    if (
      !Number.isInteger(input.difficulty) ||
      input.difficulty < 1 ||
      input.difficulty > 3
    )
      throw new BadRequestException("Độ khó phải từ 1 đến 3.");
    const objective = [
      "SINGLE_CHOICE",
      "MULTIPLE_CHOICE",
      "TRUE_FALSE",
    ].includes(input.type);
    if (objective && options.length < 2)
      throw new BadRequestException(
        "Câu hỏi trắc nghiệm cần ít nhất hai lựa chọn khác nhau.",
      );
    if (correctAnswers.some((answer) => !options.includes(answer)) && objective)
      throw new BadRequestException(
        "Đáp án đúng phải nằm trong danh sách lựa chọn.",
      );
    if (
      (input.type === "SINGLE_CHOICE" || input.type === "TRUE_FALSE") &&
      correctAnswers.length !== 1
    )
      throw new BadRequestException(
        "Câu hỏi một đáp án cần đúng một đáp án đúng.",
      );
    if (input.type === "MULTIPLE_CHOICE" && correctAnswers.length < 1)
      throw new BadRequestException(
        "Câu hỏi nhiều đáp án cần ít nhất một đáp án đúng.",
      );
    if (
      input.type === "TRUE_FALSE" &&
      (options.length !== 2 ||
        ![["Đúng", "Sai"], ["True", "False"], ["Đúng (True)", "Sai (False)"]].some((pair) => pair.every((option) => options.includes(option))))
    )
      throw new BadRequestException(
        "Câu hỏi đúng/sai phải có hai lựa chọn Đúng và Sai.",
      );
    return {
      courseId: input.courseId.trim(),
      type: input.type,
      content,
      options,
      correctAnswers,
      difficulty: input.difficulty,
      tags,
    };
  }

  /** Chuẩn hóa đáp án nộp và chặn lựa chọn không thuộc options của câu hỏi. */
  private validateSubmittedAnswers(
    question: LearningQuestion,
    answers: string[],
  ): string[] {
    const normalized = answers.map((answer) => answer.trim()).filter(Boolean);
    if (new Set(normalized).size !== normalized.length)
      throw new BadRequestException(
        "Câu trả lời không được chứa giá trị trùng.",
      );
    if (
      ["SINGLE_CHOICE", "TRUE_FALSE"].includes(question.type) &&
      normalized.length > 1
    )
      throw new BadRequestException("Câu hỏi này chỉ chấp nhận một lựa chọn.");
    if (
      ["SHORT_ANSWER", "ESSAY"].includes(question.type) &&
      normalized.length > 1
    )
      throw new BadRequestException(
        "Câu hỏi này chỉ chấp nhận một nội dung trả lời.",
      );
    if (
      ["SINGLE_CHOICE", "MULTIPLE_CHOICE", "TRUE_FALSE"].includes(
        question.type,
      ) &&
      normalized.some((answer) => !question.options.includes(answer))
    )
      throw new BadRequestException("Lựa chọn trả lời không thuộc câu hỏi.");
    return normalized;
  }

  /** So sánh đáp án khách quan không phụ thuộc thứ tự lựa chọn. */
  private isQuestionAnswerCorrect(
    question: LearningQuestion,
    submitted: string[],
  ): boolean {
    if (question.type === "SHORT_ANSWER") {
      const value = submitted[0]?.trim().toLocaleLowerCase("vi");
      return (
        Boolean(value) &&
        question.correctAnswers.some(
          (answer) => answer.trim().toLocaleLowerCase("vi") === value,
        )
      );
    }
    return (
      JSON.stringify([...submitted].sort()) ===
      JSON.stringify([...question.correctAnswers].sort())
    );
  }

  /** Ánh xạ đề và giữ thứ tự câu hỏi theo trường order trong bảng nối. */
  private mapExam(row: ExamWithQuestions): LearningExam {
    return {
      id: row.id,
      classId: row.classId,
      title: row.title,
      questionIds: row.questions.map(({ questionId }) => questionId),
      durationMinutes: row.durationMinutes,
      totalScore: Number(row.totalScore),
      openAt: row.openAt.toISOString(),
      closeAt: row.closeAt.toISOString(),
      attemptLimit: row.attemptLimit,
      shuffleQuestions: row.shuffleQuestions,
      randomSeed: row.randomSeed ?? undefined,
      questionScores: Object.fromEntries(
        row.questions.map(({ questionId, score }) => [
          questionId,
          Number(score),
        ]),
      ),
      aiContext:
        row.aiContext &&
        typeof row.aiContext === "object" &&
        !Array.isArray(row.aiContext)
          ? (row.aiContext as unknown as LearningExam["aiContext"])
          : undefined,
      status: row.status,
      version: row.version,
    };
  }

  /** Ánh xạ lượt thi cùng câu trả lời và receipt sang hợp đồng API. */
  private mapAttempt(row: AttemptWithAnswers): ExamAttempt {
    return {
      id: row.id,
      examId: row.examId,
      learnerId: row.learnerId,
      answers: Object.fromEntries(
        row.answers.map((answer) => [
          answer.questionId,
          this.toStringArray(answer.answerData),
        ]),
      ),
      status: row.status,
      startedAt: row.startedAt.toISOString(),
      submittedAt: row.submittedAt?.toISOString(),
      score: row.score === null ? undefined : Number(row.score),
      feedback: row.feedback ?? undefined,
      gradePublishedAt: row.gradePublishedAt?.toISOString(),
      serverTime: now(),
      lastSavedAt: row.answers.length
        ? new Date(
            Math.max(
              ...row.answers.map((answer) => answer.updatedAt.getTime()),
            ),
          ).toISOString()
        : undefined,
      submissionReceipt: row.submittedAt
        ? this.submissionReceipt(row.id, row.submittedAt.toISOString())
        : undefined,
    };
  }

  /** Tạo mã biên nhận ngắn có HMAC từ lượt thi và thời điểm nộp. */
  private submissionReceipt(attemptId: string, submittedAt: string): string {
    return `SUB-${createHash("sha256").update(`${attemptId}.${submittedAt}`).digest("hex").slice(0, 16).toUpperCase()}`;
  }

  /** Ánh xạ yêu cầu phúc khảo và các mốc xử lý. */
  private mapRegradeRequest(
    row: Prisma.RegradeRequestGetPayload<Record<string, never>>,
  ): RegradeRequest {
    return {
      id: row.id,
      attemptId: row.attemptId,
      learnerId: row.learnerId,
      reason: row.reason,
      status: row.status,
      resolution: row.resolution ?? undefined,
      assignedToId: row.assignedToId ?? undefined,
      resolvedById: row.resolvedById ?? undefined,
      resolvedAt: row.resolvedAt?.toISOString(),
      createdAt: row.createdAt.toISOString(),
    };
  }

  /** Ánh xạ chủ đề diễn đàn và trạng thái điều phối. */
  private mapTopic(
    row: Prisma.ForumTopicGetPayload<Record<string, never>>,
  ): ForumTopic {
    return {
      id: row.id,
      classId: row.classId,
      title: row.title,
      body: row.body,
      authorId: row.authorId,
      tags: this.toStringArray(row.tags),
      isPinned: row.isPinned,
      isLocked: row.isLocked,
      status: row.status === "PUBLISHED" ? "VISIBLE" : "HIDDEN",
      createdAt: row.createdAt.toISOString(),
    };
  }

  /** Ánh xạ bài viết, mentions và tệp đính kèm nếu relation đã được include. */
  private mapPost(
    row:
      | Prisma.ForumPostGetPayload<Record<string, never>>
      | ForumPostWithRelations,
  ): ForumPost {
    return {
      id: row.id,
      topicId: row.topicId,
      authorId: row.authorId,
      body: row.status === "PUBLISHED" ? row.body : "[Nội dung đã bị ẩn]",
      parentId: row.parentId ?? undefined,
      status: row.status === "PUBLISHED" ? "VISIBLE" : "HIDDEN",
      attachmentIds:
        row.status === "PUBLISHED" && "attachments" in row
          ? row.attachments.map((item) => item.materialId)
          : [],
      mentionedUserIds:
        row.status === "PUBLISHED" && "mentions" in row
          ? row.mentions.map((item) => item.mentionedUserId)
          : [],
      createdAt: row.createdAt.toISOString(),
      editedAt: row.editedAt?.toISOString(),
      deletedAt: row.deletedAt?.toISOString(),
      editCount: Array.isArray(row.editHistory) ? row.editHistory.length : 0,
    };
  }

  /** Ánh xạ báo cáo nội dung và lịch sử moderation action tùy relation. */
  private mapReport(
    row:
      | Prisma.ContentReportGetPayload<Record<string, never>>
      | ContentReportWithActions,
  ): ContentReport {
    if (row.targetType !== "TOPIC" && row.targetType !== "POST")
      throw new BadRequestException("Loại nội dung báo cáo không hợp lệ.");
    return {
      id: row.id,
      targetType: row.targetType,
      targetId: row.targetId,
      reporterId: row.reporterId,
      reason: row.reason,
      details: row.details,
      status: row.status,
      resolution: row.resolution ?? undefined,
      assignedToId: row.assignedToId ?? undefined,
      escalationLevel: row.escalationLevel,
      resolvedAt: row.resolvedAt?.toISOString(),
      appealReason: row.appealReason ?? undefined,
      appealedAt: row.appealedAt?.toISOString(),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      actions:
        "actions" in row
          ? row.actions.map((action) => ({
              id: action.id,
              reportId: action.reportId,
              actorId: action.actorId,
              action: action.action as ModerationActionRecord["action"],
              reason: action.reason,
              previousStatus: action.previousStatus,
              nextStatus: action.nextStatus,
              createdAt: action.createdAt.toISOString(),
            }))
          : [],
    };
  }

  /** Ánh xạ biện pháp can thiệp tiến độ sang kiểu ngày ISO. */
  private mapProgressIntervention(
    row: Prisma.ProgressInterventionGetPayload<Record<string, never>>,
  ): ProgressIntervention {
    return {
      id: row.id,
      classId: row.classId,
      learnerId: row.learnerId,
      ownerId: row.ownerId,
      createdById: row.createdById,
      title: row.title,
      notes: row.notes ?? undefined,
      dueAt: row.dueAt.toISOString(),
      status: row.status,
      outcome: row.outcome ?? undefined,
      cancellationReason: row.cancellationReason ?? undefined,
      acceptedAt: row.acceptedAt?.toISOString(),
      completedAt: row.completedAt?.toISOString(),
      history: this.progressInterventionHistory(row.handoffHistory),
      createdAt: row.createdAt.toISOString(),
    };
  }

  /** Chuẩn hóa lịch sử bàn giao JSON trước khi đưa ra API hoặc ghi nối tiếp. */
  private progressInterventionHistory(
    value: Prisma.JsonValue,
  ): ProgressIntervention["history"] {
    if (!Array.isArray(value)) return [];
    return value.flatMap((entry) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry))
        return [];
      const row = entry as Record<string, Prisma.JsonValue>;
      return typeof row.fromOwnerId === "string" &&
        typeof row.toOwnerId === "string" &&
        typeof row.reason === "string" &&
        typeof row.actorId === "string" &&
        typeof row.createdAt === "string"
        ? [
            {
              fromOwnerId: row.fromOwnerId,
              toOwnerId: row.toOwnerId,
              reason: row.reason,
              actorId: row.actorId,
              createdAt: row.createdAt,
            },
          ]
        : [];
    });
  }

  /** Ánh xạ trạng thái bản xuất báo cáo mà không lộ object key lưu trữ. */
  private mapReportExport(
    row: Prisma.ReportExportGetPayload<Record<string, never>>,
  ): ReportExport {
    const sizeBytes =
      row.sizeBytes === null ? undefined : Number(row.sizeBytes);
    if (sizeBytes !== undefined && !Number.isSafeInteger(sizeBytes))
      throw new BadRequestException(
        "Kích thước tệp báo cáo vượt giới hạn an toàn.",
      );
    return {
      id: row.id,
      reportRunId: row.reportRunId,
      format: row.format as "CSV",
      status: row.status,
      fileName: row.fileName,
      sizeBytes,
      errorMessage: row.errorMessage ?? undefined,
      expiresAt: row.expiresAt.toISOString(),
      createdAt: row.createdAt.toISOString(),
    };
  }

  /** Parse khoảng báo cáo, áp dụng mặc định và từ chối ngày đảo ngược/không hợp lệ. */
  private reportingPeriod(
    fromInput?: string,
    toInput?: string,
  ): { from: Date; to: Date } {
    const to = toInput ? new Date(toInput) : new Date();
    const from = fromInput
      ? new Date(fromInput)
      : new Date(to.getTime() - 365 * 86_400_000);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()))
      throw new BadRequestException("Khoảng thời gian báo cáo không hợp lệ.");
    if (from > to)
      throw new BadRequestException(
        "Ngày bắt đầu báo cáo phải trước ngày kết thúc.",
      );
    if (to.getTime() - from.getTime() > 5 * 365 * 86_400_000)
      throw new BadRequestException(
        "Khoảng thời gian báo cáo không được vượt quá 5 năm.",
      );
    return { from, to };
  }

  /** Bảo đảm các ngưỡng rủi ro nằm trong miền phần trăm hợp lệ. */
  private validateRiskThresholds(thresholds: RiskThresholds): void {
    for (const [name, value] of Object.entries(thresholds))
      if (!Number.isInteger(value) || value < 1 || value > 100)
        throw new BadRequestException(
          `Ngưỡng ${name} phải là số nguyên từ 1 đến 100.`,
        );
  }

  /** Dùng Intl kiểm tra tên múi giờ IANA trước khi lưu lớp. */
  private validateTimezone(timezone: string): void {
    try {
      new Intl.DateTimeFormat("vi-VN", { timeZone: timezone }).format(
        new Date(),
      );
    } catch {
      throw new BadRequestException("Múi giờ lớp học không hợp lệ.");
    }
  }

  /** Tính phần trăm làm tròn và tránh chia cho zero. */
  private percentage(numerator: number, denominator: number): number {
    return denominator > 0
      ? Math.round((numerator / denominator) * 10_000) / 100
      : 0;
  }

  /** Trả mốc ISO mới nhất hoặc undefined khi không có dữ liệu. */
  private latestDate(values: Date[]): string | undefined {
    if (!values.length) return undefined;
    return new Date(
      Math.max(...values.map((value) => value.getTime())),
    ).toISOString();
  }

  /** So sánh chỉ số học viên với ngưỡng để sinh mức và lý do rủi ro. */
  private buildLearnerProgress(
    input: Omit<LearnerProgress, "riskLevel" | "riskReasons"> & {
      thresholds: RiskThresholds;
    },
  ): LearnerProgress {
    const reasons: string[] = [];
    if (input.attendanceRate < input.thresholds.attendanceBelow)
      reasons.push(
        `Điểm danh ${input.attendanceRate}% thấp hơn ngưỡng ${input.thresholds.attendanceBelow}%.`,
      );
    if (input.averageScore < input.thresholds.scoreBelow)
      reasons.push(
        `Điểm trung bình ${input.averageScore}% thấp hơn ngưỡng ${input.thresholds.scoreBelow}%.`,
      );
    const overallCompletion =
      Math.round(
        ((input.materialCompletionRate + input.assessmentCompletionRate) / 2) *
          100,
      ) / 100;
    if (overallCompletion < input.thresholds.completionBelow)
      reasons.push(
        `Tiến độ tổng hợp ${overallCompletion}% thấp hơn ngưỡng ${input.thresholds.completionBelow}%.`,
      );
    const riskLevel: LearnerProgress["riskLevel"] =
      reasons.length >= 2 ? "HIGH" : reasons.length === 1 ? "MEDIUM" : "LOW";
    return {
      learnerId: input.learnerId,
      materialCompletionRate: input.materialCompletionRate,
      assessmentCompletionRate: input.assessmentCompletionRate,
      attendanceRate: input.attendanceRate,
      averageScore: input.averageScore,
      lastActivityAt: input.lastActivityAt,
      interventions: input.interventions,
      riskLevel,
      riskReasons: reasons,
    };
  }

  /** Chuyển snapshot vận hành sang CSV tiếng Việt có escape trường dữ liệu. */
  private operationalReportCsv(report: OperationalReport): string {
    const rows: Array<[string, string | number]> = [
      ["Phiên bản định nghĩa", report.definitionVersion],
      ["Múi giờ", report.timezone],
      ["Thời điểm tạo", report.generatedAt],
      ["Khóa học", report.courses],
      ["Lớp học", report.classes],
      ["Lớp đang hoạt động", report.activeClasses],
      ["Học viên", report.learners],
      ["Học liệu", report.materials],
      ["Học liệu đã phát hành", report.publishedMaterials],
      ["Câu hỏi", report.questions],
      ["Đề thi", report.exams],
      ["Buổi trực tuyến", report.liveSessions],
      ["Báo cáo diễn đàn mở", report.openReports],
      ["Phiếu hỗ trợ mở", report.openTickets],
    ];
    const escape = (value: string | number): string =>
      `"${String(value).replaceAll('"', '""')}"`;
    return [["Chỉ số", "Giá trị"], ...rows]
      .map((row) => row.map(escape).join(","))
      .join("\r\n");
  }

  /** Ghi action kiểm duyệt và cập nhật báo cáo trong fallback in-memory. */
  private recordMemoryModeration(
    report: ContentReport,
    actorId: string,
    action: ModerationActionRecord["action"],
    reason: string,
    nextStatus: ContentReport["status"],
  ): void {
    const timestamp = now();
    const record: ModerationActionRecord = {
      id: id("mod-action"),
      reportId: report.id,
      actorId,
      action,
      reason,
      previousStatus: report.status,
      nextStatus,
      createdAt: timestamp,
    };
    this.moderationActions.unshift(record);
    report.actions.push(record);
    report.status = nextStatus;
    report.updatedAt = timestamp;
  }

  /** Thêm dấu vết thay đổi thành viên lớp vào lịch sử in-memory. */
  private recordMemberHistory(
    classId: string,
    memberId: string,
    memberType: ClassMemberHistory["memberType"],
    action: string,
    actorId: string,
    detail: { role?: InstructorRole; source?: string; reason?: string },
  ): void {
    this.classMemberHistory.unshift({
      id: `${classId}:${id("member-history")}`,
      memberId,
      memberType,
      action,
      actorId,
      createdAt: now(),
      ...detail,
    });
  }

  /** Dựng URL chủ phòng/người học cho provider demo bằng token phòng ngẫu nhiên. */
  private buildProviderUrls(
    provider: LiveSession["provider"],
    token: string,
  ): { hostUrl: string; attendeeUrl: string } {
    const base =
      provider === "ZOOM"
        ? "https://zoom.us/wc/join"
        : provider === "GOOGLE_MEET"
          ? "https://meet.google.com"
          : "https://meet.jit.si";
    return {
      hostUrl: `${base}/${token}?role=host`,
      attendeeUrl: `${base}/${token}`,
    };
  }

  /** Xáo trộn xác định theo seed để một học viên nhận thứ tự ổn định trong lượt thi. */
  private seededOrder(values: string[], seed: string): string[] {
    return [...values].sort(
      (left, right) =>
        createHash("sha256")
          .update(`${seed}:${left}`)
          .digest("hex")
          .localeCompare(
            createHash("sha256").update(`${seed}:${right}`).digest("hex"),
          ) || left.localeCompare(right),
    );
  }

  /** Chuẩn hóa phân bổ điểm từng câu, đối chiếu đủ câu và tổng điểm với sai số hai chữ số thập phân. */
  private resolveExamScoreAllocations(
    questionIds: string[],
    totalScore: number,
    allocations?: Array<{ questionId: string; score: number }>,
  ): Record<string, number> {
    if (!allocations?.length) {
      const base = Math.floor((totalScore / questionIds.length) * 100) / 100;
      const scores = Object.fromEntries(
        questionIds.map((questionId) => [questionId, base]),
      );
      scores[questionIds[questionIds.length - 1]!] =
        Math.round((totalScore - base * (questionIds.length - 1)) * 100) / 100;
      return scores;
    }
    if (
      allocations.length !== questionIds.length ||
      new Set(allocations.map((item) => item.questionId)).size !==
        questionIds.length
    )
      throw new BadRequestException(
        "Cần phân bổ đúng một mức điểm cho từng câu hỏi.",
      );
    const expectedIds = new Set(questionIds);
    if (
      allocations.some(
        (item) =>
          !expectedIds.has(item.questionId) ||
          !Number.isFinite(item.score) ||
          item.score <= 0,
      )
    )
      throw new BadRequestException(
        "Phân bổ điểm chứa câu hỏi hoặc mức điểm không hợp lệ.",
      );
    const allocatedTotal =
      Math.round(allocations.reduce((sum, item) => sum + item.score, 0) * 100) /
      100;
    if (Math.abs(allocatedTotal - totalScore) > 0.001)
      throw new BadRequestException(
        `Tổng điểm từng câu phải bằng ${totalScore}.`,
      );
    return Object.fromEntries(
      allocations.map((item) => [
        item.questionId,
        Math.round(item.score * 100) / 100,
      ]),
    );
  }

  /** Lấy thang điểm một câu trong fallback in-memory, hỗ trợ dữ liệu cũ chia đều. */
  private examQuestionScore(exam: LearningExam, questionId: string): number {
    return (
      exam.questionScores?.[questionId] ??
      (exam.questionIds.length ? exam.totalScore / exam.questionIds.length : 0)
    );
  }

  /** Thử cấp phòng provider yêu cầu và chuyển sang fallback khi provider không khả dụng. */
  private async provisionProviderMeeting(requested: LiveSession["provider"]): Promise<{
    provider: LiveSession["provider"];
    hostUrl: string;
    attendeeUrl: string;
    fallbackUsed: boolean;
    attempts: number;
  }> {
    const retryLimit =
      this.config?.get("LIVE_PROVIDER_RETRY_LIMIT", { infer: true }) ?? 2;
    const rawOrder =
      this.config?.get("LIVE_PROVIDER_FALLBACK_ORDER", { infer: true }) ??
      "GOOGLE_MEET,ZOOM,JITSI";
    const rawFailures =
      this.config?.get("LIVE_PROVIDER_SIMULATED_FAILURES", { infer: true }) ??
      "";
    const configuredOrder = rawOrder
      .split(",")
      .map((value) => value.trim())
      .filter((value): value is LiveSession["provider"] =>
        this.isLiveProvider(value),
      );
    const failures = new Set(
      rawFailures
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean),
    );
    const integrations = this.system ? await this.system.listIntegrations() : undefined;
    const readyProviders = integrations
      ? new Set(
          integrations
            .filter((item) => item.enabled && item.healthStatus === "HEALTHY")
            .map((item) => item.provider),
        )
      : undefined;
    const defaultProvider = integrations?.find(
      (item) => item.enabled && item.isDefault && item.healthStatus === "HEALTHY",
    )?.provider;
    const candidates = [
      ...new Set(
        [requested, defaultProvider, ...configuredOrder]
          .filter((value): value is LiveSession["provider"] => Boolean(value)),
      ),
    ];
    let attempts = 0;
    for (const provider of candidates) {
      if (readyProviders && !readyProviders.has(provider)) continue;
      if (this.system && provider !== "JITSI") continue;
      for (let retry = 0; retry < retryLimit; retry += 1) {
        attempts += 1;
        if (failures.has(provider)) continue;
        return {
          provider,
          ...this.buildProviderUrls(provider, randomUUID()),
          fallbackUsed: provider !== requested,
          attempts,
        };
      }
    }
    throw new ServiceUnavailableException(
      `Không thể tạo phòng học sau ${attempts} lần thử. Vui lòng kiểm tra cấu hình provider hoặc thử lại sau.`,
    );
  }

  /** Truy vấn danh sách userId đang có một vai trò cụ thể để phát thông báo. */
  private async userIdsForRole(
    database: PrismaService | Prisma.TransactionClient,
    roleCode: string,
  ): Promise<string[]> {
    const rows = await database.user.findMany({
      where: {
        status: "ACTIVE",
        roles: { some: { role: { code: roleCode } } },
      },
      select: { id: true },
    });
    return rows.map(({ id: userId }) => userId);
  }

  /** Tạo notification hàng loạt cho giảng viên và học viên hoạt động của lớp. */
  private async notifyClassMembers(
    database: PrismaService | Prisma.TransactionClient,
    classId: string,
    type: string,
    title: string,
    entityId: string,
    templateEventCode?: string,
    templateVariables: Record<string, string> = {},
  ): Promise<void> {
    const item = await database.learningClass.findUnique({
      where: { id: classId },
      include: {
        instructors: { select: { instructorId: true } },
        enrollments: {
          where: { status: "ACTIVE" },
          select: { learnerId: true },
        },
      },
    });
    if (!item) return;
    const resolvedTitle =
      this.system && templateEventCode
        ? await this.system.renderPublishedNotification(
            templateEventCode,
            templateVariables,
            title,
          )
        : title;
    const recipients = new Set([
      ...item.instructors.map((row) => row.instructorId),
      ...item.enrollments.map((row) => row.learnerId),
    ]);
    for (const recipientId of recipients)
      await database.notification.upsert({
        where: { dedupKey: `${type}:${entityId}:${recipientId}` },
        update: { title: resolvedTitle, readAt: null },
        create: {
          id: id("notification"),
          recipientId,
          type,
          title: resolvedTitle,
          entityType: "LIVE_SESSION",
          entityId,
          dedupKey: `${type}:${entityId}:${recipientId}`,
        },
      });
  }

  /** Ánh xạ buổi học trực tuyến và metadata provider/recording sang API. */
  private mapSession(
    row: Prisma.LiveSessionGetPayload<Record<string, never>>,
  ): LiveSession {
    if (!this.isLiveProvider(row.provider))
      throw new BadRequestException(
        `Nhà cung cấp lớp trực tuyến ${row.provider} không được hỗ trợ.`,
      );
    return {
      id: row.id,
      classId: row.classId,
      hostId: row.hostId,
      title: row.title,
      startsAt: row.startsAt.toISOString(),
      endsAt: row.endsAt.toISOString(),
      provider: row.provider,
      requestedProvider: this.isLiveProvider(row.requestedProvider)
        ? row.requestedProvider
        : row.provider,
      fallbackUsed: row.fallbackUsed,
      provisioningAttempts: row.provisioningAttempts,
      status: row.status,
      hostUrl: row.hostUrl,
      attendeeUrl: row.attendeeUrl,
      recordingUrl: row.recordingUrl ?? undefined,
      recordingStatus:
        row.recordingExpiresAt &&
        row.recordingExpiresAt <= new Date() &&
        row.recordingStatus === "READY"
          ? "EXPIRED"
          : (row.recordingStatus as LiveSession["recordingStatus"]),
      recordingReadyAt: row.recordingReadyAt?.toISOString(),
      recordingExpiresAt: row.recordingExpiresAt?.toISOString(),
      recordingError: row.recordingError ?? undefined,
      timezone: row.timezone,
      changeReason: row.changeReason ?? undefined,
      cancellationReason: row.cancellationReason ?? undefined,
      attendanceLockedAt: row.attendanceLockedAt?.toISOString(),
      attendanceLockedById: row.attendanceLockedById ?? undefined,
    };
  }

  /** Ánh xạ bản ghi điểm danh và các mốc tham dự/điều chỉnh. */
  private mapAttendance(
    row: Prisma.AttendanceRecordGetPayload<Record<string, never>>,
  ): AttendanceRecord {
    return {
      sessionId: row.sessionId,
      learnerId: row.learnerId,
      joinedAt: row.joinedAt?.toISOString(),
      leftAt: row.leftAt?.toISOString(),
      attendedMinutes: row.attendedMinutes,
      status: row.status,
      adjustmentReason: row.adjustmentReason ?? undefined,
      providerParticipantId: row.providerParticipantId ?? undefined,
      providerSnapshot:
        row.providerSnapshot &&
        typeof row.providerSnapshot === "object" &&
        !Array.isArray(row.providerSnapshot)
          ? ({ ...row.providerSnapshot } as Record<string, unknown>)
          : undefined,
    };
  }

  /** Ánh xạ khiếu nại điểm danh sang dữ liệu hiển thị. */
  private mapAttendanceAppeal(
    row: Prisma.AttendanceAppealGetPayload<Record<string, never>>,
  ): AttendanceAppeal {
    return {
      id: row.id,
      sessionId: row.sessionId,
      learnerId: row.learnerId,
      reason: row.reason,
      status: row.status,
      resolution: row.resolution ?? undefined,
      createdAt: row.createdAt.toISOString(),
    };
  }

  /** Ánh xạ phiếu hỗ trợ và tệp đính kèm khi relation đã được tải. */
  private mapTicket(
    row:
      | Prisma.SupportTicketGetPayload<Record<string, never>>
      | SupportTicketWithAttachments,
  ): SupportTicket {
    return {
      id: row.id,
      clientRequestId: row.clientRequestId ?? undefined,
      reporterId: row.reporterId,
      category: row.category,
      severity: row.severity,
      description: row.description,
      contextId: row.contextId ?? undefined,
      duplicateOfId: row.duplicateOfId ?? undefined,
      status: row.status,
      assigneeId: row.assigneeId ?? undefined,
      resolution: row.resolution ?? undefined,
      dueAt: row.dueAt.toISOString(),
      attachments:
        "attachments" in row
          ? row.attachments.map((attachment) => ({
              id: attachment.id,
              ticketId: attachment.ticketId,
              name: attachment.name,
              mimeType: attachment.mimeType,
              sizeBytes: Number(attachment.sizeBytes),
              checksum: attachment.checksum,
              createdAt: attachment.createdAt.toISOString(),
            }))
          : [],
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  /** Type guard giới hạn provider vào danh mục phòng họp được hỗ trợ. */
  private isLiveProvider(value: string): value is LiveSession["provider"] {
    return value === "GOOGLE_MEET" || value === "ZOOM" || value === "JITSI";
  }

  /** Kiểm tra số lượng, userId và mốc thời gian của dữ liệu điểm danh provider. */
  private validateProviderAttendanceInput(
    records: ProviderAttendanceInput[],
  ): void {
    if (!records.length)
      throw new BadRequestException("Cần ít nhất một bản ghi từ nhà cung cấp.");
    const participantOwners = new Map<string, string>();
    for (const record of records) {
      const participantOwner = participantOwners.get(
        record.providerParticipantId,
      );
      if (participantOwner && participantOwner !== record.learnerId)
        throw new ConflictException(
          `Mã người tham dự ${record.providerParticipantId} thuộc nhiều học viên.`,
        );
      const joinedAt = new Date(record.joinedAt);
      const leftAt = new Date(record.leftAt);
      if (
        Number.isNaN(joinedAt.getTime()) ||
        Number.isNaN(leftAt.getTime()) ||
        leftAt <= joinedAt
      )
        throw new BadRequestException(
          `Khoảng tham dự của ${record.learnerId} không hợp lệ.`,
        );
      participantOwners.set(record.providerParticipantId, record.learnerId);
    }
  }

  /** Cắt khoảng tham dự theo biên buổi học rồi tính số phút hợp lệ. */
  private calculateProviderAttendanceMinutes(
    joinedAt: Date,
    leftAt: Date,
    startsAt: Date,
    endsAt: Date,
  ): number {
    if (
      joinedAt > new Date(endsAt.getTime() + 30 * 60_000) ||
      leftAt < new Date(startsAt.getTime() - 15 * 60_000)
    )
      throw new BadRequestException(
        "Khoảng tham dự nằm ngoài cửa sổ của buổi học.",
      );
    const effectiveStart = new Date(
      Math.max(joinedAt.getTime(), startsAt.getTime()),
    );
    const effectiveEnd = new Date(Math.min(leftAt.getTime(), endsAt.getTime()));
    return Math.max(
      0,
      Math.round((effectiveEnd.getTime() - effectiveStart.getTime()) / 60_000),
    );
  }

  /** Hợp nhất các khoảng chồng nhau, cắt theo thời lượng buổi và trả tổng phút không đếm trùng. */
  private mergedAttendanceMinutes(
    intervals: Array<{ joinedAt: Date; leftAt: Date }>,
    startsAt: Date,
    endsAt: Date,
  ): number {
    const clipped = intervals
      .map((item) => ({
        start: Math.max(item.joinedAt.getTime(), startsAt.getTime()),
        end: Math.min(item.leftAt.getTime(), endsAt.getTime()),
      }))
      .filter((item) => item.end > item.start)
      .sort((left, right) => left.start - right.start);
    if (!clipped.length) return 0;
    let total = 0;
    let currentStart = clipped[0]!.start;
    let currentEnd = clipped[0]!.end;
    for (const interval of clipped.slice(1)) {
      if (interval.start <= currentEnd)
        currentEnd = Math.max(currentEnd, interval.end);
      else {
        total += currentEnd - currentStart;
        currentStart = interval.start;
        currentEnd = interval.end;
      }
    }
    total += currentEnd - currentStart;
    return Math.max(0, Math.round(total / 60_000));
  }

  /** Suy ra PRESENT/LATE/ABSENT từ giờ vào và tổng phút provider ghi nhận. */
  private deriveProviderAttendanceStatus(
    joinedAt: Date,
    attendedMinutes: number,
    startsAt: Date,
  ): AttendanceRecord["status"] {
    if (attendedMinutes === 0) return "ABSENT";
    return joinedAt.getTime() > startsAt.getTime() + 10 * 60_000
      ? "LATE"
      : "PRESENT";
  }

  /** Chặn số phút âm hoặc vượt quá độ dài buổi học. */
  private validateAttendanceMinutes(
    attendedMinutes: number,
    startsAt: Date,
    endsAt: Date,
  ): void {
    const maximum = Math.max(
      0,
      Math.round((endsAt.getTime() - startsAt.getTime()) / 60_000) + 30,
    );
    if (
      !Number.isInteger(attendedMinutes) ||
      attendedMinutes < 0 ||
      attendedMinutes > maximum
    )
      throw new BadRequestException(
        `Số phút tham dự phải từ 0 đến ${maximum}.`,
      );
  }

  /** Chuyển các bộ đếm nghiệp vụ còn mở thành danh sách blocker đóng lớp. */
  private buildClassClosureReadiness(
    status: LearningClass["status"],
    endAt: Date,
    counts: Omit<ClassClosureReadiness, "eligible" | "blockers">,
  ): ClassClosureReadiness {
    const blockers: string[] = [];
    if (status !== "ACTIVE") blockers.push("lớp không ở trạng thái hoạt động");
    if (endAt > new Date()) blockers.push("chưa đến ngày kết thúc lớp");
    if (counts.openExams)
      blockers.push(`${counts.openExams} kỳ thi đang mở hoặc chờ duyệt`);
    if (counts.inProgressAttempts)
      blockers.push(`${counts.inProgressAttempts} lượt thi đang làm`);
    if (counts.pendingGrades)
      blockers.push(`${counts.pendingGrades} bài nộp chưa chấm`);
    if (counts.openAssignments)
      blockers.push(`${counts.openAssignments} bài tập đang mở`);
    if (counts.pendingAssignmentGrades)
      blockers.push(
        `${counts.pendingAssignmentGrades} bài tập đã nộp chưa chấm`,
      );
    if (counts.openRegrades)
      blockers.push(`${counts.openRegrades} yêu cầu phúc khảo chưa kết thúc`);
    if (counts.activeSessions)
      blockers.push(`${counts.activeSessions} buổi học chưa kết thúc`);
    if (counts.unlockedAttendanceSessions)
      blockers.push(
        `${counts.unlockedAttendanceSessions} kỳ điểm danh chưa khóa`,
      );
    if (counts.openAppeals)
      blockers.push(`${counts.openAppeals} yêu cầu điểm danh chưa xử lý`);
    return { eligible: blockers.length === 0, blockers, ...counts };
  }

  /** Thu hẹp action lưu trong DB về tập hành động kiểm duyệt tệp hỗ trợ. */
  private fileReviewAction(value: string): FileReviewRecord["action"] {
    if (value === "APPROVE" || value === "HIDE" || value === "REQUEST_CHANGES")
      return value;
    throw new BadRequestException(
      "Hành động kiểm duyệt học liệu không hợp lệ.",
    );
  }

  /** Tải lớp cùng thành viên và ném 404 nhất quán nếu không tồn tại. */
  private async getDatabaseClass(
    database: PrismaService | Prisma.TransactionClient,
    classId: string,
  ): Promise<LearningClass> {
    const row = await database.learningClass.findUnique({
      where: { id: classId },
      include: {
        instructors: true,
        enrollments: { where: { status: "ACTIVE" } },
      },
    });
    if (!row) throw new NotFoundException("Không tìm thấy lớp học.");
    return this.mapClass(row);
  }

  /** Tải đề cùng câu hỏi theo thứ tự để dùng chung giữa các luồng thi. */
  private async getDatabaseExam(
    database: PrismaService | Prisma.TransactionClient,
    examId: string,
  ): Promise<LearningExam> {
    const row = await database.exam.findUnique({
      where: { id: examId },
      include: { questions: { orderBy: { position: "asc" } } },
    });
    if (!row) throw new NotFoundException("Không tìm thấy đề.");
    return this.mapExam(row);
  }

  /** Tải lượt thi cùng đáp án và ném 404 nhất quán. */
  private async getDatabaseAttempt(
    database: PrismaService | Prisma.TransactionClient,
    attemptId: string,
  ): Promise<ExamAttempt> {
    const row = await database.examAttempt.findUnique({
      where: { id: attemptId },
      include: { answers: true },
    });
    if (!row) throw new NotFoundException("Không tìm thấy lượt làm bài.");
    return this.mapAttempt(row);
  }

  /** Bắt buộc user tồn tại, ACTIVE và có vai trò yêu cầu trước mutation thành viên. */
  private async requireUserRole(
    database: PrismaService,
    userId: string,
    roleCode: "INSTRUCTOR" | "LEARNER",
    message: string,
  ): Promise<void> {
    const user = await database.user.findFirst({
      where: {
        id: userId,
        status: "ACTIVE",
        roles: { some: { role: { code: roleCode } } },
      },
      select: { id: true },
    });
    if (!user) throw new BadRequestException(message);
  }

  /** Đọc chính sách storage từ cấu hình hệ thống và áp dụng mặc định an toàn. */
  private async getStoragePolicy(database: PrismaService): Promise<{
    maxFileSizeMb: number;
    storageQuotaMb: number;
    allowedMimeTypes: string[];
  }> {
    const row = await database.systemSetting.findUnique({
      where: { key: "platform" },
      select: { value: true },
    });
    const record =
      typeof row?.value === "object" &&
      row.value !== null &&
      !Array.isArray(row.value)
        ? (row.value as Record<string, unknown>)
        : {};
    return {
      maxFileSizeMb:
        typeof record.maxFileSizeMb === "number" ? record.maxFileSizeMb : 50,
      storageQuotaMb:
        typeof record.storageQuotaMb === "number"
          ? record.storageQuotaMb
          : 10_240,
      allowedMimeTypes: includeSupportedDocumentMimeTypes(
        Array.isArray(record.allowedMimeTypes) &&
          record.allowedMimeTypes.every((item) => typeof item === "string")
          ? record.allowedMimeTypes
          : DEFAULT_MATERIAL_MIME_TYPES,
      ),
    };
  }

  /** Kiểm tra quota/chính sách, quét virus rồi ghi upload vào namespace material/quarantine. */
  private async storeUpload(
    classId: string,
    materialId: string,
    upload: UploadedMaterialFile,
    quarantined = false,
  ): Promise<{ objectKey: string; checksum: string }> {
    if (upload.size !== (upload.path ? (await stat(upload.path)).size : upload.buffer.length))
      throw new BadRequestException(
        "Kích thước tệp tải lên không khớp nội dung nhận được.",
      );
    const safeExtension = extname(upload.originalName)
      .toLowerCase()
      .replace(/[^a-z0-9.]/g, "")
      .slice(0, 12);
    const objectKey = `${quarantined ? "quarantine" : "files"}/${classId}/${materialId}${safeExtension}`;
    if (this.objectStorage)
      return upload.path ? this.objectStorage.putFile(objectKey, upload.path) : this.objectStorage.put(objectKey, upload.buffer);
    const target = this.resolveObjectPath(objectKey);
    await mkdir(dirname(target), { recursive: true });
    if (upload.path) return { objectKey, ...(await streamToFile(createReadStream(upload.path), target, upload.size)) };
    await writeFile(target, upload.buffer, { flag: "wx" }).catch(
      (error: unknown) => {
        if (
          typeof error === "object" &&
          error !== null &&
          "code" in error &&
          error.code === "EEXIST"
        )
          throw new ConflictException("Khóa lưu trữ học liệu đã tồn tại.");
        throw error;
      },
    );
    return {
      objectKey,
      checksum: `sha256:${createHash("sha256").update(upload.buffer).digest("hex")}`,
    };
  }

  /** Ghi object qua storage service hoặc filesystem fallback đã chặn path traversal. */
  private async writeStoredFile(
    objectKey: string,
    buffer: Buffer,
  ): Promise<StoredObject> {
    if (this.objectStorage) return this.objectStorage.put(objectKey, buffer);
    const target = this.resolveObjectPath(objectKey);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, buffer, { flag: "wx" }).catch((error: unknown) => {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "EEXIST"
      )
        throw new ConflictException(
          "Tệp bằng chứng đã tồn tại trong kho lưu trữ.",
        );
      throw error;
    });
    return {
      objectKey,
      checksum: `sha256:${createHash("sha256").update(buffer).digest("hex")}`,
    };
  }

  /** Xóa object theo best-effort ở provider chính hoặc filesystem fallback. */
  private async removeStoredFile(objectKey: string): Promise<void> {
    if (this.objectStorage) {
      await this.objectStorage.remove(objectKey);
      return;
    }
    await unlink(this.resolveObjectPath(objectKey)).catch((error: unknown) => {
      if (
        !(
          typeof error === "object" &&
          error !== null &&
          "code" in error &&
          error.code === "ENOENT"
        )
      )
        throw error;
    });
  }

  /** Chỉ xóa ảnh câu hỏi khi không còn version nào tham chiếu cùng object key. */
  private async removeQuestionObjectIfUnreferenced(
    objectKey: string,
  ): Promise<void> {
    const prisma = this.database();
    if (
      prisma &&
      (await prisma.question.count({ where: { imageObjectKey: objectKey } })) >
        0
    )
      return;
    await this.removeStoredFile(objectKey);
  }

  /** Resolve đường dẫn fallback và từ chối object key thoát khỏi storage root. */
  private resolveObjectPath(objectKey: string): string {
    const root = resolve(
      this.config?.get("STORAGE_ROOT", { infer: true }) ?? "../TestDoAn-data",
    );
    const target = resolve(root, objectKey);
    if (target !== root && !target.startsWith(`${root}${sep}`))
      throw new BadRequestException("Đường dẫn lưu trữ không hợp lệ.");
    return target;
  }

  /** Ký HMAC liên kết học liệu, ràng buộc id, hạn và loại hành động. */
  private signMaterialAccess(
    materialId: string,
    expires: number,
    action: MaterialAccessAction,
  ): string {
    const secret =
      this.config?.get("STORAGE_SIGNING_SECRET", { infer: true }) ??
      "development-storage-signing-key-change-me";
    return createHmac("sha256", secret)
      .update(`${materialId}.${expires}.${action}`)
      .digest("base64url");
  }

  /** Ký liên kết bản ghi gắn riêng với buổi học và học viên. */
  private signRecordingAccess(
    sessionId: string,
    expires: number,
    learnerId: string,
  ): string {
    const secret =
      this.config?.get("STORAGE_SIGNING_SECRET", { infer: true }) ??
      "development-storage-signing-key-change-me";
    return createHmac("sha256", secret)
      .update(`recording.${sessionId}.${learnerId}.${expires}`)
      .digest("base64url");
  }

  /** Kiểm tra hạn và so sánh chữ ký constant-time, trả thông báo nghiệp vụ tương ứng. */
  private verifyExpiringSignature(
    expectedSignature: string,
    expires: number,
    signature: string,
    message: string,
  ): void {
    const current = Math.floor(Date.now() / 1000);
    if (
      !Number.isSafeInteger(expires) ||
      expires < current ||
      expires > current + 600
    )
      throw new BadRequestException("Liên kết đã hết hạn hoặc không hợp lệ.");
    const expected = Buffer.from(expectedSignature);
    const received = Buffer.from(signature);
    if (
      expected.length !== received.length ||
      !timingSafeEqual(expected, received)
    )
      throw new BadRequestException(message);
  }

  /** Dựng lại chữ ký học liệu mong đợi và dùng bộ kiểm tra liên kết hết hạn. */
  private verifyMaterialAccess(
    materialId: string,
    expires: number,
    signature: string,
    action: MaterialAccessAction,
  ): void {
    const current = Math.floor(Date.now() / 1000);
    if (
      !Number.isSafeInteger(expires) ||
      expires < current ||
      expires > current + 600
    )
      throw new BadRequestException(
        "Liên kết tải học liệu đã hết hạn hoặc không hợp lệ.",
      );
    const expected = Buffer.from(
      this.signMaterialAccess(materialId, expires, action),
    );
    const received = Buffer.from(signature);
    if (
      expected.length !== received.length ||
      !timingSafeEqual(expected, received)
    )
      throw new BadRequestException("Chữ ký tải học liệu không hợp lệ.");
  }

  /** Ánh xạ vai trò sang tài khoản seed tương ứng chỉ cho fallback/demo. */
  private userIdForRole(role: string): string {
    if (role === "SYSTEM_ADMIN") return "usr-admin";
    if (role === "CENTER_MANAGER") return "usr-manager";
    if (role === "INSTRUCTOR") return "usr-instructor";
    return "usr-learner";
  }

  /** Đọc object qua storage service hoặc filesystem fallback. */
  private readStoredFile(objectKey: string): Promise<Buffer> {
    if (this.objectStorage) return this.objectStorage.get(objectKey);
    return readFile(this.resolveObjectPath(objectKey)).catch(() => {
      throw new NotFoundException("Tệp không còn tồn tại trong kho lưu trữ.");
    });
  }

  /** Xác định object key thuộc namespace học liệu mà service cho phép phục vụ. */
  private isMaterialObjectKey(objectKey: string): boolean {
    return (
      objectKey.startsWith("files/") || objectKey.startsWith("cloudinary:")
    );
  }

  /** Cho phép vai trò quản trị/điều hành truy cập hàng đợi hỗ trợ. */
  private canManageSupport(role: string): boolean {
    return role === "SYSTEM_ADMIN" || role === "CENTER_MANAGER";
  }

  /** Áp dụng quyền lớp và visibility cho học liệu fallback in-memory. */
  private canAccessMemoryMaterial(
    material: LearningMaterial,
    role: string,
    actorId: string,
  ): boolean {
    const classItem = this.classes.find((item) => item.id === material.classId);
    if (!classItem) return false;
    if (role === "LEARNER")
      return (
        material.visibility === "PUBLISHED" &&
        classItem.learnerIds.includes(actorId)
      );
    if (role === "INSTRUCTOR") return classItem.instructorIds.includes(actorId);
    return true;
  }

  /** Kiểm tra thành viên lớp ở bản ghi Prisma trước khi truy cập học liệu. */
  private assertMaterialClassAccess(
    classItem: {
      enrollments: Array<{ learnerId: string; status: string }>;
      instructors: Array<{ instructorId: string }>;
    },
    role: string,
    actorId: string,
  ): void {
    if (
      role === "LEARNER" &&
      !classItem.enrollments.some(
        (item) => item.learnerId === actorId && item.status === "ACTIVE",
      )
    )
      throw new NotFoundException(
        "Học viên không thuộc lớp chứa học liệu này.",
      );
    if (
      role === "INSTRUCTOR" &&
      !classItem.instructors.some((item) => item.instructorId === actorId)
    )
      throw new NotFoundException(
        "Giảng viên không được phân công vào lớp chứa học liệu này.",
      );
  }

  /** Kiểm tra quyền lớp tương đương trên dữ liệu in-memory. */
  private assertMemoryMaterialClassAccess(
    classId: string,
    role: string,
    actorId: string,
  ): void {
    const classItem = this.findClass(classId);
    if (role === "LEARNER" && !classItem.learnerIds.includes(actorId))
      throw new NotFoundException(
        "Học viên không thuộc lớp chứa học liệu này.",
      );
    if (role === "INSTRUCTOR" && !classItem.instructorIds.includes(actorId))
      throw new NotFoundException(
        "Giảng viên không được phân công vào lớp chứa học liệu này.",
      );
  }

  /** Tính trạng thái đề từ công bố, cửa sổ thời gian, lượt đang làm và giới hạn số lượt. */
  private examAvailability(
    exam: LearningExam,
    attemptCount: number,
    active: boolean,
    timestamp: Date,
  ): LearnerExamSummary["availabilityStatus"] {
    if (active) return "IN_PROGRESS";
    if (timestamp < new Date(exam.openAt)) return "UPCOMING";
    if (timestamp > new Date(exam.closeAt) || exam.status === "CLOSED")
      return "CLOSED";
    if (attemptCount >= exam.attemptLimit) return "ATTEMPT_LIMIT_REACHED";
    return "AVAILABLE";
  }

  /** Chọn hạn sớm hơn giữa thời lượng lượt thi và giờ đóng đề. */
  private attemptDeadline(
    startedAt: Date,
    durationMinutes: number,
    examCloseAt: Date,
  ): Date {
    return new Date(
      Math.min(
        startedAt.getTime() + durationMinutes * 60_000,
        examCloseAt.getTime(),
      ),
    );
  }

  /** Tìm câu hỏi fallback và dùng chung logic so sánh đáp án khách quan. */
  private isMemoryAnswerCorrect(
    questionId: string,
    submitted: string[],
  ): boolean {
    const question = this.questions.find((item) => item.id === questionId);
    return (
      Boolean(question) &&
      JSON.stringify([...submitted].sort()) ===
        JSON.stringify([...(question?.correctAnswers ?? [])].sort())
    );
  }

  /** Chuẩn hóa văn bản diễn đàn và áp dụng giới hạn độ dài/nội dung rỗng. */
  private validateForumContent(value: string, label: string): string {
    const normalized = value.trim();
    if (/<\/?[a-z][^>]*>|javascript:|data:text\/html/i.test(normalized))
      throw new BadRequestException(
        `${label} chứa HTML hoặc mã thực thi không được phép.`,
      );
    return normalized;
  }

  /** Chuẩn hóa văn bản phiếu hỗ trợ và chặn nội dung rỗng/quá dài. */
  private validateSupportText(value: string, label: string): string {
    const normalized = this.validateForumContent(value, label);
    const secretPatterns = [
      /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/i,
      /(?:password|passwd|mật\s*khẩu)\s*[:=]\s*\S+/i,
      /(?:access[_-]?token|api[_-]?key|secret)\s*[:=]\s*[A-Za-z0-9_\-./+=]{8,}/i,
      /(?:Bearer\s+)[A-Za-z0-9_\-.]{12,}/i,
    ];
    if (secretPatterns.some((pattern) => pattern.test(normalized))) {
      throw new BadRequestException(
        `${label} có dấu hiệu chứa mật khẩu, token hoặc khóa bí mật. Hãy xóa dữ liệu nhạy cảm trước khi gửi.`,
      );
    }
    return normalized;
  }

  /** Kiểm tra kích thước, MIME và chữ ký tệp bằng chứng hỗ trợ. */
  private validateSupportUpload(upload: UploadedMaterialFile): void {
    const allowedMimeTypes = new Set([
      "application/pdf",
      "image/png",
      "image/jpeg",
      "text/plain",
    ]);
    if (upload.size !== upload.buffer.length)
      throw new BadRequestException(
        "Kích thước tệp bằng chứng không khớp nội dung nhận được.",
      );
    if (upload.size < 1 || upload.size > 10 * 1024 * 1024)
      throw new BadRequestException(
        "Tệp bằng chứng phải có kích thước từ 1 byte đến 10 MB.",
      );
    if (!allowedMimeTypes.has(upload.mimeType))
      throw new BadRequestException(
        "Chỉ chấp nhận bằng chứng PDF, PNG, JPEG hoặc TXT.",
      );
    if (/\.(?:exe|dll|bat|cmd|ps1|js|html?)$/i.test(upload.originalName))
      throw new BadRequestException(
        "Loại tệp bằng chứng có nguy cơ thực thi không được phép.",
      );
    if (upload.mimeType === "text/plain")
      this.validateSupportText(
        upload.buffer.toString("utf8"),
        "Tệp bằng chứng",
      );
  }

  /** Phát hiện mẫu tệp thực thi/script nguy hiểm khi antivirus ngoài không khả dụng. */
  private detectMaliciousUpload(
    upload: UploadedMaterialFile,
  ): string | undefined {
    const head = upload.buffer.subarray(
      0,
      Math.min(upload.buffer.length, 8192),
    );
    const text = head.toString("utf8");
    if (head[0] === 0x4d && head[1] === 0x5a)
      return "Phát hiện chữ ký tệp thực thi Windows (MZ).";
    if (text.includes("EICAR-STANDARD-ANTIVIRUS-TEST-FILE"))
      return "Phát hiện chữ ký kiểm thử antivirus EICAR.";
    if (/<script\b|javascript:/i.test(text))
      return "Phát hiện nội dung script có khả năng thực thi.";
    if (/\.(?:exe|dll|bat|cmd|ps1|js|html?)$/i.test(upload.originalName))
      return "Phần mở rộng tệp có khả năng thực thi.";
    return undefined;
  }

  /** Kiểm tra giới hạn, MIME, magic bytes và quét virus cho ảnh câu hỏi. */
  private async validateQuestionImage(
    upload: UploadedMaterialFile,
  ): Promise<void> {
    const allowedMimeTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
    if (upload.size !== upload.buffer.length)
      throw new BadRequestException(
        "Kích thước ảnh không khớp nội dung nhận được.",
      );
    if (upload.size < 1 || upload.size > 8 * 1024 * 1024)
      throw new BadRequestException(
        "Ảnh câu hỏi phải có kích thước từ 1 byte đến 8 MB.",
      );
    if (!allowedMimeTypes.has(upload.mimeType))
      throw new BadRequestException("Chỉ chấp nhận ảnh PNG, JPEG hoặc WebP.");
    const buffer = upload.buffer;
    const isPng =
      buffer.length >= 8 &&
      buffer
        .subarray(0, 8)
        .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    const isJpeg =
      buffer.length >= 3 &&
      buffer[0] === 0xff &&
      buffer[1] === 0xd8 &&
      buffer[2] === 0xff;
    const isWebp =
      buffer.length >= 12 &&
      buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
      buffer.subarray(8, 12).toString("ascii") === "WEBP";
    const signatureMatches =
      upload.mimeType === "image/png"
        ? isPng
        : upload.mimeType === "image/jpeg"
          ? isJpeg
          : isWebp;
    if (!signatureMatches)
      throw new BadRequestException(
        "Nội dung ảnh không khớp định dạng tệp đã khai báo.",
      );
    const threat = await this.scanUpload(upload);
    if (threat)
      throw new BadRequestException(`Ảnh câu hỏi không an toàn: ${threat}`);
  }

  /** Gọi antivirus service và trả lý do cách ly thay vì ném lỗi khi phát hiện malware. */
  private async scanUpload(
    upload: UploadedMaterialFile,
  ): Promise<string | undefined> {
    const signatureReason = this.detectMaliciousUpload(upload);
    if (signatureReason) return signatureReason;
    if (!this.antivirus) return undefined;
    const result = upload.path ? await this.antivirus.scanFile(upload.path) : await this.antivirus.scan(upload.buffer);
    return result.clean
      ? undefined
      : `ClamAV phát hiện mã độc: ${result.signature ?? "không xác định"}.`;
  }

  /** Áp dụng cấu hình kiểm duyệt hiệu lực và trả trạng thái ẩn chờ duyệt khi nội dung bị gắn cờ. */
  private async enforceForumPolicy(
    database: PrismaService,
    authorId: string,
    content: string,
  ): Promise<"FLAG" | "HIDE_PENDING_REVIEW" | undefined> {
    if (!this.system) {
      const policy = await database.moderationPolicy.findFirst({
        orderBy: { version: "desc" },
      });
      const terms = this.toStringArray(policy?.prohibitedTerms ?? []);
      if (
        terms.some((term) => content.toLowerCase().includes(term.toLowerCase()))
      )
        throw new BadRequestException(
          "Nội dung chứa từ khóa bị chính sách diễn đàn chặn.",
        );
      const recentPosts = await database.forumPost.count({
        where: { authorId, createdAt: { gte: new Date(Date.now() - 60_000) } },
      });
      if (recentPosts >= (policy?.maxPostsPerMinute ?? 5))
        throw new BadRequestException(
          "Bạn đã vượt giới hạn bài viết trong một phút.",
        );
      return undefined;
    }
    const settings = await this.system.getSettings();
    if (!settings.moderationEnabled) return undefined;
    const policy = await this.system.getModerationPolicy();
    const recentPosts = await database.forumPost.count({
      where: { authorId, createdAt: { gte: new Date(Date.now() - 60_000) } },
    });
    if (recentPosts >= policy.maxPostsPerMinute)
      throw new BadRequestException(
        "Bạn đã vượt giới hạn bài viết trong một phút.",
      );
    const matched = policy.prohibitedTerms.some((term) =>
      content.toLocaleLowerCase("vi").includes(term.toLocaleLowerCase("vi")),
    );
    if (!matched) return undefined;
    return policy.action;
  }

  /** Áp dụng chính sách kiểm duyệt tương đương trên kho nhớ demo. */
  private async enforceMemoryForumPolicy(
    authorId: string,
    content: string,
  ): Promise<"FLAG" | "HIDE_PENDING_REVIEW" | undefined> {
    if (!this.system) {
      if (
        this.moderationTerms().some((term) =>
          content.toLowerCase().includes(term),
        )
      )
        throw new BadRequestException(
          "Nội dung chứa từ khóa bị chính sách diễn đàn chặn.",
        );
    } else if (!(await this.system.getSettings()).moderationEnabled) {
      return undefined;
    }
    const policy = this.system
      ? await this.system.getModerationPolicy()
      : {
          prohibitedTerms: this.moderationTerms(),
          maxPostsPerMinute: 5,
          action: "FLAG" as const,
        };
    const recentPosts = this.posts.filter(
      (item) =>
        item.authorId === authorId &&
        Date.now() - new Date(item.createdAt).getTime() <= 60_000,
    ).length;
    if (recentPosts >= policy.maxPostsPerMinute)
      throw new BadRequestException(
        "Bạn đã vượt giới hạn bài viết trong một phút.",
      );
    if (!this.system) return undefined;
    return policy.prohibitedTerms.some((term) =>
      content.toLocaleLowerCase("vi").includes(term.toLocaleLowerCase("vi")),
    )
      ? policy.action
      : undefined;
  }

  /** Trả danh sách từ khóa kiểm duyệt được chuẩn hóa từ cấu hình môi trường. */
  private moderationTerms(): string[] {
    return ["spam", "lừa đảo"];
  }

  /** Xác minh vai trò quản trị hoặc thành viên lớp trước thao tác diễn đàn Prisma. */
  private assertForumClassAccess(
    classItem: ClassWithMembers,
    role: string,
    actorId: string,
  ): void {
    if (
      role === "LEARNER" &&
      !classItem.enrollments.some(
        (item) => item.learnerId === actorId && item.status === "ACTIVE",
      )
    )
      throw new NotFoundException(
        "Không tìm thấy chủ đề trong lớp đã ghi danh.",
      );
    if (
      role === "INSTRUCTOR" &&
      !classItem.instructors.some((item) => item.instructorId === actorId)
    )
      throw new NotFoundException(
        "Không tìm thấy chủ đề trong lớp được phân công.",
      );
  }

  /** Xác minh quyền diễn đàn tương đương trên dữ liệu lớp in-memory. */
  private assertMemoryForumClassAccess(
    classId: string,
    role: string,
    actorId: string,
  ): void {
    const classItem = this.findClass(classId);
    if (role === "LEARNER" && !classItem.learnerIds.includes(actorId))
      throw new NotFoundException(
        "Không tìm thấy chủ đề trong lớp đã ghi danh.",
      );
    if (role === "INSTRUCTOR" && !classItem.instructorIds.includes(actorId))
      throw new NotFoundException(
        "Không tìm thấy chủ đề trong lớp được phân công.",
      );
  }

  /** Thu hẹp JSON thành mảng chuỗi, loại mọi phần tử không đúng kiểu. */
  private toStringArray(value: Prisma.JsonValue): string[] {
    return Array.isArray(value)
      ? value.filter((item): item is string => typeof item === "string")
      : [];
  }

  /** Tìm khóa học trong fallback và chuẩn hóa lỗi 404. */
  private findCourse(courseId: string): LearningCourse {
    const item = this.courses.find((course) => course.id === courseId);
    if (!item) throw new NotFoundException("Không tìm thấy khóa học.");
    return item;
  }
  /** Tìm lớp trong fallback và chuẩn hóa lỗi 404. */
  private findClass(classId: string): LearningClass {
    const item = this.classes.find((candidate) => candidate.id === classId);
    if (!item) throw new NotFoundException("Không tìm thấy lớp học.");
    return item;
  }
  /** Tìm đề thi trong fallback và chuẩn hóa lỗi 404. */
  private findExam(examId: string): LearningExam {
    const item = this.exams.find((candidate) => candidate.id === examId);
    if (!item) throw new NotFoundException("Không tìm thấy đề.");
    return item;
  }
  /** Tìm lượt thi trong fallback và chuẩn hóa lỗi 404. */
  private findAttempt(attemptId: string): ExamAttempt {
    const item = this.attempts.find((candidate) => candidate.id === attemptId);
    if (!item) throw new NotFoundException("Không tìm thấy lượt làm bài.");
    return item;
  }
  /** Tìm chủ đề trong fallback và chuẩn hóa lỗi 404. */
  private findTopic(topicId: string): ForumTopic {
    const item = this.topics.find((candidate) => candidate.id === topicId);
    if (!item) throw new NotFoundException("Không tìm thấy chủ đề.");
    return item;
  }
  /** Tìm bài viết trong fallback và chuẩn hóa lỗi 404. */
  private findPost(postId: string): ForumPost {
    const item = this.posts.find((candidate) => candidate.id === postId);
    if (!item) throw new NotFoundException("Không tìm thấy bài viết.");
    return item;
  }
  /** Tìm báo cáo trong fallback và chuẩn hóa lỗi 404. */
  private findReport(reportId: string): ContentReport {
    const item = this.reports.find((candidate) => candidate.id === reportId);
    if (!item) throw new NotFoundException("Không tìm thấy báo cáo.");
    return item;
  }
  /** Tìm buổi học trong fallback và chuẩn hóa lỗi 404. */
  private findSession(sessionId: string): LiveSession {
    const item = this.sessions.find((candidate) => candidate.id === sessionId);
    if (!item) throw new NotFoundException("Không tìm thấy buổi học.");
    return item;
  }
}
