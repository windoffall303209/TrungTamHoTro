import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from "@nestjs/common";
import type { AuthenticatedSession } from "../../auth/auth.service.js";
import { id, isUniqueConstraintError } from "../learning.shared.js";
import type { ClassCapabilities, LearningClass } from "../learning.types.js";
import type { LearningServiceContext } from "../learning.context.js";

/** Lọc lớp theo vai trò: quản trị xem tất cả, giảng viên/học viên theo quan hệ thành viên. */
export async function listClasses(
  serviceContext: LearningServiceContext,
  role: string,
  actorId = serviceContext.userIdForRole(role),
): Promise<LearningClass[]> {
  const prisma = serviceContext.database();
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
    return rows.map((row) => serviceContext.mapClass(row));
  }
  return serviceContext.classes
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
      if (isUniqueConstraintError(error))
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
  return { ...item, instructorIds: [], learnerIds: [] };
}
