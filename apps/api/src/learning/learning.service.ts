import { BadRequestException, ConflictException, Injectable, NotFoundException, Optional } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { dirname, extname, resolve, sep } from "node:path";
import type { Prisma } from "../generated/prisma/client.js";
import type { Environment } from "../config/environment.js";
import { PrismaService } from "../database/prisma.service.js";
import type {
  AttendanceRecord, ContentReport, ExamAttempt, ForumPost, ForumTopic, LearningClass,
  LearningCourse, LearningExam, LearningMaterial, LearningQuestion, LiveSession, SupportTicket,
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
export interface UploadedMaterialFile { originalName: string; mimeType: string; size: number; buffer: Buffer }
export interface MaterialDownload { fileName: string; mimeType: string; buffer: Buffer }
export type MaterialAccessAction = "PREVIEW" | "DOWNLOAD";

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
  private readonly topics: ForumTopic[] = [
    { id: "topic-rest", classId: "class-web-01", title: "Thảo luận: REST hay GraphQL?", body: "Chia sẻ trường hợp bạn sẽ chọn REST hoặc GraphQL và lý do.", authorId: "usr-instructor", tags: ["api", "thảo luận"], isPinned: true, isLocked: false, createdAt: now() },
  ];
  private readonly posts: ForumPost[] = [
    { id: "post-rest-01", topicId: "topic-rest", authorId: "usr-learner", body: "Em chọn REST cho hệ thống CRUD vì dễ cache và theo dõi.", status: "VISIBLE", createdAt: now() },
  ];
  private readonly reports: ContentReport[] = [];
  private readonly sessions: LiveSession[] = [
    { id: "session-web-01", classId: "class-web-01", title: "Thiết kế API có version", startsAt: "2026-08-26T02:00:00.000Z", endsAt: "2026-08-26T03:30:00.000Z", provider: "JITSI", status: "SCHEDULED", hostUrl: "https://meet.jit.si/wind-web-01-host", attendeeUrl: "https://meet.jit.si/wind-web-01" },
  ];
  private readonly attendance: AttendanceRecord[] = [];
  private readonly tickets: SupportTicket[] = [];
  private readonly materialFiles = new Map<string, { objectKey: string; checksum: string }>();
  private readonly materialAccessLogs: Array<{ materialId: string; userId: string; action: MaterialAccessAction; createdAt: string }> = [];

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
        where: role === "LEARNER" ? { visibility: "PUBLISHED" } : undefined,
        orderBy: { createdAt: "desc" },
      });
      return rows.map((row) => this.mapMaterial(row)).filter((item) => !normalized || `${item.name} ${item.folder} ${item.tags.join(" ")}`.toLowerCase().includes(normalized));
    }
    return this.materials.filter((item) => role !== "LEARNER" || item.visibility === "PUBLISHED").filter((item) => !normalized || `${item.name} ${item.tags.join(" ")}`.toLowerCase().includes(normalized)).map((item) => ({ ...item, tags: [...item.tags] }));
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
    if (prisma) {
      const classItem = await prisma.learningClass.findUnique({ where: { id: classId } });
      if (!classItem) throw new NotFoundException("Không tìm thấy lớp học.");
      const usage = await prisma.material.aggregate({ _sum: { sizeBytes: true } });
      if ((usage._sum.sizeBytes ?? 0n) + BigInt(input.sizeBytes) > BigInt(policy.storageQuotaMb) * 1_000_000n) throw new BadRequestException("Kho lưu trữ đã vượt quota hệ thống.");
      const materialId = id("material");
      const stored = upload ? await this.storeUpload(classId, materialId, upload) : { objectKey: `metadata/${classId}/${materialId}`, checksum: undefined };
      try {
        return this.mapMaterial(await prisma.material.create({
          data: {
            id: materialId, classId, ownerId: "usr-instructor", name: input.name.trim(),
            objectKey: stored.objectKey, checksum: stored.checksum, mimeType: input.mimeType,
            sizeBytes: BigInt(input.sizeBytes), folder: input.folder.trim(), tags: input.tags,
          },
        }));
      } catch (error) {
        if (upload) await this.removeStoredFile(stored.objectKey);
        throw error;
      }
    }
    this.findClass(classId);
    const item: LearningMaterial = { ...input, id: id("material"), classId, version: 1, visibility: "DRAFT", createdAt: now() };
    if (upload) {
      const stored = await this.storeUpload(classId, item.id, upload);
      this.materialFiles.set(item.id, { objectKey: stored.objectKey, checksum: stored.checksum });
    }
    this.materials.unshift(item);
    return { ...item, tags: [...item.tags] };
  }

  async createMaterialAccess(materialId: string, role: string, action: MaterialAccessAction = "DOWNLOAD"): Promise<{ url: string; expiresAt: string }> {
    const prisma = this.database();
    if (prisma) {
      const material = await prisma.material.findUnique({
        where: { id: materialId }, include: { class: { include: { enrollments: true } } },
      });
      if (!material) throw new NotFoundException("Không tìm thấy học liệu.");
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
      return this.mapMaterial(await prisma.material.update({
        where: { id: materialId },
        data: { folder: input.folder?.trim(), tags: input.tags, visibility: input.visibility, version: { increment: 1 } },
      }));
    }
    const item = this.materials.find((material) => material.id === materialId);
    if (!item) throw new NotFoundException("Không tìm thấy học liệu.");
    Object.assign(item, input);
    item.version += 1;
    return { ...item, tags: [...item.tags] };
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

  async getExamQuestions(examId: string): Promise<LearningQuestion[]> {
    const prisma = this.database();
    if (prisma) {
      const exam = await prisma.exam.findUnique({
        where: { id: examId }, include: { questions: { include: { question: true }, orderBy: { position: "asc" } } },
      });
      if (!exam) throw new NotFoundException("Không tìm thấy đề.");
      if (exam.status !== "PUBLISHED") throw new BadRequestException("Đề chưa được phát hành.");
      return exam.questions.map(({ question }) => ({ ...this.mapQuestion(question), correctAnswers: [] }));
    }
    const exam = this.findExam(examId);
    if (exam.status !== "PUBLISHED") throw new BadRequestException("Đề chưa được phát hành.");
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
        const exam = await transaction.exam.findUnique({ where: { id: examId } });
        if (!exam) throw new NotFoundException("Không tìm thấy đề.");
        if (exam.status !== "PUBLISHED") throw new BadRequestException("Đề chưa được phát hành.");
        const timestamp = new Date();
        if (timestamp < exam.openAt || timestamp > exam.closeAt) throw new BadRequestException("Đề chưa mở hoặc đã đóng.");
        const attempts = await transaction.examAttempt.findMany({
          where: { examId, learnerId }, include: { answers: true }, orderBy: { attemptNo: "asc" },
        });
        const existing = attempts.find((item) => item.status === "IN_PROGRESS");
        if (existing) return this.mapAttempt(existing);
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
    const attempts = this.attempts.filter((item) => item.examId === examId && item.learnerId === learnerId);
    if (attempts.length >= exam.attemptLimit) throw new BadRequestException("Đã hết số lần làm bài.");
    const existing = attempts.find((item) => item.status === "IN_PROGRESS");
    if (existing) return { ...existing, answers: { ...existing.answers } };
    const item: ExamAttempt = { id: id("attempt"), examId, learnerId, answers: {}, status: "IN_PROGRESS", startedAt: now() };
    this.attempts.push(item);
    return { ...item, answers: {} };
  }

  async saveAnswer(attemptId: string, questionId: string, answers: string[]): Promise<ExamAttempt> {
    const prisma = this.database();
    if (prisma) {
      const attempt = await prisma.examAttempt.findUnique({ where: { id: attemptId } });
      if (!attempt) throw new NotFoundException("Không tìm thấy lượt làm bài.");
      if (attempt.status !== "IN_PROGRESS") throw new BadRequestException("Bài làm đã khóa.");
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
    if (!this.findExam(item.examId).questionIds.includes(questionId)) throw new BadRequestException("Câu hỏi không thuộc đề.");
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
    item.feedback = "Bài đã được chấm tự động. Giảng viên có thể bổ sung nhận xét.";
    return { ...item, answers: { ...item.answers } };
  }

  async getAttempt(attemptId: string): Promise<ExamAttempt> {
    const prisma = this.database();
    if (prisma) return this.getDatabaseAttempt(prisma, attemptId);
    const item = this.findAttempt(attemptId);
    return { ...item, answers: { ...item.answers } };
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
        where: { id: attemptId }, data: { score, feedback: feedback.trim(), status: "GRADED" }, include: { answers: true },
      }));
    }
    const item = this.findAttempt(attemptId);
    const exam = this.findExam(item.examId);
    if (score > exam.totalScore) throw new BadRequestException("Điểm không được vượt tổng điểm của đề.");
    item.score = score;
    item.feedback = feedback.trim();
    item.status = "GRADED";
    return { ...item, answers: { ...item.answers } };
  }

  async listTopics(): Promise<ForumTopic[]> {
    const prisma = this.database();
    if (prisma) {
      const rows = await prisma.forumTopic.findMany({ orderBy: [{ isPinned: "desc" }, { createdAt: "desc" }] });
      return rows.map((row) => this.mapTopic(row));
    }
    return this.topics.map((item) => ({ ...item, tags: [...item.tags] }));
  }

  async createTopic(
    classId: string,
    input: Pick<ForumTopic, "title" | "body" | "tags" | "isPinned">,
    authorId = "usr-instructor",
  ): Promise<ForumTopic> {
    const prisma = this.database();
    if (prisma) {
      const classItem = await prisma.learningClass.findUnique({ where: { id: classId } });
      if (!classItem) throw new NotFoundException("Không tìm thấy lớp học.");
      return this.mapTopic(await prisma.forumTopic.create({
        data: {
          id: id("topic"), classId, authorId, title: input.title.trim(), body: input.body.trim(),
          tags: input.tags, isPinned: input.isPinned,
        },
      }));
    }
    this.findClass(classId);
    const item: ForumTopic = { ...input, id: id("topic"), classId, authorId, isLocked: false, createdAt: now() };
    this.topics.unshift(item);
    return { ...item, tags: [...item.tags] };
  }

  async listPosts(topicId: string): Promise<ForumPost[]> {
    const prisma = this.database();
    if (prisma) {
      const topic = await prisma.forumTopic.findUnique({ where: { id: topicId } });
      if (!topic) throw new NotFoundException("Không tìm thấy chủ đề.");
      const rows = await prisma.forumPost.findMany({ where: { topicId }, orderBy: { createdAt: "asc" } });
      return rows.map((row) => this.mapPost(row));
    }
    this.findTopic(topicId);
    return this.posts.filter((item) => item.topicId === topicId).map((item) => ({ ...item }));
  }

  async createPost(topicId: string, body: string, authorId = "usr-learner", parentId?: string): Promise<ForumPost> {
    const prisma = this.database();
    if (prisma) {
      const topic = await prisma.forumTopic.findUnique({ where: { id: topicId } });
      if (!topic) throw new NotFoundException("Không tìm thấy chủ đề.");
      if (topic.isLocked) throw new BadRequestException("Chủ đề đã khóa.");
      if (parentId) {
        const parent = await prisma.forumPost.findFirst({ where: { id: parentId, topicId } });
        if (!parent) throw new BadRequestException("Bài cha không hợp lệ.");
      }
      return this.mapPost(await prisma.forumPost.create({
        data: { id: id("post"), topicId, authorId, body: body.trim(), parentId },
      }));
    }
    const topic = this.findTopic(topicId);
    if (topic.isLocked) throw new BadRequestException("Chủ đề đã khóa.");
    if (parentId && !this.posts.some((item) => item.id === parentId && item.topicId === topicId)) throw new BadRequestException("Bài cha không hợp lệ.");
    const item: ForumPost = { id: id("post"), topicId, authorId, body: body.trim(), parentId, status: "VISIBLE", createdAt: now() };
    this.posts.push(item);
    return { ...item };
  }

  async reportContent(input: Omit<ContentReport, "id" | "status">): Promise<ContentReport> {
    const prisma = this.database();
    if (prisma) {
      const targetExists = input.targetType === "POST"
        ? Boolean(await prisma.forumPost.findUnique({ where: { id: input.targetId }, select: { id: true } }))
        : Boolean(await prisma.forumTopic.findUnique({ where: { id: input.targetId }, select: { id: true } }));
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

  async listSessions(): Promise<LiveSession[]> {
    const prisma = this.database();
    if (prisma) {
      const rows = await prisma.liveSession.findMany({ orderBy: { startsAt: "desc" } });
      return rows.map((row) => this.mapSession(row));
    }
    return this.sessions.map((item) => ({ ...item }));
  }

  async createSession(classId: string, input: Pick<LiveSession, "title" | "startsAt" | "endsAt" | "provider">): Promise<LiveSession> {
    if (new Date(input.endsAt) <= new Date(input.startsAt)) throw new BadRequestException("Thời gian kết thúc phải sau thời gian bắt đầu.");
    const prisma = this.database();
    if (prisma) {
      const classItem = await prisma.learningClass.findUnique({ where: { id: classId } });
      if (!classItem) throw new NotFoundException("Không tìm thấy lớp học.");
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
    this.findClass(classId);
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
    const joinedAt = now();
    const existing = this.attendance.find((record) => record.sessionId === sessionId && record.learnerId === learnerId);
    if (existing) existing.joinedAt = existing.joinedAt ?? joinedAt;
    else this.attendance.push({ sessionId, learnerId, joinedAt, attendedMinutes: 0, status: "PRESENT" });
    return { attendeeUrl: item.attendeeUrl, joinedAt };
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
      const attendance = await prisma.attendanceRecord.findUnique({ where: { sessionId_learnerId: { sessionId, learnerId } } });
      const mapped = this.mapSession(session);
      return { session: { ...mapped, hostUrl: undefined }, attendance: attendance ? this.mapAttendance(attendance) : { sessionId, learnerId, attendedMinutes: 0, status: "ABSENT" } };
    }
    const session = this.findSession(sessionId);
    return { session: { ...session, hostUrl: undefined }, attendance: this.attendance.find((item) => item.sessionId === sessionId && item.learnerId === learnerId) ?? { sessionId, learnerId, attendedMinutes: 0, status: "ABSENT" } };
  }

  async listTickets(role: string): Promise<SupportTicket[]> {
    const prisma = this.database();
    if (prisma) {
      const rows = await prisma.supportTicket.findMany({
        where: role === "LEARNER" ? { reporterId: "usr-learner" } : undefined,
        orderBy: [{ status: "asc" }, { createdAt: "desc" }],
      });
      return rows.map((row) => this.mapTicket(row));
    }
    return this.tickets.filter((item) => role === "LEARNER" ? item.reporterId === "usr-learner" : true).map((item) => ({ ...item }));
  }

  async createTicket(input: Pick<SupportTicket, "category" | "severity" | "description">, reporterId = "usr-learner"): Promise<SupportTicket> {
    const prisma = this.database();
    if (prisma) {
      const slaHours: Record<SupportTicket["severity"], number> = { P0: 4, P1: 24, P2: 72, P3: 120 };
      return this.mapTicket(await prisma.supportTicket.create({
        data: {
          id: id("ticket"), reporterId, category: input.category.trim(), severity: input.severity,
          description: input.description.trim(), dueAt: new Date(Date.now() + slaHours[input.severity] * 3_600_000),
        },
      }));
    }
    const item: SupportTicket = { ...input, id: id("ticket"), reporterId, status: "OPEN", createdAt: now() };
    this.tickets.unshift(item);
    return { ...item };
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
    return { ...item };
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

  private mapPost(row: Prisma.ForumPostGetPayload<Record<string, never>>): ForumPost {
    return {
      id: row.id,
      topicId: row.topicId,
      authorId: row.authorId,
      body: row.body,
      parentId: row.parentId ?? undefined,
      status: row.status === "PUBLISHED" ? "VISIBLE" : "HIDDEN",
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

  private mapTicket(row: Prisma.SupportTicketGetPayload<Record<string, never>>): SupportTicket {
    return {
      id: row.id,
      reporterId: row.reporterId,
      category: row.category,
      severity: row.severity,
      description: row.description,
      status: row.status,
      assigneeId: row.assigneeId ?? undefined,
      resolution: row.resolution ?? undefined,
      createdAt: row.createdAt.toISOString(),
    };
  }

  private isLiveProvider(value: string): value is LiveSession["provider"] {
    return value === "GOOGLE_MEET" || value === "ZOOM" || value === "JITSI";
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

  private async storeUpload(classId: string, materialId: string, upload: UploadedMaterialFile): Promise<{ objectKey: string; checksum: string }> {
    if (upload.size !== upload.buffer.length) throw new BadRequestException("Kích thước tệp tải lên không khớp nội dung nhận được.");
    const safeExtension = extname(upload.originalName).toLowerCase().replace(/[^a-z0-9.]/g, "").slice(0, 12);
    const objectKey = `files/${classId}/${materialId}${safeExtension}`;
    const target = this.resolveObjectPath(objectKey);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, upload.buffer, { flag: "wx" }).catch((error: unknown) => {
      if (typeof error === "object" && error !== null && "code" in error && error.code === "EEXIST") throw new ConflictException("Khóa lưu trữ học liệu đã tồn tại.");
      throw error;
    });
    return { objectKey, checksum: `sha256:${createHash("sha256").update(upload.buffer).digest("hex")}` };
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
