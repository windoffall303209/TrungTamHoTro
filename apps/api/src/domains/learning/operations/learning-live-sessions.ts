import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from "@nestjs/common";
import { id, now } from "../learning.shared.js";
import type { AttendanceRecord, LiveSession } from "../learning.types.js";
import type { LearningServiceContext } from "../learning.context.js";

/** Liệt kê buổi trực tuyến theo quan hệ lớp và trạng thái truy cập của vai trò. */
export async function listSessions(
  serviceContext: LearningServiceContext,
  role = "LEARNER",
  actorId = serviceContext.userIdForRole(role),
): Promise<LiveSession[]> {
  const prisma = serviceContext.database();
  if (prisma) {
    const rows = await prisma.liveSession.findMany({
      where:
        role === "LEARNER"
          ? {
              class: {
                enrollments: {
                  some: { learnerId: actorId, status: "ACTIVE" },
                },
              },
            }
          : role === "INSTRUCTOR"
            ? { class: { instructors: { some: { instructorId: actorId } } } }
            : undefined,
      orderBy: { startsAt: "desc" },
    });
    return rows.map((row) =>
      role === "LEARNER"
        ? {
            ...serviceContext.mapSession(row),
            hostUrl: "",
            recordingUrl: undefined,
          }
        : serviceContext.mapSession(row),
    );
  }
  return serviceContext.sessions
    .filter((item) => {
      const classItem = serviceContext.classes.find(
        (candidate) => candidate.id === item.classId,
      );
      if (role === "LEARNER") return classItem?.learnerIds.includes(actorId);
      if (role === "INSTRUCTOR")
        return classItem?.instructorIds.includes(actorId);
      return true;
    })
    .map((item) =>
      role === "LEARNER"
        ? { ...item, hostUrl: "", recordingUrl: undefined }
        : { ...item },
    );
}

