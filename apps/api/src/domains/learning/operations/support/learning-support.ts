import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from "@nestjs/common";
import { createHash } from "node:crypto";
import { extname } from "node:path";
import { normalizeMultipartFileName } from "../../../../infrastructure/file-transfer.js";
import {
  id,
  MaterialDownload,
  now,
  UploadedMaterialFile,
} from "../../core/learning.shared.js";
import type {
  LearningNotification,
  SupportAttachment,
  SupportTicket,
  TicketComment,
} from "../../core/learning.types.js";
import type { LearningServiceContext } from "../../core/learning.context.js";

/** Kiểm tra chuyển trạng thái và người xử lý thống nhất giữa hai chế độ lưu trữ. */
function assertTicketTransition(
  currentStatus: SupportTicket["status"],
  nextStatus: SupportTicket["status"],
  assigneeId: string | null | undefined,
): void {
  const allowedTransitions: Record<
    SupportTicket["status"],
    SupportTicket["status"][]
  > = {
    OPEN: ["OPEN", "IN_PROGRESS"],
    IN_PROGRESS: ["IN_PROGRESS", "RESOLVED"],
    RESOLVED: ["RESOLVED"],
    CLOSED: [],
  };
  if (!allowedTransitions[currentStatus].includes(nextStatus))
    throw new ConflictException(
      `Không thể chuyển phiếu từ ${currentStatus} sang ${nextStatus}.`,
    );
  if (["IN_PROGRESS", "RESOLVED"].includes(nextStatus) && !assigneeId)
    throw new BadRequestException(
      "Cần phân công người xử lý trước khi tiếp nhận hoặc hoàn tất phiếu.",
    );
}

/** Liệt kê tất cả phiếu cho nhân sự hỗ trợ hoặc chỉ phiếu của người gửi. */
export async function listTickets(
  serviceContext: LearningServiceContext,
  role: string,
  actorId = serviceContext.userIdForRole(role),
): Promise<SupportTicket[]> {
  const canManage = serviceContext.canManageSupport(role);
  const prisma = serviceContext.database();
  if (prisma) {
    const rows = await prisma.supportTicket.findMany({
      where: canManage ? undefined : { reporterId: actorId },
      include: { attachments: true },
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    });
    return rows.map((row) => serviceContext.mapTicket(row));
  }
  return serviceContext.tickets
    .filter((item) => canManage || item.reporterId === actorId)
    .map((item) => ({
      ...item,
      attachments: item.attachments.map((attachment) => ({ ...attachment })),
    }));
}

