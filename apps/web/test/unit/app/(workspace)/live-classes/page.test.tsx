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

describe("LiveClassesPage aggregated schedule", () => {
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

  it.each(["INSTRUCTOR", "LEARNER"] as const)(
    "hiển thị lưới lịch học tổng hợp 7 ngày cho %s và ẩn nút Lên lịch với học sinh",
    async (roleCode) => {
      currentRole.code = roleCode;
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
      if (roleCode === "INSTRUCTOR") {
        expect(screen.getByRole("button", { name: "Lên lịch" })).toBeInTheDocument();
      } else {
        expect(screen.queryByRole("button", { name: "Lên lịch" })).not.toBeInTheDocument();
      }
    },
  );

  it.each(["CENTER_MANAGER", "SYSTEM_ADMIN"] as const)(
    "chuyển hướng %s khỏi trang /live-classes riêng lẻ về tab lịch trong lớp",
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

  it("tra cứu classId từ sessionId để mở thẳng tab Lịch học trong lớp khi quản lý mở liên kết chỉ mang sessionId", async () => {
    currentRole.code = "CENTER_MANAGER";
    searchParamsState.values.set("sessionId", "ses-77");
    apiMock.mockImplementation((path: string) => {
      if (path === "/sessions") {
        return Promise.resolve([
          buildTodaySession({ id: "ses-77", classId: "cls-55" }),
        ]);
      }
      throw new Error(`Unexpected request: ${path}`);
    });

    render(<LiveClassesPage />);

    await waitFor(() =>
      expect(replaceMock).toHaveBeenCalledWith(
        "/courses/classes/cls-55?tab=schedule&sessionId=ses-77",
      ),
    );
  });

  it("hiển thị Đã kết thúc cho buổi COMPLETED và cho phép học sinh bấm Vào phòng ngay cả khi chưa tới giờ", async () => {
    currentRole.code = "LEARNER";
    const now = new Date();
    const futureStarts = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 0, 0);
    const futureEnds = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 55, 0);
    apiMock.mockImplementation((path: string) => {
      if (path === "/classes") return Promise.resolve([]);
      if (path.startsWith("/sessions/page?")) {
        return Promise.resolve({
          items: [
            buildTodaySession({ id: "done-1", title: "Ca sáng", status: "COMPLETED" }),
            buildTodaySession({
              id: "future-1",
              title: "Ca tối",
              status: "SCHEDULED",
              startsAt: futureStarts.toISOString(),
              endsAt: futureEnds.toISOString(),
            }),
          ],
          total: 2,
          page: 1,
          pageSize: 100,
          totalPages: 1,
        });
      }
      throw new Error(`Unexpected request: ${path}`);
    });

    render(<LiveClassesPage />);
    expect(await screen.findByText("Đã kết thúc")).toBeInTheDocument();
    expect(screen.queryByText("COMPLETED")).not.toBeInTheDocument();
    const joinBtn = screen.getByRole("button", { name: /Vào phòng/i });
    expect(joinBtn).not.toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Tháng" }));
    expect(await screen.findByText("Đã kết thúc")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Vào phòng/i })).not.toBeDisabled();
  });
});