/** Validate lịch/quyền lớp, cấp phòng từ provider có fallback rồi thông báo thành viên. */
export async function createSession(
  serviceContext: LearningServiceContext,
  classId: string,
  input: Pick<LiveSession, "title" | "startsAt" | "endsAt" | "provider">,
  actorId = "usr-instructor",
  actorRole = "INSTRUCTOR",
): Promise<LiveSession> {
  if (new Date(input.endsAt) <= new Date(input.startsAt))
    throw new BadRequestException(
      "Thời gian kết thúc phải sau thời gian bắt đầu.",
    );
  const prisma = serviceContext.database();
  if (prisma) {
    const classItem = await prisma.learningClass.findUnique({
      where: { id: classId },
      include: { instructors: true },
    });
    if (!classItem) throw new NotFoundException("Không tìm thấy lớp học.");
    if (classItem.status === "CLOSED")
      throw new ConflictException("Lớp đã lưu trữ và chỉ cho phép đọc.");
    const hostId =
      actorRole === "CENTER_MANAGER"
        ? (classItem.instructors.find((row) => row.role === "PRIMARY")
            ?.instructorId ?? classItem.instructors[0]?.instructorId)
        : actorId;
    if (
      !hostId ||
      !classItem.instructors.some((item) => item.instructorId === hostId)
    )
      throw new NotFoundException("Lớp chưa có giảng viên phù hợp để chủ trì.");
    if (new Date(input.startsAt) < new Date())
      throw new BadRequestException(
        "Không thể lên lịch buổi học trong quá khứ.",
      );
    if (
      new Date(input.startsAt) < classItem.startAt ||
      new Date(input.endsAt) > classItem.endAt
    )
      throw new BadRequestException(
        "Buổi học phải nằm trong thời gian của lớp.",
      );
    const overlaps = await prisma.liveSession.count({
      where: {
        OR: [{ classId }, { hostId }],
        status: { not: "CANCELLED" },
        startsAt: { lt: new Date(input.endsAt) },
        endsAt: { gt: new Date(input.startsAt) },
      },
    });
    if (overlaps) throw new ConflictException("Lịch học bị trùng.");
    const provisioned = await serviceContext.provisionProviderMeeting(
      input.provider,
    );
    const created = await prisma.liveSession.create({
      data: {
        id: id("session"),
        classId,
        hostId,
        title: input.title.trim(),
        startsAt: new Date(input.startsAt),
        endsAt: new Date(input.endsAt),
        provider: provisioned.provider,
        requestedProvider: input.provider,
        fallbackUsed: provisioned.fallbackUsed,
        provisioningAttempts: provisioned.attempts,
        timezone: classItem.timezone,
        hostUrl: provisioned.hostUrl,
        attendeeUrl: provisioned.attendeeUrl,
      },
    });
    await serviceContext.notifyClassMembers(
      prisma,
      classId,
      "LIVE_SESSION_SCHEDULED",
      `Đã lên lịch: ${created.title}`,
      created.id,
      "CLASS_REMINDER",
      {
        className: classItem.code,
        sessionTitle: created.title,
        startsAt: created.startsAt.toISOString(),
      },
    );
    await prisma.auditLog.create({
      data: {
        actorId,
        action: "LIVE_SESSION_SCHEDULED",
        entityType: "live_session",
        entityId: created.id,
        context: {
          classId,
          startsAt: input.startsAt,
          endsAt: input.endsAt,
          timezone: classItem.timezone,
          requestedProvider: input.provider,
          provider: provisioned.provider,
          fallbackUsed: provisioned.fallbackUsed,
          provisioningAttempts: provisioned.attempts,
        },
      },
    });
    return serviceContext.mapSession(created);
  }
  const classItem = serviceContext.findClass(classId);
  if (classItem.status === "CLOSED")
    throw new ConflictException("Lớp đã lưu trữ và chỉ cho phép đọc.");
  const hostId =
    actorRole === "CENTER_MANAGER" ? classItem.instructorIds[0] : actorId;
  if (!hostId || !classItem.instructorIds.includes(hostId))
    throw new NotFoundException("Lớp chưa có giảng viên phù hợp để chủ trì.");
  if (new Date(input.startsAt) < new Date())
    throw new BadRequestException("Không thể lên lịch buổi học trong quá khứ.");
  if (
    new Date(input.startsAt) < new Date(classItem.startAt) ||
    new Date(input.endsAt) > new Date(classItem.endAt)
  )
    throw new BadRequestException("Buổi học phải nằm trong thời gian của lớp.");
  const overlaps = serviceContext.sessions.some(
    (item) =>
      item.classId === classId &&
      item.status !== "CANCELLED" &&
      new Date(input.startsAt) < new Date(item.endsAt) &&
      new Date(input.endsAt) > new Date(item.startsAt),
  );
  if (overlaps) throw new ConflictException("Lịch học bị trùng.");
  const provisioned = await serviceContext.provisionProviderMeeting(
    input.provider,
  );
  const item: LiveSession = {
    ...input,
    provider: provisioned.provider,
    requestedProvider: input.provider,
    fallbackUsed: provisioned.fallbackUsed,
    provisioningAttempts: provisioned.attempts,
    id: id("session"),
    classId,
    hostId,
    status: "SCHEDULED",
    timezone: classItem.timezone,
    hostUrl: provisioned.hostUrl,
    attendeeUrl: provisioned.attendeeUrl,
  };
  serviceContext.sessions.unshift(item);
  return { ...item };
}

