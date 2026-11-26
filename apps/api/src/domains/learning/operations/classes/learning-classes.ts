import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { Prisma } from "../../../../generated/prisma/client.js";
import type { AuthenticatedSession } from "../../../../auth/auth.service.js";
import {
  paginateArray,
  type PaginatedResult,
} from "../../../../common/pagination.js";
import { copyLearningClass, id, now } from "../../core/learning.shared.js";
import { seedDefaultClassFolders } from "../materials/class-folders.js";
import {
  normalizeGradeText,
  STANDARD_K12_GRADES,
  STANDARD_K12_SUBJECTS,
} from "../courses/learning-courses.js";
import { isPrismaUniqueConstraintError } from "../../../../infrastructure/prisma-errors.js";
import type { ClassCapabilities, LearningClass, LearningCourse } from "../../core/learning.types.js";
import type { LearningServiceContext } from "../../core/learning.context.js";
import { readWithoutTransaction } from "../../../../database/read-without-transaction.js";

export interface ClassPageFilters {
  query?: string;
  grade?: string | number;
  subject?: string;
  courseId?: string;
  status?: LearningClass["status"];
  page?: number;
  pageSize?: number;
}

export type CreateClassInput = Pick<
  LearningClass,
  "code" | "name" | "term" | "startAt" | "endAt" | "capacity"
> & {
  courseId?: string;
  timezone?: string;
  allowPeerGradeViewing?: boolean;
  allowLearnerFeedPosting?: boolean;
  grade?: string | number;
  subject?: string;
};

/** Định dạng tên hiển thị cho khối học (thêm tiền tố Khối với số 1..12, giữ nguyên tên tùy chỉnh). */
function formatGradeDisplay(grade: string): string {
  return /^\d+$/.test(grade) ? `Khối ${grade}` : grade;
}

/** Sinh mã khóa học tự động duy nhất khi người dùng mở lớp trực tiếp theo Khối & Môn. */
function buildAutoCourseCode(): string {
  return `CRS-${randomUUID().replace(/-/g, "").slice(0, 10).toUpperCase()}`;
}

/** Tạo điều kiện Prisma giới hạn lớp học theo vai trò và quan hệ thành viên của phiên. */
function buildClassRoleWhere(
  role: string,
  actorId: string,
): Prisma.LearningClassWhereInput | undefined {
  if (role === "LEARNER") {
    // Lớp nháp chưa mở cho học viên dù đã có ghi danh trước.
    return { status: { not: "DRAFT" }, enrollments: { some: { learnerId: actorId, status: "ACTIVE" } } };
  }
  if (role === "INSTRUCTOR") {
    return { instructors: { some: { instructorId: actorId } } };
  }
  return undefined;
}

/** Kiểm tra thành viên lớp trên dữ liệu bộ nhớ fallback khi không kết nối Prisma. */
function matchesMemoryClassRole(
  item: LearningClass,
  role: string,
  actorId: string,
): boolean {
  if (role === "LEARNER") return item.status !== "DRAFT" && item.learnerIds.includes(actorId);
  if (role === "INSTRUCTOR") return item.instructorIds.includes(actorId);
  return true;
}

/** Học viên chỉ nhận id của chính mình trong learnerIds (kèm sĩ số), không nhận danh sách id của cả lớp. */
function redactClassForRole(item: LearningClass, role: string, actorId: string): LearningClass {
  if (role !== "LEARNER") return item;
  return { ...item, learnerIds: item.learnerIds.filter((learnerId) => learnerId === actorId), learnerCount: item.learnerIds.length };
}

/** Lọc lớp theo vai trò: quản trị xem tất cả, giảng viên/học viên theo quan hệ thành viên. */
export async function listClasses(
  serviceContext: LearningServiceContext,
  role: string,
  actorId: string,
): Promise<LearningClass[]> {
  const prisma = serviceContext.database();
  if (prisma) {
    const rows = await prisma.learningClass.findMany({
      where: buildClassRoleWhere(role, actorId),
      include: {
        instructors: true,
        enrollments: { where: { status: "ACTIVE" } },
      },
      orderBy: { startAt: "desc" },
    });
    return rows.map((row) => redactClassForRole(serviceContext.mapClass(row), role, actorId));
  }
  return serviceContext.classes
    .filter((item) => matchesMemoryClassRole(item, role, actorId))
    .map((item) => redactClassForRole(copyLearningClass(item), role, actorId));
}