/** Validate nội dung, chống phiếu trùng đang mở và tạo SLA theo mức độ nghiêm trọng. */
export async function createTicket(
  serviceContext: LearningServiceContext,
  input: Pick<
    SupportTicket,
    "category" | "severity" | "description" | "contextId"
  > & { clientRequestId?: string },
  reporterId = "usr-learner",
): Promise<SupportTicket> {
  const slaHours: Record<SupportTicket["severity"], number> = {
    P0: 4,
    P1: 24,
    P2: 72,
    P3: 120,
  };
  const description = serviceContext.validateSupportText(
    input.description,
    "Mô tả yêu cầu",
  );
  const category = input.category.trim();
  const contextId = input.contextId?.trim() || undefined;
  const clientRequestId = input.clientRequestId?.trim() || undefined;
  const prisma = serviceContext.database();
  if (prisma) {
    try {
      return await prisma.$transaction(async (transaction) => {
        const duplicate = await transaction.supportTicket.findFirst({
          where: {
            reporterId,
            category,
            status: { in: ["OPEN", "IN_PROGRESS"] },
            createdAt: { gte: new Date(Date.now() - 24 * 3_600_000) },
            ...(contextId ? { contextId } : { description }),
          },
          orderBy: { createdAt: "desc" },
        });
        const ticketId = id("ticket");
        const ticketData = {
          id: ticketId,
          clientRequestId: clientRequestId ?? null,
          reporterId,
          category,
          severity: input.severity,
          description,
          contextId: contextId ?? null,
          duplicateOfId: duplicate?.id,
          dueAt: new Date(Date.now() + slaHours[input.severity] * 3_600_000),
        };
        const created = clientRequestId
          ? await transaction.supportTicket.upsert({
              where: {
                reporterId_clientRequestId: { reporterId, clientRequestId },
              },
              update: {},
              create: ticketData,
              include: { attachments: true },
            })
          : await transaction.supportTicket.create({
              data: ticketData,
              include: { attachments: true },
            });
        if (created.id !== ticketId) return serviceContext.mapTicket(created);
        if (input.severity === "P0") {
          const adminIds = await serviceContext.userIdsForRole(
            transaction,
            "SYSTEM_ADMIN",
          );
          await transaction.notification.createMany({
            data: adminIds.map((recipientId) => ({
              id: id("notification"),
              recipientId,
              type: "SUPPORT_P0",
              title: `P0 mới: ${category}${contextId ? ` · ${contextId}` : ""}`,
              entityType: "SUPPORT_TICKET",
              entityId: ticketId,
              dedupKey: `support-p0:${ticketId}:${recipientId}`,
            })),
            skipDuplicates: true,
          });
        }
        return serviceContext.mapTicket(created);
      });
    } catch (error) {
      const uniqueRace =
        clientRequestId &&
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "P2002";
      if (uniqueRace) {
        const existing = await prisma.supportTicket.findUnique({
          where: {
            reporterId_clientRequestId: { reporterId, clientRequestId },
          },
          include: { attachments: true },
        });
        if (existing) return serviceContext.mapTicket(existing);
      }
      throw error;
    }
  }
  if (clientRequestId) {
    const existing = serviceContext.tickets.find(
      (ticket) =>
        ticket.reporterId === reporterId &&
        ticket.clientRequestId === clientRequestId,
    );
    if (existing)
      return { ...existing, attachments: [...existing.attachments] };
  }
  const duplicate = serviceContext.tickets.find(
    (ticket) =>
      ticket.reporterId === reporterId &&
      ticket.category === category &&
      ["OPEN", "IN_PROGRESS"].includes(ticket.status) &&
      Date.now() - new Date(ticket.createdAt).getTime() <= 24 * 3_600_000 &&
      (contextId
        ? ticket.contextId === contextId
        : ticket.description === description),
  );
  const item: SupportTicket = {
    ...input,
    category,
    description,
    contextId,
    duplicateOfId: duplicate?.id,
    clientRequestId,
    id: id("ticket"),
    reporterId,
    status: "OPEN",
    dueAt: new Date(
      Date.now() + slaHours[input.severity] * 3_600_000,
    ).toISOString(),
    attachments: [],
    createdAt: now(),
    updatedAt: now(),
  };
  serviceContext.tickets.unshift(item);
  if (input.severity === "P0")
    serviceContext.notifications.unshift({
      id: id("notification"),
      recipientId: serviceContext.userIdForRole("SYSTEM_ADMIN"),
      type: "SUPPORT_P0",
      title: `P0 mới: ${category}${contextId ? ` · ${contextId}` : ""}`,
      entityType: "SUPPORT_TICKET",
      entityId: item.id,
      createdAt: now(),
    });
  return { ...item, attachments: [] };
}

/** Adapter tương thích cũ ánh xạ vai trò demo sang userId để đọc thông báo. */
export function listRoleNotifications(
  serviceContext: LearningServiceContext,
  role: string,
): Promise<LearningNotification[]> {
  return serviceContext.listNotifications(serviceContext.userIdForRole(role));
}

/** Adapter tương thích cũ đánh dấu thông báo theo userId mặc định của vai trò. */
export function markRoleNotificationRead(
  serviceContext: LearningServiceContext,
  notificationId: string,
  role: string,
): Promise<LearningNotification> {
  return serviceContext.markNotificationRead(
    notificationId,
    serviceContext.userIdForRole(role),
  );
}

