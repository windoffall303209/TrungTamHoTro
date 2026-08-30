import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { AuthenticatedSession } from "../auth/auth.service.js";
import type { Prisma } from "../generated/prisma/client.js";
import { PrismaService } from "../database/prisma.service.js";
import { AntivirusService } from "../infrastructure/antivirus.service.js";
import { ObjectStorageService } from "../infrastructure/object-storage.service.js";

export interface RubricCriterion { id: string; title: string; description: string; maxPoints: number }
export interface UploadedAssignmentFile { originalName: string; mimeType: string; size: number; buffer: Buffer }
export interface AssignmentAttachmentView { id: string; originalName: string; mimeType: string; sizeBytes: number; createdAt: string; canPreview: boolean }
export interface AssignmentView { id: string; classId: string; classCode: string; title: string; description: string; instructions: string; dueAt: string; maxScore: number; rubric: RubricCriterion[]; status: "DRAFT" | "PUBLISHED" | "CLOSED"; createdById: string; submission?: AssignmentSubmissionView; createdAt: string }
export interface AssignmentSubmissionView { id: string; assignmentId: string; learnerId: string; learnerName: string; learnerEmail: string; content: string; attachments: AssignmentAttachmentView[]; status: "SUBMITTED" | "GRADED"; submittedAt: string; score?: number; rubricScores: Array<{ criterionId: string; score: number }>; feedback?: string; gradedAt?: string }
export interface AcademicCalendarEvent { id: string; classId: string; classCode: string; type: "CLASS" | "LIVE_SESSION" | "EXAM" | "ASSIGNMENT"; title: string; startAt: string; endAt?: string; href: string }
export interface ClassAnnouncementView { id: string; classId: string; classCode: string; title: string; body: string; authorName: string; publishedAt: string }
export interface GradebookRow { learnerId: string; learnerName: string; learnerEmail: string; examEarned: number; examPossible: number; assignmentEarned: number; assignmentPossible: number; totalPercent: number }

