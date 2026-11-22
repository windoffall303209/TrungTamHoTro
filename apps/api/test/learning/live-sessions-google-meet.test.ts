import "reflect-metadata";
import { ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../../src/app.module.js";
import { PrismaService } from "../../src/database/prisma.service.js";
import {
  CreateSessionDto,
  UpdateSessionDto,
} from "../../src/domains/learning/core/learning.dto.js";
import { LearningService } from "../../src/domains/learning/core/learning.service.js";
import { SystemService } from "../../src/domains/system/core/system.service.js";

const suffix = `${process.pid}-${Date.now().toString(36)}`;

describe("Live sessions with direct Google Meet URLs", () => {
  let prisma: PrismaService;
  let learning: LearningService;
  let system: SystemService;
  const createdClassIds: string[] = [];
  const createdUserIds: string[] = [];
  let instructorRoleId = "";

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    prisma = moduleRef.get(PrismaService);
    learning = moduleRef.get(LearningService);
    system = moduleRef.get(SystemService);

    const role = await prisma.role.findUniqueOrThrow({
      where: { code: "INSTRUCTOR" },
    });
    instructorRoleId = role.id;

    for (const key of ["co", "outsider"]) {
      const userId = `usr-meet-${key}-${suffix}`;
      await prisma.user.create({
        data: {
          id: userId,
          username: `meet-${key}-${suffix}`,
          email: `meet-${key}-${suffix}@wind.test`,
          displayName: `GV ${key}`,
          status: "ACTIVE",
        },
      });
      await prisma.userRole.create({
        data: { userId, roleId: instructorRoleId },
      });
      createdUserIds.push(userId);
    }
  });

  afterAll(async () => {
    if (createdClassIds.length) {
      await prisma.learningClass.deleteMany({
        where: { id: { in: createdClassIds } },
      });
    }
    if (createdUserIds.length) {
      await prisma.user.deleteMany({
        where: { id: { in: createdUserIds } },
      });
    }
  });

  it("kiểm tra DTO bắt buộc link Google Meet hợp lệ khi lên lịch hoặc đổi lịch", async () => {
    const pipe = new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    });
    await expect(
      pipe.transform(
        {
          title: "Buổi học Google Meet",
          startsAt: "2027-03-10T12:30:00.000Z",
          endsAt: "2027-03-10T14:00:00.000Z",
          provider: "GOOGLE_MEET",
        },
        { type: "body", metatype: CreateSessionDto },
      ),
    ).rejects.toThrow();

    const validCreate = (await pipe.transform(
      {
        title: "  Buổi học Google Meet  ",
        startsAt: "2027-03-10T12:30:00.000Z",
        endsAt: "2027-03-10T14:00:00.000Z",
        provider: "GOOGLE_MEET",
        meetingUrl: "  https://meet.google.com/abc-defg-hij  ",
      },
      { type: "body", metatype: CreateSessionDto },
    )) as CreateSessionDto;
    expect(validCreate.title).toBe("Buổi học Google Meet");
    expect(validCreate.meetingUrl).toBe("https://meet.google.com/abc-defg-hij");

    const validUpdate = (await pipe.transform(
      {
        title: "Buổi cập nhật link",
        startsAt: "2027-03-11T12:30:00.000Z",
        endsAt: "2027-03-11T14:00:00.000Z",
        provider: "GOOGLE_MEET",
        meetingUrl: "https://meet.google.com/xyz-abcd-efg",
        reason: "Cập nhật phòng học mới",
      },
      { type: "body", metatype: UpdateSessionDto },
    )) as UpdateSessionDto;
    expect(validUpdate.meetingUrl).toBe("https://meet.google.com/xyz-abcd-efg");
  });

  it("lưu thẳng link Google Meet không fallback Jitsi, kiểm tra quyền giảng viên lớp và mở phòng theo vai trò", async () => {
    const [coInstructorId, outsiderId] = createdUserIds as [string, string];
    const startAt = new Date(Date.now() + 2 * 86_400_000).toISOString();
    const endAt = new Date(Date.now() + 20 * 86_400_000).toISOString();
    const classItem = await learning.createClass({
      courseId: "course-web",
      code: `MEET-${suffix}`.slice(0, 30),
      name: "Lớp Google Meet thật",
      term: "2026-HK1",
      startAt,
      endAt,
      capacity: 30,
    }, "usr-manager");
    createdClassIds.push(classItem.id);

    await learning.assignInstructor(classItem.id, "usr-instructor", "PRIMARY", "usr-manager");
    await learning.assignInstructor(classItem.id, coInstructorId, "CO_INSTRUCTOR", "usr-manager");
    await learning.enrollLearner(classItem.id, "usr-learner", "usr-manager");

    expect(
      (await system.listIntegrations()).some(
        (entry) => entry.provider === "JITSI" && entry.enabled,
      ),
    ).toBe(true);

    const sessionStart = new Date(Date.now() + 5 * 86_400_000).toISOString();
    const sessionEnd = new Date(
      Date.now() + 5 * 86_400_000 + 90 * 60_000,
    ).toISOString();

    await expect(
      learning.createSession(
        classItem.id,
        {
          title: "Link sai tên miền",
          startsAt: sessionStart,
          endsAt: sessionEnd,
          provider: "GOOGLE_MEET",
          meetingUrl: "https://zoom.us/j/123456789",
        },
        "usr-instructor",
        "INSTRUCTOR",
      ),
    ).rejects.toThrow("Google Meet");

    await expect(
      learning.createSession(
        classItem.id,
        {
          title: "Ngoài lớp tạo",
          startsAt: sessionStart,
          endsAt: sessionEnd,
          provider: "GOOGLE_MEET",
          meetingUrl: "https://meet.google.com/abc-defg-hij",
        },
        outsiderId,
        "INSTRUCTOR",
      ),
    ).rejects.toThrow();

    const created = await learning.createSession(
      classItem.id,
      {
        title: "Buổi 01: Thực hành API",
        startsAt: sessionStart,
        endsAt: sessionEnd,
        provider: "GOOGLE_MEET",
        meetingUrl: "https://meet.google.com/abc-defg-hij",
      },
      "usr-instructor",
      "INSTRUCTOR",
    );

    expect(created).toMatchObject({
      provider: "GOOGLE_MEET",
      requestedProvider: "GOOGLE_MEET",
      fallbackUsed: false,
      hostUrl: "https://meet.google.com/abc-defg-hij",
      attendeeUrl: "https://meet.google.com/abc-defg-hij",
    });

    await expect(
      learning.updateSession(
        created.id,
        {
          title: "Ngoài lớp sửa",
          startsAt: sessionStart,
          endsAt: sessionEnd,
          provider: "GOOGLE_MEET",
          meetingUrl: "https://meet.google.com/klm-nopq-rst",
          reason: "Thử vượt quyền",
        },
        outsiderId,
        "INSTRUCTOR",
      ),
    ).rejects.toThrow();

    const updated = await learning.updateSession(
      created.id,
      {
        title: "Buổi 01: Thực hành API (Cập nhật)",
        startsAt: new Date(Date.now() + 6 * 86_400_000).toISOString(),
        endsAt: new Date(
          Date.now() + 6 * 86_400_000 + 90 * 60_000,
        ).toISOString(),
        provider: "GOOGLE_MEET",
        meetingUrl: "https://meet.google.com/klm-nopq-rst",
        reason: "Đổi phòng Google Meet mới cho đồng giảng viên",
      },
      coInstructorId,
      "INSTRUCTOR",
    );
    expect(updated.attendeeUrl).toBe("https://meet.google.com/klm-nopq-rst");

    const coJoin = await learning.joinSession(
      created.id,
      coInstructorId,
      "INSTRUCTOR",
    );
    expect(coJoin.attendeeUrl).toBe("https://meet.google.com/klm-nopq-rst");

    const managerJoin = await learning.joinSession(
      created.id,
      "usr-manager",
      "CENTER_MANAGER",
    );
    expect(managerJoin.attendeeUrl).toBe("https://meet.google.com/klm-nopq-rst");

    await expect(
      learning.joinSession(created.id, outsiderId, "INSTRUCTOR"),
    ).rejects.toThrow("Giảng viên không thuộc lớp");

    await expect(
      learning.joinSession(created.id, "usr-learner", "LEARNER"),
    ).rejects.toThrow("sớm tối đa 15 phút");

    const cancelled = await learning.cancelSession(
      created.id,
      "Dời lịch sang tuần kế tiếp",
      coInstructorId,
      "INSTRUCTOR",
    );
    expect(cancelled.status).toBe("CANCELLED");

    await expect(
      learning.joinSession(created.id, "usr-instructor", "INSTRUCTOR"),
    ).rejects.toThrow("không còn cho phép tham gia");
  });
});
