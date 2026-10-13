import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from "@nestjs/common";
import { id, now } from "../learning.shared.js";
import type { InstructorRole, LearningClass } from "../learning.types.js";
import type { LearningServiceContext } from "../learning.context.js";

/** Gán giảng viên đúng role, bảo đảm người dùng có vai trò INSTRUCTOR và ghi lịch sử thành viên. */
export async function assignInstructor(
  serviceContext: LearningServiceContext,
  classId: string,
  instructorId: string,
  requestedRole?: InstructorRole,
  actorId = "usr-manager",
): Promise<LearningClass> {
  const prisma = serviceContext.database();
  if (prisma) {
    await serviceContext.requireUserRole(
      prisma,
      instructorId,
      "INSTRUCTOR",
      "Người dùng được chọn không phải giảng viên.",
    );
    const classItem = await prisma.learningClass.findUnique({
      where: { id: classId },
      include: { instructors: true },
    });
    if (!classItem) throw new NotFoundException("Không tìm thấy lớp học.");
    if (classItem.status === "CLOSED")
      throw new ConflictException("Lớp đã lưu trữ và chỉ cho phép đọc.");
    const role =
      requestedRole ??
      (classItem.instructors.length ? "CO_INSTRUCTOR" : "PRIMARY");
    const currentPrimary = classItem.instructors.find(
      (row) => row.role === "PRIMARY",
    );
    if (
      role === "PRIMARY" &&
      currentPrimary &&
      currentPrimary.instructorId !== instructorId
    )
      throw new ConflictException(
        "Lớp đã có giảng viên chính; hãy dùng luồng bàn giao để thay đổi.",
      );
    const load = await prisma.classInstructor.count({
      where: { instructorId, class: { status: { in: ["DRAFT", "ACTIVE"] } } },
    });
    if (
      !classItem.instructors.some((row) => row.instructorId === instructorId) &&
      load >= 5
    )
      throw new ConflictException(
        "Giảng viên đã đạt giới hạn 5 lớp đang phụ trách.",
      );
    const targetSessions = await prisma.liveSession.findMany({
      where: { classId, status: { not: "CANCELLED" } },
      select: { startsAt: true, endsAt: true },
    });
    let overlap: { class: { code: string } } | null = null;
    for (const session of targetSessions) {
      overlap = await prisma.liveSession.findFirst({
        where: {
          classId: { not: classId },
          status: { not: "CANCELLED" },
          startsAt: { lt: session.endsAt },
          endsAt: { gt: session.startsAt },
          class: {
            status: "ACTIVE",
            instructors: { some: { instructorId } },
          },
        },
        select: { class: { select: { code: true } } },
      });
      if (overlap) break;
    }
    if (overlap)
      throw new ConflictException(
        `Giảng viên có buổi học xung đột với lớp ${overlap.class.code}.`,
      );
    await prisma.$transaction(async (transaction) => {
      if (role === "PRIMARY")
        await transaction.classInstructor.updateMany({
          where: {
            classId,
            role: "PRIMARY",
            instructorId: { not: instructorId },
          },
          data: { role: "CO_INSTRUCTOR" },
        });
      await transaction.classInstructor.upsert({
        where: { classId_instructorId: { classId, instructorId } },
        update: { role, assignedBy: actorId },
        create: { classId, instructorId, role, assignedBy: actorId },
      });
      await transaction.classInstructorHistory.create({
        data: {
          id: id("instructor-history"),
          classId,
          instructorId,
          role,
          action: "ASSIGNED",
          actorId,
        },
      });
      await transaction.notification.upsert({
        where: {
          dedupKey: `instructor-assigned:${classId}:${instructorId}:${role}`,
        },
        update: {
          title: `Bạn được phân công ${role === "PRIMARY" ? "giảng viên chính" : "đồng giảng viên"} cho lớp ${classItem.code}`,
          readAt: null,
          createdAt: new Date(),
        },
        create: {
          id: id("notification"),
          recipientId: instructorId,
          type: "CLASS_INSTRUCTOR_ASSIGNED",
          title: `Bạn được phân công ${role === "PRIMARY" ? "giảng viên chính" : "đồng giảng viên"} cho lớp ${classItem.code}`,
          entityType: "CLASS",
          entityId: classId,
          dedupKey: `instructor-assigned:${classId}:${instructorId}:${role}`,
        },
      });
    });
    return serviceContext.getDatabaseClass(prisma, classId);
  }
  const item = serviceContext.findClass(classId);
  if (item.status === "CLOSED")
    throw new ConflictException("Lớp đã lưu trữ và chỉ cho phép đọc.");
  const role =
    requestedRole ?? (item.instructorIds.length ? "CO_INSTRUCTOR" : "PRIMARY");
  const currentPrimaryId = item.instructorIds.find(
    (currentId) =>
      serviceContext.instructorRoles.get(`${classId}:${currentId}`) ===
      "PRIMARY",
  );
  if (
    role === "PRIMARY" &&
    currentPrimaryId &&
    currentPrimaryId !== instructorId
  )
    throw new ConflictException(
      "Lớp đã có giảng viên chính; hãy dùng luồng bàn giao để thay đổi.",
    );
  const targetSessions = serviceContext.sessions.filter(
    (session) => session.classId === classId && session.status !== "CANCELLED",
  );
  const conflictSession = targetSessions
    .map((targetSession) =>
      serviceContext.sessions.find((session) => {
        if (session.classId === classId || session.status === "CANCELLED")
          return false;
        const candidate = serviceContext.classes.find(
          (classItem) => classItem.id === session.classId,
        );
        return Boolean(
          candidate?.status === "ACTIVE" &&
            candidate.instructorIds.includes(instructorId) &&
            new Date(session.startsAt) < new Date(targetSession.endsAt) &&
            new Date(session.endsAt) > new Date(targetSession.startsAt),
        );
      }),
    )
    .find(Boolean);
  const conflict = conflictSession
    ? serviceContext.classes.find(
        (candidate) => candidate.id === conflictSession.classId,
      )
    : undefined;
  if (conflict)
    throw new ConflictException(
      `Giảng viên có buổi học xung đột với lớp ${conflict.code}.`,
    );
  if (role === "PRIMARY")
    for (const currentId of item.instructorIds)
      serviceContext.instructorRoles.set(
        `${classId}:${currentId}`,
        "CO_INSTRUCTOR",
      );
  if (!item.instructorIds.includes(instructorId))
    item.instructorIds.push(instructorId);
  serviceContext.instructorRoles.set(`${classId}:${instructorId}`, role);
  serviceContext.recordMemberHistory(
    classId,
    instructorId,
    "INSTRUCTOR",
    "ASSIGNED",
    actorId,
    { role },
  );
  serviceContext.notifications.unshift({
    id: id("notification"),
    recipientId: instructorId,
    type: "CLASS_INSTRUCTOR_ASSIGNED",
    title: `Bạn được phân công vào lớp ${item.code}`,
    entityType: "CLASS",
    entityId: classId,
    createdAt: now(),
  });
  return {
    ...item,
    instructorIds: [...item.instructorIds],
    learnerIds: [...item.learnerIds],
  };
}