@Injectable()
export class AcademicService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly objectStorage: ObjectStorageService,
    private readonly antivirus: AntivirusService,
  ) {}

  async listAssignments(session: AuthenticatedSession, classId?: string): Promise<AssignmentView[]> {
    const classIds = await this.accessibleClassIds(session);
    if (classId && !classIds.includes(classId)) throw new NotFoundException("Không tìm thấy lớp học trong phạm vi truy cập.");
    const rows = await this.prisma.assignment.findMany({
      where: { classId: classId ?? { in: classIds }, ...(session.roleCode === "LEARNER" ? { status: { in: ["PUBLISHED", "CLOSED"] } } : {}) },
      include: { class: { select: { code: true } }, submissions: { where: { learnerId: session.user.id }, include: { learner: { select: { displayName: true, email: true } }, attachments: { orderBy: { createdAt: "asc" } } } } },
      orderBy: { dueAt: "asc" },
    });
    return rows.map((row) => this.mapAssignment(row, row.submissions[0]));
  }

  async createAssignment(classId: string, input: { title: string; description: string; instructions: string; dueAt: string; maxScore: number; rubric: Array<{ title: string; description: string; maxPoints: number }> }, session: AuthenticatedSession): Promise<AssignmentView> {
    await this.requireTeachingAccess(classId, session);
    const dueAt = new Date(input.dueAt);
    if (dueAt <= new Date()) throw new BadRequestException("Hạn nộp phải nằm trong tương lai.");
    const total = input.rubric.reduce((sum, item) => sum + item.maxPoints, 0);
    if (Math.abs(total - input.maxScore) > 0.001) throw new BadRequestException("Tổng điểm rubric phải bằng điểm tối đa của bài tập.");
    const rubric: RubricCriterion[] = input.rubric.map((item) => ({ id: `criterion-${randomUUID()}`, title: item.title.trim(), description: item.description.trim(), maxPoints: item.maxPoints }));
    const row = await this.prisma.assignment.create({ data: { id: `assignment-${randomUUID()}`, classId, createdById: session.user.id, title: input.title.trim(), description: input.description.trim(), instructions: input.instructions.trim(), dueAt, maxScore: input.maxScore, rubric: rubric as unknown as Prisma.InputJsonValue }, include: { class: { select: { code: true } }, submissions: { include: { learner: { select: { displayName: true, email: true } }, attachments: true } } } });
    return this.mapAssignment(row);
  }

  async publishAssignment(assignmentId: string, session: AuthenticatedSession): Promise<AssignmentView> {
    const current = await this.prisma.assignment.findUnique({ where: { id: assignmentId } });
    if (!current) throw new NotFoundException("Không tìm thấy bài tập.");
    await this.requireTeachingAccess(current.classId, session);
    if (current.status !== "DRAFT") throw new ConflictException("Chỉ bài tập nháp mới có thể xuất bản.");
    const row = await this.prisma.$transaction(async (transaction) => {
      const updated = await transaction.assignment.update({ where: { id: assignmentId }, data: { status: "PUBLISHED" }, include: { class: { select: { code: true } }, submissions: { include: { learner: { select: { displayName: true, email: true } }, attachments: true } } } });
      const learners = await transaction.classEnrollment.findMany({ where: { classId: current.classId, status: "ACTIVE" }, select: { learnerId: true } });
      if (learners.length) await transaction.notification.createMany({ data: learners.map(({ learnerId }) => ({ id: `notification-${randomUUID()}`, recipientId: learnerId, type: "ASSIGNMENT_PUBLISHED", title: `Bài tập mới: ${current.title}`, entityType: "ASSIGNMENT", entityId: assignmentId, dedupKey: `assignment-published:${assignmentId}:${learnerId}` })) });
      return updated;
    });
    return this.mapAssignment(row);
  }

  async submitAssignment(assignmentId: string, content: string | undefined, session: AuthenticatedSession, files: UploadedAssignmentFile[] = []): Promise<AssignmentSubmissionView> {
    if (session.roleCode !== "LEARNER") throw new ForbiddenException("Chỉ học viên được nộp bài.");
    this.validateAssignmentFiles(files);
    const assignment = await this.prisma.assignment.findUnique({ where: { id: assignmentId }, include: { class: { include: { enrollments: { where: { learnerId: session.user.id, status: "ACTIVE" } } } } } });
    if (!assignment || !assignment.class.enrollments.length || assignment.status !== "PUBLISHED") throw new NotFoundException("Không tìm thấy bài tập đang mở trong lớp của bạn.");
    if (assignment.dueAt < new Date()) throw new ConflictException("Bài tập đã hết hạn nộp.");
    const existing = await this.prisma.assignmentSubmission.findUnique({ where: { assignmentId_learnerId: { assignmentId, learnerId: session.user.id } }, include: { attachments: true } });
    if (existing?.status === "GRADED") throw new ConflictException("Bài đã chấm không thể nộp lại.");
    if ((existing?.attachments.length ?? 0) + files.length > 5) throw new BadRequestException("Mỗi bài nộp được đính kèm tối đa 5 tệp.");
    const normalizedContent = (content ?? existing?.content ?? "").trim();
    if (!normalizedContent && !(existing?.attachments.length ?? 0) && !files.length) throw new BadRequestException("Cần nhập nội dung hoặc đính kèm ít nhất một tệp.");

    const stored: Array<UploadedAssignmentFile & { objectKey: string; checksum: string }> = [];
    try {
      for (const file of files) {
        const scan = await this.antivirus.scan(file.buffer);
        if (!scan.clean) throw new BadRequestException(`Tệp ${file.originalName} không an toàn và đã bị từ chối.`);
        const saved = await this.objectStorage.put(`assignment-submissions/${session.user.id}/${randomUUID()}`, file.buffer);
        stored.push({ ...file, ...saved });
      }
      const row = await this.prisma.$transaction(async (transaction) => {
        const submission = await transaction.assignmentSubmission.upsert({
          where: { assignmentId_learnerId: { assignmentId, learnerId: session.user.id } },
          update: { content: normalizedContent, submittedAt: new Date(), status: "SUBMITTED", score: null, feedback: null, rubricScores: undefined, gradedAt: null, gradedBy: null },
          create: { id: `submission-${randomUUID()}`, assignmentId, learnerId: session.user.id, content: normalizedContent },
        });
        if (stored.length) await transaction.assignmentSubmissionAttachment.createMany({ data: stored.map((file) => ({ id: `submission-file-${randomUUID()}`, submissionId: submission.id, objectKey: file.objectKey, originalName: file.originalName, mimeType: file.mimeType, sizeBytes: file.size, checksum: file.checksum })) });
        return transaction.assignmentSubmission.findUniqueOrThrow({ where: { id: submission.id }, include: { learner: { select: { displayName: true, email: true } }, attachments: { orderBy: { createdAt: "asc" } } } });
      });
      return this.mapSubmission(row);
    } catch (error) {
      await Promise.allSettled(stored.map((file) => this.objectStorage.remove(file.objectKey)));
      throw error;
    }
  }

  async addSubmissionAttachments(submissionId: string, files: UploadedAssignmentFile[], session: AuthenticatedSession): Promise<AssignmentSubmissionView> {
    if (!files.length) throw new BadRequestException("Cần chọn ít nhất một tệp.");
    const submission = await this.prisma.assignmentSubmission.findUnique({ where: { id: submissionId } });
    if (!submission || submission.learnerId !== session.user.id) throw new NotFoundException("Không tìm thấy bài nộp của bạn.");
    return this.submitAssignment(submission.assignmentId, undefined, session, files);
  }

  async removeSubmissionAttachment(submissionId: string, attachmentId: string, session: AuthenticatedSession): Promise<AssignmentSubmissionView> {
    if (session.roleCode !== "LEARNER") throw new ForbiddenException("Chỉ học viên được sửa tệp bài nộp.");
    const submission = await this.prisma.assignmentSubmission.findUnique({ where: { id: submissionId }, include: { assignment: true, attachments: true } });
    if (!submission || submission.learnerId !== session.user.id) throw new NotFoundException("Không tìm thấy bài nộp của bạn.");
    if (submission.status === "GRADED") throw new ConflictException("Bài đã chấm không thể sửa tệp.");
    if (submission.assignment.dueAt < new Date()) throw new ConflictException("Bài tập đã hết hạn chỉnh sửa.");
    const attachment = submission.attachments.find((item) => item.id === attachmentId);
    if (!attachment) throw new NotFoundException("Không tìm thấy tệp đính kèm.");
    if (!submission.content.trim() && submission.attachments.length === 1) throw new BadRequestException("Bài nộp phải còn nội dung hoặc ít nhất một tệp.");
    await this.objectStorage.remove(attachment.objectKey);
    const row = await this.prisma.assignmentSubmission.update({ where: { id: submissionId }, data: { attachments: { delete: { id: attachmentId } }, submittedAt: new Date() }, include: { learner: { select: { displayName: true, email: true } }, attachments: { orderBy: { createdAt: "asc" } } } });
    return this.mapSubmission(row);
  }

  async readSubmissionAttachment(submissionId: string, attachmentId: string, session: AuthenticatedSession): Promise<{ buffer: Buffer; fileName: string; mimeType: string }> {
    const attachment = await this.prisma.assignmentSubmissionAttachment.findFirst({ where: { id: attachmentId, submissionId }, include: { submission: { include: { assignment: true } } } });
    if (!attachment) throw new NotFoundException("Không tìm thấy tệp đính kèm.");
    if (session.roleCode === "LEARNER") {
      if (attachment.submission.learnerId !== session.user.id) throw new NotFoundException("Không tìm thấy tệp đính kèm.");
    } else {
      await this.requireTeachingAccess(attachment.submission.assignment.classId, session);
    }
    return { buffer: await this.objectStorage.get(attachment.objectKey), fileName: attachment.originalName, mimeType: attachment.mimeType };
  }

  async listSubmissions(assignmentId: string, session: AuthenticatedSession): Promise<AssignmentSubmissionView[]> {
    const assignment = await this.prisma.assignment.findUnique({ where: { id: assignmentId } });
    if (!assignment) throw new NotFoundException("Không tìm thấy bài tập.");
    await this.requireTeachingAccess(assignment.classId, session);
    const rows = await this.prisma.assignmentSubmission.findMany({ where: { assignmentId }, include: { learner: { select: { displayName: true, email: true } }, attachments: { orderBy: { createdAt: "asc" } } }, orderBy: { submittedAt: "asc" } });
    return rows.map((row) => this.mapSubmission(row));
  }

  async gradeSubmission(submissionId: string, rubricScores: Array<{ criterionId: string; score: number }>, feedback: string, session: AuthenticatedSession): Promise<AssignmentSubmissionView> {
    const submission = await this.prisma.assignmentSubmission.findUnique({ where: { id: submissionId }, include: { assignment: true } });
    if (!submission) throw new NotFoundException("Không tìm thấy bài nộp.");
    await this.requireTeachingAccess(submission.assignment.classId, session);
    const rubric = this.rubric(submission.assignment.rubric);
    if (rubricScores.length !== rubric.length || new Set(rubricScores.map((item) => item.criterionId)).size !== rubric.length) throw new BadRequestException("Điểm rubric phải có đúng một giá trị cho từng tiêu chí.");
    let total = 0;
    for (const criterion of rubric) {
      const score = rubricScores.find((item) => item.criterionId === criterion.id)?.score;
      if (score === undefined || score > criterion.maxPoints) throw new BadRequestException(`Điểm tiêu chí ${criterion.title} vượt giới hạn.`);
      total += score;
    }
    const row = await this.prisma.$transaction(async (transaction) => {
      const updated = await transaction.assignmentSubmission.update({ where: { id: submissionId }, data: { status: "GRADED", score: total, rubricScores, feedback: feedback.trim(), gradedBy: session.user.id, gradedAt: new Date() }, include: { learner: { select: { displayName: true, email: true } }, attachments: { orderBy: { createdAt: "asc" } } } });
      await transaction.notification.upsert({ where: { dedupKey: `assignment-graded:${submissionId}` }, update: { readAt: null, createdAt: new Date() }, create: { id: `notification-${randomUUID()}`, recipientId: submission.learnerId, type: "ASSIGNMENT_GRADED", title: `Đã chấm bài: ${submission.assignment.title}`, entityType: "ASSIGNMENT", entityId: submission.assignmentId, dedupKey: `assignment-graded:${submissionId}` } });
      return updated;
    });
    return this.mapSubmission(row);
  }

  async gradebook(classId: string, session: AuthenticatedSession): Promise<GradebookRow[]> {
    await this.requireTeachingAccess(classId, session);
    const classItem = await this.prisma.learningClass.findUnique({ where: { id: classId }, include: {
      enrollments: { where: { status: "ACTIVE" }, include: { learner: { select: { displayName: true, email: true } } } },
      exams: { where: { status: { in: ["PUBLISHED", "CLOSED"] } }, include: { attempts: { where: { status: "GRADED" } } } },
      assignments: { where: { status: { in: ["PUBLISHED", "CLOSED"] } }, include: { submissions: { where: { status: "GRADED" } } } },
    } });
    if (!classItem) throw new NotFoundException("Không tìm thấy lớp học.");
    const examPossible = classItem.exams.reduce((sum, exam) => sum + Number(exam.totalScore), 0);
    const assignmentPossible = classItem.assignments.reduce((sum, assignment) => sum + Number(assignment.maxScore), 0);
    return classItem.enrollments.map(({ learnerId, learner }) => {
      const examEarned = classItem.exams.reduce((sum, exam) => sum + Math.max(0, ...exam.attempts.filter((attempt) => attempt.learnerId === learnerId).map((attempt) => Number(attempt.score ?? 0))), 0);
      const assignmentEarned = classItem.assignments.reduce((sum, assignment) => sum + Number(assignment.submissions.find((item) => item.learnerId === learnerId)?.score ?? 0), 0);
      const possible = examPossible + assignmentPossible;
      return { learnerId, learnerName: learner.displayName, learnerEmail: learner.email, examEarned, examPossible, assignmentEarned, assignmentPossible, totalPercent: possible ? Math.round(((examEarned + assignmentEarned) / possible) * 10_000) / 100 : 0 };
    });
  }

  async calendar(session: AuthenticatedSession, classId?: string): Promise<AcademicCalendarEvent[]> {
    const classIds = await this.accessibleClassIds(session);
    if (classId && !classIds.includes(classId)) throw new NotFoundException("Không tìm thấy lớp học trong phạm vi truy cập.");
    const classes = await this.prisma.learningClass.findMany({ where: { id: classId ?? { in: classIds } }, include: { sessions: true, exams: true, assignments: { where: { status: { in: ["PUBLISHED", "CLOSED"] } } } } });
    const events: AcademicCalendarEvent[] = [];
    for (const item of classes) {
      events.push({ id: `class-${item.id}`, classId: item.id, classCode: item.code, type: "CLASS", title: `Thời gian lớp ${item.name}`, startAt: item.startAt.toISOString(), endAt: item.endAt.toISOString(), href: "/courses" });
      events.push(...item.sessions.map((sessionItem) => ({ id: `session-${sessionItem.id}`, classId: item.id, classCode: item.code, type: "LIVE_SESSION" as const, title: sessionItem.title, startAt: sessionItem.startsAt.toISOString(), endAt: sessionItem.endsAt.toISOString(), href: "/live-classes" })));
      events.push(...item.exams.flatMap((exam) => [{ id: `exam-open-${exam.id}`, classId: item.id, classCode: item.code, type: "EXAM" as const, title: `Mở đề: ${exam.title}`, startAt: exam.openAt.toISOString(), href: "/exams" }, { id: `exam-close-${exam.id}`, classId: item.id, classCode: item.code, type: "EXAM" as const, title: `Đóng đề: ${exam.title}`, startAt: exam.closeAt.toISOString(), href: "/exams" }]));
      events.push(...item.assignments.map((assignment) => ({ id: `assignment-${assignment.id}`, classId: item.id, classCode: item.code, type: "ASSIGNMENT" as const, title: `Hạn bài: ${assignment.title}`, startAt: assignment.dueAt.toISOString(), href: "/academic" })));
    }
    return events.sort((a, b) => a.startAt.localeCompare(b.startAt));
  }

  async listAnnouncements(session: AuthenticatedSession, classId?: string): Promise<ClassAnnouncementView[]> {
    const classIds = await this.accessibleClassIds(session);
    if (classId && !classIds.includes(classId)) throw new NotFoundException("Không tìm thấy lớp học trong phạm vi truy cập.");
    const rows = await this.prisma.classAnnouncement.findMany({ where: { classId: classId ?? { in: classIds } }, include: { class: { select: { code: true } }, author: { select: { displayName: true } } }, orderBy: { publishedAt: "desc" }, take: 100 });
    return rows.map((row) => ({ id: row.id, classId: row.classId, classCode: row.class.code, title: row.title, body: row.body, authorName: row.author.displayName, publishedAt: row.publishedAt.toISOString() }));
  }

  async createAnnouncement(classId: string, title: string, body: string, session: AuthenticatedSession): Promise<ClassAnnouncementView> {
    await this.requireTeachingAccess(classId, session);
    return this.prisma.$transaction(async (transaction) => {
      const row = await transaction.classAnnouncement.create({ data: { id: `announcement-${randomUUID()}`, classId, authorId: session.user.id, title: title.trim(), body: body.trim() }, include: { class: { select: { code: true } }, author: { select: { displayName: true } } } });
      const members = await transaction.learningClass.findUnique({ where: { id: classId }, include: { instructors: { select: { instructorId: true } }, enrollments: { where: { status: "ACTIVE" }, select: { learnerId: true } } } });
      const recipients = new Set([...(members?.instructors.map((item) => item.instructorId) ?? []), ...(members?.enrollments.map((item) => item.learnerId) ?? [])]); recipients.delete(session.user.id);
      if (recipients.size) await transaction.notification.createMany({ data: [...recipients].map((recipientId) => ({ id: `notification-${randomUUID()}`, recipientId, type: "CLASS_ANNOUNCEMENT", title: `Thông báo lớp: ${title.trim()}`, entityType: "CLASS_ANNOUNCEMENT", entityId: row.id, dedupKey: `announcement:${row.id}:${recipientId}` })) });
      return { id: row.id, classId: row.classId, classCode: row.class.code, title: row.title, body: row.body, authorName: row.author.displayName, publishedAt: row.publishedAt.toISOString() };
    });
  }

  private async accessibleClassIds(session: AuthenticatedSession): Promise<string[]> {
    if (session.roleCode === "CENTER_MANAGER" || session.roleCode === "SYSTEM_ADMIN") return (await this.prisma.learningClass.findMany({ select: { id: true } })).map((item) => item.id);
    if (session.roleCode === "INSTRUCTOR") return (await this.prisma.classInstructor.findMany({ where: { instructorId: session.user.id }, select: { classId: true } })).map((item) => item.classId);
    return (await this.prisma.classEnrollment.findMany({ where: { learnerId: session.user.id, status: "ACTIVE" }, select: { classId: true } })).map((item) => item.classId);
  }

  private async requireTeachingAccess(classId: string, session: AuthenticatedSession): Promise<void> {
    if (session.roleCode !== "INSTRUCTOR") throw new ForbiddenException("Nghiệp vụ học thuật chỉ dành cho giảng viên được phân công.");
    if (!session.permissions.includes("exam:manage") || !(await this.accessibleClassIds(session)).includes(classId)) throw new NotFoundException("Không tìm thấy lớp học trong phạm vi quản lý.");
  }

  private mapAssignment(row: Prisma.AssignmentGetPayload<{ include: { class: { select: { code: true } }; submissions: { include: { learner: { select: { displayName: true; email: true } }; attachments: true } } } }>, submission?: Prisma.AssignmentSubmissionGetPayload<{ include: { learner: { select: { displayName: true; email: true } }; attachments: true } }>): AssignmentView {
    return { id: row.id, classId: row.classId, classCode: row.class.code, title: row.title, description: row.description, instructions: row.instructions, dueAt: row.dueAt.toISOString(), maxScore: Number(row.maxScore), rubric: this.rubric(row.rubric), status: row.status, createdById: row.createdById, submission: submission ? this.mapSubmission(submission) : undefined, createdAt: row.createdAt.toISOString() };
  }

  private mapSubmission(row: Prisma.AssignmentSubmissionGetPayload<{ include: { learner: { select: { displayName: true; email: true } }; attachments: true } }>): AssignmentSubmissionView {
    return { id: row.id, assignmentId: row.assignmentId, learnerId: row.learnerId, learnerName: row.learner.displayName, learnerEmail: row.learner.email, content: row.content, attachments: row.attachments.map((item) => ({ id: item.id, originalName: item.originalName, mimeType: item.mimeType, sizeBytes: Number(item.sizeBytes), createdAt: item.createdAt.toISOString(), canPreview: item.mimeType === "application/pdf" || item.mimeType.startsWith("image/") })), status: row.status, submittedAt: row.submittedAt.toISOString(), score: row.score === null ? undefined : Number(row.score), rubricScores: this.rubricScores(row.rubricScores), feedback: row.feedback ?? undefined, gradedAt: row.gradedAt?.toISOString() };
  }

  private validateAssignmentFiles(files: UploadedAssignmentFile[]): void {
    if (files.length > 5) throw new BadRequestException("Mỗi lần chỉ được chọn tối đa 5 tệp.");
    const mimeByExtension: Record<string, string> = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", pdf: "application/pdf", doc: "application/msword", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", txt: "text/plain" };
    for (const file of files) {
      if (!file.originalName || file.originalName.length > 255) throw new BadRequestException("Tên tệp phải có từ 1 đến 255 ký tự.");
      if (file.size <= 0 || file.size > 20 * 1024 * 1024 || file.buffer.length !== file.size) throw new BadRequestException(`Tệp ${file.originalName} phải có dung lượng từ 1 byte đến 20 MB.`);
      const extension = file.originalName.split(".").pop()?.toLowerCase() ?? "";
      const expectedMime = mimeByExtension[extension];
      if (!expectedMime || (file.mimeType && file.mimeType !== "application/octet-stream" && file.mimeType !== expectedMime)) throw new BadRequestException(`Tệp ${file.originalName} không đúng định dạng JPG, PNG, WebP, PDF, DOC, DOCX hoặc TXT.`);
      const validSignature = extension === "txt" ? !file.buffer.includes(0) && !file.buffer.toString("utf8").includes("\uFFFD")
        : extension === "jpg" || extension === "jpeg" ? file.buffer.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))
          : extension === "png" ? file.buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
            : extension === "webp" ? file.buffer.subarray(0, 4).toString("ascii") === "RIFF" && file.buffer.subarray(8, 12).toString("ascii") === "WEBP"
              : extension === "pdf" ? file.buffer.subarray(0, 4).toString("ascii") === "%PDF"
                : extension === "doc" ? file.buffer.subarray(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]))
                  : file.buffer.subarray(0, 2).toString("ascii") === "PK";
      if (!validSignature) throw new BadRequestException(`Nội dung tệp ${file.originalName} không khớp với phần mở rộng.`);
      file.mimeType = expectedMime;
    }
  }

  private rubric(value: Prisma.JsonValue): RubricCriterion[] {
    if (!Array.isArray(value)) throw new BadRequestException("Rubric lưu trữ không hợp lệ.");
    return value.map((item) => { const row = item as Record<string, unknown>; return { id: String(row.id), title: String(row.title), description: String(row.description), maxPoints: Number(row.maxPoints) }; });
  }

  private rubricScores(value: Prisma.JsonValue | null): Array<{ criterionId: string; score: number }> {
    if (!Array.isArray(value)) return [];
    return value.map((item) => { const row = item as Record<string, unknown>; return { criterionId: String(row.criterionId), score: Number(row.score) }; });
  }
}
