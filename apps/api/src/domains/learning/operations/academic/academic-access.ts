import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";
import type { AuthenticatedSession } from "../../../../auth/auth.service.js";
import type { AcademicServiceContext } from "../../academic/academic.context.js";

/** Tính lớp truy cập được theo vai trò quản trị, phân công giảng viên hoặc ghi danh học viên. */
export async function accessibleClassIds(
  serviceContext: AcademicServiceContext,
  session: AuthenticatedSession,
): Promise<string[]> {
  if (
    session.roleCode === "CENTER_MANAGER" ||
    session.roleCode === "SYSTEM_ADMIN"
  )
    return (
      await serviceContext.prisma.learningClass.findMany({
        select: { id: true },
      })
    ).map((item) => item.id);
  if (session.roleCode === "INSTRUCTOR")
    return (
      await serviceContext.prisma.classInstructor.findMany({
        where: { instructorId: session.user.id },
        select: { classId: true },
      })
    ).map((item) => item.classId);
  return (
    await serviceContext.prisma.classEnrollment.findMany({
      where: { learnerId: session.user.id, status: "ACTIVE" },
      select: { classId: true },
    })
  ).map((item) => item.classId);
}

/** Cho quản trị hoặc giảng viên được phân công tiếp tục và từ chối các phiên còn lại. */
export async function requireTeachingAccess(
  serviceContext: AcademicServiceContext,
  classId: string,
  session: AuthenticatedSession,
  requireWritable = false,
): Promise<void> {
  if (session.roleCode !== "INSTRUCTOR")
    throw new ForbiddenException(
      "Nghiệp vụ học thuật chỉ dành cho giảng viên được phân công.",
    );
  if (!session.permissions.includes("exam:manage"))
    throw new NotFoundException(
      "Không tìm thấy lớp học trong phạm vi quản lý.",
    );
  // Kiểm tra phân công và trạng thái trong cùng truy vấn, không tải mọi lớp của giảng viên.
  const classItem = await serviceContext.prisma.learningClass.findFirst({
    where: { id: classId, instructors: { some: { instructorId: session.user.id } } },
    select: { status: true },
  });
  if (!classItem)
    throw new NotFoundException("Không tìm thấy lớp học trong phạm vi quản lý.");
  if (requireWritable && classItem.status === "CLOSED")
      throw new ConflictException("Lớp đã lưu trữ và chỉ cho phép đọc.");
}

/** Cấp quản lý (quản lý trung tâm/quản trị) được đọc dữ liệu học thuật của mọi lớp ở chế độ chỉ đọc. */
export function isAcademicSupervisor(session: AuthenticatedSession): boolean {
  return (session.roleCode === "CENTER_MANAGER" || session.roleCode === "SYSTEM_ADMIN") && session.permissions.includes("class:view");
}
