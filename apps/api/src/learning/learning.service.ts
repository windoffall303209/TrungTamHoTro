import { BadRequestException, ConflictException, Injectable, NotFoundException, Optional } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { dirname, extname, resolve, sep } from "node:path";
import type { Prisma } from "../generated/prisma/client.js";
import type { Environment } from "../config/environment.js";
import { PrismaService } from "../database/prisma.service.js";
import type {
  AttendanceAppeal, AttendanceRecord, ContentReport, ExamAttempt, FileReviewRecord, ForumPost, ForumTopic, LearningClass, LearningNotification,
  LearnerExamSummary, LearnerResult, LearningCourse, LearningExam, LearningMaterial, LearningQuestion, LiveSession,
  RegradeRequest, SupportAttachment, SupportTicket, TicketComment,
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
type SupportTicketWithAttachments = Prisma.SupportTicketGetPayload<{ include: { attachments: true } }>;
export interface UploadedMaterialFile { originalName: string; mimeType: string; size: number; buffer: Buffer }
export interface MaterialDownload { fileName: string; mimeType: string; buffer: Buffer }
export type MaterialAccessAction = "PREVIEW" | "DOWNLOAD";
export interface MaterialSearchResult { items: LearningMaterial[]; total: number; page: number; pageSize: number; totalPages: number }

@Injectable()
export class LearningService {
  private readonly courses: LearningCourse[] = [
    { id: "course-web", code: "WEB-FULLSTACK", name: "Phát triển Web Full-stack", description: "Xây dựng ứng dụng web hiện đại từ giao diện đến API.", outcomes: ["Thiết kế giao diện responsive", "Xây dựng REST API", "Thiết kế cơ sở dữ liệu"], status: "PUBLISHED", version: 1, createdAt: now(), updatedAt: now() },
    { id: "course-data", code: "DATA-FOUNDATION", name: "Nền tảng dữ liệu", description: "Tổ chức, phân tích và trực quan hóa dữ liệu.", outcomes: ["Làm sạch dữ liệu", "Mô hình hóa dữ liệu"], status: "DRAFT", version: 1, createdAt: now(), updatedAt: now() },
  ];

  private readonly classes: LearningClass[] = [
    { id: "class-web-01", courseId: "course-web", code: "WEB-K01", name: "Web Full-stack K01", term: "2026-HK1", startAt: "2026-08-18T01:00:00.000Z", endAt: "2026-12-20T10:00:00.000Z", capacity: 40, status: "ACTIVE", instructorIds: ["usr-instructor"], learnerIds: ["usr-learner"] },
  ];

  private readonly materials: LearningMaterial[] = [
    { id: "mat-web-intro", classId: "class-web-01", name: "01 — Tổng quan kiến trúc Web.pdf", mimeType: "application/pdf", sizeBytes: 2_420_000, folder: "Tuần 1", tags: ["kiến trúc", "bắt đầu"], version: 1, visibility: "PUBLISHED", createdAt: now() },
    { id: "mat-api-guide", classId: "class-web-01", name: "02 — Thiết kế REST API.pdf", mimeType: "application/pdf", sizeBytes: 3_180_000, folder: "Tuần 2", tags: ["api", "backend"], version: 2, visibility: "PUBLISHED", createdAt: now() },
  ];

  private readonly questions: LearningQuestion[] = [
    { id: "q-rest-01", courseId: "course-web", type: "SINGLE_CHOICE", content: "HTTP method nào phù hợp để cập nhật một phần tài nguyên?", options: ["GET", "POST", "PATCH", "DELETE"], correctAnswers: ["PATCH"], difficulty: 1, tags: ["http", "api"], status: "PUBLISHED", version: 1 },
    { id: "q-db-01", courseId: "course-web", type: "TRUE_FALSE", content: "Khóa ngoại giúp duy trì tính toàn vẹn tham chiếu.", options: ["Đúng", "Sai"], correctAnswers: ["Đúng"], difficulty: 1, tags: ["database"], status: "PUBLISHED", version: 1 },
  ];

  private readonly exams: LearningExam[] = [
    { id: "exam-mid-web", classId: "class-web-01", title: "Kiểm tra giữa kỳ Web Full-stack", questionIds: ["q-rest-01", "q-db-01"], durationMinutes: 45, totalScore: 10, openAt: "2026-08-20T00:00:00.000Z", closeAt: "2026-12-30T23:59:00.000Z", attemptLimit: 2, status: "PUBLISHED" },
  ];

  private readonly attempts: ExamAttempt[] = [];
  private readonly regradeRequests: RegradeRequest[] = [];
  private readonly topics: ForumTopic[] = [
    { id: "topic-rest", classId: "class-web-01", title: "Thảo luận: REST hay GraphQL?", body: "Chia sẻ trường hợp bạn sẽ chọn REST hoặc GraphQL và lý do.", authorId: "usr-instructor", tags: ["api", "thảo luận"], isPinned: true, isLocked: false, createdAt: now() },
  ];
  private readonly posts: ForumPost[] = [
    { id: "post-rest-01", topicId: "topic-rest", authorId: "usr-learner", body: "Em chọn REST cho hệ thống CRUD vì dễ cache và theo dõi.", status: "VISIBLE", attachmentIds: [], mentionedUserIds: [], createdAt: now() },
  ];
  private readonly notifications: LearningNotification[] = [];
  private readonly reports: ContentReport[] = [];
  private readonly sessions: LiveSession[] = [
    { id: "session-web-01", classId: "class-web-01", title: "Thiết kế API có version", startsAt: "2026-08-26T02:00:00.000Z", endsAt: "2026-08-26T03:30:00.000Z", provider: "JITSI", status: "SCHEDULED", hostUrl: "https://meet.jit.si/wind-web-01-host", attendeeUrl: "https://meet.jit.si/wind-web-01" },
  ];
  private readonly attendance: AttendanceRecord[] = [];
  private readonly attendanceAppeals: AttendanceAppeal[] = [];
  private readonly tickets: SupportTicket[] = [];
  private readonly ticketComments: TicketComment[] = [];
  private readonly materialFiles = new Map<string, { objectKey: string; checksum: string }>();
  private readonly materialAccessLogs: Array<{ materialId: string; userId: string; action: MaterialAccessAction; createdAt: string }> = [];
  private readonly materialReviews: FileReviewRecord[] = [];

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
  async publishCourse(courseId: string): Promise<LearningCourse> {
    const prisma = this.database();
    if (prisma) {
      const course = await prisma.course.findUnique({ where: { id: courseId } });
      if (!course) throw new NotFoundException("Không tìm thấy khóa học.");
      if (!this.toStringArray(course.outcomes).length) throw new BadRequestException("Khóa học cần ít nhất một mục tiêu học tập.");
      return this.mapCourse(await prisma.course.update({
        where: { id: courseId },
        data: { status: "PUBLISHED", version: { increment: 1 } },
      }));
    }
    const course = this.findCourse(courseId);
    if (!course.outcomes.length) throw new BadRequestException("Khóa học cần ít nhất một mục tiêu học tập.");
    course.status = "PUBLISHED";
    course.version += 1;
    course.updatedAt = now();
    return { ...course, outcomes: [...course.outcomes] };
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

  async createClass(input: Omit<LearningClass, "id" | "status" | "instructorIds" | "learnerIds">): Promise<LearningClass> {
    const prisma = this.database();
    if (prisma) {
      const course = await prisma.course.findUnique({ where: { id: input.courseId } });
      if (!course || course.status !== "PUBLISHED") throw new BadRequestException("Khóa học phải được phát hành trước khi mở lớp.");
      if (new Date(input.endAt) <= new Date(input.startAt)) throw new BadRequestException("Ngày kết thúc phải sau ngày bắt đầu.");
      try {
        const row = await prisma.learningClass.create({
          data: {
            id: id("class"), courseId: input.courseId, code: input.code.trim().toUpperCase(),
            name: input.name.trim(), term: input.term.trim(), startAt: new Date(input.startAt),
            endAt: new Date(input.endAt), capacity: input.capacity,
          },
          include: { instructors: true, enrollments: true },
        });
        return this.mapClass(row);
      } catch (error) {
        if (isUniqueConstraintError(error)) throw new ConflictException("Mã lớp đã tồn tại.");
        throw error;
      }
    }
    if (!this.courses.some((course) => course.id === input.courseId && course.status === "PUBLISHED")) throw new BadRequestException("Khóa học phải được phát hành trước khi mở lớp.");
    if (new Date(input.endAt) <= new Date(input.startAt)) throw new BadRequestException("Ngày kết thúc phải sau ngày bắt đầu.");
    if (this.classes.some((item) => item.code === input.code)) throw new ConflictException("Mã lớp đã tồn tại.");
    const item: LearningClass = { ...input, id: id("class"), status: "DRAFT", instructorIds: [], learnerIds: [] }; this.classes.unshift(item); return { ...item, instructorIds: [], learnerIds: [] };
  }
  async assignInstructor(classId: string, instructorId: string): Promise<LearningClass> {
    const prisma = this.database();
    if (prisma) {
      await this.requireUserRole(prisma, instructorId, "INSTRUCTOR", "Người dùng được chọn không phải giảng viên.");
      const classItem = await prisma.learningClass.findUnique({ where: { id: classId } });
      if (!classItem) throw new NotFoundException("Không tìm thấy lớp học.");
      await prisma.classInstructor.upsert({
        where: { classId_instructorId: { classId, instructorId } }, update: {}, create: { classId, instructorId },
      });
      return this.getDatabaseClass(prisma, classId);
    }
    const item = this.findClass(classId);
    if (!item.instructorIds.includes(instructorId)) item.instructorIds.push(instructorId);
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
        if (classItem.enrollments.some((row) => row.learnerId === learnerId)) throw new ConflictException("Học viên đã có trong lớp.");
        if (classItem.enrollments.length >= classItem.capacity) throw new BadRequestException("Lớp đã đủ sĩ số.");
        await transaction.classEnrollment.upsert({
          where: { classId_learnerId: { classId, learnerId } },
          update: { status: "ACTIVE", joinedAt: new Date() },
          create: { classId, learnerId, status: "ACTIVE" },
        });
        return this.getDatabaseClass(transaction, classId);
      });
    }
    const item = this.findClass(classId);
    if (item.learnerIds.includes(learnerId)) throw new ConflictException("Học viên đã có trong lớp.");
    if (item.learnerIds.length >= item.capacity) throw new BadRequestException("Lớp đã đủ sĩ số.");
    item.learnerIds.push(learnerId);
    return { ...item, instructorIds: [...item.instructorIds], learnerIds: [...item.learnerIds] };
  }

  async activateClass(classId: string): Promise<LearningClass> {
    const prisma = this.database();
    if (prisma) {
      const item = await this.getDatabaseClass(prisma, classId);
      if (!item.instructorIds.length) throw new BadRequestException("Cần phân công ít nhất một giảng viên trước khi kích hoạt.");
      await prisma.learningClass.update({ where: { id: classId }, data: { status: "ACTIVE" } });
      return this.getDatabaseClass(prisma, classId);
    }
    const item = this.findClass(classId);
    if (!item.instructorIds.length) throw new BadRequestException("Cần phân công ít nhất một giảng viên trước khi kích hoạt.");
    item.status = "ACTIVE";
    return { ...item, instructorIds: [...item.instructorIds], learnerIds: [...item.learnerIds] };
  }

  async closeClass(classId: string): Promise<LearningClass> {
    const prisma = this.database();
    if (prisma) {
      const current = await prisma.learningClass.findUnique({ where: { id: classId } });
      if (!current) throw new NotFoundException("Không tìm thấy lớp học.");
      if (current.status !== "ACTIVE") throw new BadRequestException("Chỉ lớp đang hoạt động mới có thể đóng.");
      await prisma.learningClass.update({ where: { id: classId }, data: { status: "CLOSED" } });
      return this.getDatabaseClass(prisma, classId);
    }
    const item = this.findClass(classId);
    if (item.status !== "ACTIVE") throw new BadRequestException("Chỉ lớp đang hoạt động mới có thể đóng.");
    item.status = "CLOSED";
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
    this.findClass(classId);
    const item: LearningMaterial = { ...input, id: id("material"), classId, version: 1, visibility: quarantineReason ? "HIDDEN" : "DRAFT", quarantinedAt: quarantineReason ? now() : undefined, quarantineReason, createdAt: now() };
    if (upload) {
      const stored = await this.storeUpload(classId, item.id, upload, Boolean(quarantineReason));
      this.materialFiles.set(item.id, { objectKey: stored.objectKey, checksum: stored.checksum });
    }
    this.materials.unshift(item);
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
      const current = await prisma.material.findUnique({ where: { id: materialId } });
      if (!current) throw new NotFoundException("Không tìm thấy học liệu.");
      if (current.quarantinedAt && input.visibility === "PUBLISHED") throw new BadRequestException("Không thể phát hành tệp đang bị cách ly.");
      return this.mapMaterial(await prisma.material.update({
        where: { id: materialId },
        data: { folder: input.folder?.trim(), tags: input.tags, visibility: input.visibility, version: { increment: 1 } },
      }));
    }
    const item = this.materials.find((material) => material.id === materialId);
    if (!item) throw new NotFoundException("Không tìm thấy học liệu.");
    if (item.quarantinedAt && input.visibility === "PUBLISHED") throw new BadRequestException("Không thể phát hành tệp đang bị cách ly.");
    Object.assign(item, input);
    item.version += 1;
    return { ...item, tags: [...item.tags] };
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

  async listQuestions(query?: string): Promise<LearningQuestion[]> {
    const normalized = query?.toLowerCase() ?? "";
    const prisma = this.database();
    if (prisma) {
      const rows = await prisma.question.findMany({ orderBy: { createdAt: "desc" } });
      return rows.map((row) => this.mapQuestion(row)).filter((item) => !normalized || `${item.content} ${item.tags.join(" ")}`.toLowerCase().includes(normalized));
    }
    return this.questions.filter((item) => !normalized || `${item.content} ${item.tags.join(" ")}`.toLowerCase().includes(normalized)).map((item) => ({ ...item, options: [...item.options], correctAnswers: [...item.correctAnswers], tags: [...item.tags] }));
  }

  async createQuestion(input: Omit<LearningQuestion, "id" | "status" | "version">): Promise<LearningQuestion> {
    if (["SINGLE_CHOICE", "MULTIPLE_CHOICE", "TRUE_FALSE"].includes(input.type) && !input.correctAnswers.length) throw new BadRequestException("Câu hỏi trắc nghiệm cần đáp án đúng.");
    const prisma = this.database();
    if (prisma) {
      const course = await prisma.course.findUnique({ where: { id: input.courseId } });
      if (!course) throw new NotFoundException("Không tìm thấy khóa học.");
      return this.mapQuestion(await prisma.question.create({
        data: {
          id: id("question"), courseId: input.courseId, authorId: "usr-instructor",
          type: input.type, content: input.content.trim(), options: input.options,
          correctAnswers: input.correctAnswers, difficulty: input.difficulty, tags: input.tags,
        },
      }));
    }
    const item: LearningQuestion = { ...input, id: id("question"), status: "DRAFT", version: 1 };
    this.questions.unshift(item);
    return { ...item, options: [...item.options], correctAnswers: [...item.correctAnswers], tags: [...item.tags] };
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

  async createExam(input: Omit<LearningExam, "id" | "status">): Promise<LearningExam> {
    if (new Date(input.closeAt) <= new Date(input.openAt)) throw new BadRequestException("Thời gian đóng đề phải sau thời gian mở.");
    if (!input.questionIds.length) throw new BadRequestException("Đề cần ít nhất một câu hỏi.");
    const prisma = this.database();
    if (prisma) {
      return prisma.$transaction(async (transaction) => {
        const classItem = await transaction.learningClass.findUnique({ where: { id: input.classId } });
        if (!classItem) throw new NotFoundException("Không tìm thấy lớp học.");
        if (new Set(input.questionIds).size !== input.questionIds.length) throw new BadRequestException("Danh sách đề không được chứa câu hỏi trùng.");
        const questionCount = await transaction.question.count({ where: { id: { in: input.questionIds } } });
        if (questionCount !== input.questionIds.length) throw new BadRequestException("Danh sách đề chứa câu hỏi không tồn tại.");
        const exam = await transaction.exam.create({
          data: {
            id: id("exam"), classId: input.classId, title: input.title.trim(),
            durationMinutes: input.durationMinutes, totalScore: input.totalScore,
            openAt: new Date(input.openAt), closeAt: new Date(input.closeAt), attemptLimit: input.attemptLimit,
          },
        });
        const scorePerQuestion = input.totalScore / input.questionIds.length;
        await transaction.examQuestion.createMany({
          data: input.questionIds.map((questionId, position) => ({ examId: exam.id, questionId, position: position + 1, score: scorePerQuestion })),
        });
        return this.getDatabaseExam(transaction, exam.id);
      });
    }
    this.findClass(input.classId);
    const item: LearningExam = { ...input, id: id("exam"), status: "DRAFT" };
    this.exams.unshift(item);
    return { ...item, questionIds: [...item.questionIds] };
  }

  async publishExam(examId: string): Promise<LearningExam> {
    const prisma = this.database();
    if (prisma) {
      const exam = await this.getDatabaseExam(prisma, examId);
      if (!exam.questionIds.length) throw new BadRequestException("Đề cần ít nhất một câu hỏi.");
      await prisma.exam.update({ where: { id: examId }, data: { status: "PUBLISHED" } });
      return this.getDatabaseExam(prisma, examId);
    }
    const item = this.findExam(examId);
    item.status = "PUBLISHED";
    return { ...item, questionIds: [...item.questionIds] };
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
    return { ...item, answers: { ...item.answers } };
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

  async gradeAttempt(attemptId: string, score: number, feedback: string): Promise<ExamAttempt> {
    const prisma = this.database();
    if (prisma) {
      const attempt = await prisma.examAttempt.findUnique({ where: { id: attemptId }, include: { exam: true } });
      if (!attempt) throw new NotFoundException("Không tìm thấy lượt làm bài.");
      if (score > Number(attempt.exam.totalScore)) throw new BadRequestException("Điểm không được vượt tổng điểm của đề.");
      return this.mapAttempt(await prisma.examAttempt.update({
        where: { id: attemptId }, data: { score, feedback: feedback.trim(), status: "GRADED", gradePublishedAt: new Date() }, include: { answers: true },
      }));
    }
    const item = this.findAttempt(attemptId);
    const exam = this.findExam(item.examId);
    if (score > exam.totalScore) throw new BadRequestException("Điểm không được vượt tổng điểm của đề.");
    item.score = score;
    item.feedback = feedback.trim();
    item.status = "GRADED";
    item.gradePublishedAt = now();
    return { ...item, answers: { ...item.answers } };
  }

  async listTopics(role = "LEARNER"): Promise<ForumTopic[]> {
    const prisma = this.database();
    if (prisma) {
      const rows = await prisma.forumTopic.findMany({
        where: role === "LEARNER"
          ? { class: { enrollments: { some: { learnerId: "usr-learner", status: "ACTIVE" } } } }
          : role === "INSTRUCTOR"
            ? { class: { instructors: { some: { instructorId: "usr-instructor" } } } }
            : undefined,
        orderBy: [{ isPinned: "desc" }, { createdAt: "desc" }],
      });
      return rows.map((row) => this.mapTopic(row));
    }
    return this.topics.filter((item) => {
      const classItem = this.classes.find((candidate) => candidate.id === item.classId);
      if (role === "LEARNER") return classItem?.learnerIds.includes("usr-learner");
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
      if (authorId === "usr-learner" && !classItem.enrollments.some((item) => item.learnerId === authorId && item.status === "ACTIVE")) throw new NotFoundException("Học viên không thuộc lớp này.");
      if (authorId === "usr-instructor" && !classItem.instructors.some((item) => item.instructorId === authorId)) throw new NotFoundException("Giảng viên chưa được phân công vào lớp này.");
      await this.enforceForumPolicy(prisma, authorId, `${safeTitle} ${safeBody}`);
      return this.mapTopic(await prisma.forumTopic.create({
        data: {
          id: id("topic"), classId, authorId, title: safeTitle, body: safeBody,
          tags: input.tags, isPinned: input.isPinned,
        },
      }));
    }
    const classItem = this.findClass(classId);
    if (authorId === "usr-learner" && !classItem.learnerIds.includes(authorId)) throw new NotFoundException("Học viên không thuộc lớp này.");
    if (authorId === "usr-instructor" && !classItem.instructorIds.includes(authorId)) throw new NotFoundException("Giảng viên chưa được phân công vào lớp này.");
    this.enforceMemoryForumPolicy(authorId, `${safeTitle} ${safeBody}`);
    const item: ForumTopic = { ...input, title: safeTitle, body: safeBody, id: id("topic"), classId, authorId, isLocked: false, createdAt: now() };
    this.topics.unshift(item);
    return { ...item, tags: [...item.tags] };
  }

  async listPosts(topicId: string, role = "LEARNER"): Promise<ForumPost[]> {
    const prisma = this.database();
    if (prisma) {
      const topic = await prisma.forumTopic.findUnique({ where: { id: topicId }, include: { class: { include: { enrollments: true, instructors: true } } } });
      if (!topic) throw new NotFoundException("Không tìm thấy chủ đề.");
      this.assertForumClassAccess(topic.class, role);
      const rows = await prisma.forumPost.findMany({ where: { topicId }, include: { attachments: true, mentions: true }, orderBy: { createdAt: "asc" } });
      return rows.map((row) => this.mapPost(row));
    }
    const topic = this.findTopic(topicId);
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
      if (!topic.class.enrollments.some((item) => item.learnerId === authorId && item.status === "ACTIVE")) throw new NotFoundException("Học viên không thuộc lớp của chủ đề.");
      await this.enforceForumPolicy(prisma, authorId, safeBody);
      if (parentId) {
        const parent = await prisma.forumPost.findFirst({ where: { id: parentId, topicId } });
        if (!parent) throw new BadRequestException("Bài cha không hợp lệ.");
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
    const classItem = this.findClass(topic.classId);
    if (!classItem.learnerIds.includes(authorId)) throw new NotFoundException("Học viên không thuộc lớp của chủ đề.");
    this.enforceMemoryForumPolicy(authorId, safeBody);
    if (parentId && !this.posts.some((item) => item.id === parentId && item.topicId === topicId)) throw new BadRequestException("Bài cha không hợp lệ.");
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

  async reportContent(input: Omit<ContentReport, "id" | "status">): Promise<ContentReport> {
    const prisma = this.database();
    if (prisma) {
      const targetExists = input.targetType === "POST"
        ? Boolean(await prisma.forumPost.findFirst({ where: { id: input.targetId, topic: { class: { enrollments: { some: { learnerId: input.reporterId, status: "ACTIVE" } } } } }, select: { id: true } }))
        : Boolean(await prisma.forumTopic.findFirst({ where: { id: input.targetId, class: { enrollments: { some: { learnerId: input.reporterId, status: "ACTIVE" } } } }, select: { id: true } }));
      if (!targetExists) throw new NotFoundException("Không tìm thấy nội dung cần báo cáo.");
      try {
        return this.mapReport(await prisma.contentReport.create({
          data: { id: id("report"), ...input },
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
    const item: ContentReport = { ...input, id: id("report"), status: "OPEN" };
    this.reports.unshift(item);
    return { ...item };
  }

  async listReports(): Promise<ContentReport[]> {
    const prisma = this.database();
    if (prisma) {
      const rows = await prisma.contentReport.findMany({ orderBy: { createdAt: "desc" } });
      return rows.map((row) => this.mapReport(row));
    }
    return this.reports.map((item) => ({ ...item }));
  }

  async listLearnerReports(learnerId = "usr-learner"): Promise<ContentReport[]> {
    const prisma = this.database();
    if (prisma) {
      const rows = await prisma.contentReport.findMany({ where: { reporterId: learnerId }, orderBy: { createdAt: "desc" } });
      return rows.map((row) => this.mapReport(row));
    }
    return this.reports.filter((item) => item.reporterId === learnerId).map((item) => ({ ...item }));
  }

  async resolveReport(reportId: string, status: "RESOLVED" | "REJECTED", resolution: string): Promise<ContentReport> {
    const prisma = this.database();
    if (prisma) {
      return prisma.$transaction(async (transaction) => {
        const item = await transaction.contentReport.findUnique({ where: { id: reportId } });
        if (!item) throw new NotFoundException("Không tìm thấy báo cáo.");
        if (item.status !== "OPEN") throw new ConflictException("Báo cáo đã được xử lý trước đó.");
        if (status === "RESOLVED" && item.targetType === "POST") {
          await transaction.forumPost.updateMany({ where: { id: item.targetId }, data: { status: "ARCHIVED" } });
        }
        return this.mapReport(await transaction.contentReport.update({
          where: { id: reportId }, data: { status, resolution: resolution.trim() },
        }));
      });
    }
    const item = this.reports.find((report) => report.id === reportId);
    if (!item) throw new NotFoundException("Không tìm thấy báo cáo.");
    item.status = status;
    item.resolution = resolution;
    if (status === "RESOLVED" && item.targetType === "POST") {
      const post = this.posts.find((candidate) => candidate.id === item.targetId);
      if (post) post.status = "HIDDEN";
    }
    return { ...item };
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

  async createSession(classId: string, input: Pick<LiveSession, "title" | "startsAt" | "endsAt" | "provider">): Promise<LiveSession> {
    if (new Date(input.endsAt) <= new Date(input.startsAt)) throw new BadRequestException("Thời gian kết thúc phải sau thời gian bắt đầu.");
    const prisma = this.database();
    if (prisma) {
      const classItem = await prisma.learningClass.findUnique({ where: { id: classId }, include: { instructors: true } });
      if (!classItem) throw new NotFoundException("Không tìm thấy lớp học.");
      if (!classItem.instructors.some((item) => item.instructorId === "usr-instructor")) throw new NotFoundException("Giảng viên chưa được phân công vào lớp này.");
      const overlaps = await prisma.liveSession.count({
        where: {
          classId, status: { not: "CANCELLED" },
          startsAt: { lt: new Date(input.endsAt) }, endsAt: { gt: new Date(input.startsAt) },
        },
      });
      if (overlaps) throw new ConflictException("Lịch học bị trùng.");
      const token = randomUUID();
      return this.mapSession(await prisma.liveSession.create({
        data: {
          id: id("session"), classId, hostId: "usr-instructor", title: input.title.trim(),
          startsAt: new Date(input.startsAt), endsAt: new Date(input.endsAt), provider: input.provider,
          hostUrl: `https://meet.jit.si/${token}-host`, attendeeUrl: `https://meet.jit.si/${token}`,
        },
      }));
    }
    const classItem = this.findClass(classId);
    if (!classItem.instructorIds.includes("usr-instructor")) throw new NotFoundException("Giảng viên chưa được phân công vào lớp này.");
    const overlaps = this.sessions.some((item) => item.classId === classId && item.status !== "CANCELLED" && new Date(input.startsAt) < new Date(item.endsAt) && new Date(input.endsAt) > new Date(item.startsAt));
    if (overlaps) throw new ConflictException("Lịch học bị trùng.");
    const token = randomUUID();
    const item: LiveSession = { ...input, id: id("session"), classId, status: "SCHEDULED", hostUrl: `https://meet.jit.si/${token}-host`, attendeeUrl: `https://meet.jit.si/${token}` };
    this.sessions.unshift(item);
    return { ...item };
  }

  async transitionSession(sessionId: string, status: LiveSession["status"]): Promise<LiveSession> {
    const allowed: Record<LiveSession["status"], LiveSession["status"][]> = { SCHEDULED: ["LIVE", "CANCELLED"], LIVE: ["COMPLETED"], COMPLETED: [], CANCELLED: [] };
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
    const prisma = this.database();
    if (prisma) {
      const session = await prisma.liveSession.findUnique({ where: { id: sessionId } });
      if (!session) throw new NotFoundException("Không tìm thấy buổi học.");
      const enrollment = await prisma.classEnrollment.findFirst({ where: { classId: session.classId, learnerId, status: "ACTIVE" } });
      if (!enrollment) throw new BadRequestException("Học viên không thuộc lớp.");
      const row = await prisma.attendanceRecord.upsert({
        where: { sessionId_learnerId: { sessionId, learnerId } },
        update: { status, attendedMinutes, adjustmentReason: adjustmentReason.trim() },
        create: { sessionId, learnerId, status, attendedMinutes, adjustmentReason: adjustmentReason.trim() },
      });
      return this.mapAttendance(row);
    }
    this.findSession(sessionId);
    let record = this.attendance.find((item) => item.sessionId === sessionId && item.learnerId === learnerId);
    if (!record) {
      record = { sessionId, learnerId, attendedMinutes, status, adjustmentReason };
      this.attendance.push(record);
    } else Object.assign(record, { status, attendedMinutes, adjustmentReason });
    return { ...record };
  }

  async attachRecording(sessionId: string, recordingUrl: string): Promise<LiveSession> {
    const prisma = this.database();
    if (prisma) {
      const item = await prisma.liveSession.findUnique({ where: { id: sessionId } });
      if (!item) throw new NotFoundException("Không tìm thấy buổi học.");
      if (item.status !== "COMPLETED") throw new BadRequestException("Chỉ gắn bản ghi sau khi buổi học kết thúc.");
      return this.mapSession(await prisma.liveSession.update({ where: { id: sessionId }, data: { recordingUrl } }));
    }
    const item = this.findSession(sessionId);
    if (item.status !== "COMPLETED") throw new BadRequestException("Chỉ gắn bản ghi sau khi buổi học kết thúc.");
    item.recordingUrl = recordingUrl;
    return { ...item };
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
      return { session: { ...mapped, hostUrl: "", attendeeUrl: "", recordingUrl: undefined }, recordingAvailable: Boolean(session.recordingUrl), attendance: attendance ? this.mapAttendance(attendance) : { sessionId, learnerId, attendedMinutes: 0, status: "ABSENT" }, appeal: appeal ? this.mapAttendanceAppeal(appeal) : undefined };
    }
    const session = this.findSession(sessionId);
    if (!this.findClass(session.classId).learnerIds.includes(learnerId)) throw new NotFoundException("Học viên không thuộc lớp của buổi học.");
    return { session: { ...session, hostUrl: "", attendeeUrl: "", recordingUrl: undefined }, recordingAvailable: Boolean(session.recordingUrl), attendance: this.attendance.find((item) => item.sessionId === sessionId && item.learnerId === learnerId) ?? { sessionId, learnerId, attendedMinutes: 0, status: "ABSENT" }, appeal: this.attendanceAppeals.find((item) => item.sessionId === sessionId && item.learnerId === learnerId) };
  }

  async createRecordingAccess(sessionId: string, learnerId = "usr-learner"): Promise<{ url: string; expiresAt: string }> {
    const prisma = this.database();
    if (prisma) {
      const session = await prisma.liveSession.findFirst({ where: { id: sessionId, status: "COMPLETED", recordingUrl: { not: null }, class: { enrollments: { some: { learnerId, status: "ACTIVE" } } } } });
      if (!session) throw new NotFoundException("Bản ghi chưa sẵn sàng hoặc học viên không có quyền xem.");
    } else {
      const session = this.findSession(sessionId);
      if (session.status !== "COMPLETED" || !session.recordingUrl || !this.findClass(session.classId).learnerIds.includes(learnerId)) throw new NotFoundException("Bản ghi chưa sẵn sàng hoặc học viên không có quyền xem.");
    }
    const expires = Math.floor(Date.now() / 1000) + 300;
    const signature = this.signRecordingAccess(sessionId, expires, learnerId);
    return { url: `/learner/sessions/${sessionId}/recording?expires=${expires}&signature=${encodeURIComponent(signature)}`, expiresAt: new Date(expires * 1000).toISOString() };
  }

  async resolveRecordingAccess(sessionId: string, expires: number, signature: string, learnerId = "usr-learner"): Promise<{ recordingUrl: string }> {
    this.verifyExpiringSignature(this.signRecordingAccess(sessionId, expires, learnerId), expires, signature, "Chữ ký bản ghi không hợp lệ.");
    const prisma = this.database();
    if (prisma) {
      const session = await prisma.liveSession.findFirst({ where: { id: sessionId, status: "COMPLETED", recordingUrl: { not: null }, class: { enrollments: { some: { learnerId, status: "ACTIVE" } } } } });
      if (!session?.recordingUrl) throw new NotFoundException("Bản ghi chưa sẵn sàng hoặc học viên không có quyền xem.");
      return { recordingUrl: session.recordingUrl };
    }
    const session = this.findSession(sessionId);
    if (session.status !== "COMPLETED" || !session.recordingUrl || !this.findClass(session.classId).learnerIds.includes(learnerId)) throw new NotFoundException("Bản ghi chưa sẵn sàng hoặc học viên không có quyền xem.");
    return { recordingUrl: session.recordingUrl };
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

  async getOperationalReport(): Promise<object> {
    const prisma = this.database();
    if (prisma) {
      const [courses, classes, activeClasses, learnerRows, materials, publishedMaterials, questions, exams, liveSessions, openReports, openTickets] = await prisma.$transaction([
        prisma.course.count(),
        prisma.learningClass.count(),
        prisma.learningClass.count({ where: { status: "ACTIVE" } }),
        prisma.classEnrollment.findMany({ where: { status: "ACTIVE" }, distinct: ["learnerId"], select: { learnerId: true } }),
        prisma.material.count(),
        prisma.material.count({ where: { visibility: "PUBLISHED" } }),
        prisma.question.count(),
        prisma.exam.count(),
        prisma.liveSession.count(),
        prisma.contentReport.count({ where: { status: "OPEN" } }),
        prisma.supportTicket.count({ where: { status: { in: ["OPEN", "IN_PROGRESS"] } } }),
      ]);
      return { courses, classes, activeClasses, learners: learnerRows.length, materials, publishedMaterials, questions, exams, liveSessions, openReports, openTickets, generatedAt: now() };
    }
    const classes = this.classes.filter((item) => item.status === "ACTIVE").length;
    const materials = this.materials.filter((item) => item.visibility === "PUBLISHED").length;
    return { courses: this.courses.length, classes, activeClasses: classes, learners: new Set(this.classes.flatMap((item) => item.learnerIds)).size, materials, publishedMaterials: materials, questions: this.questions.length, exams: this.exams.length, liveSessions: this.sessions.length, openReports: this.reports.filter((item) => item.status === "OPEN").length, openTickets: this.tickets.filter((item) => !["RESOLVED", "CLOSED"].includes(item.status)).length, generatedAt: now() };
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
      code: row.code,
      name: row.name,
      term: row.term,
      startAt: row.startAt.toISOString(),
      endAt: row.endAt.toISOString(),
      capacity: row.capacity,
      status: row.status,
      instructorIds: row.instructors.map(({ instructorId }) => instructorId),
      learnerIds: row.enrollments.map(({ learnerId }) => learnerId),
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
    };
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
      status: row.status,
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
    };
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
    };
  }

  private mapReport(row: Prisma.ContentReportGetPayload<Record<string, never>>): ContentReport {
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
    };
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
      status: row.status,
      hostUrl: row.hostUrl,
      attendeeUrl: row.attendeeUrl,
      recordingUrl: row.recordingUrl ?? undefined,
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
  private findSession(sessionId: string): LiveSession { const item = this.sessions.find((candidate) => candidate.id === sessionId); if (!item) throw new NotFoundException("Không tìm thấy buổi học."); return item; }
}