/** Bàn giao PRIMARY nguyên tử, chống hai yêu cầu đồng thời bằng người nguồn kỳ vọng. */
export async function transferPrimaryInstructor(
  serviceContext: LearningServiceContext,
  classId: string,
  expectedPrimaryId: string,
  newPrimaryId: string,
  rawReason: string,
  actorId = "usr-manager",
): Promise<LearningClass> {
  const reason = rawReason.trim();
  if (reason.length < 5)
    throw new BadRequestException("Lý do bàn giao cần ít nhất 5 ký tự.");
  if (expectedPrimaryId === newPrimaryId)
    throw new BadRequestException(
      "Giảng viên nhận bàn giao phải khác người hiện tại.",
    );
  const prisma = serviceContext.database();
  if (prisma) {
    await serviceContext.requireUserRole(
      prisma,
      newPrimaryId,
      "INSTRUCTOR",
      "Người nhận bàn giao không phải giảng viên.",
    );
    return prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`SELECT id FROM learning_classes WHERE id = ${classId} FOR UPDATE`;
      const classItem = await transaction.learningClass.findUnique({
        where: { id: classId },
        include: { instructors: true },
      });
      if (!classItem) throw new NotFoundException("Không tìm thấy lớp học.");
      if (classItem.status === "CLOSED")
        throw new ConflictException("Lớp đã lưu trữ và chỉ cho phép đọc.");
      const currentPrimary = classItem.instructors.find(
        (row) => row.role === "PRIMARY",
      );
      if (currentPrimary?.instructorId !== expectedPrimaryId)
        throw new ConflictException(
          "Giảng viên chính đã thay đổi; hãy tải lại trước khi bàn giao.",
        );
      const claimed = await transaction.classInstructor.updateMany({
        where: { classId, instructorId: expectedPrimaryId, role: "PRIMARY" },
        data: { role: "CO_INSTRUCTOR" },
      });
      if (claimed.count !== 1)
        throw new ConflictException(
          "Giảng viên chính đã thay đổi; hãy tải lại trước khi bàn giao.",
        );
      await transaction.classInstructor.upsert({
        where: {
          classId_instructorId: { classId, instructorId: newPrimaryId },
        },
        update: { role: "PRIMARY", assignedBy: actorId },
        create: {
          classId,
          instructorId: newPrimaryId,
          role: "PRIMARY",
          assignedBy: actorId,
        },
      });
      await transaction.classInstructorHistory.createMany({
        data: [
          {
            id: id("instructor-history"),
            classId,
            instructorId: expectedPrimaryId,
            role: "CO_INSTRUCTOR",
            action: "PRIMARY_TRANSFERRED_OUT",
            reason,
            actorId,
          },
          {
            id: id("instructor-history"),
            classId,
            instructorId: newPrimaryId,
            role: "PRIMARY",
            action: "PRIMARY_TRANSFERRED_IN",
            reason,
            actorId,
          },
        ],
      });
      for (const recipientId of new Set([expectedPrimaryId, newPrimaryId]))
        await transaction.notification.upsert({
          where: {
            dedupKey: `primary-transfer:${classId}:${expectedPrimaryId}:${newPrimaryId}:${recipientId}`,
          },
          update: { readAt: null, createdAt: new Date() },
          create: {
            id: id("notification"),
            recipientId,
            type: "CLASS_PRIMARY_TRANSFERRED",
            title: `Lớp ${classItem.code} đã bàn giao giảng viên chính`,
            entityType: "CLASS",
            entityId: classId,
            dedupKey: `primary-transfer:${classId}:${expectedPrimaryId}:${newPrimaryId}:${recipientId}`,
          },
        });
      await transaction.auditLog.create({
        data: {
          actorId,
          action: "CLASS_PRIMARY_TRANSFERRED",
          entityType: "learning_class",
          entityId: classId,
          context: { expectedPrimaryId, newPrimaryId, reason },
        },
      });
      return serviceContext.getDatabaseClass(transaction, classId);
    });
  }
  const item = serviceContext.findClass(classId);
  if (item.status === "CLOSED")
    throw new ConflictException("Lớp đã lưu trữ và chỉ cho phép đọc.");
  const currentPrimaryId = item.instructorIds.find(
    (instructorId) =>
      serviceContext.instructorRoles.get(`${classId}:${instructorId}`) ===
      "PRIMARY",
  );
  if (currentPrimaryId !== expectedPrimaryId)
    throw new ConflictException(
      "Giảng viên chính đã thay đổi; hãy tải lại trước khi bàn giao.",
    );
  serviceContext.instructorRoles.set(
    `${classId}:${expectedPrimaryId}`,
    "CO_INSTRUCTOR",
  );
  if (!item.instructorIds.includes(newPrimaryId))
    item.instructorIds.push(newPrimaryId);
  serviceContext.instructorRoles.set(`${classId}:${newPrimaryId}`, "PRIMARY");
  serviceContext.recordMemberHistory(
    classId,
    expectedPrimaryId,
    "INSTRUCTOR",
    "PRIMARY_TRANSFERRED_OUT",
    actorId,
    { role: "CO_INSTRUCTOR", reason },
  );
  serviceContext.recordMemberHistory(
    classId,
    newPrimaryId,
    "INSTRUCTOR",
    "PRIMARY_TRANSFERRED_IN",
    actorId,
    { role: "PRIMARY", reason },
  );
  return {
    ...item,
    instructorIds: [...item.instructorIds],
    learnerIds: [...item.learnerIds],
  };
}

