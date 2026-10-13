import { NotFoundException } from "@nestjs/common";
import { readFile } from "node:fs/promises";
import type {
  LearnerExamSummary,
  LearningExam,
  LearningMaterial,
} from "../learning.types.js";
import type { LearningServiceContext } from "../learning.context.js";

/** Ánh xạ vai trò sang tài khoản seed tương ứng chỉ cho fallback/demo. */
export function userIdForRole(role: string): string {
  if (role === "SYSTEM_ADMIN") return "usr-admin";
  if (role === "CENTER_MANAGER") return "usr-manager";
  if (role === "INSTRUCTOR") return "usr-instructor";
  return "usr-learner";
}

/** Đọc object qua storage service hoặc filesystem fallback. */
export function readStoredFile(
  serviceContext: LearningServiceContext,
  objectKey: string,
): Promise<Buffer> {
  if (serviceContext.objectStorage)
    return serviceContext.objectStorage.get(objectKey);
  return readFile(serviceContext.resolveObjectPath(objectKey)).catch(() => {
    throw new NotFoundException("Tệp không còn tồn tại trong kho lưu trữ.");
  });
}

/** Xác định object key thuộc namespace học liệu mà service cho phép phục vụ. */
export function isMaterialObjectKey(objectKey: string): boolean {
  return objectKey.startsWith("files/") || objectKey.startsWith("cloudinary:");
}

/** Cho phép vai trò quản trị/điều hành truy cập hàng đợi hỗ trợ. */
export function canManageSupport(role: string): boolean {
  return role === "SYSTEM_ADMIN" || role === "CENTER_MANAGER";
}

/** Áp dụng quyền lớp và visibility cho học liệu fallback in-memory. */
export function canAccessMemoryMaterial(
  serviceContext: LearningServiceContext,
  material: LearningMaterial,
  role: string,
  actorId: string,
): boolean {
  const classItem = serviceContext.classes.find(
    (item) => item.id === material.classId,
  );
  if (!classItem) return false;
  if (role === "LEARNER")
    return (
      material.visibility === "PUBLISHED" &&
      classItem.learnerIds.includes(actorId)
    );
  if (role === "INSTRUCTOR") return classItem.instructorIds.includes(actorId);
  return true;
}

/** Kiểm tra thành viên lớp ở bản ghi Prisma trước khi truy cập học liệu. */
export function assertMaterialClassAccess(
  classItem: {
    enrollments: Array<{ learnerId: string; status: string }>;
    instructors: Array<{ instructorId: string }>;
  },
  role: string,
  actorId: string,
): void {
  if (
    role === "LEARNER" &&
    !classItem.enrollments.some(
      (item) => item.learnerId === actorId && item.status === "ACTIVE",
    )
  )
    throw new NotFoundException("Học viên không thuộc lớp chứa học liệu này.");
  if (
    role === "INSTRUCTOR" &&
    !classItem.instructors.some((item) => item.instructorId === actorId)
  )
    throw new NotFoundException(
      "Giảng viên không được phân công vào lớp chứa học liệu này.",
    );
}

/** Kiểm tra quyền lớp tương đương trên dữ liệu in-memory. */
export function assertMemoryMaterialClassAccess(
  serviceContext: LearningServiceContext,
  classId: string,
  role: string,
  actorId: string,
): void {
  const classItem = serviceContext.findClass(classId);
  if (role === "LEARNER" && !classItem.learnerIds.includes(actorId))
    throw new NotFoundException("Học viên không thuộc lớp chứa học liệu này.");
  if (role === "INSTRUCTOR" && !classItem.instructorIds.includes(actorId))
    throw new NotFoundException(
      "Giảng viên không được phân công vào lớp chứa học liệu này.",
    );
}

/** Tính trạng thái đề từ công bố, cửa sổ thời gian, lượt đang làm và giới hạn số lượt. */
export function examAvailability(
  exam: LearningExam,
  attemptCount: number,
  active: boolean,
  timestamp: Date,
): LearnerExamSummary["availabilityStatus"] {
  if (active) return "IN_PROGRESS";
  if (timestamp < new Date(exam.openAt)) return "UPCOMING";
  if (timestamp > new Date(exam.closeAt) || exam.status === "CLOSED")
    return "CLOSED";
  if (attemptCount >= exam.attemptLimit) return "ATTEMPT_LIMIT_REACHED";
  return "AVAILABLE";
}

/** Chọn hạn sớm hơn giữa thời lượng lượt thi và giờ đóng đề. */
export function attemptDeadline(
  startedAt: Date,
  durationMinutes: number,
  examCloseAt: Date,
): Date {
  return new Date(
    Math.min(
      startedAt.getTime() + durationMinutes * 60_000,
      examCloseAt.getTime(),
    ),
  );
}

/** Tìm câu hỏi fallback và dùng chung logic so sánh đáp án khách quan. */
export function isMemoryAnswerCorrect(
  serviceContext: LearningServiceContext,
  questionId: string,
  submitted: string[],
): boolean {
  const question = serviceContext.questions.find(
    (item) => item.id === questionId,
  );
  return (
    Boolean(question) &&
    JSON.stringify([...submitted].sort()) ===
      JSON.stringify([...(question?.correctAnswers ?? [])].sort())
  );
}
