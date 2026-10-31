import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "../../../../generated/prisma/client.js";
import { id, now } from "../../core/learning.shared.js";
import type {
  AttendanceAppeal,
  AttendanceRecord,
  AttendanceSessionReview,
  LiveSession,
  ProviderAttendanceInput,
} from "../../core/learning.types.js";
import type { LearningServiceContext } from "../../core/learning.context.js";

/** Điều chỉnh điểm danh thủ công sau validation và ghi lịch sử trước/sau. */
export async function updateAttendance(
  serviceContext: LearningServiceContext,
  sessionId: string,
  learnerId: string,
  status: AttendanceRecord["status"],
  attendedMinutes: number,
  adjustmentReason: string,
  actorId = "usr-instructor",
): Promise<AttendanceRecord> {
  const normalizedReason = adjustmentReason.trim();
  if (normalizedReason.length < 3)
    throw new BadRequestException("Lý do điều chỉnh cần ít nhất 3 ký tự.");
  const prisma = serviceContext.database();
  if (prisma) {
    const session = await prisma.liveSession.findUnique({
      where: { id: sessionId },
    });
    if (!session || session.hostId !== actorId)
      throw new NotFoundException(
        "Không tìm thấy buổi học được phép điểm danh.",
      );
    if (session.status !== "COMPLETED")
      throw new ConflictException(
        "Chỉ điều chỉnh điểm danh sau khi buổi học kết thúc.",
      );
    if (session.attendanceLockedAt)
      throw new ConflictException("Kỳ điểm danh đã khóa.");
    serviceContext.validateAttendanceMinutes(
      attendedMinutes,
      session.startsAt,
      session.endsAt,
    );
    const enrollment = await prisma.classEnrollment.findFirst({
      where: { classId: session.classId, learnerId, status: "ACTIVE" },
    });
    if (!enrollment) throw new BadRequestException("Học viên không thuộc lớp.");
    const row = await prisma.attendanceRecord.upsert({
      where: { sessionId_learnerId: { sessionId, learnerId } },
      update: { status, attendedMinutes, adjustmentReason: normalizedReason },
      create: {
        sessionId,
        learnerId,
        status,
        attendedMinutes,
        adjustmentReason: normalizedReason,
      },
    });
    return serviceContext.mapAttendance(row);
  }
  const session = serviceContext.findSession(sessionId);
  if (session.hostId !== actorId)
    throw new NotFoundException("Không tìm thấy buổi học được phép điểm danh.");
  if (session.status !== "COMPLETED")
    throw new ConflictException(
      "Chỉ điều chỉnh điểm danh sau khi buổi học kết thúc.",
    );
  if (session.attendanceLockedAt)
    throw new ConflictException("Kỳ điểm danh đã khóa.");
  serviceContext.validateAttendanceMinutes(
    attendedMinutes,
    new Date(session.startsAt),
    new Date(session.endsAt),
  );
  if (!serviceContext.findClass(session.classId).learnerIds.includes(learnerId))
    throw new BadRequestException("Học viên không thuộc lớp.");
  let record = serviceContext.attendance.find(
    (item) => item.sessionId === sessionId && item.learnerId === learnerId,
  );
  if (!record) {
    record = {
      sessionId,
      learnerId,
      attendedMinutes,
      status,
      adjustmentReason: normalizedReason,
    };
    serviceContext.attendance.push(record);
  } else
    Object.assign(record, {
      status,
      attendedMinutes,
      adjustmentReason: normalizedReason,
    });
  return { ...record };
}