/** Gỡ phân công giảng viên, bảo vệ điều kiện giảng viên chính và lưu lý do lịch sử. */
export async function removeInstructor(
  serviceContext: LearningServiceContext,
  classId: string,
  instructorId: string,
  reason: string,
  actorId = "usr-manager",
): Promise<LearningClass> {
  const normalizedReason = reason.trim();
  if (normalizedReason.length < 5)
    throw new BadRequestException("Lý do gỡ phân công cần ít nhất 5 ký tự.");
  const prisma = serviceContext.database();
  if (prisma) {
    const current = await prisma.classInstructor.findUnique({
      where: { classId_instructorId: { classId, instructorId } },
    });
    if (!current) throw new NotFoundException("Giảng viên không thuộc lớp.");
    const primaryCount = await prisma.classInstructor.count({
      where: { classId, role: "PRIMARY" },
    });
    if (current.role === "PRIMARY" && primaryCount <= 1)
      throw new ConflictException(
        "Không thể gỡ giảng viên chính cuối cùng; hãy phân công người thay thế trước.",
      );
    await prisma.$transaction([
      prisma.classInstructor.delete({
        where: { classId_instructorId: { classId, instructorId } },
      }),
      prisma.classInstructorHistory.create({
        data: {
          id: id("instructor-history"),
          classId,
          instructorId,
          role: current.role,
          action: "REMOVED",
          reason: normalizedReason,
          actorId,
        },
      }),
      prisma.notification.upsert({
        where: { dedupKey: `instructor-removed:${classId}:${instructorId}` },
        update: { readAt: null, createdAt: new Date() },
        create: {
          id: id("notification"),
          recipientId: instructorId,
          type: "CLASS_INSTRUCTOR_REMOVED",
          title: "Phân công giảng dạy đã được cập nhật",
          entityType: "CLASS",
          entityId: classId,
          dedupKey: `instructor-removed:${classId}:${instructorId}`,
        },
      }),
    ]);
    return serviceContext.getDatabaseClass(prisma, classId);
  }
  const item = serviceContext.findClass(classId);
  const role = serviceContext.instructorRoles.get(`${classId}:${instructorId}`);
  if (!role) throw new NotFoundException("Giảng viên không thuộc lớp.");
  if (
    role === "PRIMARY" &&
    item.instructorIds.filter(
      (value) =>
        serviceContext.instructorRoles.get(`${classId}:${value}`) === "PRIMARY",
    ).length <= 1
  )
    throw new ConflictException(
      "Không thể gỡ giảng viên chính cuối cùng; hãy phân công người thay thế trước.",
    );
  item.instructorIds = item.instructorIds.filter(
    (value) => value !== instructorId,
  );
  serviceContext.instructorRoles.delete(`${classId}:${instructorId}`);
  serviceContext.recordMemberHistory(
    classId,
    instructorId,
    "INSTRUCTOR",
    "REMOVED",
    actorId,
    { role, reason: normalizedReason },
  );
  return {
    ...item,
    instructorIds: [...item.instructorIds],
    learnerIds: [...item.learnerIds],
  };
}