/** Cập nhật lịch/provider trước khi buổi học diễn ra và lưu lý do audit. */
export async function updateSession(
  serviceContext: LearningServiceContext,
  sessionId: string,
  input: Pick<LiveSession, "title" | "startsAt" | "endsAt" | "provider"> & {
    reason: string;
  },
  actorId = "usr-manager",
): Promise<LiveSession> {
  const reason = input.reason.trim();
  if (reason.length < 5)
    throw new BadRequestException("Lý do đổi lịch cần ít nhất 5 ký tự.");
  const startsAt = new Date(input.startsAt);
  const endsAt = new Date(input.endsAt);
  if (endsAt <= startsAt)
    throw new BadRequestException(
      "Thời gian kết thúc phải sau thời gian bắt đầu.",
    );
  if (startsAt < new Date())
    throw new BadRequestException("Không thể chuyển buổi học vào quá khứ.");
  const prisma = serviceContext.database();
  if (prisma) {
    const current = await prisma.liveSession.findUnique({
      where: { id: sessionId },
    });
    if (!current) throw new NotFoundException("Không tìm thấy buổi học.");
    if (current.status !== "SCHEDULED" || current.startsAt <= new Date())
      throw new ConflictException("Chỉ được sửa buổi học sắp diễn ra.");
    const overlap = await prisma.liveSession.count({
      where: {
        id: { not: sessionId },
        OR: [{ classId: current.classId }, { hostId: current.hostId }],
        status: { not: "CANCELLED" },
        startsAt: { lt: endsAt },
        endsAt: { gt: startsAt },
      },
    });
    if (overlap)
      throw new ConflictException(
        "Lịch mới bị trùng lớp hoặc trùng lịch giảng viên.",
      );
    const provisioned = await serviceContext.provisionProviderMeeting(
      input.provider,
    );
    const updated = await prisma.liveSession.update({
      where: { id: sessionId },
      data: {
        title: input.title.trim(),
        startsAt,
        endsAt,
        provider: provisioned.provider,
        requestedProvider: input.provider,
        fallbackUsed: provisioned.fallbackUsed,
        provisioningAttempts: provisioned.attempts,
        changeReason: reason,
        hostUrl: provisioned.hostUrl,
        attendeeUrl: provisioned.attendeeUrl,
      },
    });
    await serviceContext.notifyClassMembers(
      prisma,
      current.classId,
      "LIVE_SESSION_CHANGED",
      `Lịch học đã thay đổi: ${updated.title}`,
      sessionId,
    );
    await prisma.auditLog.create({
      data: {
        actorId,
        action: "LIVE_SESSION_CHANGED",
        entityType: "live_session",
        entityId: sessionId,
        context: {
          reason,
          previousStartsAt: current.startsAt,
          startsAt,
          endsAt,
          provider: input.provider,
        },
      },
    });
    return serviceContext.mapSession(updated);
  }
  const item = serviceContext.findSession(sessionId);
  if (item.status !== "SCHEDULED" || new Date(item.startsAt) <= new Date())
    throw new ConflictException("Chỉ được sửa buổi học sắp diễn ra.");
  const overlap = serviceContext.sessions.some(
    (row) =>
      row.id !== sessionId &&
      row.classId === item.classId &&
      row.status !== "CANCELLED" &&
      startsAt < new Date(row.endsAt) &&
      endsAt > new Date(row.startsAt),
  );
  if (overlap)
    throw new ConflictException(
      "Lịch mới bị trùng lớp hoặc trùng lịch giảng viên.",
    );
  const provisioned = await serviceContext.provisionProviderMeeting(
    input.provider,
  );
  Object.assign(item, input, {
    provider: provisioned.provider,
    requestedProvider: input.provider,
    fallbackUsed: provisioned.fallbackUsed,
    provisioningAttempts: provisioned.attempts,
    changeReason: reason,
    hostUrl: provisioned.hostUrl,
    attendeeUrl: provisioned.attendeeUrl,
  });
  return { ...item };
}

/** Hủy buổi chưa hoàn tất, ghi lý do và gửi thông báo tới lớp. */
export async function cancelSession(
  serviceContext: LearningServiceContext,
  sessionId: string,
  reason: string,
  actorId = "usr-manager",
): Promise<LiveSession> {
  const normalized = reason.trim();
  if (normalized.length < 5)
    throw new BadRequestException("Lý do hủy cần ít nhất 5 ký tự.");
  const prisma = serviceContext.database();
  if (prisma) {
    const current = await prisma.liveSession.findUnique({
      where: { id: sessionId },
    });
    if (!current) throw new NotFoundException("Không tìm thấy buổi học.");
    if (current.status !== "SCHEDULED" || current.startsAt <= new Date())
      throw new ConflictException("Chỉ được hủy buổi học chưa diễn ra.");
    const updated = await prisma.liveSession.update({
      where: { id: sessionId },
      data: { status: "CANCELLED", cancellationReason: normalized },
    });
    await serviceContext.notifyClassMembers(
      prisma,
      current.classId,
      "LIVE_SESSION_CANCELLED",
      `Buổi học đã hủy: ${current.title}`,
      sessionId,
    );
    await prisma.auditLog.create({
      data: {
        actorId,
        action: "LIVE_SESSION_CANCELLED",
        entityType: "live_session",
        entityId: sessionId,
        context: { reason: normalized, startsAt: current.startsAt },
      },
    });
    return serviceContext.mapSession(updated);
  }
  const item = serviceContext.findSession(sessionId);
  if (item.status !== "SCHEDULED" || new Date(item.startsAt) <= new Date())
    throw new ConflictException("Chỉ được hủy buổi học chưa diễn ra.");
  item.status = "CANCELLED";
  item.cancellationReason = normalized;
  return { ...item };
}