/** Tổng hợp bản ghi điểm danh, lần đồng bộ và khiếu nại của buổi học. */
export async function getAttendanceReview(
  serviceContext: LearningServiceContext,
  sessionId: string,
): Promise<AttendanceSessionReview> {
  const prisma = serviceContext.database();
  if (prisma) {
    const session = await prisma.liveSession.findUnique({
      where: { id: sessionId },
      include: {
        class: { include: { enrollments: { where: { status: "ACTIVE" } } } },
        attendance: { orderBy: { learnerId: "asc" } },
        appeals: { orderBy: { createdAt: "desc" } },
      },
    });
    if (!session) throw new NotFoundException("Không tìm thấy buổi học.");
    return {
      session: serviceContext.mapSession(session),
      enrolledLearnerIds: session.class.enrollments.map(
        (item) => item.learnerId,
      ),
      records: session.attendance.map((item) =>
        serviceContext.mapAttendance(item),
      ),
      appeals: session.appeals.map((item) =>
        serviceContext.mapAttendanceAppeal(item),
      ),
    };
  }
  const session = serviceContext.findSession(sessionId);
  return {
    session: { ...session },
    enrolledLearnerIds: [
      ...serviceContext.findClass(session.classId).learnerIds,
    ],
    records: serviceContext.attendance
      .filter((item) => item.sessionId === sessionId)
      .map((item) => ({
        ...item,
        providerSnapshot: item.providerSnapshot
          ? { ...item.providerSnapshot }
          : undefined,
      })),
    appeals: serviceContext.attendanceAppeals
      .filter((item) => item.sessionId === sessionId)
      .map((item) => ({ ...item })),
  };
}

