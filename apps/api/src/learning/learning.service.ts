import { BadRequestException, ConflictException, Injectable, NotFoundException, Optional, ServiceUnavailableException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { dirname, extname, resolve, sep } from "node:path";
import type { Prisma } from "../generated/prisma/client.js";
import type { Environment } from "../config/environment.js";
import { PrismaService } from "../database/prisma.service.js";
import type {
  AttendanceAppeal, AttendanceRecord, AttendanceSessionReview, ClassClosureReadiness, ClassMemberHistory, ClassProgressReport, ClassRoster, ContentReport, CourseVersionSnapshot, EnrollmentImportResult, ExamAnalytics, ExamApprovalRecord, ExamAttempt, FileReviewRecord, ForumPost, ForumTopic, GradeHistoryRecord, InstructorRole, LearnerProgress, LearningClass, LearningNotification, ModerationActionRecord, ModerationContext, OperationalReport, ProgressIntervention, ReportExport, ReportRun, RiskThresholds,
  LearnerExamSummary, LearnerResult, LearningCourse, LearningExam, LearningMaterial, LearningQuestion, LiveSession, MaterialVersionSnapshot, QuestionImportResult,
  ProviderAttendanceInput, RegradeRequest, SupportAttachment, SupportTicket, TicketComment,
} from "./learning.types.js";

const now = (): string => new Date().toISOString();
const id = (prefix: string): string => `${prefix}-${randomUUID()}`;
const isUniqueConstraintError = (error: unknown): boolean =>
  typeof error === "object" && error !== null && "code" in error && error.code === "P2002";

type ClassWithMembers = Prisma.LearningClassGetPayload<{
  include: { instructors: true; enrollments: true };
}>;
type ExamWithQuestions = Prisma.ExamGetPayload<{ include: { questions: true } }>;
type AttemptWithAnswers = Prisma.ExamAttemptGetPayload<{ include: { answers: true } }>;
type ForumPostWithRelations = Prisma.ForumPostGetPayload<{ include: { attachments: true; mentions: true } }>;
type ContentReportWithActions = Prisma.ContentReportGetPayload<{ include: { actions: true } }>;
type SupportTicketWithAttachments = Prisma.SupportTicketGetPayload<{ include: { attachments: true } }>;
export interface UploadedMaterialFile { originalName: string; mimeType: string; size: number; buffer: Buffer }
export interface MaterialDownload { fileName: string; mimeType: string; buffer: Buffer }
export type MaterialAccessAction = "PREVIEW" | "DOWNLOAD";
export interface MaterialSearchResult { items: LearningMaterial[]; total: number; page: number; pageSize: number; totalPages: number }
type MemoryMaterialVersion = MaterialVersionSnapshot & { objectKey?: string; checksum?: string };

@Injectable()
export class LearningService {
  private readonly courses: LearningCourse[] = [
    { id: "course-web", code: "WEB-FULLSTACK", name: "Phát triển Web Full-stack", description: "Xây dựng ứng dụng web hiện đại từ giao diện đến API.", outcomes: ["Thiết kế giao diện responsive", "Xây dựng REST API", "Thiết kế cơ sở dữ liệu"], status: "PUBLISHED", version: 1, createdAt: now(), updatedAt: now() },
    { id: "course-data", code: "DATA-FOUNDATION", name: "Nền tảng dữ liệu", description: "Tổ chức, phân tích và trực quan hóa dữ liệu.", outcomes: ["Làm sạch dữ liệu", "Mô hình hóa dữ liệu"], status: "DRAFT", version: 1, createdAt: now(), updatedAt: now() },
  ];

  private readonly courseVersions: CourseVersionSnapshot[] = [
    { id: "course-version-web-1", courseId: "course-web", version: 1, name: "Phát triển Web Full-stack", description: "Xây dựng ứng dụng web hiện đại từ giao diện đến API.", outcomes: ["Thiết kế giao diện responsive", "Xây dựng REST API", "Thiết kế cơ sở dữ liệu"], publishedBy: "usr-manager", publishedAt: now() },
  ];

  private readonly classes: LearningClass[] = [
    { id: "class-web-01", courseId: "course-web", courseVersion: 1, code: "WEB-K01", name: "Web Full-stack K01", term: "2026-HK1", startAt: "2026-08-18T01:00:00.000Z", endAt: "2026-12-20T10:00:00.000Z", capacity: 40, timezone: "Asia/Bangkok", allowLateEnrollment: false, status: "ACTIVE", instructorIds: ["usr-instructor"], learnerIds: ["usr-learner"] },
  ];

  private readonly materials: LearningMaterial[] = [
    { id: "mat-web-intro", classId: "class-web-01", name: "01 — Tổng quan kiến trúc Web.pdf", mimeType: "application/pdf", sizeBytes: 2_420_000, folder: "Tuần 1", tags: ["kiến trúc", "bắt đầu"], version: 1, visibility: "PUBLISHED", createdAt: now() },
    { id: "mat-api-guide", classId: "class-web-01", name: "02 — Thiết kế REST API.pdf", mimeType: "application/pdf", sizeBytes: 3_180_000, folder: "Tuần 2", tags: ["api", "backend"], version: 2, visibility: "PUBLISHED", createdAt: now() },
  ];
  private readonly materialVersions: MemoryMaterialVersion[] = this.materials.map((item) => ({ ...item, id: `material-version-${item.id}-${item.version}`, materialId: item.id, createdBy: "usr-instructor", objectKey: undefined, checksum: undefined }));

  private readonly questions: LearningQuestion[] = [
    { id: "q-rest-01", familyId: "q-rest-01", courseId: "course-web", type: "SINGLE_CHOICE", content: "HTTP method nào phù hợp để cập nhật một phần tài nguyên?", options: ["GET", "POST", "PATCH", "DELETE"], correctAnswers: ["PATCH"], difficulty: 1, tags: ["http", "api"], status: "PUBLISHED", version: 1 },
    { id: "q-db-01", familyId: "q-db-01", courseId: "course-web", type: "TRUE_FALSE", content: "Khóa ngoại giúp duy trì tính toàn vẹn tham chiếu.", options: ["Đúng", "Sai"], correctAnswers: ["Đúng"], difficulty: 1, tags: ["database"], status: "PUBLISHED", version: 1 },
  ];

  private readonly exams: LearningExam[] = [
    { id: "exam-mid-web", classId: "class-web-01", title: "Kiểm tra giữa kỳ Web Full-stack", questionIds: ["q-rest-01", "q-db-01"], durationMinutes: 45, totalScore: 10, openAt: "2026-08-20T00:00:00.000Z", closeAt: "2026-12-30T23:59:00.000Z", attemptLimit: 2, status: "PUBLISHED", version: 1 },
  ];

  private readonly attempts: ExamAttempt[] = [];
  private readonly gradeHistory: GradeHistoryRecord[] = [];
  private readonly examApprovals: ExamApprovalRecord[] = [];
  private readonly regradeRequests: RegradeRequest[] = [];
  private readonly topics: ForumTopic[] = [
    { id: "topic-rest", classId: "class-web-01", title: "Thảo luận: REST hay GraphQL?", body: "Chia sẻ trường hợp bạn sẽ chọn REST hoặc GraphQL và lý do.", authorId: "usr-instructor", tags: ["api", "thảo luận"], isPinned: true, isLocked: false, status: "VISIBLE", createdAt: now() },
  ];
  private readonly posts: ForumPost[] = [
    { id: "post-rest-01", topicId: "topic-rest", authorId: "usr-learner", body: "Em chọn REST cho hệ thống CRUD vì dễ cache và theo dõi.", status: "VISIBLE", attachmentIds: [], mentionedUserIds: [], createdAt: now() },
  ];
  private readonly notifications: LearningNotification[] = [];
  private readonly reports: ContentReport[] = [];
  private readonly moderationActions: ModerationActionRecord[] = [];
  private readonly sessions: LiveSession[] = [
    { id: "session-web-01", classId: "class-web-01", title: "Thiết kế API có version", startsAt: "2026-08-26T02:00:00.000Z", endsAt: "2026-08-26T03:30:00.000Z", provider: "JITSI", requestedProvider: "JITSI", fallbackUsed: false, provisioningAttempts: 1, status: "SCHEDULED", timezone: "Asia/Bangkok", hostUrl: "https://meet.jit.si/wind-web-01-host", attendeeUrl: "https://meet.jit.si/wind-web-01" },
  ];
  private readonly attendance: AttendanceRecord[] = [];
  private readonly attendanceAppeals: AttendanceAppeal[] = [];
  private readonly tickets: SupportTicket[] = [];
  private readonly ticketComments: TicketComment[] = [];
  private readonly materialFiles = new Map<string, { objectKey: string; checksum: string }>();
  private readonly materialAccessLogs: Array<{ materialId: string; userId: string; action: MaterialAccessAction; createdAt: string }> = [];
  private readonly materialReviews: FileReviewRecord[] = [];
  private readonly progressInterventions: ProgressIntervention[] = [];
  private readonly reportRuns: ReportRun[] = [];
  private readonly reportExports: Array<ReportExport & { filePath?: string }> = [];
  private readonly instructorRoles = new Map<string, InstructorRole>([["class-web-01:usr-instructor", "PRIMARY"]]);
  private readonly classMemberHistory: ClassMemberHistory[] = [];

  constructor(
    @Optional() private readonly prisma?: PrismaService,
    @Optional() private readonly config?: ConfigService<Environment, true>,
  ) {}

  async listCourses(): Promise<LearningCourse[]> {
    const prisma = this.database();
    if (prisma) {
      const rows = await prisma.course.findMany({ orderBy: { createdAt: "desc" } });
      return rows.map((row) => this.mapCourse(row));
    }
    return this.courses.map((item) => ({ ...item, outcomes: [...item.outcomes] }));
  }

  async createCourse(input: Pick<LearningCourse, "code" | "name" | "description" | "outcomes">): Promise<LearningCourse> {
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
            ownerId: "usr-manager",
          },
        });
        return this.mapCourse(row);
      } catch (error) {
        if (isUniqueConstraintError(error)) throw new ConflictException("Mã khóa học đã tồn tại.");
        throw error;
      }
    }
    if (this.courses.some((course) => course.code === code)) throw new ConflictException("Mã khóa học đã tồn tại.");
    const timestamp = now();
    const course: LearningCourse = { id: id("course"), code, name: input.name.trim(), description: input.description.trim(), outcomes: input.outcomes.filter(Boolean), status: "DRAFT", version: 1, createdAt: timestamp, updatedAt: timestamp };
    this.courses.unshift(course); return { ...course, outcomes: [...course.outcomes] };
  }

  async updateCourse(courseId: string, input: Pick<LearningCourse, "name" | "description" | "outcomes">, actorId = "usr-manager"): Promise<LearningCourse> {
    const name = input.name.trim();
    const description = input.description.trim();
    const outcomes = input.outcomes.map((item) => item.trim()).filter(Boolean);
    if (!outcomes.length) throw new BadRequestException("Khóa học cần ít nhất một mục tiêu học tập.");
    const prisma = this.database();
    if (prisma) {
      const current = await prisma.course.findUnique({ where: { id: courseId } });
      if (!current) throw new NotFoundException("Không tìm thấy khóa học.");
      if (current.status === "ARCHIVED") throw new ConflictException("Khóa học đã ngừng sử dụng và không thể sửa.");
      return prisma.$transaction(async (transaction) => {
        const row = await transaction.course.update({ where: { id: courseId }, data: { name, description, outcomes, status: "DRAFT" } });
        await transaction.auditLog.create({ data: { actorId, action: "COURSE_DRAFT_UPDATED", entityType: "course", entityId: courseId, context: { publishedVersion: current.version, previousStatus: current.status, nextStatus: "DRAFT" } } });
        return this.mapCourse(row);
      });
    }
    const current = this.findCourse(courseId);
    if (current.status === "ARCHIVED") throw new ConflictException("Khóa học đã ngừng sử dụng và không thể sửa.");
    Object.assign(current, { name, description, outcomes, status: "DRAFT", updatedAt: now() });
    return { ...current, outcomes: [...current.outcomes] };
  }

  async listCourseVersions(courseId: string): Promise<CourseVersionSnapshot[]> {
    const prisma = this.database();
    if (prisma) {
      if (!await prisma.course.findUnique({ where: { id: courseId }, select: { id: true } })) throw new NotFoundException("Không tìm thấy khóa học.");
      const rows = await prisma.courseVersion.findMany({ where: { courseId }, orderBy: { version: "desc" } });
      return rows.map((row) => ({ id: row.id, courseId: row.courseId, version: row.version, name: row.name, description: row.description, outcomes: this.toStringArray(row.outcomes), publishedBy: row.publishedBy, publishedAt: row.publishedAt.toISOString() }));
    }
    this.findCourse(courseId);
    return this.courseVersions.filter((item) => item.courseId === courseId).sort((a, b) => b.version - a.version).map((item) => ({ ...item, outcomes: [...item.outcomes] }));
  }

  async publishCourse(courseId: string, actorId = "usr-manager"): Promise<LearningCourse> {
    const prisma = this.database();
    if (prisma) {
      return prisma.$transaction(async (transaction) => {
        const course = await transaction.course.findUnique({ where: { id: courseId }, include: { versions: { orderBy: { version: "desc" }, take: 1 } } });
        if (!course) throw new NotFoundException("Không tìm thấy khóa học.");
        if (course.status === "ARCHIVED") throw new ConflictException("Khóa học đã ngừng sử dụng.");
        if (course.status === "PUBLISHED") return this.mapCourse(course);
        const outcomes = this.toStringArray(course.outcomes);
        if (!outcomes.length) throw new BadRequestException("Khóa học cần ít nhất một mục tiêu học tập.");
        const nextVersion = course.versions.length ? course.versions[0]!.version + 1 : Math.max(1, course.version);
        await transaction.courseVersion.create({ data: { id: id("course-version"), courseId, version: nextVersion, name: course.name, description: course.description, outcomes, publishedBy: actorId } });
        const updated = await transaction.course.update({ where: { id: courseId }, data: { status: "PUBLISHED", version: nextVersion } });
        await transaction.auditLog.create({ data: { actorId, action: "COURSE_VERSION_PUBLISHED", entityType: "course", entityId: courseId, context: { version: nextVersion } } });
        return this.mapCourse(updated);
      });
    }
    const course = this.findCourse(courseId);
    if (course.status === "ARCHIVED") throw new ConflictException("Khóa học đã ngừng sử dụng.");
    if (course.status === "PUBLISHED") return { ...course, outcomes: [...course.outcomes] };
    if (!course.outcomes.length) throw new BadRequestException("Khóa học cần ít nhất một mục tiêu học tập.");
    const lastVersion = Math.max(0, ...this.courseVersions.filter((item) => item.courseId === courseId).map((item) => item.version));
    course.version = lastVersion ? lastVersion + 1 : Math.max(1, course.version);
    course.status = "PUBLISHED";
    course.updatedAt = now();
    this.courseVersions.unshift({ id: id("course-version"), courseId, version: course.version, name: course.name, description: course.description, outcomes: [...course.outcomes], publishedBy: actorId, publishedAt: now() });
    return { ...course, outcomes: [...course.outcomes] };
  }

  async archiveCourse(courseId: string, reason: string, actorId = "usr-manager"): Promise<LearningCourse> {
    const normalizedReason = reason.trim();
    if (normalizedReason.length < 5) throw new BadRequestException("Lý do ngừng sử dụng cần ít nhất 5 ký tự.");
    const prisma = this.database();
    if (prisma) {
      const current = await prisma.course.findUnique({ where: { id: courseId } });
      if (!current) throw new NotFoundException("Không tìm thấy khóa học.");
      if (current.status === "ARCHIVED") throw new ConflictException("Khóa học đã ngừng sử dụng.");
      return prisma.$transaction(async (transaction) => {
        const row = await transaction.course.update({ where: { id: courseId }, data: { status: "ARCHIVED" } });
        await transaction.auditLog.create({ data: { actorId, action: "COURSE_ARCHIVED", entityType: "course", entityId: courseId, context: { reason: normalizedReason, version: current.version } } });
        return this.mapCourse(row);
      });
    }
    const current = this.findCourse(courseId);
    if (current.status === "ARCHIVED") throw new ConflictException("Khóa học đã ngừng sử dụng.");
    current.status = "ARCHIVED";
    current.updatedAt = now();
    return { ...current, outcomes: [...current.outcomes] };
  }

  async listClasses(role: string): Promise<LearningClass[]> {
    const prisma = this.database();
    if (prisma) {
      const rows = await prisma.learningClass.findMany({
        where: role === "LEARNER"
          ? { enrollments: { some: { learnerId: "usr-learner", status: "ACTIVE" } } }
          : role === "INSTRUCTOR"
            ? { instructors: { some: { instructorId: "usr-instructor" } } }
            : undefined,
        include: { instructors: true, enrollments: { where: { status: "ACTIVE" } } },
        orderBy: { startAt: "desc" },
      });
      return rows.map((row) => this.mapClass(row));
    }
    return this.classes.filter((item) => role === "LEARNER" ? item.learnerIds.includes("usr-learner") : role === "INSTRUCTOR" ? item.instructorIds.includes("usr-instructor") : true).map((item) => ({ ...item, instructorIds: [...item.instructorIds], learnerIds: [...item.learnerIds] }));
  }

  async createClass(input: Pick<LearningClass, "courseId" | "code" | "name" | "term" | "startAt" | "endAt" | "capacity"> & Partial<Pick<LearningClass, "timezone" | "allowLateEnrollment">>, actorId = "usr-manager"): Promise<LearningClass> {
    const code = input.code.trim().toUpperCase();
    const term = input.term.trim();
    const timezone = input.timezone?.trim() || "Asia/Bangkok";
    this.validateTimezone(timezone);
    const prisma = this.database();
    if (prisma) {
      const course = await prisma.course.findUnique({ where: { id: input.courseId } });
      if (!course || course.status !== "PUBLISHED") throw new BadRequestException("Khóa học phải được phát hành trước khi mở lớp.");
      if (new Date(input.endAt) <= new Date(input.startAt)) throw new BadRequestException("Ngày kết thúc phải sau ngày bắt đầu.");
      try {
        const row = await prisma.learningClass.create({
          data: {
            id: id("class"), courseId: input.courseId, courseVersion: course.version, code,
            name: input.name.trim(), term, startAt: new Date(input.startAt),
            endAt: new Date(input.endAt), capacity: input.capacity, timezone, allowLateEnrollment: input.allowLateEnrollment ?? false,
          },
          include: { instructors: true, enrollments: true },
        });
        await prisma.auditLog.create({ data: { actorId, action: "CLASS_DRAFT_CREATED", entityType: "learning_class", entityId: row.id, context: { courseId: input.courseId, courseVersion: course.version, code, term, timezone } } });
        return this.mapClass(row);
      } catch (error) {
        if (isUniqueConstraintError(error)) throw new ConflictException("Mã lớp đã tồn tại.");
        throw error;
      }
    }
    if (!this.courses.some((course) => course.id === input.courseId && course.status === "PUBLISHED")) throw new BadRequestException("Khóa học phải được phát hành trước khi mở lớp.");
    if (new Date(input.endAt) <= new Date(input.startAt)) throw new BadRequestException("Ngày kết thúc phải sau ngày bắt đầu.");
    if (this.classes.some((item) => item.code === code && item.term === term)) throw new ConflictException("Mã lớp đã tồn tại trong học kỳ.");
    const course = this.findCourse(input.courseId);
    const item: LearningClass = { ...input, courseVersion: course.version, code, term, timezone, allowLateEnrollment: input.allowLateEnrollment ?? false, id: id("class"), status: "DRAFT", instructorIds: [], learnerIds: [] }; this.classes.unshift(item); return { ...item, instructorIds: [], learnerIds: [] };
  }
  async assignInstructor(classId: string, instructorId: string, requestedRole?: InstructorRole, actorId = "usr-manager"): Promise<LearningClass> {
    const prisma = this.database();
    if (prisma) {
      await this.requireUserRole(prisma, instructorId, "INSTRUCTOR", "Người dùng được chọn không phải giảng viên.");
      const classItem = await prisma.learningClass.findUnique({ where: { id: classId }, include: { instructors: true } });
      if (!classItem) throw new NotFoundException("Không tìm thấy lớp học.");
      if (classItem.status === "CLOSED") throw new ConflictException("Lớp đã lưu trữ và chỉ cho phép đọc.");
      const role = requestedRole ?? (classItem.instructors.length ? "CO_INSTRUCTOR" : "PRIMARY");
      const load = await prisma.classInstructor.count({ where: { instructorId, class: { status: { in: ["DRAFT", "ACTIVE"] } } } });
      if (!classItem.instructors.some((row) => row.instructorId === instructorId) && load >= 5) throw new ConflictException("Giảng viên đã đạt giới hạn 5 lớp đang phụ trách.");
      const overlap = await prisma.classInstructor.findFirst({ where: { instructorId, classId: { not: classId }, class: { status: "ACTIVE", startAt: { lt: classItem.endAt }, endAt: { gt: classItem.startAt } } }, select: { class: { select: { code: true } } } });
      if (overlap) throw new ConflictException(`Giảng viên có lịch lớp xung đột với ${overlap.class.code}.`);
      await prisma.$transaction(async (transaction) => {
        if (role === "PRIMARY") await transaction.classInstructor.updateMany({ where: { classId, role: "PRIMARY", instructorId: { not: instructorId } }, data: { role: "CO_INSTRUCTOR" } });
        await transaction.classInstructor.upsert({ where: { classId_instructorId: { classId, instructorId } }, update: { role, assignedBy: actorId }, create: { classId, instructorId, role, assignedBy: actorId } });
        await transaction.classInstructorHistory.create({ data: { id: id("instructor-history"), classId, instructorId, role, action: "ASSIGNED", actorId } });
        await transaction.notification.create({ data: { id: id("notification"), recipientId: instructorId, type: "CLASS_INSTRUCTOR_ASSIGNED", title: `Bạn được phân công ${role === "PRIMARY" ? "giảng viên chính" : "đồng giảng viên"} cho lớp ${classItem.code}`, entityType: "CLASS", entityId: classId, dedupKey: `instructor-assigned:${classId}:${instructorId}:${role}` } });
      });
      return this.getDatabaseClass(prisma, classId);
    }
    const item = this.findClass(classId);
    if (item.status === "CLOSED") throw new ConflictException("Lớp đã lưu trữ và chỉ cho phép đọc.");
    const role = requestedRole ?? (item.instructorIds.length ? "CO_INSTRUCTOR" : "PRIMARY");
    const conflict = this.classes.find((candidate) => candidate.id !== classId && candidate.status === "ACTIVE" && candidate.instructorIds.includes(instructorId) && new Date(candidate.startAt) < new Date(item.endAt) && new Date(candidate.endAt) > new Date(item.startAt));
    if (conflict) throw new ConflictException(`Giảng viên có lịch lớp xung đột với ${conflict.code}.`);
    if (role === "PRIMARY") for (const currentId of item.instructorIds) this.instructorRoles.set(`${classId}:${currentId}`, "CO_INSTRUCTOR");
    if (!item.instructorIds.includes(instructorId)) item.instructorIds.push(instructorId);
    this.instructorRoles.set(`${classId}:${instructorId}`, role);
    this.recordMemberHistory(classId, instructorId, "INSTRUCTOR", "ASSIGNED", actorId, { role });
    this.notifications.unshift({ id: id("notification"), recipientId: instructorId, type: "CLASS_INSTRUCTOR_ASSIGNED", title: `Bạn được phân công vào lớp ${item.code}`, entityType: "CLASS", entityId: classId, createdAt: now() });
    return { ...item, instructorIds: [...item.instructorIds], learnerIds: [...item.learnerIds] };
  }

  async removeInstructor(classId: string, instructorId: string, reason: string, actorId = "usr-manager"): Promise<LearningClass> {
    const normalizedReason = reason.trim();
    if (normalizedReason.length < 5) throw new BadRequestException("Lý do gỡ phân công cần ít nhất 5 ký tự.");
    const prisma = this.database();
    if (prisma) {
      const current = await prisma.classInstructor.findUnique({ where: { classId_instructorId: { classId, instructorId } } });
      if (!current) throw new NotFoundException("Giảng viên không thuộc lớp.");
      const primaryCount = await prisma.classInstructor.count({ where: { classId, role: "PRIMARY" } });
      if (current.role === "PRIMARY" && primaryCount <= 1) throw new ConflictException("Không thể gỡ giảng viên chính cuối cùng; hãy phân công người thay thế trước.");
      await prisma.$transaction([
        prisma.classInstructor.delete({ where: { classId_instructorId: { classId, instructorId } } }),
        prisma.classInstructorHistory.create({ data: { id: id("instructor-history"), classId, instructorId, role: current.role, action: "REMOVED", reason: normalizedReason, actorId } }),
        prisma.notification.create({ data: { id: id("notification"), recipientId: instructorId, type: "CLASS_INSTRUCTOR_REMOVED", title: "Phân công giảng dạy đã được cập nhật", entityType: "CLASS", entityId: classId, dedupKey: `instructor-removed:${classId}:${instructorId}` } }),
      ]);
      return this.getDatabaseClass(prisma, classId);
    }
    const item = this.findClass(classId); const role = this.instructorRoles.get(`${classId}:${instructorId}`);
    if (!role) throw new NotFoundException("Giảng viên không thuộc lớp.");
    if (role === "PRIMARY" && item.instructorIds.filter((value) => this.instructorRoles.get(`${classId}:${value}`) === "PRIMARY").length <= 1) throw new ConflictException("Không thể gỡ giảng viên chính cuối cùng; hãy phân công người thay thế trước.");
    item.instructorIds = item.instructorIds.filter((value) => value !== instructorId); this.instructorRoles.delete(`${classId}:${instructorId}`);
    this.recordMemberHistory(classId, instructorId, "INSTRUCTOR", "REMOVED", actorId, { role, reason: normalizedReason });
    return { ...item, instructorIds: [...item.instructorIds], learnerIds: [...item.learnerIds] };
  }

  async enrollLearner(classId: string, learnerId: string): Promise<LearningClass> {
    const prisma = this.database();
    if (prisma) {
      await this.requireUserRole(prisma, learnerId, "LEARNER", "Người dùng được chọn không phải học viên.");
      return prisma.$transaction(async (transaction) => {
        const classItem = await transaction.learningClass.findUnique({
          where: { id: classId }, include: { enrollments: { where: { status: "ACTIVE" } } },
        });
        if (!classItem) throw new NotFoundException("Không tìm thấy lớp học.");
        if (classItem.status === "CLOSED") throw new ConflictException("Lớp đã lưu trữ và chỉ cho phép đọc.");
        if (classItem.enrollments.some((row) => row.learnerId === learnerId)) throw new ConflictException("Học viên đã có trong lớp.");
        if (classItem.enrollments.length >= classItem.capacity) throw new BadRequestException("Lớp đã đủ sĩ số.");
        await transaction.classEnrollment.upsert({
          where: { classId_learnerId: { classId, learnerId } },
          update: { status: "ACTIVE", joinedAt: new Date(), source: "MANUAL", removalReason: null, removedAt: null },
          create: { classId, learnerId, status: "ACTIVE", source: "MANUAL" },
        });
        await transaction.classEnrollmentHistory.create({ data: { id: id("enrollment-history"), classId, learnerId, action: "ENROLLED", source: "MANUAL", actorId: "usr-manager" } });
        await transaction.notification.create({ data: { id: id("notification"), recipientId: learnerId, type: "CLASS_ENROLLED", title: `Bạn đã được ghi danh vào lớp ${classItem.code}`, entityType: "CLASS", entityId: classId, dedupKey: `class-enrolled:${classId}:${learnerId}` } });
        return this.getDatabaseClass(transaction, classId);
      });
    }
    const item = this.findClass(classId);
    if (item.status === "CLOSED") throw new ConflictException("Lớp đã lưu trữ và chỉ cho phép đọc.");
    if (item.learnerIds.includes(learnerId)) throw new ConflictException("Học viên đã có trong lớp.");
    if (item.learnerIds.length >= item.capacity) throw new BadRequestException("Lớp đã đủ sĩ số.");
    item.learnerIds.push(learnerId);
    this.recordMemberHistory(classId, learnerId, "LEARNER", "ENROLLED", "usr-manager", { source: "MANUAL" });
    this.notifications.unshift({ id: id("notification"), recipientId: learnerId, type: "CLASS_ENROLLED", title: `Bạn đã được ghi danh vào lớp ${item.code}`, entityType: "CLASS", entityId: classId, createdAt: now() });
    return { ...item, instructorIds: [...item.instructorIds], learnerIds: [...item.learnerIds] };
  }

  async importEnrollments(classId: string, userIds: string[]): Promise<EnrollmentImportResult[]> {
    const normalized = userIds.map((value) => value.trim()).filter(Boolean);
    const seen = new Set<string>(); const results: EnrollmentImportResult[] = [];
    for (const userId of normalized) {
      if (seen.has(userId)) { results.push({ userId, status: "SKIPPED", message: "Trùng trong danh sách nhập." }); continue; }
      seen.add(userId);
      try { await this.enrollLearner(classId, userId); results.push({ userId, status: "ENROLLED", message: "Ghi danh thành công." }); }
      catch (error) { results.push({ userId, status: error instanceof ConflictException ? "SKIPPED" : "FAILED", message: error instanceof Error ? error.message : "Không thể ghi danh." }); }
    }
    return results;
  }

  async removeEnrollment(classId: string, learnerId: string, reason: string, actorId = "usr-manager"): Promise<LearningClass> {
    const normalizedReason = reason.trim(); if (normalizedReason.length < 5) throw new BadRequestException("Lý do gỡ học viên cần ít nhất 5 ký tự.");
    const prisma = this.database();
    if (prisma) {
      const enrollment = await prisma.classEnrollment.findUnique({ where: { classId_learnerId: { classId, learnerId } } });
      if (!enrollment || enrollment.status !== "ACTIVE") throw new NotFoundException("Học viên không có ghi danh đang hoạt động.");
      await prisma.$transaction([
        prisma.classEnrollment.update({ where: { classId_learnerId: { classId, learnerId } }, data: { status: "CANCELLED", removalReason: normalizedReason, removedAt: new Date() } }),
        prisma.classEnrollmentHistory.create({ data: { id: id("enrollment-history"), classId, learnerId, action: "REMOVED", source: enrollment.source, reason: normalizedReason, actorId } }),
        prisma.notification.create({ data: { id: id("notification"), recipientId: learnerId, type: "CLASS_ENROLLMENT_REMOVED", title: "Trạng thái ghi danh lớp học đã thay đổi", entityType: "CLASS", entityId: classId, dedupKey: `enrollment-removed:${classId}:${learnerId}` } }),
      ]);
      return this.getDatabaseClass(prisma, classId);
    }
    const item = this.findClass(classId); if (!item.learnerIds.includes(learnerId)) throw new NotFoundException("Học viên không có ghi danh đang hoạt động.");
    item.learnerIds = item.learnerIds.filter((value) => value !== learnerId); this.recordMemberHistory(classId, learnerId, "LEARNER", "REMOVED", actorId, { source: "MANUAL", reason: normalizedReason });
    return { ...item, instructorIds: [...item.instructorIds], learnerIds: [...item.learnerIds] };
  }

  async getClassRoster(classId: string): Promise<ClassRoster> {
    const prisma = this.database();
    if (prisma) {
      const item = await prisma.learningClass.findUnique({ where: { id: classId }, include: { instructors: { orderBy: { assignedAt: "asc" } }, enrollments: { orderBy: { joinedAt: "asc" } }, instructorHistory: { orderBy: { createdAt: "desc" } }, enrollmentHistory: { orderBy: { createdAt: "desc" } } } });
      if (!item) throw new NotFoundException("Không tìm thấy lớp học.");
      return { classId, instructors: item.instructors.map((row) => ({ instructorId: row.instructorId, role: row.role, assignedAt: row.assignedAt.toISOString() })), enrollments: item.enrollments.map((row) => ({ learnerId: row.learnerId, status: row.status === "ACTIVE" ? "ACTIVE" : "CANCELLED", source: row.source, joinedAt: row.joinedAt.toISOString(), removalReason: row.removalReason ?? undefined, removedAt: row.removedAt?.toISOString() })), history: [...item.instructorHistory.map((row) => ({ id: row.id, memberId: row.instructorId, memberType: "INSTRUCTOR" as const, action: row.action, role: row.role, reason: row.reason ?? undefined, actorId: row.actorId, createdAt: row.createdAt.toISOString() })), ...item.enrollmentHistory.map((row) => ({ id: row.id, memberId: row.learnerId, memberType: "LEARNER" as const, action: row.action, source: row.source, reason: row.reason ?? undefined, actorId: row.actorId, createdAt: row.createdAt.toISOString() }))].sort((a, b) => b.createdAt.localeCompare(a.createdAt)) };
    }
    const item = this.findClass(classId);
    return { classId, instructors: item.instructorIds.map((instructorId) => ({ instructorId, role: this.instructorRoles.get(`${classId}:${instructorId}`) ?? "CO_INSTRUCTOR", assignedAt: now() })), enrollments: item.learnerIds.map((learnerId) => ({ learnerId, status: "ACTIVE", source: "MANUAL", joinedAt: now() })), history: this.classMemberHistory.filter((row) => row.id.startsWith(`${classId}:`)).map((row) => ({ ...row })) };
  }

  async activateClass(classId: string, actorId = "usr-manager"): Promise<LearningClass> {
    const prisma = this.database();
    if (prisma) {
      const item = await this.getDatabaseClass(prisma, classId);
      if (item.status === "ACTIVE") return item;
      if (item.status === "CLOSED") throw new ConflictException("Lớp đã đóng và không thể kích hoạt trực tiếp.");
      if (!item.instructorIds.length) throw new BadRequestException("Cần phân công ít nhất một giảng viên trước khi kích hoạt.");
      if (new Date(item.endAt) <= new Date(item.startAt)) throw new BadRequestException("Lịch lớp không hợp lệ.");
      if (item.learnerIds.length > item.capacity) throw new BadRequestException("Sĩ số hiện tại vượt quá sức chứa lớp.");
      await prisma.$transaction([
        prisma.learningClass.update({ where: { id: classId }, data: { status: "ACTIVE" } }),
        prisma.auditLog.create({ data: { actorId, action: "CLASS_ACTIVATED", entityType: "learning_class", entityId: classId, context: { courseId: item.courseId, courseVersion: item.courseVersion, instructorCount: item.instructorIds.length, learnerCount: item.learnerIds.length } } }),
      ]);
      return this.getDatabaseClass(prisma, classId);
    }
    const item = this.findClass(classId);
    if (item.status === "ACTIVE") return { ...item, instructorIds: [...item.instructorIds], learnerIds: [...item.learnerIds] };
    if (item.status === "CLOSED") throw new ConflictException("Lớp đã đóng và không thể kích hoạt trực tiếp.");
    if (!item.instructorIds.length) throw new BadRequestException("Cần phân công ít nhất một giảng viên trước khi kích hoạt.");
    if (new Date(item.endAt) <= new Date(item.startAt)) throw new BadRequestException("Lịch lớp không hợp lệ.");
    if (item.learnerIds.length > item.capacity) throw new BadRequestException("Sĩ số hiện tại vượt quá sức chứa lớp.");
    item.status = "ACTIVE";
    return { ...item, instructorIds: [...item.instructorIds], learnerIds: [...item.learnerIds] };
  }

  async getClassClosureReadiness(classId: string): Promise<ClassClosureReadiness> {
    const prisma = this.database();
    if (prisma) {
      const current = await prisma.learningClass.findUnique({ where: { id: classId } });
      if (!current) throw new NotFoundException("Không tìm thấy lớp học.");
      const [openExams, pendingGrades, activeSessions, unlockedAttendanceSessions, openAppeals] = await prisma.$transaction([
        prisma.exam.count({ where: { classId, OR: [{ status: "PENDING_REVIEW" }, { status: "PUBLISHED", closeAt: { gt: new Date() } }] } }),
        prisma.examAttempt.count({ where: { exam: { classId }, status: "SUBMITTED" } }),
        prisma.liveSession.count({ where: { classId, status: { in: ["SCHEDULED", "LIVE"] } } }),
        prisma.liveSession.count({ where: { classId, status: "COMPLETED", attendanceLockedAt: null } }),
        prisma.attendanceAppeal.count({ where: { session: { classId }, status: { in: ["OPEN", "IN_REVIEW"] } } }),
      ]);
      return this.buildClassClosureReadiness(current.status, current.endAt, { openExams, pendingGrades, activeSessions, unlockedAttendanceSessions, openAppeals });
    }
    const item = this.findClass(classId);
    const classExams = this.exams.filter((exam) => exam.classId === classId);
    const classSessions = this.sessions.filter((session) => session.classId === classId);
    return this.buildClassClosureReadiness(item.status, new Date(item.endAt), {
      openExams: classExams.filter((exam) => exam.status === "PENDING_REVIEW" || (exam.status === "PUBLISHED" && new Date(exam.closeAt) > new Date())).length,
      pendingGrades: this.attempts.filter((attempt) => classExams.some((exam) => exam.id === attempt.examId) && attempt.status === "SUBMITTED").length,
      activeSessions: classSessions.filter((session) => session.status === "SCHEDULED" || session.status === "LIVE").length,
      unlockedAttendanceSessions: classSessions.filter((session) => session.status === "COMPLETED" && !session.attendanceLockedAt).length,
      openAppeals: this.attendanceAppeals.filter((appeal) => classSessions.some((session) => session.id === appeal.sessionId) && ["OPEN", "IN_REVIEW"].includes(appeal.status)).length,
    });
  }

  async closeClass(classId: string, closeReason: string, archivePolicy: "STANDARD_RETENTION" | "LONG_TERM_RETENTION", actorId = "usr-manager"): Promise<LearningClass> {
    const reason = closeReason.trim();
    if (reason.length < 5) throw new BadRequestException("Lý do đóng lớp cần ít nhất 5 ký tự.");
    const readiness = await this.getClassClosureReadiness(classId);
    if (!readiness.eligible) throw new ConflictException(`Chưa thể đóng lớp: ${readiness.blockers.join("; ")}.`);
    const prisma = this.database();
    if (prisma) {
      await prisma.$transaction(async (transaction) => {
        const updated = await transaction.learningClass.updateMany({ where: { id: classId, status: "ACTIVE" }, data: { status: "CLOSED", closeReason: reason, archivePolicy, closedAt: new Date(), archivedAt: new Date() } });
        if (updated.count !== 1) throw new ConflictException("Trạng thái lớp đã thay đổi; hãy kiểm tra lại trước khi đóng.");
        await transaction.auditLog.create({ data: { actorId, action: "CLASS_CLOSE_ARCHIVE", entityType: "learning_class", entityId: classId, context: { closeReason: reason, archivePolicy, eligible: readiness.eligible, blockers: readiness.blockers, openExams: readiness.openExams, pendingGrades: readiness.pendingGrades, activeSessions: readiness.activeSessions, unlockedAttendanceSessions: readiness.unlockedAttendanceSessions, openAppeals: readiness.openAppeals } } });
        const recipients = await transaction.classEnrollment.findMany({ where: { classId, status: "ACTIVE" }, select: { learnerId: true } });
        for (const recipient of recipients) await transaction.notification.create({ data: { id: id("notification"), recipientId: recipient.learnerId, type: "CLASS_ARCHIVED", title: "Lớp học đã kết thúc và chuyển sang chỉ đọc", entityType: "CLASS", entityId: classId, dedupKey: `class-archived:${classId}:${recipient.learnerId}` } });
      });
      return this.getDatabaseClass(prisma, classId);
    }
    const item = this.findClass(classId);
    item.status = "CLOSED";
    item.closeReason = reason;
    item.archivePolicy = archivePolicy;
    item.closedAt = now();
    item.archivedAt = item.closedAt;
    for (const learnerId of item.learnerIds) this.notifications.unshift({ id: id("notification"), recipientId: learnerId, type: "CLASS_ARCHIVED", title: "Lớp học đã kết thúc và chuyển sang chỉ đọc", entityType: "CLASS", entityId: classId, createdAt: now() });
    return { ...item, instructorIds: [...item.instructorIds], learnerIds: [...item.learnerIds] };
  }

  async reopenClass(classId: string, rawReason: string, actorId = "usr-manager"): Promise<LearningClass> {
    const reason = rawReason.trim();
    if (reason.length < 5) throw new BadRequestException("Lý do mở lại lớp cần ít nhất 5 ký tự.");
    const prisma = this.database();
    if (prisma) {
      await prisma.$transaction(async (transaction) => {
        const current = await transaction.learningClass.findUnique({ where: { id: classId } });
        if (!current) throw new NotFoundException("Không tìm thấy lớp học.");
        if (current.status !== "CLOSED") throw new ConflictException("Chỉ lớp đã đóng mới có thể mở lại.");
        await transaction.learningClass.update({ where: { id: classId }, data: { status: "ACTIVE", closeReason: null, archivePolicy: null, closedAt: null, archivedAt: null } });
        await transaction.auditLog.create({ data: { actorId, action: "CLASS_REOPEN", entityType: "learning_class", entityId: classId, context: { reason, previousClosedAt: current.closedAt?.toISOString(), previousArchivePolicy: current.archivePolicy } } });
      });
      return this.getDatabaseClass(prisma, classId);
    }
    const item = this.findClass(classId);
    if (item.status !== "CLOSED") throw new ConflictException("Chỉ lớp đã đóng mới có thể mở lại.");
    item.status = "ACTIVE";
    item.closeReason = undefined;
    item.archivePolicy = undefined;
    item.closedAt = undefined;
    item.archivedAt = undefined;
    return { ...item, instructorIds: [...item.instructorIds], learnerIds: [...item.learnerIds] };
  }

  async listMaterials(role: string, query?: string): Promise<LearningMaterial[]> {
    const normalized = query?.toLowerCase() ?? "";
    const prisma = this.database();
    if (prisma) {
      const rows = await prisma.material.findMany({
        where: role === "LEARNER"
          ? { visibility: "PUBLISHED", class: { enrollments: { some: { learnerId: "usr-learner", status: "ACTIVE" } } } }
          : role === "INSTRUCTOR"
            ? { class: { instructors: { some: { instructorId: "usr-instructor" } } } }
            : undefined,
        orderBy: { createdAt: "desc" },
      });
      return rows.map((row) => this.mapMaterial(row)).filter((item) => !normalized || `${item.name} ${item.folder} ${item.tags.join(" ")}`.toLowerCase().includes(normalized));
    }
    return this.materials
      .filter((item) => this.canAccessMemoryMaterial(item, role))
      .filter((item) => !normalized || `${item.name} ${item.folder} ${item.tags.join(" ")}`.toLowerCase().includes(normalized))
      .map((item) => ({ ...item, tags: [...item.tags] }));
  }

  async searchAccessibleMaterials(input: {
    query?: string;
    classId?: string;
    folder?: string;
    mimeType?: string;
    tag?: string;
    page?: number;
    pageSize?: number;
  }): Promise<MaterialSearchResult> {
    const page = Number.isInteger(input.page) && (input.page ?? 0) > 0 ? input.page as number : 1;
    const pageSize = Number.isInteger(input.pageSize) && (input.pageSize ?? 0) > 0 ? Math.min(input.pageSize as number, 50) : 12;
    const query = input.query?.trim();
    const prisma = this.database();
    if (prisma) {
      const where: Prisma.MaterialWhereInput = {
        visibility: "PUBLISHED",
        class: { enrollments: { some: { learnerId: "usr-learner", status: "ACTIVE" } } },
        classId: input.classId || undefined,
        folder: input.folder ? { contains: input.folder } : undefined,
        mimeType: input.mimeType || undefined,
        tags: input.tag ? { array_contains: input.tag } : undefined,
        ...(query ? { OR: [{ name: { contains: query } }, { folder: { contains: query } }] } : {}),
      };
      const [rows, total] = await prisma.$transaction([
        prisma.material.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "asc" }], skip: (page - 1) * pageSize, take: pageSize }),
        prisma.material.count({ where }),
      ]);
      const items = rows.map((row) => this.mapMaterial(row));
      return { items, total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
    }
    const normalized = query?.toLowerCase() ?? "";
    const tag = input.tag?.trim().toLowerCase() ?? "";
    const filtered = this.materials.filter((item) => this.canAccessMemoryMaterial(item, "LEARNER"))
      .filter((item) => !input.classId || item.classId === input.classId)
      .filter((item) => !input.folder || item.folder.toLowerCase().includes(input.folder.toLowerCase()))
      .filter((item) => !input.mimeType || item.mimeType === input.mimeType)
      .filter((item) => !tag || item.tags.some((value) => value.toLowerCase() === tag))
      .filter((item) => !normalized || `${item.name} ${item.folder} ${item.tags.join(" ")}`.toLowerCase().includes(normalized));
    const items = filtered.slice((page - 1) * pageSize, page * pageSize).map((item) => ({ ...item, tags: [...item.tags] }));
    return { items, total: filtered.length, page, pageSize, totalPages: Math.max(1, Math.ceil(filtered.length / pageSize)) };
  }

  async createMaterial(
    classId: string,
    input: Pick<LearningMaterial, "name" | "mimeType" | "sizeBytes" | "folder" | "tags">,
    upload?: UploadedMaterialFile,
  ): Promise<LearningMaterial> {
    const prisma = this.database();
    const policy = prisma ? await this.getStoragePolicy(prisma) : { maxFileSizeMb: 50, storageQuotaMb: 10_240, allowedMimeTypes: ["application/pdf", "video/mp4", "image/png", "image/jpeg"] };
    if (input.sizeBytes > policy.maxFileSizeMb * 1_000_000) throw new BadRequestException(`Tệp vượt giới hạn ${policy.maxFileSizeMb} MB.`);
    if (!policy.allowedMimeTypes.includes(input.mimeType)) throw new BadRequestException("Loại MIME không được chính sách lưu trữ cho phép.");
    const quarantineReason = upload ? this.detectMaliciousUpload(upload) : undefined;
    if (prisma) {
      const classItem = await prisma.learningClass.findUnique({ where: { id: classId } });
      if (!classItem) throw new NotFoundException("Không tìm thấy lớp học.");
      if (classItem.status === "CLOSED") throw new ConflictException("Lớp đã lưu trữ và chỉ cho phép đọc.");
      const usage = await prisma.material.aggregate({ _sum: { sizeBytes: true } });
      if ((usage._sum.sizeBytes ?? 0n) + BigInt(input.sizeBytes) > BigInt(policy.storageQuotaMb) * 1_000_000n) throw new BadRequestException("Kho lưu trữ đã vượt quota hệ thống.");
      const materialId = id("material");
      const stored = upload ? await this.storeUpload(classId, materialId, upload, Boolean(quarantineReason)) : { objectKey: `metadata/${classId}/${materialId}`, checksum: undefined };
      try {
        return prisma.$transaction(async (transaction) => {
          const material = await transaction.material.create({
            data: {
              id: materialId, classId, ownerId: "usr-instructor", name: input.name.trim(),
              objectKey: stored.objectKey, checksum: stored.checksum, mimeType: input.mimeType,
              sizeBytes: BigInt(input.sizeBytes), folder: input.folder.trim(), tags: input.tags,
              visibility: quarantineReason ? "HIDDEN" : "DRAFT",
              quarantinedAt: quarantineReason ? new Date() : null,
              quarantineReason,
            },
          });
          await transaction.materialVersion.create({ data: { id: id("material-version"), materialId, version: 1, name: material.name, objectKey: material.objectKey, mimeType: material.mimeType, sizeBytes: material.sizeBytes, checksum: material.checksum, folder: material.folder, tags: this.toStringArray(material.tags), visibility: material.visibility, createdBy: "usr-instructor" } });
          if (quarantineReason) {
            await transaction.notification.create({ data: { id: id("notification"), recipientId: "usr-instructor", type: "MATERIAL_QUARANTINED", title: `Tệp ${input.name.trim()} đã bị cách ly`, entityType: "MATERIAL", entityId: materialId, dedupKey: `material-quarantine:${materialId}:usr-instructor` } });
          }
          return this.mapMaterial(material);
        });
      } catch (error) {
        if (upload) await this.removeStoredFile(stored.objectKey);
        throw error;
      }
    }
    if (this.findClass(classId).status === "CLOSED") throw new ConflictException("Lớp đã lưu trữ và chỉ cho phép đọc.");
    const item: LearningMaterial = { ...input, id: id("material"), classId, version: 1, visibility: quarantineReason ? "HIDDEN" : "DRAFT", quarantinedAt: quarantineReason ? now() : undefined, quarantineReason, createdAt: now() };
    if (upload) {
      const stored = await this.storeUpload(classId, item.id, upload, Boolean(quarantineReason));
      this.materialFiles.set(item.id, { objectKey: stored.objectKey, checksum: stored.checksum });
    }
    this.materials.unshift(item);
    const storedFile = this.materialFiles.get(item.id);
    this.materialVersions.unshift({ ...item, id: id("material-version"), materialId: item.id, createdBy: "usr-instructor", objectKey: storedFile?.objectKey, checksum: storedFile?.checksum });
    if (quarantineReason) this.notifications.unshift({ id: id("notification"), recipientId: "usr-instructor", type: "MATERIAL_QUARANTINED", title: `Tệp ${input.name.trim()} đã bị cách ly`, entityType: "MATERIAL", entityId: item.id, createdAt: now() });
    return { ...item, tags: [...item.tags] };
  }

  async createMaterialAccess(materialId: string, role: string, action: MaterialAccessAction = "DOWNLOAD"): Promise<{ url: string; expiresAt: string }> {
    const prisma = this.database();
    if (prisma) {
      const material = await prisma.material.findUnique({
        where: { id: materialId }, include: { class: { include: { enrollments: true } } },
      });
      if (!material) throw new NotFoundException("Không tìm thấy học liệu.");
      if (material.quarantinedAt) throw new BadRequestException("Tệp đang bị cách ly và không thể truy cập.");
      if (role === "LEARNER" && material.visibility !== "PUBLISHED") throw new NotFoundException("Không tìm thấy học liệu đã phát hành.");
      if (role === "LEARNER" && !material.class.enrollments.some((item) => item.learnerId === "usr-learner" && item.status === "ACTIVE")) {
        throw new NotFoundException("Học viên không thuộc lớp chứa học liệu này.");
      }
      if (role === "INSTRUCTOR") {
        const assigned = await prisma.classInstructor.findUnique({ where: { classId_instructorId: { classId: material.classId, instructorId: "usr-instructor" } } });
        if (!assigned) throw new NotFoundException("Giảng viên không được phân công vào lớp chứa học liệu này.");
      }
      if (!material.objectKey.startsWith("files/")) throw new NotFoundException("Học liệu này chưa có tệp bytes để tải.");
    } else {
      const material = this.materials.find((item) => item.id === materialId);
      if (material?.quarantinedAt) throw new BadRequestException("Tệp đang bị cách ly và không thể truy cập.");
      if (!material || role === "LEARNER" && material.visibility !== "PUBLISHED") throw new NotFoundException("Không tìm thấy học liệu.");
      const classItem = this.findClass(material.classId);
      if (role === "LEARNER" && !classItem.learnerIds.includes("usr-learner")) throw new NotFoundException("Học viên không thuộc lớp chứa học liệu này.");
      if (role === "INSTRUCTOR" && !classItem.instructorIds.includes("usr-instructor")) throw new NotFoundException("Giảng viên không được phân công vào lớp chứa học liệu này.");
      if (!this.materialFiles.has(materialId)) throw new NotFoundException("Học liệu này chưa có tệp bytes để tải.");
    }
    const expires = Math.floor(Date.now() / 1000) + 300;
    const signature = this.signMaterialAccess(materialId, expires, action);
    return { url: `/materials/${materialId}/download?expires=${expires}&action=${action}&signature=${encodeURIComponent(signature)}`, expiresAt: new Date(expires * 1000).toISOString() };
  }

  async readMaterialDownload(
    materialId: string,
    expires: number,
    signature: string,
    role: string,
    action: MaterialAccessAction = "DOWNLOAD",
    context: { ipAddress?: string; userAgent?: string } = {},
  ): Promise<MaterialDownload> {
    this.verifyMaterialAccess(materialId, expires, signature, action);
    const prisma = this.database();
    let fileName: string;
    let mimeType: string;
    let objectKey: string | undefined;
    let expectedChecksum: string | undefined;
    if (prisma) {
      const material = await prisma.material.findUnique({
        where: { id: materialId },
        include: { class: { include: { enrollments: true, instructors: true } } },
      });
      if (!material || role === "LEARNER" && material.visibility !== "PUBLISHED") throw new NotFoundException("Không tìm thấy học liệu.");
      if (material.quarantinedAt) throw new BadRequestException("Tệp đang bị cách ly và không thể truy cập.");
      if (role === "LEARNER" && !material.class.enrollments.some((item) => item.learnerId === "usr-learner" && item.status === "ACTIVE")) {
        throw new NotFoundException("Học viên không thuộc lớp chứa học liệu này.");
      }
      if (role === "INSTRUCTOR" && !material.class.instructors.some((item) => item.instructorId === "usr-instructor")) {
        throw new NotFoundException("Giảng viên không được phân công vào lớp chứa học liệu này.");
      }
      fileName = material.name;
      mimeType = material.mimeType;
      objectKey = material.objectKey;
      expectedChecksum = material.checksum ?? undefined;
    } else {
      const material = this.materials.find((item) => item.id === materialId);
      const stored = this.materialFiles.get(materialId);
      if (!material || !stored || role === "LEARNER" && material.visibility !== "PUBLISHED") throw new NotFoundException("Không tìm thấy học liệu.");
      if (material.quarantinedAt) throw new BadRequestException("Tệp đang bị cách ly và không thể truy cập.");
      const classItem = this.findClass(material.classId);
      if (role === "LEARNER" && !classItem.learnerIds.includes("usr-learner")) throw new NotFoundException("Học viên không thuộc lớp chứa học liệu này.");
      if (role === "INSTRUCTOR" && !classItem.instructorIds.includes("usr-instructor")) throw new NotFoundException("Giảng viên không được phân công vào lớp chứa học liệu này.");
      fileName = material.name;
      mimeType = material.mimeType;
      objectKey = stored.objectKey;
      expectedChecksum = stored.checksum;
    }
    if (!objectKey?.startsWith("files/")) throw new NotFoundException("Tệp học liệu không tồn tại trong kho bytes.");
    const buffer = await readFile(this.resolveObjectPath(objectKey)).catch(() => { throw new NotFoundException("Tệp học liệu không còn tồn tại trên ổ đĩa."); });
    if (expectedChecksum) {
      const actualChecksum = `sha256:${createHash("sha256").update(buffer).digest("hex")}`;
      if (actualChecksum !== expectedChecksum) throw new BadRequestException("Checksum học liệu không hợp lệ; tệp đã được cách ly.");
    }
    const userId = this.userIdForRole(role);
    if (prisma) {
      await prisma.materialAccessLog.create({
        data: { id: id("material-access"), materialId, userId, action, ipAddress: context.ipAddress?.slice(0, 45), userAgent: context.userAgent?.slice(0, 500) },
      });
    } else {
      this.materialAccessLogs.unshift({ materialId, userId, action, createdAt: now() });
    }
    return { fileName, mimeType, buffer };
  }

  async updateMaterial(materialId: string, input: Partial<Pick<LearningMaterial, "folder" | "tags" | "visibility">>): Promise<LearningMaterial> {
    const prisma = this.database();
    if (prisma) {
      const current = await prisma.material.findUnique({ where: { id: materialId }, include: { class: true } });
      if (!current) throw new NotFoundException("Không tìm thấy học liệu.");
      if (current.class.status === "CLOSED") throw new ConflictException("Lớp đã lưu trữ và chỉ cho phép đọc.");
      if (current.quarantinedAt && input.visibility === "PUBLISHED") throw new BadRequestException("Không thể phát hành tệp đang bị cách ly.");
      return prisma.$transaction(async (transaction) => {
        const updated = await transaction.material.update({ where: { id: materialId }, data: { folder: input.folder?.trim(), tags: input.tags, visibility: input.visibility, version: { increment: 1 } } });
        await transaction.materialVersion.create({ data: { id: id("material-version"), materialId, version: updated.version, name: updated.name, objectKey: updated.objectKey, mimeType: updated.mimeType, sizeBytes: updated.sizeBytes, checksum: updated.checksum, folder: updated.folder, tags: this.toStringArray(updated.tags), visibility: updated.visibility, createdBy: "usr-instructor" } });
        return this.mapMaterial(updated);
      });
    }
    const item = this.materials.find((material) => material.id === materialId);
    if (!item) throw new NotFoundException("Không tìm thấy học liệu.");
    if (this.findClass(item.classId).status === "CLOSED") throw new ConflictException("Lớp đã lưu trữ và chỉ cho phép đọc.");
    if (item.quarantinedAt && input.visibility === "PUBLISHED") throw new BadRequestException("Không thể phát hành tệp đang bị cách ly.");
    Object.assign(item, input);
    item.version += 1;
    const stored = this.materialFiles.get(materialId);
    this.materialVersions.unshift({ ...item, id: id("material-version"), materialId, createdBy: "usr-instructor", objectKey: stored?.objectKey, checksum: stored?.checksum, tags: [...item.tags] });
    return { ...item, tags: [...item.tags] };
  }

  async listMaterialVersions(materialId: string, role: string): Promise<MaterialVersionSnapshot[]> {
    const prisma = this.database();
    if (prisma) {
      const material = await prisma.material.findUnique({ where: { id: materialId }, include: { class: { include: { enrollments: true, instructors: true } } } });
      if (!material) throw new NotFoundException("Không tìm thấy học liệu.");
      this.assertMaterialClassAccess(material.class, role);
      const rows = await prisma.materialVersion.findMany({ where: { materialId, ...(role === "LEARNER" ? { visibility: "PUBLISHED" } : {}) }, orderBy: { version: "desc" } });
      return rows.map((row) => this.mapMaterialVersion(row));
    }
    const material = this.materials.find((item) => item.id === materialId);
    if (!material) throw new NotFoundException("Không tìm thấy học liệu.");
    this.assertMemoryMaterialClassAccess(material.classId, role);
    return this.materialVersions.filter((item) => item.materialId === materialId && (role !== "LEARNER" || item.visibility === "PUBLISHED")).sort((a, b) => b.version - a.version).map((item) => ({ id: item.id, materialId: item.materialId, version: item.version, name: item.name, mimeType: item.mimeType, sizeBytes: item.sizeBytes, folder: item.folder, tags: [...item.tags], visibility: item.visibility, createdBy: item.createdBy, createdAt: item.createdAt }));
  }

  async createMaterialVersionAccess(materialId: string, version: number, role: string, action: MaterialAccessAction = "DOWNLOAD"): Promise<{ url: string; expiresAt: string }> {
    const prisma = this.database();
    if (prisma) {
      const row = await prisma.materialVersion.findUnique({ where: { materialId_version: { materialId, version } }, include: { material: { include: { class: { include: { enrollments: true, instructors: true } } } } } });
      if (!row || role === "LEARNER" && row.visibility !== "PUBLISHED") throw new NotFoundException("Không tìm thấy phiên bản học liệu.");
      this.assertMaterialClassAccess(row.material.class, role);
      if (!row.objectKey.startsWith("files/")) throw new NotFoundException("Phiên bản này chưa có tệp bytes để tải.");
    } else {
      const material = this.materials.find((item) => item.id === materialId);
      const row = this.materialVersions.find((item) => item.materialId === materialId && item.version === version);
      if (!material || !row || role === "LEARNER" && row.visibility !== "PUBLISHED") throw new NotFoundException("Không tìm thấy phiên bản học liệu.");
      this.assertMemoryMaterialClassAccess(material.classId, role);
      if (!row.objectKey?.startsWith("files/")) throw new NotFoundException("Phiên bản này chưa có tệp bytes để tải.");
    }
    const expires = Math.floor(Date.now() / 1000) + 300;
    const signature = this.signMaterialAccess(`${materialId}:${version}`, expires, action);
    return { url: `/materials/${materialId}/versions/${version}/download?expires=${expires}&action=${action}&signature=${encodeURIComponent(signature)}`, expiresAt: new Date(expires * 1000).toISOString() };
  }

  async readMaterialVersionDownload(materialId: string, version: number, expires: number, signature: string, role: string, action: MaterialAccessAction = "DOWNLOAD"): Promise<MaterialDownload> {
    this.verifyMaterialAccess(`${materialId}:${version}`, expires, signature, action);
    const prisma = this.database();
    let fileName: string; let mimeType: string; let objectKey: string | undefined; let checksum: string | undefined;
    if (prisma) {
      const row = await prisma.materialVersion.findUnique({ where: { materialId_version: { materialId, version } }, include: { material: { include: { class: { include: { enrollments: true, instructors: true } } } } } });
      if (!row || role === "LEARNER" && row.visibility !== "PUBLISHED") throw new NotFoundException("Không tìm thấy phiên bản học liệu.");
      this.assertMaterialClassAccess(row.material.class, role);
      ({ name: fileName, mimeType, objectKey } = row); checksum = row.checksum ?? undefined;
    } else {
      const material = this.materials.find((item) => item.id === materialId);
      const row = this.materialVersions.find((item) => item.materialId === materialId && item.version === version);
      if (!material || !row || role === "LEARNER" && row.visibility !== "PUBLISHED") throw new NotFoundException("Không tìm thấy phiên bản học liệu.");
      this.assertMemoryMaterialClassAccess(material.classId, role);
      fileName = row.name; mimeType = row.mimeType; objectKey = row.objectKey; checksum = row.checksum;
    }
    if (!objectKey?.startsWith("files/")) throw new NotFoundException("Tệp phiên bản không tồn tại trong kho bytes.");
    const buffer = await readFile(this.resolveObjectPath(objectKey)).catch(() => { throw new NotFoundException("Tệp phiên bản không còn tồn tại trên ổ đĩa."); });
    if (checksum && `sha256:${createHash("sha256").update(buffer).digest("hex")}` !== checksum) throw new BadRequestException("Checksum phiên bản học liệu không hợp lệ.");
    if (prisma) await prisma.materialAccessLog.create({ data: { id: id("material-access"), materialId, userId: this.userIdForRole(role), action: `${action}_V${version}` } });
    else this.materialAccessLogs.unshift({ materialId, userId: this.userIdForRole(role), action, createdAt: now() });
    return { fileName, mimeType, buffer };
  }

  async replaceMaterialVersion(materialId: string, input: Pick<LearningMaterial, "folder" | "tags">, upload: UploadedMaterialFile): Promise<LearningMaterial> {
    const prisma = this.database();
    const policy = prisma ? await this.getStoragePolicy(prisma) : { maxFileSizeMb: 50, storageQuotaMb: 10_240, allowedMimeTypes: ["application/pdf", "video/mp4", "image/png", "image/jpeg"] };
    if (upload.size > policy.maxFileSizeMb * 1_000_000) throw new BadRequestException(`Tệp vượt giới hạn ${policy.maxFileSizeMb} MB.`);
    if (!policy.allowedMimeTypes.includes(upload.mimeType)) throw new BadRequestException("Loại MIME không được chính sách lưu trữ cho phép.");
    const quarantineReason = this.detectMaliciousUpload(upload);
    if (prisma) {
      const storedVersions = await prisma.materialVersion.findMany({ distinct: ["objectKey"], select: { sizeBytes: true } });
      if (storedVersions.reduce((sum, item) => sum + item.sizeBytes, 0n) + BigInt(upload.size) > BigInt(policy.storageQuotaMb) * 1_000_000n) throw new BadRequestException("Kho lưu trữ đã vượt quota hệ thống.");
      const current = await prisma.material.findUnique({ where: { id: materialId }, include: { class: { include: { instructors: true } } } });
      if (!current || !current.class.instructors.some((item) => item.instructorId === "usr-instructor")) throw new NotFoundException("Không tìm thấy học liệu được phép cập nhật.");
      if (current.class.status === "CLOSED") throw new ConflictException("Lớp đã lưu trữ và chỉ cho phép đọc.");
      const nextVersion = current.version + 1;
      const stored = await this.storeUpload(current.classId, `${materialId}-v${nextVersion}-${randomUUID()}`, upload, Boolean(quarantineReason));
      try {
        return await prisma.$transaction(async (transaction) => {
          const updated = await transaction.material.update({ where: { id: materialId }, data: { name: upload.originalName.trim(), objectKey: stored.objectKey, checksum: stored.checksum, mimeType: upload.mimeType, sizeBytes: BigInt(upload.size), folder: input.folder.trim(), tags: input.tags, version: nextVersion, visibility: quarantineReason ? "HIDDEN" : "DRAFT", quarantinedAt: quarantineReason ? new Date() : null, quarantineReason } });
          await transaction.materialVersion.create({ data: { id: id("material-version"), materialId, version: nextVersion, name: updated.name, objectKey: updated.objectKey, mimeType: updated.mimeType, sizeBytes: updated.sizeBytes, checksum: updated.checksum, folder: updated.folder, tags: this.toStringArray(updated.tags), visibility: updated.visibility, createdBy: "usr-instructor" } });
          return this.mapMaterial(updated);
        });
      } catch (error) { await this.removeStoredFile(stored.objectKey); throw error; }
    }
    const current = this.materials.find((item) => item.id === materialId);
    if (!current || !this.findClass(current.classId).instructorIds.includes("usr-instructor")) throw new NotFoundException("Không tìm thấy học liệu được phép cập nhật.");
    if (this.findClass(current.classId).status === "CLOSED") throw new ConflictException("Lớp đã lưu trữ và chỉ cho phép đọc.");
    const distinctStoredBytes = [...new Map(this.materialVersions.filter((item) => item.objectKey).map((item) => [item.objectKey, item.sizeBytes])).values()].reduce((sum, size) => sum + size, 0);
    if (distinctStoredBytes + upload.size > policy.storageQuotaMb * 1_000_000) throw new BadRequestException("Kho lưu trữ đã vượt quota hệ thống.");
    const nextVersion = current.version + 1;
    const stored = await this.storeUpload(current.classId, `${materialId}-v${nextVersion}-${randomUUID()}`, upload, Boolean(quarantineReason));
    Object.assign(current, { name: upload.originalName.trim(), mimeType: upload.mimeType, sizeBytes: upload.size, folder: input.folder.trim(), tags: [...input.tags], version: nextVersion, visibility: quarantineReason ? "HIDDEN" : "DRAFT", quarantinedAt: quarantineReason ? now() : undefined, quarantineReason });
    this.materialFiles.set(materialId, stored);
    this.materialVersions.unshift({ ...current, id: id("material-version"), materialId, createdBy: "usr-instructor", objectKey: stored.objectKey, checksum: stored.checksum, tags: [...current.tags] });
    return { ...current, tags: [...current.tags] };
  }

  async reviewClassMaterial(
    materialId: string,
    action: FileReviewRecord["action"],
    rawReason?: string,
    reviewerId = "usr-manager",
  ): Promise<LearningMaterial> {
    const reason = rawReason?.trim();
    if ((action === "HIDE" || action === "REQUEST_CHANGES") && (!reason || reason.length < 5)) {
      throw new BadRequestException("Cần lý do ít nhất 5 ký tự khi ẩn hoặc yêu cầu sửa học liệu.");
    }
    const visibility: LearningMaterial["visibility"] = action === "APPROVE" ? "PUBLISHED" : action === "HIDE" ? "HIDDEN" : "DRAFT";
    const prisma = this.database();
    if (prisma) {
      return prisma.$transaction(async (transaction) => {
        const current = await transaction.material.findUnique({ where: { id: materialId } });
        if (!current) throw new NotFoundException("Không tìm thấy học liệu.");
        if (current.quarantinedAt && action === "APPROVE") throw new BadRequestException("Không thể duyệt tệp đang bị cách ly.");
        const material = await transaction.material.update({ where: { id: materialId }, data: { visibility, version: { increment: 1 } } });
        await transaction.materialVersion.create({ data: { id: id("material-version"), materialId, version: material.version, name: material.name, objectKey: material.objectKey, mimeType: material.mimeType, sizeBytes: material.sizeBytes, checksum: material.checksum, folder: material.folder, tags: this.toStringArray(material.tags), visibility: material.visibility, createdBy: reviewerId } });
        const reviewId = id("file-review");
        await transaction.fileReview.create({ data: { id: reviewId, materialId, reviewerId, action, reason } });
        await transaction.auditLog.create({ data: { actorId: reviewerId, action: `MATERIAL_${action}`, entityType: "material", entityId: materialId, context: { reason: reason ?? "Duyệt phát hành", before: current.visibility, after: visibility } } });
        await transaction.notification.create({ data: { id: id("notification"), recipientId: current.ownerId, type: "MATERIAL_REVIEWED", title: `Học liệu ${current.name}: ${action}`, entityType: "MATERIAL", entityId: materialId, dedupKey: `material-review:${reviewId}:${current.ownerId}` } });
        return this.mapMaterial(material);
      });
    }
    const item = this.materials.find((material) => material.id === materialId);
    if (!item) throw new NotFoundException("Không tìm thấy học liệu.");
    if (item.quarantinedAt && action === "APPROVE") throw new BadRequestException("Không thể duyệt tệp đang bị cách ly.");
    const review: FileReviewRecord = { id: id("file-review"), materialId, reviewerId, action, reason, createdAt: now() };
    this.materialReviews.unshift(review);
    item.visibility = visibility;
    item.version += 1;
    const stored = this.materialFiles.get(materialId);
    this.materialVersions.unshift({ ...item, id: id("material-version"), materialId, createdBy: reviewerId, objectKey: stored?.objectKey, checksum: stored?.checksum, tags: [...item.tags] });
    this.notifications.unshift({ id: id("notification"), recipientId: "usr-instructor", type: "MATERIAL_REVIEWED", title: `Học liệu ${item.name}: ${action}`, entityType: "MATERIAL", entityId: materialId, createdAt: now() });
    return { ...item, tags: [...item.tags] };
  }

  async listMaterialReviews(materialId: string): Promise<FileReviewRecord[]> {
    const prisma = this.database();
    if (prisma) {
      const exists = await prisma.material.findUnique({ where: { id: materialId }, select: { id: true } });
      if (!exists) throw new NotFoundException("Không tìm thấy học liệu.");
      const rows = await prisma.fileReview.findMany({ where: { materialId }, orderBy: { createdAt: "desc" } });
      return rows.map((row) => ({ id: row.id, materialId: row.materialId, reviewerId: row.reviewerId, action: this.fileReviewAction(row.action), reason: row.reason ?? undefined, createdAt: row.createdAt.toISOString() }));
    }
    return this.materialReviews.filter((review) => review.materialId === materialId).map((review) => ({ ...review }));
  }

  async listQuestions(filters: string | { query?: string; courseId?: string; type?: string; difficulty?: number; tag?: string } = {}): Promise<LearningQuestion[]> {
    const input = typeof filters === "string" ? { query: filters } : filters;
    const normalized = input.query?.trim().toLowerCase() ?? "";
    const matches = (item: LearningQuestion): boolean =>
      (!normalized || `${item.content} ${item.tags.join(" ")}`.toLowerCase().includes(normalized))
      && (!input.courseId || item.courseId === input.courseId)
      && (!input.type || item.type === input.type)
      && (!input.difficulty || item.difficulty === input.difficulty)
      && (!input.tag || item.tags.some((tag) => tag.toLowerCase() === input.tag!.trim().toLowerCase()));
    const prisma = this.database();
    if (prisma) {
      const rows = await prisma.question.findMany({ orderBy: { createdAt: "desc" } });
      return this.latestQuestionVersions(rows.map((row) => this.mapQuestion(row))).filter(matches);
    }
    return this.latestQuestionVersions(this.questions).filter(matches).map((item) => this.cloneQuestion(item));
  }

  async createQuestion(input: Omit<LearningQuestion, "id" | "status" | "version">): Promise<LearningQuestion> {
    const normalized = this.validateQuestionInput(input);
    const contentHash = this.questionContentHash(normalized.content);
    const prisma = this.database();
    if (prisma) {
      const course = await prisma.course.findUnique({ where: { id: normalized.courseId } });
      if (!course) throw new NotFoundException("Không tìm thấy khóa học.");
      const duplicate = await prisma.question.findFirst({ where: { courseId: normalized.courseId, contentHash } });
      if (duplicate) throw new ConflictException("Nội dung câu hỏi đã tồn tại trong khóa học.");
      const questionId = id("question");
      return this.mapQuestion(await prisma.question.create({
        data: {
          id: questionId, familyId: questionId, contentHash, courseId: normalized.courseId, authorId: "usr-instructor",
          type: normalized.type, content: normalized.content, options: normalized.options,
          correctAnswers: normalized.correctAnswers, difficulty: normalized.difficulty, tags: normalized.tags,
        },
      }));
    }
    if (this.questions.some((item) => item.courseId === normalized.courseId && this.questionContentHash(item.content) === contentHash)) throw new ConflictException("Nội dung câu hỏi đã tồn tại trong khóa học.");
    const questionId = id("question");
    const item: LearningQuestion = { ...normalized, id: questionId, familyId: questionId, status: "DRAFT", version: 1 };
    this.questions.unshift(item);
    return this.cloneQuestion(item);
  }

  async updateQuestion(questionId: string, input: Omit<LearningQuestion, "id" | "status" | "version">): Promise<LearningQuestion> {
    const normalized = this.validateQuestionInput(input);
    const contentHash = this.questionContentHash(normalized.content);
    const prisma = this.database();
    if (prisma) {
      const current = await prisma.question.findUnique({ where: { id: questionId } });
      if (!current) throw new NotFoundException("Không tìm thấy câu hỏi.");
      const familyId = current.familyId || current.id;
      const duplicate = await prisma.question.findFirst({ where: { courseId: normalized.courseId, contentHash, familyId: { not: familyId } } });
      if (duplicate) throw new ConflictException("Nội dung câu hỏi đã tồn tại trong khóa học.");
      const latest = await prisma.question.findFirst({ where: { familyId }, orderBy: { version: "desc" } });
      if (latest?.id !== current.id) throw new ConflictException("Chỉ có thể sửa phiên bản mới nhất của câu hỏi.");
      return this.mapQuestion(await prisma.question.create({ data: {
        id: id("question"), familyId, supersedesId: current.id, contentHash, courseId: normalized.courseId,
        authorId: "usr-instructor", type: normalized.type, content: normalized.content, options: normalized.options,
        correctAnswers: normalized.correctAnswers, difficulty: normalized.difficulty, tags: normalized.tags,
        status: "DRAFT", version: current.version + 1,
      } }));
    }
    const current = this.questions.find((item) => item.id === questionId);
    if (!current) throw new NotFoundException("Không tìm thấy câu hỏi.");
    const familyId = current.familyId ?? current.id;
    const latest = this.questions.filter((item) => (item.familyId ?? item.id) === familyId).sort((a, b) => b.version - a.version)[0];
    if (latest?.id !== current.id) throw new ConflictException("Chỉ có thể sửa phiên bản mới nhất của câu hỏi.");
    if (this.questions.some((item) => item.courseId === normalized.courseId && (item.familyId ?? item.id) !== familyId && this.questionContentHash(item.content) === contentHash)) throw new ConflictException("Nội dung câu hỏi đã tồn tại trong khóa học.");
    const next: LearningQuestion = { ...normalized, id: id("question"), familyId, supersedesId: current.id, status: "DRAFT", version: current.version + 1 };
    this.questions.unshift(next);
    return this.cloneQuestion(next);
  }

  async publishQuestion(questionId: string): Promise<LearningQuestion> {
    const prisma = this.database();
    if (prisma) {
      const current = await prisma.question.findUnique({ where: { id: questionId } });
      if (!current) throw new NotFoundException("Không tìm thấy câu hỏi.");
      if (current.status === "PUBLISHED") return this.mapQuestion(current);
      const latest = await prisma.question.findFirst({ where: { familyId: current.familyId }, orderBy: { version: "desc" } });
      if (latest?.id !== current.id) throw new ConflictException("Chỉ có thể xuất bản phiên bản mới nhất của câu hỏi.");
      return this.mapQuestion(await prisma.question.update({ where: { id: questionId }, data: { status: "PUBLISHED" } }));
    }
    const current = this.questions.find((item) => item.id === questionId);
    if (!current) throw new NotFoundException("Không tìm thấy câu hỏi.");
    if (current.status === "PUBLISHED") return this.cloneQuestion(current);
    const familyId = current.familyId ?? current.id;
    const latest = this.questions.filter((item) => (item.familyId ?? item.id) === familyId).sort((a, b) => b.version - a.version)[0];
    if (latest?.id !== current.id) throw new ConflictException("Chỉ có thể xuất bản phiên bản mới nhất của câu hỏi.");
    current.status = "PUBLISHED";
    return this.cloneQuestion(current);
  }

  async importQuestions(inputs: Array<Omit<LearningQuestion, "id" | "status" | "version">>): Promise<QuestionImportResult[]> {
    const results: QuestionImportResult[] = [];
    for (const [index, input] of inputs.entries()) {
      try {
        const question = await this.createQuestion(input);
        results.push({ row: index + 1, status: "IMPORTED", questionId: question.id, message: "Đã nhập câu hỏi." });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Không thể nhập câu hỏi.";
        results.push({ row: index + 1, status: "FAILED", message });
      }
    }
    return results;
  }

  async listExams(role: string): Promise<LearningExam[]> {
    const prisma = this.database();
    if (prisma) {
      const rows = await prisma.exam.findMany({
        where: role === "LEARNER" ? { status: "PUBLISHED" } : undefined,
        include: { questions: { orderBy: { position: "asc" } } }, orderBy: { openAt: "desc" },
      });
      return rows.map((row) => this.mapExam(row));
    }
    return this.exams.filter((item) => role !== "LEARNER" || item.status === "PUBLISHED").map((item) => ({ ...item, questionIds: [...item.questionIds] }));
  }

  async listLearnerExamSummaries(classId?: string): Promise<LearnerExamSummary[]> {
    const learnerId = "usr-learner";
    const timestamp = new Date();
    const prisma = this.database();
    if (prisma) {
      const rows = await prisma.exam.findMany({
        where: {
          status: "PUBLISHED",
          classId: classId || undefined,
          class: { enrollments: { some: { learnerId, status: "ACTIVE" } } },
        },
        include: { questions: { orderBy: { position: "asc" } }, attempts: { where: { learnerId }, orderBy: { attemptNo: "asc" } } },
        orderBy: { openAt: "desc" },
      });
      return rows.map((row) => {
        const exam = this.mapExam(row);
        const active = row.attempts.some((attempt) => attempt.status === "IN_PROGRESS");
        return {
          ...exam,
          questionIds: [],
          questionCount: row.questions.length,
          availabilityStatus: this.examAvailability(exam, row.attempts.length, active, timestamp),
          remainingAttempts: Math.max(0, exam.attemptLimit - row.attempts.length),
          serverTime: timestamp.toISOString(),
        };
      });
    }
    return this.exams.filter((exam) => exam.status === "PUBLISHED")
      .filter((exam) => !classId || exam.classId === classId)
      .filter((exam) => this.classes.some((classItem) => classItem.id === exam.classId && classItem.learnerIds.includes(learnerId)))
      .map((exam) => {
        const attempts = this.attempts.filter((attempt) => attempt.examId === exam.id && attempt.learnerId === learnerId);
        return {
          ...exam,
          questionIds: [],
          questionCount: exam.questionIds.length,
          availabilityStatus: this.examAvailability(exam, attempts.length, attempts.some((attempt) => attempt.status === "IN_PROGRESS"), timestamp),
          remainingAttempts: Math.max(0, exam.attemptLimit - attempts.length),
          serverTime: timestamp.toISOString(),
        };
      });
  }

  async getExamQuestions(examId: string): Promise<LearningQuestion[]> {
    const prisma = this.database();
    if (prisma) {
      const exam = await prisma.exam.findFirst({
        where: {
          id: examId,
          status: "PUBLISHED",
          class: { enrollments: { some: { learnerId: "usr-learner", status: "ACTIVE" } } },
          attempts: { some: { learnerId: "usr-learner", status: "IN_PROGRESS" } },
        },
        include: {
          questions: { include: { question: true }, orderBy: { position: "asc" } },
          attempts: { where: { learnerId: "usr-learner", status: "IN_PROGRESS" }, take: 1 },
        },
      });
      if (!exam) throw new NotFoundException("Không tìm thấy lượt làm bài đang mở cho đề này.");
      const activeAttempt = exam.attempts[0];
      if (!activeAttempt || this.attemptDeadline(activeAttempt.startedAt, exam.durationMinutes, exam.closeAt) <= new Date()) {
        throw new BadRequestException("Lượt làm bài đã hết thời gian.");
      }
      return exam.questions.map(({ question }) => ({ ...this.mapQuestion(question), correctAnswers: [] }));
    }
    const exam = this.findExam(examId);
    if (exam.status !== "PUBLISHED") throw new BadRequestException("Đề chưa được phát hành.");
    const classItem = this.findClass(exam.classId);
    if (!classItem.learnerIds.includes("usr-learner")) throw new NotFoundException("Học viên không thuộc lớp được giao đề.");
    if (!this.attempts.some((attempt) => attempt.examId === examId && attempt.learnerId === "usr-learner" && attempt.status === "IN_PROGRESS")) {
      throw new NotFoundException("Không tìm thấy lượt làm bài đang mở cho đề này.");
    }
    const activeAttempt = this.attempts.find((attempt) => attempt.examId === examId && attempt.learnerId === "usr-learner" && attempt.status === "IN_PROGRESS");
    if (!activeAttempt || this.attemptDeadline(new Date(activeAttempt.startedAt), exam.durationMinutes, new Date(exam.closeAt)) <= new Date()) {
      throw new BadRequestException("Lượt làm bài đã hết thời gian.");
    }
    return exam.questionIds.map((questionId) => {
      const question = this.questions.find((item) => item.id === questionId);
      if (!question) throw new NotFoundException("Đề chứa câu hỏi không tồn tại.");
      return { ...question, options: [...question.options], correctAnswers: [], tags: [...question.tags] };
    });
  }

  async createExam(input: Omit<LearningExam, "id" | "status" | "version">): Promise<LearningExam> {
    if (new Date(input.closeAt) <= new Date(input.openAt)) throw new BadRequestException("Thời gian đóng đề phải sau thời gian mở.");
    if (!input.questionIds.length) throw new BadRequestException("Đề cần ít nhất một câu hỏi.");
    const orderedQuestionIds = input.shuffleQuestions ? this.seededOrder(input.questionIds, input.randomSeed?.trim() || "wind-exam-default") : [...input.questionIds];
    const prisma = this.database();
    if (prisma) {
      return prisma.$transaction(async (transaction) => {
        const classItem = await transaction.learningClass.findUnique({ where: { id: input.classId } });
        if (!classItem) throw new NotFoundException("Không tìm thấy lớp học.");
        if (classItem.status === "CLOSED") throw new ConflictException("Lớp đã lưu trữ và chỉ cho phép đọc.");
        if (new Set(input.questionIds).size !== input.questionIds.length) throw new BadRequestException("Danh sách đề không được chứa câu hỏi trùng.");
        const questionCount = await transaction.question.count({ where: { id: { in: input.questionIds }, status: "PUBLISHED", courseId: classItem.courseId } });
        if (questionCount !== input.questionIds.length) throw new BadRequestException("Đề chỉ được dùng câu hỏi đã xuất bản thuộc khóa học của lớp.");
        const exam = await transaction.exam.create({
          data: {
            id: id("exam"), classId: input.classId, title: input.title.trim(),
            durationMinutes: input.durationMinutes, totalScore: input.totalScore,
            openAt: new Date(input.openAt), closeAt: new Date(input.closeAt), attemptLimit: input.attemptLimit,
            shuffleQuestions: input.shuffleQuestions ?? false, randomSeed: input.randomSeed?.trim(),
          },
        });
        const scorePerQuestion = input.totalScore / input.questionIds.length;
        await transaction.examQuestion.createMany({
          data: orderedQuestionIds.map((questionId, position) => ({ examId: exam.id, questionId, position: position + 1, score: scorePerQuestion })),
        });
        return this.getDatabaseExam(transaction, exam.id);
      });
    }
    const classItem = this.findClass(input.classId);
    if (classItem.status === "CLOSED") throw new ConflictException("Lớp đã lưu trữ và chỉ cho phép đọc.");
    if (new Set(input.questionIds).size !== input.questionIds.length) throw new BadRequestException("Danh sách đề không được chứa câu hỏi trùng.");
    if (input.questionIds.some((questionId) => !this.questions.some((question) => question.id === questionId && question.status === "PUBLISHED" && question.courseId === classItem.courseId))) throw new BadRequestException("Đề chỉ được dùng câu hỏi đã xuất bản thuộc khóa học của lớp.");
    const item: LearningExam = { ...input, questionIds: orderedQuestionIds, id: id("exam"), status: "DRAFT", version: 1 };
    this.exams.unshift(item);
    return { ...item, questionIds: [...item.questionIds] };
  }

  async submitExamForReview(examId: string): Promise<LearningExam> {
    const prisma = this.database();
    if (prisma) {
      const exam = await this.getDatabaseExam(prisma, examId);
      if (!exam.questionIds.length) throw new BadRequestException("Đề cần ít nhất một câu hỏi.");
      if (exam.status !== "DRAFT") throw new ConflictException("Chỉ đề nháp mới được gửi duyệt.");
      await prisma.exam.update({ where: { id: examId }, data: { status: "PENDING_REVIEW" } });
      return this.getDatabaseExam(prisma, examId);
    }
    const item = this.findExam(examId);
    if (!item.questionIds.length) throw new BadRequestException("Đề cần ít nhất một câu hỏi.");
    if (item.status !== "DRAFT") throw new ConflictException("Chỉ đề nháp mới được gửi duyệt.");
    item.status = "PENDING_REVIEW";
    return { ...item, questionIds: [...item.questionIds] };
  }

  async reviewExam(examId: string, decision: ExamApprovalRecord["decision"], rawNote?: string, reviewerId = "usr-manager"): Promise<LearningExam> {
    const reviewNote = rawNote?.trim();
    if (decision === "RETURN" && (!reviewNote || reviewNote.length < 5)) throw new BadRequestException("Cần lý do ít nhất 5 ký tự khi trả lại đề.");
    const nextStatus: LearningExam["status"] = decision === "APPROVE" ? "PUBLISHED" : "DRAFT";
    const prisma = this.database();
    if (prisma) {
      return prisma.$transaction(async (transaction) => {
        const current = await transaction.exam.findUnique({ where: { id: examId } });
        if (!current) throw new NotFoundException("Không tìm thấy đề.");
        if (current.status !== "PENDING_REVIEW") throw new ConflictException("Đề không ở trạng thái chờ phê duyệt.");
        const approvalId = id("exam-approval");
        await transaction.examApproval.create({ data: { id: approvalId, examId, reviewerId, examVersion: current.version, decision, reviewNote } });
        await transaction.auditLog.create({ data: { actorId: reviewerId, action: `EXAM_${decision}`, entityType: "exam", entityId: examId, context: { version: current.version, reviewNote: reviewNote ?? "Đạt yêu cầu" } } });
        await transaction.notification.create({ data: { id: id("notification"), recipientId: "usr-instructor", type: "EXAM_REVIEWED", title: `Đề ${current.title}: ${decision}`, entityType: "EXAM", entityId: examId, dedupKey: `exam-review:${approvalId}:usr-instructor` } });
        await transaction.exam.update({ where: { id: examId }, data: { status: nextStatus } });
        return this.getDatabaseExam(transaction, examId);
      });
    }
    const item = this.findExam(examId);
    if (item.status !== "PENDING_REVIEW") throw new ConflictException("Đề không ở trạng thái chờ phê duyệt.");
    const approval: ExamApprovalRecord = { id: id("exam-approval"), examId, reviewerId, examVersion: item.version, decision, reviewNote, createdAt: now() };
    this.examApprovals.unshift(approval);
    item.status = nextStatus;
    this.notifications.unshift({ id: id("notification"), recipientId: "usr-instructor", type: "EXAM_REVIEWED", title: `Đề ${item.title}: ${decision}`, entityType: "EXAM", entityId: examId, createdAt: now() });
    return { ...item, questionIds: [...item.questionIds] };
  }

  async listExamApprovals(examId: string): Promise<ExamApprovalRecord[]> {
    const prisma = this.database();
    if (prisma) {
      const rows = await prisma.examApproval.findMany({ where: { examId }, orderBy: { createdAt: "desc" } });
      return rows.map((row) => ({ id: row.id, examId: row.examId, reviewerId: row.reviewerId, examVersion: row.examVersion, decision: row.decision === "APPROVE" ? "APPROVE" : "RETURN", reviewNote: row.reviewNote ?? undefined, createdAt: row.createdAt.toISOString() }));
    }
    return this.examApprovals.filter((item) => item.examId === examId).map((item) => ({ ...item }));
  }

  async startAttempt(examId: string, learnerId = "usr-learner"): Promise<ExamAttempt> {
    const prisma = this.database();
    if (prisma) {
      return prisma.$transaction(async (transaction) => {
        const exam = await transaction.exam.findUnique({
          where: { id: examId },
          include: { class: { include: { enrollments: { where: { learnerId, status: "ACTIVE" } } } } },
        });
        if (!exam) throw new NotFoundException("Không tìm thấy đề.");
        if (exam.status !== "PUBLISHED") throw new BadRequestException("Đề chưa được phát hành.");
        if (!exam.class.enrollments.length) throw new NotFoundException("Học viên không thuộc lớp được giao đề.");
        const timestamp = new Date();
        if (timestamp < exam.openAt || timestamp > exam.closeAt) throw new BadRequestException("Đề chưa mở hoặc đã đóng.");
        const attempts = await transaction.examAttempt.findMany({
          where: { examId, learnerId }, include: { answers: true }, orderBy: { attemptNo: "asc" },
        });
        const existing = attempts.find((item) => item.status === "IN_PROGRESS");
        if (existing) {
          if (this.attemptDeadline(existing.startedAt, exam.durationMinutes, exam.closeAt) <= timestamp) throw new BadRequestException("Lượt làm bài trước đã hết thời gian; cần nộp bài để hoàn tất.");
          return this.mapAttempt(existing);
        }
        if (attempts.length >= exam.attemptLimit) throw new BadRequestException("Đã hết số lần làm bài.");
        const created = await transaction.examAttempt.create({
          data: { id: id("attempt"), examId, learnerId, attemptNo: attempts.length + 1 },
          include: { answers: true },
        });
        return this.mapAttempt(created);
      });
    }
    const exam = this.findExam(examId);
    if (exam.status !== "PUBLISHED") throw new BadRequestException("Đề chưa được phát hành.");
    const timestamp = new Date();
    if (timestamp < new Date(exam.openAt) || timestamp > new Date(exam.closeAt)) throw new BadRequestException("Đề chưa mở hoặc đã đóng.");
    const classItem = this.findClass(exam.classId);
    if (!classItem.learnerIds.includes(learnerId)) throw new NotFoundException("Học viên không thuộc lớp được giao đề.");
    const attempts = this.attempts.filter((item) => item.examId === examId && item.learnerId === learnerId);
    const existing = attempts.find((item) => item.status === "IN_PROGRESS");
    if (existing) return { ...existing, answers: { ...existing.answers } };
    if (attempts.length >= exam.attemptLimit) throw new BadRequestException("Đã hết số lần làm bài.");
    const item: ExamAttempt = { id: id("attempt"), examId, learnerId, answers: {}, status: "IN_PROGRESS", startedAt: now() };
    this.attempts.push(item);
    return { ...item, answers: {} };
  }

  async saveAnswer(attemptId: string, questionId: string, answers: string[]): Promise<ExamAttempt> {
    const prisma = this.database();
    if (prisma) {
      const attempt = await prisma.examAttempt.findUnique({ where: { id: attemptId }, include: { exam: true } });
      if (!attempt) throw new NotFoundException("Không tìm thấy lượt làm bài.");
      if (attempt.status !== "IN_PROGRESS") throw new BadRequestException("Bài làm đã khóa.");
      if (this.attemptDeadline(attempt.startedAt, attempt.exam.durationMinutes, attempt.exam.closeAt) <= new Date()) throw new BadRequestException("Đã hết thời gian lưu câu trả lời.");
      const examQuestion = await prisma.examQuestion.findUnique({ where: { examId_questionId: { examId: attempt.examId, questionId } } });
      if (!examQuestion) throw new BadRequestException("Câu hỏi không thuộc đề.");
      await prisma.attemptAnswer.upsert({
        where: { attemptId_questionId: { attemptId, questionId } },
        update: { answerData: answers }, create: { attemptId, questionId, answerData: answers },
      });
      return this.getDatabaseAttempt(prisma, attemptId);
    }
    const item = this.findAttempt(attemptId);
    if (item.status !== "IN_PROGRESS") throw new BadRequestException("Bài làm đã khóa.");
    const exam = this.findExam(item.examId);
    if (this.attemptDeadline(new Date(item.startedAt), exam.durationMinutes, new Date(exam.closeAt)) <= new Date()) throw new BadRequestException("Đã hết thời gian lưu câu trả lời.");
    if (!exam.questionIds.includes(questionId)) throw new BadRequestException("Câu hỏi không thuộc đề.");
    item.answers[questionId] = [...answers];
    item.lastSavedAt = now();
    return { ...item, answers: { ...item.answers }, serverTime: now() };
  }

  async submitAttempt(attemptId: string): Promise<ExamAttempt> {
    const prisma = this.database();
    if (prisma) {
      return prisma.$transaction(async (transaction) => {
        const attempt = await transaction.examAttempt.findUnique({
          where: { id: attemptId },
          include: { answers: true, exam: { include: { questions: { include: { question: true } } } } },
        });
        if (!attempt) throw new NotFoundException("Không tìm thấy lượt làm bài.");
        if (attempt.status !== "IN_PROGRESS") throw new ConflictException("Bài đã được nộp trước đó.");
        let score = 0;
        let requiresManualGrade = false;
        for (const examQuestion of attempt.exam.questions) {
          const objective = !["SHORT_ANSWER", "ESSAY"].includes(examQuestion.question.type);
          if (!objective) {
            requiresManualGrade = true;
            continue;
          }
          const answer = attempt.answers.find((item) => item.questionId === examQuestion.questionId);
          const submitted = this.toStringArray(answer?.answerData ?? []);
          const expected = this.toStringArray(examQuestion.question.correctAnswers);
          const isCorrect = JSON.stringify([...submitted].sort()) === JSON.stringify([...expected].sort());
          const awarded = isCorrect ? Number(examQuestion.score) : 0;
          score += awarded;
          if (answer) await transaction.attemptAnswer.update({
            where: { attemptId_questionId: { attemptId, questionId: examQuestion.questionId } }, data: { score: awarded },
          });
        }
        const updated = await transaction.examAttempt.update({
          where: { id: attemptId },
          data: {
            score, submittedAt: new Date(), status: requiresManualGrade ? "SUBMITTED" : "GRADED",
            gradePublishedAt: requiresManualGrade ? null : new Date(),
            feedback: requiresManualGrade ? "Bài đang chờ giảng viên chấm câu tự luận." : "Bài đã được chấm tự động. Giảng viên có thể bổ sung nhận xét.",
          },
          include: { answers: true },
        });
        return this.mapAttempt(updated);
      });
    }
    const item = this.findAttempt(attemptId);
    if (item.status !== "IN_PROGRESS") throw new ConflictException("Bài đã được nộp trước đó.");
    const exam = this.findExam(item.examId);
    let correct = 0;
    exam.questionIds.forEach((questionId) => {
      const question = this.questions.find((candidate) => candidate.id === questionId);
      if (question && JSON.stringify([...(item.answers[questionId] ?? [])].sort()) === JSON.stringify([...question.correctAnswers].sort())) correct += 1;
    });
    item.score = Math.round((correct / exam.questionIds.length) * exam.totalScore * 100) / 100;
    item.status = "GRADED";
    item.submittedAt = now();
    item.submissionReceipt = this.submissionReceipt(item.id, item.submittedAt);
    item.gradePublishedAt = now();
    item.feedback = "Bài đã được chấm tự động. Giảng viên có thể bổ sung nhận xét.";
    return { ...item, answers: { ...item.answers } };
  }

  async getAttempt(attemptId: string): Promise<ExamAttempt> {
    const prisma = this.database();
    if (prisma) return this.getDatabaseAttempt(prisma, attemptId);
    const item = this.findAttempt(attemptId);
    return { ...item, answers: { ...item.answers } };
  }

  async listLearnerResults(learnerId = "usr-learner"): Promise<LearnerResult[]> {
    const prisma = this.database();
    if (prisma) {
      const rows = await prisma.examAttempt.findMany({
        where: { learnerId, status: "GRADED", gradePublishedAt: { not: null } },
        include: {
          answers: true,
          exam: { include: { questions: { include: { question: true }, orderBy: { position: "asc" } } } },
          regradeRequests: { where: { learnerId }, orderBy: { createdAt: "desc" }, take: 1 },
        },
        orderBy: { gradePublishedAt: "desc" },
      });
      return rows.map((row) => ({
        attempt: this.mapAttempt(row),
        exam: { id: row.exam.id, title: row.exam.title, totalScore: Number(row.exam.totalScore), closeAt: row.exam.closeAt.toISOString() },
        answerBreakdown: row.exam.questions.map((examQuestion) => {
          const answer = row.answers.find((item) => item.questionId === examQuestion.questionId);
          return {
            questionId: examQuestion.questionId,
            content: examQuestion.question.content,
            submittedAnswers: this.toStringArray(answer?.answerData ?? []),
            awardedScore: Number(answer?.score ?? 0),
            maxScore: Number(examQuestion.score),
          };
        }),
        regradeRequest: row.regradeRequests[0] ? this.mapRegradeRequest(row.regradeRequests[0]) : undefined,
      }));
    }
    return this.attempts
      .filter((attempt) => attempt.learnerId === learnerId && attempt.status === "GRADED" && attempt.gradePublishedAt)
      .sort((left, right) => (right.gradePublishedAt ?? "").localeCompare(left.gradePublishedAt ?? ""))
      .map((attempt) => {
        const exam = this.findExam(attempt.examId);
        const scorePerQuestion = exam.totalScore / exam.questionIds.length;
        return {
          attempt: { ...attempt, answers: structuredClone(attempt.answers) },
          exam: { id: exam.id, title: exam.title, totalScore: exam.totalScore, closeAt: exam.closeAt },
          answerBreakdown: exam.questionIds.map((questionId) => ({
            questionId,
            content: this.questions.find((question) => question.id === questionId)?.content ?? "Câu hỏi không còn tồn tại",
            submittedAnswers: [...(attempt.answers[questionId] ?? [])],
            awardedScore: this.isMemoryAnswerCorrect(questionId, attempt.answers[questionId] ?? []) ? scorePerQuestion : 0,
            maxScore: scorePerQuestion,
          })),
          regradeRequest: this.regradeRequests.find((request) => request.attemptId === attempt.id && request.learnerId === learnerId),
        };
      });
  }

  async getLearnerResult(attemptId: string, learnerId = "usr-learner"): Promise<LearnerResult> {
    const result = (await this.listLearnerResults(learnerId)).find((item) => item.attempt.id === attemptId);
    if (!result) throw new NotFoundException("Kết quả chưa được công bố hoặc không thuộc học viên hiện tại.");
    return result;
  }

  async requestRegrade(attemptId: string, reason: string, learnerId = "usr-learner"): Promise<RegradeRequest> {
    const normalizedReason = reason.trim();
    if (normalizedReason.length < 10) throw new BadRequestException("Lý do phúc khảo cần ít nhất 10 ký tự.");
    const prisma = this.database();
    if (prisma) {
      const attempt = await prisma.examAttempt.findFirst({
        where: { id: attemptId, learnerId, status: "GRADED", gradePublishedAt: { not: null } },
        include: { regradeRequests: { where: { learnerId, status: { in: ["OPEN", "IN_REVIEW"] } } } },
      });
      if (!attempt?.gradePublishedAt) throw new NotFoundException("Không tìm thấy kết quả được phép phúc khảo.");
      if (Date.now() > attempt.gradePublishedAt.getTime() + 7 * 86_400_000) throw new BadRequestException("Đã hết hạn phúc khảo 7 ngày.");
      if (attempt.regradeRequests.length) throw new ConflictException("Đã có yêu cầu phúc khảo đang được xử lý.");
      return this.mapRegradeRequest(await prisma.regradeRequest.create({
        data: { id: id("regrade"), attemptId, learnerId, reason: normalizedReason },
      }));
    }
    const attempt = this.attempts.find((item) => item.id === attemptId && item.learnerId === learnerId && item.status === "GRADED" && item.gradePublishedAt);
    if (!attempt?.gradePublishedAt) throw new NotFoundException("Không tìm thấy kết quả được phép phúc khảo.");
    if (Date.now() > new Date(attempt.gradePublishedAt).getTime() + 7 * 86_400_000) throw new BadRequestException("Đã hết hạn phúc khảo 7 ngày.");
    if (this.regradeRequests.some((item) => item.attemptId === attemptId && ["OPEN", "IN_REVIEW"].includes(item.status))) throw new ConflictException("Đã có yêu cầu phúc khảo đang được xử lý.");
    const request: RegradeRequest = { id: id("regrade"), attemptId, learnerId, reason: normalizedReason, status: "OPEN", createdAt: now() };
    this.regradeRequests.unshift(request);
    return { ...request };
  }

  async listAttempts(examId?: string): Promise<ExamAttempt[]> {
    const prisma = this.database();
    if (prisma) {
      const rows = await prisma.examAttempt.findMany({
        where: examId ? { examId } : undefined, include: { answers: true }, orderBy: { startedAt: "desc" },
      });
      return rows.map((row) => this.mapAttempt(row));
    }
    return this.attempts.filter((item) => !examId || item.examId === examId).map((item) => ({ ...item, answers: { ...item.answers } }));
  }

  async gradeAttempt(attemptId: string, score: number, feedback: string, correctionReason?: string, graderId = "usr-instructor"): Promise<ExamAttempt> {
    const prisma = this.database();
    if (prisma) {
      const attempt = await prisma.examAttempt.findUnique({ where: { id: attemptId }, include: { exam: true } });
      if (!attempt) throw new NotFoundException("Không tìm thấy lượt làm bài.");
      if (score > Number(attempt.exam.totalScore)) throw new BadRequestException("Điểm không được vượt tổng điểm của đề.");
      const reason = attempt.score === null ? "Chấm lần đầu" : correctionReason?.trim();
      if (attempt.score !== null && (!reason || reason.length < 5)) throw new BadRequestException("Sửa điểm cần lý do ít nhất 5 ký tự.");
      return prisma.$transaction(async (transaction) => {
        await transaction.gradeHistory.create({ data: { id: id("grade-history"), attemptId, graderId, previousScore: attempt.score, nextScore: score, reason: reason! } });
        return this.mapAttempt(await transaction.examAttempt.update({ where: { id: attemptId }, data: { score, feedback: feedback.trim(), status: "GRADED", gradePublishedAt: new Date() }, include: { answers: true } }));
      });
    }
    const item = this.findAttempt(attemptId);
    const exam = this.findExam(item.examId);
    if (score > exam.totalScore) throw new BadRequestException("Điểm không được vượt tổng điểm của đề.");
    const reason = item.score === undefined ? "Chấm lần đầu" : correctionReason?.trim();
    if (item.score !== undefined && (!reason || reason.length < 5)) throw new BadRequestException("Sửa điểm cần lý do ít nhất 5 ký tự.");
    this.gradeHistory.unshift({ id: id("grade-history"), attemptId, graderId, previousScore: item.score, nextScore: score, reason: reason!, createdAt: now() });
    item.score = score;
    item.feedback = feedback.trim();
    item.status = "GRADED";
    item.gradePublishedAt = now();
    return { ...item, answers: { ...item.answers } };
  }

  async listGradeHistory(attemptId: string): Promise<GradeHistoryRecord[]> {
    const prisma = this.database();
    if (prisma) {
      const rows = await prisma.gradeHistory.findMany({ where: { attemptId }, orderBy: { createdAt: "desc" } });
      return rows.map((row) => ({ id: row.id, attemptId: row.attemptId, graderId: row.graderId, previousScore: row.previousScore === null ? undefined : Number(row.previousScore), nextScore: Number(row.nextScore), reason: row.reason, createdAt: row.createdAt.toISOString() }));
    }
    return this.gradeHistory.filter((item) => item.attemptId === attemptId).map((item) => ({ ...item }));
  }

  async listTopics(role = "LEARNER"): Promise<ForumTopic[]> {
    const prisma = this.database();
    if (prisma) {
      const rows = await prisma.forumTopic.findMany({
        where: role === "LEARNER"
          ? { status: "PUBLISHED", class: { enrollments: { some: { learnerId: "usr-learner", status: "ACTIVE" } } } }
          : role === "INSTRUCTOR"
            ? { class: { instructors: { some: { instructorId: "usr-instructor" } } } }
            : undefined,
        orderBy: [{ isPinned: "desc" }, { createdAt: "desc" }],
      });
      return rows.map((row) => this.mapTopic(row));
    }
    return this.topics.filter((item) => {
      const classItem = this.classes.find((candidate) => candidate.id === item.classId);
      if (role === "LEARNER") return item.status === "VISIBLE" && classItem?.learnerIds.includes("usr-learner");
      if (role === "INSTRUCTOR") return classItem?.instructorIds.includes("usr-instructor");
      return true;
    }).map((item) => ({ ...item, tags: [...item.tags] }));
  }

  async createTopic(
    classId: string,
    input: Pick<ForumTopic, "title" | "body" | "tags" | "isPinned">,
    authorId = "usr-instructor",
  ): Promise<ForumTopic> {
    const safeTitle = this.validateForumContent(input.title, "Tiêu đề");
    const safeBody = this.validateForumContent(input.body, "Nội dung");
    const prisma = this.database();
    if (prisma) {
      const classItem = await prisma.learningClass.findUnique({
        where: { id: classId }, include: { enrollments: true, instructors: true },
      });
      if (!classItem) throw new NotFoundException("Không tìm thấy lớp học.");
      if (classItem.status === "CLOSED") throw new ConflictException("Lớp đã lưu trữ và chỉ cho phép đọc.");
      if (authorId === "usr-learner" && !classItem.enrollments.some((item) => item.learnerId === authorId && item.status === "ACTIVE")) throw new NotFoundException("Học viên không thuộc lớp này.");
      if (authorId === "usr-instructor" && !classItem.instructors.some((item) => item.instructorId === authorId)) throw new NotFoundException("Giảng viên chưa được phân công vào lớp này.");
      await this.enforceForumPolicy(prisma, authorId, `${safeTitle} ${safeBody}`);
      const created = await prisma.forumTopic.create({
        data: {
          id: id("topic"), classId, authorId, title: safeTitle, body: safeBody,
          tags: input.tags, isPinned: input.isPinned,
        },
      });
      await this.notifyClassMembers(prisma, classId, "FORUM_TOPIC_CREATED", `Chủ đề mới: ${created.title}`, created.id);
      return this.mapTopic(created);
    }
    const classItem = this.findClass(classId);
    if (classItem.status === "CLOSED") throw new ConflictException("Lớp đã lưu trữ và chỉ cho phép đọc.");
    if (authorId === "usr-learner" && !classItem.learnerIds.includes(authorId)) throw new NotFoundException("Học viên không thuộc lớp này.");
    if (authorId === "usr-instructor" && !classItem.instructorIds.includes(authorId)) throw new NotFoundException("Giảng viên chưa được phân công vào lớp này.");
    this.enforceMemoryForumPolicy(authorId, `${safeTitle} ${safeBody}`);
    const item: ForumTopic = { ...input, title: safeTitle, body: safeBody, id: id("topic"), classId, authorId, isLocked: false, status: "VISIBLE", createdAt: now() };
    this.topics.unshift(item);
    for (const recipientId of new Set([...classItem.learnerIds, ...classItem.instructorIds])) if (recipientId !== authorId) this.notifications.unshift({ id: id("notification"), recipientId, type: "FORUM_TOPIC_CREATED", title: `Chủ đề mới: ${item.title}`, entityType: "FORUM_TOPIC", entityId: item.id, createdAt: now() });
    return { ...item, tags: [...item.tags] };
  }

  async moderateTopic(topicId: string, input: { isLocked?: boolean; isPinned?: boolean; reason: string }, actorId = "usr-instructor"): Promise<ForumTopic> {
    const reason = input.reason.trim();
    if (reason.length < 5) throw new BadRequestException("Lý do điều phối cần ít nhất 5 ký tự.");
    if (input.isLocked === undefined && input.isPinned === undefined) throw new BadRequestException("Cần chọn trạng thái khóa hoặc ghim cần thay đổi.");
    const prisma = this.database();
    if (prisma) {
      return prisma.$transaction(async (transaction) => {
        const current = await transaction.forumTopic.findFirst({ where: { id: topicId, class: { instructors: { some: { instructorId: actorId } } } } });
        if (!current) throw new NotFoundException("Không tìm thấy chủ đề được phép điều phối.");
        const updated = await transaction.forumTopic.update({ where: { id: topicId }, data: { isLocked: input.isLocked, isPinned: input.isPinned } });
        await transaction.auditLog.create({ data: { actorId, action: "FORUM_TOPIC_MODERATED", entityType: "forum_topic", entityId: topicId, context: { reason, before: { isLocked: current.isLocked, isPinned: current.isPinned }, after: { isLocked: updated.isLocked, isPinned: updated.isPinned } } } });
        return this.mapTopic(updated);
      });
    }
    const current = this.findTopic(topicId);
    if (!this.findClass(current.classId).instructorIds.includes(actorId)) throw new NotFoundException("Không tìm thấy chủ đề được phép điều phối.");
    if (input.isLocked !== undefined) current.isLocked = input.isLocked;
    if (input.isPinned !== undefined) current.isPinned = input.isPinned;
    return { ...current, tags: [...current.tags] };
  }

  async listPosts(topicId: string, role = "LEARNER"): Promise<ForumPost[]> {
    const prisma = this.database();
    if (prisma) {
      const topic = await prisma.forumTopic.findUnique({ where: { id: topicId }, include: { class: { include: { enrollments: true, instructors: true } } } });
      if (!topic) throw new NotFoundException("Không tìm thấy chủ đề.");
      if (role === "LEARNER" && topic.status !== "PUBLISHED") throw new NotFoundException("Không tìm thấy chủ đề trong lớp đã ghi danh.");
      this.assertForumClassAccess(topic.class, role);
      const rows = await prisma.forumPost.findMany({ where: { topicId }, include: { attachments: true, mentions: true }, orderBy: { createdAt: "asc" } });
      return rows.map((row) => this.mapPost(row));
    }
    const topic = this.findTopic(topicId);
    if (role === "LEARNER" && topic.status !== "VISIBLE") throw new NotFoundException("Không tìm thấy chủ đề trong lớp đã ghi danh.");
    this.assertMemoryForumClassAccess(topic.classId, role);
    return this.posts.filter((item) => item.topicId === topicId).map((item) => ({
      ...item,
      body: item.status === "HIDDEN" ? "[Nội dung đã bị ẩn]" : item.body,
      attachmentIds: item.status === "HIDDEN" ? [] : [...item.attachmentIds],
      mentionedUserIds: item.status === "HIDDEN" ? [] : [...item.mentionedUserIds],
    }));
  }

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
    const mentionedUserIds = [...new Set(rawMentionedUserIds)].filter((userId) => userId !== authorId);
    if (attachmentIds.length > 5) throw new BadRequestException("Mỗi phản hồi chỉ được đính kèm tối đa 5 tệp.");
    if (mentionedUserIds.length > 10) throw new BadRequestException("Mỗi phản hồi chỉ được nhắc tối đa 10 thành viên.");
    const prisma = this.database();
    if (prisma) {
      const topic = await prisma.forumTopic.findUnique({ where: { id: topicId }, include: { class: { include: { enrollments: true, instructors: true } } } });
      if (!topic) throw new NotFoundException("Không tìm thấy chủ đề.");
      if (topic.isLocked) throw new BadRequestException("Chủ đề đã khóa.");
      if (topic.class.status === "CLOSED") throw new ConflictException("Lớp đã lưu trữ và chỉ cho phép đọc.");
      if (!topic.class.enrollments.some((item) => item.learnerId === authorId && item.status === "ACTIVE")) throw new NotFoundException("Học viên không thuộc lớp của chủ đề.");
      await this.enforceForumPolicy(prisma, authorId, safeBody);
      if (parentId) {
        const parent = await prisma.forumPost.findFirst({ where: { id: parentId, topicId }, include: { parent: { include: { parent: true } } } });
        if (!parent) throw new BadRequestException("Bài cha không hợp lệ.");
        if (parent.parent?.parentId) throw new BadRequestException("Phản hồi chỉ được lồng tối đa 2 cấp.");
      }
      const validAttachments = attachmentIds.length
        ? await prisma.material.findMany({ where: { id: { in: attachmentIds }, classId: topic.classId, visibility: "PUBLISHED" }, select: { id: true } })
        : [];
      if (validAttachments.length !== attachmentIds.length) throw new BadRequestException("Tệp đính kèm phải thuộc lớp và đã được phát hành.");
      const validMentions = mentionedUserIds.length
        ? await prisma.user.findMany({
            where: {
              id: { in: mentionedUserIds },
              OR: [
                { enrollments: { some: { classId: topic.classId, status: "ACTIVE" } } },
                { instructedClasses: { some: { classId: topic.classId } } },
              ],
            },
            select: { id: true },
          })
        : [];
      if (validMentions.length !== mentionedUserIds.length) throw new BadRequestException("Chỉ được nhắc thành viên đang thuộc lớp.");
      return prisma.$transaction(async (transaction) => {
        const postId = id("post");
        const post = await transaction.forumPost.create({
          data: {
            id: postId,
            topicId,
            authorId,
            body: safeBody,
            parentId,
            attachments: { create: attachmentIds.map((materialId) => ({ materialId })) },
            mentions: { create: mentionedUserIds.map((mentionedUserId) => ({ mentionedUserId })) },
          },
          include: { attachments: true, mentions: true },
        });
        if (mentionedUserIds.length) {
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
    if (this.findClass(topic.classId).status === "CLOSED") throw new ConflictException("Lớp đã lưu trữ và chỉ cho phép đọc.");
    const classItem = this.findClass(topic.classId);
    if (!classItem.learnerIds.includes(authorId)) throw new NotFoundException("Học viên không thuộc lớp của chủ đề.");
    this.enforceMemoryForumPolicy(authorId, safeBody);
    const parent = parentId ? this.posts.find((item) => item.id === parentId && item.topicId === topicId) : undefined;
    if (parentId && !parent) throw new BadRequestException("Bài cha không hợp lệ.");
    if (parent?.parentId && this.posts.find((item) => item.id === parent.parentId)?.parentId) throw new BadRequestException("Phản hồi chỉ được lồng tối đa 2 cấp.");
    if (attachmentIds.some((materialId) => !this.materials.some((item) => item.id === materialId && item.classId === topic.classId && item.visibility === "PUBLISHED"))) {
      throw new BadRequestException("Tệp đính kèm phải thuộc lớp và đã được phát hành.");
    }
    const classMembers = new Set([...classItem.learnerIds, ...classItem.instructorIds]);
    if (mentionedUserIds.some((userId) => !classMembers.has(userId))) throw new BadRequestException("Chỉ được nhắc thành viên đang thuộc lớp.");
    const item: ForumPost = { id: id("post"), topicId, authorId, body: safeBody, parentId, status: "VISIBLE", attachmentIds, mentionedUserIds, createdAt: now() };
    this.posts.push(item);
    for (const recipientId of mentionedUserIds) {
      if (!this.notifications.some((notification) => notification.entityId === item.id && notification.recipientId === recipientId)) {
        this.notifications.unshift({ id: id("notification"), recipientId, type: "FORUM_MENTION", title: `Bạn được nhắc trong chủ đề ${topic.title}`, entityType: "FORUM_POST", entityId: item.id, createdAt: now() });
      }
    }
    return { ...item, attachmentIds: [...item.attachmentIds], mentionedUserIds: [...item.mentionedUserIds] };
  }

  async updatePost(postId: string, body: string, authorId = "usr-learner"): Promise<ForumPost> {
    const safeBody = this.validateForumContent(body, "Nội dung phản hồi");
    const prisma = this.database();
    if (prisma) {
      const current = await prisma.forumPost.findFirst({ where: { id: postId, authorId }, include: { topic: true, attachments: true, mentions: true } });
      if (!current) throw new NotFoundException("Không tìm thấy phản hồi được phép sửa.");
      if (current.deletedAt || current.status !== "PUBLISHED") throw new ConflictException("Phản hồi đã bị xóa hoặc ẩn.");
      if (current.topic.isLocked) throw new ConflictException("Chủ đề đã khóa.");
      const history = Array.isArray(current.editHistory) ? current.editHistory : [];
      return this.mapPost(await prisma.forumPost.update({ where: { id: postId }, data: { body: safeBody, editedAt: new Date(), editHistory: [...history, { body: current.body, editedAt: new Date().toISOString() }] }, include: { attachments: true, mentions: true } }));
    }
    const current = this.posts.find((item) => item.id === postId && item.authorId === authorId);
    if (!current) throw new NotFoundException("Không tìm thấy phản hồi được phép sửa.");
    if (current.deletedAt || current.status !== "VISIBLE") throw new ConflictException("Phản hồi đã bị xóa hoặc ẩn.");
    if (this.findTopic(current.topicId).isLocked) throw new ConflictException("Chủ đề đã khóa.");
    current.body = safeBody; current.editedAt = now(); current.editCount = (current.editCount ?? 0) + 1;
    return { ...current, attachmentIds: [...current.attachmentIds], mentionedUserIds: [...current.mentionedUserIds] };
  }

  async deletePost(postId: string, authorId = "usr-learner"): Promise<ForumPost> {
    const prisma = this.database();
    if (prisma) {
      const current = await prisma.forumPost.findFirst({ where: { id: postId, authorId }, include: { topic: true, attachments: true, mentions: true } });
      if (!current) throw new NotFoundException("Không tìm thấy phản hồi được phép xóa.");
      if (current.topic.isLocked) throw new ConflictException("Chủ đề đã khóa.");
      if (current.deletedAt) return this.mapPost(current);
      return this.mapPost(await prisma.forumPost.update({ where: { id: postId }, data: { status: "ARCHIVED", deletedAt: new Date() }, include: { attachments: true, mentions: true } }));
    }
    const current = this.posts.find((item) => item.id === postId && item.authorId === authorId);
    if (!current) throw new NotFoundException("Không tìm thấy phản hồi được phép xóa.");
    if (this.findTopic(current.topicId).isLocked) throw new ConflictException("Chủ đề đã khóa.");
    current.status = "HIDDEN"; current.deletedAt ??= now();
    return { ...current, body: "[Nội dung đã bị xóa]", attachmentIds: [], mentionedUserIds: [] };
  }

  async hidePost(postId: string, rawReason: string, actorId = "usr-instructor"): Promise<ForumPost> {
    const reason = rawReason.trim();
    if (reason.length < 5) throw new BadRequestException("Lý do ẩn cần ít nhất 5 ký tự.");
    const prisma = this.database();
    if (prisma) {
      return prisma.$transaction(async (transaction) => {
        const current = await transaction.forumPost.findFirst({ where: { id: postId, topic: { class: { instructors: { some: { instructorId: actorId } } } } }, include: { attachments: true, mentions: true } });
        if (!current) throw new NotFoundException("Không tìm thấy phản hồi được phép kiểm duyệt.");
        const updated = await transaction.forumPost.update({ where: { id: postId }, data: { status: "ARCHIVED" }, include: { attachments: true, mentions: true } });
        await transaction.auditLog.create({ data: { actorId, action: "FORUM_POST_HIDDEN", entityType: "forum_post", entityId: postId, context: { reason, authorId: current.authorId } } });
        return this.mapPost(updated);
      });
    }
    const current = this.findPost(postId);
    if (!this.findClass(this.findTopic(current.topicId).classId).instructorIds.includes(actorId)) throw new NotFoundException("Không tìm thấy phản hồi được phép kiểm duyệt.");
    current.status = "HIDDEN";
    return { ...current, body: "[Nội dung đã bị ẩn]", attachmentIds: [], mentionedUserIds: [] };
  }

  async listNotifications(recipientId = "usr-learner"): Promise<LearningNotification[]> {
    const prisma = this.database();
    if (prisma) {
      const rows = await prisma.notification.findMany({ where: { recipientId }, orderBy: { createdAt: "desc" }, take: 50 });
      return rows.map((row) => ({ id: row.id, recipientId: row.recipientId, type: row.type, title: row.title, entityType: row.entityType, entityId: row.entityId, readAt: row.readAt?.toISOString(), createdAt: row.createdAt.toISOString() }));
    }
    return this.notifications.filter((item) => item.recipientId === recipientId).map((item) => ({ ...item }));
  }

  async markNotificationRead(notificationId: string, recipientId = "usr-learner"): Promise<LearningNotification> {
    const prisma = this.database();
    if (prisma) {
      const existing = await prisma.notification.findFirst({ where: { id: notificationId, recipientId } });
      if (!existing) throw new NotFoundException("Không tìm thấy thông báo.");
      const row = await prisma.notification.update({ where: { id: notificationId }, data: { readAt: existing.readAt ?? new Date() } });
      return { id: row.id, recipientId: row.recipientId, type: row.type, title: row.title, entityType: row.entityType, entityId: row.entityId, readAt: row.readAt?.toISOString(), createdAt: row.createdAt.toISOString() };
    }
    const item = this.notifications.find((notification) => notification.id === notificationId && notification.recipientId === recipientId);
    if (!item) throw new NotFoundException("Không tìm thấy thông báo.");
    item.readAt ??= now();
    return { ...item };
  }

  async reportContent(input: Pick<ContentReport, "targetType" | "targetId" | "reporterId" | "reason" | "details">): Promise<ContentReport> {
    const prisma = this.database();
    if (prisma) {
      const targetExists = input.targetType === "POST"
        ? Boolean(await prisma.forumPost.findFirst({ where: { id: input.targetId, topic: { class: { enrollments: { some: { learnerId: input.reporterId, status: "ACTIVE" } } } } }, select: { id: true } }))
        : Boolean(await prisma.forumTopic.findFirst({ where: { id: input.targetId, class: { enrollments: { some: { learnerId: input.reporterId, status: "ACTIVE" } } } }, select: { id: true } }));
      if (!targetExists) throw new NotFoundException("Không tìm thấy nội dung cần báo cáo.");
      try {
        return this.mapReport(await prisma.contentReport.create({
          data: { id: id("report"), ...input }, include: { actions: true },
        }));
      } catch (error) {
        if (isUniqueConstraintError(error)) throw new ConflictException("Bạn đã báo cáo nội dung này.");
        throw error;
      }
    }
    const targetClassId = input.targetType === "TOPIC"
      ? this.topics.find((item) => item.id === input.targetId)?.classId
      : this.topics.find((topic) => topic.id === this.posts.find((post) => post.id === input.targetId)?.topicId)?.classId;
    if (!targetClassId || !this.findClass(targetClassId).learnerIds.includes(input.reporterId)) throw new NotFoundException("Không tìm thấy nội dung trong lớp đã ghi danh.");
    if (this.reports.some((item) => item.targetId === input.targetId && item.reporterId === input.reporterId && item.status === "OPEN")) throw new ConflictException("Bạn đã báo cáo nội dung này.");
    const timestamp = now();
    const item: ContentReport = { ...input, id: id("report"), status: "OPEN", escalationLevel: 0, createdAt: timestamp, updatedAt: timestamp, actions: [] };
    this.reports.unshift(item);
    return { ...item };
  }

  async listReports(): Promise<ContentReport[]> {
    const prisma = this.database();
    if (prisma) {
      const rows = await prisma.contentReport.findMany({ include: { actions: { orderBy: { createdAt: "asc" } } }, orderBy: { createdAt: "desc" } });
      return rows.map((row) => this.mapReport(row));
    }
    return this.reports.map((item) => ({ ...item }));
  }

  async listLearnerReports(learnerId = "usr-learner"): Promise<ContentReport[]> {
    const prisma = this.database();
    if (prisma) {
      const rows = await prisma.contentReport.findMany({ where: { reporterId: learnerId }, include: { actions: { orderBy: { createdAt: "asc" } } }, orderBy: { createdAt: "desc" } });
      return rows.map((row) => this.mapReport(row));
    }
    return this.reports.filter((item) => item.reporterId === learnerId).map((item) => ({ ...item }));
  }

  async getReportContext(reportId: string): Promise<ModerationContext> {
    const prisma = this.database();
    if (prisma) {
      const report = await prisma.contentReport.findUnique({ where: { id: reportId }, include: { actions: { orderBy: { createdAt: "asc" } } } });
      if (!report) throw new NotFoundException("Không tìm thấy báo cáo.");
      if (report.targetType === "TOPIC") {
        const topic = await prisma.forumTopic.findUnique({ where: { id: report.targetId }, include: { posts: { orderBy: { createdAt: "asc" }, take: 20 } } });
        if (!topic) throw new NotFoundException("Nội dung báo cáo không còn tồn tại.");
        return { report: this.mapReport(report), classId: topic.classId, topicTitle: topic.title, targetAuthorId: topic.authorId, targetBody: topic.body, surroundingPosts: topic.posts.map((post) => ({ id: post.id, authorId: post.authorId, body: post.body, createdAt: post.createdAt.toISOString() })) };
      }
      const post = await prisma.forumPost.findUnique({ where: { id: report.targetId }, include: { topic: { include: { posts: { orderBy: { createdAt: "asc" }, take: 20 } } } } });
      if (!post) throw new NotFoundException("Nội dung báo cáo không còn tồn tại.");
      return { report: this.mapReport(report), classId: post.topic.classId, topicTitle: post.topic.title, targetAuthorId: post.authorId, targetBody: post.body, surroundingPosts: post.topic.posts.map((item) => ({ id: item.id, authorId: item.authorId, body: item.body, createdAt: item.createdAt.toISOString() })) };
    }
    const report = this.findReport(reportId);
    const topic = report.targetType === "TOPIC" ? this.findTopic(report.targetId) : this.findTopic(this.findPost(report.targetId).topicId);
    const target = report.targetType === "TOPIC" ? { authorId: topic.authorId, body: topic.body } : this.findPost(report.targetId);
    return { report: { ...report, actions: report.actions.map((action) => ({ ...action })) }, classId: topic.classId, topicTitle: topic.title, targetAuthorId: target.authorId, targetBody: target.body, surroundingPosts: this.posts.filter((post) => post.topicId === topic.id).map((post) => ({ id: post.id, authorId: post.authorId, body: post.body, createdAt: post.createdAt })) };
  }

  async claimReport(reportId: string, moderatorId = "usr-manager"): Promise<ContentReport> {
    const prisma = this.database();
    if (prisma) {
      return prisma.$transaction(async (transaction) => {
        const current = await transaction.contentReport.findUnique({ where: { id: reportId } });
        if (!current) throw new NotFoundException("Không tìm thấy báo cáo.");
        if (current.status === "IN_REVIEW" && current.assignedToId === moderatorId) return this.mapReport(await transaction.contentReport.findUniqueOrThrow({ where: { id: reportId }, include: { actions: { orderBy: { createdAt: "asc" } } } }));
        if (current.status !== "OPEN") throw new ConflictException("Chỉ báo cáo đang mở mới có thể nhận xử lý.");
        await transaction.moderationAction.create({ data: { id: id("mod-action"), reportId, actorId: moderatorId, action: "CLAIM", reason: "Nhận xử lý báo cáo", previousStatus: current.status, nextStatus: "IN_REVIEW" } });
        await transaction.auditLog.create({ data: { actorId: moderatorId, action: "FORUM_REPORT_CLAIM", entityType: "content_report", entityId: reportId, context: { previousStatus: current.status, nextStatus: "IN_REVIEW" } } });
        return this.mapReport(await transaction.contentReport.update({ where: { id: reportId }, data: { status: "IN_REVIEW", assignedToId: moderatorId }, include: { actions: { orderBy: { createdAt: "asc" } } } }));
      });
    }
    const current = this.findReport(reportId);
    if (current.status === "IN_REVIEW" && current.assignedToId === moderatorId) return { ...current, actions: current.actions.map((action) => ({ ...action })) };
    if (current.status !== "OPEN") throw new ConflictException("Chỉ báo cáo đang mở mới có thể nhận xử lý.");
    this.recordMemoryModeration(current, moderatorId, "CLAIM", "Nhận xử lý báo cáo", "IN_REVIEW");
    current.assignedToId = moderatorId;
    return { ...current, actions: current.actions.map((action) => ({ ...action })) };
  }

  async resolveReport(reportId: string, action: "HIDE_CONTENT" | "KEEP_CONTENT" | "ESCALATE_ADMIN", resolution: string, moderatorId = "usr-manager"): Promise<ContentReport> {
    const normalizedResolution = resolution.trim();
    if (normalizedResolution.length < 3) throw new BadRequestException("Lý do xử lý phải có ít nhất 3 ký tự.");
    const nextStatus = action === "HIDE_CONTENT" ? "RESOLVED" : action === "KEEP_CONTENT" ? "REJECTED" : "ESCALATED";
    const prisma = this.database();
    if (prisma) {
      return prisma.$transaction(async (transaction) => {
        const item = await transaction.contentReport.findUnique({ where: { id: reportId } });
        if (!item) throw new NotFoundException("Không tìm thấy báo cáo.");
        if (!["OPEN", "IN_REVIEW"].includes(item.status)) throw new ConflictException("Báo cáo đã được xử lý hoặc chuyển cấp.");
        if (item.assignedToId && item.assignedToId !== moderatorId) throw new ConflictException("Báo cáo đang do quản lý khác xử lý.");
        let targetAuthorId: string | undefined;
        if (item.targetType === "POST") {
          targetAuthorId = (await transaction.forumPost.findUnique({ where: { id: item.targetId }, select: { authorId: true } }))?.authorId;
        } else {
          targetAuthorId = (await transaction.forumTopic.findUnique({ where: { id: item.targetId }, select: { authorId: true } }))?.authorId;
        }
        if (!targetAuthorId) throw new NotFoundException("Nội dung báo cáo không còn tồn tại.");
        if (action === "HIDE_CONTENT" && item.targetType === "POST") {
          await transaction.forumPost.updateMany({ where: { id: item.targetId }, data: { status: "ARCHIVED" } });
        }
        if (action === "HIDE_CONTENT" && item.targetType === "TOPIC") await transaction.forumTopic.updateMany({ where: { id: item.targetId }, data: { status: "ARCHIVED", isLocked: true } });
        if (action === "KEEP_CONTENT" && item.targetType === "POST") await transaction.forumPost.updateMany({ where: { id: item.targetId }, data: { status: "PUBLISHED" } });
        if (action === "KEEP_CONTENT" && item.targetType === "TOPIC") await transaction.forumTopic.updateMany({ where: { id: item.targetId }, data: { status: "PUBLISHED", isLocked: false } });
        await transaction.moderationAction.create({ data: { id: id("mod-action"), reportId, actorId: moderatorId, action, reason: normalizedResolution, previousStatus: item.status, nextStatus } });
        await transaction.auditLog.create({ data: { actorId: moderatorId, action: `FORUM_REPORT_${action}`, entityType: "content_report", entityId: reportId, context: { targetType: item.targetType, targetId: item.targetId, previousStatus: item.status, nextStatus, resolution: normalizedResolution } } });
        const recipients = [...new Set([item.reporterId, targetAuthorId, action === "ESCALATE_ADMIN" ? "usr-admin" : undefined].filter((value): value is string => Boolean(value)))];
        await transaction.notification.createMany({ data: recipients.map((recipientId) => ({ id: id("notification"), recipientId, type: "FORUM_MODERATION", title: action === "ESCALATE_ADMIN" ? "Báo cáo diễn đàn đã được chuyển cấp" : "Báo cáo diễn đàn đã có kết quả", entityType: "content_report", entityId: reportId, dedupKey: `forum-report:${reportId}:${action}:${recipientId}` })), skipDuplicates: true });
        return this.mapReport(await transaction.contentReport.update({ where: { id: reportId }, data: { status: nextStatus, assignedToId: moderatorId, escalationLevel: action === "ESCALATE_ADMIN" ? { increment: 1 } : item.escalationLevel, resolution: normalizedResolution, resolvedAt: action === "ESCALATE_ADMIN" ? null : new Date() }, include: { actions: { orderBy: { createdAt: "asc" } } } }));
      });
    }
    const item = this.findReport(reportId);
    if (!["OPEN", "IN_REVIEW"].includes(item.status)) throw new ConflictException("Báo cáo đã được xử lý hoặc chuyển cấp.");
    if (item.assignedToId && item.assignedToId !== moderatorId) throw new ConflictException("Báo cáo đang do quản lý khác xử lý.");
    const topic = item.targetType === "TOPIC" ? this.findTopic(item.targetId) : this.findTopic(this.findPost(item.targetId).topicId);
    const targetAuthorId = item.targetType === "TOPIC" ? topic.authorId : this.findPost(item.targetId).authorId;
    if (action === "HIDE_CONTENT" && item.targetType === "POST") this.findPost(item.targetId).status = "HIDDEN";
    if (action === "HIDE_CONTENT" && item.targetType === "TOPIC") { topic.status = "HIDDEN"; topic.isLocked = true; }
    if (action === "KEEP_CONTENT" && item.targetType === "POST") this.findPost(item.targetId).status = "VISIBLE";
    if (action === "KEEP_CONTENT" && item.targetType === "TOPIC") { topic.status = "VISIBLE"; topic.isLocked = false; }
    this.recordMemoryModeration(item, moderatorId, action, normalizedResolution, nextStatus);
    item.assignedToId = moderatorId;
    item.resolution = normalizedResolution;
    item.escalationLevel += action === "ESCALATE_ADMIN" ? 1 : 0;
    if (action !== "ESCALATE_ADMIN") item.resolvedAt = now();
    for (const recipientId of new Set([item.reporterId, targetAuthorId, action === "ESCALATE_ADMIN" ? "usr-admin" : undefined])) if (recipientId) this.notifications.unshift({ id: id("notification"), recipientId, type: "FORUM_MODERATION", title: action === "ESCALATE_ADMIN" ? "Báo cáo diễn đàn đã được chuyển cấp" : "Báo cáo diễn đàn đã có kết quả", entityType: "content_report", entityId: reportId, createdAt: now() });
    return { ...item, actions: item.actions.map((record) => ({ ...record })) };
  }

  async appealReport(reportId: string, reason: string, learnerId = "usr-learner"): Promise<ContentReport> {
    const normalizedReason = reason.trim();
    if (normalizedReason.length < 10) throw new BadRequestException("Lý do kháng nghị phải có ít nhất 10 ký tự.");
    const prisma = this.database();
    if (prisma) {
      return prisma.$transaction(async (transaction) => {
        const item = await transaction.contentReport.findFirst({ where: { id: reportId, reporterId: learnerId } });
        if (!item) throw new NotFoundException("Không tìm thấy báo cáo được phép kháng nghị.");
        if (!["RESOLVED", "REJECTED"].includes(item.status)) throw new ConflictException("Chỉ kết quả đã xử lý mới có thể kháng nghị.");
        if (item.appealedAt) throw new ConflictException("Báo cáo này đã được kháng nghị trước đó.");
        await transaction.moderationAction.create({ data: { id: id("mod-action"), reportId, actorId: learnerId, action: "APPEAL", reason: normalizedReason, previousStatus: item.status, nextStatus: "IN_REVIEW" } });
        await transaction.auditLog.create({ data: { actorId: learnerId, action: "FORUM_REPORT_APPEAL", entityType: "content_report", entityId: reportId, context: { reason: normalizedReason, previousStatus: item.status } } });
        await transaction.notification.create({ data: { id: id("notification"), recipientId: "usr-manager", type: "FORUM_MODERATION_APPEAL", title: "Có kháng nghị kiểm duyệt mới", entityType: "content_report", entityId: reportId, dedupKey: `forum-report:${reportId}:appeal` } });
        return this.mapReport(await transaction.contentReport.update({ where: { id: reportId }, data: { status: "IN_REVIEW", assignedToId: null, appealReason: normalizedReason, appealedAt: new Date(), resolvedAt: null }, include: { actions: { orderBy: { createdAt: "asc" } } } }));
      });
    }
    const item = this.reports.find((report) => report.id === reportId && report.reporterId === learnerId);
    if (!item) throw new NotFoundException("Không tìm thấy báo cáo được phép kháng nghị.");
    if (!["RESOLVED", "REJECTED"].includes(item.status)) throw new ConflictException("Chỉ kết quả đã xử lý mới có thể kháng nghị.");
    if (item.appealedAt) throw new ConflictException("Báo cáo này đã được kháng nghị trước đó.");
    this.recordMemoryModeration(item, learnerId, "APPEAL", normalizedReason, "IN_REVIEW");
    item.assignedToId = undefined;
    item.appealReason = normalizedReason;
    item.appealedAt = now();
    item.resolvedAt = undefined;
    this.notifications.unshift({ id: id("notification"), recipientId: "usr-manager", type: "FORUM_MODERATION_APPEAL", title: "Có kháng nghị kiểm duyệt mới", entityType: "content_report", entityId: reportId, createdAt: now() });
    return { ...item, actions: item.actions.map((record) => ({ ...record })) };
  }

  async listSessions(role = "LEARNER"): Promise<LiveSession[]> {
    const prisma = this.database();
    if (prisma) {
      const rows = await prisma.liveSession.findMany({
        where: role === "LEARNER"
          ? { class: { enrollments: { some: { learnerId: "usr-learner", status: "ACTIVE" } } } }
          : role === "INSTRUCTOR"
            ? { class: { instructors: { some: { instructorId: "usr-instructor" } } } }
            : undefined,
        orderBy: { startsAt: "desc" },
      });
      return rows.map((row) => role === "LEARNER" ? { ...this.mapSession(row), hostUrl: "" } : this.mapSession(row));
    }
    return this.sessions.filter((item) => {
      const classItem = this.classes.find((candidate) => candidate.id === item.classId);
      if (role === "LEARNER") return classItem?.learnerIds.includes("usr-learner");
      if (role === "INSTRUCTOR") return classItem?.instructorIds.includes("usr-instructor");
      return true;
    }).map((item) => role === "LEARNER" ? { ...item, hostUrl: "" } : { ...item });
  }

  async createSession(classId: string, input: Pick<LiveSession, "title" | "startsAt" | "endsAt" | "provider">, actorId = "usr-instructor"): Promise<LiveSession> {
    if (new Date(input.endsAt) <= new Date(input.startsAt)) throw new BadRequestException("Thời gian kết thúc phải sau thời gian bắt đầu.");
    const prisma = this.database();
    if (prisma) {
      const classItem = await prisma.learningClass.findUnique({ where: { id: classId }, include: { instructors: true } });
      if (!classItem) throw new NotFoundException("Không tìm thấy lớp học.");
      if (classItem.status === "CLOSED") throw new ConflictException("Lớp đã lưu trữ và chỉ cho phép đọc.");
      const hostId = actorId === "usr-manager" ? classItem.instructors.find((row) => row.role === "PRIMARY")?.instructorId ?? classItem.instructors[0]?.instructorId : actorId;
      if (!hostId || !classItem.instructors.some((item) => item.instructorId === hostId)) throw new NotFoundException("Lớp chưa có giảng viên phù hợp để chủ trì.");
      if (new Date(input.startsAt) < new Date()) throw new BadRequestException("Không thể lên lịch buổi học trong quá khứ.");
      const overlaps = await prisma.liveSession.count({
        where: {
          OR: [{ classId }, { hostId }], status: { not: "CANCELLED" },
          startsAt: { lt: new Date(input.endsAt) }, endsAt: { gt: new Date(input.startsAt) },
        },
      });
      if (overlaps) throw new ConflictException("Lịch học bị trùng.");
      const provisioned = this.provisionProviderMeeting(input.provider);
      const created = await prisma.liveSession.create({ data: {
          id: id("session"), classId, hostId, title: input.title.trim(),
          startsAt: new Date(input.startsAt), endsAt: new Date(input.endsAt), provider: provisioned.provider, requestedProvider: input.provider,
          fallbackUsed: provisioned.fallbackUsed, provisioningAttempts: provisioned.attempts,
          timezone: classItem.timezone, hostUrl: provisioned.hostUrl, attendeeUrl: provisioned.attendeeUrl,
        } });
      await this.notifyClassMembers(prisma, classId, "LIVE_SESSION_SCHEDULED", `Đã lên lịch: ${created.title}`, created.id);
      await prisma.auditLog.create({ data: { actorId, action: "LIVE_SESSION_SCHEDULED", entityType: "live_session", entityId: created.id, context: { classId, startsAt: input.startsAt, endsAt: input.endsAt, timezone: classItem.timezone, requestedProvider: input.provider, provider: provisioned.provider, fallbackUsed: provisioned.fallbackUsed, provisioningAttempts: provisioned.attempts } } });
      return this.mapSession(created);
    }
    const classItem = this.findClass(classId);
    if (classItem.status === "CLOSED") throw new ConflictException("Lớp đã lưu trữ và chỉ cho phép đọc.");
    const hostId = actorId === "usr-manager" ? classItem.instructorIds[0] : actorId;
    if (!hostId || !classItem.instructorIds.includes(hostId)) throw new NotFoundException("Lớp chưa có giảng viên phù hợp để chủ trì.");
    if (new Date(input.startsAt) < new Date()) throw new BadRequestException("Không thể lên lịch buổi học trong quá khứ.");
    const overlaps = this.sessions.some((item) => item.classId === classId && item.status !== "CANCELLED" && new Date(input.startsAt) < new Date(item.endsAt) && new Date(input.endsAt) > new Date(item.startsAt));
    if (overlaps) throw new ConflictException("Lịch học bị trùng.");
    const provisioned = this.provisionProviderMeeting(input.provider);
    const item: LiveSession = { ...input, provider: provisioned.provider, requestedProvider: input.provider, fallbackUsed: provisioned.fallbackUsed, provisioningAttempts: provisioned.attempts, id: id("session"), classId, status: "SCHEDULED", timezone: classItem.timezone, hostUrl: provisioned.hostUrl, attendeeUrl: provisioned.attendeeUrl };
    this.sessions.unshift(item);
    return { ...item };
  }

  async updateSession(sessionId: string, input: Pick<LiveSession, "title" | "startsAt" | "endsAt" | "provider"> & { reason: string }, actorId = "usr-manager"): Promise<LiveSession> {
    const reason = input.reason.trim(); if (reason.length < 5) throw new BadRequestException("Lý do đổi lịch cần ít nhất 5 ký tự.");
    const startsAt = new Date(input.startsAt); const endsAt = new Date(input.endsAt);
    if (endsAt <= startsAt) throw new BadRequestException("Thời gian kết thúc phải sau thời gian bắt đầu.");
    if (startsAt < new Date()) throw new BadRequestException("Không thể chuyển buổi học vào quá khứ.");
    const prisma = this.database();
    if (prisma) {
      const current = await prisma.liveSession.findUnique({ where: { id: sessionId } });
      if (!current) throw new NotFoundException("Không tìm thấy buổi học.");
      if (current.status !== "SCHEDULED" || current.startsAt <= new Date()) throw new ConflictException("Chỉ được sửa buổi học sắp diễn ra.");
      const overlap = await prisma.liveSession.count({ where: { id: { not: sessionId }, OR: [{ classId: current.classId }, { hostId: current.hostId }], status: { not: "CANCELLED" }, startsAt: { lt: endsAt }, endsAt: { gt: startsAt } } });
      if (overlap) throw new ConflictException("Lịch mới bị trùng lớp hoặc trùng lịch giảng viên.");
      const provisioned = this.provisionProviderMeeting(input.provider);
      const updated = await prisma.liveSession.update({ where: { id: sessionId }, data: { title: input.title.trim(), startsAt, endsAt, provider: provisioned.provider, requestedProvider: input.provider, fallbackUsed: provisioned.fallbackUsed, provisioningAttempts: provisioned.attempts, changeReason: reason, hostUrl: provisioned.hostUrl, attendeeUrl: provisioned.attendeeUrl } });
      await this.notifyClassMembers(prisma, current.classId, "LIVE_SESSION_CHANGED", `Lịch học đã thay đổi: ${updated.title}`, sessionId);
      await prisma.auditLog.create({ data: { actorId, action: "LIVE_SESSION_CHANGED", entityType: "live_session", entityId: sessionId, context: { reason, previousStartsAt: current.startsAt, startsAt, endsAt, provider: input.provider } } });
      return this.mapSession(updated);
    }
    const item = this.findSession(sessionId); if (item.status !== "SCHEDULED" || new Date(item.startsAt) <= new Date()) throw new ConflictException("Chỉ được sửa buổi học sắp diễn ra.");
    const overlap = this.sessions.some((row) => row.id !== sessionId && row.classId === item.classId && row.status !== "CANCELLED" && startsAt < new Date(row.endsAt) && endsAt > new Date(row.startsAt));
    if (overlap) throw new ConflictException("Lịch mới bị trùng lớp hoặc trùng lịch giảng viên.");
    const provisioned = this.provisionProviderMeeting(input.provider);
    Object.assign(item, input, { provider: provisioned.provider, requestedProvider: input.provider, fallbackUsed: provisioned.fallbackUsed, provisioningAttempts: provisioned.attempts, changeReason: reason, hostUrl: provisioned.hostUrl, attendeeUrl: provisioned.attendeeUrl }); return { ...item };
  }

  async cancelSession(sessionId: string, reason: string, actorId = "usr-manager"): Promise<LiveSession> {
    const normalized = reason.trim(); if (normalized.length < 5) throw new BadRequestException("Lý do hủy cần ít nhất 5 ký tự.");
    const prisma = this.database();
    if (prisma) {
      const current = await prisma.liveSession.findUnique({ where: { id: sessionId } });
      if (!current) throw new NotFoundException("Không tìm thấy buổi học.");
      if (current.status !== "SCHEDULED" || current.startsAt <= new Date()) throw new ConflictException("Chỉ được hủy buổi học chưa diễn ra.");
      const updated = await prisma.liveSession.update({ where: { id: sessionId }, data: { status: "CANCELLED", cancellationReason: normalized } });
      await this.notifyClassMembers(prisma, current.classId, "LIVE_SESSION_CANCELLED", `Buổi học đã hủy: ${current.title}`, sessionId);
      await prisma.auditLog.create({ data: { actorId, action: "LIVE_SESSION_CANCELLED", entityType: "live_session", entityId: sessionId, context: { reason: normalized, startsAt: current.startsAt } } });
      return this.mapSession(updated);
    }
    const item = this.findSession(sessionId); if (item.status !== "SCHEDULED" || new Date(item.startsAt) <= new Date()) throw new ConflictException("Chỉ được hủy buổi học chưa diễn ra.");
    item.status = "CANCELLED"; item.cancellationReason = normalized; return { ...item };
  }

  async transitionSession(sessionId: string, status: LiveSession["status"]): Promise<LiveSession> {
    const allowed: Record<LiveSession["status"], LiveSession["status"][]> = { SCHEDULED: ["LIVE"], LIVE: ["COMPLETED"], COMPLETED: [], CANCELLED: [] };
    const prisma = this.database();
    if (prisma) {
      const item = await prisma.liveSession.findUnique({ where: { id: sessionId } });
      if (!item) throw new NotFoundException("Không tìm thấy buổi học.");
      if (!allowed[item.status].includes(status)) throw new BadRequestException(`Không thể chuyển ${item.status} → ${status}.`);
      return this.mapSession(await prisma.liveSession.update({ where: { id: sessionId }, data: { status } }));
    }
    const item = this.findSession(sessionId);
    if (!allowed[item.status].includes(status)) throw new BadRequestException(`Không thể chuyển ${item.status} → ${status}.`);
    item.status = status;
    return { ...item };
  }

  async joinSession(sessionId: string, learnerId = "usr-learner"): Promise<{ attendeeUrl: string; joinedAt: string }> {
    const prisma = this.database();
    if (prisma) {
      const session = await prisma.liveSession.findUnique({ where: { id: sessionId } });
      if (!session) throw new NotFoundException("Không tìm thấy buổi học.");
      const enrollment = await prisma.classEnrollment.findFirst({ where: { classId: session.classId, learnerId, status: "ACTIVE" } });
      if (!enrollment) throw new BadRequestException("Học viên không thuộc lớp.");
      if (["CANCELLED", "COMPLETED"].includes(session.status)) throw new BadRequestException("Buổi học không còn cho phép tham gia.");
      const joinedAt = new Date();
      if (joinedAt < new Date(session.startsAt.getTime() - 15 * 60_000)) throw new BadRequestException("Chỉ có thể vào lớp sớm tối đa 15 phút.");
      if (joinedAt > new Date(session.endsAt.getTime() + 30 * 60_000)) throw new BadRequestException("Đã hết thời gian tham gia buổi học.");
      const existingAttendance = await prisma.attendanceRecord.findUnique({
        where: { sessionId_learnerId: { sessionId, learnerId } }, select: { joinedAt: true },
      });
      await prisma.attendanceRecord.upsert({
        where: { sessionId_learnerId: { sessionId, learnerId } },
        update: { joinedAt: existingAttendance?.joinedAt ?? joinedAt, status: "PRESENT" },
        create: { sessionId, learnerId, joinedAt, status: "PRESENT" },
      });
      return { attendeeUrl: session.attendeeUrl, joinedAt: joinedAt.toISOString() };
    }
    const item = this.findSession(sessionId);
    const classItem = this.findClass(item.classId);
    if (!classItem.learnerIds.includes(learnerId)) throw new BadRequestException("Học viên không thuộc lớp.");
    if (item.status === "CANCELLED" || item.status === "COMPLETED") throw new BadRequestException("Buổi học không còn cho phép tham gia.");
    const timestamp = new Date();
    if (timestamp < new Date(new Date(item.startsAt).getTime() - 15 * 60_000)) throw new BadRequestException("Chỉ có thể vào lớp sớm tối đa 15 phút.");
    if (timestamp > new Date(new Date(item.endsAt).getTime() + 30 * 60_000)) throw new BadRequestException("Đã hết thời gian tham gia buổi học.");
    const joinedAt = now();
    const existing = this.attendance.find((record) => record.sessionId === sessionId && record.learnerId === learnerId);
    if (existing) existing.joinedAt = existing.joinedAt ?? joinedAt;
    else this.attendance.push({ sessionId, learnerId, joinedAt, attendedMinutes: 0, status: "PRESENT" });
    return { attendeeUrl: item.attendeeUrl, joinedAt };
  }

  async leaveSession(sessionId: string, learnerId = "usr-learner"): Promise<AttendanceRecord> {
    const prisma = this.database();
    if (prisma) {
      const attendance = await prisma.attendanceRecord.findUnique({ where: { sessionId_learnerId: { sessionId, learnerId } } });
      if (!attendance?.joinedAt) throw new BadRequestException("Chưa có lượt tham gia để kết thúc.");
      const leftAt = new Date();
      const attendedMinutes = Math.max(0, Math.round((leftAt.getTime() - attendance.joinedAt.getTime()) / 60_000));
      return this.mapAttendance(await prisma.attendanceRecord.update({
        where: { sessionId_learnerId: { sessionId, learnerId } }, data: { leftAt, attendedMinutes },
      }));
    }
    const attendance = this.attendance.find((item) => item.sessionId === sessionId && item.learnerId === learnerId);
    if (!attendance?.joinedAt) throw new BadRequestException("Chưa có lượt tham gia để kết thúc.");
    attendance.leftAt = now();
    attendance.attendedMinutes = Math.max(0, Math.round((new Date(attendance.leftAt).getTime() - new Date(attendance.joinedAt).getTime()) / 60_000));
    return { ...attendance };
  }

  async updateAttendance(sessionId: string, learnerId: string, status: AttendanceRecord["status"], attendedMinutes: number, adjustmentReason: string): Promise<AttendanceRecord> {
    const normalizedReason = adjustmentReason.trim();
    if (normalizedReason.length < 3) throw new BadRequestException("Lý do điều chỉnh cần ít nhất 3 ký tự.");
    const prisma = this.database();
    if (prisma) {
      const session = await prisma.liveSession.findUnique({ where: { id: sessionId } });
      if (!session) throw new NotFoundException("Không tìm thấy buổi học.");
      if (session.status !== "COMPLETED") throw new ConflictException("Chỉ điều chỉnh điểm danh sau khi buổi học kết thúc.");
      if (session.attendanceLockedAt) throw new ConflictException("Kỳ điểm danh đã khóa.");
      this.validateAttendanceMinutes(attendedMinutes, session.startsAt, session.endsAt);
      const enrollment = await prisma.classEnrollment.findFirst({ where: { classId: session.classId, learnerId, status: "ACTIVE" } });
      if (!enrollment) throw new BadRequestException("Học viên không thuộc lớp.");
      const row = await prisma.attendanceRecord.upsert({
        where: { sessionId_learnerId: { sessionId, learnerId } },
        update: { status, attendedMinutes, adjustmentReason: normalizedReason },
        create: { sessionId, learnerId, status, attendedMinutes, adjustmentReason: normalizedReason },
      });
      return this.mapAttendance(row);
    }
    const session = this.findSession(sessionId);
    if (session.status !== "COMPLETED") throw new ConflictException("Chỉ điều chỉnh điểm danh sau khi buổi học kết thúc.");
    if (session.attendanceLockedAt) throw new ConflictException("Kỳ điểm danh đã khóa.");
    this.validateAttendanceMinutes(attendedMinutes, new Date(session.startsAt), new Date(session.endsAt));
    if (!this.findClass(session.classId).learnerIds.includes(learnerId)) throw new BadRequestException("Học viên không thuộc lớp.");
    let record = this.attendance.find((item) => item.sessionId === sessionId && item.learnerId === learnerId);
    if (!record) {
      record = { sessionId, learnerId, attendedMinutes, status, adjustmentReason: normalizedReason };
      this.attendance.push(record);
    } else Object.assign(record, { status, attendedMinutes, adjustmentReason: normalizedReason });
    return { ...record };
  }

  async getAttendanceReview(sessionId: string): Promise<AttendanceSessionReview> {
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
        enrolledLearnerIds: session.class.enrollments.map((item) => item.learnerId),
        records: session.attendance.map((item) => this.mapAttendance(item)),
        appeals: session.appeals.map((item) => this.mapAttendanceAppeal(item)),
      };
    }
    const session = this.findSession(sessionId);
    return {
      session: { ...session },
      enrolledLearnerIds: [...this.findClass(session.classId).learnerIds],
      records: this.attendance.filter((item) => item.sessionId === sessionId).map((item) => ({ ...item, providerSnapshot: item.providerSnapshot ? { ...item.providerSnapshot } : undefined })),
      appeals: this.attendanceAppeals.filter((item) => item.sessionId === sessionId).map((item) => ({ ...item })),
    };
  }

  async syncAttendance(sessionId: string, inputRecords: ProviderAttendanceInput[], actorId = "usr-manager"): Promise<{ review: AttendanceSessionReview; skippedLearnerIds: string[] }> {
    this.validateProviderAttendanceInput(inputRecords);
    const prisma = this.database();
    if (prisma) {
      const skippedLearnerIds = await prisma.$transaction(async (transaction) => {
        const session = await transaction.liveSession.findUnique({
          where: { id: sessionId },
          include: { class: { include: { enrollments: { where: { status: "ACTIVE" } } } } },
        });
        if (!session) throw new NotFoundException("Không tìm thấy buổi học.");
        if (session.status !== "COMPLETED") throw new ConflictException("Chỉ đồng bộ điểm danh sau khi buổi học kết thúc.");
        if (session.attendanceLockedAt) throw new ConflictException("Kỳ điểm danh đã khóa.");
        const enrolledIds = new Set(session.class.enrollments.map((item) => item.learnerId));
        const validRecords = inputRecords.filter((item) => enrolledIds.has(item.learnerId));
        const skipped = inputRecords.filter((item) => !enrolledIds.has(item.learnerId)).map((item) => item.learnerId);
        for (const item of validRecords) {
          const joinedAt = new Date(item.joinedAt);
          const leftAt = new Date(item.leftAt);
          const attendedMinutes = this.calculateProviderAttendanceMinutes(joinedAt, leftAt, session.startsAt, session.endsAt);
          const status = this.deriveProviderAttendanceStatus(joinedAt, attendedMinutes, session.startsAt);
          await transaction.attendanceRecord.upsert({
            where: { sessionId_learnerId: { sessionId, learnerId: item.learnerId } },
            update: { joinedAt, leftAt, attendedMinutes, status, providerParticipantId: item.providerParticipantId, providerSnapshot: { ...item } },
            create: { sessionId, learnerId: item.learnerId, joinedAt, leftAt, attendedMinutes, status, providerParticipantId: item.providerParticipantId, providerSnapshot: { ...item } },
          });
        }
        const seenLearners = new Set(validRecords.map((item) => item.learnerId));
        for (const learnerId of enrolledIds) {
          if (seenLearners.has(learnerId)) continue;
          await transaction.attendanceRecord.upsert({
            where: { sessionId_learnerId: { sessionId, learnerId } },
            update: {},
            create: { sessionId, learnerId, status: "ABSENT", attendedMinutes: 0, providerSnapshot: { absentFromProviderExport: true } },
          });
        }
        await transaction.auditLog.create({ data: { actorId, action: "ATTENDANCE_SYNC", entityType: "live_session", entityId: sessionId, context: { received: inputRecords.length, accepted: validRecords.length, skippedLearnerIds: skipped } } });
        return skipped;
      });
      return { review: await this.getAttendanceReview(sessionId), skippedLearnerIds };
    }

    const session = this.findSession(sessionId);
    if (session.status !== "COMPLETED") throw new ConflictException("Chỉ đồng bộ điểm danh sau khi buổi học kết thúc.");
    if (session.attendanceLockedAt) throw new ConflictException("Kỳ điểm danh đã khóa.");
    const enrolledIds = new Set(this.findClass(session.classId).learnerIds);
    const skippedLearnerIds = inputRecords.filter((item) => !enrolledIds.has(item.learnerId)).map((item) => item.learnerId);
    const seenLearners = new Set<string>();
    for (const item of inputRecords.filter((record) => enrolledIds.has(record.learnerId))) {
      const joinedAt = new Date(item.joinedAt);
      const leftAt = new Date(item.leftAt);
      const attendedMinutes = this.calculateProviderAttendanceMinutes(joinedAt, leftAt, new Date(session.startsAt), new Date(session.endsAt));
      const status = this.deriveProviderAttendanceStatus(joinedAt, attendedMinutes, new Date(session.startsAt));
      const providerSnapshot = { ...item };
      const existing = this.attendance.find((record) => record.sessionId === sessionId && record.learnerId === item.learnerId);
      if (existing) Object.assign(existing, { joinedAt: item.joinedAt, leftAt: item.leftAt, attendedMinutes, status, providerParticipantId: item.providerParticipantId, providerSnapshot });
      else this.attendance.push({ sessionId, learnerId: item.learnerId, joinedAt: item.joinedAt, leftAt: item.leftAt, attendedMinutes, status, providerParticipantId: item.providerParticipantId, providerSnapshot });
      seenLearners.add(item.learnerId);
    }
    for (const learnerId of enrolledIds) {
      if (!seenLearners.has(learnerId) && !this.attendance.some((item) => item.sessionId === sessionId && item.learnerId === learnerId)) this.attendance.push({ sessionId, learnerId, attendedMinutes: 0, status: "ABSENT", providerSnapshot: { absentFromProviderExport: true } });
    }
    return { review: await this.getAttendanceReview(sessionId), skippedLearnerIds };
  }

  async lockAttendance(sessionId: string, actorId = "usr-manager"): Promise<LiveSession> {
    const prisma = this.database();
    if (prisma) {
      return prisma.$transaction(async (transaction) => {
        const session = await transaction.liveSession.findUnique({ where: { id: sessionId }, include: { appeals: { where: { status: { in: ["OPEN", "IN_REVIEW"] } } } } });
        if (!session) throw new NotFoundException("Không tìm thấy buổi học.");
        if (session.status !== "COMPLETED") throw new ConflictException("Chỉ khóa điểm danh của buổi học đã kết thúc.");
        if (session.attendanceLockedAt) throw new ConflictException("Kỳ điểm danh đã được khóa trước đó.");
        if (session.appeals.length) throw new ConflictException("Cần xử lý hết yêu cầu điều chỉnh trước khi khóa.");
        const updated = await transaction.liveSession.update({ where: { id: sessionId }, data: { attendanceLockedAt: new Date(), attendanceLockedById: actorId } });
        await transaction.auditLog.create({ data: { actorId, action: "ATTENDANCE_LOCK", entityType: "live_session", entityId: sessionId, context: { lockedAt: updated.attendanceLockedAt?.toISOString() } } });
        return this.mapSession(updated);
      });
    }
    const session = this.findSession(sessionId);
    if (session.status !== "COMPLETED") throw new ConflictException("Chỉ khóa điểm danh của buổi học đã kết thúc.");
    if (session.attendanceLockedAt) throw new ConflictException("Kỳ điểm danh đã được khóa trước đó.");
    if (this.attendanceAppeals.some((item) => item.sessionId === sessionId && ["OPEN", "IN_REVIEW"].includes(item.status))) throw new ConflictException("Cần xử lý hết yêu cầu điều chỉnh trước khi khóa.");
    session.attendanceLockedAt = now();
    session.attendanceLockedById = actorId;
    return { ...session };
  }

  async resolveAttendanceAppeal(appealId: string, decision: "APPROVE" | "REJECT", resolution: string, status?: AttendanceRecord["status"], attendedMinutes?: number, actorId = "usr-manager"): Promise<AttendanceAppeal> {
    const normalizedResolution = resolution.trim();
    if (normalizedResolution.length < 5) throw new BadRequestException("Kết luận xử lý cần ít nhất 5 ký tự.");
    if (decision === "APPROVE" && (status === undefined || attendedMinutes === undefined)) throw new BadRequestException("Cần trạng thái và số phút mới khi phê duyệt điều chỉnh.");
    const prisma = this.database();
    if (prisma) {
      return prisma.$transaction(async (transaction) => {
        const appeal = await transaction.attendanceAppeal.findUnique({ where: { id: appealId }, include: { session: true } });
        if (!appeal) throw new NotFoundException("Không tìm thấy yêu cầu điều chỉnh.");
        if (!["OPEN", "IN_REVIEW"].includes(appeal.status)) throw new ConflictException("Yêu cầu đã được xử lý.");
        if (appeal.session.attendanceLockedAt) throw new ConflictException("Kỳ điểm danh đã khóa.");
        if (decision === "APPROVE") {
          this.validateAttendanceMinutes(attendedMinutes!, appeal.session.startsAt, appeal.session.endsAt);
          await transaction.attendanceRecord.update({ where: { sessionId_learnerId: { sessionId: appeal.sessionId, learnerId: appeal.learnerId } }, data: { status, attendedMinutes, adjustmentReason: normalizedResolution } });
        }
        const updated = await transaction.attendanceAppeal.update({ where: { id: appealId }, data: { status: decision === "APPROVE" ? "RESOLVED" : "REJECTED", resolution: normalizedResolution } });
        await transaction.auditLog.create({ data: { actorId, action: `ATTENDANCE_APPEAL_${decision}`, entityType: "attendance_appeal", entityId: appealId, context: { sessionId: appeal.sessionId, learnerId: appeal.learnerId, status, attendedMinutes, resolution: normalizedResolution } } });
        await transaction.notification.create({ data: { id: id("notification"), recipientId: appeal.learnerId, type: "ATTENDANCE_APPEAL_RESOLVED", title: decision === "APPROVE" ? "Yêu cầu điểm danh đã được chấp thuận" : "Yêu cầu điểm danh không được chấp thuận", entityType: "ATTENDANCE_APPEAL", entityId: appealId, dedupKey: `attendance-appeal:${appealId}:${decision}` } });
        return this.mapAttendanceAppeal(updated);
      });
    }
    const appeal = this.attendanceAppeals.find((item) => item.id === appealId);
    if (!appeal) throw new NotFoundException("Không tìm thấy yêu cầu điều chỉnh.");
    if (!["OPEN", "IN_REVIEW"].includes(appeal.status)) throw new ConflictException("Yêu cầu đã được xử lý.");
    const session = this.findSession(appeal.sessionId);
    if (session.attendanceLockedAt) throw new ConflictException("Kỳ điểm danh đã khóa.");
    if (decision === "APPROVE") {
      this.validateAttendanceMinutes(attendedMinutes!, new Date(session.startsAt), new Date(session.endsAt));
      const record = this.attendance.find((item) => item.sessionId === appeal.sessionId && item.learnerId === appeal.learnerId);
      if (!record) throw new NotFoundException("Không tìm thấy dữ liệu điểm danh cần điều chỉnh.");
      Object.assign(record, { status, attendedMinutes, adjustmentReason: normalizedResolution });
    }
    appeal.status = decision === "APPROVE" ? "RESOLVED" : "REJECTED";
    appeal.resolution = normalizedResolution;
    this.notifications.unshift({ id: id("notification"), recipientId: appeal.learnerId, type: "ATTENDANCE_APPEAL_RESOLVED", title: decision === "APPROVE" ? "Yêu cầu điểm danh đã được chấp thuận" : "Yêu cầu điểm danh không được chấp thuận", entityType: "ATTENDANCE_APPEAL", entityId: appealId, createdAt: now() });
    return { ...appeal };
  }

  async attachRecording(sessionId: string, recordingUrl: string): Promise<LiveSession> {
    const prisma = this.database();
    if (prisma) {
      const item = await prisma.liveSession.findUnique({ where: { id: sessionId } });
      if (!item) throw new NotFoundException("Không tìm thấy buổi học.");
      if (item.status !== "COMPLETED") throw new BadRequestException("Chỉ gắn bản ghi sau khi buổi học kết thúc.");
      return this.mapSession(await prisma.liveSession.update({
        where: { id: sessionId },
        data: { recordingUrl, recordingStatus: "PROCESSING", recordingReadyAt: null, recordingExpiresAt: null, recordingError: null },
      }));
    }
    const item = this.findSession(sessionId);
    if (item.status !== "COMPLETED") throw new BadRequestException("Chỉ gắn bản ghi sau khi buổi học kết thúc.");
    item.recordingUrl = recordingUrl;
    item.recordingStatus = "PROCESSING";
    item.recordingReadyAt = undefined;
    item.recordingExpiresAt = undefined;
    item.recordingError = undefined;
    return { ...item };
  }

  async completeRecording(sessionId: string, status: "READY" | "FAILED", retentionDays = 90, errorMessage?: string): Promise<LiveSession> {
    const normalizedError = errorMessage?.trim();
    if (status === "FAILED" && (!normalizedError || normalizedError.length < 5)) throw new BadRequestException("Cần mô tả lỗi xử lý bản ghi ít nhất 5 ký tự.");
    const readyAt = status === "READY" ? new Date() : null;
    const expiresAt = readyAt ? new Date(readyAt.getTime() + retentionDays * 86_400_000) : null;
    const prisma = this.database();
    if (prisma) {
      return prisma.$transaction(async (transaction) => {
        const current = await transaction.liveSession.findUnique({ where: { id: sessionId } });
        if (!current) throw new NotFoundException("Không tìm thấy buổi học.");
        if (current.status !== "COMPLETED" || !current.recordingUrl) throw new ConflictException("Buổi học chưa có bản ghi để cập nhật.");
        if (current.recordingStatus !== "PROCESSING") throw new ConflictException("Bản ghi không ở trạng thái đang xử lý.");
        const updated = await transaction.liveSession.update({
          where: { id: sessionId },
          data: { recordingStatus: status, recordingReadyAt: readyAt, recordingExpiresAt: expiresAt, recordingError: status === "FAILED" ? normalizedError : null },
        });
        await transaction.auditLog.create({ data: { actorId: "usr-instructor", action: `RECORDING_${status}`, entityType: "live_session", entityId: sessionId, context: { retentionDays, expiresAt, errorMessage: normalizedError } } });
        if (status === "READY") await this.notifyClassMembers(transaction, current.classId, "RECORDING_READY", `Bản ghi đã sẵn sàng: ${current.title}`, sessionId);
        return this.mapSession(updated);
      });
    }
    const item = this.findSession(sessionId);
    if (item.status !== "COMPLETED" || !item.recordingUrl) throw new ConflictException("Buổi học chưa có bản ghi để cập nhật.");
    if (item.recordingStatus !== "PROCESSING") throw new ConflictException("Bản ghi không ở trạng thái đang xử lý.");
    item.recordingStatus = status;
    item.recordingReadyAt = readyAt?.toISOString();
    item.recordingExpiresAt = expiresAt?.toISOString();
    item.recordingError = status === "FAILED" ? normalizedError : undefined;
    return { ...item };
  }

  private isRecordingAvailable(session: Pick<LiveSession, "recordingUrl" | "recordingStatus" | "recordingExpiresAt">): boolean {
    return Boolean(session.recordingUrl && session.recordingStatus === "READY" && session.recordingExpiresAt && new Date(session.recordingExpiresAt) > new Date());
  }

  async getSessionSummary(sessionId: string, learnerId = "usr-learner"): Promise<object> {
    const prisma = this.database();
    if (prisma) {
      const session = await prisma.liveSession.findUnique({ where: { id: sessionId } });
      if (!session) throw new NotFoundException("Không tìm thấy buổi học.");
      const enrollment = await prisma.classEnrollment.findFirst({ where: { classId: session.classId, learnerId, status: "ACTIVE" } });
      if (!enrollment) throw new NotFoundException("Học viên không thuộc lớp của buổi học.");
      const attendance = await prisma.attendanceRecord.findUnique({ where: { sessionId_learnerId: { sessionId, learnerId } } });
      const appeal = await prisma.attendanceAppeal.findFirst({ where: { sessionId, learnerId }, orderBy: { createdAt: "desc" } });
      const mapped = this.mapSession(session);
      return { session: { ...mapped, hostUrl: "", attendeeUrl: "", recordingUrl: undefined }, recordingAvailable: this.isRecordingAvailable(mapped), attendance: attendance ? this.mapAttendance(attendance) : { sessionId, learnerId, attendedMinutes: 0, status: "ABSENT" }, appeal: appeal ? this.mapAttendanceAppeal(appeal) : undefined };
    }
    const session = this.findSession(sessionId);
    if (!this.findClass(session.classId).learnerIds.includes(learnerId)) throw new NotFoundException("Học viên không thuộc lớp của buổi học.");
    return { session: { ...session, hostUrl: "", attendeeUrl: "", recordingUrl: undefined }, recordingAvailable: this.isRecordingAvailable(session), attendance: this.attendance.find((item) => item.sessionId === sessionId && item.learnerId === learnerId) ?? { sessionId, learnerId, attendedMinutes: 0, status: "ABSENT" }, appeal: this.attendanceAppeals.find((item) => item.sessionId === sessionId && item.learnerId === learnerId) };
  }

  async createRecordingAccess(sessionId: string, learnerId = "usr-learner"): Promise<{ url: string; expiresAt: string }> {
    const prisma = this.database();
    if (prisma) {
      const session = await prisma.liveSession.findFirst({ where: { id: sessionId, status: "COMPLETED", recordingStatus: "READY", recordingUrl: { not: null }, recordingExpiresAt: { gt: new Date() }, class: { enrollments: { some: { learnerId, status: "ACTIVE" } } } } });
      if (!session) throw new NotFoundException("Bản ghi chưa sẵn sàng hoặc học viên không có quyền xem.");
    } else {
      const session = this.findSession(sessionId);
      if (session.status !== "COMPLETED" || !this.isRecordingAvailable(session) || !this.findClass(session.classId).learnerIds.includes(learnerId)) throw new NotFoundException("Bản ghi chưa sẵn sàng, đã hết hạn hoặc học viên không có quyền xem.");
    }
    const expires = Math.floor(Date.now() / 1000) + 300;
    const signature = this.signRecordingAccess(sessionId, expires, learnerId);
    return { url: `/learner/sessions/${sessionId}/recording?expires=${expires}&signature=${encodeURIComponent(signature)}`, expiresAt: new Date(expires * 1000).toISOString() };
  }

  async resolveRecordingAccess(sessionId: string, expires: number, signature: string, learnerId = "usr-learner"): Promise<{ recordingUrl: string }> {
    this.verifyExpiringSignature(this.signRecordingAccess(sessionId, expires, learnerId), expires, signature, "Chữ ký bản ghi không hợp lệ.");
    const prisma = this.database();
    if (prisma) {
      const session = await prisma.liveSession.findFirst({ where: { id: sessionId, status: "COMPLETED", recordingStatus: "READY", recordingUrl: { not: null }, recordingExpiresAt: { gt: new Date() }, class: { enrollments: { some: { learnerId, status: "ACTIVE" } } } } });
      if (!session?.recordingUrl) throw new NotFoundException("Bản ghi chưa sẵn sàng hoặc học viên không có quyền xem.");
      return { recordingUrl: session.recordingUrl };
    }
    const session = this.findSession(sessionId);
    if (session.status !== "COMPLETED" || !this.isRecordingAvailable(session) || !this.findClass(session.classId).learnerIds.includes(learnerId)) throw new NotFoundException("Bản ghi chưa sẵn sàng, đã hết hạn hoặc học viên không có quyền xem.");
    return { recordingUrl: session.recordingUrl! };
  }

  async requestAttendanceAppeal(sessionId: string, reason: string, learnerId = "usr-learner"): Promise<AttendanceAppeal> {
    const normalized = reason.trim();
    if (normalized.length < 10) throw new BadRequestException("Lý do điều chỉnh cần ít nhất 10 ký tự.");
    const prisma = this.database();
    if (prisma) {
      const session = await prisma.liveSession.findFirst({ where: { id: sessionId, status: "COMPLETED", class: { enrollments: { some: { learnerId, status: "ACTIVE" } } } }, include: { attendance: { where: { learnerId } }, appeals: { where: { learnerId, status: { in: ["OPEN", "IN_REVIEW"] } } } } });
      if (!session) throw new NotFoundException("Không tìm thấy buổi học được phép yêu cầu điều chỉnh.");
      if (!session.attendance.length) throw new BadRequestException("Chưa có dữ liệu điểm danh để yêu cầu điều chỉnh.");
      if (session.appeals.length) throw new ConflictException("Đã có yêu cầu điều chỉnh đang được xử lý.");
      return this.mapAttendanceAppeal(await prisma.attendanceAppeal.create({ data: { id: id("attendance-appeal"), sessionId, learnerId, reason: normalized } }));
    }
    const session = this.findSession(sessionId);
    if (session.status !== "COMPLETED" || !this.findClass(session.classId).learnerIds.includes(learnerId)) throw new NotFoundException("Không tìm thấy buổi học được phép yêu cầu điều chỉnh.");
    if (!this.attendance.some((item) => item.sessionId === sessionId && item.learnerId === learnerId)) throw new BadRequestException("Chưa có dữ liệu điểm danh để yêu cầu điều chỉnh.");
    if (this.attendanceAppeals.some((item) => item.sessionId === sessionId && item.learnerId === learnerId && ["OPEN", "IN_REVIEW"].includes(item.status))) throw new ConflictException("Đã có yêu cầu điều chỉnh đang được xử lý.");
    const appeal: AttendanceAppeal = { id: id("attendance-appeal"), sessionId, learnerId, reason: normalized, status: "OPEN", createdAt: now() };
    this.attendanceAppeals.unshift(appeal);
    return { ...appeal };
  }

  async listTickets(role: string): Promise<SupportTicket[]> {
    const prisma = this.database();
    if (prisma) {
      const rows = await prisma.supportTicket.findMany({
        where: role === "LEARNER" ? { reporterId: "usr-learner" } : undefined,
        include: { attachments: true },
        orderBy: [{ status: "asc" }, { createdAt: "desc" }],
      });
      return rows.map((row) => this.mapTicket(row));
    }
    return this.tickets.filter((item) => role === "LEARNER" ? item.reporterId === "usr-learner" : true).map((item) => ({ ...item, attachments: item.attachments.map((attachment) => ({ ...attachment })) }));
  }

  async createTicket(input: Pick<SupportTicket, "category" | "severity" | "description" | "contextId">, reporterId = "usr-learner"): Promise<SupportTicket> {
    const slaHours: Record<SupportTicket["severity"], number> = { P0: 4, P1: 24, P2: 72, P3: 120 };
    const description = this.validateSupportText(input.description, "Mô tả yêu cầu");
    const category = input.category.trim();
    const contextId = input.contextId?.trim() || undefined;
    const prisma = this.database();
    if (prisma) {
      return prisma.$transaction(async (transaction) => {
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
        const created = await transaction.supportTicket.create({
          data: {
            id: ticketId, reporterId, category, severity: input.severity, description,
            contextId: contextId ?? null, duplicateOfId: duplicate?.id,
            dueAt: new Date(Date.now() + slaHours[input.severity] * 3_600_000),
          },
          include: { attachments: true },
        });
        if (input.severity === "P0") {
          await transaction.notification.create({
            data: {
              id: id("notification"), recipientId: "usr-admin", type: "SUPPORT_P0",
              title: `P0 mới: ${category}${contextId ? ` · ${contextId}` : ""}`,
              entityType: "SUPPORT_TICKET", entityId: ticketId, dedupKey: `support-p0:${ticketId}:usr-admin`,
            },
          });
        }
        return this.mapTicket(created);
      });
    }
    const duplicate = this.tickets.find((ticket) => ticket.reporterId === reporterId && ticket.category === category && ["OPEN", "IN_PROGRESS"].includes(ticket.status) && Date.now() - new Date(ticket.createdAt).getTime() <= 24 * 3_600_000 && (contextId ? ticket.contextId === contextId : ticket.description === description));
    const item: SupportTicket = { ...input, category, description, contextId, duplicateOfId: duplicate?.id, id: id("ticket"), reporterId, status: "OPEN", dueAt: new Date(Date.now() + slaHours[input.severity] * 3_600_000).toISOString(), attachments: [], createdAt: now() };
    this.tickets.unshift(item);
    if (input.severity === "P0") this.notifications.unshift({ id: id("notification"), recipientId: "usr-admin", type: "SUPPORT_P0", title: `P0 mới: ${category}${contextId ? ` · ${contextId}` : ""}`, entityType: "SUPPORT_TICKET", entityId: item.id, createdAt: now() });
    return { ...item, attachments: [] };
  }

  listRoleNotifications(role: string): Promise<LearningNotification[]> {
    return this.listNotifications(this.userIdForRole(role));
  }

  markRoleNotificationRead(notificationId: string, role: string): Promise<LearningNotification> {
    return this.markNotificationRead(notificationId, this.userIdForRole(role));
  }

  async addSupportAttachment(
    ticketId: string,
    upload: UploadedMaterialFile,
    role: string,
  ): Promise<SupportAttachment> {
    const uploaderId = this.userIdForRole(role);
    this.validateSupportUpload(upload);
    const attachmentId = id("support-attachment");
    const safeExtension = extname(upload.originalName).toLowerCase().replace(/[^.a-z0-9]/g, "");
    const objectKey = `support/${ticketId}/${attachmentId}${safeExtension}`;
    const checksum = `sha256:${createHash("sha256").update(upload.buffer).digest("hex")}`;
    const prisma = this.database();
    if (prisma) {
      const ticket = await prisma.supportTicket.findUnique({ where: { id: ticketId } });
      if (!ticket || role === "LEARNER" && ticket.reporterId !== uploaderId) throw new NotFoundException("Không tìm thấy ticket được phép đính kèm.");
      if (["RESOLVED", "CLOSED"].includes(ticket.status)) throw new BadRequestException("Ticket đã hoàn tất, không thể thêm bằng chứng.");
      await this.writeStoredFile(objectKey, upload.buffer);
      try {
        const row = await prisma.supportAttachment.create({ data: { id: attachmentId, ticketId, uploaderId, name: upload.originalName, objectKey, mimeType: upload.mimeType, sizeBytes: upload.size, checksum } });
        return { id: row.id, ticketId: row.ticketId, name: row.name, mimeType: row.mimeType, sizeBytes: Number(row.sizeBytes), checksum: row.checksum, createdAt: row.createdAt.toISOString() };
      } catch (error) {
        await this.removeStoredFile(objectKey);
        throw error;
      }
    }
    const ticket = this.tickets.find((item) => item.id === ticketId);
    if (!ticket || role === "LEARNER" && ticket.reporterId !== uploaderId) throw new NotFoundException("Không tìm thấy ticket được phép đính kèm.");
    if (["RESOLVED", "CLOSED"].includes(ticket.status)) throw new BadRequestException("Ticket đã hoàn tất, không thể thêm bằng chứng.");
    await this.writeStoredFile(objectKey, upload.buffer);
    const attachment: SupportAttachment = { id: attachmentId, ticketId, name: upload.originalName, mimeType: upload.mimeType, sizeBytes: upload.size, checksum, createdAt: now() };
    ticket.attachments.push(attachment);
    return { ...attachment };
  }

  async updateTicket(ticketId: string, input: Partial<Pick<SupportTicket, "status" | "assigneeId" | "resolution">>): Promise<SupportTicket> {
    if ((input.status === "RESOLVED" || input.status === "CLOSED") && !input.resolution) throw new BadRequestException("Cần ghi nội dung xử lý trước khi đóng.");
    const prisma = this.database();
    if (prisma) {
      const item = await prisma.supportTicket.findUnique({ where: { id: ticketId } });
      if (!item) throw new NotFoundException("Không tìm thấy ticket.");
      if (input.assigneeId) {
        const assignee = await prisma.user.findUnique({ where: { id: input.assigneeId } });
        if (!assignee || assignee.status !== "ACTIVE") throw new BadRequestException("Người xử lý không hợp lệ.");
      }
      return this.mapTicket(await prisma.supportTicket.update({
        where: { id: ticketId },
        data: { status: input.status, assigneeId: input.assigneeId, resolution: input.resolution?.trim() },
      }));
    }
    const item = this.tickets.find((ticket) => ticket.id === ticketId);
    if (!item) throw new NotFoundException("Không tìm thấy ticket.");
    Object.assign(item, input);
    return { ...item, attachments: item.attachments.map((attachment) => ({ ...attachment })) };
  }

  async closeTicketByReporter(ticketId: string, reporterId = "usr-learner"): Promise<SupportTicket> {
    const prisma = this.database();
    if (prisma) {
      return prisma.$transaction(async (transaction) => {
        const item = await transaction.supportTicket.findFirst({ where: { id: ticketId, reporterId }, include: { attachments: true } });
        if (!item) throw new NotFoundException("Không tìm thấy ticket được phép đóng.");
        if (item.status !== "RESOLVED" || !item.resolution?.trim()) throw new ConflictException("Chỉ được đóng ticket đã có kết quả xử lý.");
        const updated = await transaction.supportTicket.update({ where: { id: ticketId }, data: { status: "CLOSED" }, include: { attachments: true } });
        await transaction.auditLog.create({ data: { actorId: reporterId, action: "SUPPORT_TICKET_CLOSED_BY_REPORTER", entityType: "support_ticket", entityId: ticketId, context: { resolution: item.resolution } } });
        return this.mapTicket(updated);
      });
    }
    const item = this.tickets.find((ticket) => ticket.id === ticketId && ticket.reporterId === reporterId);
    if (!item) throw new NotFoundException("Không tìm thấy ticket được phép đóng.");
    if (item.status !== "RESOLVED" || !item.resolution?.trim()) throw new ConflictException("Chỉ được đóng ticket đã có kết quả xử lý.");
    item.status = "CLOSED";
    return { ...item, attachments: item.attachments.map((attachment) => ({ ...attachment })) };
  }

  async listTicketComments(ticketId: string, role: string): Promise<TicketComment[]> {
    const prisma = this.database();
    if (prisma) {
      const ticket = await prisma.supportTicket.findUnique({ where: { id: ticketId } });
      if (!ticket || role === "LEARNER" && ticket.reporterId !== "usr-learner") throw new NotFoundException("Không tìm thấy ticket được phép xem.");
      const rows = await prisma.ticketComment.findMany({ where: { ticketId }, orderBy: { createdAt: "asc" } });
      return rows.map((row) => ({ id: row.id, ticketId: row.ticketId, authorId: row.authorId, body: row.body, createdAt: row.createdAt.toISOString() }));
    }
    const ticket = this.tickets.find((item) => item.id === ticketId);
    if (!ticket || role === "LEARNER" && ticket.reporterId !== "usr-learner") throw new NotFoundException("Không tìm thấy ticket được phép xem.");
    return this.ticketComments.filter((item) => item.ticketId === ticketId).map((item) => ({ ...item }));
  }

  async addTicketComment(ticketId: string, body: string, role: string): Promise<TicketComment> {
    const normalized = this.validateSupportText(body, "Nội dung trao đổi");
    const authorId = this.userIdForRole(role);
    const prisma = this.database();
    if (prisma) {
      const ticket = await prisma.supportTicket.findUnique({ where: { id: ticketId } });
      if (!ticket || role === "LEARNER" && ticket.reporterId !== authorId) throw new NotFoundException("Không tìm thấy ticket được phép phản hồi.");
      if (ticket.status === "CLOSED") throw new BadRequestException("Ticket đã đóng, không thể thêm trao đổi.");
      const row = await prisma.ticketComment.create({ data: { id: id("ticket-comment"), ticketId, authorId, body: normalized } });
      if (role !== "LEARNER" && ticket.status === "OPEN") await prisma.supportTicket.update({ where: { id: ticketId }, data: { status: "IN_PROGRESS", assigneeId: authorId } });
      return { id: row.id, ticketId: row.ticketId, authorId: row.authorId, body: row.body, createdAt: row.createdAt.toISOString() };
    }
    const ticket = this.tickets.find((item) => item.id === ticketId);
    if (!ticket || role === "LEARNER" && ticket.reporterId !== authorId) throw new NotFoundException("Không tìm thấy ticket được phép phản hồi.");
    if (ticket.status === "CLOSED") throw new BadRequestException("Ticket đã đóng, không thể thêm trao đổi.");
    if (role !== "LEARNER" && ticket.status === "OPEN") Object.assign(ticket, { status: "IN_PROGRESS", assigneeId: authorId });
    const comment: TicketComment = { id: id("ticket-comment"), ticketId, authorId, body: normalized, createdAt: now() };
    this.ticketComments.push(comment);
    return { ...comment };
  }

  async getClassProgress(classId: string, input: { from?: string; to?: string } & Partial<RiskThresholds>): Promise<ClassProgressReport> {
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
          materials: { where: { visibility: "PUBLISHED" }, include: { accessLogs: { where: { createdAt: { gte: from, lte: to } } } } },
          exams: { where: { openAt: { lte: to }, closeAt: { gte: from } }, include: { attempts: { where: { submittedAt: { gte: from, lte: to } } } } },
          sessions: { where: { startsAt: { gte: from, lte: to }, status: { in: ["COMPLETED", "LIVE"] } }, include: { attendance: true } },
        },
      });
      if (!classItem) throw new NotFoundException("Không tìm thấy lớp học.");
      const interventions = await prisma.progressIntervention.findMany({ where: { classId }, orderBy: { createdAt: "desc" } });
      const learners = classItem.enrollments.map(({ learnerId }) => {
        const accessedMaterialIds = new Set(classItem.materials.filter((material) => material.accessLogs.some((log) => log.userId === learnerId)).map((material) => material.id));
        const attempts = classItem.exams.flatMap((exam) => exam.attempts.filter((attempt) => attempt.learnerId === learnerId).map((attempt) => ({ ...attempt, totalScore: Number(exam.totalScore) })));
        const completedExamIds = new Set(attempts.map((attempt) => attempt.examId));
        const attendance = classItem.sessions.flatMap((session) => session.attendance.filter((record) => record.learnerId === learnerId));
        const activityDates = [...classItem.materials.flatMap((material) => material.accessLogs.filter((log) => log.userId === learnerId).map((log) => log.createdAt)), ...attempts.flatMap((attempt) => attempt.submittedAt ? [attempt.submittedAt] : []), ...attendance.flatMap((record) => record.joinedAt ? [record.joinedAt] : [])];
        return this.buildLearnerProgress({ learnerId, materialCompletionRate: this.percentage(accessedMaterialIds.size, classItem.materials.length), assessmentCompletionRate: this.percentage(completedExamIds.size, classItem.exams.length), attendanceRate: this.percentage(attendance.filter((record) => record.status === "PRESENT" || record.status === "LATE").length, classItem.sessions.length), averageScore: attempts.length ? Math.round((attempts.reduce((sum, attempt) => sum + (attempt.score === null ? 0 : Number(attempt.score) / attempt.totalScore * 100), 0) / attempts.length) * 100) / 100 : 0, lastActivityAt: this.latestDate(activityDates), thresholds, interventions: interventions.filter((item) => item.learnerId === learnerId).map((item) => this.mapProgressIntervention(item)) });
      });
      return { classId, classCode: classItem.code, from: from.toISOString(), to: to.toISOString(), thresholds, learners, generatedAt: now() };
    }
    const classItem = this.findClass(classId);
    const materials = this.materials.filter((material) => material.classId === classId && material.visibility === "PUBLISHED");
    const exams = this.exams.filter((exam) => exam.classId === classId && new Date(exam.openAt) <= to && new Date(exam.closeAt) >= from);
    const sessions = this.sessions.filter((session) => session.classId === classId && new Date(session.startsAt) >= from && new Date(session.startsAt) <= to && ["COMPLETED", "LIVE"].includes(session.status));
    const learners = classItem.learnerIds.map((learnerId) => {
      const accessLogs = this.materialAccessLogs.filter((log) => log.userId === learnerId && materials.some((material) => material.id === log.materialId) && new Date(log.createdAt) >= from && new Date(log.createdAt) <= to);
      const attempts = this.attempts.filter((attempt) => attempt.learnerId === learnerId && exams.some((exam) => exam.id === attempt.examId) && attempt.submittedAt && new Date(attempt.submittedAt) >= from && new Date(attempt.submittedAt) <= to);
      const attendance = this.attendance.filter((record) => record.learnerId === learnerId && sessions.some((session) => session.id === record.sessionId));
      const activityDates = [...accessLogs.map((log) => new Date(log.createdAt)), ...attempts.flatMap((attempt) => attempt.submittedAt ? [new Date(attempt.submittedAt)] : []), ...attendance.flatMap((record) => record.joinedAt ? [new Date(record.joinedAt)] : [])];
      return this.buildLearnerProgress({ learnerId, materialCompletionRate: this.percentage(new Set(accessLogs.map((log) => log.materialId)).size, materials.length), assessmentCompletionRate: this.percentage(new Set(attempts.map((attempt) => attempt.examId)).size, exams.length), attendanceRate: this.percentage(attendance.filter((record) => record.status === "PRESENT" || record.status === "LATE").length, sessions.length), averageScore: attempts.length ? Math.round((attempts.reduce((sum, attempt) => { const exam = exams.find((candidate) => candidate.id === attempt.examId); return sum + (exam ? (attempt.score ?? 0) / exam.totalScore * 100 : 0); }, 0) / attempts.length) * 100) / 100 : 0, lastActivityAt: this.latestDate(activityDates), thresholds, interventions: this.progressInterventions.filter((item) => item.classId === classId && item.learnerId === learnerId).map((item) => ({ ...item })) });
    });
    return { classId, classCode: classItem.code, from: from.toISOString(), to: to.toISOString(), thresholds, learners, generatedAt: now() };
  }

  async createProgressIntervention(classId: string, input: Pick<ProgressIntervention, "learnerId" | "title" | "notes" | "dueAt">, ownerId = "usr-manager"): Promise<ProgressIntervention> {
    const dueAt = new Date(input.dueAt);
    if (Number.isNaN(dueAt.getTime()) || dueAt <= new Date()) throw new BadRequestException("Hạn hành động hỗ trợ phải ở tương lai.");
    const title = input.title.trim();
    const prisma = this.database();
    if (prisma) {
      const enrollment = await prisma.classEnrollment.findFirst({ where: { classId, learnerId: input.learnerId, status: "ACTIVE" } });
      if (!enrollment) throw new NotFoundException("Học viên không thuộc lớp đang hoạt động.");
      const row = await prisma.progressIntervention.create({ data: { id: id("intervention"), classId, learnerId: input.learnerId, ownerId, title, notes: input.notes?.trim(), dueAt } });
      await prisma.auditLog.create({ data: { actorId: ownerId, action: "PROGRESS_INTERVENTION_CREATED", entityType: "progress_intervention", entityId: row.id, context: { classId, learnerId: input.learnerId, dueAt: dueAt.toISOString() } } });
      return this.mapProgressIntervention(row);
    }
    if (!this.findClass(classId).learnerIds.includes(input.learnerId)) throw new NotFoundException("Học viên không thuộc lớp đang hoạt động.");
    const item: ProgressIntervention = { id: id("intervention"), classId, learnerId: input.learnerId, ownerId, title, notes: input.notes?.trim(), dueAt: dueAt.toISOString(), status: "OPEN", createdAt: now() };
    this.progressInterventions.unshift(item);
    return { ...item };
  }

  async updateProgressIntervention(interventionId: string, status: "DONE" | "CANCELLED", ownerId = "usr-manager"): Promise<ProgressIntervention> {
    const prisma = this.database();
    if (prisma) {
      const current = await prisma.progressIntervention.findUnique({ where: { id: interventionId } });
      if (!current) throw new NotFoundException("Không tìm thấy hành động hỗ trợ.");
      if (current.status !== "OPEN") throw new ConflictException("Hành động hỗ trợ đã kết thúc.");
      const row = await prisma.progressIntervention.update({ where: { id: interventionId }, data: { status, completedAt: status === "DONE" ? new Date() : null } });
      await prisma.auditLog.create({ data: { actorId: ownerId, action: `PROGRESS_INTERVENTION_${status}`, entityType: "progress_intervention", entityId: interventionId, context: { previousStatus: current.status, nextStatus: status } } });
      return this.mapProgressIntervention(row);
    }
    const item = this.progressInterventions.find((candidate) => candidate.id === interventionId);
    if (!item) throw new NotFoundException("Không tìm thấy hành động hỗ trợ.");
    if (item.status !== "OPEN") throw new ConflictException("Hành động hỗ trợ đã kết thúc.");
    item.status = status;
    item.completedAt = status === "DONE" ? now() : undefined;
    return { ...item };
  }

  async runOperationalReport(fromInput: string, toInput: string, requestedById = "usr-manager"): Promise<ReportRun> {
    const { from, to } = this.reportingPeriod(fromInput, toInput);
    const result = await this.getOperationalReport(from.toISOString(), to.toISOString());
    const run: ReportRun = { id: id("report-run"), reportType: "OPERATIONS", definitionVersion: result.definitionVersion, timezone: result.timezone, filters: { from: from.toISOString(), to: to.toISOString() }, result, requestedById, createdAt: now() };
    const prisma = this.database();
    if (prisma) {
      const row = await prisma.reportRun.create({ data: { id: run.id, reportType: run.reportType, definitionVersion: run.definitionVersion, timezone: run.timezone, filters: run.filters, result: run.result as unknown as Prisma.InputJsonValue, requestedById } });
      await prisma.auditLog.create({ data: { actorId: requestedById, action: "OPERATIONAL_REPORT_RUN", entityType: "report_run", entityId: row.id, context: run.filters } });
      return { ...run, createdAt: row.createdAt.toISOString() };
    }
    this.reportRuns.unshift(run);
    return structuredClone(run);
  }

  async createReportExport(reportRunId: string, format: "CSV", requestedById = "usr-manager"): Promise<ReportExport> {
    const prisma = this.database();
    const run = prisma
      ? await prisma.reportRun.findFirst({ where: { id: reportRunId, requestedById } })
      : this.reportRuns.find((item) => item.id === reportRunId && item.requestedById === requestedById);
    if (!run) throw new NotFoundException("Không tìm thấy lần chạy báo cáo được phép xuất.");
    const exportId = id("report-export");
    const fileName = `bao-cao-van-hanh-${new Date().toISOString().slice(0, 10)}-${exportId.slice(-8)}.csv`;
    const objectKey = `report-exports/${exportId}.csv`;
    const filePath = this.resolveObjectPath(objectKey);
    const expiresAt = new Date(Date.now() + 24 * 3_600_000);
    const result = ("result" in run ? run.result : {}) as unknown as OperationalReport;
    const csv = this.operationalReportCsv(result);
    if (prisma) await prisma.reportExport.create({ data: { id: exportId, reportRunId, format, fileName, expiresAt, requestedById } });
    try {
      await mkdir(dirname(filePath), { recursive: true });
      await writeFile(filePath, `\uFEFF${csv}`, { flag: "wx" });
      const sizeBytes = Buffer.byteLength(`\uFEFF${csv}`);
      if (prisma) {
        const row = await prisma.reportExport.update({ where: { id: exportId }, data: { status: "COMPLETED", filePath, sizeBytes } });
        await prisma.auditLog.create({ data: { actorId: requestedById, action: "OPERATIONAL_REPORT_EXPORTED", entityType: "report_export", entityId: exportId, context: { reportRunId, format, sizeBytes, expiresAt: expiresAt.toISOString() } } });
        return this.mapReportExport(row);
      }
      const item: ReportExport & { filePath: string } = { id: exportId, reportRunId, format, status: "COMPLETED", fileName, filePath, sizeBytes, expiresAt: expiresAt.toISOString(), createdAt: now() };
      this.reportExports.unshift(item);
      return { ...item, filePath: undefined } as ReportExport;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Không thể tạo tệp xuất báo cáo.";
      if (prisma) await prisma.reportExport.update({ where: { id: exportId }, data: { status: "FAILED", errorMessage: message } });
      throw new BadRequestException("Không thể tạo tệp xuất báo cáo.");
    }
  }

  async listReportExports(requestedById = "usr-manager"): Promise<ReportExport[]> {
    const prisma = this.database();
    if (prisma) {
      const rows = await prisma.reportExport.findMany({ where: { requestedById }, orderBy: { createdAt: "desc" }, take: 50 });
      return rows.map((row) => this.mapReportExport(row));
    }
    return this.reportExports.filter((item) => item.status !== "EXPIRED").map((item) => ({ id: item.id, reportRunId: item.reportRunId, format: item.format, status: item.status, fileName: item.fileName, sizeBytes: item.sizeBytes, errorMessage: item.errorMessage, expiresAt: item.expiresAt, createdAt: item.createdAt }));
  }

  async downloadReportExport(exportId: string, requestedById = "usr-manager"): Promise<MaterialDownload> {
    const prisma = this.database();
    if (prisma) {
      const row = await prisma.reportExport.findFirst({ where: { id: exportId, requestedById } });
      if (!row) throw new NotFoundException("Không tìm thấy tệp xuất báo cáo.");
      if (row.expiresAt <= new Date()) { await prisma.reportExport.update({ where: { id: exportId }, data: { status: "EXPIRED" } }); throw new BadRequestException("Tệp xuất báo cáo đã hết hạn."); }
      if (row.status !== "COMPLETED" || !row.filePath) throw new ConflictException("Tệp xuất báo cáo chưa sẵn sàng.");
      return { fileName: row.fileName, mimeType: "text/csv; charset=utf-8", buffer: await readFile(row.filePath) };
    }
    const item = this.reportExports.find((candidate) => candidate.id === exportId);
    if (!item) throw new NotFoundException("Không tìm thấy tệp xuất báo cáo.");
    if (new Date(item.expiresAt) <= new Date()) { item.status = "EXPIRED"; throw new BadRequestException("Tệp xuất báo cáo đã hết hạn."); }
    if (item.status !== "COMPLETED" || !item.filePath) throw new ConflictException("Tệp xuất báo cáo chưa sẵn sàng.");
    return { fileName: item.fileName, mimeType: "text/csv; charset=utf-8", buffer: await readFile(item.filePath) };
  }

  async getOperationalReport(fromInput?: string, toInput?: string): Promise<OperationalReport> {
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
        openReports: "Báo cáo diễn đàn chưa kết thúc được tạo trong kỳ báo cáo.",
        openTickets: "Phiếu hỗ trợ chưa kết thúc được tạo trong kỳ báo cáo.",
      },
    };
    const prisma = this.database();
    if (prisma) {
      const [courses, classes, activeClasses, learnerRows, materials, publishedMaterials, questions, exams, liveSessions, openReports, openTickets] = await prisma.$transaction([
        prisma.course.count({ where: { createdAt } }),
        prisma.learningClass.count({ where: { createdAt } }),
        prisma.learningClass.count({ where: { status: "ACTIVE", createdAt } }),
        prisma.classEnrollment.findMany({ where: { status: "ACTIVE" }, distinct: ["learnerId"], select: { learnerId: true } }),
        prisma.material.count({ where: { createdAt } }),
        prisma.material.count({ where: { visibility: "PUBLISHED", createdAt } }),
        prisma.question.count({ where: { createdAt } }),
        prisma.exam.count({ where: { createdAt } }),
        prisma.liveSession.count({ where: { startsAt: createdAt } }),
        prisma.contentReport.count({ where: { status: { in: ["OPEN", "IN_REVIEW", "ESCALATED"] }, createdAt } }),
        prisma.supportTicket.count({ where: { status: { in: ["OPEN", "IN_PROGRESS"] }, createdAt } }),
      ]);
      return { courses, classes, activeClasses, learners: learnerRows.length, materials, publishedMaterials, questions, exams, liveSessions, openReports, openTickets, generatedAt: now(), ...metadata };
    }
    const classes = this.classes.filter((item) => item.status === "ACTIVE").length;
    const materials = this.materials.filter((item) => item.visibility === "PUBLISHED").length;
    return { courses: this.courses.length, classes, activeClasses: classes, learners: new Set(this.classes.flatMap((item) => item.learnerIds)).size, materials, publishedMaterials: materials, questions: this.questions.length, exams: this.exams.length, liveSessions: this.sessions.filter((item) => new Date(item.startsAt) >= from && new Date(item.startsAt) <= to).length, openReports: this.reports.filter((item) => ["OPEN", "IN_REVIEW", "ESCALATED"].includes(item.status) && new Date(item.createdAt) >= from && new Date(item.createdAt) <= to).length, openTickets: this.tickets.filter((item) => !["RESOLVED", "CLOSED"].includes(item.status) && new Date(item.createdAt) >= from && new Date(item.createdAt) <= to).length, generatedAt: now(), ...metadata };
  }

  async getClassReports(): Promise<object[]> {
    const prisma = this.database();
    if (prisma) {
      const classes = await prisma.learningClass.findMany({
        include: {
          instructors: true,
          enrollments: { where: { status: "ACTIVE" } },
          materials: { where: { visibility: "PUBLISHED" }, select: { id: true } },
          exams: { include: { attempts: true } },
          sessions: { include: { attendance: true } },
        },
        orderBy: { startAt: "desc" },
      });
      return classes.map((classItem) => {
        const attempts = classItem.exams.flatMap((exam) => exam.attempts);
        const graded = attempts.filter((attempt) => attempt.score !== null);
        const attendance = classItem.sessions.flatMap((session) => session.attendance);
        const attendanceDenominator = classItem.enrollments.length * classItem.sessions.length;
        return {
          classId: classItem.id,
          classCode: classItem.code,
          className: classItem.name,
          learners: classItem.enrollments.length,
          instructors: classItem.instructors.length,
          publishedMaterials: classItem.materials.length,
          exams: classItem.exams.length,
          submittedAttempts: attempts.filter((attempt) => attempt.status !== "IN_PROGRESS").length,
          averageScore: graded.length ? Math.round((graded.reduce((sum, attempt) => sum + Number(attempt.score), 0) / graded.length) * 100) / 100 : 0,
          sessions: classItem.sessions.length,
          attendanceRate: attendanceDenominator ? Math.round((attendance.filter((row) => row.status === "PRESENT" || row.status === "LATE").length / attendanceDenominator) * 100) : 0,
          status: classItem.status,
        };
      });
    }
    return this.classes.map((classItem) => {
      const classExams = this.exams.filter((exam) => exam.classId === classItem.id);
      const classAttempts = this.attempts.filter((attempt) => classExams.some((exam) => exam.id === attempt.examId));
      const classSessions = this.sessions.filter((session) => session.classId === classItem.id);
      const attendanceRows = this.attendance.filter((record) => classSessions.some((session) => session.id === record.sessionId));
      const graded = classAttempts.filter((attempt) => attempt.score !== undefined);
      return { classId: classItem.id, classCode: classItem.code, className: classItem.name, learners: classItem.learnerIds.length, instructors: classItem.instructorIds.length, publishedMaterials: this.materials.filter((material) => material.classId === classItem.id && material.visibility === "PUBLISHED").length, exams: classExams.length, submittedAttempts: classAttempts.filter((attempt) => attempt.status !== "IN_PROGRESS").length, averageScore: graded.length ? Math.round((graded.reduce((sum, attempt) => sum + (attempt.score ?? 0), 0) / graded.length) * 100) / 100 : 0, sessions: classSessions.length, attendanceRate: classItem.learnerIds.length && classSessions.length ? Math.round((attendanceRows.filter((row) => row.status === "PRESENT" || row.status === "LATE").length / (classItem.learnerIds.length * classSessions.length)) * 100) : 0, status: classItem.status };
    });
  }

  private database(): PrismaService | undefined {
    return this.prisma?.isStartupConnectionEnabled() ? this.prisma : undefined;
  }

  private mapCourse(row: Prisma.CourseGetPayload<Record<string, never>>): LearningCourse {
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

  private mapMaterial(row: Prisma.MaterialGetPayload<Record<string, never>>): LearningMaterial {
    const sizeBytes = Number(row.sizeBytes);
    if (!Number.isSafeInteger(sizeBytes)) throw new BadRequestException("Kích thước học liệu vượt giới hạn số an toàn.");
    return {
      id: row.id,
      classId: row.classId,
      name: row.name,
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

  private mapQuestion(row: Prisma.QuestionGetPayload<Record<string, never>>): LearningQuestion {
    return {
      id: row.id,
      courseId: row.courseId,
      type: row.type,
      content: row.content,
      options: this.toStringArray(row.options),
      correctAnswers: this.toStringArray(row.correctAnswers),
      difficulty: Math.min(3, Math.max(1, row.difficulty)) as 1 | 2 | 3,
      tags: this.toStringArray(row.tags),
      status: row.status === "PUBLISHED" ? "PUBLISHED" : "DRAFT",
      version: row.version,
      familyId: row.familyId,
      supersedesId: row.supersedesId ?? undefined,
    };
  }

  async getExamAnalytics(input: { classId?: string; examId?: string; from?: string; to?: string }): Promise<ExamAnalytics> {
    const { from, to } = this.reportingPeriod(input.from, input.to);
    const metricDefinitions = { averagePercentage: "Trung bình điểm đã chấm chia tổng điểm đề, quy đổi phần trăm.", passRate: "Tỷ lệ bài đạt từ 50% tổng điểm trong các bài đã chấm.", correctRate: "Tỷ lệ lượt trả lời khớp toàn bộ đáp án chuẩn của câu hỏi sau khi đề đóng." };
    const prisma = this.database();
    if (prisma) {
      const rows = await prisma.exam.findMany({
        where: { id: input.examId || undefined, classId: input.classId || undefined, openAt: { lte: to }, closeAt: { gte: from }, class: { instructors: { some: { instructorId: "usr-instructor" } } } },
        include: { questions: { include: { question: true }, orderBy: { position: "asc" } }, attempts: { where: { submittedAt: { gte: from, lte: to }, status: { in: ["SUBMITTED", "GRADED"] } }, include: { answers: true } } },
        orderBy: { openAt: "desc" },
      });
      return { generatedAt: now(), filters: input, metricDefinitions, exams: rows.map((exam) => {
        const graded = exam.attempts.filter((attempt) => attempt.score !== null);
        const percentages = graded.map((attempt) => Number(attempt.score) / Number(exam.totalScore) * 100);
        const questionStatsAvailable = new Date() > exam.closeAt;
        const questionStats = questionStatsAvailable ? exam.questions.map(({ question }) => {
          const answers = exam.attempts.map((attempt) => attempt.answers.find((answer) => answer.questionId === question.id)).filter((answer) => Boolean(answer));
          const correct = this.toStringArray(question.correctAnswers).sort().join("\u0000");
          const correctCount = answers.filter((answer) => this.toStringArray(answer!.answerData).sort().join("\u0000") === correct).length;
          return { questionId: question.id, difficulty: question.difficulty, responseCount: answers.length, correctRate: answers.length ? Math.round(correctCount / answers.length * 10_000) / 100 : 0 };
        }) : [];
        return { examId: exam.id, classId: exam.classId, title: exam.title, sampleSize: graded.length, smallSampleWarning: graded.length < 5, averagePercentage: percentages.length ? Math.round(percentages.reduce((sum, value) => sum + value, 0) / percentages.length * 100) / 100 : 0, passRate: percentages.length ? Math.round(percentages.filter((value) => value >= 50).length / percentages.length * 10_000) / 100 : 0, questionStatsAvailable, questionStats };
      }) };
    }
    const exams = this.exams.filter((exam) => (!input.examId || exam.id === input.examId) && (!input.classId || exam.classId === input.classId) && this.findClass(exam.classId).instructorIds.includes("usr-instructor") && new Date(exam.openAt) <= to && new Date(exam.closeAt) >= from).map((exam) => {
      const attempts = this.attempts.filter((attempt) => attempt.examId === exam.id && attempt.submittedAt && new Date(attempt.submittedAt) >= from && new Date(attempt.submittedAt) <= to && ["SUBMITTED", "GRADED"].includes(attempt.status));
      const graded = attempts.filter((attempt) => attempt.score !== undefined);
      const percentages = graded.map((attempt) => (attempt.score ?? 0) / exam.totalScore * 100);
      const questionStatsAvailable = new Date() > new Date(exam.closeAt);
      const questionStats = questionStatsAvailable ? exam.questionIds.map((questionId) => {
        const question = this.questions.find((item) => item.id === questionId);
        if (!question) throw new NotFoundException("Đề chứa câu hỏi không tồn tại.");
        const answers = attempts.map((attempt) => attempt.answers[questionId]).filter((answer): answer is string[] => Boolean(answer));
        const correct = [...question.correctAnswers].sort().join("\u0000");
        return { questionId, difficulty: question.difficulty, responseCount: answers.length, correctRate: answers.length ? Math.round(answers.filter((answer) => [...answer].sort().join("\u0000") === correct).length / answers.length * 10_000) / 100 : 0 };
      }) : [];
      return { examId: exam.id, classId: exam.classId, title: exam.title, sampleSize: graded.length, smallSampleWarning: graded.length < 5, averagePercentage: percentages.length ? Math.round(percentages.reduce((sum, value) => sum + value, 0) / percentages.length * 100) / 100 : 0, passRate: percentages.length ? Math.round(percentages.filter((value) => value >= 50).length / percentages.length * 10_000) / 100 : 0, questionStatsAvailable, questionStats };
    });
    return { generatedAt: now(), filters: input, metricDefinitions, exams };
  }

  async exportExamAnalytics(input: { classId?: string; examId?: string; from?: string; to?: string }): Promise<Buffer> {
    const report = await this.getExamAnalytics(input);
    const escape = (value: string | number | boolean): string => `"${String(value).replaceAll('"', '""')}"`;
    const rows = [["examId", "classId", "title", "sampleSize", "smallSampleWarning", "averagePercentage", "passRate"], ...report.exams.map((exam) => [exam.examId, exam.classId, exam.title, exam.sampleSize, exam.smallSampleWarning, exam.averagePercentage, exam.passRate])];
    return Buffer.from(`\uFEFF${rows.map((row) => row.map(escape).join(",")).join("\r\n")}`, "utf8");
  }

  private mapMaterialVersion(row: Prisma.MaterialVersionGetPayload<Record<string, never>>): MaterialVersionSnapshot {
    const sizeBytes = Number(row.sizeBytes);
    if (!Number.isSafeInteger(sizeBytes)) throw new BadRequestException("Kích thước phiên bản học liệu vượt giới hạn số an toàn.");
    return { id: row.id, materialId: row.materialId, version: row.version, name: row.name, mimeType: row.mimeType, sizeBytes, folder: row.folder, tags: this.toStringArray(row.tags), visibility: row.visibility, createdBy: row.createdBy, createdAt: row.createdAt.toISOString() };
  }

  private cloneQuestion(item: LearningQuestion): LearningQuestion {
    return { ...item, options: [...item.options], correctAnswers: [...item.correctAnswers], tags: [...item.tags] };
  }

  private latestQuestionVersions(items: LearningQuestion[]): LearningQuestion[] {
    const latest = new Map<string, LearningQuestion>();
    for (const item of items) {
      const familyId = item.familyId ?? item.id;
      const current = latest.get(familyId);
      if (!current || item.version > current.version) latest.set(familyId, item);
    }
    return [...latest.values()].sort((a, b) => b.version - a.version);
  }

  private questionContentHash(content: string): string {
    return createHash("sha256").update(content.trim().replace(/\s+/g, " ").toLowerCase()).digest("hex");
  }

  private validateQuestionInput(input: Omit<LearningQuestion, "id" | "status" | "version">): Omit<LearningQuestion, "id" | "status" | "version" | "familyId" | "supersedesId"> {
    const content = input.content.trim().replace(/\s+/g, " ");
    const options = [...new Set(input.options.map((item) => item.trim()).filter(Boolean))];
    const correctAnswers = [...new Set(input.correctAnswers.map((item) => item.trim()).filter(Boolean))];
    const tags = [...new Set(input.tags.map((item) => item.trim().toLowerCase()).filter(Boolean))];
    if (content.length < 5) throw new BadRequestException("Nội dung câu hỏi cần ít nhất 5 ký tự.");
    if (!Number.isInteger(input.difficulty) || input.difficulty < 1 || input.difficulty > 3) throw new BadRequestException("Độ khó phải từ 1 đến 3.");
    const objective = ["SINGLE_CHOICE", "MULTIPLE_CHOICE", "TRUE_FALSE"].includes(input.type);
    if (objective && options.length < 2) throw new BadRequestException("Câu hỏi trắc nghiệm cần ít nhất hai lựa chọn khác nhau.");
    if (correctAnswers.some((answer) => !options.includes(answer)) && objective) throw new BadRequestException("Đáp án đúng phải nằm trong danh sách lựa chọn.");
    if ((input.type === "SINGLE_CHOICE" || input.type === "TRUE_FALSE") && correctAnswers.length !== 1) throw new BadRequestException("Câu hỏi một đáp án cần đúng một đáp án đúng.");
    if (input.type === "MULTIPLE_CHOICE" && correctAnswers.length < 1) throw new BadRequestException("Câu hỏi nhiều đáp án cần ít nhất một đáp án đúng.");
    if (input.type === "TRUE_FALSE" && (options.length !== 2 || !options.includes("Đúng") || !options.includes("Sai"))) throw new BadRequestException("Câu hỏi đúng/sai phải có hai lựa chọn Đúng và Sai.");
    return { courseId: input.courseId.trim(), type: input.type, content, options, correctAnswers, difficulty: input.difficulty, tags };
  }

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
      status: row.status,
      version: row.version,
    };
  }

  private mapAttempt(row: AttemptWithAnswers): ExamAttempt {
    return {
      id: row.id,
      examId: row.examId,
      learnerId: row.learnerId,
      answers: Object.fromEntries(row.answers.map((answer) => [answer.questionId, this.toStringArray(answer.answerData)])),
      status: row.status,
      startedAt: row.startedAt.toISOString(),
      submittedAt: row.submittedAt?.toISOString(),
      score: row.score === null ? undefined : Number(row.score),
      feedback: row.feedback ?? undefined,
      gradePublishedAt: row.gradePublishedAt?.toISOString(),
      serverTime: now(),
      lastSavedAt: row.answers.length ? new Date(Math.max(...row.answers.map((answer) => answer.updatedAt.getTime()))).toISOString() : undefined,
      submissionReceipt: row.submittedAt ? this.submissionReceipt(row.id, row.submittedAt.toISOString()) : undefined,
    };
  }

  private submissionReceipt(attemptId: string, submittedAt: string): string {
    return `SUB-${createHash("sha256").update(`${attemptId}.${submittedAt}`).digest("hex").slice(0, 16).toUpperCase()}`;
  }

  private mapRegradeRequest(row: Prisma.RegradeRequestGetPayload<Record<string, never>>): RegradeRequest {
    return {
      id: row.id,
      attemptId: row.attemptId,
      learnerId: row.learnerId,
      reason: row.reason,
      status: row.status,
      resolution: row.resolution ?? undefined,
      createdAt: row.createdAt.toISOString(),
    };
  }

  private mapTopic(row: Prisma.ForumTopicGetPayload<Record<string, never>>): ForumTopic {
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

  private mapPost(row: Prisma.ForumPostGetPayload<Record<string, never>> | ForumPostWithRelations): ForumPost {
    return {
      id: row.id,
      topicId: row.topicId,
      authorId: row.authorId,
      body: row.status === "PUBLISHED" ? row.body : "[Nội dung đã bị ẩn]",
      parentId: row.parentId ?? undefined,
      status: row.status === "PUBLISHED" ? "VISIBLE" : "HIDDEN",
      attachmentIds: row.status === "PUBLISHED" && "attachments" in row ? row.attachments.map((item) => item.materialId) : [],
      mentionedUserIds: row.status === "PUBLISHED" && "mentions" in row ? row.mentions.map((item) => item.mentionedUserId) : [],
      createdAt: row.createdAt.toISOString(),
      editedAt: row.editedAt?.toISOString(),
      deletedAt: row.deletedAt?.toISOString(),
      editCount: Array.isArray(row.editHistory) ? row.editHistory.length : 0,
    };
  }

  private mapReport(row: Prisma.ContentReportGetPayload<Record<string, never>> | ContentReportWithActions): ContentReport {
    if (row.targetType !== "TOPIC" && row.targetType !== "POST") throw new BadRequestException("Loại nội dung báo cáo không hợp lệ.");
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
      actions: "actions" in row ? row.actions.map((action) => ({
        id: action.id,
        reportId: action.reportId,
        actorId: action.actorId,
        action: action.action as ModerationActionRecord["action"],
        reason: action.reason,
        previousStatus: action.previousStatus,
        nextStatus: action.nextStatus,
        createdAt: action.createdAt.toISOString(),
      })) : [],
    };
  }

  private mapProgressIntervention(row: Prisma.ProgressInterventionGetPayload<Record<string, never>>): ProgressIntervention {
    return { id: row.id, classId: row.classId, learnerId: row.learnerId, ownerId: row.ownerId, title: row.title, notes: row.notes ?? undefined, dueAt: row.dueAt.toISOString(), status: row.status, completedAt: row.completedAt?.toISOString(), createdAt: row.createdAt.toISOString() };
  }

  private mapReportExport(row: Prisma.ReportExportGetPayload<Record<string, never>>): ReportExport {
    const sizeBytes = row.sizeBytes === null ? undefined : Number(row.sizeBytes);
    if (sizeBytes !== undefined && !Number.isSafeInteger(sizeBytes)) throw new BadRequestException("Kích thước tệp báo cáo vượt giới hạn an toàn.");
    return { id: row.id, reportRunId: row.reportRunId, format: row.format as "CSV", status: row.status, fileName: row.fileName, sizeBytes, errorMessage: row.errorMessage ?? undefined, expiresAt: row.expiresAt.toISOString(), createdAt: row.createdAt.toISOString() };
  }

  private reportingPeriod(fromInput?: string, toInput?: string): { from: Date; to: Date } {
    const to = toInput ? new Date(toInput) : new Date();
    const from = fromInput ? new Date(fromInput) : new Date(to.getTime() - 365 * 86_400_000);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) throw new BadRequestException("Khoảng thời gian báo cáo không hợp lệ.");
    if (from > to) throw new BadRequestException("Ngày bắt đầu báo cáo phải trước ngày kết thúc.");
    if (to.getTime() - from.getTime() > 5 * 365 * 86_400_000) throw new BadRequestException("Khoảng thời gian báo cáo không được vượt quá 5 năm.");
    return { from, to };
  }

  private validateRiskThresholds(thresholds: RiskThresholds): void {
    for (const [name, value] of Object.entries(thresholds)) if (!Number.isInteger(value) || value < 1 || value > 100) throw new BadRequestException(`Ngưỡng ${name} phải là số nguyên từ 1 đến 100.`);
  }

  private validateTimezone(timezone: string): void {
    try {
      new Intl.DateTimeFormat("vi-VN", { timeZone: timezone }).format(new Date());
    } catch {
      throw new BadRequestException("Múi giờ lớp học không hợp lệ.");
    }
  }

  private percentage(numerator: number, denominator: number): number {
    return denominator > 0 ? Math.round(numerator / denominator * 10_000) / 100 : 0;
  }

  private latestDate(values: Date[]): string | undefined {
    if (!values.length) return undefined;
    return new Date(Math.max(...values.map((value) => value.getTime()))).toISOString();
  }

  private buildLearnerProgress(input: Omit<LearnerProgress, "riskLevel" | "riskReasons"> & { thresholds: RiskThresholds }): LearnerProgress {
    const reasons: string[] = [];
    if (input.attendanceRate < input.thresholds.attendanceBelow) reasons.push(`Điểm danh ${input.attendanceRate}% thấp hơn ngưỡng ${input.thresholds.attendanceBelow}%.`);
    if (input.averageScore < input.thresholds.scoreBelow) reasons.push(`Điểm trung bình ${input.averageScore}% thấp hơn ngưỡng ${input.thresholds.scoreBelow}%.`);
    const overallCompletion = Math.round((input.materialCompletionRate + input.assessmentCompletionRate) / 2 * 100) / 100;
    if (overallCompletion < input.thresholds.completionBelow) reasons.push(`Tiến độ tổng hợp ${overallCompletion}% thấp hơn ngưỡng ${input.thresholds.completionBelow}%.`);
    const riskLevel: LearnerProgress["riskLevel"] = reasons.length >= 2 ? "HIGH" : reasons.length === 1 ? "MEDIUM" : "LOW";
    return { learnerId: input.learnerId, materialCompletionRate: input.materialCompletionRate, assessmentCompletionRate: input.assessmentCompletionRate, attendanceRate: input.attendanceRate, averageScore: input.averageScore, lastActivityAt: input.lastActivityAt, interventions: input.interventions, riskLevel, riskReasons: reasons };
  }

  private operationalReportCsv(report: OperationalReport): string {
    const rows: Array<[string, string | number]> = [
      ["Phiên bản định nghĩa", report.definitionVersion], ["Múi giờ", report.timezone], ["Thời điểm tạo", report.generatedAt],
      ["Khóa học", report.courses], ["Lớp học", report.classes], ["Lớp đang hoạt động", report.activeClasses], ["Học viên", report.learners],
      ["Học liệu", report.materials], ["Học liệu đã phát hành", report.publishedMaterials], ["Câu hỏi", report.questions], ["Đề thi", report.exams],
      ["Buổi trực tuyến", report.liveSessions], ["Báo cáo diễn đàn mở", report.openReports], ["Phiếu hỗ trợ mở", report.openTickets],
    ];
    const escape = (value: string | number): string => `"${String(value).replaceAll('"', '""')}"`;
    return [["Chỉ số", "Giá trị"], ...rows].map((row) => row.map(escape).join(",")).join("\r\n");
  }

  private recordMemoryModeration(report: ContentReport, actorId: string, action: ModerationActionRecord["action"], reason: string, nextStatus: ContentReport["status"]): void {
    const timestamp = now();
    const record: ModerationActionRecord = { id: id("mod-action"), reportId: report.id, actorId, action, reason, previousStatus: report.status, nextStatus, createdAt: timestamp };
    this.moderationActions.unshift(record);
    report.actions.push(record);
    report.status = nextStatus;
    report.updatedAt = timestamp;
  }

  private recordMemberHistory(classId: string, memberId: string, memberType: ClassMemberHistory["memberType"], action: string, actorId: string, detail: { role?: InstructorRole; source?: string; reason?: string }): void {
    this.classMemberHistory.unshift({ id: `${classId}:${id("member-history")}`, memberId, memberType, action, actorId, createdAt: now(), ...detail });
  }

  private buildProviderUrls(provider: LiveSession["provider"], token: string): { hostUrl: string; attendeeUrl: string } {
    const base = provider === "ZOOM" ? "https://zoom.us/wc/join" : provider === "GOOGLE_MEET" ? "https://meet.google.com" : "https://meet.jit.si";
    return { hostUrl: `${base}/${token}?role=host`, attendeeUrl: `${base}/${token}` };
  }

  private seededOrder(values: string[], seed: string): string[] {
    return [...values].sort((left, right) => createHash("sha256").update(`${seed}:${left}`).digest("hex").localeCompare(createHash("sha256").update(`${seed}:${right}`).digest("hex")) || left.localeCompare(right));
  }

  private provisionProviderMeeting(requested: LiveSession["provider"]): { provider: LiveSession["provider"]; hostUrl: string; attendeeUrl: string; fallbackUsed: boolean; attempts: number } {
    const retryLimit = this.config?.get("LIVE_PROVIDER_RETRY_LIMIT", { infer: true }) ?? 2;
    const rawOrder = this.config?.get("LIVE_PROVIDER_FALLBACK_ORDER", { infer: true }) ?? "GOOGLE_MEET,ZOOM,JITSI";
    const rawFailures = this.config?.get("LIVE_PROVIDER_SIMULATED_FAILURES", { infer: true }) ?? "";
    const configuredOrder = rawOrder.split(",").map((value) => value.trim()).filter((value): value is LiveSession["provider"] => this.isLiveProvider(value));
    const failures = new Set(rawFailures.split(",").map((value) => value.trim()).filter(Boolean));
    const candidates = [...new Set([requested, ...configuredOrder])];
    let attempts = 0;
    for (const provider of candidates) {
      for (let retry = 0; retry < retryLimit; retry += 1) {
        attempts += 1;
        if (failures.has(provider)) continue;
        return { provider, ...this.buildProviderUrls(provider, randomUUID()), fallbackUsed: provider !== requested, attempts };
      }
    }
    throw new ServiceUnavailableException(`Không thể tạo phòng học sau ${attempts} lần thử. Vui lòng kiểm tra cấu hình provider hoặc thử lại sau.`);
  }

  private async notifyClassMembers(database: PrismaService | Prisma.TransactionClient, classId: string, type: string, title: string, entityId: string): Promise<void> {
    const item = await database.learningClass.findUnique({ where: { id: classId }, include: { instructors: { select: { instructorId: true } }, enrollments: { where: { status: "ACTIVE" }, select: { learnerId: true } } } });
    if (!item) return;
    const recipients = new Set([...item.instructors.map((row) => row.instructorId), ...item.enrollments.map((row) => row.learnerId)]);
    for (const recipientId of recipients) await database.notification.upsert({ where: { dedupKey: `${type}:${entityId}:${recipientId}` }, update: { title, readAt: null }, create: { id: id("notification"), recipientId, type, title, entityType: "LIVE_SESSION", entityId, dedupKey: `${type}:${entityId}:${recipientId}` } });
  }

  private mapSession(row: Prisma.LiveSessionGetPayload<Record<string, never>>): LiveSession {
    if (!this.isLiveProvider(row.provider)) throw new BadRequestException(`Nhà cung cấp lớp trực tuyến ${row.provider} không được hỗ trợ.`);
    return {
      id: row.id,
      classId: row.classId,
      title: row.title,
      startsAt: row.startsAt.toISOString(),
      endsAt: row.endsAt.toISOString(),
      provider: row.provider,
      requestedProvider: this.isLiveProvider(row.requestedProvider) ? row.requestedProvider : row.provider,
      fallbackUsed: row.fallbackUsed,
      provisioningAttempts: row.provisioningAttempts,
      status: row.status,
      hostUrl: row.hostUrl,
      attendeeUrl: row.attendeeUrl,
      recordingUrl: row.recordingUrl ?? undefined,
      recordingStatus: row.recordingExpiresAt && row.recordingExpiresAt <= new Date() && row.recordingStatus === "READY" ? "EXPIRED" : row.recordingStatus as LiveSession["recordingStatus"],
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

  private mapAttendance(row: Prisma.AttendanceRecordGetPayload<Record<string, never>>): AttendanceRecord {
    return {
      sessionId: row.sessionId,
      learnerId: row.learnerId,
      joinedAt: row.joinedAt?.toISOString(),
      leftAt: row.leftAt?.toISOString(),
      attendedMinutes: row.attendedMinutes,
      status: row.status,
      adjustmentReason: row.adjustmentReason ?? undefined,
      providerParticipantId: row.providerParticipantId ?? undefined,
      providerSnapshot: row.providerSnapshot && typeof row.providerSnapshot === "object" && !Array.isArray(row.providerSnapshot)
        ? { ...row.providerSnapshot } as Record<string, unknown>
        : undefined,
    };
  }

  private mapAttendanceAppeal(row: Prisma.AttendanceAppealGetPayload<Record<string, never>>): AttendanceAppeal {
    return { id: row.id, sessionId: row.sessionId, learnerId: row.learnerId, reason: row.reason, status: row.status, resolution: row.resolution ?? undefined, createdAt: row.createdAt.toISOString() };
  }

  private mapTicket(row: Prisma.SupportTicketGetPayload<Record<string, never>> | SupportTicketWithAttachments): SupportTicket {
    return {
      id: row.id,
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
      attachments: "attachments" in row ? row.attachments.map((attachment) => ({
        id: attachment.id,
        ticketId: attachment.ticketId,
        name: attachment.name,
        mimeType: attachment.mimeType,
        sizeBytes: Number(attachment.sizeBytes),
        checksum: attachment.checksum,
        createdAt: attachment.createdAt.toISOString(),
      })) : [],
      createdAt: row.createdAt.toISOString(),
    };
  }

  private isLiveProvider(value: string): value is LiveSession["provider"] {
    return value === "GOOGLE_MEET" || value === "ZOOM" || value === "JITSI";
  }

  private validateProviderAttendanceInput(records: ProviderAttendanceInput[]): void {
    if (!records.length) throw new BadRequestException("Cần ít nhất một bản ghi từ nhà cung cấp.");
    const participantIds = new Set<string>();
    const learnerIds = new Set<string>();
    for (const record of records) {
      if (participantIds.has(record.providerParticipantId)) throw new ConflictException(`Trùng mã người tham dự ${record.providerParticipantId}.`);
      if (learnerIds.has(record.learnerId)) throw new ConflictException(`Trùng học viên ${record.learnerId} trong dữ liệu đồng bộ.`);
      const joinedAt = new Date(record.joinedAt);
      const leftAt = new Date(record.leftAt);
      if (Number.isNaN(joinedAt.getTime()) || Number.isNaN(leftAt.getTime()) || leftAt <= joinedAt) throw new BadRequestException(`Khoảng tham dự của ${record.learnerId} không hợp lệ.`);
      participantIds.add(record.providerParticipantId);
      learnerIds.add(record.learnerId);
    }
  }

  private calculateProviderAttendanceMinutes(joinedAt: Date, leftAt: Date, startsAt: Date, endsAt: Date): number {
    if (joinedAt > new Date(endsAt.getTime() + 30 * 60_000) || leftAt < new Date(startsAt.getTime() - 15 * 60_000)) throw new BadRequestException("Khoảng tham dự nằm ngoài cửa sổ của buổi học.");
    const effectiveStart = new Date(Math.max(joinedAt.getTime(), startsAt.getTime()));
    const effectiveEnd = new Date(Math.min(leftAt.getTime(), endsAt.getTime()));
    return Math.max(0, Math.round((effectiveEnd.getTime() - effectiveStart.getTime()) / 60_000));
  }

  private deriveProviderAttendanceStatus(joinedAt: Date, attendedMinutes: number, startsAt: Date): AttendanceRecord["status"] {
    if (attendedMinutes === 0) return "ABSENT";
    return joinedAt.getTime() > startsAt.getTime() + 10 * 60_000 ? "LATE" : "PRESENT";
  }

  private validateAttendanceMinutes(attendedMinutes: number, startsAt: Date, endsAt: Date): void {
    const maximum = Math.max(0, Math.round((endsAt.getTime() - startsAt.getTime()) / 60_000) + 30);
    if (!Number.isInteger(attendedMinutes) || attendedMinutes < 0 || attendedMinutes > maximum) throw new BadRequestException(`Số phút tham dự phải từ 0 đến ${maximum}.`);
  }

  private buildClassClosureReadiness(
    status: LearningClass["status"],
    endAt: Date,
    counts: Omit<ClassClosureReadiness, "eligible" | "blockers">,
  ): ClassClosureReadiness {
    const blockers: string[] = [];
    if (status !== "ACTIVE") blockers.push("lớp không ở trạng thái hoạt động");
    if (endAt > new Date()) blockers.push("chưa đến ngày kết thúc lớp");
    if (counts.openExams) blockers.push(`${counts.openExams} kỳ thi đang mở hoặc chờ duyệt`);
    if (counts.pendingGrades) blockers.push(`${counts.pendingGrades} bài nộp chưa chấm`);
    if (counts.activeSessions) blockers.push(`${counts.activeSessions} buổi học chưa kết thúc`);
    if (counts.unlockedAttendanceSessions) blockers.push(`${counts.unlockedAttendanceSessions} kỳ điểm danh chưa khóa`);
    if (counts.openAppeals) blockers.push(`${counts.openAppeals} yêu cầu điểm danh chưa xử lý`);
    return { eligible: blockers.length === 0, blockers, ...counts };
  }

  private fileReviewAction(value: string): FileReviewRecord["action"] {
    if (value === "APPROVE" || value === "HIDE" || value === "REQUEST_CHANGES") return value;
    throw new BadRequestException("Hành động kiểm duyệt học liệu không hợp lệ.");
  }

  private async getDatabaseClass(
    database: PrismaService | Prisma.TransactionClient,
    classId: string,
  ): Promise<LearningClass> {
    const row = await database.learningClass.findUnique({
      where: { id: classId },
      include: { instructors: true, enrollments: { where: { status: "ACTIVE" } } },
    });
    if (!row) throw new NotFoundException("Không tìm thấy lớp học.");
    return this.mapClass(row);
  }

  private async getDatabaseExam(
    database: PrismaService | Prisma.TransactionClient,
    examId: string,
  ): Promise<LearningExam> {
    const row = await database.exam.findUnique({
      where: { id: examId }, include: { questions: { orderBy: { position: "asc" } } },
    });
    if (!row) throw new NotFoundException("Không tìm thấy đề.");
    return this.mapExam(row);
  }

  private async getDatabaseAttempt(
    database: PrismaService | Prisma.TransactionClient,
    attemptId: string,
  ): Promise<ExamAttempt> {
    const row = await database.examAttempt.findUnique({ where: { id: attemptId }, include: { answers: true } });
    if (!row) throw new NotFoundException("Không tìm thấy lượt làm bài.");
    return this.mapAttempt(row);
  }

  private async requireUserRole(
    database: PrismaService,
    userId: string,
    roleCode: "INSTRUCTOR" | "LEARNER",
    message: string,
  ): Promise<void> {
    const user = await database.user.findFirst({
      where: { id: userId, status: "ACTIVE", roles: { some: { role: { code: roleCode } } } },
      select: { id: true },
    });
    if (!user) throw new BadRequestException(message);
  }

  private async getStoragePolicy(database: PrismaService): Promise<{ maxFileSizeMb: number; storageQuotaMb: number; allowedMimeTypes: string[] }> {
    const row = await database.systemSetting.findUnique({ where: { key: "platform" }, select: { value: true } });
    const record = typeof row?.value === "object" && row.value !== null && !Array.isArray(row.value)
      ? row.value as Record<string, unknown>
      : {};
    return {
      maxFileSizeMb: typeof record.maxFileSizeMb === "number" ? record.maxFileSizeMb : 50,
      storageQuotaMb: typeof record.storageQuotaMb === "number" ? record.storageQuotaMb : 10_240,
      allowedMimeTypes: Array.isArray(record.allowedMimeTypes) && record.allowedMimeTypes.every((item) => typeof item === "string")
        ? record.allowedMimeTypes
        : ["application/pdf", "video/mp4", "image/png", "image/jpeg"],
    };
  }

  private async storeUpload(classId: string, materialId: string, upload: UploadedMaterialFile, quarantined = false): Promise<{ objectKey: string; checksum: string }> {
    if (upload.size !== upload.buffer.length) throw new BadRequestException("Kích thước tệp tải lên không khớp nội dung nhận được.");
    const safeExtension = extname(upload.originalName).toLowerCase().replace(/[^a-z0-9.]/g, "").slice(0, 12);
    const objectKey = `${quarantined ? "quarantine" : "files"}/${classId}/${materialId}${safeExtension}`;
    const target = this.resolveObjectPath(objectKey);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, upload.buffer, { flag: "wx" }).catch((error: unknown) => {
      if (typeof error === "object" && error !== null && "code" in error && error.code === "EEXIST") throw new ConflictException("Khóa lưu trữ học liệu đã tồn tại.");
      throw error;
    });
    return { objectKey, checksum: `sha256:${createHash("sha256").update(upload.buffer).digest("hex")}` };
  }

  private async writeStoredFile(objectKey: string, buffer: Buffer): Promise<void> {
    const target = this.resolveObjectPath(objectKey);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, buffer, { flag: "wx" }).catch((error: unknown) => {
      if (typeof error === "object" && error !== null && "code" in error && error.code === "EEXIST") throw new ConflictException("Tệp bằng chứng đã tồn tại trong kho lưu trữ.");
      throw error;
    });
  }

  private async removeStoredFile(objectKey: string): Promise<void> {
    await unlink(this.resolveObjectPath(objectKey)).catch((error: unknown) => {
      if (!(typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT")) throw error;
    });
  }

  private resolveObjectPath(objectKey: string): string {
    const root = resolve(this.config?.get("STORAGE_ROOT", { infer: true }) ?? "../TestDoAn-data");
    const target = resolve(root, objectKey);
    if (target !== root && !target.startsWith(`${root}${sep}`)) throw new BadRequestException("Đường dẫn lưu trữ không hợp lệ.");
    return target;
  }

  private signMaterialAccess(materialId: string, expires: number, action: MaterialAccessAction): string {
    const secret = this.config?.get("STORAGE_SIGNING_SECRET", { infer: true }) ?? "development-storage-signing-key-change-me";
    return createHmac("sha256", secret).update(`${materialId}.${expires}.${action}`).digest("base64url");
  }

  private signRecordingAccess(sessionId: string, expires: number, learnerId: string): string {
    const secret = this.config?.get("STORAGE_SIGNING_SECRET", { infer: true }) ?? "development-storage-signing-key-change-me";
    return createHmac("sha256", secret).update(`recording.${sessionId}.${learnerId}.${expires}`).digest("base64url");
  }

  private verifyExpiringSignature(expectedSignature: string, expires: number, signature: string, message: string): void {
    const current = Math.floor(Date.now() / 1000);
    if (!Number.isSafeInteger(expires) || expires < current || expires > current + 600) throw new BadRequestException("Liên kết đã hết hạn hoặc không hợp lệ.");
    const expected = Buffer.from(expectedSignature);
    const received = Buffer.from(signature);
    if (expected.length !== received.length || !timingSafeEqual(expected, received)) throw new BadRequestException(message);
  }

  private verifyMaterialAccess(materialId: string, expires: number, signature: string, action: MaterialAccessAction): void {
    const current = Math.floor(Date.now() / 1000);
    if (!Number.isSafeInteger(expires) || expires < current || expires > current + 600) throw new BadRequestException("Liên kết tải học liệu đã hết hạn hoặc không hợp lệ.");
    const expected = Buffer.from(this.signMaterialAccess(materialId, expires, action));
    const received = Buffer.from(signature);
    if (expected.length !== received.length || !timingSafeEqual(expected, received)) throw new BadRequestException("Chữ ký tải học liệu không hợp lệ.");
  }

  private userIdForRole(role: string): string {
    if (role === "SYSTEM_ADMIN") return "usr-admin";
    if (role === "CENTER_MANAGER") return "usr-manager";
    if (role === "INSTRUCTOR") return "usr-instructor";
    return "usr-learner";
  }

  private canAccessMemoryMaterial(material: LearningMaterial, role: string): boolean {
    const classItem = this.classes.find((item) => item.id === material.classId);
    if (!classItem) return false;
    if (role === "LEARNER") return material.visibility === "PUBLISHED" && classItem.learnerIds.includes("usr-learner");
    if (role === "INSTRUCTOR") return classItem.instructorIds.includes("usr-instructor");
    return true;
  }

  private assertMaterialClassAccess(classItem: { enrollments: Array<{ learnerId: string; status: string }>; instructors: Array<{ instructorId: string }> }, role: string): void {
    if (role === "LEARNER" && !classItem.enrollments.some((item) => item.learnerId === "usr-learner" && item.status === "ACTIVE")) throw new NotFoundException("Học viên không thuộc lớp chứa học liệu này.");
    if (role === "INSTRUCTOR" && !classItem.instructors.some((item) => item.instructorId === "usr-instructor")) throw new NotFoundException("Giảng viên không được phân công vào lớp chứa học liệu này.");
  }

  private assertMemoryMaterialClassAccess(classId: string, role: string): void {
    const classItem = this.findClass(classId);
    if (role === "LEARNER" && !classItem.learnerIds.includes("usr-learner")) throw new NotFoundException("Học viên không thuộc lớp chứa học liệu này.");
    if (role === "INSTRUCTOR" && !classItem.instructorIds.includes("usr-instructor")) throw new NotFoundException("Giảng viên không được phân công vào lớp chứa học liệu này.");
  }

  private examAvailability(exam: LearningExam, attemptCount: number, active: boolean, timestamp: Date): LearnerExamSummary["availabilityStatus"] {
    if (active) return "IN_PROGRESS";
    if (timestamp < new Date(exam.openAt)) return "UPCOMING";
    if (timestamp > new Date(exam.closeAt) || exam.status === "CLOSED") return "CLOSED";
    if (attemptCount >= exam.attemptLimit) return "ATTEMPT_LIMIT_REACHED";
    return "AVAILABLE";
  }

  private attemptDeadline(startedAt: Date, durationMinutes: number, examCloseAt: Date): Date {
    return new Date(Math.min(startedAt.getTime() + durationMinutes * 60_000, examCloseAt.getTime()));
  }

  private isMemoryAnswerCorrect(questionId: string, submitted: string[]): boolean {
    const question = this.questions.find((item) => item.id === questionId);
    return Boolean(question) && JSON.stringify([...submitted].sort()) === JSON.stringify([...(question?.correctAnswers ?? [])].sort());
  }

  private validateForumContent(value: string, label: string): string {
    const normalized = value.trim();
    if (/<\/?[a-z][^>]*>|javascript:|data:text\/html/i.test(normalized)) throw new BadRequestException(`${label} chứa HTML hoặc mã thực thi không được phép.`);
    return normalized;
  }

  private validateSupportText(value: string, label: string): string {
    const normalized = this.validateForumContent(value, label);
    const secretPatterns = [
      /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/i,
      /(?:password|passwd|mật\s*khẩu)\s*[:=]\s*\S+/i,
      /(?:access[_-]?token|api[_-]?key|secret)\s*[:=]\s*[A-Za-z0-9_\-./+=]{8,}/i,
      /(?:Bearer\s+)[A-Za-z0-9_\-.]{12,}/i,
    ];
    if (secretPatterns.some((pattern) => pattern.test(normalized))) {
      throw new BadRequestException(`${label} có dấu hiệu chứa mật khẩu, token hoặc khóa bí mật. Hãy xóa dữ liệu nhạy cảm trước khi gửi.`);
    }
    return normalized;
  }

  private validateSupportUpload(upload: UploadedMaterialFile): void {
    const allowedMimeTypes = new Set(["application/pdf", "image/png", "image/jpeg", "text/plain"]);
    if (upload.size !== upload.buffer.length) throw new BadRequestException("Kích thước tệp bằng chứng không khớp nội dung nhận được.");
    if (upload.size < 1 || upload.size > 10 * 1024 * 1024) throw new BadRequestException("Tệp bằng chứng phải có kích thước từ 1 byte đến 10 MB.");
    if (!allowedMimeTypes.has(upload.mimeType)) throw new BadRequestException("Chỉ chấp nhận bằng chứng PDF, PNG, JPEG hoặc TXT.");
    if (/\.(?:exe|dll|bat|cmd|ps1|js|html?)$/i.test(upload.originalName)) throw new BadRequestException("Loại tệp bằng chứng có nguy cơ thực thi không được phép.");
    if (upload.mimeType === "text/plain") this.validateSupportText(upload.buffer.toString("utf8"), "Tệp bằng chứng");
  }

  private detectMaliciousUpload(upload: UploadedMaterialFile): string | undefined {
    const head = upload.buffer.subarray(0, Math.min(upload.buffer.length, 8192));
    const text = head.toString("utf8");
    if (head[0] === 0x4d && head[1] === 0x5a) return "Phát hiện chữ ký tệp thực thi Windows (MZ).";
    if (text.includes("EICAR-STANDARD-ANTIVIRUS-TEST-FILE")) return "Phát hiện chữ ký kiểm thử antivirus EICAR.";
    if (/<script\b|javascript:/i.test(text)) return "Phát hiện nội dung script có khả năng thực thi.";
    if (/\.(?:exe|dll|bat|cmd|ps1|js|html?)$/i.test(upload.originalName)) return "Phần mở rộng tệp có khả năng thực thi.";
    return undefined;
  }

  private async enforceForumPolicy(database: PrismaService, authorId: string, content: string): Promise<void> {
    const policy = await database.moderationPolicy.findFirst({ orderBy: { version: "desc" } });
    const terms = this.toStringArray(policy?.prohibitedTerms ?? []);
    if (terms.some((term) => content.toLowerCase().includes(term.toLowerCase()))) throw new BadRequestException("Nội dung chứa từ khóa bị chính sách diễn đàn chặn.");
    const recentPosts = await database.forumPost.count({ where: { authorId, createdAt: { gte: new Date(Date.now() - 60_000) } } });
    if (recentPosts >= (policy?.maxPostsPerMinute ?? 5)) throw new BadRequestException("Bạn đã vượt giới hạn bài viết trong một phút.");
  }

  private enforceMemoryForumPolicy(authorId: string, content: string): void {
    if (this.moderationTerms().some((term) => content.toLowerCase().includes(term))) throw new BadRequestException("Nội dung chứa từ khóa bị chính sách diễn đàn chặn.");
    const recentPosts = this.posts.filter((item) => item.authorId === authorId && Date.now() - new Date(item.createdAt).getTime() <= 60_000).length;
    if (recentPosts >= 5) throw new BadRequestException("Bạn đã vượt giới hạn bài viết trong một phút.");
  }

  private moderationTerms(): string[] {
    return ["spam", "lừa đảo"];
  }

  private assertForumClassAccess(classItem: ClassWithMembers, role: string): void {
    if (role === "LEARNER" && !classItem.enrollments.some((item) => item.learnerId === "usr-learner" && item.status === "ACTIVE")) throw new NotFoundException("Không tìm thấy chủ đề trong lớp đã ghi danh.");
    if (role === "INSTRUCTOR" && !classItem.instructors.some((item) => item.instructorId === "usr-instructor")) throw new NotFoundException("Không tìm thấy chủ đề trong lớp được phân công.");
  }

  private assertMemoryForumClassAccess(classId: string, role: string): void {
    const classItem = this.findClass(classId);
    if (role === "LEARNER" && !classItem.learnerIds.includes("usr-learner")) throw new NotFoundException("Không tìm thấy chủ đề trong lớp đã ghi danh.");
    if (role === "INSTRUCTOR" && !classItem.instructorIds.includes("usr-instructor")) throw new NotFoundException("Không tìm thấy chủ đề trong lớp được phân công.");
  }

  private toStringArray(value: Prisma.JsonValue): string[] {
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
  }

  private findCourse(courseId: string): LearningCourse { const item = this.courses.find((course) => course.id === courseId); if (!item) throw new NotFoundException("Không tìm thấy khóa học."); return item; }
  private findClass(classId: string): LearningClass { const item = this.classes.find((candidate) => candidate.id === classId); if (!item) throw new NotFoundException("Không tìm thấy lớp học."); return item; }
  private findExam(examId: string): LearningExam { const item = this.exams.find((candidate) => candidate.id === examId); if (!item) throw new NotFoundException("Không tìm thấy đề."); return item; }
  private findAttempt(attemptId: string): ExamAttempt { const item = this.attempts.find((candidate) => candidate.id === attemptId); if (!item) throw new NotFoundException("Không tìm thấy lượt làm bài."); return item; }
  private findTopic(topicId: string): ForumTopic { const item = this.topics.find((candidate) => candidate.id === topicId); if (!item) throw new NotFoundException("Không tìm thấy chủ đề."); return item; }
  private findPost(postId: string): ForumPost { const item = this.posts.find((candidate) => candidate.id === postId); if (!item) throw new NotFoundException("Không tìm thấy bài viết."); return item; }
  private findReport(reportId: string): ContentReport { const item = this.reports.find((candidate) => candidate.id === reportId); if (!item) throw new NotFoundException("Không tìm thấy báo cáo."); return item; }
  private findSession(sessionId: string): LiveSession { const item = this.sessions.find((candidate) => candidate.id === sessionId); if (!item) throw new NotFoundException("Không tìm thấy buổi học."); return item; }
}
