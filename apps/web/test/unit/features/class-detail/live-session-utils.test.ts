import { describe, expect, it } from "vitest";
import {
  buildDefaultSessionDraft,
  canLearnerJoinSession,
  normalizeGoogleMeetUrlInput,
  validateSessionFormInput,
} from "../../../../src/features/class-detail/live-session-utils";

const sampleClass = {
  startAt: "2026-11-01T00:00:00.000Z",
  endAt: "2026-12-31T23:59:59.000Z",
};

describe("live-session-utils", () => {
  it("chuẩn hóa và xác thực đúng link Google Meet hợp lệ", () => {
    expect(
      normalizeGoogleMeetUrlInput("  https://meet.google.com/abc-defg-hij?authuser=0 "),
    ).toBe("https://meet.google.com/abc-defg-hij?authuser=0");
    expect(normalizeGoogleMeetUrlInput("meet.google.com/xyz-pqrs-tuv")).toBe(
      "https://meet.google.com/xyz-pqrs-tuv",
    );
    expect(normalizeGoogleMeetUrlInput("http://meet.google.com/abc-defg-hij")).toBeNull();
    expect(normalizeGoogleMeetUrlInput("https://zoom.us/j/123456")).toBeNull();
    expect(normalizeGoogleMeetUrlInput("https://meet.google.com/")).toBeNull();
    expect(
      normalizeGoogleMeetUrlInput("https://attacker@meet.google.com/abc-defg-hij"),
    ).toBeNull();
  });

  it("kiểm tra hợp lệ dữ liệu tạo/sửa buổi học theo quy tắc lớp và thời gian", () => {
    const now = new Date("2026-11-16T07:00:00.000Z");
    const valid = validateSessionFormInput({
      title: "Buổi 01: Ôn tập",
      date: "2026-11-20",
      startTime: "19:30",
      endTime: "21:00",
      meetingUrl: "https://meet.google.com/abc-defg-hij",
      classItem: sampleClass,
      now,
    });
    expect(valid.valid).toBe(true);
    expect(valid.normalizedMeetingUrl).toBe("https://meet.google.com/abc-defg-hij");

    const invalidEndBeforeStart = validateSessionFormInput({
      title: "Buổi sai giờ",
      date: "2026-11-20",
      startTime: "21:00",
      endTime: "19:30",
      meetingUrl: "https://meet.google.com/abc-defg-hij",
      classItem: sampleClass,
      now,
    });
    expect(invalidEndBeforeStart.valid).toBe(false);
    expect(invalidEndBeforeStart.errors.time).toBe(
      "Thời gian kết thúc phải sau thời gian bắt đầu.",
    );

    const outOfClass = validateSessionFormInput({
      title: "Buổi ngoài khóa",
      date: "2027-01-10",
      startTime: "19:30",
      endTime: "21:00",
      meetingUrl: "https://meet.google.com/abc-defg-hij",
      classItem: sampleClass,
      now,
    });
    expect(outOfClass.valid).toBe(false);
    expect(outOfClass.errors.time).toBe("Buổi học phải nằm trong thời gian của lớp.");

    const editWithoutMandatoryReason = validateSessionFormInput({
      title: "Buổi đổi lịch",
      date: "2026-11-20",
      startTime: "19:30",
      endTime: "21:00",
      meetingUrl: "https://meet.google.com/abc-defg-hij",
      classItem: sampleClass,
      now,
    });
    expect(editWithoutMandatoryReason.valid).toBe(true);
    expect(editWithoutMandatoryReason.errors.reason).toBeUndefined();

    const draft = buildDefaultSessionDraft(sampleClass, now);
    expect(draft.date).toBe("2026-11-17");
  });

  it("xác định chính xác cửa sổ vào phòng của học viên", () => {
    const startsAt = "2026-11-20T12:30:00.000Z";
    const endsAt = "2026-11-20T14:00:00.000Z";
    expect(
      canLearnerJoinSession(
        { status: "LIVE", startsAt, endsAt },
        new Date("2026-11-16T00:00:00.000Z").getTime(),
      ),
    ).toBe(true);
    expect(
      canLearnerJoinSession(
        { status: "SCHEDULED", startsAt, endsAt },
        new Date("2026-11-20T12:10:00.000Z").getTime(),
      ),
    ).toBe(false);
    expect(
      canLearnerJoinSession(
        { status: "SCHEDULED", startsAt, endsAt },
        new Date("2026-11-20T12:20:00.000Z").getTime(),
      ),
    ).toBe(true);
    expect(
      canLearnerJoinSession(
        { status: "CANCELLED", startsAt, endsAt },
        new Date("2026-11-20T12:35:00.000Z").getTime(),
      ),
    ).toBe(false);
  });
});
