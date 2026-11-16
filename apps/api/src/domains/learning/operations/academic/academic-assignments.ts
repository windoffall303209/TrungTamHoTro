import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { PaginatedResult } from "../../../../common/pagination.js";
import type { AuthenticatedSession } from "../../../../auth/auth.service.js";
import type { Prisma } from "../../../../generated/prisma/client.js";
import { AssignmentView, RubricCriterion } from "../../academic/academic.shared.js";
import type { AcademicServiceContext } from "../../academic/academic.context.js";

export interface AssignmentPageFilters {
  classId?: string;
  status?: "DRAFT" | "PUBLISHED" | "CLOSED";
  query?: string;
  page?: number;
  pageSize?: number;
}

/** Kiểm tra tệp đề trong giao dịch tạo hoặc cập nhật bài tập. */
async function checkSourceMaterial(
  transaction: Prisma.TransactionClient,
  materialId: string | null | undefined,
  classId: string,
): Promise<void> {
  if (!materialId) return;
  const material = await transaction.material.findFirst({
    where: { id: materialId, classId, scope: "CLASS", quarantinedAt: null },
  });
  if (!material)
    throw new ConflictException("Tệp đề bài không còn khả dụng. Hãy kiểm tra học liệu trước khi phát hành.");

}

/** Xây dựng bộ lọc Prisma kiểm tra quyền lớp và trạng thái hiển thị bài tập theo vai trò. */
function buildAssignmentWhere(
  session: AuthenticatedSession,
  classIds: readonly string[],
  filters: { classId?: string; status?: "DRAFT" | "PUBLISHED" | "CLOSED"; query?: string },
): Prisma.AssignmentWhereInput {
  const andConditions: Prisma.AssignmentWhereInput[] = [
    { classId: filters.classId ?? { in: [...classIds] } },
  ];
  if (session.roleCode === "LEARNER") {
    andConditions.push({ hidden: false, status: { in: ["PUBLISHED", "CLOSED"] } });
  }
  if (filters.status) {
    andConditions.push({ status: filters.status });
  }
  const query = filters.query?.trim();
  if (query) {
    andConditions.push({
      OR: [
        { title: { contains: query, mode: "insensitive" } },
        { description: { contains: query, mode: "insensitive" } },
      ],
    });
  }
  return { AND: andConditions };
}

/** Ẩn trường nội bộ hoặc tệp đề chưa phát hành khi trả bài tập cho học viên. */
function redactAssignmentForRole(
  serviceContext: AcademicServiceContext,
  row: Parameters<AcademicServiceContext["mapAssignment"]>[0] & {
    sourceMaterial?: { visibility: string } | null;
    submissions: Array<Parameters<AcademicServiceContext["mapAssignment"]>[1]>;
  },
  roleCode: string,
): AssignmentView {
  const view = serviceContext.mapAssignment(row, row.submissions[0]);
  if (roleCode === "INSTRUCTOR") return view;
  if (row.sourceMaterial?.visibility !== "PUBLISHED") delete view.sourceMaterial;
  if (row.hidden) {
    return {
      ...view,
      description: "",
      instructions: "",
      rubric: [],
      sourceMaterial: undefined,
      submission: undefined,
    };
  }
  return view;
}

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
    where: buildAssignmentWhere(session, classIds, { classId }),
    include: {
      class: { select: { code: true } },
      sourceMaterial: { select: { visibility: true, id: true, name: true, mimeType: true, sizeBytes: true } },
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
    redactAssignmentForRole(serviceContext, row, session.roleCode),
  );
}

/** Phân trang danh sách bài tập trực tiếp trên PostgreSQL theo phạm vi lớp truy cập được. */
export async function listAssignmentsPage(
  serviceContext: AcademicServiceContext,
  session: AuthenticatedSession,
  filters: AssignmentPageFilters = {},
): Promise<PaginatedResult<AssignmentView>> {
  const query = filters.query?.trim();
  const classId = filters.classId?.trim();
  if ((query && query.length > 255) || (classId && classId.length > 191)) {
    throw new BadRequestException("Search filters must not exceed 255 characters.");
  }
  const classIds = await serviceContext.accessibleClassIds(session);
  if (classId && !classIds.includes(classId)) {
    throw new NotFoundException("Không tìm thấy lớp học trong phạm vi truy cập.");
  }
  const page =
    Number.isSafeInteger(filters.page) &&
    (filters.page ?? 0) > 0 &&
    (filters.page ?? 0) <= 100_000
      ? (filters.page as number)
      : 1;
  const pageSize =
    Number.isInteger(filters.pageSize) && (filters.pageSize ?? 0) > 0
      ? Math.min(filters.pageSize as number, 100)
      : 10;
  const where = buildAssignmentWhere(session, classIds, {
    classId,
    status: filters.status,
    query,
  });
  const { rows, total, safePage, totalPages } =
    await serviceContext.prisma.$transaction(
      async (transaction) => {
        const total = await transaction.assignment.count({ where });
        const totalPages = Math.max(1, Math.ceil(total / pageSize));
        const safePage = Math.min(page, totalPages);
        const rows =
          total === 0
            ? []
            : await transaction.assignment.findMany({
                where,
                include: {
                  class: { select: { code: true } },
                  sourceMaterial: {
                    select: {
                      visibility: true,
                      id: true,
                      name: true,
                      mimeType: true,
                      sizeBytes: true,
                    },
                  },
                  submissions: {
                    where: { learnerId: session.user.id },
                    include: {
                      learner: { select: { displayName: true, email: true } },
                      attachments: { orderBy: { createdAt: "asc" } },
                    },
                  },
                },
                orderBy: [{ dueAt: "asc" }, { id: "asc" }],
                skip: (safePage - 1) * pageSize,
                take: pageSize,
              });
        return { rows, total, safePage, totalPages };
      },
      { isolationLevel: "RepeatableRead" },
    );
  return {
    items: rows.map((row) =>
      redactAssignmentForRole(serviceContext, row, session.roleCode),
    ),
    total,
    page: safePage,
    pageSize,
    totalPages,
  };
}

