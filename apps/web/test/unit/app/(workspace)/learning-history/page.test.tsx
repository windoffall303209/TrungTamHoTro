import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LiveSession } from "@/lib/learning-types";
import LearningHistoryPage from "../../../../../src/app/(workspace)/learning-history/page";

const { apiMock, notifyMock } = vi.hoisted(() => ({ apiMock: vi.fn(), notifyMock: vi.fn() }));

vi.mock("@/lib/api-client", () => ({ apiRequest: apiMock }));
vi.mock("@/providers/app-provider", () => ({
  useApp: () => ({ session: { roleCode: "LEARNER" }, notify: notifyMock }),
}));

const session: LiveSession = {
  id: "lesson-a", classId: "class-a", title: "Session A",
  startsAt: "2026-10-31T08:00:00Z", endsAt: "2026-10-31T09:00:00Z",
  provider: "JITSI", status: "COMPLETED", hostUrl: "", attendeeUrl: "", timezone: "Asia/Bangkok",
};

// Mô phỏng nhiều request cùng buổi học trả về khác thứ tự.
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((success, failure) => { resolve = success; reject = failure; });
  return { promise, resolve, reject };
}

// Tạo dữ liệu điểm danh có số phút nhận diện riêng cho từng lần tải.
function makeSummary(minutes: number) {
  return {
    session, recordingAvailable: false, attendance: { attendedMinutes: minutes, status: "PRESENT" },
  };
}

describe("LearningHistoryPage request lifecycle", () => {
  beforeEach(() => {
    apiMock.mockReset();
    notifyMock.mockReset();
  });

  afterEach(() => cleanup());

  it("keeps the newest summary after the previous request completes late", async () => {
    const first = deferred<ReturnType<typeof makeSummary>>();
    const second = deferred<ReturnType<typeof makeSummary>>();
    let requestCount = 0;
    apiMock.mockImplementation((path: string) => {
      if (path === "/sessions") return Promise.resolve([session]);
      if (path === "/learner/sessions/lesson-a/summary") return ++requestCount === 1 ? first.promise : second.promise;
      throw new Error(`Unexpected request: ${path}`);
    });

    render(<LearningHistoryPage />);
    const button = await screen.findByRole("button", { name: "Xem điểm danh" });
    fireEvent.click(button);
    fireEvent.click(button);
    await act(async () => second.resolve(makeSummary(80)));
    expect(screen.getByText("80'")).toBeInTheDocument();
    await act(async () => first.resolve(makeSummary(20)));
    expect(screen.getByText("80'")).toBeInTheDocument();
    expect(screen.queryByText("20'")).not.toBeInTheDocument();
    expect(notifyMock).not.toHaveBeenCalled();
  });

  it("does not show a loading error after the page unmounts", async () => {
    const pending = deferred<LiveSession[]>();
    apiMock.mockImplementation((path: string) => {
      if (path === "/sessions") return pending.promise;
      throw new Error(`Unexpected request: ${path}`);
    });
    const page = render(<LearningHistoryPage />);
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith("/sessions", expect.anything()));
    page.unmount();
    await act(async () => pending.reject(new Error("Obsolete session load")));
    expect(notifyMock).not.toHaveBeenCalled();
  });
});
