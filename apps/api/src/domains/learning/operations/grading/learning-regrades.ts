import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from "@nestjs/common";
import { id, now } from "../../core/learning.shared.js";
import type { ExamAttempt, RegradeRequest } from "../../core/learning.types.js";
import type { LearningServiceContext } from "../../core/learning.context.js";

/** Mở yêu cầu phúc khảo duy nhất cho lượt đã chấm và thông báo giảng viên. */
export async function requestRegrade(
  serviceContext: LearningServiceContext,
  attemptId: string,
  reason: string,
  learnerId = "usr-learner",
): Promise<RegradeRequest> {
  const normalizedReason = reason.trim();
  if (normalizedReason.length < 10)
    throw new BadRequestException("Lý do phúc khảo cần ít nhất 10 ký tự.");
  const prisma = serviceContext.database();
  if (prisma) {
    const attempt = await prisma.examAttempt.findFirst({
      where: {
        id: attemptId,
        learnerId,
        status: "GRADED",
        gradePublishedAt: { not: null },
      },
      include: {
        regradeRequests: {
          where: { learnerId, status: { in: ["OPEN", "IN_REVIEW"] } },
        },
      },
    });
    if (!attempt?.gradePublishedAt)
      throw new NotFoundException(
        "Không tìm thấy kết quả được phép phúc khảo.",
      );
    if (Date.now() > attempt.gradePublishedAt.getTime() + 7 * 86_400_000)
      throw new BadRequestException("Đã hết hạn phúc khảo 7 ngày.");
    if (attempt.regradeRequests.length)
      throw new ConflictException("Đã có yêu cầu phúc khảo đang được xử lý.");
    return serviceContext.mapRegradeRequest(
      await prisma.regradeRequest.create({
        data: {
          id: id("regrade"),
          attemptId,
          learnerId,
          reason: normalizedReason,
        },
      }),
    );
  }
  const attempt = serviceContext.attempts.find(
    (item) =>
      item.id === attemptId &&
      item.learnerId === learnerId &&
      item.status === "GRADED" &&
      item.gradePublishedAt,
  );
  if (!attempt?.gradePublishedAt)
    throw new NotFoundException("Không tìm thấy kết quả được phép phúc khảo.");
  if (
    Date.now() >
    new Date(attempt.gradePublishedAt).getTime() + 7 * 86_400_000
  )
    throw new BadRequestException("Đã hết hạn phúc khảo 7 ngày.");
  if (
    serviceContext.regradeRequests.some(
      (item) =>
        item.attemptId === attemptId &&
        ["OPEN", "IN_REVIEW"].includes(item.status),
    )
  )
    throw new ConflictException("Đã có yêu cầu phúc khảo đang được xử lý.");
  const request: RegradeRequest = {
    id: id("regrade"),
    attemptId,
    learnerId,
    reason: normalizedReason,
    status: "OPEN",
    createdAt: now(),
  };
  serviceContext.regradeRequests.unshift(request);
  return { ...request };
}

/** Liệt kê hàng đợi phúc khảo trong đúng phạm vi lớp của giảng viên. */
export async function listRegradeRequests(
  serviceContext: LearningServiceContext,
  actorId = "usr-instructor",
  status?: RegradeRequest["status"],
): Promise<RegradeRequest[]> {
  const allowed = ["OPEN", "IN_REVIEW", "RESOLVED", "REJECTED"] as const;
  if (status && !allowed.includes(status))
    throw new BadRequestException("Trạng thái phúc khảo không hợp lệ.");
  const prisma = serviceContext.database();
  if (prisma) {
    const rows = await prisma.regradeRequest.findMany({
      where: {
        status,
        attempt: {
          exam: {
            class: { instructors: { some: { instructorId: actorId } } },
          },
        },
      },
      orderBy: { createdAt: "asc" },
    });
    return rows.map((row) => serviceContext.mapRegradeRequest(row));
  }
  const allowedAttemptIds = new Set(
    serviceContext.attempts
      .filter((attempt) =>
        serviceContext
          .findClass(serviceContext.findExam(attempt.examId).classId)
          .instructorIds.includes(actorId),
      )
      .map((attempt) => attempt.id),
  );
  return serviceContext.regradeRequests
    .filter(
      (request) =>
        allowedAttemptIds.has(request.attemptId) &&
        (!status || request.status === status),
    )
    .map((request) => ({ ...request }));
}

