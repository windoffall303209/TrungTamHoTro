import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";
import type { Prisma } from "../../../../generated/prisma/client.js";
import {
  paginateArray,
  type PaginatedResult,
} from "../../../../common/pagination.js";
import { id, now } from "../../core/learning.shared.js";
import type { LiveSession } from "../../core/learning.types.js";
import type { LearningServiceContext } from "../../core/learning.context.js";
import { readWithoutTransaction } from "../../../../database/read-without-transaction.js";

const GOOGLE_MEET_URL_ERROR =
  "Link phòng học phải là URL Google Meet hợp lệ (https://meet.google.com/...).";

const INVALID_SESSION_TIME_ERROR = "Thời gian buổi học không hợp lệ.";

// Kiểm tra và chuẩn hóa URL Google Meet hợp lệ cho phòng học trực tuyến.
export function normalizeGoogleMeetUrl(rawUrl: string): string {
  const trimmed = rawUrl.trim();
  if (!trimmed || /\s/.test(trimmed) || trimmed.length > 1000) {
    throw new BadRequestException(GOOGLE_MEET_URL_ERROR);
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new BadRequestException(GOOGLE_MEET_URL_ERROR);
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.hostname.toLowerCase() !== "meet.google.com" ||
    Boolean(parsed.username) ||
    Boolean(parsed.password) ||
    parsed.pathname.replaceAll("/", "").length === 0
  ) {
    throw new BadRequestException(GOOGLE_MEET_URL_ERROR);
  }
  return parsed.toString();
}

// Kiểm tra tiêu đề và mốc thời gian bắt đầu/kết thúc trước khi thao tác DB.
function validateSessionWindow(
  title: string,
  startsAtRaw: string,
  endsAtRaw: string,
  pastErrorMessage: string,
): { title: string; startsAt: Date; endsAt: Date } {
  const normalizedTitle = title.trim();
  if (normalizedTitle.length < 3) {
    throw new BadRequestException("Tên buổi học cần ít nhất 3 ký tự.");
  }
  const startsAt = new Date(startsAtRaw);
  const endsAt = new Date(endsAtRaw);
  if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime())) {
    throw new BadRequestException(INVALID_SESSION_TIME_ERROR);
  }
  if (endsAt <= startsAt) {
    throw new BadRequestException(
      "Thời gian kết thúc phải sau thời gian bắt đầu.",
    );
  }
  if (startsAt < new Date()) {
    throw new BadRequestException(pastErrorMessage);
  }
  return { title: normalizedTitle, startsAt, endsAt };
}

// Tạo metadata phòng học từ link Google Meet gắn trực tiếp hoặc fallback provider cũ.
async function resolveProvisionedMeeting(
  serviceContext: LearningServiceContext,
  requestedProvider: LiveSession["provider"] = "GOOGLE_MEET",
  meetingUrl?: string,
): Promise<{
  provider: LiveSession["provider"];
  requestedProvider: LiveSession["provider"];
  hostUrl: string;
  attendeeUrl: string;
  fallbackUsed: boolean;
  attempts: number;
}> {
  if (meetingUrl !== undefined) {
    const normalizedUrl = normalizeGoogleMeetUrl(meetingUrl);
    return {
      provider: "GOOGLE_MEET",
      requestedProvider: "GOOGLE_MEET",
      hostUrl: normalizedUrl,
      attendeeUrl: normalizedUrl,
      fallbackUsed: false,
      attempts: 1,
    };
  }
  const provisioned =
    await serviceContext.provisionProviderMeeting(requestedProvider);
  return {
    ...provisioned,
    requestedProvider,
  };
}

// Kiểm tra vai trò quản trị được quyền lên lịch thay cho giảng viên của lớp.
function isManagerRole(role: string): boolean {
  return role === "CENTER_MANAGER" || role === "SYSTEM_ADMIN";
}

const SESSION_ACCESS_DENIED = "Vai trò hiện tại không được phép truy cập buổi học này.";

// Deny-by-default: chỉ giảng viên và cấp quản lý được tạo, sửa hoặc hủy buổi học; vai trò lạ bị từ chối thay vì được toàn quyền.
function assertSessionControlRole(role: string): void {
  if (role !== "INSTRUCTOR" && !isManagerRole(role)) throw new ForbiddenException(SESSION_ACCESS_DENIED);
}

