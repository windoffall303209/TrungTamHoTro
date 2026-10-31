import { randomUUID } from "node:crypto";
import { Prisma } from "../../../generated/prisma/client.js";
import type { ExamSourceFile } from "../../system/ai/ai-provider.service.js";
import type {
  LearningClass,
  LearningMaterial,
  MaterialVersionSnapshot,
} from "./learning.types.js";

/** Lấy thời điểm hiện tại theo định dạng ISO để lưu và trả về nhất quán. */
export const now = (): string => new Date().toISOString();

/** Tạo mã định danh có tiền tố nghiệp vụ và UUID để tránh trùng lặp. */
export const id = (prefix: string): string => `${prefix}-${randomUUID()}`;

/** Sao chép dữ liệu lớp và tách hai danh sách thành viên khỏi trạng thái trong bộ nhớ. */
export const copyLearningClass = (item: LearningClass): LearningClass => ({
  ...item,
  instructorIds: [...item.instructorIds],
  learnerIds: [...item.learnerIds],
});

export type ClassWithMembers = Prisma.LearningClassGetPayload<{
  include: { instructors: true; enrollments: true };
}>;

export type ExamWithQuestions = Prisma.ExamGetPayload<{
  include: { questions: true };
}>;

export type AttemptWithAnswers = Prisma.ExamAttemptGetPayload<{
  include: { answers: true };
}>;

export type ForumPostWithRelations = Prisma.ForumPostGetPayload<{
  include: { attachments: true; mentions: true };
}>;

export type ContentReportWithActions = Prisma.ContentReportGetPayload<{
  include: { actions: true };
}>;

export type SupportTicketWithAttachments = Prisma.SupportTicketGetPayload<{
  include: { attachments: true };
}>;

export interface UploadedMaterialFile {
  originalName: string;
  mimeType: string;
  size: number;
  buffer: Buffer;
  /** Đường dẫn tạm nội bộ cho học liệu lớn; khi đó buffer chỉ chứa phần đầu để nhận diện định dạng. */
  path?: string;
}

export interface MaterialDownload {
  fileName: string;
  mimeType: string;
  buffer: Buffer;
}

export type MaterialAccessAction = "PREVIEW" | "DOWNLOAD";

export interface MaterialSearchResult {
  items: LearningMaterial[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface ExamGenerationContext {
  courseId: string;
  courseName: string;
  courseDescription: string;
  sourceFiles: ExamSourceFile[];
}

export type MemoryMaterialVersion = MaterialVersionSnapshot & {
  objectKey?: string;
  checksum?: string;
};

export type MemoryQuestionImage = {
  objectKey: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  checksum: string;
  buffer: Buffer;
};

export type MemoryAttendanceInterval = {
  sessionId: string;
  learnerId: string;
  joinedAt: string;
  leftAt?: string;
  source: "APP" | "PROVIDER";
};
