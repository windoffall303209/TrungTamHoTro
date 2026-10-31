import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { AuthenticatedSession } from "../../../../auth/auth.service.js";
import type { Prisma } from "../../../../generated/prisma/client.js";
import {
  AssignmentChangeView,
  AssignmentView,
  RubricCriterion,
} from "../../academic/academic.shared.js";
import type { AcademicServiceContext } from "../../academic/academic.context.js";

/** Lọc bài tập theo lớp truy cập được và chỉ gắn bài nộp của chính học viên. */
export async function listAssignments(
  serviceContext: AcademicServiceContext,
  session: AuthenticatedSession,
  classId?: string,
): Promise<AssignmentView[]> {
  const classIds = await serviceContext.accessibleClassIds(session);
  if (classId && !classIds.includes(classId))
    throw new NotFoundException(
      "Không tìm thấy lớp học trong phạm vi truy cập.",
    );
  const rows = await serviceContext.prisma.assignment.findMany({
    where: {
      classId: classId ?? { in: classIds },
      ...(session.roleCode === "LEARNER"
        ? { status: { in: ["PUBLISHED", "CLOSED"] } }
        : {}),
    },
    include: {
      class: { select: { code: true } },
      submissions: {
        where: { learnerId: session.user.id },
        include: {
          learner: { select: { displayName: true, email: true } },
          attachments: { orderBy: { createdAt: "asc" } },
        },
      },
    },
    orderBy: { dueAt: "asc" },
  });
  return rows.map((row) =>
    serviceContext.mapAssignment(row, row.submissions[0]),
  );
}

/** Kiểm tra quyền dạy, đối chiếu tổng rubric và tạo bài tập ở trạng thái nháp. */
export async function createAssignment(
  serviceContext: AcademicServiceContext,
  classId: string,
  input: {
    title: string;
    description: string;
    instructions: string;
    dueAt: string;
    maxScore: number;
    rubric: Array<{ title: string; description: string; maxPoints: number }>;
  },
  session: AuthenticatedSession,
): Promise<AssignmentView> {
  await serviceContext.requireTeachingAccess(classId, session, true);
  const dueAt = new Date(input.dueAt);
  if (dueAt <= new Date())
    throw new BadRequestException("Hạn nộp phải nằm trong tương lai.");
  const classWindow = await serviceContext.prisma.learningClass.findUnique({
    where: { id: classId },
    select: { endAt: true },
  });
  if (!classWindow || dueAt > classWindow.endAt)
    throw new BadRequestException("Hạn nộp phải nằm trong thời gian của lớp.");
  const total = input.rubric.reduce((sum, item) => sum + item.maxPoints, 0);
  if (Math.abs(total - input.maxScore) > 0.001)
    throw new BadRequestException(
      "Tổng điểm rubric phải bằng điểm tối đa của bài tập.",
    );
  const rubric: RubricCriterion[] = input.rubric.map((item) => ({
    id: `criterion-${randomUUID()}`,
    title: item.title.trim(),
    description: item.description.trim(),
    maxPoints: item.maxPoints,
  }));
  const row = await serviceContext.prisma.assignment.create({
    data: {
      id: `assignment-${randomUUID()}`,
      classId,
      createdById: session.user.id,
      title: input.title.trim(),
      description: input.description.trim(),
      instructions: input.instructions.trim(),
      dueAt,
      maxScore: input.maxScore,
      rubric: rubric as unknown as Prisma.InputJsonValue,
    },
    include: {
      class: { select: { code: true } },
      submissions: {
        include: {
          learner: { select: { displayName: true, email: true } },
          attachments: true,
        },
      },
    },
  });
  return serviceContext.mapAssignment(row);
}

