import { NotFoundException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { AuthenticatedSession } from "../../auth/auth.service.js";
import { ClassAnnouncementView } from "../academic.shared.js";
import type { AcademicServiceContext } from "../academic.context.js";

/** Trả thông báo mới nhất trong phạm vi lớp của người dùng. */
export async function listAnnouncements(
  serviceContext: AcademicServiceContext,
  session: AuthenticatedSession,
  classId?: string,
): Promise<ClassAnnouncementView[]> {
  const classIds = await serviceContext.accessibleClassIds(session);
  if (classId && !classIds.includes(classId))
    throw new NotFoundException(
      "Không tìm thấy lớp học trong phạm vi truy cập.",
    );
  const rows = await serviceContext.prisma.classAnnouncement.findMany({
    where: { classId: classId ?? { in: classIds } },
    include: {
      class: { select: { code: true } },
      author: { select: { displayName: true } },
    },
    orderBy: { publishedAt: "desc" },
    take: 100,
  });
  return rows.map((row) => ({
    id: row.id,
    classId: row.classId,
    classCode: row.class.code,
    title: row.title,
    body: row.body,
    authorName: row.author.displayName,
    publishedAt: row.publishedAt.toISOString(),
  }));
}

/** Kiểm tra quyền dạy rồi tạo thông báo gắn với tác giả hiện tại. */
export async function createAnnouncement(
  serviceContext: AcademicServiceContext,
  classId: string,
  title: string,
  body: string,
  session: AuthenticatedSession,
): Promise<ClassAnnouncementView> {
  await serviceContext.requireTeachingAccess(classId, session, true);
  return serviceContext.prisma.$transaction(async (transaction) => {
    const row = await transaction.classAnnouncement.create({
      data: {
        id: `announcement-${randomUUID()}`,
        classId,
        authorId: session.user.id,
        title: title.trim(),
        body: body.trim(),
      },
      include: {
        class: { select: { code: true } },
        author: { select: { displayName: true } },
      },
    });
    const members = await transaction.learningClass.findUnique({
      where: { id: classId },
      include: {
        instructors: { select: { instructorId: true } },
        enrollments: {
          where: { status: "ACTIVE" },
          select: { learnerId: true },
        },
      },
    });
    const recipients = new Set([
      ...(members?.instructors.map((item) => item.instructorId) ?? []),
      ...(members?.enrollments.map((item) => item.learnerId) ?? []),
    ]);
    recipients.delete(session.user.id);
    if (recipients.size)
      await transaction.notification.createMany({
        data: [...recipients].map((recipientId) => ({
          id: `notification-${randomUUID()}`,
          recipientId,
          type: "CLASS_ANNOUNCEMENT",
          title: `Thông báo lớp: ${title.trim()}`,
          entityType: "CLASS_ANNOUNCEMENT",
          entityId: row.id,
          dedupKey: `announcement:${row.id}:${recipientId}`,
        })),
      });
    return {
      id: row.id,
      classId: row.classId,
      classCode: row.class.code,
      title: row.title,
      body: row.body,
      authorName: row.author.displayName,
      publishedAt: row.publishedAt.toISOString(),
    };
  });
}