// Deny-by-default cho thao tác đọc/tham gia: chỉ bốn vai trò đã biết mới đi tiếp, mỗi vai trò tự giới hạn phạm vi lớp.
function assertKnownSessionRole(role: string): void {
  if (role !== "LEARNER" && role !== "INSTRUCTOR" && !isManagerRole(role)) throw new ForbiddenException(SESSION_ACCESS_DENIED);
}

export interface LiveSessionPageFilters {
  classId?: string;
  status?: LiveSession["status"];
  query?: string;
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
}

/** Tạo điều kiện giới hạn buổi học theo vai trò và quan hệ thành viên lớp. */
function buildSessionRoleWhere(
  role: string,
  actorId: string,
): Prisma.LiveSessionWhereInput | undefined {
  if (role === "LEARNER") {
    return {
      class: { enrollments: { some: { learnerId: actorId, status: "ACTIVE" } } },
    };
  }
  if (role === "INSTRUCTOR") {
    return { class: { instructors: { some: { instructorId: actorId } } } };
  }
  if (isManagerRole(role)) return undefined;
  throw new ForbiddenException(SESSION_ACCESS_DENIED);
}

/** Ẩn liên kết phòng và URL bản ghi gốc khi trả danh sách buổi học cho học viên; học viên nhận link phòng qua API join xác thực thành viên lớp. */
function redactSessionForRole(
  mapped: LiveSession,
  role: string,
): LiveSession {
  const expired = Boolean(mapped.recordingExpiresAt && new Date(mapped.recordingExpiresAt) <= new Date());
  const visible = expired ? { ...mapped, recordingUrl: undefined } : mapped;
  return role === "INSTRUCTOR" || isManagerRole(role)
    ? visible
    : { ...visible, hostUrl: "", attendeeUrl: "", recordingUrl: undefined };
}

/** Kiểm tra thành viên lớp trên kho nhớ fallback cho danh sách buổi học. */
function canAccessMemorySession(
  serviceContext: LearningServiceContext,
  item: LiveSession,
  role: string,
  actorId: string,
): boolean {
  const classItem = serviceContext.classes.find(
    (candidate) => candidate.id === item.classId,
  );
  if (role === "LEARNER") return Boolean(classItem?.learnerIds.includes(actorId));
  if (role === "INSTRUCTOR") return Boolean(classItem?.instructorIds.includes(actorId));
  return isManagerRole(role);
}

/** Liệt kê buổi trực tuyến theo quan hệ lớp và trạng thái truy cập của vai trò. */
export async function listSessions(
  serviceContext: LearningServiceContext,
  role: string,
  actorId: string,
): Promise<LiveSession[]> {
  assertKnownSessionRole(role);
  const prisma = serviceContext.database();
  if (prisma) {
    const rows = await prisma.liveSession.findMany({
      where: buildSessionRoleWhere(role, actorId),
      orderBy: { startsAt: "desc" },
    });
    return rows.map((row) =>
      redactSessionForRole(serviceContext.mapSession(row), role),
    );
  }
  return serviceContext.sessions
    .filter((item) => canAccessMemorySession(serviceContext, item, role, actorId))
    .map((item) => redactSessionForRole({ ...item }, role));
}

