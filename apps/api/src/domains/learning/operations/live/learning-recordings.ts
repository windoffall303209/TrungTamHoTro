import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from "@nestjs/common";
import { assertPublicHttpsUrl } from "../../../../infrastructure/safe-provider-fetch.js";
import type { LiveSession } from "../../core/learning.types.js";
import type { LearningServiceContext } from "../../core/learning.context.js";

/** Gắn nguồn bản ghi cho buổi đã hoàn tất và chuyển sang trạng thái xử lý. */
export async function attachRecording(
  serviceContext: LearningServiceContext,
  sessionId: string,
  rawRecordingUrl: string,
  actorId: string,
): Promise<LiveSession> {
  // URL bản ghi sẽ được mở cho học viên: chỉ nhận HTTPS tới host công khai (chặn javascript:, IP nội bộ, metadata cloud).
  const recordingUrl = assertPublicHttpsUrl(rawRecordingUrl, "Liên kết bản ghi phải dùng HTTPS và trỏ tới máy chủ công khai.");
  const prisma = serviceContext.database();
  if (prisma) {
    const item = await prisma.liveSession.findUnique({
      where: { id: sessionId },
    });
    if (!item || item.hostId !== actorId)
      throw new NotFoundException(
        "Không tìm thấy buổi học được phép cập nhật bản ghi.",
      );
    if (item.status !== "COMPLETED")
      throw new BadRequestException(
        "Chỉ gắn bản ghi sau khi buổi học kết thúc.",
      );
    return serviceContext.mapSession(
      await prisma.liveSession.update({
        where: { id: sessionId },
        data: {
          recordingUrl,
          recordingStatus: "PROCESSING",
          recordingReadyAt: null,
          recordingExpiresAt: null,
          recordingError: null,
        },
      }),
    );
  }
  const item = serviceContext.findSession(sessionId);
  if (item.hostId !== actorId)
    throw new NotFoundException(
      "Không tìm thấy buổi học được phép cập nhật bản ghi.",
    );
  if (item.status !== "COMPLETED")
    throw new BadRequestException("Chỉ gắn bản ghi sau khi buổi học kết thúc.");
  item.recordingUrl = recordingUrl;
  item.recordingStatus = "PROCESSING";
  item.recordingReadyAt = undefined;
  item.recordingExpiresAt = undefined;
  item.recordingError = undefined;
  return { ...item };
}

/** Chốt xử lý bản ghi, tính ngày hết hạn hoặc lưu lỗi và thông báo học viên khi sẵn sàng. */
export async function completeRecording(
  serviceContext: LearningServiceContext,
  sessionId: string,
  status: "READY" | "FAILED",
  retentionDays = 90,
  errorMessage: string | undefined,
  actorId: string,
): Promise<LiveSession> {
  const normalizedError = errorMessage?.trim();
  if (status === "FAILED" && (!normalizedError || normalizedError.length < 5))
    throw new BadRequestException(
      "Cần mô tả lỗi xử lý bản ghi ít nhất 5 ký tự.",
    );
  const readyAt = status === "READY" ? new Date() : null;
  const expiresAt = readyAt
    ? new Date(readyAt.getTime() + retentionDays * 86_400_000)
    : null;
  const prisma = serviceContext.database();
  if (prisma) {
    return prisma.$transaction(async (transaction) => {
      const current = await transaction.liveSession.findUnique({
        where: { id: sessionId },
      });
      if (!current || current.hostId !== actorId)
        throw new NotFoundException(
          "Không tìm thấy buổi học được phép cập nhật bản ghi.",
        );
      if (current.status !== "COMPLETED" || !current.recordingUrl)
        throw new ConflictException("Buổi học chưa có bản ghi để cập nhật.");
      if (current.recordingStatus !== "PROCESSING")
        throw new ConflictException("Bản ghi không ở trạng thái đang xử lý.");
      const updated = await transaction.liveSession.update({
        where: { id: sessionId },
        data: {
          recordingStatus: status,
          recordingReadyAt: readyAt,
          recordingExpiresAt: expiresAt,
          recordingError: status === "FAILED" ? normalizedError : null,
        },
      });
      await transaction.auditLog.create({
        data: {
          actorId,
          action: `RECORDING_${status}`,
          entityType: "live_session",
          entityId: sessionId,
          context: {
            retentionDays,
            expiresAt,
            errorMessage: normalizedError,
          },
        },
      });
      if (status === "READY")
        await serviceContext.notifyClassMembers(
          transaction,
          current.classId,
          "RECORDING_READY",
          `Bản ghi đã sẵn sàng: ${current.title}`,
          sessionId,
        );
      return serviceContext.mapSession(updated);
    });
  }
  const item = serviceContext.findSession(sessionId);
  if (item.hostId !== actorId)
    throw new NotFoundException(
      "Không tìm thấy buổi học được phép cập nhật bản ghi.",
    );
  if (item.status !== "COMPLETED" || !item.recordingUrl)
    throw new ConflictException("Buổi học chưa có bản ghi để cập nhật.");
  if (item.recordingStatus !== "PROCESSING")
    throw new ConflictException("Bản ghi không ở trạng thái đang xử lý.");
  item.recordingStatus = status;
  item.recordingReadyAt = readyAt?.toISOString();
  item.recordingExpiresAt = expiresAt?.toISOString();
  item.recordingError = status === "FAILED" ? normalizedError : undefined;
  return { ...item };
}

