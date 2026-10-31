import { NotFoundException } from "@nestjs/common";
import { Prisma } from "../../../../generated/prisma/client.js";
import type {
  ContentReport,
  ExamAttempt,
  ForumPost,
  ForumTopic,
  LearningClass,
  LearningCourse,
  LearningExam,
  LiveSession,
} from "../../core/learning.types.js";
import type { LearningServiceContext } from "../../core/learning.context.js";

/** Thu hẹp JSON thành mảng chuỗi, loại mọi phần tử không đúng kiểu. */
export function toStringArray(value: Prisma.JsonValue): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

/** Tìm khóa học trong fallback và chuẩn hóa lỗi 404. */
export function findCourse(
  serviceContext: LearningServiceContext,
  courseId: string,
): LearningCourse {
  const item = serviceContext.courses.find((course) => course.id === courseId);
  if (!item) throw new NotFoundException("Không tìm thấy khóa học.");
  return item;
}

/** Tìm lớp trong fallback và chuẩn hóa lỗi 404. */
export function findClass(
  serviceContext: LearningServiceContext,
  classId: string,
): LearningClass {
  const item = serviceContext.classes.find(
    (candidate) => candidate.id === classId,
  );
  if (!item) throw new NotFoundException("Không tìm thấy lớp học.");
  return item;
}

/** Tìm đề thi trong fallback và chuẩn hóa lỗi 404. */
export function findExam(
  serviceContext: LearningServiceContext,
  examId: string,
): LearningExam {
  const item = serviceContext.exams.find(
    (candidate) => candidate.id === examId,
  );
  if (!item) throw new NotFoundException("Không tìm thấy đề.");
  return item;
}

/** Tìm lượt thi trong fallback và chuẩn hóa lỗi 404. */
export function findAttempt(
  serviceContext: LearningServiceContext,
  attemptId: string,
): ExamAttempt {
  const item = serviceContext.attempts.find(
    (candidate) => candidate.id === attemptId,
  );
  if (!item) throw new NotFoundException("Không tìm thấy lượt làm bài.");
  return item;
}

/** Tìm chủ đề trong fallback và chuẩn hóa lỗi 404. */
export function findTopic(
  serviceContext: LearningServiceContext,
  topicId: string,
): ForumTopic {
  const item = serviceContext.topics.find(
    (candidate) => candidate.id === topicId,
  );
  if (!item) throw new NotFoundException("Không tìm thấy chủ đề.");
  return item;
}

/** Tìm bài viết trong fallback và chuẩn hóa lỗi 404. */
export function findPost(
  serviceContext: LearningServiceContext,
  postId: string,
): ForumPost {
  const item = serviceContext.posts.find(
    (candidate) => candidate.id === postId,
  );
  if (!item) throw new NotFoundException("Không tìm thấy bài viết.");
  return item;
}

/** Tìm báo cáo trong fallback và chuẩn hóa lỗi 404. */
export function findReport(
  serviceContext: LearningServiceContext,
  reportId: string,
): ContentReport {
  const item = serviceContext.reports.find(
    (candidate) => candidate.id === reportId,
  );
  if (!item) throw new NotFoundException("Không tìm thấy báo cáo.");
  return item;
}

/** Tìm buổi học trong fallback và chuẩn hóa lỗi 404. */
export function findSession(
  serviceContext: LearningServiceContext,
  sessionId: string,
): LiveSession {
  const item = serviceContext.sessions.find(
    (candidate) => candidate.id === sessionId,
  );
  if (!item) throw new NotFoundException("Không tìm thấy buổi học.");
  return item;
}