/** Đọc chi tiết đúng một lớp theo quyền truy cập của vai trò hiện tại để tránh tải toàn bộ danh sách lớp. */
export async function getClassById(
  serviceContext: LearningServiceContext,
  classId: string,
  role: string,
  actorId: string,
): Promise<LearningClass> {
  const prisma = serviceContext.database();
  if (prisma) {
    const roleWhere = buildClassRoleWhere(role, actorId);
    const row = await prisma.learningClass.findFirst({
      where: roleWhere ? { AND: [{ id: classId }, roleWhere] } : { id: classId },
      include: {
        instructors: true,
        enrollments: { where: { status: "ACTIVE" } },
      },
    });
    if (!row) throw new NotFoundException("Không tìm thấy lớp học.");
    return redactClassForRole(serviceContext.mapClass(row), role, actorId);
  }
  const found = serviceContext.classes.find(
    (item) => item.id === classId && matchesMemoryClassRole(item, role, actorId),
  );
  if (!found) throw new NotFoundException("Không tìm thấy lớp học.");
  return redactClassForRole(copyLearningClass(found), role, actorId);
}

/** Phân trang danh sách lớp học theo vai trò, khóa học, khối/môn và từ khóa trực tiếp ở DB. */
export async function listClassesPage(
  serviceContext: LearningServiceContext,
  role: string,
  actorId: string,
  filters: ClassPageFilters = {},
): Promise<PaginatedResult<LearningClass>> {
  const query = filters.query?.trim();
  const grade = normalizeGradeText(filters.grade);
  const subject = filters.subject?.trim();
  const courseId = filters.courseId?.trim();
  if (
    (query && query.length > 255) ||
    (grade && grade.length > 255) ||
    (subject && subject.length > 255) ||
    (courseId && courseId.length > 255)
  ) {
    throw new BadRequestException("Search filters must not exceed 255 characters.");
  }
  const page =
    Number.isSafeInteger(filters.page) &&
    (filters.page ?? 0) > 0 &&
    (filters.page ?? 0) <= 100_000
      ? (filters.page as number)
      : 1;
  const pageSize =
    Number.isInteger(filters.pageSize) && (filters.pageSize ?? 0) > 0
      ? Math.min(filters.pageSize as number, 100)
      : 20;
  const prisma = serviceContext.database();
  if (prisma) {
    const andConditions: Prisma.LearningClassWhereInput[] = [];
    const roleWhere = buildClassRoleWhere(role, actorId);
    if (roleWhere) andConditions.push(roleWhere);
    if (courseId) andConditions.push({ courseId });
    if (filters.status) andConditions.push({ status: filters.status });
    if (grade === "__OTHER__") {
      andConditions.push({
        OR: [
          {
            AND: [
              { grade: { not: null } },
              { grade: { notIn: ["", ...STANDARD_K12_GRADES] } },
            ],
          },
          {
            OR: [{ grade: null }, { grade: "" }],
            course: {
              is: {
                AND: [
                  { grade: { not: null } },
                  { grade: { notIn: ["", ...STANDARD_K12_GRADES] } },
                ],
              },
            },
          },
        ],
      });
    } else if (grade !== undefined) {
      andConditions.push({
        OR: [
          { grade },
          {
            OR: [{ grade: null }, { grade: "" }],
            course: { is: { grade } },
          },
        ],
      });
    }
    if (subject === "__OTHER__") {
      andConditions.push({
        OR: [
          {
            AND: [
              { subject: { not: null } },
              { subject: { notIn: ["", ...STANDARD_K12_SUBJECTS] } },
            ],
          },
          {
            OR: [{ subject: null }, { subject: "" }],
            course: {
              is: {
                AND: [
                  { subject: { not: null } },
                  { subject: { notIn: ["", ...STANDARD_K12_SUBJECTS] } },
                ],
              },
            },
          },
        ],
      });
    } else if (subject) {
      andConditions.push({
        OR: [
          { subject },
          {
            OR: [{ subject: null }, { subject: "" }],
            course: { is: { subject } },
          },
        ],
      });
    }
    if (query) {
      andConditions.push({
        OR: [
          { code: { contains: query, mode: "insensitive" } },
          { name: { contains: query, mode: "insensitive" } },
          { term: { contains: query, mode: "insensitive" } },
        ],
      });
    }
    const where: Prisma.LearningClassWhereInput | undefined =
      andConditions.length > 0 ? { AND: andConditions } : undefined;
    const { rows, total, safePage, totalPages } = await readWithoutTransaction(prisma,
      async (transaction) => {
        const total = await transaction.learningClass.count({ where });
        const totalPages = Math.max(1, Math.ceil(total / pageSize));
        const safePage = Math.min(page, totalPages);
        const rows =
          total === 0
            ? []
            : await transaction.learningClass.findMany({
                where,
                include: {
                  instructors: true,
                  enrollments: { where: { status: "ACTIVE" } },
                },
                orderBy: [{ startAt: "desc" }, { id: "asc" }],
                skip: (safePage - 1) * pageSize,
                take: pageSize,
              });
        return { rows, total, safePage, totalPages };
      }
    );
    return {
      items: rows.map((row) => redactClassForRole(serviceContext.mapClass(row), role, actorId)),
      total,
      page: safePage,
      pageSize,
      totalPages,
    };
  }

  const normalizedQuery = query?.toLowerCase() ?? "";
  const courseById = new Map(serviceContext.courses.map((item) => [item.id, item]));
  const filtered = serviceContext.classes
    .filter((item) => {
      if (!matchesMemoryClassRole(item, role, actorId)) return false;
      if (courseId && item.courseId !== courseId) return false;
      if (filters.status && item.status !== filters.status) return false;
      const parentCourse = courseById.get(item.courseId);
      if (grade !== undefined) {
        const effectiveGrade = item.grade || parentCourse?.grade;
        if (grade === "__OTHER__") {
          if (
            !effectiveGrade ||
            (STANDARD_K12_GRADES as readonly string[]).includes(effectiveGrade)
          ) {
            return false;
          }
        } else if (effectiveGrade !== grade) {
          return false;
        }
      }
      if (subject) {
        const effectiveSubject = item.subject || parentCourse?.subject;
        if (subject === "__OTHER__") {
          if (
            !effectiveSubject ||
            (STANDARD_K12_SUBJECTS as readonly string[]).includes(effectiveSubject)
          ) {
            return false;
          }
        } else if (effectiveSubject !== subject) {
          return false;
        }
      }
      if (
        normalizedQuery &&
        !`${item.code} ${item.name} ${item.term}`
          .toLowerCase()
          .includes(normalizedQuery)
      ) {
        return false;
      }
      return true;
    })
    .map(copyLearningClass);
  return paginateArray(filtered, page, pageSize);
}