/** Kiểm tra bản ghi READY, có URL và chưa vượt thời hạn lưu giữ. */
export function isRecordingAvailable(
  session: Pick<
    LiveSession,
    "recordingUrl" | "recordingStatus" | "recordingExpiresAt"
  >,
): boolean {
  return Boolean(
    session.recordingUrl &&
      session.recordingStatus === "READY" &&
      session.recordingExpiresAt &&
      new Date(session.recordingExpiresAt) > new Date(),
  );
}

/** Trả tóm tắt buổi học, trạng thái điểm danh và khả năng xem bản ghi của học viên. */
export async function getSessionSummary(
  serviceContext: LearningServiceContext,
  sessionId: string,
  learnerId: string,
): Promise<object> {
  const prisma = serviceContext.database();
  if (prisma) {
    const session = await prisma.liveSession.findUnique({
      where: { id: sessionId },
    });
    if (!session) throw new NotFoundException("Không tìm thấy buổi học.");
    const enrollment = await prisma.classEnrollment.findFirst({
      where: { classId: session.classId, learnerId, status: "ACTIVE" },
    });
    if (!enrollment)
      throw new NotFoundException("Học viên không thuộc lớp của buổi học.");
    const mapped = serviceContext.mapSession(session);
    return {
      session: {
        ...mapped,
        hostUrl: "",
        attendeeUrl: "",
        recordingUrl: undefined,
      },
      recordingAvailable: serviceContext.isRecordingAvailable(mapped),
    };
  }
  const session = serviceContext.findSession(sessionId);
  if (!serviceContext.findClass(session.classId).learnerIds.includes(learnerId))
    throw new NotFoundException("Học viên không thuộc lớp của buổi học.");
  return {
    session: {
      ...session,
      hostUrl: "",
      attendeeUrl: "",
      recordingUrl: undefined,
    },
    recordingAvailable: serviceContext.isRecordingAvailable(session),
  };
}

/** Phát URL nội bộ ký theo session, learner và hạn để bảo vệ bản ghi. */
export async function createRecordingAccess(
  serviceContext: LearningServiceContext,
  sessionId: string,
  learnerId: string,
): Promise<{ url: string; expiresAt: string }> {
  const prisma = serviceContext.database();
  if (prisma) {
    const session = await prisma.liveSession.findFirst({
      where: {
        id: sessionId,
        status: "COMPLETED",
        recordingStatus: "READY",
        recordingUrl: { not: null },
        recordingExpiresAt: { gt: new Date() },
        class: { enrollments: { some: { learnerId, status: "ACTIVE" } } },
      },
    });
    if (!session)
      throw new NotFoundException(
        "Bản ghi chưa sẵn sàng hoặc học viên không có quyền xem.",
      );
  } else {
    const session = serviceContext.findSession(sessionId);
    if (
      session.status !== "COMPLETED" ||
      !serviceContext.isRecordingAvailable(session) ||
      !serviceContext.findClass(session.classId).learnerIds.includes(learnerId)
    )
      throw new NotFoundException(
        "Bản ghi chưa sẵn sàng, đã hết hạn hoặc học viên không có quyền xem.",
      );
  }
  const expires = Math.floor(Date.now() / 1000) + 300;
  const signature = serviceContext.signRecordingAccess(
    sessionId,
    expires,
    learnerId,
  );
  return {
    url: `/learner/sessions/${sessionId}/recording?expires=${expires}&signature=${encodeURIComponent(signature)}`,
    expiresAt: new Date(expires * 1000).toISOString(),
  };
}

/** Xác minh chữ ký/hạn/quyền học viên rồi mới trả URL provider thực. */
export async function resolveRecordingAccess(
  serviceContext: LearningServiceContext,
  sessionId: string,
  expires: number,
  signature: string,
  learnerId: string,
): Promise<{ recordingUrl: string }> {
  serviceContext.verifyExpiringSignature(
    serviceContext.signRecordingAccess(sessionId, expires, learnerId),
    expires,
    signature,
    "Chữ ký bản ghi không hợp lệ.",
  );
  const prisma = serviceContext.database();
  if (prisma) {
    const session = await prisma.liveSession.findFirst({
      where: {
        id: sessionId,
        status: "COMPLETED",
        recordingStatus: "READY",
        recordingUrl: { not: null },
        recordingExpiresAt: { gt: new Date() },
        class: { enrollments: { some: { learnerId, status: "ACTIVE" } } },
      },
    });
    if (!session?.recordingUrl)
      throw new NotFoundException(
        "Bản ghi chưa sẵn sàng hoặc học viên không có quyền xem.",
      );
    return { recordingUrl: session.recordingUrl };
  }
  const session = serviceContext.findSession(sessionId);
  if (
    session.status !== "COMPLETED" ||
    !serviceContext.isRecordingAvailable(session) ||
    !serviceContext.findClass(session.classId).learnerIds.includes(learnerId)
  )
    throw new NotFoundException(
      "Bản ghi chưa sẵn sàng, đã hết hạn hoặc học viên không có quyền xem.",
    );
  return { recordingUrl: session.recordingUrl! };
}
