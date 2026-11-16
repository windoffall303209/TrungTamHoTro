import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from "@nestjs/common";
import type { Prisma } from "../../../../generated/prisma/client.js";
import type { AuthenticatedSession } from "../../../../auth/auth.service.js";
import {
  paginateArray,
  type PaginatedResult,
} from "../../../../common/pagination.js";
import { copyLearningClass, id } from "../../core/learning.shared.js";
import { seedDefaultClassFolders } from "../materials/class-folders.js";
import { isPrismaUniqueConstraintError } from "../../../../infrastructure/prisma-errors.js";
import type { ClassCapabilities, LearningClass } from "../../core/learning.types.js";
import type { LearningServiceContext } from "../../core/learning.context.js";

export interface ClassPageFilters {
  query?: string;
  grade?: number;
  subject?: string;
  courseId?: string;
  status?: LearningClass["status"];
  page?: number;
  pageSize?: number;
}

/** Tạo điều kiện Prisma giới hạn lớp học theo vai trò và quan hệ thành viên của phiên. */
function buildClassRoleWhere(
  role: string,
  actorId: string,
): Prisma.LearningClassWhereInput | undefined {
  if (role === "LEARNER") {
    return { enrollments: { some: { learnerId: actorId, status: "ACTIVE" } } };
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
  if (role === "LEARNER") return item.learnerIds.includes(actorId);
  if (role === "INSTRUCTOR") return item.instructorIds.includes(actorId);
  return true;
}

/** Lọc lớp theo vai trò: quản trị xem tất cả, giảng viên/học viên theo quan hệ thành viên. */
export async function listClasses(
  serviceContext: LearningServiceContext,
  role: string,
  actorId = serviceContext.userIdForRole(role),
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
    return rows.map((row) => serviceContext.mapClass(row));
  }
  return serviceContext.classes
    .filter((item) => matchesMemoryClassRole(item, role, actorId))
    .map(copyLearningClass);
}

/** Phân trang danh sách lớp học theo vai trò, khóa học, khối/môn và từ khóa trực tiếp ở DB. */
export async function listClassesPage(
  serviceContext: LearningServiceContext,
  role: string,
  actorId = serviceContext.userIdForRole(role),
  filters: ClassPageFilters = {},
): Promise<PaginatedResult<LearningClass>> {
  const query = filters.query?.trim();
  const subject = filters.subject?.trim();
  const courseId = filters.courseId?.trim();
  if (
    (query && query.length > 255) ||
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
    if (filters.grade !== undefined) {
      andConditions.push({
        OR: [
          { grade: filters.grade },
          { grade: null, course: { is: { grade: filters.grade } } },
        ],
      });
    }
    if (subject) {
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
    const { rows, total, safePage, totalPages } = await prisma.$transaction(
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
      },
      { isolationLevel: "RepeatableRead" },
    );
    return {
      items: rows.map((row) => serviceContext.mapClass(row)),
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
      if (filters.grade !== undefined) {
        const effectiveGrade = item.grade ?? parentCourse?.grade;
        if (effectiveGrade !== filters.grade) return false;
      }
      if (subject) {
        const effectiveSubject = item.subject || parentCourse?.subject;
        if (effectiveSubject !== subject) return false;
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

/** Tạo lớp nháp từ phiên bản khóa học hợp lệ và kiểm tra lịch, sức chứa, múi giờ. */
export async function createClass(
  serviceContext: LearningServiceContext,
  input: Pick<
    LearningClass,
    "courseId" | "code" | "name" | "term" | "startAt" | "endAt" | "capacity"
  > &
    Partial<Pick<LearningClass, "timezone" | "allowLateEnrollment" | "grade" | "subject">>,
  actorId = "usr-manager",
): Promise<LearningClass> {
  const code = input.code.trim().toUpperCase();
  const term = input.term.trim();
  const timezone = input.timezone?.trim() || "Asia/Bangkok";
  serviceContext.validateTimezone(timezone);
  const prisma = serviceContext.database();
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
          grade: input.grade ?? course.grade ?? null,
          subject: input.subject?.trim() || course.subject || null,
          startAt: new Date(input.startAt),
          endAt: new Date(input.endAt),
          capacity: input.capacity,
          timezone,
          allowLateEnrollment: input.allowLateEnrollment ?? false,
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
            courseId: input.courseId,
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
      if (isPrismaUniqueConstraintError(error))
        throw new ConflictException("Mã lớp đã tồn tại.");
      throw error;
    }
  }
  if (
    !serviceContext.courses.some(
      (course) => course.id === input.courseId && course.status === "PUBLISHED",
    )
  )
    throw new BadRequestException(
      "Khóa học phải được phát hành trước khi mở lớp.",
    );
  if (new Date(input.endAt) <= new Date(input.startAt))
    throw new BadRequestException("Ngày kết thúc phải sau ngày bắt đầu.");
  if (
    serviceContext.classes.some(
      (item) => item.code === code && item.term === term,
    )
  )
    throw new ConflictException("Mã lớp đã tồn tại trong học kỳ.");
  const course = serviceContext.findCourse(input.courseId);
  const item: LearningClass = {
    ...input,
    courseVersion: course.version,
    code,
    term,
    grade: input.grade ?? course.grade,
    subject: input.subject?.trim() || course.subject,
    timezone,
    allowLateEnrollment: input.allowLateEnrollment ?? false,
    id: id("class"),
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
  input: { name?: string; capacity?: number; allowLateEnrollment?: boolean; allowPeerGradeViewing?: boolean },
  actorId = "usr-manager",
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
    if (input.allowLateEnrollment !== undefined) dataToUpdate.allowLateEnrollment = input.allowLateEnrollment;
    if (input.allowPeerGradeViewing !== undefined) dataToUpdate.allowPeerGradeViewing = input.allowPeerGradeViewing;

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
  if (input.allowLateEnrollment !== undefined) item.allowLateEnrollment = input.allowLateEnrollment;
  if (input.allowPeerGradeViewing !== undefined) item.allowPeerGradeViewing = input.allowPeerGradeViewing;
  return item;
}