/** Tính capability tại máy chủ từ quyền phiên, quan hệ lớp và trạng thái thay vì tên vai trò đơn lẻ. */
export async function getClassCapabilities(
  serviceContext: LearningServiceContext,
  classId: string,
  session: AuthenticatedSession,
): Promise<ClassCapabilities> {
  const prisma = serviceContext.database();
  let status: LearningClass["status"];
  let relationship: ClassCapabilities["relationship"] = "NONE";
  if (prisma) {
    const item = await prisma.learningClass.findUnique({
      where: { id: classId },
      include: { instructors: true, enrollments: true },
    });
    if (!item) throw new NotFoundException("Không tìm thấy lớp học.");
    status = item.status;
    if (session.roleCode === "SYSTEM_ADMIN") relationship = "ADMIN";
    else if (session.roleCode === "CENTER_MANAGER") relationship = "MANAGER";
    else if (
      item.instructors.some((entry) => entry.instructorId === session.user.id)
    )
      relationship = "INSTRUCTOR";
    else if (
      item.enrollments.some(
        (entry) =>
          entry.learnerId === session.user.id && entry.status === "ACTIVE",
      )
    )
      relationship = "LEARNER";
  } else {
    const item = serviceContext.findClass(classId);
    status = item.status;
    if (session.roleCode === "SYSTEM_ADMIN") relationship = "ADMIN";
    else if (session.roleCode === "CENTER_MANAGER") relationship = "MANAGER";
    else if (item.instructorIds.includes(session.user.id))
      relationship = "INSTRUCTOR";
    else if (item.learnerIds.includes(session.user.id))
      relationship = "LEARNER";
  }
  const permissions = new Set(session.permissions);
  const related = relationship !== "NONE";
  if (!related)
    throw new NotFoundException(
      "Không tìm thấy lớp học trong phạm vi truy cập.",
    );
  const writable = status !== "CLOSED";
  /** Tạo kết quả cho phép thao tác kèm lý do từ chối, ưu tiên trạng thái lớp chỉ đọc. */
  const decide = (
    allowed: boolean,
    deniedReason: string,
  ): { allowed: boolean; reason?: string } =>
    allowed
      ? { allowed: true }
      : {
          allowed: false,
          reason: !writable ? "Lớp đã đóng và chỉ cho phép đọc." : deniedReason,
        };
  return {
    classId,
    relationship,
    classStatus: status,
    actions: {
      view: decide(
        permissions.has("class:view") && related,
        "Bạn không có quyền xem lớp này.",
      ),
      manageRoster: decide(
        writable &&
          ["ADMIN", "MANAGER"].includes(relationship) &&
          permissions.has("class:manage"),
        "Chỉ quản trị hoặc quản lý có quyền điều phối thành viên.",
      ),
      manageContent: decide(
        writable &&
          relationship === "INSTRUCTOR" &&
          permissions.has("material:manage"),
        "Chỉ giảng viên được phân công có quyền quản lý học liệu.",
      ),
      submitWork: decide(
        writable && relationship === "LEARNER" && permissions.has("exam:view"),
        "Chỉ học viên đang ghi danh có quyền nộp bài.",
      ),
      grade: decide(
        writable &&
          relationship === "INSTRUCTOR" &&
          permissions.has("exam:manage"),
        "Chỉ giảng viên được phân công có quyền chấm bài.",
      ),
      postForum: decide(
        writable &&
          ["INSTRUCTOR", "LEARNER"].includes(relationship) &&
          permissions.has("forum:post"),
        "Bạn không có quyền đăng trong lớp này.",
      ),
      joinLive: decide(
        writable &&
          ["INSTRUCTOR", "LEARNER"].includes(relationship) &&
          permissions.has("session:view"),
        "Bạn không thuộc lớp hoặc thiếu quyền tham gia buổi học.",
      ),
      chat: decide(
        writable && ["INSTRUCTOR", "LEARNER"].includes(relationship),
        "Bạn không phải thành viên đang hoạt động của lớp.",
      ),
    },
  };
}

