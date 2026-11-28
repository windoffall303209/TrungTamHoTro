import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from "@nestjs/common";
import type { Prisma } from "../../../../generated/prisma/client.js";
import {
  paginateArray,
  type PaginatedResult,
} from "../../../../common/pagination.js";
import { id, now } from "../../core/learning.shared.js";
import { isPrismaUniqueConstraintError } from "../../../../infrastructure/prisma-errors.js";
import type {
  CourseVersionSnapshot,
  LearningCourse,
} from "../../core/learning.types.js";
import type { LearningServiceContext } from "../../core/learning.context.js";
import { readWithoutTransaction } from "../../../../database/read-without-transaction.js";

export const STANDARD_K12_GRADES = [
  "1",
  "2",
  "3",
  "4",
  "5",
  "6",
  "7",
  "8",
  "9",
  "10",
  "11",
  "12",
] as const;

export const STANDARD_K12_SUBJECTS = [
  "Toán",
  "Ngữ văn",
  "Tiếng Anh",
  "Vật lí",
  "Hóa học",
  "Sinh học",
  "Lịch sử",
  "Địa lí",
  "Tin học",
  "Công nghệ",
  "GDCD",
  "Khoa học tự nhiên",
  "Lịch sử và Địa lí",
] as const;

export interface CoursePageFilters {
  query?: string;
  grade?: string | number;
  subject?: string;
  status?: LearningCourse["status"];
  page?: number;
  pageSize?: number;
}

/** Chuẩn hóa giá trị khối học từ số hoặc chuỗi sang chuỗi đã cắt khoảng trắng. */
export function normalizeGradeText(value?: string | number | null): string | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }
  return undefined;
}

/** Liệt kê khóa học từ DB hoặc trả bản sao dữ liệu nhớ để tránh mutation ngoài service. */
export async function listCourses(
  serviceContext: LearningServiceContext,
): Promise<LearningCourse[]> {
  const prisma = serviceContext.database();
  if (prisma) {
    const rows = await prisma.course.findMany({
      orderBy: { createdAt: "desc" },
    });
    return rows.map((row) => serviceContext.mapCourse(row));
  }
  return serviceContext.courses.map((item) => ({
    ...item,
    outcomes: [...item.outcomes],
  }));
}

/** Trả về một trang danh mục khóa học kèm tổng số bản ghi được lọc trực tiếp từ DB. */
export async function listCoursesPage(
  serviceContext: LearningServiceContext,
  filters: CoursePageFilters = {},
): Promise<PaginatedResult<LearningCourse>> {
  const query = filters.query?.trim();
  const grade = normalizeGradeText(filters.grade);
  const subject = filters.subject?.trim();
  if (
    (query && query.length > 255) ||
    (grade && grade.length > 255) ||
    (subject && subject.length > 255)
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
    const andConditions: Prisma.CourseWhereInput[] = [];
    if (grade === "__OTHER__") {
      andConditions.push(
        { grade: { not: null } },
        { grade: { notIn: ["", ...STANDARD_K12_GRADES] } },
      );
    } else if (grade !== undefined) {
      andConditions.push({ grade });
    }
    if (subject === "__OTHER__") {
      andConditions.push(
        { subject: { not: null } },
        { subject: { notIn: ["", ...STANDARD_K12_SUBJECTS] } },
      );
    } else if (subject) {
      andConditions.push({ subject });
    }
    if (filters.status) andConditions.push({ status: filters.status });
    if (query) {
      andConditions.push({
        OR: [
          { code: { contains: query, mode: "insensitive" } },
          { name: { contains: query, mode: "insensitive" } },
          { description: { contains: query, mode: "insensitive" } },
        ],
      });
    }
    const where: Prisma.CourseWhereInput =
      andConditions.length > 0 ? { AND: andConditions } : {};
    const { rows, total, safePage, totalPages } = await readWithoutTransaction(prisma,
      async (transaction) => {
        const total = await transaction.course.count({ where });
        const totalPages = Math.max(1, Math.ceil(total / pageSize));
        const safePage = Math.min(page, totalPages);
        const rows =
          total === 0
            ? []
            : await transaction.course.findMany({
                where,
                orderBy: [{ createdAt: "desc" }, { id: "asc" }],
                skip: (safePage - 1) * pageSize,
                take: pageSize,
              });
        return { rows, total, safePage, totalPages };
      }
    );
    return {
      items: rows.map((row) => serviceContext.mapCourse(row)),
      total,
      page: safePage,
      pageSize,
      totalPages,
    };
  }
  const normalizedQuery = query?.toLowerCase() ?? "";
  const filtered = serviceContext.courses
    .filter((item) => {
      if (grade === "__OTHER__") {
        if (!item.grade || (STANDARD_K12_GRADES as readonly string[]).includes(item.grade)) {
          return false;
        }
      } else if (grade !== undefined && item.grade !== grade) {
        return false;
      }
      if (subject === "__OTHER__") {
        if (!item.subject || (STANDARD_K12_SUBJECTS as readonly string[]).includes(item.subject)) {
          return false;
        }
      } else if (subject && item.subject !== subject) {
        return false;
      }
      if (filters.status && item.status !== filters.status) return false;
      if (
        normalizedQuery &&
        !`${item.code} ${item.name} ${item.description}`
          .toLowerCase()
          .includes(normalizedQuery)
      ) {
        return false;
      }
      return true;
    })
    .map((item) => ({
      ...item,
      outcomes: [...item.outcomes],
    }));
  return paginateArray(filtered, page, pageSize);
}