/** Kiểm tra quyền phiếu, magic bytes/virus rồi lưu tệp bằng chứng và metadata. */
export async function addSupportAttachment(
  serviceContext: LearningServiceContext,
  ticketId: string,
  upload: UploadedMaterialFile,
  role: string,
  uploaderId = serviceContext.userIdForRole(role),
): Promise<SupportAttachment> {
  const canManage = serviceContext.canManageSupport(role);
  serviceContext.validateSupportUpload(upload);
  const quarantineReason = await serviceContext.scanUpload(upload);
  if (quarantineReason)
    throw new BadRequestException(
      `Tệp bằng chứng bị từ chối: ${quarantineReason}`,
    );
  const attachmentId = id("support-attachment");
  const safeExtension = extname(upload.originalName)
    .toLowerCase()
    .replace(/[^.a-z0-9]/g, "");
  const objectKey = `support/${ticketId}/${attachmentId}${safeExtension}`;
  const checksum = `sha256:${createHash("sha256").update(upload.buffer).digest("hex")}`;
  const prisma = serviceContext.database();
  if (prisma) {
    const ticket = await prisma.supportTicket.findUnique({
      where: { id: ticketId },
    });
    if (!ticket || (!canManage && ticket.reporterId !== uploaderId))
      throw new NotFoundException("Không tìm thấy ticket được phép đính kèm.");
    if (["RESOLVED", "CLOSED"].includes(ticket.status))
      throw new BadRequestException(
        "Ticket đã hoàn tất, không thể thêm bằng chứng.",
      );
    const stored = await serviceContext.writeStoredFile(
      objectKey,
      upload.buffer,
    );
    try {
      const row = await prisma.supportAttachment.create({
        data: {
          id: attachmentId,
          ticketId,
          uploaderId,
          name: upload.originalName,
          objectKey: stored.objectKey,
          mimeType: upload.mimeType,
          sizeBytes: upload.size,
          checksum: stored.checksum,
        },
      });
      return {
        id: row.id,
        ticketId: row.ticketId,
        name: row.name,
        mimeType: row.mimeType,
        sizeBytes: Number(row.sizeBytes),
        checksum: row.checksum,
        createdAt: row.createdAt.toISOString(),
      };
    } catch (error) {
      await serviceContext.removeStoredFile(stored.objectKey);
      throw error;
    }
  }
  const ticket = serviceContext.tickets.find((item) => item.id === ticketId);
  if (!ticket || (!canManage && ticket.reporterId !== uploaderId))
    throw new NotFoundException("Không tìm thấy ticket được phép đính kèm.");
  if (["RESOLVED", "CLOSED"].includes(ticket.status))
    throw new BadRequestException(
      "Ticket đã hoàn tất, không thể thêm bằng chứng.",
    );
  await serviceContext.writeStoredFile(objectKey, upload.buffer);
  const attachment: SupportAttachment = {
    id: attachmentId,
    ticketId,
    name: upload.originalName,
    mimeType: upload.mimeType,
    sizeBytes: upload.size,
    checksum,
    createdAt: now(),
  };
  serviceContext.supportAttachmentFiles.set(attachmentId, objectKey);
  ticket.attachments.push(attachment);
  return { ...attachment };
}

/** Trả bytes bằng chứng cho đúng người gửi hoặc vai trò quản lý hỗ trợ. */
export async function readSupportAttachment(
  serviceContext: LearningServiceContext,
  ticketId: string,
  attachmentId: string,
  role: string,
  actorId = serviceContext.userIdForRole(role),
): Promise<MaterialDownload> {
  const canManage = serviceContext.canManageSupport(role);
  const prisma = serviceContext.database();
  if (prisma) {
    const attachment = await prisma.supportAttachment.findFirst({
      where: { id: attachmentId, ticketId },
      include: { ticket: true },
    });
    if (!attachment || (!canManage && attachment.ticket.reporterId !== actorId))
      throw new NotFoundException(
        "Không tìm thấy bằng chứng hỗ trợ được phép xem.",
      );
    const buffer = await serviceContext.readStoredFile(attachment.objectKey);
    if (
      `sha256:${createHash("sha256").update(buffer).digest("hex")}` !==
      attachment.checksum
    )
      throw new BadRequestException("Checksum bằng chứng hỗ trợ không hợp lệ.");
    return {
      fileName: normalizeMultipartFileName(attachment.name),
      mimeType: attachment.mimeType,
      buffer,
    };
  }
  const ticket = serviceContext.tickets.find((item) => item.id === ticketId);
  const attachment = ticket?.attachments.find(
    (item) => item.id === attachmentId,
  );
  const objectKey = serviceContext.supportAttachmentFiles.get(attachmentId);
  if (
    !ticket ||
    !attachment ||
    !objectKey ||
    (!canManage && ticket.reporterId !== actorId)
  )
    throw new NotFoundException(
      "Không tìm thấy bằng chứng hỗ trợ được phép xem.",
    );
  const buffer = await serviceContext.readStoredFile(objectKey);
  if (
    `sha256:${createHash("sha256").update(buffer).digest("hex")}` !==
    attachment.checksum
  )
    throw new BadRequestException("Checksum bằng chứng hỗ trợ không hợp lệ.");
  return {
    fileName: normalizeMultipartFileName(attachment.name),
    mimeType: attachment.mimeType,
    buffer,
  };
}

