import { NotFoundException } from "@nestjs/common";

import { ClassWithMembers } from "../../core/learning.shared.js";
import type { LearningServiceContext } from "../../core/learning.context.js";

/** Xác minh vai trò quản trị hoặc thành viên lớp trước thao tác diễn đàn Prisma. */
export function assertForumClassAccess(
  classItem: ClassWithMembers,
  role: string,
  actorId: string,
): void {
  if (
    role === "LEARNER" &&
    !classItem.enrollments.some(
      (item) => item.learnerId === actorId && item.status === "ACTIVE",
    )
  )
    throw new NotFoundException("Không tìm thấy chủ đề trong lớp đã ghi danh.");
  if (
    role === "INSTRUCTOR" &&
    !classItem.instructors.some((item) => item.instructorId === actorId)
  )
    throw new NotFoundException(
      "Không tìm thấy chủ đề trong lớp được phân công.",
    );
}

/** Xác minh quyền diễn đàn tương đương trên dữ liệu lớp in-memory. */
export function assertMemoryForumClassAccess(
  serviceContext: LearningServiceContext,
  classId: string,
  role: string,
  actorId: string,
): void {
  const classItem = serviceContext.findClass(classId);
  if (role === "LEARNER" && !classItem.learnerIds.includes(actorId))
    throw new NotFoundException("Không tìm thấy chủ đề trong lớp đã ghi danh.");
  if (role === "INSTRUCTOR" && !classItem.instructorIds.includes(actorId))
    throw new NotFoundException(
      "Không tìm thấy chủ đề trong lớp được phân công.",
    );
}