/** Chuẩn hóa dữ liệu provider, bỏ user ngoài lớp và upsert attendance trong transaction. */
export async function syncAttendance(
  serviceContext: LearningServiceContext,
  sessionId: string,
  inputRecords: ProviderAttendanceInput[],
  actorId = "usr-manager",
): Promise<{ review: AttendanceSessionReview; skippedLearnerIds: string[] }> {
  serviceContext.validateProviderAttendanceInput(inputRecords);
  const prisma = serviceContext.database();
  if (prisma) {
    const skippedLearnerIds = await prisma.$transaction(async (transaction) => {
      const session = await transaction.liveSession.findUnique({
        where: { id: sessionId },
        include: {
          class: {
            include: { enrollments: { where: { status: "ACTIVE" } } },
          },
        },
      });
      if (!session) throw new NotFoundException("Không tìm thấy buổi học.");
      if (session.status !== "COMPLETED")
        throw new ConflictException(
          "Chỉ đồng bộ điểm danh sau khi buổi học kết thúc.",
        );
      if (session.attendanceLockedAt)
        throw new ConflictException("Kỳ điểm danh đã khóa.");
      const enrolledIds = new Set(
        session.class.enrollments.map((item) => item.learnerId),
      );
      const validRecords = inputRecords.filter((item) =>
        enrolledIds.has(item.learnerId),
      );
      const skipped = inputRecords
        .filter((item) => !enrolledIds.has(item.learnerId))
        .map((item) => item.learnerId);
      await transaction.attendanceInterval.deleteMany({
        where: { sessionId, source: "PROVIDER" },
      });
      const byLearner = new Map<string, ProviderAttendanceInput[]>();
      for (const item of validRecords)
        byLearner.set(item.learnerId, [
          ...(byLearner.get(item.learnerId) ?? []),
          item,
        ]);
      for (const [learnerId, records] of byLearner) {
        const intervals = records.map((item) => ({
          joinedAt: new Date(item.joinedAt),
          leftAt: new Date(item.leftAt),
        }));
        for (const interval of intervals)
          serviceContext.calculateProviderAttendanceMinutes(
            interval.joinedAt,
            interval.leftAt,
            session.startsAt,
            session.endsAt,
          );
        const attendedMinutes = serviceContext.mergedAttendanceMinutes(
          intervals,
          session.startsAt,
          session.endsAt,
        );
        const joinedAt = intervals.reduce(
          (earliest, item) =>
            item.joinedAt < earliest ? item.joinedAt : earliest,
          intervals[0]!.joinedAt,
        );
        const leftAt = intervals.reduce(
          (latest, item) => (item.leftAt > latest ? item.leftAt : latest),
          intervals[0]!.leftAt,
        );
        const status = serviceContext.deriveProviderAttendanceStatus(
          joinedAt,
          attendedMinutes,
          session.startsAt,
        );
        const providerSnapshot = {
          intervals: records.map((item) => ({ ...item })),
        } as unknown as Prisma.InputJsonValue;
        await transaction.attendanceRecord.upsert({
          where: { sessionId_learnerId: { sessionId, learnerId } },
          update: {
            joinedAt,
            leftAt,
            attendedMinutes,
            status,
            providerParticipantId: records[0]!.providerParticipantId,
            providerSnapshot,
          },
          create: {
            sessionId,
            learnerId,
            joinedAt,
            leftAt,
            attendedMinutes,
            status,
            providerParticipantId: records[0]!.providerParticipantId,
            providerSnapshot,
          },
        });
        await transaction.attendanceInterval.createMany({
          data: records.map((item) => ({
            id: id("attendance-interval"),
            sessionId,
            learnerId,
            joinedAt: new Date(item.joinedAt),
            leftAt: new Date(item.leftAt),
            source: "PROVIDER",
            providerParticipantId: item.providerParticipantId,
          })),
        });
      }
      const seenLearners = new Set(validRecords.map((item) => item.learnerId));
      for (const learnerId of enrolledIds) {
        if (seenLearners.has(learnerId)) continue;
        await transaction.attendanceRecord.upsert({
          where: { sessionId_learnerId: { sessionId, learnerId } },
          update: {},
          create: {
            sessionId,
            learnerId,
            status: "ABSENT",
            attendedMinutes: 0,
            providerSnapshot: { absentFromProviderExport: true },
          },
        });
      }
      await transaction.auditLog.create({
        data: {
          actorId,
          action: "ATTENDANCE_SYNC",
          entityType: "live_session",
          entityId: sessionId,
          context: {
            received: inputRecords.length,
            accepted: validRecords.length,
            skippedLearnerIds: skipped,
          },
        },
      });
      return skipped;
    });
    return {
      review: await serviceContext.getAttendanceReview(sessionId),
      skippedLearnerIds,
    };
  }

  const session = serviceContext.findSession(sessionId);
  if (session.status !== "COMPLETED")
    throw new ConflictException(
      "Chỉ đồng bộ điểm danh sau khi buổi học kết thúc.",
    );
  if (session.attendanceLockedAt)
    throw new ConflictException("Kỳ điểm danh đã khóa.");
  const enrolledIds = new Set(
    serviceContext.findClass(session.classId).learnerIds,
  );
  const skippedLearnerIds = inputRecords
    .filter((item) => !enrolledIds.has(item.learnerId))
    .map((item) => item.learnerId);
  const seenLearners = new Set<string>();
  const validRecords = inputRecords.filter((record) =>
    enrolledIds.has(record.learnerId),
  );
  const byLearner = new Map<string, ProviderAttendanceInput[]>();
  for (const item of validRecords)
    byLearner.set(item.learnerId, [
      ...(byLearner.get(item.learnerId) ?? []),
      item,
    ]);
  serviceContext.attendanceIntervals.splice(
    0,
    serviceContext.attendanceIntervals.length,
    ...serviceContext.attendanceIntervals.filter(
      (item) => item.sessionId !== sessionId || item.source !== "PROVIDER",
    ),
  );
  for (const [learnerId, records] of byLearner) {
    const intervals = records.map((item) => ({
      joinedAt: new Date(item.joinedAt),
      leftAt: new Date(item.leftAt),
    }));
    for (const interval of intervals)
      serviceContext.calculateProviderAttendanceMinutes(
        interval.joinedAt,
        interval.leftAt,
        new Date(session.startsAt),
        new Date(session.endsAt),
      );
    const attendedMinutes = serviceContext.mergedAttendanceMinutes(
      intervals,
      new Date(session.startsAt),
      new Date(session.endsAt),
    );
    const joinedAt = intervals.reduce(
      (earliest, item) => (item.joinedAt < earliest ? item.joinedAt : earliest),
      intervals[0]!.joinedAt,
    );
    const leftAt = intervals.reduce(
      (latest, item) => (item.leftAt > latest ? item.leftAt : latest),
      intervals[0]!.leftAt,
    );
    const status = serviceContext.deriveProviderAttendanceStatus(
      joinedAt,
      attendedMinutes,
      new Date(session.startsAt),
    );
    const providerSnapshot = { intervals: records };
    const existing = serviceContext.attendance.find(
      (record) =>
        record.sessionId === sessionId && record.learnerId === learnerId,
    );
    if (existing)
      Object.assign(existing, {
        joinedAt: joinedAt.toISOString(),
        leftAt: leftAt.toISOString(),
        attendedMinutes,
        status,
        providerParticipantId: records[0]!.providerParticipantId,
        providerSnapshot,
      });
    else
      serviceContext.attendance.push({
        sessionId,
        learnerId,
        joinedAt: joinedAt.toISOString(),
        leftAt: leftAt.toISOString(),
        attendedMinutes,
        status,
        providerParticipantId: records[0]!.providerParticipantId,
        providerSnapshot,
      });
    serviceContext.attendanceIntervals.push(
      ...records.map((item) => ({
        sessionId,
        learnerId,
        joinedAt: item.joinedAt,
        leftAt: item.leftAt,
        source: "PROVIDER" as const,
      })),
    );
    seenLearners.add(learnerId);
  }
  for (const learnerId of enrolledIds) {
    if (
      !seenLearners.has(learnerId) &&
      !serviceContext.attendance.some(
        (item) => item.sessionId === sessionId && item.learnerId === learnerId,
      )
    )
      serviceContext.attendance.push({
        sessionId,
        learnerId,
        attendedMinutes: 0,
        status: "ABSENT",
        providerSnapshot: { absentFromProviderExport: true },
      });
  }
  return {
    review: await serviceContext.getAttendanceReview(sessionId),
    skippedLearnerIds,
  };
}