/** Cập nhật người phụ trách/trạng thái/kết quả và ghi audit chuyển trạng thái. */
export async function updateTicket(
  serviceContext: LearningServiceContext,
  ticketId: string,
  input: Partial<
    Pick<SupportTicket, "status" | "assigneeId" | "resolution">
  > & { expectedUpdatedAt?: string },
  actorId = "usr-admin",
): Promise<SupportTicket> {
  if (input.status === "CLOSED")
    throw new BadRequestException(
      "Người gửi phải là người xác nhận đóng phiếu sau khi nhận kết quả.",
    );
  if (input.status === "RESOLVED" && !input.resolution?.trim())
    throw new BadRequestException("Cần ghi nội dung xử lý trước khi hoàn tất.");
  const prisma = serviceContext.database();
  if (prisma) {
    return prisma.$transaction(async (transaction) => {
      const item = await transaction.supportTicket.findUnique({
        where: { id: ticketId },
      });
      if (!item) throw new NotFoundException("Không tìm thấy ticket.");
      const expectedUpdatedAt = input.expectedUpdatedAt
        ? new Date(input.expectedUpdatedAt)
        : item.updatedAt;
      if (Number.isNaN(expectedUpdatedAt.getTime()))
        throw new BadRequestException("Phiên bản phiếu hỗ trợ không hợp lệ.");
      if (item.status === "CLOSED")
        throw new ConflictException("Phiếu đã đóng và không thể thay đổi.");
      const nextStatus =
        input.status ??
        (item.status === "OPEN" && input.assigneeId
          ? "IN_PROGRESS"
          : item.status);
      const assigneeId = input.assigneeId ?? item.assigneeId;
      assertTicketTransition(item.status, nextStatus, assigneeId);
      if (assigneeId) {
        const assignee = await transaction.user.findFirst({
          where: {
            id: assigneeId,
            status: "ACTIVE",
            roles: {
              some: {
                role: {
                  permissions: {
                    some: { permission: { code: "support:manage" } },
                  },
                },
              },
            },
          },
          select: { id: true },
        });
        if (!assignee)
          throw new BadRequestException(
            "Người xử lý phải là tài khoản hoạt động có quyền support:manage.",
          );
      }
      const changed = await transaction.supportTicket.updateMany({
        where: { id: ticketId, updatedAt: expectedUpdatedAt },
        data: {
          status: nextStatus,
          assigneeId,
          resolution:
            nextStatus === "RESOLVED"
              ? input.resolution!.trim()
              : item.resolution,
        },
      });
      if (changed.count !== 1)
        throw new ConflictException(
          "Phiếu vừa thay đổi ở nơi khác. Hãy tải lại trước khi xử lý.",
        );
      const updated = await transaction.supportTicket.findUniqueOrThrow({
        where: { id: ticketId },
        include: { attachments: true },
      });
      await transaction.auditLog.create({
        data: {
          actorId,
          action: "SUPPORT_TICKET_UPDATED",
          entityType: "support_ticket",
          entityId: ticketId,
          context: {
            previousStatus: item.status,
            nextStatus,
            assigneeId,
          },
        },
      });
      const recipients = new Set([
        item.reporterId,
        ...(assigneeId && assigneeId !== actorId ? [assigneeId] : []),
      ]);
      await transaction.notification.createMany({
        data: [...recipients].map((recipientId) => ({
          id: id("notification"),
          recipientId,
          type:
            nextStatus === "RESOLVED" ? "SUPPORT_RESOLVED" : "SUPPORT_UPDATED",
          title:
            nextStatus === "RESOLVED"
              ? "Phiếu hỗ trợ đã có kết quả"
              : "Phiếu hỗ trợ đã được tiếp nhận",
          entityType: "SUPPORT_TICKET",
          entityId: ticketId,
          dedupKey: `support-update:${ticketId}:${updated.updatedAt.getTime()}:${recipientId}`,
        })),
      });
      return serviceContext.mapTicket(updated);
    });
  }
  const item = serviceContext.tickets.find((ticket) => ticket.id === ticketId);
  if (!item) throw new NotFoundException("Không tìm thấy ticket.");
  if (item.status === "CLOSED")
    throw new ConflictException("Phiếu đã đóng và không thể thay đổi.");
  const nextStatus =
    input.status ??
    (item.status === "OPEN" && input.assigneeId ? "IN_PROGRESS" : item.status);
  const assigneeId = input.assigneeId ?? item.assigneeId;
  assertTicketTransition(item.status, nextStatus, assigneeId);
  Object.assign(item, {
    status: nextStatus,
    assigneeId,
    resolution:
      nextStatus === "RESOLVED" ? input.resolution?.trim() : item.resolution,
    updatedAt: now(),
  });
  return {
    ...item,
    attachments: item.attachments.map((attachment) => ({ ...attachment })),
  };
}

