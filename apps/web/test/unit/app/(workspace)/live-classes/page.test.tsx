import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
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
      if (path === "/sessions") return ++sessionRequests === 1 ? first.promise : second.promise;
      if (path === "/classes") return Promise.resolve([]);
      throw new Error(`Unexpected request: ${path}`);
    });

    const view = render(<LiveClassesPage />);
    await waitFor(() => expect(sessionRequests).toBe(1));
    currentRole.code = "SYSTEM_ADMIN";
    view.rerender(<LiveClassesPage />);
    await waitFor(() => expect(sessionRequests).toBe(2));
    await act(async () => second.resolve([{ ...session, id: "live-b", title: "New session" }]));
    expect(screen.getByText("New session")).toBeInTheDocument();
    await act(async () => first.resolve([session]));
    expect(screen.getByText("New session")).toBeInTheDocument();
    expect(screen.queryByText("Old session")).not.toBeInTheDocument();
    expect(notifyMock).not.toHaveBeenCalled();
  });

  it("ignores a pending schedule failure after unmount", async () => {
    const pending = deferred<LiveSession[]>();
    apiMock.mockImplementation((path: string) => {
      if (path === "/sessions") return pending.promise;
      if (path === "/classes") return Promise.resolve([]);
      throw new Error(`Unexpected request: ${path}`);
    });
    const view = render(<LiveClassesPage />);
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith("/sessions", expect.anything()));
    view.unmount();
    await act(async () => pending.reject(new Error("Outdated schedule failure")));
    expect(notifyMock).not.toHaveBeenCalled();
  });
});