/** Khóa điểm danh sau khi buổi kết thúc và không còn dữ liệu cần đối soát. */
export async function lockAttendance(
  serviceContext: LearningServiceContext,
  sessionId: string,
  actorId = "usr-manager",
): Promise<LiveSession> {
  const prisma = serviceContext.database();
  if (prisma) {
    return prisma.$transaction(async (transaction) => {
      const session = await transaction.liveSession.findUnique({
        where: { id: sessionId },
        include: {
          appeals: { where: { status: { in: ["OPEN", "IN_REVIEW"] } } },
        },
      });
      if (!session) throw new NotFoundException("Không tìm thấy buổi học.");
      if (session.status !== "COMPLETED")
        throw new ConflictException(
          "Chỉ khóa điểm danh của buổi học đã kết thúc.",
        );
      if (session.attendanceLockedAt)
        throw new ConflictException("Kỳ điểm danh đã được khóa trước đó.");
      if (session.appeals.length)
        throw new ConflictException(
          "Cần xử lý hết yêu cầu điều chỉnh trước khi khóa.",
        );
      const updated = await transaction.liveSession.update({
        where: { id: sessionId },
        data: {
          attendanceLockedAt: new Date(),
          attendanceLockedById: actorId,
        },
      });
      await transaction.auditLog.create({
        data: {
          actorId,
          action: "ATTENDANCE_LOCK",
          entityType: "live_session",
          entityId: sessionId,
          context: { lockedAt: updated.attendanceLockedAt?.toISOString() },
        },
      });
      return serviceContext.mapSession(updated);
    });
  }
  const session = serviceContext.findSession(sessionId);
  if (session.status !== "COMPLETED")
    throw new ConflictException("Chỉ khóa điểm danh của buổi học đã kết thúc.");
  if (session.attendanceLockedAt)
    throw new ConflictException("Kỳ điểm danh đã được khóa trước đó.");
  if (
    serviceContext.attendanceAppeals.some(
      (item) =>
        item.sessionId === sessionId &&
        ["OPEN", "IN_REVIEW"].includes(item.status),
    )
  )
    throw new ConflictException(
      "Cần xử lý hết yêu cầu điều chỉnh trước khi khóa.",
    );
  session.attendanceLockedAt = now();
  session.attendanceLockedById = actorId;
  return { ...session };
}

