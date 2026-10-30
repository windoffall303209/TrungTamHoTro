import { BadRequestException, ConflictException } from "@nestjs/common";
import type {
  AttendanceRecord,
  LiveSession,
  ProviderAttendanceInput,
} from "../learning.types.js";

/** Type guard giới hạn provider vào danh mục phòng họp được hỗ trợ. */
export function isLiveProvider(
  value: string,
): value is LiveSession["provider"] {
  return value === "GOOGLE_MEET" || value === "ZOOM" || value === "JITSI";
}

/** Kiểm tra số lượng, userId và mốc thời gian của dữ liệu điểm danh provider. */
export function validateProviderAttendanceInput(
  records: ProviderAttendanceInput[],
): void {
  if (!records.length)
    throw new BadRequestException("Cần ít nhất một bản ghi từ nhà cung cấp.");
  const participantOwners = new Map<string, string>();
  for (const record of records) {
    const participantOwner = participantOwners.get(
      record.providerParticipantId,
    );
    if (participantOwner && participantOwner !== record.learnerId)
      throw new ConflictException(
        `Mã người tham dự ${record.providerParticipantId} thuộc nhiều học viên.`,
      );
    const joinedAt = new Date(record.joinedAt);
    const leftAt = new Date(record.leftAt);
    if (
      Number.isNaN(joinedAt.getTime()) ||
      Number.isNaN(leftAt.getTime()) ||
      leftAt <= joinedAt
    )
      throw new BadRequestException(
        `Khoảng tham dự của ${record.learnerId} không hợp lệ.`,
      );
    participantOwners.set(record.providerParticipantId, record.learnerId);
  }
}

/** Cắt khoảng tham dự theo biên buổi học rồi tính số phút hợp lệ. */
export function calculateProviderAttendanceMinutes(
  joinedAt: Date,
  leftAt: Date,
  startsAt: Date,
  endsAt: Date,
): number {
  if (
    joinedAt > new Date(endsAt.getTime() + 30 * 60_000) ||
    leftAt < new Date(startsAt.getTime() - 15 * 60_000)
  )
    throw new BadRequestException(
      "Khoảng tham dự nằm ngoài cửa sổ của buổi học.",
    );
  const effectiveStart = new Date(
    Math.max(joinedAt.getTime(), startsAt.getTime()),
  );
  const effectiveEnd = new Date(Math.min(leftAt.getTime(), endsAt.getTime()));
  return Math.max(
    0,
    Math.round((effectiveEnd.getTime() - effectiveStart.getTime()) / 60_000),
  );
}

/** Hợp nhất các khoảng chồng nhau, cắt theo thời lượng buổi và trả tổng phút không đếm trùng. */
export function mergedAttendanceMinutes(
  intervals: Array<{ joinedAt: Date; leftAt: Date }>,
  startsAt: Date,
  endsAt: Date,
): number {
  const clipped = intervals
    .map((item) => ({
      start: Math.max(item.joinedAt.getTime(), startsAt.getTime()),
      end: Math.min(item.leftAt.getTime(), endsAt.getTime()),
    }))
    .filter((item) => item.end > item.start)
    .sort((left, right) => left.start - right.start);
  if (!clipped.length) return 0;
  let total = 0;
  let currentStart = clipped[0]!.start;
  let currentEnd = clipped[0]!.end;
  for (const interval of clipped.slice(1)) {
    if (interval.start <= currentEnd)
      currentEnd = Math.max(currentEnd, interval.end);
    else {
      total += currentEnd - currentStart;
      currentStart = interval.start;
      currentEnd = interval.end;
    }
  }
  total += currentEnd - currentStart;
  return Math.max(0, Math.round(total / 60_000));
}

/** Suy ra PRESENT/LATE/ABSENT từ giờ vào và tổng phút provider ghi nhận. */
export function deriveProviderAttendanceStatus(
  joinedAt: Date,
  attendedMinutes: number,
  startsAt: Date,
): AttendanceRecord["status"] {
  if (attendedMinutes === 0) return "ABSENT";
  return joinedAt.getTime() > startsAt.getTime() + 10 * 60_000
    ? "LATE"
    : "PRESENT";
}

/** Chặn số phút âm hoặc vượt quá độ dài buổi học. */
export function validateAttendanceMinutes(
  attendedMinutes: number,
  startsAt: Date,
  endsAt: Date,
): void {
  const maximum = Math.max(
    0,
    Math.round((endsAt.getTime() - startsAt.getTime()) / 60_000) + 30,
  );
  if (
    !Number.isInteger(attendedMinutes) ||
    attendedMinutes < 0 ||
    attendedMinutes > maximum
  )
    throw new BadRequestException(`Số phút tham dự phải từ 0 đến ${maximum}.`);
}
