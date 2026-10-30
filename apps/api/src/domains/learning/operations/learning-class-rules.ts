import { BadRequestException, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../../../database/prisma.service.js";
import { Prisma } from "../../../generated/prisma/client.js";
import type {
  ClassClosureReadiness,
  ExamAttempt,
  FileReviewRecord,
  LearningClass,
  LearningExam,
} from "../learning.types.js";
import type { LearningServiceContext } from "../learning.context.js";

/** Chuyển các bộ đếm nghiệp vụ còn mở thành danh sách blocker đóng lớp. */
export function buildClassClosureReadiness(
  status: LearningClass["status"],
  endAt: Date,
  counts: Omit<ClassClosureReadiness, "eligible" | "blockers">,
): ClassClosureReadiness {
  const blockers: string[] = [];
  if (status !== "ACTIVE") blockers.push("lớp không ở trạng thái hoạt động");
  if (endAt > new Date()) blockers.push("chưa đến ngày kết thúc lớp");
  if (counts.openExams)
    blockers.push(`${counts.openExams} kỳ thi đang mở hoặc chờ duyệt`);
  if (counts.inProgressAttempts)
    blockers.push(`${counts.inProgressAttempts} lượt thi đang làm`);
  if (counts.pendingGrades)
    blockers.push(`${counts.pendingGrades} bài nộp chưa chấm`);
  if (counts.openAssignments)
    blockers.push(`${counts.openAssignments} bài tập đang mở`);
  if (counts.pendingAssignmentGrades)
    blockers.push(`${counts.pendingAssignmentGrades} bài tập đã nộp chưa chấm`);
  if (counts.openRegrades)
    blockers.push(`${counts.openRegrades} yêu cầu phúc khảo chưa kết thúc`);
  if (counts.activeSessions)
    blockers.push(`${counts.activeSessions} buổi học chưa kết thúc`);
  if (counts.unlockedAttendanceSessions)
    blockers.push(
      `${counts.unlockedAttendanceSessions} kỳ điểm danh chưa khóa`,
    );
  if (counts.openAppeals)
    blockers.push(`${counts.openAppeals} yêu cầu điểm danh chưa xử lý`);
  return { eligible: blockers.length === 0, blockers, ...counts };
}

/** Thu hẹp action lưu trong DB về tập hành động kiểm duyệt tệp hỗ trợ. */
export function fileReviewAction(value: string): FileReviewRecord["action"] {
  if (value === "APPROVE" || value === "REVOKE" || value === "HIDE" || value === "REQUEST_CHANGES")
    return value;
  throw new BadRequestException("Hành động kiểm duyệt học liệu không hợp lệ.");
}

/** Tải lớp cùng thành viên và ném 404 nhất quán nếu không tồn tại. */
export async function getDatabaseClass(
  serviceContext: LearningServiceContext,
  database: PrismaService | Prisma.TransactionClient,
  classId: string,
): Promise<LearningClass> {
  const row = await database.learningClass.findUnique({
    where: { id: classId },
    include: {
      instructors: true,
      enrollments: { where: { status: "ACTIVE" } },
    },
  });
  if (!row) throw new NotFoundException("Không tìm thấy lớp học.");
  return serviceContext.mapClass(row);
}

/** Tải đề cùng câu hỏi theo thứ tự để dùng chung giữa các luồng thi. */
export async function getDatabaseExam(
  serviceContext: LearningServiceContext,
  database: PrismaService | Prisma.TransactionClient,
  examId: string,
): Promise<LearningExam> {
  const row = await database.exam.findUnique({
    where: { id: examId },
    include: { questions: { orderBy: { position: "asc" } } },
  });
  if (!row) throw new NotFoundException("Không tìm thấy đề.");
  return serviceContext.mapExam(row);
}

/** Tải lượt thi cùng đáp án và ném 404 nhất quán. */
export async function getDatabaseAttempt(
  serviceContext: LearningServiceContext,
  database: PrismaService | Prisma.TransactionClient,
  attemptId: string,
): Promise<ExamAttempt> {
  const row = await database.examAttempt.findUnique({
    where: { id: attemptId },
    include: { answers: true },
  });
  if (!row) throw new NotFoundException("Không tìm thấy lượt làm bài.");
  return serviceContext.mapAttempt(row);
}

/** Bắt buộc user tồn tại, đang hoạt động hoặc vừa được cấp, và có vai trò yêu cầu trước mutation thành viên. */
export async function requireUserRole(
  database: PrismaService,
  userId: string,
  roleCode: "INSTRUCTOR" | "LEARNER",
  message: string,
): Promise<void> {
  const user = await database.user.findFirst({
    where: {
      id: userId,
      // Tài khoản vừa cấp (chưa xác thực) vẫn được xếp lớp và phân công ngay.
      status: { in: ["ACTIVE", "PENDING"] },
      roles: { some: { role: { code: roleCode } } },
    },
    select: { id: true },
  });
  if (!user) throw new BadRequestException(message);
}
