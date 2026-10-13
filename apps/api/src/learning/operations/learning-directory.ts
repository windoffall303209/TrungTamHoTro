import { NotFoundException } from "@nestjs/common";
import type { DirectoryUser } from "../learning.types.js";
import type { LearningServiceContext } from "../learning.context.js";

/** Xác minh giảng viên phụ trách rồi trả học viên đang ghi danh trong lớp. */
export async function listInstructorClassLearners(
  serviceContext: LearningServiceContext,
  classId: string,
  instructorId: string,
): Promise<DirectoryUser[]> {
  const prisma = serviceContext.database();
  if (prisma) {
    const classItem = await prisma.learningClass.findFirst({
      where: { id: classId, instructors: { some: { instructorId } } },
      include: {
        enrollments: {
          where: { status: "ACTIVE" },
          include: {
            learner: { select: { id: true, displayName: true, email: true } },
          },
          orderBy: { learner: { displayName: "asc" } },
        },
      },
    });
    if (!classItem)
      throw new NotFoundException("Không tìm thấy lớp được phân công.");
    return classItem.enrollments.map(({ learner }) => ({
      id: learner.id,
      displayName: learner.displayName,
      email: learner.email,
      roleCode: "LEARNER",
    }));
  }
  const classItem = serviceContext.findClass(classId);
  if (!classItem.instructorIds.includes(instructorId))
    throw new NotFoundException("Không tìm thấy lớp được phân công.");
  return classItem.learnerIds.map((learnerId) => ({
    id: learnerId,
    displayName: learnerId,
    email: "",
    roleCode: "LEARNER",
  }));
}

/** Tìm người dùng theo vai trò và tùy chọn loại các thành viên đã thuộc lớp. */
export async function searchDirectory(
  serviceContext: LearningServiceContext,
  roleCode: "INSTRUCTOR" | "LEARNER",
  query = "",
  classId?: string,
): Promise<DirectoryUser[]> {
  const prisma = serviceContext.database();
  if (!prisma) return [];
  const text = query.trim();
  const assignedIds = classId
    ? roleCode === "INSTRUCTOR"
      ? (
          await prisma.classInstructor.findMany({
            where: { classId },
            select: { instructorId: true },
          })
        ).map((row) => row.instructorId)
      : (
          await prisma.classEnrollment.findMany({
            where: { classId, status: "ACTIVE" },
            select: { learnerId: true },
          })
        ).map((row) => row.learnerId)
    : [];
  const users = await prisma.user.findMany({
    where: {
      status: "ACTIVE",
      id: assignedIds.length ? { notIn: assignedIds } : undefined,
      roles: { some: { role: { code: roleCode } } },
      ...(text
        ? {
            OR: [
              { displayName: { contains: text, mode: "insensitive" } },
              { email: { contains: text, mode: "insensitive" } },
            ],
          }
        : {}),
    },
    select: { id: true, displayName: true, email: true },
    orderBy: { displayName: "asc" },
    take: 20,
  });
  return users.map((user) => ({ ...user, roleCode }));
}
