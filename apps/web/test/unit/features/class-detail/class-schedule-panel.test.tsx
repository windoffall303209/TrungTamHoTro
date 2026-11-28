import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ClassSchedulePanel } from "../../../../src/features/class-detail/class-schedule-panel";
import type { LearningClass, LiveSession } from "@/lib/learning-types";

const mockApiRequest = vi.hoisted(() => vi.fn());

vi.mock("@/lib/api-client", () => ({
  apiRequest: mockApiRequest,
}));

const tomorrow = new Date(Date.now() + 86_400_000);
const tomorrowDate = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, "0")}-${String(tomorrow.getDate()).padStart(2, "0")}`;

const classItem: LearningClass = {
  id: "cls-live-1",
  courseId: "crs-1",
  courseVersion: 1,
  code: "WEB01",
  name: "Web Full-stack",
  term: "2026-HK1",
  startAt: new Date(Date.now() - 10 * 86_400_000).toISOString(),
  endAt: new Date(Date.now() + 60 * 86_400_000).toISOString(),
  capacity: 40,
  timezone: "Asia/Bangkok",
  status: "ACTIVE",
  instructorIds: ["usr-instructor"],
  learnerIds: ["usr-learner"],
};

const existingSession: LiveSession = {
  id: "sess-real-1",
  classId: "cls-live-1",
  title: "Buổi học Google Meet có sẵn",
  startsAt: new Date(Date.now() + 2 * 3_600_000).toISOString(),
  endsAt: new Date(Date.now() + 3 * 3_600_000).toISOString(),
  provider: "GOOGLE_MEET",
  status: "SCHEDULED",
  hostUrl: "https://meet.google.com/abc-defg-hij",
  attendeeUrl: "https://meet.google.com/abc-defg-hij",
  timezone: "Asia/Bangkok",
};

describe("ClassSchedulePanel", () => {
  const notify = vi.fn();

  beforeEach(() => {
    notify.mockReset();
    mockApiRequest.mockReset();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("nạp lịch thật theo lớp, mở modal thêm buổi gắn Google Meet và mở thẳng link khi bấm Vào phòng", async () => {
    let sessionsStore = [existingSession];
    mockApiRequest.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === "/sessions") return sessionsStore;
      if (
        url === "/instructor/classes/cls-live-1/sessions" &&
        init?.method === "POST"
      ) {
        const body = JSON.parse(String(init.body)) as {
          title: string;
          startsAt: string;
          endsAt: string;
          provider: "GOOGLE_MEET";
          meetingUrl: string;
        };
        const created: LiveSession = {
          id: "sess-real-2",
          classId: "cls-live-1",
          title: body.title,
          startsAt: body.startsAt,
          endsAt: body.endsAt,
          provider: body.provider,
          status: "SCHEDULED",
          hostUrl: body.meetingUrl,
          attendeeUrl: body.meetingUrl,
          timezone: "Asia/Bangkok",
        };
        sessionsStore = [...sessionsStore, created];
        return created;
      }
      if (url === "/sessions/sess-real-1/join" && init?.method === "POST") {
        return {
          attendeeUrl: "https://meet.google.com/abc-defg-hij",
          joinedAt: new Date().toISOString(),
        };
      }
      throw new Error(`Unexpected API call: ${url}`);
    });

    const popupWindow = { opener: window, location: { replace: vi.fn() }, close: vi.fn() };
    const openSpy = vi.spyOn(window, "open").mockReturnValue(popupWindow as unknown as Window);

    render(
      <ClassSchedulePanel
        classItem={classItem}
        roleCode="INSTRUCTOR"
        canManage={true}
        canTransitionStatus={true}
        locale="vi-VN"
        notify={notify}
        t={(key) => key}
      />,
    );

    expect(await screen.findByText("Buổi học Google Meet có sẵn")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Vào phòng" }));
    await waitFor(() =>
      expect(popupWindow.location.replace).toHaveBeenCalledWith(
        "https://meet.google.com/abc-defg-hij",
      ),
    );
    expect(openSpy).toHaveBeenCalledWith("", "_blank");
    expect(popupWindow.opener).toBeNull();
    expect(notify).not.toHaveBeenCalledWith(
      "Đang kết nối phòng học trực tuyến...",
      expect.anything(),
    );

    fireEvent.click(screen.getByRole("button", { name: "Thêm buổi học mới" }));
    fireEvent.change(screen.getByLabelText(/Tên buổi học/i), {
      target: { value: "Buổi 02: Chữa bài tập" },
    });
    fireEvent.change(screen.getByLabelText(/Ngày học/i), {
      target: { value: tomorrowDate },
    });
    fireEvent.change(screen.getByLabelText(/Giờ bắt đầu/i), {
      target: { value: "19:30" },
    });
    fireEvent.change(screen.getByLabelText(/Giờ kết thúc/i), {
      target: { value: "21:00" },
    });
    fireEvent.change(screen.getByLabelText(/Link Google Meet/i), {
      target: { value: "https://zoom.us/j/not-google-meet" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Tạo buổi học" }));
    expect(
      (await screen.findAllByText(
        "Link phòng học phải là URL Google Meet hợp lệ (https://meet.google.com/...).",
      )).length,
    ).toBeGreaterThan(0);

    fireEvent.change(screen.getByLabelText(/Link Google Meet/i), {
      target: { value: "https://meet.google.com/xyz-abcd-efg" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Tạo buổi học" }));

    await waitFor(() =>
      expect(mockApiRequest).toHaveBeenCalledWith(
        "/instructor/classes/cls-live-1/sessions",
        expect.objectContaining({
          method: "POST",
          roleCode: "INSTRUCTOR",
        }),
      ),
    );
    expect(await screen.findByText("Buổi 02: Chữa bài tập")).toBeInTheDocument();
  });

  it.each(["CENTER_MANAGER", "SYSTEM_ADMIN"] as const)(
    "hiển thị Chưa tới giờ khi giáo viên chưa bắt đầu và chỉ hiện Vào phòng khi LIVE đối với %s",
    async (roleCode) => {
      mockApiRequest.mockImplementation(async (url: string) => {
        if (url === "/sessions") {
          return [
            { ...existingSession, id: "sess-sched", title: "Ca chưa bắt đầu", status: "SCHEDULED" },
            { ...existingSession, id: "sess-live", title: "Ca đang học", status: "LIVE" },
          ];
        }
        throw new Error(`Unexpected API call: ${url}`);
      });

      render(
        <ClassSchedulePanel
          classItem={classItem}
          roleCode={roleCode}
          canManage={true}
          canTransitionStatus={true}
          locale="vi-VN"
          notify={notify}
          t={(key) => key}
        />,
      );

      expect(await screen.findByText("Ca chưa bắt đầu")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Chưa tới giờ" })).toBeDisabled();
      expect(screen.getAllByRole("button", { name: "Vào phòng" })).toHaveLength(1);
      expect(screen.queryByRole("button", { name: "Bắt đầu" })).not.toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: /Dạng tháng/i }));
      expect(screen.getByRole("button", { name: "Chưa tới giờ" })).toBeDisabled();
      expect(screen.getAllByRole("button", { name: "Vào phòng" })).toHaveLength(1);
    },
  );
});