/** Sửa nội dung bài nháp bằng khóa phiên bản để không ghi đè thay đổi của người khác. */
export async function updateAssignment(
  serviceContext: AcademicServiceContext,
  assignmentId: string,
  input: {
    title: string;
    description: string;
    instructions: string;
    dueAt: string;
    maxScore: number;
    rubric: Array<{ title: string; description: string; maxPoints: number }>;
    expectedVersion: number;
  },
  session: AuthenticatedSession,
): Promise<AssignmentView> {
  const current = await serviceContext.prisma.assignment.findUnique({
    where: { id: assignmentId },
    include: { class: { select: { code: true, endAt: true } } },
  });
  if (!current) throw new NotFoundException("Không tìm thấy bài tập.");
  await serviceContext.requireTeachingAccess(current.classId, session, true);
  if (current.status !== "DRAFT")
    throw new ConflictException(
      "Chỉ bài tập nháp mới được sửa nội dung và rubric.",
    );
  const dueAt = new Date(input.dueAt);
  if (dueAt <= new Date() || dueAt > current.class.endAt)
    throw new BadRequestException(
      "Hạn nộp phải ở tương lai và nằm trong thời gian lớp.",
    );
  const total = input.rubric.reduce((sum, item) => sum + item.maxPoints, 0);
  if (Math.abs(total - input.maxScore) > 0.001)
    throw new BadRequestException(
      "Tổng điểm rubric phải bằng điểm tối đa của bài tập.",
    );
  const previousRubric = serviceContext.rubric(current.rubric);
  const rubric: RubricCriterion[] = input.rubric.map((item, index) => ({
    id: previousRubric[index]?.id ?? `criterion-${randomUUID()}`,
    title: item.title.trim(),
    description: item.description.trim(),
    maxPoints: item.maxPoints,
  }));
  return serviceContext.prisma.$transaction(async (transaction) => {
    const result = await transaction.assignment.updateMany({
      where: {
        id: assignmentId,
        status: "DRAFT",
        version: input.expectedVersion,
      },
      data: {
        title: input.title.trim(),
        description: input.description.trim(),
        instructions: input.instructions.trim(),
        dueAt,
        maxScore: input.maxScore,
        rubric: rubric as unknown as Prisma.InputJsonValue,
        version: { increment: 1 },
      },
    });
    if (result.count !== 1)
      throw new ConflictException(
        "Bài tập đã thay đổi ở nơi khác. Hãy tải lại trước khi lưu.",
      );
    const updated = await transaction.assignment.findUniqueOrThrow({
      where: { id: assignmentId },
      include: {
        class: { select: { code: true } },
        submissions: {
          include: {
            learner: { select: { displayName: true, email: true } },
            attachments: true,
          },
        },
      },
    });
    await transaction.assignmentChange.create({
      data: {
        id: `assignment-change-${randomUUID()}`,
        assignmentId,
        actorId: session.user.id,
        action: "DRAFT_UPDATED",
        fromVersion: current.version,
        toVersion: updated.version,
        snapshot: serviceContext.assignmentSnapshot(current),
      },
    });
    return serviceContext.mapAssignment(updated);
  });
}

