import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LiveSession } from "@/lib/learning-types";
import LiveClassesPage from "../../../../../src/app/(workspace)/live-classes/page";

const { apiMock, notifyMock, replaceMock, searchParamsState, currentRole } = vi.hoisted(() => ({
  apiMock: vi.fn(),
  notifyMock: vi.fn(),
  replaceMock: vi.fn(),
  searchParamsState: { values: new Map<string, string>() },
  currentRole: { code: "INSTRUCTOR" },
}));

vi.mock("@/lib/api-client", () => ({ apiRequest: apiMock }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: replaceMock }),
  useSearchParams: () => ({
    get: (key: string) => searchParamsState.values.get(key) ?? null,
  }),
}));
vi.mock("@/providers/app-provider", () => ({
  useApp: () => ({ session: { roleCode: currentRole.code }, notify: notifyMock }),
}));
vi.mock("@/providers/i18n-provider", () => ({
  useI18n: () => ({ t: (value: string) => value }),
}));

// Tạo mốc thời gian nằm trong ngày hiện tại để buổi học luôn rơi vào tuần và tháng đang xem.
function buildTodaySession(overrides: Partial<LiveSession> = {}): LiveSession {
  const now = new Date();
  const startsAt = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 10, 0, 0);
  const endsAt = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 11, 30, 0);
  return {
    id: "live-a",
    classId: "class-a",
    title: "Old session",
    startsAt: startsAt.toISOString(),
    endsAt: endsAt.toISOString(),
    provider: "GOOGLE_MEET",
    status: "SCHEDULED",
    hostUrl: "https://meet.google.com/abc-defg-hij",
    attendeeUrl: "https://meet.google.com/abc-defg-hij",
    timezone: "Asia/Bangkok",
    ...overrides,
  };
}

// Tạo request trì hoãn để thử tình huống các phản hồi về sai thứ tự.
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((success, failure) => {
    resolve = success;
    reject = failure;
  });
  return { promise, resolve, reject };
}

describe("LiveClassesPage aggregated instructor schedule", () => {
  beforeEach(() => {
    currentRole.code = "INSTRUCTOR";
    searchParamsState.values.clear();
    apiMock.mockReset();
    notifyMock.mockReset();
    replaceMock.mockReset();
  });

  afterEach(() => cleanup());

  it("keeps the newest schedule when an older view request finishes last", async () => {
    const first = deferred<LiveSession[]>();
    const second = deferred<LiveSession[]>();
    let sessionRequests = 0;
    apiMock.mockImplementation((path: string) => {
      if (path.startsWith("/sessions/page?")) {
        return ++sessionRequests === 1 ? first.promise : second.promise;
      }
      if (path === "/classes") return Promise.resolve([]);
      throw new Error(`Unexpected request: ${path}`);
    });

    render(<LiveClassesPage />);
    await waitFor(() => expect(sessionRequests).toBe(1));
    fireEvent.click(screen.getByRole("button", { name: "Tháng" }));
    await waitFor(() => expect(sessionRequests).toBe(2));

    await act(async () =>
      second.resolve({
        items: [buildTodaySession({ id: "live-b", title: "New session" })],
        total: 1,
        page: 1,
        pageSize: 100,
        totalPages: 1,
      } as unknown as LiveSession[]),
    );
    expect(screen.getByText("New session")).toBeInTheDocument();

    await act(async () => first.resolve([buildTodaySession()]));
    expect(screen.getByText("New session")).toBeInTheDocument();
    expect(screen.queryByText("Old session")).not.toBeInTheDocument();
    expect(notifyMock).not.toHaveBeenCalled();
  });

  it("ignores a pending schedule failure after unmount", async () => {
    const pending = deferred<LiveSession[]>();
    apiMock.mockImplementation((path: string) => {
      if (path.startsWith("/sessions/page?")) return pending.promise;
      if (path === "/classes") return Promise.resolve([]);
      throw new Error(`Unexpected request: ${path}`);
    });

    const view = render(<LiveClassesPage />);
    await waitFor(() =>
      expect(apiMock).toHaveBeenCalledWith(
        expect.stringMatching(/^\/sessions\/page\?/),
        expect.anything(),
      ),
    );
    view.unmount();
    await act(async () => pending.reject(new Error("Outdated schedule failure")));
    expect(notifyMock).not.toHaveBeenCalled();
  });

  it("hiển thị lưới tuần 7 ngày cho giảng viên ngay cả khi tuần chưa có buổi học và không còn nhãn Lớp học online", async () => {
    apiMock.mockImplementation((path: string) => {
      if (path === "/classes") return Promise.resolve([]);
      if (path.startsWith("/sessions/page?")) {
        return Promise.resolve({
          items: [],
          total: 0,
          page: 1,
          pageSize: 100,
          totalPages: 1,
        });
      }
      throw new Error(`Unexpected request: ${path}`);
    });

    render(<LiveClassesPage />);
    await waitFor(() =>
      expect(screen.getAllByText("Không có lịch học")).toHaveLength(7),
    );
    expect(screen.getByRole("heading", { name: "Lịch học" })).toBeInTheDocument();
    expect(screen.queryByText("Lớp học online")).not.toBeInTheDocument();
  });

  it.each(["LEARNER", "CENTER_MANAGER", "SYSTEM_ADMIN"] as const)(
    "chuyển hướng %s khỏi trang /live-classes riêng lẻ về danh sách lớp hoặc tab lịch trong lớp",
    async (roleCode) => {
      currentRole.code = roleCode;
      searchParamsState.values.set("classId", "cls-101");

      render(<LiveClassesPage />);

      await waitFor(() =>
        expect(replaceMock).toHaveBeenCalledWith(
          "/courses/classes/cls-101?tab=schedule",
        ),
      );
      expect(apiMock).not.toHaveBeenCalled();
      expect(screen.queryByText("Lớp học online")).not.toBeInTheDocument();
    },
  );
});