/** Phân trang danh sách buổi học theo vai trò, lớp, trạng thái và khoảng thời gian trên DB. */
export async function listSessionsPage(
  serviceContext: LearningServiceContext,
  role: string,
  actorId: string,
  filters: LiveSessionPageFilters = {},
): Promise<PaginatedResult<LiveSession>> {
  assertKnownSessionRole(role);
  const query = filters.query?.trim();
  const classId = filters.classId?.trim();
  if ((query && query.length > 255) || (classId && classId.length > 191)) {
    throw new BadRequestException("Search filters must not exceed 255 characters.");
  }
  const from = filters.from ? new Date(filters.from) : undefined;
  const to = filters.to ? new Date(filters.to) : undefined;
  if ((from && Number.isNaN(from.getTime())) || (to && Number.isNaN(to.getTime()))) {
    throw new BadRequestException(INVALID_SESSION_TIME_ERROR);
  }
  if (from && to && from > to) {
    throw new BadRequestException("Thời gian bắt đầu phải trước thời gian kết thúc.");
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
  const prisma = serviceContext.database();
  if (prisma) {
    const andConditions: Prisma.LiveSessionWhereInput[] = [];
    const roleWhere = buildSessionRoleWhere(role, actorId);
    if (roleWhere) andConditions.push(roleWhere);
    if (classId) andConditions.push({ classId });
    if (filters.status) andConditions.push({ status: filters.status });
    if (from || to) andConditions.push({ startsAt: { gte: from, lte: to } });
    if (query) {
      andConditions.push({
        OR: [
          { title: { contains: query, mode: "insensitive" } },
          { provider: { contains: query, mode: "insensitive" } },
        ],
      });
    }
    const where: Prisma.LiveSessionWhereInput | undefined =
      andConditions.length > 0 ? { AND: andConditions } : undefined;
    const { rows, total, safePage, totalPages } = await readWithoutTransaction(prisma,
      async (transaction) => {
        const total = await transaction.liveSession.count({ where });
        const totalPages = Math.max(1, Math.ceil(total / pageSize));
        const safePage = Math.min(page, totalPages);
        const rows =
          total === 0
            ? []
            : await transaction.liveSession.findMany({
                where,
                orderBy: [{ startsAt: "desc" }, { id: "asc" }],
                skip: (safePage - 1) * pageSize,
                take: pageSize,
              });
        return { rows, total, safePage, totalPages };
      }
    );
    return {
      items: rows.map((row) =>
        redactSessionForRole(serviceContext.mapSession(row), role),
      ),
      total,
      page: safePage,
      pageSize,
      totalPages,
    };
  }
  const normalizedQuery = query?.toLowerCase() ?? "";
  const filtered = serviceContext.sessions
    .filter(
      (item) =>
        canAccessMemorySession(serviceContext, item, role, actorId) &&
        (!classId || item.classId === classId) &&
        (!filters.status || item.status === filters.status) &&
        (!from || new Date(item.startsAt) >= from) &&
        (!to || new Date(item.startsAt) <= to) &&
        (!normalizedQuery ||
          `${item.title} ${item.provider}`
            .toLowerCase()
            .includes(normalizedQuery)),
    )
    .map((item) => redactSessionForRole({ ...item }, role));
  return paginateArray(filtered, page, pageSize);
}

/** Validate lịch/quyền lớp, lưu link Google Meet hoặc cấp phòng từ provider rồi thông báo thành viên. */
export async function createSession(
  serviceContext: LearningServiceContext,
  classId: string,
  input: Pick<LiveSession, "title" | "startsAt" | "endsAt" | "provider"> & {
    meetingUrl?: string;
  },
  actorId: string,
  actorRole: string,
): Promise<LiveSession> {
  assertSessionControlRole(actorRole);
  const validated = validateSessionWindow(
    input.title,
    input.startsAt,
    input.endsAt,
    "Không thể lên lịch buổi học trong quá khứ.",
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
    const hostId = isManagerRole(actorRole)
      ? (classItem.instructors.find((row) => row.role === "PRIMARY")
          ?.instructorId ?? classItem.instructors[0]?.instructorId)
      : actorId;
    if (
      !hostId ||
      !classItem.instructors.some((item) => item.instructorId === hostId)
    )
      throw new NotFoundException("Lớp chưa có giảng viên phù hợp để chủ trì.");
    if (
      validated.startsAt < classItem.startAt ||
      validated.endsAt > classItem.endAt
    )
      throw new BadRequestException(
        "Buổi học phải nằm trong thời gian của lớp.",
      );
    const overlaps = await prisma.liveSession.count({
      where: {
        OR: [{ classId }, { hostId }],
        status: { not: "CANCELLED" },
        startsAt: { lt: validated.endsAt },
        endsAt: { gt: validated.startsAt },
      },
    });
    if (overlaps) throw new ConflictException("Lịch học bị trùng.");
    const provisioned = await resolveProvisionedMeeting(
      serviceContext,
      input.provider,
      input.meetingUrl,
    );
    const created = await prisma.liveSession.create({
      data: {
        id: id("session"),
        classId,
        hostId,
        title: validated.title,
        startsAt: validated.startsAt,
        endsAt: validated.endsAt,
        provider: provisioned.provider,
        requestedProvider: provisioned.requestedProvider,
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
          startsAt: validated.startsAt.toISOString(),
          endsAt: validated.endsAt.toISOString(),
          timezone: classItem.timezone,
          requestedProvider: provisioned.requestedProvider,
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
  const hostId = isManagerRole(actorRole) ? classItem.instructorIds[0] : actorId;
  if (!hostId || !classItem.instructorIds.includes(hostId))
    throw new NotFoundException("Lớp chưa có giảng viên phù hợp để chủ trì.");
  if (
    validated.startsAt < new Date(classItem.startAt) ||
    validated.endsAt > new Date(classItem.endAt)
  )
    throw new BadRequestException("Buổi học phải nằm trong thời gian của lớp.");
  const overlaps = serviceContext.sessions.some(
    (item) =>
      item.classId === classId &&
      item.status !== "CANCELLED" &&
      validated.startsAt < new Date(item.endsAt) &&
      validated.endsAt > new Date(item.startsAt),
  );
  if (overlaps) throw new ConflictException("Lịch học bị trùng.");
  const provisioned = await resolveProvisionedMeeting(
    serviceContext,
    input.provider,
    input.meetingUrl,
  );
  const item: LiveSession = {
    title: validated.title,
    startsAt: validated.startsAt.toISOString(),
    endsAt: validated.endsAt.toISOString(),
    provider: provisioned.provider,
    requestedProvider: provisioned.requestedProvider,
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

/** Cập nhật lịch và liên kết phòng họp trước khi buổi học diễn ra và lưu dấu vết audit. */
export async function updateSession(
  serviceContext: LearningServiceContext,
  sessionId: string,
  input: Pick<LiveSession, "title" | "startsAt" | "endsAt" | "provider"> & {
    reason?: string;
    meetingUrl?: string;
  },
  actorId: string,
  actorRole: string,
): Promise<LiveSession> {
  assertSessionControlRole(actorRole);
  const reason = input.reason?.trim() || "Cập nhật lịch học";
  const validated = validateSessionWindow(
    input.title,
    input.startsAt,
    input.endsAt,
    "Không thể chuyển buổi học vào quá khứ.",
  );
  const prisma = serviceContext.database();
  if (prisma) {
    const current = await prisma.liveSession.findUnique({
      where: { id: sessionId },
      include: { class: { include: { instructors: true } } },
    });
    if (!current) throw new NotFoundException("Không tìm thấy buổi học.");
    if (current.class.status === "CLOSED")
      throw new ConflictException("Lớp đã lưu trữ và chỉ cho phép đọc.");
    if (
      !isManagerRole(actorRole) &&
      current.hostId !== actorId &&
      !current.class.instructors.some((row) => row.instructorId === actorId)
    )
      throw new NotFoundException(
        "Không tìm thấy buổi học được phép điều khiển.",
      );
    if (current.status !== "SCHEDULED" || current.startsAt <= new Date())
      throw new ConflictException("Chỉ được sửa buổi học sắp diễn ra.");
    if (
      validated.startsAt < current.class.startAt ||
      validated.endsAt > current.class.endAt
    )
      throw new BadRequestException(
        "Buổi học phải nằm trong thời gian của lớp.",
      );
    const overlap = await prisma.liveSession.count({
      where: {
        id: { not: sessionId },
        OR: [{ classId: current.classId }, { hostId: current.hostId }],
        status: { not: "CANCELLED" },
        startsAt: { lt: validated.endsAt },
        endsAt: { gt: validated.startsAt },
      },
    });
    if (overlap)
      throw new ConflictException(
        "Lịch mới bị trùng lớp hoặc trùng lịch giảng viên.",
      );
    // Chỉ sửa tiêu đề/giờ học thì giữ nguyên link phòng đang dùng (có thể là link Meet thật giảng viên đã dán).
    const keepMeeting = input.meetingUrl === undefined && Boolean(current.attendeeUrl) && (!input.provider || input.provider === current.provider);
    const provisioned = keepMeeting
      ? {
          provider: current.provider as LiveSession["provider"],
          requestedProvider: current.requestedProvider as LiveSession["provider"],
          hostUrl: current.hostUrl,
          attendeeUrl: current.attendeeUrl,
          fallbackUsed: current.fallbackUsed,
          attempts: current.provisioningAttempts,
        }
      : await resolveProvisionedMeeting(
          serviceContext,
          input.provider,
          input.meetingUrl,
        );
    const updated = await prisma.liveSession.update({
      where: { id: sessionId },
      data: {
        title: validated.title,
        startsAt: validated.startsAt,
        endsAt: validated.endsAt,
        provider: provisioned.provider,
        requestedProvider: provisioned.requestedProvider,
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
          startsAt: validated.startsAt,
          endsAt: validated.endsAt,
          provider: provisioned.provider,
        },
      },
    });
    return serviceContext.mapSession(updated);
  }
  const item = serviceContext.findSession(sessionId);
  const classItem = serviceContext.findClass(item.classId);
  if (classItem.status === "CLOSED")
    throw new ConflictException("Lớp đã lưu trữ và chỉ cho phép đọc.");
  if (
    !isManagerRole(actorRole) &&
    item.hostId !== actorId &&
    !classItem.instructorIds.includes(actorId)
  )
    throw new NotFoundException("Không tìm thấy buổi học được phép điều khiển.");
  if (item.status !== "SCHEDULED" || new Date(item.startsAt) <= new Date())
    throw new ConflictException("Chỉ được sửa buổi học sắp diễn ra.");
  if (
    validated.startsAt < new Date(classItem.startAt) ||
    validated.endsAt > new Date(classItem.endAt)
  )
    throw new BadRequestException("Buổi học phải nằm trong thời gian của lớp.");
  const overlap = serviceContext.sessions.some(
    (row) =>
      row.id !== sessionId &&
      row.classId === item.classId &&
      row.status !== "CANCELLED" &&
      validated.startsAt < new Date(row.endsAt) &&
      validated.endsAt > new Date(row.startsAt),
  );
  if (overlap)
    throw new ConflictException(
      "Lịch mới bị trùng lớp hoặc trùng lịch giảng viên.",
    );
  const keepMeeting = input.meetingUrl === undefined && Boolean(item.attendeeUrl) && (!input.provider || input.provider === item.provider);
  const provisioned = keepMeeting
    ? {
        provider: item.provider,
        requestedProvider: item.requestedProvider ?? item.provider,
        hostUrl: item.hostUrl,
        attendeeUrl: item.attendeeUrl,
        fallbackUsed: item.fallbackUsed ?? false,
        attempts: item.provisioningAttempts ?? 1,
      }
    : await resolveProvisionedMeeting(
        serviceContext,
        input.provider,
        input.meetingUrl,
      );
  Object.assign(item, {
    title: validated.title,
    startsAt: validated.startsAt.toISOString(),
    endsAt: validated.endsAt.toISOString(),
    provider: provisioned.provider,
    requestedProvider: provisioned.requestedProvider,
    fallbackUsed: provisioned.fallbackUsed,
    provisioningAttempts: provisioned.attempts,
    changeReason: reason,
    hostUrl: provisioned.hostUrl,
    attendeeUrl: provisioned.attendeeUrl,
  });
  return { ...item };
}

/** Hủy buổi chưa hoàn tất và gửi thông báo tới lớp. */
export async function cancelSession(
  serviceContext: LearningServiceContext,
  sessionId: string,
  reason: string | undefined,
  actorId: string,
  actorRole: string,
): Promise<LiveSession> {
  assertSessionControlRole(actorRole);
  const normalized = reason?.trim() || "Hủy buổi học";
  const prisma = serviceContext.database();
  if (prisma) {
    const current = await prisma.liveSession.findUnique({
      where: { id: sessionId },
      include: { class: { include: { instructors: true } } },
    });
    if (!current) throw new NotFoundException("Không tìm thấy buổi học.");
    if (current.class.status === "CLOSED")
      throw new ConflictException("Lớp đã lưu trữ và chỉ cho phép đọc.");
    if (
      !isManagerRole(actorRole) &&
      current.hostId !== actorId &&
      !current.class.instructors.some((row) => row.instructorId === actorId)
    )
      throw new NotFoundException(
        "Không tìm thấy buổi học được phép điều khiển.",
      );
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
  const classItem = serviceContext.findClass(item.classId);
  if (classItem.status === "CLOSED")
    throw new ConflictException("Lớp đã lưu trữ và chỉ cho phép đọc.");
  if (
    !isManagerRole(actorRole) &&
    item.hostId !== actorId &&
    !classItem.instructorIds.includes(actorId)
  )
    throw new NotFoundException("Không tìm thấy buổi học được phép điều khiển.");
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
  actorId: string,
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
      include: { class: { include: { instructors: true } } },
    });
    if (
      !item ||
      (item.hostId !== actorId &&
        !item.class.instructors.some((row) => row.instructorId === actorId))
    )
      throw new NotFoundException(
        "Không tìm thấy buổi học được phép điều khiển.",
      );
    if (item.class.status === "CLOSED")
      throw new ConflictException("Lớp đã lưu trữ và chỉ cho phép đọc.");
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
  const classItem = serviceContext.findClass(item.classId);
  if (item.hostId !== actorId && !classItem.instructorIds.includes(actorId))
    throw new NotFoundException(
      "Không tìm thấy buổi học được phép điều khiển.",
    );
  if (classItem.status === "CLOSED")
    throw new ConflictException("Lớp đã lưu trữ và chỉ cho phép đọc.");
  if (!allowed[item.status].includes(status))
    throw new BadRequestException(
      `Không thể chuyển ${item.status} → ${status}.`,
    );
  item.status = status;
  return { ...item };
}

/** Xác minh quyền thành viên lớp theo vai trò và trả URL phòng họp hợp lệ bất kể khung giờ khi buổi học còn mở. */
export async function joinSession(
  serviceContext: LearningServiceContext,
  sessionId: string,
  actorId: string,
  actorRole: string,
): Promise<{ attendeeUrl: string; joinedAt: string }> {
  assertKnownSessionRole(actorRole);
  const prisma = serviceContext.database();
  if (prisma) {
    const session = await prisma.liveSession.findUnique({
      where: { id: sessionId },
      include: { class: { include: { instructors: true } } },
    });
    if (!session) throw new NotFoundException("Không tìm thấy buổi học.");
    if (["CANCELLED", "COMPLETED"].includes(session.status))
      throw new BadRequestException("Buổi học không còn cho phép tham gia.");

    if (actorRole === "INSTRUCTOR") {
      if (
        session.hostId !== actorId &&
        !session.class.instructors.some((row) => row.instructorId === actorId)
      ) {
        throw new BadRequestException("Giảng viên không thuộc lớp của buổi học.");
      }
      const meetingUrl = session.hostUrl || session.attendeeUrl;
      if (!meetingUrl) {
        throw new BadRequestException("Buổi học chưa có liên kết phòng học.");
      }
      return {
        attendeeUrl: meetingUrl,
        joinedAt: new Date().toISOString(),
      };
    }

    if (isManagerRole(actorRole)) {
      const meetingUrl = session.hostUrl || session.attendeeUrl;
      if (!meetingUrl) {
        throw new BadRequestException("Buổi học chưa có liên kết phòng học.");
      }
      return {
        attendeeUrl: meetingUrl,
        joinedAt: new Date().toISOString(),
      };
    }

    const enrollment = await prisma.classEnrollment.findFirst({
      where: { classId: session.classId, learnerId: actorId, status: "ACTIVE" },
    });
    if (!enrollment) throw new BadRequestException("Học viên không thuộc lớp.");
    const meetingUrl = session.attendeeUrl || session.hostUrl;
    if (!meetingUrl) {
      throw new BadRequestException("Buổi học chưa có liên kết phòng học.");
    }
    return {
      attendeeUrl: meetingUrl,
      joinedAt: new Date().toISOString(),
    };
  }
  const item = serviceContext.findSession(sessionId);
  const classItem = serviceContext.findClass(item.classId);
  if (item.status === "CANCELLED" || item.status === "COMPLETED")
    throw new BadRequestException("Buổi học không còn cho phép tham gia.");
  if (actorRole === "INSTRUCTOR") {
    if (item.hostId !== actorId && !classItem.instructorIds.includes(actorId)) {
      throw new BadRequestException("Giảng viên không thuộc lớp của buổi học.");
    }
    const meetingUrl = item.hostUrl || item.attendeeUrl;
    if (!meetingUrl) {
      throw new BadRequestException("Buổi học chưa có liên kết phòng học.");
    }
    return { attendeeUrl: meetingUrl, joinedAt: now() };
  }
  if (isManagerRole(actorRole)) {
    const meetingUrl = item.hostUrl || item.attendeeUrl;
    if (!meetingUrl) {
      throw new BadRequestException("Buổi học chưa có liên kết phòng học.");
    }
    return { attendeeUrl: meetingUrl, joinedAt: now() };
  }
  if (!classItem.learnerIds.includes(actorId))
    throw new BadRequestException("Học viên không thuộc lớp.");
  const meetingUrl = item.attendeeUrl || item.hostUrl;
  if (!meetingUrl) {
    throw new BadRequestException("Buổi học chưa có liên kết phòng học.");
  }
  return { attendeeUrl: meetingUrl, joinedAt: now() };
}