/** Kiểm soát chuyển trạng thái buổi học và cập nhật mốc vận hành liên quan. */
export async function transitionSession(
  serviceContext: LearningServiceContext,
  sessionId: string,
  status: LiveSession["status"],
  actorId = "usr-instructor",
): Promise<LiveSession> {
  const allowed: Record<LiveSession["status"], LiveSession["status"][]> = {
    SCHEDULED: ["LIVE"],
    LIVE: ["COMPLETED"],
    COMPLETED: [],
    CANCELLED: [],
  };
  const prisma = serviceContext.database();
  if (prisma) {
    const item = await prisma.liveSession.findUnique({
      where: { id: sessionId },
    });
    if (!item || item.hostId !== actorId)
      throw new NotFoundException(
        "Không tìm thấy buổi học được phép điều khiển.",
      );
    if (!allowed[item.status].includes(status))
      throw new BadRequestException(
        `Không thể chuyển ${item.status} → ${status}.`,
      );
    return serviceContext.mapSession(
      await prisma.liveSession.update({
        where: { id: sessionId },
        data: { status },
      }),
    );
  }
  const item = serviceContext.findSession(sessionId);
  if (item.hostId !== actorId)
    throw new NotFoundException(
      "Không tìm thấy buổi học được phép điều khiển.",
    );
  if (!allowed[item.status].includes(status))
    throw new BadRequestException(
      `Không thể chuyển ${item.status} → ${status}.`,
    );
  item.status = status;
  return { ...item };
}

/** Xác minh ghi danh/cửa sổ tham dự, mở bản ghi attendance và trả URL người học. */
export async function joinSession(
  serviceContext: LearningServiceContext,
  sessionId: string,
  learnerId = "usr-learner",
): Promise<{ attendeeUrl: string; joinedAt: string }> {
  const prisma = serviceContext.database();
  if (prisma) {
    const session = await prisma.liveSession.findUnique({
      where: { id: sessionId },
    });
    if (!session) throw new NotFoundException("Không tìm thấy buổi học.");
    const enrollment = await prisma.classEnrollment.findFirst({
      where: { classId: session.classId, learnerId, status: "ACTIVE" },
    });
    if (!enrollment) throw new BadRequestException("Học viên không thuộc lớp.");
    if (["CANCELLED", "COMPLETED"].includes(session.status))
      throw new BadRequestException("Buổi học không còn cho phép tham gia.");
    const joinedAt = new Date();
    if (joinedAt < new Date(session.startsAt.getTime() - 15 * 60_000))
      throw new BadRequestException("Chỉ có thể vào lớp sớm tối đa 15 phút.");
    if (joinedAt > new Date(session.endsAt.getTime() + 30 * 60_000))
      throw new BadRequestException("Đã hết thời gian tham gia buổi học.");
    await prisma.$transaction(async (transaction) => {
      const existingAttendance = await transaction.attendanceRecord.findUnique({
        where: { sessionId_learnerId: { sessionId, learnerId } },
        select: { joinedAt: true },
      });
      await transaction.attendanceRecord.upsert({
        where: { sessionId_learnerId: { sessionId, learnerId } },
        update: {
          joinedAt: existingAttendance?.joinedAt ?? joinedAt,
          status: "PRESENT",
        },
        create: { sessionId, learnerId, joinedAt, status: "PRESENT" },
      });
      const openInterval = await transaction.attendanceInterval.findFirst({
        where: { sessionId, learnerId, source: "APP", leftAt: null },
      });
      if (!openInterval)
        await transaction.attendanceInterval.create({
          data: {
            id: id("attendance-interval"),
            sessionId,
            learnerId,
            joinedAt,
            source: "APP",
          },
        });
    });
    return {
      attendeeUrl: session.attendeeUrl,
      joinedAt: joinedAt.toISOString(),
    };
  }
  const item = serviceContext.findSession(sessionId);
  const classItem = serviceContext.findClass(item.classId);
  if (!classItem.learnerIds.includes(learnerId))
    throw new BadRequestException("Học viên không thuộc lớp.");
  if (item.status === "CANCELLED" || item.status === "COMPLETED")
    throw new BadRequestException("Buổi học không còn cho phép tham gia.");
  const timestamp = new Date();
  if (timestamp < new Date(new Date(item.startsAt).getTime() - 15 * 60_000))
    throw new BadRequestException("Chỉ có thể vào lớp sớm tối đa 15 phút.");
  if (timestamp > new Date(new Date(item.endsAt).getTime() + 30 * 60_000))
    throw new BadRequestException("Đã hết thời gian tham gia buổi học.");
  const joinedAt = now();
  const existing = serviceContext.attendance.find(
    (record) =>
      record.sessionId === sessionId && record.learnerId === learnerId,
  );
  if (existing) existing.joinedAt = existing.joinedAt ?? joinedAt;
  else
    serviceContext.attendance.push({
      sessionId,
      learnerId,
      joinedAt,
      attendedMinutes: 0,
      status: "PRESENT",
    });
  if (
    !serviceContext.attendanceIntervals.some(
      (interval) =>
        interval.sessionId === sessionId &&
        interval.learnerId === learnerId &&
        interval.source === "APP" &&
        !interval.leftAt,
    )
  )
    serviceContext.attendanceIntervals.push({
      sessionId,
      learnerId,
      joinedAt,
      source: "APP",
    });
  return { attendeeUrl: item.attendeeUrl, joinedAt };
}

