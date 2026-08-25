import { BadRequestException, ConflictException, Injectable, NotFoundException, Optional } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { Prisma } from "../generated/prisma/client.js";
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

  constructor(@Optional() private readonly prisma?: PrismaService) {}

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

  async createMaterial(classId: string, input: Pick<LearningMaterial, "name" | "mimeType" | "sizeBytes" | "folder" | "tags">): Promise<LearningMaterial> {
    if (input.sizeBytes > 50_000_000) throw new BadRequestException("Tệp vượt giới hạn 50 MB.");
    const prisma = this.database();
    if (prisma) {
      const classItem = await prisma.learningClass.findUnique({ where: { id: classId } });
      if (!classItem) throw new NotFoundException("Không tìm thấy lớp học.");
      const materialId = id("material");
      return this.mapMaterial(await prisma.material.create({
        data: {
          id: materialId, classId, ownerId: "usr-instructor", name: input.name.trim(),
          objectKey: `materials/${classId}/${materialId}`, mimeType: input.mimeType,
          sizeBytes: BigInt(input.sizeBytes), folder: input.folder.trim(), tags: input.tags,
        },
      }));
    }
    this.findClass(classId);
    const item: LearningMaterial = { ...input, id: id("material"), classId, version: 1, visibility: "DRAFT", createdAt: now() };
    this.materials.unshift(item);
    return { ...item, tags: [...item.tags] };
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

  listQuestions(query?: string): LearningQuestion[] { const normalized = query?.toLowerCase() ?? ""; return this.questions.filter((item) => !normalized || `${item.content} ${item.tags.join(" ")}`.toLowerCase().includes(normalized)).map((item) => ({ ...item, options: [...item.options], correctAnswers: [...item.correctAnswers], tags: [...item.tags] })); }
  createQuestion(input: Omit<LearningQuestion, "id" | "status" | "version">): LearningQuestion { if (["SINGLE_CHOICE", "MULTIPLE_CHOICE", "TRUE_FALSE"].includes(input.type) && !input.correctAnswers.length) throw new BadRequestException("Câu hỏi trắc nghiệm cần đáp án đúng."); const item: LearningQuestion = { ...input, id: id("question"), status: "DRAFT", version: 1 }; this.questions.unshift(item); return { ...item, options: [...item.options], correctAnswers: [...item.correctAnswers], tags: [...item.tags] }; }

  listExams(role: string): LearningExam[] { return this.exams.filter((item) => role !== "LEARNER" || item.status === "PUBLISHED").map((item) => ({ ...item, questionIds: [...item.questionIds] })); }
  getExamQuestions(examId: string): LearningQuestion[] { const exam = this.findExam(examId); if (exam.status !== "PUBLISHED") throw new BadRequestException("Đề chưa được phát hành."); return exam.questionIds.map((questionId) => { const question = this.questions.find((item) => item.id === questionId); if (!question) throw new NotFoundException("Đề chứa câu hỏi không tồn tại."); return { ...question, options: [...question.options], correctAnswers: [], tags: [...question.tags] }; }); }
  createExam(input: Omit<LearningExam, "id" | "status">): LearningExam { this.findClass(input.classId); if (new Date(input.closeAt) <= new Date(input.openAt)) throw new BadRequestException("Thời gian đóng đề phải sau thời gian mở."); if (!input.questionIds.length) throw new BadRequestException("Đề cần ít nhất một câu hỏi."); const item: LearningExam = { ...input, id: id("exam"), status: "DRAFT" }; this.exams.unshift(item); return { ...item, questionIds: [...item.questionIds] }; }
  publishExam(examId: string): LearningExam { const item = this.findExam(examId); item.status = "PUBLISHED"; return { ...item, questionIds: [...item.questionIds] }; }
  startAttempt(examId: string, learnerId = "usr-learner"): ExamAttempt { const exam = this.findExam(examId); if (exam.status !== "PUBLISHED") throw new BadRequestException("Đề chưa được phát hành."); const attempts = this.attempts.filter((item) => item.examId === examId && item.learnerId === learnerId); if (attempts.length >= exam.attemptLimit) throw new BadRequestException("Đã hết số lần làm bài."); const existing = attempts.find((item) => item.status === "IN_PROGRESS"); if (existing) return { ...existing, answers: { ...existing.answers } }; const item: ExamAttempt = { id: id("attempt"), examId, learnerId, answers: {}, status: "IN_PROGRESS", startedAt: now() }; this.attempts.push(item); return { ...item, answers: {} }; }
  saveAnswer(attemptId: string, questionId: string, answers: string[]): ExamAttempt { const item = this.findAttempt(attemptId); if (item.status !== "IN_PROGRESS") throw new BadRequestException("Bài làm đã khóa."); if (!this.findExam(item.examId).questionIds.includes(questionId)) throw new BadRequestException("Câu hỏi không thuộc đề."); item.answers[questionId] = [...answers]; return { ...item, answers: { ...item.answers } }; }
  submitAttempt(attemptId: string): ExamAttempt { const item = this.findAttempt(attemptId); if (item.status !== "IN_PROGRESS") throw new ConflictException("Bài đã được nộp trước đó."); const exam = this.findExam(item.examId); let correct = 0; exam.questionIds.forEach((questionId) => { const question = this.questions.find((candidate) => candidate.id === questionId); if (question && JSON.stringify([...(item.answers[questionId] ?? [])].sort()) === JSON.stringify([...question.correctAnswers].sort())) correct += 1; }); item.score = Math.round((correct / exam.questionIds.length) * exam.totalScore * 100) / 100; item.status = "GRADED"; item.submittedAt = now(); item.feedback = "Bài đã được chấm tự động. Giảng viên có thể bổ sung nhận xét."; return { ...item, answers: { ...item.answers } }; }
  getAttempt(attemptId: string): ExamAttempt { const item = this.findAttempt(attemptId); return { ...item, answers: { ...item.answers } }; }
  listAttempts(examId?: string): ExamAttempt[] { return this.attempts.filter((item) => !examId || item.examId === examId).map((item) => ({ ...item, answers: { ...item.answers } })); }
  gradeAttempt(attemptId: string, score: number, feedback: string): ExamAttempt { const item = this.findAttempt(attemptId); const exam = this.findExam(item.examId); if (score > exam.totalScore) throw new BadRequestException("Điểm không được vượt tổng điểm của đề."); item.score = score; item.feedback = feedback.trim(); item.status = "GRADED"; return { ...item, answers: { ...item.answers } }; }

  listTopics(): ForumTopic[] { return this.topics.map((item) => ({ ...item, tags: [...item.tags] })); }
  createTopic(classId: string, input: Pick<ForumTopic, "title" | "body" | "tags" | "isPinned">, authorId = "usr-instructor"): ForumTopic { this.findClass(classId); const item: ForumTopic = { ...input, id: id("topic"), classId, authorId, isLocked: false, createdAt: now() }; this.topics.unshift(item); return { ...item, tags: [...item.tags] }; }
  listPosts(topicId: string): ForumPost[] { this.findTopic(topicId); return this.posts.filter((item) => item.topicId === topicId).map((item) => ({ ...item })); }
  createPost(topicId: string, body: string, authorId = "usr-learner", parentId?: string): ForumPost { const topic = this.findTopic(topicId); if (topic.isLocked) throw new BadRequestException("Chủ đề đã khóa."); if (parentId && !this.posts.some((item) => item.id === parentId && item.topicId === topicId)) throw new BadRequestException("Bài cha không hợp lệ."); const item: ForumPost = { id: id("post"), topicId, authorId, body: body.trim(), parentId, status: "VISIBLE", createdAt: now() }; this.posts.push(item); return { ...item }; }
  reportContent(input: Omit<ContentReport, "id" | "status">): ContentReport { if (this.reports.some((item) => item.targetId === input.targetId && item.reporterId === input.reporterId && item.status === "OPEN")) throw new ConflictException("Bạn đã báo cáo nội dung này."); const item: ContentReport = { ...input, id: id("report"), status: "OPEN" }; this.reports.unshift(item); return { ...item }; }
  listReports(): ContentReport[] { return this.reports.map((item) => ({ ...item })); }
  resolveReport(reportId: string, status: "RESOLVED" | "REJECTED", resolution: string): ContentReport { const item = this.reports.find((report) => report.id === reportId); if (!item) throw new NotFoundException("Không tìm thấy báo cáo."); item.status = status; item.resolution = resolution; if (status === "RESOLVED" && item.targetType === "POST") { const post = this.posts.find((candidate) => candidate.id === item.targetId); if (post) post.status = "HIDDEN"; } return { ...item }; }

  listSessions(): LiveSession[] { return this.sessions.map((item) => ({ ...item })); }
  createSession(classId: string, input: Pick<LiveSession, "title" | "startsAt" | "endsAt" | "provider">): LiveSession { this.findClass(classId); if (new Date(input.endsAt) <= new Date(input.startsAt)) throw new BadRequestException("Thời gian kết thúc phải sau thời gian bắt đầu."); const overlaps = this.sessions.some((item) => item.classId === classId && item.status !== "CANCELLED" && new Date(input.startsAt) < new Date(item.endsAt) && new Date(input.endsAt) > new Date(item.startsAt)); if (overlaps) throw new ConflictException("Lịch học bị trùng."); const token = randomUUID(); const item: LiveSession = { ...input, id: id("session"), classId, status: "SCHEDULED", hostUrl: `https://meet.jit.si/${token}-host`, attendeeUrl: `https://meet.jit.si/${token}` }; this.sessions.unshift(item); return { ...item }; }
  transitionSession(sessionId: string, status: LiveSession["status"]): LiveSession { const item = this.findSession(sessionId); const allowed: Record<LiveSession["status"], LiveSession["status"][]> = { SCHEDULED: ["LIVE", "CANCELLED"], LIVE: ["COMPLETED"], COMPLETED: [], CANCELLED: [] }; if (!allowed[item.status].includes(status)) throw new BadRequestException(`Không thể chuyển ${item.status} → ${status}.`); item.status = status; return { ...item }; }
  joinSession(sessionId: string, learnerId = "usr-learner"): { attendeeUrl: string; joinedAt: string } { const item = this.findSession(sessionId); const classItem = this.findClass(item.classId); if (!classItem.learnerIds.includes(learnerId)) throw new BadRequestException("Học viên không thuộc lớp."); if (item.status === "CANCELLED" || item.status === "COMPLETED") throw new BadRequestException("Buổi học không còn cho phép tham gia."); const joinedAt = now(); const existing = this.attendance.find((record) => record.sessionId === sessionId && record.learnerId === learnerId); if (existing) { existing.joinedAt = existing.joinedAt ?? joinedAt; } else this.attendance.push({ sessionId, learnerId, joinedAt, attendedMinutes: 0, status: "PRESENT" }); return { attendeeUrl: item.attendeeUrl, joinedAt }; }
  updateAttendance(sessionId: string, learnerId: string, status: AttendanceRecord["status"], attendedMinutes: number, adjustmentReason: string): AttendanceRecord { this.findSession(sessionId); let record = this.attendance.find((item) => item.sessionId === sessionId && item.learnerId === learnerId); if (!record) { record = { sessionId, learnerId, attendedMinutes, status, adjustmentReason }; this.attendance.push(record); } else Object.assign(record, { status, attendedMinutes, adjustmentReason }); return { ...record }; }
  attachRecording(sessionId: string, recordingUrl: string): LiveSession { const item = this.findSession(sessionId); if (item.status !== "COMPLETED") throw new BadRequestException("Chỉ gắn bản ghi sau khi buổi học kết thúc."); item.recordingUrl = recordingUrl; return { ...item }; }
  getSessionSummary(sessionId: string, learnerId = "usr-learner"): object { const session = this.findSession(sessionId); return { session: { ...session, hostUrl: undefined }, attendance: this.attendance.find((item) => item.sessionId === sessionId && item.learnerId === learnerId) ?? { sessionId, learnerId, attendedMinutes: 0, status: "ABSENT" } }; }

  listTickets(role: string): SupportTicket[] { return this.tickets.filter((item) => role === "LEARNER" ? item.reporterId === "usr-learner" : true).map((item) => ({ ...item })); }
  createTicket(input: Pick<SupportTicket, "category" | "severity" | "description">, reporterId = "usr-learner"): SupportTicket { const item: SupportTicket = { ...input, id: id("ticket"), reporterId, status: "OPEN", createdAt: now() }; this.tickets.unshift(item); return { ...item }; }
  updateTicket(ticketId: string, input: Partial<Pick<SupportTicket, "status" | "assigneeId" | "resolution">>): SupportTicket { const item = this.tickets.find((ticket) => ticket.id === ticketId); if (!item) throw new NotFoundException("Không tìm thấy ticket."); if ((input.status === "RESOLVED" || input.status === "CLOSED") && !input.resolution) throw new BadRequestException("Cần ghi nội dung xử lý trước khi đóng."); Object.assign(item, input); return { ...item }; }

  getOperationalReport(): object { const classes = this.classes.filter((item) => item.status === "ACTIVE").length; const materials = this.materials.filter((item) => item.visibility === "PUBLISHED").length; return { courses: this.courses.length, classes, activeClasses: classes, learners: new Set(this.classes.flatMap((item) => item.learnerIds)).size, materials, publishedMaterials: materials, questions: this.questions.length, exams: this.exams.length, liveSessions: this.sessions.length, openReports: this.reports.filter((item) => item.status === "OPEN").length, openTickets: this.tickets.filter((item) => !["RESOLVED", "CLOSED"].includes(item.status)).length, generatedAt: now() }; }
  getClassReports(): object[] { return this.classes.map((classItem) => { const classExams = this.exams.filter((exam) => exam.classId === classItem.id); const classAttempts = this.attempts.filter((attempt) => classExams.some((exam) => exam.id === attempt.examId)); const classSessions = this.sessions.filter((session) => session.classId === classItem.id); const attendanceRows = this.attendance.filter((record) => classSessions.some((session) => session.id === record.sessionId)); const graded = classAttempts.filter((attempt) => attempt.score !== undefined); return { classId: classItem.id, classCode: classItem.code, className: classItem.name, learners: classItem.learnerIds.length, instructors: classItem.instructorIds.length, publishedMaterials: this.materials.filter((material) => material.classId === classItem.id && material.visibility === "PUBLISHED").length, exams: classExams.length, submittedAttempts: classAttempts.filter((attempt) => attempt.status !== "IN_PROGRESS").length, averageScore: graded.length ? Math.round((graded.reduce((sum, attempt) => sum + (attempt.score ?? 0), 0) / graded.length) * 100) / 100 : 0, sessions: classSessions.length, attendanceRate: classItem.learnerIds.length && classSessions.length ? Math.round((attendanceRows.filter((row) => row.status === "PRESENT" || row.status === "LATE").length / (classItem.learnerIds.length * classSessions.length)) * 100) : 0, status: classItem.status }; }); }

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
