import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from "@nestjs/common";
import { id, isUniqueConstraintError, now } from "../learning.shared.js";
import type {
  CourseVersionSnapshot,
  LearningCourse,
} from "../learning.types.js";
import type { LearningServiceContext } from "../learning.context.js";

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

/** Tạo khóa học nháp sau khi chuẩn hóa mã và chống trùng, đồng thời ghi audit. */
export async function createCourse(
  serviceContext: LearningServiceContext,
  input: Pick<LearningCourse, "code" | "name" | "description" | "outcomes"> &
    Partial<Pick<LearningCourse, "grade" | "subject">>,
  actorId = "usr-manager",
): Promise<LearningCourse> {
  const code = input.code.trim().toUpperCase();
  const prisma = serviceContext.database();
  if (prisma) {
    try {
      const row = await prisma.course.create({
        data: {
          id: id("course"),
          code,
          name: input.name.trim(),
          description: input.description.trim(),
          grade: input.grade ?? null,
          subject: input.subject?.trim() || null,
          outcomes: input.outcomes.filter(Boolean),
          ownerId: actorId,
        },
      });
      return serviceContext.mapCourse(row);
    } catch (error) {
      if (isUniqueConstraintError(error))
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
    grade: input.grade,
    subject: input.subject?.trim(),
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
  input: Pick<LearningCourse, "name" | "description" | "outcomes"> &
    Partial<Pick<LearningCourse, "grade" | "subject">>,
  actorId = "usr-manager",
): Promise<LearningCourse> {
  const name = input.name.trim();
  const description = input.description.trim();
  const outcomes = input.outcomes.map((item) => item.trim()).filter(Boolean);
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
          grade: input.grade !== undefined ? input.grade : current.grade,
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
  actorId = "usr-manager",
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
  reason: string,
  actorId = "usr-manager",
): Promise<LearningCourse> {
  const normalizedReason = reason.trim();
  if (normalizedReason.length < 5)
    throw new BadRequestException("Lý do ngừng sử dụng cần ít nhất 5 ký tự.");
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