/** Nhận xử lý một yêu cầu OPEN bằng cập nhật có điều kiện để chống hai người cùng nhận. */
export async function claimRegrade(
  serviceContext: LearningServiceContext,
  requestId: string,
  actorId = "usr-instructor",
): Promise<RegradeRequest> {
  const prisma = serviceContext.database();
  if (prisma) {
    const request = await prisma.regradeRequest.findFirst({
      where: {
        id: requestId,
        attempt: {
          exam: {
            class: { instructors: { some: { instructorId: actorId } } },
          },
        },
      },
    });
    if (!request)
      throw new NotFoundException(
        "Không tìm thấy yêu cầu phúc khảo được phép xử lý.",
      );
    const claimed = await prisma.regradeRequest.updateMany({
      where: { id: requestId, status: "OPEN" },
      data: { status: "IN_REVIEW", assignedToId: actorId },
    });
    if (claimed.count !== 1)
      throw new ConflictException(
        "Yêu cầu phúc khảo đã được người khác nhận hoặc đã kết thúc.",
      );
    const updated = await prisma.regradeRequest.findUniqueOrThrow({
      where: { id: requestId },
    });
    return serviceContext.mapRegradeRequest(updated);
  }
  const request = serviceContext.regradeRequests.find(
    (item) => item.id === requestId,
  );
  if (
    !request ||
    !serviceContext
      .findClass(
        serviceContext.findExam(
          serviceContext.findAttempt(request.attemptId).examId,
        ).classId,
      )
      .instructorIds.includes(actorId)
  )
    throw new NotFoundException(
      "Không tìm thấy yêu cầu phúc khảo được phép xử lý.",
    );
  if (request.status !== "OPEN")
    throw new ConflictException(
      "Yêu cầu phúc khảo đã được người khác nhận hoặc đã kết thúc.",
    );
  request.status = "IN_REVIEW";
  request.assignedToId = actorId;
  return { ...request };
}

