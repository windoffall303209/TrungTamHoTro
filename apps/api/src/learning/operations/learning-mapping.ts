import { BadRequestException } from "@nestjs/common";
import { PrismaService } from "../../database/prisma.service.js";
import { Prisma } from "../../generated/prisma/client.js";
import { normalizeMultipartFileName } from "../../infrastructure/file-transfer.js";
import { type ExamApprovalMode } from "../../system/system.service.js";
import { ClassWithMembers } from "../learning.shared.js";
import type {
  LearningClass,
  LearningCourse,
  LearningMaterial,
  LearningQuestion,
} from "../learning.types.js";
import type { LearningServiceContext } from "../learning.context.js";

/** Chọn Prisma khi DB được bật; nếu không các public method dùng dữ liệu nhớ demo. */
export function database(
  serviceContext: LearningServiceContext,
): PrismaService | undefined {
  return serviceContext.prisma?.isStartupConnectionEnabled()
    ? serviceContext.prisma
    : undefined;
}

/** Đọc chế độ duyệt đề từ cấu hình DB và mặc định AUTO khi chưa có cấu hình. */
export async function getExamApprovalMode(
  serviceContext: LearningServiceContext,
): Promise<ExamApprovalMode> {
  // Các unit test khởi tạo service độc lập vẫn giữ quy trình thủ công cũ;
  // trong ứng dụng thực tế SystemService luôn được inject và mặc định là AUTO.
  if (!serviceContext.system) return "MANUAL";
  return (await serviceContext.system.getSettings()).examApprovalMode;
}

/** Đọc chế độ duyệt câu hỏi dùng chung kiểu AUTO/MANUAL với đề thi. */
export async function getQuestionApprovalMode(
  serviceContext: LearningServiceContext,
): Promise<ExamApprovalMode> {
  if (!serviceContext.system) return "AUTO";
  return (await serviceContext.system.getSettings()).questionApprovalMode;
}

/** Ánh xạ Course Prisma, bao gồm JSON outcomes, sang hợp đồng API. */
export function mapCourse(
  serviceContext: LearningServiceContext,
  row: Prisma.CourseGetPayload<Record<string, never>>,
): LearningCourse {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    description: row.description,
    outcomes: serviceContext.toStringArray(row.outcomes),
    status: row.status,
    version: row.version,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Ánh xạ lớp cùng thành viên hoạt động và metadata vòng đời. */
export function mapClass(row: ClassWithMembers): LearningClass {
  return {
    id: row.id,
    courseId: row.courseId,
    courseVersion: row.courseVersion,
    code: row.code,
    name: row.name,
    term: row.term,
    startAt: row.startAt.toISOString(),
    endAt: row.endAt.toISOString(),
    capacity: row.capacity,
    timezone: row.timezone,
    allowLateEnrollment: row.allowLateEnrollment,
    status: row.status,
    instructorIds: row.instructors.map(({ instructorId }) => instructorId),
    learnerIds: row.enrollments.map(({ learnerId }) => learnerId),
    closeReason: row.closeReason ?? undefined,
    archivePolicy: row.archivePolicy ?? undefined,
    closedAt: row.closedAt?.toISOString(),
    archivedAt: row.archivedAt?.toISOString(),
  };
}

/** Ánh xạ học liệu và chỉ công bố metadata cần thiết, không lộ object key. */
export function mapMaterial(
  serviceContext: LearningServiceContext,
  row: Prisma.MaterialGetPayload<Record<string, never>>,
): LearningMaterial {
  const sizeBytes = Number(row.sizeBytes);
  if (!Number.isSafeInteger(sizeBytes))
    throw new BadRequestException(
      "Kích thước học liệu vượt giới hạn số an toàn.",
    );
  return {
    id: row.id,
    classId: row.classId,
    courseId: row.courseId,
    ownerId: row.ownerId,
    name: normalizeMultipartFileName(row.name),
    mimeType: row.mimeType,
    sizeBytes,
    folder: row.folder,
    tags: serviceContext.toStringArray(row.tags),
    version: row.version,
    visibility: row.visibility,
    scope: row.scope,
    quarantinedAt: row.quarantinedAt?.toISOString(),
    quarantineReason: row.quarantineReason ?? undefined,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Thu hẹp JSON options/answers/tags và ánh xạ version family của câu hỏi. */
export function mapQuestion(
  serviceContext: LearningServiceContext,
  row: Prisma.QuestionGetPayload<Record<string, never>>,
): LearningQuestion {
  const imageSizeBytes =
    row.imageSizeBytes === null ? undefined : Number(row.imageSizeBytes);
  if (imageSizeBytes !== undefined && !Number.isSafeInteger(imageSizeBytes))
    throw new BadRequestException(
      "Kích thước ảnh câu hỏi vượt giới hạn số an toàn.",
    );
  return {
    id: row.id,
    courseId: row.courseId,
    type: row.type,
    content: row.content,
    options: serviceContext.toStringArray(row.options),
    correctAnswers: serviceContext.toStringArray(row.correctAnswers),
    difficulty: Math.min(3, Math.max(1, row.difficulty)) as 1 | 2 | 3,
    tags: serviceContext.toStringArray(row.tags),
    status:
      row.status === "PUBLISHED"
        ? "PUBLISHED"
        : row.status === "PENDING_REVIEW"
          ? "PENDING_REVIEW"
          : "DRAFT",
    version: row.version,
    familyId: row.familyId,
    supersedesId: row.supersedesId ?? undefined,
    imageUrl: row.imageObjectKey
      ? `/question-bank/questions/${row.id}/image?v=${encodeURIComponent(row.imageChecksum ?? row.updatedAt.getTime().toString())}`
      : undefined,
    imageName: row.imageName ?? undefined,
    imageMimeType: row.imageMimeType ?? undefined,
    imageSizeBytes,
  };
}
