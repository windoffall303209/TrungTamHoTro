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

/** Học liệu chung đã phát hành và không bị cách ly: mọi học viên đọc được, không cần thuộc lớp. */
export function isSharedForLearners(material: {
  scope?: string;
  visibility: string;
  quarantinedAt?: Date | string | null;
}): boolean {
  return (
    material.scope === "SHARED" &&
    material.visibility === "PUBLISHED" &&
    !material.quarantinedAt
  );
}

/** Chỉ người tải lên và người được người đó cấp quyền mới sửa được học liệu. */
export function canEditMaterial(
  material: { ownerId: string; editors?: Array<{ userId: string }>; editorIds?: string[] },
  actorId: string,
): boolean {
  return (
    material.ownerId === actorId ||
    Boolean(material.editors?.some((item) => item.userId === actorId)) ||
    Boolean(material.editorIds?.includes(actorId))
  );
}

/** Kiểm tra quyền đọc học liệu theo vai trò; nơi gọi tự kiểm tra học liệu đã phát hành với học viên. */
export function assertMaterialReadAccess(
  material: {
    ownerId: string;
    scope?: string;
    visibility: string;
    quarantinedAt?: Date | string | null;
    editors?: Array<{ userId: string }>;
    class: {
      enrollments: Array<{ learnerId: string; status: string }>;
      instructors: Array<{ instructorId: string }>;
    } | null;
  },
  role: string,
  actorId: string,
): void {
  if (role === "LEARNER") {
    if (
      isSharedForLearners(material) ||
      material.class?.enrollments.some(
        (item) => item.learnerId === actorId && item.status === "ACTIVE",
      )
    )
      return;
    throw new NotFoundException("Học viên không thuộc lớp chứa học liệu này.");
  }
  if (
    role === "INSTRUCTOR" &&
    !canEditMaterial(material, actorId) &&
    !material.class?.instructors.some((item) => item.instructorId === actorId)
  )
    throw new NotFoundException(
      "Giảng viên không được phân công vào lớp chứa học liệu này.",
    );
}

/** Bản in-memory của assertMaterialReadAccess cho chế độ dữ liệu mẫu. */
export function assertMemoryMaterialReadAccess(
  serviceContext: LearningServiceContext,
  material: LearningMaterial,
  role: string,
  actorId: string,
): void {
  const classItem = material.classId
    ? serviceContext.classes.find((item) => item.id === material.classId)
    : undefined;
  if (role === "LEARNER") {
    if (isSharedForLearners(material) || classItem?.learnerIds.includes(actorId))
      return;
    throw new NotFoundException("Học viên không thuộc lớp chứa học liệu này.");
  }
  if (
    role === "INSTRUCTOR" &&
    !canEditMaterial(material, actorId) &&
    !classItem?.instructorIds.includes(actorId)
  )
    throw new NotFoundException(
      "Giảng viên không được phân công vào lớp chứa học liệu này.",
    );
}

/** Áp dụng quyền lớp và visibility cho học liệu fallback in-memory. */
export function canAccessMemoryMaterial(
  serviceContext: LearningServiceContext,
  material: LearningMaterial,
  role: string,
  actorId: string,
): boolean {
  if (role === "LEARNER" && material.visibility !== "PUBLISHED") return false;
  try {
    assertMemoryMaterialReadAccess(serviceContext, material, role, actorId);
    return true;
  } catch {
    return false;
  }
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
