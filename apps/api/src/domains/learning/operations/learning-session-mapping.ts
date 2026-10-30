import { BadRequestException } from "@nestjs/common";
import { Prisma } from "../../../generated/prisma/client.js";
import { SupportTicketWithAttachments } from "../learning.shared.js";
import type {
  AttendanceAppeal,
  AttendanceRecord,
  LiveSession,
  SupportTicket,
} from "../learning.types.js";
import type { LearningServiceContext } from "../learning.context.js";

/** Ánh xạ buổi học trực tuyến và metadata provider/recording sang API. */
export function mapSession(
  serviceContext: LearningServiceContext,
  row: Prisma.LiveSessionGetPayload<Record<string, never>>,
): LiveSession {
  if (!serviceContext.isLiveProvider(row.provider))
    throw new BadRequestException(
      `Nhà cung cấp lớp trực tuyến ${row.provider} không được hỗ trợ.`,
    );
  return {
    id: row.id,
    classId: row.classId,
    hostId: row.hostId,
    title: row.title,
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt.toISOString(),
    provider: row.provider,
    requestedProvider: serviceContext.isLiveProvider(row.requestedProvider)
      ? row.requestedProvider
      : row.provider,
    fallbackUsed: row.fallbackUsed,
    provisioningAttempts: row.provisioningAttempts,
    status: row.status,
    hostUrl: row.hostUrl,
    attendeeUrl: row.attendeeUrl,
    recordingUrl: row.recordingUrl ?? undefined,
    recordingStatus:
      row.recordingExpiresAt &&
      row.recordingExpiresAt <= new Date() &&
      row.recordingStatus === "READY"
        ? "EXPIRED"
        : (row.recordingStatus as LiveSession["recordingStatus"]),
    recordingReadyAt: row.recordingReadyAt?.toISOString(),
    recordingExpiresAt: row.recordingExpiresAt?.toISOString(),
    recordingError: row.recordingError ?? undefined,
    timezone: row.timezone,
    changeReason: row.changeReason ?? undefined,
    cancellationReason: row.cancellationReason ?? undefined,
    attendanceLockedAt: row.attendanceLockedAt?.toISOString(),
    attendanceLockedById: row.attendanceLockedById ?? undefined,
  };
}

/** Ánh xạ bản ghi điểm danh và các mốc tham dự/điều chỉnh. */
export function mapAttendance(
  row: Prisma.AttendanceRecordGetPayload<Record<string, never>>,
): AttendanceRecord {
  return {
    sessionId: row.sessionId,
    learnerId: row.learnerId,
    joinedAt: row.joinedAt?.toISOString(),
    leftAt: row.leftAt?.toISOString(),
    attendedMinutes: row.attendedMinutes,
    status: row.status,
    adjustmentReason: row.adjustmentReason ?? undefined,
    providerParticipantId: row.providerParticipantId ?? undefined,
    providerSnapshot:
      row.providerSnapshot &&
      typeof row.providerSnapshot === "object" &&
      !Array.isArray(row.providerSnapshot)
        ? ({ ...row.providerSnapshot } as Record<string, unknown>)
        : undefined,
  };
}

/** Ánh xạ khiếu nại điểm danh sang dữ liệu hiển thị. */
export function mapAttendanceAppeal(
  row: Prisma.AttendanceAppealGetPayload<Record<string, never>>,
): AttendanceAppeal {
  return {
    id: row.id,
    sessionId: row.sessionId,
    learnerId: row.learnerId,
    reason: row.reason,
    status: row.status,
    resolution: row.resolution ?? undefined,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Ánh xạ phiếu hỗ trợ và tệp đính kèm khi relation đã được tải. */
export function mapTicket(
  row:
    | Prisma.SupportTicketGetPayload<Record<string, never>>
    | SupportTicketWithAttachments,
): SupportTicket {
  return {
    id: row.id,
    clientRequestId: row.clientRequestId ?? undefined,
    reporterId: row.reporterId,
    category: row.category,
    severity: row.severity,
    description: row.description,
    contextId: row.contextId ?? undefined,
    duplicateOfId: row.duplicateOfId ?? undefined,
    status: row.status,
    assigneeId: row.assigneeId ?? undefined,
    resolution: row.resolution ?? undefined,
    dueAt: row.dueAt.toISOString(),
    attachments:
      "attachments" in row
        ? row.attachments.map((attachment) => ({
            id: attachment.id,
            ticketId: attachment.ticketId,
            name: attachment.name,
            mimeType: attachment.mimeType,
            sizeBytes: Number(attachment.sizeBytes),
            checksum: attachment.checksum,
            createdAt: attachment.createdAt.toISOString(),
          }))
        : [],
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