/** Kiểm tra quyền dạy, công bố tệp đính kèm và tạo bài tập đã phát hành. */
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
    hidden?: boolean;
    sourceMaterialId?: string;
  },
  session: AuthenticatedSession,
): Promise<AssignmentView> {
  await serviceContext.requireTeachingAccess(classId, session, true);
  if (input.sourceMaterialId) {
    const material = await serviceContext.prisma.material.findFirst({
      where: { id: input.sourceMaterialId, classId, ownerId: session.user.id, scope: "CLASS", quarantinedAt: null },
      select: { id: true },
    });
    if (!material) throw new BadRequestException("Tệp đính kèm không thuộc lớp hoặc không được phép sử dụng.");
  }
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
  const row = await serviceContext.prisma.$transaction(async (transaction) => {
    await checkSourceMaterial(transaction, input.sourceMaterialId, classId);
    return transaction.assignment.create({
      data: {
        id: `assignment-${randomUUID()}`,
        classId,
        createdById: session.user.id,
        sourceMaterialId: input.sourceMaterialId,
        hidden: input.hidden,
        title: input.title.trim(),
        description: input.description.trim(),
        instructions: input.instructions.trim(),
        dueAt,
        maxScore: input.maxScore,
        rubric: rubric as unknown as Prisma.InputJsonValue,
        status: "PUBLISHED",
      },
      include: {
        class: { select: { code: true } },
        sourceMaterial: { select: { id: true, name: true, mimeType: true, sizeBytes: true } },
        submissions: {
          include: {
            learner: { select: { displayName: true, email: true } },
            attachments: true,
          },
        },
      },
    });
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
    hidden?: boolean;
    sourceMaterialId?: string;
  },
  session: AuthenticatedSession,
): Promise<AssignmentView> {
  const current = await serviceContext.prisma.assignment.findUnique({
    where: { id: assignmentId },
    include: { class: { select: { code: true, endAt: true } } },
  });
  if (!current) throw new NotFoundException("Không tìm thấy bài tập.");
  await serviceContext.requireTeachingAccess(current.classId, session, true);
  if (input.sourceMaterialId) {
    const material = await serviceContext.prisma.material.findFirst({
      where: { id: input.sourceMaterialId, classId: current.classId, ownerId: session.user.id, scope: "CLASS", quarantinedAt: null },
      select: { id: true },
    });
    if (!material) throw new BadRequestException("Tệp đính kèm không thuộc lớp hoặc không được phép sử dụng.");
  }
  if (!["DRAFT", "PUBLISHED"].includes(current.status))
    throw new ConflictException("Bài tập đã đóng nên không thể sửa nội dung và rubric.");
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
  const previousRubric = serviceContext.rubric(current.rubric, Number(current.maxScore));
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
        status: { in: ["DRAFT", "PUBLISHED"] },
        version: input.expectedVersion,
      },
      data: {
        hidden: input.hidden,
        title: input.title.trim(),
        description: input.description.trim(),
        instructions: input.instructions.trim(),
        dueAt,
        maxScore: input.maxScore,
        rubric: rubric as unknown as Prisma.InputJsonValue,
        ...(input.sourceMaterialId !== undefined ? { sourceMaterialId: input.sourceMaterialId || null } : {}),
        version: { increment: 1 },
      },
    });
    if (result.count !== 1)
      throw new ConflictException(
        "Bài tập đã thay đổi ở nơi khác. Hãy tải lại trước khi lưu.",
      );
    if (input.hidden) await transaction.notification.deleteMany({ where: { entityType: "ASSIGNMENT", entityId: assignmentId } });
    const updated = await transaction.assignment.findUniqueOrThrow({
      where: { id: assignmentId },
      include: {
        class: { select: { code: true } },
        sourceMaterial: { select: { id: true, name: true, mimeType: true, sizeBytes: true } },
        submissions: {
          include: {
            learner: { select: { displayName: true, email: true } },
            attachments: true,
          },
        },
      },
    });
    return serviceContext.mapAssignment(updated);
  });
}

/** Gia hạn bài đã công bố, ghi lý do và thông báo cho toàn bộ học viên đang học. */
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
    await transaction.auditLog.create({
      data: {
        actorId: session.user.id, action: "ASSIGNMENT_EXTENDED", entityType: "assignment", entityId: assignmentId,
        context: { reason, dueAt: dueAt.toISOString() },
      },
    });
    const learners = await transaction.classEnrollment.findMany({
      where: { classId: current.classId, status: "ACTIVE" },
      select: { learnerId: true },
    });
    if (!updated.hidden && learners.length)
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

/** Đóng bài sớm bằng cập nhật có điều kiện và lưu lý do đóng. */
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
    return serviceContext.mapAssignment(updated);
  });
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
  if (current.status === "CLOSED")
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
    await checkSourceMaterial(transaction, current.sourceMaterialId, current.classId);
    const changed = await transaction.assignment.updateMany({
      where: { id: assignmentId, status: { in: ["DRAFT", "PUBLISHED"] }, version: current.version },
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
        sourceMaterial: { select: { id: true, name: true, mimeType: true, sizeBytes: true } },
        submissions: {
          include: {
            learner: { select: { displayName: true, email: true } },
            attachments: true,
          },
        },
      },
    });
    const learners = await transaction.classEnrollment.findMany({
      where: { classId: current.classId, status: "ACTIVE" },
      select: { learnerId: true },
    });
    if (!updated.hidden && learners.length)
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
