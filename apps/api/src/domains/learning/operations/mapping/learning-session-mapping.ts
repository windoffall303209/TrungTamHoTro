import { BadRequestException } from "@nestjs/common";
import { Prisma } from "../../../../generated/prisma/client.js";
import { SupportTicketWithAttachments } from "../../core/learning.shared.js";
import type { LiveSession, SupportTicket } from "../../core/learning.types.js";
import type { LearningServiceContext } from "../../core/learning.context.js";

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