/** Gia hạn bài đã công bố, ghi lịch sử và thông báo lại cho toàn bộ học viên đang học. */
export async function extendAssignment(
  serviceContext: AcademicServiceContext,
  assignmentId: string,
  dueAtValue: string,
  reason: string,
  expectedVersion: number,
  session: AuthenticatedSession,
): Promise<AssignmentView> {
  const current = await serviceContext.prisma.assignment.findUnique({
    where: { id: assignmentId },
    include: { class: { select: { code: true, endAt: true } } },
  });
  if (!current) throw new NotFoundException("Không tìm thấy bài tập.");
  await serviceContext.requireTeachingAccess(current.classId, session, true);
  if (current.status !== "PUBLISHED")
    throw new ConflictException("Chỉ bài tập đang mở mới được gia hạn.");
  const dueAt = new Date(dueAtValue);
  if (dueAt <= current.dueAt || dueAt > current.class.endAt)
    throw new BadRequestException(
      "Hạn mới phải muộn hơn hạn hiện tại và không vượt ngày kết thúc lớp.",
    );
  return serviceContext.prisma.$transaction(async (transaction) => {
    const result = await transaction.assignment.updateMany({
      where: {
        id: assignmentId,
        status: "PUBLISHED",
        version: expectedVersion,
      },
      data: { dueAt, version: { increment: 1 } },
    });
    if (result.count !== 1)
      throw new ConflictException(
        "Bài tập đã thay đổi ở nơi khác. Hãy tải lại trước khi gia hạn.",
      );
    const updated = await transaction.assignment.findUniqueOrThrow({
      where: { id: assignmentId },
      include: {
        class: { select: { code: true } },
        submissions: {
          include: {
            learner: { select: { displayName: true, email: true } },
            attachments: true,
          },
        },
      },
    });
    await transaction.assignmentChange.create({
      data: {
        id: `assignment-change-${randomUUID()}`,
        assignmentId,
        actorId: session.user.id,
        action: "DUE_DATE_EXTENDED",
        reason: reason.trim(),
        fromVersion: current.version,
        toVersion: updated.version,
        snapshot: serviceContext.assignmentSnapshot(current),
      },
    });
    const learners = await transaction.classEnrollment.findMany({
      where: { classId: current.classId, status: "ACTIVE" },
      select: { learnerId: true },
    });
    if (learners.length)
      await transaction.notification.createMany({
        data: learners.map(({ learnerId }) => ({
          id: `notification-${randomUUID()}`,
          recipientId: learnerId,
          type: "ASSIGNMENT_EXTENDED",
          title: `Gia hạn bài ${current.title} đến ${dueAt.toLocaleString("vi-VN")}`,
          entityType: "ASSIGNMENT",
          entityId: assignmentId,
          dedupKey: `assignment-extended:${assignmentId}:${updated.version}:${learnerId}`,
        })),
      });
    return serviceContext.mapAssignment(updated);
  });
}

/** Đóng bài sớm bằng cập nhật có điều kiện và bảo toàn lý do trong lịch sử. */
export async function closeAssignment(
  serviceContext: AcademicServiceContext,
  assignmentId: string,
  reason: string,
  expectedVersion: number,
  session: AuthenticatedSession,
): Promise<AssignmentView> {
  const current = await serviceContext.prisma.assignment.findUnique({
    where: { id: assignmentId },
  });
  if (!current) throw new NotFoundException("Không tìm thấy bài tập.");
  await serviceContext.requireTeachingAccess(current.classId, session, true);
  if (current.status !== "PUBLISHED")
    throw new ConflictException("Chỉ bài tập đang mở mới được đóng.");
  return serviceContext.prisma.$transaction(async (transaction) => {
    const closedAt = new Date();
    const result = await transaction.assignment.updateMany({
      where: {
        id: assignmentId,
        status: "PUBLISHED",
        version: expectedVersion,
      },
      data: {
        status: "CLOSED",
        closedAt,
        closedById: session.user.id,
        closeReason: reason.trim(),
        version: { increment: 1 },
      },
    });
    if (result.count !== 1)
      throw new ConflictException(
        "Bài tập đã thay đổi ở nơi khác. Hãy tải lại trước khi đóng.",
      );
    const updated = await transaction.assignment.findUniqueOrThrow({
      where: { id: assignmentId },
      include: {
        class: { select: { code: true } },
        submissions: {
          include: {
            learner: { select: { displayName: true, email: true } },
            attachments: true,
          },
        },
      },
    });
    await transaction.assignmentChange.create({
      data: {
        id: `assignment-change-${randomUUID()}`,
        assignmentId,
        actorId: session.user.id,
        action: "CLOSED",
        reason: reason.trim(),
        fromVersion: current.version,
        toVersion: updated.version,
        snapshot: serviceContext.assignmentSnapshot(current),
      },
    });
    return serviceContext.mapAssignment(updated);
  });
}