/** Mở lớp nháp theo Khối và Môn học (tự động gắn/tạo học phần nền nếu không truyền courseId) và kiểm tra lịch, sức chứa, múi giờ. */
export async function createClass(
  serviceContext: LearningServiceContext,
  input: CreateClassInput,
  actorId: string,
): Promise<LearningClass> {
  const code = input.code.trim().toUpperCase();
  const term = input.term.trim();
  const timezone = input.timezone?.trim() || "Asia/Bangkok";
  const explicitCourseId = input.courseId?.trim() || undefined;
  const normalizedGrade = normalizeGradeText(input.grade);
  const normalizedSubject = input.subject?.trim() || undefined;
  serviceContext.validateTimezone(timezone);
  if (new Date(input.endAt) <= new Date(input.startAt)) {
    throw new BadRequestException("Ngày kết thúc phải sau ngày bắt đầu.");
  }
  if (!explicitCourseId && (!normalizedGrade || !normalizedSubject)) {
    throw new BadRequestException(
      "Vui lòng chọn hoặc nhập đầy đủ Khối và Môn học để mở lớp.",
    );
  }

  const prisma = serviceContext.database();
  if (prisma) {
    if (explicitCourseId) {
      const course = await prisma.course.findUnique({
        where: { id: explicitCourseId },
      });
      if (!course || course.status !== "PUBLISHED") {
        throw new BadRequestException(
          "Khóa học phải được phát hành trước khi mở lớp.",
        );
      }
      try {
        const row = await prisma.learningClass.create({
          data: {
            id: id("class"),
            courseId: course.id,
            courseVersion: course.version,
            code,
            name: input.name.trim(),
            term,
            grade: normalizedGrade ?? course.grade ?? null,
            subject: normalizedSubject || course.subject || null,
            startAt: new Date(input.startAt),
            endAt: new Date(input.endAt),
            capacity: input.capacity,
            timezone,
            allowPeerGradeViewing: input.allowPeerGradeViewing ?? false,
            allowLearnerFeedPosting: input.allowLearnerFeedPosting ?? true,
          },
          include: { instructors: true, enrollments: true },
        });
        await seedDefaultClassFolders({ database: prisma }, row.id);
        await prisma.auditLog.create({
          data: {
            actorId,
            action: "CLASS_DRAFT_CREATED",
            entityType: "learning_class",
            entityId: row.id,
            context: {
              courseId: course.id,
              courseVersion: course.version,
              code,
              term,
              timezone,
              grade: row.grade,
              subject: row.subject,
            },
          },
        });
        return serviceContext.mapClass(row);
      } catch (error) {
        if (isPrismaUniqueConstraintError(error)) {
          throw new ConflictException("Mã lớp đã tồn tại.");
        }
        throw error;
      }
    }

    try {
      const row = await prisma.$transaction(async (transaction) => {
        let course = await transaction.course.findFirst({
          where: {
            grade: normalizedGrade!,
            subject: normalizedSubject!,
            status: "PUBLISHED",
          },
          orderBy: { updatedAt: "desc" },
        });
        if (!course) {
          const gradeLabel = formatGradeDisplay(normalizedGrade!);
          const courseName = `${normalizedSubject!} - ${gradeLabel}`.slice(0, 200);
          const courseDescription = `Chương trình ${normalizedSubject!} (${gradeLabel})`;
          const outcomes = [
            `Hoàn thành chương trình ${normalizedSubject!} (${gradeLabel})`,
          ];
          course = await transaction.course.create({
            data: {
              id: id("course"),
              code: buildAutoCourseCode(),
              name: courseName,
              description: courseDescription,
              grade: normalizedGrade!,
              subject: normalizedSubject!,
              outcomes,
              status: "PUBLISHED",
              version: 1,
              ownerId: actorId,
            },
          });
          await transaction.courseVersion.create({
            data: {
              id: id("course-version"),
              courseId: course.id,
              version: 1,
              name: courseName,
              description: courseDescription,
              grade: normalizedGrade!,
              subject: normalizedSubject!,
              outcomes,
              publishedBy: actorId,
            },
          });
        } else {
          await transaction.courseVersion.upsert({
            where: {
              courseId_version: {
                courseId: course.id,
                version: course.version,
              },
            },
            update: {},
            create: {
              id: id("course-version"),
              courseId: course.id,
              version: course.version,
              name: course.name,
              description: course.description,
              grade: course.grade,
              subject: course.subject,
              outcomes: serviceContext.toStringArray(course.outcomes),
              publishedBy: actorId,
            },
          });
        }

        const created = await transaction.learningClass.create({
          data: {
            id: id("class"),
            courseId: course.id,
            courseVersion: course.version,
            code,
            name: input.name.trim(),
            term,
            grade: normalizedGrade!,
            subject: normalizedSubject!,
            startAt: new Date(input.startAt),
            endAt: new Date(input.endAt),
            capacity: input.capacity,
            timezone,
            allowPeerGradeViewing: input.allowPeerGradeViewing ?? false,
            allowLearnerFeedPosting: input.allowLearnerFeedPosting ?? true,
          },
          include: { instructors: true, enrollments: true },
        });
        await seedDefaultClassFolders({ database: transaction }, created.id);
        await transaction.auditLog.create({
          data: {
            actorId,
            action: "CLASS_DRAFT_CREATED",
            entityType: "learning_class",
            entityId: created.id,
            context: {
              courseId: course.id,
              courseVersion: course.version,
              code,
              term,
              timezone,
              grade: created.grade,
              subject: created.subject,
            },
          },
        });
        return created;
      });
      return serviceContext.mapClass(row);
    } catch (error) {
      if (isPrismaUniqueConstraintError(error)) {
        throw new ConflictException("Mã lớp đã tồn tại.");
      }
      throw error;
    }
  }

  let course: LearningCourse;
  if (explicitCourseId) {
    const existingCourse = serviceContext.courses.find(
      (item) => item.id === explicitCourseId && item.status === "PUBLISHED",
    );
    if (!existingCourse) {
      throw new BadRequestException(
        "Khóa học phải được phát hành trước khi mở lớp.",
      );
    }
    course = existingCourse;
  } else {
    const existingCourse = serviceContext.courses.find(
      (item) =>
        item.status === "PUBLISHED" &&
        item.grade === normalizedGrade &&
        item.subject === normalizedSubject,
    );
    if (existingCourse) {
      course = existingCourse;
    } else {
      const timestamp = now();
      const gradeLabel = formatGradeDisplay(normalizedGrade!);
      const courseName = `${normalizedSubject!} - ${gradeLabel}`.slice(0, 200);
      const courseDescription = `Chương trình ${normalizedSubject!} (${gradeLabel})`;
      const outcomes = [
        `Hoàn thành chương trình ${normalizedSubject!} (${gradeLabel})`,
      ];
      course = {
        id: id("course"),
        code: buildAutoCourseCode(),
        name: courseName,
        description: courseDescription,
        grade: normalizedGrade!,
        subject: normalizedSubject!,
        outcomes,
        status: "PUBLISHED",
        version: 1,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      serviceContext.courses.unshift(course);
      serviceContext.courseVersions.unshift({
        id: id("course-version"),
        courseId: course.id,
        version: 1,
        name: courseName,
        description: courseDescription,
        grade: normalizedGrade!,
        subject: normalizedSubject!,
        outcomes: [...outcomes],
        publishedBy: actorId,
        publishedAt: timestamp,
      });
    }
  }

  if (
    serviceContext.classes.some(
      (item) => item.code === code && item.term === term,
    )
  ) {
    throw new ConflictException("Mã lớp đã tồn tại trong học kỳ.");
  }
  const item: LearningClass = {
    id: id("class"),
    courseId: course.id,
    courseVersion: course.version,
    code,
    name: input.name.trim(),
    term,
    grade: normalizedGrade ?? course.grade,
    subject: normalizedSubject || course.subject,
    startAt: input.startAt,
    endAt: input.endAt,
    capacity: input.capacity,
    timezone,
    allowPeerGradeViewing: input.allowPeerGradeViewing ?? false,
    allowLearnerFeedPosting: input.allowLearnerFeedPosting ?? true,
    avatarUrl: null,
    status: "DRAFT",
    instructorIds: [],
    learnerIds: [],
  };
  serviceContext.classes.unshift(item);
  await seedDefaultClassFolders(serviceContext, item.id);
  return { ...item, instructorIds: [], learnerIds: [] };
}

/** Cập nhật thông tin và cài đặt lớp học. */
export async function updateClass(
  serviceContext: LearningServiceContext,
  classId: string,
  input: {
    name?: string;
    capacity?: number;
    allowPeerGradeViewing?: boolean;
    allowLearnerFeedPosting?: boolean;
  },
  actorId: string,
): Promise<LearningClass> {
  const prisma = serviceContext.database();
  if (prisma) {
    const existing = await prisma.learningClass.findUnique({
      where: { id: classId },
      include: { instructors: true, enrollments: true },
    });
    if (!existing) {
      throw new NotFoundException("Không tìm thấy lớp học.");
    }
    const dataToUpdate: Record<string, unknown> = {};
    if (input.name !== undefined) dataToUpdate.name = input.name.trim();
    if (input.capacity !== undefined) dataToUpdate.capacity = input.capacity;
    if (input.allowPeerGradeViewing !== undefined) dataToUpdate.allowPeerGradeViewing = input.allowPeerGradeViewing;
    if (input.allowLearnerFeedPosting !== undefined) dataToUpdate.allowLearnerFeedPosting = input.allowLearnerFeedPosting;

    const row = await prisma.learningClass.update({
      where: { id: classId },
      data: dataToUpdate,
      include: { instructors: true, enrollments: true },
    });
    await prisma.auditLog.create({
      data: {
        actorId,
        action: "CLASS_UPDATED",
        entityType: "learning_class",
        entityId: row.id,
        context: { changes: input },
      },
    });
    return serviceContext.mapClass(row);
  }

  const item = serviceContext.findClass(classId);
  if (!item) throw new NotFoundException("Không tìm thấy lớp học.");
  if (input.name !== undefined) item.name = input.name.trim();
  if (input.capacity !== undefined) item.capacity = input.capacity;
  if (input.allowPeerGradeViewing !== undefined) item.allowPeerGradeViewing = input.allowPeerGradeViewing;
  if (input.allowLearnerFeedPosting !== undefined) item.allowLearnerFeedPosting = input.allowLearnerFeedPosting;
  return item;
}