/** Đóng lần tham dự và tính phút có mặt trong giới hạn thời gian buổi học. */
export async function leaveSession(
  serviceContext: LearningServiceContext,
  sessionId: string,
  learnerId = "usr-learner",
): Promise<AttendanceRecord> {
  const prisma = serviceContext.database();
  if (prisma) {
    return prisma.$transaction(async (transaction) => {
      const session = await transaction.liveSession.findUnique({
        where: { id: sessionId },
      });
      if (!session) throw new NotFoundException("Không tìm thấy buổi học.");
      const openInterval = await transaction.attendanceInterval.findFirst({
        where: { sessionId, learnerId, source: "APP", leftAt: null },
        orderBy: { joinedAt: "desc" },
      });
      if (!openInterval)
        throw new BadRequestException(
          "Chưa có lượt tham gia đang mở để kết thúc.",
        );
      const leftAt = new Date();
      await transaction.attendanceInterval.update({
        where: { id: openInterval.id },
        data: { leftAt },
      });
      const intervals = await transaction.attendanceInterval.findMany({
        where: { sessionId, learnerId, leftAt: { not: null } },
        orderBy: { joinedAt: "asc" },
      });
      const attendedMinutes = serviceContext.mergedAttendanceMinutes(
        intervals.map((item) => ({
          joinedAt: item.joinedAt,
          leftAt: item.leftAt!,
        })),
        session.startsAt,
        session.endsAt,
      );
      const firstJoinedAt = intervals.reduce<Date | undefined>(
        (earliest, item) =>
          !earliest || item.joinedAt < earliest ? item.joinedAt : earliest,
        undefined,
      );
      return serviceContext.mapAttendance(
        await transaction.attendanceRecord.update({
          where: { sessionId_learnerId: { sessionId, learnerId } },
          data: {
            joinedAt: firstJoinedAt,
            leftAt,
            attendedMinutes,
            status: serviceContext.deriveProviderAttendanceStatus(
              firstJoinedAt ?? openInterval.joinedAt,
              attendedMinutes,
              session.startsAt,
            ),
          },
        }),
      );
    });
  }
  const attendance = serviceContext.attendance.find(
    (item) => item.sessionId === sessionId && item.learnerId === learnerId,
  );
  const openInterval = serviceContext.attendanceIntervals.findLast(
    (item) =>
      item.sessionId === sessionId &&
      item.learnerId === learnerId &&
      item.source === "APP" &&
      !item.leftAt,
  );
  if (!attendance?.joinedAt || !openInterval)
    throw new BadRequestException("Chưa có lượt tham gia đang mở để kết thúc.");
  openInterval.leftAt = now();
  attendance.leftAt = openInterval.leftAt;
  const session = serviceContext.findSession(sessionId);
  attendance.attendedMinutes = serviceContext.mergedAttendanceMinutes(
    serviceContext.attendanceIntervals
      .filter(
        (item) =>
          item.sessionId === sessionId &&
          item.learnerId === learnerId &&
          item.leftAt,
      )
      .map((item) => ({
        joinedAt: new Date(item.joinedAt),
        leftAt: new Date(item.leftAt!),
      })),
    new Date(session.startsAt),
    new Date(session.endsAt),
  );
  return { ...attendance };
}