/** Tạo khóa học nháp sau khi chuẩn hóa mã và chống trùng, đồng thời ghi audit. */
export async function createCourse(
  serviceContext: LearningServiceContext,
  input: Pick<LearningCourse, "code" | "name" | "description" | "outcomes"> & {
    grade?: string | number;
    subject?: string;
  },
  actorId: string,
): Promise<LearningCourse> {
  const code = input.code.trim().toUpperCase();
  const normalizedGrade = normalizeGradeText(input.grade);
  const prisma = serviceContext.database();
  if (prisma) {
    try {
      const row = await prisma.course.create({
        data: {
          id: id("course"),
          code,
          name: input.name.trim(),
          description: input.description.trim(),
          grade: normalizedGrade ?? null,
          subject: input.subject?.trim() || null,
          outcomes: input.outcomes.filter(Boolean),
          ownerId: actorId,
        },
      });
      return serviceContext.mapCourse(row);
    } catch (error) {
      if (isPrismaUniqueConstraintError(error))
        throw new ConflictException("Mã khóa học đã tồn tại.");
      throw error;
    }
  }
  if (serviceContext.courses.some((course) => course.code === code))
    throw new ConflictException("Mã khóa học đã tồn tại.");
  const timestamp = now();
  const course: LearningCourse = {
    id: id("course"),
    code,
    name: input.name.trim(),
    description: input.description.trim(),
    grade: normalizedGrade,
    subject: input.subject?.trim() || undefined,
    outcomes: input.outcomes.filter(Boolean),
    status: "DRAFT",
    version: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  serviceContext.courses.unshift(course);
  return { ...course, outcomes: [...course.outcomes] };
}

/** Cập nhật nội dung khóa học; khóa học đã xuất bản sẽ tăng version theo quy tắc lưu lịch sử. */
export async function updateCourse(
  serviceContext: LearningServiceContext,
  courseId: string,
  input: Pick<LearningCourse, "name" | "description" | "outcomes"> & {
    grade?: string | number;
    subject?: string;
  },
  actorId: string,
): Promise<LearningCourse> {
  const name = input.name.trim();
  const description = input.description.trim();
  const outcomes = input.outcomes.map((item) => item.trim()).filter(Boolean);
  const normalizedGrade =
    input.grade !== undefined ? normalizeGradeText(input.grade) ?? null : undefined;
  if (!outcomes.length)
    throw new BadRequestException("Khóa học cần ít nhất một mục tiêu học tập.");
  const prisma = serviceContext.database();
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
        data: {
          name,
          description,
          outcomes,
          grade: normalizedGrade !== undefined ? normalizedGrade : current.grade,
          subject: input.subject !== undefined ? input.subject?.trim() || null : current.subject,
          status: "DRAFT",
        },
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
      return serviceContext.mapCourse(row);
    });
  }
  const current = serviceContext.findCourse(courseId);
  if (current.status === "ARCHIVED")
    throw new ConflictException("Khóa học đã ngừng sử dụng và không thể sửa.");
  Object.assign(current, {
    name,
    description,
    outcomes,
    grade: normalizedGrade !== undefined ? normalizedGrade ?? undefined : current.grade,
    subject: input.subject !== undefined ? input.subject?.trim() || undefined : current.subject,
    status: "DRAFT",
    updatedAt: now(),
  });
  return { ...current, outcomes: [...current.outcomes] };
}