/** Giải quyết khiếu nại và nếu duyệt thì cập nhật điểm danh cùng audit nguyên tử. */
export async function resolveAttendanceAppeal(
  serviceContext: LearningServiceContext,
  appealId: string,
  decision: "APPROVE" | "REJECT",
  resolution: string,
  status?: AttendanceRecord["status"],
  attendedMinutes?: number,
  actorId = "usr-manager",
): Promise<AttendanceAppeal> {
  const normalizedResolution = resolution.trim();
  if (normalizedResolution.length < 5)
    throw new BadRequestException("Kết luận xử lý cần ít nhất 5 ký tự.");
  if (
    decision === "APPROVE" &&
    (status === undefined || attendedMinutes === undefined)
  )
    throw new BadRequestException(
      "Cần trạng thái và số phút mới khi phê duyệt điều chỉnh.",
    );
  const prisma = serviceContext.database();
  if (prisma) {
    return prisma.$transaction(async (transaction) => {
      const appeal = await transaction.attendanceAppeal.findUnique({
        where: { id: appealId },
        include: { session: true },
      });
      if (!appeal)
        throw new NotFoundException("Không tìm thấy yêu cầu điều chỉnh.");
      if (!["OPEN", "IN_REVIEW"].includes(appeal.status))
        throw new ConflictException("Yêu cầu đã được xử lý.");
      if (appeal.session.attendanceLockedAt)
        throw new ConflictException("Kỳ điểm danh đã khóa.");
      if (decision === "APPROVE") {
        serviceContext.validateAttendanceMinutes(
          attendedMinutes!,
          appeal.session.startsAt,
          appeal.session.endsAt,
        );
        await transaction.attendanceRecord.update({
          where: {
            sessionId_learnerId: {
              sessionId: appeal.sessionId,
              learnerId: appeal.learnerId,
            },
          },
          data: {
            status,
            attendedMinutes,
            adjustmentReason: normalizedResolution,
          },
        });
      }
      const updated = await transaction.attendanceAppeal.update({
        where: { id: appealId },
        data: {
          status: decision === "APPROVE" ? "RESOLVED" : "REJECTED",
          resolution: normalizedResolution,
        },
      });
      await transaction.auditLog.create({
        data: {
          actorId,
          action: `ATTENDANCE_APPEAL_${decision}`,
          entityType: "attendance_appeal",
          entityId: appealId,
          context: {
            sessionId: appeal.sessionId,
            learnerId: appeal.learnerId,
            status,
            attendedMinutes,
            resolution: normalizedResolution,
          },
        },
      });
      await transaction.notification.create({
        data: {
          id: id("notification"),
          recipientId: appeal.learnerId,
          type: "ATTENDANCE_APPEAL_RESOLVED",
          title:
            decision === "APPROVE"
              ? "Yêu cầu điểm danh đã được chấp thuận"
              : "Yêu cầu điểm danh không được chấp thuận",
          entityType: "ATTENDANCE_APPEAL",
          entityId: appealId,
          dedupKey: `attendance-appeal:${appealId}:${decision}`,
        },
      });
      return serviceContext.mapAttendanceAppeal(updated);
    });
  }
  const appeal = serviceContext.attendanceAppeals.find(
    (item) => item.id === appealId,
  );
  if (!appeal)
    throw new NotFoundException("Không tìm thấy yêu cầu điều chỉnh.");
  if (!["OPEN", "IN_REVIEW"].includes(appeal.status))
    throw new ConflictException("Yêu cầu đã được xử lý.");
  const session = serviceContext.findSession(appeal.sessionId);
  if (session.attendanceLockedAt)
    throw new ConflictException("Kỳ điểm danh đã khóa.");
  if (decision === "APPROVE") {
    serviceContext.validateAttendanceMinutes(
      attendedMinutes!,
      new Date(session.startsAt),
      new Date(session.endsAt),
    );
    const record = serviceContext.attendance.find(
      (item) =>
        item.sessionId === appeal.sessionId &&
        item.learnerId === appeal.learnerId,
    );
    if (!record)
      throw new NotFoundException(
        "Không tìm thấy dữ liệu điểm danh cần điều chỉnh.",
      );
    Object.assign(record, {
      status,
      attendedMinutes,
      adjustmentReason: normalizedResolution,
    });
  }
  appeal.status = decision === "APPROVE" ? "RESOLVED" : "REJECTED";
  appeal.resolution = normalizedResolution;
  serviceContext.notifications.unshift({
    id: id("notification"),
    recipientId: appeal.learnerId,
    type: "ATTENDANCE_APPEAL_RESOLVED",
    title:
      decision === "APPROVE"
        ? "Yêu cầu điểm danh đã được chấp thuận"
        : "Yêu cầu điểm danh không được chấp thuận",
    entityType: "ATTENDANCE_APPEAL",
    entityId: appealId,
    createdAt: now(),
  });
  return { ...appeal };
}
