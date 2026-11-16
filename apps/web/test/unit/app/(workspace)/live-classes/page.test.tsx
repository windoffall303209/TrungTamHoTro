import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LiveSession } from "@/lib/learning-types";
import LiveClassesPage from "../../../../../src/app/(workspace)/live-classes/page";

const { apiMock, notifyMock, currentRole } = vi.hoisted(() => ({
  apiMock: vi.fn(), notifyMock: vi.fn(), currentRole: { code: "CENTER_MANAGER" },
}));

vi.mock("@/lib/api-client", () => ({ apiRequest: apiMock }));
vi.mock("next/navigation", () => ({ useSearchParams: () => ({ get: () => null }) }));
vi.mock("@/lib/access-control", () => ({ hasPermission: () => true }));
vi.mock("@/providers/app-provider", () => ({
  useApp: () => ({ session: { roleCode: currentRole.code }, notify: notifyMock }),
}));
vi.mock("@/providers/i18n-provider", () => ({ useI18n: () => ({ t: (value: string) => value }) }));

const session: LiveSession = {
  id: "live-a", classId: "class-a", title: "Old session",
  startsAt: "2026-10-31T08:00:00Z", endsAt: "2026-10-31T09:00:00Z",
  provider: "JITSI", status: "COMPLETED", hostUrl: "", attendeeUrl: "", timezone: "Asia/Bangkok",
};

// Tạo request trì hoãn để thử tình huống các phản hồi về sai thứ tự.
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((success, failure) => { resolve = success; reject = failure; });
  return { promise, resolve, reject };
}

describe("LiveClassesPage request lifecycle", () => {
  beforeEach(() => {
    currentRole.code = "CENTER_MANAGER";
    apiMock.mockReset();
    notifyMock.mockReset();
  });

  afterEach(() => cleanup());

  it("keeps the newest schedule when an older role request finishes last", async () => {
    const first = deferred<LiveSession[]>();
    const second = deferred<LiveSession[]>();
    let sessionRequests = 0;
    apiMock.mockImplementation((path: string) => {
      if (path.startsWith("/sessions/page?")) return ++sessionRequests === 1 ? first.promise : second.promise;
      if (path === "/classes") return Promise.resolve([]);
      throw new Error(`Unexpected request: ${path}`);
    });

    const view = render(<LiveClassesPage />);
    await waitFor(() => expect(sessionRequests).toBe(1));
    currentRole.code = "SYSTEM_ADMIN";
    view.rerender(<LiveClassesPage />);
    await waitFor(() => expect(sessionRequests).toBe(2));
    await act(async () =>
      second.resolve({
        items: [{ ...session, id: "live-b", title: "New session" }],
        total: 1,
        page: 1,
        pageSize: 10,
        totalPages: 1,
      } as unknown as LiveSession[]),
    );
    expect(screen.getByText("New session")).toBeInTheDocument();
    await act(async () => first.resolve([session]));
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
      expect(apiMock).toHaveBeenCalledWith(expect.stringMatching(/^\/sessions\/page\?/), expect.anything()),
    );
    view.unmount();
    await act(async () => pending.reject(new Error("Outdated schedule failure")));
    expect(notifyMock).not.toHaveBeenCalled();
  });

  it("chuyển trang danh sách buổi học trực tuyến ở chế độ quản trị", async () => {
    apiMock.mockImplementation((path: string) => {
      if (path === "/classes") return Promise.resolve([]);
      if (path.startsWith("/sessions/page?")) {
        const page = Number(new URLSearchParams(path.split("?")[1] ?? "").get("page") ?? "1");
        return Promise.resolve({
          items: [{ ...session, id: `live-${page}`, title: `Schedule Page ${page}` }],
          total: 14,
          page,
          pageSize: 10,
          totalPages: 2,
        });
      }
      throw new Error(`Unexpected request: ${path}`);
    });

    render(<LiveClassesPage />);
    await screen.findByText("Schedule Page 1");
    fireEvent.click(screen.getByRole("button", { name: "Trang sau" }));
    await screen.findByText("Schedule Page 2");
  });
});