/** Trả lịch sử thay đổi bài tập cho người dạy có quyền trên lớp. */
export async function assignmentHistory(
  serviceContext: AcademicServiceContext,
  assignmentId: string,
  session: AuthenticatedSession,
): Promise<AssignmentChangeView[]> {
  const assignment = await serviceContext.prisma.assignment.findUnique({
    where: { id: assignmentId },
  });
  if (!assignment) throw new NotFoundException("Không tìm thấy bài tập.");
  await serviceContext.requireTeachingAccess(assignment.classId, session);
  const rows = await serviceContext.prisma.assignmentChange.findMany({
    where: { assignmentId },
    orderBy: { createdAt: "desc" },
  });
  return rows.map((row) => ({
    id: row.id,
    action: row.action,
    actorId: row.actorId,
    reason: row.reason ?? undefined,
    fromVersion: row.fromVersion,
    toVersion: row.toVersion,
    createdAt: row.createdAt.toISOString(),
  }));
}

/** Chuyển bài tập sang PUBLISHED sau khi xác nhận quyền phụ trách lớp. */
export async function publishAssignment(
  serviceContext: AcademicServiceContext,
  assignmentId: string,
  session: AuthenticatedSession,
): Promise<AssignmentView> {
  const current = await serviceContext.prisma.assignment.findUnique({
    where: { id: assignmentId },
  });
  if (!current) throw new NotFoundException("Không tìm thấy bài tập.");
  await serviceContext.requireTeachingAccess(current.classId, session, true);
  if (current.status !== "DRAFT")
    throw new ConflictException("Chỉ bài tập nháp mới có thể xuất bản.");
  const classWindow = await serviceContext.prisma.learningClass.findUnique({
    where: { id: current.classId },
    select: { startAt: true, endAt: true },
  });
  if (
    !classWindow ||
    current.dueAt <= new Date() ||
    current.dueAt > classWindow.endAt
  )
    throw new ConflictException(
      "Hạn nộp không còn hợp lệ để xuất bản bài tập.",
    );
  const row = await serviceContext.prisma.$transaction(async (transaction) => {
    const changed = await transaction.assignment.updateMany({
      where: { id: assignmentId, status: "DRAFT", version: current.version },
      data: { status: "PUBLISHED", version: { increment: 1 } },
    });
    if (changed.count !== 1)
      throw new ConflictException(
        "Bài tập đã thay đổi ở nơi khác. Hãy tải lại trước khi công bố.",
      );
    const updated = await transaction.assignment.findUniqueOrThrow({
      where: { id: assignmentId },
      include: {
        class: { select: { code: true } },
        submissions: {
          include: {
            learner: { select: { displayName: true, email: true } },
            attachments: true,
          },
        },
      },
    });
    await transaction.assignmentChange.create({
      data: {
        id: `assignment-change-${randomUUID()}`,
        assignmentId,
        actorId: session.user.id,
        action: "PUBLISHED",
        fromVersion: current.version,
        toVersion: updated.version,
        snapshot: serviceContext.assignmentSnapshot(current),
      },
    });
    const learners = await transaction.classEnrollment.findMany({
      where: { classId: current.classId, status: "ACTIVE" },
      select: { learnerId: true },
    });
    if (learners.length)
      await transaction.notification.createMany({
        data: learners.map(({ learnerId }) => ({
          id: `notification-${randomUUID()}`,
          recipientId: learnerId,
          type: "ASSIGNMENT_PUBLISHED",
          title: `Bài tập mới: ${current.title}`,
          entityType: "ASSIGNMENT",
          entityId: assignmentId,
          dedupKey: `assignment-published:${assignmentId}:${learnerId}`,
        })),
      });
    return updated;
  });
  return serviceContext.mapAssignment(row);
}
