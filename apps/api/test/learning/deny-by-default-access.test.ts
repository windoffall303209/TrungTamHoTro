import { ForbiddenException } from "@nestjs/common";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LearningService } from "../../src/domains/learning/core/learning.service.js";

describe("Phân quyền deny-by-default cho buổi học trực tuyến và học liệu", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-01T00:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // Tạo lớp riêng có thời gian ở tương lai để lên lịch buổi học kiểm thử.
  async function createLiveClass(service: LearningService): Promise<string> {
    const classItem = await service.createClass({
      courseId: "course-web",
      code: "LIVE-DENY",
      name: "Lớp kiểm thử phân quyền",
      term: "2027",
      startAt: "2027-07-01T00:00:00.000Z",
      endAt: "2027-09-01T00:00:00.000Z",
      capacity: 20,
      timezone: "Asia/Bangkok",
    }, "usr-manager");
    await service.assignInstructor(classItem.id, "host-live", "PRIMARY", "usr-manager");
    return classItem.id;
  }

  it("từ chối vai trò ngoài danh sách khi tạo, sửa, hủy, liệt kê hoặc vào buổi học", async () => {
    const service = new LearningService();
    const classId = await createLiveClass(service);
    const input = { title: "Buổi kiểm thử", startsAt: "2027-07-10T02:00:00.000Z", endsAt: "2027-07-10T03:00:00.000Z", provider: "GOOGLE_MEET" as const };
    const created = await service.createSession(classId, input, "usr-manager", "CENTER_MANAGER");

    await expect(service.createSession(classId, input, "usr-learner", "LEARNER")).rejects.toThrow(ForbiddenException);
    await expect(service.updateSession(created.id, { ...input, reason: "Học viên tự đổi lịch" }, "usr-learner", "LEARNER")).rejects.toThrow(ForbiddenException);
    await expect(service.cancelSession(created.id, "Vai trò lạ tự hủy lịch", "usr-guest", "GUEST")).rejects.toThrow(ForbiddenException);
    await expect(service.listSessions("GUEST", "usr-guest")).rejects.toThrow(ForbiddenException);
    await expect(service.listSessionsPage("GUEST", "usr-guest", {})).rejects.toThrow(ForbiddenException);
    await expect(service.joinSession(created.id, "usr-guest", "GUEST")).rejects.toThrow(ForbiddenException);

    // Vai trò trong danh sách vẫn thao tác được như trước.
    expect((await service.cancelSession(created.id, "Nghỉ theo lịch trung tâm", "usr-manager", "CENTER_MANAGER")).status).toBe("CANCELLED");
  });

  it("không trả học liệu cho vai trò lạ thay vì mặc định toàn quyền đọc", async () => {
    const service = new LearningService();
    expect((await service.listMaterials("CENTER_MANAGER", undefined, "usr-manager")).length).toBeGreaterThan(0);
    expect(await service.listMaterials("GUEST", undefined, "usr-guest")).toEqual([]);
  });
});