/** Cho đúng người gửi đóng phiếu chưa hoàn tất và ghi mốc đóng. */
export async function closeTicketByReporter(
  serviceContext: LearningServiceContext,
  ticketId: string,
  reporterId = "usr-learner",
): Promise<SupportTicket> {
  const prisma = serviceContext.database();
  if (prisma) {
    return prisma.$transaction(async (transaction) => {
      const item = await transaction.supportTicket.findFirst({
        where: { id: ticketId, reporterId },
        include: { attachments: true },
      });
      if (!item)
        throw new NotFoundException("Không tìm thấy ticket được phép đóng.");
      if (item.status !== "RESOLVED" || !item.resolution?.trim())
        throw new ConflictException(
          "Chỉ được đóng ticket đã có kết quả xử lý.",
        );
      const updated = await transaction.supportTicket.update({
        where: { id: ticketId },
        data: { status: "CLOSED" },
        include: { attachments: true },
      });
      await transaction.auditLog.create({
        data: {
          actorId: reporterId,
          action: "SUPPORT_TICKET_CLOSED_BY_REPORTER",
          entityType: "support_ticket",
          entityId: ticketId,
          context: { resolution: item.resolution },
        },
      });
      return serviceContext.mapTicket(updated);
    });
  }
  const item = serviceContext.tickets.find(
    (ticket) => ticket.id === ticketId && ticket.reporterId === reporterId,
  );
  if (!item)
    throw new NotFoundException("Không tìm thấy ticket được phép đóng.");
  if (item.status !== "RESOLVED" || !item.resolution?.trim())
    throw new ConflictException("Chỉ được đóng ticket đã có kết quả xử lý.");
  item.status = "CLOSED";
  item.updatedAt = now();
  return {
    ...item,
    attachments: item.attachments.map((attachment) => ({ ...attachment })),
  };
}