/** Kết thúc yêu cầu đã nhận; nếu chấp thuận thì sửa điểm qua cùng cơ chế lịch sử chấm. */
export async function resolveRegrade(
  serviceContext: LearningServiceContext,
  requestId: string,
  input: {
    decision: "APPROVE" | "REJECT";
    resolution: string;
    score?: number;
    feedback?: string;
    questionScores?: Array<{ questionId: string; score: number }>;
  },
  actorId = "usr-instructor",
): Promise<RegradeRequest> {
  const resolution = input.resolution.trim();
  if (resolution.length < 5)
    throw new BadRequestException("Kết luận phúc khảo cần ít nhất 5 ký tự.");
  const prisma = serviceContext.database();
  if (prisma) {
    const request = await prisma.regradeRequest.findFirst({
      where: {
        id: requestId,
        assignedToId: actorId,
        status: "IN_REVIEW",
        attempt: {
          exam: {
            class: { instructors: { some: { instructorId: actorId } } },
          },
        },
      },
    });
    if (!request)
      throw new NotFoundException(
        "Không tìm thấy yêu cầu phúc khảo đang được bạn xử lý.",
      );
    if (input.decision === "APPROVE") {
      if (input.score === undefined)
        throw new BadRequestException("Cần nhập điểm sau phúc khảo.");
      await serviceContext.gradeAttempt(
        request.attemptId,
        input.score,
        input.feedback ?? resolution,
        `Phúc khảo: ${resolution}`,
        actorId,
        input.questionScores,
      );
    }
    const nextStatus = input.decision === "APPROVE" ? "RESOLVED" : "REJECTED";
    const updated = await prisma.$transaction(async (transaction) => {
      const changed = await transaction.regradeRequest.updateMany({
        where: { id: requestId, status: "IN_REVIEW", assignedToId: actorId },
        data: {
          status: nextStatus,
          resolution,
          resolvedById: actorId,
          resolvedAt: new Date(),
        },
      });
      if (changed.count !== 1)
        throw new ConflictException(
          "Trạng thái phúc khảo đã thay đổi; hãy tải lại hàng đợi.",
        );
      await transaction.notification.upsert({
        where: { dedupKey: `regrade-resolved:${requestId}` },
        update: {
          title:
            input.decision === "APPROVE"
              ? "Phúc khảo đã hoàn tất và điểm đã được cập nhật"
              : "Yêu cầu phúc khảo không được chấp thuận",
          readAt: null,
          createdAt: new Date(),
        },
        create: {
          id: id("notification"),
          recipientId: request.learnerId,
          type: "REGRADE_RESOLVED",
          title:
            input.decision === "APPROVE"
              ? "Phúc khảo đã hoàn tất và điểm đã được cập nhật"
              : "Yêu cầu phúc khảo không được chấp thuận",
          entityType: "EXAM_ATTEMPT",
          entityId: request.attemptId,
          dedupKey: `regrade-resolved:${requestId}`,
        },
      });
      return transaction.regradeRequest.findUniqueOrThrow({
        where: { id: requestId },
      });
    });
    return serviceContext.mapRegradeRequest(updated);
  }
  const request = serviceContext.regradeRequests.find(
    (item) =>
      item.id === requestId &&
      item.assignedToId === actorId &&
      item.status === "IN_REVIEW",
  );
  if (!request)
    throw new NotFoundException(
      "Không tìm thấy yêu cầu phúc khảo đang được bạn xử lý.",
    );
  if (input.decision === "APPROVE") {
    if (input.score === undefined)
      throw new BadRequestException("Cần nhập điểm sau phúc khảo.");
    await serviceContext.gradeAttempt(
      request.attemptId,
      input.score,
      input.feedback ?? resolution,
      `Phúc khảo: ${resolution}`,
      actorId,
      input.questionScores,
    );
  }
  request.status = input.decision === "APPROVE" ? "RESOLVED" : "REJECTED";
  request.resolution = resolution;
  request.resolvedById = actorId;
  request.resolvedAt = now();
  serviceContext.notifications.unshift({
    id: id("notification"),
    recipientId: request.learnerId,
    type: "REGRADE_RESOLVED",
    title:
      input.decision === "APPROVE"
        ? "Phúc khảo đã hoàn tất và điểm đã được cập nhật"
        : "Yêu cầu phúc khảo không được chấp thuận",
    entityType: "EXAM_ATTEMPT",
    entityId: request.attemptId,
    createdAt: now(),
  });
  return { ...request };
}

/** Liệt kê lượt thi trong phạm vi lớp giảng viên phụ trách. */
export async function listAttempts(
  serviceContext: LearningServiceContext,
  examId?: string,
  actorId = "usr-instructor",
): Promise<ExamAttempt[]> {
  const prisma = serviceContext.database();
  if (prisma) {
    const rows = await prisma.examAttempt.findMany({
      where: {
        examId: examId || undefined,
        exam: { class: { instructors: { some: { instructorId: actorId } } } },
      },
      include: { answers: true },
      orderBy: { startedAt: "desc" },
    });
    return rows.map((row) => serviceContext.mapAttempt(row));
  }
  return serviceContext.attempts
    .filter(
      (item) =>
        (!examId || item.examId === examId) &&
        serviceContext
          .findClass(serviceContext.findExam(item.examId).classId)
          .instructorIds.includes(actorId),
    )
    .map((item) => ({ ...item, answers: { ...item.answers } }));
}
