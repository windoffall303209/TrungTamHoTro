import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from "@nestjs/common";
import { id, now } from "../learning.shared.js";
import type {
  ClassRoster,
  EnrollmentImportResult,
  LearningClass,
} from "../learning.types.js";
import type { LearningServiceContext } from "../learning.context.js";

/** Ghi danh học viên sau khi kiểm tra vai trò, trạng thái lớp, thời hạn và sức chứa. */
export async function enrollLearner(
  serviceContext: LearningServiceContext,
  classId: string,
  learnerId: string,
  actorId = "usr-manager",
): Promise<LearningClass> {
  const prisma = serviceContext.database();
  if (prisma) {
    await serviceContext.requireUserRole(
      prisma,
      learnerId,
      "LEARNER",
      "Người dùng được chọn không phải học viên.",
    );
    return prisma.$transaction(
      async (transaction) => {
        await transaction.$queryRaw`SELECT id FROM learning_classes WHERE id = ${classId} FOR UPDATE`;
        const classItem = await transaction.learningClass.findUnique({
          where: { id: classId },
          include: { enrollments: { where: { status: "ACTIVE" } } },
        });
        if (!classItem) throw new NotFoundException("Không tìm thấy lớp học.");
        if (classItem.status === "CLOSED")
          throw new ConflictException("Lớp đã lưu trữ và chỉ cho phép đọc.");
        if (new Date() > classItem.endAt)
          throw new ConflictException(
            "Lớp đã kết thúc, không thể ghi danh thêm học viên.",
          );
        if (
          classItem.status === "ACTIVE" &&
          new Date() > classItem.startAt &&
          !classItem.allowLateEnrollment
        )
          throw new ConflictException(
            "Lớp đã bắt đầu và không cho phép ghi danh muộn.",
          );
        if (classItem.enrollments.some((row) => row.learnerId === learnerId))
          throw new ConflictException("Học viên đã có trong lớp.");
        if (classItem.enrollments.length >= classItem.capacity)
          throw new BadRequestException("Lớp đã đủ sĩ số.");
        await transaction.classEnrollment.upsert({
          where: { classId_learnerId: { classId, learnerId } },
          update: {
            status: "ACTIVE",
            joinedAt: new Date(),
            source: "MANUAL",
            removalReason: null,
            removedAt: null,
          },
          create: { classId, learnerId, status: "ACTIVE", source: "MANUAL" },
        });
        await transaction.classEnrollmentHistory.create({
          data: {
            id: id("enrollment-history"),
            classId,
            learnerId,
            action: "ENROLLED",
            source: "MANUAL",
            actorId,
          },
        });
        await transaction.notification.upsert({
          where: { dedupKey: `class-enrolled:${classId}:${learnerId}` },
          update: {
            title: `Bạn đã được ghi danh vào lớp ${classItem.code}`,
            readAt: null,
            createdAt: new Date(),
          },
          create: {
            id: id("notification"),
            recipientId: learnerId,
            type: "CLASS_ENROLLED",
            title: `Bạn đã được ghi danh vào lớp ${classItem.code}`,
            entityType: "CLASS",
            entityId: classId,
            dedupKey: `class-enrolled:${classId}:${learnerId}`,
          },
        });
        return serviceContext.getDatabaseClass(transaction, classId);
      },
      { isolationLevel: "ReadCommitted" },
    );
  }
  const item = serviceContext.findClass(classId);
  if (item.status === "CLOSED")
    throw new ConflictException("Lớp đã lưu trữ và chỉ cho phép đọc.");
  if (new Date() > new Date(item.endAt))
    throw new ConflictException(
      "Lớp đã kết thúc, không thể ghi danh thêm học viên.",
    );
  if (
    item.status === "ACTIVE" &&
    new Date() > new Date(item.startAt) &&
    !item.allowLateEnrollment
  )
    throw new ConflictException(
      "Lớp đã bắt đầu và không cho phép ghi danh muộn.",
    );
  if (item.learnerIds.includes(learnerId))
    throw new ConflictException("Học viên đã có trong lớp.");
  if (item.learnerIds.length >= item.capacity)
    throw new BadRequestException("Lớp đã đủ sĩ số.");
  item.learnerIds.push(learnerId);
  serviceContext.recordMemberHistory(
    classId,
    learnerId,
    "LEARNER",
    "ENROLLED",
    actorId,
    { source: "MANUAL" },
  );
  serviceContext.notifications.unshift({
    id: id("notification"),
    recipientId: learnerId,
    type: "CLASS_ENROLLED",
    title: `Bạn đã được ghi danh vào lớp ${item.code}`,
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

/** Ghi danh lần lượt danh sách userId và cô lập lỗi để trả kết quả trên từng học viên. */
export async function importEnrollments(
  serviceContext: LearningServiceContext,
  classId: string,
  userIds: string[],
  actorId = "usr-manager",
): Promise<EnrollmentImportResult[]> {
  const normalized = userIds.map((value) => value.trim()).filter(Boolean);
  const seen = new Set<string>();
  const results: EnrollmentImportResult[] = [];
  for (const identifier of normalized) {
    const key = identifier.toLowerCase();
    if (seen.has(key)) {
      results.push({
        userId: identifier,
        status: "SKIPPED",
        message: "Trùng trong danh sách nhập.",
      });
      continue;
    }
    seen.add(key);
    try {
      const prisma = serviceContext.database();
      const user = prisma
        ? await prisma.user.findFirst({
            where: {
              status: { in: ["ACTIVE", "PENDING"] },
              OR: [{ id: identifier }, { email: key }],
              roles: { some: { role: { code: "LEARNER" } } },
            },
            select: { id: true },
          })
        : null;
      const userId = user?.id ?? identifier;
      await serviceContext.enrollLearner(classId, userId, actorId);
      results.push({
        userId,
        status: "ENROLLED",
        message: "Ghi danh thành công.",
      });
    } catch (error) {
      results.push({
        userId: identifier,
        status: error instanceof ConflictException ? "SKIPPED" : "FAILED",
        message: error instanceof Error ? error.message : "Không thể ghi danh.",
      });
    }
  }
  return results;
}

/** Hủy ghi danh theo kiểu lưu lịch sử, thay vì xóa mất dấu vết thành viên. */
export async function removeEnrollment(
  serviceContext: LearningServiceContext,
  classId: string,
  learnerId: string,
  reason: string,
  actorId = "usr-manager",
): Promise<LearningClass> {
  const normalizedReason = reason.trim();
  if (normalizedReason.length < 5)
    throw new BadRequestException("Lý do gỡ học viên cần ít nhất 5 ký tự.");
  const prisma = serviceContext.database();
  if (prisma) {
    const enrollment = await prisma.classEnrollment.findUnique({
      where: { classId_learnerId: { classId, learnerId } },
    });
    if (!enrollment || enrollment.status !== "ACTIVE")
      throw new NotFoundException("Học viên không có ghi danh đang hoạt động.");
    await prisma.$transaction([
      prisma.classEnrollment.update({
        where: { classId_learnerId: { classId, learnerId } },
        data: {
          status: "CANCELLED",
          removalReason: normalizedReason,
          removedAt: new Date(),
        },
      }),
      prisma.classEnrollmentHistory.create({
        data: {
          id: id("enrollment-history"),
          classId,
          learnerId,
          action: "REMOVED",
          source: enrollment.source,
          reason: normalizedReason,
          actorId,
        },
      }),
      prisma.notification.upsert({
        where: { dedupKey: `enrollment-removed:${classId}:${learnerId}` },
        update: { readAt: null, createdAt: new Date() },
        create: {
          id: id("notification"),
          recipientId: learnerId,
          type: "CLASS_ENROLLMENT_REMOVED",
          title: "Trạng thái ghi danh lớp học đã thay đổi",
          entityType: "CLASS",
          entityId: classId,
          dedupKey: `enrollment-removed:${classId}:${learnerId}`,
        },
      }),
    ]);
    return serviceContext.getDatabaseClass(prisma, classId);
  }
  const item = serviceContext.findClass(classId);
  if (!item.learnerIds.includes(learnerId))
    throw new NotFoundException("Học viên không có ghi danh đang hoạt động.");
  item.learnerIds = item.learnerIds.filter((value) => value !== learnerId);
  serviceContext.recordMemberHistory(
    classId,
    learnerId,
    "LEARNER",
    "REMOVED",
    actorId,
    { source: "MANUAL", reason: normalizedReason },
  );
  return {
    ...item,
    instructorIds: [...item.instructorIds],
    learnerIds: [...item.learnerIds],
  };
}

/** Tổng hợp giảng viên, ghi danh đang/cũ và lịch sử thao tác thành roster chi tiết. */
export async function getClassRoster(
  serviceContext: LearningServiceContext,
  classId: string,
): Promise<ClassRoster> {
  const prisma = serviceContext.database();
  if (prisma) {
    const item = await prisma.learningClass.findUnique({
      where: { id: classId },
      include: {
        instructors: {
          orderBy: { assignedAt: "asc" },
          include: {
            instructor: { select: { displayName: true, email: true } },
          },
        },
        enrollments: {
          orderBy: { joinedAt: "asc" },
          include: {
            learner: { select: { displayName: true, email: true } },
          },
        },
        instructorHistory: { orderBy: { createdAt: "desc" } },
        enrollmentHistory: { orderBy: { createdAt: "desc" } },
      },
    });
    if (!item) throw new NotFoundException("Không tìm thấy lớp học.");
    return {
      classId,
      instructors: item.instructors.map((row) => ({
        instructorId: row.instructorId,
        displayName: row.instructor.displayName,
        email: row.instructor.email,
        role: row.role,
        assignedAt: row.assignedAt.toISOString(),
      })),
      enrollments: item.enrollments.map((row) => ({
        learnerId: row.learnerId,
        displayName: row.learner.displayName,
        email: row.learner.email,
        status: row.status === "ACTIVE" ? "ACTIVE" : "CANCELLED",
        source: row.source,
        joinedAt: row.joinedAt.toISOString(),
        removalReason: row.removalReason ?? undefined,
        removedAt: row.removedAt?.toISOString(),
      })),
      history: [
        ...item.instructorHistory.map((row) => ({
          id: row.id,
          memberId: row.instructorId,
          memberType: "INSTRUCTOR" as const,
          action: row.action,
          role: row.role,
          reason: row.reason ?? undefined,
          actorId: row.actorId,
          createdAt: row.createdAt.toISOString(),
        })),
        ...item.enrollmentHistory.map((row) => ({
          id: row.id,
          memberId: row.learnerId,
          memberType: "LEARNER" as const,
          action: row.action,
          source: row.source,
          reason: row.reason ?? undefined,
          actorId: row.actorId,
          createdAt: row.createdAt.toISOString(),
        })),
      ].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    };
  }
  const item = serviceContext.findClass(classId);
  return {
    classId,
    instructors: item.instructorIds.map((instructorId) => ({
      instructorId,
      role:
        serviceContext.instructorRoles.get(`${classId}:${instructorId}`) ??
        "CO_INSTRUCTOR",
      assignedAt: now(),
    })),
    enrollments: item.learnerIds.map((learnerId) => ({
      learnerId,
      status: "ACTIVE",
      source: "MANUAL",
      joinedAt: now(),
    })),
    history: serviceContext.classMemberHistory
      .filter((row) => row.id.startsWith(`${classId}:`))
      .map((row) => ({ ...row })),
  };
}