/** Kiểm tra người gửi hoặc quyền hỗ trợ trước khi trả trao đổi của phiếu. */
export async function listTicketComments(
  serviceContext: LearningServiceContext,
  ticketId: string,
  role: string,
  actorId = serviceContext.userIdForRole(role),
): Promise<TicketComment[]> {
  const canManage = serviceContext.canManageSupport(role);
  const prisma = serviceContext.database();
  if (prisma) {
    const ticket = await prisma.supportTicket.findUnique({
      where: { id: ticketId },
    });
    if (!ticket || (!canManage && ticket.reporterId !== actorId))
      throw new NotFoundException("Không tìm thấy ticket được phép xem.");
    const rows = await prisma.ticketComment.findMany({
      where: { ticketId },
      orderBy: { createdAt: "asc" },
    });
    return rows.map((row) => ({
      id: row.id,
      ticketId: row.ticketId,
      authorId: row.authorId,
      body: row.body,
      createdAt: row.createdAt.toISOString(),
    }));
  }
  const ticket = serviceContext.tickets.find((item) => item.id === ticketId);
  if (!ticket || (!canManage && ticket.reporterId !== actorId))
    throw new NotFoundException("Không tìm thấy ticket được phép xem.");
  return serviceContext.ticketComments
    .filter((item) => item.ticketId === ticketId)
    .map((item) => ({ ...item }));
}

/** Thêm trao đổi hợp lệ vào phiếu truy cập được và cập nhật thời gian hoạt động. */
export async function addTicketComment(
  serviceContext: LearningServiceContext,
  ticketId: string,
  body: string,
  role: string,
  authorId = serviceContext.userIdForRole(role),
): Promise<TicketComment> {
  const normalized = serviceContext.validateSupportText(
    body,
    "Nội dung trao đổi",
  );
  const canManage = serviceContext.canManageSupport(role);
  const prisma = serviceContext.database();
  if (prisma) {
    const ticket = await prisma.supportTicket.findUnique({
      where: { id: ticketId },
    });
    if (!ticket || (!canManage && ticket.reporterId !== authorId))
      throw new NotFoundException("Không tìm thấy ticket được phép phản hồi.");
    if (ticket.status === "CLOSED")
      throw new BadRequestException("Ticket đã đóng, không thể thêm trao đổi.");
    return prisma.$transaction(async (transaction) => {
      const row = await transaction.ticketComment.create({
        data: {
          id: id("ticket-comment"),
          ticketId,
          authorId,
          body: normalized,
        },
      });
      const nextAssigneeId =
        canManage && ticket.status === "OPEN" ? authorId : ticket.assigneeId;
      if (canManage && ticket.status === "OPEN")
        await transaction.supportTicket.update({
          where: { id: ticketId },
          data: { status: "IN_PROGRESS", assigneeId: authorId },
        });
      const recipientIds = canManage
        ? [ticket.reporterId]
        : nextAssigneeId
          ? [nextAssigneeId]
          : await serviceContext.userIdsForRole(transaction, "SYSTEM_ADMIN");
      const recipients = [
        ...new Set(
          recipientIds.filter((recipientId) => recipientId !== authorId),
        ),
      ];
      if (recipients.length)
        await transaction.notification.createMany({
          data: recipients.map((recipientId) => ({
            id: id("notification"),
            recipientId,
            type: "SUPPORT_COMMENT",
            title: "Phiếu hỗ trợ có phản hồi mới",
            entityType: "SUPPORT_TICKET",
            entityId: ticketId,
            dedupKey: `support-comment:${row.id}:${recipientId}`,
          })),
        });
      return {
        id: row.id,
        ticketId: row.ticketId,
        authorId: row.authorId,
        body: row.body,
        createdAt: row.createdAt.toISOString(),
      };
    });
  }
  const ticket = serviceContext.tickets.find((item) => item.id === ticketId);
  if (!ticket || (!canManage && ticket.reporterId !== authorId))
    throw new NotFoundException("Không tìm thấy ticket được phép phản hồi.");
  if (ticket.status === "CLOSED")
    throw new BadRequestException("Ticket đã đóng, không thể thêm trao đổi.");
  if (canManage && ticket.status === "OPEN")
    Object.assign(ticket, { status: "IN_PROGRESS", assigneeId: authorId });
  const comment: TicketComment = {
    id: id("ticket-comment"),
    ticketId,
    authorId,
    body: normalized,
    createdAt: now(),
  };
  serviceContext.ticketComments.push(comment);
  return { ...comment };
}