/** Liệt kê snapshot xuất bản của khóa học theo thứ tự phiên bản. */
export async function listCourseVersions(
  serviceContext: LearningServiceContext,
  courseId: string,
): Promise<CourseVersionSnapshot[]> {
  const prisma = serviceContext.database();
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
      grade: row.grade ?? undefined,
      subject: row.subject ?? undefined,
      outcomes: serviceContext.toStringArray(row.outcomes),
      publishedBy: row.publishedBy,
      publishedAt: row.publishedAt.toISOString(),
    }));
  }
  serviceContext.findCourse(courseId);
  return serviceContext.courseVersions
    .filter((item) => item.courseId === courseId)
    .sort((a, b) => b.version - a.version)
    .map((item) => ({ ...item, outcomes: [...item.outcomes] }));
}

/** Xuất bản khóa học và chụp snapshot bất biến của phiên bản hiện tại trong transaction. */
export async function publishCourse(
  serviceContext: LearningServiceContext,
  courseId: string,
  actorId: string,
): Promise<LearningCourse> {
  const prisma = serviceContext.database();
  if (prisma) {
    return prisma.$transaction(async (transaction) => {
      const course = await transaction.course.findUnique({
        where: { id: courseId },
        include: { versions: { orderBy: { version: "desc" }, take: 1 } },
      });
      if (!course) throw new NotFoundException("Không tìm thấy khóa học.");
      if (course.status === "ARCHIVED")
        throw new ConflictException("Khóa học đã ngừng sử dụng.");
      if (course.status === "PUBLISHED")
        return serviceContext.mapCourse(course);
      const outcomes = serviceContext.toStringArray(course.outcomes);
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
          grade: course.grade,
          subject: course.subject,
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
      return serviceContext.mapCourse(updated);
    });
  }
  const course = serviceContext.findCourse(courseId);
  if (course.status === "ARCHIVED")
    throw new ConflictException("Khóa học đã ngừng sử dụng.");
  if (course.status === "PUBLISHED")
    return { ...course, outcomes: [...course.outcomes] };
  if (!course.outcomes.length)
    throw new BadRequestException("Khóa học cần ít nhất một mục tiêu học tập.");
  const lastVersion = Math.max(
    0,
    ...serviceContext.courseVersions
      .filter((item) => item.courseId === courseId)
      .map((item) => item.version),
  );
  course.version = lastVersion ? lastVersion + 1 : Math.max(1, course.version);
  course.status = "PUBLISHED";
  course.updatedAt = now();
  serviceContext.courseVersions.unshift({
    id: id("course-version"),
    courseId,
    version: course.version,
    name: course.name,
    description: course.description,
    grade: course.grade,
    subject: course.subject,
    outcomes: [...course.outcomes],
    publishedBy: actorId,
    publishedAt: now(),
  });
  return { ...course, outcomes: [...course.outcomes] };
}

/** Chuyển khóa học sang ARCHIVED sau khi kiểm tra ràng buộc sử dụng và lưu lý do audit. */
export async function archiveCourse(
  serviceContext: LearningServiceContext,
  courseId: string,
  reason: string | undefined,
  actorId: string,
): Promise<LearningCourse> {
  const normalizedReason = reason?.trim() || "Ngừng sử dụng khóa học";
  const prisma = serviceContext.database();
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
      return serviceContext.mapCourse(row);
    });
  }
  const current = serviceContext.findCourse(courseId);
  if (current.status === "ARCHIVED")
    throw new ConflictException("Khóa học đã ngừng sử dụng.");
  const activeClassCount = serviceContext.classes.filter(
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
